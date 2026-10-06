import { jpegxlCodec } from '../../src/codecs/jpegxl.ts'
import { JpegXlEncoderMemory } from '../../src/codecs/jpegxl-encoder-memory.ts'
import {
  encodeJpegXlVarDct8,
  encodeJpegXlVarDct8Async,
} from '../../src/codecs/jpegxl-vardct-encode.ts'
import { defaultImageLimits } from '../../src/limits.ts'
import { MemorySource } from '../../src/source.ts'

export const jpegXlLargeBlockPixels = (width = 129, height = 65): Uint8Array => {
  const pixels = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const grain = (Math.imul(x + 1, 1597334677) ^ Math.imul(y + 1, 3812015801)) >>> 0
      const red = 110 + 65 * Math.sin(x / 31) + 30 * Math.cos(y / 19) + (grain % 3) - 1
      const green =
        125 + 50 * Math.sin(x / 47 + y / 37) + 25 * Math.cos(y / 29) + ((grain >>> 8) % 3) - 1
      const blue =
        110 + 55 * Math.cos(x / 43 - y / 23) + 20 * Math.sin(y / 17) + ((grain >>> 16) % 3) - 1
      const offset = (y * width + x) * 4
      pixels[offset] = Math.max(0, Math.min(255, Math.round(red)))
      pixels[offset + 1] = Math.max(0, Math.min(255, Math.round(green)))
      pixels[offset + 2] = Math.max(0, Math.min(255, Math.round(blue)))
      pixels[offset + 3] = 255
    }
  }
  return pixels
}

export const encodeJpegXlLargeBlocks = async (
  width = 129,
  height = 65,
  maxWorkingBytes = 16_777_216,
  progressive = false,
  compressionSearch = true,
  pixels = jpegXlLargeBlockPixels(width, height),
) => {
  const memory = new JpegXlEncoderMemory(maxWorkingBytes)
  let encoded: Uint8Array | undefined
  let ownedPeak = 0
  try {
    const parts = await encodeJpegXlVarDct8Async(
      pixels,
      width,
      height,
      9,
      memory,
      async () => {},
      4,
      7,
      undefined,
      8,
      progressive,
      undefined,
      defaultImageLimits,
      { compressionSearch },
    )
    encoded = new Uint8Array(parts.reduce((sum, part) => sum + part.byteLength, 0))
    let offset = 0
    for (const part of parts) {
      encoded.set(part, offset)
      offset += part.byteLength
    }
    if (memory.liveBytes !== encoded.byteLength)
      throw new Error('Large-block output ownership changed')
    ownedPeak = memory.peakBytes
  } finally {
    memory.close()
  }
  if (memory.liveBytes !== 0 || memory.liveAllocations !== 0)
    throw new Error('Large-block ownership did not close')
  if (!encoded) throw new Error('Large-block output missing')
  return { pixels, encoded, width, height, ownedPeak }
}

export const verifyJpegXlLargeBlocks = async (
  width = 129,
  height = 65,
  maxWorkingBytes = 16_777_216,
  progressive = false,
) => {
  const fixture = await encodeJpegXlLargeBlocks(width, height, maxWorkingBytes, progressive)
  const decoder = await jpegxlCodec.createDecoder?.(
    new MemorySource(fixture.encoded),
    defaultImageLimits,
  )
  if (
    !decoder ||
    decoder.width !== width ||
    decoder.height !== height ||
    decoder.pixelFormat !== 'rgba8'
  )
    throw new Error('Large-block public decoder layout changed')
  let alphaError = 0,
    colorError = 0,
    samples = 0,
    checksum = 2166136261
  for await (const block of decoder.decode()) {
    try {
      for (let y = 0; y < block.height; y++) {
        for (let x = 0; x < block.width; x++) {
          const source = ((block.y + y) * width + block.x + x) * 4
          const target = y * block.stride + x * 4
          for (let channel = 0; channel < 4; channel++) {
            const value = block.data[target + channel] ?? 0
            checksum = Math.imul(checksum ^ value, 16777619) >>> 0
            const difference = Math.abs(value - (fixture.pixels[source + channel] ?? 0))
            if (channel === 3) alphaError = Math.max(alphaError, difference)
            else {
              colorError += difference
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
    bytes: fixture.encoded.length,
    alphaError,
    meanColorError: colorError / samples,
    samples,
    decodedChecksum: checksum,
    ownedPeak: fixture.ownedPeak,
  }
}

export const synchronousJpegXlLargeBlocks = (pixels: Uint8Array, width = 129, height = 65) =>
  encodeJpegXlVarDct8(pixels, width, height, 9, undefined, 4, 7)
