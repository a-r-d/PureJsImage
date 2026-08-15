import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { brotliCompressSync, constants, gzipSync } from 'node:zlib'
import { build } from 'esbuild'
import { measurePackageFootprint } from '../benchmark/lib/package-footprint.ts'
import type { EngineKind, EngineMetadata, PackageFootprint } from '../benchmark/types.ts'
import {
  codecPackageExport,
  codecTargetId,
  createCompetitorBundleTargets,
  createPureJsImageEntryTargets,
  scientificReaderTargetId,
  type BundleTarget,
  type CompetitorBundleTarget,
  type WasmAssetTarget,
  wasmAssetTargets,
} from './bundle-size-config.ts'
import {
  readCapabilityManifest,
  type CapabilityManifest,
  type ScientificReaderCapability,
} from './capability-manifest.ts'
import {
  parsePackageJsonSurface,
  validatePackageAndBundleSurfaces,
  type PackageJsonSurface,
} from './validate-package-surfaces.ts'

export type { BundleTarget, CompetitorBundleTarget }

export interface PackageVersion {
  readonly name: string
  readonly version: string
}

export interface BundleEntry {
  readonly packageExports?: readonly string[]
  readonly sourceEntries?: readonly string[]
}

export interface PackageMetric {
  readonly category: 'competitor' | 'purejsimage-entry'
  readonly codecs?: readonly string[]
  readonly configuredCeilingMinifiedBytes: number | null
  readonly entry: BundleEntry
  readonly gzipBytes: number
  readonly id: string
  readonly implementation: BundleTarget['implementation']
  /** Bytes occupied by the package after npm extracts it. This is not the compressed .tgz size. */
  readonly unpackedPackageBytes: number
  readonly minifiedJsBytes: number
  readonly name: string
  readonly packageVersions: readonly PackageVersion[]
  readonly productionPackageCount: number
  readonly recordedBaselineMinifiedBytes: number | null
  readonly brotliBytes: number
}

export interface WasmAssetMetric {
  readonly brotliBytes: number
  readonly gzipBytes: number
  readonly id: string
  readonly name: string
  readonly rawBytes: number
  readonly sourceEntry: string
}

export interface CodecMetric {
  readonly experimental: boolean
  readonly id: string
  readonly name: string
  readonly packageExport: string
  readonly readLabel: string
  readonly readStatus: string
  readonly targetId: string
  readonly writeLabel: string
  readonly writeStatus: string
}

export interface ScientificReaderMetric {
  readonly demoWired: boolean
  readonly family: string
  readonly format: string
  readonly id: string
  readonly packageExport: string
  readonly targetId: string
}

export interface ScientificReaderGroup {
  readonly id: string
  readonly label: string
  readonly readerIds: readonly string[]
}

export interface PackageMetricsDocument {
  readonly codecs: readonly CodecMetric[]
  readonly liveDemoReaderIds: readonly string[]
  readonly package: {
    readonly name: string
    readonly version: string
  }
  readonly schemaVersion: 2
  readonly scientificReaderGroups: readonly ScientificReaderGroup[]
  readonly scientificReaders: readonly ScientificReaderMetric[]
  readonly targets: readonly PackageMetric[]
  readonly wasmAssets: readonly WasmAssetMetric[]
}

export const packageMetricsPath = 'benchmark/generated/package-metrics.json'
export const docsPackageMetricsPath = 'docs-astro/src/data/package-metrics.json'

export const liveDemoReaderIds: readonly string[] = [
  'purejsimage/gsf',
  'purejsimage/envi',
  'purejsimage/fits',
  'purejsimage/mrc',
  'purejsimage/cbf',
]

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const stringOf = (value: unknown, label: string): string => {
  if (typeof value !== 'string') throw new Error(`${label} must be a string`)
  return value
}

const numberOf = (value: unknown, label: string): number => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative safe integer`)
  }
  return value
}

const nullableNumberOf = (value: unknown, label: string): number | null =>
  value === null ? null : numberOf(value, label)

const stringArrayOf = (value: unknown, label: string): readonly string[] => {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`)
  return value.map((entry, index) => stringOf(entry, `${label}[${index}]`))
}

const implementationOf = (value: unknown, label: string): BundleTarget['implementation'] => {
  const implementation = stringOf(value, label)
  if (
    implementation !== 'native-wrapper' &&
    implementation !== 'package-core' &&
    implementation !== 'pure-javascript' &&
    implementation !== 'webassembly'
  ) {
    throw new Error(`${label} has unknown implementation ${implementation}`)
  }
  return implementation
}

const categoryOf = (value: unknown, label: string): PackageMetric['category'] => {
  const category = stringOf(value, label)
  if (category !== 'competitor' && category !== 'purejsimage-entry') {
    throw new Error(`${label} has unknown category ${category}`)
  }
  return category
}

const parsePackageVersions = (value: unknown, label: string): readonly PackageVersion[] => {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`)
  return value.map((entry, index) => {
    if (!isRecord(entry)) throw new Error(`${label}[${index}] must be an object`)
    return {
      name: stringOf(entry.name, `${label}[${index}].name`),
      version: stringOf(entry.version, `${label}[${index}].version`),
    }
  })
}

const parseEntry = (value: unknown, label: string): BundleEntry => {
  if (!isRecord(value)) throw new Error(`${label} must be an object`)
  const sourceEntries =
    value.sourceEntries === undefined
      ? undefined
      : stringArrayOf(value.sourceEntries, `${label}.sourceEntries`)
  const packageExports =
    value.packageExports === undefined
      ? undefined
      : stringArrayOf(value.packageExports, `${label}.packageExports`)
  if (sourceEntries === undefined && packageExports === undefined) {
    throw new Error(`${label} must contain sourceEntries or packageExports`)
  }
  return {
    ...(packageExports === undefined ? {} : { packageExports }),
    ...(sourceEntries === undefined ? {} : { sourceEntries }),
  }
}

const parseTarget = (value: unknown, index: number): PackageMetric => {
  const label = `targets[${index}]`
  if (!isRecord(value)) throw new Error(`${label} must be an object`)
  const codecs =
    value.codecs === undefined ? undefined : stringArrayOf(value.codecs, `${label}.codecs`)
  return {
    category: categoryOf(value.category, `${label}.category`),
    ...(codecs === undefined ? {} : { codecs }),
    configuredCeilingMinifiedBytes: nullableNumberOf(
      value.configuredCeilingMinifiedBytes,
      `${label}.configuredCeilingMinifiedBytes`,
    ),
    entry: parseEntry(value.entry, `${label}.entry`),
    gzipBytes: numberOf(value.gzipBytes, `${label}.gzipBytes`),
    id: stringOf(value.id, `${label}.id`),
    implementation: implementationOf(value.implementation, `${label}.implementation`),
    unpackedPackageBytes: numberOf(value.unpackedPackageBytes, `${label}.unpackedPackageBytes`),
    minifiedJsBytes: numberOf(value.minifiedJsBytes, `${label}.minifiedJsBytes`),
    name: stringOf(value.name, `${label}.name`),
    packageVersions: parsePackageVersions(value.packageVersions, `${label}.packageVersions`),
    productionPackageCount: numberOf(
      value.productionPackageCount,
      `${label}.productionPackageCount`,
    ),
    recordedBaselineMinifiedBytes: nullableNumberOf(
      value.recordedBaselineMinifiedBytes,
      `${label}.recordedBaselineMinifiedBytes`,
    ),
    brotliBytes: numberOf(value.brotliBytes, `${label}.brotliBytes`),
  }
}

const parseWasmAsset = (value: unknown, index: number): WasmAssetMetric => {
  const label = `wasmAssets[${index}]`
  if (!isRecord(value)) throw new Error(`${label} must be an object`)
  return {
    brotliBytes: numberOf(value.brotliBytes, `${label}.brotliBytes`),
    gzipBytes: numberOf(value.gzipBytes, `${label}.gzipBytes`),
    id: stringOf(value.id, `${label}.id`),
    name: stringOf(value.name, `${label}.name`),
    rawBytes: numberOf(value.rawBytes, `${label}.rawBytes`),
    sourceEntry: stringOf(value.sourceEntry, `${label}.sourceEntry`),
  }
}

const parseCodec = (value: unknown, index: number): CodecMetric => {
  const label = `codecs[${index}]`
  if (!isRecord(value)) throw new Error(`${label} must be an object`)
  if (typeof value.experimental !== 'boolean') {
    throw new Error(`${label}.experimental must be boolean`)
  }
  return {
    experimental: value.experimental,
    id: stringOf(value.id, `${label}.id`),
    name: stringOf(value.name, `${label}.name`),
    packageExport: stringOf(value.packageExport, `${label}.packageExport`),
    readLabel: stringOf(value.readLabel, `${label}.readLabel`),
    readStatus: stringOf(value.readStatus, `${label}.readStatus`),
    targetId: stringOf(value.targetId, `${label}.targetId`),
    writeLabel: stringOf(value.writeLabel, `${label}.writeLabel`),
    writeStatus: stringOf(value.writeStatus, `${label}.writeStatus`),
  }
}

const parseScientificReader = (value: unknown, index: number): ScientificReaderMetric => {
  const label = `scientificReaders[${index}]`
  if (!isRecord(value)) throw new Error(`${label} must be an object`)
  if (typeof value.demoWired !== 'boolean') throw new Error(`${label}.demoWired must be boolean`)
  return {
    demoWired: value.demoWired,
    family: stringOf(value.family, `${label}.family`),
    format: stringOf(value.format, `${label}.format`),
    id: stringOf(value.id, `${label}.id`),
    packageExport: stringOf(value.packageExport, `${label}.packageExport`),
    targetId: stringOf(value.targetId, `${label}.targetId`),
  }
}

const parseScientificReaderGroup = (value: unknown, index: number): ScientificReaderGroup => {
  const label = `scientificReaderGroups[${index}]`
  if (!isRecord(value)) throw new Error(`${label} must be an object`)
  return {
    id: stringOf(value.id, `${label}.id`),
    label: stringOf(value.label, `${label}.label`),
    readerIds: stringArrayOf(value.readerIds, `${label}.readerIds`),
  }
}

export const parsePackageMetrics = (value: unknown): PackageMetricsDocument => {
  if (!isRecord(value)) throw new Error('Package metrics must be an object')
  if (value.schemaVersion !== 2) throw new Error('Package metrics schemaVersion must be 2')
  if (!isRecord(value.package)) throw new Error('Package metrics package must be an object')
  if (!Array.isArray(value.targets)) throw new Error('Package metrics targets must be an array')
  if (!Array.isArray(value.wasmAssets))
    throw new Error('Package metrics wasmAssets must be an array')
  if (!Array.isArray(value.codecs)) throw new Error('Package metrics codecs must be an array')
  if (!Array.isArray(value.scientificReaders)) {
    throw new Error('Package metrics scientificReaders must be an array')
  }
  if (!Array.isArray(value.scientificReaderGroups)) {
    throw new Error('Package metrics scientificReaderGroups must be an array')
  }
  const targets = value.targets.map(parseTarget)
  if (new Set(targets.map(({ id }) => id)).size !== targets.length) {
    throw new Error('Package metrics target IDs must be unique')
  }
  return {
    codecs: value.codecs.map(parseCodec),
    liveDemoReaderIds: stringArrayOf(value.liveDemoReaderIds, 'liveDemoReaderIds'),
    package: {
      name: stringOf(value.package.name, 'package.name'),
      version: stringOf(value.package.version, 'package.version'),
    },
    schemaVersion: 2,
    scientificReaderGroups: value.scientificReaderGroups.map(parseScientificReaderGroup),
    scientificReaders: value.scientificReaders.map(parseScientificReader),
    targets,
    wasmAssets: value.wasmAssets.map(parseWasmAsset),
  }
}

const packageJsonPath = (repositoryDirectory: string, packageName: string): string =>
  packageName === 'purejsimage'
    ? join(repositoryDirectory, 'package.json')
    : join(repositoryDirectory, 'node_modules', ...packageName.split('/'), 'package.json')

const readPackageJson = async (path: string): Promise<unknown> =>
  JSON.parse(await readFile(path, 'utf8'))

const readPackageSurface = async (repositoryDirectory: string): Promise<PackageJsonSurface> =>
  parsePackageJsonSurface(await readPackageJson(join(repositoryDirectory, 'package.json')))

const packageDetails = async (
  target: BundleTarget,
  repositoryDirectory: string,
  footprintCache: Map<string, PackageFootprint>,
  versionCache: Map<string, string>,
): Promise<{ footprint: PackageFootprint; version: string }> => {
  const packageNames = target.packageNames ?? [target.packageName]
  const packageVersions: string[] = []
  for (const packageName of packageNames) {
    let version = versionCache.get(packageName)
    if (version === undefined) {
      const parsed = await readPackageJson(packageJsonPath(repositoryDirectory, packageName))
      if (!isRecord(parsed) || typeof parsed.version !== 'string') {
        throw new Error(`Invalid installed package metadata: ${packageName}`)
      }
      version = parsed.version
      versionCache.set(packageName, version)
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
  let footprint = footprintCache.get(footprintKey)
  if (footprint === undefined) {
    const engine: EngineMetadata = {
      id: target.id,
      version,
      kind:
        target.implementation === 'native-wrapper'
          ? 'native'
          : target.implementation === 'webassembly'
            ? 'webassembly'
            : 'pure-javascript',
      packageName: target.packageName,
      ...(target.packageNames === undefined ? {} : { packageNames: target.packageNames }),
    }
    footprint = await measurePackageFootprint({ engine, repositoryDirectory })
    footprintCache.set(footprintKey, footprint)
  }
  return { footprint, version }
}

const measureBundle = async (
  target: BundleTarget,
  repositoryDirectory: string,
): Promise<{ brotliBytes: number; gzipBytes: number; minifiedBytes: number }> => {
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
      resolveDir: repositoryDirectory,
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
    brotliBytes: brotliCompressSync(output, {
      params: { [constants.BROTLI_PARAM_QUALITY]: 11 },
    }).byteLength,
    gzipBytes: gzipSync(output, { level: 9 }).byteLength,
    minifiedBytes: output.byteLength,
  }
}

const measureWasmAsset = async (
  target: WasmAssetTarget,
  repositoryDirectory: string,
): Promise<WasmAssetMetric> => {
  const bytes = await readFile(join(repositoryDirectory, target.sourceEntry))
  return {
    brotliBytes: brotliCompressSync(bytes, {
      params: { [constants.BROTLI_PARAM_QUALITY]: 11 },
    }).byteLength,
    gzipBytes: gzipSync(bytes, { level: 9 }).byteLength,
    id: target.id,
    name: target.name,
    rawBytes: bytes.byteLength,
    sourceEntry: target.sourceEntry,
  }
}

const packageVersions = (footprint: PackageFootprint): readonly PackageVersion[] =>
  footprint.packages.map((specifier) => {
    const separator = specifier.lastIndexOf('@')
    if (separator <= 0 || separator === specifier.length - 1) {
      throw new Error(`Invalid installed package version ${specifier}`)
    }
    return { name: specifier.slice(0, separator), version: specifier.slice(separator + 1) }
  })

const targetEntry = (target: BundleTarget): BundleEntry => ({
  ...(target.packageExports === undefined && target.packageExport === undefined
    ? {}
    : {
        packageExports:
          target.packageExports ??
          (target.packageExport === undefined ? [] : [target.packageExport]),
      }),
  ...(target.sourceEntries === undefined ? {} : { sourceEntries: target.sourceEntries }),
})

const targetMetric = async (
  target: BundleTarget,
  repositoryDirectory: string,
  footprintCache: Map<string, PackageFootprint>,
  versionCache: Map<string, string>,
): Promise<PackageMetric> => {
  const [bundle, details] = await Promise.all([
    measureBundle(target, repositoryDirectory),
    packageDetails(target, repositoryDirectory, footprintCache, versionCache),
  ])
  return {
    category: target.category,
    ...(target.codecs === undefined ? {} : { codecs: target.codecs }),
    configuredCeilingMinifiedBytes: target.maxMinifiedBytes ?? null,
    entry: targetEntry(target),
    gzipBytes: bundle.gzipBytes,
    id: target.id,
    implementation: target.implementation,
    unpackedPackageBytes: details.footprint.bytes,
    minifiedJsBytes: bundle.minifiedBytes,
    name: target.name,
    packageVersions: packageVersions(details.footprint),
    productionPackageCount: details.footprint.productionPackageCount,
    recordedBaselineMinifiedBytes: target.baselineMinifiedBytes ?? null,
    brotliBytes: bundle.brotliBytes,
  }
}

const readerFamily = (reader: ScientificReaderCapability): string => {
  if (reader.datasetKinds.includes('surface')) return 'Surface and metrology'
  if (
    reader.datasetKinds.includes('spectrum') ||
    reader.datasetKinds.includes('spectrum-image') ||
    reader.datasetKinds.includes('orientation-map')
  ) {
    return 'Spectroscopy and instrument data'
  }
  if (reader.datasetKinds.includes('pyramid')) return 'Microscopy and whole-slide data'
  if (['PNG', 'JPEG', 'WebP', 'BMP', 'JPEG 2000 / JP2'].includes(reader.format)) {
    return 'Ordinary image adapters'
  }
  return 'Scientific images and volumes'
}

const readerGroups = (
  readers: readonly ScientificReaderMetric[],
): readonly ScientificReaderGroup[] => {
  const order = [
    'Surface and metrology',
    'Spectroscopy and instrument data',
    'Microscopy and whole-slide data',
    'Scientific images and volumes',
    'Ordinary image adapters',
  ] as const
  return order.flatMap((label) => {
    const groupReaders = readers.filter((reader) => reader.family === label)
    if (groupReaders.length === 0) return []
    return [
      {
        id: label.toLowerCase().replaceAll(/[^a-z0-9]+/gu, '-'),
        label,
        readerIds: groupReaders.map(({ id }) => id),
      },
    ]
  })
}

const scientificReaderMetrics = (
  manifest: CapabilityManifest,
): readonly ScientificReaderMetric[] => {
  const demoIds = new Set(liveDemoReaderIds)
  const metrics = manifest.scientificReaders.map((reader) => ({
    demoWired: demoIds.has(reader.id),
    family: readerFamily(reader),
    format: reader.format,
    id: reader.id,
    packageExport: reader.packageExport,
    targetId: scientificReaderTargetId(reader.packageExport),
  }))
  const unknownDemoIds = liveDemoReaderIds.filter(
    (id) => !metrics.some((reader) => reader.id === id),
  )
  if (unknownDemoIds.length > 0) {
    throw new Error(`Scientific demo references unknown readers: ${unknownDemoIds.join(', ')}`)
  }
  return metrics
}

const codecMetrics = (manifest: CapabilityManifest): readonly CodecMetric[] =>
  manifest.codecs
    .filter((codec) => codec.packageFormat !== undefined)
    .map((codec) => ({
      experimental: codec.experimental,
      id: codec.id,
      name: codec.name,
      packageExport: codecPackageExport(codec),
      readLabel: codec.read.label,
      readStatus: codec.read.status,
      targetId: codecTargetId(codec),
      writeLabel: codec.write.label,
      writeStatus: codec.write.status,
    }))

const enforceCeilings = (targets: readonly PackageMetric[]): void => {
  const oversized = targets.filter(
    (target) =>
      target.configuredCeilingMinifiedBytes !== null &&
      target.minifiedJsBytes > target.configuredCeilingMinifiedBytes,
  )
  if (oversized.length > 0) {
    throw new Error(
      oversized
        .map(
          (target) =>
            `${target.name} is ${target.minifiedJsBytes} minified bytes; limit is ${target.configuredCeilingMinifiedBytes}`,
        )
        .join('\n'),
    )
  }
}

export const measurePackageMetrics = async (
  repositoryDirectory = process.cwd(),
): Promise<PackageMetricsDocument> => {
  const [manifest, packageJson] = await Promise.all([
    readCapabilityManifest(join(repositoryDirectory, 'capabilities/manifest.json')),
    readPackageSurface(repositoryDirectory),
  ])
  const pureTargets = createPureJsImageEntryTargets(manifest)
  const competitorTargets = createCompetitorBundleTargets(manifest)
  await validatePackageAndBundleSurfaces({
    manifest,
    packageJson,
    repositoryDirectory,
    targets: [...pureTargets, ...competitorTargets],
  })
  const footprintCache = new Map<string, PackageFootprint>()
  const versionCache = new Map<string, string>()
  const targets = await Promise.all(
    [...pureTargets, ...competitorTargets].map((target) =>
      targetMetric(target, repositoryDirectory, footprintCache, versionCache),
    ),
  )
  enforceCeilings(targets)
  const scientificReaders = scientificReaderMetrics(manifest)
  const codecs = codecMetrics(manifest)
  const wasmAssets = await Promise.all(
    wasmAssetTargets.map((target) => measureWasmAsset(target, repositoryDirectory)),
  )
  return {
    codecs,
    liveDemoReaderIds,
    package: { name: packageJson.name, version: packageJson.version },
    schemaVersion: 2,
    scientificReaderGroups: readerGroups(scientificReaders),
    scientificReaders,
    targets,
    wasmAssets,
  }
}

const json = (metrics: PackageMetricsDocument): string => `${JSON.stringify(metrics, null, 2)}\n`

export const writePackageMetrics = async (
  metrics: PackageMetricsDocument,
  repositoryDirectory = process.cwd(),
): Promise<void> => {
  const content = json(metrics)
  const paths = [
    join(repositoryDirectory, packageMetricsPath),
    join(repositoryDirectory, docsPackageMetricsPath),
  ]
  await mkdir(join(repositoryDirectory, 'benchmark/generated'), { recursive: true })
  await Promise.all(paths.map((path) => writeFile(path, content)))
}

export const readPackageMetrics = async (
  path = packageMetricsPath,
): Promise<PackageMetricsDocument> => parsePackageMetrics(JSON.parse(await readFile(path, 'utf8')))

export const serializePackageMetrics = json

export const packageMetricById = (metrics: PackageMetricsDocument, id: string): PackageMetric => {
  const target = metrics.targets.find((candidate) => candidate.id === id)
  if (target === undefined) throw new Error(`Package metrics target is missing: ${id}`)
  return target
}

export const formatKibibytes = (bytes: number): string => `${(bytes / 1024).toFixed(1)} KiB`
export const formatMebibytes = (bytes: number): string =>
  `${(bytes / (1024 * 1024)).toFixed(1)} MiB`

export const packageVersionLabel = (target: PackageMetric): string =>
  target.packageVersions.map(({ name, version }) => `${name} ${version}`).join('; ')

export const targetPackageExport = (target: PackageMetric): string => {
  const packageExports = target.entry.packageExports
  if (packageExports !== undefined && packageExports.length > 0) {
    return packageExports.join('; ')
  }
  return target.entry.sourceEntries?.join(' + ') ?? 'unknown'
}

export const implementationLabel = (implementation: BundleTarget['implementation']): string =>
  implementation === 'native-wrapper'
    ? 'Native wrapper'
    : implementation === 'webassembly'
      ? 'WebAssembly'
      : implementation === 'package-core'
        ? 'Package core'
        : 'Pure JavaScript'

export const packageMetricPackageVersions = (
  metrics: PackageMetricsDocument,
): readonly PackageVersion[] => {
  const versions = new Map<string, string>()
  for (const target of metrics.targets) {
    for (const packageVersion of target.packageVersions) {
      const key = `${packageVersion.name}@${packageVersion.version}`
      versions.set(key, packageVersion.version)
    }
  }
  return [...versions.keys()].sort().map((key) => {
    const separator = key.lastIndexOf('@')
    return { name: key.slice(0, separator), version: versions.get(key) ?? '' }
  })
}

export const engineKindForTarget = (target: CompetitorBundleTarget): EngineKind =>
  target.implementation === 'native-wrapper'
    ? 'native'
    : target.implementation === 'webassembly'
      ? 'webassembly'
      : 'pure-javascript'
