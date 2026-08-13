import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { PNG } from 'pngjs'
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'

import {
  avifColorFixturePath,
  avifHdrConstantLuminanceFixture,
  avifHdrToneMapOracle,
} from '../benchmark/avif/color-fixtures.ts'
import {
  avifHighBitExpandedFixturePath,
  avifHighBitExpandedFixtures,
} from '../benchmark/avif/high-bit-expanded-fixtures.ts'
import {
  avifBoundedFilteredFixture,
  avifBoundedFilteredFixturePath,
} from '../benchmark/avif/lossy-multitile-fixture.ts'
import { av1ObuType } from '../src/codecs/av1.ts'
import { parseAv1Frame, parseAv1FrameObus } from '../src/codecs/av1-frame.ts'
import {
  decodeRestrictedAv1Intra,
  estimateRestrictedAv1WorkingBytes,
} from '../src/codecs/av1-intra.ts'
import { avifCodec, inspectAvifBitstreams, validateAvifWorkingBytes } from '../src/codecs/avif.ts'
import { defaultImageLimits } from '../src/limits.ts'
import { MemorySource } from '../src/source.ts'
import { Image } from './image-library.ts'

// Sharp/libvips produces different RGB oracle hashes for these fixtures on macOS. Other platforms
// retain the full interoperability gate, and every other high-bit fixture still runs on macOS.
const macosSharpOracleMismatchFiles = new Set([
  'restoration-matrix-wiener-12bpc-yuv422-642x386.avif',
  'restoration-matrix-sgr-12bpc-yuv422-642x386.avif',
  'restoration-matrix-switchable-12bpc-yuv444-642x386.avif',
])

describe('AVIF high-bit and large tiled decode', () => {
  it.for(avifHighBitExpandedFixtures)(
    'decodes expanded $bitDepth-bit $chromaSubsampling AVIF fixture $file',
    async (fixture, { skip }) => {
      skip(
        process.platform === 'darwin' && macosSharpOracleMismatchFiles.has(fixture.file),
        'Sharp/libvips produces a platform-variable RGB oracle on macOS',
      )
      const input = await readFile(avifHighBitExpandedFixturePath(fixture))
      const inspection = await inspectAvifBitstreams(new MemorySource(input))
      const coded = inspection.codedImages.find((image) => image.role === 'color')
      const frameObu = coded?.obus.find((obu) => obu.type === av1ObuType.frame)
      if (!coded || !frameObu) throw new Error('Expanded high-bit fixture has no AV1 frame OBU')
      const frame = parseAv1Frame(coded.sequence, frameObu.payload)
      const decoded = decodeRestrictedAv1Intra(coded.sequence, frame)
      const output = PNG.sync.read(await (await Image.open(input)).png().toBuffer())

      expect(createHash('sha256').update(input).digest('hex')).toBe(fixture.fileSha256)
      expect(coded.sequence).toMatchObject({
        bitDepth: fixture.bitDepth,
        chromaSubsampling: fixture.chromaSubsampling,
        fullRange: fixture.fullRange ?? true,
      })
      expect(frame.header.codedLossless).toBe(fixture.codedLossless)
      expect(frame.header.loopFilterLevels.some((level) => level !== 0)).toBe(
        fixture.filters.includes('deblock'),
      )
      expect(
        [
          ...frame.header.cdefYPrimaryStrengths,
          ...frame.header.cdefYSecondaryStrengths,
          ...frame.header.cdefUvPrimaryStrengths,
          ...frame.header.cdefUvSecondaryStrengths,
        ].some((strength) => strength !== 0),
      ).toBe(fixture.filters.includes('cdef'))
      expect(frame.header.restorationTypes.some((type) => type === 1)).toBe(
        fixture.filters.includes('wiener'),
      )
      expect(frame.header.restorationTypes.some((type) => type === 2)).toBe(
        fixture.filters.includes('self-guided'),
      )
      const nativeYuv = Buffer.alloc(
        (decoded.width * decoded.height + 2 * decoded.chromaWidth * decoded.chromaHeight) * 2,
      )
      let offset = 0
      for (const [plane, stride, width, height] of [
        [decoded.y, decoded.yStride, decoded.width, decoded.height],
        [decoded.u, decoded.chromaStride, decoded.chromaWidth, decoded.chromaHeight],
        [decoded.v, decoded.chromaStride, decoded.chromaWidth, decoded.chromaHeight],
      ] as const) {
        for (let y = 0; y < height; y += 1) {
          for (let x = 0; x < width; x += 1) {
            nativeYuv.writeUInt16LE(plane[y * stride + x] ?? 0, offset)
            offset += 2
          }
        }
      }
      expect(createHash('sha256').update(nativeYuv).digest('hex')).toBe(fixture.nativeYuvSha256)
      expect(createHash('sha256').update(output.data).digest('hex')).toBe(fixture.decodedRgbaSha256)
      if (fixture.sharpRgbSha256 !== undefined && fixture.maximumSharpRgbDifference !== undefined) {
        const { data: oracle, info } = await sharp(input)
          .removeAlpha()
          .raw()
          .toBuffer({ resolveWithObject: true })
        expect([info.width, info.height, info.channels]).toEqual([fixture.width, fixture.height, 3])
        expect(createHash('sha256').update(oracle).digest('hex')).toBe(fixture.sharpRgbSha256)
        let maximumDifference = 0
        for (let pixel = 0; pixel < fixture.width * fixture.height; pixel += 1) {
          for (let channel = 0; channel < 3; channel += 1) {
            maximumDifference = Math.max(
              maximumDifference,
              Math.abs(
                (output.data[pixel * 4 + channel] ?? 0) - (oracle[pixel * 3 + channel] ?? 0),
              ),
            )
          }
        }
        expect(maximumDifference).toBe(fixture.maximumSharpRgbDifference)
      }
    },
  )

  it('decodes a filtered 4K 8x2 AV1 tile layout within the default memory limit', async () => {
    const fixture = avifBoundedFilteredFixture
    const input = await readFile(avifBoundedFilteredFixturePath)
    const inspection = await inspectAvifBitstreams(new MemorySource(input))
    const coded = inspection.codedImages.find((image) => image.role === 'color')
    if (!coded) throw new Error('Bounded filtered AVIF fixture has no color coded image')
    const frame = parseAv1FrameObus(coded.sequence, coded.obus)
    const decoder = await avifCodec.createDecoder?.(new MemorySource(input), defaultImageLimits)
    if (!decoder) throw new Error('AVIF decoder is unavailable')
    const hash = createHash('sha256')
    let outputY = 0
    for await (const block of decoder.decode()) {
      expect(block).toMatchObject({
        x: 0,
        y: outputY,
        width: fixture.width,
        stride: fixture.width * 4,
      })
      expect(block.height).toBeLessThanOrEqual(32)
      hash.update(block.data.subarray(0, block.stride * block.height))
      outputY += block.height
    }

    expect(createHash('sha256').update(input).digest('hex')).toBe(fixture.fileSha256)
    expect(frame.header).toMatchObject({
      allLossless: false,
      tileColumns: fixture.columns,
      tileRows: fixture.rows,
      restorationTypes: [0, 0, 0],
    })
    expect(frame.header.loopFilterLevels.some((level) => level !== 0)).toBe(true)
    expect(frame.header.cdefYPrimaryStrengths.some((strength) => strength !== 0)).toBe(true)
    expect(frame.tiles).toHaveLength(fixture.columns * fixture.rows)
    expect(() =>
      validateAvifWorkingBytes(estimateRestrictedAv1WorkingBytes(coded.sequence, frame)),
    ).not.toThrow()
    expect(outputY).toBe(fixture.height)
    expect(hash.digest('hex')).toBe(fixture.decodedRgbaSha256)
  }, 30_000)

  it('tone-maps BT.2020 constant-luminance matrix 10 pixels', async () => {
    const fixture = avifHdrConstantLuminanceFixture
    const input = await readFile(avifColorFixturePath(fixture))
    const inspection = await inspectAvifBitstreams(new MemorySource(input))
    const output = PNG.sync.read(await (await Image.open(input)).png().toBuffer())

    expect(createHash('sha256').update(input).digest('hex')).toBe(fixture.fileSha256)
    expect(inspection.gainMap).toBeUndefined()
    expect(inspection.nclx).toMatchObject({
      primaries: fixture.primaries,
      transferCharacteristics: fixture.transferCharacteristics,
      matrixCoefficients: fixture.matrixCoefficients,
      fullRange: true,
    })
    expect([output.width, output.height]).toEqual([fixture.width, fixture.height])
    expect(createHash('sha256').update(output.data).digest('hex')).toBe(fixture.rgbaSha256)
    for (const sample of fixture.oracleSamples) {
      const offset = sample.pixel * 4
      for (let channel = 0; channel < 3; channel += 1) {
        const error = Math.abs((output.data[offset + channel] ?? 0) - (sample.rgb[channel] ?? 0))
        expect(error, avifHdrToneMapOracle).toBeLessThanOrEqual(fixture.maximumAbsoluteError)
      }
    }
  }, 20_000)
})
