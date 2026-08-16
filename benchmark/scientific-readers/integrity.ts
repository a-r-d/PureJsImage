import { createHash } from 'node:crypto'
import type {
  PreparedFixtureSummary,
  ScientificBenchmarkProfile,
  ScientificBenchmarkStatus,
  ScientificEnvironmentIdentity,
} from './types.ts'

export interface ScientificStatusInput {
  readonly status: ScientificBenchmarkStatus
  readonly statusReason: string | null
}

export interface ScientificAggregateStatus {
  readonly status: ScientificBenchmarkStatus
  readonly reason: string | null
}

export interface ScientificFingerprintConfiguration {
  readonly profile: ScientificBenchmarkProfile
  readonly runs: number
  readonly warmups: number
  readonly fragmentBytes: number
  readonly sourceLatencies: readonly number[]
  readonly isolatedProcessPerRun: boolean
}

const stableJson = (value: unknown): string => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  const record = value as Readonly<Record<string, unknown>>
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
    .join(',')}}`
}

const sha256 = (value: unknown): string =>
  createHash('sha256').update(stableJson(value)).digest('hex')

const firstReason = (
  results: readonly ScientificStatusInput[],
  status: ScientificBenchmarkStatus,
  fallback: string,
): string =>
  results.find((result) => result.status === status && result.statusReason !== null)
    ?.statusReason ?? fallback

export const aggregateScientificStatus = (
  results: readonly ScientificStatusInput[],
): ScientificAggregateStatus => {
  if (results.length === 0) return { status: 'error', reason: 'No run results' }
  if (results.some((result) => result.status === 'invalid-output')) {
    return {
      status: 'invalid-output',
      reason: firstReason(results, 'invalid-output', 'Invalid output'),
    }
  }
  if (results.some((result) => result.status === 'error')) {
    return { status: 'error', reason: firstReason(results, 'error', 'Measured run failed') }
  }
  if (results.every((result) => result.status === 'supported')) {
    return { status: 'supported', reason: null }
  }
  if (results.every((result) => result.status === 'unsupported')) {
    return {
      status: 'unsupported',
      reason: firstReason(results, 'unsupported', 'Unsupported workload'),
    }
  }
  return {
    status: 'error',
    reason: `Inconsistent measured statuses: ${results.map(({ status }) => status).join(', ')}`,
  }
}

export const scientificEnvironmentFingerprint = (
  environment: ScientificEnvironmentIdentity & {
    readonly platform: string
    readonly runnerClass: 'github-hosted' | 'local' | 'self-hosted'
  },
  configuration: ScientificFingerprintConfiguration,
): string =>
  sha256({
    configuration,
    environment: {
      operatingSystem: environment.operatingSystem,
      operatingSystemVersion: environment.operatingSystemVersion,
      architecture: environment.architecture,
      nodeVersion: environment.nodeVersion,
      v8Version: environment.v8Version,
      cpuModel: environment.cpuModel,
      logicalCpuCount: environment.logicalCpuCount,
      platform: environment.platform,
      runnerClass: environment.runnerClass,
    },
  })

export const scientificFixtureFingerprint = (fixtures: readonly PreparedFixtureSummary[]): string =>
  sha256(
    fixtures.map((fixture) => ({
      fixtureId: fixture.id,
      resources: fixture.resources.map((resource) => ({
        resourceId: resource.id,
        name: resource.name,
        sha256: resource.sha256,
        sizeBytes: resource.sizeBytes,
        payloadRanges: resource.payloadRanges,
      })),
    })),
  )
