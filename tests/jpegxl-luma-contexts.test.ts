import { describe, expect, it } from 'vitest'
import { verifyJpegXlLumaContexts } from './helpers/jpegxl-luma-contexts.ts'

// The owner moved complete luma alternatives to effort 9; recovery bounds stay strict.
describe('JPEG XL effort-9 luma and spatial contexts', () => {
  for (const asynchronous of [false, true]) {
    it(`preserves complete pixels through both optional LIMIT paths, async=${asynchronous}`, async () => {
      const preceding = await verifyJpegXlLumaContexts(asynchronous, 'limit')
      const median = await verifyJpegXlLumaContexts(asynchronous, 'group-limit')
      const selected = await verifyJpegXlLumaContexts(asynchronous)
      expect(preceding.hits).toBe(2)
      expect(preceding.groupHits).toBe(0)
      expect(median.hits).toBe(2)
      expect(median.groupHits).toBe(1)
      expect(selected.hits).toBe(2)
      expect(selected.groupHits).toBeGreaterThan(1)
      expect(median.bytes).toBeLessThan(preceding.bytes)
      expect(selected.bytes).toBeLessThanOrEqual(median.bytes)
      expect(median.decodedChecksum).toBe(preceding.decodedChecksum)
      expect(selected.decodedChecksum).toBe(preceding.decodedChecksum)
      expect(selected.colorMaximum).toBeGreaterThan(selected.colorMinimum)
      expect(selected.samples).toBe((257 * 8 - 3) * (256 * 8 - 1) * 4)
      for (const result of [preceding, median, selected]) {
        expect(result.callerPreserved).toBe(true)
        expect(result.alphaError).toBe(0)
        expect(result.live).toBe(0)
        expect(result.allocations).toBe(0)
        expect(result.peak).toBeLessThanOrEqual(67_108_864)
      }
    }, 300_000)
    for (const failure of ['invalid', 'group-invalid'] as const) {
      it(`propagates ${failure} allocation errors and releases preceding sections, async=${asynchronous}`, async () => {
        const result = await verifyJpegXlLumaContexts(asynchronous, failure)
        expect(result.propagated).toBe(true)
        expect(result.hits).toBe(failure === 'invalid' ? 1 : 2)
        expect(result.groupHits).toBe(failure === 'invalid' ? 0 : 1)
        expect(result.live).toBe(0)
        expect(result.allocations).toBe(0)
        expect(result.callerPreserved).toBe(true)
      }, 180_000)
    }
  }
  for (const failure of ['cancel', 'group-cancel'] as const) {
    it(`propagates ${failure} and releases every preceding stream`, async () => {
      const result = await verifyJpegXlLumaContexts(true, failure)
      expect(result.propagated).toBe(true)
      expect(result.hits).toBe(failure === 'cancel' ? 1 : 2)
      if (failure === 'group-cancel') expect(result.groupHits).toBeGreaterThan(0)
      else expect(result.groupHits).toBe(0)
      expect(result.live).toBe(0)
      expect(result.allocations).toBe(0)
      expect(result.callerPreserved).toBe(true)
    }, 180_000)
  }
  it('does not attempt complete luma alternatives at effort 7', async () => {
    const result = await verifyJpegXlLumaContexts(false, 'none', false, 7)
    expect(result.hits).toBe(0)
    expect(result.groupHits).toBe(0)
    expect(result.samples).toBe((256 * 8 - 3) * (256 * 8 - 1) * 4)
    expect(result.live).toBe(0)
    expect(result.allocations).toBe(0)
  }, 120_000)
  it('attempts complete luma alternatives at effort 9 below the former size gate', async () => {
    const fast = await verifyJpegXlLumaContexts(false, 'none', false, 7, [255, 257])
    const result = await verifyJpegXlLumaContexts(false, 'none', false, 9, [255, 257])
    expect(fast.hits).toBe(0)
    expect(fast.groupHits).toBe(0)
    expect(fast.samples).toBe(result.samples)
    expect(fast.alphaError).toBe(0)
    expect(fast.live).toBe(0)
    expect(fast.allocations).toBe(0)
    expect(fast.peak).toBeLessThanOrEqual(67_108_864)
    expect(result.hits).toBe(2)
    expect(result.groupHits).toBeGreaterThan(1)
    expect(result.samples).toBe((255 * 8 - 3) * (257 * 8 - 1) * 4)
    expect(result.callerPreserved).toBe(true)
    expect(result.alphaError).toBe(0)
    expect(result.live).toBe(0)
    expect(result.allocations).toBe(0)
    expect(result.peak).toBeLessThanOrEqual(67_108_864)
  }, 300_000)
})
