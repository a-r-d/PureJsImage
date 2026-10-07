import { describe, expect, it } from 'vitest'
import { verifyJpegXlLumaContexts } from './helpers/jpegxl-luma-contexts.ts'

describe('JPEG XL original-size luma contexts', () => {
  for (const asynchronous of [false, true]) {
    it(`preserves pixels and the preceding complete file after optional LIMIT, async=${asynchronous}`, async () => {
      const preceding = await verifyJpegXlLumaContexts(asynchronous, 'limit')
      const selected = await verifyJpegXlLumaContexts(asynchronous)
      expect(preceding.hits).toBe(1)
      expect(selected.hits).toBe(1)
      expect(selected.bytes).toBeLessThanOrEqual(preceding.bytes)
      expect(selected.decodedChecksum).toBe(preceding.decodedChecksum)
      expect(selected.colorMaximum).toBeGreaterThan(selected.colorMinimum)
      expect(selected.samples).toBe((257 * 8 - 3) * (256 * 8 - 1) * 4)
      for (const result of [preceding, selected]) {
        expect(result.callerPreserved).toBe(true)
        expect(result.alphaError).toBe(0)
        expect(result.live).toBe(0)
        expect(result.allocations).toBe(0)
        expect(result.peak).toBeLessThanOrEqual(67_108_864)
      }
    }, 240_000)
    it(`propagates other median allocation errors and releases preceding sections, async=${asynchronous}`, async () => {
      const result = await verifyJpegXlLumaContexts(asynchronous, 'invalid')
      expect(result.propagated).toBe(true)
      expect(result.hits).toBe(1)
      expect(result.live).toBe(0)
      expect(result.allocations).toBe(0)
      expect(result.callerPreserved).toBe(true)
    }, 120_000)
  }
  it('propagates cancellation after the median copy and releases both streams', async () => {
    const result = await verifyJpegXlLumaContexts(true, 'cancel')
    expect(result.propagated).toBe(true)
    expect(result.hits).toBe(1)
    expect(result.live).toBe(0)
    expect(result.allocations).toBe(0)
    expect(result.callerPreserved).toBe(true)
  }, 120_000)
  it('does not attempt the original-size model at the 65536-block boundary', async () => {
    const result = await verifyJpegXlLumaContexts(false, 'none', false)
    expect(result.hits).toBe(0)
    expect(result.samples).toBe((256 * 8 - 3) * (256 * 8 - 1) * 4)
    expect(result.live).toBe(0)
    expect(result.allocations).toBe(0)
  }, 120_000)
})
