import { describe, expect, it } from 'vitest'
import {
  aggregateScientificStatus,
  scientificEnvironmentFingerprint,
  scientificFixtureFingerprint,
} from '../benchmark/scientific-readers/integrity.ts'
import type { PreparedFixtureSummary } from '../benchmark/scientific-readers/types.ts'

const status = (
  value: 'error' | 'invalid-output' | 'supported' | 'unsupported',
  statusReason: string | null = null,
) => ({ status: value, statusReason })

describe('scientific benchmark integrity', () => {
  it('requires every measured run to agree before reporting supported or unsupported', () => {
    expect(aggregateScientificStatus([status('supported'), status('supported')])).toEqual({
      status: 'supported',
      reason: null,
    })
    expect(
      aggregateScientificStatus([status('unsupported'), status('unsupported', 'no reader')]),
    ).toEqual({ status: 'unsupported', reason: 'no reader' })
    expect(aggregateScientificStatus([status('supported'), status('unsupported')])).toMatchObject({
      status: 'error',
    })
    expect(
      aggregateScientificStatus([status('supported'), status('error', 'worker failed')]),
    ).toEqual({ status: 'error', reason: 'worker failed' })
    expect(
      aggregateScientificStatus([status('supported'), status('invalid-output', 'wrong hash')]),
    ).toEqual({ status: 'invalid-output', reason: 'wrong hash' })
  })

  it('keeps Git revision metadata out of the environment fingerprint', () => {
    const environment = {
      operatingSystem: 'Linux',
      operatingSystemVersion: '6.8.0',
      architecture: 'x64',
      nodeVersion: 'v22.18.0',
      v8Version: '12.4',
      cpuModel: 'Benchmark CPU',
      logicalCpuCount: 8,
      platform: 'linux',
      runnerClass: 'local' as const,
    }
    const configuration = {
      profile: 'scaling' as const,
      runs: 7,
      warmups: 1,
      fragmentBytes: 0,
      sourceLatencies: [0],
      isolatedProcessPerRun: true,
    }
    const first = { ...environment, gitCommit: 'a'.repeat(40), gitDirty: false }
    const second = { ...environment, gitCommit: 'b'.repeat(40), gitDirty: true }
    expect(scientificEnvironmentFingerprint(first, configuration)).toBe(
      scientificEnvironmentFingerprint(second, configuration),
    )
  })

  it('keeps checkout paths out of fixture fingerprints while retaining payload ranges', () => {
    const fixture = (path: string, payloadEnd: number): PreparedFixtureSummary => {
      const resource = {
        id: 'primary',
        name: 'volume.npy',
        sha256: 'c'.repeat(64),
        sizeBytes: 1_024,
        payloadRanges: [[128, payloadEnd] as const],
        representative: true,
      }
      const resourceWithCheckoutPath = { ...resource, path }
      return {
        id: 'npy-medium',
        sha256: 'd'.repeat(64),
        resources: [resourceWithCheckoutPath],
        provenance: 'generated',
        supportBoundary: 'native plane',
        expectedOracle: 'exact hash',
        representative: true,
      }
    }
    expect(scientificFixtureFingerprint([fixture('/checkout-a/volume.npy', 1_024)])).toBe(
      scientificFixtureFingerprint([fixture('/checkout-b/volume.npy', 1_024)]),
    )
    expect(scientificFixtureFingerprint([fixture('/checkout-a/volume.npy', 1_024)])).not.toBe(
      scientificFixtureFingerprint([fixture('/checkout-a/volume.npy', 900)]),
    )
  })
})
