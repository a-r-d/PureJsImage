import { jpegxlCodec } from '../../src/codecs/jpegxl.ts'
import { defaultImageLimits } from '../../src/limits.ts'
import { Uint8ArraySink } from '../../src/sink.ts'
import { MemorySource } from '../../src/source.ts'

export const encodeJpegXlCoefficientOrderFixture = async (
  depth: 8 | 16,
  progressive: boolean,
  opaque: boolean,
  maxWorkingBytes = 16_777_216,
) => {
  const width = 513,
    height = 129,
    sampleBytes = depth / 8,
    maximum = 2 ** depth - 1,
    format = depth === 8 ? 'rgba8' : 'rgba16'
  const pixels = new Uint8Array(width * height * 4 * sampleBytes)
  const input = new DataView(pixels.buffer)
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const wave = Math.round(
        34 * Math.sin((((y & 7) + 0.5) * 3 * Math.PI) / 8) +
          18 * Math.sin((((x & 7) + 0.5) * Math.PI) / 8),
      )
      const alpha = opaque
        ? maximum
        : (x + y * 13) % 43 === 0
          ? 0
          : (x + y) % 11 === 0
            ? Math.floor(maximum / 2)
            : maximum
      for (let channel = 0; channel < 4; channel++) {
        const color =
          84 + channel * 22 + wave + (((x >>> 3) * 7 + (y >>> 3) * 11 + channel * x) % 47)
        const value = channel === 3 ? alpha : color * (depth === 8 ? 1 : 257)
        const offset = ((y * width + x) * 4 + channel) * sampleBytes
        if (depth === 8) input.setUint8(offset, value)
        else input.setUint16(offset, value)
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
  if (!encoder) throw new Error('Missing coefficient-order encoder')
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
    format,
    sampleBytes,
    pixels,
    encoded: sink.toUint8Array(),
  }
}

export const verifyJpegXlCoefficientOrders = async (
  depth: 8 | 16,
  progressive: boolean,
  opaque: boolean,
  maxWorkingBytes = 16_777_216,
) => {
  const fixture = await encodeJpegXlCoefficientOrderFixture(
    depth,
    progressive,
    opaque,
    maxWorkingBytes,
  )
  const { width, height, format, sampleBytes, pixels, encoded } = fixture
  const decoder = await jpegxlCodec.createDecoder?.(new MemorySource(encoded), defaultImageLimits)
  if (
    !decoder ||
    decoder.width !== width ||
    decoder.height !== height ||
    decoder.pixelFormat !== format
  )
    throw new Error('Coefficient-order fixture layout changed')
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
