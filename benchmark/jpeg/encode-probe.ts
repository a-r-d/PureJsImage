import { performance } from 'node:perf_hooks'
import jpeg from 'jpeg-js'

import type { ImageCodec } from '../../src/codec.ts'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const isImageCodec = (value: unknown): value is ImageCodec =>
  isRecord(value) && typeof value.createEncoder === 'function'

const codecModuleUrl = new URL('../../dist/codec-entries/jpeg.js', import.meta.url).href
const codecModule: unknown = await import(codecModuleUrl)
if (!isRecord(codecModule) || !isImageCodec(codecModule.jpegCodec)) {
  throw new Error('Built JPEG codec entry is unavailable; run npm run build first')
}
const jpegCodec = codecModule.jpegCodec

const width = 2_048
const height = 1_536
const pixels = width * height
const requestedMode = process.argv[2] ?? '420'
if (requestedMode !== '420' && requestedMode !== '422' && requestedMode !== '444') {
  throw new Error('Usage: node benchmark/jpeg/encode-probe.ts [420|422|444]')
}
const chromaSubsampling = requestedMode
const source = new Uint8Array(pixels * 3)
for (let y = 0; y < height; y += 1) {
  for (let x = 0; x < width; x += 1) {
    const offset = (y * width + x) * 3
    source[offset] = (x * 13 + y * 3) & 255
    source[offset + 1] = (x * 5 + y * 11) & 255
    source[offset + 2] = (x * 7 + y * 17) & 255
  }
}

const encode = async (): Promise<{ elapsed: number; output: Buffer }> => {
  const chunks: Buffer[] = []
  const sink = {
    async write(chunk: Uint8Array): Promise<void> {
      chunks.push(Buffer.from(chunk))
    },
    async close(): Promise<void> {},
    async abort(): Promise<void> {},
  }
  const start = performance.now()
  const encoder = await jpegCodec.createEncoder?.(sink, {
    width,
    height,
    pixelFormat: 'rgb8',
    options: { quality: 80, chromaSubsampling },
  })
  if (!encoder) throw new Error('JPEG encoder is unavailable')
  await encoder.write({
    x: 0,
    y: 0,
    width,
    height,
    stride: width * 3,
    format: 'rgb8',
    data: source,
  })
  await encoder.finish()
  return { elapsed: performance.now() - start, output: Buffer.concat(chunks) }
}

const garbageCollector: unknown = Reflect.get(globalThis, 'gc')
const collectGarbage = (): void => {
  if (typeof garbageCollector === 'function') Reflect.apply(garbageCollector, undefined, [])
}

for (let warmup = 0; warmup < 2; warmup += 1) {
  await encode()
  collectGarbage()
}
const elapsed: number[] = []
let output: Buffer<ArrayBufferLike> = Buffer.alloc(0)
for (let sample = 0; sample < 5; sample += 1) {
  const result = await encode()
  elapsed.push(result.elapsed)
  output = result.output
}
const peakRssKiB = process.resourceUsage().maxRSS
const decoded = jpeg.decode(output, {
  useTArray: true,
  formatAsRGBA: false,
  tolerantDecoding: false,
})
if (decoded.width !== width || decoded.height !== height) {
  throw new Error(`Independent decode returned ${decoded.width}x${decoded.height}`)
}
let squaredError = 0
for (let index = 0; index < source.byteLength; index += 1) {
  const difference = (source[index] ?? 0) - (decoded.data[index] ?? 0)
  squaredError += difference * difference
}
const sorted = elapsed.toSorted((left, right) => left - right)
const medianMilliseconds = sorted[2] ?? 0
const meanSquaredError = squaredError / source.byteLength
console.log(
  JSON.stringify(
    {
      chromaSubsampling,
      dimensions: `${width}x${height}`,
      samples: elapsed,
      medianMilliseconds,
      throughputMegapixelsPerSecond: pixels / medianMilliseconds / 1_000,
      peakRssMiB: peakRssKiB / 1_024,
      outputBytes: output.byteLength,
      psnr: 10 * Math.log10((255 * 255) / meanSquaredError),
      independentDecode: 'passed',
    },
    undefined,
    2,
  ),
)
