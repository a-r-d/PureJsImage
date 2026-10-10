import { inspectJpegXlStructure, jpegxlCodec } from '../../src/codecs/jpegxl.ts'
import { JpegXlCodestreamSource } from '../../src/codecs/jpegxl-container.ts'
import { readJpegXlSourceFrameStructures } from '../../src/codecs/jpegxl-decode.ts'
import { JpegXlEncoderMemory } from '../../src/codecs/jpegxl-encoder-memory.ts'
import { resolveJpegXlLimits } from '../../src/codecs/jpegxl-limits.ts'
import { limitExceeded } from '../../src/errors.ts'
import { defaultImageLimits } from '../../src/limits.ts'
import { Uint8ArraySink } from '../../src/sink.ts'
import { MemorySource } from '../../src/source.ts'
import { jpegXlArtworkPixels } from './jpegxl-artwork.ts'

type Format = 'rgb8' | 'rgba8'
type Owned =
  | Uint8Array<ArrayBuffer>
  | Uint16Array<ArrayBuffer>
  | Uint32Array<ArrayBuffer>
  | Int8Array<ArrayBuffer>
  | Int16Array<ArrayBuffer>
  | Int32Array<ArrayBuffer>
  | Float32Array<ArrayBuffer>
  | Float64Array<ArrayBuffer>
const budget = 268_435_456
const require = (condition: boolean, message: string): void => {
  if (!condition) throw new Error(message)
}
const checksum = (bytes: Uint8Array): number => {
  let value = 2166136261
  for (const byte of bytes) value = Math.imul(value ^ byte, 16777619) >>> 0
  return value
}
const encode = async (
  pixels: Uint8Array,
  width: number,
  height: number,
  format: Format,
  container: boolean,
  signal?: AbortSignal,
) => {
  const before = pixels.slice(),
    sink = new Uint8ArraySink(),
    channels = format === 'rgb8' ? 3 : 4
  const encoder = await jpegxlCodec.createEncoder?.(sink, {
    width,
    height,
    pixelFormat: format,
    limits: defaultImageLimits,
    ...(signal ? { signal } : {}),
    colorSemantics: {
      family: 'rgb',
      primaries: 'srgb',
      transfer: { kind: 'srgb' },
      matrix: 'identity',
      range: 'full',
      alpha: format === 'rgb8' ? 'none' : 'straight',
      provenance: 'assumed-default',
      renderingIntent: 'relative',
    },
    options: { mode: 'lossy', effort: 7, distance: 3, container, maxWorkingBytes: budget },
  })
  if (!encoder) throw new Error('Missing public palette encoder')
  try {
    await encoder.write({
      x: 0,
      y: 0,
      width,
      height,
      stride: width * channels,
      format,
      data: pixels,
    })
    await encoder.finish()
  } finally {
    for (let i = 0; i < pixels.length; i++)
      require(pixels[i] === before[i], 'Caller palette pixels changed')
    require('managedLiveBytes' in encoder &&
      encoder.managedLiveBytes === 0, 'Encoder retained bytes')
    require('managedLiveAllocations' in encoder &&
      encoder.managedLiveAllocations === 0, 'Encoder retained allocations')
    require('managedPeakBytes' in encoder &&
      typeof encoder.managedPeakBytes === 'number' &&
      encoder.managedPeakBytes <= budget, 'Encoder exceeded admitted storage')
  }
  return sink.toUint8Array()
}
const inspect = async (
  bytes: Uint8Array,
  pixels: Uint8Array,
  width: number,
  height: number,
  format: Format,
) => {
  const source = new MemorySource(bytes)
  const structure = await inspectJpegXlStructure(source, { jpegXlLimits: resolveJpegXlLimits() })
  const frames = await readJpegXlSourceFrameStructures(
    new JpegXlCodestreamSource(source, structure),
    defaultImageLimits,
  )
  const decoder = await jpegxlCodec.createDecoder?.(source, defaultImageLimits)
  if (!decoder || (decoder.pixelFormat !== 'rgb8' && decoder.pixelFormat !== 'rgba8'))
    throw new Error('Missing color decoder')
  require(decoder.width === width && decoder.height === height, 'Palette dimensions changed')
  const outChannels = decoder.pixelFormat === 'rgba8' ? 4 : 3,
    inputChannels = format === 'rgba8' ? 4 : 3
  if (inputChannels === 4) require(outChannels === 4, 'RGBA palette lost alpha')
  const visited = new Uint8Array(width * height),
    color = new Uint8Array(width * height * 3)
  let count = 0,
    maximumColorError = 0,
    maximumAlphaError = 0
  for await (const block of decoder.decode())
    try {
      require(block.x >= 0 &&
        block.y >= 0 &&
        block.x + block.width <= width &&
        block.y + block.height <= height, 'Decoded block out of bounds')
      require(block.stride >= block.width * outChannels &&
        block.data.length >=
          (block.height - 1) * block.stride +
            block.width * outChannels, 'Truncated decoded palette block')
      for (let y = 0; y < block.height; y++)
        for (let x = 0; x < block.width; x++) {
          const p = (block.y + y) * width + block.x + x,
            at = y * block.stride + x * outChannels
          require(visited[p] === 0, 'Repeated decoded pixel')
          visited[p] = 1
          count++
          for (let c = 0; c < 3; c++) {
            const value = block.data[at + c],
              original = pixels[p * inputChannels + c]
            if (value === undefined || original === undefined)
              throw new Error('Missing color sample')
            color[p * 3 + c] = value
            maximumColorError = Math.max(maximumColorError, Math.abs(value - original))
          }
          maximumAlphaError = Math.max(
            maximumAlphaError,
            Math.abs(
              (outChannels === 4 ? (block.data[at + 3] ?? 0) : 255) -
                (inputChannels === 4 ? (pixels[p * inputChannels + 3] ?? 0) : 255),
            ),
          )
        }
    } finally {
      block.release?.()
    }
  require(count === width * height, 'Incomplete palette pixel coverage')
  require(maximumAlphaError === 0, 'Palette alpha changed')
  return {
    envelope: structure.kind,
    encoding: frames.at(-1)?.encoding,
    bytes: bytes.length,
    encodedChecksum: checksum(bytes),
    colorChecksum: checksum(color),
    maximumColorError,
    maximumAlphaError,
    pixels: count,
    ownedLive: 0,
    callerIntact: true,
  }
}

export const verifyJpegXlPalettePublic = async () => {
  const f = jpegXlArtworkPixels({ width: 257, height: 257 }),
    rgb = new Uint8Array(f.width * f.height * 3)
  for (let p = 0; p < f.width * f.height; p++)
    for (let c = 0; c < 3; c++) rgb[p * 3 + c] = f.pixels[p * 4 + c] ?? 0
  const rawRgb = await inspect(
    await encode(rgb, f.width, f.height, 'rgb8', false),
    rgb,
    f.width,
    f.height,
    'rgb8',
  )
  const containerRgba = await inspect(
    await encode(f.pixels, f.width, f.height, 'rgba8', true),
    f.pixels,
    f.width,
    f.height,
    'rgba8',
  )
  require(rawRgb.envelope === 'raw-codestream' &&
    containerRgba.envelope === 'container', 'Wrong palette envelopes')
  require(rawRgb.encoding === 'modular' &&
    containerRgba.encoding === 'modular', 'Exact artwork winner changed')
  require(rawRgb.maximumColorError === 0 &&
    containerRgba.maximumColorError === 0, 'Exact artwork colors changed')
  require(rawRgb.colorChecksum === containerRgba.colorChecksum, 'RGB/RGBA palette colors differ')

  const small = jpegXlArtworkPixels({ width: 65, height: 65 }),
    original = JpegXlEncoderMemory.prototype.allocate
  let refused = 0
  JpegXlEncoderMemory.prototype.allocate = function <T extends Owned>(
    this: JpegXlEncoderMemory,
    type: { new (length: number): T; readonly BYTES_PER_ELEMENT: number },
    length: number,
    scope = this.currentScope,
  ): T {
    if (Object.is(type, Uint8Array) && length === small.width * small.height * 3) {
      refused++
      throw limitExceeded('Refused optional canonical RGB copy')
    }
    return (original<T>).call(this, type, length, scope)
  }
  let fallback: Awaited<ReturnType<typeof inspect>>
  try {
    fallback = await inspect(
      await encode(small.pixels, small.width, small.height, 'rgba8', false),
      small.pixels,
      small.width,
      small.height,
      'rgba8',
    )
    require(refused > 0, 'Canonical RGB LIMIT path was not reached')
    require(fallback.maximumColorError <= 16, 'Optional palette fallback exceeded its color bound')
  } finally {
    JpegXlEncoderMemory.prototype.allocate = original
  }

  const controller = new AbortController()
  let allocated = 0,
    cancelled = false
  JpegXlEncoderMemory.prototype.allocate = function <T extends Owned>(
    this: JpegXlEncoderMemory,
    type: { new (length: number): T; readonly BYTES_PER_ELEMENT: number },
    length: number,
    scope = this.currentScope,
  ): T {
    const result = (original<T>).call(this, type, length, scope)
    if (Object.is(type, Uint8Array) && length === small.width * small.height * 3) {
      allocated++
      controller.abort()
    }
    return result
  }
  try {
    try {
      await encode(small.pixels, small.width, small.height, 'rgba8', false, controller.signal)
    } catch (error: unknown) {
      if (!(error instanceof Error) || error.name !== 'AbortError') throw error
      cancelled = true
    }
    require(allocated > 0 && cancelled, 'Real-copy cancellation was not observed')
  } finally {
    JpegXlEncoderMemory.prototype.allocate = original
  }
  return {
    rawRgb,
    containerRgba,
    fallback,
    refused,
    cancellation: { allocated, abortError: cancelled, ownedLive: 0, callerIntact: true },
  }
}
