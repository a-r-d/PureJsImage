import { createHash } from 'node:crypto'

import { allCodecs } from '../../src/codec-entries/all.ts'
import { pngCodec } from '../../src/codecs/png.ts'
import { defaultImageLimits } from '../../src/limits.ts'
import { createNodeImageLibrary } from '../../src/node-image.ts'
import { createNodeRuntime } from '../../src/node-runtime.ts'
import type { PixelBlock, PixelFormat } from '../../src/pixel.ts'
import { pixelBytesPerPixel } from '../../src/pixel.ts'
import { createResizeTransform } from '../../src/resize.ts'
import { Uint8ArraySink } from '../../src/sink.ts'
import { MemorySource } from '../../src/source.ts'

type Workload =
  | 'png16-roundtrip'
  | 'png16-crop-resize'
  | 'gray16-downscale'
  | 'rgb16-downscale'
  | 'rgba16-alpha-resize'
  | 'grayf32-resize'
  | 'rgbf32-resize'

const workloadNames: readonly Workload[] = [
  'png16-roundtrip',
  'png16-crop-resize',
  'gray16-downscale',
  'rgb16-downscale',
  'rgba16-alpha-resize',
  'grayf32-resize',
  'rgbf32-resize',
]

const expectedOutputHashes: Readonly<Record<Workload, string>> = Object.freeze({
  'png16-roundtrip': 'e57228d904c32befdcb199a6f48121156110d9adbf312e06897e5f08c71a4a72',
  'png16-crop-resize': '9d92c18c1dddbc8af7014b4af3d2ffc5e1d9395a6abd616f7cd382ce185bf6bb',
  'gray16-downscale': '34d6ca6e11f8cfd63584f86f34768d667e5ee7626f9e16ea43c37cdc7cfe8f63',
  'rgb16-downscale': '9c2541c65f0d8648e7d99005c6425d602e5be6ebebd2384bec059892261570a0',
  'rgba16-alpha-resize': '7f5a98eb16147c2d6978ee7f0b6707b01efef1bcf8c38072e6607ef57889d1df',
  'grayf32-resize': '8f07be183b9327139c2c892a39a2fba091888a1035fe692b49ab70d5d70ccdcc',
  'rgbf32-resize': 'a9863efc4948f73f3081a54ac78b003927288a09758bbbec29f94eeb973d9c0a',
})

const isWorkload = (value: unknown): value is Workload =>
  typeof value === 'string' && workloadNames.some((candidate) => candidate === value)

interface Snapshot {
  readonly rssBytes: number
  readonly externalBytes: number
  readonly arrayBuffersBytes: number
}

const snapshot = (): Snapshot => {
  const memory = process.memoryUsage()
  return {
    rssBytes: memory.rss,
    externalBytes: memory.external,
    arrayBuffersBytes: memory.arrayBuffers,
  }
}

const maximum = (left: Snapshot, right: Snapshot): Snapshot => ({
  rssBytes: Math.max(left.rssBytes, right.rssBytes),
  externalBytes: Math.max(left.externalBytes, right.externalBytes),
  arrayBuffersBytes: Math.max(left.arrayBuffersBytes, right.arrayBuffersBytes),
})

const workloadValue = process.argv[2]
if (!isWorkload(workloadValue)) {
  throw new Error('Precision benchmark worker requires a known workload')
}
const workload = workloadValue

const dimensions = (
  selected: Workload,
): {
  readonly width: number
  readonly height: number
  readonly outputWidth: number
  readonly outputHeight: number
} =>
  selected === 'gray16-downscale'
    ? { width: 4096, height: 3072, outputWidth: 512, outputHeight: 384 }
    : selected === 'png16-roundtrip' || selected === 'png16-crop-resize'
      ? {
          width: 1536,
          height: 1024,
          outputWidth: selected === 'png16-roundtrip' ? 1536 : 384,
          outputHeight: selected === 'png16-roundtrip' ? 1024 : 256,
        }
      : { width: 2048, height: 1536, outputWidth: 512, outputHeight: 384 }

const formatFor = (selected: Workload): PixelFormat => {
  if (selected === 'gray16-downscale' || selected.startsWith('png16')) return 'gray16'
  if (selected === 'rgb16-downscale') return 'rgb16'
  if (selected === 'rgba16-alpha-resize') return 'rgba16'
  if (selected === 'grayf32-resize') return 'grayf32'
  return 'rgbf32'
}

const createPixels = (format: PixelFormat, width: number, height: number): Uint8Array => {
  const bytesPerPixel = pixelBytesPerPixel(format)
  const data = new Uint8Array(width * height * bytesPerPixel)
  if (format.endsWith('16')) {
    const channels = bytesPerPixel / 2
    for (let pixel = 0; pixel < width * height; pixel += 1) {
      for (let channel = 0; channel < channels; channel += 1) {
        const value = (pixel * 257 + channel * 12_347) & 0xffff
        const offset = (pixel * channels + channel) * 2
        data[offset] = value >>> 8
        data[offset + 1] = value & 0xff
      }
      if (format === 'rgba16') {
        const alpha = (pixel * 991) & 0xffff
        const offset = pixel * 8 + 6
        data[offset] = alpha >>> 8
        data[offset + 1] = alpha & 0xff
      }
    }
    return data
  }
  const view = new DataView(data.buffer)
  const channels = format === 'grayf32' ? 1 : 3
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    for (let channel = 0; channel < channels; channel += 1) {
      view.setFloat32(
        (pixel * channels + channel) * 4,
        ((pixel + channel * 17) % 2048) / 127,
        false,
      )
    }
  }
  return data
}

const blockSource = (
  format: PixelFormat,
  width: number,
  height: number,
  data: Uint8Array,
): AsyncIterable<PixelBlock> => ({
  async *[Symbol.asyncIterator](): AsyncGenerator<PixelBlock> {
    const bytesPerPixel = pixelBytesPerPixel(format)
    const rows = 32
    for (let y = 0; y < height; y += rows) {
      const blockHeight = Math.min(rows, height - y)
      yield {
        x: 0,
        y,
        width,
        height: blockHeight,
        stride: width * bytesPerPixel,
        format,
        data: data.subarray(y * width * bytesPerPixel, (y + blockHeight) * width * bytesPerPixel),
      }
    }
  },
})

const encodePng = async (width: number, height: number, data: Uint8Array): Promise<Uint8Array> => {
  const sink = new Uint8ArraySink()
  const encoder = await pngCodec.createEncoder?.(sink, {
    width,
    height,
    pixelFormat: 'gray16',
    options: { compressionLevel: 1 },
    runtime: createNodeRuntime(),
    limits: defaultImageLimits,
  })
  if (!encoder) throw new Error('PNG encoder is unavailable')
  for await (const block of blockSource('gray16', width, height, data)) await encoder.write(block)
  await encoder.finish()
  await sink.close()
  return sink.toUint8Array()
}

const decodeHash = async (
  png: Uint8Array,
): Promise<{
  readonly hash: string
  readonly maximumBlockBytes: number
  readonly format: PixelFormat
  readonly width: number
  readonly height: number
}> => {
  const decoder = await pngCodec.createDecoder?.(new MemorySource(png), defaultImageLimits)
  if (!decoder) throw new Error('PNG decoder is unavailable')
  const hash = createHash('sha256')
  let maximumBlockBytes = 0
  for await (const block of decoder.decode()) {
    hash.update(block.data)
    maximumBlockBytes = Math.max(maximumBlockBytes, block.data.byteLength)
  }
  return {
    hash: hash.digest('hex'),
    maximumBlockBytes,
    format: decoder.pixelFormat,
    width: decoder.width,
    height: decoder.height,
  }
}

const geometry = dimensions(workload)
const format = formatFor(workload)
let pixels = createPixels(format, geometry.width, geometry.height)
let pngInput: Uint8Array | undefined
if (workload.startsWith('png16'))
  pngInput = await encodePng(geometry.width, geometry.height, pixels)

for (let turn = 0; turn < 4; turn += 1) {
  globalThis.gc?.()
  await new Promise<void>((resolve) => setImmediate(resolve))
}
const baseline = snapshot()
let peak = baseline
let maximumManagedBlockBytes = 0
const cpuStart = process.cpuUsage()
const startedAt = performance.now()
let outputBytes = 0
let outputFormat: PixelFormat = format
let outputHash = ''
let losslessRoundTrip = false

if (pngInput) {
  const images = createNodeImageLibrary(allCodecs)
  const image = await images.open(pngInput)
  const pipeline =
    workload === 'png16-roundtrip'
      ? image.png({ compressionLevel: 1 })
      : image
          .crop({ x: 0, y: 0, width: geometry.width, height: geometry.height })
          .resize({
            width: geometry.outputWidth,
            height: geometry.outputHeight,
            fit: 'fill',
            kernel: 'lanczos3',
          })
          .png({ compressionLevel: 1 })
  const output = await pipeline.toBuffer()
  outputBytes = output.byteLength
  const decoded = await decodeHash(output)
  outputFormat = decoded.format
  outputHash = decoded.hash
  maximumManagedBlockBytes = decoded.maximumBlockBytes
  if (decoded.width !== geometry.outputWidth || decoded.height !== geometry.outputHeight) {
    throw new Error('16-bit PNG benchmark produced incorrect output dimensions')
  }
  if (workload === 'png16-roundtrip') {
    const sourceHash = createHash('sha256').update(pixels).digest('hex')
    losslessRoundTrip = sourceHash === outputHash
    if (!losslessRoundTrip) throw new Error('16-bit PNG round trip changed native samples')
  }
  peak = maximum(peak, snapshot())
} else {
  const transform = createResizeTransform(geometry.width, geometry.height, format, {
    width: geometry.outputWidth,
    height: geometry.outputHeight,
    fit: 'fill',
    kernel: 'lanczos3',
  })
  const hash = createHash('sha256')
  for await (const block of transform.apply(
    blockSource(format, geometry.width, geometry.height, pixels),
  )) {
    hash.update(block.data)
    outputBytes += block.data.byteLength
    maximumManagedBlockBytes = Math.max(maximumManagedBlockBytes, block.data.byteLength)
    peak = maximum(peak, snapshot())
  }
  outputHash = hash.digest('hex')
  outputFormat = transform.pixelFormat
}
if (outputFormat !== format) throw new Error('Precision benchmark changed the native pixel format')
if (outputHash !== expectedOutputHashes[workload]) {
  throw new Error('Precision benchmark output does not match the pinned exact hash')
}
const wallMilliseconds = performance.now() - startedAt
const cpu = process.cpuUsage(cpuStart)
const maximumRssBytes = process.resourceUsage().maxRSS * 1024
pixels = new Uint8Array()

console.log(
  JSON.stringify({
    workload,
    wallMilliseconds: Number(wallMilliseconds.toFixed(3)),
    cpuMilliseconds: Number(((cpu.user + cpu.system) / 1000).toFixed(3)),
    baseline,
    peak,
    maximumRssBytes,
    rssDeltaBytes: Math.max(0, maximumRssBytes - baseline.rssBytes),
    peakExternalDeltaBytes: Math.max(0, peak.externalBytes - baseline.externalBytes),
    peakArrayBuffersDeltaBytes: Math.max(0, peak.arrayBuffersBytes - baseline.arrayBuffersBytes),
    maximumManagedBlockBytes,
    outputWidth: geometry.outputWidth,
    outputHeight: geometry.outputHeight,
    outputFormat,
    correctness: losslessRoundTrip ? 'exact-lossless-roundtrip' : 'exact-pinned-output',
    maximumAbsoluteError: 0,
    outputBytes,
    outputHash,
  }),
)
