import { describe, expect, it } from 'vitest'
import type { LabMode } from '../benchmark/jpegxl/lossy-lab/fixture-selection.ts'
import { lossyLabDistances } from '../benchmark/jpegxl/lossy-lab/quality-ladder.ts'

describe('fixed lossy campaign and final report ladders', () => {
  it.each(['screen', 'scale'] as const)('keeps the five-point %s ladder', (mode) => {
    expect(lossyLabDistances({ mode, promotion: true, effort: 7, finalReport: false })).toEqual([
      0.5, 1, 2, 4, 7,
    ])
  })
  it.each(['lab', 'holdout', 'watch'] as const)('keeps the nine-point %s ladder', (mode) => {
    expect(lossyLabDistances({ mode, promotion: true, effort: 7, finalReport: false })).toEqual([
      0.45, 0.65, 0.9, 1.3, 1.85, 3, 3.8, 5.35, 7.5,
    ])
  })
  it('keeps the isolated distance-2 speed setting', () => {
    expect(
      lossyLabDistances({ mode: 'speed', promotion: false, effort: 7, finalReport: false }),
    ).toEqual([2])
  })
  it('extends only the final effort-7 lab report on promoted main', () => {
    expect(
      lossyLabDistances({
        mode: 'lab',
        promotion: true,
        finalReport: true,
        effort: 7,
        branch: 'main',
      }),
    ).toEqual([0.45, 0.65, 0.9, 1.3, 1.85, 3, 3.8, 5.35, 7.5, 10, 14])
  })
  it.each(['screen', 'scale', 'speed', 'holdout', 'watch'] satisfies LabMode[])(
    'rejects final distances in %s mode',
    (mode) => {
      expect(() =>
        lossyLabDistances({ mode, promotion: true, finalReport: true, effort: 7, branch: 'main' }),
      ).toThrow('final effort-7 lab report')
    },
  )
  it('rejects exploration, effort 9 and an unpromoted candidate', () => {
    const report = {
      mode: 'lab',
      promotion: true,
      finalReport: true,
      effort: 7,
      branch: 'main',
    } as const
    for (const options of [
      { ...report, promotion: false },
      { ...report, effort: 9 as const },
      { ...report, branch: 'jxl-lossy-candidate' },
      { mode: 'lab' as const, promotion: true, finalReport: true, effort: 7 as const },
    ])
      expect(() => lossyLabDistances(options)).toThrow('final effort-7 lab report')
  })
})
