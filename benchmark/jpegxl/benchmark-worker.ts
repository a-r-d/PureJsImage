import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { jpegxlCodec } from '../../src/codecs/jpegxl.ts'
import { reconstructJpegFromJpegXl, transcodeJpegToJpegXl } from '../../src/jpegxl.ts'
import { defaultImageLimits } from '../../src/limits.ts'
import { Uint8ArraySink } from '../../src/sink.ts'
import { MemorySource } from '../../src/source.ts'

type Workload = 'encode-rgb8' | 'transcode-progressive-yuv420'

interface MemorySnapshot {
  readonly arrayBuffersBytes: number
  readonly externalBytes: number
  readonly heapUsedBytes: number
  readonly rssBytes: number
}

const snapshot = (): MemorySnapshot => {
  const memory = process.memoryUsage()
  return {
    arrayBuffersBytes: memory.arrayBuffers,
    externalBytes: memory.external,
    heapUsedBytes: memory.heapUsed,
    rssBytes: memory.rss,
  }
}

const sha256 = (data: Uint8Array): string => createHash('sha256').update(data).digest('hex')

const rgbFixture = (): Readonly<{ width: number; height: number; pixels: Uint8Array }> => {
  const width = 512
  const height = 384
  const pixels = new Uint8Array(width * height * 3)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 3
      pixels[offset] = (x * 3 + y) & 255
      pixels[offset + 1] = (x + y * 5) & 255
      pixels[offset + 2] = ((x >>> 3) * 19 + (y >>> 3) * 11) & 255
    }
  }
  return Object.freeze({ width, height, pixels })
}

const encodeRgb = async (): Promise<Readonly<{ input: Uint8Array; output: Uint8Array }>> => {
  const fixture = rgbFixture()
  const sink = new Uint8ArraySink()
  const encoder = await jpegxlCodec.createEncoder?.(sink, {
    width: fixture.width,
    height: fixture.height,
    pixelFormat: 'rgb8',
    options: { mode: 'lossless', effort: 1, container: true },
    limits: defaultImageLimits,
  })
  if (!encoder) throw new Error('JPEG XL encoder is unavailable')
  await encoder.write({
    x: 0,
    y: 0,
    width: fixture.width,
    height: fixture.height,
    stride: fixture.width * 3,
    format: 'rgb8',
    data: fixture.pixels,
  })
  await encoder.finish()
  const output = sink.toUint8Array()
  const decoder = await jpegxlCodec.createDecoder?.(new MemorySource(output), defaultImageLimits)
  if (decoder?.pixelFormat !== 'rgb8') {
    throw new Error('JPEG XL encoder benchmark output did not reopen as RGB8')
  }
  const decoded = new Uint8Array(fixture.pixels.byteLength)
  for await (const block of decoder.decode()) {
    try {
      for (let row = 0; row < block.height; row += 1) {
        decoded.set(
          block.data.subarray(row * block.stride, row * block.stride + block.width * 3),
          ((block.y + row) * fixture.width + block.x) * 3,
        )
      }
    } finally {
      block.release?.()
    }
  }
  if (sha256(decoded) !== sha256(fixture.pixels)) {
    throw new Error('JPEG XL encoder benchmark output differs from the source pixels')
  }
  return Object.freeze({ input: fixture.pixels, output })
}

const transcodeJpeg = async (): Promise<Readonly<{ input: Uint8Array; output: Uint8Array }>> => {
  const input = new Uint8Array(
    await readFile('benchmark/corpus/files/wpt-webcodecs-mozjpeg-yuv420.jpg'),
  )
  if (sha256(input) !== '226671d7fcd032a237d7e195e936545f0b492628fd96b21e1b062ccbc40e2a6e') {
    throw new Error('JPEG XL transcode benchmark source checksum changed')
  }
  const result = await transcodeJpegToJpegXl(input)
  const reconstructed = await reconstructJpegFromJpegXl(result.data)
  if (sha256(reconstructed) !== sha256(input) || reconstructed.byteLength !== input.byteLength) {
    throw new Error('JPEG XL transcode benchmark reconstruction differs from the source JPEG')
  }
  return Object.freeze({ input, output: result.data })
}

const workload = process.argv[2] as Workload | undefined
if (workload !== 'encode-rgb8' && workload !== 'transcode-progressive-yuv420') {
  throw new Error('Usage: benchmark-worker.ts <encode-rgb8|transcode-progressive-yuv420> [output]')
}
for (let turn = 0; turn < 5; turn += 1) {
  globalThis.gc?.()
  await new Promise<void>((resolve) => setImmediate(resolve))
}
const baseline = snapshot()
const startedAt = performance.now()
const result = workload === 'encode-rgb8' ? await encodeRgb() : await transcodeJpeg()
const wallMilliseconds = performance.now() - startedAt
const peak = snapshot()
const outputPath = process.argv[3]
if (outputPath) await writeFile(outputPath, result.output)
const sourcePath = process.argv[4]
if (sourcePath && workload === 'encode-rgb8') {
  const header = new TextEncoder().encode('P6\n512 384\n255\n')
  const ppm = new Uint8Array(header.byteLength + result.input.byteLength)
  ppm.set(header)
  ppm.set(result.input, header.byteLength)
  await writeFile(sourcePath, ppm)
}
console.log(
  JSON.stringify({
    workload,
    validation: workload === 'encode-rgb8' ? 'exact-pixels' : 'exact-jpeg-bytes',
    baseline,
    peak,
    maximumRssBytes: process.resourceUsage().maxRSS * 1_024,
    inputBytes: result.input.byteLength,
    inputSha256: sha256(result.input),
    outputBytes: result.output.byteLength,
    outputSha256: sha256(result.output),
    wallMilliseconds: Number(wallMilliseconds.toFixed(3)),
  }),
)
