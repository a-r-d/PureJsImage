import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { openCbf } from '../../src/scientific/formats/cbf.ts'

const commit = '88f4f5b6fdcee5577d1f96c46c27a653c6622e20'
const url = `https://raw.githubusercontent.com/paulscherrerinstitute/cbf/${commit}/examples/in16c_010001.cbf`
const expectedSha256 = '6d338b78101bcaecfe7322942d067f4ca40f403491773026f23f24004feaf516'
const response = await fetch(url)
if (!response.ok) throw new Error(`PSI CBF sample returned HTTP ${response.status}`)
const bytes = new Uint8Array(await response.arrayBuffer())
const sha256 = createHash('sha256').update(bytes).digest('hex')
if (sha256 !== expectedSha256) {
  throw new Error(`CBF sample checksum changed: expected ${expectedSha256}, received ${sha256}`)
}
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
const outputDirectory = resolve('benchmark/corpus/cbf/compatibility')
await mkdir(outputDirectory, { recursive: true })
await writeFile(resolve(outputDirectory, 'in16c_010001.cbf'), bytes)
console.log(`Prepared ${bytes.byteLength} byte CBF sample with SHA-256 ${sha256}`)
