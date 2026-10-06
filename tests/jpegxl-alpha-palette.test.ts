import { describe, expect, it } from 'vitest'
import { JpegXlEncoderMemory } from '../src/codecs/jpegxl-encoder-memory.ts'
import {
  encodeJpegXlVarDct8,
  encodeJpegXlVarDct8Async,
} from '../src/codecs/jpegxl-vardct-encode.ts'
import {
  encodeJpegXlAlphaEntropyFixture,
  verifyJpegXlAlphaEntropy,
} from './helpers/jpegxl-alpha-entropy.ts'

describe('JPEG XL compact alpha palettes', () => {
  for (const depth of [8, 16] as const)
    for (const progressive of [false, true])
      for (const grouped of [false, true])
        it(`preserves all colors and alpha with a complete-file floor, depth=${depth}, progressive=${progressive}, grouped=${grouped}`, async () => {
          const result = await verifyJpegXlAlphaEntropy(
            depth,
            progressive,
            grouped,
            16_777_216,
            'triangles',
          )
          // Frozen before this search. Independent native and Rust grids also agree exactly.
          const checksum =
            depth === 8 ? (grouped ? 2184733352 : 3294516377) : grouped ? 181100822 : 2909912072
          const ceiling =
            depth === 8
              ? progressive
                ? grouped
                  ? 21_039
                  : 10_894
                : grouped
                  ? 18_168
                  : 9_379
              : progressive
                ? grouped
                  ? 16_277
                  : 8_387
                : grouped
                  ? 13_947
                  : 7_181
          expect(result.decodedChecksum).toBe(checksum)
          expect(result.bytes).toBeLessThanOrEqual(ceiling)
          expect(result.alphaError).toBe(0)
          expect(result.alphaSamples).toBe((grouped ? 257 : 129) * 129)
        })

  for (const depth of [8, 16] as const)
    it(`preserves every sample when the optional alpha model exceeds its working budget, depth=${depth}`, async () => {
      const limited = await verifyJpegXlAlphaEntropy(depth, true, true, 3_145_728, 'triangles')
      const ordinary = await verifyJpegXlAlphaEntropy(depth, true, true, 16_777_216, 'triangles')
      expect(limited.alphaError).toBe(0)
      expect(limited.decodedChecksum).toBe(ordinary.decodedChecksum)
      expect(limited.bytes).toBeGreaterThan(ordinary.bytes)
    })

  for (const height of [17, 33])
    for (const progressive of [false, true])
      it(`handles partial alpha planes across two DC groups, height=${height}, progressive=${progressive}`, async () => {
        const result = await verifyJpegXlAlphaEntropy(
          8,
          progressive,
          true,
          16_777_216,
          'triangles',
          { width: 2065, height },
        )
        expect(result.alphaSamples).toBe(2065 * height)
        expect(result.alphaError).toBe(0)
      })

  it('keeps sync and cooperative output identical, preserves caller storage, and releases a late cancellation', async () => {
    const fixture = await encodeJpegXlAlphaEntropyFixture(8, false, true, 67_108_864, 'triangles', {
      width: 512,
      height: 512,
    })
    const before = fixture.pixels.slice()
    const memory = new JpegXlEncoderMemory(67_108_864)
    let checkpoints = 0
    const parts = await encodeJpegXlVarDct8Async(
      fixture.pixels,
      fixture.width,
      fixture.height,
      3,
      memory,
      async () => {
        checkpoints++
      },
      4,
      7,
    )
    expect(parts).toEqual(
      encodeJpegXlVarDct8(fixture.pixels, fixture.width, fixture.height, 3, undefined, 4, 7),
    )
    expect(fixture.pixels).toEqual(before)
    expect(memory.liveBytes).toBe(parts.reduce((sum, part) => sum + part.byteLength, 0))
    memory.close()
    expect(memory.liveBytes).toBe(0)
    expect(memory.liveAllocations).toBe(0)
    const aborted = new JpegXlEncoderMemory(67_108_864)
    const reason = new Error('cancel alpha model search')
    let steps = 0
    await expect(
      encodeJpegXlVarDct8Async(
        fixture.pixels,
        fixture.width,
        fixture.height,
        3,
        aborted,
        async () => {
          if (++steps === checkpoints - 2) throw reason
        },
        4,
        7,
      ),
    ).rejects.toBe(reason)
    expect(fixture.pixels).toEqual(before)
    expect(aborted.liveBytes).toBe(0)
    expect(aborted.liveAllocations).toBe(0)
    aborted.close()
  }, 60_000)
})
