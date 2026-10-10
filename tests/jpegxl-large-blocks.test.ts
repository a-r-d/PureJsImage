import { describe, expect, it } from 'vitest'
import { JpegXlEncoderMemory } from '../src/codecs/jpegxl-encoder-memory.ts'
import { encodeJpegXlVarDct8Async } from '../src/codecs/jpegxl-vardct-encode.ts'
import { defaultImageLimits } from '../src/limits.ts'
import {
  encodeJpegXlLargeBlocks,
  jpegXlLargeBlockPixels,
  synchronousJpegXlLargeBlocks,
  verifyJpegXlLargeBlocks,
} from './helpers/jpegxl-large-blocks.ts'

describe('JPEG XL larger photo transforms', () => {
  for (const [width, height, previousBytes, checksum] of [
    // Shared photo quantization changes the digest while preserving the original error bound.
    [129, 65, 681, 812191697],
    // The same shared photo policy covers the larger partial group.
    [257, 129, 1721, 717277342],
    // Geometry admission restores standalone strip precision and the valid 2x2 transform.
    [2065, 17, 2455, 826275486],
    // The transposed strip uses the same geometry rule and precision.
    [17, 2065, 2768, 3492195716],
  ] as const) {
    it(`keeps exact alpha and bounded color error across partial groups at ${width}x${height}`, async () => {
      const result = await verifyJpegXlLargeBlocks(width, height)
      // Complete native/Rust grids agree within one code value, with exact alpha.
      expect(result.bytes).toBeLessThan(previousBytes)
      expect(result.alphaError).toBe(0)
      expect(result.meanColorError).toBeLessThan(1.5)
      expect(result.decodedChecksum).toBe(checksum)
      expect(result.samples).toBe(width * height * 3)
      expect(result.ownedPeak).toBeLessThanOrEqual(16_777_216)
    })
  }

  it('recovers the exact preceding stream at the original working budget', async () => {
    const limited = await encodeJpegXlLargeBlocks(129, 65, 797_262)
    const preceding = await encodeJpegXlLargeBlocks(129, 65, 797_262, false, false)
    expect(limited.encoded).toEqual(preceding.encoded)
    // Shared fallback precision changes output; removing dead scratch lowers its exact peak.
    expect(limited.encoded.length).toBe(606)
    expect(limited.ownedPeak).toBe(797198)
    const decoded = await verifyJpegXlLargeBlocks(129, 65, 797_262)
    expect(decoded.decodedChecksum).toBe(3711444055)
    expect(decoded.alphaError).toBe(0)
  })

  it('rejects the insufficient budget with closed ownership', async () => {
    const pixels = jpegXlLargeBlockPixels()
    const before = pixels.slice()
    // Removing 64 bytes of scratch moved this adjacent failure boundary down by 64 bytes.
    const memory = new JpegXlEncoderMemory(797_197)
    await expect(
      encodeJpegXlVarDct8Async(pixels, 129, 65, 9, memory, async () => {}, 4, 7),
    ).rejects.toMatchObject({ code: 'LIMIT_EXCEEDED' })
    expect(pixels).toEqual(before)
    expect(memory.liveBytes).toBe(0)
    expect(memory.liveAllocations).toBe(0)
    memory.close()
  })

  it('retains the previous progressive stream and decoded pixels', async () => {
    const current = await encodeJpegXlLargeBlocks(257, 129, 16_777_216, true)
    const preceding = await encodeJpegXlLargeBlocks(257, 129, 16_777_216, true, false)
    expect(current.encoded).toEqual(preceding.encoded)
    // Progressive filtering and luminance refinement restore this independently verified preceding stream.
    expect(current.encoded.length).toBe(1939)
    const decoded = await verifyJpegXlLargeBlocks(257, 129, 16_777_216, true)
    expect(decoded.decodedChecksum).toBe(1254500280)
    expect(decoded.alphaError).toBe(0)
  })

  it('keeps synchronous and cooperative output identical without changing caller storage', async () => {
    const pixels = jpegXlLargeBlockPixels(257, 129),
      before = pixels.slice()
    const fixture = await encodeJpegXlLargeBlocks(257, 129, 16_777_216, false, true, pixels)
    const parts = synchronousJpegXlLargeBlocks(pixels, 257, 129)
    const combined = new Uint8Array(parts.reduce((sum, part) => sum + part.byteLength, 0))
    let offset = 0
    for (const part of parts) {
      combined.set(part, offset)
      offset += part.byteLength
    }
    expect(fixture.encoded).toEqual(combined)
    expect(pixels).toEqual(before)
  })

  it('propagates late cancellation and releases new transform and entropy scratch', async () => {
    const pixels = jpegXlLargeBlockPixels(257, 129),
      before = pixels.slice()
    const ordinary = new JpegXlEncoderMemory(16_777_216)
    let checkpoints = 0
    await encodeJpegXlVarDct8Async(
      pixels,
      257,
      129,
      9,
      ordinary,
      async () => {
        checkpoints++
      },
      4,
      7,
    )
    ordinary.close()
    const cancelled = new JpegXlEncoderMemory(16_777_216)
    const reason = new Error('cancel larger photo transforms')
    let steps = 0
    await expect(
      encodeJpegXlVarDct8Async(
        pixels,
        257,
        129,
        9,
        cancelled,
        async () => {
          if (++steps === checkpoints - 2) throw reason
        },
        4,
        7,
        undefined,
        8,
        false,
        undefined,
        defaultImageLimits,
      ),
    ).rejects.toBe(reason)
    expect(pixels).toEqual(before)
    expect(cancelled.liveBytes).toBe(0)
    expect(cancelled.liveAllocations).toBe(0)
    cancelled.close()
  })
})
