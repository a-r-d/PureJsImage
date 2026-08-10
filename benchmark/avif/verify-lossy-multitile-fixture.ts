import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'

import { parseAv1Frame } from '../../src/codecs/av1-frame.ts'
import { decodeRestrictedAv1Intra, type Av1DecodedFrame } from '../../src/codecs/av1-intra.ts'
import { av1ObuType } from '../../src/codecs/av1.ts'
import { inspectAvifBitstreams } from '../../src/codecs/avif.ts'
import { MemorySource } from '../../src/source.ts'
import {
  avifLossyMultitileFixture,
  avifLossyMultitileFixturePath,
} from './lossy-multitile-fixture.ts'

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

const decodeOracle = (decoder: 'libaom-av1' | 'libdav1d'): Promise<Uint8Array> =>
  new Promise((resolve, reject) => {
    const child = spawn('ffmpeg', [
      '-v',
      'error',
      '-c:v',
      decoder,
      '-i',
      avifLossyMultitileFixturePath,
      '-frames:v',
      '1',
      '-pix_fmt',
      'yuv420p',
      '-f',
      'rawvideo',
      'pipe:1',
    ])
    const chunks: Uint8Array[] = []
    const errors: Uint8Array[] = []
    child.stdout.on('data', (chunk: Uint8Array) => chunks.push(chunk))
    child.stderr.on('data', (chunk: Uint8Array) => errors.push(chunk))
    child.on('error', reject)
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`ffmpeg ${decoder} failed: ${Buffer.concat(errors).toString()}`))
        return
      }
      resolve(Buffer.concat(chunks))
    })
  })

const fixture = avifLossyMultitileFixture
const input = new Uint8Array(await readFile(avifLossyMultitileFixturePath))
if (sha256(input) !== fixture.fileSha256) throw new Error(`${fixture.file} checksum changed`)
const inspection = await inspectAvifBitstreams(new MemorySource(input))
const coded = inspection.codedImages.find((image) => image.role === 'color')
const obu = coded?.obus.find((candidate) => candidate.type === av1ObuType.frame)
if (!coded || !obu) throw new Error(`${fixture.file} has no color frame OBU`)
const parsed = parseAv1Frame(coded.sequence, obu.payload)
if (
  parsed.tiles.length !== fixture.columns * fixture.rows ||
  parsed.header.allLossless ||
  parsed.header.loopFilterLevels.every((level) => level === 0) ||
  parsed.header.cdefYPrimaryStrengths.every((strength) => strength === 0) ||
  parsed.header.restorationTypes.every((type) => type === 0)
) {
  throw new Error(`${fixture.file} lossy multi-tile filter configuration changed`)
}
const pure = packVisibleYuv(decodeRestrictedAv1Intra(coded.sequence, parsed))
if (sha256(pure) !== fixture.pureYuvSha256) {
  throw new Error(`PureJsImage ${fixture.file} YUV checksum changed`)
}
const [dav1d, libaom] = await Promise.all([decodeOracle('libdav1d'), decodeOracle('libaom-av1')])
for (const [name, output] of [
  ['dav1d', dav1d],
  ['libaom', libaom],
] as const) {
  if (sha256(output) !== fixture.oracleYuvSha256) {
    throw new Error(`${name} ${fixture.file} YUV checksum changed`)
  }
}
let differences = 0
let maximumDifference = 0
for (let index = 0; index < pure.length; index += 1) {
  const difference = Math.abs((pure[index] ?? 0) - (dav1d[index] ?? 0))
  if (difference !== 0) differences += 1
  maximumDifference = Math.max(maximumDifference, difference)
}
if (
  differences !== fixture.nativeYuvDifferenceCount ||
  maximumDifference !== fixture.maximumNativeYuvDifference
) {
  throw new Error(
    `${fixture.file} native YUV tolerance changed: ${differences} differences, maximum ${maximumDifference}`,
  )
}
console.log(
  JSON.stringify(
    {
      decoders: ['PureJsImage', 'dav1d', 'libaom'],
      differences,
      file: fixture.file,
      maximumDifference,
      tiles: `${fixture.columns}x${fixture.rows}`,
    },
    null,
    2,
  ),
)
