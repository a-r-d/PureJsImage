import { deflateSync } from 'node:zlib'
import { PNG } from 'pngjs'
import { describe, expect, it } from 'vitest'

import { pngCodec } from '../src/codec-entries/png.ts'
import { crc32 } from '../src/codecs/crc32.ts'
import { createImageLibrary } from '../src/index.ts'
import { Image } from './image-library.ts'

type PngColorType = 0 | 2 | 3 | 4 | 6

interface PngFormat {
  readonly label: string
  readonly colorType: PngColorType
  readonly bitDepth: 1 | 2 | 4 | 8 | 16
}

interface Adam7Pass {
  readonly startX: number
  readonly startY: number
  readonly stepX: number
  readonly stepY: number
}

interface FixtureOptions {
  readonly width?: number
  readonly height?: number
  readonly interlace?: boolean
  readonly splitIdat?: boolean
  readonly transparency?: Uint8Array
}

const formats: readonly PngFormat[] = [
  { label: 'grayscale 1-bit', colorType: 0, bitDepth: 1 },
  { label: 'grayscale 2-bit', colorType: 0, bitDepth: 2 },
  { label: 'grayscale 4-bit', colorType: 0, bitDepth: 4 },
  { label: 'grayscale 8-bit', colorType: 0, bitDepth: 8 },
  { label: 'grayscale 16-bit', colorType: 0, bitDepth: 16 },
  { label: 'truecolor 8-bit', colorType: 2, bitDepth: 8 },
  { label: 'truecolor 16-bit', colorType: 2, bitDepth: 16 },
  { label: 'indexed 1-bit', colorType: 3, bitDepth: 1 },
  { label: 'indexed 2-bit', colorType: 3, bitDepth: 2 },
  { label: 'indexed 4-bit', colorType: 3, bitDepth: 4 },
  { label: 'indexed 8-bit', colorType: 3, bitDepth: 8 },
  { label: 'grayscale-alpha 8-bit', colorType: 4, bitDepth: 8 },
  { label: 'grayscale-alpha 16-bit', colorType: 4, bitDepth: 16 },
  { label: 'truecolor-alpha 8-bit', colorType: 6, bitDepth: 8 },
  { label: 'truecolor-alpha 16-bit', colorType: 6, bitDepth: 16 },
]

const adam7Passes: readonly Adam7Pass[] = [
  { startX: 0, startY: 0, stepX: 8, stepY: 8 },
  { startX: 4, startY: 0, stepX: 8, stepY: 8 },
  { startX: 0, startY: 4, stepX: 4, stepY: 8 },
  { startX: 2, startY: 0, stepX: 4, stepY: 4 },
  { startX: 0, startY: 2, stepX: 2, stepY: 4 },
  { startX: 1, startY: 0, stepX: 2, stepY: 2 },
  { startX: 0, startY: 1, stepX: 1, stepY: 2 },
]

const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])

const channels = (colorType: PngColorType): number => {
  if (colorType === 0 || colorType === 3) return 1
  if (colorType === 2) return 3
  if (colorType === 4) return 2
  return 4
}

const paletteEntries = (format: PngFormat): number =>
  format.colorType === 3 ? Math.min(4, 1 << format.bitDepth) : 0

const sampleValue = (x: number, y: number, channel: number, format: PngFormat): number => {
  const entries = paletteEntries(format)
  if (entries > 0) return (x * 3 + y * 5) % entries
  const maximum = format.bitDepth === 16 ? 65_535 : (1 << format.bitDepth) - 1
  return (x * 257 + y * 911 + channel * 12_345) % (maximum + 1)
}

const setSample = (row: Uint8Array, index: number, bitDepth: number, value: number): void => {
  if (bitDepth === 16) {
    row[index * 2] = value >>> 8
    row[index * 2 + 1] = value & 0xff
    return
  }
  if (bitDepth === 8) {
    row[index] = value
    return
  }
  const bitOffset = index * bitDepth
  const byteOffset = Math.floor(bitOffset / 8)
  const shift = 8 - bitDepth - (bitOffset % 8)
  row[byteOffset] = (row[byteOffset] ?? 0) | (value << shift)
}

const rawRow = (
  width: number,
  sourceY: number,
  format: PngFormat,
  startX = 0,
  stepX = 1,
): Uint8Array => {
  const channelCount = channels(format.colorType)
  const row = new Uint8Array(Math.ceil((width * channelCount * format.bitDepth) / 8))
  for (let x = 0; x < width; x += 1) {
    const sourceX = startX + x * stepX
    for (let channel = 0; channel < channelCount; channel += 1) {
      setSample(
        row,
        x * channelCount + channel,
        format.bitDepth,
        sampleValue(sourceX, sourceY, channel, format),
      )
    }
  }
  return row
}

const paeth = (left: number, above: number, upperLeft: number): number => {
  const prediction = left + above - upperLeft
  const leftDistance = Math.abs(prediction - left)
  const aboveDistance = Math.abs(prediction - above)
  const upperLeftDistance = Math.abs(prediction - upperLeft)
  if (leftDistance <= aboveDistance && leftDistance <= upperLeftDistance) return left
  return aboveDistance <= upperLeftDistance ? above : upperLeft
}

const filteredRow = (
  row: Uint8Array,
  previous: Uint8Array,
  bytesPerPixel: number,
  filter: number,
): Uint8Array => {
  const output = new Uint8Array(row.byteLength + 1)
  output[0] = filter
  for (let index = 0; index < row.byteLength; index += 1) {
    const value = row[index] ?? 0
    const left = index >= bytesPerPixel ? (row[index - bytesPerPixel] ?? 0) : 0
    const above = previous[index] ?? 0
    const upperLeft = index >= bytesPerPixel ? (previous[index - bytesPerPixel] ?? 0) : 0
    let predictor = 0
    if (filter === 1) predictor = left
    else if (filter === 2) predictor = above
    else if (filter === 3) predictor = Math.floor((left + above) / 2)
    else if (filter === 4) predictor = paeth(left, above, upperLeft)
    output[index + 1] = (value - predictor) & 0xff
  }
  return output
}

const passLength = (size: number, start: number, step: number): number =>
  start >= size ? 0 : Math.floor((size - start + step - 1) / step)

const imageData = (
  width: number,
  height: number,
  format: PngFormat,
  interlace: boolean,
): Buffer => {
  const scanlines: Uint8Array[] = []
  const bytesPerPixel = Math.max(1, Math.ceil((channels(format.colorType) * format.bitDepth) / 8))
  let filter = 0
  const passes = interlace
    ? adam7Passes
    : [{ startX: 0, startY: 0, stepX: 1, stepY: 1 } satisfies Adam7Pass]
  for (const pass of passes) {
    const passWidth = passLength(width, pass.startX, pass.stepX)
    const passHeight = passLength(height, pass.startY, pass.stepY)
    if (passWidth === 0 || passHeight === 0) continue
    let previous: Uint8Array = new Uint8Array(
      Math.ceil((passWidth * channels(format.colorType) * format.bitDepth) / 8),
    )
    for (let y = 0; y < passHeight; y += 1) {
      const row = rawRow(passWidth, pass.startY + y * pass.stepY, format, pass.startX, pass.stepX)
      scanlines.push(filteredRow(row, previous, bytesPerPixel, filter % 5))
      previous = row
      filter += 1
    }
  }
  return Buffer.concat(scanlines)
}

const pngChunk = (type: string, data: Uint8Array): Buffer => {
  const encodedType = Buffer.from(type, 'ascii')
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.byteLength)
  const checksum = Buffer.alloc(4)
  checksum.writeUInt32BE(crc32(encodedType, data))
  return Buffer.concat([length, encodedType, data, checksum])
}

const palette = (format: PngFormat): Uint8Array | undefined => {
  const entries = paletteEntries(format)
  if (entries === 0) return undefined
  const data = new Uint8Array(entries * 3)
  for (let entry = 0; entry < entries; entry += 1) {
    data[entry * 3] = entry * 67
    data[entry * 3 + 1] = 255 - entry * 41
    data[entry * 3 + 2] = entry * 29 + 13
  }
  return data
}

const pngFixture = (format: PngFormat, options: FixtureOptions = {}): Buffer => {
  const width = options.width ?? 13
  const height = options.height ?? 11
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header[8] = format.bitDepth
  header[9] = format.colorType
  header[12] = options.interlace ? 1 : 0
  const compressed = deflateSync(imageData(width, height, format, options.interlace ?? false))
  const idat: Buffer[] = []
  if (options.splitIdat && compressed.byteLength >= 3) {
    const first = Math.floor(compressed.byteLength / 3)
    const second = Math.floor((compressed.byteLength * 2) / 3)
    idat.push(
      pngChunk('IDAT', compressed.subarray(0, first)),
      pngChunk('IDAT', compressed.subarray(first, second)),
      pngChunk('IDAT', compressed.subarray(second)),
    )
  } else {
    idat.push(pngChunk('IDAT', compressed))
  }
  const paletteData = palette(format)
  return Buffer.concat([
    signature,
    pngChunk('IHDR', header),
    ...(paletteData ? [pngChunk('PLTE', paletteData)] : []),
    ...(options.transparency ? [pngChunk('tRNS', options.transparency)] : []),
    ...idat,
    pngChunk('IEND', new Uint8Array()),
  ])
}

const chunks = (png: Buffer): Buffer[] => {
  const output: Buffer[] = []
  let offset = signature.byteLength
  while (offset < png.byteLength) {
    const length = png.readUInt32BE(offset)
    const end = offset + length + 12
    output.push(png.subarray(offset, end))
    offset = end
  }
  return output
}

const chunkType = (chunk: Buffer): string => chunk.toString('ascii', 4, 8)

const compareWithOracle = async (input: Buffer, tolerance = 0): Promise<void> => {
  const reference = PNG.sync.read(input)
  const output = await (await Image.open(input)).png().toBuffer()
  const decoded = PNG.sync.read(output)
  expect({ width: decoded.width, height: decoded.height }).toEqual({
    width: reference.width,
    height: reference.height,
  })
  expect(decoded.data.byteLength).toBe(reference.data.byteLength)
  for (let offset = 0; offset < decoded.data.byteLength; offset += 4) {
    const decodedAlpha = decoded.data[offset + 3] ?? 0
    const referenceAlpha = reference.data[offset + 3] ?? 0
    expect(Math.abs(decodedAlpha - referenceAlpha)).toBeLessThanOrEqual(tolerance)
    if (decodedAlpha === 0 && referenceAlpha === 0) continue
    for (let channel = 0; channel < 3; channel += 1) {
      expect(
        Math.abs((decoded.data[offset + channel] ?? 0) - (reference.data[offset + channel] ?? 0)),
      ).toBeLessThanOrEqual(tolerance)
    }
  }
}

describe('PNG compatibility matrix', () => {
  it.each(formats)('decodes non-interlaced $label with filters 0-4', async (format) => {
    await compareWithOracle(
      pngFixture(format, { width: 17, height: 5, splitIdat: true }),
      format.bitDepth === 16 ? 1 : 0,
    )
  })

  it('decodes every tRNS form', async () => {
    const gray: PngFormat = { label: 'transparent grayscale', colorType: 0, bitDepth: 8 }
    const rgb: PngFormat = { label: 'transparent truecolor', colorType: 2, bitDepth: 8 }
    const indexed: PngFormat = { label: 'transparent indexed', colorType: 3, bitDepth: 4 }
    const grayKey = sampleValue(2, 1, 0, gray)
    const redKey = sampleValue(2, 1, 0, rgb)
    const greenKey = sampleValue(2, 1, 1, rgb)
    const blueKey = sampleValue(2, 1, 2, rgb)
    await compareWithOracle(pngFixture(gray, { transparency: Uint8Array.of(0, grayKey) }))
    await compareWithOracle(
      pngFixture(rgb, {
        transparency: Uint8Array.of(0, redKey, 0, greenKey, 0, blueKey),
      }),
    )
    await compareWithOracle(pngFixture(indexed, { transparency: Uint8Array.of(255, 0, 127, 255) }))
  })
})

describe('PNG Adam7 compatibility', () => {
  it.each(formats)('decodes Adam7 $label', async (format) => {
    await compareWithOracle(
      pngFixture(format, { width: 13, height: 11, interlace: true, splitIdat: true }),
      format.bitDepth === 16 ? 1 : 0,
    )
  })

  it.each([
    { width: 1, height: 1 },
    { width: 2, height: 3 },
    { width: 7, height: 5 },
    { width: 67, height: 65 },
  ])('decodes Adam7 edge dimensions $width x $height', async ({ width, height }) => {
    const format: PngFormat = { label: 'RGBA edge', colorType: 6, bitDepth: 8 }
    await compareWithOracle(pngFixture(format, { width, height, interlace: true }))
  })

  it('crops Adam7 pixels exactly', async () => {
    const format: PngFormat = { label: 'RGBA crop', colorType: 6, bitDepth: 8 }
    const input = pngFixture(format, { width: 19, height: 15, interlace: true })
    const reference = PNG.sync.read(input)
    const output = await (await Image.open(input))
      .crop({ x: 4, y: 3, width: 9, height: 7 })
      .png()
      .toBuffer()
    const cropped = PNG.sync.read(output)
    for (let y = 0; y < cropped.height; y += 1) {
      const sourceStart = ((y + 3) * reference.width + 4) * 4
      const targetStart = y * cropped.width * 4
      expect(cropped.data.subarray(targetStart, targetStart + cropped.width * 4)).toEqual(
        reference.data.subarray(sourceStart, sourceStart + cropped.width * 4),
      )
    }
  })

  it('applies inflated-byte limits before retaining high-bit-depth Adam7 rows', async () => {
    const format: PngFormat = { label: 'RGBA16 limit', colorType: 6, bitDepth: 16 }
    const input = pngFixture(format, { width: 13, height: 11, interlace: true })
    const images = createImageLibrary([pngCodec])
    const image = await images.open(input, { limits: { maxDecodedBytes: 700 } })
    await expect(image.png().toBuffer()).rejects.toMatchObject({ code: 'LIMIT_EXCEEDED' })
  })
})

describe('PNG parser hardening', () => {
  it.each(['IHDR', 'PLTE', 'tRNS', 'IEND'])('rejects a corrupt %s CRC', async (type) => {
    const format: PngFormat = { label: 'indexed CRC', colorType: 3, bitDepth: 4 }
    const input = pngFixture(format, { transparency: Uint8Array.of(255, 0, 127, 255) })
    const corrupt = Buffer.from(input)
    const target = chunks(corrupt).find((chunk) => chunkType(chunk) === type)
    expect(target).toBeDefined()
    if (target === undefined) return
    target[target.byteLength - 1] = (target[target.byteLength - 1] ?? 0) ^ 0xff
    await expect((await Image.open(corrupt)).png().toBuffer()).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    })
  })

  it('rejects duplicate palettes and transparency chunks', async () => {
    const format: PngFormat = { label: 'indexed ordering', colorType: 3, bitDepth: 4 }
    const input = pngFixture(format, { transparency: Uint8Array.of(255, 0, 127, 255) })
    for (const type of ['PLTE', 'tRNS']) {
      const parts = chunks(input)
      const index = parts.findIndex((chunk) => chunkType(chunk) === type)
      const duplicate = parts[index]
      expect(duplicate).toBeDefined()
      if (duplicate === undefined) continue
      parts.splice(index + 1, 0, duplicate)
      await expect(
        (await Image.open(Buffer.concat([signature, ...parts]))).png().toBuffer(),
      ).rejects.toMatchObject({
        code: 'INVALID_INPUT',
      })
    }
  })

  it('rejects misplaced palettes, transparency, and non-consecutive IDAT chunks', async () => {
    const format: PngFormat = { label: 'indexed ordering', colorType: 3, bitDepth: 4 }
    const input = pngFixture(format, {
      splitIdat: true,
      transparency: Uint8Array.of(255, 0, 127, 255),
    })

    const paletteAfterData = chunks(input)
    const paletteIndex = paletteAfterData.findIndex((chunk) => chunkType(chunk) === 'PLTE')
    const idatIndex = paletteAfterData.findIndex((chunk) => chunkType(chunk) === 'IDAT')
    const paletteChunk = paletteAfterData[paletteIndex]
    expect(paletteChunk).toBeDefined()
    if (paletteChunk !== undefined) {
      paletteAfterData.splice(paletteIndex, 1)
      paletteAfterData.splice(idatIndex + 1, 0, paletteChunk)
      await expect(
        (await Image.open(Buffer.concat([signature, ...paletteAfterData]))).png().toBuffer(),
      ).rejects.toMatchObject({ code: 'INVALID_INPUT' })
    }

    const transparencyBeforePalette = chunks(input)
    const transparencyIndex = transparencyBeforePalette.findIndex(
      (chunk) => chunkType(chunk) === 'tRNS',
    )
    const transparencyChunk = transparencyBeforePalette[transparencyIndex]
    expect(transparencyChunk).toBeDefined()
    if (transparencyChunk !== undefined) {
      transparencyBeforePalette.splice(transparencyIndex, 1)
      const currentPalette = transparencyBeforePalette.findIndex(
        (chunk) => chunkType(chunk) === 'PLTE',
      )
      transparencyBeforePalette.splice(currentPalette, 0, transparencyChunk)
      await expect(
        (await Image.open(Buffer.concat([signature, ...transparencyBeforePalette])))
          .png()
          .toBuffer(),
      ).rejects.toMatchObject({ code: 'INVALID_INPUT' })
    }

    const separatedIdat = chunks(input)
    const firstIdat = separatedIdat.findIndex((chunk) => chunkType(chunk) === 'IDAT')
    separatedIdat.splice(firstIdat + 1, 0, pngChunk('tEXt', Buffer.from('key\0value')))
    await expect(
      (await Image.open(Buffer.concat([signature, ...separatedIdat]))).png().toBuffer(),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' })

    const rgb: PngFormat = { label: 'truecolor ordering', colorType: 2, bitDepth: 8 }
    const rgbParts = chunks(pngFixture(rgb, { transparency: Uint8Array.of(0, 1, 0, 2, 0, 3) }))
    const rgbIdat = rgbParts.findIndex((chunk) => chunkType(chunk) === 'IDAT')
    rgbParts.splice(rgbIdat, 0, pngChunk('PLTE', Uint8Array.of(0, 0, 0)))
    await expect(
      (await Image.open(Buffer.concat([signature, ...rgbParts]))).png().toBuffer(),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' })
  })

  it('rejects unknown critical chunks, invalid reserved bits, and trailing data', async () => {
    const format: PngFormat = { label: 'RGBA structure', colorType: 6, bitDepth: 8 }
    const input = pngFixture(format)
    const base = chunks(input)
    const idat = base.findIndex((chunk) => chunkType(chunk) === 'IDAT')
    const unknownCritical = [...base]
    unknownCritical.splice(idat, 0, pngChunk('ABCD', new Uint8Array()))
    const invalidReserved = [...base]
    invalidReserved.splice(idat, 0, pngChunk('abca', new Uint8Array()))
    const trailing = Buffer.concat([input, Buffer.of(0)])

    for (const malformed of [
      Buffer.concat([signature, ...unknownCritical]),
      Buffer.concat([signature, ...invalidReserved]),
      trailing,
    ]) {
      await expect((await Image.open(malformed)).png().toBuffer()).rejects.toMatchObject({
        code: 'INVALID_INPUT',
      })
    }
  })

  it('validates ancillary CRCs after image data', async () => {
    const format: PngFormat = { label: 'RGBA ancillary', colorType: 6, bitDepth: 8 }
    const input = pngFixture(format)
    const parts = chunks(input)
    const end = parts.findIndex((chunk) => chunkType(chunk) === 'IEND')
    const corruptText = pngChunk('tEXt', Buffer.from('key\0value'))
    corruptText[corruptText.byteLength - 1] = (corruptText[corruptText.byteLength - 1] ?? 0) ^ 0xff
    parts.splice(end, 0, corruptText)
    await expect(
      (await Image.open(Buffer.concat([signature, ...parts]))).png().toBuffer(),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' })
  })
})
