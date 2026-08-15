import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

export const hdf5CorpusDirectory = 'benchmark/corpus/files/hdf5'
export const hdf5CorpusManifest = 'benchmark/hdf5/corpus.json'

interface Hdf5CorpusFixtureBase {
  readonly file: string
  readonly path: string
  readonly bytes: number
  readonly sha256: string
  readonly superblockVersion: 0 | 1 | 2 | 3
  readonly objectHeaderVersion: 1 | 2
}

export interface Hdf5LegacyCorpusFixture extends Hdf5CorpusFixtureBase {
  readonly storage: 'legacy'
  readonly rootLinks: readonly string[]
}

export interface Hdf5DenseCorpusFixture extends Hdf5CorpusFixtureBase {
  readonly storage: 'dense'
  readonly unsupportedLink: string
}

export interface Hdf5DatasetCorpusExpectation {
  readonly path: string
  readonly layout: 'compact' | 'contiguous' | 'chunked'
  readonly dimensions: readonly number[]
  readonly chunkDimensions?: readonly number[]
  readonly datatype: Hdf5DatatypeCorpusExpectation
  readonly elementBytes: number
  readonly logicalBytes: number
  readonly fillStatus: 'default-zero' | 'undefined' | 'defined'
  readonly filterIds?: readonly number[]
  readonly sample?: Hdf5DatasetSampleExpectation
}

export type Hdf5DatatypeCorpusExpectation =
  | { readonly kind: 'integer' | 'float' | 'fixed-string' }
  | {
      readonly kind: 'enum'
      readonly members: readonly Readonly<{ readonly name: string; readonly value: string }>[]
    }
  | {
      readonly kind: 'compound'
      readonly members: readonly Readonly<{
        readonly name: string
        readonly offset: number
        readonly kind: 'integer' | 'float' | 'fixed-string' | 'enum'
        readonly elementBytes: number
      }>[]
    }

export interface Hdf5DatasetSampleExpectation {
  readonly elementOffset: number
  readonly rawHex: string
}

export interface Hdf5DatasetCorpusFixture extends Hdf5CorpusFixtureBase {
  readonly storage: 'datasets'
  readonly datasets: readonly Hdf5DatasetCorpusExpectation[]
}

export type Hdf5CorpusFixture =
  | Hdf5LegacyCorpusFixture
  | Hdf5DenseCorpusFixture
  | Hdf5DatasetCorpusFixture

export interface Hdf5CorpusManifestValue {
  readonly schemaVersion: 5
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

const nonNegativeInteger = (value: unknown, label: string): number => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`HDF5 corpus field ${label} must be a non-negative integer`)
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

const parseStorage = (value: unknown): 'legacy' | 'dense' | 'datasets' => {
  if (value === 'legacy' || value === 'dense' || value === 'datasets') return value
  throw new Error('HDF5 corpus storage is invalid')
}

const parsePositiveIntegerArray = (value: unknown, label: string): readonly number[] => {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`HDF5 corpus ${label} must be a non-empty array`)
  }
  return Object.freeze(value.map((entry) => positiveInteger(entry, label)))
}

const parseFilterIds = (value: unknown): readonly number[] => {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error('HDF5 corpus filterIds must be a non-empty array')
  }
  return Object.freeze(
    value.map((filterId) => {
      const id = nonNegativeInteger(filterId, 'filter ID')
      if (id > 0xffff) throw new Error('HDF5 corpus filter ID exceeds 65535')
      return id
    }),
  )
}

const parseDatatypeExpectation = (value: unknown): Hdf5DatatypeCorpusExpectation => {
  if (!isRecord(value)) throw new Error('HDF5 corpus datatype must be an object')
  const kind = value.kind
  if (kind === 'integer' || kind === 'float' || kind === 'fixed-string') {
    return Object.freeze({ kind })
  }
  if (kind !== 'enum' && kind !== 'compound') {
    throw new Error('HDF5 corpus datatype kind is invalid')
  }
  if (!Array.isArray(value.members) || value.members.length === 0) {
    throw new Error('HDF5 corpus datatype members must be a non-empty array')
  }
  const names = new Set<string>()
  if (kind === 'enum') {
    const members = value.members.map((member) => {
      if (!isRecord(member)) throw new Error('HDF5 corpus enum member must be an object')
      const name = requiredString(member, 'name')
      const rawValue = requiredString(member, 'value')
      if (names.has(name) || !/^-?(?:0|[1-9][0-9]*)$/u.test(rawValue)) {
        throw new Error('HDF5 corpus enum member name or value is invalid')
      }
      names.add(name)
      return Object.freeze({ name, value: rawValue })
    })
    return Object.freeze({ kind, members: Object.freeze(members) })
  }
  const members = value.members.map((member) => {
    if (!isRecord(member)) throw new Error('HDF5 corpus compound member must be an object')
    const name = requiredString(member, 'name')
    const memberKind = member.kind
    if (
      names.has(name) ||
      (memberKind !== 'integer' &&
        memberKind !== 'float' &&
        memberKind !== 'fixed-string' &&
        memberKind !== 'enum')
    ) {
      throw new Error('HDF5 corpus compound member name or kind is invalid')
    }
    names.add(name)
    return Object.freeze({
      name,
      offset: nonNegativeInteger(member.offset, 'member offset'),
      kind: memberKind,
      elementBytes: positiveInteger(member.elementBytes, 'member elementBytes'),
    })
  })
  return Object.freeze({ kind, members: Object.freeze(members) })
}

const parseSampleExpectation = (
  value: unknown,
  elementBytes: number,
): Hdf5DatasetSampleExpectation | undefined => {
  if (value === undefined) return undefined
  if (!isRecord(value)) throw new Error('HDF5 corpus sample must be an object')
  const rawHex = requiredString(value, 'rawHex')
  if (!/^(?:[a-f0-9]{2})+$/u.test(rawHex) || rawHex.length % (elementBytes * 2) !== 0) {
    throw new Error('HDF5 corpus sample rawHex must contain complete elements')
  }
  return Object.freeze({
    elementOffset: nonNegativeInteger(value.elementOffset, 'sample elementOffset'),
    rawHex,
  })
}

const parseDatasetExpectations = (value: unknown): readonly Hdf5DatasetCorpusExpectation[] => {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error('HDF5 corpus datasets must be a non-empty array')
  }
  const paths = new Set<string>()
  return Object.freeze(
    value.map((entry): Hdf5DatasetCorpusExpectation => {
      if (!isRecord(entry)) throw new Error('HDF5 corpus dataset must be an object')
      const path = requiredString(entry, 'path')
      if (!path.startsWith('/') || path.includes('\0') || paths.has(path)) {
        throw new Error('HDF5 corpus dataset path must be unique and absolute')
      }
      paths.add(path)
      const layout = entry.layout
      if (layout !== 'compact' && layout !== 'contiguous' && layout !== 'chunked') {
        throw new Error('HDF5 corpus dataset layout is invalid')
      }
      const fillStatus = entry.fillStatus
      if (fillStatus !== 'default-zero' && fillStatus !== 'undefined' && fillStatus !== 'defined') {
        throw new Error('HDF5 corpus dataset fillStatus is invalid')
      }
      const chunkDimensions =
        entry.chunkDimensions === undefined
          ? undefined
          : parsePositiveIntegerArray(entry.chunkDimensions, 'chunkDimensions')
      if ((layout === 'chunked') !== (chunkDimensions !== undefined)) {
        throw new Error('HDF5 corpus chunkDimensions must appear only for chunked layouts')
      }
      const elementBytes = positiveInteger(entry.elementBytes, 'elementBytes')
      const sample = parseSampleExpectation(entry.sample, elementBytes)
      if (layout === 'chunked' && sample !== undefined) {
        throw new Error('HDF5 corpus samples require D3 compact or contiguous storage')
      }
      const filterIds = entry.filterIds === undefined ? undefined : parseFilterIds(entry.filterIds)
      if (filterIds !== undefined && layout !== 'chunked') {
        throw new Error('HDF5 corpus filterIds require chunked storage')
      }
      return Object.freeze({
        path,
        layout,
        dimensions: parsePositiveIntegerArray(entry.dimensions, 'dimensions'),
        ...(chunkDimensions === undefined ? {} : { chunkDimensions }),
        datatype: parseDatatypeExpectation(entry.datatype),
        elementBytes,
        logicalBytes: positiveInteger(entry.logicalBytes, 'logicalBytes'),
        fillStatus,
        ...(filterIds === undefined ? {} : { filterIds }),
        ...(sample === undefined ? {} : { sample }),
      })
    }),
  )
}

const assertCorpusManifest = (value: unknown): Hdf5CorpusManifestValue => {
  if (!isRecord(value) || value.schemaVersion !== 5 || !isRecord(value.source)) {
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
    const base: Hdf5CorpusFixtureBase = {
      file,
      path: requiredString(fixture, 'path'),
      bytes: positiveInteger(fixture.bytes, 'bytes'),
      sha256,
      superblockVersion: parseSuperblockVersion(fixture.superblockVersion),
      objectHeaderVersion: parseObjectHeaderVersion(fixture.objectHeaderVersion),
    }
    const storage = parseStorage(fixture.storage)
    if (storage === 'legacy') {
      return Object.freeze({ ...base, storage, rootLinks: parseRootLinks(fixture.rootLinks) })
    }
    if (storage === 'dense') {
      return Object.freeze({
        ...base,
        storage,
        unsupportedLink: requiredString(fixture, 'unsupportedLink'),
      })
    }
    return Object.freeze({
      ...base,
      storage,
      datasets: parseDatasetExpectations(fixture.datasets),
    })
  })
  return Object.freeze({
    schemaVersion: 5,
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
