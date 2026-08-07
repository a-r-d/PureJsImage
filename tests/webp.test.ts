import { describe, expect, it } from 'vitest'
import { PNG } from 'pngjs'

import { Image } from '../src/index.ts'

const lossless = Buffer.from(
  'UklGRlIAAABXRUJQVlA4TEUAAAAvAAEwEM1lRP9jASSE//eVGOj+p7SBmbZtWv7ge20WEBT6P5pAIMUrLFBOQCqev1xBHf/xH//xH//xH//xH//xH/+9cAAA',
  'base64',
)

const lossy = Buffer.from(
  'UklGRqQAAABXRUJQVlA4IJgAAABwBACdASogABgAPmUmj0WkIiEb/VQAQAZEs4BmwkBKSJFI4AHVyHQgWMclgAD+/qV1+gM5jXoqf8T/xA/L7f0lia3y/8Hn4WHFIQuFlP1xw1tSDx+ucwX+ndmTYQ35mZkrIBYOX9PWp0ByLB1fAb9EWwcebp60J6lOM+Wjvcp762MmOBNj6axIrCC/NsuuSyHsh32LLNAAAA==',
  'base64',
)

describe('WebP codec', () => {
  it('detects and exactly decodes lossless RGBA WebP', async () => {
    const image = await Image.open(lossless)
    await expect(image.metadata()).resolves.toEqual({
      width: 257,
      height: 193,
      format: 'webp',
      mimeType: 'image/webp',
      hasAlpha: true,
      colorSpace: 'srgb',
      bitDepth: 8,
      frames: 1,
    })

    const output = PNG.sync.read(await image.png().toBuffer())
    for (let y = 0; y < output.height; y += 1) {
      for (let x = 0; x < output.width; x += 1) {
        const offset = (y * output.width + x) * 4
        expect(Array.from(output.data.subarray(offset, offset + 4))).toEqual([
          x & 255,
          y & 255,
          (x * 17 + y * 31) & 255,
          (x + y) & 255,
        ])
      }
    }
  })

  it('runs lossless WebP through crop, resize, alpha flattening, and JPEG encoding', async () => {
    const output = await (await Image.open(lossless))
      .crop({ x: 1, y: 1, width: 255, height: 191 })
      .resize({ width: 64 })
      .jpeg({ quality: 80, background: '#ffffff' })
      .toBuffer()
    const metadata = await (await Image.open(output)).metadata()
    expect(metadata).toMatchObject({ format: 'jpeg', width: 64, height: 48 })
  })

  it('reads lossy WebP metadata and reports the unfinished VP8 decoder explicitly', async () => {
    const image = await Image.open(lossy)
    await expect(image.metadata()).resolves.toMatchObject({
      format: 'webp',
      width: 32,
      height: 24,
      hasAlpha: false,
    })
    await expect(image.png().toBuffer()).rejects.toThrow('Lossy WebP decoding is not implemented')
  })

  it('rejects truncated WebP input', async () => {
    await expect((await Image.open(lossless.subarray(0, 40))).metadata()).rejects.toMatchObject({
      code: 'TRUNCATED_INPUT',
    })
  })
})
