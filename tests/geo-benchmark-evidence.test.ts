import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  parseGeoBenchmarkReport,
  validateGeoLiveCompatibilityRecord,
} from '../benchmark/geo/types.ts'

const report = () => {
  const value: unknown = JSON.parse(readFileSync('benchmark/generated/geo-benchmark.json', 'utf8'))
  return parseGeoBenchmarkReport(value)
}

describe('generated geo benchmark evidence', () => {
  it('contains all required deterministic scenarios and metrics', () => {
    const evidence = report()
    expect(evidence.deterministicServers).toBe(true)
    expect(evidence.results.map(({ id }) => id).sort()).toEqual([
      'geozarr-time-band-selection',
      'local-envi-subset',
      'remote-cog-viewport',
      'remote-netcdf-variable-subset',
      'remote-sharded-geozarr-viewport',
      'target-grid-reprojection',
    ])
    for (const result of evidence.results) {
      expect(result.status, result.id).toBe('passed')
      expect(result.correctness, result.id).not.toBe('')
      for (const value of Object.values(result.measurements)) {
        if (value === null || typeof value === 'string') continue
        expect(Number.isFinite(value), result.id).toBe(true)
        expect(value, result.id).toBeGreaterThanOrEqual(0)
      }
    }
  })

  it('quantifies selective remote access and Zarr shard behavior', () => {
    const byId = new Map(report().results.map((result) => [result.id, result]))
    const cog = byId.get('remote-cog-viewport')
    const netcdf = byId.get('remote-netcdf-variable-subset')
    const zarr = byId.get('remote-sharded-geozarr-viewport')
    expect(cog?.measurements.transferredBytes).toBeLessThan(64 * 1024 * 1024)
    expect(netcdf?.measurements.transferredBytes).toBeLessThan(32 * 1024 * 1024 * 0.01)
    expect(zarr?.measurements.zarrChunksAccessed).toBeGreaterThan(0)
    expect(zarr?.measurements.zarrShardsAccessed).toBe(1)
    expect(zarr?.measurements.zarrUniqueShardObjects).toBe(1)
    expect(zarr?.measurements.zarrShardIndexReads).toBe(1)
    expect(zarr?.measurements.zarrShardPayloadRanges).toBeGreaterThan(0)
  })

  it('requires complete provenance for opt-in public live compatibility records', () => {
    expect(
      validateGeoLiveCompatibilityRecord({
        schemaVersion: 1,
        assetIdentity: 'https://data.example.test/cog.tif#etag=abc',
        testedAt: '2026-08-21T00:00:00.000Z',
        transport: { protocol: 'https', acceptsRanges: true, contentEncoding: null },
        sourceMutationEvidence: { etag: '"abc"', lastModified: null, versionId: null },
        outcome: 'passed',
        failureCategory: null,
      }),
    ).toMatchObject({ outcome: 'passed', assetIdentity: expect.stringContaining('etag=abc') })
    expect(() =>
      validateGeoLiveCompatibilityRecord({
        schemaVersion: 1,
        assetIdentity: 'mutable-url-only',
        testedAt: '2026-08-21',
        transport: { protocol: 'https', acceptsRanges: 'unknown', contentEncoding: null },
        sourceMutationEvidence: { etag: null, lastModified: null, versionId: null },
        outcome: 'failed',
        failureCategory: null,
      }),
    ).toThrow('failure category')
  })
})
