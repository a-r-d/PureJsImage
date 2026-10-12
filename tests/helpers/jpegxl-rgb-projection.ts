import { jpegxlCodec } from '../../src/codecs/jpegxl.ts'
import { defaultImageLimits } from '../../src/limits.ts'
import { Uint8ArraySink } from '../../src/sink.ts'
import { MemorySource } from '../../src/source.ts'

const width = 96,
  height = 80,
  budget = 950_000
type Format = 'rgb8' | 'rgba8'
const require = (condition: boolean, message: string): void => {
  if (!condition) throw new Error(message)
}
const requireEqual = (a: Uint8Array, b: Uint8Array, message: string): void => {
  require(a.length === b.length, message)
  for (let i = 0; i < a.length; i++) require(a[i] === b[i], message)
}
const encode = async (pixels: Uint8Array, format: Format, distance: number, bounded: boolean) => {
  const before = pixels.slice(),
    channels = format === 'rgba8' ? 4 : 3,
    sink = new Uint8ArraySink()
  const encoder = await jpegxlCodec.createEncoder?.(sink, {
    width,
    height,
    pixelFormat: format,
    limits: defaultImageLimits,
    colorSemantics: {
      family: 'rgb',
      primaries: 'srgb',
      transfer: { kind: 'srgb' },
      matrix: 'identity',
      range: 'full',
      alpha: format === 'rgba8' ? 'straight' : 'none',
      provenance: 'container-signaled',
      renderingIntent: 'relative',
    },
    options: {
      mode: 'lossy',
      effort: 7,
      distance,
      container: false,
      ...(bounded ? { maxWorkingBytes: budget } : {}),
    },
  })
  if (!encoder) throw new Error('Missing projection encoder')
  await encoder.write({ x: 0, y: 0, width, height, stride: width * channels, format, data: pixels })
  await encoder.finish()
  requireEqual(pixels, before, 'Projection changed caller pixels')
  if (!('managedPeakBytes' in encoder) || typeof encoder.managedPeakBytes !== 'number')
    throw new Error('Missing managed peak')
  require(encoder.managedPeakBytes <= budget, 'Projection exceeded the regression budget')
  require('managedLiveBytes' in encoder && encoder.managedLiveBytes === 0, 'Retained bytes')
  require('managedLiveAllocations' in encoder &&
    encoder.managedLiveAllocations === 0, 'Retained allocations')
  return { bytes: sink.toUint8Array(), peak: encoder.managedPeakBytes }
}
const decodeColor = async (bytes: Uint8Array) => {
  const decoder = await jpegxlCodec.createDecoder?.(new MemorySource(bytes), defaultImageLimits)
  if (!decoder || (decoder.pixelFormat !== 'rgb8' && decoder.pixelFormat !== 'rgba8'))
    throw new Error('Missing projection decoder')
  require(decoder.width === width && decoder.height === height, 'Projection changed dimensions')
  const channels = decoder.pixelFormat === 'rgba8' ? 4 : 3,
    color = new Uint8Array(width * height * 3),
    visited = new Uint8Array(width * height)
  let count = 0
  for await (const block of decoder.decode()) {
    try {
      require(block.x >= 0 &&
        block.y >= 0 &&
        block.x + block.width <= width &&
        block.y + block.height <= height, 'Invalid projection block')
      require(block.stride >= block.width * channels &&
        block.data.length >=
          (block.height - 1) * block.stride + block.width * channels, 'Truncated projection block')
      for (let y = 0; y < block.height; y++)
        for (let x = 0; x < block.width; x++) {
          const pixel = (block.y + y) * width + block.x + x,
            at = y * block.stride + x * channels
          require(visited[pixel] === 0, 'Repeated projection pixel')
          visited[pixel] = 1
          count++
          for (let channel = 0; channel < 3; channel++) {
            const value = block.data[at + channel]
            if (value === undefined) throw new Error('Missing projection color')
            color[pixel * 3 + channel] = value
          }
          if (channels === 4) require(block.data[at + 3] === 255, 'Projection changed opaque alpha')
        }
    } finally {
      block.release?.()
    }
  }
  require(count === visited.length, 'Incomplete projection coverage')
  return color
}

export const verifyJpegXlRgbProjection = async () => {
  const rgb = new Uint8Array(width * height * 3),
    rgba = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const pixel = y * width + x,
        grain = (Math.imul(x + 1, 1597334677) ^ Math.imul(y + 1, 3812015801)) >>> 28,
        value = (x + y + grain) & 255
      rgb.fill(value, pixel * 3, pixel * 3 + 3)
      rgba.fill(value, pixel * 4, pixel * 4 + 3)
      rgba[pixel * 4 + 3] = 255
    }
  const rows = []
  for (const distance of [0.45, 3, 7.5]) {
    const a = await encode(rgb, 'rgb8', distance, false),
      b = await encode(rgba, 'rgba8', distance, false),
      bounded = await encode(rgba, 'rgba8', distance, true)
    requireEqual(b.bytes, bounded.bytes, 'Managed budget changed the emitted stream')
    const color = await decodeColor(a.bytes)
    requireEqual(color, await decodeColor(b.bytes), 'RGB/RGBA projection colors differ')
    requireEqual(color, await decodeColor(bounded.bytes), 'Bounded projection colors differ')
    let checksum = 2166136261
    for (const byte of b.bytes) checksum = Math.imul(checksum ^ byte, 16777619) >>> 0
    rows.push({
      distance,
      bytes: b.bytes.length,
      checksum,
      rgbPeak: a.peak,
      rgbaPeak: b.peak,
      budget,
      alphaExact: true,
      callerUnchanged: true,
    })
  }
  return rows
}
