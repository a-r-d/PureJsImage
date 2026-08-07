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

const uint32LittleEndian = (data: Uint8Array, offset: number): number =>
  new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(offset, true)

const writeUint32LittleEndian = (data: Uint8Array, offset: number, value: number): void => {
  new DataView(data.buffer, data.byteOffset, data.byteLength).setUint32(offset, value, true)
}

const webpChunkOffset = (data: Uint8Array, type: string): number => {
  for (let offset = 12; offset + 8 <= data.byteLength; ) {
    if (Buffer.from(data.subarray(offset, offset + 4)).toString('ascii') === type) return offset
    const length = uint32LittleEndian(data, offset + 4)
    offset += 8 + length + (length & 1)
  }
  throw new Error(`Generated WebP did not contain a ${type} chunk`)
}

const riffChunk = (type: string, payload: Uint8Array, padding = 0): Uint8Array => {
  if (type.length !== 4) throw new Error('RIFF chunk type must contain four characters')
  const output = new Uint8Array(8 + payload.byteLength + (payload.byteLength & 1))
  output.set(Buffer.from(type, 'ascii'))
  writeUint32LittleEndian(output, 4, payload.byteLength)
  output.set(payload, 8)
  if ((payload.byteLength & 1) !== 0) output[output.byteLength - 1] = padding
  return output
}

const insertRiffBytes = (input: Uint8Array, offset: number, inserted: Uint8Array): Uint8Array => {
  const output = new Uint8Array(input.byteLength + inserted.byteLength)
  output.set(input.subarray(0, offset))
  output.set(inserted, offset)
  output.set(input.subarray(offset), offset + inserted.byteLength)
  writeUint32LittleEndian(output, 4, uint32LittleEndian(input, 4) + inserted.byteLength)
  return output
}

const removeRiffBytes = (input: Uint8Array, offset: number, length: number): Uint8Array => {
  const output = new Uint8Array(input.byteLength - length)
  output.set(input.subarray(0, offset))
  output.set(input.subarray(offset + length), offset)
  writeUint32LittleEndian(output, 4, uint32LittleEndian(input, 4) - length)
  return output
}

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

  it('losslessly encodes blocks larger than the byte-writer growth boundary', async () => {
    const source = new PNG({ width: 40, height: 40 })
    for (let y = 0; y < source.height; y += 1) {
      for (let x = 0; x < source.width; x += 1) {
        const offset = (y * source.width + x) * 4
        source.data[offset] = (x * 13 + y * 3) & 255
        source.data[offset + 1] = (x * 5 + y * 17) & 255
        source.data[offset + 2] = (x * 19 + y * 7) & 255
        source.data[offset + 3] = (x * 11 + y * 23) & 255
      }
    }

    const encoded = await (await Image.open(PNG.sync.write(source)))
      .webp({ lossless: true })
      .toBuffer()
    expect(encoded.length).toBeGreaterThan(4096)
    const decoded = PNG.sync.read(await (await Image.open(encoded)).png().toBuffer())
    expect(decoded.data).toEqual(source.data)
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
    const decoded = PNG.sync.read(await (await Image.open(high)).png().toBuffer())
    expectPixelClose(decoded, 0, 0, [0, 0, 0])
    expectPixelClose(decoded, 16, 12, [149, 171, 189])
    expectPixelClose(decoded, 31, 23, [75, 77, 62])
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

  it('accepts unknown chunks with conforming odd-byte padding', async () => {
    const extended = insertRiffBytes(
      lossless,
      lossless.byteLength,
      riffChunk('JUNK', Uint8Array.of(42)),
    )
    const reference = PNG.sync.read(await (await Image.open(lossless)).png().toBuffer())
    const output = PNG.sync.read(await (await Image.open(extended)).png().toBuffer())

    expect(output.data).toEqual(reference.data)
  })

  it.each([
    {
      name: 'an impossible RIFF size',
      mutate: (data: Uint8Array): Uint8Array => {
        writeUint32LittleEndian(data, 4, 3)
        return data
      },
      code: 'INVALID_INPUT',
    },
    {
      name: 'a RIFF payload larger than the input',
      mutate: (data: Uint8Array): Uint8Array => {
        writeUint32LittleEndian(data, 4, uint32LittleEndian(data, 4) + 2)
        return data
      },
      code: 'TRUNCATED_INPUT',
    },
    {
      name: 'a chunk extent outside the RIFF payload',
      mutate: (data: Uint8Array): Uint8Array => {
        writeUint32LittleEndian(data, webpChunkOffset(data, 'VP8L') + 4, 0xffff_ffff)
        return data
      },
      code: 'TRUNCATED_INPUT',
    },
    {
      name: 'a missing odd-byte padding byte',
      mutate: (data: Uint8Array): Uint8Array => data.subarray(0, data.byteLength - 1),
      code: 'TRUNCATED_INPUT',
    },
    {
      name: 'a nonzero odd-byte padding byte',
      mutate: (data: Uint8Array): Uint8Array =>
        insertRiffBytes(data, data.byteLength, riffChunk('JUNK', Uint8Array.of(42), 1)),
      code: 'INVALID_INPUT',
    },
  ])('rejects $name with a typed error', async ({ mutate, code }) => {
    const malformed = mutate(Uint8Array.from(lossless))

    await expect((await Image.open(malformed)).metadata()).rejects.toMatchObject({ code })
  })

  it.each([
    {
      name: 'reserved feature flags',
      mutate: (data: Uint8Array, extended: number): void => {
        data[extended + 8] = (data[extended + 8] ?? 0) | 0x80
      },
    },
    {
      name: 'reserved header bytes',
      mutate: (data: Uint8Array, extended: number): void => {
        data[extended + 9] = 1
      },
    },
    {
      name: 'a noncanonical header size',
      mutate: (data: Uint8Array, extended: number): void => {
        writeUint32LittleEndian(data, extended + 4, 11)
      },
    },
    {
      name: 'a canvas area beyond the format limit',
      mutate: (data: Uint8Array, extended: number): void => {
        data.fill(0xff, extended + 12, extended + 18)
      },
    },
  ])('rejects a VP8X header with $name', async ({ mutate }) => {
    const malformed = Uint8Array.from(lossyRawAlpha)
    mutate(malformed, webpChunkOffset(malformed, 'VP8X'))

    await expect((await Image.open(malformed)).metadata()).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    })
  })

  it('rejects duplicate and inconsistent reconstruction chunks', async () => {
    const extendedOffset = webpChunkOffset(lossyRawAlpha, 'VP8X')
    const duplicateExtended = insertRiffBytes(
      lossyRawAlpha,
      extendedOffset + 18,
      lossyRawAlpha.subarray(extendedOffset, extendedOffset + 18),
    )

    const imageOffset = webpChunkOffset(lossless, 'VP8L')
    const imageLength = uint32LittleEndian(lossless, imageOffset + 4)
    const imageBytes = 8 + imageLength + (imageLength & 1)
    const duplicateImage = insertRiffBytes(
      lossless,
      lossless.byteLength,
      lossless.subarray(imageOffset, imageOffset + imageBytes),
    )

    const alphaOffset = webpChunkOffset(lossyRawAlpha, 'ALPH')
    const alphaLength = uint32LittleEndian(lossyRawAlpha, alphaOffset + 4)
    const missingAlpha = removeRiffBytes(
      lossyRawAlpha,
      alphaOffset,
      8 + alphaLength + (alphaLength & 1),
    )

    const unflaggedAlpha = Uint8Array.from(lossyRawAlpha)
    unflaggedAlpha[extendedOffset + 8] = (unflaggedAlpha[extendedOffset + 8] ?? 0) & ~0x10

    const mismatchedCanvas = Uint8Array.from(lossyRawAlpha)
    mismatchedCanvas[extendedOffset + 12] = (mismatchedCanvas[extendedOffset + 12] ?? 0) + 1

    for (const malformed of [
      duplicateExtended,
      duplicateImage,
      missingAlpha,
      unflaggedAlpha,
      mismatchedCanvas,
    ]) {
      await expect((await Image.open(malformed)).metadata()).rejects.toMatchObject({
        code: 'INVALID_INPUT',
      })
    }
  })

  it.each([
    { flags: 0x80, code: 'INVALID_INPUT' },
    { flags: 0x02, code: 'UNSUPPORTED_OPERATION' },
  ] as const)('rejects corrupt alpha flags %#', async ({ flags, code }) => {
    const malformed = Buffer.from(lossyRawAlpha)
    const alpha = webpChunkOffset(malformed, 'ALPH')
    malformed[alpha + 8] = flags

    await expect((await Image.open(malformed)).png().toBuffer()).rejects.toMatchObject({ code })
  })

  it('rejects truncated WebP input', async () => {
    await expect((await Image.open(lossless.subarray(0, 40))).metadata()).rejects.toMatchObject({
      code: 'TRUNCATED_INPUT',
    })
  })
})
