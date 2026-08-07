import { describe, expect, it } from 'vitest'
import { GifReader, GifWriter } from 'omggif'
import jpeg from 'jpeg-js'
import { PNG } from 'pngjs'

import { Image } from './image-library.ts'

const palette = [0x000000, 0xff2400, 0x20d060, 0x2050ff]

const imageDescriptor = (data: Uint8Array): number => {
  let offset = 13
  const packed = data[10] ?? 0
  if ((packed & 0x80) !== 0) offset += 3 * 2 ** ((packed & 7) + 1)
  while (offset < data.byteLength) {
    const marker = data[offset]
    if (marker === 0x2c) return offset
    if (marker !== 0x21) throw new Error('Generated GIF contains an unexpected block')
    offset += 2
    while (offset < data.byteLength) {
      const length = data[offset] ?? 0
      offset += 1
      if (length === 0) break
      offset += length
    }
  }
  throw new Error('Generated GIF has no image descriptor')
}

const gifFixture = (interlaced = false): Uint8Array => {
  const output = new Uint8Array(4096)
  const writer = new GifWriter(output, 9, 12, { loop: 0 })
  const pixels = Array.from({ length: 45 }, (_, index) => (index % 5 === 0 ? 0 : (index % 3) + 1))
  writer.addFrame(2, 1, 5, 9, pixels, { palette, transparent: 0, disposal: 1 })
  writer.addFrame(0, 0, 9, 12, new Array<number>(108).fill(3), { palette })
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

describe('GIF first-frame pipeline', () => {
  it.each([false, true])(
    'decodes local palettes, offsets, transparency, and interlace=%s',
    async (interlaced) => {
      const input = gifFixture(interlaced)
      const output = PNG.sync.read(await (await Image.open(input)).png().toBuffer())

      expect({ width: output.width, height: output.height }).toEqual({ width: 9, height: 12 })
      expect(Buffer.from(output.data)).toEqual(Buffer.from(oracleFirstFrame(input)))
    },
  )

  it('uses only the first frame and flattens transparent pixels deterministically', async () => {
    const input = gifFixture()
    const output = jpeg.decode(
      await (await Image.open(input)).jpeg({ quality: 100, background: '#ffffff' }).toBuffer(),
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

    await expect((await Image.open(noPalette)).png().toBuffer()).rejects.toThrow(
      'has no color table',
    )
    await expect((await Image.open(invalidCodeSize)).png().toBuffer()).rejects.toThrow(
      'minimum code size',
    )
    await expect((await Image.open(truncated)).png().toBuffer()).rejects.toMatchObject({
      code: 'TRUNCATED_INPUT',
    })
  })
})
