import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { performance } from 'node:perf_hooks'
import jpeg from 'jpeg-js'

import type { ImageCodec } from '../../src/codec.ts'
import { jpegCodec } from '../../src/codecs/jpeg.ts'
import {
  createWasmJpegAcceleratorWithLoaders,
  type WasmJpegInstanceLoader,
} from '../../src/accelerators/wasm/jpeg.ts'
import type { PixelFormat } from '../../src/pixel.ts'

const engine = process.argv[2]
const mode = process.argv[3]
const width = Number(process.argv[4])
const height = Number(process.argv[5])
const profile = process.argv[6]
const entropy = process.argv[7]
const inputFormat = process.argv[9] ?? 'rgb'
if (engine !== 'javascript' && engine !== 'scalar' && engine !== 'aan' && engine !== 'simd') {
  throw new Error('JPEG WASM encoder engine must be javascript, scalar, aan, or simd')
}
if (mode !== 'gray' && mode !== '420' && mode !== '422' && mode !== '444') {
  throw new Error('JPEG WASM encoder mode must be gray, 420, 422, or 444')
}
if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1) {
  throw new Error('JPEG WASM encoder dimensions are invalid')
}
if (profile !== 'cold' && profile !== 'warm') {
  throw new Error('JPEG WASM encoder profile must be cold or warm')
}
if (entropy !== 'low' && entropy !== 'high') {
  throw new Error('JPEG WASM encoder entropy must be low or high')
}
if (inputFormat !== 'rgb' && inputFormat !== 'rgba') {
  throw new Error('JPEG WASM encoder input format must be rgb or rgba')
}

const grayscale = mode === 'gray'
if (grayscale && inputFormat === 'rgba') throw new Error('Grayscale input cannot use RGBA')
const pixelFormat: PixelFormat = grayscale ? 'gray8' : inputFormat === 'rgba' ? 'rgba8' : 'rgb8'
const channels = grayscale ? 1 : inputFormat === 'rgba' ? 4 : 3
const source = new Uint8Array(width * height * channels)
let random = 0x6d2b79f5
for (let y = 0; y < height; y += 1) {
  for (let x = 0; x < width; x += 1) {
    const offset = (y * width + x) * channels
    if (entropy === 'high') {
      random = Math.imul(random ^ (random >>> 15), 1 | random)
      random ^= random + Math.imul(random ^ (random >>> 7), 61 | random)
      random ^= random >>> 14
    }
    const value = entropy === 'high' ? random : x * 3 + y * 5
    source[offset] = value & 255
    if (!grayscale) {
      source[offset + 1] = (value >>> 8) & 255
      source[offset + 2] = (value >>> 16) & 255
      if (channels === 4) source[offset + 3] = (value >>> 24) & 255
    }
  }
}

const artifactPath =
  process.argv[8] ??
  new URL(
    engine === 'simd'
      ? '../../src/accelerator-entries/jpeg-encoder-simd.wasm'
      : engine === 'aan'
        ? '../.tmp/wasm/jpeg-encoder-aan.wasm'
        : '../../src/accelerator-entries/jpeg-encoder.wasm',
    import.meta.url,
  )
let initializationMilliseconds = 0
let wasmInstance: WebAssembly.Instance | undefined
const loadInstance: WasmJpegInstanceLoader = async () => {
  const start = performance.now()
  const result = await WebAssembly.instantiate(await readFile(artifactPath))
  initializationMilliseconds = performance.now() - start
  wasmInstance = result.instance
  return result.instance
}
const codec: ImageCodec =
  engine === 'javascript'
    ? jpegCodec
    : createWasmJpegAcceleratorWithLoaders(
        engine === 'simd' ? { simdEncoder: loadInstance } : { encoder: loadInstance },
        { minimumEncodePixels: 1 },
      ).accelerate(jpegCodec)

const encode = async (): Promise<{ readonly bytes: Uint8Array; readonly milliseconds: number }> => {
  const chunks: Uint8Array[] = []
  let length = 0
  const sink = {
    async write(chunk: Uint8Array): Promise<void> {
      const copy = chunk.slice()
      chunks.push(copy)
      length += copy.byteLength
    },
    async close(): Promise<void> {},
    async abort(): Promise<void> {},
  }
  const start = performance.now()
  const encoder = await codec.createEncoder?.(sink, {
    width,
    height,
    pixelFormat,
    options: {
      chromaSubsampling: grayscale ? '444' : mode,
      quality: 80,
    },
  })
  if (!encoder) throw new Error('JPEG encoder is unavailable')
  await encoder.write({
    data: source,
    format: pixelFormat,
    height,
    stride: width * channels,
    width,
    x: 0,
    y: 0,
  })
  await encoder.finish()
  const bytes = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return { bytes, milliseconds: performance.now() - start }
}

const garbageCollector: unknown = Reflect.get(globalThis, 'gc')
const collectGarbage = (): void => {
  if (typeof garbageCollector === 'function') Reflect.apply(garbageCollector, undefined, [])
}
collectGarbage()
const baseline = process.memoryUsage()
const warmups = profile === 'warm' ? 2 : 0
const runs = profile === 'warm' ? 5 : 1
for (let warmup = 0; warmup < warmups; warmup += 1) {
  await encode()
  collectGarbage()
}
const samples: number[] = []
let output: Uint8Array<ArrayBufferLike> = new Uint8Array(0)
for (let run = 0; run < runs; run += 1) {
  const result = await encode()
  samples.push(result.milliseconds)
  output = result.bytes
}
const sorted = samples.toSorted((left, right) => left - right)
const medianMilliseconds = sorted[Math.floor(sorted.length / 2)] ?? 0
const memory = wasmInstance?.exports.memory
const wasmMemoryBytes = memory instanceof WebAssembly.Memory ? memory.buffer.byteLength : 0
const usage = process.memoryUsage()
const decoded = jpeg.decode(output, {
  formatAsRGBA: false,
  tolerantDecoding: false,
  useTArray: true,
})
if (decoded.width !== width || decoded.height !== height) {
  throw new Error(`Independent JPEG decode returned ${decoded.width}x${decoded.height}`)
}
let squaredError = 0
for (let pixel = 0; pixel < width * height; pixel += 1) {
  for (let channel = 0; channel < 3; channel += 1) {
    const sourceIndex = grayscale ? pixel : pixel * channels + channel
    const sourceValue = source[sourceIndex] ?? 0
    const expected =
      channels === 4
        ? Math.floor(
            (sourceValue * (source[pixel * 4 + 3] ?? 0) +
              255 * (255 - (source[pixel * 4 + 3] ?? 0)) +
              127) /
              255,
          )
        : sourceValue
    const difference = expected - (decoded.data[pixel * 3 + channel] ?? 0)
    squaredError += difference * difference
  }
}
const meanSquaredError = squaredError / (width * height * 3)
const psnr =
  meanSquaredError === 0
    ? Number.POSITIVE_INFINITY
    : 10 * Math.log10((255 * 255) / meanSquaredError)
console.log(
  JSON.stringify({
    arrayBuffersBytes: usage.arrayBuffers,
    baselineRssBytes: baseline.rss,
    dimensions: `${width}x${height}`,
    engine,
    entropy,
    externalBytes: usage.external,
    hash: createHash('sha256').update(output).digest('hex'),
    inputFormat,
    initializationMilliseconds,
    maximumRssBytes: process.resourceUsage().maxRSS * 1024,
    medianMilliseconds,
    psnr,
    mode,
    outputBytes: output.byteLength,
    profile,
    samples,
    throughputMegapixelsPerSecond: (width * height) / medianMilliseconds / 1_000,
    wasmMemoryBytes,
  }),
)
