import { describe, expect, it } from 'vitest'

import { defaultImageLimits } from '../src/index.ts'
import { tgaCodec } from '../src/codecs/tga.ts'
import { MemorySource } from '../src/source.ts'
import { Image } from './image-library.ts'
import { decodeFixture } from './small-codec-helpers.ts'

interface TgaFixtureOptions {
  readonly width: number
  readonly height: number
  readonly imageType: 1 | 2 | 3 | 9 | 10 | 11
  readonly pixelDepth: 8 | 15 | 16 | 24 | 32
  readonly descriptor?: number
  readonly imageId?: string
  readonly paletteOrigin?: number
  readonly paletteLength?: number
  readonly paletteDepth?: 15 | 16 | 24 | 32
  readonly palette?: readonly number[]
  readonly raster: readonly number[]
}

const tgaFixture = (options: TgaFixtureOptions): Uint8Array => {
  const id = new TextEncoder().encode(options.imageId ?? '')
  const palette = Uint8Array.from(options.palette ?? [])
  const output = new Uint8Array(18 + id.byteLength + palette.byteLength + options.raster.length)
  const view = new DataView(output.buffer)
  output[0] = id.byteLength
  output[1] = options.palette ? 1 : 0
  output[2] = options.imageType
  view.setUint16(3, options.paletteOrigin ?? 0, true)
  view.setUint16(5, options.paletteLength ?? 0, true)
  output[7] = options.paletteDepth ?? 0
  view.setUint16(12, options.width, true)
  view.setUint16(14, options.height, true)
  output[16] = options.pixelDepth
  output[17] = options.descriptor ?? 0
  output.set(id, 18)
  output.set(palette, 18 + id.byteLength)
  output.set(options.raster, 18 + id.byteLength + palette.byteLength)
  return output
}

const red = [0, 0, 255]
const green = [0, 255, 0]
const blue = [255, 0, 0]
const white = [255, 255, 255]
const expected = [255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255]

describe('TGA', () => {
  it.each([
    ['top-left', 0x20, [...red, ...green, ...blue, ...white]],
    ['bottom-left', 0, [...blue, ...white, ...red, ...green]],
    ['top-right', 0x30, [...green, ...red, ...white, ...blue]],
    ['bottom-right', 0x10, [...white, ...blue, ...green, ...red]],
  ])('decodes uncompressed 24-bit %s origin', async (_name, descriptor, raster) => {
    const decoded = await decodeFixture(
      tgaCodec,
      tgaFixture({ width: 2, height: 2, imageType: 2, pixelDepth: 24, descriptor, raster }),
    )
    expect(decoded.decoder).toMatchObject({ width: 2, height: 2, pixelFormat: 'rgb8' })
    expect([...decoded.pixels]).toEqual(expected)
    expect(decoded.blocks.every((block) => block.height === 1)).toBe(true)
  })

  it('decodes raw and run-length packets within and across scanlines', async () => {
    const input = tgaFixture({
      width: 3,
      height: 1,
      imageType: 10,
      pixelDepth: 24,
      descriptor: 0x20,
      raster: [0x81, ...red, 0, ...blue],
    })
    expect([...(await decodeFixture(tgaCodec, input)).pixels]).toEqual([
      255, 0, 0, 255, 0, 0, 0, 0, 255,
    ])

    const grayscale = tgaFixture({
      width: 4,
      height: 1,
      imageType: 11,
      pixelDepth: 8,
      descriptor: 0x20,
      raster: [0x81, 9, 1, 20, 30],
    })
    expect([...(await decodeFixture(tgaCodec, grayscale)).pixels]).toEqual([9, 9, 20, 30])

    const crossing = tgaFixture({
      width: 2,
      height: 2,
      imageType: 10,
      pixelDepth: 24,
      descriptor: 0x20,
      raster: [0x82, ...red, 0, ...blue],
    })
    expect([...(await decodeFixture(tgaCodec, crossing)).pixels]).toEqual([
      255, 0, 0, 255, 0, 0, 255, 0, 0, 0, 0, 255,
    ])
  })

  it('decodes grayscale, RGB555, and RGB5551 attribute alpha', async () => {
    const grayscale = tgaFixture({
      width: 2,
      height: 1,
      imageType: 3,
      pixelDepth: 8,
      descriptor: 0x20,
      raster: [3, 240],
    })
    expect([...(await decodeFixture(tgaCodec, grayscale)).pixels]).toEqual([3, 240])

    const rgb555 = tgaFixture({
      width: 3,
      height: 1,
      imageType: 2,
      pixelDepth: 15,
      descriptor: 0x20,
      raster: [0, 0x7c, 0xe0, 3, 0x1f, 0],
    })
    expect([...(await decodeFixture(tgaCodec, rgb555)).pixels]).toEqual([
      255, 0, 0, 0, 255, 0, 0, 0, 255,
    ])

    const rgba5551 = tgaFixture({
      width: 2,
      height: 1,
      imageType: 2,
      pixelDepth: 16,
      descriptor: 0x21,
      raster: [0, 0xfc, 0x1f, 0],
    })
    const decoded = await decodeFixture(tgaCodec, rgba5551)
    expect(decoded.decoder.pixelFormat).toBe('rgba8')
    expect([...decoded.pixels]).toEqual([255, 0, 0, 255, 0, 0, 255, 0])
  })

  it('decodes indexed input with color-map origins and alpha entries', async () => {
    const indexed = tgaFixture({
      width: 2,
      height: 1,
      imageType: 1,
      pixelDepth: 8,
      descriptor: 0x20,
      paletteOrigin: 5,
      paletteLength: 2,
      paletteDepth: 24,
      palette: [...red, ...green],
      raster: [5, 6],
    })
    expect([...(await decodeFixture(tgaCodec, indexed)).pixels]).toEqual([255, 0, 0, 0, 255, 0])

    const indexedRle = tgaFixture({
      width: 2,
      height: 1,
      imageType: 9,
      pixelDepth: 16,
      descriptor: 0x20,
      paletteOrigin: 300,
      paletteLength: 1,
      paletteDepth: 32,
      palette: [30, 20, 10, 40],
      raster: [0x81, 44, 1],
    })
    const decoded = await decodeFixture(tgaCodec, indexedRle)
    expect(decoded.decoder.pixelFormat).toBe('rgba8')
    expect([...decoded.pixels]).toEqual([10, 20, 30, 40, 10, 20, 30, 40])
  })

  it('exposes the image ID and decodes cropped regions', async () => {
    const input = tgaFixture({
      width: 2,
      height: 2,
      imageType: 2,
      pixelDepth: 24,
      descriptor: 0x20,
      imageId: 'fixture-id',
      raster: [...red, ...green, ...blue, ...white],
    })
    const metadata = await tgaCodec.metadata(new MemorySource(input), defaultImageLimits)
    expect(metadata).toMatchObject({ imageId: 'fixture-id', bitDepth: 24, lossless: true })
    expect([
      ...(await decodeFixture(tgaCodec, input, { x: 1, y: 1, width: 1, height: 1 })).pixels,
    ]).toEqual([255, 255, 255])
  })

  it('encodes deterministic raw RGB, raw RGBA, and RLE output with a TGA 2 footer', async () => {
    const source = tgaFixture({
      width: 3,
      height: 1,
      imageType: 2,
      pixelDepth: 32,
      descriptor: 0x28,
      raster: [0, 0, 255, 10, 0, 0, 255, 10, 255, 0, 0, 200],
    })
    const image = await Image.open(source)
    const rgb = await image.tga({ alpha: false }).toBuffer()
    const rgba = await image.tga({ alpha: true }).toBuffer()
    const rle = await image.tga({ alpha: true, rle: true }).toBuffer()

    expect(rgb[2]).toBe(2)
    expect(rgb[16]).toBe(24)
    expect(rgba[16]).toBe(32)
    expect(rle[2]).toBe(10)
    expect(new TextDecoder().decode(rle.subarray(rle.byteLength - 18))).toBe('TRUEVISION-XFILE.\0')
    expect([...(await decodeFixture(tgaCodec, rgb)).pixels]).toEqual([
      255, 0, 0, 255, 0, 0, 0, 0, 255,
    ])
    expect([...(await decodeFixture(tgaCodec, rgba)).pixels]).toEqual([
      255, 0, 0, 10, 255, 0, 0, 10, 0, 0, 255, 200,
    ])
    expect([...(await decodeFixture(tgaCodec, rle)).pixels]).toEqual([
      255, 0, 0, 10, 255, 0, 0, 10, 0, 0, 255, 200,
    ])
    expect(rle).toEqual(await image.tga({ alpha: true, rle: true }).toBuffer())
  })

  it('rejects truncated rasters, packet overflow, invalid palette indices, and attributes', async () => {
    const inputs = [
      tgaFixture({ width: 2, height: 1, imageType: 2, pixelDepth: 24, raster: [0, 0, 0] }),
      tgaFixture({ width: 2, height: 1, imageType: 10, pixelDepth: 24, raster: [0x82, 0, 0, 0] }),
      tgaFixture({
        width: 1,
        height: 1,
        imageType: 2,
        pixelDepth: 15,
        descriptor: 1,
        raster: [0, 0],
      }),
      tgaFixture({
        width: 1,
        height: 1,
        imageType: 1,
        pixelDepth: 8,
        paletteOrigin: 5,
        paletteLength: 1,
        paletteDepth: 24,
        palette: [...red],
        raster: [4],
      }),
    ]
    const invalidAttributes = tgaFixture({
      width: 1,
      height: 1,
      imageType: 2,
      pixelDepth: 24,
      descriptor: 1,
      raster: [...red],
    })

    for (const input of [...inputs, invalidAttributes]) {
      await expect(async () => {
        const image = await Image.open(input)
        await image.png().toBuffer()
      }).rejects.toMatchObject({ code: expect.stringMatching(/INVALID_INPUT|TRUNCATED_INPUT/) })
    }
  })
})
