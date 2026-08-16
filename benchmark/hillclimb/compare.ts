export type HillclimbGoal = 'memory' | 'speed'
export type HillclimbVerdict = 'accepted' | 'incomparable' | 'neutral' | 'rejected'

export interface HillclimbTrial {
  readonly label: 'base' | 'candidate'
  readonly status: 'supported'
  readonly environmentFingerprint: string
  readonly fixtureFingerprint: string
  readonly correctnessSignature: string
  readonly operationSignature: string
  readonly wallMilliseconds: number
  readonly peakRssBytes: number
  readonly protectedMetrics: Readonly<Record<string, number>>
}

export interface DistributionSummary {
  readonly samples: readonly number[]
  readonly median: number
  readonly mad: number
  readonly iqr: number
  readonly coefficientOfVariationPercent: number | null
}

export interface HillclimbComparisonPolicy {
  readonly goal: HillclimbGoal
  readonly materialSpeedPercent: number
  readonly materialMemoryPercent: number
  readonly maximumRegressionPercent: number
  readonly maximumCoefficientOfVariationPercent: number
  readonly allowedProtectedMetricRegressions: readonly string[]
}

export interface HillclimbComparison {
  readonly verdict: HillclimbVerdict
  readonly exitCode: 0 | 1 | 2
  readonly reasons: readonly string[]
  readonly speed: {
    readonly base: DistributionSummary
    readonly candidate: DistributionSummary
    readonly medianDeltaPercent: number
    readonly pairedDeltaPercent: DistributionSummary
  }
  readonly memory: {
    readonly base: DistributionSummary
    readonly candidate: DistributionSummary
    readonly medianDeltaPercent: number
    readonly pairedDeltaPercent: DistributionSummary
  }
  readonly protectedMetricDeltasPercent: Readonly<Record<string, number>>
}

const quantile = (sorted: readonly number[], fraction: number): number => {
  if (sorted.length === 0) throw new Error('Cannot summarize an empty sample set')
  const position = (sorted.length - 1) * fraction
  const lowerIndex = Math.floor(position)
  const upperIndex = Math.ceil(position)
  const lower = sorted[lowerIndex] ?? 0
  const upper = sorted[upperIndex] ?? lower
  return lower + (upper - lower) * (position - lowerIndex)
}

export const summarizeDistribution = (values: readonly number[]): DistributionSummary => {
  if (values.length === 0 || values.some((value) => !Number.isFinite(value))) {
    throw new Error('Benchmark samples must contain finite values')
  }
  const sorted = [...values].sort((left, right) => left - right)
  const median = quantile(sorted, 0.5)
  const deviations = sorted
    .map((value) => Math.abs(value - median))
    .sort((left, right) => left - right)
  const mean = sorted.reduce((sum, value) => sum + value, 0) / sorted.length
  const variance = sorted.reduce((sum, value) => sum + (value - mean) ** 2, 0) / sorted.length
  return Object.freeze({
    samples: Object.freeze([...values]),
    median,
    mad: quantile(deviations, 0.5),
    iqr: quantile(sorted, 0.75) - quantile(sorted, 0.25),
    coefficientOfVariationPercent:
      sorted.length < 2 || mean === 0 ? null : (Math.sqrt(variance) / Math.abs(mean)) * 100,
  })
}

const deltaPercent = (base: number, candidate: number): number =>
  base === 0 ? (candidate === 0 ? 0 : Number.POSITIVE_INFINITY) : ((candidate - base) / base) * 100

const pairedDeltas = (
  base: readonly number[],
  candidate: readonly number[],
): DistributionSummary => {
  if (base.length !== candidate.length) throw new Error('Base and candidate trial counts differ')
  return summarizeDistribution(
    base.map((value, index) => deltaPercent(value, candidate[index] ?? 0)),
  )
}

const stableValues = (trials: readonly HillclimbTrial[], key: keyof HillclimbTrial): boolean =>
  new Set(trials.map((trial) => String(trial[key]))).size === 1

export const compareHillclimbTrials = (
  base: readonly HillclimbTrial[],
  candidate: readonly HillclimbTrial[],
  policy: HillclimbComparisonPolicy,
): HillclimbComparison => {
  if (base.length === 0 || base.length !== candidate.length) {
    throw new Error('Base and candidate require the same non-zero trial count')
  }
  const all = [...base, ...candidate]
  const baseSpeed = summarizeDistribution(base.map(({ wallMilliseconds }) => wallMilliseconds))
  const candidateSpeed = summarizeDistribution(
    candidate.map(({ wallMilliseconds }) => wallMilliseconds),
  )
  const baseMemory = summarizeDistribution(base.map(({ peakRssBytes }) => peakRssBytes))
  const candidateMemory = summarizeDistribution(candidate.map(({ peakRssBytes }) => peakRssBytes))
  const speedDelta = deltaPercent(baseSpeed.median, candidateSpeed.median)
  const memoryDelta = deltaPercent(baseMemory.median, candidateMemory.median)
  const speedPairs = pairedDeltas(
    base.map(({ wallMilliseconds }) => wallMilliseconds),
    candidate.map(({ wallMilliseconds }) => wallMilliseconds),
  )
  const memoryPairs = pairedDeltas(
    base.map(({ peakRssBytes }) => peakRssBytes),
    candidate.map(({ peakRssBytes }) => peakRssBytes),
  )
  const reasons: string[] = []
  let setupInvalid = false
  let regression = false

  for (const key of [
    'environmentFingerprint',
    'fixtureFingerprint',
    'correctnessSignature',
    'operationSignature',
  ] as const) {
    if (!stableValues(all, key)) {
      reasons.push(`${key} mismatch`)
      if (key === 'correctnessSignature' || key === 'operationSignature') regression = true
      else setupInvalid = true
    }
  }

  const allowed = new Set(policy.allowedProtectedMetricRegressions)
  const protectedNames = new Set(all.flatMap((trial) => Object.keys(trial.protectedMetrics)))
  const protectedMetricDeltasPercent: Record<string, number> = {}
  for (const name of protectedNames) {
    const baseValues = base.map((trial) => trial.protectedMetrics[name])
    const candidateValues = candidate.map((trial) => trial.protectedMetrics[name])
    if (
      baseValues.some((value) => value === undefined) ||
      candidateValues.some((value) => value === undefined)
    ) {
      reasons.push(`protected metric ${name} is missing from some trials`)
      setupInvalid = true
      continue
    }
    const baseSummary = summarizeDistribution(baseValues as number[])
    const candidateSummary = summarizeDistribution(candidateValues as number[])
    const change = deltaPercent(baseSummary.median, candidateSummary.median)
    protectedMetricDeltasPercent[name] = change
    if (change > 0 && !allowed.has(name)) {
      reasons.push(`protected metric ${name} regressed ${change.toFixed(2)}%`)
      regression = true
    }
  }

  const noisy = [baseSpeed, candidateSpeed, baseMemory, candidateMemory].some(
    ({ coefficientOfVariationPercent }) =>
      coefficientOfVariationPercent !== null &&
      coefficientOfVariationPercent > policy.maximumCoefficientOfVariationPercent,
  )
  if (noisy) {
    reasons.push(
      `measurement noise exceeds ${policy.maximumCoefficientOfVariationPercent.toFixed(1)}% CV`,
    )
    setupInvalid = true
  }
  if (speedDelta > policy.maximumRegressionPercent) {
    reasons.push(`speed regressed ${speedDelta.toFixed(2)}%`)
    regression = true
  }
  if (memoryDelta > policy.maximumRegressionPercent) {
    reasons.push(`peak RSS regressed ${memoryDelta.toFixed(2)}%`)
    regression = true
  }

  const materialThreshold =
    policy.goal === 'speed' ? policy.materialSpeedPercent : policy.materialMemoryPercent
  const goalDelta = policy.goal === 'speed' ? speedDelta : memoryDelta
  let verdict: HillclimbVerdict
  let exitCode: 0 | 1 | 2
  if (regression) {
    verdict = 'rejected'
    exitCode = 1
  } else if (setupInvalid) {
    verdict = 'incomparable'
    exitCode = 2
  } else if (goalDelta <= -materialThreshold) {
    verdict = 'accepted'
    exitCode = 0
    reasons.push(`${policy.goal} improved ${Math.abs(goalDelta).toFixed(2)}%`)
  } else {
    verdict = 'neutral'
    exitCode = 0
    reasons.push(
      `${policy.goal} change ${goalDelta.toFixed(2)}% is below the ${materialThreshold.toFixed(1)}% material threshold`,
    )
  }

  return Object.freeze({
    verdict,
    exitCode,
    reasons: Object.freeze(reasons),
    speed: Object.freeze({
      base: baseSpeed,
      candidate: candidateSpeed,
      medianDeltaPercent: speedDelta,
      pairedDeltaPercent: speedPairs,
    }),
    memory: Object.freeze({
      base: baseMemory,
      candidate: candidateMemory,
      medianDeltaPercent: memoryDelta,
      pairedDeltaPercent: memoryPairs,
    }),
    protectedMetricDeltasPercent: Object.freeze(protectedMetricDeltasPercent),
  })
}
