import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { av1ObuType } from '../../src/codecs/av1.ts'
import { parseAv1Frame } from '../../src/codecs/av1-frame.ts'
import { type Av1DecodedFrame, decodeRestrictedAv1Intra } from '../../src/codecs/av1-intra.ts'
import { inspectAvifBitstreams } from '../../src/codecs/avif.ts'
import { MemorySource } from '../../src/source.ts'
import { avifLayeredFixture as fixture, avifLayeredFixturePath as path } from './layered-fixture.ts'

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
  return output.subarray(frameOffset + 6)
}

const input = new Uint8Array(await readFile(path))
if (sha256(input) !== fixture.fileSha256) throw new Error(`${fixture.file} checksum changed`)
const inspection = await inspectAvifBitstreams(new MemorySource(input))
const coded = inspection.codedImages.find((image) => image.role === 'color')
if (!coded) throw new Error(`${fixture.file} has no color item`)
const frameObus = coded.obus.filter((obu) => obu.type === av1ObuType.frame)
if (
  !coded.layerSizes ||
  coded.layerSizes.some((size, index) => size !== fixture.layerSizes[index]) ||
  coded.layerSelector !== fixture.selectedSpatialId ||
  frameObus.length !== fixture.spatialIds.length ||
  frameObus.some((obu, index) => obu.spatialId !== fixture.spatialIds[index])
) {
  throw new Error(`${fixture.file} layered structure changed`)
}
const selected = frameObus.find((obu) => obu.spatialId === fixture.selectedSpatialId)
if (!selected) throw new Error(`${fixture.file} has no selected output frame`)
const pure = packVisibleYuv(
  decodeRestrictedAv1Intra(coded.sequence, parseAv1Frame(coded.sequence, selected.payload)),
)
const temporaryDirectory = await mkdtemp(join(tmpdir(), 'purejsimage-avif-layered-oracles-'))
try {
  const [dav1d, libaom] = await Promise.all([
    decodeOracle('dav1d', join(temporaryDirectory, 'dav1d.y4m')),
    decodeOracle('aom', join(temporaryDirectory, 'libaom.y4m')),
  ])
  if (!Buffer.from(pure).equals(dav1d) || !Buffer.from(dav1d).equals(libaom)) {
    throw new Error(`${fixture.file} native YUV differs across decoders`)
  }
  if (sha256(pure) !== fixture.decodedYuvSha256) throw new Error('Decoded YUV checksum changed')
  console.log(
    JSON.stringify({
      decoders: ['PureJsImage', 'dav1d', 'libaom'],
      file: fixture.file,
      layerSizes: fixture.layerSizes,
      selectedSpatialId: fixture.selectedSpatialId,
      spatialIds: fixture.spatialIds,
      tolerance: 0,
      yuvSha256: fixture.decodedYuvSha256,
    }),
  )
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true })
}
