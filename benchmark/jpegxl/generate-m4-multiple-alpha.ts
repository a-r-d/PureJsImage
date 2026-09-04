import { spawnSync } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import {
  JpegXlBitWriter,
  writeU32,
  writeModularHeader,
  writeModularTree,
  writePrefixCode,
  writeHybridUint,
} from '../../src/codecs/jpegxl-modular-encode.ts'
import { jpegxlCodec } from '../../src/codecs/jpegxl.ts'
import { MemorySource } from '../../src/source.ts'
import { defaultImageLimits } from '../../src/limits.ts'
const section = new JpegXlBitWriter()
section.writeBits(1, 1) // default DC quantization
section.writeBits(0, 1) // local tree
writeModularHeader(section, false)
writeModularTree(section, 0)
const samples = Uint8Array.of(10, 20, 30, 40, 50, 60, 70, 80, 90, 100)
const frequencies = new Uint32Array(256)
for (const sample of samples) frequencies[sample * 2] = (frequencies[sample * 2] ?? 0) + 1
const entropy = writePrefixCode(section, 1, frequencies)
for (const sample of samples) writeHybridUint(section, sample * 2, entropy)
const payload = section.finish()
const writer = new JpegXlBitWriter()
const field = (value: number, count: number): void => writer.writeBits(value, count)
field(0xff, 8)
field(0x0a, 8)
field(0, 1)
field(0, 2)
field(0, 9) // height 1
field(0, 3)
field(0, 2)
field(1, 9) // width 2
field(0, 1)
field(0, 1) // explicit metadata, no extra fields
field(0, 1)
field(0, 2)
field(1, 1) // integer 8-bit, sufficient buffer
field(2, 2)
field(0, 4) // two extra channels
field(1, 1)
field(1, 1) // two default alpha channels
field(0, 1)
field(1, 1) // no XYB, default sRGB
field(0, 2)
field(1, 1)
writer.alignToByte()
field(0, 1)
field(0, 2)
field(1, 1) // regular Modular frame
field(0, 2)
field(0, 1) // flags, no YCbCr
field(0, 2)
field(0, 2)
field(0, 2) // color and two alpha upsampling factors
field(3, 2)
field(0, 2) // group size, one pass
field(0, 1) // default dimensions
field(0, 2)
field(0, 2)
field(0, 2) // replace color and extra channels
field(1, 1)
field(0, 2) // last, empty name
field(0, 1)
field(0, 1)
field(0, 2) // explicit loop filter, no Gaborish or EPF
field(0, 2)
field(0, 2)
field(0, 1)
writer.alignToByte() // no extensions or TOC permutation
writeU32(writer, payload.length, [
  { bits: 10, offset: 0 },
  { bits: 14, offset: 1024 },
  { bits: 22, offset: 17408 },
  { bits: 30, offset: 4211712 },
])
const header = writer.finish()
const encoded = new Uint8Array(header.length + payload.length)
encoded.set(header)
encoded.set(payload, header.length)
const path = 'tests/fixtures/jpegxl/m4-color/multiple-alpha.jxl'
await writeFile(path, encoded)
const result = spawnSync(
  '.tmp/jpegxl-oracles/libjxl-v0.12.0/source/build-pinned/tools/djxl',
  [path, '.tmp/jpegxl-m4-color/multiple-alpha.npy', '--num_threads=1'],
  { encoding: 'utf8' },
)
if (result.status !== 0) throw new Error(result.stderr)
const npy = await readFile('.tmp/jpegxl-m4-color/multiple-alpha.npy')
const start = 10 + npy.readUInt16LE(8)
const expected = [10, 30, 50, 70, 90, 20, 40, 60, 80, 100]
for (let index = 0; index < expected.length; index += 1) {
  if (Math.abs(npy.readFloatLE(start + index * 4) * 255 - (expected[index] ?? 0)) > 1e-4)
    throw new Error('Multiple-alpha oracle samples differ')
}
for (const alphaChannel of [0, 1]) {
  const decoder = await jpegxlCodec.createDecoder?.(new MemorySource(encoded), defaultImageLimits, {
    alphaChannel,
  })
  for await (const block of decoder?.decode() ?? []) {
    try {
      for (let x = 0; x < 2; x += 1)
        for (let c = 0; c < 4; c += 1) {
          if (block.data[x * 4 + c] !== expected[x * 5 + (c === 3 ? 3 + alphaChannel : c)])
            throw new Error('Selected alpha samples differ')
        }
    } finally {
      block.release?.()
    }
  }
}
console.log('Both alpha channels match the five-channel djxl output')
