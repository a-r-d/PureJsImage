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
import { decodeRestrictedAv1Intra, type Av1DecodedFrame } from '../src/codecs/av1-intra.ts'
import { av1ObuType, type Av1SequenceHeader } from '../src/codecs/av1.ts'
import { inspectAvifBitstreams } from '../src/codecs/avif.ts'
import { av1InverseQuantizationMatrix } from '../src/codecs/av1-qmatrix.ts'
import { MemorySource } from '../src/source.ts'
import {
  applyAv1LoopFilter,
  applyAv1LoopRestoration,
  type Av1FilterPlane,
  type Av1PostFilterState,
  type Av1RestorationPlaneState,
} from '../src/codecs/av1-post-filter.ts'

const packVisibleYuv = (frame: Av1DecodedFrame): Uint8Array => {
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
const restorationUnitCount = (unitSize: number, size: number): number =>
  Math.max(Math.floor((size + (unitSize >> 1)) / unitSize), 1)

const createRestorationPlaneState = (
  width: number,
  height: number,
  unitSize: number,
  type: 0 | 1 | 2,
): Av1RestorationPlaneState => {
  const columns = restorationUnitCount(unitSize, width)
  const rows = restorationUnitCount(unitSize, height)
  const units = columns * rows
  const types = new Uint8Array(units)
  types.fill(type)
  return {
    columns,
    rows,
    sgrSets: new Uint8Array(units),
    sgrXqd: new Int16Array(units * 2),
    types,
    unitSize,
    wiener: new Int8Array(units * 6),
  }
}

const createPostFilterState = (
  width: number,
  height: number,
  unitSize: number,
  type: 0 | 1 | 2,
): Av1PostFilterState => {
  const empty = new Uint8Array(0)
  return {
    bitDepth: 10,
    cdefColumns: 0,
    cdefIndices: new Uint16Array(0),
    chromaShiftX: 1,
    chromaShiftY: 1,
    contextMiColumns: 0,
    contextMiRows: 0,
    miColumns: 0,
    miColumnStart: 0,
    miRows: 0,
    miRowStart: 0,
    restoration: [
      createRestorationPlaneState(width, height, unitSize, type),
      createRestorationPlaneState(Math.ceil(width / 2), Math.ceil(height / 2), unitSize, type),
      createRestorationPlaneState(Math.ceil(width / 2), Math.ceil(height / 2), unitSize, type),
    ],
    skips: empty,
    segmentIds: empty,
    transformHeights: [empty, empty, empty],
    transformWidths: [empty, empty, empty],
  }
}

const createFilterPlanes = (
  width: number,
  height: number,
): [Av1FilterPlane, Av1FilterPlane, Av1FilterPlane] => {
  const plane = (planeWidth: number, planeHeight: number, seed: number): Av1FilterPlane => {
    const data = new Uint16Array(planeWidth * planeHeight)
    for (let index = 0; index < data.length; index += 1) {
      data[index] = (index * 17 + seed) & 1_023
    }
    return { data, height: planeHeight, stride: planeWidth, width: planeWidth }
  }
  const chromaWidth = Math.ceil(width / 2)
  const chromaHeight = Math.ceil(height / 2)
  return [
    plane(width, height, 3),
    plane(chromaWidth, chromaHeight, 7),
    plane(chromaWidth, chromaHeight, 11),
  ]
}

const restorationHeader = (
  header: Av1FrameHeader,
  width: number,
  height: number,
  unitSize: number,
  type: 0 | 1 | 2,
): Av1FrameHeader => ({
  ...header,
  frameHeight: height,
  frameWidth: width,
  renderHeight: height,
  renderWidth: width,
  restorationTypes: [type, type, type],
  restorationUnitSizes: [unitSize, unitSize, unitSize],
  upscaledWidth: width,
})
const replaceFirstRestorationPlane = (
  state: Av1PostFilterState,
  plane: Av1RestorationPlaneState,
): Av1PostFilterState => ({
  ...state,
  restoration: [plane, state.restoration[1], state.restoration[2]],
})

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

  it('applies segment-specific loop-filter levels at transform edges', async () => {
    const { header: sourceHeader } = await decodeFixture('post-filter-deblock-96x74.avif')
    const featureEnabled = Array.from({ length: 8 }, () => Array.from({ length: 8 }, () => false))
    const featureData = Array.from({ length: 8 }, () => Array.from({ length: 8 }, () => 0))
    const segmentOneFeatures = featureEnabled[1]
    const segmentOneData = featureData[1]
    if (!segmentOneFeatures || !segmentOneData) throw new Error('Segment state is missing')
    segmentOneFeatures[1] = true
    segmentOneData[1] = -20
    const header: Av1FrameHeader = {
      ...sourceHeader,
      frameHeight: 4,
      frameWidth: 8,
      loopFilterDeltaEnabled: false,
      loopFilterLevels: [20, 0, 0, 0],
      renderHeight: 4,
      renderWidth: 8,
      segmentation: {
        enabled: true,
        featureData,
        featureEnabled,
        lastActiveId: 1,
        preSkip: true,
      },
      upscaledWidth: 8,
    }
    const empty = new Uint8Array(0)
    const state: Av1PostFilterState = {
      ...createPostFilterState(8, 4, 64, 0),
      bitDepth: 8,
      contextMiColumns: 2,
      contextMiRows: 1,
      miColumns: 2,
      miRows: 1,
      segmentIds: Uint8Array.of(0, 1),
      skips: Uint8Array.of(0, 0),
      transformHeights: [Uint8Array.of(4, 4), empty, empty],
      transformWidths: [Uint8Array.of(4, 4), empty, empty],
    }
    const source = Uint16Array.from([
      96, 96, 96, 96, 104, 104, 104, 104, 96, 96, 96, 96, 104, 104, 104, 104, 96, 96, 96, 96, 104,
      104, 104, 104, 96, 96, 96, 96, 104, 104, 104, 104,
    ])
    const planes = (): [Av1FilterPlane, Av1FilterPlane, Av1FilterPlane] => [
      { data: Uint16Array.from(source), height: 4, stride: 8, width: 8 },
      { data: new Uint16Array(8), height: 2, stride: 4, width: 4 },
      { data: new Uint16Array(8), height: 2, stride: 4, width: 4 },
    ]
    const baseFiltered = planes()
    applyAv1LoopFilter(
      baseFiltered,
      {
        ...header,
        segmentation: {
          ...header.segmentation,
          featureEnabled: Array.from({ length: 8 }, () => Array.from({ length: 8 }, () => false)),
        },
      },
      state,
    )
    const segmentFiltered = planes()
    applyAv1LoopFilter(segmentFiltered, header, state)

    expect(baseFiltered[0].data).not.toEqual(source)
    expect(segmentFiltered[0].data).toEqual(source)
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
  it('rejects a truncated restoration-unit payload', async () => {
    const { frame, sequence } = await decodeFixture('post-filter-restoration-units-300x130.avif')
    const lastTile = frame.tiles.at(-1)
    if (!lastTile) throw new Error('Restoration fixture has no AV1 tile')
    const tiles = frame.tiles.map((tile, index) =>
      index === frame.tiles.length - 1
        ? { ...tile, data: tile.data.subarray(0, tile.data.length - 1) }
        : tile,
    )

    expect(() => decodeRestrictedAv1Intra(sequence, { ...frame, tiles })).toThrow(
      expect.objectContaining({
        code: 'INVALID_INPUT',
        message: 'AV1 symbol decoder over-read its tile',
      }),
    )
  })

  it('rejects invalid Wiener coefficients before filtering', async () => {
    const { header: sourceHeader } = await decodeFixture('post-filter-wiener-sgr-66x70.avif')
    const width = 99
    const height = 67
    const header = restorationHeader(sourceHeader, width, height, 64, 1)
    const state = createPostFilterState(width, height, 64, 1)
    state.restoration[0].wiener[0] = 11

    expect(() =>
      applyAv1LoopRestoration(
        createFilterPlanes(width, height),
        createFilterPlanes(width, height),
        header,
        state,
      ),
    ).toThrow(
      expect.objectContaining({ message: 'AV1 Wiener restoration coefficients are invalid' }),
    )
  })

  it.each([
    {
      mutate: (plane: Av1RestorationPlaneState): void => {
        plane.sgrSets[0] = 16
      },
      name: 'set',
    },
    {
      mutate: (plane: Av1RestorationPlaneState): void => {
        plane.sgrXqd[0] = -97
      },
      name: 'projection weight',
    },
  ])('rejects an invalid self-guided restoration $name', async ({ mutate }) => {
    const { header: sourceHeader } = await decodeFixture('post-filter-wiener-sgr-66x70.avif')
    const width = 99
    const height = 67
    const header = restorationHeader(sourceHeader, width, height, 64, 2)
    const state = createPostFilterState(width, height, 64, 2)
    mutate(state.restoration[0])

    expect(() =>
      applyAv1LoopRestoration(
        createFilterPlanes(width, height),
        createFilterPlanes(width, height),
        header,
        state,
      ),
    ).toThrow(
      expect.objectContaining({ message: 'AV1 self-guided restoration parameters are invalid' }),
    )
  })

  it('rejects truncated restoration state before allocating filter bands', async () => {
    const { header: sourceHeader } = await decodeFixture('post-filter-wiener-sgr-66x70.avif')
    const width = 99
    const height = 67
    const header = restorationHeader(sourceHeader, width, height, 64, 1)
    const state = createPostFilterState(width, height, 64, 1)
    const truncated = replaceFirstRestorationPlane(state, {
      ...state.restoration[0],
      types: state.restoration[0].types.subarray(0, state.restoration[0].types.length - 1),
    })

    expect(() =>
      applyAv1LoopRestoration(
        createFilterPlanes(width, height),
        createFilterPlanes(width, height),
        header,
        truncated,
      ),
    ).toThrow(expect.objectContaining({ message: 'AV1 restoration unit state is truncated' }))
  })

  it('limits Wiener writes to partial edge restoration units', async () => {
    const { header: sourceHeader } = await decodeFixture('post-filter-wiener-sgr-66x70.avif')
    const width = 99
    const height = 64
    const header = restorationHeader(sourceHeader, width, height, 64, 1)
    const state = createPostFilterState(width, height, 64, 1)
    const cdef = createFilterPlanes(width, height)
    const expected = cdef.map((plane) => plane.data.slice())
    const output = applyAv1LoopRestoration(createFilterPlanes(width, height), cdef, header, state)

    expect([state.restoration[0].columns, state.restoration[0].rows]).toEqual([2, 1])
    expect(output.map((plane) => plane.data)).toEqual(expected)
  })

  it('bounds self-guided restoration at odd frame and chroma dimensions', async () => {
    const { header: sourceHeader } = await decodeFixture('post-filter-wiener-sgr-66x70.avif')
    const width = 99
    const height = 99
    const header = restorationHeader(sourceHeader, width, height, 64, 2)
    const state = createPostFilterState(width, height, 64, 2)
    const output = applyAv1LoopRestoration(
      createFilterPlanes(width, height),
      createFilterPlanes(width, height),
      header,
      state,
    )

    expect([state.restoration[0].columns, state.restoration[0].rows]).toEqual([2, 2])
    expect(output.map((plane) => [plane.data.length, plane.width, plane.height])).toEqual([
      [99 * 99, 99, 99],
      [50 * 50, 50, 50],
      [50 * 50, 50, 50],
    ])
    expect(output.every((plane) => plane.data.every((sample) => sample <= 1_023))).toBe(true)
  })

  it('rejects invalid restoration unit sizes before restoration-state allocation', async () => {
    const { frame, sequence } = await decodeFixture('post-filter-wiener-sgr-66x70.avif')
    const invalidFrame: Av1Frame = {
      ...frame,
      header: { ...frame.header, restorationUnitSizes: [16, 256, 256] },
    }

    expect(() => decodeRestrictedAv1Intra(sequence, invalidFrame)).toThrow(
      expect.objectContaining({ message: 'AV1 restoration unit size is invalid' }),
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
