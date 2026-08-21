import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import {
  geoCapabilityIds,
  geoCapabilityStates,
  readGeoCapabilityManifest,
  type GeoCapabilityClaim,
  type GeoCapabilityId,
  type GeoCapabilityManifest,
  type GeoCapabilityState,
} from './geo-capability-manifest.ts'

const checkOnly = process.argv.includes('--check')
const sourcePath = 'capabilities/geo-manifest.json'

const labels: Readonly<Record<GeoCapabilityId, string>> = {
  'local-open': 'Local open',
  'remote-open': 'Remote open',
  'range-access': 'Range access',
  'region-read': 'Region read',
  multiscale: 'Multiscale',
  'rotated-affine': 'Rotated affine',
  'pixel-is-area': 'Pixel is area',
  'pixel-is-point': 'Pixel is point',
  'unknown-crs': 'Unknown CRS',
  bands: 'Bands',
  'time-dimension': 'Time',
  'vertical-dimension': 'Vertical',
  nodata: 'Nodata',
  'scale-offset': 'Scale and offset',
  'target-grid-read': 'Target grid',
  reprojection: 'Reprojection',
  writer: 'Writer',
}

const shortStates: Readonly<Record<GeoCapabilityState, string>> = {
  'implemented-tested': 'Tested',
  'implemented-fixture-limited': 'Fixture-limited',
  'metadata-only': 'Metadata only',
  'recognized-unsupported': 'Unsupported',
  unavailable: 'Unavailable',
  'intentionally-out-of-scope': 'Out of scope',
}

const stateCodes: Readonly<Record<GeoCapabilityState, string>> = {
  'implemented-tested': 'tested',
  'implemented-fixture-limited': 'limited',
  'metadata-only': 'metadata',
  'recognized-unsupported': 'unsupported',
  unavailable: 'none',
  'intentionally-out-of-scope': 'out-of-scope',
}

const markdownCell = (claim: GeoCapabilityClaim): string => {
  const label = shortStates[claim.state]
  const evidence = claim.evidence.length === 0 ? '' : ` [evidence](#${claim.evidence[0]})`
  return `${label}${evidence}`
}

const generatedMarkdown = (manifest: GeoCapabilityManifest): string => {
  const header = ['Format', ...geoCapabilityIds.map((id) => labels[id])]
  const rows = manifest.formats.map((format) => [
    format.name,
    ...geoCapabilityIds.map((id) => markdownCell(format.capabilities[id])),
  ])
  const evidence = manifest.evidence.flatMap((item) => [
    `<a id="${item.id}"></a>`,
    `- **${item.id}:** [${item.path}](../../${item.path}) (${item.kind}). ${item.note}`,
  ])
  return [
    '<!-- Generated from capabilities/geo-manifest.json. Do not edit directly. -->',
    '# Geo compatibility evidence',
    '',
    '## Quick Answer',
    '',
    'This table is generated from checked capability records. A feature is marked Tested only when',
    'the manifest names deterministic executable evidence. Fixture-limited and metadata-only states',
    'are not treated as complete support.',
    '',
    `| ${header.join(' | ')} |`,
    `| ${header.map(() => '---').join(' | ')} |`,
    ...rows.map((row) => `| ${row.join(' | ')} |`),
    '',
    '## State definitions',
    '',
    ...geoCapabilityStates.map(
      (state) => `- **${shortStates[state]}:** ${manifest.stateDefinitions[state]}`,
    ),
    '',
    '## Evidence index',
    '',
    ...evidence,
    '',
  ].join('\n')
}

const readmeBlock = (manifest: GeoCapabilityManifest): string =>
  [
    '<!-- Generated from capabilities/geo-manifest.json. Do not edit directly. -->',
    '### Geographic raster compatibility',
    '',
    '| Format | Local | Remote | Region | Multiscale | Reprojection | Write |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    ...manifest.formats.map((format) => {
      const ids: readonly GeoCapabilityId[] = [
        'local-open',
        'remote-open',
        'region-read',
        'multiscale',
        'reprojection',
        'writer',
      ]
      return `| ${format.name} | ${ids.map((id) => shortStates[format.capabilities[id].state]).join(' | ')} |`
    }),
    '',
    '“Fixture-limited” is implemented behavior with a narrow current corpus. “Metadata only” does not',
    'claim the related pixel operation. See the [complete generated geo evidence table](docs/generated/geo-compatibility.md)',
    'and the [machine-readable manifest](docs-astro/public/geo-capabilities.json).',
  ].join('\n')

const replaceRegion = (source: string, name: string, replacement: string): string => {
  const start = `<!-- geo-capabilities:${name}:start -->`
  const end = `<!-- geo-capabilities:${name}:end -->`
  const startIndex = source.indexOf(start)
  const endIndex = source.indexOf(end)
  if (startIndex < 0 || endIndex < startIndex)
    throw new Error(`Missing generated geo region ${name}`)
  return `${source.slice(0, startIndex + start.length)}\n${replacement.trimEnd()}\n${source.slice(endIndex)}`
}

const fullJson = (manifest: GeoCapabilityManifest): string =>
  `${JSON.stringify(manifest, null, 2)}\n`

const compactJson = (manifest: GeoCapabilityManifest): string =>
  `${JSON.stringify(
    {
      schemaVersion: 1,
      stateCodes,
      capabilities: geoCapabilityIds.map((id) => ({ id, label: labels[id] })),
      formats: manifest.formats.map((format) => ({
        id: format.id,
        name: format.name,
        publicEntry: format.publicEntry,
        states: Object.fromEntries(
          geoCapabilityIds.map((id) => [id, stateCodes[format.capabilities[id].state]]),
        ),
      })),
    },
    null,
    2,
  )}\n`

const expectationsJson = (manifest: GeoCapabilityManifest): string =>
  `${JSON.stringify(
    {
      schemaVersion: 1,
      formats: manifest.formats.map((format) => ({
        id: format.id,
        publicEntry: format.publicEntry,
        capabilities: format.capabilities,
      })),
    },
    null,
    2,
  )}\n`

const manifest = await readGeoCapabilityManifest()
for (const item of manifest.evidence) {
  await access(item.path).catch(() => {
    throw new Error(`Geo capability evidence does not exist: ${item.path}`)
  })
  if (item.kind === 'test') {
    const contents = await readFile(item.path, 'utf8')
    if (!/(?:describe|test)\s*\(/.test(contents)) {
      throw new Error(`Geo test evidence contains no test declaration: ${item.path}`)
    }
  }
}

const outputs = new Map<string, string>()
outputs.set('docs/generated/geo-compatibility.md', generatedMarkdown(manifest))
outputs.set('docs-astro/public/geo-capabilities.json', fullJson(manifest))
outputs.set('docs-astro/src/data/geo-capabilities.json', compactJson(manifest))
outputs.set('tests/generated/geo-capability-expectations.json', expectationsJson(manifest))
const readme = await readFile('README.md', 'utf8')
outputs.set('README.md', replaceRegion(readme, 'readme', readmeBlock(manifest)))

const jsonEquivalent = (actual: string, expected: string): boolean => {
  try {
    const actualValue: unknown = JSON.parse(actual)
    const expectedValue: unknown = JSON.parse(expected)
    return JSON.stringify(actualValue) === JSON.stringify(expectedValue)
  } catch {
    return false
  }
}

const stale: string[] = []
for (const [path, expected] of outputs) {
  if (checkOnly) {
    const actual = await readFile(path, 'utf8').catch(() => undefined)
    const matches =
      actual !== undefined &&
      (path.endsWith('.json') ? jsonEquivalent(actual, expected) : actual === expected)
    if (!matches) stale.push(path)
    continue
  }
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, expected)
}

if (stale.length > 0) {
  throw new Error(
    `Generated geo capability outputs are stale:\n${stale.map((path) => `- ${path}`).join('\n')}\nRun npm run capabilities:generate.`,
  )
}

if (!checkOnly) console.log(`Generated ${outputs.size} geo capability outputs from ${sourcePath}.`)
