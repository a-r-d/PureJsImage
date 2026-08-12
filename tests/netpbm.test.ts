import { describe, expect, it } from 'vitest'

import { defaultImageLimits } from '../src/index.ts'
import { netpbmCodec } from '../src/codecs/netpbm.ts'
import { MemorySource } from '../src/source.ts'
import { Image } from './image-library.ts'
import { decodeFixture } from './small-codec-helpers.ts'

const textEncoder = new TextEncoder()

const binaryFixture = (header: string, raster: Uint8Array): Uint8Array => {
  const encodedHeader = textEncoder.encode(header)
  const output = new Uint8Array(encodedHeader.byteLength + raster.byteLength)
  output.set(encodedHeader)
  output.set(raster, encodedHeader.byteLength)
  return output
}

const floatRaster = (values: readonly number[], littleEndian: boolean): Uint8Array => {
  const output = new Uint8Array(values.length * 4)
  const view = new DataView(output.buffer)
  for (let index = 0; index < values.length; index += 1) {
    view.setFloat32(index * 4, values[index] ?? 0, littleEndian)
  }
  return output
}

const floats = (data: Uint8Array): number[] => {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const output: number[] = []
  for (let offset = 0; offset < data.byteLength; offset += 4) {
    output.push(view.getFloat32(offset, false))
  }
  return output
}

describe('Netpbm integer formats', () => {
  it.each([
    ['P1', textEncoder.encode('P1\n2 1\n0 1\n'), [255, 0]],
    ['P4', binaryFixture('P4\n2 1\n', Uint8Array.of(0x40)), [255, 0]],
    ['P2', textEncoder.encode('P2\n3 1\n100\n0 50 100\n'), [0, 128, 255]],
    ['P5', binaryFixture('P5\n3 1\n100\n', Uint8Array.of(0, 50, 100)), [0, 128, 255]],
    ['P3', textEncoder.encode('P3\n2 1\n255\n255 0 0 0 255 0\n'), [255, 0, 0, 0, 255, 0]],
    [
      'P6',
      binaryFixture('P6\n2 1\n255\n', Uint8Array.of(255, 0, 0, 0, 255, 0)),
      [255, 0, 0, 0, 255, 0],
    ],
  ])('decodes %s samples', async (_magic, input, expected) => {
    expect([...(await decodeFixture(netpbmCodec, input)).pixels]).toEqual(expected)
  })

  it('parses comments and preserves 16-bit samples in canonical big-endian order', async () => {
    const input = binaryFixture(
      'P6\n# source comment\n2 # width comment\n1\n65535\n',
      Uint8Array.of(0x12, 0x34, 0xab, 0xcd, 0xff, 0xff, 0, 0, 0x80, 0, 0, 1),
    )
    const decoded = await decodeFixture(netpbmCodec, input)

    expect(decoded.decoder.pixelFormat).toBe('rgb16')
    expect([...decoded.pixels]).toEqual([0x12, 0x34, 0xab, 0xcd, 0xff, 0xff, 0, 0, 0x80, 0, 0, 1])
  })

  it('decodes PAM RGB, RGBA, grayscale alpha, and non-255 MAXVAL', async () => {
    const rgba = binaryFixture(
      'P7\nWIDTH 1\nHEIGHT 1\nDEPTH 4\nMAXVAL 255\nTUPLTYPE RGB_ALPHA\nENDHDR\n',
      Uint8Array.of(1, 2, 3, 4),
    )
    expect([...(await decodeFixture(netpbmCodec, rgba)).pixels]).toEqual([1, 2, 3, 4])

    const grayAlpha = binaryFixture(
      'P7\nWIDTH 1\nHEIGHT 1\nDEPTH 2\nMAXVAL 100\nTUPLTYPE GRAYSCALE_ALPHA\nENDHDR\n',
      Uint8Array.of(50, 25),
    )
    expect([...(await decodeFixture(netpbmCodec, grayAlpha)).pixels]).toEqual([128, 128, 128, 64])

    const rgb16 = binaryFixture(
      'P7\nWIDTH 1\nHEIGHT 1\nDEPTH 3\nMAXVAL 65535\nTUPLTYPE RGB\nENDHDR\n',
      Uint8Array.of(0x12, 0x34, 0x56, 0x78, 0x9a, 0xbc),
    )
    const decoded = await decodeFixture(netpbmCodec, rgb16)
    expect(decoded.decoder.pixelFormat).toBe('rgb16')
    expect([...decoded.pixels]).toEqual([0x12, 0x34, 0x56, 0x78, 0x9a, 0xbc])
  })

  it('encodes the practical PBM, PGM, PPM, and PAM variants deterministically', async () => {
    const source = binaryFixture('P6\n2 1\n255\n', Uint8Array.of(255, 0, 0, 0, 255, 255))
    const image = await Image.open(source)
    const pbmAscii = await image.pbm({ ascii: true }).toBuffer()
    const pbmBinary = await image.pbm().toBuffer()
    const pgm16 = await image.pgm({ bitDepth: 16 }).toBuffer()
    const ppmAscii = await image.ppm({ ascii: true }).toBuffer()
    const pam = await image.pam({ bitDepth: 8 }).toBuffer()
    expect(new TextDecoder().decode(pbmAscii)).toMatch(/^P1\n2 1\n/)
    expect(new TextDecoder().decode(pbmBinary.subarray(0, 7))).toBe('P4\n2 1\n')
    expect(new TextDecoder().decode(pgm16.subarray(0, 13))).toContain('65535\n')
    expect(new TextDecoder().decode(ppmAscii)).toMatch(/^P3\n2 1\n255\n/)
    expect(new TextDecoder().decode(pam.subarray(0, 80))).toContain('TUPLTYPE RGB')
    expect(await image.ppm({ ascii: true }).toBuffer()).toEqual(ppmAscii)

    const wide = await Image.open(binaryFixture('P5\n40 1\n255\n', new Uint8Array(40).fill(128)))
    const plainLines = new TextDecoder()
      .decode(await wide.ppm({ ascii: true }).toBuffer())
      .trimEnd()
      .split('\n')
    expect(plainLines.every((line) => line.length <= 70)).toBe(true)
  })

  it('rejects out-of-range samples, oversized headers, malformed PAM, and truncated rasters', async () => {
    const inputs = [
      textEncoder.encode('P2\n1 1\n10\n11\n'),
      textEncoder.encode(
        'P7\nWIDTH 1\nHEIGHT 1\nDEPTH 4\nMAXVAL 255\nTUPLTYPE RGB\nENDHDR\n\0\0\0\0',
      ),
      binaryFixture('P6\n2 1\n255\n', Uint8Array.of(1, 2, 3)),
      textEncoder.encode(`P2\n#${'x'.repeat(65_536)}\n1 1\n1\n0\n`),
    ]
    for (const input of inputs) {
      await expect(async () => {
        const image = await Image.open(input)
        await image.png().toBuffer()
      }).rejects.toMatchObject({ code: expect.stringMatching(/INVALID_INPUT|TRUNCATED_INPUT/) })
    }
  })
})

describe('PFM', () => {
  it('decodes little-endian grayscale and big-endian RGB with scale and bottom-up rows', async () => {
    const gray = binaryFixture('Pf\n2 2\n-2\n', floatRaster([1.5, 2, 0.5, 1], true))
    const grayDecoded = await decodeFixture(netpbmCodec, gray)
    expect(grayDecoded.decoder.pixelFormat).toBe('grayf32')
    expect(floats(grayDecoded.pixels)).toEqual([1, 2, 3, 4])

    const rgb = binaryFixture('PF\n1 2\n0.5\n', floatRaster([8, 10, 12, 2, 4, 6], false))
    const rgbDecoded = await decodeFixture(netpbmCodec, rgb)
    expect(rgbDecoded.decoder.pixelFormat).toBe('rgbf32')
    expect(floats(rgbDecoded.pixels)).toEqual([1, 2, 3, 4, 5, 6])
  })

  it('preserves negative, greater-than-one, NaN, and infinite float32 values', async () => {
    const input = binaryFixture(
      'Pf\n6 1\n-1\n',
      floatRaster(
        [-2, 0.25, 4, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY],
        true,
      ),
    )
    const values = floats((await decodeFixture(netpbmCodec, input)).pixels)

    expect(values.slice(0, 3)).toEqual([-2, 0.25, 4])
    expect(Number.isNaN(values[3])).toBe(true)
    expect(values[4]).toBe(Number.POSITIVE_INFINITY)
    expect(values[5]).toBe(Number.NEGATIVE_INFINITY)
  })

  it('encodes deterministic little- and big-endian PFM while preserving native floats', async () => {
    const input = binaryFixture('PF\n1 1\n-1\n', floatRaster([2, -3, 8], true))
    const image = await Image.open(input)
    const little = await image.pfm({ endian: 'little', scale: 2 }).toBuffer()
    const big = await image.pfm({ endian: 'big', scale: 0.5 }).toBuffer()

    expect(little).toEqual(await image.pfm({ endian: 'little', scale: 2 }).toBuffer())
    expect(new TextDecoder().decode(little.subarray(0, 16))).toContain('-2\n')
    expect(new TextDecoder().decode(big.subarray(0, 16))).toContain('0.5\n')
    expect(floats((await decodeFixture(netpbmCodec, little)).pixels)).toEqual([2, -3, 8])
    expect(floats((await decodeFixture(netpbmCodec, big)).pixels)).toEqual([2, -3, 8])
  })

  it('reports the documented convention and rejects zero scale and truncation', async () => {
    const input = binaryFixture('Pf\n1 1\n-1\n', floatRaster([1], true))
    const metadata = await netpbmCodec.metadata(new MemorySource(input), defaultImageLimits)
    expect(metadata).toMatchObject({
      variant: 'Pf',
      scale: 1,
      storageOrientation: 'bottom-to-top',
      sampleFormat: 'floating-point',
    })

    for (const malformed of [
      binaryFixture('Pf\n1 1\n0\n', floatRaster([1], true)),
      textEncoder.encode('PF\n2 2\n-1\n\0\0\0\0'),
    ]) {
      await expect(async () => {
        const image = await Image.open(malformed)
        await image.pfm().toBuffer()
      }).rejects.toMatchObject({ code: expect.stringMatching(/INVALID_INPUT|TRUNCATED_INPUT/) })
    }
  })
})
