import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

import { createWasmPngAcceleratorWithLoaders } from '../src/accelerators/wasm/png.ts'
import type { DecoderOptions, ImageCodec, ImageDecoder } from '../src/codec.ts'
import { pngCodec } from '../src/codecs/png.ts'
import { ImageError } from '../src/errors.ts'
import { defaultImageLimits } from '../src/limits.ts'
import { nodeRuntime } from '../src/node-runtime.ts'
import type { PixelFormat } from '../src/pixel.ts'
import { Uint8ArraySink } from '../src/sink.ts'
import { MemorySource } from '../src/source.ts'

type WasmVariant = 'scalar' | 'simd'
type PngPixelFormat = 'gray8' | 'rgb8' | 'rgba8'

interface WorkerOptions {
  readonly file: string
  readonly variant: WasmVariant
}

interface DecodedImage {
  readonly format: PngPixelFormat
  readonly height: number
  readonly pixels: Uint8Array
  readonly width: number
}

interface ErrorResult {
  readonly code: string | null
  readonly message: string
}

interface Diagnostics {
  readonly eligible: boolean
  readonly kernelCalls: number
  readonly loaderCalls: number
}

type DecodeResult =
  | { readonly diagnostics: Diagnostics; readonly image: DecodedImage }
  | { readonly diagnostics: Diagnostics; readonly error: ErrorResult }

type WorkerResult =
  | {
      readonly status: 'pass'
      readonly width: number
      readonly height: number
      readonly strict: Diagnostics
      readonly tolerant: Diagnostics
      readonly encode: Diagnostics
    }
  | {
      readonly status: 'matched-error'
      readonly strict: ErrorResult
      readonly tolerant: ErrorResult
      readonly loaderCalls: number
      readonly kernelCalls: number
    }
  | { readonly status: 'failure'; readonly message: string }

const scalarArtifact = new URL('../src/accelerator-entries/png-codec.wasm', import.meta.url)
const simdArtifact = new URL('../src/accelerator-entries/png-codec-simd.wasm', import.meta.url)

const argumentValue = (arguments_: readonly string[], index: number, name: string): string => {
  const value = arguments_[index + 1]
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value`)
  return value
}

const parseOptions = (arguments_: readonly string[]): WorkerOptions => {
  let file: string | undefined
  let variant: WasmVariant | undefined
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index]
    if (argument === '--file') {
      file = argumentValue(arguments_, index, argument)
      index += 1
    } else if (argument === '--variant') {
      const value = argumentValue(arguments_, index, argument)
      if (value !== 'scalar' && value !== 'simd') throw new Error('variant must be scalar or simd')
      variant = value
      index += 1
    } else {
      throw new Error(`Unknown worker option: ${argument ?? '<missing>'}`)
    }
  }
  if (!file || !variant) throw new Error('Worker requires --file and --variant')
  return { file, variant }
}

const instrument = (
  instance: WebAssembly.Instance,
  exportName: string,
  onCall: () => void,
): WebAssembly.Instance => {
  const original: unknown = instance.exports[exportName]
  if (typeof original !== 'function') throw new Error(`PNG WASM export ${exportName} is missing`)
  return {
    exports: {
      ...instance.exports,
      [exportName]: (...arguments_: readonly number[]): unknown => {
        onCall()
        return Reflect.apply(original, undefined, arguments_)
      },
    },
  }
}

const instantiate = async (
  url: URL,
  exportName: string,
  onCall: () => void,
): Promise<WebAssembly.Instance> => {
  const result = await WebAssembly.instantiate(await readFile(url))
  return instrument(result.instance, exportName, onCall)
}

const pngFormat = (format: PixelFormat): PngPixelFormat => {
  if (format === 'gray8' || format === 'rgb8' || format === 'rgba8') return format
  throw new Error(`Expected PNG gray8, rgb8, or rgba8 output, received ${format}`)
}

const channels = (format: PngPixelFormat): 1 | 3 | 4 =>
  format === 'gray8' ? 1 : format === 'rgb8' ? 3 : 4

const decodedPixels = async (decoder: ImageDecoder): Promise<DecodedImage> => {
  const format = pngFormat(decoder.pixelFormat)
  const channelCount = channels(format)
  const pixels = new Uint8Array(decoder.width * decoder.height * channelCount)
  for await (const block of decoder.decode()) {
    if (block.format !== format) throw new Error(`Expected ${format}, received ${block.format}`)
    for (let row = 0; row < block.height; row += 1) {
      pixels.set(
        block.data.subarray(row * block.stride, row * block.stride + block.width * channelCount),
        ((block.y + row) * decoder.width + block.x) * channelCount,
      )
    }
    block.release?.()
  }
  return { format, height: decoder.height, pixels, width: decoder.width }
}

const decode = async (
  codec: ImageCodec,
  input: Uint8Array,
  options: Readonly<DecoderOptions>,
): Promise<DecodedImage> => {
  const decoder = await codec.createDecoder?.(new MemorySource(input), defaultImageLimits, options)
  if (!decoder) throw new Error('PNG decoder is unavailable')
  return decodedPixels(decoder)
}

const encode = async (codec: ImageCodec, image: DecodedImage): Promise<Uint8Array> => {
  const sink = new Uint8ArraySink()
  const encoder = await codec.createEncoder?.(sink, {
    height: image.height,
    options: { compressionLevel: 6 },
    pixelFormat: image.format,
    runtime: nodeRuntime,
    width: image.width,
  })
  if (!encoder) throw new Error('PNG encoder is unavailable')
  await encoder.write({
    data: image.pixels,
    format: image.format,
    height: image.height,
    stride: image.width * channels(image.format),
    width: image.width,
    x: 0,
    y: 0,
  })
  await encoder.finish()
  return sink.toUint8Array()
}

const equalBytes = (left: Uint8Array, right: Uint8Array): boolean => {
  if (left.byteLength !== right.byteLength) return false
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) return false
  }
  return true
}

const errorResult = (error: unknown): ErrorResult => ({
  code: error instanceof ImageError ? error.code : null,
  message: error instanceof Error ? error.message : String(error),
})

const hasChunk = (input: Uint8Array, target: string): boolean => {
  if (input.byteLength < 33) return false
  const view = new DataView(input.buffer, input.byteOffset, input.byteLength)
  let offset = 8
  while (offset + 12 <= input.byteLength) {
    const length = view.getUint32(offset)
    const end = offset + length + 12
    if (!Number.isSafeInteger(end) || end > input.byteLength) return false
    const type = String.fromCharCode(
      input[offset + 4] ?? 0,
      input[offset + 5] ?? 0,
      input[offset + 6] ?? 0,
      input[offset + 7] ?? 0,
    )
    if (type === target) return true
    offset = end
  }
  return false
}

const decoderEligible = (input: Uint8Array): boolean => {
  if (input.byteLength < 33) return false
  const view = new DataView(input.buffer, input.byteOffset, input.byteLength)
  const width = view.getUint32(16)
  const height = view.getUint32(20)
  const bitDepth = input[24]
  const colorType = input[25]
  const interlace = input[28]
  const channelCount = colorType === 0 ? 1 : colorType === 2 ? 3 : colorType === 6 ? 4 : 0
  return (
    width > 0 &&
    height > 0 &&
    bitDepth === 8 &&
    channelCount > 0 &&
    interlace === 0 &&
    !hasChunk(input, 'tRNS') &&
    !hasChunk(input, 'acTL') &&
    width * channelCount <= 16 * 1024 * 1024
  )
}

const sameError = (label: string, expected: ErrorResult, actual: ErrorResult | undefined): void => {
  if (!actual)
    throw new Error(`${label} accelerator accepted input rejected by the reference codec`)
  if (actual.code !== expected.code || actual.message !== expected.message) {
    throw new Error(
      `${label} error mismatch: expected ${expected.code ?? 'raw'} ${expected.message}; received ${actual.code ?? 'raw'} ${actual.message}`,
    )
  }
}

export const validatePngWasm = async (options: WorkerOptions): Promise<WorkerResult> => {
  const input = await readFile(options.file)
  const eligible = decoderEligible(input)
  let decoderLoaderCalls = 0
  let decoderKernelCalls = 0
  let encoderLoaderCalls = 0
  let encoderKernelCalls = 0
  const artifact = options.variant === 'simd' ? simdArtifact : scalarArtifact
  const loadDecoder = async (): Promise<WebAssembly.Instance> => {
    decoderLoaderCalls += 1
    return instantiate(artifact, 'png_unfilter_rows', () => {
      decoderKernelCalls += 1
    })
  }
  const loadEncoder = async (): Promise<WebAssembly.Instance> => {
    encoderLoaderCalls += 1
    return instantiate(artifact, 'png_filter_rows', () => {
      encoderKernelCalls += 1
    })
  }
  const codec = createWasmPngAcceleratorWithLoaders(
    options.variant === 'simd'
      ? { simdDecoder: loadDecoder, simdEncoder: loadEncoder }
      : { decoder: loadDecoder, encoder: loadEncoder },
    { minimumEncodePixels: 1, minimumPixels: 1 },
  ).accelerate(pngCodec)

  const decodeMode = async (
    label: string,
    decoderOptions: Readonly<DecoderOptions>,
  ): Promise<DecodeResult> => {
    let reference: DecodedImage
    try {
      reference = await decode(pngCodec, input, decoderOptions)
    } catch (error) {
      const expected = errorResult(error)
      let actual: ErrorResult | undefined
      try {
        await decode(codec, input, decoderOptions)
      } catch (acceleratedError) {
        actual = errorResult(acceleratedError)
      }
      sameError(label, expected, actual)
      return {
        diagnostics: { eligible, kernelCalls: 0, loaderCalls: 0 },
        error: expected,
      }
    }
    const loaderStart = decoderLoaderCalls
    const kernelStart = decoderKernelCalls
    const accelerated = await decode(codec, input, decoderOptions)
    const diagnostics = {
      eligible,
      kernelCalls: decoderKernelCalls - kernelStart,
      loaderCalls: decoderLoaderCalls - loaderStart,
    }
    if (
      accelerated.format !== reference.format ||
      accelerated.width !== reference.width ||
      accelerated.height !== reference.height ||
      !equalBytes(accelerated.pixels, reference.pixels)
    ) {
      throw new Error(`${label} decoded pixels differ from the TypeScript reference`)
    }
    if (eligible && diagnostics.kernelCalls < 1) {
      throw new Error(`${label} did not execute the forced PNG WASM decoder`)
    }
    return { diagnostics, image: reference }
  }

  try {
    const strict = await decodeMode('strict decode', {})
    const tolerant = await decodeMode('tolerant decode', { tolerantDecoding: true })
    if ('error' in strict && 'error' in tolerant) {
      return {
        kernelCalls: decoderKernelCalls,
        loaderCalls: decoderLoaderCalls,
        status: 'matched-error',
        strict: strict.error,
        tolerant: tolerant.error,
      }
    }
    const image =
      'image' in strict ? strict.image : 'image' in tolerant ? tolerant.image : undefined
    if (!image) throw new Error('Strict and tolerant PNG decoding produced no image')
    const referenceMetadata = await pngCodec.metadata(new MemorySource(input), defaultImageLimits)
    const acceleratedMetadata = await codec.metadata(new MemorySource(input), defaultImageLimits)
    if (JSON.stringify(acceleratedMetadata) !== JSON.stringify(referenceMetadata)) {
      throw new Error('PNG metadata differs from the TypeScript reference')
    }
    const expected = await encode(pngCodec, image)
    const loaderStart = encoderLoaderCalls
    const kernelStart = encoderKernelCalls
    const actual = await encode(codec, image)
    const encodeDiagnostics = {
      eligible: true,
      kernelCalls: encoderKernelCalls - kernelStart,
      loaderCalls: encoderLoaderCalls - loaderStart,
    }
    if (encodeDiagnostics.kernelCalls < 1) {
      throw new Error('PNG encode did not execute the forced WASM encoder')
    }
    if (!equalBytes(actual, expected)) {
      throw new Error('PNG encoded bytes differ from the TypeScript reference')
    }
    return {
      encode: encodeDiagnostics,
      height: image.height,
      status: 'pass',
      strict: strict.diagnostics,
      tolerant: tolerant.diagnostics,
      width: image.width,
    }
  } catch (error) {
    return { message: error instanceof Error ? error.message : String(error), status: 'failure' }
  }
}

const runCli = async (): Promise<void> => {
  const result = await validatePngWasm(parseOptions(process.argv.slice(2)))
  process.stdout.write(`${JSON.stringify(result)}\n`)
}

const entrypoint = process.argv[1]
if (entrypoint && import.meta.url === pathToFileURL(entrypoint).href) await runCli()
