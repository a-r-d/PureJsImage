import { readFile } from 'node:fs/promises'
import { performance } from 'node:perf_hooks'

import {
  createWasmPngAcceleratorWithLoaders,
  type WasmPngInstanceLoader,
  type WasmPngInstanceLoaders,
} from '../../src/accelerators/wasm/png.ts'
import type { ImageCodec } from '../../src/codec.ts'
import { pngCodec } from '../../src/codecs/png.ts'
import { channelsForFormat, encodeBenchmarkPng, sha256 } from './wasm-fixtures.ts'
const MAXIMUM_ROW_BYTES = 16 * 1_048_576
const WARMUP_RUNS = 2
const WARM_SAMPLES = 5

const engine = process.argv[2]
const profile = process.argv[3]
const inputPath = process.argv[4]
const width = Number(process.argv[5])
const height = Number(process.argv[6])
const format = process.argv[7]
const expectedHash = process.argv[8]
if (engine !== 'javascript' && engine !== 'scalar' && engine !== 'simd') {
  throw new Error('PNG WASM encode engine must be javascript, scalar, or simd')
}
if (profile !== 'cold' && profile !== 'warm') {
  throw new Error('PNG WASM encode profile must be cold or warm')
}
if (!inputPath || !expectedHash) {
  throw new Error(
    'Usage: wasm-encode-worker.ts engine profile input.raw width height format expected-sha256',
  )
}
if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1) {
  throw new Error('PNG WASM encode dimensions are invalid')
}
if (format !== 'rgb8' && format !== 'rgba8') {
  throw new Error('PNG WASM encode format must be rgb8 or rgba8')
}

const input = await readFile(inputPath)
if (input.byteLength !== width * height * channelsForFormat(format)) {
  throw new Error('PNG WASM encode raw input has an invalid byte length')
}
let initializationMilliseconds = 0
let loaderCalls = 0
let loaderFailure: unknown
let initialWasmMemoryBytes = 0
const wasmMemories: WebAssembly.Memory[] = []
const artifactPath = new URL(
  engine === 'simd'
    ? '../../src/accelerator-entries/png-codec-simd.wasm'
    : '../../src/accelerator-entries/png-codec.wasm',
  import.meta.url,
)
const loadInstance: WasmPngInstanceLoader = async () => {
  const start = performance.now()
  loaderCalls += 1
  try {
    const result = await WebAssembly.instantiate(await readFile(artifactPath))
    const abiFunction: unknown = result.instance.exports.png_codec_abi_version
    const simdFunction: unknown = result.instance.exports.png_codec_simd
    if (typeof abiFunction !== 'function' || typeof simdFunction !== 'function') {
      throw new Error('PNG WASM encoder identity exports are unavailable')
    }
    const abiVersion: unknown = Reflect.apply(abiFunction, undefined, [])
    const simd: unknown = Reflect.apply(simdFunction, undefined, [])
    if (abiVersion !== 1 || simd !== (engine === 'simd' ? 1 : 0)) {
      throw new Error('PNG WASM encoder artifact identity is invalid')
    }
    const memory: unknown = result.instance.exports.memory
    if (!(memory instanceof WebAssembly.Memory)) {
      throw new Error('PNG WASM encoder memory export is unavailable')
    }
    initialWasmMemoryBytes = memory.buffer.byteLength
    wasmMemories.push(memory)
    initializationMilliseconds += performance.now() - start
    return result.instance
  } catch (error) {
    loaderFailure = error
    throw error
  }
}
const loaders: WasmPngInstanceLoaders =
  engine === 'simd' ? { simdEncoder: loadInstance } : { encoder: loadInstance }
const codec: ImageCodec =
  engine === 'javascript'
    ? pngCodec
    : createWasmPngAcceleratorWithLoaders(loaders, {
        maximumRowBytes: MAXIMUM_ROW_BYTES,
        minimumEncodePixels: 1,
        minimumPixels: 1,
      }).accelerate(pngCodec)

const encode = async (): Promise<{
  readonly milliseconds: number
  readonly outputBytes: number
  readonly outputSha256: string
}> => {
  const start = performance.now()
  const output = await encodeBenchmarkPng(codec, input, width, height, format)
  const milliseconds = performance.now() - start
  return { milliseconds, outputBytes: output.byteLength, outputSha256: sha256(output) }
}

const garbageCollector: unknown = Reflect.get(globalThis, 'gc')
const collectGarbage = (): void => {
  if (typeof garbageCollector === 'function') Reflect.apply(garbageCollector, undefined, [])
}

if (profile === 'warm') {
  for (let run = 0; run < WARMUP_RUNS; run += 1) {
    const warmup = await encode()
    if (warmup.outputSha256 !== expectedHash) {
      throw new Error('PNG WASM encode warmup failed byte-identical output parity')
    }
    collectGarbage()
  }
}
collectGarbage()
const baseline = process.memoryUsage()
const samples: number[] = []
let outputBytes = 0
let outputSha256 = ''
const measuredRuns = profile === 'warm' ? WARM_SAMPLES : 1
for (let run = 0; run < measuredRuns; run += 1) {
  const result = await encode()
  if (result.outputSha256 !== expectedHash) {
    throw new Error('PNG WASM encode failed byte-identical output parity')
  }
  if (outputSha256 && result.outputSha256 !== outputSha256) {
    throw new Error('PNG WASM encode output changed between samples')
  }
  samples.push(result.milliseconds)
  outputBytes = result.outputBytes
  outputSha256 = result.outputSha256
}
if (loaderFailure !== undefined) {
  throw new Error('PNG WASM encode loader failed and the reference fallback was selected', {
    cause: loaderFailure,
  })
}
if (
  (engine === 'javascript' && loaderCalls !== 0) ||
  (engine !== 'javascript' && loaderCalls !== 1)
) {
  throw new Error(`PNG WASM encode loader ran ${loaderCalls} times for ${engine}`)
}
let wasmMemoryBytes = 0
for (const memory of wasmMemories) {
  wasmMemoryBytes = Math.max(wasmMemoryBytes, memory.buffer.byteLength)
}
if (engine !== 'javascript' && wasmMemoryBytes <= initialWasmMemoryBytes) {
  throw new Error('PNG WASM encode did not reserve its accelerated row workspace')
}
const usage = process.memoryUsage()
const maximumRssBytes = process.resourceUsage().maxRSS * 1_024
console.log(
  JSON.stringify({
    absoluteRssDeltaBytes: Math.abs(usage.rss - baseline.rss),
    arrayBuffersBytes: usage.arrayBuffers,
    baselineRssBytes: baseline.rss,
    engine,
    externalBytes: usage.external,
    finalRssBytes: usage.rss,
    initializationMilliseconds,
    loaderCalls,
    maximumRssBytes,
    operation: 'encode',
    outputBytes,
    outputSha256,
    peakRssDeltaBytes: Math.max(0, maximumRssBytes - baseline.rss),
    profile,
    samples,
    wasmInitialMemoryBytes: initialWasmMemoryBytes,
    wasmMemoryBytes,
  }),
)
