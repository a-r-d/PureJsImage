import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { createScientificPathContext } from '../../src/scientific/node.ts'
import type { ScientificMetadataObject } from '../../src/scientific/dataset.ts'
import { getScientificDatasetIdentity } from '../../src/scientific/reader.ts'
import { tiaEmiReader } from '../../src/scientific/readers/tia-emi.ts'
import { readTiaEmiCorpusManifest, tiaEmiCorpusPath } from './emi-corpus.ts'

const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')
const requireEqual = (actual: unknown, expected: unknown, label: string): void => {
  if (actual !== expected)
    throw new Error(`${label}: expected ${String(expected)}, got ${String(actual)}`)
}
const isMetadataObject = (value: unknown): value is ScientificMetadataObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const manifest = await readTiaEmiCorpusManifest()
for (const fixture of manifest.fixtures) {
  requireEqual(
    sha256(await readFile(tiaEmiCorpusPath(fixture.file))),
    fixture.sha256,
    `${fixture.file} checksum`,
  )
  for (const companion of fixture.companions) {
    requireEqual(
      sha256(await readFile(tiaEmiCorpusPath(companion.file))),
      companion.sha256,
      `${companion.file} checksum`,
    )
  }
  const document = await tiaEmiReader.open(
    await createScientificPathContext(tiaEmiCorpusPath(fixture.file)),
  )
  requireEqual(document.metadata.objectCount, fixture.objectCount, `${fixture.file} object count`)
  requireEqual(
    document.datasets.map(({ id }) => id).join(','),
    fixture.datasetIds.join(','),
    `${fixture.file} datasets`,
  )
  for (let index = 0; index < document.datasets.length; index += 1) {
    const summary = document.datasets[index]
    if (summary === undefined) continue
    const emi = summary.descriptor.metadata?.['purejsimage:tiaEmi']
    if (!isMetadataObject(emi)) {
      throw new Error(`${fixture.file} ${summary.id} lacks EMI metadata`)
    }
    requireEqual(
      emi.uuid,
      fixture.metadataUuids[index] ?? undefined,
      `${fixture.file} ${summary.id} UUID`,
    )
    const dataset = await document.openDataset(summary.id)
    requireEqual(
      getScientificDatasetIdentity(dataset)?.resources.length,
      2,
      `${fixture.file} ${summary.id} identity resources`,
    )
  }
  const readSummary = document.datasets.find(({ id }) => id === fixture.read.datasetId)
  if (readSummary === undefined) throw new Error(`${fixture.file} lacks ${fixture.read.datasetId}`)
  for (const axisId of fixture.reciprocalAxes) {
    const axis = readSummary.descriptor.axes.find(({ id }) => id === axisId)
    requireEqual(axis?.kind, 'reciprocal-space', `${fixture.file} ${axisId} kind`)
    requireEqual(axis?.unit, '1/m', `${fixture.file} ${axisId} unit`)
  }
  const emi = readSummary.descriptor.metadata?.['purejsimage:tiaEmi']
  if (!isMetadataObject(emi)) {
    throw new Error(`${fixture.file} read dataset lacks EMI metadata`)
  }
  const merge = emi.calibrationMerge
  if (!isMetadataObject(merge) && fixture.preservedConflictAxes.length > 0) {
    throw new Error(`${fixture.file} read dataset lacks calibration merge metadata`)
  }
  const conflicts = isMetadataObject(merge) ? merge.preservedConflicts : []
  if (!Array.isArray(conflicts)) throw new Error(`${fixture.file} conflicts are missing`)
  requireEqual(
    conflicts
      .map((conflict) =>
        typeof conflict === 'object' && conflict !== null && !Array.isArray(conflict)
          ? conflict.axisId
          : undefined,
      )
      .join(','),
    fixture.preservedConflictAxes.join(','),
    `${fixture.file} preserved conflicts`,
  )
  const dataset = await document.openDataset(fixture.read.datasetId)
  const output: number[] = []
  if (fixture.read.kind === 'plane') {
    for await (const block of dataset.readPlane({
      displayAxes: ['x', 'y'],
      fixedIndices: fixture.read.fixedIndices,
      width: 2,
      height: 2,
    })) {
      output.push(...block.data)
    }
  } else {
    if (dataset.readSeries === undefined) throw new Error(`${fixture.file} lacks series reads`)
    for await (const block of dataset.readSeries({
      axisId: 'energy',
      fixedIndices: fixture.read.fixedIndices,
      start: 0,
      length: 4,
    })) {
      output.push(...block.data)
    }
  }
  requireEqual(
    Buffer.from(output).toString('hex'),
    fixture.expectedHex,
    `${fixture.file} sample window`,
  )
  console.log(
    `ok ${fixture.file} ${fixture.objectCount} objects ${fixture.datasetIds.length} datasets`,
  )
}
