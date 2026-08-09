import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  avifPostFilterFixtureDirectory,
  avifPostFilterFixtures,
} from '../benchmark/avif/post-filter-fixtures.ts'
import { avifQmatrixFixtures } from '../benchmark/avif/qmatrix-fixtures.ts'
import { parseAv1Frame, type Av1Frame, type Av1FrameHeader } from '../src/codecs/av1-frame.ts'
import { decodeRestrictedAv1Intra, type Av1Yuv420Frame } from '../src/codecs/av1-intra.ts'
import { av1ObuType, type Av1SequenceHeader } from '../src/codecs/av1.ts'
import { inspectAvifBitstreams } from '../src/codecs/avif.ts'
import { av1InverseQuantizationMatrix } from '../src/codecs/av1-qmatrix.ts'
import { MemorySource } from '../src/source.ts'

const packVisibleYuv = (frame: Av1Yuv420Frame): Uint8Array => {
  const output = new Uint8Array(
    frame.width * frame.height + 2 * frame.chromaWidth * frame.chromaHeight,
  )
  let offset = 0
  for (let row = 0; row < frame.height; row += 1) {
    output.set(frame.y.subarray(row * frame.yStride, row * frame.yStride + frame.width), offset)
    offset += frame.width
  }
  for (const plane of [frame.u, frame.v]) {
    for (let row = 0; row < frame.chromaHeight; row += 1) {
      output.set(
        plane.subarray(row * frame.chromaStride, row * frame.chromaStride + frame.chromaWidth),
        offset,
      )
      offset += frame.chromaWidth
    }
  }
  return output
}

const decodeFixture = async (
  file: string,
): Promise<{
  readonly frame: Av1Frame
  readonly header: Av1FrameHeader
  readonly sequence: Av1SequenceHeader
  readonly yuv: Uint8Array
}> => {
  const input = new Uint8Array(await readFile(join(avifPostFilterFixtureDirectory, file)))
  const inspection = await inspectAvifBitstreams(new MemorySource(input))
  const coded = inspection.codedImages.find((image) => image.role === 'color')
  if (!coded) throw new Error('AVIF post-filter fixture has no color item')
  const obu = coded.obus.find((candidate) => candidate.type === av1ObuType.frame)
  if (!obu) throw new Error('AVIF post-filter fixture has no frame OBU')
  const frame = parseAv1Frame(coded.sequence, obu.payload)
  return {
    frame,
    header: frame.header,
    sequence: coded.sequence,
    yuv: packVisibleYuv(decodeRestrictedAv1Intra(coded.sequence, frame)),
  }
}

describe('AV1 post-reconstruction filters', () => {
  it.each(avifPostFilterFixtures)(
    'matches the independently decoded YUV pixels for $id',
    async (fixture) => {
      const input = await readFile(join(avifPostFilterFixtureDirectory, fixture.file))
      expect(createHash('sha256').update(input).digest('hex')).toBe(fixture.fileSha256)

      const decoded = await decodeFixture(fixture.file)
      expect([decoded.header.renderWidth, decoded.header.renderHeight]).toEqual([
        fixture.width,
        fixture.height,
      ])
      expect(createHash('sha256').update(decoded.yuv).digest('hex')).toBe(fixture.yuvSha256)
    },
  )

  it('keeps every post-filter disabled when the frame signals no filtering', async () => {
    const { header } = await decodeFixture('post-filter-disabled-66x70.avif')

    expect(header.loopFilterLevels).toEqual([0, 0, 0, 0])
    expect(header.cdefYPrimaryStrengths).toEqual([0])
    expect(header.cdefUvPrimaryStrengths).toEqual([0])
    expect(header.restorationTypes).toEqual([0, 0, 0])
  })

  it('covers deblocking at odd frame boundaries and luma/chroma CDEF strengths', async () => {
    const deblock = await decodeFixture('post-filter-deblock-96x74.avif')
    const cdef = await decodeFixture('post-filter-cdef-66x70.avif')

    expect(deblock.header.loopFilterLevels).toEqual([6, 6, 6, 6])
    expect(deblock.header.cdefYPrimaryStrengths).toEqual([0])
    expect(cdef.header.loopFilterLevels).toEqual([0, 0, 0, 0])
    expect(cdef.header.cdefYPrimaryStrengths).toEqual([11, 0])
    expect(cdef.header.cdefUvPrimaryStrengths).toEqual([11, 11])
  })

  it('covers Wiener, self-guided, and multiple restoration-unit decisions', async () => {
    const mixed = await decodeFixture('post-filter-wiener-sgr-66x70.avif')
    const units = await decodeFixture('post-filter-restoration-units-300x130.avif')

    expect(mixed.header.restorationTypes).toEqual([1, 2, 0])
    expect(units.header.restorationTypes).toEqual([2, 2, 2])
    expect(units.header.restorationUnitSizes).toEqual([256, 256, 256])
    expect(Math.ceil(units.header.upscaledWidth / 256)).toBe(2)
  })

  it('does not expose undecoded below-left luma across superblock rows', async () => {
    const decoded = await decodeFixture('fox.profile0.8bpc.yuv420.avif')
    const visibleLuma = decoded.yuv.subarray(0, 1204 * 800)

    expect(createHash('sha256').update(visibleLuma).digest('hex')).toBe(
      'a0d2f16c5eec8b8cf6c4f973b8e2bfea864fb868e45789e785cb9d688444325d',
    )
  })

  it('covers both superblock sizes across luma and chroma reconstruction', async () => {
    const blocks64 = await decodeFixture('post-filter-restoration-units-300x130.avif')
    const blocks128 = await decodeFixture('fox.profile0.8bpc.yuv420.avif')

    expect(blocks64.sequence.use128x128Superblock).toBe(false)
    expect(blocks128.sequence.use128x128Superblock).toBe(true)
    expect(createHash('sha256').update(blocks64.yuv).digest('hex')).toBe(
      '76dafc8db06b678046b403d02e250b17f6c6701196b10f944b75ecf757e033e8',
    )
    expect(createHash('sha256').update(blocks128.yuv).digest('hex')).toBe(
      'a9f523bde5a466a809c019a31731e902b6039e94310ae7f5128b78416892c02d',
    )
  })

  it('keeps the flat quantization-matrix level pixel-identical', async () => {
    const { frame, sequence } = await decodeFixture('post-filter-disabled-66x70.avif')
    const qmatrixFrame: Av1Frame = {
      ...frame,
      header: { ...frame.header, usingQMatrix: true, qmY: 15, qmU: 15, qmV: 15 },
    }

    expect(packVisibleYuv(decodeRestrictedAv1Intra(sequence, qmatrixFrame))).toEqual(
      packVisibleYuv(decodeRestrictedAv1Intra(sequence, frame)),
    )
  })
})

describe('AV1 quantization matrices', () => {
  it('exposes the normative luma weights and flat level', () => {
    expect(Array.from(av1InverseQuantizationMatrix(0, 0, 4, 4) ?? [])).toEqual([
      32, 43, 73, 97, 43, 67, 94, 110, 73, 94, 137, 150, 97, 110, 150, 200,
    ])
    expect(av1InverseQuantizationMatrix(15, 0, 4, 4)).toBeUndefined()
  })

  it('uses the adjusted 32x32 matrix dimensions for 64-point transforms', () => {
    expect(av1InverseQuantizationMatrix(0, 0, 64, 64)).toEqual(
      av1InverseQuantizationMatrix(0, 0, 32, 32),
    )
    expect(av1InverseQuantizationMatrix(0, 1, 64, 16)).toEqual(
      av1InverseQuantizationMatrix(0, 1, 32, 16),
    )
  })

  it.each(avifQmatrixFixtures)(
    'matches independently decoded Sharp q$quality YUV pixels',
    async (fixture) => {
      const input = await readFile(join(avifPostFilterFixtureDirectory, fixture.file))
      expect(createHash('sha256').update(input).digest('hex')).toBe(fixture.fileSha256)

      const decoded = await decodeFixture(fixture.file)
      expect([decoded.header.renderWidth, decoded.header.renderHeight]).toEqual([
        fixture.width,
        fixture.height,
      ])
      expect(decoded.header.baseQuantizer).toBe(fixture.baseQuantizer)
      expect(decoded.header.usingQMatrix).toBe(true)
      expect([decoded.header.qmY, decoded.header.qmU, decoded.header.qmV]).toEqual(
        fixture.matrixLevels,
      )
      expect(decoded.header.deltaQPresent).toBe(true)
      expect(decoded.header.deltaQResolution).toBe(fixture.deltaQResolution)
      expect(decoded.header.deltaLfPresent).toBe(false)
      expect(createHash('sha256').update(decoded.yuv).digest('hex')).toBe(fixture.decodedYuvSha256)
    },
  )

  it('keeps delta loop-filter syntax explicitly unsupported', async () => {
    const { frame, sequence } = await decodeFixture('sharp-qmatrix-q50-256x192.avif')
    const deltaLoopFilterFrame: Av1Frame = {
      ...frame,
      header: { ...frame.header, deltaLfPresent: true },
    }

    expect(() => decodeRestrictedAv1Intra(sequence, deltaLoopFilterFrame)).toThrow(
      'does not support AV1 loop-filter deltas',
    )
  })
})
