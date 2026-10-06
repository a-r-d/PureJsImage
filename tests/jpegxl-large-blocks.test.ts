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
    [129, 65, 681, 3367695530],
    [257, 129, 1721, 4248577614],
    [2065, 17, 2455, 1145807969],
    [17, 2065, 2768, 723715316],
  ] as const) {
    it(`keeps exact alpha and bounded color error across partial groups at ${width}x${height}`, async () => {
      const result = await verifyJpegXlLargeBlocks(width, height)
      // Complete native/Rust grids independently verify these original fields.
      expect(result.bytes).toBeLessThan(previousBytes)
      expect(result.alphaError).toBe(0)
      expect(result.meanColorError).toBeLessThan(1.5)
      expect(result.decodedChecksum).toBe(checksum)
      expect(result.samples).toBe(width * height * 3)
      expect(result.ownedPeak).toBeLessThanOrEqual(16_777_216)
    })
  }

  it('recovers the exact preceding stream at the original minimum working budget', async () => {
    const limited = await encodeJpegXlLargeBlocks(129, 65, 797_262)
    const preceding = await encodeJpegXlLargeBlocks(129, 65, 797_262, false, false)
    expect(limited.encoded).toEqual(preceding.encoded)
    expect(limited.encoded.length).toBe(681)
    expect(limited.ownedPeak).toBe(797_262)
    const decoded = await verifyJpegXlLargeBlocks(129, 65, 797_262)
    expect(decoded.decodedChecksum).toBe(775643947)
    expect(decoded.alphaError).toBe(0)
  })

  it('rejects the original insufficient budget with closed ownership', async () => {
    const pixels = jpegXlLargeBlockPixels()
    const before = pixels.slice()
    const memory = new JpegXlEncoderMemory(797_261)
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
