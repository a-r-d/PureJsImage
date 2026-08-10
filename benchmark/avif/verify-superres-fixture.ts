import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { parseAv1Frame } from '../../src/codecs/av1-frame.ts'
import { decodeRestrictedAv1Intra, type Av1DecodedFrame } from '../../src/codecs/av1-intra.ts'
import { av1ObuType } from '../../src/codecs/av1.ts'
import { inspectAvifBitstreams } from '../../src/codecs/avif.ts'
import { MemorySource } from '../../src/source.ts'
import {
  avifSuperresFixtureDirectory,
  avifSuperresFixtures,
  type AvifSuperresFixture,
} from './superres-fixture.ts'

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

const decodeOracle = (
  decoder: 'libaom-av1' | 'libdav1d',
  fixture: AvifSuperresFixture,
): Promise<Uint8Array> =>
  new Promise((resolve, reject) => {
    const child = spawn('ffmpeg', [
      '-v',
      'error',
      '-c:v',
      decoder,
      '-i',
      join(avifSuperresFixtureDirectory, fixture.file),
      '-frames:v',
      '1',
      '-pix_fmt',
      fixture.chromaSubsampling === '444' ? 'gbrp' : 'yuv420p',
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

const results: Array<{
  readonly chromaSubsampling: string
  readonly codedWidth: number
  readonly file: string
  readonly output: string
  readonly yuvSha256: string
}> = []
for (const fixture of avifSuperresFixtures) {
  const fixturePath = join(avifSuperresFixtureDirectory, fixture.file)
  const input = new Uint8Array(await readFile(fixturePath))
  if (sha256(input) !== fixture.fileSha256) throw new Error(`${fixture.file} checksum changed`)
  const inspection = await inspectAvifBitstreams(new MemorySource(input))
  const coded = inspection.codedImages.find((image) => image.role === 'color')
  const obu = coded?.obus.find((candidate) => candidate.type === av1ObuType.frame)
  if (!coded || !obu) throw new Error(`${fixture.file} has no color frame OBU`)
  const parsed = parseAv1Frame(coded.sequence, obu.payload)
  if (
    parsed.header.frameWidth !== fixture.codedWidth ||
    parsed.header.upscaledWidth !== fixture.width ||
    parsed.header.frameHeight !== fixture.height ||
    coded.sequence.chromaSubsampling !== fixture.chromaSubsampling
  ) {
    throw new Error(`${fixture.file} frame configuration changed`)
  }
  const pure = packVisibleYuv(decodeRestrictedAv1Intra(coded.sequence, parsed))
  const [dav1d, libaom] = await Promise.all([
    decodeOracle('libdav1d', fixture),
    decodeOracle('libaom-av1', fixture),
  ])
  for (const [name, output] of [
    ['PureJsImage', pure],
    ['dav1d', dav1d],
    ['libaom', libaom],
  ] as const) {
    const checksum = sha256(output)
    if (checksum !== fixture.decodedYuvSha256) {
      throw new Error(`${name} ${fixture.file} YUV checksum changed: ${checksum}`)
    }
  }
  results.push({
    chromaSubsampling: fixture.chromaSubsampling,
    codedWidth: parsed.header.frameWidth,
    file: fixture.file,
    output: `${parsed.header.upscaledWidth}x${parsed.header.frameHeight}`,
    yuvSha256: fixture.decodedYuvSha256,
  })
}
console.log(
  JSON.stringify(
    {
      decoders: ['PureJsImage', 'dav1d', 'libaom'],
      superresDenominator: 12,
      results,
    },
    null,
    2,
  ),
)
