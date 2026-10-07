import { describe, expect, it } from 'vitest'
import { verifyJpegXlGroupContexts } from './helpers/jpegxl-group-contexts.ts'

describe('JPEG XL spatial histogram selectors', () => {
  for (const asynchronous of [false, true]) {
    it(`recovers every coefficient from complete and partial groups, async=${asynchronous}`, async () => {
      const results = await verifyJpegXlGroupContexts(asynchronous)
      expect(results).toHaveLength(4)
      expect(results.reduce((sum, row) => sum + row.samples, 0)).toBe(1_234_926)
      for (const row of results) {
        expect(row.histogramCount).toBeGreaterThan(1)
        expect(row.histogramCount).toBeLessThanOrEqual(4)
        expect(new Set(row.selectors).size).toBeGreaterThan(1)
        expect(row.selectors.every((selector) => selector < row.histogramCount)).toBe(true)
        expect(row.contextCount).toBe(row.histogramCount * (row.threshold === null ? 3 : 6) * 495)
        expect(row.callerPreserved).toBe(true)
        expect(row.live).toBe(0)
        expect(row.allocations).toBe(0)
        expect(row.peak).toBeLessThanOrEqual(268_435_456)
      }
    }, 30_000)
  }
})
