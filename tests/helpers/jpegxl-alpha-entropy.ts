import { jpegxlCodec } from '../../src/codecs/jpegxl.ts'
import { defaultImageLimits } from '../../src/limits.ts'
import { Uint8ArraySink } from '../../src/sink.ts'
import { MemorySource } from '../../src/source.ts'

export const encodeJpegXlAlphaEntropyFixture = async (
  depth: 8 | 16,
  progressive: boolean,
  grouped: boolean,
  maxWorkingBytes = 16_777_216,
  pattern: 'levels' | 'binary-bands' = 'levels',
) => {
  const width = grouped ? 257 : 129,
    height = 129,
    sampleBytes = depth / 8,
    maximum = 2 ** depth - 1,
    format = depth === 8 ? 'rgba8' : 'rgba16'
  const pixels = new Uint8Array(width * height * 4 * sampleBytes)
  const input = new DataView(pixels.buffer)
  const alphaLevels = [0, 1, Math.floor(maximum / 2), maximum - 1, maximum]
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const band = (x + y * 3) % 31
      const alpha =
        pattern === 'binary-bands'
          ? (x + ((Math.imul(y + 1, 2654435761) >>> 0) % 67)) % 67 < 33
            ? maximum
            : 0
          : (alphaLevels[Math.floor(band / 7)] ?? maximum)
      for (let channel = 0; channel < 4; channel++) {
        const value = channel === 3 ? alpha : Math.floor(maximum * (0.3 + channel * 0.2))
        const offset = ((y * width + x) * 4 + channel) * sampleBytes
        if (sampleBytes === 1) input.setUint8(offset, value)
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
  if (!encoder) throw new Error('Missing alpha entropy encoder')
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
  const encoded = sink.toUint8Array()
  return { depth, progressive, grouped, width, height, format, sampleBytes, pixels, encoded }
}

export const verifyJpegXlAlphaEntropy = async (
  depth: 8 | 16,
  progressive: boolean,
  grouped: boolean,
  maxWorkingBytes = 16_777_216,
  pattern: 'levels' | 'binary-bands' = 'levels',
) => {
  const { width, height, format, sampleBytes, pixels, encoded } =
    await encodeJpegXlAlphaEntropyFixture(depth, progressive, grouped, maxWorkingBytes, pattern)
  const input = new DataView(pixels.buffer)
  const decodedPixels =
    pattern === 'binary-bands' && depth === 8 ? new Uint8Array(pixels.length) : undefined
  let encodedChecksum = 2166136261,
    decodedChecksum = 2166136261,
    alphaSamples = 0,
    alphaError = 0
  for (const byte of encoded) encodedChecksum = Math.imul(encodedChecksum ^ byte, 16777619) >>> 0
  const decoder = await jpegxlCodec.createDecoder?.(new MemorySource(encoded), defaultImageLimits)
  if (
    !decoder ||
    decoder.pixelFormat !== format ||
    decoder.width !== width ||
    decoder.height !== height
  )
    throw new Error('Alpha fixture layout changed')
  for await (const block of decoder.decode()) {
    try {
      const output = new DataView(block.data.buffer, block.data.byteOffset, block.data.byteLength)
      for (let y = 0; y < block.height; y++) {
        decodedPixels?.set(
          block.data.subarray(y * block.stride, y * block.stride + block.width * 4),
          ((block.y + y) * width + block.x) * 4,
        )
        for (let x = 0; x < block.width; x++) {
          const target = y * block.stride + x * 4 * sampleBytes
          const source = ((block.y + y) * width + block.x + x) * 4 * sampleBytes
          const alpha =
            sampleBytes === 1 ? output.getUint8(target + 3) : output.getUint16(target + 6)
          const expected =
            sampleBytes === 1 ? input.getUint8(source + 3) : input.getUint16(source + 6)
          alphaError = Math.max(alphaError, Math.abs(alpha - expected))
          alphaSamples++
          for (let byte = 0; byte < 4 * sampleBytes; byte++)
            decodedChecksum =
              Math.imul(decodedChecksum ^ (block.data[target + byte] ?? 0), 16777619) >>> 0
        }
      }
    } finally {
      block.release?.()
    }
  }
  return {
    depth,
    progressive,
    grouped,
    bytes: encoded.length,
    encodedChecksum,
    decodedChecksum,
    alphaSamples,
    alphaError,
    ...(decodedPixels ? { decodedPixels: Array.from(decodedPixels) } : {}),
  }
}
