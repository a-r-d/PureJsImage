import { expect, it } from 'vitest'
import { libjxlTransformQuantization } from '../benchmark/jpegxl/lossy-lab/libjxl-quantization-port.ts'

it('keeps two-block maxima and relaxes larger blocks to the mean at coarse distances', () => {
  const field = Int32Array.of(4, 4, 4, 16)
  expect(libjxlTransformQuantization(field, 2, 0, 0, 2, 2, 1, false)).toBe(16)
  expect(libjxlTransformQuantization(field, 2, 0, 0, 2, 2, 4, false)).toBe(7)
  expect(libjxlTransformQuantization(field, 2, 0, 1, 2, 1, 4, false)).toBe(16)
  const estimate = libjxlTransformQuantization(field, 2, 0, 0, 2, 2, 4, true)
  expect(estimate).toBeGreaterThan(14)
  expect(estimate).toBeLessThan(16)
})
it('preserves constant fields and rejects invalid precision', () => {
  expect(libjxlTransformQuantization(Int32Array.of(7, 7, 7, 7), 2, 0, 0, 2, 2, 2, true)).toBe(7)
  expect(() => libjxlTransformQuantization(Int32Array.of(0), 1, 0, 0, 1, 1, 2, true)).toThrow(
    'Invalid',
  )
})
