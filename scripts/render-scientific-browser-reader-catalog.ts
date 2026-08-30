import { readFile, writeFile } from 'node:fs/promises'
import { readCapabilityManifest } from './capability-manifest.ts'

const outputPath = 'src/scientific/browser-reader-catalog.generated.ts'
const checkOnly = process.argv.includes('--check')

interface PackageExportTarget {
  readonly import?: string
  readonly default?: string
}

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

const packageExports = (value: unknown): Readonly<Record<string, PackageExportTarget>> => {
  if (!isRecord(value) || !isRecord(value.exports)) {
    throw new Error('package.json exports must be an object')
  }
  const exports: Record<string, PackageExportTarget> = {}
  for (const [key, target] of Object.entries(value.exports)) {
    if (!isRecord(target)) throw new Error(`Package export ${key} must be an object`)
    const imported = target.import
    const fallback = target.default
    if (imported !== undefined && typeof imported !== 'string') {
      throw new Error(`Package export ${key} import target must be a string`)
    }
    if (fallback !== undefined && typeof fallback !== 'string') {
      throw new Error(`Package export ${key} default target must be a string`)
    }
    exports[key] = {
      ...(imported === undefined ? {} : { import: imported }),
      ...(fallback === undefined ? {} : { default: fallback }),
    }
  }
  return exports
}

const manifest = await readCapabilityManifest()
const parsedPackage: unknown = JSON.parse(await readFile('package.json', 'utf8'))
const exports = packageExports(parsedPackage)

const entries = manifest.scientificReaders.map((reader) => {
  const exportKey = `./${reader.packageExport.slice('purejsimage/'.length)}`
  const target = exports[exportKey]
  const path = target?.import ?? target?.default
  if (path === undefined) throw new Error(`${reader.packageExport} is not exported by package.json`)
  const match = path.match(/^\.\/dist\/scientific\/readers\/([a-z0-9-]+)\.js$/u)
  if (match === null) {
    throw new Error(`${reader.packageExport} has an unexpected browser loader target: ${path}`)
  }
  const moduleName = match[1]
  if (moduleName === undefined) throw new Error(`Missing module name for ${reader.id}`)
  return { reader, moduleName }
})

const source = [
  '// Generated from capabilities/manifest.json and package.json.',
  '// Run npm run scientific:reader-catalog:generate. Do not edit directly.',
  '',
  "import type { ScientificBrowserReaderCatalogEntry } from './browser-reader-catalog.ts'",
  '',
  'const entries: readonly ScientificBrowserReaderCatalogEntry[] =',
  `${JSON.stringify(
    entries.map(({ reader }) => ({
      id: reader.id,
      version: reader.version,
      format: reader.format,
      packageExport: reader.packageExport,
      extensions: reader.extensions,
      mediaTypes: reader.mediaTypes,
      resourceModel: reader.resourceModel,
      datasetKinds: reader.datasetKinds,
      directRangeReads: reader.directRangeReads,
      boundary: reader.boundary,
    })),
    null,
    2,
  )}`,
  '',
  'export const generatedScientificBrowserReaderCatalog = Object.freeze(',
  '  entries.map((entry) => Object.freeze({',
  '    ...entry,',
  '    extensions: Object.freeze(entry.extensions),',
  '    mediaTypes: Object.freeze(entry.mediaTypes),',
  '    datasetKinds: Object.freeze(entry.datasetKinds),',
  '  })),',
  ')',
  '',
  'export const importGeneratedScientificReaderModule = (id: string): Promise<unknown> => {',
  '  switch (id) {',
  ...entries.map(
    ({ reader, moduleName }) =>
      `    case ${JSON.stringify(reader.id)}: return import('./readers/${moduleName}.ts')`,
  ),
  '    default: return Promise.reject(new Error(`Unknown generated scientific reader $' + '{id}`))',
  '  }',
  '}',
  '',
].join('\n')

const current = await readFile(outputPath, 'utf8').catch(() => undefined)
if (checkOnly) {
  if (current !== source) throw new Error(`${outputPath} is stale`)
} else if (current !== source) {
  await writeFile(outputPath, source)
}
