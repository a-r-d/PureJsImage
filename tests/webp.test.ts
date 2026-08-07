import { describe, expect, it } from 'vitest'
import { PNG } from 'pngjs'

import { Image } from './image-library.ts'

const lossless = Buffer.from(
  'UklGRlIAAABXRUJQVlA4TEUAAAAvAAEwEM1lRP9jASSE//eVGOj+p7SBmbZtWv7ge20WEBT6P5pAIMUrLFBOQCqev1xBHf/xH//xH//xH//xH//xH/+9cAAA',
  'base64',
)

const lossy = Buffer.from(
  'UklGRqQAAABXRUJQVlA4IJgAAABwBACdASogABgAPmUmj0WkIiEb/VQAQAZEs4BmwkBKSJFI4AHVyHQgWMclgAD+/qV1+gM5jXoqf8T/xA/L7f0lia3y/8Hn4WHFIQuFlP1xw1tSDx+ucwX+ndmTYQ35mZkrIBYOX9PWp0ByLB1fAb9EWwcebp60J6lOM+Wjvcp762MmOBNj6axIrCC/NsuuSyHsh32LLNAAAA==',
  'base64',
)

const lossyRawAlpha = Buffer.from(
  'UklGRmYAAABXRUJQVlA4WAoAAAAQAAAAAgAAAQAAQUxQSAcAAAAA/4AATv8BAFZQOCA4AAAAEAIAnQEqAwACAAFAJiWUAnR/BMAAKUaZkAD+yr/6pU1fOecZv5EGOg0FHVOrS4M187wOHiAAAAA=',
  'base64',
)

const lossyCompressedAlpha = Buffer.from(
  'UklGRsgAAABXRUJQVlA4WAoAAAAQAAAAPwAAPwAAQUxQSBAAAAABB1DAiAgACeH/ey2i/6kfVlA4IJIAAAAwBgCdASpAAEAAPm00l0ikIqIhIgmYgA2JZAE6ArzN5/IPxu4acwC//QDp+1KOZWVPach092wtfongAP7xWZpw6//0J3nye3//EY/EY+4pvnvKojdAwTZYvEo/+gJaGj8ZSA79NGRrSRc/PGbnlE04a9o8+uYPyDCV3HzloG7n+Ow52b6e/ubSnudgAKe9fAAAAA==',
  'base64',
)

const withRawAlphaFilter = (filter: 1 | 2 | 3, residuals: readonly number[]): Buffer => {
  const output = Buffer.from(lossyRawAlpha)
  const alphaOffset = output.indexOf('ALPH') + 8
  output[alphaOffset] = filter << 2
  output.set(residuals, alphaOffset + 1)
  return output
}

const expectPixelClose = (
  image: InstanceType<typeof PNG>,
  x: number,
  y: number,
  expected: readonly [number, number, number],
): void => {
  const offset = (y * image.width + x) * 4
  for (let channel = 0; channel < 3; channel += 1) {
    expect(
      Math.abs((image.data[offset + channel] ?? 0) - (expected[channel] ?? 0)),
    ).toBeLessThanOrEqual(18)
  }
}

describe('WebP codec', () => {
  it('losslessly encodes RGBA pixels and decodes them exactly', async () => {
    const source = new PNG({ width: 3, height: 2 })
    source.data.set([
      255, 0, 0, 255, 0, 255, 0, 128, 0, 0, 255, 0, 12, 34, 56, 78, 90, 123, 210, 255, 255, 255,
      255, 1,
    ])
    const encoded = await (await Image.open(PNG.sync.write(source)))
      .webp({ lossless: true })
      .toBuffer()
    expect(encoded.subarray(0, 4).toString('ascii')).toBe('RIFF')
    expect(encoded.subarray(8, 12).toString('ascii')).toBe('WEBP')

    const image = await Image.open(encoded)
    await expect(image.metadata()).resolves.toMatchObject({
      format: 'webp',
      width: 3,
      height: 2,
      hasAlpha: true,
    })
    const decoded = PNG.sync.read(await image.png().toBuffer())
    expect(decoded.data).toEqual(source.data)

    const lossyEncoded = await (await Image.open(PNG.sync.write(source)))
      .webp({ quality: 80 })
      .toBuffer()
    const lossyDecoded = PNG.sync.read(await (await Image.open(lossyEncoded)).png().toBuffer())
    expect(Array.from({ length: 6 }, (_, index) => lossyDecoded.data[index * 4 + 3])).toEqual([
      255, 128, 0, 78, 255, 1,
    ])
  })

  it('lossily encodes WebP with effective quality control', async () => {
    const image = await Image.open(lossy)
    expect(() => image.webp({ quality: 0 })).toThrow('WebP quality')
    const low = await image.webp({ quality: 20 }).toBuffer()
    const high = await image.webp({ quality: 95 }).toBuffer()
    expect(low.length).toBeLessThan(high.length)
    await expect((await Image.open(high)).metadata()).resolves.toMatchObject({
      format: 'webp',
      width: 32,
      height: 24,
      hasAlpha: false,
    })
  })

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

  it('decodes lossy VP8 pixels through prediction, transforms, and loop filtering', async () => {
    const image = await Image.open(lossy)
    await expect(image.metadata()).resolves.toMatchObject({
      format: 'webp',
      width: 32,
      height: 24,
      hasAlpha: false,
    })
    const output = PNG.sync.read(await image.png().toBuffer())
    expectPixelClose(output, 0, 0, [0, 0, 0])
    expectPixelClose(output, 16, 12, [149, 171, 189])
    expectPixelClose(output, 18, 12, [141, 163, 183])
    expectPixelClose(output, 5, 20, [120, 121, 114])
    expectPixelClose(output, 31, 23, [75, 77, 62])
  })

  it('decodes raw and VP8L-compressed extended WebP alpha exactly', async () => {
    const raw = PNG.sync.read(await (await Image.open(lossyRawAlpha)).png().toBuffer())
    expect(raw.width).toBe(3)
    expect(raw.height).toBe(2)
    expect(Array.from({ length: 6 }, (_, index) => raw.data[index * 4 + 3])).toEqual([
      255, 128, 0, 78, 255, 1,
    ])

    const compressed = PNG.sync.read(
      await (await Image.open(lossyCompressedAlpha)).png().toBuffer(),
    )
    expect(compressed.width).toBe(64)
    expect(compressed.height).toBe(64)
    expect(Array.from({ length: 64 * 64 }, (_, index) => compressed.data[index * 4 + 3])).toEqual(
      Array.from({ length: 64 * 64 }, () => 128),
    )
  })

  it.each([
    [1, [255, 129, 128, 79, 177, 2]],
    [2, [255, 129, 128, 79, 127, 1]],
    [3, [255, 129, 128, 79, 255, 130]],
  ] as const)('reconstructs alpha filter %i at top and left boundaries', async (filter, data) => {
    const decoded = PNG.sync.read(
      await (await Image.open(withRawAlphaFilter(filter, data))).png().toBuffer(),
    )
    expect(Array.from({ length: 6 }, (_, index) => decoded.data[index * 4 + 3])).toEqual([
      255, 128, 0, 78, 255, 1,
    ])
  })

  it('rejects truncated WebP input', async () => {
    await expect((await Image.open(lossless.subarray(0, 40))).metadata()).rejects.toMatchObject({
      code: 'TRUNCATED_INPUT',
    })
  })
})
