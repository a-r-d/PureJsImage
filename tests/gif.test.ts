import { describe, expect, it } from 'vitest'
import { GifReader, GifWriter } from 'omggif'
import jpeg from 'jpeg-js'
import { PNG } from 'pngjs'

import { Image } from './image-library.ts'

const palette = [0x000000, 0xff2400, 0x20d060, 0x2050ff]

const imageDescriptors = (data: Uint8Array): readonly number[] => {
  const descriptors: number[] = []
  let offset = 13
  const packed = data[10] ?? 0
  if ((packed & 0x80) !== 0) offset += 3 * 2 ** ((packed & 7) + 1)
  while (offset < data.byteLength) {
    const marker = data[offset]
    if (marker === 0x3b) return descriptors
    if (marker === 0x21) {
      offset += 2
      while (offset < data.byteLength) {
        const length = data[offset] ?? 0
        offset += 1
        if (length === 0) break
        offset += length
      }
      continue
    }
    if (marker === 0x2c) {
      descriptors.push(offset)
      const imagePacked = data[offset + 9] ?? 0
      offset += 10
      if ((imagePacked & 0x80) !== 0) offset += 3 * 2 ** ((imagePacked & 7) + 1)
      offset += 1
      while (offset < data.byteLength) {
        const length = data[offset] ?? 0
        offset += 1
        if (length === 0) break
        offset += length
      }
      continue
    }
    throw new Error('Generated GIF contains an unexpected block')
  }
  throw new Error('Generated GIF has no image descriptor')
}

const imageDescriptor = (data: Uint8Array): number => {
  const descriptor = imageDescriptors(data)[0]
  if (descriptor === undefined) throw new Error('Generated GIF has no image descriptor')
  return descriptor
}

const codeSizeOffset = (data: Uint8Array, descriptor: number): number => {
  const packed = data[descriptor + 9] ?? 0
  return descriptor + 10 + ((packed & 0x80) !== 0 ? 3 * 2 ** ((packed & 7) + 1) : 0)
}

const gifFixture = (interlaced = false, animated = true): Uint8Array => {
  const output = new Uint8Array(4096)
  const writer = new GifWriter(output, 9, 12, { loop: 0 })
  const pixels = Array.from({ length: 45 }, (_, index) => (index % 5 === 0 ? 0 : (index % 3) + 1))
  writer.addFrame(2, 1, 5, 9, pixels, { palette, transparent: 0, disposal: 1 })
  if (animated) {
    writer.addFrame(0, 0, 9, 12, new Array<number>(108).fill(3), { palette })
  }
  const data = output.slice(0, writer.end())
  if (interlaced) {
    const descriptor = imageDescriptor(data)
    data[descriptor + 9] = (data[descriptor + 9] ?? 0) | 0x40
  }
  return data
}

const oracleFirstFrame = (input: Uint8Array): Uint8Array => {
  const reader = new GifReader(input)
  const output = new Uint8Array(reader.width * reader.height * 4)
  reader.decodeAndBlitFrameRGBA(0, output)
  return output
}

describe('GIF decode pipeline', () => {
  it.each([false, true])(
    'decodes local palettes, offsets, transparency, and interlace=%s',
    async (interlaced) => {
      const input = gifFixture(interlaced)
      const output = PNG.sync.read(await (await Image.open(input, { frame: 0 })).png().toBuffer())

      expect({ width: output.width, height: output.height }).toEqual({ width: 9, height: 12 })
      expect(Buffer.from(output.data)).toEqual(Buffer.from(oracleFirstFrame(input)))
    },
  )
  it('decodes a static GIF without requiring a frame selection', async () => {
    const input = gifFixture(false, false)
    const output = PNG.sync.read(await (await Image.open(input)).png().toBuffer())

    expect(Buffer.from(output.data)).toEqual(Buffer.from(oracleFirstFrame(input)))
  })

  it('reports animation metadata and rejects pixel decode without explicit selection', async () => {
    const input = gifFixture()
    const image = await Image.open(input)

    await expect(image.metadata()).resolves.toMatchObject({ frames: 2 })
    await expect(image.png().toBuffer()).rejects.toMatchObject({
      code: 'UNSUPPORTED_OPERATION',
      message: expect.stringContaining('pass { frame: 0 } to open()'),
    })
  })

  it('rejects unsupported and invalid frame selections', async () => {
    const input = gifFixture()

    await expect(Image.open(input, { frame: 1 })).rejects.toMatchObject({
      code: 'UNSUPPORTED_OPERATION',
      message: expect.stringContaining('Only frame 0 can be selected'),
    })
    await expect(Image.open(input, { frame: -1 })).rejects.toMatchObject({
      code: 'INVALID_INPUT',
      message: 'frame must be a non-negative safe integer',
    })
  })

  it('explicitly uses the first frame and flattens transparent pixels deterministically', async () => {
    const input = gifFixture()
    const output = jpeg.decode(
      await (await Image.open(input, { frame: 0 }))
        .jpeg({ quality: 100, background: '#ffffff' })
        .toBuffer(),
      { useTArray: true, formatAsRGBA: true, tolerantDecoding: false },
    )

    expect({ width: output.width, height: output.height }).toEqual({ width: 9, height: 12 })
    expect(output.data[0]).toBeGreaterThan(245)
    expect(output.data[1]).toBeGreaterThan(245)
    expect(output.data[2]).toBeGreaterThan(245)
    const inside = (2 * output.width + 3) * 4
    expect(output.data[inside + 3]).toBe(255)
  })

  it('rejects missing palettes, invalid code sizes, and truncated image data', async () => {
    const input = gifFixture()
    const descriptor = imageDescriptor(input)
    const noPalette = input.slice()
    noPalette[descriptor + 9] = (noPalette[descriptor + 9] ?? 0) & ~0x80
    const localPaletteBytes = 3 * 2 ** (((input[descriptor + 9] ?? 0) & 7) + 1)
    const invalidCodeSize = input.slice()
    invalidCodeSize[descriptor + 10 + localPaletteBytes] = 1
    const truncated = input.subarray(0, descriptor + 10 + localPaletteBytes + 3)

    await expect((await Image.open(noPalette, { frame: 0 })).png().toBuffer()).rejects.toThrow(
      'has no color table',
    )
    await expect(
      (await Image.open(invalidCodeSize, { frame: 0 })).png().toBuffer(),
    ).rejects.toThrow('minimum code size')
    await expect(
      (await Image.open(truncated, { frame: 0 })).png().toBuffer(),
    ).rejects.toMatchObject({
      code: 'TRUNCATED_INPUT',
    })
  })

  it('applies logical-screen and frame-count limits during metadata inspection', async () => {
    const oversized = gifFixture()
    oversized.set([0xff, 0xff, 0xff, 0xff], 6)

    await expect(
      (await Image.open(oversized, { limits: { maxWidth: 1_024, maxHeight: 1_024 } })).metadata(),
    ).rejects.toMatchObject({ code: 'LIMIT_EXCEEDED' })
    await expect(
      (await Image.open(gifFixture(), { limits: { maxFrames: 1 } })).metadata(),
    ).rejects.toMatchObject({ code: 'LIMIT_EXCEEDED' })
  })

  it.each([
    {
      name: 'zero logical-screen dimensions',
      mutate: (data: Uint8Array): Uint8Array => {
        data.set([0, 0], 6)
        return data
      },
      code: 'INVALID_INPUT',
    },
    {
      name: 'a frame outside the logical screen',
      mutate: (data: Uint8Array): Uint8Array => {
        const descriptor = imageDescriptors(data)[1]
        if (descriptor === undefined) throw new Error('Generated GIF has no second frame')
        data.set([9, 0], descriptor + 1)
        return data
      },
      code: 'INVALID_INPUT',
    },
    {
      name: 'a later frame without a color table',
      mutate: (data: Uint8Array): Uint8Array => {
        const descriptor = imageDescriptors(data)[1]
        if (descriptor === undefined) throw new Error('Generated GIF has no second frame')
        data[descriptor + 9] = (data[descriptor + 9] ?? 0) & ~0x80
        return data
      },
      code: 'INVALID_INPUT',
    },
    {
      name: 'an invalid later-frame LZW code size',
      mutate: (data: Uint8Array): Uint8Array => {
        const descriptor = imageDescriptors(data)[1]
        if (descriptor === undefined) throw new Error('Generated GIF has no second frame')
        data[codeSizeOffset(data, descriptor)] = 9
        return data
      },
      code: 'INVALID_INPUT',
    },
    {
      name: 'an invalid graphics-control block size',
      mutate: (data: Uint8Array): Uint8Array => {
        const control = Buffer.from(data).indexOf(Buffer.from([0x21, 0xf9]))
        if (control < 0) throw new Error('Generated GIF has no graphics control extension')
        data[control + 2] = 3
        return data
      },
      code: 'INVALID_INPUT',
    },
    {
      name: 'a missing graphics-control terminator',
      mutate: (data: Uint8Array): Uint8Array => {
        const control = Buffer.from(data).indexOf(Buffer.from([0x21, 0xf9]))
        if (control < 0) throw new Error('Generated GIF has no graphics control extension')
        data[control + 7] = 1
        return data
      },
      code: 'INVALID_INPUT',
    },
    {
      name: 'an unknown block marker',
      mutate: (data: Uint8Array): Uint8Array => {
        data[imageDescriptor(data)] = 0x7f
        return data
      },
      code: 'INVALID_INPUT',
    },
    {
      name: 'a missing trailer',
      mutate: (data: Uint8Array): Uint8Array => data.subarray(0, data.byteLength - 1),
      code: 'TRUNCATED_INPUT',
    },
  ])('rejects $name while inspecting metadata', async ({ mutate, code }) => {
    const malformed = mutate(gifFixture())

    await expect((await Image.open(malformed)).metadata()).rejects.toMatchObject({ code })
  })
})
