import { mkdir, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { downloadPinnedFile } from '../lib/pinned-download.ts'
import { openCbf } from '../../src/scientific/formats/cbf.ts'

const commit = '88f4f5b6fdcee5577d1f96c46c27a653c6622e20'
const url = `https://raw.githubusercontent.com/paulscherrerinstitute/cbf/${commit}/examples/in16c_010001.cbf`
const expectedSha256 = '6d338b78101bcaecfe7322942d067f4ca40f403491773026f23f24004feaf516'
const outputDirectory = resolve('benchmark/corpus/cbf/compatibility')
const destination = resolve(outputDirectory, 'in16c_010001.cbf')
await mkdir(outputDirectory, { recursive: true })
await downloadPinnedFile({
  allowedDirectory: outputDirectory,
  allowedHosts: new Set(['raw.githubusercontent.com']),
  destination,
  expectedSha256,
  maximumBytes: 307_605,
  url,
})
const bytes = await readFile(destination)
const dataset = await openCbf(bytes, { maxInputBytes: bytes.byteLength })
if (
  dataset.sizeX !== 487 ||
  dataset.sizeY !== 619 ||
  dataset.sampleType !== 'int32' ||
  dataset.encoding !== 'x-CBF_BYTE_OFFSET' ||
  !dataset.detector.detectorName?.includes('PILATUS 300K') ||
  dataset.detector.exposureTimeSeconds !== 1 ||
  dataset.detector.wavelengthAngstroms !== 1.542
) {
  throw new Error('PSI CBF sample metadata changed')
}
console.log(`Prepared ${bytes.byteLength} byte CBF sample with SHA-256 ${expectedSha256}`)
