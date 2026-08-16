import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  codecPackageExport,
  codecTargetId,
  scientificReaderSourceEntry,
  scientificReaderTargetId,
  type BundleTarget,
} from './bundle-size-config.ts'
import type { CapabilityManifest } from './capability-manifest.ts'

export interface PackageJsonSurface {
  readonly exports: Readonly<Record<string, unknown>>
  readonly name: string
  readonly version: string
}

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const packageExportKey = (packageExport: string): string => {
  const prefix = 'purejsimage/'
  if (packageExport === 'purejsimage') return '.'
  if (!packageExport.startsWith(prefix)) {
    throw new Error(`PureJsImage package export must use the package name: ${packageExport}`)
  }
  return `./${packageExport.slice(prefix.length)}`
}

const sourceReaderSlug = (sourceEntry: string): string => {
  const match = sourceEntry.match(/^\.\/src\/scientific\/readers\/(.+)\.ts$/u)
  if (!match?.[1]) throw new Error(`Invalid scientific reader source entry ${sourceEntry}`)
  return match[1]
}

const sorted = (values: Iterable<string>): readonly string[] => [...values].sort()

const assertEqualSets = (
  actualValues: Iterable<string>,
  expectedValues: Iterable<string>,
  label: string,
): void => {
  const actual = sorted(actualValues)
  const expected = sorted(expectedValues)
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `${label} drift:\nactual: ${actual.join(', ')}\nexpected: ${expected.join(', ')}`,
    )
  }
}

const assertPackageExport = (packageJson: PackageJsonSurface, packageExport: string): void => {
  const key = packageExportKey(packageExport)
  if (!(key in packageJson.exports)) {
    throw new Error(`Package export is missing from package.json: ${packageExport}`)
  }
}

const exportReaderSlugs = (source: string): readonly string[] =>
  [...source.matchAll(/export \* from ['"]\.\/([^'"]+)\.ts['"]/gu)].map((match) => match[1] ?? '')

const importedCodecIds = (source: string): readonly string[] =>
  [...source.matchAll(/from ['"]\.\.\/codecs\/([^'"]+)\.ts['"]/gu)].map((match) => match[1] ?? '')

const targetIds = (targets: readonly BundleTarget[]): ReadonlySet<string> =>
  new Set(targets.map(({ id }) => id))

export const validatePackageAndBundleSurfaces = async ({
  manifest,
  packageJson,
  repositoryDirectory,
  targets,
}: {
  readonly manifest: CapabilityManifest
  readonly packageJson: PackageJsonSurface
  readonly repositoryDirectory: string
  readonly targets: readonly BundleTarget[]
}): Promise<void> => {
  if (packageJson.name !== 'purejsimage') {
    throw new Error(`Expected purejsimage package metadata, found ${packageJson.name}`)
  }

  const ids = targetIds(targets)
  const readerTargetIds = manifest.scientificReaders.map((reader) =>
    scientificReaderTargetId(reader.packageExport),
  )
  const staleReaderTargets = targets
    .filter(({ id }) => id.startsWith('scientific-reader-'))
    .map(({ id }) => id)
  assertEqualSets(staleReaderTargets, readerTargetIds, 'Scientific reader bundle targets')

  for (const reader of manifest.scientificReaders) {
    assertPackageExport(packageJson, reader.packageExport)
    const targetId = scientificReaderTargetId(reader.packageExport)
    if (!ids.has(targetId)) throw new Error(`Scientific reader has no bundle target: ${reader.id}`)
    const sourceEntry = scientificReaderSourceEntry(reader.packageExport)
    const sourcePath = join(repositoryDirectory, sourceEntry.slice(2))
    const source = await readFile(sourcePath, 'utf8').catch(() => undefined)
    if (source === undefined) throw new Error(`Scientific reader source is missing: ${sourceEntry}`)
  }

  assertPackageExport(packageJson, 'purejsimage/scientific/readers/all')
  const allReadersSource = await readFile(
    join(repositoryDirectory, 'src/scientific/readers/all.ts'),
    'utf8',
  )
  assertEqualSets(
    exportReaderSlugs(allReadersSource),
    manifest.scientificReaders.map((reader) =>
      sourceReaderSlug(scientificReaderSourceEntry(reader.packageExport)),
    ),
    'Scientific readers/all exports',
  )

  const publicCodecs = manifest.codecs.filter((codec) => codec.packageFormat !== undefined)
  for (const codec of publicCodecs) {
    assertPackageExport(packageJson, codecPackageExport(codec))
  }
  const stableCodecs = publicCodecs.filter((codec) => !codec.experimental)
  const stableCodecTargetIds = stableCodecs.map(codecTargetId)
  const codecTargetIds = publicCodecs.map(codecTargetId)
  const measuredCodecTargetIds = targets
    .filter(({ id }) => id.startsWith('codec-'))
    .map(({ id }) => id)
  assertEqualSets(measuredCodecTargetIds, codecTargetIds, 'Public codec bundle targets')
  assertEqualSets(
    measuredCodecTargetIds.filter((id) => stableCodecTargetIds.includes(id)),
    stableCodecTargetIds,
    'Stable codec bundle targets',
  )
  const experimentalCodecTargetIds = publicCodecs
    .filter((codec) => codec.experimental)
    .map(codecTargetId)
  assertEqualSets(
    measuredCodecTargetIds.filter(
      (id) => codecTargetIds.includes(id) && !stableCodecTargetIds.includes(id),
    ),
    experimentalCodecTargetIds,
    'Experimental codec bundle targets',
  )
  assertPackageExport(packageJson, 'purejsimage/codecs/all')
  assertPackageExport(packageJson, 'purejsimage/codecs/web')

  const allCodecsSource = await readFile(
    join(repositoryDirectory, 'src/codec-entries/all.ts'),
    'utf8',
  )
  assertEqualSets(
    importedCodecIds(allCodecsSource),
    stableCodecs.map((codec) => codec.id),
    'Stable allCodecs exports',
  )
  if (importedCodecIds(allCodecsSource).includes('heic')) {
    throw new Error('Experimental HEIF/HEIC is present in allCodecs')
  }

  const webCodecsSource = await readFile(
    join(repositoryDirectory, 'src/codec-entries/web.ts'),
    'utf8',
  )
  assertEqualSets(
    importedCodecIds(webCodecsSource),
    ['avif', 'jpeg', 'png', 'webp'],
    'Common allWebCodecs exports',
  )
  if (importedCodecIds(webCodecsSource).includes('heic')) {
    throw new Error('Experimental HEIF/HEIC is present in allWebCodecs')
  }
}

export const parsePackageJsonSurface = (value: unknown): PackageJsonSurface => {
  if (!isRecord(value)) throw new Error('package.json must be an object')
  if (typeof value.name !== 'string' || typeof value.version !== 'string') {
    throw new Error('package.json name and version must be strings')
  }
  if (!isRecord(value.exports)) throw new Error('package.json exports must be an object')
  return { exports: value.exports, name: value.name, version: value.version }
}
