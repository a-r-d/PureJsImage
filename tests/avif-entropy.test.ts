import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { PNG } from 'pngjs'
import { describe, expect, it } from 'vitest'

import {
  avifNonstillSequenceFixture,
  avifNonstillSequenceFixturePath,
} from '../benchmark/avif/nonstill-sequence-fixture.ts'
import {
  avifStillPictureEntropyFixturePath,
  avifStillPictureEntropyFixtures,
} from '../benchmark/avif/still-picture-entropy-fixtures.ts'
import { av1ObuType } from '../src/codecs/av1.ts'
import { parseAv1Frame } from '../src/codecs/av1-frame.ts'
import { type Av1DecodedFrame, decodeRestrictedAv1Intra } from '../src/codecs/av1-intra.ts'
import { inspectAvifBitstreams } from '../src/codecs/avif.ts'
import { MemorySource } from '../src/source.ts'
import { Image } from './image-library.ts'

const visibleYuvSha256 = (frame: Av1DecodedFrame): string => {
  const hash = createHash('sha256')
  for (let row = 0; row < frame.height; row += 1) {
    hash.update(frame.y.subarray(row * frame.yStride, row * frame.yStride + frame.width))
  }
  for (const plane of [frame.u, frame.v]) {
    for (let row = 0; row < frame.chromaHeight; row += 1) {
      hash.update(
        plane.subarray(row * frame.chromaStride, row * frame.chromaStride + frame.chromaWidth),
      )
    }
  }
  return hash.digest('hex')
}

describe('AVIF entropy decode', () => {
  it('decodes a non-still sequence header containing one shown key frame', async () => {
    const fixture = avifNonstillSequenceFixture
    const input = await readFile(avifNonstillSequenceFixturePath)
    const metadata = await (await Image.open(input)).metadata()
    const inspection = await inspectAvifBitstreams(new MemorySource(input))
    const coded = inspection.codedImages.find((image) => image.role === 'color')
    if (!coded) throw new Error('Non-still sequence fixture has no color item')
    const output = PNG.sync.read(await (await Image.open(input)).png().toBuffer())

    expect(createHash('sha256').update(input).digest('hex')).toBe(fixture.fileSha256)
    expect(coded.sequence).toMatchObject({
      stillPicture: false,
      reducedStillPictureHeader: false,
    })
    expect(metadata).toMatchObject({
      bitDepth: 8,
      chromaSubsampling: '420',
      frames: 1,
      height: fixture.height,
      width: fixture.width,
    })
    expect([output.width, output.height]).toEqual([fixture.width, fixture.height])
    expect(createHash('sha256').update(output.data).digest('hex')).toBe(fixture.decodedRgbaSha256)
  }, 20_000)

  it.each(avifStillPictureEntropyFixtures)(
    'decodes $file through AV1 still-picture entropy termination',
    async (fixture) => {
      const input = new Uint8Array(await readFile(avifStillPictureEntropyFixturePath(fixture)))
      const inspection = await inspectAvifBitstreams(new MemorySource(input))
      const coded = inspection.codedImages.find((image) => image.role === 'color')
      const frameObu = coded?.obus.find((obu) => obu.type === av1ObuType.frame)
      if (!coded || !frameObu) throw new Error(`${fixture.file} has no color frame OBU`)
      const frame = parseAv1Frame(coded.sequence, frameObu.payload)
      const decoded = decodeRestrictedAv1Intra(coded.sequence, frame)
      const output = PNG.sync.read(await (await Image.open(input)).png().toBuffer())

      expect(createHash('sha256').update(input).digest('hex')).toBe(fixture.fileSha256)
      expect(frame.header.allowIntrabc).toBe(fixture.allowIntrabc)
      expect([decoded.width, decoded.height]).toEqual([fixture.width, fixture.height])
      expect(visibleYuvSha256(decoded)).toBe(fixture.nativeYuvSha256)
      expect([output.width, output.height]).toEqual([fixture.width, fixture.height])
      expect(createHash('sha256').update(output.data).digest('hex')).toBe(fixture.rgbaSha256)
    },
    20_000,
  )
})
