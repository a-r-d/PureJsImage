import { jpegxlCodec } from '../../src/codecs/jpegxl.ts'
import { readJpegXlSourceFrameStructures } from '../../src/codecs/jpegxl-decode.ts'
import { defaultImageLimits } from '../../src/limits.ts'
import { Uint8ArraySink } from '../../src/sink.ts'
import { MemorySource } from '../../src/source.ts'

export const losslessPatchFixture = (
  format: 'rgb8' | 'rgba8' = 'rgba8',
  background: 'pale' | 'flat' = 'pale',
) => {
  const width = 512,
    height = 512,
    channels = format === 'rgba8' ? 4 : 3
  const pixels = new Uint8Array(width * height * channels)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * channels
      for (let channel = 0; channel < 3; channel++)
        pixels[offset + channel] =
          background === 'flat' ? 40 + channel * 32 : 248 + ((x + y + channel) % 8)
      if (channels === 4) pixels[offset + 3] = x > 495 && y < 16 ? 0 : 255
    }
  }
  let state = 0x179bc3d5
  for (let cellY = 0; cellY < 30; cellY++) {
    for (let cellX = 0; cellX < 30; cellX++) {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0
      const style = (state >>> 24) & 31
      for (let y = 0; y < 8; y++) {
        for (let x = 0; x < 8; x++) {
          const offset = ((cellY * 16 + y) * width + cellX * 16 + x) * channels
          for (let channel = 0; channel < 3; channel++)
            pixels[offset + channel] = 20 + ((x * 37 + y * 59 + channel * 71 + style * 13) % 200)
          if (channels === 4)
            pixels[offset + 3] = (x + y) % 3 === 0 ? 0 : (x + y) % 3 === 1 ? 128 : 255
        }
      }
    }
  }
  // One otherwise identical component has a distinct alpha value.
  if (channels === 4) pixels[(16 * width + 16) * channels + 3] = 123
  for (let x = 0; x < width; x++) {
    const offset = ((height - 1) * width + x) * channels
    pixels[offset] = 11
  }
  return { width, height, channels, format, pixels }
}

export const encodeLosslessPatchFixture = async (
  fixture: ReturnType<typeof losslessPatchFixture>,
  maxWorkingBytes?: number,
) => {
  const sink = new Uint8ArraySink()
  const encoder = await jpegxlCodec.createEncoder?.(sink, {
    width: fixture.width,
    height: fixture.height,
    pixelFormat: fixture.format,
    colorSemantics: {
      family: 'rgb',
      primaries: 'srgb',
      transfer: { kind: 'srgb' },
      matrix: 'identity',
      range: 'full',
      alpha: fixture.channels === 4 ? 'straight' : 'none',
      provenance: 'assumed-default',
      renderingIntent: 'relative',
    },
    options: {
      mode: 'lossless',
      effort: 7,
      container: false,
      ...(maxWorkingBytes === undefined ? {} : { maxWorkingBytes }),
    },
    limits: defaultImageLimits,
  })
  if (!encoder) throw new Error('Missing lossless patch encoder')
  await encoder.write({
    x: 0,
    y: 0,
    width: fixture.width,
    height: fixture.height,
    stride: fixture.width * fixture.channels,
    format: fixture.format,
    data: fixture.pixels,
  })
  await encoder.finish()
  if (
    !('managedPeakBytes' in encoder) ||
    typeof encoder.managedPeakBytes !== 'number' ||
    !('managedLiveBytes' in encoder) ||
    typeof encoder.managedLiveBytes !== 'number'
  )
    throw new Error('Missing lossless patch memory diagnostics')
  return {
    encoded: sink.toUint8Array(),
    ownedPeak: encoder.managedPeakBytes,
    ownedLive: encoder.managedLiveBytes,
  }
}

export const verifyLosslessPatchFixture = async (
  format: 'rgb8' | 'rgba8' = 'rgba8',
  background: 'pale' | 'flat' = 'pale',
) => {
  const fixture = losslessPatchFixture(format, background)
  const original = Uint8Array.from(fixture.pixels)
  const result = await encodeLosslessPatchFixture(fixture)
  if (result.ownedLive !== 0) throw new Error('Lossless patch storage did not unwind')
  const frames = await readJpegXlSourceFrameStructures(
    new MemorySource(result.encoded),
    defaultImageLimits,
  )
  if (
    frames.length !== 2 ||
    frames[0]?.frameType !== 'reference' ||
    frames[1]?.frameType !== 'regular' ||
    frames[1]?.frameFlags !== 2
  )
    throw new Error('Lossless patch fixture did not select a reference frame')
  const decoder = await jpegxlCodec.createDecoder?.(
    new MemorySource(result.encoded),
    defaultImageLimits,
  )
  if (!decoder) throw new Error('Missing lossless patch decoder')
  const rowBytes = fixture.width * fixture.channels
  let rows = 0
  for await (const block of decoder.decode()) {
    try {
      if (block.format !== fixture.format) throw new Error('Lossless patch sample format changed')
      for (let y = 0; y < block.height; y++) {
        for (let byte = 0; byte < rowBytes; byte++) {
          const offset = (block.y + y) * rowBytes + byte
          if (block.data[y * block.stride + byte] !== fixture.pixels[offset])
            throw new Error(`Lossless patch sample changed at ${offset}`)
        }
        rows++
      }
    } finally {
      block.release?.()
    }
  }
  if (rows !== fixture.height) throw new Error('Incomplete lossless patch output')
  for (let offset = 0; offset < original.length; offset++)
    if (original[offset] !== fixture.pixels[offset]) throw new Error('Encoder modified input')
  let checksum = 0x811c9dc5
  for (const byte of result.encoded) checksum = Math.imul(checksum ^ byte, 0x01000193) >>> 0
  return {
    format,
    samples: fixture.pixels.length,
    bytes: result.encoded.length,
    checksum,
    ownedLive: result.ownedLive,
    frames: frames.map((frame) => [frame.frameType, frame.encoding, frame.frameFlags]),
  }
}
