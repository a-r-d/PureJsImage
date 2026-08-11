import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { openMrc } from '../../src/scientific/formats/mrc.ts'

const commit = 'a2a8c6b569a57b7f18b023b5056fa7a14f2f99c2'
const url = `https://raw.githubusercontent.com/ccpem/mrcfile/${commit}/tests/test_data/EMD-3197.map`
const expectedSha256 = '351d5090d4c56eb5fc41796842ad64abecc238b8da6181f8857be5844dbbc262'
const response = await fetch(url)
if (!response.ok) throw new Error(`CCP-EM MRC sample returned HTTP ${response.status}`)
const bytes = new Uint8Array(await response.arrayBuffer())
const sha256 = createHash('sha256').update(bytes).digest('hex')
if (sha256 !== expectedSha256) {
  throw new Error(`MRC sample checksum changed: expected ${expectedSha256}, received ${sha256}`)
}
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
const outputDirectory = resolve('benchmark/corpus/mrc/official')
await mkdir(outputDirectory, { recursive: true })
await writeFile(resolve(outputDirectory, 'EMD-3197.map'), bytes)
console.log(`Prepared ${bytes.byteLength} byte MRC sample with SHA-256 ${sha256}`)
