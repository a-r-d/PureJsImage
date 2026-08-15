import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { digitalMicrographReader } from '../../src/scientific/readers/digital-micrograph.ts'
import { FileSource } from '../../src/node-source.ts'
import { rasterSampleBytes } from '../../src/raster.ts'
import type { ImageSource, ImageSourceReadOptions } from '../../src/source.ts'
import { digitalMicrographCorpusPath, readDigitalMicrographCorpusManifest } from './corpus.ts'

interface SourceRead {
  readonly offset: number
  readonly length: number
}

class TrackingSource implements ImageSource {
  readonly size: number
  readonly reads: SourceRead[] = []
  readonly #source: ImageSource

  constructor(source: ImageSource) {
    this.#source = source
    this.size = source.size
  }

  async read(
    offset: number,
    length: number,
    options: Readonly<ImageSourceReadOptions> = {},
  ): Promise<Uint8Array> {
    this.reads.push(Object.freeze({ offset, length }))
    return this.#source.read(offset, length, options)
  }
}

const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')

const hex = (bytes: Uint8Array): string => {
  let result = ''
  for (const byte of bytes) result += byte.toString(16).padStart(2, '0')
  return result
}

const requireEqual = (actual: unknown, expected: unknown, label: string): void => {
  if (actual !== expected)
    throw new Error(`${label}: expected ${String(expected)}, got ${String(actual)}`)
}

const manifest = await readDigitalMicrographCorpusManifest()
for (const fixture of manifest.fixtures) {
  const path = digitalMicrographCorpusPath(fixture.file)
  const fileBytes = await readFile(path)
  requireEqual(sha256(fileBytes), fixture.sha256, `${fixture.file} checksum`)

  const source = new TrackingSource(await FileSource.open(path))
  const document = await digitalMicrographReader.open({
    primary: { id: fixture.file, name: fixture.file, source },
  })
  requireEqual(document.datasets.length, fixture.datasetCount, `${fixture.file} dataset count`)
  requireEqual(document.metadata.version, fixture.version, `${fixture.file} DM version`)
  const unsupported = document.metadata.unsupportedDatasets
  requireEqual(
    Array.isArray(unsupported) ? unsupported.length : 0,
    fixture.unsupportedDatasetCount ?? 0,
    `${fixture.file} unsupported dataset count`,
  )

  const summary = document.datasets.find(({ id }) => id === fixture.dataset.id)
  if (summary === undefined) throw new Error(`${fixture.file} is missing ${fixture.dataset.id}`)
  requireEqual(summary.name, fixture.dataset.name, `${fixture.file} dataset name`)
  requireEqual(
    summary.descriptor.sampleType,
    fixture.dataset.sampleType,
    `${fixture.file} sample type`,
  )
  requireEqual(
    summary.descriptor.components.length,
    fixture.dataset.components,
    `${fixture.file} component count`,
  )
  const dimensions = summary.descriptor.axes.map(({ length }) => length)
  requireEqual(
    JSON.stringify(dimensions),
    JSON.stringify(fixture.dataset.dimensions),
    `${fixture.file} dimensions`,
  )
  for (const expectedAxis of fixture.dataset.axes ?? []) {
    const actual = summary.descriptor.axes.find(({ id }) => id === expectedAxis.id)
    if (actual === undefined) throw new Error(`${fixture.file} is missing axis ${expectedAxis.id}`)
    requireEqual(actual.unit, expectedAxis.unit, `${fixture.file} ${expectedAxis.id} unit`)
    if (actual.coordinates.type !== 'linear') {
      throw new Error(`${fixture.file} ${expectedAxis.id} is not linearly calibrated`)
    }
    requireEqual(
      actual.coordinates.origin,
      expectedAxis.origin,
      `${fixture.file} ${expectedAxis.id} origin`,
    )
    requireEqual(
      actual.coordinates.step,
      expectedAxis.step,
      `${fixture.file} ${expectedAxis.id} step`,
    )
    if (actual.calibration === undefined) {
      throw new Error(`${fixture.file} ${expectedAxis.id} lacks calibration evidence`)
    }
  }
  if (summary.descriptor.metadata?.['purejsimage:gatan'] === undefined) {
    throw new Error(`${fixture.file} lacks bounded Gatan metadata`)
  }

  const readsBeforePlane = source.reads.length
  const dataset = await document.openDataset(fixture.dataset.id)
  const width = fixture.dataset.width ?? fixture.dataset.dimensions[0] ?? 0
  const height = fixture.dataset.height ?? fixture.dataset.dimensions[1] ?? 0
  const output: number[] = []
  for await (const block of dataset.readPlane({
    displayAxes: ['x', 'y'],
    fixedIndices: fixture.dataset.fixedIndices ?? [],
    x: 0,
    y: 0,
    width,
    height,
  })) {
    output.push(...block.data)
  }
  requireEqual(
    hex(Uint8Array.from(output)),
    fixture.dataset.expectedHex,
    `${fixture.file} oracle window`,
  )
  const planeReads = source.reads.slice(readsBeforePlane)
  requireEqual(planeReads.length, height, `${fixture.file} direct row-read count`)
  const expectedReadBytes =
    width * fixture.dataset.components * rasterSampleBytes(fixture.dataset.sampleType)
  for (const read of planeReads) {
    requireEqual(read.length, expectedReadBytes, `${fixture.file} direct row-read bytes`)
  }
  console.log(`ok ${fixture.file} ${fixture.dataset.sampleType} ${dimensions.join('x')}`)
}
