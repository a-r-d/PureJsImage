import { expect, it } from 'vitest'
import { frequencyBand, frequencyError } from '../benchmark/jpegxl/lossy-lab/frequency-error.ts'

it('separates constant offsets into DC and preserves Parseval energy', () => {
  const zero = new Float32Array(256),
    constant = new Float32Array(256).fill(0.25)
  const result = frequencyError([zero, zero, zero], [zero, constant, zero], 16, 16)
  expect(result.error[4]).toBeCloseTo(0.0625, 12)
  expect(result.error.reduce((a, b) => a + b, 0)).toBeCloseTo(0.0625, 12)
  expect(result.error.slice(0, 4)).toEqual([0, 0, 0, 0])
  expect(result.coefficientError[64]).toBeCloseTo(0.0625, 12)
})
it('preserves identity and sums frequency error to spatial MSE', () => {
  const source = Float32Array.from({ length: 256 }, (_, i) => Math.sin(i * 0.7))
  const dst = Float32Array.from(source, (v, i) => v + Math.cos(i * 0.1) * 0.01)
  expect(frequencyError([source, source, source], [source, source, source], 16, 16).error).toEqual(
    new Array(12).fill(0),
  )
  const result = frequencyError([source, source, source], [dst, dst, dst], 16, 16)
  for (let c = 0; c < 3; c++)
    for (let band = 0; band < 4; band++) {
      const error = result.coefficientError
        .slice(c * 64, c * 64 + 64)
        .reduce(
          (sum, value, p) => sum + (frequencyBand(p % 8, Math.floor(p / 8)) === band ? value : 0),
          0,
        )
      expect(error).toBeCloseTo(result.error[c * 4 + band] ?? NaN, 12)
    }
  const error = result.error.reduce((a, b) => a + b, 0)
  expect(error).toBeCloseTo(
    (source.reduce((s, v, i) => s + (v - (dst[i] ?? 0)) ** 2, 0) * 3) / 256,
    12,
  )
  expect(() => frequencyError([source, source, source], [dst, dst, dst], 15, 16)).toThrow('tiles')
})

it('locates a single oriented cosine at its frequency coordinates', () => {
  const zero = new Float32Array(64)
  const cosine = Float32Array.from(
    { length: 64 },
    (_, p) =>
      0.25 *
      Math.cos((Math.PI * ((p % 8) + 0.5) * 3) / 8) *
      Math.cos((Math.PI * (Math.floor(p / 8) + 0.5) * 2) / 8),
  )
  const result = frequencyError([zero, zero, zero], [zero, cosine, zero], 8, 8)
  expect(result.coefficientError[64 + 2 * 8 + 3]).toBeCloseTo(1 / 64, 10)
  expect(result.error[6]).toBeCloseTo(1 / 64, 10)
  const other = result.coefficientError.reduce(
    (sum, value, i) => sum + (i === 64 + 2 * 8 + 3 ? 0 : value),
    0,
  )
  expect(other).toBeLessThan(1e-14)
})
