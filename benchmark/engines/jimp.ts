import { createHash } from 'node:crypto'
import { Jimp, JimpMime } from 'jimp'
import type {
  BatchWorkflow,
  BenchmarkColor,
  Engine,
  EngineExecution,
  Operation,
  PipelineWorkflow,
} from '../types.ts'

type ContainOperation = Extract<Operation, { type: 'contain' }>
type EncodeOperation = Extract<Operation, { type: 'encode' }>
type ResizeOptions = { w: number; h?: number } | { h: number; w?: number }

interface JimpImage {
  bitmap: { width: number; height: number }
  blit(options: { src: JimpImage; x: number; y: number }): JimpImage
  crop(options: { x: number; y: number; w: number; h: number }): JimpImage
  getBuffer(mime: string, options?: Record<string, unknown>): Promise<Buffer>
  flip(options: { horizontal?: boolean; vertical?: boolean }): JimpImage
  rotate(degrees: number): JimpImage
  resize(options: ResizeOptions): JimpImage
  scaleToFit(options: { w: number; h: number }): JimpImage
}

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null
}

const isJimpImage = (value: unknown): value is JimpImage => {
  return (
    isRecord(value) &&
    isRecord(value.bitmap) &&
    typeof value.bitmap.width === 'number' &&
    typeof value.bitmap.height === 'number' &&
    typeof value.blit === 'function' &&
    typeof value.crop === 'function' &&
    typeof value.flip === 'function' &&
    typeof value.getBuffer === 'function' &&
    typeof value.resize === 'function' &&
    typeof value.rotate === 'function' &&
    typeof value.scaleToFit === 'function'
  )
}

const readJimp = async (input: Buffer): Promise<JimpImage> => {
  const image: unknown = await Jimp.read(input)
  if (!isJimpImage(image)) throw new Error('Jimp returned an invalid image instance')
  return image
}

const createCanvas = (width: number, height: number, color: number): JimpImage => {
  const image: unknown = new Jimp({ width, height, color })
  if (!isJimpImage(image)) throw new Error('Jimp returned an invalid canvas instance')
  return image
}

const parseHexColor = (value: BenchmarkColor): number => {
  if (value === 'transparent') return 0x00000000
  if (value === '#ffffff') return 0xffffffff
  throw new Error(`Unsupported benchmark color: ${value}`)
}

const flatten = (image: JimpImage, background: BenchmarkColor): JimpImage => {
  const canvas = createCanvas(image.bitmap.width, image.bitmap.height, parseHexColor(background))
  canvas.blit({ src: image, x: 0, y: 0 })
  return canvas
}

const contain = (image: JimpImage, operation: ContainOperation): JimpImage => {
  image.scaleToFit({ w: operation.width, h: operation.height })
  const canvas = createCanvas(
    operation.width,
    operation.height,
    parseHexColor(operation.background),
  )
  const x = Math.round((operation.width - image.bitmap.width) / 2)
  const y = Math.round((operation.height - image.bitmap.height) / 2)
  canvas.blit({ src: image, x, y })
  return canvas
}

const encode = async (image: JimpImage, operation: EncodeOperation): Promise<Buffer> => {
  let outputImage = image
  if (operation.format === 'jpeg' && operation.background) {
    outputImage = flatten(image, operation.background)
  }

  if (operation.format === 'jpeg') {
    return outputImage.getBuffer(JimpMime.jpeg, {
      ...(operation.quality !== undefined ? { quality: operation.quality } : {}),
    })
  }
  if (operation.format === 'png') {
    return outputImage.getBuffer(JimpMime.png, {
      ...(operation.compressionLevel !== undefined
        ? { deflateLevel: operation.compressionLevel }
        : {}),
    })
  }
  if (operation.format === 'bmp') return outputImage.getBuffer(JimpMime.bmp)
  if (operation.format === 'tiff') return outputImage.getBuffer(JimpMime.tiff)
  throw new Error(`Unsupported output format: ${operation.format}`)
}

const executePipeline = async (
  workflow: PipelineWorkflow,
  input: Buffer,
): Promise<EngineExecution> => {
  let image = await readJimp(input)
  let output: Buffer | undefined

  for (const operation of workflow.operations) {
    switch (operation.type) {
      case 'metadata':
        return {
          metadata: {
            format: workflow.expected.format,
            width: image.bitmap.width,
            height: image.bitmap.height,
          },
        }
      case 'autoOrient':
        // Jimp.read() already applies EXIF orientation in @jimp/core.
        break
      case 'rotate':
        // PureJsImage uses positive clockwise angles; Jimp uses positive counter-clockwise.
        image.rotate(-operation.degrees)
        break
      case 'flip':
        image.flip({ vertical: true })
        break
      case 'flop':
        image.flip({ horizontal: true })
        break
      case 'crop':
        image.crop({
          x: operation.x,
          y: operation.y,
          w: operation.width,
          h: operation.height,
        })
        break
      case 'resize': {
        if (
          operation.withoutEnlargement &&
          (!operation.width || image.bitmap.width <= operation.width) &&
          (!operation.height || image.bitmap.height <= operation.height)
        ) {
          break
        }
        if (operation.width !== undefined && operation.height !== undefined) {
          image.resize({ w: operation.width, h: operation.height })
        } else if (operation.width !== undefined) {
          image.resize({ w: operation.width })
        } else if (operation.height !== undefined) {
          image.resize({ h: operation.height })
        } else {
          throw new Error('Resize operation requires a width or height')
        }
        break
      }
      case 'contain':
        image = contain(image, operation)
        break
      case 'encode':
        output = await encode(image, operation)
        break
      default:
        throw new Error('Unsupported operation')
    }
  }

  return output ? { output } : {}
}

const executeBatch = async (
  workflow: BatchWorkflow,
  inputs: readonly Buffer[],
): Promise<EngineExecution> => {
  const digest = createHash('sha256')
  let outputBytes = 0
  let lastOutput: Buffer | undefined

  for (let index = 0; index < workflow.batch.count; index += 1) {
    const input = inputs[index % inputs.length]
    if (!input) throw new Error('Batch workflow has no input images')
    const image = await readJimp(input)
    image.resize({ w: workflow.batch.width })
    lastOutput = await image.getBuffer(JimpMime.jpeg, {
      quality: workflow.batch.quality,
    })
    outputBytes += lastOutput.byteLength
    digest.update(lastOutput)
  }

  if (!lastOutput) throw new Error('Batch workflow produced no output')
  return {
    output: lastOutput,
    outputBytes,
    outputCount: workflow.batch.count,
    batchSha256: digest.digest('hex'),
  }
}

export const engine: Engine = {
  id: 'jimp',
  version: '1.6.0',
  kind: 'pure-javascript',
  packageName: 'jimp',
  unsupportedReason: (workflow): string | undefined => {
    const input = workflow.batch ? workflow.inputs.join(',') : workflow.input
    if (input.includes('webp')) return 'Jimp 1.6.0 has no WebP decoder'
    if (input.includes('iphone12-') || input.includes('heic')) {
      return 'Jimp 1.6.0 has no HEIC decoder'
    }
    if (input.includes('ico')) return 'Jimp 1.6.0 has no ICO decoder'
    if (
      workflow.operations?.some(
        (operation) => operation.type === 'encode' && operation.format === 'webp',
      )
    ) {
      return 'Jimp 1.6.0 has no WebP encoder'
    }
    return undefined
  },
  execute: async ({ workflow, inputs }): Promise<EngineExecution> => {
    if (workflow.batch) {
      return executeBatch(workflow, inputs)
    }
    const input = inputs[0]
    if (!input) throw new Error('Pipeline workflow has no input image')
    return executePipeline(workflow, input)
  },
}
