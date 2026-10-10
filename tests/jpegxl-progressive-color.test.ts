import { expect, it } from 'vitest'
import { verifyJpegXlRgbRgbaEquivalence } from './helpers/jpegxl-rgb-rgba-equivalence.ts'

it('keeps progressive RGB and opaque RGBA color decisions identical', async () => {
  const result = await verifyJpegXlRgbRgbaEquivalence(true)
  expect(result.rows).toHaveLength(6)
  for (const row of result.rows) {
    expect(row.comparedColorSamples).toBe(result.width * result.height * 3)
    expect(row.opaquePixels).toBe(result.width * result.height)
  }
})
