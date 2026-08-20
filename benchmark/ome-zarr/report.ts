import {
  isOmeZarrCompatibilityClassification,
  type OmeZarrCompatibilityClassification,
  type OmeZarrCompatibilityResult,
} from './compatibility.ts'
import type { OmeZarrHttpStoreIdentitySummary } from '../../src/scientific/ome-zarr-http.ts'

export const OME_ZARR_COMPATIBILITY_REPORT_PATH = 'benchmark/generated/ome-zarr-compatibility.json'
export const OME_ZARR_COMPATIBILITY_MARKDOWN_PATH = 'docs/generated/ome-zarr-compatibility.md'

export interface OmeZarrCompatibilityReport {
  readonly schemaVersion: 2
  readonly reportType: 'public-compatibility'
  readonly corpusPath: string
  readonly generatedAt: string
  readonly nodeVersion: string
  readonly platform: string
  readonly results: readonly OmeZarrCompatibilityResult[]
  readonly unexpectedFailures: readonly {
    readonly id: string
    readonly expected: OmeZarrCompatibilityClassification
    readonly actual: OmeZarrCompatibilityClassification
  }[]
}

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const requiredString = (value: unknown, label: string): string => {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${label} must be a string`)
  return value
}

const parseStoreIdentity = (
  value: unknown,
  label: string,
): OmeZarrHttpStoreIdentitySummary | undefined => {
  if (value === undefined) return undefined
  if (!isRecord(value)) throw new Error(`${label} must be an object`)
  const sourceIdentityStrength = value.sourceIdentityStrength
  if (sourceIdentityStrength !== 'strong' && sourceIdentityStrength !== 'weak') {
    throw new Error(`${label}.sourceIdentityStrength is invalid`)
  }
  const rootObjectSize = value.rootObjectSize
  if (
    !Number.isSafeInteger(rootObjectSize) ||
    typeof rootObjectSize !== 'number' ||
    rootObjectSize < 0
  ) {
    throw new Error(`${label}.rootObjectSize is invalid`)
  }
  const rootObjectValidator = value.rootObjectValidator
  let validator: OmeZarrHttpStoreIdentitySummary['rootObjectValidator']
  if (rootObjectValidator !== undefined) {
    if (
      !isRecord(rootObjectValidator) ||
      (rootObjectValidator.kind !== 'etag' &&
        rootObjectValidator.kind !== 'version-id' &&
        rootObjectValidator.kind !== 'last-modified')
    ) {
      throw new Error(`${label}.rootObjectValidator is invalid`)
    }
    validator = Object.freeze({
      kind: rootObjectValidator.kind,
      value: requiredString(rootObjectValidator.value, `${label}.rootObjectValidator.value`),
    })
  }
  const sessionIdentity = value.sessionIdentity
  const parsedSessionIdentity =
    sessionIdentity === undefined
      ? undefined
      : requiredString(sessionIdentity, `${label}.sessionIdentity`)
  const stableValidator = validator?.kind === 'etag' || validator?.kind === 'version-id'
  if (
    sourceIdentityStrength !== (stableValidator ? 'strong' : 'weak') ||
    (stableValidator && parsedSessionIdentity !== undefined) ||
    (!stableValidator && parsedSessionIdentity === undefined)
  ) {
    throw new Error(`${label} overstates or omits its root identity evidence`)
  }
  const zarrFormat = value.zarrFormat
  if (zarrFormat !== undefined && zarrFormat !== 2 && zarrFormat !== 3) {
    throw new Error(`${label}.zarrFormat is invalid`)
  }
  const omeNgffVersion = value.omeNgffVersion
  if (omeNgffVersion !== undefined && typeof omeNgffVersion !== 'string') {
    throw new Error(`${label}.omeNgffVersion is invalid`)
  }
  return Object.freeze({
    normalizedRootUrl: requiredString(value.normalizedRootUrl, `${label}.normalizedRootUrl`),
    selectedRootMetadataObject: requiredString(
      value.selectedRootMetadataObject,
      `${label}.selectedRootMetadataObject`,
    ),
    sourceIdentityStrength,
    rootObjectSize,
    ...(validator === undefined ? {} : { rootObjectValidator: validator }),
    ...(parsedSessionIdentity === undefined ? {} : { sessionIdentity: parsedSessionIdentity }),
    ...(zarrFormat === undefined ? {} : { zarrFormat }),
    ...(omeNgffVersion === undefined ? {} : { omeNgffVersion }),
  })
}

export const parseOmeZarrCompatibilityReport = (value: unknown): OmeZarrCompatibilityReport => {
  if (
    !isRecord(value) ||
    value.schemaVersion !== 2 ||
    value.reportType !== 'public-compatibility'
  ) {
    throw new Error('OME-Zarr compatibility report schema is invalid')
  }
  if (!Array.isArray(value.results) || !Array.isArray(value.unexpectedFailures)) {
    throw new Error('OME-Zarr compatibility report result arrays are invalid')
  }
  const results = value.results.map((entry, index): OmeZarrCompatibilityResult => {
    if (!isRecord(entry) || !isOmeZarrCompatibilityClassification(entry.classification)) {
      throw new Error(`OME-Zarr compatibility result ${index} is invalid`)
    }
    const storeIdentity = parseStoreIdentity(entry.storeIdentity, `results[${index}].storeIdentity`)
    return Object.freeze({
      ...entry,
      id: requiredString(entry.id, `results[${index}].id`),
      collection: requiredString(entry.collection, `results[${index}].collection`),
      url: requiredString(entry.url, `results[${index}].url`),
      classification: entry.classification,
      ...(storeIdentity === undefined ? {} : { storeIdentity }),
    })
  })
  const unexpectedFailures = value.unexpectedFailures.map((entry, index) => {
    if (
      !isRecord(entry) ||
      !isOmeZarrCompatibilityClassification(entry.expected) ||
      !isOmeZarrCompatibilityClassification(entry.actual)
    ) {
      throw new Error(`OME-Zarr unexpected compatibility failure ${index} is invalid`)
    }
    return Object.freeze({
      id: requiredString(entry.id, `unexpectedFailures[${index}].id`),
      expected: entry.expected,
      actual: entry.actual,
    })
  })
  const generatedAt = requiredString(value.generatedAt, 'generatedAt')
  if (!Number.isFinite(Date.parse(generatedAt))) throw new Error('generatedAt must be an ISO date')
  return Object.freeze({
    schemaVersion: 2,
    reportType: 'public-compatibility',
    corpusPath: requiredString(value.corpusPath, 'corpusPath'),
    generatedAt,
    nodeVersion: requiredString(value.nodeVersion, 'nodeVersion'),
    platform: requiredString(value.platform, 'platform'),
    results: Object.freeze(results),
    unexpectedFailures: Object.freeze(unexpectedFailures),
  })
}

const stableReport = (value: unknown): string => {
  const parsed = parseOmeZarrCompatibilityReport(value)
  const { generatedAt: _generatedAt, ...stable } = parsed
  const results = stable.results.map((result) => {
    if (result.storeIdentity?.sessionIdentity === undefined) return result
    const { sessionIdentity: _sessionIdentity, ...identity } = result.storeIdentity
    return Object.freeze({
      ...result,
      storeIdentity: Object.freeze({ ...identity, sessionIdentity: 'session' }),
    })
  })
  return `${JSON.stringify({ ...stable, results }, null, 2)}\n`
}

export const assertOmeZarrCompatibilityReportCurrent = (
  checkedIn: unknown,
  generated: unknown,
): void => {
  if (stableReport(checkedIn) !== stableReport(generated)) {
    throw new Error('Checked-in OME-Zarr public compatibility report is stale; run with --write')
  }
}

const cell = (value: string): string => value.replaceAll('|', '\\|').replaceAll('\n', ' ')

export const renderOmeZarrCompatibilityMarkdown = (input: OmeZarrCompatibilityReport): string => {
  const passed = input.results.filter((result) => result.classification === 'PASS').length
  const expectedBoundaries = input.results.filter(
    (result) => (result.expectedClassification ?? 'PASS') !== 'PASS',
  ).length
  const rows = input.results.map((result) => {
    const expected = result.expectedClassification ?? 'PASS'
    const surfaces = result.observedSurfaces?.join(', ') ?? 'not available'
    const warnings = result.warnings?.map((warning) => warning.code).join(', ') ?? 'none'
    const identity = result.storeIdentity
    const rootIdentity =
      identity === undefined
        ? 'not available'
        : `${identity.selectedRootMetadataObject}; ${identity.rootObjectSize} bytes; ${identity.rootObjectValidator?.kind ?? 'session-only'}`
    return `| ${cell(result.id)} | ${cell(result.classification)} | ${cell(expected)} | ${cell(rootIdentity)} | ${cell(surfaces)} | ${cell(warnings)} |`
  })
  return `# OME-Zarr public compatibility evidence

- Generated: ${input.generatedAt}
- Runtime: ${input.nodeVersion} on ${input.platform}
- Corpus: \`${input.corpusPath}\`
- Results: ${passed} supported stores passed; expected non-PASS boundary entries: ${expectedBoundaries}; unexpected classifications: ${input.unexpectedFailures.length}

This is a bounded external interoperability snapshot, not a claim of complete Zarr v3, hierarchy,
or pixel-data conformance. Each run reads only small selections from the pinned public roots.

| Sample | Actual | Expected | Root identity evidence | Observed surfaces | Metadata warnings |
| --- | --- | --- | --- | --- | --- |
${rows.join('\n')}
`
}
