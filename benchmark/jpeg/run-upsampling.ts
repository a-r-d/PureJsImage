import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'

import sharp from 'sharp'

import { jpegCodec } from '../../src/codecs/jpeg.ts'
import { defaultImageLimits } from '../../src/limits.ts'
import { MemorySource } from '../../src/source.ts'
import { allFixtures, fixturePath, readManifest } from '../lib/corpus.ts'

const manifest = await readManifest()
const fixture = allFixtures(manifest).find((candidate) => candidate.id === 'tundra-4000x3000')
if (!fixture) throw new Error('Pinned tundra-4000x3000 fixture is missing')
const input = await readFile(fixturePath(fixture))

const decode = async (): Promise<Uint8Array> => {
  const decoder = await jpegCodec.createDecoder?.(new MemorySource(input), defaultImageLimits)
  if (!decoder) throw new Error('JPEG decoder is unavailable')
  const output = new Uint8Array(decoder.width * decoder.height * 3)
  for await (const block of decoder.decode()) {
    if (block.format !== 'rgb8') throw new Error('JPEG benchmark expected RGB8 output')
    for (let row = 0; row < block.height; row += 1) {
      const sourceOffset = row * block.stride
      const targetOffset = (block.y + row) * decoder.width * 3
      output.set(block.data.subarray(sourceOffset, sourceOffset + decoder.width * 3), targetOffset)
    }
    block.release?.()
  }
  return output
}

await decode()
const samples: number[] = []
let actual: Uint8Array<ArrayBufferLike> = new Uint8Array()
for (let run = 0; run < 5; run += 1) {
  const startedAt = performance.now()
  actual = await decode()
  samples.push(performance.now() - startedAt)
}
samples.sort((left, right) => left - right)
const reference = await sharp(input).removeAlpha().raw().toBuffer()
if (actual.byteLength !== reference.byteLength) throw new Error('libjpeg output size differs')
let totalError = 0
let maximumChannelError = 0
for (let offset = 0; offset < actual.byteLength; offset += 1) {
  const error = Math.abs((actual[offset] ?? 0) - (reference[offset] ?? 0))
  totalError += error
  maximumChannelError = Math.max(maximumChannelError, error)
}
console.log(
  JSON.stringify(
    {
      fixture: fixture.id,
      dimensions: '4000x3000',
      oracle: 'Sharp/libvips/libjpeg fancy upsampling',
      medianMilliseconds: samples[2],
      samples,
      meanAbsoluteError: totalError / actual.byteLength,
      maximumChannelError,
      outputSha256: createHash('sha256').update(actual).digest('hex'),
    },
    undefined,
    2,
  ),
)
