import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const registryPath = resolve(repositoryRoot, 'scripts/dicom/ps3.6-2026c-registry.json')
const generatedPath = resolve(
  repositoryRoot,
  'src/scientific/formats/dicom/dictionary.generated.ts',
)

const checkOnly = process.argv.includes('--check')

interface RegistrySource {
  readonly url: string
  readonly title: string
  readonly publisher: string
  readonly sha256: string
  readonly byteLength: number
  readonly retrieved: string
  readonly lastModified: string
  readonly tables: readonly string[]
}

interface RegistryEntry {
  readonly tag: string
  readonly keyword: string
  readonly vr: readonly string[]
  readonly retired: boolean
}

interface RegistryDocument {
  readonly edition: string
  readonly source: RegistrySource
  readonly entryCount: number
  readonly entries: readonly RegistryEntry[]
}

const isPlainObject = (value: unknown): value is { readonly [key: string]: unknown } =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

const requiredString = (value: unknown, label: string): string => {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${label} must be a non-empty string`)
  }
  return value
}

const requiredNumber = (value: unknown, label: string): number => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative safe integer`)
  }
  return value
}

const requiredStringArray = (value: unknown, label: string): readonly string[] => {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.some((entry) => typeof entry !== 'string')
  ) {
    throw new Error(`${label} must be a non-empty string array`)
  }
  return value
}

const parseRegistry = (value: unknown): RegistryDocument => {
  if (!isPlainObject(value)) throw new Error('DICOM registry must be an object')
  if (!isPlainObject(value.source)) throw new Error('DICOM registry source must be an object')
  if (!Array.isArray(value.entries)) throw new Error('DICOM registry entries must be an array')
  const source: RegistrySource = {
    url: requiredString(value.source.url, 'source.url'),
    title: requiredString(value.source.title, 'source.title'),
    publisher: requiredString(value.source.publisher, 'source.publisher'),
    sha256: requiredString(value.source.sha256, 'source.sha256'),
    byteLength: requiredNumber(value.source.byteLength, 'source.byteLength'),
    retrieved: requiredString(value.source.retrieved, 'source.retrieved'),
    lastModified: requiredString(value.source.lastModified, 'source.lastModified'),
    tables: requiredStringArray(value.source.tables, 'source.tables'),
  }
  const entries: RegistryEntry[] = []
  for (let index = 0; index < value.entries.length; index += 1) {
    const entry = value.entries[index]
    if (!isPlainObject(entry)) throw new Error(`entries[${index}] must be an object`)
    if (typeof entry.retired !== 'boolean')
      throw new Error(`entries[${index}].retired must be boolean`)
    const tag = requiredString(entry.tag, `entries[${index}].tag`)
    if (!/^[0-9A-FX]{4},[0-9A-FX]{4}$/.test(tag)) {
      throw new Error(`entries[${index}].tag is invalid: ${tag}`)
    }
    const keyword = requiredString(entry.keyword, `entries[${index}].keyword`)
    if (!/^[A-Za-z][A-Za-z0-9]*$/.test(keyword)) {
      throw new Error(`entries[${index}].keyword is invalid: ${keyword}`)
    }
    const vr = requiredStringArray(entry.vr, `entries[${index}].vr`)
    if (vr.some((code) => !/^[A-Z]{2}$/.test(code))) {
      throw new Error(`entries[${index}].vr is invalid`)
    }
    entries.push({ tag, keyword, vr, retired: entry.retired })
  }
  const edition = requiredString(value.edition, 'edition')
  const entryCount = requiredNumber(value.entryCount, 'entryCount')
  if (entryCount !== entries.length) {
    throw new Error(`entryCount ${entryCount} does not match ${entries.length} entries`)
  }
  return { edition, source, entryCount, entries }
}

const packLine = (entry: RegistryEntry): string =>
  `${entry.tag}\t${entry.vr.join('/')}\t${entry.keyword}\t${entry.retired ? '1' : '0'}`

const generate = (registry: RegistryDocument): string => {
  const exact: string[] = []
  const patterns: string[] = []
  for (const entry of registry.entries) {
    const line = packLine(entry)
    if (entry.tag.includes('X')) patterns.push(line)
    else exact.push(line)
  }
  exact.sort()
  patterns.sort()
  const packedExact = exact.join('\n')
  const packedPatterns = patterns.join('\n')
  const artifactHash = createHash('sha256')
    .update(packedExact)
    .update('\n')
    .update(packedPatterns)
    .digest('hex')
  return `// Generated from DICOM PS3.6 ${registry.edition}. Do not edit.
export const dicomDictionaryEdition = ${JSON.stringify(registry.edition)} as const

export const dicomDictionarySource = Object.freeze({
  edition: ${JSON.stringify(registry.edition)},
  url: ${JSON.stringify(registry.source.url)},
  title: ${JSON.stringify(registry.source.title)},
  publisher: ${JSON.stringify(registry.source.publisher)},
  sha256: ${JSON.stringify(registry.source.sha256)},
  byteLength: ${registry.source.byteLength},
  retrieved: ${JSON.stringify(registry.source.retrieved)},
  lastModified: ${JSON.stringify(registry.source.lastModified)},
  tables: Object.freeze(${JSON.stringify(registry.source.tables)}),
  entryCount: ${registry.entryCount},
  exactCount: ${exact.length},
  patternCount: ${patterns.length},
  artifactSha256: ${JSON.stringify(artifactHash)},
})

export const dicomDictionaryExactPacked = ${JSON.stringify(packedExact)}

export const dicomDictionaryPatternPacked = ${JSON.stringify(packedPatterns)}
`
}

const registry = parseRegistry(JSON.parse(readFileSync(registryPath, 'utf8')))
const generated = generate(registry)
if (checkOnly) {
  const current = readFileSync(generatedPath, 'utf8')
  if (current !== generated) {
    throw new Error('Generated DICOM dictionary is stale; run npm run dicom:dictionary:generate')
  }
  process.stdout.write(
    `DICOM dictionary ${registry.edition} is current (${registry.entryCount} entries).\n`,
  )
} else {
  writeFileSync(generatedPath, generated)
  process.stdout.write(
    `Wrote ${generatedPath} (${registry.entryCount} entries, ${generated.length} bytes).\n`,
  )
}
