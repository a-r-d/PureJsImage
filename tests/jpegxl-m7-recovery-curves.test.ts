import { describe, expect, it } from 'vitest'
import {
  nextRecoverySetting,
  recoveryBracket,
  recoveryFrontier,
  recoveryMonotonicityViolations,
} from '../benchmark/jpegxl/m7-recovery-curves.ts'

describe('M7 bounded quality refinement', () => {
  it('keeps nondominated measured points and accepts an exact target', () => {
    const points = [
      { setting: 1, bytes: 200, score: 90 },
      { setting: 2, bytes: 160, score: 80 },
      { setting: 3, bytes: 180, score: 75 },
      { setting: 4, bytes: 120, score: 70 },
    ]
    expect(recoveryFrontier(points).map((point) => point.setting)).toEqual([4, 2, 1])
    expect(recoveryBracket(points, 80)?.width).toBe(0)
    expect(nextRecoverySetting(points, 80, 0.05, 20, 2)).toBeUndefined()
  })

  it('chooses a bounded interior setting without extrapolating a ratio', () => {
    const points = [
      { setting: 2, bytes: 200, score: 82 },
      { setting: 8, bytes: 80, score: 62 },
    ]
    expect(recoveryBracket(points, 70)?.width).toBe(20)
    const next = nextRecoverySetting(points, 70, 0.25, 20, 2)
    expect(next).toBeGreaterThan(2)
    expect(next).toBeLessThan(8)
  })

  it('uses a measured setting midpoint when quality is nonmonotonic', () => {
    const points = [
      { setting: 1, bytes: 300, score: 80 },
      { setting: 2, bytes: 220, score: 70 },
      { setting: 3, bytes: 200, score: 78 },
      { setting: 4, bytes: 150, score: 60 },
    ]
    expect(recoveryMonotonicityViolations(points)).toBe(1)
    expect(nextRecoverySetting(points, 75, 0.25, 20, 2)).toBe(2.4495)
  })

  it('stops at a demonstrated setting floor and reports nonmonotonic scores', () => {
    const points = [
      { setting: 0.05, bytes: 300, score: 89 },
      { setting: 0.1, bytes: 240, score: 87 },
      { setting: 0.2, bytes: 220, score: 88 },
    ]
    expect(nextRecoverySetting(points, 90, 0.05, 20, 2)).toBeUndefined()
    expect(recoveryMonotonicityViolations(points)).toBe(1)
  })
})
