import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { parseAv1Frame } from '../../src/codecs/av1-frame.ts'
import { decodeRestrictedAv1Intra, type Av1DecodedFrame } from '../../src/codecs/av1-intra.ts'
import { av1ObuType } from '../../src/codecs/av1.ts'
import { inspectAvifBitstreams } from '../../src/codecs/avif.ts'
import { MemorySource } from '../../src/source.ts'
import {
  avifCommonPhotoSyntaxFixturePath,
  avifCommonPhotoSyntaxFixtures,
  type AvifCommonPhotoSyntaxFixture,
} from './common-photo-syntax-fixtures.ts'

const sha256 = (data: Uint8Array): string => createHash('sha256').update(data).digest('hex')

const packVisibleYuv = (frame: Av1DecodedFrame): Uint8Array => {
  const output = new Uint8Array(
    frame.width * frame.height + 2 * frame.chromaWidth * frame.chromaHeight,
  )
  let offset = 0
  for (let row = 0; row < frame.height; row += 1) {
    output.set(frame.y.subarray(row * frame.yStride, row * frame.yStride + frame.width), offset)
    offset += frame.width
  }
  for (const plane of [frame.u, frame.v]) {
    for (let row = 0; row < frame.chromaHeight; row += 1) {
      output.set(
        plane.subarray(row * frame.chromaStride, row * frame.chromaStride + frame.chromaWidth),
        offset,
      )
      offset += frame.chromaWidth
    }
  }
  return output
}

const decodePure = async (input: Uint8Array, file: string): Promise<Uint8Array> => {
  const inspection = await inspectAvifBitstreams(new MemorySource(input))
  const coded = inspection.codedImages.find((image) => image.role === 'color')
  const obu = coded?.obus.find((candidate) => candidate.type === av1ObuType.frame)
  if (!coded || !obu) throw new Error(`${file} has no color frame OBU`)
  const frame = parseAv1Frame(coded.sequence, obu.payload)
  return packVisibleYuv(decodeRestrictedAv1Intra(coded.sequence, frame))
}

const decodeOracle = async (
  decoder: 'aom' | 'dav1d',
  fixture: AvifCommonPhotoSyntaxFixture,
  outputPath: string,
): Promise<Uint8Array> => {
  const result = spawnSync(
    'avifdec',
    ['--codec', decoder, '--jobs', '1', avifCommonPhotoSyntaxFixturePath(fixture), outputPath],
    { encoding: 'utf8' },
  )
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`avifdec ${decoder} failed: ${result.stderr}`)
  const output = await readFile(outputPath)
  const frameOffset = output.indexOf('FRAME\n')
  if (frameOffset < 0) throw new Error(`avifdec ${decoder} produced invalid Y4M`)
  const lumaBytes = fixture.width * fixture.height
  const expectedBytes =
    fixture.chromaSubsampling === '420'
      ? lumaBytes + 2 * (fixture.width >> 1) * (fixture.height >> 1)
      : lumaBytes * 3
  return output.subarray(frameOffset + 6, frameOffset + 6 + expectedBytes)
}

const firstDifference = (left: Uint8Array, right: Uint8Array): number => {
  const length = Math.min(left.byteLength, right.byteLength)
  for (let index = 0; index < length; index += 1) {
    if (left[index] !== right[index]) return index
  }
  return left.byteLength === right.byteLength ? -1 : length
}

const verify = async (): Promise<void> => {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), 'purejsimage-avif-common-syntax-'))
  try {
    const results: Array<{
      readonly chromaSubsampling: '420' | '444'
      readonly decoders: readonly ['dav1d', 'libaom']
      readonly file: string
      readonly pixels: number
      readonly tolerance: 0
      readonly yuvSha256: string
    }> = []
    for (const fixture of avifCommonPhotoSyntaxFixtures) {
      const input = new Uint8Array(await readFile(avifCommonPhotoSyntaxFixturePath(fixture)))
      if (sha256(input) !== fixture.fileSha256) throw new Error(`${fixture.file} checksum changed`)
      const [pure, dav1d, libaom] = await Promise.all([
        decodePure(input, fixture.file),
        decodeOracle('dav1d', fixture, join(temporaryDirectory, `${fixture.file}-dav1d.y4m`)),
        decodeOracle('aom', fixture, join(temporaryDirectory, `${fixture.file}-libaom.y4m`)),
      ])
      for (const [name, output] of [
        ['dav1d', dav1d],
        ['libaom', libaom],
      ] as const) {
        const difference = firstDifference(pure, output)
        if (difference !== -1) {
          throw new Error(`${fixture.file} differs from ${name} at YUV byte ${difference}`)
        }
      }
      if (firstDifference(dav1d, libaom) !== -1) {
        throw new Error(`${fixture.file} independent decoders disagree`)
      }
      if (sha256(pure) !== fixture.nativeYuvSha256) {
        throw new Error(`${fixture.file} YUV checksum changed`)
      }
      results.push({
        chromaSubsampling: fixture.chromaSubsampling,
        decoders: ['dav1d', 'libaom'],
        file: fixture.file,
        pixels: fixture.width * fixture.height,
        tolerance: 0,
        yuvSha256: fixture.nativeYuvSha256,
      })
    }
    console.log(JSON.stringify({ results }, undefined, 2))
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true })
  }
}

await verify()
