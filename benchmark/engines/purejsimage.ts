import { pathToFileURL } from 'node:url'
import type { Engine, EngineExecution, ImageMetadata, PipelineWorkflow } from '../types.ts'

interface PureImage {
  metadata(): Promise<ImageMetadata>
  autoOrient(): PureImage
  crop(options: { x: number; y: number; width: number; height: number }): PureImage
  resize(options: {
    width?: number
    height?: number
    fit?: 'contain'
    position?: 'center'
    background?: string
    withoutEnlargement?: boolean
  }): PureImage
  encode(
    format: 'jpeg' | 'png' | 'webp',
    options: {
      quality?: number
      compressionLevel?: number
      lossless?: boolean
      background?: string
    },
  ): { toBuffer(): Promise<Uint8Array> }
}

interface PureImageClass {
  open(input: Uint8Array): Promise<PureImage>
}

const entry = process.env.PUREJSIMAGE_ENTRY

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null
}

const isImageClass = (value: unknown): value is PureImageClass => {
  return (
    (typeof value === 'function' || isRecord(value)) &&
    'open' in value &&
    typeof value.open === 'function'
  )
}

const loadImageClass = async (): Promise<PureImageClass> => {
  if (!entry) {
    throw new Error('PUREJSIMAGE_ENTRY is not set')
  }
  const module: unknown = await import(pathToFileURL(entry).href)
  if (!isRecord(module) || !isImageClass(module.Image)) {
    throw new Error(`${entry} does not export Image`)
  }
  return module.Image
}

const applyOperations = async ({
  Image,
  workflow,
  input,
}: {
  Image: PureImageClass
  workflow: PipelineWorkflow
  input: Buffer
}): Promise<EngineExecution> => {
  let image = await Image.open(input)
  let output: Uint8Array | undefined

  for (const operation of workflow.operations) {
    switch (operation.type) {
      case 'metadata':
        return { metadata: await image.metadata() }
      case 'autoOrient':
        image = image.autoOrient()
        break
      case 'crop':
        image = image.crop({
          x: operation.x,
          y: operation.y,
          width: operation.width,
          height: operation.height,
        })
        break
      case 'resize':
        image = image.resize({
          ...(operation.width !== undefined ? { width: operation.width } : {}),
          ...(operation.height !== undefined ? { height: operation.height } : {}),
          ...(operation.withoutEnlargement ? { withoutEnlargement: true } : {}),
        })
        break
      case 'contain':
        image = image.resize({
          width: operation.width,
          height: operation.height,
          fit: 'contain',
          ...(operation.position ? { position: operation.position } : {}),
          background: operation.background,
        })
        break
      case 'encode':
        output = await image
          .encode(operation.format, {
            ...(operation.quality ? { quality: operation.quality } : {}),
            ...(operation.compressionLevel !== undefined
              ? { compressionLevel: operation.compressionLevel }
              : {}),
            ...(operation.lossless !== undefined ? { lossless: operation.lossless } : {}),
            ...(operation.background ? { background: operation.background } : {}),
          })
          .toBuffer()
        break
      default:
        throw new Error('Unsupported operation')
    }
  }

  return output ? { output } : {}
}

export const engine: Engine = {
  id: 'purejsimage',
  version: 'workspace',
  execute: async ({ workflow, inputs }): Promise<EngineExecution> => {
    const Image = await loadImageClass()
    if (!workflow.batch) {
      const input = inputs[0]
      if (!input) throw new Error('Pipeline workflow has no input image')
      return applyOperations({ Image, workflow, input })
    }

    let output: Uint8Array | undefined
    let outputBytes = 0
    for (let index = 0; index < workflow.batch.count; index += 1) {
      const input = inputs[index % inputs.length]
      if (!input) throw new Error('Batch workflow has no input images')
      const image = await Image.open(input)
      output = await image
        .resize({ width: workflow.batch.width })
        .encode('jpeg', { quality: workflow.batch.quality })
        .toBuffer()
      outputBytes += output.byteLength
    }
    if (!output) throw new Error('Batch workflow produced no output')
    return { output, outputBytes, outputCount: workflow.batch.count }
  },
}
