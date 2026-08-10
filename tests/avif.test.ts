import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { PNG } from 'pngjs'
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'

import {
  avifCleanApertureFixture,
  avifCleanApertureFixtureDirectory,
} from '../benchmark/avif/clean-aperture-fixture.ts'
import { avifAlphaFixtures } from '../benchmark/avif/alpha-fixtures.ts'
import {
  avifQ0FixtureDirectory,
  avifQ0LosslessFixture,
  avifQ0LossyFixture,
} from '../benchmark/avif/q0-fixtures.ts'
import {
  avifHighBitLosslessFixtureDirectory,
  avifHighBitLosslessFixtures,
} from '../benchmark/avif/high-bit-lossless-fixtures.ts'
import {
  avifHighBitExpandedFixturePath,
  avifHighBitExpandedFixtures,
} from '../benchmark/avif/high-bit-expanded-fixtures.ts'
import {
  avifTiledLosslessFixture,
  avifTiledLosslessFixturePath,
  tiledLosslessSample,
} from '../benchmark/avif/tiled-lossless-fixture.ts'
import {
  avifFullHeaderTileGroupsFixture,
  avifFullHeaderTileGroupsFixturePath,
  avifLossyMultitileFixture,
  avifLossyMultitileFixturePath,
} from '../benchmark/avif/lossy-multitile-fixture.ts'
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
import { avifCorpusDirectory } from '../benchmark/avif/corpus.ts'
import { avifBoundedRowFixture, avifBoundedRowFixturePath } from '../benchmark/avif/row-fixture.ts'
import {
  avifBoundedAlphaRowFixture,
  avifBoundedAlphaRowFixturePath,
} from '../benchmark/avif/row-alpha-fixture.ts'
import {
  avifNonstillSequenceFixture,
  avifNonstillSequenceFixturePath,
} from '../benchmark/avif/nonstill-sequence-fixture.ts'
import {
  avifCommonPhotoSyntaxFixturePath,
  avifCommonPhotoSyntaxFixtures,
} from '../benchmark/avif/common-photo-syntax-fixtures.ts'
import { av1ObuType } from '../src/codecs/av1.ts'
import { parseAv1Frame, parseAv1FrameObus } from '../src/codecs/av1-frame.ts'
import { decodeRestrictedAv1Intra } from '../src/codecs/av1-intra.ts'
import {
  avifCodec,
  inspectAvifBitstreams,
  validateAvifFrameDimensions,
  validateAvifWorkingBytes,
} from '../src/codecs/avif.ts'
import { defaultImageLimits } from '../src/limits.ts'
import { MemorySource } from '../src/source.ts'
import { channelSwappingRgbProfile } from './icc-fixtures.ts'
import { Image } from './image-library.ts'

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
    ...rotationProperties,
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
      label: 'fractional origin',
      cleanApertures: [[7, 1, 6, 1, 0, 1, 0, 1]],
      code: 'UNSUPPORTED_OPERATION',
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
  it('decodes a non-still sequence header containing one shown key frame', async () => {
    const fixture = avifNonstillSequenceFixture
    const input = await readFile(avifNonstillSequenceFixturePath)
    const metadata = await (await Image.open(input)).metadata()
    const inspection = await inspectAvifBitstreams(new MemorySource(input))
    const coded = inspection.codedImages.find((image) => image.role === 'color')
    if (!coded) throw new Error('Non-still sequence fixture has no color item')
    const output = PNG.sync.read(await (await Image.open(input)).png().toBuffer())

    expect(createHash('sha256').update(input).digest('hex')).toBe(fixture.fileSha256)
    expect(coded.sequence).toMatchObject({
      stillPicture: false,
      reducedStillPictureHeader: false,
    })
    expect(metadata).toMatchObject({
      bitDepth: 8,
      chromaSubsampling: '420',
      frames: 1,
      height: fixture.height,
      width: fixture.width,
    })
    expect([output.width, output.height]).toEqual([fixture.width, fixture.height])
    expect(createHash('sha256').update(output.data).digest('hex')).toBe(fixture.decodedRgbaSha256)
  }, 20_000)
  it.each(avifCommonPhotoSyntaxFixtures)(
    'decodes $file with portable common-photo syntax contexts',
    async (fixture) => {
      const input = await readFile(avifCommonPhotoSyntaxFixturePath(fixture))
      const image = await Image.open(input)
      const metadata = await image.metadata()
      const output = PNG.sync.read(await image.png().toBuffer())

      expect(createHash('sha256').update(input).digest('hex')).toBe(fixture.fileSha256)
      expect(metadata).toMatchObject({
        bitDepth: 8,
        chromaSubsampling: fixture.chromaSubsampling,
        height: fixture.height,
        width: fixture.width,
      })
      expect([output.width, output.height]).toEqual([fixture.width, fixture.height])
      expect(createHash('sha256').update(output.data).digest('hex')).toBe(fixture.rgbaSha256)
    },
    20_000,
  )

  it('keeps AVIF animation outside the pixel-decode boundary', async () => {
    const input = await readFile(
      join(avifCorpusDirectory, 'colors-animated-8bpc-alpha-exif-xmp.avif'),
    )

    await expect((await Image.open(input)).png().toBuffer()).rejects.toMatchObject({
      code: 'UNSUPPORTED_OPERATION',
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

  it.each(avifHighBitExpandedFixtures)(
    'decodes expanded $bitDepth-bit $chromaSubsampling AVIF fixture $file',
    async (fixture) => {
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
        fullRange: true,
      })
      expect(frame.header.codedLossless).toBe(fixture.codedLossless)
      if (!fixture.codedLossless) {
        expect(frame.header).toMatchObject({
          loopFilterLevels: [0, 0, 0, 0],
          restorationTypes: [0, 0, 0],
        })
        expect(frame.header.cdefYPrimaryStrengths.every((strength) => strength === 0)).toBe(true)
      }
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

  it.each([
    {
      file: 'kodim03_yuv420_8bpc.avif',
      width: 768,
      height: 512,
      rgbaSha256: '47e9bd0a4f371bc44abd8afeb3d1e271c94b423bd60f3edff7761cfbdcbe2375',
    },
    {
      file: 'fox.profile0.8bpc.yuv420.avif',
      width: 1204,
      height: 800,
      rgbaSha256: 'cd94cd9d459af6338f77cf401749656b647f88b9e357c737a0a88c34584a46ec',
    },
    {
      file: 'fox.profile0.8bpc.yuv420.monochrome.avif',
      width: 1204,
      height: 800,
      rgbaSha256: '207521f4de944619a5f14b107d39b2a4dab7aafe8fae3082ea6bbb4ba27b38bc',
    },
    {
      file: 'fox.profile1.8bpc.yuv444.avif',
      width: 1204,
      height: 800,
      rgbaSha256: 'd46498beea49ddf03420810e33d30a2534395827bd19b22a287a6031debf9cd1',
    },
    {
      file: 'fox.profile2.8bpc.yuv422.avif',
      width: 1204,
      height: 800,
      rgbaSha256: '4ef692312c9c87692b548ebbd6ba100feb3ec53f5b1929bdd9f2c86d78a31f95',
    },
  ] as const)('decodes the common opaque 8-bit photograph $file', async (fixture) => {
    const output = PNG.sync.read(
      await (await Image.open(join(avifCorpusDirectory, fixture.file))).png().toBuffer(),
    )

    expect([output.width, output.height]).toEqual([fixture.width, fixture.height])
    expect(createHash('sha256').update(output.data).digest('hex')).toBe(fixture.rgbaSha256)
  })
  it('converts a requested AVIF region into bounded ordered row blocks', async () => {
    const input = new Uint8Array(
      await readFile(join(avifCorpusDirectory, 'fox.profile0.8bpc.yuv420.avif')),
    )
    const decoder = await avifCodec.createDecoder?.(new MemorySource(input), defaultImageLimits)
    if (!decoder) throw new Error('AVIF decoder is unavailable')
    const blocks: ReadonlyArray<number>[] = []
    const hash = createHash('sha256')
    for await (const block of decoder.decode({ x: 37, y: 41, width: 73, height: 70 })) {
      blocks.push([block.x, block.y, block.width, block.height, block.stride])
      hash.update(block.data)
    }

    expect(blocks).toEqual([
      [0, 0, 73, 32, 292],
      [0, 32, 73, 32, 292],
      [0, 64, 73, 6, 292],
    ])
    expect(hash.digest('hex')).toBe(
      '78f5c448c85d19567bf74ac4d62a7f1835082d11d08fde361150d4bfdc1bffc9',
    )
  })

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

  it('rejects a sequence-only AVIF instead of fabricating pixels', async () => {
    await expect((await Image.open(avifBitstreamFixture())).png().toBuffer()).rejects.toMatchObject(
      {
        code: 'UNSUPPORTED_OPERATION',
      },
    )
  })
})
