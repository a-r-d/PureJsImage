import { createHash } from 'node:crypto'
import { Animation, Image, ImageType } from 'imagescript'
import type {
  BatchWorkflow,
  BenchmarkColor,
  Engine,
  EngineExecution,
  Operation,
  PipelineWorkflow,
  Workflow,
} from '../types.ts'

type EncodeOperation = Extract<Operation, { type: 'encode' }>

// ImageScript colors are 0xRRGGBBAA numbers.
const color = (value: BenchmarkColor): number => {
  if (value === 'transparent') return 0x00000000
  if (value === '#ffffff') return 0xffffffff
  throw new Error(`Unsupported benchmark color: ${value}`)
}

const encode = (image: Image, operation: EncodeOperation): Promise<Uint8Array> => {
  switch (operation.format) {
    case 'jpeg':
      return image.encodeJPEG({
        ...(operation.quality !== undefined ? { quality: operation.quality } : {}),
        ...(operation.background !== undefined ? { background: color(operation.background) } : {}),
      })
    case 'png':
      return image.encodePNG(
        operation.compressionLevel !== undefined ? { compression: operation.compressionLevel } : {},
      )
    case 'webp':
      // ImageScript encodes WebP losslessly when no quality is given.
      if (operation.lossless === true) return image.encodeWebP()
      if (operation.quality === undefined) {
        throw new Error('ImageScript lossy WebP output needs an explicit quality')
      }
      return image.encodeWebP({ quality: operation.quality })
    case 'avif':
      return image.encodeAVIF(operation.quality !== undefined ? { quality: operation.quality } : {})
    case 'bmp':
      return image.encodeBMP()
    case 'qoi':
      return image.encodeQOI()
    case 'tga':
      return image.encodeTGA()
    case 'gif':
      // ImageScript's default dithering is Floyd-Steinberg at strength 0.85.
      return image.encodeGIF()
    default:
      throw new Error(`ImageScript benchmark output is unsupported: ${operation.format}`)
  }
}

const executeAnimated = async (
  workflow: PipelineWorkflow,
  input: Buffer,
): Promise<EngineExecution> => {
  const animation = await Animation.decode(input)
  for (const operation of workflow.operations) {
    if (operation.type === 'resize' && operation.width !== undefined) {
      animation.resize({ width: operation.width })
    } else if (operation.type === 'encode' && operation.format === 'gif') {
      return { output: await animation.encodeGIF() }
    } else if (operation.type === 'encode' && operation.format === 'webp') {
      // ImageScript writes lossless WebP when no quality is given.
      if (operation.lossless === true) return { output: await animation.encodeWebP() }
      if (operation.quality === undefined) {
        throw new Error('ImageScript lossy WebP output needs an explicit quality')
      }
      return { output: await animation.encodeWebP({ quality: operation.quality }) }
    } else {
      throw new Error(`ImageScript animated operation is unsupported: ${operation.type}`)
    }
  }
  return {}
}

// ImageScript returns GIF frames as stored rectangles. The benchmark only selects frames that
// cover the whole canvas, so a stored frame equals the composited frame.
const selectedFrame = async (input: Buffer, frame: number): Promise<Image> => {
  const animation = await Animation.decode(input)
  const selected = animation.frames[frame]
  if (
    selected?.xOffset !== 0 ||
    selected.yOffset !== 0 ||
    selected.width !== animation.width ||
    selected.height !== animation.height
  ) {
    throw new Error(`ImageScript frame ${frame} does not cover the whole canvas`)
  }
  return selected.image
}

const executePipeline = async (
  workflow: PipelineWorkflow,
  input: Buffer,
): Promise<EngineExecution> => {
  if (workflow.animated) return executeAnimated(workflow, input)
  // ImageScript applies EXIF orientation while decoding, so it is enabled only when the workflow
  // asks for it.
  const image =
    workflow.frame !== undefined && workflow.frame > 0
      ? await selectedFrame(input, workflow.frame)
      : await Image.decode(input, {
          applyOrientation: workflow.operations.some(
            (operation) => operation.type === 'autoOrient',
          ),
        })
  let output: Uint8Array | undefined

  for (const operation of workflow.operations) {
    switch (operation.type) {
      case 'metadata':
        // ImageScript has no header-only reader, so dimensions come from a full decode, as with Jimp.
        return {
          metadata: { format: workflow.expected.format, width: image.width, height: image.height },
        }
      case 'autoOrient':
        // Applied by Image.decode() above.
        break
      case 'rotate':
        // Both PureJsImage and ImageScript use positive clockwise angles.
        image.rotate(operation.degrees)
        break
      case 'flip':
        image.flip('vertical')
        break
      case 'flop':
        image.flip('horizontal')
        break
      case 'crop':
        image.crop(operation.x, operation.y, operation.width, operation.height)
        break
      case 'resize':
        if (
          operation.withoutEnlargement &&
          (!operation.width || image.width <= operation.width) &&
          (!operation.height || image.height <= operation.height)
        ) {
          break
        }
        if (operation.width !== undefined && operation.height !== undefined) {
          image.resize({ width: operation.width, height: operation.height })
        } else if (operation.width !== undefined) {
          image.resize({ width: operation.width })
        } else if (operation.height !== undefined) {
          image.resize({ height: operation.height })
        } else {
          throw new Error('Resize operation requires a width or height')
        }
        break
      case 'contain':
        image.resize({
          width: operation.width,
          height: operation.height,
          fit: 'contain',
          background: color(operation.background),
        })
        break
      case 'encode':
        output = await encode(image, operation)
        break
      default:
        throw new Error(`ImageScript operation is unsupported: ${operation.type}`)
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
  let lastOutput: Uint8Array | undefined

  for (let index = 0; index < workflow.batch.count; index += 1) {
    const input = inputs[index % inputs.length]
    if (!input) throw new Error('Batch workflow has no input images')
    const image = await Image.decode(input, { applyOrientation: false })
    image.resize({ width: workflow.batch.width })
    lastOutput = await image.encodeJPEG({ quality: workflow.batch.quality })
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

const unsupportedOutputs = new Set(['hdr', 'ico', 'netpbm', 'pfm', 'ppm', 'tiff'])

const unsupportedReason = (workflow: Workflow, inputs: readonly Buffer[]): string | undefined => {
  const inputIds = workflow.batch ? workflow.inputs : [workflow.input]
  if (inputIds.some((id) => id.includes('heic') || id.startsWith('iphone12-'))) {
    return 'ImageScript 4.0.0 has no HEIC decoder'
  }
  for (const input of inputs) {
    if (ImageType.getType(input) === null)
      return 'ImageScript 4.0.0 cannot decode this input format'
  }
  for (const operation of workflow.operations ?? []) {
    if (operation.type === 'raw') return 'ImageScript has no streaming raw-decode benchmark path'
    if (operation.type === 'encode' && unsupportedOutputs.has(operation.format)) {
      return `ImageScript 4.0.0 has no ${operation.format.toUpperCase()} encoder for this benchmark`
    }
  }
  return undefined
}

export const engine: Engine = {
  id: 'imagescript',
  version: '4.0.0',
  kind: 'pure-javascript',
  packageName: 'imagescript',
  unsupportedReason,
  execute: async ({ workflow, inputs }): Promise<EngineExecution> => {
    if (workflow.batch) return executeBatch(workflow, inputs)
    const input = inputs[0]
    if (!input) throw new Error('Pipeline workflow has no input image')
    return executePipeline(workflow, input)
  },
}
