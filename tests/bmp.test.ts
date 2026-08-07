import { PNG } from 'pngjs'
import { describe, expect, it } from 'vitest'

import { Image } from '../src/index.ts'

type Rgba = readonly [red: number, green: number, blue: number, alpha: number]

interface BmpFixtureOptions {
  readonly width: number
  readonly height: number
  readonly bitDepth: 1 | 4 | 8 | 16 | 24 | 32
  readonly compression?: 0 | 1 | 2 | 3 | 6
  readonly topDown?: boolean
  readonly headerSize?: 40 | 108
  readonly palette?: readonly Rgba[]
  readonly masks?: readonly number[]
  readonly data: Uint8Array
}

const bmpFixture = (options: BmpFixtureOptions): Uint8Array => {
  const headerSize = options.headerSize ?? 40
  const compression = options.compression ?? 0
  const appendedMasks = headerSize === 40 && (compression === 3 || compression === 6)
  const maskBytes = appendedMasks ? (compression === 6 ? 16 : 12) : 0
  const paletteBytes = (options.palette?.length ?? 0) * 4
  const pixelOffset = 14 + headerSize + maskBytes + paletteBytes
  const output = new Uint8Array(pixelOffset + options.data.byteLength)
  const view = new DataView(output.buffer)
  output.set([0x42, 0x4d])
  view.setUint32(2, output.byteLength, true)
  view.setUint32(10, pixelOffset, true)
  view.setUint32(14, headerSize, true)
  view.setInt32(18, options.width, true)
  view.setInt32(22, options.topDown ? -options.height : options.height, true)
  view.setUint16(26, 1, true)
  view.setUint16(28, options.bitDepth, true)
  view.setUint32(30, compression, true)
  view.setUint32(34, options.data.byteLength, true)
  view.setUint32(46, options.palette?.length ?? 0, true)

  const maskOffset = headerSize === 40 ? 14 + headerSize : 54
  for (let index = 0; index < (options.masks?.length ?? 0); index += 1) {
    view.setUint32(maskOffset + index * 4, options.masks?.[index] ?? 0, true)
  }
  const paletteOffset = 14 + headerSize + maskBytes
  for (let index = 0; index < (options.palette?.length ?? 0); index += 1) {
    const color = options.palette?.[index]
    if (!color) continue
    output.set([color[2], color[1], color[0], 0], paletteOffset + index * 4)
  }
  output.set(options.data, pixelOffset)
  return output
}

const os2MonochromeFixture = (): Uint8Array => {
  const output = new Uint8Array(14 + 12 + 6 + 4)
  const view = new DataView(output.buffer)
  output.set([0x42, 0x4d])
  view.setUint32(2, output.byteLength, true)
  view.setUint32(10, 32, true)
  view.setUint32(14, 12, true)
  view.setUint16(18, 2, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint16(24, 1, true)
  output.set([0, 0, 0, 255, 255, 255], 26)
  output.set([0x40, 0, 0, 0], 32)
  return output
}

const decodedPng = async (input: Uint8Array): Promise<PNG> => {
  const output = await (await Image.open(input)).png().toBuffer()
  return PNG.sync.read(output)
}

const pixel = (image: PNG, x: number, y: number): Rgba => {
  const offset = (y * image.width + x) * 4
  return [
    image.data[offset] ?? -1,
    image.data[offset + 1] ?? -1,
    image.data[offset + 2] ?? -1,
    image.data[offset + 3] ?? -1,
  ]
}

describe('BMP codec', () => {
  it('decodes bottom-up 24-bit rows, padding, and regions', async () => {
    const input = bmpFixture({
      width: 3,
      height: 2,
      bitDepth: 24,
      data: Uint8Array.from([
        255, 255, 255, 0, 0, 0, 0, 255, 255, 0, 0, 0, 0, 0, 255, 0, 255, 0, 255, 0, 0, 0, 0, 0,
      ]),
    })
    const image = await Image.open(input)

    await expect(image.metadata()).resolves.toMatchObject({
      format: 'bmp',
      width: 3,
      height: 2,
      bitDepth: 24,
      hasAlpha: false,
    })
    const decoded = await decodedPng(input)
    expect(pixel(decoded, 0, 0)).toEqual([255, 0, 0, 255])
    expect(pixel(decoded, 1, 0)).toEqual([0, 255, 0, 255])
    expect(pixel(decoded, 2, 0)).toEqual([0, 0, 255, 255])
    expect(pixel(decoded, 0, 1)).toEqual([255, 255, 255, 255])

    const cropped = PNG.sync.read(
      await image.crop({ x: 1, y: 0, width: 2, height: 1 }).png().toBuffer(),
    )
    expect(pixel(cropped, 0, 0)).toEqual([0, 255, 0, 255])
    expect(pixel(cropped, 1, 0)).toEqual([0, 0, 255, 255])
  })

  it('decodes RLE4 and RLE8 encoded and absolute runs', async () => {
    const palette: readonly Rgba[] = [
      [255, 0, 0, 255],
      [0, 255, 0, 255],
      [0, 0, 255, 255],
      [255, 255, 255, 255],
    ]
    const rle4Input = bmpFixture({
      width: 4,
      height: 2,
      bitDepth: 4,
      compression: 2,
      palette,
      data: Uint8Array.from([4, 0x23, 0, 0, 0, 4, 0x01, 0x23, 0, 0, 0, 1]),
    })
    const rle8Input = bmpFixture({
      width: 4,
      height: 2,
      bitDepth: 8,
      compression: 1,
      palette,
      data: Uint8Array.from([4, 2, 0, 0, 0, 4, 0, 1, 2, 3, 0, 0, 0, 1]),
    })

    for (const [input, lastBottomPixel] of [
      [rle4Input, [255, 255, 255, 255]],
      [rle8Input, [0, 0, 255, 255]],
    ] as const) {
      const decoded = await decodedPng(input)
      expect(pixel(decoded, 0, 0)).toEqual([255, 0, 0, 255])
      expect(pixel(decoded, 1, 0)).toEqual([0, 255, 0, 255])
      expect(pixel(decoded, 2, 1)).toEqual([0, 0, 255, 255])
      expect(pixel(decoded, 3, 1)).toEqual(lastBottomPixel)
    }
  })

  it('supports OS/2 headers and full-range bitfield scaling', async () => {
    const os2 = await decodedPng(os2MonochromeFixture())
    expect(pixel(os2, 0, 0)).toEqual([0, 0, 0, 255])
    expect(pixel(os2, 1, 0)).toEqual([255, 255, 255, 255])

    const rgb565 = bmpFixture({
      width: 2,
      height: 1,
      bitDepth: 16,
      compression: 3,
      masks: [0xf800, 0x07e0, 0x001f],
      data: Uint8Array.from([0x00, 0xf8, 0xe0, 0x07]),
    })
    const decoded = await decodedPng(rgb565)
    expect(pixel(decoded, 0, 0)).toEqual([255, 0, 0, 255])
    expect(pixel(decoded, 1, 0)).toEqual([0, 255, 0, 255])
  })

  it('preserves V4 alpha masks', async () => {
    const input = bmpFixture({
      width: 2,
      height: 1,
      bitDepth: 32,
      compression: 3,
      headerSize: 108,
      masks: [0x00ff0000, 0x0000ff00, 0x000000ff, 0xff000000],
      data: Uint8Array.from([30, 20, 10, 40, 90, 80, 70, 0]),
    })
    const image = await Image.open(input)

    await expect(image.metadata()).resolves.toMatchObject({ hasAlpha: true, bitDepth: 32 })
    const decoded = await decodedPng(input)
    expect(pixel(decoded, 0, 0)).toEqual([10, 20, 30, 40])
    expect(pixel(decoded, 1, 0)).toEqual([70, 80, 90, 0])
  })

  it('encodes streaming top-down 24-bit and alpha BMPs', async () => {
    const source = new PNG({ width: 2, height: 1 })
    source.data.set([10, 20, 30, 255, 70, 80, 90, 0])
    const png = PNG.sync.write(source)

    const opaque = await (await Image.open(png)).bmp({ alpha: false }).toBuffer()
    const opaqueView = new DataView(opaque.buffer, opaque.byteOffset, opaque.byteLength)
    expect(opaqueView.getUint32(14, true)).toBe(40)
    expect(opaqueView.getInt32(22, true)).toBe(-1)
    expect(opaque.subarray(54, 60)).toEqual(Buffer.from([30, 20, 10, 90, 80, 70]))
    expect(pixel(await decodedPng(opaque), 0, 0)).toEqual([10, 20, 30, 255])

    const alpha = await (await Image.open(png)).bmp().toBuffer()
    const alphaView = new DataView(alpha.buffer, alpha.byteOffset, alpha.byteLength)
    expect(alphaView.getUint32(14, true)).toBe(108)
    expect(alphaView.getUint32(66, true)).toBe(0xff000000)
    const roundTrip = await decodedPng(alpha)
    expect(pixel(roundTrip, 0, 0)).toEqual([10, 20, 30, 255])
    expect(pixel(roundTrip, 1, 0)).toEqual([70, 80, 90, 0])
  })

  it('rejects truncated pixels, invalid planes, masks, and RLE overruns', async () => {
    const valid = bmpFixture({
      width: 1,
      height: 1,
      bitDepth: 24,
      data: Uint8Array.from([0, 0, 0, 0]),
    })
    await expect((await Image.open(valid.subarray(0, -1))).png().toBuffer()).rejects.toMatchObject({
      code: 'TRUNCATED_INPUT',
    })

    const badPlanes = valid.slice()
    new DataView(badPlanes.buffer).setUint16(26, 2, true)
    await expect((await Image.open(badPlanes)).metadata()).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    })

    const overlappingMasks = bmpFixture({
      width: 1,
      height: 1,
      bitDepth: 16,
      compression: 3,
      masks: [0x7c00, 0x7c00, 0x001f],
      data: Uint8Array.from([0, 0, 0, 0]),
    })
    await expect((await Image.open(overlappingMasks)).metadata()).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    })

    const missingAlphaMask = bmpFixture({
      width: 1,
      height: 1,
      bitDepth: 32,
      compression: 6,
      masks: [0x00ff0000, 0x0000ff00, 0x000000ff],
      data: Uint8Array.from([0, 0, 0, 0]),
    })
    await expect((await Image.open(missingAlphaMask)).metadata()).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    })

    const rleOverrun = bmpFixture({
      width: 2,
      height: 1,
      bitDepth: 8,
      compression: 1,
      palette: [[0, 0, 0, 255]],
      data: Uint8Array.from([3, 0, 0, 1]),
    })
    await expect((await Image.open(rleOverrun)).png().toBuffer()).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    })
  })
})
