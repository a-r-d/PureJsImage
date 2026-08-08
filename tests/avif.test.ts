import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { PNG } from 'pngjs'
import { describe, expect, it } from 'vitest'

import { avifCorpusDirectory } from '../benchmark/avif/corpus.ts'
import { inspectAvifBitstreams } from '../src/codecs/avif.ts'
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
  compatibleMajorBrand = false,
  height = 480,
  profile = 0,
  rotation,
  width = 640,
}: {
  alpha?: boolean
  bitDepth?: 8 | 10 | 12
  chroma?: '400' | '420' | '422' | '444'
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
    ...(rotation === undefined ? [] : [box('irot', [rotation])]),
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
      file: 'kodim03_yuv420_8bpc.avif',
      width: 768,
      height: 512,
      rgbaSha256: '8247dea62ef7bcb2a4508f2b4ebe55bee4aae63514eaf13c8c4a559527f44f98',
    },
    {
      file: 'fox.profile0.8bpc.yuv420.avif',
      width: 1204,
      height: 800,
      rgbaSha256: 'bc447990c95f074c8c1aa7cc9cac7b7fd0b262769a42d70457cfa86f454a7e75',
    },
  ] as const)('decodes the common opaque 8-bit 4:2:0 photograph $file', async (fixture) => {
    const output = PNG.sync.read(
      await (await Image.open(join(avifCorpusDirectory, fixture.file))).png().toBuffer(),
    )

    expect([output.width, output.height]).toEqual([fixture.width, fixture.height])
    expect(createHash('sha256').update(output.data).digest('hex')).toBe(fixture.rgbaSha256)
  })

  it('rejects a sequence-only AVIF instead of fabricating pixels', async () => {
    await expect((await Image.open(avifBitstreamFixture())).png().toBuffer()).rejects.toMatchObject(
      {
        code: 'UNSUPPORTED_OPERATION',
      },
    )
  })
})
