import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { inspectJpegXlStructure } from '../../src/codecs/jpegxl.ts'

const concatenate = (parts: readonly Uint8Array[]): Uint8Array => {
  const output = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
  let offset = 0
  for (const part of parts) {
    output.set(part, offset)
    offset += part.length
  }
  return output
}
const box = (type: string, data: Uint8Array): Uint8Array => {
  const output = new Uint8Array(data.length + 8)
  new DataView(output.buffer).setUint32(0, output.length)
  output.set(new TextEncoder().encode(type), 4)
  output.set(data, 8)
  return output
}
const input = new Uint8Array(await readFile('tests/fixtures/jpegxl/m4-color/srgb-12.jxl'))
const structure = await inspectJpegXlStructure(input)
const codestream = concatenate(
  structure.codestreamSegments.map((segment) =>
    input.subarray(segment.offset, segment.offset + segment.length),
  ),
)
const chunks = [
  box('JXL ', Uint8Array.of(13, 10, 135, 10)),
  box('ftyp', Uint8Array.of(106, 120, 108, 32, 0, 0, 0, 0, 106, 120, 108, 32)),
]
for (let i = 0; i < 4; i += 1) {
  const index = new Uint8Array(4)
  new DataView(index.buffer).setUint32(0, i + (i === 3 ? 0x80000000 : 0))
  chunks.push(
    box(
      'jxlp',
      concatenate([
        index,
        codestream.subarray(
          Math.floor((i * codestream.length) / 4),
          Math.floor(((i + 1) * codestream.length) / 4),
        ),
      ]),
    ),
  )
}
await mkdir('tests/fixtures/jpegxl/m5-pipeline', { recursive: true })
await writeFile('tests/fixtures/jpegxl/m5-pipeline/segmented.jxl', concatenate(chunks))
