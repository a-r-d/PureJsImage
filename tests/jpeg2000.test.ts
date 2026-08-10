import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { PNG } from 'pngjs'
import { describe, expect, it } from 'vitest'

import { jpegCodec } from '../src/codecs/jpeg.ts'
import { createJpeg2000CodestreamDecoder, jpeg2000Codec } from '../src/codecs/jpeg2000.ts'
import { pngCodec } from '../src/codecs/png.ts'
import { createNodeImageLibrary } from '../src/node-image.ts'

const images = createNodeImageLibrary([jpeg2000Codec, pngCodec, jpegCodec])
const fixture = (name: string): Promise<Buffer> => readFile(`benchmark/corpus/files/jp2/${name}`)

const asciiOffset = (data: Uint8Array, value: string): number => {
  for (let offset = 0; offset + value.length <= data.byteLength; offset += 1) {
    let matches = true
    for (let index = 0; index < value.length; index += 1) {
      if (data[offset + index] !== value.charCodeAt(index)) {
        matches = false
        break
      }
    }
    if (matches) return offset
  }
  return -1
}

const pixel = (image: PNG, x: number, y: number): readonly [number, number, number] => {
  const offset = (y * image.width + x) * 4
  return [image.data[offset] ?? -1, image.data[offset + 1] ?? -1, image.data[offset + 2] ?? -1]
}

const closePixel = (
  actual: readonly number[],
  expected: readonly number[],
  tolerance: number,
): void => {
  expect(actual).toHaveLength(expected.length)
  for (let index = 0; index < expected.length; index += 1) {
    expect(Math.abs((actual[index] ?? -1) - (expected[index] ?? -1))).toBeLessThanOrEqual(tolerance)
  }
}

describe('JPEG 2000 codec', () => {
  it('inspects and decodes lossless RGB and grayscale JP2 fixtures', async () => {
    const rgb = await fixture('openjpeg-lossless-rgb16.jp2')
    const gray = await fixture('openjpeg-lossless-gray16.jp2')

    await expect((await images.open(rgb)).metadata()).resolves.toMatchObject({
      format: 'jp2',
      mimeType: 'image/jp2',
      width: 17,
      height: 13,
      colorSpace: 'sRGB',
      bitDepth: 16,
      components: 3,
      channels: 3,
      lossless: true,
      tiles: 1,
    })
    await expect((await images.open(gray)).metadata()).resolves.toMatchObject({
      width: 9,
      height: 7,
      colorSpace: 'gray',
      components: 1,
      lossless: true,
    })

    const rgbPixels = PNG.sync.read(await (await images.open(rgb)).png().toBuffer())
    expect(pixel(rgbPixels, 0, 0)).toEqual([255, 0, 0])
    closePixel(pixel(rgbPixels, 8, 6), [128, 0, 128], 1)
    expect(pixel(rgbPixels, 16, 12)).toEqual([0, 0, 255])

    const grayPixels = PNG.sync.read(await (await images.open(gray)).png().toBuffer())
    expect(pixel(grayPixels, 0, 0)).toEqual([0, 0, 0])
    closePixel(pixel(grayPixels, 4, 3), [128, 128, 128], 1)
    expect(pixel(grayPixels, 8, 6)).toEqual([255, 255, 255])
  })

  it('decodes irreversible 9/7 output within the pinned oracle tolerance', async () => {
    const input = await fixture('ffmpeg-lossy-rgb8.jp2')
    const decoded = PNG.sync.read(await (await images.open(input)).png().toBuffer())

    expect(decoded.width).toBe(32)
    expect(decoded.height).toBe(24)
    closePixel(pixel(decoded, 0, 0), [0, 1, 1], 1)
    closePixel(pixel(decoded, 8, 7), [255, 0, 254], 1)
    closePixel(pixel(decoded, 16, 12), [255, 255, 1], 1)
    closePixel(pixel(decoded, 31, 23), [255, 255, 255], 1)
  })

  it('runs crop, resize, PNG, and JPEG workflows through the public pipeline', async () => {
    const input = await fixture('openjpeg-lossless-rgb16.jp2')
    const transformed = await (await images.open(input))
      .crop({ x: 2, y: 1, width: 12, height: 10 })
      .resize({ width: 6, height: 5 })
      .jpeg({ quality: 80 })
      .toBuffer()
    expect(transformed.subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff]))
  })

  it('decodes all five progression orders and multiple tiles consistently', async () => {
    const progressions = ['rgb8', 'rlcp-rgb8', 'rpcl-rgb8', 'pcrl-rgb8', 'cprl-rgb8']
    for (const suffix of progressions) {
      const input = await fixture(`ffmpeg-lossy-${suffix}.jp2`)
      const decoded = PNG.sync.read(await (await images.open(input)).png().toBuffer())
      expect(createHash('sha256').update(decoded.data).digest('hex')).toBe(
        '7792ee3edf547133b1568d9adb25410723b9e3de0f4576e9d8507114e4868c16',
      )
    }

    const tiled = await fixture('ffmpeg-lossy-tiled-rgb8.jp2')
    await expect((await images.open(tiled)).metadata()).resolves.toMatchObject({
      width: 40,
      height: 30,
      tiles: 6,
      lossless: false,
    })
    const decoded = PNG.sync.read(await (await images.open(tiled)).png().toBuffer())
    expect(createHash('sha256').update(decoded.data).digest('hex')).toBe(
      '2e2ffdb4441ece4c1704efed99a0a44a54162314215ef09c216a435019f1cde9',
    )
  })

  it('decodes a raw codestream through the reusable composition API', async () => {
    const input = await fixture('openjpeg-lossless-rgb16.jp2')
    const codestreamType = asciiOffset(input, 'jp2c')
    if (codestreamType < 0) throw new Error('JP2 codestream box is missing')
    const decoder = createJpeg2000CodestreamDecoder(input.subarray(codestreamType + 4), {
      colorSpace: 'rgb',
    })
    expect({ width: decoder.width, height: decoder.height, format: decoder.pixelFormat }).toEqual({
      width: 17,
      height: 13,
      format: 'rgb8',
    })
    const output = new Uint8Array(decoder.width * decoder.height * 3)
    for await (const block of decoder.decode()) output.set(block.data, block.y * block.stride)
    expect(Array.from(output.subarray(0, 3))).toEqual([255, 0, 0])
    expect(Array.from(output.subarray((6 * 17 + 8) * 3, (6 * 17 + 8) * 3 + 3))).toEqual([
      128, 0, 128,
    ])
    expect(Array.from(output.subarray(-3))).toEqual([0, 0, 255])
  })

  it('rejects raw codestreams, non-JP2 brands, invalid box extents, and contradictory dimensions', async () => {
    const original = await fixture('openjpeg-lossless-rgb16.jp2')
    const codestreamType = asciiOffset(original, 'jp2c')
    expect(codestreamType).toBeGreaterThan(0)
    const codestream = original.subarray(codestreamType + 4)
    await expect(images.open(codestream)).rejects.toMatchObject({
      code: 'UNSUPPORTED_OPERATION',
    })

    const wrongBrand = Buffer.from(original)
    const ftyp = asciiOffset(wrongBrand, 'ftyp')
    expect(ftyp).toBeGreaterThan(0)
    wrongBrand.set(Buffer.from('jpx '), ftyp + 4)
    await expect((await images.open(wrongBrand)).metadata()).rejects.toMatchObject({
      code: 'UNSUPPORTED_OPERATION',
    })

    const oversized = Buffer.from(original)
    oversized.writeUInt32BE(oversized.byteLength + 100, codestreamType - 4)
    await expect((await images.open(oversized)).metadata()).rejects.toMatchObject({
      code: 'TRUNCATED_INPUT',
    })

    const contradictory = Buffer.from(original)
    const ihdr = asciiOffset(contradictory, 'ihdr')
    expect(ihdr).toBeGreaterThan(0)
    contradictory.writeUInt32BE(18, ihdr + 8)
    await expect((await images.open(contradictory)).metadata()).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    })
  })
})
