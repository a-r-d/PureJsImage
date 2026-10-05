import { jpegxlCodec } from '../../src/codecs/jpegxl.ts'
import { defaultImageLimits } from '../../src/limits.ts'
import { Uint8ArraySink } from '../../src/sink.ts'
import { MemorySource } from '../../src/source.ts'

export const encodeJpegXlFamilyContextFixture = async (
  depth: 8 | 16,
  progressive: boolean,
  opaque: boolean,
  maxWorkingBytes = 33_554_432,
) => {
  const width = 513,
    height = 257,
    sampleBytes = depth / 8,
    maximum = 2 ** depth - 1,
    format = depth === 8 ? 'rgba8' : 'rgba16'
  const pixels = new Uint8Array(width * height * 4 * sampleBytes)
  const view = new DataView(pixels.buffer)
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const pattern = ((x >>> 3) + (y >>> 3)) & 3
      const variation =
        pattern === 0
          ? (x & 7) * 3 + (y & 7) * 5 - 28
          : pattern === 1
            ? (x & 7) < 4
              ? -24
              : 24
            : pattern === 2
              ? (y & 7) < 4
                ? -29
                : 29
              : (x & 7) === 3 && (y & 7) === 3
                ? 40
                : 0
      const alpha = opaque
        ? maximum
        : (x + y * 13) % 43 === 0
          ? 0
          : (x + y) % 11 === 0
            ? Math.floor(maximum / 2)
            : maximum
      for (let channel = 0; channel < 4; channel++) {
        const color =
          72 + channel * 32 + variation + (((x >>> 3) * 17 + (y >>> 3) * 11 + channel * 13) % 39)
        const value = channel === 3 ? alpha : color * (depth === 8 ? 1 : 257)
        const offset = ((y * width + x) * 4 + channel) * sampleBytes
        if (depth === 8) view.setUint8(offset, value)
        else view.setUint16(offset, value)
      }
    }
  const sink = new Uint8ArraySink()
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
      alpha: 'straight',
      provenance: 'assumed-default',
      renderingIntent: 'relative',
    },
    options: { mode: 'lossy', effort: 7, distance: 3, progressive, maxWorkingBytes },
  })
  if (!encoder) throw new Error('Missing family-context encoder')
  await encoder.write({
    x: 0,
    y: 0,
    width,
    height,
    stride: width * 4 * sampleBytes,
    format,
    data: pixels,
  })
  await encoder.finish()
  return {
    depth,
    progressive,
    opaque,
    width,
    height,
    sampleBytes,
    format,
    pixels,
    encoded: sink.toUint8Array(),
  }
}

export const verifyJpegXlFamilyContexts = async (
  depth: 8 | 16,
  progressive: boolean,
  opaque: boolean,
  maxWorkingBytes = 33_554_432,
) => {
  const fixture = await encodeJpegXlFamilyContextFixture(
    depth,
    progressive,
    opaque,
    maxWorkingBytes,
  )
  const { width, height, sampleBytes, format, pixels, encoded } = fixture
  const decoder = await jpegxlCodec.createDecoder?.(new MemorySource(encoded), defaultImageLimits)
  if (
    !decoder ||
    decoder.width !== width ||
    decoder.height !== height ||
    decoder.pixelFormat !== format
  )
    throw new Error('Family-context fixture layout changed')
  const input = new DataView(pixels.buffer)
  const grid = new Uint8Array(pixels.length)
  let alphaError = 0,
    alphaSamples = 0,
    encodedChecksum = 2166136261,
    decodedChecksum = 2166136261
  for (const byte of encoded) encodedChecksum = Math.imul(encodedChecksum ^ byte, 16777619) >>> 0
  for await (const block of decoder.decode()) {
    try {
      const output = new DataView(block.data.buffer, block.data.byteOffset, block.data.byteLength)
      for (let y = 0; y < block.height; y++) {
        const row = ((block.y + y) * width + block.x) * 4 * sampleBytes
        grid.set(
          block.data.subarray(y * block.stride, y * block.stride + block.width * 4 * sampleBytes),
          row,
        )
        for (let x = 0; x < block.width; x++) {
          const target = y * block.stride + x * 4 * sampleBytes + 3 * sampleBytes
          const source = row + (x * 4 + 3) * sampleBytes
          const actual = depth === 8 ? output.getUint8(target) : output.getUint16(target)
          const expected = depth === 8 ? input.getUint8(source) : input.getUint16(source)
          alphaError = Math.max(alphaError, Math.abs(actual - expected))
          alphaSamples++
        }
      }
    } finally {
      block.release?.()
    }
  }
  for (const byte of grid) decodedChecksum = Math.imul(decodedChecksum ^ byte, 16777619) >>> 0
  return {
    depth,
    progressive,
    opaque,
    bytes: encoded.length,
    encodedChecksum,
    decodedChecksum,
    alphaError,
    alphaSamples,
  }
}
