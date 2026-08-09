import { readFile } from 'node:fs/promises'
import { brotliCompressSync, constants, gzipSync } from 'node:zlib'
import { build } from 'esbuild'
import { measurePackageFootprint } from '../benchmark/lib/package-footprint.ts'
import type { EngineKind, EngineMetadata, PackageFootprint } from '../benchmark/types.ts'
import {
  competitorBundleTargets,
  pureJsImageEntryTargets,
  type BundleTarget,
  type CompetitorBundleTarget,
} from './bundle-size-config.ts'

interface BundleMeasurement<Target extends BundleTarget = BundleTarget> {
  readonly brotliBytes: number
  readonly gzipBytes: number
  readonly minifiedBytes: number
  readonly target: Target
}

interface PackageJson {
  readonly name: string
  readonly version: string
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const readPackageJson = async (path: string): Promise<PackageJson> => {
  const parsed: unknown = JSON.parse(await readFile(path, 'utf8'))
  if (!isRecord(parsed) || typeof parsed.name !== 'string' || typeof parsed.version !== 'string') {
    throw new Error(`Invalid package metadata: ${path}`)
  }
  return { name: parsed.name, version: parsed.version }
}

const measure = async <Target extends BundleTarget>(
  target: Target,
): Promise<BundleMeasurement<Target>> => {
  const result = await build({
    bundle: true,
    charset: 'utf8',
    format: 'esm',
    legalComments: 'none',
    logLevel: 'silent',
    minify: true,
    platform: 'node',
    stdin: {
      contents: target.contents,
      loader: 'ts',
      resolveDir: process.cwd(),
      sourcefile: 'bundle-size-entry.ts',
    },
    sourcemap: false,
    target: 'node22',
    treeShaking: true,
    write: false,
  })
  const output = result.outputFiles[0]?.contents
  if (!output) throw new Error(`esbuild produced no output for ${target.name}`)
  return {
    target,
    brotliBytes: brotliCompressSync(output, {
      params: { [constants.BROTLI_PARAM_QUALITY]: 11 },
    }).byteLength,
    gzipBytes: gzipSync(output, { level: 9 }).byteLength,
    minifiedBytes: output.byteLength,
  }
}

const kibibytes = (bytes: number): string => `${(bytes / 1024).toFixed(1)} KiB`
const mebibytes = (bytes: number): string => `${(bytes / (1024 * 1024)).toFixed(1)} MiB`

const packageJsonPath = (packageName: string): string =>
  packageName === 'purejsimage' ? 'package.json' : `node_modules/${packageName}/package.json`

const packageKind = (target: CompetitorBundleTarget): EngineKind =>
  target.implementation === 'native-wrapper'
    ? 'native'
    : target.implementation === 'webassembly'
      ? 'webassembly'
      : 'pure-javascript'

const footprints = new Map<string, PackageFootprint>()
const versions = new Map<string, string>()

const packageDetails = async (
  target: CompetitorBundleTarget,
): Promise<{ footprint: PackageFootprint; version: string }> => {
  const packageNames = target.packageNames ?? [target.packageName]
  const packageVersions: string[] = []
  for (const packageName of packageNames) {
    let version = versions.get(packageName)
    if (!version) {
      version = (await readPackageJson(packageJsonPath(packageName))).version
      versions.set(packageName, version)
    }
    packageVersions.push(version)
  }
  const version =
    packageNames.length === 1
      ? (packageVersions[0] ?? 'unknown')
      : packageNames
          .map((packageName, index) => `${packageName} ${packageVersions[index] ?? 'unknown'}`)
          .join('; ')

  const footprintKey = packageNames.join('\0')
  let footprint = footprints.get(footprintKey)
  if (!footprint) {
    const engine: EngineMetadata = {
      id: target.id,
      version,
      kind: packageKind(target),
      packageName: target.packageName,
      ...(target.packageNames ? { packageNames: target.packageNames } : {}),
    }
    footprint = await measurePackageFootprint({ engine, repositoryDirectory: process.cwd() })
    footprints.set(footprintKey, footprint)
  }
  return { footprint, version }
}

const competitorMeasurements = await Promise.all(competitorBundleTargets.map(measure))

console.log('## Competitor bundle comparison')
console.log('')
console.log(
  '| Import | Version | Codecs in measured import | Minified JS | gzip | Brotli | Installed footprint | Production packages |',
)
console.log('| --- | --- | --- | ---: | ---: | ---: | ---: | ---: |')
for (const measurement of competitorMeasurements) {
  const target = measurement.target
  const { footprint, version } = await packageDetails(target)
  console.log(
    `| ${target.name} | ${version} | ${target.codecs.join(', ')} | ${kibibytes(measurement.minifiedBytes)} | ${kibibytes(measurement.gzipBytes)} | ${kibibytes(measurement.brotliBytes)} | ${mebibytes(footprint.bytes)} | ${footprint.productionPackageCount} |`,
  )
}

console.log('')
console.log(
  'JPEG and PNG are the codecs available in all five compared libraries. PureJsImage and jSquash can assemble that matched set explicitly. The normal public imports for Jimp, image-js, and Sharp include the additional codecs shown rather than offering equivalent codec-level tree shaking.',
)
console.log(
  "Sharp's JavaScript number is only its wrapper. Its installed footprint includes the native addon and this platform's libvips package, so the wrapper size must not be presented as its deployment size.",
)
console.log(
  "jSquash's JavaScript number is its codec and resize glue. Its installed footprint includes the JPEG, PNG, and resize WebAssembly payloads, so the JavaScript number must not be presented as its deployment size.",
)

const entryMeasurements = await Promise.all(pureJsImageEntryTargets.map(measure))
console.log('')
console.log('## PureJsImage entry points')
console.log('')
console.log('| Entry | Minified | gzip | Brotli |')
console.log('| --- | ---: | ---: | ---: |')
for (const measurement of entryMeasurements) {
  console.log(
    `| ${measurement.target.name} | ${kibibytes(measurement.minifiedBytes)} | ${kibibytes(measurement.gzipBytes)} | ${kibibytes(measurement.brotliBytes)} |`,
  )
}
