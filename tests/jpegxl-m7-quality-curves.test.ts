import { describe, expect, it } from 'vitest'
import { interpolateM7Quality } from '../benchmark/jpegxl/m7-quality-curves.ts'

describe('M7 measured quality matching', () => {
  it('interpolates log bytes after removing points dominated in both score and size', () => {
    expect(
      interpolateM7Quality(
        [
          { bytes: 400, score: 90 },
          { bytes: 100, score: 70 },
          { bytes: 500, score: 80 },
          { bytes: 600, score: 90 },
        ],
        80,
      ),
    ).toBeCloseTo(200, 10)
  })
  it('matches lower-is-better perceptual distance in the same domain', () => {
    expect(
      interpolateM7Quality(
        [
          { bytes: 100, score: 2 },
          { bytes: 400, score: 1 },
        ],
        1.5,
        false,
      ),
    ).toBeCloseTo(200, 10)
  })
  it('keeps exact endpoints and leaves unbracketed quality unmeasured', () => {
    const points = [
      { bytes: 100, score: 70 },
      { bytes: 400, score: 90 },
    ]
    expect(interpolateM7Quality(points, 70)).toBe(100)
    expect(interpolateM7Quality(points, 90)).toBe(400)
    expect(interpolateM7Quality(points, 69)).toBeUndefined()
    expect(interpolateM7Quality(points, 91)).toBeUndefined()
    expect(interpolateM7Quality([], 80)).toBeUndefined()
  })
  it('rejects invalid measurements rather than inventing a curve', () => {
    expect(() => interpolateM7Quality([{ bytes: 0, score: 80 }], 80)).toThrow()
    expect(() => interpolateM7Quality([{ bytes: 100, score: NaN }], 80)).toThrow()
    expect(() => interpolateM7Quality([{ bytes: 100, score: 80 }], Infinity)).toThrow()
  })
})
