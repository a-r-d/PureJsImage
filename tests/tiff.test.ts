import { deflateSync } from 'node:zlib'
import jpeg from 'jpeg-js'
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
  readonly tileWidth?: number
  readonly tileHeight?: number
  readonly rowsPerStrip?: number
  readonly fillOrder?: 1 | 2
  readonly planarConfiguration?: 1 | 2
  readonly predictor?: 1 | 2
  readonly t6Options?: number
  readonly t4Options?: number
  readonly extraSamples?: readonly number[]
  readonly colorMap?: readonly number[]
  readonly orientation?: number
  readonly iccProfile?: Uint8Array
  readonly jpegInterchange?: Uint8Array
  readonly extraEntries?: readonly TiffEntryFixture[]
  readonly pointedEntries?: readonly {
    readonly tag: number
    readonly tables: readonly Uint8Array[]
  }[]
}

const typeBytes = (type: TiffFieldType): number => (type === 3 ? 2 : type === 4 ? 4 : 1)

const tiffFixture = (options: TiffFixtureOptions): Uint8Array<ArrayBuffer> => {
  const littleEndian = options.littleEndian ?? true
  const samples = options.bitsPerSample.length
  const rowsPerStrip = options.rowsPerStrip ?? options.height
  const tiled = options.tileWidth !== undefined || options.tileHeight !== undefined
  if (tiled && (options.tileWidth === undefined || options.tileHeight === undefined)) {
    throw new Error('Both tile dimensions are required')
  }
  const entries = (
    stripOffsets: readonly number[],
    jpegInterchangeOffset: number,
    pointedOffsets: ReadonlyMap<number, readonly number[]>,
  ): TiffEntryFixture[] => {
    const values: TiffEntryFixture[] = [
      { tag: 256, type: 4, values: [options.width] },
      { tag: 257, type: 4, values: [options.height] },
      { tag: 258, type: 3, values: options.bitsPerSample },
      { tag: 259, type: 3, values: [options.compression] },
      { tag: 262, type: 3, values: [options.photometric] },
      ...(options.fillOrder ? [{ tag: 266, type: 3 as const, values: [options.fillOrder] }] : []),
      ...(tiled || options.strips.length === 0
        ? []
        : [{ tag: 273, type: 4 as const, values: stripOffsets }]),
      ...(options.orientation
        ? [{ tag: 274, type: 3 as const, values: [options.orientation] }]
        : []),
      { tag: 277, type: 3, values: [samples] },
      ...(tiled || options.strips.length === 0
        ? []
        : [{ tag: 278, type: 4 as const, values: [rowsPerStrip] }]),
      ...(tiled || options.strips.length === 0
        ? []
        : [
            {
              tag: 279,
              type: 4 as const,
              values: options.strips.map((strip) => strip.byteLength),
            },
          ]),
      { tag: 284, type: 3, values: [options.planarConfiguration ?? 1] },
      ...(options.jpegInterchange
        ? [
            { tag: 513, type: 4 as const, values: [jpegInterchangeOffset] },
            { tag: 514, type: 4 as const, values: [options.jpegInterchange.byteLength] },
          ]
        : []),
      ...(options.t4Options === undefined
        ? []
        : [{ tag: 292, type: 4 as const, values: [options.t4Options] }]),
      ...(options.t6Options === undefined
        ? []
        : [{ tag: 293, type: 4 as const, values: [options.t6Options] }]),
      ...(options.predictor ? [{ tag: 317, type: 3 as const, values: [options.predictor] }] : []),
      ...(options.colorMap ? [{ tag: 320, type: 3 as const, values: options.colorMap }] : []),
      ...(tiled
        ? [
            { tag: 322, type: 4 as const, values: [options.tileWidth ?? 0] },
            { tag: 323, type: 4 as const, values: [options.tileHeight ?? 0] },
            { tag: 324, type: 4 as const, values: stripOffsets },
            {
              tag: 325,
              type: 4 as const,
              values: options.strips.map((strip) => strip.byteLength),
            },
          ]
        : []),
      ...(options.extraSamples
        ? [{ tag: 338, type: 3 as const, values: options.extraSamples }]
        : []),
      ...(options.iccProfile
        ? [{ tag: 34675, type: 7 as const, values: Array.from(options.iccProfile) }]
        : []),
      ...(options.extraEntries ?? []),
      ...(options.pointedEntries ?? []).map((entry) => ({
        tag: entry.tag,
        type: 4 as const,
        values: pointedOffsets.get(entry.tag) ?? entry.tables.map(() => 0),
      })),
    ]
    return values.sort((left, right) => left.tag - right.tag)
  }

  const placeholderEntries = entries(
    options.strips.map(() => 0),
    0,
    new Map(),
  )
  const ifdBytes = 2 + placeholderEntries.length * 12 + 4
  const externalBytes = placeholderEntries.reduce((total, entry) => {
    const bytes = entry.values.length * typeBytes(entry.type)
    return total + (bytes > 4 ? bytes : 0)
  }, 0)
  let pointedDataOffset = 8 + ifdBytes + externalBytes
  const pointedOffsets = new Map<number, readonly number[]>()
  for (const entry of options.pointedEntries ?? []) {
    const offsets: number[] = []
    for (const table of entry.tables) {
      offsets.push(pointedDataOffset)
      pointedDataOffset += table.byteLength
    }
    pointedOffsets.set(entry.tag, offsets)
  }
  const pixelOffset = pointedDataOffset
  const stripOffsets: number[] = []
  let nextStripOffset = pixelOffset
  for (const strip of options.strips) {
    stripOffsets.push(nextStripOffset)
    nextStripOffset += strip.byteLength
  }
  const jpegInterchangeOffset = nextStripOffset
  const outputBytes = nextStripOffset + (options.jpegInterchange?.byteLength ?? 0)

  const finalEntries = entries(stripOffsets, jpegInterchangeOffset, pointedOffsets)
  const output = new Uint8Array(outputBytes)
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
  for (const entry of options.pointedEntries ?? []) {
    const offsets = pointedOffsets.get(entry.tag) ?? []
    for (let index = 0; index < entry.tables.length; index += 1) {
      output.set(entry.tables[index] ?? new Uint8Array(), offsets[index] ?? 0)
    }
  }
  for (let index = 0; index < options.strips.length; index += 1) {
    output.set(options.strips[index] ?? new Uint8Array(), stripOffsets[index] ?? 0)
  }
  if (options.jpegInterchange) output.set(options.jpegInterchange, jpegInterchangeOffset)
  return output
}

const bigTiffRgbFixture = (): Uint8Array<ArrayBuffer> => {
  const entries = [
    [256, 4, 1, 2],
    [257, 4, 1, 1],
    [258, 3, 3, 0x0008_0008_0008],
    [259, 3, 1, 1],
    [262, 3, 1, 2],
    [273, 16, 1, 0],
    [277, 3, 1, 3],
    [278, 4, 1, 1],
    [279, 16, 1, 6],
    [284, 3, 1, 1],
  ] as const
  const pixelOffset = 16 + 8 + entries.length * 20 + 8
  const output = new Uint8Array(pixelOffset + 6)
  const view = new DataView(output.buffer)
  output.set([0x49, 0x49, 0x2b, 0])
  view.setUint16(4, 8, true)
  view.setBigUint64(8, 16n, true)
  view.setBigUint64(16, BigInt(entries.length), true)
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index]
    if (!entry) continue
    const offset = 24 + index * 20
    view.setUint16(offset, entry[0], true)
    view.setUint16(offset + 2, entry[1], true)
    view.setBigUint64(offset + 4, BigInt(entry[2]), true)
    view.setBigUint64(offset + 12, BigInt(entry[0] === 273 ? pixelOffset : entry[3]), true)
  }
  output.set([10, 20, 30, 200, 150, 100], pixelOffset)
  return output
}

const packedFaxBits = (bits: string): Uint8Array => {
  const output = new Uint8Array(Math.ceil(bits.length / 8))
  for (let index = 0; index < bits.length; index += 1) {
    if (bits[index] === '1') {
      const byte = index >>> 3
      output[byte] = (output[byte] ?? 0) | (1 << (7 - (index & 7)))
    }
  }
  return output
}

const splitJpegTables = (
  input: Uint8Array,
): { readonly image: Uint8Array; readonly tables: Uint8Array } => {
  const image: number[] = [0xff, 0xd8]
  const tables: number[] = [0xff, 0xd8]
  let offset = 2
  while (offset + 4 <= input.byteLength) {
    const marker = input[offset + 1]
    if (input[offset] !== 0xff || marker === undefined) throw new Error('Invalid JPEG fixture')
    if (marker === 0xda) {
      image.push(...input.subarray(offset))
      tables.push(0xff, 0xd9)
      return { image: Uint8Array.from(image), tables: Uint8Array.from(tables) }
    }
    const length = ((input[offset + 2] ?? 0) << 8) | (input[offset + 3] ?? 0)
    const end = offset + length + 2
    if (length < 2 || end > input.byteLength) throw new Error('Invalid JPEG fixture marker')
    const target = marker === 0xdb || marker === 0xc4 || marker === 0xdd ? tables : image
    target.push(...input.subarray(offset, end))
    offset = end
  }
  throw new Error('JPEG fixture has no scan')
}

interface OldJpegFixtureParts {
  readonly entropy: Uint8Array
  readonly quantizationTables: readonly Uint8Array[]
  readonly dcTables: readonly Uint8Array[]
  readonly acTables: readonly Uint8Array[]
  readonly horizontalSubsampling: number
  readonly verticalSubsampling: number
  readonly scan: Uint8Array
}

const oldJpegFixtureParts = (input: Uint8Array): OldJpegFixtureParts => {
  const quantization = new Map<number, Uint8Array>()
  const dc = new Map<number, Uint8Array>()
  const ac = new Map<number, Uint8Array>()
  const componentIds: number[] = []
  const tableSelectors: number[] = []
  const horizontalSampling: number[] = []
  const verticalSampling: number[] = []
  const scanSelectors = new Map<number, number>()
  let entropy: Uint8Array | undefined
  let scan: Uint8Array | undefined
  let offset = 2
  while (offset + 4 <= input.byteLength) {
    const marker = input[offset + 1]
    if (input[offset] !== 0xff || marker === undefined) throw new Error('Invalid JPEG fixture')
    const length = ((input[offset + 2] ?? 0) << 8) | (input[offset + 3] ?? 0)
    const start = offset + 4
    const end = offset + length + 2
    if (length < 2 || end > input.byteLength) throw new Error('Invalid JPEG fixture marker')
    if (marker === 0xdb) {
      let position = start
      while (position < end) {
        const selector = input[position] ?? 0xff
        if (selector >>> 4 !== 0 || position + 65 > end) {
          throw new Error('Unsupported JPEG fixture quantization table')
        }
        quantization.set(selector & 15, input.slice(position + 1, position + 65))
        position += 65
      }
    } else if (marker === 0xc4) {
      let position = start
      while (position < end) {
        const selector = input[position] ?? 0xff
        let values = 0
        for (let index = 0; index < 16; index += 1) values += input[position + 1 + index] ?? 0
        const tableEnd = position + 17 + values
        if (tableEnd > end) throw new Error('Invalid JPEG fixture Huffman table')
        const table = input.slice(position + 1, tableEnd)
        const tables = selector >>> 4 === 0 ? dc : ac
        tables.set(selector & 15, table)
        position = tableEnd
      }
    } else if (marker === 0xc0) {
      const count = input[start + 5] ?? 0
      for (let index = 0; index < count; index += 1) {
        const component = start + 6 + index * 3
        componentIds.push(input[component] ?? 0)
        const sampling = input[component + 1] ?? 0
        horizontalSampling.push(sampling >>> 4)
        verticalSampling.push(sampling & 15)
        tableSelectors.push(input[component + 2] ?? 0)
      }
    } else if (marker === 0xda) {
      const count = input[start] ?? 0
      for (let index = 0; index < count; index += 1) {
        scanSelectors.set(input[start + 1 + index * 2] ?? 0, input[start + 2 + index * 2] ?? 0)
      }
      const entropyEnd =
        input[input.byteLength - 2] === 0xff && input[input.byteLength - 1] === 0xd9
          ? input.byteLength - 2
          : input.byteLength
      entropy = input.slice(end, entropyEnd)
      scan = input.slice(offset, entropyEnd)
      break
    }
    offset = end
  }
  if (!entropy || !scan || componentIds.length !== 3) throw new Error('Incomplete JPEG fixture')
  const quantizationTables: Uint8Array[] = []
  const dcTables: Uint8Array[] = []
  const acTables: Uint8Array[] = []
  for (let index = 0; index < componentIds.length; index += 1) {
    const scan = scanSelectors.get(componentIds[index] ?? 0) ?? 0
    const quantizationTable = quantization.get(tableSelectors[index] ?? 0)
    const dcTable = dc.get(scan >>> 4)
    const acTable = ac.get(scan & 15)
    if (!quantizationTable || !dcTable || !acTable) throw new Error('JPEG fixture table is missing')
    quantizationTables.push(quantizationTable)
    dcTables.push(dcTable)
    acTables.push(acTable)
  }
  return {
    scan,
    entropy,
    quantizationTables,
    dcTables,
    acTables,
    horizontalSubsampling: horizontalSampling[0] ?? 1,
    verticalSubsampling: verticalSampling[0] ?? 1,
  }
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
const packLegacyLzwLiterals = (values: Uint8Array): Uint8Array => {
  const output = new Uint8Array(Math.ceil(((values.byteLength + 2) * 12) / 8))
  let bitOffset = 0
  let codeWidth = 9
  let nextCode = 258
  let hasPrevious = false
  const writeCode = (code: number): void => {
    for (let bit = 0; bit < codeWidth; bit += 1) {
      if ((code & (1 << bit)) !== 0) {
        const byte = bitOffset >>> 3
        output[byte] = (output[byte] ?? 0) | (1 << (bitOffset & 7))
      }
      bitOffset += 1
    }
  }

  writeCode(256)
  for (const value of values) {
    writeCode(value)
    if (hasPrevious && nextCode < 4096) {
      nextCode += 1
      if (codeWidth < 12 && nextCode === 1 << codeWidth) codeWidth += 1
    }
    hasPrevious = true
  }
  writeCode(257)
  return output.subarray(0, Math.ceil(bitOffset / 8))
}

const decodedPng = async (input: Uint8Array): Promise<PNG> => {
  const output = await (await Image.open(input)).png().toBuffer()
  return PNG.sync.read(output)
}

const reverseByteBits = (input: Uint8Array): Uint8Array => {
  const output = new Uint8Array(input.byteLength)
  for (let index = 0; index < input.byteLength; index += 1) {
    let source = input[index] ?? 0
    let reversed = 0
    for (let bit = 0; bit < 8; bit += 1) {
      reversed = (reversed << 1) | (source & 1)
      source >>>= 1
    }
    output[index] = reversed
  }
  return output
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

const renameClassicTiffTag = (input: Uint8Array, from: number, to: number): void => {
  const view = new DataView(input.buffer, input.byteOffset, input.byteLength)
  const littleEndian = input[0] === 0x49
  const entryCount = view.getUint16(8, littleEndian)
  for (let index = 0; index < entryCount; index += 1) {
    const offset = 10 + index * 12
    if (view.getUint16(offset, littleEndian) === from) {
      view.setUint16(offset, to, littleEndian)
      return
    }
  }
  throw new Error(`TIFF fixture tag ${from} is missing`)
}

const clearClassicTiffTag = (input: Uint8Array, tag: number): void => {
  const view = new DataView(input.buffer, input.byteOffset, input.byteLength)
  const littleEndian = input[0] === 0x49
  const entryCount = view.getUint16(8, littleEndian)
  for (let index = 0; index < entryCount; index += 1) {
    const offset = 10 + index * 12
    if (view.getUint16(offset, littleEndian) === tag) {
      input.fill(0, offset, offset + 12)
      return
    }
  }
  throw new Error(`TIFF fixture tag ${tag} is missing`)
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
    const deflateLastStripPadding = tiffFixture({
      width: 1,
      height: 3,
      bitsPerSample: [8],
      compression: 8,
      photometric: 1,
      rowsPerStrip: 2,
      strips: [deflateSync(Uint8Array.of(1, 2)), deflateSync(Uint8Array.of(3, 99))],
    })

    const lzwPixels = await decodedPng(lzw)
    expect(pixel(lzwPixels, 0, 0)).toEqual([10, 10, 10, 255])
    expect(pixel(lzwPixels, 2, 0)).toEqual([30, 30, 30, 255])
    const deflatePixels = await decodedPng(deflate)
    expect(pixel(deflatePixels, 0, 0)).toEqual([10, 10, 10, 255])
    expect(pixel(deflatePixels, 1, 0)).toEqual([20, 20, 20, 255])
    expect(pixel(deflatePixels, 2, 0)).toEqual([35, 35, 35, 255])
    const paddedPixels = await decodedPng(deflateLastStripPadding)
    expect(pixel(paddedPixels, 0, 2)).toEqual([3, 3, 3, 255])
  })

  it('decodes padded tiles and crops edge tiles to the image dimensions', async () => {
    const input = tiffFixture({
      width: 3,
      height: 3,
      bitsPerSample: [8, 8, 8],
      compression: 1,
      photometric: 2,
      tileWidth: 2,
      tileHeight: 2,
      strips: [
        Uint8Array.from([255, 0, 0, 0, 255, 0, 255, 255, 0, 0, 255, 255]),
        Uint8Array.from([0, 0, 255, 1, 2, 3, 255, 0, 255, 4, 5, 6]),
        Uint8Array.from([255, 255, 255, 0, 0, 0, 7, 8, 9, 10, 11, 12]),
        Uint8Array.from([127, 127, 127, 13, 14, 15, 16, 17, 18, 19, 20, 21]),
      ],
    })
    const decoded = await decodedPng(input)

    expect(pixel(decoded, 0, 0)).toEqual([255, 0, 0, 255])
    expect(pixel(decoded, 2, 0)).toEqual([0, 0, 255, 255])
    expect(pixel(decoded, 1, 1)).toEqual([0, 255, 255, 255])
    expect(pixel(decoded, 0, 2)).toEqual([255, 255, 255, 255])
    expect(pixel(decoded, 2, 2)).toEqual([127, 127, 127, 255])
  })

  it('accepts legacy tiled TIFFs that store tile tables in strip tags', async () => {
    const input = tiffFixture({
      width: 3,
      height: 1,
      bitsPerSample: [8],
      compression: 1,
      photometric: 1,
      tileWidth: 2,
      tileHeight: 1,
      strips: [Uint8Array.of(10, 20), Uint8Array.of(30, 99)],
    })
    renameClassicTiffTag(input, 324, 273)
    renameClassicTiffTag(input, 325, 279)

    const decoded = await decodedPng(input)
    expect(pixel(decoded, 0, 0)).toEqual([10, 10, 10, 255])
    expect(pixel(decoded, 1, 0)).toEqual([20, 20, 20, 255])
    expect(pixel(decoded, 2, 0)).toEqual([30, 30, 30, 255])
  })

  it('decodes 16-bit RGB in both byte orders and BigTIFF 64-bit offsets', async () => {
    const rgb16 = tiffFixture({
      width: 2,
      height: 1,
      littleEndian: false,
      bitsPerSample: [16, 16, 16],
      compression: 1,
      photometric: 2,
      strips: [Uint8Array.from([0, 0, 0x80, 0, 0xff, 0xff, 0xff, 0xff, 0, 0, 1, 1])],
    })
    const decoded16 = await decodedPng(rgb16)
    const bigTiffInput = bigTiffRgbFixture()
    bigTiffInput[63] = 0xff
    const bigTiff = await decodedPng(bigTiffInput)

    expect(pixel(decoded16, 0, 0)).toEqual([0, 128, 255, 255])
    expect(pixel(decoded16, 1, 0)).toEqual([255, 0, 1, 255])
    expect(pixel(bigTiff, 0, 0)).toEqual([10, 20, 30, 255])
    expect(pixel(bigTiff, 1, 0)).toEqual([200, 150, 100, 255])
  })
  it('decodes legacy LSB-packed TIFF LZW through its late code-width transition', async () => {
    const values = Uint8Array.from({ length: 300 }, (_, index) => index & 0xff)
    const input = tiffFixture({
      width: values.byteLength,
      height: 1,
      bitsPerSample: [8],
      compression: 5,
      photometric: 1,
      strips: [packLegacyLzwLiterals(values)],
    })

    const decoded = await decodedPng(input)
    expect(pixel(decoded, 0, 0)).toEqual([0, 0, 0, 255])
    expect(pixel(decoded, 255, 0)).toEqual([255, 255, 255, 255])
    expect(pixel(decoded, 299, 0)).toEqual([43, 43, 43, 255])
  })

  it('decodes independently encoded tiled LZW and BigTIFF files', async () => {
    // ImageMagick 7.1.2/libtiff 4.7 encoded both fixtures; TIFF64 emits BigTIFF.
    const bigTiff = Buffer.from(
      'SUkrAAgAAAAeAAAAAAAAAIAFBQPABBYNAoJBoLAQEAAAAAAAAAAAAQMAAQAAAAAAAAADAAAAAAAAAAEBAwABAAAAAAAAAAIAAAAAAAAAAgEDAAMAAAAAAAAACAAIAAgAAAADAQMAAQAAAAAAAAAFAAAAAAAAAAYBAwABAAAAAAAAAAIAAAAAAAAACgEDAAEAAAAAAAAAAQAAAAAAAAARARAAAQAAAAAAAAAQAAAAAAAAABIBAwABAAAAAAAAAAEAAAAAAAAAFQEDAAEAAAAAAAAAAwAAAAAAAAAWAQMAAQAAAAAAAAACAAAAAAAAABcBEAABAAAAAAAAAA4AAAAAAAAAHAEDAAEAAAAAAAAAAQAAAAAAAAApAQMAAgAAAAAAAAAAAAEAAAAAAD0BAwABAAAAAAAAAAIAAAAAAAAAPgEFAAIAAAAAAAAAngEAAAAAAAA/AQUABgAAAAAAAABuAQAAAAAAAAAAAAAAAAAAhetRAAAAgADD9agAAAAAAs3MTAAAAAABzcxMAAAAgADNzEwAAAAAAo/C9QAAAAAQNxqgAAAAAAIrhwoAAAAgAA==',
      'base64',
    )
    const tiled = Buffer.from(
      'SUkqAFIBAACABMrpsAQWDQeCu0Uqo0FMkAkWnMfkU0COHxE3xR5xc5p8jGhhkeIHNAJA3QiUABAPB6w0VSMXx8ZyKIl+PgOaHNHkc0NMjSN3MohSmEBJjAU0EOfxEnzwJ0s5n+eOOoK8kGhZkWRlCroOtREH1cp1+JVcR2Q31d52RPkmQESRs+3JO4RE4W4x3U5i+3DO9F+3AO9I8lT0hyNf4VR4eIu/CnPGHNIFmkjSRk/KBPLRE/5Rx5s5q8tVgZyNv6NB6WwaMp6o5rDRiPXG/RvPXJ8tyAZXHcpPdxEP4Uh5En4UJ5F4YVx5FXkusEKRv/cmPfnNv85B9CIo+id3vQcqFIpgBWqxVgBgkpsn9GoFgipT9/5fP6fX6eHx+XziEltkPkY9z4PtAcCQK7r8PI8wAEC/pfwA974wNCUJvrBD9AAcL+i/B8BQpDz6oCARAAABAwABAAAABQAAAAEBAwABAAAAAwAAAAIBAwADAAAAJAIAAAMBAwABAAAABQAAAAYBAwABAAAAAgAAAAoBAwABAAAAAQAAABIBAwABAAAAAQAAABUBAwABAAAAAwAAABwBAwABAAAAAQAAACkBAwACAAAAAAABAD0BAwABAAAAAgAAAD4BBQACAAAAWgIAAD8BBQAGAAAAKgIAAEIBAwABAAAAEAAAAEMBAwABAAAAEAAAAEQBBAABAAAACAAAAEUBBAABAAAASgEAAAAAAAAIAAgACACF61EAAACAAMP1qAAAAAACzcxMAAAAAAHNzEwAAACAAM3MTAAAAAACj8L1AAAAABA3GqAAAAAAAiuHCgAAACAA',
      'base64',
    )
    const bigPixels = await decodedPng(bigTiff)
    const tilePixels = await decodedPng(tiled)

    expect(pixel(bigPixels, 2, 1)).toEqual([20, 40, 60, 255])
    expect(pixel(tilePixels, 0, 0)).toEqual([19, 87, 155, 255])
    expect(pixel(tilePixels, 2, 1)).toEqual([128, 144, 110, 255])
    expect(pixel(tilePixels, 4, 2)).toEqual([238, 202, 66, 255])
  })

  it('converts CMYK and subsampled YCbCr samples to RGB', async () => {
    const cmyk = tiffFixture({
      width: 4,
      height: 1,
      bitsPerSample: [8, 8, 8, 8],
      compression: 1,
      photometric: 5,
      strips: [Uint8Array.from([0, 0, 0, 0, 255, 0, 0, 0, 0, 0, 0, 255, 128, 64, 0, 128])],
    })
    const ycbcr = tiffFixture({
      width: 3,
      height: 1,
      bitsPerSample: [8, 8, 8],
      compression: 1,
      photometric: 6,
      extraEntries: [{ tag: 530, type: 3, values: [2, 2] }],
      strips: [Uint8Array.from([76, 76, 76, 76, 85, 255, 29, 29, 29, 29, 255, 107])],
    })
    const cmykPixels = await decodedPng(cmyk)
    const ycbcrPixels = await decodedPng(ycbcr)

    expect(pixel(cmykPixels, 0, 0)).toEqual([255, 255, 255, 255])
    expect(pixel(cmykPixels, 1, 0)).toEqual([0, 255, 255, 255])
    expect(pixel(cmykPixels, 2, 0)).toEqual([0, 0, 0, 255])
    expect(pixel(cmykPixels, 3, 0)).toEqual([63, 95, 127, 255])
    expect(pixel(ycbcrPixels, 0, 0)).toEqual([254, 0, 0, 255])
    expect(pixel(ycbcrPixels, 1, 0)).toEqual([254, 0, 0, 255])
    expect(pixel(ycbcrPixels, 2, 0)).toEqual([0, 0, 254, 255])
  })

  it('accepts bounded LZW padding in the final subsampled YCbCr strip', async () => {
    const firstStrip = Uint8Array.from([10, 20, 30, 40, 128, 128, 50, 60, 70, 80, 128, 128])
    const paddedLastStrip = Uint8Array.from([90, 100, 200, 200, 128, 128, 0, 0, 0, 0, 128, 128])
    const input = tiffFixture({
      width: 2,
      height: 5,
      bitsPerSample: [8, 8, 8],
      compression: 5,
      photometric: 6,
      rowsPerStrip: 4,
      extraEntries: [{ tag: 530, type: 3, values: [2, 2] }],
      strips: [
        packNineBitCodes([256, ...firstStrip, 257]),
        packNineBitCodes([256, ...paddedLastStrip, 257]),
      ],
    })

    const decoded = await decodedPng(input)
    expect(pixel(decoded, 0, 4)).toEqual([90, 90, 90, 255])
    expect(pixel(decoded, 1, 4)).toEqual([100, 100, 100, 255])
  })

  it('matches independently encoded LZW CMYK, YCbCr, and 16-bit RGB fixtures', async () => {
    // ImageMagick 7.1.2/libtiff 4.7 encoded these fixtures independently.
    const cmyk = Buffer.from(
      'SUkqAHAAAACAJgSuxiAAAHA4QaFQuGQ2HQ+IRGJROKRWLACBQSDQiLx2PR+QSGIRmCweEyKUSmVSqSRuTyuYTGZQ+WyaZzecTCaxycz2fR2dy+f0OiQ2g0WkUmj0mmT+l02oTen1GqSup1WsSGAgABEAAAEDAAEAAAAQAAAAAQEDAAEAAAAMAAAAAgEDAAQAAABCAQAAAwEDAAEAAAAFAAAABgEDAAEAAAAFAAAACgEDAAEAAAABAAAAEQEEAAEAAAAIAAAAEgEDAAEAAAABAAAAFQEDAAEAAAAEAAAAFgEDAAEAAAAMAAAAFwEEAAEAAABnAAAAHAEDAAEAAAABAAAAKQEDAAIAAAAAAAEAPQEDAAEAAAACAAAAPgEFAAIAAAB6AQAAPwEFAAYAAABKAQAATAEDAAEAAAABAAAAAAAAABAAEAAQABAAhetRAAAAgADD9agAAAAAAs3MTAAAAAABzcxMAAAAgADNzEwAAAAAAo/C9QAAAAAQNxqgAAAAAAIrhwoAAAAgAA==',
      'base64',
    )
    const rgb16 = Buffer.from(
      'SUkqAJgAAACABIJDQaFYrACEQmFQuGQ2HQ+IRGJRJOCdEkM7F+JxuOR2PRwTD1vFJLmiPyeUSmJK8pDMxLc4yqZTOUjk0Ig4tc9TSeT2JMM+t1APhBz6jUeEk1JjNIBhG0ioT1rqhEJ8cpao1mZGFfN1XFlP1qxSd1NMZL48qix2uOHR0odmppY2y6RF/P5uNxdLq632GwEQAAABAwABAAAAEAAAAAEBAwABAAAADAAAAAIBAwADAAAAXgEAAAMBAwABAAAABQAAAAYBAwABAAAAAgAAAAoBAwABAAAAAQAAABEBBAABAAAACAAAABIBAwABAAAAAQAAABUBAwABAAAAAwAAABYBAwABAAAADAAAABcBBAABAAAAkAAAABwBAwABAAAAAQAAACkBAwACAAAAAAABAD0BAwABAAAAAgAAAD4BBQACAAAAlAEAAD8BBQAGAAAAZAEAAAAAAAAQABAAEACF61EAAACAAMP1qAAAAAACzcxMAAAAAAHNzEwAAACAAM3MTAAAAAACj8L1AAAAABA3GqAAAAAAAiuHCgAAACAA',
      'base64',
    )
    const ycbcr = Buffer.from(
      'SUkqAEwAAACAGhSomBQSBwWEQeFQaGQmGwuHRGIROHxWJRaKReNRmORiPRuPx2QSORSWQyeSSiTSmWSuXSqYS2Yy+ZTWaTeZzmHQEBAAAAEDAAEAAAAQAAAAAQEDAAEAAAAMAAAAAgEDAAMAAAASAQAAAwEDAAEAAAAFAAAABgEDAAEAAAAGAAAACgEDAAEAAAABAAAAEQEEAAEAAAAIAAAAEgEDAAEAAAABAAAAFQEDAAEAAAADAAAAFgEDAAEAAAAMAAAAFwEEAAEAAABEAAAAHAEDAAEAAAABAAAAKQEDAAIAAAAAAAEAPgEFAAIAAABIAQAAPwEFAAYAAAAYAQAAEgIDAAIAAAABAAEAAAAAAAgACAAIAIXrUQAAAIAAw/WoAAAAAALNzEwAAAAAAc3MTAAAAIAAzcxMAAAAAAKPwvUAAAAAEDcaoAAAAAACK4cKAAAAIAA=',
      'base64',
    )
    const cmykPixels = await decodedPng(cmyk)
    const rgb16Pixels = await decodedPng(rgb16)
    const ycbcrPixels = await decodedPng(ycbcr)

    expect(pixel(cmykPixels, 8, 6)).toEqual([122, 33, 143, 255])
    expect(pixel(rgb16Pixels, 0, 0)).toEqual([18, 52, 86, 255])
    expect(pixel(rgb16Pixels, 15, 11)).toEqual([254, 220, 186, 255])
    expect(pixel(ycbcrPixels, 8, 6)).toEqual([117, 85, 170, 255])
  })

  it('decodes complete old-style JPEG and abbreviated new-style JPEG segments', async () => {
    const rgba = Uint8Array.from([
      240, 20, 30, 255, 240, 20, 30, 255, 20, 210, 50, 255, 20, 210, 50, 255, 240, 20, 30, 255, 240,
      20, 30, 255, 20, 210, 50, 255, 20, 210, 50, 255,
    ])
    const encoded = jpeg.encode({ width: 4, height: 2, data: rgba }, 100).data
    const split = splitJpegTables(encoded)
    const oldParts = oldJpegFixtureParts(encoded)
    const oldStyle = tiffFixture({
      width: 4,
      height: 2,
      bitsPerSample: [8, 8, 8],
      compression: 6,
      photometric: 6,
      strips: [],
      jpegInterchange: encoded,
    })
    const newStyle = tiffFixture({
      width: 4,
      height: 2,
      bitsPerSample: [8, 8, 8],
      compression: 7,
      photometric: 6,
      extraEntries: [{ tag: 347, type: 7, values: Array.from(split.tables) }],
      strips: [split.image],
    })
    const oldStyleTables = tiffFixture({
      width: 4,
      height: 2,
      bitsPerSample: [8, 8, 8],
      compression: 6,
      photometric: 6,
      extraEntries: [
        { tag: 512, type: 3, values: [1] },
        {
          tag: 530,
          type: 3,
          values: [oldParts.horizontalSubsampling, oldParts.verticalSubsampling],
        },
      ],
      pointedEntries: [
        { tag: 519, tables: oldParts.quantizationTables },
        { tag: 520, tables: oldParts.dcTables },
        { tag: 521, tables: oldParts.acTables },
      ],
      strips: [oldParts.entropy],
    })
    const oldPixels = await decodedPng(oldStyle)
    const newPixels = await decodedPng(newStyle)
    const tablePixels = await decodedPng(oldStyleTables)

    expect(newPixels.data).toEqual(oldPixels.data)
    expect(tablePixels.data).toEqual(oldPixels.data)
    expect(pixel(newPixels, 0, 0)[0]).toBeGreaterThan(220)
    expect(pixel(newPixels, 2, 0)[1]).toBeGreaterThan(190)
  })

  it('reconstructs legacy old-style JPEG strip boundaries and padded IFDs', async () => {
    const solidRgba = (red: number, green: number, blue: number): Uint8Array => {
      const output = new Uint8Array(4 * 2 * 4)
      for (let offset = 0; offset < output.byteLength; offset += 4) {
        output[offset] = red
        output[offset + 1] = green
        output[offset + 2] = blue
        output[offset + 3] = 255
      }
      return output
    }
    const topJpeg = jpeg.encode({ width: 4, height: 2, data: solidRgba(240, 20, 30) }, 100).data
    const bottomJpeg = jpeg.encode({ width: 4, height: 2, data: solidRgba(20, 40, 230) }, 100).data
    const top = oldJpegFixtureParts(topJpeg)
    const bottom = oldJpegFixtureParts(bottomJpeg)
    const scanOffset = topJpeg.byteLength - top.scan.byteLength - 2
    const commonEntries: readonly TiffEntryFixture[] = [
      { tag: 512, type: 3, values: [1] },
      {
        tag: 530,
        type: 3,
        values: [top.horizontalSubsampling, top.verticalSubsampling],
      },
    ]
    const commonTables = [
      { tag: 519, tables: top.quantizationTables },
      { tag: 520, tables: top.dcTables },
      { tag: 521, tables: top.acTables },
    ]
    const multiStrip = tiffFixture({
      width: 4,
      height: 4,
      bitsPerSample: [8, 8, 8],
      compression: 6,
      photometric: 6,
      rowsPerStrip: 2,
      extraEntries: commonEntries,
      pointedEntries: commonTables,
      strips: [top.scan, bottom.scan],
      jpegInterchange: topJpeg.slice(0, scanOffset),
    })
    const missingRowsPerStrip = tiffFixture({
      width: 4,
      height: 2,
      bitsPerSample: [8, 8, 8],
      compression: 6,
      photometric: 6,
      extraEntries: commonEntries,
      pointedEntries: commonTables,
      strips: [top.entropy],
    })
    clearClassicTiffTag(missingRowsPerStrip, 278)
    clearClassicTiffTag(missingRowsPerStrip, 284)

    const malformedInterchange = Uint8Array.from(topJpeg)
    malformedInterchange[scanOffset + 11] = 0
    malformedInterchange[scanOffset + 12] = 0
    malformedInterchange[scanOffset + 13] = 0
    const malformedScan = tiffFixture({
      width: 4,
      height: 2,
      bitsPerSample: [8, 8, 8],
      compression: 6,
      photometric: 6,
      extraEntries: commonEntries,
      pointedEntries: commonTables,
      strips: [top.entropy],
      jpegInterchange: malformedInterchange,
    })

    const multiPixels = await decodedPng(multiStrip)
    const missingRowsPixels = await decodedPng(missingRowsPerStrip)
    const malformedPixels = await decodedPng(malformedScan)
    const expectedTop = await decodedPng(topJpeg)

    expect(pixel(multiPixels, 0, 0)[0]).toBeGreaterThan(220)
    expect(pixel(multiPixels, 0, 3)[2]).toBeGreaterThan(210)
    expect(missingRowsPixels.data).toEqual(expectedTop.data)
    expect(malformedPixels.data).toEqual(expectedTop.data)
  })

  it('rejects corrupt BigTIFF, tile tables, JPEG tables, and Group 3 data as ImageErrors', async () => {
    const invalidBigTiff = bigTiffRgbFixture()
    new DataView(invalidBigTiff.buffer).setBigUint64(8, BigInt(Number.MAX_SAFE_INTEGER) + 1n, true)

    const incompleteTiles = tiffFixture({
      width: 2,
      height: 2,
      bitsPerSample: [8],
      compression: 1,
      photometric: 1,
      tileWidth: 2,
      tileHeight: 2,
      strips: [Uint8Array.of(1, 2, 3, 4)],
    })
    const oversizedTile = tiffFixture({
      width: 1,
      height: 1,
      bitsPerSample: [8, 8, 8],
      compression: 1,
      photometric: 2,
      tileWidth: 0xffff_ffff,
      tileHeight: 1,
      strips: [Uint8Array.of(1)],
    })
    const tileView = new DataView(incompleteTiles.buffer)
    const tileEntryCount = tileView.getUint16(8, true)
    for (let index = 0; index < tileEntryCount; index += 1) {
      const offset = 10 + index * 12
      if (tileView.getUint16(offset, true) === 325) tileView.setUint16(offset, 326, true)
    }

    const encoded = jpeg.encode(
      { width: 1, height: 1, data: Uint8Array.of(20, 40, 60, 255) },
      90,
    ).data
    const split = splitJpegTables(encoded)
    const invalidJpegTables = tiffFixture({
      width: 1,
      height: 1,
      bitsPerSample: [8, 8, 8],
      compression: 7,
      photometric: 6,
      extraEntries: [{ tag: 347, type: 7, values: [1, 2, 3, 4] }],
      strips: [split.image],
    })
    const invalidGroup3 = tiffFixture({
      width: 8,
      height: 1,
      bitsPerSample: [1],
      compression: 3,
      photometric: 0,
      strips: [Uint8Array.of(0)],
    })

    await expect((await Image.open(invalidBigTiff)).metadata()).rejects.toMatchObject({
      name: 'ImageError',
      code: 'INVALID_INPUT',
    })
    await expect((await Image.open(incompleteTiles)).metadata()).rejects.toMatchObject({
      name: 'ImageError',
      code: 'INVALID_INPUT',
      message: 'TIFF tiled image is missing a required tile tag',
    })
    await expect((await Image.open(oversizedTile)).metadata()).rejects.toMatchObject({
      name: 'ImageError',
      code: 'LIMIT_EXCEEDED',
      message: 'TIFF segment row is too large',
    })
    await expect((await Image.open(invalidJpegTables)).png().toBuffer()).rejects.toMatchObject({
      name: 'ImageError',
      code: 'INVALID_INPUT',
      message: 'TIFF JPEGTables must be bounded by SOI and EOI markers',
    })
    await expect((await Image.open(invalidGroup3)).png().toBuffer()).rejects.toMatchObject({
      name: 'ImageError',
    })
  })

  it('decodes CCITT Modified Huffman and mixed one/two-dimensional Group 3 rows', async () => {
    const modifiedHuffman = tiffFixture({
      width: 8,
      height: 2,
      bitsPerSample: [1],
      compression: 2,
      photometric: 0,
      strips: [Uint8Array.of(0x98, 0x35, 0x14)],
    })
    const group3 = tiffFixture({
      width: 8,
      height: 2,
      bitsPerSample: [1],
      compression: 3,
      photometric: 0,
      t4Options: 1,
      strips: [packedFaxBits(`0000000000011${'10011'}00000000000101`)],
    })
    const modifiedPixels = await decodedPng(modifiedHuffman)
    const group3Pixels = await decodedPng(group3)

    expect(pixel(modifiedPixels, 0, 0)).toEqual([255, 255, 255, 255])
    expect(pixel(modifiedPixels, 7, 0)).toEqual([255, 255, 255, 255])
    expect(pixel(modifiedPixels, 0, 1)).toEqual([0, 0, 0, 255])
    expect(pixel(modifiedPixels, 7, 1)).toEqual([0, 0, 0, 255])
    expect(pixel(group3Pixels, 0, 0)).toEqual([255, 255, 255, 255])
    expect(pixel(group3Pixels, 7, 1)).toEqual([255, 255, 255, 255])
  })

  it('decodes one-dimensional Group 3 rows without EOL markers', async () => {
    const input = tiffFixture({
      width: 8,
      height: 2,
      bitsPerSample: [1],
      compression: 3,
      photometric: 0,
      strips: [packedFaxBits('1001110011')],
    })

    const decoded = await decodedPng(input)
    expect(pixel(decoded, 0, 0)).toEqual([255, 255, 255, 255])
    expect(pixel(decoded, 7, 1)).toEqual([255, 255, 255, 255])
  })

  it('decodes independently encoded CCITT Group 4 fax strips', async () => {
    // ImageMagick 7.1.2/libtiff 4.7 encoded this 1728-pixel-wide bilevel fax fixture.
    const input = Buffer.from(
      'SUkqABgAAACRAGYLRblgEwGv8RgAgAgADQAAAQMAAQAAAMAGAAABAQMAAQAAAAQAAAACAQMAAQAAAAEAAAADAQMAAQAAAAQAAAAGAQMAAQAAAAAAAAAKAQMAAQAAAAEAAAARAQQAAQAAAAgAAAASAQMAAQAAAAEAAAAVAQMAAQAAAAEAAAAWAQMAAQAAAAQAAAAXAQQAAQAAAA8AAAAcAQMAAQAAAAEAAAApAQMAAgAAAAAAAQAAAAAA',
      'base64',
    )
    const image = await Image.open(input)

    await expect(image.metadata()).resolves.toMatchObject({
      format: 'tiff',
      width: 1728,
      height: 4,
      bitDepth: 1,
      hasAlpha: false,
    })
    const decoded = await decodedPng(input)
    expect(pixel(decoded, 700, 0)).toEqual([255, 255, 255, 255])
    expect(pixel(decoded, 19, 1)).toEqual([255, 255, 255, 255])
    expect(pixel(decoded, 20, 1)).toEqual([0, 0, 0, 255])
    expect(pixel(decoded, 400, 1)).toEqual([0, 0, 0, 255])
    expect(pixel(decoded, 401, 2)).toEqual([255, 255, 255, 255])
    expect(pixel(decoded, 699, 2)).toEqual([255, 255, 255, 255])
    expect(pixel(decoded, 700, 2)).toEqual([0, 0, 0, 255])
    expect(pixel(decoded, 1500, 2)).toEqual([0, 0, 0, 255])
    expect(pixel(decoded, 1501, 2)).toEqual([255, 255, 255, 255])
    expect(pixel(decoded, 1200, 3)).toEqual([255, 255, 255, 255])
  })

  it('resets CCITT Group 4 references per strip and honors FillOrder 2', async () => {
    // This four-row strip was independently encoded by ImageMagick/libtiff.
    const strip = Buffer.from('lxecB/wAQAQ=', 'base64')
    const input = tiffFixture({
      width: 32,
      height: 8,
      bitsPerSample: [1],
      compression: 4,
      photometric: 0,
      fillOrder: 2,
      rowsPerStrip: 4,
      strips: [reverseByteBits(strip), reverseByteBits(strip)],
    })
    const decoded = await decodedPng(input)

    for (let row = 0; row < 8; row += 1) {
      const stripRow = row & 3
      for (let x = 0; x < 32; x += 1) {
        const black = (stripRow >= 1 && x >= 2 && x <= 9) || (stripRow >= 2 && x >= 15 && x <= 28)
        expect(pixel(decoded, x, row)).toEqual(black ? [0, 0, 0, 255] : [255, 255, 255, 255])
      }
    }
  })

  it('rejects corrupt and unsupported CCITT Group 4 streams as ImageErrors', async () => {
    const corrupt = tiffFixture({
      width: 8,
      height: 1,
      bitsPerSample: [1],
      compression: 4,
      photometric: 0,
      strips: [Uint8Array.of(0)],
    })
    const unsupportedMode = tiffFixture({
      width: 8,
      height: 1,
      bitsPerSample: [1],
      compression: 4,
      photometric: 0,
      t6Options: 2,
      strips: [Uint8Array.of(0x03, 0x80)],
    })

    await expect((await Image.open(corrupt)).png().toBuffer()).rejects.toMatchObject({
      name: 'ImageError',
      code: 'INVALID_INPUT',
    })
    await expect((await Image.open(unsupportedMode)).png().toBuffer()).rejects.toMatchObject({
      name: 'ImageError',
      code: 'UNSUPPORTED_OPERATION',
      message: 'TIFF CCITT Group 4 uncompressed mode is unsupported',
    })
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
      compression: 999,
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
