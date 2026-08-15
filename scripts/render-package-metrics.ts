import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  formatKibibytes,
  formatMebibytes,
  parsePackageMetrics,
  packageMetricsPath,
  serializePackageMetrics,
  type PackageMetric,
  type PackageMetricsDocument,
} from './bundle-size.ts'

const repositoryDirectory = process.cwd()
const readmePath = join(repositoryDirectory, 'README.md')
const docsMetricsPath = join(repositoryDirectory, 'docs-astro/src/data/package-metrics.json')
const checkOnly = process.argv.includes('--check')

const markdownCell = (value: string): string => value.replaceAll('|', '\\|')

const targetById = (metrics: PackageMetricsDocument, id: string): PackageMetric => {
  const target = metrics.targets.find((candidate) => candidate.id === id)
  if (target === undefined) throw new Error(`Package metrics target is missing: ${id}`)
  return target
}

const formatVersionSummary = (target: PackageMetric): string => {
  const directPackageNames: Readonly<Record<string, readonly string[]>> = {
    'purejsimage-matched': ['purejsimage'],
    'purejsimage-all': ['purejsimage'],
    jimp: ['jimp'],
    'image-js': ['image-js'],
    jsquash: ['@jsquash/jpeg', '@jsquash/png', '@jsquash/resize'],
    sharp: ['sharp'],
  }
  const names = directPackageNames[target.id] ?? ['purejsimage']
  const direct = target.packageVersions.filter(({ name }) => names.includes(name))
  const displayed = direct.map(({ name, version }) => `${name} ${version}`)
  const dependencyCount = target.packageVersions.length - direct.length
  if (dependencyCount > 0) displayed.push(`+ ${dependencyCount} dependencies`)
  return displayed.join('; ')
}

const renderScientificReaders = (metrics: PackageMetricsDocument): string => {
  const readersById = new Map(metrics.scientificReaders.map((reader) => [reader.id, reader]))
  const groups = metrics.scientificReaderGroups.map((group) => {
    const readers = group.readerIds.map((id) => {
      const reader = readersById.get(id)
      if (reader === undefined) throw new Error(`Scientific reader group references ${id}`)
      return `**${reader.format}** (\`${reader.packageExport}\`)`
    })
    return `| ${group.label} | ${readers.join('<br>')} |`
  })
  const demoReaders = metrics.liveDemoReaderIds.map((id) => {
    const reader = readersById.get(id)
    if (reader === undefined) throw new Error(`Scientific demo references ${id}`)
    return `${reader.format} (\`${reader.packageExport}\`)`
  })
  return [
    '### Scientific reader package surface',
    '',
    `The package currently exposes **${metrics.scientificReaders.length} scientific readers** through explicit purejsimage/scientific/readers/* exports. This full package surface is generated from the scientific reader inventory in capabilities/manifest.json, the package exports, and src/scientific/readers/all.ts.`,
    '',
    '| Reader group | Package readers |',
    '| --- | --- |',
    ...groups,
    '',
    `The live browser explorer currently wires the smaller demo set: ${demoReaders.join(', ')}. The explorer does **not** claim to open every reader in the package surface; applications can register any explicit reader export.`,
    '',
    'The raster APIs preserve native numeric data instead of forcing every source through RGB. The full reader surface includes scientific images and volumes, spectroscopy and instrument data, microscopy and whole-slide data, surface and metrology formats, and ordinary image adapters.',
  ].join('\n')
}

const renderCompetitors = (targets: readonly PackageMetric[]): readonly string[] => [
  '#### Competitor bundle and npm package size',
  '',
  'Current deterministic measurements use the repository esbuild, gzip, and Brotli settings. The `npm package (unpacked)` column is the byte size after npm extracts what it publishes, including the full PureJsImage package contents; it is not the compressed `.tgz` download size. Competitor rows also include their production dependency trees and platform packages, and the JSON artifact records every package version used. Run `npm pack --dry-run --json` to see both `size` (compressed tarball) and `unpackedSize`.',
  '',
  '| Import | Implementation | Version(s) | Codecs in measured import | Minified JS | gzip | Brotli | npm package (unpacked) | Production packages |',
  '| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: |',
  ...targets.map(
    (target) =>
      `| ${markdownCell(target.name)} | ${target.implementation} | ${markdownCell(formatVersionSummary(target))} | ${markdownCell(target.codecs?.join(', ') ?? '—')} | ${formatKibibytes(target.minifiedJsBytes)} | ${formatKibibytes(target.gzipBytes)} | ${formatKibibytes(target.brotliBytes)} | ${formatMebibytes(target.unpackedPackageBytes)} | ${target.productionPackageCount} |`,
  ),
]

const renderPureEntries = (
  targets: readonly PackageMetric[],
  title: string,
  selected: readonly PackageMetric[],
): readonly string[] => [
  `#### ${title}`,
  '',
  '| Entry | Package export/source | Implementation | Minified JS | Recorded baseline | Ceiling | gzip | Brotli |',
  '| --- | --- | --- | ---: | ---: | ---: | ---: | ---: |',
  ...selected.map((target) => {
    const baseline =
      target.recordedBaselineMinifiedBytes === null
        ? '—'
        : formatKibibytes(target.recordedBaselineMinifiedBytes)
    const ceiling =
      target.configuredCeilingMinifiedBytes === null
        ? '—'
        : formatKibibytes(target.configuredCeilingMinifiedBytes)
    return `| ${markdownCell(target.name)} | ${markdownCell(target.entry.packageExports?.join('; ') ?? target.entry.sourceEntries?.join(' + ') ?? '—')} | ${target.implementation} | ${formatKibibytes(target.minifiedJsBytes)} | ${baseline} | ${ceiling} | ${formatKibibytes(target.gzipBytes)} | ${formatKibibytes(target.brotliBytes)} |`
  }),
  ...(targets.length === 0 ? ['No entries.'] : []),
]

const renderCodecEntries = (
  metrics: PackageMetricsDocument,
  targetsById: ReadonlyMap<string, PackageMetric>,
): readonly string[] => {
  const rows = metrics.codecs.map((codec) => {
    const target = targetsById.get(codec.targetId)
    if (target === undefined) throw new Error(`Codec metrics target is missing: ${codec.targetId}`)
    return `| ${codec.experimental ? 'Experimental' : 'Stable'} | ${markdownCell(codec.name)} | \`${codec.packageExport}\` | ${formatKibibytes(target.minifiedJsBytes)} | ${formatKibibytes(target.gzipBytes)} | ${formatKibibytes(target.brotliBytes)} | ${target.implementation} |`
  })
  const allCodecs = targetsById.get('codecs-all')
  if (allCodecs === undefined) throw new Error('Codec all target is missing')
  rows.push(
    `| Stable aggregate | All stable codecs | \`purejsimage/codecs/all\` | ${formatKibibytes(allCodecs.minifiedJsBytes)} | ${formatKibibytes(allCodecs.gzipBytes)} | ${formatKibibytes(allCodecs.brotliBytes)} | ${allCodecs.implementation} |`,
  )
  return [
    '#### Codec entry sizes',
    '',
    'Every stable codec package export is measured individually. Experimental HEIF/HEIC remains a separate row and is not included in the stable aggregate.',
    '',
    '| Surface | Codec | Package export | Minified JS | gzip | Brotli | Implementation |',
    '| --- | --- | --- | ---: | ---: | ---: | --- |',
    ...rows,
  ]
}

const renderWasm = (metrics: PackageMetricsDocument): readonly string[] => [
  '#### Current WASM asset sizes',
  '',
  '| Asset | Source entry | Raw WASM | gzip | Brotli |',
  '| --- | --- | ---: | ---: | ---: |',
  ...metrics.wasmAssets.map(
    (asset) =>
      `| ${asset.name} | \`${asset.sourceEntry}\` | ${asset.rawBytes} bytes | ${asset.gzipBytes} bytes | ${asset.brotliBytes} bytes |`,
  ),
]

const renderBundle = (metrics: PackageMetricsDocument): string => {
  const targets = metrics.targets.filter(({ category }) => category === 'purejsimage-entry')
  const targetMap = new Map(metrics.targets.map((target) => [target.id, target]))
  const competitors = metrics.targets.filter(({ category }) => category === 'competitor')
  const majorIds = [
    'core',
    'scientific',
    'scientific-readers-all',
    'operations',
    'analysis',
    'analysis-results',
    'analysis-roi',
    'analysis-runtime',
    'analysis-project',
    'extensions',
  ] as const
  const majorEntries = majorIds.map((id) => targetById(metrics, id))
  const readerEntries = targets.filter(({ id }) => id.startsWith('scientific-reader-'))
  return [
    '### Bundle size and npm package size',
    '',
    `Generated for package ${metrics.package.name} ${metrics.package.version}. These current measurements are separate from the dated performance charts and headline timings above; those historical benchmark snapshots are not rewritten by this generator.`,
    '',
    ...renderCompetitors(competitors),
    '',
    ...renderPureEntries(targets, 'Core, scientific, and application entries', majorEntries),
    '',
    ...renderPureEntries(targets, 'Scientific per-reader imports', readerEntries),
    '',
    ...renderCodecEntries(metrics, targetMap),
    '',
    ...renderWasm(metrics),
    '',
    '[See reproduction commands and the machine-readable package metrics →](https://purejsimage.com/performance/#bundle)',
  ].join('\n')
}

const replaceRegion = (source: string, id: string, content: string): string => {
  const start = `<!-- package-metrics:${id}:start -->`
  const end = `<!-- package-metrics:${id}:end -->`
  const startIndex = source.indexOf(start)
  const endIndex = source.indexOf(end)
  if (startIndex < 0 || endIndex < 0 || endIndex < startIndex) {
    throw new Error(`README is missing package metrics markers for ${id}`)
  }
  const before = source.slice(0, startIndex + start.length)
  const after = source.slice(endIndex)
  return `${before}\n<!-- Generated by scripts/render-package-metrics.ts. Do not edit this block. -->\n${content}\n${after}`
}

const metrics = parsePackageMetrics(
  JSON.parse(await readFile(join(repositoryDirectory, packageMetricsPath), 'utf8')),
)
const expectedDocsMetrics = serializePackageMetrics(metrics)
const actualDocsMetrics = await readFile(docsMetricsPath, 'utf8').catch(() => undefined)
let docsMetricsMatch = false
if (actualDocsMetrics !== undefined) {
  try {
    docsMetricsMatch =
      serializePackageMetrics(parsePackageMetrics(JSON.parse(actualDocsMetrics))) ===
      expectedDocsMetrics
  } catch {
    docsMetricsMatch = false
  }
}
if (!docsMetricsMatch) {
  if (checkOnly) throw new Error('docs-astro/src/data/package-metrics.json is stale')
  await writeFile(docsMetricsPath, expectedDocsMetrics)
}

const currentReadme = await readFile(readmePath, 'utf8')
const expectedReadme = replaceRegion(
  replaceRegion(currentReadme, 'scientific-readers', renderScientificReaders(metrics)),
  'bundle',
  renderBundle(metrics),
)
if (checkOnly) {
  if (currentReadme !== expectedReadme) {
    throw new Error('README generated package metrics blocks are stale')
  }
} else if (currentReadme !== expectedReadme) {
  await writeFile(readmePath, expectedReadme)
}
