import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { avifCorpusDirectory } from './corpus.ts'
import {
  avifDependentLayerFixture,
  avifSelectedBaseLayerFixture,
} from './dependent-layer-fixture.ts'

const sha256 = (data: Uint8Array): string => createHash('sha256').update(data).digest('hex')
const uint32 = (data: Uint8Array, offset: number): number =>
  new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(offset)
const setUint32 = (data: Uint8Array, offset: number, value: number): void =>
  new DataView(data.buffer, data.byteOffset, data.byteLength).setUint32(offset, value)
const boxOffset = (data: Uint8Array, type: string): number => {
  const marker = new TextEncoder().encode(type)
  for (let offset = 4; offset <= data.byteLength - marker.byteLength; offset += 1) {
    if (marker.every((value, index) => data[offset + index] === value)) return offset - 4
  }
  throw new Error(`AVIF source has no ${type} box`)
}

const sourcePath = join(avifCorpusDirectory, avifDependentLayerFixture.file)
const source = new Uint8Array(await readFile(sourcePath))
if (sha256(source) !== avifDependentLayerFixture.fileSha256) {
  throw new Error('Dependent-layer AVIF source checksum changed')
}

const meta = boxOffset(source, 'meta')
const iloc = boxOffset(source, 'iloc')
const iprp = boxOffset(source, 'iprp')
const ipco = boxOffset(source, 'ipco')
const ispe = boxOffset(source, 'ispe')
const ipma = boxOffset(source, 'ipma')
const mdat = boxOffset(source, 'mdat')
if (ipma + uint32(source, ipma) !== mdat) throw new Error('Unexpected AVIF property layout')

const lsel = Uint8Array.of(0, 0, 0, 10, 0x6c, 0x73, 0x65, 0x6c, 0, 0)
const originalIpmaSize = uint32(source, ipma)
const output = new Uint8Array(source.byteLength + lsel.byteLength + 1)
output.set(source.subarray(0, ipma), 0)
output.set(lsel, ipma)
const outputIpma = ipma + lsel.byteLength
output.set(source.subarray(ipma, ipma + originalIpmaSize), outputIpma)
output.set(source.subarray(ipma + originalIpmaSize), outputIpma + originalIpmaSize + 1)

setUint32(output, meta, uint32(source, meta) + lsel.byteLength + 1)
setUint32(output, iprp, uint32(source, iprp) + lsel.byteLength + 1)
setUint32(output, ipco, uint32(source, ipco) + lsel.byteLength)
setUint32(output, outputIpma, originalIpmaSize + 1)
output[outputIpma + 18] = (output[outputIpma + 18] ?? 0) + 1
output[outputIpma + originalIpmaSize] = 0x86
setUint32(output, iloc + 20, uint32(source, iloc + 20) + lsel.byteLength + 1)
setUint32(output, ispe + 12, avifSelectedBaseLayerFixture.width)
setUint32(output, ispe + 16, avifSelectedBaseLayerFixture.height)

const outputPath = join(avifCorpusDirectory, avifSelectedBaseLayerFixture.file)
const outputSha256 = sha256(output)
if (outputSha256 !== avifSelectedBaseLayerFixture.fileSha256) {
  throw new Error('Selected base-layer AVIF checksum changed')
}
await writeFile(outputPath, output)
console.log(
  JSON.stringify({
    file: avifSelectedBaseLayerFixture.file,
    bytes: output.byteLength,
    sha256: outputSha256,
  }),
)
