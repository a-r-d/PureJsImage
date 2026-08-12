import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { PNG } from 'pngjs'
import { describe, expect, it } from 'vitest'

import {
  avifCommonPhotoSyntaxFixturePath,
  avifCommonPhotoSyntaxFixtures,
} from '../benchmark/avif/common-photo-syntax-fixtures.ts'
import { avifCorpusDirectory } from '../benchmark/avif/corpus.ts'
import { avifCodec } from '../src/codecs/avif.ts'
import { defaultImageLimits } from '../src/limits.ts'
import { MemorySource } from '../src/source.ts'
import { Image } from './image-library.ts'

describe('AVIF photographic decode', () => {
  it.each(avifCommonPhotoSyntaxFixtures)(
    'decodes $file with portable common-photo syntax contexts',
    async (fixture) => {
      const input = await readFile(avifCommonPhotoSyntaxFixturePath(fixture))
      const image = await Image.open(input)
      const metadata = await image.metadata()
      const output = PNG.sync.read(await image.png().toBuffer())

      expect(createHash('sha256').update(input).digest('hex')).toBe(fixture.fileSha256)
      expect(metadata).toMatchObject({
        bitDepth: 8,
        chromaSubsampling: fixture.chromaSubsampling,
        height: fixture.height,
        width: fixture.width,
      })
      expect([output.width, output.height]).toEqual([fixture.width, fixture.height])
      expect(createHash('sha256').update(output.data).digest('hex')).toBe(fixture.rgbaSha256)
    },
    20_000,
  )

  it.each([
    {
      file: 'kodim03_yuv420_8bpc.avif',
      width: 768,
      height: 512,
      rgbaSha256: '47e9bd0a4f371bc44abd8afeb3d1e271c94b423bd60f3edff7761cfbdcbe2375',
    },
    {
      file: 'fox.profile0.8bpc.yuv420.avif',
      width: 1204,
      height: 800,
      rgbaSha256: 'cd94cd9d459af6338f77cf401749656b647f88b9e357c737a0a88c34584a46ec',
    },
    {
      file: 'fox.profile0.8bpc.yuv420.monochrome.avif',
      width: 1204,
      height: 800,
      rgbaSha256: '207521f4de944619a5f14b107d39b2a4dab7aafe8fae3082ea6bbb4ba27b38bc',
    },
    {
      file: 'fox.profile1.8bpc.yuv444.avif',
      width: 1204,
      height: 800,
      rgbaSha256: 'd46498beea49ddf03420810e33d30a2534395827bd19b22a287a6031debf9cd1',
    },
    {
      file: 'fox.profile2.8bpc.yuv422.avif',
      width: 1204,
      height: 800,
      rgbaSha256: '4ef692312c9c87692b548ebbd6ba100feb3ec53f5b1929bdd9f2c86d78a31f95',
    },
  ] as const)(
    'decodes the common opaque 8-bit photograph $file',
    async (fixture) => {
      const output = PNG.sync.read(
        await (await Image.open(join(avifCorpusDirectory, fixture.file))).png().toBuffer(),
      )

      expect([output.width, output.height]).toEqual([fixture.width, fixture.height])
      expect(createHash('sha256').update(output.data).digest('hex')).toBe(fixture.rgbaSha256)
    },
    20_000,
  )

  it('converts a requested AVIF region into bounded ordered row blocks', async () => {
    const input = new Uint8Array(
      await readFile(join(avifCorpusDirectory, 'fox.profile0.8bpc.yuv420.avif')),
    )
    const decoder = await avifCodec.createDecoder?.(new MemorySource(input), defaultImageLimits)
    if (!decoder) throw new Error('AVIF decoder is unavailable')
    const blocks: ReadonlyArray<number>[] = []
    const hash = createHash('sha256')
    for await (const block of decoder.decode({ x: 37, y: 41, width: 73, height: 70 })) {
      blocks.push([block.x, block.y, block.width, block.height, block.stride])
      hash.update(block.data)
    }

    expect(blocks).toEqual([
      [0, 0, 73, 32, 292],
      [0, 32, 73, 32, 292],
      [0, 64, 73, 6, 292],
    ])
    expect(hash.digest('hex')).toBe(
      '78f5c448c85d19567bf74ac4d62a7f1835082d11d08fde361150d4bfdc1bffc9',
    )
  })
})
