import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { PNG } from 'pngjs'

import { allCodecs } from '../../src/codec-entries/all.ts'
import { parseAv1FrameObus } from '../../src/codecs/av1-frame.ts'
import { decodeRestrictedAv1Intra } from '../../src/codecs/av1-intra.ts'
import { inspectAvifBitstreams } from '../../src/codecs/avif.ts'
import { createNodeImageLibrary } from '../../src/node-image.ts'
import { MemorySource } from '../../src/source.ts'
import { avifFilmGrainFixture, avifFilmGrainFixturePath } from './film-grain-fixture.ts'

const Image = createNodeImageLibrary(allCodecs)
const sha256 = (data: Uint8Array): string => createHash('sha256').update(data).digest('hex')
const input = new Uint8Array(await readFile(avifFilmGrainFixturePath))
if (sha256(input) !== avifFilmGrainFixture.fileSha256) {
  throw new Error('AVIF film-grain fixture checksum changed')
}
const inspection = await inspectAvifBitstreams(new MemorySource(input))
const coded = inspection.codedImages.find((image) => image.role === 'color')
if (!coded) throw new Error('AVIF film-grain fixture has no coded color item')
const parsed = parseAv1FrameObus(coded.sequence, coded.obus)
if (!parsed.header.filmGrain) throw new Error('AVIF film-grain parameters are missing')
const frame = decodeRestrictedAv1Intra(coded.sequence, parsed)
const native = new Uint8Array(
  frame.width * frame.height + 2 * frame.chromaWidth * frame.chromaHeight,
)
let target = 0
for (const [plane, width, height, stride] of [
  [frame.y, frame.width, frame.height, frame.yStride],
  [frame.u, frame.chromaWidth, frame.chromaHeight, frame.chromaStride],
  [frame.v, frame.chromaWidth, frame.chromaHeight, frame.chromaStride],
] as const) {
  for (let y = 0; y < height; y += 1) {
    native.set(plane.subarray(y * stride, y * stride + width), target)
    target += width
  }
}
if (sha256(native) !== avifFilmGrainFixture.nativeYuvSha256) {
  throw new Error('AVIF film-grain native YUV checksum changed')
}

const portable = new Uint8Array(
  PNG.sync.read(await (await Image.open(input)).png().toBuffer()).data,
)
if (sha256(portable) !== avifFilmGrainFixture.decodedRgbaSha256) {
  throw new Error('AVIF film-grain portable RGBA checksum changed')
}

const directory = await mkdtemp(join(tmpdir(), 'purejsimage-avif-film-grain-oracle-'))
const results: Array<Record<string, unknown>> = []
try {
  for (const decoder of ['dav1d', 'aom'] as const) {
    const y4mPath = join(directory, `${decoder}.y4m`)
    const pngPath = join(directory, `${decoder}.png`)
    for (const outputPath of [y4mPath, pngPath]) {
      const result = spawnSync(
        'avifdec',
        ['--jobs', '1', '--codec', decoder, avifFilmGrainFixturePath, outputPath],
        { encoding: 'utf8' },
      )
      if (result.error) throw result.error
      if (result.status !== 0) throw new Error(`avifdec ${decoder} failed: ${result.stderr}`)
    }
    const y4m = await readFile(y4mPath)
    const marker = y4m.indexOf(Buffer.from('FRAME\n'))
    if (marker < 0) throw new Error(`avifdec ${decoder} Y4M has no frame marker`)
    const oracleNative = y4m.subarray(marker + 6)
    if (!Buffer.from(native).equals(oracleNative)) {
      throw new Error(`AVIF film-grain native YUV differs from ${decoder}`)
    }
    const oracle = new Uint8Array(PNG.sync.read(await readFile(pngPath)).data)
    if (sha256(oracle) !== avifFilmGrainFixture.oracleRgbaSha256) {
      throw new Error(`AVIF film-grain ${decoder} RGBA checksum changed`)
    }
    let maximumDifference = 0
    for (let index = 0; index < portable.length; index += 1) {
      maximumDifference = Math.max(
        maximumDifference,
        Math.abs((portable[index] ?? 0) - (oracle[index] ?? 0)),
      )
    }
    if (maximumDifference > avifFilmGrainFixture.maximumOracleDifference) {
      throw new Error(`AVIF film-grain portable RGBA drifted from ${decoder}`)
    }
    results.push({ decoder, maximumDifference })
  }
} finally {
  await rm(directory, { recursive: true, force: true })
}

console.log(
  JSON.stringify(
    {
      fixture: avifFilmGrainFixture.file,
      dimensions: `${frame.width}x${frame.height}`,
      nativeYuvSha256: avifFilmGrainFixture.nativeYuvSha256,
      results,
    },
    null,
    2,
  ),
)
