import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { FileSource } from '../../src/node-source.ts'
import { rasterSampleBytes } from '../../src/raster.ts'
import { tiaSerReader } from '../../src/scientific/readers/tia-ser.ts'
import type { ImageSource, ImageSourceReadOptions } from '../../src/source.ts'
import { readTiaSerCorpusManifest, tiaSerCorpusPath } from './corpus.ts'

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

const hex = (bytes: readonly number[]): string =>
  bytes.map((byte) => byte.toString(16).padStart(2, '0')).join('')

const requireEqual = (actual: unknown, expected: unknown, label: string): void => {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${String(expected)}, got ${String(actual)}`)
  }
}

const manifest = await readTiaSerCorpusManifest()
for (const fixture of manifest.fixtures) {
  const path = tiaSerCorpusPath(fixture.file)
  const fileBytes = await readFile(path)
  requireEqual(sha256(fileBytes), fixture.sha256, `${fixture.file} checksum`)

  const source = new TrackingSource(await FileSource.open(path))
  const document = await tiaSerReader.open({
    primary: { id: fixture.file, name: fixture.file, source },
  })
  requireEqual(document.metadata.seriesVersion, fixture.version, `${fixture.file} version`)
  requireEqual(document.metadata.dataKind, fixture.dataKind, `${fixture.file} data kind`)
  const summary = document.datasets.find(({ id }) => id === fixture.datasetId)
  if (summary === undefined) throw new Error(`${fixture.file} is missing ${fixture.datasetId}`)
  requireEqual(summary.descriptor.sampleType, fixture.sampleType, `${fixture.file} sample type`)
  requireEqual(summary.descriptor.axes.length, fixture.axes.length, `${fixture.file} axis count`)
  for (const expectedAxis of fixture.axes) {
    const actual = summary.descriptor.axes.find(({ id }) => id === expectedAxis.id)
    if (actual === undefined) throw new Error(`${fixture.file} is missing axis ${expectedAxis.id}`)
    requireEqual(actual.length, expectedAxis.length, `${fixture.file} ${expectedAxis.id} length`)
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

  const dataset = await document.openDataset(fixture.datasetId)
  const readsBeforeSamples = source.reads.length
  const output: number[] = []
  if (fixture.read.kind === 'series') {
    if (dataset.readSeries === undefined) {
      throw new Error(`${fixture.file} lacks native series reads`)
    }
    for await (const block of dataset.readSeries({
      axisId: 'energy',
      fixedIndices: fixture.read.fixedIndices,
      start: fixture.read.start,
      length: fixture.read.length,
    })) {
      output.push(...block.data)
    }
  } else {
    for await (const block of dataset.readPlane({
      displayAxes: ['x', 'y'],
      fixedIndices: fixture.read.fixedIndices,
      width: fixture.read.width,
      height: fixture.read.height,
    })) {
      output.push(...block.data)
    }
  }
  requireEqual(hex(output), fixture.expectedHex, `${fixture.file} oracle window`)
  const sampleReads = source.reads.slice(readsBeforeSamples)
  const bytesPerSample = rasterSampleBytes(fixture.sampleType)
  if (fixture.read.kind === 'series') {
    requireEqual(sampleReads.length, 1, `${fixture.file} direct series-read count`)
    requireEqual(
      sampleReads[0]?.length,
      fixture.read.length * bytesPerSample,
      `${fixture.file} direct series-read bytes`,
    )
  } else {
    requireEqual(sampleReads.length, fixture.read.height, `${fixture.file} direct row-read count`)
    for (const read of sampleReads) {
      requireEqual(
        read.length,
        fixture.read.width * bytesPerSample,
        `${fixture.file} direct row-read bytes`,
      )
    }
  }
  console.log(
    `ok ${fixture.file} v${fixture.version} ${fixture.sampleType} ${fixture.axes
      .map(({ length }) => length)
      .join('x')}`,
  )
}
