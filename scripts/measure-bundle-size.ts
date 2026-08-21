import { readFile } from 'node:fs/promises'
import {
  formatKibibytes,
  formatMebibytes,
  measurePackageMetrics,
  parsePackageMetrics,
  packageVersionLabel,
  serializePackageMetrics,
  targetPackageExport,
  applyRecordedNativeWrapperFootprints,
  writePackageMetrics,
  type PackageMetric,
  type PackageMetricsDocument,
} from './bundle-size.ts'

const checkOnly = process.argv.includes('--check')
const repositoryDirectory = process.cwd()
const metrics = await measurePackageMetrics(repositoryDirectory)

const generatedPaths = [
  'benchmark/generated/package-metrics.json',
  'docs-astro/src/data/package-metrics.json',
] as const

const assertGeneratedMetrics = async (document: PackageMetricsDocument): Promise<void> => {
  const stalePaths: string[] = []
  let firstRecorded: string | undefined
  for (const path of generatedPaths) {
    let actual: string
    try {
      actual = await readFile(path, 'utf8')
    } catch {
      stalePaths.push(path)
      continue
    }
    try {
      const parsed = parsePackageMetrics(JSON.parse(actual))
      const recorded = serializePackageMetrics(parsed)
      const expected = serializePackageMetrics(
        applyRecordedNativeWrapperFootprints(document, parsed),
      )
      if (recorded !== expected || (firstRecorded !== undefined && recorded !== firstRecorded)) {
        stalePaths.push(path)
      }
      firstRecorded ??= recorded
    } catch {
      stalePaths.push(path)
    }
  }
  if (stalePaths.length > 0) {
    throw new Error(
      `Generated package metrics are stale: ${stalePaths.join(', ')}. Run npm run size to refresh them.`,
    )
  }
}

if (checkOnly) {
  await assertGeneratedMetrics(metrics)
} else {
  await writePackageMetrics(metrics, repositoryDirectory)
}

const kibibytes = (bytes: number): string => formatKibibytes(bytes)
const mebibytes = (bytes: number): string => formatMebibytes(bytes)

const printTargetTable = (
  heading: string,
  targets: readonly PackageMetric[],
  includeFootprint: boolean,
): void => {
  console.log('')
  console.log(`## ${heading}`)
  console.log('')
  console.log(
    includeFootprint
      ? '| Entry | Version(s) | Package export/source | Minified JS | gzip | Brotli | npm package (unpacked) | Production packages |'
      : '| Entry | Package export/source | Minified | Recorded baseline | Ceiling | gzip | Brotli |',
  )
  console.log(
    includeFootprint
      ? '| --- | --- | --- | ---: | ---: | ---: | ---: | ---: |'
      : '| --- | --- | ---: | ---: | ---: | ---: | ---: |',
  )
  for (const target of targets) {
    if (includeFootprint) {
      console.log(
        `| ${target.name} | ${packageVersionLabel(target)} | ${targetPackageExport(target)} | ${kibibytes(target.minifiedJsBytes)} | ${kibibytes(target.gzipBytes)} | ${kibibytes(target.brotliBytes)} | ${mebibytes(target.unpackedPackageBytes)} | ${target.productionPackageCount} |`,
      )
      continue
    }
    const baseline =
      target.recordedBaselineMinifiedBytes === null
        ? '—'
        : kibibytes(target.recordedBaselineMinifiedBytes)
    const ceiling =
      target.configuredCeilingMinifiedBytes === null
        ? '—'
        : kibibytes(target.configuredCeilingMinifiedBytes)
    console.log(
      `| ${target.name} | ${targetPackageExport(target)} | ${kibibytes(target.minifiedJsBytes)} | ${baseline} | ${ceiling} | ${kibibytes(target.gzipBytes)} | ${kibibytes(target.brotliBytes)} |`,
    )
  }
}

printTargetTable(
  'Competitor bundle comparison',
  metrics.targets.filter(({ category }) => category === 'competitor'),
  true,
)
console.log('')
console.log(
  'JPEG and PNG are the codecs available in all five compared libraries. PureJsImage and jSquash can assemble that matched set explicitly. The normal public imports for Jimp, image-js, and Sharp include the additional codecs shown rather than offering equivalent codec-level tree shaking.',
)
console.log(
  "Sharp's JavaScript number is only its wrapper. Its npm package (unpacked) includes the native addon and this platform's libvips package, so the wrapper size must not be presented as its deployment size.",
)
console.log(
  "jSquash's JavaScript number is its codec and resize glue. Its npm package (unpacked) includes the JPEG, PNG, and resize WebAssembly payloads, so the JavaScript number must not be presented as its deployment size.",
)

printTargetTable(
  'PureJsImage entry points',
  metrics.targets.filter(({ category }) => category === 'purejsimage-entry'),
  false,
)

console.log('')
console.log('## WASM asset sizes')
console.log('')
console.log('| Asset | Source entry | Raw WASM | gzip | Brotli |')
console.log('| --- | --- | ---: | ---: | ---: |')
for (const asset of metrics.wasmAssets) {
  console.log(
    `| ${asset.name} | ${asset.sourceEntry} | ${asset.rawBytes} bytes | ${asset.gzipBytes} bytes | ${asset.brotliBytes} bytes |`,
  )
}
