import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { RasterSampleType } from '../../src/raster.ts'

export const digitalMicrographCorpusDirectory = 'benchmark/corpus/files/digital-micrograph'
export const digitalMicrographCorpusManifest = 'benchmark/digital-micrograph/corpus.json'

export interface DigitalMicrographCorpusAxis {
  readonly id: string
  readonly unit?: string
  readonly origin: number
  readonly step: number
}

export interface DigitalMicrographCorpusDataset {
  readonly id: string
  readonly name: string
  readonly sampleType: RasterSampleType
  readonly components: number
  readonly dimensions: readonly number[]
  readonly width?: number
  readonly height?: number
  readonly fixedIndices?: readonly { readonly axisId: string; readonly index: number }[]
  readonly expectedHex: string
  readonly axes?: readonly DigitalMicrographCorpusAxis[]
}

export interface DigitalMicrographCorpusFixture {
  readonly file: string
  readonly path: string
  readonly sha256: string
  readonly version: 3 | 4
  readonly datasetCount: number
  readonly unsupportedDatasetCount?: number
  readonly dataset: DigitalMicrographCorpusDataset
}

export interface DigitalMicrographCorpusManifestValue {
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
  readonly fixtures: readonly DigitalMicrographCorpusFixture[]
}

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const requiredString = (record: Readonly<Record<string, unknown>>, key: string): string => {
  const value = record[key]
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`DigitalMicrograph corpus field ${key} must be a non-empty string`)
  }
  return value
}

const positiveInteger = (value: unknown, label: string): number => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    throw new Error(`DigitalMicrograph corpus field ${label} must be a positive integer`)
  }
  return value
}

const finiteNumber = (value: unknown, label: string): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`DigitalMicrograph corpus field ${label} must be finite`)
  }
  return value
}

const sampleTypes: ReadonlySet<string> = new Set([
  'int8',
  'uint8',
  'int16',
  'uint16',
  'int32',
  'uint32',
  'float32',
  'float64',
])

const sampleType = (value: unknown): RasterSampleType => {
  if (typeof value !== 'string' || !sampleTypes.has(value)) {
    throw new Error('DigitalMicrograph corpus sampleType is invalid')
  }
  if (
    value === 'int8' ||
    value === 'uint8' ||
    value === 'int16' ||
    value === 'uint16' ||
    value === 'int32' ||
    value === 'uint32' ||
    value === 'float32' ||
    value === 'float64'
  ) {
    return value
  }
  throw new Error('DigitalMicrograph corpus sampleType is unreachable')
}

const axis = (value: unknown): DigitalMicrographCorpusAxis => {
  if (!isRecord(value)) throw new Error('DigitalMicrograph corpus axis must be an object')
  const unit = value.unit
  if (unit !== undefined && (typeof unit !== 'string' || unit.length === 0)) {
    throw new Error('DigitalMicrograph corpus axis unit is invalid')
  }
  return Object.freeze({
    id: requiredString(value, 'id'),
    ...(typeof unit === 'string' ? { unit } : {}),
    origin: finiteNumber(value.origin, 'axis.origin'),
    step: finiteNumber(value.step, 'axis.step'),
  })
}

const dataset = (value: unknown): DigitalMicrographCorpusDataset => {
  if (!isRecord(value)) throw new Error('DigitalMicrograph corpus dataset must be an object')
  if (!Array.isArray(value.dimensions)) {
    throw new Error('DigitalMicrograph corpus dimensions must be an array')
  }
  const dimensions = value.dimensions.map((entry) => positiveInteger(entry, 'dimensions'))
  const fixedIndices = value.fixedIndices
  if (fixedIndices !== undefined && !Array.isArray(fixedIndices)) {
    throw new Error('DigitalMicrograph corpus fixedIndices must be an array')
  }
  const normalizedFixedIndices = (fixedIndices ?? []).map((entry) => {
    if (!isRecord(entry)) throw new Error('DigitalMicrograph fixed index must be an object')
    const index = entry.index
    if (typeof index !== 'number' || !Number.isSafeInteger(index) || index < 0) {
      throw new Error('DigitalMicrograph fixed index must be non-negative')
    }
    return Object.freeze({ axisId: requiredString(entry, 'axisId'), index })
  })
  const axes = value.axes
  if (axes !== undefined && !Array.isArray(axes)) {
    throw new Error('DigitalMicrograph corpus axes must be an array')
  }
  const expectedHex = requiredString(value, 'expectedHex')
  if (!/^(?:[a-f0-9]{2})+$/.test(expectedHex)) {
    throw new Error('DigitalMicrograph expectedHex must contain whole lowercase bytes')
  }
  return Object.freeze({
    id: requiredString(value, 'id'),
    name: requiredString(value, 'name'),
    sampleType: sampleType(value.sampleType),
    components: positiveInteger(value.components, 'components'),
    dimensions: Object.freeze(dimensions),
    ...(value.width === undefined ? {} : { width: positiveInteger(value.width, 'width') }),
    ...(value.height === undefined ? {} : { height: positiveInteger(value.height, 'height') }),
    ...(normalizedFixedIndices.length === 0
      ? {}
      : { fixedIndices: Object.freeze(normalizedFixedIndices) }),
    expectedHex,
    ...(axes === undefined ? {} : { axes: Object.freeze(axes.map(axis)) }),
  })
}

const assertCorpusManifest = (value: unknown): DigitalMicrographCorpusManifestValue => {
  if (!isRecord(value) || value.schemaVersion !== 1 || !isRecord(value.source)) {
    throw new Error('DigitalMicrograph corpus manifest header is invalid')
  }
  if (!Array.isArray(value.fixtures) || value.fixtures.length === 0) {
    throw new Error('DigitalMicrograph corpus manifest must contain fixtures')
  }
  const fixtures: DigitalMicrographCorpusFixture[] = []
  for (const fixture of value.fixtures) {
    if (
      !isRecord(fixture) ||
      typeof fixture.sha256 !== 'string' ||
      !/^[a-f0-9]{64}$/.test(fixture.sha256) ||
      (fixture.version !== 3 && fixture.version !== 4)
    ) {
      throw new Error('DigitalMicrograph corpus fixture is invalid')
    }
    const unsupportedDatasetCount = fixture.unsupportedDatasetCount
    if (
      unsupportedDatasetCount !== undefined &&
      (typeof unsupportedDatasetCount !== 'number' ||
        !Number.isSafeInteger(unsupportedDatasetCount) ||
        unsupportedDatasetCount < 0)
    ) {
      throw new Error('DigitalMicrograph unsupportedDatasetCount must be non-negative')
    }
    fixtures.push(
      Object.freeze({
        file: requiredString(fixture, 'file'),
        path: requiredString(fixture, 'path'),
        sha256: fixture.sha256,
        version: fixture.version,
        datasetCount: positiveInteger(fixture.datasetCount, 'datasetCount'),
        ...(typeof unsupportedDatasetCount === 'number' ? { unsupportedDatasetCount } : {}),
        dataset: dataset(fixture.dataset),
      }),
    )
  }
  const revision = requiredString(value.source, 'revision')
  const baseUrl = requiredString(value.source, 'baseUrl')
  let sourceUrl: URL
  try {
    sourceUrl = new URL(baseUrl)
  } catch {
    throw new Error('DigitalMicrograph corpus baseUrl is invalid')
  }
  if (
    sourceUrl.protocol !== 'https:' ||
    sourceUrl.hostname !== 'raw.githubusercontent.com' ||
    !sourceUrl.pathname.includes(`/${revision}/`) ||
    !sourceUrl.pathname.endsWith('/')
  ) {
    throw new Error('DigitalMicrograph corpus baseUrl must pin the declared revision')
  }
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

export const readDigitalMicrographCorpusManifest =
  async (): Promise<DigitalMicrographCorpusManifestValue> => {
    const value: unknown = JSON.parse(await readFile(digitalMicrographCorpusManifest, 'utf8'))
    return assertCorpusManifest(value)
  }

export const digitalMicrographCorpusPath = (file: string): string =>
  join(digitalMicrographCorpusDirectory, file)
