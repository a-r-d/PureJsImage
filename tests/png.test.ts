import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { deflateSync } from 'node:zlib'
import { afterEach, describe, expect, it } from 'vitest'
import { PNG } from 'pngjs'

import { crc32 } from '../src/codecs/crc32.ts'
import { displayP3RgbProfile } from './icc-fixtures.ts'
import { Image } from './image-library.ts'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true })))
})

const rgbaPng = (width: number, height: number): Buffer => {
  const image = new PNG({ width, height })
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4
      image.data[offset] = x * 17 + y
      image.data[offset + 1] = y * 29 + x
      image.data[offset + 2] = x * 11 + y * 7
      image.data[offset + 3] = (x + y) % 3 === 0 ? 80 : 255
    }
  }
  return PNG.sync.write(image, { colorType: 6, inputColorType: 6, bitDepth: 8 })
}

const pngChunk = (type: string, data: Uint8Array): Buffer => {
  const encodedType = Buffer.from(type, 'ascii')
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.byteLength)
  const checksum = Buffer.alloc(4)
  checksum.writeUInt32BE(crc32(encodedType, data))
  return Buffer.concat([length, encodedType, data, checksum])
}

const specializedPng = (
  width: number,
  height: number,
  bitDepth: number,
  colorType: number,
  scanlines: Uint8Array,
  palette?: Uint8Array,
  chunksBeforePalette: readonly Buffer[] = [],
): Buffer => {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header[8] = bitDepth
  header[9] = colorType
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', header),
    ...chunksBeforePalette,
    ...(palette ? [pngChunk('PLTE', palette)] : []),
    pngChunk('IDAT', deflateSync(scanlines)),
    pngChunk('IEND', new Uint8Array()),
  ])
}

describe('PNG pixel pipeline', () => {
  it('converts a Display-P3 iCCP profile to sRGB without changing alpha', async () => {
    const profileData = Buffer.concat([
      Buffer.from('Display P3\0', 'latin1'),
      Buffer.from([0]),
      deflateSync(displayP3RgbProfile()),
    ])
    const input = specializedPng(
      2,
      1,
      8,
      6,
      Uint8Array.of(0, 180, 100, 40, 77, 90, 110, 130, 201),
      undefined,
      [pngChunk('iCCP', profileData)],
    )
    const decoded = PNG.sync.read(await (await Image.open(input)).png().toBuffer())

    expect(Array.from(decoded.data)).toEqual([193, 95, 14, 77, 85, 111, 132, 201])
  })

  it('applies PNG gAMA and cHRM only when no higher-precedence sRGB chunk exists', async () => {
    const gamma = Buffer.alloc(4)
    gamma.writeUInt32BE(100_000)
    const gammaInput = specializedPng(1, 1, 8, 6, Uint8Array.of(0, 128, 128, 128, 91), undefined, [
      pngChunk('gAMA', gamma),
    ])
    const gammaDecoded = PNG.sync.read(await (await Image.open(gammaInput)).png().toBuffer())
    expect(Array.from(gammaDecoded.data)).toEqual([188, 188, 188, 91])
    const grayInput = specializedPng(1, 1, 8, 0, Uint8Array.of(0, 128), undefined, [
      pngChunk('gAMA', gamma),
    ])
    const grayDecoded = PNG.sync.read(await (await Image.open(grayInput)).png().toBuffer())
    expect(Array.from(grayDecoded.data)).toEqual([188, 188, 188, 255])

    const chromaticities = Buffer.alloc(32)
    const values = [31_270, 32_900, 68_000, 32_000, 26_500, 69_000, 15_000, 6_000]
    for (let index = 0; index < values.length; index += 1) {
      chromaticities.writeUInt32BE(values[index] ?? 0, index * 4)
    }
    const p3Input = specializedPng(1, 1, 8, 6, Uint8Array.of(0, 180, 100, 40, 123), undefined, [
      pngChunk('gAMA', Buffer.from([0, 0, 0xb1, 0x8f])),
      pngChunk('cHRM', chromaticities),
    ])
    const p3Decoded = PNG.sync.read(await (await Image.open(p3Input)).png().toBuffer())
    expect(Array.from(p3Decoded.data.subarray(0, 3))).not.toEqual([180, 100, 40])
    expect(p3Decoded.data[3]).toBe(123)

    const srgbInput = specializedPng(1, 1, 8, 6, Uint8Array.of(0, 128, 128, 128, 91), undefined, [
      pngChunk('gAMA', gamma),
      pngChunk('sRGB', Uint8Array.of(0)),
    ])
    const srgbDecoded = PNG.sync.read(await (await Image.open(srgbInput)).png().toBuffer())
    expect(Array.from(srgbDecoded.data)).toEqual([128, 128, 128, 91])
  })

  it('rejects corrupt ICC data and color-manages common full-range cICP signaling', async () => {
    const corruptIcc = specializedPng(1, 1, 8, 2, Uint8Array.of(0, 1, 2, 3), undefined, [
      pngChunk('iCCP', Buffer.concat([Buffer.from('profile\0'), Buffer.from([0, 1, 2, 3])])),
    ])
    const displayP3 = specializedPng(1, 1, 8, 6, Uint8Array.of(0, 180, 100, 40, 77), undefined, [
      pngChunk('cICP', Uint8Array.of(12, 13, 0, 1)),
    ])
    const unsupportedHdr = specializedPng(1, 1, 8, 2, Uint8Array.of(0, 1, 2, 3), undefined, [
      pngChunk('cICP', Uint8Array.of(9, 16, 0, 1)),
    ])

    await expect((await Image.open(corruptIcc)).metadata()).rejects.toMatchObject({
      code: 'INVALID_INPUT',
      message: 'PNG iCCP profile could not be decompressed',
    })
    const decoded = PNG.sync.read(await (await Image.open(displayP3)).png().toBuffer())
    expect(Array.from(decoded.data)).toEqual([193, 95, 14, 77])
    await expect((await Image.open(unsupportedHdr)).metadata()).rejects.toMatchObject({
      code: 'UNSUPPORTED_OPERATION',
      message: 'PNG cICP primaries 9 and transfer 16 are not implemented',
    })
  })

  it('decodes and encodes RGBA pixels without materializing a public bitmap', async () => {
    const input = rgbaPng(19, 11)
    const output = await (await Image.open(input)).png({ compressionLevel: 6 }).toBuffer()

    const before = PNG.sync.read(input)
    const after = PNG.sync.read(output)
    expect({ width: after.width, height: after.height }).toEqual({ width: 19, height: 11 })
    expect(after.data).toEqual(before.data)
  })

  it('fuses crop into PNG decoding and writes the exact selected pixels', async () => {
    const input = PNG.sync.read(rgbaPng(17, 13))
    const output = await (await Image.open(PNG.sync.write(input)))
      .crop({ x: 4, y: 3, width: 8, height: 6 })
      .png({ compressionLevel: 3 })
      .toBuffer()
    const cropped = PNG.sync.read(output)

    expect({ width: cropped.width, height: cropped.height }).toEqual({ width: 8, height: 6 })
    for (let y = 0; y < cropped.height; y += 1) {
      const sourceStart = ((y + 3) * input.width + 4) * 4
      const targetStart = y * cropped.width * 4
      expect(cropped.data.subarray(targetStart, targetStart + cropped.width * 4)).toEqual(
        input.data.subarray(sourceStart, sourceStart + cropped.width * 4),
      )
    }
  })

  it('copies every 8-bit RGBA pixel across a 32-row decode block', async () => {
    const input = rgbaPng(13, 40)
    const reference = PNG.sync.read(input)
    const output = PNG.sync.read(await (await Image.open(input)).png().toBuffer())

    expect({ width: output.width, height: output.height }).toEqual({ width: 13, height: 40 })
    expect(output.data).toEqual(reference.data)
  })

  it('crops the last column and a strip that crosses a 32-row block', async () => {
    const source = PNG.sync.read(rgbaPng(11, 40))
    const input = PNG.sync.write(source)
    const lastColumn = PNG.sync.read(
      await (await Image.open(input)).crop({ x: 10, y: 0, width: 1, height: 40 }).png().toBuffer(),
    )
    const crossing = PNG.sync.read(
      await (await Image.open(input)).crop({ x: 3, y: 28, width: 5, height: 8 }).png().toBuffer(),
    )

    expect({ width: lastColumn.width, height: lastColumn.height }).toEqual({ width: 1, height: 40 })
    expect({ width: crossing.width, height: crossing.height }).toEqual({ width: 5, height: 8 })
    for (let y = 0; y < 40; y += 1) {
      expect(lastColumn.data.subarray(y * 4, y * 4 + 4)).toEqual(
        source.data.subarray((y * 11 + 10) * 4, (y * 11 + 11) * 4),
      )
    }
    for (let y = 0; y < 8; y += 1) {
      const sourceStart = ((y + 28) * 11 + 3) * 4
      expect(crossing.data.subarray(y * 20, y * 20 + 20)).toEqual(
        source.data.subarray(sourceStart, sourceStart + 20),
      )
    }
  })

  it('keeps 16-bit RGBA on the high-byte path instead of copying packed samples', async () => {
    const input = specializedPng(
      2,
      1,
      16,
      6,
      Uint8Array.of(
        0,
        0x12,
        0x34,
        0x56,
        0x78,
        0x9a,
        0xbc,
        0xde,
        0xf0,
        0x01,
        0x02,
        0x03,
        0x04,
        0x05,
        0x06,
        0x07,
        0x08,
      ),
    )
    const output = PNG.sync.read(await (await Image.open(input)).png().toBuffer())

    expect(Array.from(output.data)).toEqual([0x12, 0x56, 0x9a, 0xde, 0x01, 0x03, 0x05, 0x07])
    expect(Array.from(output.data)).not.toEqual([0x12, 0x34, 0x56, 0x78, 0x9a, 0xbc, 0xde, 0xf0])
  })

  it('decodes palette and 16-bit grayscale PNG variants', async () => {
    const palette = specializedPng(
      2,
      2,
      8,
      3,
      Uint8Array.of(0, 0, 1, 0, 2, 3),
      Uint8Array.of(255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255),
    )
    const gray16 = specializedPng(
      2,
      2,
      16,
      0,
      Uint8Array.of(0, 0, 0, 0x12, 0x34, 0, 0xab, 0xcd, 0xff, 0xff),
    )

    for (const input of [palette, gray16]) {
      const reference = PNG.sync.read(input)
      const pipeline = (await Image.open(input)).png()
      const output = PNG.sync.read(await pipeline.toBuffer())
      await expect(pipeline.metadata()).resolves.toMatchObject({ bitDepth: 8 })
      expect({ width: output.width, height: output.height }).toEqual({
        width: reference.width,
        height: reference.height,
      })
      expect(output.data).toEqual(reference.data)
    }
  })

  it('streams PNG output to a file and honors compression level', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'purejsimage-png-'))
    temporaryDirectories.push(directory)
    const path = join(directory, 'output.png')
    const input = rgbaPng(128, 128)
    const image = await Image.open(input)

    const uncompressed = await image.png({ compressionLevel: 0 }).toBuffer()
    const compressed = await image.png({ compressionLevel: 9 }).toBuffer()
    await image.png({ compressionLevel: 6 }).toFile(path)

    expect(compressed.byteLength).toBeLessThan(uncompressed.byteLength)
    expect(PNG.sync.read(await readFile(path)).data).toEqual(PNG.sync.read(input).data)
  })

  it('uses adaptive row filters to reduce smooth-image output size', async () => {
    const input = rgbaPng(256, 128)
    const decoded = PNG.sync.read(input)
    const filterZeroScanlines = new Uint8Array((decoded.width * 4 + 1) * decoded.height)
    for (let row = 0; row < decoded.height; row += 1) {
      filterZeroScanlines.set(
        decoded.data.subarray(row * decoded.width * 4, (row + 1) * decoded.width * 4),
        row * (decoded.width * 4 + 1) + 1,
      )
    }
    const filterZero = specializedPng(decoded.width, decoded.height, 8, 6, filterZeroScanlines)
    const adaptive = await (await Image.open(input)).png({ compressionLevel: 6 }).toBuffer()

    expect(adaptive.byteLength).toBeLessThan(filterZero.byteLength / 2)
    expect(PNG.sync.read(adaptive).data).toEqual(decoded.data)
  })

  it('rejects corrupt PNG image data and cleans up failed output files', async () => {
    const corrupt = rgbaPng(4, 4).slice()
    const idat = corrupt.indexOf(Buffer.from('IDAT'))
    corrupt[idat + 4] = (corrupt[idat + 4] ?? 0) ^ 0xff
    const directory = await mkdtemp(join(tmpdir(), 'purejsimage-png-corrupt-'))
    temporaryDirectories.push(directory)
    const path = join(directory, 'should-not-exist.png')

    await expect((await Image.open(corrupt)).png().toFile(path)).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    })
    await expect(readFile(path)).rejects.toMatchObject({ code: 'ENOENT' })
  })
})
