import { describe, expect, it } from 'vitest'
import { nextComparisonQualitySetting } from '../benchmark/jpegxl/comparison/quality-refinement.ts'
import { recoveryBracket } from '../benchmark/jpegxl/m7-recovery-curves.ts'

describe('JPEG XL comparison quality refinement', () => {
  it('gives later targets a sample before spending the entire budget on the primary target', () => {
    const points = [
      { setting: 1, bytes: 1000, score: 85 },
      { setting: 4, bytes: 500, score: 60 },
      { setting: 2, bytes: 800, score: 81 },
    ]
    const first = nextComparisonQualitySetting(points, [80, 70, 90], 0.25, 25, 0.25)
    expect(first).toBeGreaterThan(2)
    expect(first).toBeLessThan(4)
    const second = nextComparisonQualitySetting(
      [...points, { setting: 3, bytes: 700, score: 71 }],
      [80, 70, 90],
      0.25,
      25,
      0.25,
    )
    expect(second).toBe(0.5)
  })

  it('continues refining another target after the primary target is measured exactly', () => {
    const points = [
      { setting: 1, bytes: 1000, score: 90 },
      { setting: 2, bytes: 800, score: 80 },
      { setting: 4, bytes: 500, score: 60 },
    ]
    const setting = nextComparisonQualitySetting(points, [80, 70, 90], 0.25, 25, 0.25)
    expect(recoveryBracket(points, 80)?.width).toBe(0)
    expect(setting).toBeGreaterThan(2)
    expect(setting).toBeLessThan(4)
  })

  it('continues after an unreachable target without extrapolating its byte size', () => {
    const points = [
      { setting: 0.25, bytes: 1000, score: 85 },
      { setting: 8, bytes: 400, score: 60 },
    ]
    expect(recoveryBracket(points, 90)).toBeUndefined()
    const setting = nextComparisonQualitySetting(points, [90, 80], 0.25, 25, 0.25)
    expect(setting).toBeGreaterThan(0.25)
    expect(setting).toBeLessThan(8)
  })

  it('stops once every requested target has an adequate measured bracket', () => {
    const points = [
      { setting: 1, bytes: 1000, score: 90 },
      { setting: 2, bytes: 800, score: 80 },
      { setting: 4, bytes: 500, score: 70 },
    ]
    expect(nextComparisonQualitySetting(points, [80, 70, 90], 0.25, 25, 0.25)).toBeUndefined()
  })

  it('preserves primary-target-only sampling and refines a wide bracket', () => {
    const points = [
      { setting: 1, bytes: 1000, score: 90 },
      { setting: 2, bytes: 800, score: 80 },
      { setting: 4, bytes: 500, score: 60 },
    ]
    expect(nextComparisonQualitySetting(points, [80], 0.25, 25, 2)).toBeUndefined()
    expect(nextComparisonQualitySetting(points, [70], 0.25, 25, 2)).toBeGreaterThan(2)
  })

  it('refines the matching frontier instead of a narrower dominated raw pair', () => {
    const points = [
      { setting: 2.652, bytes: 33911, score: 70.27920485 },
      { setting: 2.6562, bytes: 33919, score: 70.22985825 },
      { setting: 2.6605, bytes: 33811, score: 69.94602618 },
      { setting: 2.6691, bytes: 33727, score: 69.96698951 },
    ]
    expect(recoveryBracket(points, 70)?.width).toBeCloseTo(0.31221534)
    const setting = nextComparisonQualitySetting(points, [70], 0.1, 25, 0.25)
    expect(setting).toBeGreaterThan(2.6605)
    expect(setting).toBeLessThan(2.6691)
  })

  it('continues when the estimated frontier setting was already measured and dominated', () => {
    const points = [
      { setting: 1, bytes: 100, score: 90 },
      { setting: 2, bytes: 150, score: 80 },
      { setting: 4, bytes: 50, score: 70 },
    ]
    expect(recoveryBracket(points, 80)?.width).toBe(20)
    expect(nextComparisonQualitySetting(points, [80], 0.25, 25, 0.25)).toBeCloseTo(Math.SQRT2, 4)
  })

  it('stops when rounding leaves no unmeasured interior setting', () => {
    const points = [
      { setting: 1, bytes: 100, score: 90 },
      { setting: 1.00001, bytes: 50, score: 70 },
    ]
    expect(nextComparisonQualitySetting(points, [80], 0.25, 25, 0.25)).toBeUndefined()
  })
})
