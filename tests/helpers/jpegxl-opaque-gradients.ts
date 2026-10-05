import { jpegxlCodec } from '../../src/codecs/jpegxl.ts'
import { JpegXlEncoderMemory } from '../../src/codecs/jpegxl-encoder-memory.ts'
import { encodeJpegXlVarDct8Async } from '../../src/codecs/jpegxl-vardct-encode.ts'
import { defaultImageLimits } from '../../src/limits.ts'
import { Uint8ArraySink } from '../../src/sink.ts'
import { MemorySource } from '../../src/source.ts'

export const verifyOpaqueJpegXlGradient = async (progressive: boolean, partialAlpha = false) => {
  const width = 129,
    height = 65
  const pixels = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 4
      const grain = (Math.imul(x + 1, 1597334677) ^ Math.imul(y + 1, 3812015801)) >>> 0
      pixels[offset] = Math.round(180 + x / 4) + (grain % 3) - 1
      pixels[offset + 1] = Math.round(90 + y / 4) + ((grain >>> 8) % 3) - 1
      pixels[offset + 2] = Math.round(140 + x / 8 + y / 8) + ((grain >>> 16) % 3) - 1
      pixels[offset + 3] = 255
    }
  }
  if (partialAlpha) pixels[pixels.length - 1] = 254
  const memory = new JpegXlEncoderMemory(16_777_216)
  const sink = new Uint8ArraySink()
  try {
    const parts = await encodeJpegXlVarDct8Async(
      pixels,
      width,
      height,
      3,
      memory,
      async () => {},
      4,
      7,
      undefined,
      8,
      progressive,
    )
    for (const part of parts) await sink.write(part)
  } finally {
    memory.close()
  }
  const encoded = sink.toUint8Array()
  let encodedChecksum = 2166136261
  for (const value of encoded) encodedChecksum = Math.imul(encodedChecksum ^ value, 16777619) >>> 0
  const decoder = await jpegxlCodec.createDecoder?.(new MemorySource(encoded), defaultImageLimits)
  if (!decoder || decoder.pixelFormat !== 'rgba8') throw new Error('Missing RGBA JPEG XL decoder')
  let colorError = 0,
    alphaError = 0,
    decodedChecksum = 2166136261,
    samples = 0
  for await (const block of decoder.decode()) {
    try {
      for (let y = 0; y < block.height; y++) {
        for (let x = 0; x < block.width; x++) {
          const source = ((block.y + y) * width + block.x + x) * 4
          const decoded = y * block.stride + x * 4
          alphaError = Math.max(
            alphaError,
            Math.abs((block.data[decoded + 3] ?? 0) - (pixels[source + 3] ?? 0)),
          )
          for (let channel = 0; channel < 4; channel++) {
            const value = block.data[decoded + channel] ?? 0
            decodedChecksum = Math.imul(decodedChecksum ^ value, 16777619) >>> 0
            if (channel < 3) {
              colorError += Math.abs(value - (pixels[source + channel] ?? 0))
              samples++
            }
          }
        }
      }
    } finally {
      block.release?.()
    }
  }
  return {
    bytes: encoded.length,
    encodedChecksum,
    decodedChecksum,
    meanColorError: colorError / samples,
    alphaError,
    samples,
    liveBytes: memory.liveBytes,
  }
}
