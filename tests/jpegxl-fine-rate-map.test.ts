import { expect, it } from 'vitest'
import { verifyJpegXlFineRateMap } from './helpers/jpegxl-fine-rate-map.ts'

it('preserves complete fine-quality streams when optional rate-map storage is refused', async () => {
  const result = await verifyJpegXlFineRateMap()
  expect(result.rows.map((row) => row.asynchronous)).toEqual([false, true])
  expect(result.rows.map((row) => row.refusals)).toEqual([1, 1])
  expect(result.rows[0]?.bytes).toBeGreaterThan(0)
  expect(result.rows[1]?.bytes).toBe(result.rows[0]?.bytes)
  expect(result.rows[1]?.checksum).toBe(result.rows[0]?.checksum)
  expect(result.publicResult.bytes).toBeGreaterThan(0)
  expect(result.publicResult.refusals).toBe(1)
  expect(result.publicResult.samples).toBe(129 * 65 * 4)
  expect(result.publicResult.covered).toBe(129 * 65)
})
