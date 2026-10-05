import { jpegxlCodec } from '../../src/codecs/jpegxl.ts'
import { defaultImageLimits } from '../../src/limits.ts'
import { Uint8ArraySink } from '../../src/sink.ts'
import { MemorySource } from '../../src/source.ts'

export interface LearnedPaletteOptions {
  readonly depth?: 8 | 16
  readonly channels?: 3 | 4
  readonly width?: 191 | 1025
  readonly effort?: 5 | 7
  readonly maxWorkingBytes?: number
}

export const learnedPalettePixels = (options: LearnedPaletteOptions = {}) => {
  const width = options.width ?? 191,
    height = 109,
    depth = options.depth ?? 8,
    channels = options.channels ?? 3,
    sampleBytes = depth / 8,
    format: 'rgb8' | 'rgb16' | 'rgba8' | 'rgba16' =
      channels === 3 ? (depth === 8 ? 'rgb8' : 'rgb16') : depth === 8 ? 'rgba8' : 'rgba16'
  const pixels = new Uint8Array(width * height * channels * sampleBytes)
  const view = new DataView(pixels.buffer)
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const tone =
        y === 0
          ? (x * 73) % 251
          : Math.max(
              0,
              Math.min(
                250,
                Math.round(120 + 96 * Math.sin(x / 13 + y / 9) + 25 * Math.cos((x - y) / 7)),
              ),
            )
      for (let channel = 0; channel < channels; channel++) {
        const value =
          channel === 3
            ? tone % 3 === 0
              ? 0
              : tone % 3 === 1
                ? 128
                : 255
            : channel === 0
              ? tone
              : channel === 1
                ? (tone * 71) % 251
                : (tone * 113) % 251
        const offset = ((y * width + x) * channels + channel) * sampleBytes
        if (depth === 8) view.setUint8(offset, value)
        else view.setUint16(offset, value * 257)
      }
    }
  return { width, height, depth, channels, sampleBytes, format, pixels }
}

const checksum = (bytes: Uint8Array): number => {
  let value = 0x811c9dc5
  for (const byte of bytes) value = Math.imul(value ^ byte, 0x01000193) >>> 0
  return value
}

export const verifyLearnedPalette = async (options: LearnedPaletteOptions = {}) => {
  const fixture = learnedPalettePixels(options),
    inputChecksum = checksum(fixture.pixels),
    sink = new Uint8ArraySink()
  const encoder = await jpegxlCodec.createEncoder?.(sink, {
    width: fixture.width,
    height: fixture.height,
    pixelFormat: fixture.format,
    limits: defaultImageLimits,
    options: {
      mode: 'lossless',
      effort: options.effort ?? 7,
      ...(options.maxWorkingBytes === undefined
        ? {}
        : { maxWorkingBytes: options.maxWorkingBytes }),
    },
    colorSemantics: {
      family: 'rgb',
      primaries: 'srgb',
      transfer: { kind: 'srgb' },
      matrix: 'identity',
      range: 'full',
      alpha: fixture.channels === 4 ? 'straight' : 'none',
      provenance: 'container-signaled',
      renderingIntent: 'relative',
    },
  })
  if (!encoder) throw new Error('Missing learned palette encoder')
  await encoder.write({
    x: 0,
    y: 0,
    width: fixture.width,
    height: fixture.height,
    stride: fixture.width * fixture.channels * fixture.sampleBytes,
    format: fixture.format,
    data: fixture.pixels,
  })
  await encoder.finish()
  if (
    !('managedPeakBytes' in encoder) ||
    typeof encoder.managedPeakBytes !== 'number' ||
    !('managedLiveBytes' in encoder) ||
    encoder.managedLiveBytes !== 0 ||
    !('managedLiveAllocations' in encoder) ||
    encoder.managedLiveAllocations !== 0
  )
    throw new Error('Missing or leaked learned palette storage')
  if (checksum(fixture.pixels) !== inputChecksum) throw new Error('Palette encoder changed input')
  const encoded = sink.toUint8Array(),
    decoder = await jpegxlCodec.createDecoder?.(new MemorySource(encoded), defaultImageLimits)
  if (
    !decoder ||
    decoder.width !== fixture.width ||
    decoder.height !== fixture.height ||
    decoder.pixelFormat !== fixture.format
  )
    throw new Error('Learned palette layout changed')
  const decoded = new Uint8Array(fixture.pixels.length)
  const rowBytes = fixture.width * fixture.channels * fixture.sampleBytes
  let rows = 0
  for await (const block of decoder.decode()) {
    try {
      if (block.format !== fixture.format) throw new Error('Learned palette sample format changed')
      for (let y = 0; y < block.height; y++) {
        const offset = (block.y + y) * rowBytes
        for (let byte = 0; byte < rowBytes; byte++) {
          const value = block.data[y * block.stride + byte]
          if (value === undefined || value !== fixture.pixels[offset + byte])
            throw new Error(`Learned palette sample changed at row ${block.y + y}, byte ${byte}`)
          decoded[offset + byte] = value
        }
        rows++
      }
    } finally {
      block.release?.()
    }
  }
  if (rows !== fixture.height) throw new Error('Learned palette rows are incomplete')
  return {
    width: fixture.width,
    depth: fixture.depth,
    channels: fixture.channels,
    bytes: encoded.length,
    encodedChecksum: checksum(encoded),
    decodedChecksum: checksum(decoded),
    inputChecksum,
    samples: fixture.width * fixture.height * fixture.channels,
    ownedPeak: encoder.managedPeakBytes,
    ownedLive: encoder.managedLiveBytes,
    ownedAllocations: encoder.managedLiveAllocations,
  }
}
