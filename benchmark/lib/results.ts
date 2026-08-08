import type { BenchmarkSample, BenchmarkSummary, TimedSample } from '../types.ts'

const percentile = (values: readonly number[], fraction: number): number => {
  if (values.length === 0) throw new Error('Cannot calculate a percentile without values')
  const sorted = [...values].sort((left, right) => left - right)
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)
  const value = sorted[index]
  if (value === undefined) throw new Error('Percentile index was outside the sample set')
  return value
}

export const isSuccessfulSample = (
  sample: BenchmarkSample,
): sample is TimedSample & { status: 'pass' } => sample.status === 'pass'

export const summarizeSamples = (samples: readonly BenchmarkSample[]): BenchmarkSummary => {
  const successful = samples.filter(isSuccessfulSample)
  const failed = samples.find((sample) => sample.status !== 'pass')
  if (failed) {
    return {
      status: failed.status,
      errors: samples.flatMap((sample) => sample.errors),
      ...(successful.length > 0
        ? { samples: samples.length, successfulSamples: successful.length }
        : {}),
    }
  }
  if (successful.length === 0) {
    return { status: 'error', errors: ['benchmark produced no samples'] }
  }

  const wall = successful.map((sample) => sample.wallMilliseconds)
  const cpu = successful.map((sample) => sample.cpuMilliseconds)
  const peakAbsolute = successful.map((sample) => sample.peakRssBytes)
  const peakDelta = successful.map((sample) => sample.peakRssDeltaBytes)
  const outputBytes = successful.map((sample) => sample.outputBytes)
  const output = successful[0]?.output
  return {
    status: 'pass',
    samples: samples.length,
    successfulSamples: successful.length,
    wallMilliseconds: {
      median: percentile(wall, 0.5),
      p95: percentile(wall, 0.95),
      minimum: Math.min(...wall),
      maximum: Math.max(...wall),
    },
    cpuMilliseconds: { median: percentile(cpu, 0.5) },
    peakRssBytes: {
      median: percentile(peakAbsolute, 0.5),
      maximum: Math.max(...peakAbsolute),
    },
    peakRssDeltaBytes: {
      median: percentile(peakDelta, 0.5),
      maximum: Math.max(...peakDelta),
    },
    outputBytes: { median: percentile(outputBytes, 0.5) },
    ...(output ? { output } : {}),
    errors: [],
  }
}
