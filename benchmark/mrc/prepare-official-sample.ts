import { mkdir, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { downloadPinnedFile } from '../lib/pinned-download.ts'
import { openMrc } from '../../src/scientific/formats/mrc.ts'

const commit = 'a2a8c6b569a57b7f18b023b5056fa7a14f2f99c2'
const url = `https://raw.githubusercontent.com/ccpem/mrcfile/${commit}/tests/test_data/EMD-3197.map`
const expectedSha256 = '351d5090d4c56eb5fc41796842ad64abecc238b8da6181f8857be5844dbbc262'
const outputDirectory = resolve('benchmark/corpus/mrc/official')
const destination = resolve(outputDirectory, 'EMD-3197.map')
await mkdir(outputDirectory, { recursive: true })
await downloadPinnedFile({
  allowedDirectory: outputDirectory,
  allowedHosts: new Set(['raw.githubusercontent.com']),
  destination,
  expectedSha256,
  maximumBytes: 33_024,
  url,
})
const bytes = await readFile(destination)
const dataset = await openMrc(bytes, { maxInputBytes: bytes.byteLength })
if (
  dataset.sizeX !== 20 ||
  dataset.sizeY !== 20 ||
  dataset.sizeZ !== 20 ||
  dataset.mode !== 2 ||
  dataset.byteOrder !== 'little-endian'
) {
  throw new Error('CCP-EM MRC sample metadata changed')
}
console.log(`Prepared ${bytes.byteLength} byte MRC sample with SHA-256 ${expectedSha256}`)
