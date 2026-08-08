import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  compatibilityFixturePath,
  fixtureSha256,
  readCompatibilityManifest,
  type CompatibilityStatus,
} from './corpus.ts'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const compatibilityStatuses: ReadonlySet<string> = new Set([
  'Compatible',
  'Explicitly unsupported',
  'Invalid',
  'Incorrect pixels',
  'Unexpected exception',
  'Timeout',
  'Excessive memory',
])

const isCompatibilityStatus = (value: unknown): value is CompatibilityStatus =>
  typeof value === 'string' && compatibilityStatuses.has(value)

const benchmarkDirectory = dirname(dirname(dirname(fileURLToPath(import.meta.url))))
const reportPath = join(benchmarkDirectory, 'results', 'heif-compatibility-2026-08-08.json')
const manifest = await readCompatibilityManifest()

if (manifest.fixtures.length < 20)
  throw new Error('HEIF compatibility corpus must have 20 fixtures')
const ids = new Set(manifest.fixtures.map(({ id }) => id))
const files = new Set(manifest.fixtures.map(({ file }) => file))
if (ids.size !== manifest.fixtures.length) throw new Error('HEIF fixture IDs must be unique')
if (files.size !== manifest.fixtures.length)
  throw new Error('HEIF fixture file names must be unique')

for (const fixture of manifest.fixtures) {
  const actualSha256 = fixtureSha256(await readFile(compatibilityFixturePath(fixture)))
  if (actualSha256 !== fixture.sha256) {
    throw new Error(`${fixture.id}: expected SHA-256 ${fixture.sha256}, got ${actualSha256}`)
  }
}

const provenances = manifest.fixtures.map(({ provenance }) => provenance).join('\n')
for (const required of [
  'iPhone 7',
  'iPhone 12 Pro',
  'iPhone 13',
  'iOS 11.0.3',
  'iOS 16.2',
  'iOS 16.5.1',
  'iOS 16.6.1',
  'iOS 16.7',
  'Xiaomi',
  'Samsung',
  'Nokia',
  'libheif',
]) {
  if (!provenances.includes(required)) throw new Error(`HEIF corpus lacks provenance: ${required}`)
}
for (const primary of ['grid', 'hvc1']) {
  if (!manifest.fixtures.some(({ primaryItemType }) => primaryItemType === primary)) {
    throw new Error(`HEIF corpus lacks ${primary} primary coverage`)
  }
}
for (const profile of ['Main', 'Main 10', 'Main Still Picture']) {
  if (!manifest.fixtures.some(({ hevc }) => hevc.profile === profile)) {
    throw new Error(`HEIF corpus lacks ${profile} coverage`)
  }
}
for (const transform of ['irot', 'imir', 'clap']) {
  if (!manifest.fixtures.some(({ transforms }) => transforms.includes(transform))) {
    throw new Error(`HEIF corpus lacks ${transform} coverage`)
  }
}
for (const range of ['full', 'limited'] as const) {
  if (!manifest.fixtures.some(({ color }) => color.range === range)) {
    throw new Error(`HEIF corpus lacks ${range}-range color coverage`)
  }
}
for (const color of ['sRGB', 'Display P3']) {
  if (!manifest.fixtures.some(({ color: expectation }) => expectation.space.includes(color))) {
    throw new Error(`HEIF corpus lacks ${color} coverage`)
  }
}
if (!manifest.fixtures.some(({ auxiliaryItems }) => auxiliaryItems.length > 0)) {
  throw new Error('HEIF corpus lacks auxiliary item coverage')
}

const parsedReport: unknown = JSON.parse(await readFile(reportPath, 'utf8'))
if (!isRecord(parsedReport) || !Array.isArray(parsedReport.results)) {
  throw new Error('HEIF compatibility report is malformed')
}
const reportedStatuses = new Map<string, CompatibilityStatus>()
for (const result of parsedReport.results) {
  if (
    !isRecord(result) ||
    typeof result.fixture !== 'string' ||
    !isCompatibilityStatus(result.status)
  ) {
    throw new Error('HEIF compatibility report contains a malformed result')
  }
  reportedStatuses.set(result.fixture, result.status)
}
for (const fixture of manifest.fixtures) {
  const actualStatus = reportedStatuses.get(fixture.id)
  if (actualStatus !== fixture.expectedStatus) {
    throw new Error(
      `${fixture.id}: expected status ${fixture.expectedStatus}, report has ${actualStatus ?? 'none'}`,
    )
  }
}
if (reportedStatuses.size !== manifest.fixtures.length) {
  throw new Error('HEIF compatibility report and manifest fixture counts differ')
}

console.log(
  `${manifest.fixtures.length} HEIF fixtures: provenance, checksums, feature coverage, and compatibility report verified`,
)
