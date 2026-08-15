import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

export const tiaEmiCorpusDirectory = 'benchmark/corpus/files/tia-emi'
export const tiaEmiCorpusManifest = 'benchmark/tia-ser/emi-corpus.json'

export interface TiaEmiCorpusResource {
  readonly file: string
  readonly sha256: string
}

export interface TiaEmiCorpusFixture extends TiaEmiCorpusResource {
  readonly companions: readonly TiaEmiCorpusResource[]
  readonly objectCount: number
  readonly datasetIds: readonly string[]
  readonly metadataUuids: readonly (string | null)[]
  readonly reciprocalAxes: readonly string[]
  readonly preservedConflictAxes: readonly string[]
  readonly read: Readonly<{
    datasetId: string
    kind: 'plane' | 'series'
    fixedIndices: readonly Readonly<{ axisId: string; index: number }>[]
  }>
  readonly expectedHex: string
}

export interface TiaEmiCorpusManifestValue {
  readonly source: Readonly<{
    baseUrl: string
    revision: string
  }>
  readonly fixtures: readonly TiaEmiCorpusFixture[]
}

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const requiredString = (record: Readonly<Record<string, unknown>>, key: string): string => {
  const value = record[key]
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`TIA EMI corpus field ${key} must be a non-empty string`)
  }
  return value
}

const stringArray = (value: unknown, label: string): readonly string[] => {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    throw new Error(`TIA EMI corpus ${label} must be a string array`)
  }
  return Object.freeze(value)
}

const corpusRelativePath = (value: string): string => {
  if (value.startsWith('/') || value.includes('\\') || /^[a-z][a-z0-9+.-]*:/iu.test(value)) {
    throw new Error('TIA EMI corpus file must be a relative POSIX path')
  }
  const segments = value.split('/')
  if (segments.some((segment) => segment.length === 0 || segment === '.' || segment === '..')) {
    throw new Error('TIA EMI corpus file must not contain empty or traversal segments')
  }
  return value
}

const resource = (value: unknown): TiaEmiCorpusResource => {
  if (!isRecord(value)) throw new Error('TIA EMI corpus resource must be an object')
  const sha256 = requiredString(value, 'sha256')
  if (!/^[a-f0-9]{64}$/u.test(sha256)) throw new Error('TIA EMI corpus checksum is invalid')
  return Object.freeze({ file: corpusRelativePath(requiredString(value, 'file')), sha256 })
}

const manifestValue = (value: unknown): TiaEmiCorpusManifestValue => {
  if (!isRecord(value) || value.schemaVersion !== 1 || !isRecord(value.source)) {
    throw new Error('TIA EMI corpus manifest header is invalid')
  }
  const revision = requiredString(value.source, 'revision')
  const baseUrl = requiredString(value.source, 'baseUrl')
  const parsed = new URL(baseUrl)
  if (
    parsed.protocol !== 'https:' ||
    parsed.hostname !== 'raw.githubusercontent.com' ||
    !parsed.pathname.includes(`/${revision}/`)
  ) {
    throw new Error('TIA EMI corpus source must be revision-pinned GitHub content')
  }
  if (!Array.isArray(value.fixtures) || value.fixtures.length === 0) {
    throw new Error('TIA EMI corpus fixtures must be a non-empty array')
  }
  const fixtures = value.fixtures.map((entry): TiaEmiCorpusFixture => {
    if (!isRecord(entry)) throw new Error('TIA EMI corpus fixture must be an object')
    const primary = resource(entry)
    if (!Array.isArray(entry.companions) || entry.companions.length === 0) {
      throw new Error('TIA EMI corpus fixture companions must be non-empty')
    }
    if (!Array.isArray(entry.metadataUuids)) {
      throw new Error('TIA EMI corpus metadataUuids must be an array')
    }
    const metadataUuids = entry.metadataUuids.map((uuid) => {
      if (uuid !== null && typeof uuid !== 'string') {
        throw new Error('TIA EMI corpus metadata UUID must be a string or null')
      }
      return uuid
    })
    if (!isRecord(entry.read) || (entry.read.kind !== 'plane' && entry.read.kind !== 'series')) {
      throw new Error('TIA EMI corpus read is invalid')
    }
    if (!Array.isArray(entry.read.fixedIndices)) {
      throw new Error('TIA EMI corpus fixedIndices must be an array')
    }
    const fixedIndices = entry.read.fixedIndices.map((fixed) => {
      if (!isRecord(fixed) || !Number.isSafeInteger(fixed.index) || Number(fixed.index) < 0) {
        throw new Error('TIA EMI corpus fixed index is invalid')
      }
      return Object.freeze({ axisId: requiredString(fixed, 'axisId'), index: Number(fixed.index) })
    })
    const objectCount = entry.objectCount
    if (!Number.isSafeInteger(objectCount) || Number(objectCount) < 1) {
      throw new Error('TIA EMI corpus objectCount must be positive')
    }
    const expectedHex = requiredString(entry, 'expectedHex')
    if (!/^(?:[a-f0-9]{2})+$/u.test(expectedHex)) {
      throw new Error('TIA EMI corpus expectedHex is invalid')
    }
    return Object.freeze({
      ...primary,
      companions: Object.freeze(entry.companions.map(resource)),
      objectCount: Number(objectCount),
      datasetIds: stringArray(entry.datasetIds, 'datasetIds'),
      metadataUuids: Object.freeze(metadataUuids),
      reciprocalAxes: stringArray(entry.reciprocalAxes ?? [], 'reciprocalAxes'),
      preservedConflictAxes: stringArray(
        entry.preservedConflictAxes ?? [],
        'preservedConflictAxes',
      ),
      read: Object.freeze({
        datasetId: requiredString(entry.read, 'datasetId'),
        kind: entry.read.kind,
        fixedIndices: Object.freeze(fixedIndices),
      }),
      expectedHex,
    })
  })
  return Object.freeze({
    source: Object.freeze({ baseUrl, revision }),
    fixtures: Object.freeze(fixtures),
  })
}

export const readTiaEmiCorpusManifest = async (): Promise<TiaEmiCorpusManifestValue> =>
  manifestValue(JSON.parse(await readFile(tiaEmiCorpusManifest, 'utf8')))

export const tiaEmiCorpusPath = (file: string): string => join(tiaEmiCorpusDirectory, file)
