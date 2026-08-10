import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { parseAv1FrameObus } from '../../src/codecs/av1-frame.ts'
import { decodeRestrictedAv1Intra, type Av1DecodedFrame } from '../../src/codecs/av1-intra.ts'
import { inspectAvifBitstreams } from '../../src/codecs/avif.ts'
import { MemorySource } from '../../src/source.ts'
import {
  avifNonstillSequenceFixture as fixture,
  avifNonstillSequenceFixturePath as path,
} from './nonstill-sequence-fixture.ts'

const sha256 = (data: Uint8Array): string => createHash('sha256').update(data).digest('hex')

const packVisibleYuv = (frame: Av1DecodedFrame): Uint8Array => {
  const output = new Uint8Array(
    frame.width * frame.height + 2 * frame.chromaWidth * frame.chromaHeight,
  )
  let offset = 0
  for (const [plane, stride, width, height] of [
    [frame.y, frame.yStride, frame.width, frame.height],
    [frame.u, frame.chromaStride, frame.chromaWidth, frame.chromaHeight],
    [frame.v, frame.chromaStride, frame.chromaWidth, frame.chromaHeight],
  ] as const) {
    for (let row = 0; row < height; row += 1) {
      output.set(plane.subarray(row * stride, row * stride + width), offset)
      offset += width
    }
  }
  return output
}

const decodeOracle = async (decoder: 'aom' | 'dav1d', outputPath: string): Promise<Uint8Array> => {
  const result = spawnSync('avifdec', ['--codec', decoder, '--jobs', '1', path, outputPath], {
    encoding: 'utf8',
  })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`avifdec ${decoder} failed: ${result.stderr}`)
  const output = await readFile(outputPath)
  const frameOffset = output.indexOf('FRAME\n')
  if (frameOffset < 0) throw new Error(`avifdec ${decoder} produced invalid Y4M`)
  const payloadBytes = (fixture.width * fixture.height * 3) / 2
  return output.subarray(frameOffset + 6, frameOffset + 6 + payloadBytes)
}

const firstDifference = (left: Uint8Array, right: Uint8Array): number => {
  const length = Math.min(left.byteLength, right.byteLength)
  for (let index = 0; index < length; index += 1) {
    if (left[index] !== right[index]) return index
  }
  return left.byteLength === right.byteLength ? -1 : length
}

const input = new Uint8Array(await readFile(path))
if (sha256(input) !== fixture.fileSha256) throw new Error(`${fixture.file} checksum changed`)
const inspection = await inspectAvifBitstreams(new MemorySource(input))
const coded = inspection.codedImages.find((image) => image.role === 'color')
if (!coded) throw new Error(`${fixture.file} has no color item`)
if (coded.sequence.stillPicture || coded.sequence.reducedStillPictureHeader) {
  throw new Error(`${fixture.file} no longer exercises a non-still sequence header`)
}
const frame = parseAv1FrameObus(coded.sequence, coded.obus)
const pure = packVisibleYuv(decodeRestrictedAv1Intra(coded.sequence, frame))
const temporaryDirectory = await mkdtemp(join(tmpdir(), 'purejsimage-avif-nonstill-sequence-'))
try {
  const [dav1d, libaom] = await Promise.all([
    decodeOracle('dav1d', join(temporaryDirectory, 'dav1d.y4m')),
    decodeOracle('aom', join(temporaryDirectory, 'libaom.y4m')),
  ])
  for (const [name, output] of [
    ['dav1d', dav1d],
    ['libaom', libaom],
  ] as const) {
    const difference = firstDifference(pure, output)
    if (difference !== -1)
      throw new Error(`${fixture.file} differs from ${name} at YUV byte ${difference}`)
  }
  if (firstDifference(dav1d, libaom) !== -1) throw new Error('Independent AV1 decoders disagree')
  if (sha256(pure) !== fixture.decodedYuvSha256) throw new Error('Decoded YUV checksum changed')
  console.log(
    JSON.stringify({
      decoders: ['PureJsImage', 'dav1d', 'libaom'],
      file: fixture.file,
      pixels: fixture.width * fixture.height,
      sequenceStillPicture: coded.sequence.stillPicture,
      tolerance: 0,
      yuvSha256: fixture.decodedYuvSha256,
    }),
  )
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true })
}
