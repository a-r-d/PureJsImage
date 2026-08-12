import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { PNG } from 'pngjs'
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { avifAlphaFixtures, avifGainMapFixtures } from '../benchmark/avif/alpha-fixtures.ts'
import {
  avifAnimationAlphaFixture,
  avifAnimationAlphaFixturePath,
  avifAnimationAlphaOraclePath,
  avifAnimationFixture,
  avifAnimationFixturePath,
  avifAnimationKeyFrames,
  avifAnimationOraclePath,
} from '../benchmark/avif/animation-fixture.ts'
import {
  avifAlphaGridFixture,
  avifAlphaTransformDecodedRgbaSha256,
  avifAlphaTransformFixtures,
  avifAuxiliaryFixtureDirectory,
  avifAuxiliaryRoleFixtures,
} from '../benchmark/avif/auxiliary-fixtures.ts'
import {
  avifCleanApertureFixture,
  avifCleanApertureFixtureDirectory,
  avifFractionalCleanApertureFixture,
} from '../benchmark/avif/clean-aperture-fixture.ts'
import {
  avifColorFixturePath,
  avifHdrChromaDerivedFixture,
  avifHdrGainMapFixture,
  avifHdrToneMapFixtures,
  avifHdrToneMapOracle,
  avifIccFixtures,
  avifRec2020Fixture,
  avifWrongAlternativeGainMapFixture,
} from '../benchmark/avif/color-fixtures.ts'
import { avifCorpusDirectory } from '../benchmark/avif/corpus.ts'
import {
  avifDependentLayerFixture,
  avifDependentLayerFixturePath,
  avifSelectedBaseLayerFixture,
  avifSelectedBaseLayerFixturePath,
} from '../benchmark/avif/dependent-layer-fixture.ts'
import {
  avifFilmGrainFixture,
  avifFilmGrainFixturePath,
} from '../benchmark/avif/film-grain-fixture.ts'
import {
  avifHighBitLosslessFixtureDirectory,
  avifHighBitLosslessFixtures,
} from '../benchmark/avif/high-bit-lossless-fixtures.ts'
import { avifLayeredFixture, avifLayeredFixturePath } from '../benchmark/avif/layered-fixture.ts'
import {
  avifFullHeaderTileGroupsFixture,
  avifFullHeaderTileGroupsFixturePath,
  avifLossyMultitileFixture,
  avifLossyMultitileFixturePath,
} from '../benchmark/avif/lossy-multitile-fixture.ts'
import { avifMirrorFixturePath, avifMirrorFixtures } from '../benchmark/avif/mirror-fixtures.ts'
import {
  avifQ0FixtureDirectory,
  avifQ0LosslessFixture,
  avifQ0LossyFixture,
} from '../benchmark/avif/q0-fixtures.ts'
import {
  avifBoundedAlphaRowFixture,
  avifBoundedAlphaRowFixturePath,
} from '../benchmark/avif/row-alpha-fixture.ts'
import { avifBoundedRowFixture, avifBoundedRowFixturePath } from '../benchmark/avif/row-fixture.ts'
import {
  avifSegmentationFixture,
  avifSegmentationFixturePath,
} from '../benchmark/avif/segmentation-fixture.ts'
import {
  avifBoundedSuperresFixture,
  avifBoundedSuperresFixturePath,
  avifFilteredSuperresFixture,
  avifFilteredSuperresFixturePath,
  avifSuperres420Fixture,
  avifSuperres420FixturePath,
  avifSuperresFixture,
  avifSuperresFixturePath,
} from '../benchmark/avif/superres-fixture.ts'
import {
  avifTiledLosslessFixture,
  avifTiledLosslessFixturePath,
  tiledLosslessSample,
} from '../benchmark/avif/tiled-lossless-fixture.ts'
import { av1ObuType } from '../src/codecs/av1.ts'
import { inspectAv1FrameHeader, parseAv1Frame, parseAv1FrameObus } from '../src/codecs/av1-frame.ts'
import { type Av1DecodedFrame, decodeRestrictedAv1Intra } from '../src/codecs/av1-intra.ts'
import {
  avifCodec,
  inspectAvifBitstreams,
  validateAvifFrameDimensions,
  validateAvifWorkingBytes,
} from '../src/codecs/avif.ts'
import { createNclxHdrToneMap, writeNclxHdrToneMappedRgba } from '../src/codecs/icc.ts'
import { defaultImageLimits } from '../src/limits.ts'
import { Uint8ArraySink } from '../src/sink.ts'
import { MemorySource } from '../src/source.ts'
import { channelSwappingRgbProfile } from './icc-fixtures.ts'
import { Image } from './image-library.ts'

const _visibleYuvSha256 = (frame: Av1DecodedFrame): string => {
  const hash = createHash('sha256')
  for (let row = 0; row < frame.height; row += 1) {
    hash.update(frame.y.subarray(row * frame.yStride, row * frame.yStride + frame.width))
  }
  for (const plane of [frame.u, frame.v]) {
    for (let row = 0; row < frame.chromaHeight; row += 1) {
      hash.update(
        plane.subarray(row * frame.chromaStride, row * frame.chromaStride + frame.chromaWidth),
      )
    }
  }
  return hash.digest('hex')
}

const bytes32 = (value: number): readonly number[] => [
  (value >>> 24) & 0xff,
  (value >>> 16) & 0xff,
  (value >>> 8) & 0xff,
  value & 0xff,
]

const ascii = (value: string): readonly number[] =>
  [...value].map((character) => character.charCodeAt(0))

const box = (type: string, payload: readonly number[]): readonly number[] => [
  ...bytes32(payload.length + 8),
  ...ascii(type),
  ...payload,
]

const fullBox = (
  type: string,
  payload: readonly number[],
  version = 0,
  flags = 0,
): readonly number[] =>
  box(type, [version, (flags >>> 16) & 0xff, (flags >>> 8) & 0xff, flags & 0xff, ...payload])

interface AnimationTrackBoxPath {
  readonly edtsStart: number
  readonly elstStart: number
  readonly mdhdStart: number
  readonly moovStart: number
  readonly sampleEntryStart: number
  readonly stblStart: number
  readonly stsdStart: number
  readonly sttsStart: number
  readonly mdiaStart: number
  readonly minfStart: number
  readonly trackStart: number
}

const boxTypeEquals = (input: Uint8Array, offset: number, type: string): boolean => {
  if (offset < 0 || offset + 4 > input.byteLength || type.length !== 4) return false
  for (let index = 0; index < 4; index += 1) {
    if (input[offset + index] !== type.charCodeAt(index)) return false
  }
  return true
}

const fixtureBoxSize = (input: Uint8Array, start: number): number => {
  if (start < 0 || start + 8 > input.byteLength) throw new Error('Fixture box is truncated')
  const size = new DataView(input.buffer, input.byteOffset, input.byteLength).getUint32(start)
  if (size < 8 || size > input.byteLength - start) {
    throw new Error('Fixture box has an invalid size')
  }
  return size
}

const findFixtureChildBox = (
  input: Uint8Array,
  start: number,
  end: number,
  type: string,
  occurrence = 0,
): number => {
  if (
    start < 0 ||
    end < start ||
    end > input.byteLength ||
    !Number.isSafeInteger(occurrence) ||
    occurrence < 0
  ) {
    throw new Error('Fixture child-box bounds are invalid')
  }
  let offset = start
  let matches = 0
  while (offset < end) {
    const size = fixtureBoxSize(input, offset)
    if (size > end - offset) throw new Error('Fixture child box exceeds its parent')
    if (boxTypeEquals(input, offset + 4, type)) {
      if (matches === occurrence) return offset
      matches += 1
    }
    offset += size
  }
  throw new Error(`Fixture has no ${type} child box ${occurrence}`)
}

const animationTrackBoxPath = (input: Uint8Array, trackIndex: number): AnimationTrackBoxPath => {
  const moovStart = findFixtureChildBox(input, 0, input.byteLength, 'moov')
  const moovEnd = moovStart + fixtureBoxSize(input, moovStart)
  const trackStart = findFixtureChildBox(input, moovStart + 8, moovEnd, 'trak', trackIndex)
  const trackEnd = trackStart + fixtureBoxSize(input, trackStart)
  const edtsStart = findFixtureChildBox(input, trackStart + 8, trackEnd, 'edts')
  const edtsEnd = edtsStart + fixtureBoxSize(input, edtsStart)
  const elstStart = findFixtureChildBox(input, edtsStart + 8, edtsEnd, 'elst')
  const mdiaStart = findFixtureChildBox(input, trackStart + 8, trackEnd, 'mdia')
  const mdiaEnd = mdiaStart + fixtureBoxSize(input, mdiaStart)
  const mdhdStart = findFixtureChildBox(input, mdiaStart + 8, mdiaEnd, 'mdhd')
  const minfStart = findFixtureChildBox(input, mdiaStart + 8, mdiaEnd, 'minf')
  const minfEnd = minfStart + fixtureBoxSize(input, minfStart)
  const stblStart = findFixtureChildBox(input, minfStart + 8, minfEnd, 'stbl')
  const stblEnd = stblStart + fixtureBoxSize(input, stblStart)
  const stsdStart = findFixtureChildBox(input, stblStart + 8, stblEnd, 'stsd')
  const sttsStart = findFixtureChildBox(input, stblStart + 8, stblEnd, 'stts')
  const sampleEntryStart = stsdStart + 16
  const stsdEnd = stsdStart + fixtureBoxSize(input, stsdStart)
  if (
    sampleEntryStart + 8 > stsdEnd ||
    !boxTypeEquals(input, sampleEntryStart + 4, 'av01') ||
    sampleEntryStart + fixtureBoxSize(input, sampleEntryStart) !== stsdEnd
  ) {
    throw new Error('Fixture AV1 sample entry is not singular or is malformed')
  }
  return {
    edtsStart,
    elstStart,
    mdhdStart,
    moovStart,
    sampleEntryStart,
    stblStart,
    stsdStart,
    sttsStart,
    mdiaStart,
    minfStart,
    trackStart,
  }
}

const scaledUint32 = (value: number, multiplier: number): number => {
  const scaled = value * multiplier
  if (!Number.isSafeInteger(scaled) || scaled < 0 || scaled > 0xffff_ffff) {
    throw new Error('Fixture timing scale exceeds uint32')
  }
  return scaled
}

const addedUint32 = (left: number, right: number): number => {
  const sum = left + right
  if (!Number.isSafeInteger(sum) || sum < 0 || sum > 0xffff_ffff) {
    throw new Error('Fixture box size exceeds uint32')
  }
  return sum
}

const scaleAnimationTrackTiming = (
  source: Uint8Array,
  trackIndex: number,
  timescaleMultiplier: number,
  tickMultiplier: number,
): Uint8Array => {
  const input = Uint8Array.from(source)
  const path = animationTrackBoxPath(input, trackIndex)
  const view = new DataView(input.buffer, input.byteOffset, input.byteLength)
  const mdhdVersion = input[path.mdhdStart + 8]
  let timescaleOffset: number
  let durationOffset: number
  if (mdhdVersion === 0) {
    timescaleOffset = path.mdhdStart + 20
    durationOffset = path.mdhdStart + 24
  } else if (mdhdVersion === 1) {
    timescaleOffset = path.mdhdStart + 28
    if (view.getUint32(path.mdhdStart + 32) !== 0) {
      throw new Error('Fixture mdhd duration exceeds uint32')
    }
    durationOffset = path.mdhdStart + 36
  } else {
    throw new Error('Fixture mdhd version is unsupported')
  }
  view.setUint32(
    timescaleOffset,
    scaledUint32(view.getUint32(timescaleOffset), timescaleMultiplier),
  )
  view.setUint32(durationOffset, scaledUint32(view.getUint32(durationOffset), tickMultiplier))
  const entryCount = view.getUint32(path.sttsStart + 12)
  const sttsSize = fixtureBoxSize(input, path.sttsStart)
  if (entryCount > (sttsSize - 16) / 8 || sttsSize !== 16 + entryCount * 8) {
    throw new Error('Fixture stts entries are malformed')
  }
  for (let entry = 0; entry < entryCount; entry += 1) {
    const deltaOffset = path.sttsStart + 20 + entry * 8
    view.setUint32(deltaOffset, scaledUint32(view.getUint32(deltaOffset), tickMultiplier))
  }
  return input
}

const disableAnimationTrackEdit = (source: Uint8Array, trackIndex: number): Uint8Array => {
  const input = Uint8Array.from(source)
  const path = animationTrackBoxPath(input, trackIndex)
  input.set(ascii('free'), path.edtsStart + 4)
  return input
}

const appendAnimationTrackSampleEntryBox = (
  source: Uint8Array,
  trackIndex: number,
  child: readonly number[],
): Uint8Array => {
  const path = animationTrackBoxPath(source, trackIndex)
  const insertionOffset = path.sampleEntryStart + fixtureBoxSize(source, path.sampleEntryStart)
  const outputLength = source.byteLength + child.length
  if (!Number.isSafeInteger(outputLength)) throw new Error('Fixture insertion size overflows')
  const output = new Uint8Array(outputLength)
  output.set(source.subarray(0, insertionOffset))
  output.set(child, insertionOffset)
  output.set(source.subarray(insertionOffset), insertionOffset + child.length)
  const ancestors = [
    path.moovStart,
    path.trackStart,
    path.mdiaStart,
    path.minfStart,
    path.stblStart,
    path.stsdStart,
    path.sampleEntryStart,
  ]
  const view = new DataView(output.buffer, output.byteOffset, output.byteLength)
  for (const start of ancestors) {
    const size = view.getUint32(start)
    view.setUint32(start, addedUint32(size, child.length))
  }
  return output
}

const trimAnimationTrackEdit = (source: Uint8Array, trackIndex: number): Uint8Array => {
  const input = Uint8Array.from(source)
  const path = animationTrackBoxPath(input, trackIndex)
  const view = new DataView(input.buffer, input.byteOffset, input.byteLength)
  const version = input[path.elstStart + 8]
  if (version === 0) {
    view.setInt32(path.elstStart + 20, 1)
  } else if (version === 1) {
    view.setUint32(path.elstStart + 24, 0)
    view.setUint32(path.elstStart + 28, 1)
  } else {
    throw new Error('Fixture elst version is unsupported')
  }
  return input
}

const av1SequenceObu = [10, 6, 24, 12, 253, 219, 16, 128] as const
const neutralLosslessAv1 = [18, 0, 10, 5, 24, 0, 54, 0, 32, 50, 5, 16, 0, 0, 4, 128] as const
const lossyIntraAvif = Buffer.from(
  'AAAAIGZ0eXBhdmlmAAAAAGF2aWZtaWYxbWlhZk1BMUIAAADxbWV0YQAAAAAAAAAhaGRscgAAAAAAAAAAcGljdAAAAAAAAAAAAAAAAAAAAAAOcGl0bQAAAAAAAQAAAB5pbG9jAAAAAEQAAAEAAQAAAAEAAAEZAAAAMQAAAChpaW5mAAAAAAABAAAAGmluZmUCAAAAAAEAAGF2MDFDb2xvcgAAAABwaXBycAAAAFFpcGNvAAAAFGlzcGUAAAAAAAAABAAAAAQAAAAWcGl4aQAAAAEDCAgIAgACIAIgAAAADGF2MUOBAA0AAAAAE2NvbHJuY2x4AAIAAgACgAAAABdpcG1hAAAAAAAAAAEAAQQBAoMEAAAAOW1kYXQSAAoFGAR9gUgyJhfACSSSRABOQpsmXwal4c1e451a75FxWtQXOrIX0TGFWyby7pvW',
  'base64',
)

type CleanApertureValues = readonly [
  widthNumerator: number,
  widthDenominator: number,
  heightNumerator: number,
  heightDenominator: number,
  horizontalOffsetNumerator: number,
  horizontalOffsetDenominator: number,
  verticalOffsetNumerator: number,
  verticalOffsetDenominator: number,
]

const avifBitstreamFixture = ({
  codedPayload = av1SequenceObu,
  configurationMatches = true,
  displayP3 = false,
  height = 8,
  iccProfile,
  idat = false,
  multipleExtents = false,
  width = 16,
}: {
  codedPayload?: readonly number[]
  configurationMatches?: boolean
  displayP3?: boolean
  height?: number
  iccProfile?: Uint8Array
  idat?: boolean
  multipleExtents?: boolean
  width?: number
} = {}): Uint8Array => {
  const fileType = box('ftyp', [...ascii('avif'), ...bytes32(0), ...ascii('avif')])
  const itemInfo = fullBox('iinf', [0, 1, ...fullBox('infe', [0, 1, 0, 0, ...ascii('av01'), 0], 2)])
  const itemProperties = [
    fullBox('ispe', [...bytes32(width), ...bytes32(height)]),
    box('av1C', [0x81, 0, configurationMatches ? 0x0c : 0, 0]),
    ...(iccProfile
      ? [box('colr', [...ascii('prof'), ...iccProfile])]
      : displayP3
        ? [box('colr', [...ascii('nclx'), 0, 12, 0, 13, 0, 6, 0x80])]
        : []),
  ]
  const properties = box('iprp', [
    ...box('ipco', itemProperties.flat()),
    ...fullBox('ipma', [
      ...bytes32(1),
      0,
      1,
      itemProperties.length,
      ...itemProperties.map((_property, index) => index + 1),
    ]),
  ])
  const extentLengths = multipleExtents ? [4, codedPayload.length - 4] : [codedPayload.length]
  const extentOffsets = multipleExtents ? [0, 5] : [0]
  const location = (absoluteOffset: number): readonly number[] => {
    const extents = extentLengths.flatMap((length, index) => [
      ...bytes32(absoluteOffset + (extentOffsets[index] ?? 0)),
      ...bytes32(length),
    ])
    return fullBox(
      'iloc',
      [0x44, 0, 0, 1, 0, 1, ...(idat ? [0, 1] : []), 0, 0, 0, extentLengths.length, ...extents],
      idat ? 1 : 0,
    )
  }
  const itemData = multipleExtents
    ? [...codedPayload.slice(0, 4), 0xff, ...codedPayload.slice(4)]
    : [...codedPayload]
  const metadata = (absoluteOffset: number): readonly number[] =>
    fullBox('meta', [
      ...fullBox('pitm', [0, 1]),
      ...itemInfo,
      ...location(idat ? 0 : absoluteOffset),
      ...properties,
      ...(idat ? box('idat', itemData) : []),
    ])
  if (idat) return Uint8Array.from([...fileType, ...metadata(0)])
  const provisionalMetadata = metadata(0)
  const itemOffset = fileType.length + provisionalMetadata.length + 8
  return Uint8Array.from([...fileType, ...metadata(itemOffset), ...box('mdat', codedPayload)])
}

const avifFixture = ({
  alpha = false,
  bitDepth = 10,
  chroma = '420',
  cleanApertureAfterRotation = false,
  mirrorBeforeRotation = false,
  mirrors = [],
  cleanApertures = [],
  compatibleMajorBrand = false,
  height = 480,
  profile = 0,
  rotation,
  width = 640,
}: {
  alpha?: boolean
  bitDepth?: 8 | 10 | 12
  chroma?: '400' | '420' | '422' | '444'
  cleanApertureAfterRotation?: boolean
  mirrorBeforeRotation?: boolean
  mirrors?: readonly number[]
  cleanApertures?: readonly CleanApertureValues[]
  compatibleMajorBrand?: boolean
  height?: number
  profile?: number
  rotation?: 0 | 1 | 2 | 3
  width?: number
} = {}): Uint8Array => {
  const highBitDepth = bitDepth > 8 ? 0x40 : 0
  const twelveBit = bitDepth === 12 ? 0x20 : 0
  const monochrome = chroma === '400' ? 0x10 : 0
  const subsamplingX = chroma === '420' || chroma === '422' ? 0x08 : 0
  const subsamplingY = chroma === '420' ? 0x04 : 0
  const cleanApertureProperties = cleanApertures.map((values) =>
    box(
      'clap',
      values.flatMap((value) => bytes32(value)),
    ),
  )
  const rotationProperties = rotation === undefined ? [] : [box('irot', [rotation])]
  const mirrorProperties = mirrors.map((axis) => box('imir', [axis]))
  const properties = [
    fullBox('ispe', [...bytes32(width), ...bytes32(height)]),
    fullBox('pixi', [3, bitDepth, bitDepth, bitDepth]),
    box('av1C', [
      0x81,
      (profile << 5) | 13,
      highBitDepth | twelveBit | monochrome | subsamplingX | subsamplingY,
      0,
    ]),
    box('colr', [...ascii('nclx'), 0, 1, 0, 13, 0, 6, 0x80]),
    ...(!cleanApertureAfterRotation ? cleanApertureProperties : []),
    ...(mirrorBeforeRotation ? mirrorProperties : []),
    ...rotationProperties,
    ...(!mirrorBeforeRotation ? mirrorProperties : []),
    ...(cleanApertureAfterRotation ? cleanApertureProperties : []),
    ...(alpha
      ? [fullBox('auxC', [...ascii('urn:mpeg:mpegB:cicp:systems:auxiliary:alpha'), 0])]
      : []),
  ]
  const primaryPropertyCount = properties.length - (alpha ? 1 : 0)
  const propertyIndexes = Array.from({ length: primaryPropertyCount }, (_, index) => index + 1)
  const associations = [
    0,
    1,
    propertyIndexes.length,
    ...propertyIndexes,
    ...(alpha ? [0, 2, 1, properties.length] : []),
  ]
  const iprp = box('iprp', [
    ...box('ipco', properties.flat()),
    ...fullBox('ipma', [...bytes32(alpha ? 2 : 1), ...associations]),
  ])
  const references = alpha ? fullBox('iref', box('auxl', [0, 2, 0, 1, 0, 1])) : []
  const meta = fullBox('meta', [...fullBox('pitm', [0, 1]), ...iprp, ...references])
  const brands = compatibleMajorBrand
    ? [...ascii('mif1'), ...bytes32(0), ...ascii('avif'), ...ascii('miaf')]
    : [...ascii('avif'), ...bytes32(0), ...ascii('avif'), ...ascii('mif1')]
  return Uint8Array.from([...box('ftyp', brands), ...meta, ...box('mdat', [])])
}

describe('AVIF metadata', () => {
  it('detects an AVIF compatible brand and reports codec metadata', async () => {
    const metadata = await (
      await Image.open(
        avifFixture({ compatibleMajorBrand: true, width: 3024, height: 4032, bitDepth: 10 }),
      )
    ).metadata()

    expect(metadata).toEqual({
      format: 'avif',
      mimeType: 'image/avif',
      width: 3024,
      height: 4032,
      hasAlpha: false,
      bitDepth: 10,
      chromaSubsampling: '420',
      codecProfile: 0,
      colorSpace: 'srgb',
      colorProfile: {
        kind: 'nclx',
        primaries: 1,
        transferCharacteristics: 13,
        matrixCoefficients: 6,
        fullRange: true,
      },
      frames: 1,
    })
  })

  it('reports profile, chroma, alpha auxiliary items, and rotation', async () => {
    const metadata = await (
      await Image.open(
        avifFixture({ alpha: true, bitDepth: 12, chroma: '444', profile: 2, rotation: 3 }),
      )
    ).metadata()

    expect(metadata).toMatchObject({
      hasAlpha: true,
      bitDepth: 12,
      chromaSubsampling: '444',
      codecProfile: 2,
      orientation: 6,
    })
  })

  it.each([
    { label: 'bottom-to-top', mirrors: [0], orientation: 4 },
    { label: 'right-to-left', mirrors: [1], orientation: 2 },
    {
      label: 'bottom-to-top after counter-clockwise rotation',
      mirrors: [0],
      rotation: 1,
      orientation: 5,
    },
    {
      label: 'right-to-left after counter-clockwise rotation',
      mirrors: [1],
      rotation: 1,
      orientation: 7,
    },
  ] as const)(
    'maps $label transforms to pipeline orientation',
    async ({ mirrors, rotation, orientation }) => {
      const metadata = await (
        await Image.open(avifFixture({ mirrors, ...(rotation === undefined ? {} : { rotation }) }))
      ).metadata()

      expect(metadata.orientation).toBe(orientation)
    },
  )

  it('rejects an imir property with reserved bits set', async () => {
    const image = await Image.open(avifFixture({ mirrors: [2] }))
    await expect(image.metadata()).rejects.toMatchObject({ code: 'INVALID_INPUT' })
  })

  it('rejects duplicate imir properties', async () => {
    const image = await Image.open(avifFixture({ mirrors: [0, 1] }))
    await expect(image.metadata()).rejects.toMatchObject({ code: 'INVALID_INPUT' })
  })

  it('rejects imir associated before irot', async () => {
    const image = await Image.open(
      avifFixture({ mirrorBeforeRotation: true, mirrors: [1], rotation: 1 }),
    )
    await expect(image.metadata()).rejects.toMatchObject({ code: 'INVALID_INPUT' })
  })

  it('applies image dimension limits before decoding', async () => {
    const image = await Image.open(avifFixture({ width: 101 }), { limits: { maxWidth: 100 } })
    await expect(image.metadata()).rejects.toMatchObject({ code: 'LIMIT_EXCEEDED' })
  })

  it('rejects aggregate decoder working sets above 64 MiB', () => {
    expect(() => validateAvifWorkingBytes(64 * 1_024 * 1_024)).not.toThrow()
    expect(() => validateAvifWorkingBytes(64 * 1_024 * 1_024 + 1)).toThrow(
      expect.objectContaining({ code: 'LIMIT_EXCEEDED' }),
    )
    expect(() => validateAvifWorkingBytes(Number.MAX_SAFE_INTEGER + 1)).toThrow(
      expect.objectContaining({ code: 'LIMIT_EXCEEDED' }),
    )
  })

  it('rejects boxes that extend beyond their parent', async () => {
    const input = avifFixture()
    input[0] = 0x7f
    await expect((await Image.open(input)).metadata()).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    })
  })

  it('rejects missing spatial extents', async () => {
    const input = avifFixture()
    const marker = ascii('ispe')
    const offset = input.findIndex((_value, index) =>
      marker.every((byte, markerIndex) => input[index + markerIndex] === byte),
    )
    expect(offset).toBeGreaterThan(0)
    input.set(ascii('free'), offset)

    await expect((await Image.open(input)).metadata()).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    })
  })

  it('reports validated integer clean-aperture dimensions', async () => {
    const metadata = await (
      await Image.open(
        avifFixture({
          bitDepth: 8,
          chroma: '444',
          width: 16,
          height: 12,
          cleanApertures: [[8, 1, 6, 1, -1, 1, -1, 1]],
        }),
      )
    ).metadata()

    expect(metadata).toMatchObject({ width: 8, height: 6 })
  })

  it.each([
    {
      label: 'half-integer sample origin',
      cleanApertures: [[7, 1, 6, 1, 0, 1, 0, 1]],
    },
    {
      label: 'integer dimensions and origin represented as reducible rationals',
      cleanApertures: [[16, 2, 12, 2, -2, 2, -2, 2]],
    },
  ] as const)('accepts $label', async ({ cleanApertures }) => {
    const metadata = await (
      await Image.open(avifFixture({ width: 16, height: 12, cleanApertures }))
    ).metadata()

    expect(metadata).toMatchObject({
      width: cleanApertures[0][0] / cleanApertures[0][1],
      height: cleanApertures[0][2] / cleanApertures[0][3],
    })
  })

  it.each([
    {
      label: 'zero denominator',
      cleanApertures: [[8, 0, 6, 1, -1, 1, -1, 1]],
      code: 'INVALID_INPUT',
    },
    {
      label: 'zero width',
      cleanApertures: [[0, 1, 6, 1, -1, 1, -1, 1]],
      code: 'INVALID_INPUT',
    },
    {
      label: 'out-of-bounds rectangle',
      cleanApertures: [[18, 1, 6, 1, 0, 1, 0, 1]],
      code: 'INVALID_INPUT',
    },
    {
      label: 'fractional dimensions',
      cleanApertures: [[15, 2, 6, 1, 0, 1, 0, 1]],
      code: 'UNSUPPORTED_OPERATION',
    },
    {
      label: 'origin outside the integer and half-integer sample lattice',
      cleanApertures: [[8, 1, 6, 1, 1, 3, 0, 1]],
      code: 'UNSUPPORTED_OPERATION',
    },
    {
      label: 'half-integer origin outside the source',
      cleanApertures: [[16, 1, 6, 1, -1, 2, 0, 1]],
      code: 'INVALID_INPUT',
    },
    {
      label: 'oversized rational arithmetic',
      cleanApertures: [[0xffffffff, 1, 6, 1, 0, 1, 0, 1]],
      code: 'INVALID_INPUT',
    },
    {
      label: 'duplicate properties',
      cleanApertures: [
        [8, 1, 6, 1, -1, 1, -1, 1],
        [8, 1, 6, 1, -1, 1, -1, 1],
      ],
      code: 'INVALID_INPUT',
    },
  ] as const)('rejects $label in clean-aperture metadata', async ({ cleanApertures, code }) => {
    const image = await Image.open(avifFixture({ width: 16, height: 12, cleanApertures }))
    await expect(image.metadata()).rejects.toMatchObject({ code })
  })

  it('rejects clean aperture associated after rotation', async () => {
    const image = await Image.open(
      avifFixture({
        width: 16,
        height: 12,
        rotation: 1,
        cleanApertureAfterRotation: true,
        cleanApertures: [[8, 1, 6, 1, -1, 1, -1, 1]],
      }),
    )
    await expect(image.metadata()).rejects.toMatchObject({ code: 'INVALID_INPUT' })
  })
})

describe('AVIF coded item inspection', () => {
  it('extracts an absolute mdat extent and validates its AV1 configuration', async () => {
    const result = await inspectAvifBitstreams(new MemorySource(avifBitstreamFixture()))

    expect(result).toMatchObject({
      primaryItemId: 1,
      primaryItemType: 'av01',
      colorItemIds: [1],
      codedImages: [
        {
          itemId: 1,
          role: 'color',
          payloadBytes: av1SequenceObu.length,
          configurationMatchesSequence: true,
          sequence: { bitDepth: 8, chromaSubsampling: '420' },
        },
      ],
    })
  })

  it('parses AVIF prof color properties and rejects corrupt embedded profiles', async () => {
    const inspection = await inspectAvifBitstreams(
      new MemorySource(avifBitstreamFixture({ iccProfile: channelSwappingRgbProfile() })),
    )
    expect(inspection.colorTransform).toMatchObject({ kind: 'rgb' })
    const displayP3 = await inspectAvifBitstreams(
      new MemorySource(avifBitstreamFixture({ displayP3: true })),
    )
    expect(displayP3.colorTransform).toMatchObject({ kind: 'rgb' })

    await expect(
      inspectAvifBitstreams(
        new MemorySource(avifBitstreamFixture({ iccProfile: Uint8Array.of(1, 2, 3) })),
      ),
    ).rejects.toMatchObject({ code: 'TRUNCATED_INPUT' })
  })

  it('joins multiple idat-relative extents without trusting bad av1C metadata', async () => {
    const result = await inspectAvifBitstreams(
      new MemorySource(
        avifBitstreamFixture({ idat: true, multipleExtents: true, configurationMatches: false }),
      ),
    )

    expect(result.codedImages[0]).toMatchObject({
      payloadBytes: av1SequenceObu.length,
      configurationMatchesSequence: false,
      sequence: { chromaSubsampling: '420' },
    })
  })

  it('rejects item extents that escape their declared data source', async () => {
    const input = avifBitstreamFixture({ idat: true })
    const marker = ascii('iloc')
    const offset = input.findIndex((_value, index) =>
      marker.every((byte, markerIndex) => input[index + markerIndex] === byte),
    )
    expect(offset).toBeGreaterThan(0)
    input[offset + 27] = 0xff

    await expect(inspectAvifBitstreams(new MemorySource(input))).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    })
  })
})

describe('AVIF restricted pixel decode', () => {
  it('decodes an externally encoded lossless 8-bit 4:2:0 intra image', async () => {
    const input = avifBitstreamFixture({
      codedPayload: neutralLosslessAv1,
      width: 2,
      height: 2,
    })
    const output = PNG.sync.read(await (await Image.open(input)).png().toBuffer())

    expect(output.width).toBe(2)
    expect(output.height).toBe(2)
    expect([...output.data]).toEqual([
      130, 130, 130, 255, 130, 130, 130, 255, 130, 130, 130, 255, 130, 130, 130, 255,
    ])

    const cropped = PNG.sync.read(
      await (await Image.open(input)).crop({ x: 1, y: 1, width: 1, height: 1 }).png().toBuffer(),
    )
    expect([cropped.width, cropped.height, ...cropped.data]).toEqual([1, 1, 130, 130, 130, 255])
  })
  it.each(avifMirrorFixtures)(
    'auto-orients $file through imir and associated item transforms',
    async (fixture) => {
      const input = new Uint8Array(await readFile(avifMirrorFixturePath(fixture)))
      const image = await Image.open(input)
      const metadata = await image.metadata()
      const inspection = await inspectAvifBitstreams(new MemorySource(input))
      const output = PNG.sync.read(await image.autoOrient().png().toBuffer())

      expect(createHash('sha256').update(input).digest('hex')).toBe(fixture.fileSha256)
      expect(metadata).toMatchObject({
        hasAlpha: fixture.hasAlpha,
        orientation: fixture.orientation,
      })
      expect(inspection).toMatchObject({
        mirroring: fixture.mirrorAxis,
        primaryItemType: fixture.primaryItemType,
      })
      expect([output.width, output.height]).toEqual([fixture.decodedWidth, fixture.decodedHeight])
      expect(createHash('sha256').update(output.data).digest('hex')).toBe(fixture.decodedRgbaSha256)
    },
    20_000,
  )

  it('reports animation frames while requiring explicit pixel frame selection', async () => {
    const input = await readFile(avifAnimationAlphaFixturePath)
    const image = await Image.open(input)

    expect(await image.metadata()).toMatchObject({
      frames: avifAnimationAlphaFixture.frames,
      hasAlpha: avifAnimationAlphaFixture.hasAlpha,
      height: avifAnimationAlphaFixture.height,
      width: avifAnimationAlphaFixture.width,
    })
    await expect(image.png().toBuffer()).rejects.toMatchObject({
      code: 'UNSUPPORTED_OPERATION',
    })
  })

  it('aligns animated AVIF color and alpha timing across different mdhd timescales', async () => {
    const source = await readFile(avifAnimationAlphaFixturePath)
    const input = scaleAnimationTrackTiming(source, 1, 2, 2)

    expect(await (await Image.open(input)).metadata()).toMatchObject({
      frames: avifAnimationAlphaFixture.frames,
      hasAlpha: true,
    })
  })

  it('rejects equal color and alpha ticks that represent different real-time timing', async () => {
    const source = await readFile(avifAnimationAlphaFixturePath)
    const input = disableAnimationTrackEdit(scaleAnimationTrackTiming(source, 1, 2, 1), 1)

    await expect((await Image.open(input)).metadata()).rejects.toMatchObject({
      code: 'UNSUPPORTED_OPERATION',
      message: 'Animated AVIF alpha and color sample timing does not align',
    })
  })

  it('rejects animated AVIF tracks with a trimmed edit list', async () => {
    const source = await readFile(avifAnimationAlphaFixturePath)
    const input = trimAnimationTrackEdit(source, 0)

    await expect((await Image.open(input)).metadata()).rejects.toMatchObject({
      code: 'UNSUPPORTED_OPERATION',
      message: 'Animated AVIF track edit lists are not supported',
    })
  })

  it('rejects animated AVIF track-level clean apertures', async () => {
    const source = await readFile(avifAnimationAlphaFixturePath)
    const cleanAperture = box(
      'clap',
      [150, 1, 150, 1, 0, 1, 0, 1].flatMap((value) => bytes32(value)),
    )
    const input = appendAnimationTrackSampleEntryBox(source, 0, cleanAperture)

    await expect((await Image.open(input)).metadata()).rejects.toMatchObject({
      code: 'UNSUPPORTED_OPERATION',
      message: 'Animated AVIF track-level clean apertures are not supported',
    })
  })

  it('applies maxFrames before allocating animated AVIF sample tables', async () => {
    const input = await readFile(avifAnimationAlphaFixturePath)

    await expect(
      (await Image.open(input, { limits: { maxFrames: 4 } })).metadata(),
    ).rejects.toMatchObject({
      code: 'LIMIT_EXCEEDED',
      message: 'AVIF AV1 track has 5 samples; maxFrames is 4',
    })
  })

  it('decodes explicitly selected animated color and alpha key samples', async () => {
    const input = await readFile(avifAnimationAlphaFixturePath)
    const image = await Image.open(input, { frame: 0 })
    const metadata = await image.metadata()
    const output = PNG.sync.read(await image.png().toBuffer())
    const oracleFile = await readFile(avifAnimationAlphaOraclePath)
    const oracle = PNG.sync.read(oracleFile)

    expect(createHash('sha256').update(input).digest('hex')).toBe(
      avifAnimationAlphaFixture.fileSha256,
    )
    expect(metadata).toMatchObject({
      bitDepth: avifAnimationAlphaFixture.bitDepth,
      chromaSubsampling: avifAnimationAlphaFixture.chromaSubsampling,
      codecProfile: avifAnimationAlphaFixture.codecProfile,
      frames: avifAnimationAlphaFixture.frames,
      hasAlpha: avifAnimationAlphaFixture.hasAlpha,
      height: avifAnimationAlphaFixture.height,
      width: avifAnimationAlphaFixture.width,
    })
    expect(createHash('sha256').update(output.data).digest('hex')).toBe(
      avifAnimationAlphaFixture.decodedRgbaSha256,
    )
    expect(createHash('sha256').update(oracleFile).digest('hex')).toBe(
      avifAnimationAlphaFixture.oracleFileSha256,
    )
    expect(createHash('sha256').update(oracle.data).digest('hex')).toBe(
      avifAnimationAlphaFixture.oracleRgbaSha256,
    )
    expect(output.data).toEqual(oracle.data)
  })

  it.each(avifAnimationKeyFrames)(
    'selects independently decodable animated AVIF key frame $frame',

    async (fixture) => {
      const input = await readFile(avifAnimationFixturePath)
      const image = await Image.open(input, { frame: fixture.frame })
      const metadata = await image.metadata()
      const output = PNG.sync.read(await image.png().toBuffer())
      const oracleFile = await readFile(avifAnimationOraclePath(fixture))
      const oracle = PNG.sync.read(oracleFile)

      expect(createHash('sha256').update(input).digest('hex')).toBe(avifAnimationFixture.fileSha256)
      expect(metadata).toMatchObject({
        bitDepth: avifAnimationFixture.bitDepth,
        chromaSubsampling: avifAnimationFixture.chromaSubsampling,
        codecProfile: avifAnimationFixture.codecProfile,
        frames: avifAnimationFixture.frames,
        hasAlpha: avifAnimationFixture.hasAlpha,
        height: avifAnimationFixture.height,
        width: avifAnimationFixture.width,
      })
      expect([output.width, output.height]).toEqual([
        avifAnimationFixture.width,
        avifAnimationFixture.height,
      ])
      expect(createHash('sha256').update(output.data).digest('hex')).toBe(fixture.decodedRgbaSha256)
      expect(createHash('sha256').update(oracleFile).digest('hex')).toBe(fixture.oracleFileSha256)
      expect(createHash('sha256').update(oracle.data).digest('hex')).toBe(fixture.oracleRgbaSha256)
      const maximumDifferences: [number, number, number, number] = [0, 0, 0, 0]
      for (let offset = 0; offset < output.data.byteLength; offset += 1) {
        const channel = offset & 3
        maximumDifferences[channel] = Math.max(
          maximumDifferences[channel] ?? 0,
          Math.abs((output.data[offset] ?? 0) - (oracle.data[offset] ?? 0)),
        )
      }
      expect(maximumDifferences).toEqual(fixture.maximumOracleDifferences)
    },
    20_000,
  )

  it('rejects animated AVIF dependent frames instead of substituting its poster', async () => {
    const input = await readFile(avifAnimationFixturePath)

    await expect((await Image.open(input, { frame: 1 })).png().toBuffer()).rejects.toMatchObject({
      code: 'UNSUPPORTED_OPERATION',
      message: expect.stringContaining('dependent'),
    })
    await expect((await Image.open(input, { frame: 5 })).metadata()).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    })
  })

  it('rejects nonzero frame selection for still AVIF', async () => {
    await expect((await Image.open(lossyIntraAvif, { frame: 1 })).metadata()).rejects.toMatchObject(
      {
        code: 'INVALID_INPUT',
      },
    )
  })

  it.each([
    { label: 'oversized sample count', boxType: 'stsz', fieldOffset: 12, value: 100_001 },
    { label: 'zero sample duration', boxType: 'stts', fieldOffset: 16, value: 0 },
    { label: 'out-of-source sample extent', boxType: 'stco', fieldOffset: 12, value: 0xffff_ffff },
  ])('rejects animated AVIF $label before sample payload allocation', async (fixture) => {
    const source = await readFile(avifAnimationFixturePath)
    const input = new Uint8Array(source)
    const typeOffset = source.indexOf(fixture.boxType)
    if (typeOffset < 0) throw new Error(`Animation fixture has no ${fixture.boxType} box`)
    new DataView(input.buffer, input.byteOffset, input.byteLength).setUint32(
      typeOffset + fixture.fieldOffset,
      fixture.value,
    )

    await expect((await Image.open(input)).metadata()).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    })
  })

  it('applies an AVIF prof transform in the bounded block decoder', async () => {
    const input = avifBitstreamFixture({
      codedPayload: neutralLosslessAv1,
      width: 2,
      height: 2,
      iccProfile: channelSwappingRgbProfile(),
    })
    const output = PNG.sync.read(await (await Image.open(input)).png().toBuffer())

    expect([...output.data]).toEqual([
      130, 130, 130, 255, 130, 130, 130, 255, 130, 130, 130, 255, 130, 130, 130, 255,
    ])
  })

  it('decodes lossy 8x8 transforms, nonzero coefficients, and bilinear chroma', async () => {
    const output = PNG.sync.read(await (await Image.open(lossyIntraAvif)).png().toBuffer())

    expect([output.width, output.height]).toEqual([4, 4])
    expect([...output.data]).toEqual([
      0, 132, 0, 255, 0, 145, 0, 255, 35, 117, 23, 255, 122, 129, 121, 255, 0, 145, 0, 255, 1, 157,
      0, 255, 123, 130, 122, 255, 210, 142, 220, 255, 36, 118, 24, 255, 123, 130, 122, 255, 245,
      103, 255, 255, 255, 114, 255, 255, 122, 129, 121, 255, 210, 142, 220, 255, 255, 114, 255, 255,
      255, 125, 255, 255,
    ])
  })
  it.each([
    {
      ...avifQ0LossyFixture,
      label: 'lossy quantizer-context-0 coefficients',
      nclx: { fullRange: true, matrixCoefficients: 6 },
    },
    {
      ...avifQ0LosslessFixture,
      label: 'lossless 4x4 Walsh-Hadamard and identity color',
      nclx: { fullRange: true, matrixCoefficients: 0 },
    },
  ])('decodes $label exactly against the pinned libavif oracle', async (fixture) => {
    const input = await readFile(join(avifQ0FixtureDirectory, fixture.file))
    const inspection = await inspectAvifBitstreams(new MemorySource(input))
    const output = PNG.sync.read(await (await Image.open(input)).png().toBuffer())

    expect(createHash('sha256').update(input).digest('hex')).toBe(fixture.fileSha256)
    expect(inspection.nclx).toMatchObject(fixture.nclx)
    expect([output.width, output.height]).toEqual([fixture.width, fixture.height])
    expect(createHash('sha256').update(output.data).digest('hex')).toBe(fixture.decodedRgbaSha256)
  })

  it('decodes the pinned draw-points screen-content palette fixture exactly', async () => {
    const input = await readFile(join(avifCorpusDirectory, 'draw_points_idat.avif'))
    const output = PNG.sync.read(await (await Image.open(input)).png().toBuffer())

    expect(createHash('sha256').update(input).digest('hex')).toBe(
      'ce2fd627efae49391ea82584e9beae05959b867ba429e688a2b95a015b38d3db',
    )
    expect([output.width, output.height]).toEqual([33, 11])
    expect(createHash('sha256').update(output.data).digest('hex')).toBe(
      'f803b121d2471ac44b32170380ab02f8174ddf1079f9425de921dde00ac91fc7',
    )
  })

  it('applies a clean aperture exactly against the pinned Sharp oracle', async () => {
    const fixture = avifCleanApertureFixture
    const input = await readFile(join(avifCleanApertureFixtureDirectory, fixture.file))
    const inspection = await inspectAvifBitstreams(new MemorySource(input))
    const image = await Image.open(input)
    const metadata = await image.metadata()
    const output = PNG.sync.read(await image.png().toBuffer())
    const oracle = await sharp(input).ensureAlpha().raw().toBuffer()

    expect(createHash('sha256').update(input).digest('hex')).toBe(fixture.fileSha256)
    expect(inspection.displayRegion).toEqual(fixture.crop)
    expect(metadata).toMatchObject({ width: fixture.crop.width, height: fixture.crop.height })
    expect([output.width, output.height]).toEqual([fixture.crop.width, fixture.crop.height])
    expect(createHash('sha256').update(output.data).digest('hex')).toBe(fixture.decodedRgbaSha256)
    expect(createHash('sha256').update(oracle).digest('hex')).toBe(fixture.sharpRgbaSha256)
    expect(output.data).toEqual(oracle)
  })

  it('decodes the half-sample kimono aperture against a pinned Sharp oracle', async () => {
    const fixture = avifFractionalCleanApertureFixture
    const input = await readFile(join(avifCleanApertureFixtureDirectory, fixture.file))
    const inspection = await inspectAvifBitstreams(new MemorySource(input))
    const image = await Image.open(input)
    const metadata = await image.metadata()
    const output = PNG.sync.read(await image.png().toBuffer())

    const sharpInput = Buffer.from(input)
    const clapTypeOffset = sharpInput.indexOf('clap')
    expect(clapTypeOffset).toBeGreaterThan(0)
    const clapPayloadOffset = clapTypeOffset + 4
    const fullAperture = [fixture.encodedWidth, 1, fixture.encodedHeight, 1, 0, 1, 0, 1]
    for (let index = 0; index < fullAperture.length; index += 1) {
      sharpInput.writeUInt32BE(fullAperture[index] ?? 0, clapPayloadOffset + index * 4)
    }
    const sharpOracle = await sharp(sharpInput, { unlimited: true })
      .extract({
        left: fixture.crop.x,
        top: fixture.crop.y,
        width: fixture.crop.width,
        height: fixture.crop.height,
      })
      .ensureAlpha()
      .raw()
      .toBuffer()
    let squaredError = 0
    for (let index = 0; index < output.data.length; index += 1) {
      const difference = (output.data[index] ?? 0) - (sharpOracle[index] ?? 0)
      squaredError += difference * difference
    }
    const normalizedRmse = Math.sqrt(squaredError / output.data.length) / 255

    expect(createHash('sha256').update(input).digest('hex')).toBe(fixture.fileSha256)
    expect(inspection.displayRegion).toEqual(fixture.crop)
    expect(metadata).toMatchObject({ width: fixture.crop.width, height: fixture.crop.height })
    expect([output.width, output.height]).toEqual([fixture.crop.width, fixture.crop.height])
    expect(createHash('sha256').update(output.data).digest('hex')).toBe(fixture.decodedRgbaSha256)
    expect(createHash('sha256').update(sharpOracle).digest('hex')).toBe(
      fixture.sharpCroppedRgbaSha256,
    )
    expect(normalizedRmse).toBeLessThan(0.01)
  })
  it('decodes the pinned skipped intra-block-copy fixture exactly in native YUV', async () => {
    const input = await readFile(join(avifCorpusDirectory, 'blue-and-magenta-crop.avif'))
    const inspection = await inspectAvifBitstreams(new MemorySource(input))
    const coded = inspection.codedImages.find((image) => image.role === 'color')
    const frameObu = coded?.obus.find((obu) => obu.type === av1ObuType.frame)
    if (!coded || !frameObu) throw new Error('Intra-block-copy fixture has no color frame OBU')
    const frame = parseAv1Frame(coded.sequence, frameObu.payload)
    const decoded = decodeRestrictedAv1Intra(coded.sequence, frame)
    const nativeYuv = new Uint8Array(320 * 280 * 3)
    for (let plane = 0; plane < 3; plane += 1) {
      const samples = plane === 0 ? decoded.y : plane === 1 ? decoded.u : decoded.v
      const stride = plane === 0 ? decoded.yStride : decoded.chromaStride
      for (let row = 0; row < 280; row += 1) {
        nativeYuv.set(
          samples.subarray(row * stride, row * stride + 320),
          plane * 320 * 280 + row * 320,
        )
      }
    }
    const output = PNG.sync.read(await (await Image.open(input)).png().toBuffer())

    expect(createHash('sha256').update(input).digest('hex')).toBe(
      'fa8fafe0aeddf18586a987ffb3ae26d3548b174ddcfd569c4ba16d4d804c8137',
    )
    expect(frame.header.allowIntrabc).toBe(true)
    expect(createHash('sha256').update(nativeYuv).digest('hex')).toBe(
      'c50dbaedfe2846c692753d1b4b6a760de1d09b4f065403400458e5006ad9d170',
    )
    expect([output.width, output.height]).toEqual([180, 100])
    expect(createHash('sha256').update(output.data).digest('hex')).toBe(
      'dfd67e0ae631102f05399763ccae1f0b0e639c38b38f21d000927741c089cc00',
    )
  })

  it('decodes the pinned residual intra-block-copy fixture exactly', async () => {
    const input = await readFile(join(avifCorpusDirectory, 'ms-monochrome-residual-intrabc.avif'))
    const inspection = await inspectAvifBitstreams(new MemorySource(input))
    const coded = inspection.codedImages.find((image) => image.role === 'color')
    const frameObu = coded?.obus.find((obu) => obu.type === av1ObuType.frame)
    if (!coded || !frameObu) throw new Error('Residual IBC fixture has no color frame OBU')
    const frame = parseAv1Frame(coded.sequence, frameObu.payload)
    const decoded = decodeRestrictedAv1Intra(coded.sequence, frame)
    const nativeY = new Uint8Array(decoded.width * decoded.height)
    for (let row = 0; row < decoded.height; row += 1) {
      nativeY.set(
        decoded.y.subarray(row * decoded.yStride, row * decoded.yStride + decoded.width),
        row * decoded.width,
      )
    }
    const output = PNG.sync.read(await (await Image.open(input)).png().toBuffer())

    expect(createHash('sha256').update(input).digest('hex')).toBe(
      'deeb37c2cf321d3ccacff085a6fed50cc774dd38d7ed271c15517ccd01bd7a4f',
    )
    expect(coded.sequence.monochrome).toBe(true)
    expect(frame.header).toMatchObject({ allowIntrabc: true, baseQuantizer: 217 })
    expect(createHash('sha256').update(nativeY).digest('hex')).toBe(
      '2877cdd0e57286fe12f679ba5488e6c384b16cb02b13275fab65f24d003d9bd4',
    )
    expect([output.width, output.height]).toEqual([1280, 720])
    expect(createHash('sha256').update(output.data).digest('hex')).toBe(
      '6e036207ef682d41edad54421d20bb36ec7f03e34113e2f6fa4ab954779d71c0',
    )
  })

  it('decodes the pinned intra-block-copy delta-Q fixture exactly', async () => {
    const input = await readFile(join(avifCorpusDirectory, 'ibc-deltaq-512x128.avif'))
    const inspection = await inspectAvifBitstreams(new MemorySource(input))
    const coded = inspection.codedImages.find((image) => image.role === 'color')
    const frameObu = coded?.obus.find((obu) => obu.type === av1ObuType.frame)
    if (!coded || !frameObu) throw new Error('IBC delta-Q fixture has no color frame OBU')
    const frame = parseAv1Frame(coded.sequence, frameObu.payload)
    const decoded = decodeRestrictedAv1Intra(coded.sequence, frame)
    const nativeYuv = new Uint8Array(
      decoded.width * decoded.height + 2 * decoded.chromaWidth * decoded.chromaHeight,
    )
    let offset = 0
    for (const [plane, stride, width, height] of [
      [decoded.y, decoded.yStride, decoded.width, decoded.height],
      [decoded.u, decoded.chromaStride, decoded.chromaWidth, decoded.chromaHeight],
      [decoded.v, decoded.chromaStride, decoded.chromaWidth, decoded.chromaHeight],
    ] as const) {
      for (let row = 0; row < height; row += 1) {
        nativeYuv.set(plane.subarray(row * stride, row * stride + width), offset)
        offset += width
      }
    }
    const output = PNG.sync.read(await (await Image.open(input)).png().toBuffer())

    expect(createHash('sha256').update(input).digest('hex')).toBe(
      'bef07c9ff64c26c45585afc8dd38a1cb982528cc70ffc6dbfb9891e6b2f8f9b6',
    )
    expect(frame.header).toMatchObject({
      allowIntrabc: true,
      baseQuantizer: 120,
      deltaQPresent: true,
      deltaQResolution: 2,
    })
    const unsupportedSegmentFeatures = Array.from({ length: 8 }, () =>
      Array.from({ length: 8 }, () => false),
    )
    const firstSegmentFeatures = unsupportedSegmentFeatures[0]
    if (!firstSegmentFeatures) throw new Error('Segment feature state is missing')
    firstSegmentFeatures[6] = true
    expect(() =>
      decodeRestrictedAv1Intra(coded.sequence, {
        ...frame,
        header: {
          ...frame.header,
          segmentation: {
            ...frame.header.segmentation,
            enabled: true,
            featureEnabled: unsupportedSegmentFeatures,
            lastActiveId: 0,
            preSkip: true,
          },
        },
      }),
    ).toThrow('does not support skip features')
    expect(() =>
      decodeRestrictedAv1Intra(coded.sequence, {
        ...frame,
        header: { ...frame.header, deltaLfPresent: true },
      }),
    ).toThrow('does not support AV1 loop-filter deltas')
    expect(createHash('sha256').update(nativeYuv).digest('hex')).toBe(
      'f9f741e25afb9a67529b6dbdaba6d84d6d2b9c9303434ea4ff07e219c752e4af',
    )
    expect([output.width, output.height]).toEqual([512, 128])
    expect(createHash('sha256').update(output.data).digest('hex')).toBe(
      '875c709bfc54e90fc6fbadfba907da524185b6d26491857555611904a6829e40',
    )
  })

  it('decodes a rav1e keyframe with spatial segmentation maps exactly', async () => {
    const input = new Uint8Array(await readFile(avifSegmentationFixturePath))
    const inspection = await inspectAvifBitstreams(new MemorySource(input))
    const coded = inspection.codedImages.find((image) => image.role === 'color')
    const frameObu = coded?.obus.find((obu) => obu.type === av1ObuType.frame)
    if (!coded || !frameObu) throw new Error('Segmentation fixture has no color frame OBU')
    const frame = parseAv1Frame(coded.sequence, frameObu.payload)
    const output = PNG.sync.read(await (await Image.open(input)).png().toBuffer())

    expect(createHash('sha256').update(input).digest('hex')).toBe(
      avifSegmentationFixture.fileSha256,
    )
    expect(frame.header).toMatchObject({
      baseQuantizer: 72,
      reducedTransformSet: true,
      segmentation: {
        enabled: true,
        lastActiveId: 3,
        preSkip: false,
      },
    })
    expect(
      frame.header.segmentation.featureData.slice(0, 4).map((features) => features[0]),
    ).toEqual(avifSegmentationFixture.segmentQuantizerDeltas)
    expect([output.width, output.height]).toEqual([
      avifSegmentationFixture.width,
      avifSegmentationFixture.height,
    ])
    expect(createHash('sha256').update(output.data).digest('hex')).toBe(
      avifSegmentationFixture.decodedRgbaSha256,
    )
  })

  it('rejects malformed intra-block-copy superblock overlaps', async () => {
    const input = await readFile(join(avifCorpusDirectory, 'ms-monochrome-residual-intrabc.avif'))
    const inspection = await inspectAvifBitstreams(new MemorySource(input))
    const coded = inspection.codedImages.find((image) => image.role === 'color')
    const frameObu = coded?.obus.find((obu) => obu.type === av1ObuType.frame)
    if (!coded || !frameObu) throw new Error('Residual IBC fixture has no color frame OBU')
    const frame = parseAv1Frame(coded.sequence, frameObu.payload)
    const tile = frame.tiles[0]
    if (!tile) throw new Error('Residual IBC fixture has no tile')

    const data = tile.data.slice()
    data[0] = (data[0] ?? 0) ^ 1
    let failure: unknown
    try {
      decodeRestrictedAv1Intra(coded.sequence, {
        ...frame,
        tiles: [{ ...tile, data }],
      })
    } catch (error) {
      failure = error
    }
    expect(failure).toMatchObject({ code: 'INVALID_INPUT' })
    if (!(failure instanceof Error)) throw new Error('Malformed IBC mutation was not rejected')
    expect(failure.message).toBe('AV1 intra-block-copy motion vector overlaps its superblock')
  })

  it.each(avifHighBitLosslessFixtures)(
    'decodes the pinned coded-lossless $bitDepth-bit identity-color fixture',
    async (fixture) => {
      const input = await readFile(join(avifHighBitLosslessFixtureDirectory, fixture.file))
      const inspection = await inspectAvifBitstreams(new MemorySource(input))
      const output = PNG.sync.read(await (await Image.open(input)).png().toBuffer())
      const oracle = await sharp(input).removeAlpha().raw().toBuffer()

      expect(createHash('sha256').update(input).digest('hex')).toBe(fixture.fileSha256)
      expect(inspection.codedImages[0]?.sequence).toMatchObject({
        bitDepth: fixture.bitDepth,
        chromaSubsampling: '444',
        fullRange: true,
      })
      expect(inspection.nclx).toMatchObject({ fullRange: true, matrixCoefficients: 0 })
      const coded = inspection.codedImages[0]
      const frameObu = coded?.obus.find((obu) => obu.type === av1ObuType.frame)
      if (!coded || !frameObu) throw new Error('High-bit-depth fixture has no AV1 frame OBU')
      const frame = parseAv1Frame(coded.sequence, frameObu.payload)
      expect(frame.header.codedLossless).toBe(true)
      const decoded = decodeRestrictedAv1Intra(coded.sequence, frame)
      const maximum = 2 ** fixture.bitDepth - 1
      let maximumPlaneDifference = 0
      for (let y = 0; y < fixture.height; y += 1) {
        for (let x = 0; x < fixture.width; x += 1) {
          const expected = [
            Math.round((x * maximum) / (fixture.width - 1)),
            Math.round((y * maximum) / (fixture.height - 1)),
            Math.round((((x ^ y) & 15) * maximum) / 15),
          ] as const
          maximumPlaneDifference = Math.max(
            maximumPlaneDifference,
            Math.abs((decoded.y[y * decoded.yStride + x] ?? 0) - expected[0]),
            Math.abs((decoded.u[y * decoded.chromaStride + x] ?? 0) - expected[1]),
            Math.abs((decoded.v[y * decoded.chromaStride + x] ?? 0) - expected[2]),
          )
        }
      }
      expect(maximumPlaneDifference).toBe(0)
      expect([output.width, output.height]).toEqual([fixture.width, fixture.height])
      expect(createHash('sha256').update(output.data).digest('hex')).toBe(fixture.decodedRgbaSha256)
      expect(createHash('sha256').update(oracle).digest('hex')).toBe(fixture.sharpRgbSha256)
      let maximumDifference = 0
      for (let pixel = 0; pixel < fixture.width * fixture.height; pixel += 1) {
        for (let channel = 0; channel < 3; channel += 1) {
          maximumDifference = Math.max(
            maximumDifference,
            Math.abs((output.data[pixel * 4 + channel] ?? 0) - (oracle[pixel * 3 + channel] ?? 0)),
          )
        }
      }
      expect(maximumDifference).toBeLessThanOrEqual(1)
    },
  )

  it('decodes a coded-lossless 10-bit 2x2 AV1 tile layout exactly', async () => {
    const fixture = avifTiledLosslessFixture
    const input = await readFile(avifTiledLosslessFixturePath)
    const inspection = await inspectAvifBitstreams(new MemorySource(input))
    const coded = inspection.codedImages.find((image) => image.role === 'color')
    const frameObu = coded?.obus.find((obu) => obu.type === av1ObuType.frame)
    if (!coded || !frameObu) throw new Error('Tiled AVIF fixture has no color frame OBU')
    const frame = parseAv1Frame(coded.sequence, frameObu.payload)
    const output = PNG.sync.read(await (await Image.open(input)).png().toBuffer())
    const decoded = decodeRestrictedAv1Intra(coded.sequence, frame)

    expect(createHash('sha256').update(input).digest('hex')).toBe(fixture.fileSha256)
    expect(coded.sequence).toMatchObject({
      bitDepth: fixture.bitDepth,
      chromaSubsampling: '444',
      fullRange: true,
    })
    expect(frame.header).toMatchObject({
      allLossless: true,
      tileColumns: fixture.columns,
      tileRows: fixture.rows,
    })
    expect(
      frame.tiles.map((tile) => [
        tile.miColumnStart,
        tile.miRowStart,
        tile.miColumnEnd,
        tile.miRowEnd,
      ]),
    ).toEqual([
      [0, 0, 32, 32],
      [32, 0, 64, 32],
      [0, 32, 32, 64],
      [32, 32, 64, 64],
    ])
    const planes = [decoded.y, decoded.u, decoded.v] as const
    let maximumPlaneDifference = 0
    for (const plane of [0, 1, 2] as const) {
      const samples = planes[plane]
      const stride = plane === 0 ? decoded.yStride : decoded.chromaStride
      for (let y = 0; y < fixture.height; y += 1) {
        for (let x = 0; x < fixture.width; x += 1) {
          maximumPlaneDifference = Math.max(
            maximumPlaneDifference,
            Math.abs((samples[y * stride + x] ?? 0) - tiledLosslessSample(plane, x, y)),
          )
        }
      }
    }
    expect(maximumPlaneDifference).toBe(0)
    expect(createHash('sha256').update(output.data).digest('hex')).toBe(fixture.decodedRgbaSha256)
  })

  it('decodes a lossy 8-bit 2x2 AV1 tile layout through all post-filters', async () => {
    const fixture = avifLossyMultitileFixture
    const input = await readFile(avifLossyMultitileFixturePath)
    const inspection = await inspectAvifBitstreams(new MemorySource(input))
    const coded = inspection.codedImages.find((image) => image.role === 'color')
    const frameObu = coded?.obus.find((obu) => obu.type === av1ObuType.frame)
    if (!coded || !frameObu) throw new Error('Lossy multi-tile AVIF fixture has no color frame OBU')
    const frame = parseAv1Frame(coded.sequence, frameObu.payload)
    const decoded = decodeRestrictedAv1Intra(coded.sequence, frame)
    const output = PNG.sync.read(await (await Image.open(input)).png().toBuffer())

    expect(createHash('sha256').update(input).digest('hex')).toBe(fixture.fileSha256)
    expect(coded.sequence).toMatchObject({
      bitDepth: fixture.bitDepth,
      chromaSubsampling: fixture.chromaSubsampling,
      fullRange: false,
    })
    expect(frame.header).toMatchObject({
      allLossless: false,
      tileColumns: fixture.columns,
      tileRows: fixture.rows,
      loopFilterLevels: [23, 23, 0, 45],
      restorationTypes: [0, 2, 0],
    })
    expect(frame.header.cdefYPrimaryStrengths.some((strength) => strength !== 0)).toBe(true)
    const nativeYuv = new Uint8Array(
      decoded.width * decoded.height + 2 * decoded.chromaWidth * decoded.chromaHeight,
    )
    let offset = 0
    for (const [plane, stride, width, height] of [
      [decoded.y, decoded.yStride, decoded.width, decoded.height],
      [decoded.u, decoded.chromaStride, decoded.chromaWidth, decoded.chromaHeight],
      [decoded.v, decoded.chromaStride, decoded.chromaWidth, decoded.chromaHeight],
    ] as const) {
      for (let row = 0; row < height; row += 1) {
        nativeYuv.set(plane.subarray(row * stride, row * stride + width), offset)
        offset += width
      }
    }
    expect(createHash('sha256').update(nativeYuv).digest('hex')).toBe(fixture.pureYuvSha256)
    expect(createHash('sha256').update(output.data).digest('hex')).toBe(fixture.decodedRgbaSha256)
  })

  it('decodes non-reduced AV1 frame headers split across tile-group OBUs', async () => {
    const fixture = avifFullHeaderTileGroupsFixture
    const input = await readFile(avifFullHeaderTileGroupsFixturePath)
    const inspection = await inspectAvifBitstreams(new MemorySource(input))
    const coded = inspection.codedImages.find((image) => image.role === 'color')
    if (!coded) throw new Error('Full-header AVIF fixture has no color coded image')
    const frame = parseAv1FrameObus(coded.sequence, coded.obus)
    const output = PNG.sync.read(await (await Image.open(input)).png().toBuffer())

    expect(createHash('sha256').update(input).digest('hex')).toBe(fixture.fileSha256)
    expect(coded.sequence).toMatchObject({
      bitDepth: fixture.bitDepth,
      chromaSubsampling: fixture.chromaSubsampling,
      reducedStillPictureHeader: false,
      stillPicture: true,
    })
    expect(coded.obus.map((obu) => obu.type)).toEqual([
      av1ObuType.sequenceHeader,
      av1ObuType.frameHeader,
      av1ObuType.tileGroup,
      av1ObuType.tileGroup,
      av1ObuType.tileGroup,
      av1ObuType.tileGroup,
    ])
    expect(frame.header).toMatchObject({
      allLossless: false,
      tileColumns: fixture.columns,
      tileRows: fixture.rows,
    })
    expect(frame.tiles).toHaveLength(fixture.columns * fixture.rows)
    expect(createHash('sha256').update(output.data).digest('hex')).toBe(fixture.decodedRgbaSha256)
  })

  it('applies normative AV1 super-resolution to a filter-free 8-bit frame', async () => {
    const fixture = avifSuperresFixture
    const input = await readFile(avifSuperresFixturePath)
    const inspection = await inspectAvifBitstreams(new MemorySource(input))
    const coded = inspection.codedImages.find((image) => image.role === 'color')
    const frameObu = coded?.obus.find((obu) => obu.type === av1ObuType.frame)
    if (!coded || !frameObu) throw new Error('Super-resolution AVIF fixture has no color frame OBU')
    const frame = parseAv1Frame(coded.sequence, frameObu.payload)
    const output = PNG.sync.read(await (await Image.open(input)).png().toBuffer())
    const decoder = await avifCodec.createDecoder?.(new MemorySource(input), defaultImageLimits)
    if (!decoder) throw new Error('AVIF decoder is unavailable')
    const boundedHash = createHash('sha256')
    let boundedRows = 0
    for await (const block of decoder.decode()) {
      expect(block.height).toBeLessThanOrEqual(32)
      boundedRows += block.height
      boundedHash.update(block.data.subarray(0, block.stride * block.height))
    }
    const oracle = await sharp(input).removeAlpha().raw().toBuffer()

    expect(createHash('sha256').update(input).digest('hex')).toBe(fixture.fileSha256)
    expect(coded.sequence).toMatchObject({
      bitDepth: fixture.bitDepth,
      chromaSubsampling: fixture.chromaSubsampling,
      fullRange: true,
    })
    expect(frame.header).toMatchObject({
      frameWidth: fixture.codedWidth,
      frameHeight: fixture.height,
      upscaledWidth: fixture.width,
      loopFilterLevels: [0, 0, 0, 0],
      loopFilterDeltaEnabled: false,
      restorationTypes: [0, 0, 0],
    })
    expect([output.width, output.height]).toEqual([fixture.width, fixture.height])
    expect(decoder.capabilities.scaledDecode).toBe(true)
    expect(boundedRows).toBe(fixture.height)
    expect(boundedHash.digest('hex')).toBe(fixture.decodedRgbaSha256)
    expect(createHash('sha256').update(output.data).digest('hex')).toBe(fixture.decodedRgbaSha256)
    expect(createHash('sha256').update(oracle).digest('hex')).toBe(fixture.sharpRgbSha256)
    let maximumDifference = 0
    for (let pixel = 0; pixel < fixture.width * fixture.height; pixel += 1) {
      for (let channel = 0; channel < 3; channel += 1) {
        maximumDifference = Math.max(
          maximumDifference,
          Math.abs((output.data[pixel * 4 + channel] ?? 0) - (oracle[pixel * 3 + channel] ?? 0)),
        )
      }
    }
    expect(maximumDifference).toBe(0)
  })

  it('orders CDEF, super-resolution, and loop restoration for a filtered frame', async () => {
    const fixture = avifFilteredSuperresFixture
    const input = await readFile(avifFilteredSuperresFixturePath)
    const inspection = await inspectAvifBitstreams(new MemorySource(input))
    const coded = inspection.codedImages.find((image) => image.role === 'color')
    const frameObu = coded?.obus.find((obu) => obu.type === av1ObuType.frame)
    if (!coded || !frameObu) throw new Error('Filtered super-resolution fixture has no frame OBU')
    const frame = parseAv1Frame(coded.sequence, frameObu.payload)
    const decoded = decodeRestrictedAv1Intra(coded.sequence, frame)
    const output = PNG.sync.read(await (await Image.open(input)).png().toBuffer())
    const yuvHash = createHash('sha256')
    for (const [plane, stride, width, height] of [
      [decoded.y, decoded.yStride, decoded.width, decoded.height],
      [decoded.u, decoded.chromaStride, decoded.chromaWidth, decoded.chromaHeight],
      [decoded.v, decoded.chromaStride, decoded.chromaWidth, decoded.chromaHeight],
    ] as const) {
      for (let row = 0; row < height; row += 1) {
        yuvHash.update(plane.subarray(row * stride, row * stride + width))
      }
    }

    expect(createHash('sha256').update(input).digest('hex')).toBe(fixture.fileSha256)
    expect(frame.header).toMatchObject({
      frameWidth: fixture.codedWidth,
      frameHeight: fixture.height,
      upscaledWidth: fixture.width,
      superresDenominator: fixture.superresDenominator,
      loopFilterLevels: [0, 0, 0, 0],
      restorationTypes: [1, 1, 1],
    })
    expect(
      [...frame.header.cdefYPrimaryStrengths, ...frame.header.cdefUvPrimaryStrengths].some(
        (value) => value !== 0,
      ),
    ).toBe(true)
    expect(yuvHash.digest('hex')).toBe(fixture.decodedYuvSha256)
    expect([output.width, output.height]).toEqual([fixture.width, fixture.height])
    expect(createHash('sha256').update(output.data).digest('hex')).toBe(fixture.decodedRgbaSha256)
  })

  it.each([
    {
      name: 'single-band',
      fixture: avifSuperres420Fixture,
      path: avifSuperres420FixturePath,
    },
    {
      name: 'multi-band',
      fixture: avifBoundedSuperresFixture,
      path: avifBoundedSuperresFixturePath,
    },
  ])(
    'upscales subsampled AV1 chroma planes at their normative widths ($name)',
    async ({ fixture, path }) => {
      const input = await readFile(path)
      const inspection = await inspectAvifBitstreams(new MemorySource(input))
      const coded = inspection.codedImages.find((image) => image.role === 'color')
      const frameObu = coded?.obus.find((obu) => obu.type === av1ObuType.frame)
      if (!coded || !frameObu)
        throw new Error('YUV 4:2:0 super-resolution fixture has no frame OBU')
      const frame = parseAv1Frame(coded.sequence, frameObu.payload)
      const decoded = decodeRestrictedAv1Intra(coded.sequence, frame)
      const output = PNG.sync.read(await (await Image.open(input)).png().toBuffer())
      const decoder = await avifCodec.createDecoder?.(new MemorySource(input), defaultImageLimits)
      if (!decoder) throw new Error('AVIF decoder is unavailable')
      const boundedHash = createHash('sha256')
      for await (const block of decoder.decode()) {
        expect(block.height).toBeLessThanOrEqual(32)
        boundedHash.update(block.data.subarray(0, block.stride * block.height))
      }

      expect(createHash('sha256').update(input).digest('hex')).toBe(fixture.fileSha256)
      expect(coded.sequence.chromaSubsampling).toBe(fixture.chromaSubsampling)
      expect(frame.header).toMatchObject({
        frameWidth: fixture.codedWidth,
        upscaledWidth: fixture.width,
        loopFilterDeltaEnabled: false,
      })
      expect(decoded).toMatchObject({
        width: fixture.width,
        height: fixture.height,
        chromaWidth: fixture.width / 2,
        chromaHeight: fixture.height / 2,
      })
      expect(decoder.capabilities.scaledDecode).toBe(true)
      expect(boundedHash.digest('hex')).toBe(fixture.decodedRgbaSha256)
      expect(createHash('sha256').update(output.data).digest('hex')).toBe(fixture.decodedRgbaSha256)
    },
  )

  it('reconstructs a filter-free AVIF through a two-superblock row ring', async () => {
    const input = new Uint8Array(await readFile(avifBoundedRowFixturePath))
    expect(createHash('sha256').update(input).digest('hex')).toBe(avifBoundedRowFixture.fileSha256)
    const decoder = await avifCodec.createDecoder?.(new MemorySource(input), defaultImageLimits)
    if (!decoder) throw new Error('AVIF decoder is unavailable')
    const blocks: ReadonlyArray<number>[] = []
    const hash = createHash('sha256')
    for await (const block of decoder.decode()) {
      blocks.push([block.x, block.y, block.width, block.height, block.stride])
      hash.update(block.data)
    }

    expect(blocks).toEqual([
      [0, 0, 64, 32, 256],
      [0, 32, 64, 32, 256],
      [0, 64, 64, 32, 256],
      [0, 96, 64, 32, 256],
      [0, 128, 64, 32, 256],
      [0, 160, 64, 32, 256],
    ])
    expect(hash.digest('hex')).toBe(avifBoundedRowFixture.decodedRgbaSha256)
  })

  it('decimates bounded YUV rows before RGBA resize input', async () => {
    const input = new Uint8Array(await readFile(avifBoundedRowFixturePath))
    const decoder = await avifCodec.createDecoder?.(new MemorySource(input), defaultImageLimits)
    if (!decoder) throw new Error('AVIF decoder is unavailable')
    expect(decoder.capabilities.scaledDecode).toBe(true)
    const blocks: ReadonlyArray<number>[] = []
    const hash = createHash('sha256')
    for await (const block of decoder.decode({
      width: 16,
      height: 48,
      scaleDenominator: 4,
    })) {
      blocks.push([block.x, block.y, block.width, block.height, block.stride])
      hash.update(block.data)
    }
    expect(blocks).toEqual([
      [0, 0, 16, 16, 64],
      [0, 16, 16, 16, 64],
      [0, 32, 16, 16, 64],
    ])
    expect(hash.digest('hex')).toBe(
      '518122334ebc8a3ca083eb18eb8eb95c8de499076a30dc38a5a16d88cbd70c2b',
    )

    const fullPng = await (await Image.open(input)).png().toBuffer()
    const reference = PNG.sync.read(
      await (await Image.open(fullPng))
        .resize({ width: 16, height: 48, fit: 'fill' })
        .png()
        .toBuffer(),
    )
    const resized = PNG.sync.read(
      await (await Image.open(input))
        .resize({ width: 16, height: 48, fit: 'fill' })
        .png()
        .toBuffer(),
    )
    expect(resized.data).toEqual(reference.data)
    expect(createHash('sha256').update(resized.data).digest('hex')).toBe(
      '518122334ebc8a3ca083eb18eb8eb95c8de499076a30dc38a5a16d88cbd70c2b',
    )
  })

  it('rejects AV1 output dimensions that differ from the AVIF item', async () => {
    const input = new Uint8Array(await readFile(avifBoundedRowFixturePath))
    const inspection = await inspectAvifBitstreams(new MemorySource(input))
    const coded = inspection.codedImages.find((image) => image.role === 'color')
    const frameObu = coded?.obus.find((obu) => obu.type === av1ObuType.frame)
    if (!coded || !frameObu) throw new Error('Bounded AVIF fixture has no coded frame')
    const frame = parseAv1Frame(coded.sequence, frameObu.payload)

    expect(() =>
      validateAvifFrameDimensions(coded, {
        ...frame,
        header: { ...frame.header, upscaledWidth: frame.header.upscaledWidth - 1 },
      }),
    ).toThrow(expect.objectContaining({ code: 'INVALID_INPUT' }))
  })

  it('decodes aligned alpha through synchronized bounded row rings', async () => {
    const input = new Uint8Array(await readFile(avifBoundedAlphaRowFixturePath))
    expect(createHash('sha256').update(input).digest('hex')).toBe(
      avifBoundedAlphaRowFixture.fileSha256,
    )
    const decoder = await avifCodec.createDecoder?.(new MemorySource(input), defaultImageLimits)
    if (!decoder) throw new Error('AVIF decoder is unavailable')
    const blocks: ReadonlyArray<number>[] = []
    const hash = createHash('sha256')
    for await (const block of decoder.decode()) {
      blocks.push([block.x, block.y, block.width, block.height, block.stride])
      hash.update(block.data)
    }

    expect(blocks).toEqual([
      [0, 0, 64, 32, 256],
      [0, 32, 64, 32, 256],
      [0, 64, 64, 32, 256],
      [0, 96, 64, 32, 256],
      [0, 128, 64, 32, 256],
      [0, 160, 64, 32, 256],
    ])
    expect(hash.digest('hex')).toBe(avifBoundedAlphaRowFixture.decodedRgbaSha256)

    const scaledHash = createHash('sha256')
    for await (const block of decoder.decode({
      width: 16,
      height: 48,
      scaleDenominator: 4,
    })) {
      scaledHash.update(block.data)
    }
    expect(scaledHash.digest('hex')).toBe(
      '2bb33916480cc892ff7c41bd0ffd0ab08dff5bc5141777c918167f46439e6575',
    )
  })

  it.each(avifAlphaFixtures)('decodes $file and composes its alpha item', async (fixture) => {
    const input = await readFile(join(avifCorpusDirectory, fixture.file))
    const inspection = await inspectAvifBitstreams(new MemorySource(input))
    const image = await Image.open(input)
    const metadata = await image.metadata()
    const output = PNG.sync.read(await image.png().toBuffer())

    expect(inspection.premultipliedAlpha).toBe(fixture.premultiplied)
    expect(metadata.hasAlpha).toBe(true)
    expect([output.width, output.height]).toEqual([fixture.width, fixture.height])
    expect(createHash('sha256').update(output.data).digest('hex')).toBe(fixture.decodedRgbaSha256)
  })

  it.each(avifGainMapFixtures)(
    'decodes and applies the resampled gain map from $file',
    async (fixture) => {
      const input = new Uint8Array(await readFile(join(avifCorpusDirectory, fixture.file)))
      const inspection = await inspectAvifBitstreams(new MemorySource(input))
      const decoder = await avifCodec.createDecoder?.(new MemorySource(input), defaultImageLimits)
      if (!decoder) throw new Error('AVIF decoder is unavailable')
      const hash = createHash('sha256')
      let nextY = 0
      for await (const block of decoder.decode()) {
        expect(block).toMatchObject({
          x: 0,
          y: nextY,
          width: fixture.width,
          stride: fixture.width * 4,
          format: 'rgba8',
        })
        expect(block.height).toBeLessThanOrEqual(32)
        nextY += block.height
        hash.update(block.data)
      }

      expect(createHash('sha256').update(input).digest('hex')).toBe(fixture.fileSha256)
      expect([decoder.width, decoder.height, nextY]).toEqual([
        fixture.width,
        fixture.height,
        fixture.height,
      ])
      expect(inspection.primaryItemType === 'grid').toBe(fixture.baseGrid)
      expect(inspection.gainMap?.gainMapItemType === 'grid').toBe(fixture.gainMapGrid)
      expect(
        inspection.alphaItemId !== undefined || inspection.alphaAssociations.length !== 0,
      ).toBe(fixture.hasAlpha)
      expect(hash.digest('hex')).toBe(fixture.decodedRgbaSha256)
    },
    30_000,
  )

  it('synthesizes checksum-pinned AV1 film grain after reconstruction filters', async () => {
    const input = new Uint8Array(await readFile(avifFilmGrainFixturePath))
    const inspection = await inspectAvifBitstreams(new MemorySource(input))
    const coded = inspection.codedImages.find((image) => image.role === 'color')
    if (!coded) throw new Error('AVIF film-grain fixture has no color item')
    const frame = parseAv1FrameObus(coded.sequence, coded.obus)
    const decoder = await avifCodec.createDecoder?.(new MemorySource(input), defaultImageLimits)
    if (!decoder) throw new Error('AVIF decoder is unavailable')
    const hash = createHash('sha256')
    let nextY = 0
    for await (const block of decoder.decode()) {
      expect(block.y).toBe(nextY)
      expect(block.height).toBeLessThanOrEqual(32)
      nextY += block.height
      hash.update(block.data)
    }

    expect(createHash('sha256').update(input).digest('hex')).toBe(avifFilmGrainFixture.fileSha256)
    expect(frame.header.filmGrain).toMatchObject({
      seed: 45_231,
      grainScaling: 11,
      arCoeffLag: 2,
      arCoeffShift: 8,
      overlap: false,
      clipToRestrictedRange: false,
    })
    expect(frame.header.filmGrain?.yPoints.length).toBeGreaterThan(0)
    expect([decoder.width, decoder.height, nextY]).toEqual([
      avifFilmGrainFixture.width,
      avifFilmGrainFixture.height,
      avifFilmGrainFixture.height,
    ])
    expect(hash.digest('hex')).toBe(avifFilmGrainFixture.decodedRgbaSha256)
  })

  it('composes a color grid whose AV1 tiles have matching alpha auxiliaries', async () => {
    const input = await readFile(join(avifAuxiliaryFixtureDirectory, avifAlphaGridFixture.file))
    const inspection = await inspectAvifBitstreams(new MemorySource(input))
    const image = await Image.open(input)
    const metadata = await image.metadata()
    const output = PNG.sync.read(await image.png().toBuffer())
    const alphaSamples = new Uint8Array(output.width * output.height)
    for (let index = 0, offset = 3; index < alphaSamples.length; index += 1, offset += 4) {
      alphaSamples[index] = output.data[offset] ?? 0
    }

    expect(createHash('sha256').update(input).digest('hex')).toBe(avifAlphaGridFixture.fileSha256)
    expect(inspection.primaryItemType).toBe('grid')
    expect(inspection.alphaAssociations).toHaveLength(inspection.colorItemIds.length)
    expect(metadata.hasAlpha).toBe(true)
    expect([output.width, output.height]).toEqual([
      avifAlphaGridFixture.width,
      avifAlphaGridFixture.height,
    ])
    expect(createHash('sha256').update(alphaSamples).digest('hex')).toBe(
      avifAlphaGridFixture.decodedAlphaSha256,
    )
    expect(createHash('sha256').update(output.data).digest('hex')).toBe(
      avifAlphaGridFixture.decodedRgbaSha256,
    )
  })

  it.each(avifAlphaTransformFixtures)(
    'applies the primary transform after composing $file alpha',
    async (fixture) => {
      const input = await readFile(join(avifAuxiliaryFixtureDirectory, fixture.file))
      const inspection = await inspectAvifBitstreams(new MemorySource(input))
      const output = PNG.sync.read(await (await Image.open(input)).png().toBuffer())

      expect(createHash('sha256').update(input).digest('hex')).toBe(fixture.fileSha256)
      expect(inspection.alphaAssociations).toHaveLength(1)
      expect(createHash('sha256').update(output.data).digest('hex')).toBe(
        avifAlphaTransformDecodedRgbaSha256,
      )
    },
  )

  it.each(avifAuxiliaryRoleFixtures)(
    'keeps gain-map, depth, and thumbnail items outside color and alpha roles in $file',
    async (fixture) => {
      const input = await readFile(join(avifAuxiliaryFixtureDirectory, fixture.file))
      const inspection = await inspectAvifBitstreams(new MemorySource(input))

      expect(createHash('sha256').update(input).digest('hex')).toBe(fixture.fileSha256)
      expect(inspection.codedImages.filter((image) => image.role === 'color')).toHaveLength(
        fixture.colorItems,
      )
      expect(inspection.codedImages.filter((image) => image.role === 'alpha')).toHaveLength(
        fixture.alphaItems,
      )
    },
  )

  it('rejects incomplete alpha coverage across a color grid', async () => {
    const input = Buffer.from(
      await readFile(join(avifAuxiliaryFixtureDirectory, avifAlphaGridFixture.file)),
    )
    const firstReference = input.indexOf('auxl')
    const secondReference = input.indexOf('auxl', firstReference + 4)
    expect(firstReference).toBeGreaterThanOrEqual(0)
    expect(secondReference).toBeGreaterThan(firstReference)
    input.write('free', secondReference, 'ascii')

    await expect(inspectAvifBitstreams(new MemorySource(input))).rejects.toMatchObject({
      code: 'INVALID_INPUT',
      message: 'AVIF grid has incomplete alpha auxiliary coverage',
    })
  })

  it('selects a complete spatial layer from a multi-frame AVIF item', async () => {
    const input = await readFile(avifLayeredFixturePath)
    const inspection = await inspectAvifBitstreams(new MemorySource(input))
    const coded = inspection.codedImages.find((image) => image.role === 'color')
    const output = PNG.sync.read(await (await Image.open(input)).png().toBuffer())

    expect(createHash('sha256').update(input).digest('hex')).toBe(avifLayeredFixture.fileSha256)
    expect(coded).toMatchObject({
      layerSelector: avifLayeredFixture.selectedSpatialId,
      layerSizes: avifLayeredFixture.layerSizes,
    })
    expect(
      coded?.obus.filter((obu) => obu.type === av1ObuType.frame).map((obu) => obu.spatialId),
    ).toEqual(avifLayeredFixture.spatialIds)
    expect([output.width, output.height]).toEqual([
      avifLayeredFixture.width,
      avifLayeredFixture.height,
    ])
    expect(createHash('sha256').update(output.data).digest('hex')).toBe(
      avifLayeredFixture.decodedRgbaSha256,
    )
  })

  it('decodes a selected base layer whose frame dimensions override the sequence maximum', async () => {
    const input = await readFile(avifSelectedBaseLayerFixturePath)
    const inspection = await inspectAvifBitstreams(new MemorySource(input))
    const coded = inspection.codedImages.find((image) => image.role === 'color')
    if (!coded) throw new Error('Selected base-layer AVIF fixture has no color item')
    const selected = coded.obus.find(
      (obu) =>
        obu.type === av1ObuType.frame &&
        obu.spatialId === avifSelectedBaseLayerFixture.selectedSpatialId,
    )
    if (!selected) throw new Error('Selected base-layer AVIF fixture has no selected frame')
    const frame = parseAv1Frame(coded.sequence, selected.payload)
    const output = PNG.sync.read(await (await Image.open(input)).png().toBuffer())

    expect(createHash('sha256').update(input).digest('hex')).toBe(
      avifSelectedBaseLayerFixture.fileSha256,
    )
    expect(coded).toMatchObject({
      width: avifSelectedBaseLayerFixture.width,
      height: avifSelectedBaseLayerFixture.height,
      layerSelector: avifSelectedBaseLayerFixture.selectedSpatialId,
    })
    expect(frame.header).toMatchObject({
      upscaledWidth: avifSelectedBaseLayerFixture.width,
      frameHeight: avifSelectedBaseLayerFixture.height,
      renderWidth: avifDependentLayerFixture.width,
      renderHeight: avifDependentLayerFixture.height,
    })
    expect([output.width, output.height]).toEqual([
      avifSelectedBaseLayerFixture.width,
      avifSelectedBaseLayerFixture.height,
    ])
    expect(createHash('sha256').update(output.data).digest('hex')).toBe(
      avifSelectedBaseLayerFixture.decodedRgbaSha256,
    )
  })

  it('rejects a selected base layer whose AVIF extents do not match its output frame', async () => {
    const input = Buffer.from(await readFile(avifSelectedBaseLayerFixturePath))
    const spatialExtents = input.indexOf('ispe')
    expect(spatialExtents).toBeGreaterThanOrEqual(0)
    input.writeUInt32BE(avifSelectedBaseLayerFixture.width + 1, spatialExtents + 8)

    await expect((await Image.open(input)).png().toBuffer()).rejects.toMatchObject({
      code: 'INVALID_INPUT',
      message: 'AVIF item 1 dimensions do not match its AV1 frame',
    })
  })

  it('rejects a layered AVIF whose selected output layer is absent', async () => {
    const input = Buffer.from(await readFile(avifLayeredFixturePath))
    const selector = input.indexOf('lsel')
    expect(selector).toBeGreaterThanOrEqual(0)
    input.writeUInt16BE(3, selector + 4)

    await expect((await Image.open(input)).png().toBuffer()).rejects.toMatchObject({
      code: 'INVALID_INPUT',
      message: 'AVIF item 1 has no output frame for selected spatial layer 3',
    })
  })

  it('classifies dependent progressive layers before rejecting inter-frame decode', async () => {
    const input = new Uint8Array(await readFile(avifDependentLayerFixturePath))
    const inspection = await inspectAvifBitstreams(new MemorySource(input))
    const coded = inspection.codedImages.find((image) => image.role === 'color')
    if (!coded) throw new Error('Dependent-layer AVIF fixture has no color item')
    const frameObus = coded.obus.filter((obu) => obu.type === av1ObuType.frame)

    expect(createHash('sha256').update(input).digest('hex')).toBe(
      avifDependentLayerFixture.fileSha256,
    )
    expect([coded.width, coded.height]).toEqual([
      avifDependentLayerFixture.width,
      avifDependentLayerFixture.height,
    ])
    expect(coded.layerSizes).toEqual(avifDependentLayerFixture.layerSizes)
    expect(frameObus.map((obu) => obu.spatialId)).toEqual(avifDependentLayerFixture.spatialIds)
    expect(frameObus.map((obu) => inspectAv1FrameHeader(coded.sequence, obu.payload).kind)).toEqual(
      avifDependentLayerFixture.frameKinds,
    )
    await expect((await Image.open(input)).png().toBuffer()).rejects.toMatchObject({
      code: 'UNSUPPORTED_OPERATION',
      message: 'AVIF dependent AV1 spatial enhancement layer 2 decode is not supported',
    })
  })

  it('rejects malformed layered indexing sizes and frame boundaries', async () => {
    const overflow = Buffer.from(await readFile(avifLayeredFixturePath))
    const indexing = overflow.indexOf('a1lx')
    expect(indexing).toBeGreaterThanOrEqual(0)
    overflow.writeUInt16BE(0xffff, indexing + 5)
    await expect(inspectAvifBitstreams(new MemorySource(overflow))).rejects.toMatchObject({
      code: 'INVALID_INPUT',
      message: 'AVIF item 1 a1lx layer sizes exceed its payload',
    })

    const misaligned = Buffer.from(await readFile(avifLayeredFixturePath))
    misaligned.writeUInt16BE((avifLayeredFixture.layerSizes[0] ?? 0) + 1, indexing + 5)
    misaligned.writeUInt16BE((avifLayeredFixture.layerSizes[1] ?? 0) - 1, indexing + 7)
    await expect((await Image.open(misaligned)).png().toBuffer()).rejects.toMatchObject({
      code: 'INVALID_INPUT',
      message: 'AVIF item 1 a1lx range does not contain one complete frame',
    })
  })

  it('decodes and composes a cropped-edge 1x5 AVIF image grid', async () => {
    const input = await readFile(join(avifCorpusDirectory, 'sofa_grid1x5_420.avif'))
    const inspection = await inspectAvifBitstreams(new MemorySource(input))
    const image = await Image.open(input)
    const output = PNG.sync.read(await image.png().toBuffer())
    const cropped = PNG.sync.read(
      await image.crop({ x: 91, y: 120, width: 173, height: 200 }).png().toBuffer(),
    )

    expect(inspection.primaryItemType).toBe('grid')
    expect(inspection.grid).toEqual({ rows: 5, columns: 1, width: 1024, height: 770 })
    expect([output.width, output.height]).toEqual([1024, 770])
    expect(createHash('sha256').update(output.data).digest('hex')).toBe(
      '7d3fb76660d21f8ffc24a440dc62f3e0ff90dcd933d5b3ee045b93b013dfd962',
    )
    expect(createHash('sha256').update(cropped.data).digest('hex')).toBe(
      '1a630160b490c1ab5879a03c4c4daefc308e8ea90c101ce5a06315be8c2e03d8',
    )
  })

  it('rejects an image grid whose payload and spatial extents disagree', async () => {
    const input = await readFile(join(avifCorpusDirectory, 'sofa_grid1x5_420.avif'))
    const gridPayloadOffset = input.indexOf(Uint8Array.of(0, 0, 4, 0, 4, 0, 3, 2))
    expect(gridPayloadOffset).toBeGreaterThanOrEqual(0)
    input[gridPayloadOffset + 5] = 1

    await expect(inspectAvifBitstreams(new MemorySource(input))).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    })
  })

  it('converts linear BT.2020 NCLX pixels to sRGB', async () => {
    const input = await readFile(avifColorFixturePath(avifRec2020Fixture))
    const inspection = await inspectAvifBitstreams(new MemorySource(input))
    const output = PNG.sync.read(await (await Image.open(input)).png().toBuffer())

    expect(createHash('sha256').update(input).digest('hex')).toBe(avifRec2020Fixture.fileSha256)
    expect(inspection.nclx).toMatchObject({
      primaries: 9,
      transferCharacteristics: 8,
    })
    expect([output.width, output.height]).toEqual([
      avifRec2020Fixture.width,
      avifRec2020Fixture.height,
    ])
    expect(createHash('sha256').update(output.data).digest('hex')).toBe(
      avifRec2020Fixture.rgbaSha256,
    )
  })

  it.each(avifIccFixtures)('applies the compatible RGB ICC profile in $file', async (fixture) => {
    const input = await readFile(avifColorFixturePath(fixture))
    const output = PNG.sync.read(await (await Image.open(input)).png().toBuffer())
    const oracle = await sharp(input).toColourspace('srgb').ensureAlpha().raw().toBuffer()

    expect(createHash('sha256').update(input).digest('hex')).toBe(fixture.fileSha256)
    expect([output.width, output.height]).toEqual([fixture.width, fixture.height])
    expect(output.data).toEqual(oracle)
    expect(createHash('sha256').update(output.data).digest('hex')).toBe(fixture.rgbaSha256)
  })

  it('applies an ISO gain map to an HDR base for SDR output', async () => {
    const input = await readFile(avifColorFixturePath(avifHdrGainMapFixture))
    const inspection = await inspectAvifBitstreams(new MemorySource(input))
    const output = PNG.sync.read(await (await Image.open(input)).png().toBuffer())

    expect(createHash('sha256').update(input).digest('hex')).toBe(avifHdrGainMapFixture.fileSha256)
    expect(inspection.gainMap).toMatchObject({
      gainMapItemId: 3,
      gainMapItemType: 'av01',
      toneMapItemId: 2,
      alternateColor: {
        primaries: 1,
        transferCharacteristics: 13,
      },
      metadata: {
        baseHdrHeadroom: { numerator: 13, denominator: 10 },
        alternateHdrHeadroom: { numerator: 0, denominator: 1 },
      },
    })
    expect(inspection.codedImages.filter((image) => image.role === 'gain-map')).toHaveLength(1)
    expect([output.width, output.height]).toEqual([
      avifHdrGainMapFixture.width,
      avifHdrGainMapFixture.height,
    ])
    expect(createHash('sha256').update(output.data).digest('hex')).toBe(
      avifHdrGainMapFixture.rgbaSha256,
    )
  })

  it('ignores a gain map whose tmap is not the preferred alternative', async () => {
    const input = await readFile(avifColorFixturePath(avifWrongAlternativeGainMapFixture))
    const inspection = await inspectAvifBitstreams(new MemorySource(input))
    const output = PNG.sync.read(await (await Image.open(input)).png().toBuffer())
    expect(createHash('sha256').update(input).digest('hex')).toBe(
      avifWrongAlternativeGainMapFixture.fileSha256,
    )
    expect(inspection.gainMap).toBeUndefined()
    expect(inspection.codedImages.filter((image) => image.role === 'gain-map')).toHaveLength(0)
    expect([output.width, output.height]).toEqual([400, 300])
    expect(createHash('sha256').update(output.data).digest('hex')).toBe(
      '6128047c75194f836f7eea8ee0bf3f1473ef2d956a5b02262f46e96d436c672e',
    )
  })

  it('rejects a gain map with a zero HDR-headroom denominator', async () => {
    const input = Buffer.from(await readFile(avifColorFixturePath(avifHdrGainMapFixture)))
    const marker = Buffer.from('0000000000800000000d0000000a0000000000000001', 'hex')
    const toneMapPayload = input.indexOf(marker)
    expect(toneMapPayload).toBeGreaterThanOrEqual(0)
    input.writeUInt32BE(0, toneMapPayload + 10)

    await expect(inspectAvifBitstreams(new MemorySource(input))).rejects.toMatchObject({
      code: 'INVALID_INPUT',
      message: 'AVIF gain-map metadata has a zero headroom denominator',
    })
  })

  it('applies the BT.2100 HLG system gamma once from shared scene luminance', () => {
    const toneMap = createNclxHdrToneMap(9, 18)
    const output = new Uint8Array(8)

    expect(toneMap.encodedToLinear[2048]).toBeCloseTo(1 / 12, 7)
    writeNclxHdrToneMappedRgba(output, 0, 0.75, 0.5, 0.25, toneMap)
    writeNclxHdrToneMappedRgba(output, 4, 0.5, 0.5, 0.5, toneMap)

    expect(output).toEqual(Uint8Array.of(234, 101, 40, 255, 134, 134, 134, 255))
  })

  it('rejects matrix coefficients 10 with non-BT.2020 primaries before an HDR gain map', async () => {
    const input = Buffer.from(await readFile(avifColorFixturePath(avifHdrGainMapFixture)))
    const nclx = input.indexOf('nclx')
    expect(nclx).toBeGreaterThanOrEqual(0)
    expect(input.readUInt16BE(nclx + 6)).toBe(16)
    input.writeUInt16BE(10, nclx + 8)

    await expect((await Image.open(input)).png().toBuffer()).rejects.toMatchObject({
      code: 'UNSUPPORTED_OPERATION',
      message: 'HDR AVIF NCLX matrix coefficients 10 require color primaries 9',
    })
  })

  it('rejects explicit SDR AV1 CICP signaling that conflicts with HDR NCLX', async () => {
    const fixture = avifHdrToneMapFixtures.find(
      (candidate) => candidate.sequenceColorSignaling !== 'unspecified',
    )
    if (!fixture) throw new Error('Explicit-CICP HDR AVIF fixture is missing')
    const input = Buffer.from(await readFile(avifColorFixturePath(fixture)))
    const inspection = await inspectAvifBitstreams(new MemorySource(input))
    const color = inspection.codedImages.find((image) => image.role === 'color')
    const sequenceObu = color?.obus.find((obu) => obu.type === av1ObuType.sequenceHeader)
    if (!color || !sequenceObu) throw new Error('HDR AVIF fixture has no color sequence header')
    expect(color.sequence).toMatchObject({
      colorPrimaries: fixture.primaries,
      transferCharacteristics: fixture.transferCharacteristics,
      matrixCoefficients: fixture.matrixCoefficients,
    })

    const payloadOffset = input.indexOf(sequenceObu.payload)
    expect(payloadOffset).toBeGreaterThanOrEqual(0)
    const expectedCicp =
      (fixture.primaries << 16) |
      (fixture.transferCharacteristics << 8) |
      fixture.matrixCoefficients
    const matches: number[] = []
    for (let bitOffset = 0; bitOffset <= sequenceObu.payload.byteLength * 8 - 24; bitOffset += 1) {
      let value = 0
      for (let bit = 0; bit < 24; bit += 1) {
        const position = bitOffset + bit
        value =
          (value << 1) |
          (((sequenceObu.payload[Math.floor(position / 8)] ?? 0) >>> (7 - (position % 8))) & 1)
      }
      if (value === expectedCicp) matches.push(bitOffset)
    }
    expect(matches).toHaveLength(1)
    const cicpBitOffset = matches[0]
    if (cicpBitOffset === undefined) throw new Error('HDR AV1 CICP bit offset is missing')
    const transferBitOffset = payloadOffset * 8 + cicpBitOffset + 8
    const sdrTransfer = 13
    for (let bit = 0; bit < 8; bit += 1) {
      const position = transferBitOffset + bit
      const byteOffset = Math.floor(position / 8)
      const mask = 1 << (7 - (position % 8))
      const current = input[byteOffset] ?? 0
      input[byteOffset] = ((sdrTransfer >>> (7 - bit)) & 1) === 1 ? current | mask : current & ~mask
    }

    await expect((await Image.open(input)).png().toBuffer()).rejects.toMatchObject({
      code: 'INVALID_INPUT',
      message: 'AVIF HDR container and AV1 color signaling do not match',
    })
  })

  it('tone-maps HLG AVIF pixels with the shared BT.2100 OOTF', async () => {
    const fixture = avifHdrToneMapFixtures.find(
      (candidate) => candidate.transferCharacteristics === 18,
    )
    if (!fixture) throw new Error('HLG AVIF fixture is missing')
    const input = await readFile(avifColorFixturePath(fixture))
    const inspection = await inspectAvifBitstreams(new MemorySource(input))
    const color = inspection.codedImages.find((image) => image.role === 'color')
    const output = PNG.sync.read(await (await Image.open(input)).png().toBuffer())

    expect(createHash('sha256').update(input).digest('hex')).toBe(fixture.fileSha256)
    expect(inspection.gainMap).toBeUndefined()
    expect(inspection.nclx).toMatchObject({
      primaries: fixture.primaries,
      transferCharacteristics: 18,
      matrixCoefficients: fixture.matrixCoefficients,
    })
    expect(color?.sequence).toMatchObject({
      colorPrimaries: 2,
      transferCharacteristics: 2,
      matrixCoefficients: 2,
    })
    expect([output.width, output.height]).toEqual([fixture.width, fixture.height])
    expect(createHash('sha256').update(output.data).digest('hex')).toBe(fixture.rgbaSha256)
  })

  // zimg's HLG conversion uses a componentwise EOTF, so only PQ is compared to
  // that oracle; the analytic BT.2100 triplets above cover HLG color semantics.
  it.each(avifHdrToneMapFixtures.filter((fixture) => fixture.transferCharacteristics === 16))(
    'tone-maps PQ NCLX pixels in $file within the pinned FFmpeg/zimg oracle tolerance',
    async (fixture) => {
      const input = await readFile(avifColorFixturePath(fixture))
      const oracleInput = await readFile(join(avifCorpusDirectory, fixture.oracleFile))
      const inspection = await inspectAvifBitstreams(new MemorySource(input))
      const color = inspection.codedImages.find((image) => image.role === 'color')
      const image = await Image.open(input)
      const output = PNG.sync.read(await image.png().toBuffer())
      const oracle = PNG.sync.read(oracleInput)

      expect(createHash('sha256').update(input).digest('hex')).toBe(fixture.fileSha256)
      expect(createHash('sha256').update(oracleInput).digest('hex')).toBe(fixture.oracleSha256)
      expect(inspection.gainMap).toBeUndefined()
      expect(inspection.nclx).toMatchObject({
        primaries: fixture.primaries,
        transferCharacteristics: fixture.transferCharacteristics,
        matrixCoefficients: fixture.matrixCoefficients,
      })
      expect(color?.sequence).toMatchObject(
        fixture.sequenceColorSignaling === 'unspecified'
          ? { colorPrimaries: 2, transferCharacteristics: 2, matrixCoefficients: 2 }
          : {
              colorPrimaries: fixture.primaries,
              transferCharacteristics: fixture.transferCharacteristics,
              matrixCoefficients: fixture.matrixCoefficients,
            },
      )
      expect((await image.metadata()).bitDepth).toBe(10)
      expect([output.width, output.height]).toEqual([fixture.width, fixture.height])
      expect([oracle.width, oracle.height]).toEqual([fixture.width, fixture.height])
      expect(createHash('sha256').update(output.data).digest('hex')).toBe(fixture.rgbaSha256)

      const errors = new Uint8Array(fixture.width * fixture.height * 3)
      let errorIndex = 0
      let errorSum = 0
      let errorSquareSum = 0
      let maximumAbsoluteError = 0
      for (let offset = 0; offset < output.data.byteLength; offset += 4) {
        for (let channel = 0; channel < 3; channel += 1) {
          const error = Math.abs(
            (output.data[offset + channel] ?? 0) - (oracle.data[offset + channel] ?? 0),
          )
          errors[errorIndex] = error
          errorIndex += 1
          errorSum += error
          errorSquareSum += error * error
          maximumAbsoluteError = Math.max(maximumAbsoluteError, error)
        }
      }
      errors.sort()
      const meanAbsoluteError = errorSum / errors.length
      const p95AbsoluteError = errors[Math.ceil(errors.length * 0.95) - 1] ?? 255
      const rootMeanSquareError = Math.sqrt(errorSquareSum / errors.length)
      const psnr = 20 * Math.log10(255 / rootMeanSquareError)
      expect(maximumAbsoluteError, avifHdrToneMapOracle).toBeLessThanOrEqual(
        fixture.maximumAbsoluteError,
      )
      expect(meanAbsoluteError, avifHdrToneMapOracle).toBeLessThanOrEqual(
        fixture.maximumMeanAbsoluteError,
      )
      expect(p95AbsoluteError, avifHdrToneMapOracle).toBeLessThanOrEqual(
        fixture.maximumP95AbsoluteError,
      )
      expect(psnr, avifHdrToneMapOracle).toBeGreaterThanOrEqual(fixture.minimumPsnr)
    },
  )

  it('tone-maps chroma-derived non-constant-luminance P3/PQ pixels', async () => {
    const fixture = avifHdrChromaDerivedFixture
    const input = await readFile(avifColorFixturePath(fixture))
    const inspection = await inspectAvifBitstreams(new MemorySource(input))
    const output = PNG.sync.read(await (await Image.open(input)).png().toBuffer())

    expect(createHash('sha256').update(input).digest('hex')).toBe(fixture.fileSha256)
    expect(inspection.gainMap).toBeUndefined()
    expect(inspection.nclx).toMatchObject({
      primaries: fixture.primaries,
      transferCharacteristics: fixture.transferCharacteristics,
      matrixCoefficients: fixture.matrixCoefficients,
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
  })

  it.each([
    [
      'color primaries',
      4,
      22,
      'INVALID_INPUT',
      'AVIF HDR container and AV1 color signaling do not match',
    ],
    [
      'matrix coefficients',
      8,
      11,
      'UNSUPPORTED_OPERATION',
      'HDR AVIF NCLX matrix coefficients 11 are not supported',
    ],
  ] as const)(
    'rejects invalid or unsupported HDR NCLX %s explicitly',
    async (_name, offset, value, code, message) => {
      const fixture = avifHdrToneMapFixtures[0]
      if (!fixture) throw new Error('HDR AVIF fixture is missing')
      const input = Buffer.from(await readFile(avifColorFixturePath(fixture)))
      const nclx = input.indexOf('nclx')
      expect(nclx).toBeGreaterThanOrEqual(0)
      input.writeUInt16BE(value, nclx + offset)

      await expect((await Image.open(input)).png().toBuffer()).rejects.toMatchObject({
        code,
        message,
      })
    },
  )

  it('rejects a sequence-only AVIF instead of fabricating pixels', async () => {
    await expect((await Image.open(avifBitstreamFixture())).png().toBuffer()).rejects.toMatchObject(
      {
        code: 'UNSUPPORTED_OPERATION',
      },
    )
  })
})

describe('AVIF constrained encode', () => {
  const rgbaPng = (width: number, height: number, data: Uint8Array): Buffer => {
    const image = new PNG({ width, height })
    image.data.set(data)
    return PNG.sync.write(image)
  }

  it('encodes deterministic single-tile YUV 4:2:0 output accepted by independent decoders', async () => {
    const width = 9
    const height = 7
    const data = new Uint8Array(width * height * 4)
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const pixel = (y * width + x) * 4
        data[pixel] = (x * 29 + y * 7) & 255
        data[pixel + 1] = (x * 3 + y * 37) & 255
        data[pixel + 2] = (x * 19 + y * 11) & 255
        data[pixel + 3] = (x * 23 + y * 31) & 255
      }
    }
    const input = rgbaPng(width, height, data)
    const output = await (await Image.open(input)).avif({ background: '#204060' }).toBuffer()
    const encoded = await (await Image.open(input))
      .encode('avif', { background: '#204060' })
      .toBuffer()
    const metadata = await (await Image.open(output)).metadata()
    const portable = PNG.sync.read(await (await Image.open(output)).png().toBuffer())
    const native = await sharp(output).ensureAlpha().raw().toBuffer({ resolveWithObject: true })

    expect(encoded).toEqual(output)
    expect(createHash('sha256').update(output).digest('hex')).toBe(
      'f02109c6def843efdd1c8a7966a4b39eaa65875f9fbeda472b067d58896473bd',
    )
    expect(metadata).toMatchObject({
      format: 'avif',
      width,
      height,
      hasAlpha: false,
      bitDepth: 8,
      chromaSubsampling: '420',
      codecProfile: 0,
      colorProfile: {
        kind: 'nclx',
        primaries: 1,
        transferCharacteristics: 13,
        matrixCoefficients: 1,
        fullRange: true,
      },
    })
    expect([native.info.width, native.info.height, native.info.channels]).toEqual([
      width,
      height,
      4,
    ])
    expect(createHash('sha256').update(portable.data).digest('hex')).toBe(
      '8d83d999672fc2dd74b06ddc4328e434386fbd4cb53598705db3ada798e27ead',
    )
    expect(createHash('sha256').update(native.data).digest('hex')).toBe(
      '71262093f6dc24f3de35b97cec1e1de76a646cb71a664c129ab5c3eb5f83e1ba',
    )
  })

  it('encodes odd dimensions across 64x64 superblock boundaries', async () => {
    const width = 65
    const height = 67
    const data = new Uint8Array(width * height * 4)
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const pixel = (y * width + x) * 4
        data[pixel] = (x * 7 + y * 3) & 255
        data[pixel + 1] = (x * 2 + y * 5) & 255
        data[pixel + 2] = (x * 11 + y * 13) & 255
        data[pixel + 3] = (x + y) & 255
      }
    }
    const output = await (await Image.open(rgbaPng(width, height, data)))
      .avif({ background: '#204060' })
      .toBuffer()
    const decoded = await sharp(output).metadata()

    expect([decoded.width, decoded.height]).toEqual([width, height])
    expect(createHash('sha256').update(output).digest('hex')).toBe(
      '23b5377a891a8f5a7f3237492c03d97ad0690b37d82bb5af46dc5763dd69b6fd',
    )
  })

  it('composites alpha against white by default or an explicit solid background', async () => {
    const input = rgbaPng(
      2,
      2,
      Uint8Array.from([255, 0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0]),
    )
    const white = await sharp(await (await Image.open(input)).avif().toBuffer())
      .ensureAlpha()
      .raw()
      .toBuffer()
    const black = await sharp(
      await (await Image.open(input)).avif({ background: '#000000' }).toBuffer(),
    )
      .ensureAlpha()
      .raw()
      .toBuffer()

    expect([...white]).toEqual([
      255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255,
    ])
    expect([...black]).toEqual([0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255])
  })

  it('rejects dimensions whose padded superblocks exceed one AV1 tile', async () => {
    const createEncoder = avifCodec.createEncoder
    if (!createEncoder) throw new Error('AVIF encoder is missing')
    await expect(
      createEncoder(new Uint8ArraySink(), {
        width: 4033,
        height: 2339,
        pixelFormat: 'rgba8',
        options: {},
        limits: defaultImageLimits,
      }),
    ).rejects.toMatchObject({
      code: 'UNSUPPORTED_OPERATION',
      message:
        'Constrained AVIF encoding supports one tile up to 4096px wide and 9437184 padded pixels',
    })
  })

  it('rejects heights that do not fit the AV1 sequence header', async () => {
    const createEncoder = avifCodec.createEncoder
    if (!createEncoder) throw new Error('AVIF encoder is missing')
    await expect(
      createEncoder(new Uint8ArraySink(), {
        width: 1,
        height: 65_537,
        pixelFormat: 'rgba8',
        options: {},
        limits: defaultImageLimits,
      }),
    ).rejects.toMatchObject({
      code: 'UNSUPPORTED_OPERATION',
      message: 'Constrained AVIF encoding supports frames up to 65536px high',
    })
  })

  it('rejects transparent background requests for the opaque encoder subset', async () => {
    const input = rgbaPng(1, 1, Uint8Array.of(0, 0, 0, 0))
    await expect(
      (await Image.open(input)).avif({ background: 'transparent' }).toBuffer(),
    ).rejects.toMatchObject({
      code: 'INVALID_INPUT',
      message: 'AVIF opaque output requires a solid #RRGGBB or #RRGGBBAA background',
    })
  })
})
