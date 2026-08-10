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
import { avifCorpusDirectory } from './corpus.ts'

const file = 'blue-and-magenta-crop.avif'
const fileSha256 = 'fa8fafe0aeddf18586a987ffb3ae26d3548b174ddcfd569c4ba16d4d804c8137'
const yuvSha256 = 'c50dbaedfe2846c692753d1b4b6a760de1d09b4f065403400458e5006ad9d170'

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

const decodePure = async (input: Uint8Array): Promise<Uint8Array> => {
  const inspection = await inspectAvifBitstreams(new MemorySource(input))
  const coded = inspection.codedImages.find((image) => image.role === 'color')
  const obu = coded?.obus.find((candidate) => candidate.type === av1ObuType.frame)
  if (!coded || !obu) throw new Error('Intra-block-copy fixture has no color frame OBU')
  const frame = parseAv1Frame(coded.sequence, obu.payload)
  if (!frame.header.allowIntrabc) throw new Error('Intra-block-copy fixture does not enable IBC')
  return packVisibleYuv(decodeRestrictedAv1Intra(coded.sequence, frame))
}

const decodeOracle = async (
  decoder: 'aom' | 'dav1d',
  path: string,
  outputPath: string,
): Promise<Uint8Array> => {
  const result = spawnSync('avifdec', ['--codec', decoder, '--jobs', '1', path, outputPath], {
    encoding: 'utf8',
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`avifdec ${decoder} failed: ${result.stderr}`)
  }
  const output = await readFile(outputPath)
  const frameOffset = output.indexOf('FRAME\n')
  if (frameOffset < 0) throw new Error(`avifdec ${decoder} produced invalid Y4M`)
  return output.subarray(frameOffset + 6, frameOffset + 6 + 320 * 280 * 3)
}

const firstDifference = (left: Uint8Array, right: Uint8Array): number => {
  const length = Math.min(left.byteLength, right.byteLength)
  for (let index = 0; index < length; index += 1) {
    if (left[index] !== right[index]) return index
  }
  return left.byteLength === right.byteLength ? -1 : length
}

const verify = async (): Promise<void> => {
  const path = join(avifCorpusDirectory, file)
  const input = new Uint8Array(await readFile(path))
  if (sha256(input) !== fileSha256) throw new Error(`${file} checksum changed`)
  const temporaryDirectory = await mkdtemp(join(tmpdir(), 'purejsimage-avif-intrabc-'))
  try {
    const [pure, dav1d, libaom] = await Promise.all([
      decodePure(input),
      decodeOracle('dav1d', path, join(temporaryDirectory, 'dav1d.y4m')),
      decodeOracle('aom', path, join(temporaryDirectory, 'libaom.y4m')),
    ])
    for (const [name, output] of [
      ['dav1d', dav1d],
      ['libaom', libaom],
    ] as const) {
      const difference = firstDifference(pure, output)
      if (difference !== -1) {
        throw new Error(`${file} differs from ${name} at YUV byte ${difference}`)
      }
    }
    if (firstDifference(dav1d, libaom) !== -1) {
      throw new Error(`${file} independent decoders disagree`)
    }
    if (sha256(pure) !== yuvSha256) throw new Error(`${file} YUV checksum changed`)
    console.log(
      JSON.stringify({
        decoders: ['dav1d', 'libaom'],
        file,
        pixels: 320 * 280,
        tolerance: 0,
        yuvSha256,
      }),
    )
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true })
  }
}

await verify()
