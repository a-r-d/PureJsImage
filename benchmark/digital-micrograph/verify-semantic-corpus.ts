import { readFile } from 'node:fs/promises'
import { digitalMicrographReader } from '../../src/scientific/readers/digital-micrograph.ts'
import { HttpRangeSource } from '../../src/sources/http-range.ts'

const manifestPath = 'benchmark/digital-micrograph/semantic-corpus.json'

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const record = (value: unknown, label: string): Readonly<Record<string, unknown>> => {
  if (!isRecord(value)) throw new Error(`${label} must be an object`)
  return value
}

const string = (value: unknown, label: string): string => {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${label} must be a non-empty string`)
  }
  return value
}

const number = (value: unknown, label: string): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${label} must be finite`)
  }
  return value
}

const positiveInteger = (value: unknown, label: string): number => {
  const resolved = number(value, label)
  if (!Number.isSafeInteger(resolved) || resolved < 1) {
    throw new Error(`${label} must be a positive safe integer`)
  }
  return resolved
}

const array = (value: unknown, label: string): readonly unknown[] => {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`)
  return value
}

const axisPair = (value: unknown): readonly [string, string] => {
  const values = array(value, 'dataset.displayAxes')
  if (values.length !== 2) throw new Error('dataset.displayAxes must contain two axes')
  return Object.freeze([
    string(values[0], 'dataset.displayAxes[0]'),
    string(values[1], 'dataset.displayAxes[1]'),
  ])
}

const requireEqual = (actual: unknown, expected: unknown, label: string): void => {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${String(expected)}, got ${String(actual)}`)
  }
}

const hex = (bytes: Uint8Array): string => {
  let result = ''
  for (const byte of bytes) result += byte.toString(16).padStart(2, '0')
  return result
}

const manifest: unknown = JSON.parse(await readFile(manifestPath, 'utf8'))
const root = record(manifest, 'manifest')
requireEqual(root.schemaVersion, 1, 'schemaVersion')
const sourceManifest = record(root.source, 'source')
const datasetManifest = record(root.dataset, 'dataset')
const sourceUrl = string(sourceManifest.url, 'source.url')
const sourceSize = positiveInteger(sourceManifest.size, 'source.size')
const source = await HttpRangeSource.open(sourceUrl, {
  blockBytes: 65_536,
  maxCacheBytes: 262_144,
})
requireEqual(source.size, sourceSize, 'remote source size')

const document = await digitalMicrographReader.open({
  primary: {
    id: `zenodo-${positiveInteger(sourceManifest.record, 'source.record')}`,
    name: string(sourceManifest.file, 'source.file'),
    source,
  },
})
const datasetId = string(datasetManifest.id, 'dataset.id')
const summary = document.datasets.find(({ id }) => id === datasetId)
if (summary === undefined) throw new Error(`remote fixture is missing ${datasetId}`)
requireEqual(summary.name, string(datasetManifest.name, 'dataset.name'), 'dataset name')
requireEqual(
  summary.descriptor.sampleType,
  string(datasetManifest.sampleType, 'dataset.sampleType'),
  'sample type',
)

for (const [index, expectedValue] of array(datasetManifest.axes, 'dataset.axes').entries()) {
  const expected = record(expectedValue, `dataset.axes[${index}]`)
  const id = string(expected.id, `dataset.axes[${index}].id`)
  const actual = summary.descriptor.axes[index]
  if (actual === undefined) throw new Error(`dataset is missing axis ${id}`)
  requireEqual(actual.id, id, `${id} id`)
  requireEqual(actual.kind, string(expected.kind, `${id}.kind`), `${id} kind`)
  requireEqual(actual.length, positiveInteger(expected.length, `${id}.length`), `${id} length`)
  if (expected.unit === undefined) requireEqual(actual.unit, undefined, `${id} unit`)
  else requireEqual(actual.unit, string(expected.unit, `${id}.unit`), `${id} unit`)
  if (actual.coordinates.type !== 'linear') throw new Error(`${id} coordinates are not linear`)
  requireEqual(actual.coordinates.origin, number(expected.origin, `${id}.origin`), `${id} origin`)
  requireEqual(actual.coordinates.step, number(expected.step, `${id}.step`), `${id} step`)
}

const gatan = record(summary.descriptor.metadata?.['purejsimage:gatan'], 'Gatan metadata')
const semantics = record(gatan.axisSemantics, 'Gatan axis semantics')
requireEqual(semantics.kind, '4d-stem', 'axis semantic kind')
const evidence = array(semantics.evidence, 'axis semantic evidence')
requireEqual(evidence.length, 4, 'axis semantic evidence count')

const fixedIndices = array(datasetManifest.fixedIndices, 'dataset.fixedIndices').map(
  (value, index) => {
    const fixed = record(value, `dataset.fixedIndices[${index}]`)
    const coordinate = number(fixed.index, `dataset.fixedIndices[${index}].index`)
    if (!Number.isSafeInteger(coordinate) || coordinate < 0) {
      throw new Error(`dataset.fixedIndices[${index}].index must be non-negative`)
    }
    return Object.freeze({
      axisId: string(fixed.axisId, `dataset.fixedIndices[${index}].axisId`),
      index: coordinate,
    })
  },
)
const output: number[] = []
const dataset = await document.openDataset(datasetId)
for await (const block of dataset.readPlane({
  displayAxes: axisPair(datasetManifest.displayAxes),
  fixedIndices,
  width: positiveInteger(datasetManifest.width, 'dataset.width'),
  height: positiveInteger(datasetManifest.height, 'dataset.height'),
})) {
  output.push(...block.data)
}
requireEqual(
  hex(Uint8Array.from(output)),
  string(datasetManifest.expectedHex, 'dataset.expectedHex'),
  'raw sample window',
)
const maximumRangeBytes = positiveInteger(
  datasetManifest.maximumRangeBytes,
  'dataset.maximumRangeBytes',
)
if (source.stats.bytesFetched > maximumRangeBytes) {
  throw new Error(
    `remote fixture fetched ${source.stats.bytesFetched} bytes; maximum is ${maximumRangeBytes}`,
  )
}
console.log(
  `ok ${string(sourceManifest.doi, 'source.doi')} ${summary.name} ` +
    `${summary.descriptor.axes.map(({ id, length }) => `${id}:${length}`).join(' ')} ` +
    `${source.stats.bytesFetched} bytes fetched`,
)
