import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { RasterSampleType } from '../../src/raster.ts'

export const tiaSerCorpusDirectory = 'benchmark/corpus/files/tia-ser'
export const tiaSerCorpusManifest = 'benchmark/tia-ser/corpus.json'

export interface TiaSerCorpusAxis {
  readonly id: string
  readonly length: number
  readonly unit?: string
  readonly origin: number
  readonly step: number
}

export interface TiaSerCorpusFixedIndex {
  readonly axisId: string
  readonly index: number
}

export type TiaSerCorpusRead =
  | Readonly<{
      kind: 'series'
      start: number
      length: number
      fixedIndices: readonly TiaSerCorpusFixedIndex[]
    }>
  | Readonly<{
      kind: 'plane'
      width: number
      height: number
      fixedIndices: readonly TiaSerCorpusFixedIndex[]
    }>

export interface TiaSerCorpusFixture {
  readonly file: string
  readonly path: string
  readonly sha256: string
  readonly version: 528 | 544
  readonly dataKind: 'spectrum' | 'image'
  readonly datasetId: string
  readonly sampleType: RasterSampleType
  readonly axes: readonly TiaSerCorpusAxis[]
  readonly read: TiaSerCorpusRead
  readonly expectedHex: string
}

export interface TiaSerCorpusManifestValue {
  readonly schemaVersion: 1
  readonly source: {
    readonly project: string
    readonly revision: string
    readonly baseUrl: string
    readonly license: string
    readonly licenseUrl: string
    readonly attribution: string
    readonly oracleUrl: string
  }
  readonly fixtures: readonly TiaSerCorpusFixture[]
}

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const requiredString = (record: Readonly<Record<string, unknown>>, key: string): string => {
  const value = record[key]
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`TIA SER corpus field ${key} must be a non-empty string`)
  }
  return value
}

const nonNegativeInteger = (value: unknown, label: string): number => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`TIA SER corpus field ${label} must be a non-negative integer`)
  }
  return value
}

const positiveInteger = (value: unknown, label: string): number => {
  const result = nonNegativeInteger(value, label)
  if (result === 0) throw new Error(`TIA SER corpus field ${label} must be positive`)
  return result
}

const finiteNumber = (value: unknown, label: string): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`TIA SER corpus field ${label} must be finite`)
  }
  return value
}

const parseSampleType = (value: unknown): RasterSampleType => {
  if (
    value === 'uint8' ||
    value === 'uint16' ||
    value === 'uint32' ||
    value === 'int8' ||
    value === 'int16' ||
    value === 'int32' ||
    value === 'float32' ||
    value === 'float64'
  ) {
    return value
  }
  throw new Error('TIA SER corpus sampleType is invalid')
}

const parseFixedIndices = (value: unknown): readonly TiaSerCorpusFixedIndex[] => {
  if (!Array.isArray(value)) throw new Error('TIA SER corpus fixedIndices must be an array')
  return Object.freeze(
    value.map((entry) => {
      if (!isRecord(entry)) throw new Error('TIA SER corpus fixed index must be an object')
      return Object.freeze({
        axisId: requiredString(entry, 'axisId'),
        index: nonNegativeInteger(entry.index, 'fixed index'),
      })
    }),
  )
}

const parseRead = (value: unknown): TiaSerCorpusRead => {
  if (!isRecord(value)) throw new Error('TIA SER corpus read must be an object')
  const fixedIndices = parseFixedIndices(value.fixedIndices)
  if (value.kind === 'series') {
    return Object.freeze({
      kind: 'series',
      start: nonNegativeInteger(value.start, 'series start'),
      length: positiveInteger(value.length, 'series length'),
      fixedIndices,
    })
  }
  if (value.kind === 'plane') {
    return Object.freeze({
      kind: 'plane',
      width: positiveInteger(value.width, 'plane width'),
      height: positiveInteger(value.height, 'plane height'),
      fixedIndices,
    })
  }
  throw new Error('TIA SER corpus read kind is invalid')
}

const parseAxis = (value: unknown): TiaSerCorpusAxis => {
  if (!isRecord(value)) throw new Error('TIA SER corpus axis must be an object')
  const unit = value.unit
  if (unit !== undefined && (typeof unit !== 'string' || unit.length === 0)) {
    throw new Error('TIA SER corpus axis unit is invalid')
  }
  return Object.freeze({
    id: requiredString(value, 'id'),
    length: positiveInteger(value.length, 'axis length'),
    ...(typeof unit === 'string' ? { unit } : {}),
    origin: finiteNumber(value.origin, 'axis origin'),
    step: finiteNumber(value.step, 'axis step'),
  })
}

const assertCorpusManifest = (value: unknown): TiaSerCorpusManifestValue => {
  if (!isRecord(value) || value.schemaVersion !== 1 || !isRecord(value.source)) {
    throw new Error('TIA SER corpus manifest header is invalid')
  }
  if (!Array.isArray(value.fixtures) || value.fixtures.length === 0) {
    throw new Error('TIA SER corpus manifest must contain fixtures')
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
    throw new Error('TIA SER corpus baseUrl must pin the declared revision')
  }
  const fixtures = value.fixtures.map((fixture): TiaSerCorpusFixture => {
    if (!isRecord(fixture)) throw new Error('TIA SER corpus fixture must be an object')
    const sha256 = fixture.sha256
    if (typeof sha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(sha256)) {
      throw new Error('TIA SER corpus checksum is invalid')
    }
    if (fixture.version !== 528 && fixture.version !== 544) {
      throw new Error('TIA SER corpus version is invalid')
    }
    if (fixture.dataKind !== 'spectrum' && fixture.dataKind !== 'image') {
      throw new Error('TIA SER corpus dataKind is invalid')
    }
    if (!Array.isArray(fixture.axes) || fixture.axes.length === 0) {
      throw new Error('TIA SER corpus axes must be a non-empty array')
    }
    const expectedHex = requiredString(fixture, 'expectedHex')
    if (!/^(?:[a-f0-9]{2})+$/u.test(expectedHex)) {
      throw new Error('TIA SER corpus expectedHex must contain whole lowercase bytes')
    }
    return Object.freeze({
      file: requiredString(fixture, 'file'),
      path: requiredString(fixture, 'path'),
      sha256,
      version: fixture.version,
      dataKind: fixture.dataKind,
      datasetId: requiredString(fixture, 'datasetId'),
      sampleType: parseSampleType(fixture.sampleType),
      axes: Object.freeze(fixture.axes.map(parseAxis)),
      read: parseRead(fixture.read),
      expectedHex,
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
      oracleUrl: requiredString(value.source, 'oracleUrl'),
    }),
    fixtures: Object.freeze(fixtures),
  })
}

export const readTiaSerCorpusManifest = async (): Promise<TiaSerCorpusManifestValue> => {
  const value: unknown = JSON.parse(await readFile(tiaSerCorpusManifest, 'utf8'))
  return assertCorpusManifest(value)
}

export const tiaSerCorpusPath = (file: string): string => join(tiaSerCorpusDirectory, file)
