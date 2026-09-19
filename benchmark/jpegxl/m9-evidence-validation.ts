import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import gateManifest from './production-program/m9-gate-manifest.json' with { type: 'json' }
import securitySources from './production-program/m9-security-sources.json' with { type: 'json' }

type RecordValue = Readonly<Record<string, unknown>>

const isRecord = (value: unknown): value is RecordValue =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
const manifestSha256 = createHash('sha256')
  .update(readFileSync(new URL('./production-program/m9-gate-manifest.json', import.meta.url)))
  .digest('hex')

const record = (value: unknown, message = 'Expected M9 evidence object'): RecordValue => {
  if (!isRecord(value)) throw new Error(message)
  return value
}

const rows = (value: unknown, message: string): readonly RecordValue[] => {
  if (!Array.isArray(value)) throw new Error(message)
  return value.map((entry) => record(entry, message))
}

const finite = (value: unknown, minimum = 0): number => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum)
    throw new Error('Invalid M9 evidence measurement')
  return value
}

const sha256 = (value: unknown, message: string): void => {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/u.test(value)) throw new Error(message)
}

const exactIds = (
  actual: readonly RecordValue[],
  expected: readonly string[],
  label: string,
): void => {
  const ids = actual.map((entry) => entry.id)
  if (
    ids.some((id) => typeof id !== 'string') ||
    new Set(ids).size !== ids.length ||
    ids.length !== expected.length ||
    expected.some((id) => !ids.includes(id))
  )
    throw new Error(`${label} cases are missing, duplicated, or unexpected`)
}

const common = (value: unknown, revision: string): RecordValue => {
  const report = record(value)
  if (report.schemaVersion !== 1) throw new Error('Unknown M9 evidence schema version')
  if (!/^[0-9a-f]{40}$/u.test(revision) || report.revision !== revision)
    throw new Error('M9 evidence revision mismatch')
  if (report.clean !== true) throw new Error('M9 evidence must come from a clean checkout')
  if (report.manifestSha256 !== manifestSha256)
    throw new Error('M9 evidence manifest checksum is stale')
  return report
}

export const validateM9IntegrationReport = (value: unknown, revision: string): number => {
  const report = common(value, revision)
  const cases = rows(report.cases, 'M9 integration cases are missing')
  exactIds(cases, gateManifest.integrationCases, 'M9 integration')
  for (const entry of cases) {
    if (entry.status !== 'passed') throw new Error(`M9 integration case ${String(entry.id)} failed`)
    if (finite(entry.assertions, 1) < 1) throw new Error('M9 integration case has no assertions')
    sha256(entry.outputSha256, 'M9 integration output checksum is missing')
  }
  if (new Set(cases.map(({ outputSha256 }) => outputSha256)).size !== cases.length)
    throw new Error('M9 integration output checksums are not case-specific')
  const summary = record(report.summary)
  if (
    summary.passed !== true ||
    summary.total !== cases.length ||
    summary.passedCases !== cases.length ||
    summary.incorrectCases !== 0
  )
    throw new Error('M9 integration summary does not match raw cases')
  return cases.length
}

export const validateM9FuzzResourceReport = (value: unknown, revision: string): number => {
  const report = common(value, revision)
  const fuzz = rows(report.fuzzCases, 'M9 fuzz cases are missing')
  const resources = rows(report.resourceCases, 'M9 resource cases are missing')
  exactIds(fuzz, gateManifest.fuzzTargets, 'M9 fuzz')
  exactIds(resources, gateManifest.resourceCases, 'M9 resource')
  const allowed = new Set(['passed', 'malformed', 'unsupported', 'limit-exceeded', 'cancelled'])
  for (const entry of [...fuzz, ...resources]) {
    if (!allowed.has(String(entry.outcome))) throw new Error('M9 case has an invalid outcome')
    if (entry.rawException !== false) throw new Error('M9 case escaped normalized error handling')
    if (entry.managedLiveBytes !== 0) throw new Error('M9 case leaked managed ownership')
    finite(entry.elapsedMilliseconds)
    sha256(entry.inputSha256, 'M9 fuzz/resource input checksum is missing')
  }
  const sources = rows(report.securitySources, 'M9 security source review is missing')
  exactIds(
    sources,
    securitySources.sources.map(({ id }) => id),
    'M9 security-source',
  )
  for (const source of sources) {
    const expected = securitySources.sources.find(({ id }) => id === source.id)
    if (source.reviewed !== true || source.url !== expected?.url)
      throw new Error('M9 security source was not reviewed')
  }
  const expectedResourceOutcomes: Readonly<Record<string, string>> = {
    'zero-progress-source': 'malformed',
    'section-count-limit': 'limit-exceeded',
    'internal-frame-limit': 'limit-exceeded',
    'declared-pixel-limit': 'limit-exceeded',
    'metadata-limit': 'limit-exceeded',
    'computation-cancellation': 'cancelled',
    'fetch-cancellation': 'cancelled',
    'sink-failure': 'passed',
    'pending-write-abort': 'cancelled',
    'early-consumer-return': 'passed',
    'resource-reuse': 'passed',
    'malformed-after-preview': 'malformed',
  }
  for (const entry of resources) {
    if (entry.outcome !== expectedResourceOutcomes[String(entry.id)])
      throw new Error(`M9 resource case ${String(entry.id)} did not reach its required outcome`)
  }
  const summary = record(report.summary)
  if (
    summary.passed !== true ||
    summary.total !== fuzz.length + resources.length ||
    summary.rawExceptions !== 0 ||
    summary.leakedOwnership !== 0
  )
    throw new Error('M9 fuzz/resource summary does not match raw cases')
  return fuzz.length + resources.length
}

export const validateM9PackageReport = (value: unknown, revision: string): number => {
  const report = common(value, revision)
  const cases = rows(report.cases, 'M9 package/runtime cases are missing')
  exactIds(cases, gateManifest.packageCases, 'M9 package/runtime')
  for (const entry of cases) {
    if (entry.status !== 'passed') throw new Error(`M9 package case ${String(entry.id)} failed`)
    finite(entry.milliseconds)
    if (entry.id === 'entry-size-and-cold-start') {
      finite(entry.codecMinifiedBytes, 1)
      finite(entry.specializedMinifiedBytes, 1)
      finite(entry.coldImportMilliseconds)
      finite(entry.firstDecodeMilliseconds)
      if (finite(entry.codecMinifiedBytes, 1) > 440_000)
        throw new Error('M9 codec entry exceeds its checked size ceiling')
      if (finite(entry.specializedMinifiedBytes, 1) > 517_000)
        throw new Error('M9 specialized entry exceeds its checked size ceiling')
    }
  }
  const summary = record(report.summary)
  if (
    summary.passed !== true ||
    summary.total !== cases.length ||
    summary.passedCases !== cases.length ||
    summary.runtimeFailures !== 0
  )
    throw new Error('M9 package/runtime summary does not match raw cases')
  return cases.length
}
