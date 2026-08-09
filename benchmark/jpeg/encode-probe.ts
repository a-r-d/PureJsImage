import { performance } from 'node:perf_hooks'
import { writeFile } from 'node:fs/promises'
import jpeg from 'jpeg-js'

import type { ImageCodec } from '../../src/codec.ts'
import type { PixelFormat } from '../../src/pixel.ts'

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
const profile = process.argv[3] ?? 'warm'
if (
  requestedMode !== '420' &&
  requestedMode !== '422' &&
  requestedMode !== '444' &&
  requestedMode !== 'gray' &&
  requestedMode !== 'restart' &&
  requestedMode !== 'progressive' &&
  requestedMode !== 'progressive-restart'
) {
  throw new Error(
    'Usage: node benchmark/jpeg/encode-probe.ts [420|422|444|gray|restart|progressive|progressive-restart] [cold|warm]',
  )
}
if (profile !== 'cold' && profile !== 'warm')
  throw new Error('JPEG encode profile must be cold or warm')
const grayscale = requestedMode === 'gray'
const restart = requestedMode === 'restart' || requestedMode === 'progressive-restart'
const progressive = requestedMode === 'progressive' || requestedMode === 'progressive-restart'
const chromaSubsampling = requestedMode === '422' || requestedMode === '444' ? requestedMode : '420'
const sourceChannels = grayscale ? 1 : 3
const pixelFormat: PixelFormat = grayscale ? 'gray8' : 'rgb8'
const source = new Uint8Array(pixels * sourceChannels)
for (let y = 0; y < height; y += 1) {
  for (let x = 0; x < width; x += 1) {
    const offset = (y * width + x) * sourceChannels
    if (grayscale) source[offset] = (x * 13 + y * 3) & 255
    else {
      source[offset] = (x * 13 + y * 3) & 255
      source[offset + 1] = (x * 5 + y * 11) & 255
      source[offset + 2] = (x * 7 + y * 17) & 255
    }
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
    pixelFormat,
    options: {
      quality: 80,
      chromaSubsampling,
      progressive,
      ...(restart ? { restartInterval: 4 } : {}),
    },
  })
  if (!encoder) throw new Error('JPEG encoder is unavailable')
  await encoder.write({
    x: 0,
    y: 0,
    width,
    height,
    stride: width * sourceChannels,
    format: pixelFormat,
    data: source,
  })
  await encoder.finish()
  return { elapsed: performance.now() - start, output: Buffer.concat(chunks) }
}

const garbageCollector: unknown = Reflect.get(globalThis, 'gc')
const collectGarbage = (): void => {
  if (typeof garbageCollector === 'function') Reflect.apply(garbageCollector, undefined, [])
}

const warmups = profile === 'warm' ? 2 : 0
const runs = profile === 'warm' ? 5 : 1
for (let warmup = 0; warmup < warmups; warmup += 1) {
  await encode()
  collectGarbage()
}
const elapsed: number[] = []
let output: Buffer<ArrayBufferLike> = Buffer.alloc(0)
for (let sample = 0; sample < runs; sample += 1) {
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
for (let pixel = 0; pixel < pixels; pixel += 1) {
  for (let channel = 0; channel < 3; channel += 1) {
    const sourceIndex = grayscale ? pixel : pixel * 3 + channel
    const difference = (source[sourceIndex] ?? 0) - (decoded.data[pixel * 3 + channel] ?? 0)
    squaredError += difference * difference
  }
}
const restartMarkers = restart
  ? output.reduce(
      (count, value, index) =>
        value === 0xff && (output[index + 1] ?? 0) >= 0xd0 && (output[index + 1] ?? 0) <= 0xd7
          ? count + 1
          : count,
      0,
    )
  : 0
if (restart && restartMarkers === 0) throw new Error('Restart benchmark output has no markers')
const sorted = elapsed.toSorted((left, right) => left - right)
const medianMilliseconds = sorted[Math.floor(sorted.length / 2)] ?? 0
const meanSquaredError = squaredError / (pixels * 3)
const frameMarker = output.some((value, index) => value === 0xff && output[index + 1] === 0xc2)
  ? 'SOF2'
  : 'SOF0'
const scanCount = output.reduce(
  (count, value, index) => count + (value === 0xff && output[index + 1] === 0xda ? 1 : 0),
  0,
)
if (progressive && (frameMarker !== 'SOF2' || scanCount !== 6)) {
  throw new Error(`Progressive benchmark output was ${frameMarker} with ${scanCount} scans`)
}
const geometry =
  chromaSubsampling === '420'
    ? { width: 16, height: 16, luminanceBlocks: 4 }
    : chromaSubsampling === '422'
      ? { width: 16, height: 8, luminanceBlocks: 2 }
      : { width: 8, height: 8, luminanceBlocks: 1 }
const retainedCoefficientBytes = progressive
  ? Math.ceil(width / geometry.width) *
    Math.ceil(height / geometry.height) *
    (grayscale ? 1 : geometry.luminanceBlocks + 2) *
    64 *
    2
  : 0
const result = {
  mode: requestedMode,
  profile,
  progressive,
  frameMarker,
  scanCount,
  chromaSubsampling: grayscale ? '400' : chromaSubsampling,
  restartMarkers,
  dimensions: `${width}x${height}`,
  samples: elapsed,
  medianMilliseconds,
  throughputMegapixelsPerSecond: pixels / medianMilliseconds / 1_000,
  peakRssMiB: peakRssKiB / 1_024,
  retainedCoefficientBytes,
  outputBytes: output.byteLength,
  psnr: 10 * Math.log10((255 * 255) / meanSquaredError),
  independentDecode: 'passed',
}
const serialized = `${JSON.stringify(result, undefined, 2)}\n`
const outputPath = process.argv[4]
if (outputPath) await writeFile(outputPath, serialized)
else console.log(serialized.trimEnd())
