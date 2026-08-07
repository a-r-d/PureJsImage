import { describe, expect, it } from 'vitest'
import { PNG } from 'pngjs'

import { allCodecs } from '../src/codec-entries/all.ts'
import { jpegCodec } from '../src/codec-entries/jpeg.ts'
import { pngCodec } from '../src/codec-entries/png.ts'
import { createImageLibrary } from '../src/index.ts'
import { jpegFixture } from './fixtures.ts'

const pngFixture = (): Uint8Array => PNG.sync.write(new PNG({ width: 4, height: 3 }))

describe('configured image library', () => {
  it('decodes and encodes only through explicitly registered codecs', async () => {
    const images = createImageLibrary([pngCodec, jpegCodec])
    const output = await (await images.open(pngFixture())).jpeg().toBuffer()

    expect(images.formats()).toEqual(['png', 'jpeg'])
    expect([...output.subarray(0, 2)]).toEqual([0xff, 0xd8])
  })

  it('rejects input whose decoder was not registered', async () => {
    const images = createImageLibrary([pngCodec])

    await expect(images.open(jpegFixture(32, 24))).rejects.toMatchObject({
      code: 'UNSUPPORTED_FORMAT',
    })
  })

  it('rejects output whose encoder was not registered', async () => {
    const images = createImageLibrary([pngCodec])
    const image = await images.open(pngFixture())

    await expect(image.jpeg().toBuffer()).rejects.toMatchObject({
      code: 'UNSUPPORTED_OPERATION',
    })
  })

  it('provides one opt-in helper containing every codec exactly once', () => {
    const formats = createImageLibrary(allCodecs).formats()

    expect(formats).toEqual(['jpeg', 'png', 'gif', 'webp', 'avif', 'heif', 'bmp', 'tiff'])
    expect(new Set(formats).size).toBe(formats.length)
  })
})
