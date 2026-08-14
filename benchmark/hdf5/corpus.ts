import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

export const hdf5CorpusDirectory = 'benchmark/corpus/files/hdf5'
export const hdf5CorpusManifest = 'benchmark/hdf5/corpus.json'

export interface Hdf5CorpusFixture {
  readonly file: string
  readonly path: string
  readonly bytes: number
  readonly sha256: string
  readonly superblockVersion: 0 | 1 | 2 | 3
  readonly objectHeaderVersion: 1 | 2
  readonly rootLinks: readonly string[]
}

export interface Hdf5CorpusManifestValue {
  readonly schemaVersion: 1
  readonly source: {
    readonly project: string
    readonly revision: string
    readonly baseUrl: string
    readonly license: string
    readonly licenseUrl: string
    readonly attribution: string
  }
  readonly fixtures: readonly Hdf5CorpusFixture[]
}

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const requiredString = (record: Readonly<Record<string, unknown>>, key: string): string => {
  const value = record[key]
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`HDF5 corpus field ${key} must be a non-empty string`)
  }
  return value
}

const positiveInteger = (value: unknown, label: string): number => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    throw new Error(`HDF5 corpus field ${label} must be a positive integer`)
  }
  return value
}

const parseSuperblockVersion = (value: unknown): 0 | 1 | 2 | 3 => {
  if (value === 0 || value === 1 || value === 2 || value === 3) return value
  throw new Error('HDF5 corpus superblockVersion is invalid')
}

const parseObjectHeaderVersion = (value: unknown): 1 | 2 => {
  if (value === 1 || value === 2) return value
  throw new Error('HDF5 corpus objectHeaderVersion is invalid')
}

const parseRootLinks = (value: unknown): readonly string[] => {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error('HDF5 corpus rootLinks must be a non-empty array')
  }
  const links = value.map((entry) => {
    if (typeof entry !== 'string' || entry.length === 0) {
      throw new Error('HDF5 corpus root link must be a non-empty string')
    }
    return entry
  })
  if (new Set(links).size !== links.length) {
    throw new Error('HDF5 corpus rootLinks must be unique')
  }
  return Object.freeze(links)
}

const assertCorpusManifest = (value: unknown): Hdf5CorpusManifestValue => {
  if (!isRecord(value) || value.schemaVersion !== 1 || !isRecord(value.source)) {
    throw new Error('HDF5 corpus manifest header is invalid')
  }
  if (!Array.isArray(value.fixtures) || value.fixtures.length === 0) {
    throw new Error('HDF5 corpus manifest must contain fixtures')
  }
  const revision = requiredString(value.source, 'revision')
  const baseUrl = requiredString(value.source, 'baseUrl')
  const parsedUrl = new URL(baseUrl)
  if (
    parsedUrl.protocol !== 'https:' ||
    parsedUrl.hostname !== 'raw.githubusercontent.com' ||
    !parsedUrl.pathname.includes(`/${revision}/`) ||
    !parsedUrl.pathname.endsWith('/')
  ) {
    throw new Error('HDF5 corpus baseUrl must pin the declared revision')
  }
  const fixtures = value.fixtures.map((fixture): Hdf5CorpusFixture => {
    if (!isRecord(fixture)) throw new Error('HDF5 corpus fixture must be an object')
    const file = requiredString(fixture, 'file')
    if (!/^[A-Za-z0-9._-]+$/u.test(file)) {
      throw new Error('HDF5 corpus file must be a direct safe filename')
    }
    const sha256 = fixture.sha256
    if (typeof sha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(sha256)) {
      throw new Error('HDF5 corpus checksum is invalid')
    }
    return Object.freeze({
      file,
      path: requiredString(fixture, 'path'),
      bytes: positiveInteger(fixture.bytes, 'bytes'),
      sha256,
      superblockVersion: parseSuperblockVersion(fixture.superblockVersion),
      objectHeaderVersion: parseObjectHeaderVersion(fixture.objectHeaderVersion),
      rootLinks: parseRootLinks(fixture.rootLinks),
    })
  })
  return Object.freeze({
    schemaVersion: 1,
    source: Object.freeze({
      project: requiredString(value.source, 'project'),
      revision,
      baseUrl,
      license: requiredString(value.source, 'license'),
      licenseUrl: requiredString(value.source, 'licenseUrl'),
      attribution: requiredString(value.source, 'attribution'),
    }),
    fixtures: Object.freeze(fixtures),
  })
}

export const readHdf5CorpusManifest = async (): Promise<Hdf5CorpusManifestValue> => {
  const value: unknown = JSON.parse(await readFile(hdf5CorpusManifest, 'utf8'))
  return assertCorpusManifest(value)
}

export const hdf5CorpusPath = (file: string): string => join(hdf5CorpusDirectory, file)
