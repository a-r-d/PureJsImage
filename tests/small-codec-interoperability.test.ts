import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { hdrCodec } from '../src/codecs/hdr.ts'
import { netpbmCodec } from '../src/codecs/netpbm.ts'
import { qoiCodec } from '../src/codecs/qoi.ts'
import { tgaCodec } from '../src/codecs/tga.ts'
import { Image } from './image-library.ts'
import { decodeFixture } from './small-codec-helpers.ts'

const fixtureDirectory = join(import.meta.dirname, 'fixtures/small-codecs')

const fixture = async (name: string): Promise<Uint8Array> => {
  return readFile(join(fixtureDirectory, name))
}

describe('small codec interoperability fixtures', () => {
  it('matches the official-reference QOI and FFmpeg TGA source pixels', async () => {
    const referenceQoi = await fixture('city-16x16-reference.qoi')
    const qoi = await decodeFixture(qoiCodec, referenceQoi)
    const tga = await decodeFixture(tgaCodec, await fixture('city-16x16-ffmpeg-rle.tga'))

    expect(qoi.decoder).toMatchObject({ width: 16, height: 16, pixelFormat: 'rgb8' })
    expect(tga.decoder).toMatchObject({ width: 16, height: 16, pixelFormat: 'rgb8' })
    expect(createHash('sha256').update(qoi.pixels).digest('hex')).toBe(
      '40a4b2482eaed533b5257a7b2d5afb60df8654690d2adc2a708bda10a6e407b5',
    )
    expect(tga.pixels).toEqual(qoi.pixels)
    expect(
      await (await Image.open(referenceQoi)).qoi({ channels: 3, colorspace: 'srgb' }).toBuffer(),
    ).toEqual(referenceQoi)
  })

  it.each([
    ['checkerboard-8x8-ascii.pbm', 'gray8', 8, 8],
    ['checkerboard-8x8-binary.pbm', 'gray8', 8, 8],
    ['gradient-8x8-8bit.pgm', 'gray8', 8, 8],
    ['gradient-8x8-16bit.pgm', 'gray16', 8, 8],
    ['colorbars-4x4-ascii.ppm', 'rgb8', 4, 4],
    ['colorbars-4x4-16bit.ppm', 'rgb16', 4, 4],
    ['rgb-alpha-4x4.pam', 'rgba8', 4, 4],
    ['grayscale-alpha-4x4.pam', 'rgba8', 4, 4],
  ])('decodes CC0 Netpbm fixture %s', async (name, pixelFormat, width, height) => {
    const decoded = await decodeFixture(netpbmCodec, await fixture(name))
    expect(decoded.decoder).toMatchObject({ width, height, pixelFormat })
  })

  it('decodes the FFmpeg PFM fixture as native float RGB rows', async () => {
    const decoded = await decodeFixture(netpbmCodec, await fixture('potsdamer-8x4-ffmpeg.pfm'))
    expect(decoded.decoder).toMatchObject({ width: 8, height: 4, pixelFormat: 'rgbf32' })
    expect(decoded.blocks.every((block) => block.height === 1)).toBe(true)
    expect(decoded.pixels.byteLength).toBe(8 * 4 * 3 * 4)
    expect(createHash('sha256').update(decoded.pixels).digest('hex')).toBe(
      '67c92b52d32fb96980523160b0c58b70320a56c9dd011ee50f29f916d671763e',
    )
  })

  it('keeps Radiance codec probing distinct from PFM', () => {
    expect(hdrCodec.detect(new TextEncoder().encode('#?RADIANCE\n'))).toBe(true)
    expect(hdrCodec.detect(new TextEncoder().encode('PF\n8 4\n-1\n'))).toBe(false)
  })
})
