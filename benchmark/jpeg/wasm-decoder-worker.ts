import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { performance } from 'node:perf_hooks'

import type { ImageCodec } from '../../src/codec.ts'
import { createWasmJpegAcceleratorWithLoaders } from '../../src/accelerators/wasm/jpeg.ts'
import { jpegCodec } from '../../src/codecs/jpeg.ts'
import { defaultImageLimits } from '../../src/limits.ts'
import { MemorySource } from '../../src/source.ts'

const engine = process.argv[2]
const profile = process.argv[3]
const inputPath = process.argv[4]
if (
  (engine !== 'javascript' && engine !== 'scalar' && engine !== 'simd') ||
  (profile !== 'cold' && profile !== 'warm')
) {
  throw new Error('Usage: wasm-decoder-worker.ts [javascript|scalar|simd] [cold|warm] input.jpg')
}
if (!inputPath) throw new Error('JPEG WASM benchmark input path is required')
const artifactPath =
  process.argv[5] ??
  new URL(
    engine === 'simd'
      ? '../../src/accelerator-entries/jpeg-decoder-simd.wasm'
      : '../../src/accelerator-entries/jpeg-decoder.wasm',
    import.meta.url,
  )

const input = await readFile(inputPath)
let initializationMilliseconds = 0
let wasmMemoryBytes = 0
let wasmMemory: WebAssembly.Memory | undefined
const accelerator = createWasmJpegAcceleratorWithLoaders(
  {
    ...(engine === 'scalar'
      ? {
          decoder: async () => {
            const bytes = await readFile(artifactPath)
            const start = performance.now()
            const result = await WebAssembly.instantiate(bytes)
            initializationMilliseconds = performance.now() - start
            const memory: unknown = result.instance.exports.memory
            if (!(memory instanceof WebAssembly.Memory)) {
              throw new Error('JPEG WASM memory is unavailable')
            }
            wasmMemory = memory
            wasmMemoryBytes = memory.buffer.byteLength
            return result.instance
          },
        }
      : {}),
    ...(engine === 'simd'
      ? {
          simdDecoder: async () => {
            const bytes = await readFile(artifactPath)
            const start = performance.now()
            const result = await WebAssembly.instantiate(bytes)
            initializationMilliseconds = performance.now() - start
            const memory: unknown = result.instance.exports.memory
            if (!(memory instanceof WebAssembly.Memory)) {
              throw new Error('JPEG WASM memory is unavailable')
            }
            wasmMemory = memory
            wasmMemoryBytes = memory.buffer.byteLength
            return result.instance
          },
        }
      : {}),
  },
  { minimumPixels: 1 },
)
const codec: ImageCodec = engine === 'javascript' ? jpegCodec : accelerator.accelerate(jpegCodec)

const decode = async (): Promise<{ hash: string; milliseconds: number }> => {
  const start = performance.now()
  const decoder = await codec.createDecoder?.(new MemorySource(input), defaultImageLimits)
  if (!decoder) throw new Error('JPEG decoder is unavailable')
  const hash = createHash('sha256')
  for await (const block of decoder.decode()) {
    for (let row = 0; row < block.height; row += 1) {
      hash.update(block.data.subarray(row * block.stride, row * block.stride + block.width * 3))
    }
    block.release?.()
  }
  return { hash: hash.digest('hex'), milliseconds: performance.now() - start }
}

const garbageCollector: unknown = Reflect.get(globalThis, 'gc')
const collectGarbage = (): void => {
  if (typeof garbageCollector === 'function') Reflect.apply(garbageCollector, undefined, [])
}

if (profile === 'warm') {
  await decode()
  await decode()
  collectGarbage()
}
const baseline = process.memoryUsage()
const result = await decode()
if (wasmMemory) wasmMemoryBytes = wasmMemory.buffer.byteLength
const memory = process.memoryUsage()

console.log(
  JSON.stringify({
    engine,
    profile,
    ...result,
    initializationMilliseconds,
    wasmMemoryBytes,
    baselineRssBytes: baseline.rss,
    rssBytes: memory.rss,
    maximumRssBytes: process.resourceUsage().maxRSS * 1_024,
    externalBytes: memory.external,
    arrayBuffersBytes: memory.arrayBuffers,
  }),
)
