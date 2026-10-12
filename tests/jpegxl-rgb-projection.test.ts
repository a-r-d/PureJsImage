import { expect, it } from 'vitest'
import { verifyJpegXlRgbProjection } from './helpers/jpegxl-rgb-projection.ts'

it('keeps exact opaque color and bytes below the former RGB staging peak', async () => {
  const rows = await verifyJpegXlRgbProjection()
  expect(rows).toHaveLength(3)
  for (const row of rows) {
    expect(row.rgbaPeak).toBeLessThanOrEqual(950_000)
    expect(row.alphaExact).toBe(true)
    expect(row.callerUnchanged).toBe(true)
  }
}, 60_000)
