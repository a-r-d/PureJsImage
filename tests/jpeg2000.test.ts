import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { PNG } from 'pngjs'
import { describe, expect, it } from 'vitest'

import { jpegCodec } from '../src/codecs/jpeg.ts'
import { createJpeg2000CodestreamDecoder, jpeg2000Codec } from '../src/codecs/jpeg2000.ts'
import { pngCodec } from '../src/codecs/png.ts'
import { createNodeImageLibrary } from '../src/node-image.ts'
import { defaultImageLimits } from '../src/limits.ts'
import { MemorySource } from '../src/source.ts'
import { channelSwappingRgbProfile } from './icc-fixtures.ts'

const images = createNodeImageLibrary([jpeg2000Codec, pngCodec, jpegCodec])
const fixture = (name: string): Promise<Buffer> => readFile(`benchmark/corpus/files/jp2/${name}`)
// ImageMagick 7.1.2-3 / OpenJPEG 2.5.3, lossless 2x2 straight-alpha RGBA.
const openJpegAlpha = Buffer.from(
  'AAAADGpQICANCocKAAAAFGZ0eXBqcDIgAAAAAGpwMiAAAABPanAyaAAAABZpaGRyAAAAAgAAAAIABAcHAAAAAAAPY29scgEAAAAAABAAAAAiY2RlZgAEAAAAAAABAAEAAAACAAIAAAADAAMAAQAAAAAAqmpwMmP/T/9RADIAAAAAAAIAAAACAAAAAAAAAAAAAAACAAAAAgAAAAAAAAAAAAQHAQEHAQEHAQEHAQH/UgAMAAAAAQABBAQAAf9cAAdAQEhIUP9kACUAAUNyZWF0ZWQgYnkgT3BlbkpQRUcgdmVyc2lvbiAyLjUuM/+QAAoAAAAAACwAAf+TgICAgJPyAgDfz7AEAKfYAgDH2AM+wCg+YCAIBt8A/9k=',
  'base64',
)

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

const markerOffset = (data: Uint8Array, marker: number, start = 0): number => {
  for (let offset = start; offset + 1 < data.byteLength; offset += 1) {
    if (data[offset] === 0xff && data[offset + 1] === marker) return offset
  }
  return -1
}

const appendEmptyTilePart = (input: Buffer): Buffer => {
  const codestreamType = asciiOffset(input, 'jp2c')
  const tilePart = markerOffset(input, 0x90, codestreamType + 4)
  const end = markerOffset(input, 0xd9, tilePart)
  if (codestreamType < 4 || tilePart < 0 || end < 0)
    throw new Error('JP2 fixture markers are missing')
  const output = Buffer.alloc(input.byteLength + 14)
  input.copy(output, 0, 0, end)
  input.copy(output, end + 14, end)
  output.writeUInt32BE(input.readUInt32BE(codestreamType - 4) + 14, codestreamType - 4)
  output[tilePart + 11] = 2
  output.set(
    Buffer.from([
      0xff,
      0x90,
      0,
      10,
      input[tilePart + 4] ?? 0,
      input[tilePart + 5] ?? 0,
      0,
      0,
      0,
      14,
      1,
      2,
      0xff,
      0x93,
    ]),
    end,
  )
  return output
}

const setCodeBlockStyle = (input: Buffer, flags: number): Buffer => {
  const output = Buffer.from(input)
  const codestreamType = asciiOffset(output, 'jp2c')
  const codingStyle = markerOffset(output, 0x52, codestreamType + 4)
  if (codingStyle < 0) throw new Error('JP2 fixture COD marker is missing')
  output[codingStyle + 12] = flags
  return output
}

const insertMaxshiftRoi = (input: Buffer, shift: number): Buffer => {
  const codestreamType = asciiOffset(input, 'jp2c')
  const tilePart = markerOffset(input, 0x90, codestreamType + 4)
  if (codestreamType < 4 || tilePart < 0) throw new Error('JP2 fixture markers are missing')
  const marker = Buffer.from([0xff, 0x5e, 0, 5, 0, 0, shift])
  const output = Buffer.concat([input.subarray(0, tilePart), marker, input.subarray(tilePart)])
  output.writeUInt32BE(
    input.readUInt32BE(codestreamType - 4) + marker.byteLength,
    codestreamType - 4,
  )
  return output
}

const jp2Box = (type: string, content: Uint8Array): Buffer => {
  const output = Buffer.alloc(8 + content.byteLength)
  output.writeUInt32BE(output.byteLength, 0)
  output.write(type, 4, 'ascii')
  output.set(content, 8)
  return output
}

const withRgbIccProfile = (input: Buffer, profile: Uint8Array): Buffer => {
  const headerType = asciiOffset(input, 'jp2h')
  const colorType = asciiOffset(input, 'colr')
  if (headerType < 4 || colorType < 4) throw new Error('JP2 color boxes are missing')
  const colorStart = colorType - 4
  const colorLength = input.readUInt32BE(colorStart)
  const content = Buffer.concat([Buffer.from([2, 0, 0]), profile])
  const replacement = Buffer.alloc(8 + content.byteLength)
  replacement.writeUInt32BE(replacement.byteLength, 0)
  replacement.write('colr', 4, 'ascii')
  replacement.set(content, 8)
  const output = Buffer.concat([
    input.subarray(0, colorStart),
    replacement,
    input.subarray(colorStart + colorLength),
  ])
  output.writeUInt32BE(
    input.readUInt32BE(headerType - 4) + replacement.byteLength - colorLength,
    headerType - 4,
  )
  return output
}

const withRgbPalette = (input: Buffer): Buffer => {
  const headerType = asciiOffset(input, 'jp2h')
  const colorType = asciiOffset(input, 'colr')
  if (headerType < 4 || colorType < 4) throw new Error('JP2 color boxes are missing')
  const entries = 65_535
  const paletteContent = Buffer.alloc(6 + entries * 3)
  paletteContent.writeUInt16BE(entries, 0)
  paletteContent[2] = 3
  paletteContent.set([7, 7, 7], 3)
  for (let index = 0; index < entries; index += 1) {
    const value = index >>> 8
    const offset = 6 + index * 3
    paletteContent[offset] = value
    paletteContent[offset + 1] = 0
    paletteContent[offset + 2] = 255 - value
  }
  const mapping = jp2Box('cmap', Buffer.from([0, 0, 1, 0, 0, 0, 1, 1, 0, 0, 1, 2]))
  const definitions = jp2Box(
    'cdef',
    Buffer.from([0, 3, 0, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 2, 0, 2, 0, 0, 0, 3]),
  )
  const extra = Buffer.concat([jp2Box('pclr', paletteContent), mapping, definitions])
  const headerStart = headerType - 4
  const headerEnd = headerStart + input.readUInt32BE(headerStart)
  const output = Buffer.concat([input.subarray(0, headerEnd), extra, input.subarray(headerEnd)])
  output.writeUInt32BE(input.readUInt32BE(headerStart) + extra.byteLength, headerStart)
  output.writeUInt32BE(16, colorType + 7)
  return output
}
// ImageMagick 7.1.2-3 / OpenJPEG 2.5.3, 8-bit RGBA output.
const resetContextOracle = Buffer.from(
  'DQ0N/wkJCf8EBAT/AAAA/wAAAP8AAAD/AgIC/wYGBv8JCQn/MjIy/zIyMv8zMzP/NDQ0/zQ0NP80NDT/MzMz/zMzM/8yMjL/VlZW/1xcXP9iYmL/aGho/25ubv9qamr/ZWVl/2BgYP9bW1v/h4eH/4mJif+Kior/jIyM/46Ojv+MjIz/i4uL/4qKiv+IiIj/t7e3/7W1tf+ysrL/sLCw/62trf+vr6//sbGx/7Ozs/+1tbX/3Nzc/9ra2v/Y2Nj/1dXV/9PT0//V1dX/19fX/9jY2P/a2tr////////////9/f3/+vr6//j4+P/6+vr//Pz8//7+/v//////',
  'base64',
)
const verticalCausalOracle = Buffer.from(
  [0, 42, 85, 127, 170, 212, 255].flatMap((value) =>
    Array.from({ length: 9 }, () => [value, value, value, 255]).flat(),
  ),
)

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

  it('decodes a cdef-declared straight-alpha JP2 image', async () => {
    await expect((await images.open(openJpegAlpha)).metadata()).resolves.toMatchObject({
      width: 2,
      height: 2,
      hasAlpha: true,
      components: 4,
      channels: 4,
    })
    const decoded = PNG.sync.read(await (await images.open(openJpegAlpha)).png().toBuffer())
    const expected = [255, 0, 0, 255, 0, 255, 0, 144, 0, 0, 255, 80, 255, 255, 255, 16]
    closePixel(Array.from(decoded.data), expected, 1)
  })

  it('applies and preserves an embedded RGB matrix/TRC ICC profile', async () => {
    const source = await fixture('openjpeg-lossless-rgb16.jp2')
    const profile = channelSwappingRgbProfile()
    const input = withRgbIccProfile(source, profile)
    await expect((await images.open(input)).metadata()).resolves.toMatchObject({
      colorProfile: { kind: 'icc' },
    })
    const preserved = await jpeg2000Codec.preservedMetadata?.(
      new MemorySource(input),
      defaultImageLimits,
    )
    expect(preserved?.icc).toEqual(profile)
    const decoded = PNG.sync.read(await (await images.open(input)).png().toBuffer())
    closePixel(pixel(decoded, 0, 0), [0, 0, 255], 1)
    closePixel(pixel(decoded, 16, 12), [255, 0, 0], 1)
  })

  it('maps a palette codestream component into ordered RGB channels', async () => {
    const source = await fixture('openjpeg-lossless-gray16.jp2')
    const input = withRgbPalette(source)
    await expect((await images.open(input)).metadata()).resolves.toMatchObject({
      colorSpace: 'sRGB',
      components: 1,
      channels: 3,
    })
    const decoded = PNG.sync.read(await (await images.open(input)).png().toBuffer())
    expect(pixel(decoded, 0, 0)).toEqual([0, 0, 255])
    closePixel(pixel(decoded, 4, 3), [128, 0, 127], 1)
    expect(pixel(decoded, 8, 6)).toEqual([255, 0, 0])
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

  it('decodes ordered multiple tile-parts for one tile', async () => {
    const source = await fixture('openjpeg-lossless-rgb16.jp2')
    const input = appendEmptyTilePart(source)
    const expected = PNG.sync.read(await (await images.open(source)).png().toBuffer())
    const decoded = PNG.sync.read(await (await images.open(input)).png().toBuffer())
    expect(decoded.data).toEqual(expected.data)
  })

  it('decodes reset-context and vertical-causal code-block styles', async () => {
    const source = await fixture('openjpeg-lossless-gray16.jp2')
    const cases = [
      [0x02, resetContextOracle],
      [0x08, verticalCausalOracle],
    ] as const
    for (const [flags, oracle] of cases) {
      const input = setCodeBlockStyle(source, flags)
      const decoded = PNG.sync.read(await (await images.open(input)).png().toBuffer())
      closePixel(Array.from(decoded.data), Array.from(oracle), 1)
    }
  })

  it('reconstructs maxshift region-of-interest coefficients', async () => {
    const source = await fixture('openjpeg-lossless-gray16.jp2')
    const input = insertMaxshiftRoi(source, 2)
    const decoded = PNG.sync.read(await (await images.open(input)).png().toBuffer())
    closePixel(Array.from(decoded.data), Array.from(verticalCausalOracle), 1)
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

  it('selects a lower wavelet resolution for scaled decode', async () => {
    const input = await fixture('openjpeg-lossless-rgb16.jp2')
    const codestreamType = asciiOffset(input, 'jp2c')
    if (codestreamType < 0) throw new Error('JP2 codestream box is missing')
    const decoder = createJpeg2000CodestreamDecoder(input.subarray(codestreamType + 4), {
      colorSpace: 'rgb',
    })
    const output: number[] = []
    let width = 0
    let height = 0
    for await (const block of decoder.decode({ scaleDenominator: 4 })) {
      width = block.width
      height += block.height
      output.push(...block.data)
    }
    expect({ width, height }).toEqual({ width: 5, height: 4 })
    // FFmpeg 8.0 jpeg2000 -lowres 2, rgb24 output.
    const oracle = Buffer.from(
      '/wAA/wAA/wAA/wAA/wAAqwBVqwBVqwBVqwBVqwBVVQCrVQCrVQCrVQCrVQCrAAD/AAD/AAD/AAD/AAD/',
      'base64',
    )
    closePixel(output, Array.from(oracle), 1)
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
