import { decode, encode, type Image } from 'image-js'
import type { Engine, EngineExecution, Operation, PipelineWorkflow } from '../types.ts'

type EncodeOperation = Extract<Operation, { type: 'encode' }>
type CompressionLevel = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9

const compressionLevel = (value: number | undefined): CompressionLevel | undefined => {
  if (value === undefined) return undefined
  switch (value) {
    case 0:
    case 1:
    case 2:
    case 3:
    case 4:
    case 5:
    case 6:
    case 7:
    case 8:
    case 9:
      return value
    default:
      throw new Error(`Invalid PNG compression level: ${value}`)
  }
}

const encodeImage = (image: Image, operation: EncodeOperation): Uint8Array => {
  if (operation.format === 'jpeg') {
    return encode(image, {
      format: 'jpeg',
      encoderOptions: {
        ...(operation.quality !== undefined ? { quality: operation.quality } : {}),
      },
    })
  }
  if (operation.format === 'png') {
    const level = compressionLevel(operation.compressionLevel)
    return encode(image, {
      format: 'png',
      ...(level !== undefined ? { encoderOptions: { zlib: { level } } } : {}),
    })
  }
  if (operation.format === 'bmp') return encode(image, { format: 'bmp' })
  throw new Error(`image-js benchmark output is unsupported: ${operation.format}`)
}

const executePipeline = (workflow: PipelineWorkflow, input: Buffer): EngineExecution => {
  let image = decode(input)
  for (const operation of workflow.operations) {
    switch (operation.type) {
      case 'metadata':
        return {
          metadata: {
            format: workflow.expected.format,
            width: image.width,
            height: image.height,
          },
        }
      case 'autoOrient':
        // The only supported image-js auto-orient workflow uses a pinned JPEG
        // with no EXIF orientation, so this operation is an exact no-op.
        break
      case 'crop':
        image = image.crop({
          origin: { column: operation.x, row: operation.y },
          width: operation.width,
          height: operation.height,
        })
        break
      case 'resize':
        if (
          operation.withoutEnlargement &&
          (!operation.width || image.width <= operation.width) &&
          (!operation.height || image.height <= operation.height)
        ) {
          break
        }
        image = image.resize({
          ...(operation.width !== undefined ? { width: operation.width } : {}),
          ...(operation.height !== undefined ? { height: operation.height } : {}),
          preserveAspectRatio: !(operation.width !== undefined && operation.height !== undefined),
        })
        break
      case 'encode':
        return { output: encodeImage(image, operation) }
      default:
        throw new Error(`image-js operation is unsupported: ${operation.type}`)
    }
  }
  return {}
}

const supportedCompetitorWorkflows = new Set([
  'metadata-jpeg-large',
  'jpeg-resize-1200',
  'northstar-photo-pipeline',
  'jpeg-crop-resize',
  'png-resize-1000',
  'png-alpha-resize',
  'jpeg-to-png',
  'stress-100mp-downscale',
  'bmp-large-resize-jpeg',
  'tiff-large-resize-jpeg',
])

export const engine: Engine = {
  id: 'image-js',
  version: '1.7.0',
  kind: 'pure-javascript',
  packageName: 'image-js',
  unsupportedReason: (workflow): string | undefined => {
    if (supportedCompetitorWorkflows.has(workflow.id)) return undefined
    if (workflow.id === 'png-to-jpeg') {
      return 'image-js cannot flatten transparent pixels onto an explicit background through its image API'
    }
    if (workflow.id === 'auto-orient-6') {
      return 'image-js does not expose EXIF auto-orientation through its image API'
    }
    if (workflow.id === 'webp-large-resize-jpeg') return 'image-js has no WebP decoder'
    if (workflow.id === 'heif-iphone-resize-jpeg') return 'image-js has no HEIC decoder'
    return 'image-js cannot express this workflow with equivalent semantics'
  },
  execute: async ({ workflow, inputs }): Promise<EngineExecution> => {
    if (workflow.batch) throw new Error('image-js batch workflow was not classified as unsupported')
    const input = inputs[0]
    if (!input) throw new Error('Pipeline workflow has no input image')
    return executePipeline(workflow, input)
  },
}
