import jpeg from 'jpeg-js'
import { beforeAll, describe, expect, it } from 'vitest'

import type { Image as ImagePipeline } from '../src/index.ts'
import { createCodecFixtures, type CodecFixture } from './codec-fixtures.ts'
import { Image } from './image-library.ts'

const transformedJpeg = (image: ImagePipeline): Promise<Buffer> =>
  image
    .resize({ width: 16, height: 14, fit: 'fill', kernel: 'nearest' })
    .crop({ x: 2, y: 2, width: 12, height: 10 })
    .resize({ width: 8, height: 6, fit: 'fill', kernel: 'nearest' })
    .rotate(90)
    .flip()
    .flop()
    .jpeg({ quality: 90, chromaSubsampling: '444', background: '#ffffff' })
    .toBuffer()

describe('ordered transforms across codecs', () => {
  let fixtures: readonly CodecFixture[] = []

  beforeAll(async () => {
    fixtures = await createCodecFixtures()
  })

  it('matches a lossless normalized reference for every supported decoder', async () => {
    for (const fixture of fixtures) {
      const normalized = await (await Image.open(fixture.input)).png().toBuffer()
      const [direct, reference] = await Promise.all([
        transformedJpeg(await Image.open(fixture.input)),
        transformedJpeg(await Image.open(normalized)),
      ])
      const decoded = jpeg.decode(direct, { formatAsRGBA: true, useTArray: true })

      expect(decoded.width, fixture.format).toBe(6)
      expect(decoded.height, fixture.format).toBe(8)
      if (fixture.format === 'jpeg') {
        const decodedReference = jpeg.decode(reference, { formatAsRGBA: true, useTArray: true })
        let absoluteError = 0
        for (let index = 0; index < decoded.data.byteLength; index += 1) {
          absoluteError += Math.abs(
            (decoded.data[index] ?? 0) - (decodedReference.data[index] ?? 0),
          )
        }
        expect(absoluteError / decoded.data.byteLength, fixture.format).toBeLessThan(16)
      } else {
        expect(direct, fixture.format).toEqual(reference)
      }
    }
  }, 60_000)
})
