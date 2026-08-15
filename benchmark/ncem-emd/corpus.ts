import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { RasterSampleType } from '../../src/raster.ts'

export const ncemEmdCorpusDirectory = 'benchmark/corpus/files/ncem-emd'
export const ncemEmdCorpusManifest = 'benchmark/ncem-emd/corpus.json'

export interface NcemEmdCorpusFixture {
  readonly file: string
  readonly sha256: string
  readonly datasetId: string
  readonly sampleType: RasterSampleType
  readonly axisLengths: readonly number[]
  readonly expectedHex: string
}

export interface NcemEmdCorpusManifestValue {
  readonly schemaVersion: 1
  readonly source: Readonly<{
    project: string
    revision: string
    baseUrl: string
    license: string
    licenseUrl: string
    attribution: string
    oracleUrl: string
  }>
  readonly fixtures: readonly NcemEmdCorpusFixture[]
}

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const requiredString = (record: Readonly<Record<string, unknown>>, key: string): string => {
  const value = record[key]
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`NCEM EMD corpus field ${key} must be a non-empty string`)
  }
  return value
}

const sampleType = (value: unknown): RasterSampleType => {
  if (
    value === 'uint8' ||
    value === 'uint16' ||
    value === 'uint32' ||
    value === 'uint64' ||
    value === 'int8' ||
    value === 'int16' ||
    value === 'int32' ||
    value === 'float16' ||
    value === 'float32' ||
    value === 'float64'
  ) {
    return value
  }
  throw new Error('NCEM EMD corpus sampleType is invalid')
}

const readManifest = (value: unknown): NcemEmdCorpusManifestValue => {
  if (!isRecord(value) || value.schemaVersion !== 1 || !isRecord(value.source)) {
    throw new Error('NCEM EMD corpus manifest header is invalid')
  }
  if (!Array.isArray(value.fixtures) || value.fixtures.length === 0) {
    throw new Error('NCEM EMD corpus manifest must contain fixtures')
  }
  const revision = requiredString(value.source, 'revision')
  const baseUrl = requiredString(value.source, 'baseUrl')
  const url = new URL(baseUrl)
  if (
    url.protocol !== 'https:' ||
    url.hostname !== 'raw.githubusercontent.com' ||
    !url.pathname.includes(`/${revision}/`) ||
    !url.pathname.endsWith('/')
  ) {
    throw new Error('NCEM EMD corpus baseUrl must pin the declared revision')
  }
  const fixtures = value.fixtures.map((entry): NcemEmdCorpusFixture => {
    if (!isRecord(entry)) throw new Error('NCEM EMD corpus fixture must be an object')
    const file = requiredString(entry, 'file')
    if (file.includes('/') || file.includes('\\')) {
      throw new Error('NCEM EMD corpus file must be a direct filename')
    }
    const sha256 = requiredString(entry, 'sha256')
    const expectedHex = requiredString(entry, 'expectedHex')
    if (!/^[a-f0-9]{64}$/.test(sha256) || !/^(?:[a-f0-9]{2})+$/.test(expectedHex)) {
      throw new Error('NCEM EMD corpus checksum or sample window is invalid')
    }
    if (
      !Array.isArray(entry.axisLengths) ||
      entry.axisLengths.length === 0 ||
      entry.axisLengths.some(
        (length) => typeof length !== 'number' || !Number.isSafeInteger(length) || length < 1,
      )
    ) {
      throw new Error('NCEM EMD corpus axisLengths are invalid')
    }
    const axisLengths: readonly number[] = entry.axisLengths
    return Object.freeze({
      file,
      sha256,
      datasetId: requiredString(entry, 'datasetId'),
      sampleType: sampleType(entry.sampleType),
      axisLengths: Object.freeze([...axisLengths]),
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

export const readNcemEmdCorpusManifest = async (): Promise<NcemEmdCorpusManifestValue> => {
  const value: unknown = JSON.parse(await readFile(ncemEmdCorpusManifest, 'utf8'))
  return readManifest(value)
}

export const ncemEmdCorpusPath = (file: string): string => join(ncemEmdCorpusDirectory, file)
