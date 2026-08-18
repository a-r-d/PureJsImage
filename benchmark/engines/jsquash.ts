import { readFile } from 'node:fs/promises'
import decodeAvif, { init as initAvifDecode } from '@jsquash/avif/decode.js'
import encodeAvif, { init as initAvifEncode } from '@jsquash/avif/encode.js'
import decodeJpeg, { init as initJpegDecode } from '@jsquash/jpeg/decode.js'
import encodeJpeg, { init as initJpegEncode } from '@jsquash/jpeg/encode.js'
import decodePng, { init as initPngDecode } from '@jsquash/png/decode.js'
import encodePng, { init as initPngEncode } from '@jsquash/png/encode.js'
import resize, { initResize } from '@jsquash/resize'
import decodeWebp, { init as initWebpDecode } from '@jsquash/webp/decode.js'
import encodeWebp, { init as initWebpEncode } from '@jsquash/webp/encode.js'
import type { Engine, EngineExecution, Operation, PipelineWorkflow } from '../types.ts'

type EncodeOperation = Extract<Operation, { type: 'encode' }>

class NodeImageData {
  readonly data: Uint8ClampedArray
  readonly width: number
  readonly height: number

  constructor(data: Uint8ClampedArray, width: number, height: number) {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
      throw new Error(`Invalid jSquash ImageData dimensions: ${width}x${height}`)
    }
    if (data.byteLength !== width * height * 4) {
      throw new Error(`Invalid jSquash ImageData length: ${data.byteLength}`)
    }
    this.data = data
    this.width = width
    this.height = height
  }
}

if (!('ImageData' in globalThis)) {
  Object.defineProperty(globalThis, 'ImageData', {
    configurable: true,
    value: NodeImageData,
    writable: true,
  })
}

const packageResource = (packageName: string, path: string): URL =>
  new URL(path, import.meta.resolve(packageName))

const compiledModule = async (packageName: string, path: string): Promise<WebAssembly.Module> => {
  const bytes = await readFile(packageResource(packageName, path))
  return WebAssembly.compile(bytes)
}

let jpegDecoderReady: Promise<void> | undefined
const initializeJpegDecoder = (): Promise<void> => {
  jpegDecoderReady ??= compiledModule('@jsquash/jpeg', 'codec/dec/mozjpeg_dec.wasm').then(
    initJpegDecode,
  )
  return jpegDecoderReady
}

let avifDecoderReady: Promise<void> | undefined
const initializeAvifDecoder = (): Promise<void> => {
  avifDecoderReady ??= compiledModule('@jsquash/avif', 'codec/dec/avif_dec.wasm').then(
    initAvifDecode,
  )
  return avifDecoderReady
}

let avifEncoderReady: Promise<void> | undefined
const initializeAvifEncoder = (): Promise<void> => {
  avifEncoderReady ??= compiledModule('@jsquash/avif', 'codec/enc/avif_enc.wasm').then(
    initAvifEncode,
  )
  return avifEncoderReady
}

let jpegEncoderReady: Promise<void> | undefined
const initializeJpegEncoder = (): Promise<void> => {
  jpegEncoderReady ??= compiledModule('@jsquash/jpeg', 'codec/enc/mozjpeg_enc.wasm').then(
    initJpegEncode,
  )
  return jpegEncoderReady
}

let pngModule: Promise<WebAssembly.Module> | undefined
const compilePng = (): Promise<WebAssembly.Module> => {
  pngModule ??= compiledModule('@jsquash/png', 'codec/pkg/squoosh_png_bg.wasm')
  return pngModule
}

let pngDecoderReady: Promise<void> | undefined
const initializePngDecoder = (): Promise<void> => {
  pngDecoderReady ??= compilePng().then(async (module) => {
    await initPngDecode(module)
  })
  return pngDecoderReady
}

let pngEncoderReady: Promise<void> | undefined
const initializePngEncoder = (): Promise<void> => {
  pngEncoderReady ??= compilePng().then(async (module) => {
    await initPngEncode(module)
  })
  return pngEncoderReady
}

let resizeReady: Promise<void> | undefined
const initializeResize = (): Promise<void> => {
  resizeReady ??= compiledModule('@jsquash/resize', 'lib/resize/pkg/squoosh_resize_bg.wasm').then(
    async (module) => {
      await initResize(module)
    },
  )
  return resizeReady
}

let webpDecoderReady: Promise<void> | undefined
const initializeWebpDecoder = (): Promise<void> => {
  webpDecoderReady ??= compiledModule('@jsquash/webp', 'codec/dec/webp_dec.wasm').then(
    initWebpDecode,
  )
  return webpDecoderReady
}

let webpEncoderReady: Promise<void> | undefined
const initializeWebpEncoder = (): Promise<void> => {
  webpEncoderReady ??= compiledModule('@jsquash/webp', 'codec/enc/webp_enc.wasm').then(
    async (module) => {
      await initWebpEncode(module)
    },
  )
  return webpEncoderReady
}

const preparedInputs = new WeakMap<Buffer, ArrayBuffer>()

const preparedInput = (input: Buffer): ArrayBuffer => {
  const prepared = preparedInputs.get(input)
  if (!prepared) throw new Error('jSquash input was not prepared outside the timed region')
  return prepared
}

const resizeDimensions = (
  image: ImageData,
  operation: Extract<Operation, { type: 'resize' }>,
): { width: number; height: number } => {
  if (operation.width !== undefined && operation.height !== undefined) {
    return { width: operation.width, height: operation.height }
  }
  if (operation.width !== undefined) {
    return {
      width: operation.width,
      height: Math.max(1, Math.round((image.height * operation.width) / image.width)),
    }
  }
  if (operation.height !== undefined) {
    return {
      width: Math.max(1, Math.round((image.width * operation.height) / image.height)),
      height: operation.height,
    }
  }
  throw new Error('jSquash resize requires a width or height')
}

const encode = async (image: ImageData, operation: EncodeOperation): Promise<Uint8Array> => {
  if (operation.format === 'jpeg') {
    await initializeJpegEncoder()
    return new Uint8Array(
      await encodeJpeg(image, {
        ...(operation.quality !== undefined ? { quality: operation.quality } : {}),
      }),
    )
  }
  if (operation.format === 'png') {
    await initializePngEncoder()
    // @jsquash/png exposes no compression-level option. Its normal public
    // encoder defaults are used; decoded output remains losslessly equivalent.
    return new Uint8Array(await encodePng(image))
  }
  if (operation.format === 'webp') {
    await initializeWebpEncoder()
    return new Uint8Array(
      await encodeWebp(image, {
        ...(operation.quality !== undefined ? { quality: operation.quality } : {}),
        ...(operation.lossless !== undefined ? { lossless: operation.lossless ? 1 : 0 } : {}),
      }),
    )
  }
  if (operation.format === 'avif') {
    await initializeAvifEncoder()
    return new Uint8Array(await encodeAvif(image))
  }
  throw new Error(`jSquash benchmark output is unsupported: ${operation.format}`)
}

const decode = async (workflow: PipelineWorkflow, input: Buffer): Promise<ImageData> => {
  const bytes = preparedInput(input)
  if (
    workflow.id === 'jpeg-resize-1200' ||
    workflow.id === 'jpeg-to-png' ||
    workflow.id === 'auto-orient-6' ||
    workflow.id === 'jpeg-to-avif' ||
    workflow.id === 'jpeg-to-webp-lossy' ||
    workflow.id === 'jpeg-progressive-resize-1200' ||
    workflow.id === 'lambda-twilio-mms-jpeg-1024'
  ) {
    await initializeJpegDecoder()
    return decodeJpeg(bytes, {
      preserveOrientation: workflow.operations.some((operation) => operation.type === 'autoOrient'),
    })
  }
  if (
    workflow.id === 'png-resize-1000' ||
    workflow.id === 'png-alpha-resize' ||
    workflow.id === 'stress-100mp-downscale'
  ) {
    await initializePngDecoder()
    return decodePng(bytes)
  }
  if (workflow.id === 'webp-large-resize-jpeg' || workflow.id === 'webp-lossless-alpha-png') {
    await initializeWebpDecoder()
    return decodeWebp(bytes)
  }
  if (workflow.id === 'avif-fox-full-png' || workflow.id === 'avif-fox-resize-jpeg') {
    await initializeAvifDecoder()
    const image = await decodeAvif(bytes)
    if (image === null) throw new Error('jSquash AVIF decoder returned no image')
    return image
  }
  throw new Error(`jSquash input decoder is not configured for ${workflow.id}`)
}

const executePipeline = async (
  workflow: PipelineWorkflow,
  input: Buffer,
): Promise<EngineExecution> => {
  let image = await decode(workflow, input)
  for (const operation of workflow.operations) {
    switch (operation.type) {
      case 'autoOrient':
        // The JPEG decoder applied orientation through preserveOrientation.
        break
      case 'resize': {
        if (
          operation.withoutEnlargement &&
          (!operation.width || image.width <= operation.width) &&
          (!operation.height || image.height <= operation.height)
        ) {
          break
        }
        await initializeResize()
        image = await resize(image, resizeDimensions(image, operation))
        break
      }
      case 'encode':
        return { output: await encode(image, operation) }
      default:
        throw new Error(`jSquash operation is unsupported: ${operation.type}`)
    }
  }
  return {}
}

const supportedWorkflows = new Set([
  'jpeg-resize-1200',
  'png-resize-1000',
  'png-alpha-resize',
  'jpeg-to-png',
  'auto-orient-6',
  'stress-100mp-downscale',
  'webp-large-resize-jpeg',
  'webp-lossless-alpha-png',
  'avif-fox-full-png',
  'avif-fox-resize-jpeg',
  'jpeg-to-avif',
  'jpeg-to-webp-lossy',
  'jpeg-progressive-resize-1200',
  'lambda-twilio-mms-jpeg-1024',
])

export const engine: Engine = {
  id: 'jsquash',
  version: 'avif 2.1.1; jpeg 1.6.0; png 3.1.1; webp 1.5.0; resize 2.1.1',
  kind: 'webassembly',
  packageName: '@jsquash/jpeg',
  packageNames: [
    '@jsquash/avif',
    '@jsquash/jpeg',
    '@jsquash/png',
    '@jsquash/webp',
    '@jsquash/resize',
  ],
  unsupportedReason: (workflow): string | undefined => {
    if (supportedWorkflows.has(workflow.id)) return undefined
    if (workflow.id === 'metadata-jpeg-large') {
      return 'jSquash has no metadata inspection API; decoding all pixels would not be equivalent'
    }
    if (workflow.id === 'avif-fox-metadata') {
      return 'jSquash has no metadata inspection API; decoding all AVIF pixels would not be equivalent'
    }
    if (
      workflow.id === 'northstar-photo-pipeline' ||
      workflow.id === 'jpeg-crop-resize' ||
      workflow.id === 'avif-fox-crop-resize-jpeg'
    ) {
      return "jSquash has no public operation for the workflow's exact crop coordinates"
    }
    if (workflow.id === 'png-to-jpeg') {
      return 'jSquash has no public operation for flattening alpha onto an explicit background'
    }
    if (workflow.id === 'bmp-large-resize-jpeg') return 'jSquash has no BMP decoder'
    if (workflow.id === 'tiff-large-resize-jpeg') return 'jSquash has no TIFF decoder'
    if (workflow.id === 'heif-iphone-resize-jpeg') return 'jSquash has no HEIC decoder'
    return 'jSquash cannot express this workflow with equivalent semantics'
  },
  prepareInputs: (_workflow, inputs): void => {
    for (const input of inputs) preparedInputs.set(input, new Uint8Array(input).buffer)
  },
  execute: async ({ workflow, inputs }): Promise<EngineExecution> => {
    if (workflow.batch) throw new Error('jSquash batch workflow was not classified as unsupported')
    const input = inputs[0]
    if (!input) throw new Error('Pipeline workflow has no input image')
    return executePipeline(workflow, input)
  },
}
