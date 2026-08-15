import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { FileSource } from '../../src/node-source.ts'
import { openHdf5File } from '../../src/scientific/formats/hdf5-file.ts'
import {
  inspectVeloxEmdSpectra,
  readVeloxPointSpectrum,
} from '../../src/scientific/formats/velox-emd.ts'
import { veloxEmdReader } from '../../src/scientific/readers/velox-emd.ts'
import { readVeloxEmdCorpusManifest, veloxEmdCorpusPath } from './corpus.ts'

const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')
const hex = (bytes: readonly number[]): string =>
  bytes.map((byte) => byte.toString(16).padStart(2, '0')).join('')
const requireEqual = (actual: unknown, expected: unknown, label: string): void => {
  if (actual !== expected)
    throw new Error(`${label}: expected ${String(expected)}, got ${String(actual)}`)
}
const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const manifest = await readVeloxEmdCorpusManifest()
for (const fixture of manifest.fixtures) {
  const path = veloxEmdCorpusPath(fixture.file)
  const bytes = await readFile(path)
  requireEqual(sha256(bytes), fixture.sha256, `${fixture.file} checksum`)
  const source = await FileSource.open(path)
  const document = await veloxEmdReader.open({ primary: { id: fixture.file, source } })
  const summary = document.datasets.find(({ id }) => id === fixture.datasetId)
  if (summary === undefined) throw new Error(`${fixture.file} lacks ${fixture.datasetId}`)
  requireEqual(summary.name, fixture.name, `${fixture.file} dataset name`)
  requireEqual(summary.descriptor.sampleType, fixture.sampleType, `${fixture.file} sample type`)
  requireEqual(
    summary.descriptor.components.length,
    fixture.components,
    `${fixture.file} components`,
  )
  requireEqual(
    summary.descriptor.axes.map(({ length }) => length).join(','),
    fixture.axisLengths.join(','),
    `${fixture.file} axis lengths`,
  )
  const dataset = await document.openDataset(fixture.datasetId)
  const output: number[] = []
  for await (const block of dataset.readPlane({
    displayAxes: ['x', 'y'],
    fixedIndices: [{ axisId: 'frame', index: 0 }],
    width: Math.min(2, fixture.axisLengths[0] ?? 0),
    height: Math.min(2, fixture.axisLengths[1] ?? 0),
  }))
    output.push(...block.data)
  requireEqual(hex(output), fixture.expectedHex, `${fixture.file} sample window`)
  if (fixture.frequencyStorage !== undefined) {
    const velox = summary.descriptor.metadata?.veloxEmd
    const frequency = isRecord(velox) ? velox.frequencyDomain : undefined
    requireEqual(
      isRecord(frequency) ? frequency.positiveFrequencyOnly : undefined,
      true,
      `${fixture.file} positive-frequency storage`,
    )
    requireEqual(
      isRecord(frequency) ? frequency.centered : undefined,
      false,
      `${fixture.file} uncentered storage`,
    )
    requireEqual(
      isRecord(frequency) ? frequency.storage : undefined,
      fixture.frequencyStorage,
      `${fixture.file} frequency storage`,
    )
  }
  document.close?.()
  console.log(`ok ${fixture.file} ${fixture.sampleType} ${fixture.axisLengths.join('x')}`)
}

for (const fixture of manifest.spectrumFixtures) {
  const path = veloxEmdCorpusPath(fixture.file)
  const bytes = await readFile(path)
  requireEqual(sha256(bytes), fixture.sha256, `${fixture.file} checksum`)
  const source = await FileSource.open(path)
  const file = await openHdf5File(source)
  const inspection = await inspectVeloxEmdSpectra(file)
  requireEqual(
    inspection.denseSpectra.length,
    fixture.denseSpectra,
    `${fixture.file} dense spectra`,
  )
  requireEqual(
    inspection.spectrumStreams.length,
    fixture.spectrumStreams,
    `${fixture.file} spectrum streams`,
  )
  const stream = inspection.spectrumStreams.find(({ id }) => id === fixture.streamId)
  if (stream === undefined) throw new Error(`${fixture.file} lacks stream ${fixture.streamId}`)
  requireEqual(stream.detector, fixture.detector, `${fixture.file} detector`)
  requireEqual(stream.energyBins, fixture.energyBins, `${fixture.file} energy bins`)
  requireEqual(stream.width, fixture.width, `${fixture.file} width`)
  requireEqual(stream.height, fixture.height, `${fixture.file} height`)
  requireEqual(stream.frameOffsets.length, fixture.frames, `${fixture.file} frames`)
  requireEqual(stream.eventCount, fixture.eventCount, `${fixture.file} event count`)
  requireEqual(
    stream.frameOffsets.join(','),
    fixture.frameOffsets.join(','),
    `${fixture.file} frame offsets`,
  )
  requireEqual(
    stream.energyCalibration?.origin,
    fixture.energyOrigin,
    `${fixture.file} energy origin`,
  )
  requireEqual(stream.energyCalibration?.step, fixture.energyStep, `${fixture.file} energy step`)
  requireEqual(stream.energyCalibration?.unit, 'eV', `${fixture.file} energy unit`)
  const point = await readVeloxPointSpectrum(file, stream, { frame: 0, x: 0, y: 0 })
  requireEqual(sha256(point.data), fixture.pointSha256, `${fixture.file} point spectrum`)
  requireEqual(point.scannedEvents, fixture.pointScannedEvents, `${fixture.file} point event count`)
  file.close()
  console.log(
    `ok ${fixture.file} ${stream.detector} ${stream.width}x${stream.height}x${stream.frameOffsets.length}x${stream.energyBins}`,
  )
}
