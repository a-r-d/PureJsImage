import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { FileSource } from '../../src/node-source.ts'
import { ncemEmdReader } from '../../src/scientific/readers/ncem-emd.ts'
import { ncemEmdCorpusPath, readNcemEmdCorpusManifest } from './corpus.ts'

const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')
const hex = (bytes: readonly number[]): string =>
  bytes.map((byte) => byte.toString(16).padStart(2, '0')).join('')
const requireEqual = (actual: unknown, expected: unknown, label: string): void => {
  if (actual !== expected)
    throw new Error(`${label}: expected ${String(expected)}, got ${String(actual)}`)
}
const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const manifest = await readNcemEmdCorpusManifest()
for (const fixture of manifest.fixtures) {
  const path = ncemEmdCorpusPath(fixture.file)
  const bytes = await readFile(path)
  requireEqual(sha256(bytes), fixture.sha256, `${fixture.file} checksum`)
  const source = await FileSource.open(path)
  const document = await ncemEmdReader.open({
    primary: { id: fixture.file, name: fixture.file, source },
  })
  const summary = document.datasets.find(({ id }) => id === fixture.datasetId)
  if (summary === undefined) throw new Error(`${fixture.file} lacks ${fixture.datasetId}`)
  requireEqual(summary.descriptor.sampleType, fixture.sampleType, `${fixture.file} sample type`)
  requireEqual(
    summary.descriptor.axes.map(({ length }) => length).join(','),
    fixture.axisLengths.join(','),
    `${fixture.file} axis lengths`,
  )
  const dataset = await document.openDataset(fixture.datasetId)
  if (dataset.readSeries === undefined) throw new Error(`${fixture.file} lacks series reads`)
  const selected = summary.descriptor.axes[0]
  if (selected === undefined) throw new Error(`${fixture.file} lacks a selected axis`)
  const output: number[] = []
  for await (const block of dataset.readSeries({
    axisId: selected.id,
    fixedIndices: summary.descriptor.axes
      .slice(1)
      .map((axis) => Object.freeze({ axisId: axis.id, index: 0 })),
    start: 0,
    length: Math.min(3, selected.length),
  })) {
    output.push(...block.data)
  }
  requireEqual(hex(output), fixture.expectedHex, `${fixture.file} sample window`)
  if (fixture.file === 'example_metadata.emd') {
    const acquisition = document.metadata.acquisition
    const microscope = isRecord(acquisition) ? acquisition.microscope : undefined
    const sample = isRecord(acquisition) ? acquisition.sample : undefined
    requireEqual(isRecord(microscope) ? microscope.name : undefined, 'Titan', 'microscope name')
    requireEqual(isRecord(sample) ? sample.material : undefined, 'TiO2', 'sample material')
  }
  document.close?.()
  console.log(`ok ${fixture.file} ${fixture.sampleType} ${fixture.axisLengths.join('x')}`)
}
