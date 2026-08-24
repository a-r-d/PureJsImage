import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

import {
  createWasmWebpAcceleratorWithLoaders,
  type WasmWebpKernelOperation,
} from '../src/accelerators/wasm/webp.ts'
import type { DecoderOptions, ImageCodec, ImageDecoder } from '../src/codec.ts'
import { webpCodec } from '../src/codecs/webp.ts'
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
  readonly width: number
  readonly height: number
  readonly pixels: Uint8Array
}

interface ErrorResult {
  readonly code: string | null
  readonly message: string
}

interface Diagnostics {
  readonly failedOperations: readonly WasmWebpKernelOperation[]
  readonly loaderCalls: number
  readonly successfulOperations: number
}

type WorkerResult =
  | {
      readonly status: 'pass'
      readonly width: number
      readonly height: number
      readonly strict: Diagnostics
      readonly tolerant: Diagnostics
      readonly losslessEncode: Diagnostics
      readonly lossyEncode: Diagnostics
    }
  | {
      readonly status: 'matched-error'
      readonly strict: ErrorResult
      readonly tolerant: ErrorResult
      readonly loaderCalls: number
      readonly successfulOperations: number
    }
  | {
      readonly status: 'failure'
      readonly message: string
    }

const scalarArtifact = new URL('../src/accelerator-entries/webp-codec.wasm', import.meta.url)
const simdArtifact = new URL('../src/accelerator-entries/webp-codec-simd.wasm', import.meta.url)

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

const instantiate = async (url: URL): Promise<WebAssembly.Instance> => {
  const result = await WebAssembly.instantiate(await readFile(url))
  return result.instance
}

const decodedPixels = async (decoder: ImageDecoder): Promise<DecodedImage> => {
  const pixels = new Uint8Array(decoder.width * decoder.height * 4)
  for await (const block of decoder.decode()) {
    if (block.format !== 'rgba8') throw new Error(`Expected rgba8, received ${block.format}`)
    for (let row = 0; row < block.height; row += 1) {
      pixels.set(
        block.data.subarray(row * block.stride, row * block.stride + block.width * 4),
        ((block.y + row) * decoder.width + block.x) * 4,
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
  if (!decoder) throw new Error('WebP decoder is unavailable')
  return decodedPixels(decoder)
}

const encode = async (
  codec: ImageCodec,
  image: DecodedImage,
  lossless: boolean,
): Promise<Uint8Array> => {
  const sink = new Uint8ArraySink()
  const encoder = await codec.createEncoder?.(sink, {
    height: image.height,
    metadata: {},
    options: lossless ? { lossless: true } : { quality: 80 },
    pixelFormat: 'rgba8',
    width: image.width,
  })
  if (!encoder) throw new Error('WebP encoder is unavailable')
  await encoder.write({
    data: image.pixels,
    format: 'rgba8',
    height: image.height,
    stride: image.width * 4,
    width: image.width,
    x: 0,
    y: 0,
  })
  await encoder.finish()
  return sink.toUint8Array()
}

const errorResult = (error: unknown): ErrorResult => ({
  code: error instanceof ImageError ? error.code : null,
  message: error instanceof Error ? error.message : String(error),
})

const equalBytes = (left: Uint8Array, right: Uint8Array): boolean => {
  if (left.byteLength !== right.byteLength) return false
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) return false
  }
  return true
}

const diagnosticsSince = (
  loaderCalls: number,
  operations: readonly {
    readonly operation: WasmWebpKernelOperation
    readonly succeeded: boolean
  }[],
  startLoaderCalls: number,
  startOperations: number,
): Diagnostics => ({
  failedOperations: operations
    .slice(startOperations)
    .filter(({ succeeded }) => !succeeded)
    .map(({ operation }) => operation),
  loaderCalls: loaderCalls - startLoaderCalls,
  successfulOperations: operations.slice(startOperations).filter(({ succeeded }) => succeeded)
    .length,
})

const requireSuccessfulOperations = (label: string, diagnostics: Diagnostics): void => {
  if (diagnostics.failedOperations.length > 0) {
    throw new Error(
      `${label} had failed WASM operations: ${diagnostics.failedOperations.join(', ')}`,
    )
  }
  if (diagnostics.successfulOperations < 1) {
    throw new Error(`${label} did not execute a WebP WASM kernel`)
  }
}

export const validateWebpWasm = async (options: WorkerOptions): Promise<WorkerResult> => {
  const input = await readFile(options.file)
  const operations: Array<{
    readonly operation: WasmWebpKernelOperation
    readonly succeeded: boolean
  }> = []
  let loaderCalls = 0
  const load = async (): Promise<WebAssembly.Instance> => {
    loaderCalls += 1
    return instantiate(options.variant === 'simd' ? simdArtifact : scalarArtifact)
  }
  const codec = createWasmWebpAcceleratorWithLoaders(
    options.variant === 'simd'
      ? { simdDecoder: load, simdEncoder: load }
      : { decoder: load, encoder: load },
    { minimumEncodePixels: 1, minimumPixels: 1 },
    {
      kernelOperation(operation, succeeded) {
        operations.push({ operation, succeeded })
      },
    },
  ).accelerate(webpCodec)

  const decodeMode = async (
    label: string,
    decoderOptions: Readonly<DecoderOptions>,
  ): Promise<{
    readonly image?: DecodedImage
    readonly error?: ErrorResult
    readonly diagnostics: Diagnostics
  }> => {
    let reference: DecodedImage
    try {
      reference = await decode(webpCodec, input, decoderOptions)
    } catch (error) {
      const expected = errorResult(error)
      let actual: ErrorResult | undefined
      try {
        await decode(codec, input, decoderOptions)
      } catch (acceleratedError) {
        actual = errorResult(acceleratedError)
      }
      if (!actual) {
        throw new Error(`${label} accelerator accepted input rejected by the reference codec`)
      }
      if (actual.code !== expected.code || actual.message !== expected.message) {
        throw new Error(
          `${label} error mismatch: expected ${expected.code ?? 'raw'} ${expected.message}; received ${actual.code ?? 'raw'} ${actual.message}`,
        )
      }
      return {
        diagnostics: diagnosticsSince(loaderCalls, operations, loaderCalls, operations.length),
        error: expected,
      }
    }

    const startLoaderCalls = loaderCalls
    const startOperations = operations.length
    const accelerated = await decode(codec, input, decoderOptions)
    const diagnostics = diagnosticsSince(loaderCalls, operations, startLoaderCalls, startOperations)
    if (diagnostics.failedOperations.length > 0) {
      throw new Error(
        `${label} had failed WASM operations: ${diagnostics.failedOperations.join(', ')}`,
      )
    }
    if (loaderCalls < 1) throw new Error(`${label} did not load the forced WebP WASM module`)
    if (
      accelerated.width !== reference.width ||
      accelerated.height !== reference.height ||
      !equalBytes(accelerated.pixels, reference.pixels)
    ) {
      throw new Error(`${label} decoded pixels differ from the TypeScript reference`)
    }
    return { diagnostics, image: reference }
  }

  try {
    const strict = await decodeMode('strict decode', {})
    const tolerant = await decodeMode('tolerant decode', { tolerantDecoding: true })
    if (!strict.image || !tolerant.image) {
      if (!strict.error || !tolerant.error) {
        throw new Error('Strict and tolerant decoding disagreed about support')
      }
      return {
        loaderCalls,
        status: 'matched-error',
        strict: strict.error,
        successfulOperations: operations.filter(({ succeeded }) => succeeded).length,
        tolerant: tolerant.error,
      }
    }
    const image = strict.image

    const runEncode = async (lossless: boolean): Promise<Diagnostics> => {
      const expected = await encode(webpCodec, image, lossless)
      const startLoaderCalls = loaderCalls
      const startOperations = operations.length
      const actual = await encode(codec, image, lossless)
      const diagnostics = diagnosticsSince(
        loaderCalls,
        operations,
        startLoaderCalls,
        startOperations,
      )
      requireSuccessfulOperations(lossless ? 'lossless encode' : 'lossy encode', diagnostics)
      if (!equalBytes(actual, expected)) {
        throw new Error(
          `${lossless ? 'Lossless' : 'Lossy'} encoded bytes differ from the reference`,
        )
      }
      return diagnostics
    }

    return {
      height: image.height,
      losslessEncode: await runEncode(true),
      lossyEncode: await runEncode(false),
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
  const result = await validateWebpWasm(parseOptions(process.argv.slice(2)))
  process.stdout.write(`${JSON.stringify(result)}\n`)
}

const entrypoint = process.argv[1]
if (entrypoint && import.meta.url === pathToFileURL(entrypoint).href) await runCli()
