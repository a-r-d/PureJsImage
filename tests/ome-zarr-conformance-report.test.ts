import { describe, expect, it } from 'vitest'

import {
  assertOmeZarrConformanceReportCurrent,
  OME_ZARR_CONFORMANCE_EXCLUSIONS,
  OME_ZARR_CONFORMANCE_REPOSITORY,
  OME_ZARR_CONFORMANCE_REVISION,
  OME_ZARR_CONFORMANCE_VERSION,
  parseOmeZarrConformanceReport,
} from '../scripts/ome-zarr-conformance-data.ts'

const report = () => ({
  schemaVersion: 2,
  conformanceLevel: 'attributes',
  upstreamRepository: OME_ZARR_CONFORMANCE_REPOSITORY,
  upstreamRevision: OME_ZARR_CONFORMANCE_REVISION,
  omeZarrVersion: OME_ZARR_CONFORMANCE_VERSION,
  normative: { passed: 70, total: 70 },
  strict: { passed: 10, total: 11, failures: [{ id: 'strict failure' }] },
  excludedCases: OME_ZARR_CONFORMANCE_EXCLUSIONS,
  unexpectedFailures: [],
  generatedAt: '2026-08-20T12:00:00.000Z',
  nodeVersion: 'v22.18.0',
  platform: 'linux/x64',
})

describe('OME-Zarr attribute conformance evidence', () => {
  it('pins the upstream corpus and every reviewed exclusion explanation', () => {
    expect(OME_ZARR_CONFORMANCE_REVISION).toBe('69b136f1e64e68fead11216ac8dd3f1155668d04')
    expect(OME_ZARR_CONFORMANCE_EXCLUSIONS.map((entry) => entry.id)).toEqual([
      'plate_suite/plate/minimal_no_acquisitions',
      'plate_suite/plate/minimal_acquisitions',
      'plate_suite/plate/non_alphanumeric_row',
      'strict_plate_suite/plate/strict_no_acquisitions',
      'strict_plate_suite/plate/strict_acquisitions',
    ])
    expect(OME_ZARR_CONFORMANCE_EXCLUSIONS[2]).toMatchObject({
      expectedValid: true,
      pureJsImageValid: false,
      reason:
        'The row name "A1" is alphanumeric; the actual conflict is the omitted required plate.version.',
      finalSpecSection: '2.7 "plate" metadata: plate.version is required',
      reviewedAt: '2026-08-20',
    })
    expect(new Set(OME_ZARR_CONFORMANCE_EXCLUSIONS.map((entry) => entry.id)).size).toBe(
      OME_ZARR_CONFORMANCE_EXCLUSIONS.length,
    )
  })

  it('parses the attribute-level schema and rejects broader conformance claims', () => {
    expect(parseOmeZarrConformanceReport(report())).toMatchObject({
      schemaVersion: 2,
      conformanceLevel: 'attributes',
      normative: { passed: 70, total: 70 },
      strict: { passed: 10, total: 11 },
    })
    expect(() =>
      parseOmeZarrConformanceReport({ ...report(), conformanceLevel: 'hierarchy' }),
    ).toThrow(/schema/u)
    expect(() =>
      parseOmeZarrConformanceReport({ ...report(), normative: { passed: 71, total: 70 } }),
    ).toThrow(/counts/u)
  })

  it('ignores generation time but detects stale semantic evidence', () => {
    expect(() =>
      assertOmeZarrConformanceReportCurrent(report(), {
        ...report(),
        generatedAt: '2026-08-21T12:00:00.000Z',
      }),
    ).not.toThrow()
    expect(() =>
      assertOmeZarrConformanceReportCurrent(report(), {
        ...report(),
        normative: { passed: 69, total: 70 },
      }),
    ).toThrow(/stale/u)
  })
})
