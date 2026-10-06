import { describe, expect, it } from 'vitest'
import {
  originalLossyBands,
  originalLossyPoint,
  originalLossySelected,
} from '../benchmark/jpegxl/comparison/original-lossy-bands.ts'

const point = (setting: number, bytes: number, score: number, butteraugli: number) =>
  originalLossyPoint({
    setting,
    bytes,
    score,
    butteraugli,
    artifact: `fixture-${setting}.jxl`,
    artifactSha256: 'encoded',
    decodedSha256: 'pixels',
  })

describe('Original JPEG XL dual-metric comparison', () => {
  it('uses independent metric frontiers and retains raw quality inversions', () => {
    const points = [
      point(4, 100, 79.9, 1.05),
      point(3, 400, 80.1, 0.95),
      point(2, 500, 80.2, 1.1),
      point(1.5, 2500, 89.9, 0.55),
      point(1, 10000, 90.1, 0.4),
    ]
    const before = JSON.stringify(points)
    const ssim = originalLossyBands(points, 'ssimulacra2')
    const butteraugli = originalLossyBands(points, 'butteraugli')
    expect(ssim[1]?.interpolatedBytes).toBeCloseTo(200, 7)
    expect(ssim[2]?.interpolatedBytes).toBeCloseTo(5000, 7)
    expect(butteraugli[1]?.interpolatedBytes).toBeCloseTo(200, 7)
    expect(butteraugli[1]?.bracket?.lower.setting).toBe(4)
    expect(butteraugli[1]?.bracket?.upper.setting).toBe(3)
    expect(originalLossySelected(points).some((point) => point.setting === 2)).toBe(false)
    expect(JSON.stringify(points)).toBe(before)
  })

  it('keeps wide intervals unscored and never extrapolates missing targets', () => {
    const points = [point(2, 100, 79.8, 2.3), point(1, 400, 80.2, 1.7)]
    const ssim = originalLossyBands(points, 'ssimulacra2')
    const butteraugli = originalLossyBands(points, 'butteraugli')
    expect(ssim[1]?.status).toBe('wide bracket')
    expect(ssim[1]?.interpolatedBytes).toBeNull()
    expect(butteraugli[2]?.status).toBe('wide bracket')
    expect(butteraugli[2]?.interpolatedBytes).toBeNull()
    expect(ssim[0]?.status).toBe('missing bracket')
    expect(ssim[0]?.interpolatedBytes).toBeNull()
    expect(butteraugli[3]?.status).toBe('missing bracket')
    expect(butteraugli[3]?.interpolatedBytes).toBeNull()
    expect(originalLossySelected(points)).toEqual([])
  })

  it('accepts exact targets and selects each measured endpoint once', () => {
    const exact = [point(1, 128, 80, 1)]
    expect(originalLossyBands(exact, 'ssimulacra2')[1]?.interpolatedBytes).toBe(128)
    expect(originalLossyBands(exact, 'butteraugli')[1]?.interpolatedBytes).toBe(128)
    expect(originalLossySelected(exact)).toEqual(exact)
  })

  it('rejects invalid external measurements before building the frontier', () => {
    for (const input of [
      null,
      { setting: 0 },
      { setting: 1, bytes: -1 },
      { setting: 1, bytes: 1, score: Number.NaN, butteraugli: 0 },
      { setting: 1, bytes: 1, score: 80, butteraugli: -1 },
    ])
      expect(() => originalLossyPoint(input)).toThrow()
  })
})
