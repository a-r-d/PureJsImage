import { deflateSync } from 'node:zlib'
import { PNG } from 'pngjs'
import { describe, expect, it } from 'vitest'

import { channelSwappingRgbProfile } from './icc-fixtures.ts'
import { Image } from './image-library.ts'

type Rgba = readonly [red: number, green: number, blue: number, alpha: number]
type TiffFieldType = 3 | 4 | 7

interface TiffEntryFixture {
  readonly tag: number
  readonly type: TiffFieldType
  readonly values: readonly number[]
}

interface TiffFixtureOptions {
  readonly width: number
  readonly height: number
  readonly littleEndian?: boolean
  readonly bitsPerSample: readonly number[]
  readonly compression: number
  readonly photometric: number
  readonly strips: readonly Uint8Array[]
  readonly rowsPerStrip?: number
  readonly planarConfiguration?: 1 | 2
  readonly predictor?: 1 | 2
  readonly extraSamples?: readonly number[]
  readonly colorMap?: readonly number[]
  readonly orientation?: number
  readonly iccProfile?: Uint8Array
}

const typeBytes = (type: TiffFieldType): number => (type === 3 ? 2 : type === 4 ? 4 : 1)

const tiffFixture = (options: TiffFixtureOptions): Uint8Array<ArrayBuffer> => {
  const littleEndian = options.littleEndian ?? true
  const samples = options.bitsPerSample.length
  const rowsPerStrip = options.rowsPerStrip ?? options.height
  const entries = (stripOffsets: readonly number[]): TiffEntryFixture[] => {
    const values: TiffEntryFixture[] = [
      { tag: 256, type: 4, values: [options.width] },
      { tag: 257, type: 4, values: [options.height] },
      { tag: 258, type: 3, values: options.bitsPerSample },
      { tag: 259, type: 3, values: [options.compression] },
      { tag: 262, type: 3, values: [options.photometric] },
      { tag: 273, type: 4, values: stripOffsets },
      ...(options.orientation
        ? [{ tag: 274, type: 3 as const, values: [options.orientation] }]
        : []),
      { tag: 277, type: 3, values: [samples] },
      { tag: 278, type: 4, values: [rowsPerStrip] },
      { tag: 279, type: 4, values: options.strips.map((strip) => strip.byteLength) },
      { tag: 284, type: 3, values: [options.planarConfiguration ?? 1] },
      ...(options.predictor ? [{ tag: 317, type: 3 as const, values: [options.predictor] }] : []),
      ...(options.colorMap ? [{ tag: 320, type: 3 as const, values: options.colorMap }] : []),
      ...(options.extraSamples
        ? [{ tag: 338, type: 3 as const, values: options.extraSamples }]
        : []),
      ...(options.iccProfile
        ? [{ tag: 34675, type: 7 as const, values: Array.from(options.iccProfile) }]
        : []),
    ]
    return values.sort((left, right) => left.tag - right.tag)
  }

  const placeholderEntries = entries(options.strips.map(() => 0))
  const ifdBytes = 2 + placeholderEntries.length * 12 + 4
  const externalBytes = placeholderEntries.reduce((total, entry) => {
    const bytes = entry.values.length * typeBytes(entry.type)
    return total + (bytes > 4 ? bytes : 0)
  }, 0)
  const pixelOffset = 8 + ifdBytes + externalBytes
  const stripOffsets: number[] = []
  let nextStripOffset = pixelOffset
  for (const strip of options.strips) {
    stripOffsets.push(nextStripOffset)
    nextStripOffset += strip.byteLength
  }

  const finalEntries = entries(stripOffsets)
  const output = new Uint8Array(nextStripOffset)
  const view = new DataView(output.buffer)
  output.set(littleEndian ? [0x49, 0x49] : [0x4d, 0x4d])
  view.setUint16(2, 42, littleEndian)
  view.setUint32(4, 8, littleEndian)
  view.setUint16(8, finalEntries.length, littleEndian)
  let externalOffset = 8 + ifdBytes

  for (let index = 0; index < finalEntries.length; index += 1) {
    const entry = finalEntries[index]
    if (!entry) continue
    const entryOffset = 10 + index * 12
    view.setUint16(entryOffset, entry.tag, littleEndian)
    view.setUint16(entryOffset + 2, entry.type, littleEndian)
    view.setUint32(entryOffset + 4, entry.values.length, littleEndian)
    const byteLength = entry.values.length * typeBytes(entry.type)
    const valuesOffset = byteLength > 4 ? externalOffset : entryOffset + 8
    if (byteLength > 4) {
      view.setUint32(entryOffset + 8, externalOffset, littleEndian)
      externalOffset += byteLength
    }
    for (let valueIndex = 0; valueIndex < entry.values.length; valueIndex += 1) {
      const offset = valuesOffset + valueIndex * typeBytes(entry.type)
      const value = entry.values[valueIndex] ?? 0
      if (entry.type === 3) view.setUint16(offset, value, littleEndian)
      else if (entry.type === 4) view.setUint32(offset, value, littleEndian)
      else output[offset] = value
    }
  }
  view.setUint32(10 + finalEntries.length * 12, 0, littleEndian)
  for (let index = 0; index < options.strips.length; index += 1) {
    output.set(options.strips[index] ?? new Uint8Array(), stripOffsets[index] ?? 0)
  }
  return output
}

const packNineBitCodes = (codes: readonly number[]): Uint8Array => {
  const output = new Uint8Array(Math.ceil((codes.length * 9) / 8))
  let bitOffset = 0
  for (const code of codes) {
    for (let bit = 8; bit >= 0; bit -= 1) {
      if ((code & (1 << bit)) !== 0) {
        const byte = bitOffset >>> 3
        output[byte] = (output[byte] ?? 0) | (1 << (7 - (bitOffset & 7)))
      }
      bitOffset += 1
    }
  }
  return output
}

const decodedPng = async (input: Uint8Array): Promise<PNG> => {
  const output = await (await Image.open(input)).png().toBuffer()
  return PNG.sync.read(output)
}

const appendEmptyIfd = (input: Uint8Array, littleEndian: boolean): Uint8Array => {
  const output = new Uint8Array(input.byteLength + 6)
  output.set(input)
  const view = new DataView(output.buffer)
  const entryCount = view.getUint16(8, littleEndian)
  view.setUint32(10 + entryCount * 12, input.byteLength, littleEndian)
  view.setUint16(input.byteLength, 0, littleEndian)
  view.setUint32(input.byteLength + 2, 0, littleEndian)
  return output
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

describe('TIFF codec', () => {
  it('converts TIFF InterColorProfile tag 34675 to sRGB', async () => {
    const input = tiffFixture({
      width: 2,
      height: 1,
      bitsPerSample: [8, 8, 8],
      compression: 1,
      photometric: 2,
      iccProfile: channelSwappingRgbProfile(),
      strips: [Uint8Array.of(10, 20, 30, 90, 110, 130)],
    })
    const decoded = await decodedPng(input)

    expect(pixel(decoded, 0, 0)).toEqual([30, 20, 10, 255])
    expect(pixel(decoded, 1, 0)).toEqual([130, 110, 90, 255])
  })

  it('rejects corrupt and non-UNDEFINED TIFF ICC profile tags', async () => {
    const corrupt = tiffFixture({
      width: 1,
      height: 1,
      bitsPerSample: [8, 8, 8],
      compression: 1,
      photometric: 2,
      iccProfile: Uint8Array.of(1, 2, 3),
      strips: [Uint8Array.of(10, 20, 30)],
    })
    const wrongType = Uint8Array.from(
      tiffFixture({
        width: 1,
        height: 1,
        bitsPerSample: [8, 8, 8],
        compression: 1,
        photometric: 2,
        iccProfile: channelSwappingRgbProfile(),
        strips: [Uint8Array.of(10, 20, 30)],
      }),
    )
    const view = new DataView(wrongType.buffer)
    const entryCount = view.getUint16(8, true)
    for (let index = 0; index < entryCount; index += 1) {
      const offset = 10 + index * 12
      if (view.getUint16(offset, true) === 34675) view.setUint16(offset + 2, 1, true)
    }

    await expect((await Image.open(corrupt)).metadata()).rejects.toMatchObject({
      code: 'TRUNCATED_INPUT',
    })
    await expect((await Image.open(wrongType)).metadata()).rejects.toMatchObject({
      code: 'INVALID_INPUT',
      message: 'TIFF tag 34675 must use the UNDEFINED field type',
    })
  })

  it('reads big-endian metadata and decodes RGB strips and regions', async () => {
    const firstPage = tiffFixture({
      width: 2,
      height: 2,
      littleEndian: false,
      orientation: 6,
      bitsPerSample: [8, 8, 8],
      compression: 1,
      photometric: 2,
      strips: [Uint8Array.from([255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255])],
    })
    const input = appendEmptyIfd(firstPage, false)
    const image = await Image.open(input)

    await expect(image.metadata()).resolves.toMatchObject({
      format: 'tiff',
      mimeType: 'image/tiff',
      width: 2,
      height: 2,
      bitDepth: 8,
      hasAlpha: false,
      frames: 2,
      orientation: 6,
    })
    const decoded = await decodedPng(input)
    expect(pixel(decoded, 0, 0)).toEqual([255, 0, 0, 255])
    expect(pixel(decoded, 1, 0)).toEqual([0, 255, 0, 255])
    expect(pixel(decoded, 0, 1)).toEqual([0, 0, 255, 255])

    const cropped = PNG.sync.read(
      await image.crop({ x: 1, y: 0, width: 1, height: 2 }).png().toBuffer(),
    )
    expect(pixel(cropped, 0, 0)).toEqual([0, 255, 0, 255])
    expect(pixel(cropped, 0, 1)).toEqual([255, 255, 255, 255])
  })

  it('decodes packed grayscale and palette sample depths', async () => {
    const grayscale = tiffFixture({
      width: 4,
      height: 1,
      bitsPerSample: [2],
      compression: 1,
      photometric: 1,
      strips: [Uint8Array.of(0x1b)],
    })
    const colorMap = new Array<number>(16 * 3).fill(0)
    colorMap[1] = 0xffff
    colorMap[16 + 2] = 0xffff
    const palette = tiffFixture({
      width: 2,
      height: 1,
      bitsPerSample: [4],
      compression: 1,
      photometric: 3,
      colorMap,
      strips: [Uint8Array.of(0x12)],
    })

    const grayPixels = await decodedPng(grayscale)
    expect(pixel(grayPixels, 0, 0)).toEqual([0, 0, 0, 255])
    expect(pixel(grayPixels, 1, 0)).toEqual([85, 85, 85, 255])
    expect(pixel(grayPixels, 2, 0)).toEqual([170, 170, 170, 255])
    expect(pixel(grayPixels, 3, 0)).toEqual([255, 255, 255, 255])
    const palettePixels = await decodedPng(palette)
    expect(pixel(palettePixels, 0, 0)).toEqual([255, 0, 0, 255])
    expect(pixel(palettePixels, 1, 0)).toEqual([0, 255, 0, 255])
  })

  it('decodes PackBits planar grayscale with associated alpha', async () => {
    const input = tiffFixture({
      width: 2,
      height: 1,
      bitsPerSample: [8, 8],
      compression: 32773,
      photometric: 1,
      planarConfiguration: 2,
      extraSamples: [1],
      strips: [Uint8Array.from([1, 0, 50]), Uint8Array.from([1, 0, 128])],
    })
    const decoded = await decodedPng(input)

    expect(pixel(decoded, 0, 0)).toEqual([0, 0, 0, 0])
    expect(pixel(decoded, 1, 0)).toEqual([100, 100, 100, 128])
  })

  it('decodes LZW and Deflate with horizontal prediction', async () => {
    const lzw = tiffFixture({
      width: 3,
      height: 1,
      bitsPerSample: [8],
      compression: 5,
      photometric: 1,
      strips: [packNineBitCodes([256, 10, 20, 30, 257])],
    })
    const predicted = Uint8Array.from([10, 10, 15])
    const deflate = tiffFixture({
      width: 3,
      height: 1,
      bitsPerSample: [8],
      compression: 8,
      photometric: 1,
      predictor: 2,
      strips: [deflateSync(predicted)],
    })

    const lzwPixels = await decodedPng(lzw)
    expect(pixel(lzwPixels, 0, 0)).toEqual([10, 10, 10, 255])
    expect(pixel(lzwPixels, 2, 0)).toEqual([30, 30, 30, 255])
    const deflatePixels = await decodedPng(deflate)
    expect(pixel(deflatePixels, 0, 0)).toEqual([10, 10, 10, 255])
    expect(pixel(deflatePixels, 1, 0)).toEqual([20, 20, 20, 255])
    expect(pixel(deflatePixels, 2, 0)).toEqual([35, 35, 35, 255])
  })

  it('encodes streaming grayscale, RGB, and RGBA TIFF output', async () => {
    const source = new PNG({ width: 2, height: 1 })
    source.data.set([10, 20, 30, 255, 70, 80, 90, 0])
    const png = PNG.sync.write(source)

    const rgba = await (await Image.open(png)).tiff().toBuffer()
    expect(rgba.subarray(0, 4)).toEqual(Buffer.from([0x49, 0x49, 0x2a, 0]))
    await expect((await Image.open(rgba)).metadata()).resolves.toMatchObject({
      format: 'tiff',
      width: 2,
      height: 1,
      hasAlpha: true,
    })
    const roundTrip = await decodedPng(rgba)
    expect(pixel(roundTrip, 0, 0)).toEqual([10, 20, 30, 255])
    expect(pixel(roundTrip, 1, 0)).toEqual([70, 80, 90, 0])

    const viaEncode = await (await Image.open(png)).encode('tiff').toBuffer()
    expect(viaEncode).toEqual(rgba)

    const graySource = tiffFixture({
      width: 2,
      height: 1,
      bitsPerSample: [8],
      compression: 1,
      photometric: 1,
      strips: [Uint8Array.from([25, 200])],
    })
    const grayRoundTrip = await decodedPng(await (await Image.open(graySource)).tiff().toBuffer())
    expect(pixel(grayRoundTrip, 0, 0)).toEqual([25, 25, 25, 255])
    expect(pixel(grayRoundTrip, 1, 0)).toEqual([200, 200, 200, 255])

    const rgbSource = tiffFixture({
      width: 1,
      height: 1,
      bitsPerSample: [8, 8, 8],
      compression: 1,
      photometric: 2,
      strips: [Uint8Array.from([12, 34, 56])],
    })
    const rgbRoundTrip = await decodedPng(await (await Image.open(rgbSource)).tiff().toBuffer())
    expect(pixel(rgbRoundTrip, 0, 0)).toEqual([12, 34, 56, 255])
  })

  it('rejects invalid IFDs, truncated strips, unsupported compression, and expansion overruns', async () => {
    const invalidIfd = Uint8Array.from([0x49, 0x49, 0x2a, 0, 0xf0, 0xff, 0xff, 0xff])
    await expect((await Image.open(invalidIfd)).metadata()).rejects.toMatchObject({
      code: 'TRUNCATED_INPUT',
    })

    const unsupported = tiffFixture({
      width: 1,
      height: 1,
      bitsPerSample: [8],
      compression: 4,
      photometric: 1,
      strips: [Uint8Array.of(0)],
    })
    await expect((await Image.open(unsupported)).png().toBuffer()).rejects.toMatchObject({
      code: 'UNSUPPORTED_OPERATION',
    })

    const overrun = tiffFixture({
      width: 2,
      height: 1,
      bitsPerSample: [8],
      compression: 32773,
      photometric: 1,
      strips: [Uint8Array.from([2, 1, 2, 3])],
    })
    await expect((await Image.open(overrun)).png().toBuffer()).rejects.toMatchObject({
      code: 'TRUNCATED_INPUT',
    })

    const truncated = tiffFixture({
      width: 1,
      height: 1,
      bitsPerSample: [8],
      compression: 1,
      photometric: 1,
      strips: [Uint8Array.of(10)],
    }).subarray(0, -1)
    await expect((await Image.open(truncated)).png().toBuffer()).rejects.toMatchObject({
      code: 'TRUNCATED_INPUT',
    })
  })
})
