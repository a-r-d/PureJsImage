import { jpegxlCodec } from '../../src/codecs/jpegxl.ts'
import { defaultImageLimits } from '../../src/limits.ts'
import { Uint8ArraySink } from '../../src/sink.ts'
import { MemorySource } from '../../src/source.ts'

export interface JpegXlArtworkOptions {
  readonly width?: number
  readonly height?: number
  readonly depth?: 8 | 16
  readonly alpha?: 'opaque' | 'varying' | 'hidden'
  readonly progressive?: boolean
  readonly maxWorkingBytes?: number
}

export const jpegXlArtworkPixels = (options: JpegXlArtworkOptions = {}) => {
  const width = options.width ?? 513,
    height = options.height ?? 513,
    depth = options.depth ?? 8,
    sampleBytes = depth / 8,
    format: 'rgba8' | 'rgba16' = depth === 8 ? 'rgba8' : 'rgba16'
  const pixels = new Uint8Array(width * height * 4 * sampleBytes)
  const view = new DataView(pixels.buffer)
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const slot = ((x >>> 4) + 3 * (y >>> 4)) & 31
      const alpha =
        options.alpha === undefined || options.alpha === 'opaque'
          ? 255
          : (x + y * 3) % 37 === 0
            ? 0
            : (x + y) % 13 === 0
              ? 91
              : 255
      const offset = (y * width + x) * 4 * sampleBytes
      for (let channel = 0; channel < 4; channel++) {
        const color =
          channel === 0 ? 15 + slot * 7 : channel === 1 ? 240 - slot * 6 : 20 + ((slot * 9) % 200)
        const value = channel === 3 ? alpha : alpha === 0 && options.alpha !== 'hidden' ? 0 : color
        if (depth === 8) view.setUint8(offset + channel, value)
        else view.setUint16(offset + channel * 2, value * 257)
      }
    }
  return { width, height, depth, sampleBytes, format, pixels }
}

export const encodeJpegXlArtwork = async (
  options: JpegXlArtworkOptions = {},
  create = jpegxlCodec.createEncoder,
) => {
  const fixture = jpegXlArtworkPixels(options)
  if (!create) throw new Error('Missing artwork encoder')
  const sink = new Uint8ArraySink()
  const encoder = await create(sink, {
    width: fixture.width,
    height: fixture.height,
    pixelFormat: fixture.format,
    limits: defaultImageLimits,
    options: {
      mode: 'lossy',
      effort: 7,
      distance: 3,
      progressive: options.progressive ?? false,
      maxWorkingBytes: options.maxWorkingBytes ?? 134_217_728,
    },
    colorSemantics: {
      family: 'rgb',
      primaries: 'srgb',
      transfer: { kind: 'srgb' },
      matrix: 'identity',
      range: 'full',
      alpha: 'straight',
      provenance: 'container-signaled',
      renderingIntent: 'relative',
    },
  })
  await encoder.write({
    x: 0,
    y: 0,
    width: fixture.width,
    height: fixture.height,
    stride: fixture.width * 4 * fixture.sampleBytes,
    format: fixture.format,
    data: fixture.pixels,
  })
  await encoder.finish()
  if (
    !('managedPeakBytes' in encoder) ||
    typeof encoder.managedPeakBytes !== 'number' ||
    !('managedLiveBytes' in encoder) ||
    typeof encoder.managedLiveBytes !== 'number' ||
    !('managedLiveAllocations' in encoder) ||
    typeof encoder.managedLiveAllocations !== 'number'
  )
    throw new Error('Missing artwork storage accounting')
  return {
    ...fixture,
    encoded: sink.toUint8Array(),
    ownedPeak: encoder.managedPeakBytes,
    ownedLive: encoder.managedLiveBytes,
    ownedAllocations: encoder.managedLiveAllocations,
  }
}

export const verifyJpegXlArtwork = async (
  options: JpegXlArtworkOptions = {},
  create = jpegxlCodec.createEncoder,
) => {
  const fixture = await encodeJpegXlArtwork(options, create)
  const decoder = await jpegxlCodec.createDecoder?.(
    new MemorySource(fixture.encoded),
    defaultImageLimits,
  )
  if (
    !decoder ||
    decoder.width !== fixture.width ||
    decoder.height !== fixture.height ||
    decoder.pixelFormat !== fixture.format
  )
    throw new Error('Artwork layout changed')
  const decoded = new Uint8Array(fixture.pixels.length)
  for await (const block of decoder.decode()) {
    try {
      for (let y = 0; y < block.height; y++)
        decoded.set(
          block.data.subarray(
            y * block.stride,
            y * block.stride + block.width * 4 * fixture.sampleBytes,
          ),
          ((block.y + y) * fixture.width + block.x) * 4 * fixture.sampleBytes,
        )
    } finally {
      block.release?.()
    }
  }
  let visibleError = 0,
    alphaError = 0,
    hiddenError = 0,
    encodedChecksum = 2166136261,
    decodedChecksum = 2166136261
  const input = new DataView(fixture.pixels.buffer),
    output = new DataView(decoded.buffer)
  for (let offset = 0; offset < decoded.length; offset += 4 * fixture.sampleBytes) {
    const alpha = fixture.depth === 8 ? input.getUint8(offset + 3) : input.getUint16(offset + 6)
    for (let channel = 0; channel < 4; channel++) {
      const at = offset + channel * fixture.sampleBytes
      const source = fixture.depth === 8 ? input.getUint8(at) : input.getUint16(at)
      const sample = fixture.depth === 8 ? output.getUint8(at) : output.getUint16(at)
      if (channel === 3) alphaError = Math.max(alphaError, Math.abs(sample - source))
      else if (alpha > 0) visibleError = Math.max(visibleError, Math.abs(sample - source))
      else hiddenError = Math.max(hiddenError, sample)
    }
  }
  for (const byte of fixture.encoded)
    encodedChecksum = Math.imul(encodedChecksum ^ byte, 16777619) >>> 0
  for (const byte of decoded) decodedChecksum = Math.imul(decodedChecksum ^ byte, 16777619) >>> 0
  return {
    width: fixture.width,
    height: fixture.height,
    bytes: fixture.encoded.length,
    visibleError,
    hiddenError,
    alphaError,
    encodedChecksum,
    decodedChecksum,
    ownedPeak: fixture.ownedPeak,
    ownedLive: fixture.ownedLive,
    ownedAllocations: fixture.ownedAllocations,
  }
}
