import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { RasterSampleType } from '../../src/raster.ts'

export const veloxEmdCorpusDirectory = 'benchmark/corpus/files/velox-emd'
export const veloxEmdCorpusManifest = 'benchmark/velox-emd/corpus.json'

export interface VeloxEmdCorpusFixture {
  readonly file: string
  readonly sha256: string
  readonly datasetId: string
  readonly name: string
  readonly sampleType: RasterSampleType
  readonly components: 1 | 2
  readonly axisLengths: readonly number[]
  readonly expectedHex: string
  readonly frequencyStorage?: 'half-even' | 'half-odd'
}

export interface VeloxEmdSpectrumCorpusFixture {
  readonly archive: string
  readonly archiveSha256: string
  readonly entry: string
  readonly file: string
  readonly sha256: string
  readonly denseSpectra: number
  readonly spectrumStreams: number
  readonly streamId: string
  readonly detector: string
  readonly energyBins: number
  readonly width: number
  readonly height: number
  readonly frames: number
  readonly eventCount: number
  readonly frameOffsets: readonly number[]
  readonly energyOrigin: number
  readonly energyStep: number
  readonly pointSha256: string
  readonly pointScannedEvents: number
}

export interface VeloxEmdCorpusManifestValue {
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
  readonly fixtures: readonly VeloxEmdCorpusFixture[]
  readonly spectrumFixtures: readonly VeloxEmdSpectrumCorpusFixture[]
}

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const requiredString = (record: Readonly<Record<string, unknown>>, key: string): string => {
  const value = record[key]
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Velox EMD corpus field ${key} must be a non-empty string`)
  }
  return value
}

const rasterSampleType = (value: unknown): RasterSampleType => {
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
  )
    return value
  throw new Error('Velox EMD corpus sampleType is invalid')
}

const safeFile = (value: string, label: string): string => {
  if (value.includes('/') || value.includes('\\')) {
    throw new Error(`Velox EMD corpus ${label} must be one plain filename`)
  }
  return value
}

const checksum = (value: string, label: string): string => {
  if (!/^[a-f0-9]{64}$/.test(value)) {
    throw new Error(`Velox EMD corpus ${label} must be a lowercase SHA-256`)
  }
  return value
}

const positiveInteger = (value: unknown, label: string): number => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    throw new Error(`Velox EMD corpus ${label} must be a positive safe integer`)
  }
  return value
}

const finiteNumber = (value: unknown, label: string): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`Velox EMD corpus ${label} must be finite`)
  }
  return value
}

const parseManifest = (value: unknown): VeloxEmdCorpusManifestValue => {
  if (!isRecord(value) || value.schemaVersion !== 1 || !isRecord(value.source)) {
    throw new Error('Velox EMD corpus manifest header is invalid')
  }
  if (!Array.isArray(value.fixtures) || value.fixtures.length === 0) {
    throw new Error('Velox EMD corpus manifest must contain fixtures')
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
    throw new Error('Velox EMD corpus baseUrl must pin the declared revision')
  }
  const fixtures = value.fixtures.map((entry): VeloxEmdCorpusFixture => {
    if (!isRecord(entry)) throw new Error('Velox EMD corpus fixture must be an object')
    const file = safeFile(requiredString(entry, 'file'), 'file')
    const sha256 = checksum(requiredString(entry, 'sha256'), 'sha256')
    const expectedHex = requiredString(entry, 'expectedHex')
    if (!/^(?:[a-f0-9]{2})+$/.test(expectedHex)) {
      throw new Error('Velox EMD corpus fixture path, checksum, or sample window is invalid')
    }
    if (
      !Array.isArray(entry.axisLengths) ||
      entry.axisLengths.length !== 3 ||
      entry.axisLengths.some(
        (length) => typeof length !== 'number' || !Number.isSafeInteger(length) || length < 1,
      )
    ) {
      throw new Error('Velox EMD corpus axisLengths are invalid')
    }
    if (entry.components !== 1 && entry.components !== 2) {
      throw new Error('Velox EMD corpus components are invalid')
    }
    if (
      entry.frequencyStorage !== undefined &&
      entry.frequencyStorage !== 'half-even' &&
      entry.frequencyStorage !== 'half-odd'
    ) {
      throw new Error('Velox EMD corpus frequency storage is invalid')
    }
    return Object.freeze({
      file,
      sha256,
      datasetId: requiredString(entry, 'datasetId'),
      name: requiredString(entry, 'name'),
      sampleType: rasterSampleType(entry.sampleType),
      components: entry.components,
      axisLengths: Object.freeze([...entry.axisLengths]),
      expectedHex,
      ...(entry.frequencyStorage === undefined ? {} : { frequencyStorage: entry.frequencyStorage }),
    })
  })
  if (!Array.isArray(value.spectrumFixtures) || value.spectrumFixtures.length === 0) {
    throw new Error('Velox EMD corpus must contain spectrum fixtures')
  }
  const spectrumFixtures = value.spectrumFixtures.map((entry): VeloxEmdSpectrumCorpusFixture => {
    if (!isRecord(entry)) throw new Error('Velox EMD spectrum fixture must be an object')
    if (!Array.isArray(entry.frameOffsets) || entry.frameOffsets.length === 0) {
      throw new Error('Velox EMD spectrum frameOffsets must be non-empty')
    }
    const frameOffsets = entry.frameOffsets.map((offset, index) => {
      if (typeof offset !== 'number' || !Number.isSafeInteger(offset) || offset < 0) {
        throw new Error(`Velox EMD spectrum frameOffsets[${index}] is invalid`)
      }
      return offset
    })
    const frames = positiveInteger(entry.frames, 'frames')
    if (frameOffsets.length !== frames || frameOffsets[0] !== 0) {
      throw new Error('Velox EMD spectrum frameOffsets do not match frames')
    }
    return Object.freeze({
      archive: safeFile(requiredString(entry, 'archive'), 'archive'),
      archiveSha256: checksum(requiredString(entry, 'archiveSha256'), 'archiveSha256'),
      entry: safeFile(requiredString(entry, 'entry'), 'entry'),
      file: safeFile(requiredString(entry, 'file'), 'file'),
      sha256: checksum(requiredString(entry, 'sha256'), 'sha256'),
      denseSpectra: positiveInteger(entry.denseSpectra, 'denseSpectra'),
      spectrumStreams: positiveInteger(entry.spectrumStreams, 'spectrumStreams'),
      streamId: requiredString(entry, 'streamId'),
      detector: requiredString(entry, 'detector'),
      energyBins: positiveInteger(entry.energyBins, 'energyBins'),
      width: positiveInteger(entry.width, 'width'),
      height: positiveInteger(entry.height, 'height'),
      frames,
      eventCount: positiveInteger(entry.eventCount, 'eventCount'),
      frameOffsets: Object.freeze(frameOffsets),
      energyOrigin: finiteNumber(entry.energyOrigin, 'energyOrigin'),
      energyStep: finiteNumber(entry.energyStep, 'energyStep'),
      pointSha256: checksum(requiredString(entry, 'pointSha256'), 'pointSha256'),
      pointScannedEvents: positiveInteger(entry.pointScannedEvents, 'pointScannedEvents'),
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
    spectrumFixtures: Object.freeze(spectrumFixtures),
  })
}

export const readVeloxEmdCorpusManifest = async (): Promise<VeloxEmdCorpusManifestValue> =>
  parseManifest(JSON.parse(await readFile(veloxEmdCorpusManifest, 'utf8')) as unknown)

export const veloxEmdCorpusPath = (file: string): string => join(veloxEmdCorpusDirectory, file)
