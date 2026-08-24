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

const targetById = (metrics: PackageMetricsDocument, id: string): PackageMetric => {
  const target = metrics.targets.find((candidate) => candidate.id === id)
  if (target === undefined) throw new Error(`Package metrics target is missing: ${id}`)
  return target
}

const scientificFormatAnchors: Readonly<Record<string, string>> = {
  'Common raster and whole-slide': 'common-raster-whole-slide',
  'Electron microscopy': 'electron-microscopy',
  'AFM, SPM, and surface metrology': 'afm-spm-surface-metrology',
  'Medical and volume interchange': 'medical-volume-interchange',
  'Spectroscopy and detector interchange': 'spectroscopy-detector-interchange',
  'Raw numeric interchange': 'raw-numeric-interchange',
}

const renderScientificReaders = (metrics: PackageMetricsDocument): string => {
  const readersById = new Map(metrics.scientificReaders.map((reader) => [reader.id, reader]))
  const groups = metrics.scientificReaderGroups.map((group) => {
    const readers = group.readerIds.map((id) => {
      const reader = readersById.get(id)
      if (reader === undefined) throw new Error(`Scientific reader group references ${id}`)
      return reader
    })
    const anchor = scientificFormatAnchors[group.label]
    if (anchor === undefined)
      throw new Error(`Scientific reader family has no format anchor: ${group.label}`)
    const formats = readers.map((reader) => reader.format).join(', ')
    return `| [${group.label}](https://purejsimage.com/scientific-formats/#${anchor}) | ${readers.length} | ${formats} |`
  })
  const demoReaders = metrics.liveDemoReaderIds.map((id) => {
    const reader = readersById.get(id)
    if (reader === undefined) throw new Error(`Scientific demo references ${id}`)
    return `${reader.format} (\`${reader.packageExport}\`)`
  })
  return [
    '### Scientific reader package surface',
    '',
    `The package currently exposes **${metrics.scientificReaders.length} scientific readers** through explicit purejsimage/scientific/readers/* exports. This family summary is generated from the scientific reader inventory in capabilities/manifest.json, the package exports, and src/scientific/readers/all.ts.`,
    '',
    '| Reader family | Count | Representative formats |',
    '| --- | ---: | --- |',
    ...groups,
    '',
    'The complete per-reader imports and support boundaries remain on the [scientific format reference](https://purejsimage.com/scientific-formats/), the [API reference](https://purejsimage.com/api/#scientific), and the machine-readable [capability manifest](capabilities/manifest.json).',
    '',
    `The live browser explorer currently wires the smaller demo set: ${demoReaders.join(', ')}. The explorer does **not** claim to open every reader in the package surface; applications can register any explicit reader export.`,
    '',
    'The raster APIs preserve native numeric data instead of forcing every source through RGB. The full reader surface includes scientific images and volumes, spectroscopy and instrument data, microscopy and whole-slide data, surface and metrology formats, and ordinary image adapters.',
  ].join('\n')
}

const renderBundle = (metrics: PackageMetricsDocument): string => {
  const rows = [
    targetById(metrics, 'core'),
    targetById(metrics, 'codecs-web'),
    targetById(metrics, 'codecs-all'),
    targetById(metrics, 'scientific'),
    targetById(metrics, 'scientific-readers-all'),
  ]
  const installed = targetById(metrics, 'purejsimage-all')
  const wasmRawBytes = metrics.wasmAssets.reduce((sum, asset) => sum + asset.rawBytes, 0)
  return [
    '### Bundle size and npm package size',
    '',
    `Generated for ${metrics.package.name} ${metrics.package.version}. The README keeps only the major entry points; the complete per-codec, per-reader, competitor, gzip, Brotli, installed-package, and WASM measurements are on the performance page and in the machine-readable artifact.`,
    '',
    '| Surface | Import | Minified JS | gzip | Brotli |',
    '| --- | --- | ---: | ---: | ---: |',
    ...rows.map(
      (target) =>
        `| ${target.name} | \`${target.entry.packageExports?.join('; ') ?? target.entry.sourceEntries?.join(' + ') ?? '—'}\` | ${formatKibibytes(target.minifiedJsBytes)} | ${formatKibibytes(target.gzipBytes)} | ${formatKibibytes(target.brotliBytes)} |`,
    ),
    '',
    `The extracted npm package is ${formatMebibytes(installed.unpackedPackageBytes)} and has ${installed.productionPackageCount} production package. The eight optional JPEG, PNG, and WebP accelerator assets total ${formatKibibytes(wasmRawBytes)} raw WASM and are loaded only through explicit accelerator imports.`,
    '',
    '[Complete size and footprint tables →](https://purejsimage.com/performance/#package-footprint) · [Machine-readable package metrics](benchmark/generated/package-metrics.json)',
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
