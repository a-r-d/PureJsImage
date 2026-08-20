import {
  isOmeZarrCompatibilityClassification,
  type OmeZarrCompatibilityClassification,
  type OmeZarrCompatibilityResult,
} from './compatibility.ts'

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
    return Object.freeze({
      ...entry,
      id: requiredString(entry.id, `results[${index}].id`),
      collection: requiredString(entry.collection, `results[${index}].collection`),
      url: requiredString(entry.url, `results[${index}].url`),
      classification: entry.classification,
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
  return `${JSON.stringify(stable, null, 2)}\n`
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
    return `| ${cell(result.id)} | ${cell(result.classification)} | ${cell(expected)} | ${cell(surfaces)} | ${cell(warnings)} |`
  })
  return `# OME-Zarr public compatibility evidence

- Generated: ${input.generatedAt}
- Runtime: ${input.nodeVersion} on ${input.platform}
- Corpus: \`${input.corpusPath}\`
- Results: ${passed} supported stores passed; expected non-PASS boundary entries: ${expectedBoundaries}; unexpected classifications: ${input.unexpectedFailures.length}

This is a bounded external interoperability snapshot, not a claim of complete Zarr v3, hierarchy,
or pixel-data conformance. Each run reads only small selections from the pinned public roots.

| Sample | Actual | Expected | Observed surfaces | Metadata warnings |
| --- | --- | --- | --- | --- |
${rows.join('\n')}
`
}
