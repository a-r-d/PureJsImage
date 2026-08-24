import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

import { createWasmJpegAcceleratorWithLoaders } from '../src/accelerators/wasm/jpeg.ts'
import type { DecoderOptions, ImageCodec, ImageDecoder } from '../src/codec.ts'
import { jpegCodec } from '../src/codecs/jpeg.ts'
import { parseBaselineJpeg } from '../src/codecs/jpeg-baseline.ts'
import { ImageError } from '../src/errors.ts'
import { defaultImageLimits } from '../src/limits.ts'
import { Uint8ArraySink } from '../src/sink.ts'
import { MemorySource } from '../src/source.ts'

type WasmVariant = 'scalar' | 'simd'

interface WorkerOptions {
  readonly file: string
  readonly variant: WasmVariant
}

interface DecodedImage {
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

const scalarDecoderArtifact = new URL(
  '../src/accelerator-entries/jpeg-decoder.wasm',
  import.meta.url,
)
const simdDecoderArtifact = new URL(
  '../src/accelerator-entries/jpeg-decoder-simd.wasm',
  import.meta.url,
)
const scalarEncoderArtifact = new URL(
  '../src/accelerator-entries/jpeg-encoder.wasm',
  import.meta.url,
)
const simdEncoderArtifact = new URL(
  '../src/accelerator-entries/jpeg-encoder-simd.wasm',
  import.meta.url,
)

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
  if (typeof original !== 'function') throw new Error(`JPEG WASM export ${exportName} is missing`)
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

const decodedPixels = async (decoder: ImageDecoder): Promise<DecodedImage> => {
  if (decoder.pixelFormat !== 'rgb8') {
    throw new Error(`Expected JPEG rgb8 output, received ${decoder.pixelFormat}`)
  }
  const pixels = new Uint8Array(decoder.width * decoder.height * 3)
  for await (const block of decoder.decode()) {
    if (block.format !== 'rgb8') throw new Error(`Expected rgb8, received ${block.format}`)
    for (let row = 0; row < block.height; row += 1) {
      pixels.set(
        block.data.subarray(row * block.stride, row * block.stride + block.width * 3),
        ((block.y + row) * decoder.width + block.x) * 3,
      )
    }
    block.release?.()
  }
  return { height: decoder.height, pixels, width: decoder.width }
}

const decode = async (
  codec: ImageCodec,
  input: Uint8Array,
  options: Readonly<DecoderOptions>,
): Promise<DecodedImage> => {
  const decoder = await codec.createDecoder?.(new MemorySource(input), defaultImageLimits, options)
  if (!decoder) throw new Error('JPEG decoder is unavailable')
  return decodedPixels(decoder)
}

const encode = async (codec: ImageCodec, image: DecodedImage): Promise<Uint8Array> => {
  const sink = new Uint8ArraySink()
  const encoder = await codec.createEncoder?.(sink, {
    height: image.height,
    options: { chromaSubsampling: '420', quality: 80 },
    pixelFormat: 'rgb8',
    width: image.width,
  })
  if (!encoder) throw new Error('JPEG encoder is unavailable')
  await encoder.write({
    data: image.pixels,
    format: 'rgb8',
    height: image.height,
    stride: image.width * 3,
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

const decodedPsnr = async (encoded: Uint8Array, reference: DecodedImage): Promise<number> => {
  const decoded = await decode(jpegCodec, encoded, {})
  if (decoded.width !== reference.width || decoded.height !== reference.height) {
    throw new Error(
      `JPEG encoded dimensions differ: expected ${reference.width}x${reference.height}; received ${decoded.width}x${decoded.height}`,
    )
  }
  let squaredError = 0
  for (let index = 0; index < reference.pixels.byteLength; index += 1) {
    const difference = (decoded.pixels[index] ?? 0) - (reference.pixels[index] ?? 0)
    squaredError += difference * difference
  }
  if (squaredError === 0) return Number.POSITIVE_INFINITY
  const meanSquaredError = squaredError / reference.pixels.byteLength
  return 10 * Math.log10((255 * 255) / meanSquaredError)
}

const assertAanQuality = async (
  referenceBytes: Uint8Array,
  actualBytes: Uint8Array,
  image: DecodedImage,
): Promise<void> => {
  const referencePsnr = await decodedPsnr(referenceBytes, image)
  const actualPsnr = await decodedPsnr(actualBytes, image)
  const psnrDifference =
    referencePsnr === Number.POSITIVE_INFINITY && actualPsnr === Number.POSITIVE_INFINITY
      ? 0
      : Math.abs(referencePsnr - actualPsnr)
  const sizeDifference =
    Math.abs(referenceBytes.byteLength - actualBytes.byteLength) / referenceBytes.byteLength
  if (psnrDifference > 0.05 || sizeDifference > 0.01) {
    throw new Error(
      `JPEG SIMD encoder quality differs by ${psnrDifference.toFixed(4)} dB and ${(sizeDifference * 100).toFixed(3)}% bytes`,
    )
  }
}

const errorResult = (error: unknown): ErrorResult => ({
  code: error instanceof ImageError ? error.code : null,
  message: error instanceof Error ? error.message : String(error),
})

const decoderEligible = (input: Uint8Array): boolean => {
  try {
    const jpeg = parseBaselineJpeg(input)
    if (
      jpeg?.colorTransform !== 'ycbcr' ||
      jpeg.components.length !== 3 ||
      jpeg.iccTransform !== undefined ||
      input.byteLength > 32 * 1024 * 1024
    ) {
      return false
    }
    const planeBytes = jpeg.components.reduce(
      (total, component) =>
        total +
        jpeg.mcusPerLine * component.horizontalSampling * 8 * (component.verticalSampling * 8 + 2),
      0,
    )
    const outputBytes = jpeg.width * jpeg.maximumVerticalSampling * 8 * 3
    return planeBytes <= 1_048_576 && outputBytes <= 1_048_576
  } catch {
    return false
  }
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

export const validateJpegWasm = async (options: WorkerOptions): Promise<WorkerResult> => {
  const input = await readFile(options.file)
  const eligible = decoderEligible(input)
  let decoderLoaderCalls = 0
  let decoderKernelCalls = 0
  let encoderLoaderCalls = 0
  let encoderKernelCalls = 0
  const decoderArtifact = options.variant === 'simd' ? simdDecoderArtifact : scalarDecoderArtifact
  const encoderArtifact = options.variant === 'simd' ? simdEncoderArtifact : scalarEncoderArtifact
  const loadDecoder = async (): Promise<WebAssembly.Instance> => {
    decoderLoaderCalls += 1
    return instantiate(decoderArtifact, 'jpeg_decoder_next', () => {
      decoderKernelCalls += 1
    })
  }
  const loadEncoder = async (): Promise<WebAssembly.Instance> => {
    encoderLoaderCalls += 1
    return instantiate(encoderArtifact, 'jpeg_encoder_write', () => {
      encoderKernelCalls += 1
    })
  }
  const codec = createWasmJpegAcceleratorWithLoaders(
    options.variant === 'simd'
      ? { simdDecoder: loadDecoder, simdEncoder: loadEncoder }
      : { decoder: loadDecoder, encoder: loadEncoder },
    { minimumEncodePixels: 1, minimumPixels: 1 },
  ).accelerate(jpegCodec)

  const decodeMode = async (
    label: string,
    decoderOptions: Readonly<DecoderOptions>,
  ): Promise<DecodeResult> => {
    let reference: DecodedImage
    try {
      reference = await decode(jpegCodec, input, decoderOptions)
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
      accelerated.width !== reference.width ||
      accelerated.height !== reference.height ||
      !equalBytes(accelerated.pixels, reference.pixels)
    ) {
      throw new Error(`${label} decoded pixels differ from the TypeScript reference`)
    }
    if (eligible && diagnostics.kernelCalls < 1) {
      throw new Error(`${label} did not execute the forced JPEG WASM decoder`)
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
    if (!image) throw new Error('Strict and tolerant JPEG decoding produced no image')
    const referenceMetadata = await jpegCodec.metadata(new MemorySource(input), defaultImageLimits)
    const acceleratedMetadata = await codec.metadata(new MemorySource(input), defaultImageLimits)
    if (JSON.stringify(acceleratedMetadata) !== JSON.stringify(referenceMetadata)) {
      throw new Error('JPEG metadata differs from the TypeScript reference')
    }
    const expected = await encode(jpegCodec, image)
    const loaderStart = encoderLoaderCalls
    const kernelStart = encoderKernelCalls
    const actual = await encode(codec, image)
    const encodeDiagnostics = {
      eligible: true,
      kernelCalls: encoderKernelCalls - kernelStart,
      loaderCalls: encoderLoaderCalls - loaderStart,
    }
    if (encodeDiagnostics.kernelCalls < 1) {
      throw new Error('JPEG encode did not execute the forced WASM encoder')
    }
    if (options.variant === 'scalar') {
      if (!equalBytes(actual, expected)) {
        throw new Error('JPEG scalar encoded bytes differ from the TypeScript reference')
      }
    } else {
      await assertAanQuality(expected, actual, image)
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
  const result = await validateJpegWasm(parseOptions(process.argv.slice(2)))
  process.stdout.write(`${JSON.stringify(result)}\n`)
}

const entrypoint = process.argv[1]
if (entrypoint && import.meta.url === pathToFileURL(entrypoint).href) await runCli()
