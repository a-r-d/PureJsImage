import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'

import { parseAv1Frame } from '../../src/codecs/av1-frame.ts'
import { decodeRestrictedAv1Intra, type Av1DecodedFrame } from '../../src/codecs/av1-intra.ts'
import { av1ObuType } from '../../src/codecs/av1.ts'
import { inspectAvifBitstreams } from '../../src/codecs/avif.ts'
import { MemorySource } from '../../src/source.ts'
import { avifSegmentationFixture, avifSegmentationFixturePath } from './segmentation-fixture.ts'

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
      avifSegmentationFixturePath,
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

const input = new Uint8Array(await readFile(avifSegmentationFixturePath))
if (sha256(input) !== avifSegmentationFixture.fileSha256) {
  throw new Error(`${avifSegmentationFixture.file} checksum changed`)
}
const inspection = await inspectAvifBitstreams(new MemorySource(input))
const coded = inspection.codedImages.find((image) => image.role === 'color')
const obu = coded?.obus.find((candidate) => candidate.type === av1ObuType.frame)
if (!coded || !obu) throw new Error('AVIF segmentation fixture has no color frame OBU')
const frame = parseAv1Frame(coded.sequence, obu.payload)
const segmentQuantizerDeltas = frame.header.segmentation.featureData
  .slice(0, 4)
  .map((features) => features[0] ?? 0)
if (
  !frame.header.segmentation.enabled ||
  frame.header.segmentation.lastActiveId !== 3 ||
  segmentQuantizerDeltas.some(
    (delta, index) => delta !== avifSegmentationFixture.segmentQuantizerDeltas[index],
  )
) {
  throw new Error('AVIF segmentation fixture syntax changed')
}
const pure = packVisibleYuv(decodeRestrictedAv1Intra(coded.sequence, frame))
const [dav1d, libaom] = await Promise.all([decodeOracle('libdav1d'), decodeOracle('libaom-av1')])
for (const [name, output] of [
  ['PureJsImage', pure],
  ['dav1d', dav1d],
  ['libaom', libaom],
] as const) {
  const checksum = sha256(output)
  if (checksum !== avifSegmentationFixture.decodedYuvSha256) {
    throw new Error(`${name} segmentation fixture YUV checksum changed: ${checksum}`)
  }
}
console.log(
  JSON.stringify(
    {
      decoders: ['PureJsImage', 'dav1d', 'libaom'],
      file: avifSegmentationFixture.file,
      frame: `${frame.header.frameWidth}x${frame.header.frameHeight}`,
      segmentQuantizerDeltas,
      yuvSha256: avifSegmentationFixture.decodedYuvSha256,
    },
    null,
    2,
  ),
)
