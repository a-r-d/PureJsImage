export const OME_ZARR_CONFORMANCE_REPOSITORY = 'https://github.com/ome/ngff-spec.git'
export const OME_ZARR_CONFORMANCE_REVISION = '69b136f1e64e68fead11216ac8dd3f1155668d04'
export const OME_ZARR_CONFORMANCE_VERSION = '0.5'

export interface OmeZarrConformanceExclusion {
  readonly id: string
  readonly expectedValid: boolean
  readonly pureJsImageValid: boolean
  readonly reason: string
  readonly finalSpecSection: string
  readonly upstreamIssueUrl?: string
  readonly reviewedAt: string
}

export interface OmeZarrConformanceReport {
  readonly schemaVersion: 2
  readonly conformanceLevel: 'attributes'
  readonly upstreamRepository: string
  readonly upstreamRevision: string
  readonly omeZarrVersion: string
  readonly normative: { readonly passed: number; readonly total: number }
  readonly strict: {
    readonly passed: number
    readonly total: number
    readonly failures: readonly unknown[]
  }
  readonly excludedCases: readonly OmeZarrConformanceExclusion[]
  readonly unexpectedFailures: readonly unknown[]
  readonly generatedAt: string
  readonly nodeVersion: string
  readonly platform: string
}

const missingPlateVersion = (id: string, reason: string): Readonly<OmeZarrConformanceExclusion> =>
  Object.freeze({
    id,
    expectedValid: true,
    pureJsImageValid: false,
    reason,
    finalSpecSection: '2.7 "plate" metadata: plate.version is required',
    reviewedAt: '2026-08-20',
  })

/**
 * Contradictions between the pinned official attribute cases and the finalized 0.5 report.
 * These cases are reported as exclusions and are never counted as passes.
 */
export const OME_ZARR_CONFORMANCE_EXCLUSIONS = Object.freeze([
  missingPlateVersion(
    'plate_suite/plate/minimal_no_acquisitions',
    'The case expects valid metadata but omits required plate.version.',
  ),
  missingPlateVersion(
    'plate_suite/plate/minimal_acquisitions',
    'The case expects valid metadata but omits required plate.version.',
  ),
  missingPlateVersion(
    'plate_suite/plate/non_alphanumeric_row',
    'The row name "A1" is alphanumeric; the actual conflict is the omitted required plate.version.',
  ),
  missingPlateVersion(
    'strict_plate_suite/plate/strict_no_acquisitions',
    'The case expects valid metadata but omits required plate.version.',
  ),
  missingPlateVersion(
    'strict_plate_suite/plate/strict_acquisitions',
    'The case expects valid metadata but omits required plate.version.',
  ),
])

export const OME_ZARR_CONFORMANCE_EXCLUSION_BY_ID: ReadonlyMap<
  string,
  Readonly<OmeZarrConformanceExclusion>
> = new Map(OME_ZARR_CONFORMANCE_EXCLUSIONS.map((entry) => [entry.id, entry]))

export const OME_ZARR_CONFORMANCE_REPORT_PATH = 'benchmark/generated/ome-zarr-conformance.json'

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const requiredString = (value: unknown, label: string): string => {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${label} must be a string`)
  return value
}

const summary = (
  value: unknown,
  label: string,
): { readonly passed: number; readonly total: number } => {
  if (!isRecord(value)) throw new Error(`${label} must be an object`)
  if (
    !Number.isSafeInteger(value.passed) ||
    !Number.isSafeInteger(value.total) ||
    Number(value.passed) < 0 ||
    Number(value.total) < Number(value.passed)
  ) {
    throw new Error(`${label} counts are invalid`)
  }
  return Object.freeze({ passed: Number(value.passed), total: Number(value.total) })
}

const parseExclusion = (value: unknown, index: number): OmeZarrConformanceExclusion => {
  if (!isRecord(value)) throw new Error(`excludedCases[${index}] must be an object`)
  if (typeof value.expectedValid !== 'boolean' || typeof value.pureJsImageValid !== 'boolean') {
    throw new Error(`excludedCases[${index}] results are invalid`)
  }
  return Object.freeze({
    id: requiredString(value.id, `excludedCases[${index}].id`),
    expectedValid: value.expectedValid,
    pureJsImageValid: value.pureJsImageValid,
    reason: requiredString(value.reason, `excludedCases[${index}].reason`),
    finalSpecSection: requiredString(
      value.finalSpecSection,
      `excludedCases[${index}].finalSpecSection`,
    ),
    ...(value.upstreamIssueUrl === undefined
      ? {}
      : {
          upstreamIssueUrl: requiredString(
            value.upstreamIssueUrl,
            `excludedCases[${index}].upstreamIssueUrl`,
          ),
        }),
    reviewedAt: requiredString(value.reviewedAt, `excludedCases[${index}].reviewedAt`),
  })
}

export const parseOmeZarrConformanceReport = (value: unknown): OmeZarrConformanceReport => {
  if (!isRecord(value) || value.schemaVersion !== 2 || value.conformanceLevel !== 'attributes') {
    throw new Error('OME-Zarr attribute conformance report schema is invalid')
  }
  if (!isRecord(value.strict) || !Array.isArray(value.strict.failures)) {
    throw new Error('OME-Zarr strict conformance result is invalid')
  }
  if (!Array.isArray(value.excludedCases) || !Array.isArray(value.unexpectedFailures)) {
    throw new Error('OME-Zarr conformance report result arrays are invalid')
  }
  const strictCounts = summary(value.strict, 'strict')
  const generatedAt = requiredString(value.generatedAt, 'generatedAt')
  if (!Number.isFinite(Date.parse(generatedAt))) throw new Error('generatedAt must be an ISO date')
  return Object.freeze({
    schemaVersion: 2,
    conformanceLevel: 'attributes',
    upstreamRepository: requiredString(value.upstreamRepository, 'upstreamRepository'),
    upstreamRevision: requiredString(value.upstreamRevision, 'upstreamRevision'),
    omeZarrVersion: requiredString(value.omeZarrVersion, 'omeZarrVersion'),
    normative: summary(value.normative, 'normative'),
    strict: Object.freeze({
      ...strictCounts,
      failures: Object.freeze(value.strict.failures.slice()),
    }),
    excludedCases: Object.freeze(value.excludedCases.map(parseExclusion)),
    unexpectedFailures: Object.freeze(value.unexpectedFailures.slice()),
    generatedAt,
    nodeVersion: requiredString(value.nodeVersion, 'nodeVersion'),
    platform: requiredString(value.platform, 'platform'),
  })
}

export const stableOmeZarrConformanceReport = (value: unknown): string => {
  if (!isRecord(value)) {
    throw new Error('OME-Zarr conformance report must be an object')
  }
  const { generatedAt: _generatedAt, ...stable } = value
  return `${JSON.stringify(stable, null, 2)}\n`
}

export const assertOmeZarrConformanceReportCurrent = (
  checkedIn: unknown,
  generated: unknown,
): void => {
  if (
    stableOmeZarrConformanceReport(parseOmeZarrConformanceReport(checkedIn)) !==
    stableOmeZarrConformanceReport(parseOmeZarrConformanceReport(generated))
  ) {
    throw new Error('Checked-in OME-Zarr attribute conformance report is stale; run with --write')
  }
}
