import { describe, expect, it } from 'vitest'
import {
  compareHillclimbTrials,
  type HillclimbComparisonPolicy,
  type HillclimbTrial,
} from '../benchmark/hillclimb/compare.ts'

const policy: HillclimbComparisonPolicy = {
  goal: 'speed',
  materialSpeedPercent: 3,
  materialMemoryPercent: 5,
  maximumRegressionPercent: 5,
  maximumCoefficientOfVariationPercent: 10,
  allowedProtectedMetricRegressions: [],
}

const trials = (
  label: 'base' | 'candidate',
  wall: readonly number[],
  options: {
    readonly correctness?: string
    readonly environment?: string
    readonly peakRssBytes?: number
    readonly reads?: number
  } = {},
): HillclimbTrial[] =>
  wall.map((wallMilliseconds) => ({
    label,
    status: 'supported',
    environmentFingerprint: options.environment ?? 'environment',
    fixtureFingerprint: 'fixtures',
    correctnessSignature: options.correctness ?? 'correct',
    operationSignature: 'operation',
    wallMilliseconds,
    peakRssBytes: options.peakRssBytes ?? 100,
    protectedMetrics: { sourceReads: options.reads ?? 4 },
  }))

describe('benchmark hillclimb comparator', () => {
  it('accepts a material low-noise improvement', () => {
    const comparison = compareHillclimbTrials(
      trials('base', [100, 101, 99, 100, 100, 101, 99]),
      trials('candidate', [94, 95, 93, 94, 94, 95, 93]),
      policy,
    )
    expect(comparison).toMatchObject({ verdict: 'accepted', exitCode: 0 })
    expect(comparison.speed.medianDeltaPercent).toBeLessThanOrEqual(-3)
  })

  it('rejects a performance regression', () => {
    const comparison = compareHillclimbTrials(
      trials('base', [100, 100, 100]),
      trials('candidate', [106, 106, 106]),
      policy,
    )
    expect(comparison).toMatchObject({ verdict: 'rejected', exitCode: 1 })
  })

  it('rejects correctness and protected I/O regressions', () => {
    const correctness = compareHillclimbTrials(
      trials('base', [100, 100, 100]),
      trials('candidate', [95, 95, 95], { correctness: 'wrong' }),
      policy,
    )
    expect(correctness).toMatchObject({ verdict: 'rejected', exitCode: 1 })

    const sourceReads = compareHillclimbTrials(
      trials('base', [100, 100, 100]),
      trials('candidate', [95, 95, 95], { reads: 5 }),
      policy,
    )
    expect(sourceReads).toMatchObject({ verdict: 'rejected', exitCode: 1 })
    expect(sourceReads.reasons.join(' ')).toContain('sourceReads')
  })

  it('marks noisy and environment-mismatched comparisons incomparable', () => {
    const noisy = compareHillclimbTrials(
      trials('base', [50, 100, 150]),
      trials('candidate', [45, 90, 135]),
      policy,
    )
    expect(noisy).toMatchObject({ verdict: 'incomparable', exitCode: 2 })

    const environment = compareHillclimbTrials(
      trials('base', [100, 100, 100]),
      trials('candidate', [95, 95, 95], { environment: 'other-machine' }),
      policy,
    )
    expect(environment).toMatchObject({ verdict: 'incomparable', exitCode: 2 })
  })
})
