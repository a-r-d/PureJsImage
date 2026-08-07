import { describe, expect, it } from 'vitest'

import { createImageLibrary, type ImageCodec } from '../src/index.ts'
import { jpegFixture, pngFixture } from './fixtures.ts'
import { Image } from './image-library.ts'

describe('immutable image pipelines', () => {
  it('plans orientation, crop, resize, and encoding without mutating the source image', async () => {
    const source = await Image.open(jpegFixture(120, 80, 6))
    const output = source
      .autoOrient()
      .crop({ x: 10, y: 20, width: 40, height: 60 })
      .resize({ width: 20 })
      .encode('png', { compressionLevel: 6 })

    await expect(source.metadata()).resolves.toMatchObject({
      width: 120,
      height: 80,
      orientation: 6,
      format: 'jpeg',
    })
    await expect(output.metadata()).resolves.toMatchObject({
      width: 20,
      height: 30,
      orientation: 1,
      format: 'png',
      mimeType: 'image/png',
    })
  })

  it('reports exact contain geometry and preserves source alpha', async () => {
    const image = await Image.open(pngFixture(120, 40))
    const output = image
      .resize({
        width: 256,
        height: 256,
        fit: 'contain',
        position: 'center',
        background: 'transparent',
      })
      .png({ compressionLevel: 6 })

    await expect(output.metadata()).resolves.toMatchObject({
      width: 256,
      height: 256,
      format: 'png',
      hasAlpha: true,
    })
  })

  it('reports alpha introduced by a transparent contain canvas', async () => {
    const image = await Image.open(pngFixture(120, 40, 0))

    await expect(
      image.resize({ width: 256, height: 256, fit: 'contain' }).png().metadata(),
    ).resolves.toMatchObject({ width: 256, height: 256, hasAlpha: true })
  })

  it('honors withoutEnlargement for single-dimension resize', async () => {
    const image = await Image.open(pngFixture(100, 50))

    await expect(
      image.resize({ width: 200, withoutEnlargement: true }).metadata(),
    ).resolves.toMatchObject({
      width: 100,
      height: 50,
    })
  })

  it('validates operation options and lazy crop bounds', async () => {
    const image = await Image.open(pngFixture(100, 50))

    expect(() => image.jpeg({ quality: 101 })).toThrow('JPEG quality')
    expect(() => image.resize({ width: 10, background: '#ffffff' })).toThrow(
      'require both width and height',
    )
    await expect(
      image.crop({ x: 90, y: 0, width: 20, height: 10 }).metadata(),
    ).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    })
  })

  it('fails explicitly when an unimplemented codec is requested', async () => {
    const metadataOnlyCodec: ImageCodec = {
      format: 'metadata-only',
      mimeTypes: ['image/metadata-only'],
      minimumBytes: 1,
      detect: (header) => header[0] === 42,
      metadata: async () => ({
        width: 10,
        height: 10,
        format: 'metadata-only',
        mimeType: 'image/metadata-only',
        hasAlpha: false,
      }),
    }
    const image = await createImageLibrary([metadataOnlyCodec]).open(Uint8Array.of(42))

    await expect(image.resize({ width: 5 }).png().toBuffer()).rejects.toMatchObject({
      code: 'UNSUPPORTED_OPERATION',
    })
  })
})
