import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { openZipArchive } from '../../src/scientific/formats/zip.ts'
import { blockfileReader } from '../../src/scientific/readers/blockfile.ts'
import { emsaReader } from '../../src/scientific/readers/emsa.ts'
import { mibReader } from '../../src/scientific/readers/mib.ts'
import { rplReader } from '../../src/scientific/readers/rpl.ts'
import type { ScientificDataset } from '../../src/scientific/dataset.ts'
import { MemorySource } from '../../src/source.ts'
import manifest from './corpus.json' with { type: 'json' }

const directory = 'benchmark/corpus/files/scientific-interchange'
const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')
const hex = (bytes: readonly number[]): string =>
  bytes.map((byte) => byte.toString(16).padStart(2, '0')).join('')
const requireEqual = (actual: unknown, expected: unknown, label: string): void => {
  if (actual !== expected)
    throw new Error(`${label}: expected ${String(expected)}, got ${String(actual)}`)
}
const bytes = async (file: string): Promise<Uint8Array<ArrayBuffer>> =>
  Uint8Array.from(await readFile(join(directory, file)))
const plane = async (
  dataset: ScientificDataset,
  displayAxes: readonly [string, string],
  fixedIndices: readonly { readonly axisId: string; readonly index: number }[],
  width?: number,
  height?: number,
): Promise<string> => {
  const output: number[] = []
  for await (const block of dataset.readPlane({
    displayAxes,
    fixedIndices,
    ...(width === undefined ? {} : { width }),
    ...(height === undefined ? {} : { height }),
  }))
    output.push(...block.data)
  return hex(output)
}

for (const fixture of manifest.downloads) {
  requireEqual(sha256(await bytes(fixture.file)), fixture.sha256, `${fixture.file} checksum`)
}

const rplHeader = await bytes('sample.rpl')
const rplRaw = await bytes('sample.raw')
const rplDocument = await rplReader.open({
  primary: { id: 'sample-rpl', name: 'sample.rpl', source: new MemorySource(rplHeader) },
  companions: {
    async resolve() {
      return { id: 'sample-raw', name: 'sample.raw', source: new MemorySource(rplRaw) }
    },
  },
})
const rplDataset = await rplDocument.openDataset('raster')
requireEqual(
  rplDataset.descriptor.axes.map(({ length }) => length).join(','),
  manifest.oracles.rpl.shape.join(','),
  'RPL shape',
)
requireEqual(
  await plane(
    rplDataset,
    ['x', 'y'],
    [{ axisId: 'depth', index: manifest.oracles.rpl.fixedDepth }],
  ),
  manifest.oracles.rpl.expectedHex,
  'RPL oracle window',
)

const emsaDocument = await emsaReader.open({
  primary: {
    id: 'compliance-msa',
    name: 'compliance.msa',
    source: new MemorySource(await bytes('compliance.msa')),
  },
})
const emsaDataset = await emsaDocument.openDataset('spectrum')
requireEqual(emsaDataset.descriptor.axes[0]?.length, manifest.oracles.emsa.length, 'EMSA length')
if (emsaDataset.descriptor.axes[0]?.coordinates.type !== 'lookup') {
  throw new Error('EMSA real XY fixture did not expose lookup coordinates')
}
requireEqual(
  emsaDataset.descriptor.axes[0].coordinates.values[0],
  manifest.oracles.emsa.firstX,
  'EMSA first coordinate',
)
const series: number[] = []
if (emsaDataset.readSeries === undefined) throw new Error('EMSA real fixture lacks series reads')
for await (const block of emsaDataset.readSeries({
  axisId: 'spectral',
  fixedIndices: [],
  start: 0,
  length: 3,
}))
  series.push(...block.data)
requireEqual(hex(series), manifest.oracles.emsa.expectedHex, 'EMSA oracle window')

const blockDocument = await blockfileReader.open({
  primary: {
    id: 'test2-blo',
    name: 'test2.blo',
    source: new MemorySource(await bytes('test2.blo')),
  },
})
const blockDataset = await blockDocument.openDataset('diffraction')
requireEqual(
  blockDataset.descriptor.axes.map(({ length }) => length).join(','),
  [
    manifest.oracles.blockfile.shape[2],
    manifest.oracles.blockfile.shape[3],
    manifest.oracles.blockfile.shape[0],
    manifest.oracles.blockfile.shape[1],
  ].join(','),
  'BLO shape',
)
requireEqual(
  await plane(
    blockDataset,
    ['kx', 'ky'],
    [
      { axisId: 'scanX', index: 0 },
      { axisId: 'scanY', index: 0 },
    ],
    2,
    2,
  ),
  manifest.oracles.blockfile.expectedHex,
  'BLO oracle window',
)

const archive = await openZipArchive(new MemorySource(await bytes('merlin.zip')))
const mibBytes = await archive.read(manifest.oracles.mib.mibMember)
const hdrBytes = await archive.read(manifest.oracles.mib.hdrMember)
requireEqual(sha256(mibBytes), manifest.oracles.mib.mibSha256, 'MIB member checksum')
requireEqual(sha256(hdrBytes), manifest.oracles.mib.hdrSha256, 'MIB HDR member checksum')
const mibDocument = await mibReader.open({
  primary: { id: 'real-mib', name: 'real.mib', source: new MemorySource(mibBytes) },
  companions: {
    async resolve() {
      return { id: 'real-hdr', name: 'real.hdr', source: new MemorySource(hdrBytes) }
    },
  },
})
const mibDataset = await mibDocument.openDataset('diffraction')
requireEqual(
  mibDataset.descriptor.axes.map(({ length }) => length).join(','),
  [
    manifest.oracles.mib.shape[2],
    manifest.oracles.mib.shape[3],
    manifest.oracles.mib.shape[0],
    manifest.oracles.mib.shape[1],
  ].join(','),
  'MIB shape',
)
requireEqual(
  await plane(
    mibDataset,
    ['kx', 'ky'],
    [
      { axisId: 'scanX', index: 0 },
      { axisId: 'scanY', index: 0 },
    ],
    2,
    2,
  ),
  manifest.oracles.mib.expectedHex,
  'MIB oracle window',
)

console.log('Milestone H real corpus OK (RPL/RAW, EMSA, BLO, processed Merlin MIB)')
