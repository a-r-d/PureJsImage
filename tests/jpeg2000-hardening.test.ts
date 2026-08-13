import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

import { jpeg2000Codec } from '../src/codecs/jpeg2000.ts'
import { pngCodec } from '../src/codecs/png.ts'
import { ImageError } from '../src/errors.ts'
import { createImageLibrary } from '../src/image.ts'
import { defaultImageLimits } from '../src/limits.ts'

const images = createImageLibrary([jpeg2000Codec, pngCodec])
const smallFixture = (): Promise<Buffer> =>
  readFile('benchmark/corpus/files/jp2/openjpeg-lossless-rgb16.jp2')
const largeFixture = (): Promise<Buffer> =>
  readFile('benchmark/corpus/files/jp2/wikimedia-blue-marble-openjpeg-lossless.jp2')

interface BoxExtent {
  readonly end: number
  readonly headerBytes: 8 | 16
  readonly offset: number
  readonly type: string
}

const readBox = (data: Buffer, offset: number, parentEnd: number): BoxExtent => {
  if (offset + 8 > parentEnd) throw new Error('Test fixture box header is truncated')
  const length32 = data.readUInt32BE(offset)
  const type = data.toString('ascii', offset + 4, offset + 8)
  let headerBytes: 8 | 16 = 8
  let length = length32
  if (length32 === 1) {
    if (offset + 16 > parentEnd) throw new Error('Test fixture extended box is truncated')
    const extended = data.readBigUInt64BE(offset + 8)
    if (extended > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new Error('Test fixture extended box is too large')
    }
    headerBytes = 16
    length = Number(extended)
  } else if (length32 === 0) {
    length = parentEnd - offset
  }
  if (length < headerBytes || offset + length > parentEnd) {
    throw new Error(`Test fixture ${type} extent is invalid`)
  }
  return { end: offset + length, headerBytes, offset, type }
}

const findBox = (data: Buffer, type: string, start = 0, end = data.byteLength): BoxExtent => {
  let offset = start
  while (offset < end) {
    const box = readBox(data, offset, end)
    if (box.type === type) return box
    offset = box.end
  }
  throw new Error(`Test fixture does not contain ${type}`)
}

const asExtendedLength = (data: Buffer, type: string): Buffer => {
  const box = findBox(data, type)
  if (box.headerBytes !== 8) throw new Error(`${type} already has an extended header`)
  const output = Buffer.alloc(data.byteLength + 8)
  data.copy(output, 0, 0, box.offset)
  output.writeUInt32BE(1, box.offset)
  data.copy(output, box.offset + 4, box.offset + 4, box.offset + 8)
  output.writeBigUInt64BE(BigInt(box.end - box.offset + 8), box.offset + 8)
  data.copy(output, box.offset + 16, box.offset + 8)
  return output
}

const duplicateImageHeader = (data: Buffer): Buffer => {
  const header = findBox(data, 'jp2h')
  const imageHeader = findBox(data, 'ihdr', header.offset + header.headerBytes, header.end)
  const duplicateBytes = imageHeader.end - imageHeader.offset
  const output = Buffer.alloc(data.byteLength + duplicateBytes)
  data.copy(output, 0, 0, header.end)
  data.copy(output, header.end, imageHeader.offset, imageHeader.end)
  data.copy(output, header.end + duplicateBytes, header.end)
  output.writeUInt32BE(header.end - header.offset + duplicateBytes, header.offset)
  return output
}

const findMarker = (data: Buffer, marker: number, start: number): number => {
  for (let offset = start; offset + 1 < data.byteLength; offset += 1) {
    if (data[offset] === 0xff && data[offset + 1] === marker) return offset
  }
  throw new Error(`Test fixture does not contain marker 0xff${marker.toString(16)}`)
}

const expectImageError = async (input: Uint8Array): Promise<void> => {
  let failure: unknown
  try {
    await (await images.open(input)).metadata()
  } catch (error) {
    failure = error
  }
  expect(failure).toBeInstanceOf(ImageError)
}

const allowDecodeOrImageError = async (input: Uint8Array, label: string): Promise<void> => {
  try {
    await (await images.open(input)).png().toBuffer()
  } catch (error) {
    expect(error, label).toBeInstanceOf(ImageError)
  }
}

describe('JPEG 2000 container hardening', () => {
  it('accepts extended-length and end-of-file jp2c boxes', async () => {
    const original = await smallFixture()
    const extended = asExtendedLength(original, 'jp2c')
    await expect((await images.open(extended)).metadata()).resolves.toMatchObject({
      format: 'jp2',
      width: 17,
      height: 13,
    })

    const toEnd = Buffer.from(original)
    toEnd.writeUInt32BE(0, findBox(toEnd, 'jp2c').offset)
    await expect((await images.open(toEnd)).metadata()).resolves.toMatchObject({
      format: 'jp2',
      width: 17,
      height: 13,
    })
  })

  it('rejects oversized extended boxes, child overrun, and duplicate ihdr boxes', async () => {
    const original = await smallFixture()
    const extended = asExtendedLength(original, 'jp2c')
    const codestream = findBox(extended, 'jp2c')
    extended.writeBigUInt64BE(BigInt(extended.byteLength + 1), codestream.offset + 8)
    await expect((await images.open(extended)).metadata()).rejects.toMatchObject({
      code: 'TRUNCATED_INPUT',
    })

    const childOverrun = Buffer.from(original)
    const header = findBox(childOverrun, 'jp2h')
    childOverrun.writeUInt32BE(header.end - header.offset - 1, header.offset)
    await expectImageError(childOverrun)

    await expect(
      (await images.open(duplicateImageHeader(original))).metadata(),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' })
  })

  it('normalizes malformed SIZ, SOT, and EOC mutations as ImageErrors', async () => {
    const original = await smallFixture()
    const codestream = findBox(original, 'jp2c')
    const payload = codestream.offset + codestream.headerBytes
    const sizeMarker = findMarker(original, 0x51, payload)
    const tileMarker = findMarker(original, 0x90, sizeMarker + 2)

    const invalidSizeLength = Buffer.from(original)
    invalidSizeLength.writeUInt16BE(1, sizeMarker + 2)

    const oversizedGrid = Buffer.from(original)
    oversizedGrid.writeUInt32BE(100_001, sizeMarker + 6)

    const oversizedTilePart = Buffer.from(original)
    oversizedTilePart.writeUInt32BE(original.byteLength + 100, tileMarker + 6)

    const missingEndMarker = original.subarray(0, original.byteLength - 2)
    for (const mutation of [invalidSizeLength, oversizedGrid]) {
      await expectImageError(mutation)
    }
    for (const mutation of [oversizedTilePart, missingEndMarker]) {
      await expect((await images.open(mutation)).png().toBuffer()).rejects.toBeInstanceOf(
        ImageError,
      )
    }
  })

  it('inspects metadata without reading tile packet payloads', async () => {
    const input = await largeFixture()
    const codestream = findBox(input, 'jp2c')
    const payload = codestream.offset + codestream.headerBytes
    const firstTilePart = findMarker(input, 0x90, payload)
    let furthestRead = 0
    const source = {
      size: input.byteLength,
      read: async (offset: number, length: number): Promise<Uint8Array> => {
        furthestRead = Math.max(furthestRead, offset + length)
        return input.subarray(offset, offset + length)
      },
    }
    await expect(jpeg2000Codec.metadata(source, defaultImageLimits)).resolves.toMatchObject({
      width: 1920,
      height: 2172,
    })
    expect(furthestRead).toBeLessThanOrEqual(firstTilePart + 2)
  })

  it('never leaks raw exceptions across a deterministic JP2 mutation campaign', async () => {
    const original = await smallFixture()
    let state = 0x4a50_3220
    for (let index = 0; index < 128; index += 1) {
      state ^= state << 13
      state ^= state >>> 17
      state ^= state << 5
      state >>>= 0
      const offset = state % original.byteLength
      const bit = 1 << ((state >>> 29) & 7)
      const mutation = Buffer.from(original)
      mutation[offset] = (mutation[offset] ?? 0) ^ bit
      await allowDecodeOrImageError(mutation, `case ${index}, offset ${offset}, bit ${bit}`)
    }
  })
})

describe('JPEG 2000 allocation limits', () => {
  it('rejects the large real photograph at input and decoded-size gates', async () => {
    const input = await largeFixture()
    await expect(
      images.open(input, { limits: { maxInputBytes: input.byteLength - 1 } }),
    ).rejects.toMatchObject({
      code: 'LIMIT_EXCEEDED',
      message: expect.stringContaining('maxInputBytes'),
    })

    const image = await images.open(input, {
      limits: { maxDecodedBytes: 1920 * 2172 * 4 - 1 },
    })
    await expect(image.metadata()).rejects.toMatchObject({
      code: 'LIMIT_EXCEEDED',
      message: expect.stringContaining('maxDecodedBytes'),
    })
  })
})
