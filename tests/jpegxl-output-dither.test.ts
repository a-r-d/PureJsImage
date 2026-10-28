import { expect, it } from 'vitest'
import { libjxlDitheredRgba } from '../benchmark/jpegxl/lossy-lab/libjxl-output-dither-port.ts'

it('preserves integer code values, clips gamut and rejects invalid samples', () => {
  for (const value of [-1, 0, 32 / 255, 128 / 255, 1, 2]) {
    const plane = new Float64Array(37 * 35).fill(value),
      output = libjxlDitheredRgba([plane, plane, plane], 37, 35)
    for (let p = 0; p < 37 * 35; p++) {
      expect(output[p * 4]).toBe(Math.round(Math.max(0, Math.min(1, value)) * 255))
      expect(output[p * 4 + 3]).toBe(255)
    }
  }
  const bad = new Float64Array([Number.NaN])
  expect(() => libjxlDitheredRgba([bad, bad, bad], 1, 1)).toThrow('Nonfinite')
})
it('keeps a cropped image aligned to the global dither phase', () => {
  const width = 67,
    height = 49,
    plane = new Float64Array(width * height).fill(127.5 / 255),
    full = libjxlDitheredRgba([plane, plane, plane], width, height),
    tile = new Float64Array(17 * 11).fill(127.5 / 255),
    cropped = libjxlDitheredRgba([tile, tile, tile], 17, 11, 29, 23)
  for (let y = 0; y < 11; y++)
    for (let x = 0; x < 17; x++)
      expect(cropped.subarray((y * 17 + x) * 4, (y * 17 + x) * 4 + 4)).toEqual(
        full.subarray(((y + 23) * width + x + 29) * 4, ((y + 23) * width + x + 29) * 4 + 4),
      )
  expect(new Set(full).has(127)).toBe(true)
  expect(new Set(full).has(128)).toBe(true)
})
