import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { performance } from 'node:perf_hooks'

import {
  createWasmPngAcceleratorWithLoaders,
  type WasmPngInstanceLoader,
  type WasmPngInstanceLoaders,
} from '../../src/accelerators/wasm/png.ts'
import type { ImageCodec } from '../../src/codec.ts'
import { pngCodec } from '../../src/codecs/png.ts'
import { defaultImageLimits } from '../../src/limits.ts'
import { MemorySource } from '../../src/source.ts'

const MAXIMUM_ROW_BYTES = 16 * 1_048_576
const WARMUP_RUNS = 2
const WARM_SAMPLES = 5

const engine = process.argv[2]
const profile = process.argv[3]
const inputPath = process.argv[4]
const expectedHash = process.argv[5]
if (engine !== 'javascript' && engine !== 'scalar' && engine !== 'simd') {
  throw new Error('PNG WASM decode engine must be javascript, scalar, or simd')
}
if (profile !== 'cold' && profile !== 'warm') {
  throw new Error('PNG WASM decode profile must be cold or warm')
}
if (!inputPath || !expectedHash) {
  throw new Error('Usage: wasm-decode-worker.ts engine profile input.png expected-sha256')
}

const input = await readFile(inputPath)
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
      throw new Error('PNG WASM decoder identity exports are unavailable')
    }
    const abiVersion: unknown = Reflect.apply(abiFunction, undefined, [])
    const simd: unknown = Reflect.apply(simdFunction, undefined, [])
    if (abiVersion !== 1 || simd !== (engine === 'simd' ? 1 : 0)) {
      throw new Error('PNG WASM decoder artifact identity is invalid')
    }
    const memory: unknown = result.instance.exports.memory
    if (!(memory instanceof WebAssembly.Memory)) {
      throw new Error('PNG WASM decoder memory export is unavailable')
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
  engine === 'simd' ? { simdDecoder: loadInstance } : { decoder: loadInstance }
const codec: ImageCodec =
  engine === 'javascript'
    ? pngCodec
    : createWasmPngAcceleratorWithLoaders(loaders, {
        maximumRowBytes: MAXIMUM_ROW_BYTES,
        minimumEncodePixels: 1,
        minimumPixels: 1,
      }).accelerate(pngCodec)

const decode = async (): Promise<{
  readonly milliseconds: number
  readonly outputBytes: number
  readonly outputSha256: string
}> => {
  const hash = createHash('sha256')
  let outputBytes = 0
  const start = performance.now()
  const decoder = await codec.createDecoder?.(new MemorySource(input), defaultImageLimits)
  if (!decoder) throw new Error('PNG benchmark decoder is unavailable')
  for await (const block of decoder.decode()) {
    const rowBytes = block.width * (block.format === 'rgb8' ? 3 : block.format === 'rgba8' ? 4 : 1)
    for (let row = 0; row < block.height; row += 1) {
      hash.update(block.data.subarray(row * block.stride, row * block.stride + rowBytes))
      outputBytes += rowBytes
    }
    block.release?.()
  }
  return {
    milliseconds: performance.now() - start,
    outputBytes,
    outputSha256: hash.digest('hex'),
  }
}

const garbageCollector: unknown = Reflect.get(globalThis, 'gc')
const collectGarbage = (): void => {
  if (typeof garbageCollector === 'function') Reflect.apply(garbageCollector, undefined, [])
}

if (profile === 'warm') {
  for (let run = 0; run < WARMUP_RUNS; run += 1) {
    const warmup = await decode()
    if (warmup.outputSha256 !== expectedHash) {
      throw new Error('PNG WASM decode warmup failed exact output parity')
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
  const result = await decode()
  if (result.outputSha256 !== expectedHash) {
    throw new Error('PNG WASM decode failed exact output parity')
  }
  if (outputSha256 && result.outputSha256 !== outputSha256) {
    throw new Error('PNG WASM decode output changed between samples')
  }
  samples.push(result.milliseconds)
  outputBytes = result.outputBytes
  outputSha256 = result.outputSha256
}
if (loaderFailure !== undefined) {
  throw new Error('PNG WASM decode loader failed and the reference fallback was selected', {
    cause: loaderFailure,
  })
}
if (
  (engine === 'javascript' && loaderCalls !== 0) ||
  (engine !== 'javascript' && loaderCalls !== 1)
) {
  throw new Error(`PNG WASM decode loader ran ${loaderCalls} times for ${engine}`)
}
let wasmMemoryBytes = 0
for (const memory of wasmMemories) {
  wasmMemoryBytes = Math.max(wasmMemoryBytes, memory.buffer.byteLength)
}
if (engine !== 'javascript' && wasmMemoryBytes <= initialWasmMemoryBytes) {
  throw new Error('PNG WASM decode did not reserve its accelerated row workspace')
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
    operation: 'decode',
    outputBytes,
    outputSha256,
    peakRssDeltaBytes: Math.max(0, maximumRssBytes - baseline.rss),
    profile,
    samples,
    wasmInitialMemoryBytes: initialWasmMemoryBytes,
    wasmMemoryBytes,
  }),
)
