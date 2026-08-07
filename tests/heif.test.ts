import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'

import { inspectHeifBitstream } from '../src/codecs/heif.ts'
import { heicCodec, heifCodec } from '../src/codec-entries/heif.ts'
import {
  inspectHevcPps,
  inspectHevcSlice,
  inspectHevcSps,
  readHevcSliceData,
} from '../src/codecs/hevc.ts'
import { defaultImageLimits, MemorySource } from '../src/index.ts'
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

const base64Bytes = (value: string): Uint8Array => Uint8Array.from(Buffer.from(value, 'base64'))

class BitWriter {
  readonly #bits: number[] = []

  writeBit(value: number): void {
    this.#bits.push(value === 0 ? 0 : 1)
  }

  writeBits(value: number, count: number): void {
    for (let shift = count - 1; shift >= 0; shift -= 1) this.writeBit((value >>> shift) & 1)
  }

  writeUnsignedExpGolomb(value: number): void {
    const encoded = value + 1
    const bitCount = Math.floor(Math.log2(encoded)) + 1
    for (let index = 1; index < bitCount; index += 1) this.writeBit(0)
    this.writeBits(encoded, bitCount)
  }

  writeSignedExpGolomb(value: number): void {
    this.writeUnsignedExpGolomb(value <= 0 ? -2 * value : 2 * value - 1)
  }

  finishRbsp(): readonly number[] {
    this.writeBit(1)
    while (this.#bits.length % 8 !== 0) this.writeBit(0)
    const bytes: number[] = []
    for (let offset = 0; offset < this.#bits.length; offset += 8) {
      let value = 0
      for (let index = 0; index < 8; index += 1)
        value = value * 2 + (this.#bits[offset + index] ?? 0)
      bytes.push(value)
    }
    return bytes
  }
}

const writeProfileTierLevel = (writer: BitWriter, profile = 1): void => {
  writer.writeBits(0, 2)
  writer.writeBit(0)
  writer.writeBits(profile, 5)
  writer.writeBits(0, 32)
  writer.writeBits(0, 4)
  writer.writeBits(0, 32)
  writer.writeBits(0, 12)
  writer.writeBits(120, 8)
}

const escapeRbsp = (rbsp: readonly number[]): readonly number[] => {
  const escaped: number[] = []
  let zeroCount = 0
  for (const value of rbsp) {
    if (zeroCount >= 2 && value <= 3) {
      escaped.push(3)
      zeroCount = 0
    }
    escaped.push(value)
    zeroCount = value === 0 ? zeroCount + 1 : 0
  }
  return escaped
}

const parameterNal = (
  type: number,
  width: number,
  height: number,
  unsupportedExtension = false,
  profile = 1,
): readonly number[] => {
  const writer = new BitWriter()
  if (type === 32) {
    writer.writeBits(0, 4)
    writer.writeBit(1)
    writer.writeBit(1)
    writer.writeBits(0, 6)
    writer.writeBits(0, 3)
    writer.writeBit(1)
    writer.writeBits(0xffff, 16)
    writeProfileTierLevel(writer, profile)
  } else if (type === 33) {
    writer.writeBits(0, 4)
    writer.writeBits(0, 3)
    writer.writeBit(1)
    writeProfileTierLevel(writer, profile)
    writer.writeUnsignedExpGolomb(0)
    writer.writeUnsignedExpGolomb(1)
    writer.writeUnsignedExpGolomb(width)
    writer.writeUnsignedExpGolomb(height)
    writer.writeBit(0)
    writer.writeUnsignedExpGolomb(0)
    writer.writeUnsignedExpGolomb(0)
    writer.writeUnsignedExpGolomb(4)
    writer.writeBit(0)
    writer.writeUnsignedExpGolomb(0)
    writer.writeUnsignedExpGolomb(0)
    writer.writeUnsignedExpGolomb(0)
    writer.writeUnsignedExpGolomb(0)
    writer.writeUnsignedExpGolomb(3)
    writer.writeUnsignedExpGolomb(0)
    writer.writeUnsignedExpGolomb(3)
    writer.writeUnsignedExpGolomb(0)
    writer.writeUnsignedExpGolomb(0)
    writer.writeBit(0)
    writer.writeBit(0)
    writer.writeBit(0)
    writer.writeBit(0)
    writer.writeUnsignedExpGolomb(0)
    writer.writeBit(0)
    writer.writeBit(0)
    writer.writeBit(1)
    writer.writeBit(0)
    writer.writeBit(unsupportedExtension ? 1 : 0)
    if (unsupportedExtension) {
      writer.writeBit(1)
      writer.writeBits(0, 7)
    }
  } else if (type === 34) {
    writer.writeUnsignedExpGolomb(0)
    writer.writeUnsignedExpGolomb(0)
    writer.writeBit(0)
    writer.writeBit(0)
    writer.writeBits(0, 3)
    writer.writeBit(0)
    writer.writeBit(0)
    writer.writeUnsignedExpGolomb(0)
    writer.writeUnsignedExpGolomb(0)
    writer.writeSignedExpGolomb(0)
    writer.writeBit(1)
    writer.writeBit(0)
    writer.writeBit(0)
    writer.writeSignedExpGolomb(0)
    writer.writeSignedExpGolomb(0)
    writer.writeBit(0)
    writer.writeBit(0)
    writer.writeBit(0)
    writer.writeBit(0)
    writer.writeBit(0)
    writer.writeBit(0)
    writer.writeBit(0)
    writer.writeBit(0)
    writer.writeBit(0)
    writer.writeBit(0)
    writer.writeUnsignedExpGolomb(0)
    writer.writeBit(0)
    writer.writeBit(unsupportedExtension ? 1 : 0)
    if (unsupportedExtension) {
      writer.writeBit(1)
      writer.writeBits(0, 7)
    }
  }
  return [type << 1, 1, ...escapeRbsp(writer.finishRbsp())]
}

const richSpsNal = (): Uint8Array => {
  const writer = new BitWriter()
  writer.writeBits(0, 4)
  writer.writeBits(0, 3)
  writer.writeBit(1)
  writeProfileTierLevel(writer)
  writer.writeUnsignedExpGolomb(0)
  writer.writeUnsignedExpGolomb(1)
  writer.writeUnsignedExpGolomb(128)
  writer.writeUnsignedExpGolomb(96)
  writer.writeBit(0)
  writer.writeUnsignedExpGolomb(0)
  writer.writeUnsignedExpGolomb(0)
  writer.writeUnsignedExpGolomb(4)
  writer.writeBit(0)
  writer.writeUnsignedExpGolomb(0)
  writer.writeUnsignedExpGolomb(0)
  writer.writeUnsignedExpGolomb(0)
  writer.writeUnsignedExpGolomb(0)
  writer.writeUnsignedExpGolomb(3)
  writer.writeUnsignedExpGolomb(0)
  writer.writeUnsignedExpGolomb(3)
  writer.writeUnsignedExpGolomb(0)
  writer.writeUnsignedExpGolomb(0)
  writer.writeBit(1)
  writer.writeBit(1)
  for (let sizeId = 0; sizeId < 4; sizeId += 1) {
    for (let matrixId = 0; matrixId < 6; matrixId += sizeId === 3 ? 3 : 1) {
      if (sizeId === 0 && matrixId === 0) {
        writer.writeBit(1)
        for (let index = 0; index < 16; index += 1) writer.writeSignedExpGolomb(0)
      } else {
        writer.writeBit(0)
        writer.writeUnsignedExpGolomb(0)
      }
    }
  }
  writer.writeBit(1)
  writer.writeBit(1)
  writer.writeBit(1)
  writer.writeBits(7, 4)
  writer.writeBits(7, 4)
  writer.writeUnsignedExpGolomb(0)
  writer.writeUnsignedExpGolomb(0)
  writer.writeBit(0)
  writer.writeUnsignedExpGolomb(1)
  writer.writeUnsignedExpGolomb(1)
  writer.writeUnsignedExpGolomb(0)
  writer.writeUnsignedExpGolomb(0)
  writer.writeBit(1)
  writer.writeBit(1)
  writer.writeUnsignedExpGolomb(1)
  writer.writeBits(0, 8)
  writer.writeBit(1)
  writer.writeBit(1)
  writer.writeBit(1)
  writer.writeBit(1)
  writer.writeBit(0)
  writer.writeBit(0)
  writer.writeBit(1)
  writer.writeBits(5, 3)
  writer.writeBit(1)
  writer.writeBit(1)
  writer.writeBits(1, 8)
  writer.writeBits(13, 8)
  writer.writeBits(6, 8)
  writer.writeBit(1)
  writer.writeUnsignedExpGolomb(0)
  writer.writeUnsignedExpGolomb(0)
  writer.writeBits(0, 3)
  writer.writeBit(0)
  writer.writeBit(0)
  writer.writeBit(0)
  writer.writeBit(0)
  return Uint8Array.from([66, 1, ...escapeRbsp(writer.finishRbsp())])
}

const tiledPpsNal = (): Uint8Array => {
  const writer = new BitWriter()
  writer.writeUnsignedExpGolomb(0)
  writer.writeUnsignedExpGolomb(0)
  writer.writeBit(0)
  writer.writeBit(0)
  writer.writeBits(0, 3)
  writer.writeBit(0)
  writer.writeBit(0)
  writer.writeUnsignedExpGolomb(0)
  writer.writeUnsignedExpGolomb(0)
  writer.writeSignedExpGolomb(0)
  writer.writeBit(1)
  writer.writeBit(0)
  writer.writeBit(0)
  writer.writeSignedExpGolomb(0)
  writer.writeSignedExpGolomb(0)
  writer.writeBit(0)
  writer.writeBit(0)
  writer.writeBit(0)
  writer.writeBit(0)
  writer.writeBit(1)
  writer.writeBit(1)
  writer.writeUnsignedExpGolomb(1)
  writer.writeUnsignedExpGolomb(1)
  writer.writeBit(0)
  writer.writeUnsignedExpGolomb(0)
  writer.writeUnsignedExpGolomb(0)
  writer.writeBit(1)
  writer.writeBit(1)
  writer.writeBit(1)
  writer.writeBit(1)
  writer.writeBit(0)
  writer.writeSignedExpGolomb(0)
  writer.writeSignedExpGolomb(0)
  writer.writeBit(0)
  writer.writeBit(0)
  writer.writeUnsignedExpGolomb(0)
  writer.writeBit(1)
  writer.writeBit(0)
  return Uint8Array.from([68, 1, ...escapeRbsp(writer.finishRbsp())])
}

const tiledSliceNal = (): Uint8Array => {
  const writer = new BitWriter()
  writer.writeBit(1)
  writer.writeBit(0)
  writer.writeUnsignedExpGolomb(0)
  writer.writeUnsignedExpGolomb(2)
  writer.writeBit(1)
  writer.writeBit(1)
  writer.writeSignedExpGolomb(0)
  writer.writeBit(0)
  writer.writeBit(1)
  writer.writeUnsignedExpGolomb(1)
  writer.writeUnsignedExpGolomb(2)
  writer.writeBits(3, 3)
  writer.writeUnsignedExpGolomb(1)
  writer.writeBits(0xab, 8)
  return Uint8Array.from([38, 1, ...escapeRbsp([...writer.finishRbsp(), 0, 0, 0, 0, 0, 0])])
}

const sliceNal = ({
  address = 0,
  ctbCount,
  first = true,
  type = 19,
}: {
  address?: number
  ctbCount: number
  first?: boolean
  type?: number
}): readonly number[] => {
  const writer = new BitWriter()
  writer.writeBit(first ? 1 : 0)
  writer.writeBit(0)
  writer.writeUnsignedExpGolomb(0)
  if (!first) writer.writeBits(address, Math.ceil(Math.log2(ctbCount)))
  writer.writeUnsignedExpGolomb(2)
  writer.writeSignedExpGolomb(0)
  return [type << 1, 1, ...escapeRbsp(writer.finishRbsp()), 0, 0]
}

const lengthPrefixedNal = (nal: readonly number[] | Uint8Array): readonly number[] => [
  ...bytes32(nal.length),
  ...nal,
]

const parameterArray = (
  type: number,
  width: number,
  height: number,
  profile: number,
  ppsOverride: readonly number[] | Uint8Array | undefined,
): readonly number[] => {
  const nal =
    type === 34 && ppsOverride ? ppsOverride : parameterNal(type, width, height, false, profile)
  return [0x80 | type, 0, 1, (nal.length >>> 8) & 0xff, nal.length & 0xff, ...nal]
}

const hevcConfiguration = (
  parameterTypes: readonly number[] = [32, 33, 34],
  width = 4032,
  height = 3024,
  profile = 1,
  ppsOverride?: readonly number[] | Uint8Array,
): readonly number[] => [
  1,
  profile,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  120,
  0xf0,
  0,
  0xfc,
  0xfd,
  0xf8,
  0xf8,
  0,
  0,
  7,
  parameterTypes.length,
  ...parameterTypes.flatMap((type) => parameterArray(type, width, height, profile, ppsOverride)),
]

const heifFixture = ({
  brand = 'heic',
  cleanAperture,
  configurationPps,
  configurationProfile = 1,
  configurationWidth,
  externalDataReference = false,
  height = 3024,
  itemExtentLength,
  itemNalType = 19,
  multipleExtents = false,
  mirrorAxis,
  parameterTypes,
  protectedItem = false,
  rotation,
  sliceAddresses = [0],
  unknownEssentialProperty = false,
  width = 4032,
}: {
  brand?: string
  cleanAperture?: {
    readonly height: number
    readonly heightDenominator?: number
    readonly width: number
    readonly widthDenominator?: number
  }
  configurationPps?: readonly number[] | Uint8Array
  configurationProfile?: number
  configurationWidth?: number
  externalDataReference?: boolean
  height?: number
  itemExtentLength?: number
  itemNalType?: number
  multipleExtents?: boolean
  mirrorAxis?: 0 | 1
  parameterTypes?: readonly number[]
  protectedItem?: boolean
  rotation?: 0 | 1 | 2 | 3
  sliceAddresses?: readonly number[]
  unknownEssentialProperty?: boolean
  width?: number
} = {}): Uint8Array => {
  const fileType = box('ftyp', [...ascii(brand), ...bytes32(0), ...ascii(brand), ...ascii('mif1')])
  const itemInfo = fullBox('iinf', [
    0,
    1,
    ...fullBox('infe', [0, 1, 0, protectedItem ? 1 : 0, ...ascii('hvc1'), 0], 2),
  ])
  const properties = [
    fullBox('ispe', [...bytes32(width), ...bytes32(height)]),
    fullBox('pixi', [3, 8, 8, 8]),
    box(
      'hvcC',
      hevcConfiguration(
        parameterTypes,
        configurationWidth ?? width,
        height,
        configurationProfile,
        configurationPps,
      ),
    ),
    box('colr', [...ascii('nclx'), 0, 1, 0, 13, 0, 6, 0x80]),
    ...(cleanAperture === undefined
      ? []
      : [
          box('clap', [
            ...bytes32(cleanAperture.width),
            ...bytes32(cleanAperture.widthDenominator ?? 1),
            ...bytes32(cleanAperture.height),
            ...bytes32(cleanAperture.heightDenominator ?? 1),
            ...bytes32(0),
            ...bytes32(1),
            ...bytes32(0),
            ...bytes32(1),
          ]),
        ]),
    ...(rotation === undefined ? [] : [box('irot', [rotation])]),
    ...(mirrorAxis === undefined ? [] : [box('imir', [mirrorAxis])]),
    ...(unknownEssentialProperty ? [box('zzzz', [])] : []),
  ]
  const propertyAssociations = properties.map((_property, index) =>
    unknownEssentialProperty && index === properties.length - 1 ? 0x80 | (index + 1) : index + 1,
  )
  const associations = fullBox('ipma', [
    ...bytes32(1),
    0,
    1,
    properties.length,
    ...propertyAssociations,
  ])
  const ctbCount = Math.ceil(width / 64) * Math.ceil(height / 64)
  const itemPayload = sliceAddresses.flatMap((address, index) =>
    lengthPrefixedNal(sliceNal({ address, ctbCount, first: index === 0, type: itemNalType })),
  )
  const location = (absoluteOffset: number): readonly number[] => {
    const extents = multipleExtents
      ? [
          ...bytes32(absoluteOffset),
          ...bytes32(2),
          ...bytes32(absoluteOffset + 3),
          ...bytes32(itemPayload.length - 2),
        ]
      : [...bytes32(absoluteOffset), ...bytes32(itemExtentLength ?? itemPayload.length)]
    return fullBox('iloc', [
      0x44,
      0,
      0,
      1,
      0,
      1,
      0,
      externalDataReference ? 1 : 0,
      0,
      multipleExtents ? 2 : 1,
      ...extents,
    ])
  }
  const metadata = (absoluteOffset: number): readonly number[] =>
    fullBox('meta', [
      ...fullBox('pitm', [0, 1]),
      ...itemInfo,
      ...location(absoluteOffset),
      ...box('iprp', [...box('ipco', properties.flat()), ...associations]),
    ])
  const provisionalMetadata = metadata(0)
  const payloadOffset = fileType.length + provisionalMetadata.length + 8
  const storedPayload = multipleExtents
    ? [...itemPayload.slice(0, 2), 0xff, ...itemPayload.slice(2)]
    : itemPayload
  return Uint8Array.from([...fileType, ...metadata(payloadOffset), ...box('mdat', storedPayload)])
}

const decodedHeifFixture = (
  withCleanAperture = false,
  asGrid = false,
  rotation?: 0 | 1 | 2 | 3,
  iccProfile?: Uint8Array,
  displayP3 = false,
): Uint8Array => {
  const vps = base64Bytes('QAEMAf//AWAAAAMAkAAAAwAAAwAelZgJ')
  const sps = base64Bytes('QgEBAWAAAAMAkAAAAwAAAwAeoCCBBZZWaSTK8BaAgAAAAwCAAAADAIQ=')
  const pps = base64Bytes('RAHBcaES')
  const slice = base64Bytes(
    'KAGvLpQdSZY47HVNRR1H+qRYfo/4VfDD+a8z6v94yOQOTu5XAumEQ+E017fKnEFKFJnArxcwX8xxt8Gtg12WQfdrkHlYNMguGfBa/HqfbsJ+RD//fXmGkFQ5hveQFWBK+98fOkraWGRPyQLMVkS1SPdB+8ZOqklLrkNZK1aBcoqqdG6eAkCLtdoM31YFsc194IxN+oX+EeUfXBCEESlw72eha39NYXMYHMr9Bru7s1oMQMsE+cTWw4RrpWGb9h/Vb5Xabxkn7Oo9ABu+s06ZaMRyHtRIwXjUM9w9c8AvLdHW/ESAqUZeeoqo1VZAzns2oYG2zryOLbgWc0VzXlN9d5mK879KJxsk47JOzc9bGKIY4Dp3ia2yCS8dTEJVvwSvVcRgOfZPQ32r9f9Oq6h8KsuEhu/dK5ktzfcCaNsx3BR3NYdRStb3EdgqnYsP+MDMMKLFisPQdyN8LTv5kLelnc36h4H5MTieHYQ/DyAXldMY+n+GbHm01pcNifw/MRZRScxwSXhadCEOX5nuB1hrwlW7Q5j29RuNVpwXet13TiEXJ+ekxtOMivHmBuhNR5nY2wrmSU70G0w18eomPgh9eIYrRV2oADKdrE2NqQZifX1JdI0ByMNMpLxEXfxh7VbWZfI5ONGTSh63PVv6PrWPb5vLGVxu5ozrEjrqcsTmijcxBIt/9/PhngZjTWeG1WVw4g/9DJHC6fvHGldtctoFB8t9zc2/kq7Nwjq6JtqUhgGX/v33mjFiVhjZtXZR7XeFchOx8Pu3/lHEBOLrB0nKymbvjr6wgZcELrNzjb7LgX1iQNaLn1pPZKieLaab6xGP4OjxLpCz+xA2coFXZ4LCStYtiSCzEvET1tupwmDeXxTMkKQjEkUN8gCk6jwkH/FCMYgeadWuWL9vtYEdEcLw/Wb6xh6+YhC0HF1xAa/lnr2VRJBox3RnQcEYkfnRH7daf34SndLnF1AsaleP7BEWgX0FxIdAiZhshxFEnA48YHGhHiWN1e3jedXSKgenxUMYu2brN/sbVhJgfgbnnufLdiBo/ZHUuCR/2v9V/ebMUZyPHKsLYRsTJNAtmRrLY/mvHYazJ6N4AYH+n2lX6PpUZyTiSID41hDZe1jwkaVSqaFcJ1cMKBc5PwcS7Drjkk4A3+3W4mEdy3icjoMrz9YolOZzeWV1K+FFQIZ3V4yYexfq/dohOdOqi/ltzpvEK4QBSpAVrWB+XInAZdg2gfnDYfQomdaCkMlSSNHWqIcIdiGBVPfAZ0PSGJg2P7ntrUTuqiys7LanfWNyCmD1S1CYjSVh7Jljm4a4Dr8pGqvucF/ACWKk1sft2hQ7O8Ma8pIErRGrSCgpMPuWc/+3zUlA22fG6ERlgws8UHkT/psWIJkOEQa8w0t2l+mznrn5wyP3T/p81zxUkloxtNqc+oDzKaLAi+rMsfs8XjMD36f/hEiv/j70ThTObqsMAETA3YyL0mNUuQlhWuD3OhUds3+Mbywijqf+dhzlsoFgZ7vUNQrL6VJy56q72+qToRtiSmQIjWPqMJiE79kn+jOrHALQo2mOTWkCycUz8v/aiV7jqaOr+5wfVz06yfsfDN+f3pJJRvWDnapAFLzzAKcjm12urJIKaLNVBLTgpK9Pih+DhUhFMQqKoYaksmDhfH2E0DI6kxusNMWbpzV4Gbf5E5cW1EpFA8IfvahnjXZxwDl//gaL68BAdFJXWP0j9Fxa+fvW+UtA',
  )
  const parameterArrayFromNal = (type: number, nal: Uint8Array): readonly number[] => [
    0x80 | type,
    0,
    1,
    (nal.length >>> 8) & 0xff,
    nal.length & 0xff,
    ...nal,
  ]
  const configuration = [
    1,
    1,
    ...new Array<number>(10).fill(0),
    30,
    0xf0,
    0,
    0xfc,
    0xfd,
    0xf8,
    0xf8,
    0,
    0,
    7,
    3,
    ...parameterArrayFromNal(32, vps),
    ...parameterArrayFromNal(33, sps),
    ...parameterArrayFromNal(34, pps),
  ]
  const fileType = box('ftyp', [
    ...ascii('heic'),
    ...bytes32(0),
    ...ascii('heic'),
    ...ascii('mif1'),
  ])
  if (asGrid) {
    const itemInfo = fullBox('iinf', [
      0,
      5,
      ...fullBox('infe', [0, 1, 0, 0, ...ascii('grid'), 0], 2),
      ...[2, 3, 4, 5].flatMap((itemId) =>
        fullBox('infe', [0, itemId, 0, 0, ...ascii('hvc1'), 0], 2),
      ),
    ])
    const properties = [
      fullBox('ispe', [...bytes32(100), ...bytes32(90)]),
      fullBox('ispe', [...bytes32(64), ...bytes32(64)]),
      box('hvcC', configuration),
      fullBox('pixi', [3, 8, 8, 8]),
      box(
        'colr',
        iccProfile
          ? [...ascii('prof'), ...iccProfile]
          : [...ascii('nclx'), 0, displayP3 ? 12 : 1, 0, 13, 0, 6, 0],
      ),
    ]
    const associations = fullBox('ipma', [
      ...bytes32(5),
      0,
      1,
      2,
      1,
      5,
      ...[2, 3, 4, 5].flatMap((itemId) => [0, itemId, 3, 2, 3, 4]),
    ])
    const references = fullBox('iref', box('dimg', [0, 1, 0, 4, 0, 2, 0, 3, 0, 4, 0, 5]))
    const gridPayload = [0, 0, 1, 1, 0, 100, 0, 90]
    const tilePayload = lengthPrefixedNal(slice)
    const payloads = [gridPayload, tilePayload, tilePayload, tilePayload, tilePayload]
    const locations = (firstOffset: number): readonly number[] => {
      let offset = firstOffset
      const entries = payloads.flatMap((payload, index) => {
        const entry = [0, index + 1, 0, 0, 0, 1, ...bytes32(offset), ...bytes32(payload.length)]
        offset += payload.length
        return entry
      })
      return fullBox('iloc', [0x44, 0, 0, payloads.length, ...entries])
    }
    const metadata = (firstOffset: number): readonly number[] =>
      fullBox('meta', [
        ...fullBox('pitm', [0, 1]),
        ...itemInfo,
        ...locations(firstOffset),
        ...box('iprp', [...box('ipco', properties.flat()), ...associations]),
        ...references,
      ])
    const provisionalMetadata = metadata(0)
    const firstOffset = fileType.length + provisionalMetadata.length + 8
    return Uint8Array.from([...fileType, ...metadata(firstOffset), ...box('mdat', payloads.flat())])
  }
  const properties = [
    fullBox('ispe', [...bytes32(64), ...bytes32(64)]),
    fullBox('pixi', [3, 8, 8, 8]),
    box('hvcC', configuration),
    box(
      'colr',
      iccProfile
        ? [...ascii('prof'), ...iccProfile]
        : [...ascii('nclx'), 0, displayP3 ? 12 : 1, 0, 13, 0, 6, 0],
    ),
    ...(withCleanAperture
      ? [
          box('clap', [
            ...bytes32(48),
            ...bytes32(1),
            ...bytes32(32),
            ...bytes32(1),
            ...bytes32(0),
            ...bytes32(1),
            ...bytes32(0),
            ...bytes32(1),
          ]),
        ]
      : []),
    ...(rotation === undefined ? [] : [box('irot', [rotation])]),
  ]
  const itemInfo = fullBox('iinf', [0, 1, ...fullBox('infe', [0, 1, 0, 0, ...ascii('hvc1'), 0], 2)])
  const itemPayload = lengthPrefixedNal(slice)
  const metadata = (absoluteOffset: number): readonly number[] =>
    fullBox('meta', [
      ...fullBox('pitm', [0, 1]),
      ...itemInfo,
      ...fullBox('iloc', [
        0x44,
        0,
        0,
        1,
        0,
        1,
        0,
        0,
        0,
        1,
        ...bytes32(absoluteOffset),
        ...bytes32(itemPayload.length),
      ]),
      ...box('iprp', [
        ...box('ipco', properties.flat()),
        ...fullBox('ipma', [
          ...bytes32(1),
          0,
          1,
          properties.length,
          ...properties.map((_property, index) => index + 1),
        ]),
      ]),
    ])
  const provisionalMetadata = metadata(0)
  const payloadOffset = fileType.length + provisionalMetadata.length + 8
  return Uint8Array.from([...fileType, ...metadata(payloadOffset), ...box('mdat', itemPayload)])
}

const decodedMain10HeifFixture = (transfer: 16 | 18 = 16): Uint8Array => {
  const vps = base64Bytes('QAEMAf//AiAAAAMAkAAAAwAAAwAekoCQ')
  const sps = base64Bytes(
    transfer === 16
      ? 'QgEBAiAAAAMAkAAAAwAAAwAeoEIITZZKuTC8BahIgEggAAADACAAAAMAIQ=='
      : 'QgEBAiAAAAMAkAAAAwAAAwAeoEIITZZKuTC8BahIkEggAAADACAAAAMAIQ==',
  )
  const pps = base64Bytes('RAHBcaGkgA==')
  const slice = base64Bytes(
    'KAGtwCNGBl0lp1HvS4/wcZzXmuUtHUA/o3vHJ+gpBpIZd4Z+CHeJCRjbOdvpwooNEzM/IT7lyQbvAsDVdVNBshoohnOIjwrH6czmINr7Z7D6aXz//8/gLZglLCknsJowtSw57pL0kg5bOZjl3cbBdXeeBPZpqggAF+UJCTXRNWm1bDnsxe1ByKixfwxXhYTLELSfhtHiaW5SJje21FEBxSoPcnbcxEHNJ4QD0neBRcfW8AlfJRv75+ebNlQ3WZa/vTe+xgRvhJgL90Zkhgo9gImQi5KsH4IitkcwLe4c3RU9Z/WYbAN79wmDWBBjzGiqcJdickqZowHCkSS4ZoKHtxATDbEt28jORaIOhsbMBsJb8pVHrTB5LX28H/olM/kFpNrcjvBnyLd5mGU+LSmLY3i2kMqyXGUkkX9OuU09sej1MdGddXnr/946SB6+23jCV3uwKexwYZNXDsFC8U1ZBjcR2YNmDP5vOTiZv0xVZiYbBQO+C3WbI0R0utTuIRAMsj6GxJyeJEIA+GykmipVv8slhigPo7Bg',
  )
  const parameterArrayFromNal = (type: number, nal: Uint8Array): readonly number[] => [
    0x80 | type,
    0,
    1,
    (nal.length >>> 8) & 0xff,
    nal.length & 0xff,
    ...nal,
  ]
  const configuration = [
    1,
    2,
    ...new Array<number>(10).fill(0),
    30,
    0xf0,
    0,
    0xfc,
    0xfd,
    0xfa,
    0xfa,
    0,
    0,
    7,
    3,
    ...parameterArrayFromNal(32, vps),
    ...parameterArrayFromNal(33, sps),
    ...parameterArrayFromNal(34, pps),
  ]
  const fileType = box('ftyp', [
    ...ascii('heic'),
    ...bytes32(0),
    ...ascii('heic'),
    ...ascii('mif1'),
  ])
  const properties = [
    fullBox('ispe', [...bytes32(32), ...bytes32(32)]),
    fullBox('pixi', [3, 10, 10, 10]),
    box('hvcC', configuration),
    box('colr', [...ascii('nclx'), 0, 9, 0, transfer, 0, 9, 0]),
  ]
  const itemInfo = fullBox('iinf', [0, 1, ...fullBox('infe', [0, 1, 0, 0, ...ascii('hvc1'), 0], 2)])
  const itemPayload = lengthPrefixedNal(slice)
  const metadata = (absoluteOffset: number): readonly number[] =>
    fullBox('meta', [
      ...fullBox('pitm', [0, 1]),
      ...itemInfo,
      ...fullBox('iloc', [
        0x44,
        0,
        0,
        1,
        0,
        1,
        0,
        0,
        0,
        1,
        ...bytes32(absoluteOffset),
        ...bytes32(itemPayload.length),
      ]),
      ...box('iprp', [
        ...box('ipco', properties.flat()),
        ...fullBox('ipma', [
          ...bytes32(1),
          0,
          1,
          properties.length,
          ...properties.map((_property, index) => index + 1),
        ]),
      ]),
    ])
  const provisionalMetadata = metadata(0)
  const payloadOffset = fileType.length + provisionalMetadata.length + 8
  return Uint8Array.from([...fileType, ...metadata(payloadOffset), ...box('mdat', itemPayload)])
}

const heifGridFixture = ({
  referencedTiles = [2, 3, 4, 5],
}: {
  referencedTiles?: readonly number[]
} = {}): Uint8Array => {
  const fileType = box('ftyp', [
    ...ascii('heic'),
    ...bytes32(0),
    ...ascii('heic'),
    ...ascii('mif1'),
  ])
  const itemInfo = fullBox('iinf', [
    0,
    5,
    ...fullBox('infe', [0, 1, 0, 0, ...ascii('grid'), 0], 2),
    ...[2, 3, 4, 5].flatMap((itemId) => fullBox('infe', [0, itemId, 0, 0, ...ascii('hvc1'), 0], 2)),
  ])
  const properties = [
    fullBox('ispe', [...bytes32(15), ...bytes32(13)]),
    fullBox('ispe', [...bytes32(8), ...bytes32(7)]),
    box('hvcC', hevcConfiguration(undefined, 8, 7)),
    fullBox('pixi', [3, 8, 8, 8]),
    box('colr', [...ascii('nclx'), 0, 1, 0, 13, 0, 6, 0x80]),
  ]
  const associations = fullBox('ipma', [
    ...bytes32(5),
    0,
    1,
    2,
    1,
    5,
    ...[2, 3, 4, 5].flatMap((itemId) => [0, itemId, 3, 2, 3, 4]),
  ])
  const references = fullBox(
    'iref',
    box('dimg', [0, 1, 0, referencedTiles.length, ...referencedTiles.flatMap((id) => [0, id])]),
  )
  const gridPayload = [0, 0, 1, 1, 0, 15, 0, 13]
  const tilePayload = lengthPrefixedNal(sliceNal({ ctbCount: 1 }))
  const payloads = [gridPayload, tilePayload, tilePayload, tilePayload, tilePayload]
  const locations = (firstOffset: number): readonly number[] => {
    let offset = firstOffset
    const entries = payloads.flatMap((payload, index) => {
      const entry = [0, index + 1, 0, 0, 0, 1, ...bytes32(offset), ...bytes32(payload.length)]
      offset += payload.length
      return entry
    })
    return fullBox('iloc', [0x44, 0, 0, payloads.length, ...entries])
  }
  const metadata = (firstOffset: number): readonly number[] =>
    fullBox('meta', [
      ...fullBox('pitm', [0, 1]),
      ...itemInfo,
      ...locations(firstOffset),
      ...box('iprp', [...box('ipco', properties.flat()), ...associations]),
      ...references,
    ])
  const provisionalMetadata = metadata(0)
  const firstOffset = fileType.length + provisionalMetadata.length + 8
  return Uint8Array.from([...fileType, ...metadata(firstOffset), ...box('mdat', payloads.flat())])
}

describe('HEIF metadata and registration', () => {
  it('detects HEIC as the shared HEIF codec and reports HEVC metadata', async () => {
    const image = await Image.open(heifFixture({ rotation: 3 }))

    await expect(image.metadata()).resolves.toEqual({
      format: 'heif',
      mimeType: 'image/heif',
      width: 4032,
      height: 3024,
      hasAlpha: false,
      frames: 1,
      bitDepth: 8,
      chromaSubsampling: '420',
      codecProfile: 1,
      colorSpace: 'srgb',
      orientation: 6,
    })
    expect(heicCodec).toBe(heifCodec)
  })

  it('accepts a generic HEIF brand when the primary item is HEVC-coded', async () => {
    await expect(
      (await Image.open(heifFixture({ brand: 'mif1' }))).metadata(),
    ).resolves.toMatchObject({
      format: 'heif',
      width: 4032,
      height: 3024,
    })
  })

  it('applies image limits before pixel decoding', async () => {
    const image = await Image.open(heifFixture({ width: 101 }), { limits: { maxWidth: 100 } })
    await expect(image.metadata()).rejects.toMatchObject({ code: 'LIMIT_EXCEEDED' })
  })

  it('reports clean-aperture dimensions and composed mirror/rotation orientation', async () => {
    const metadata = await (
      await Image.open(
        heifFixture({
          width: 640,
          height: 480,
          cleanAperture: { width: 600, height: 400 },
          rotation: 1,
          mirrorAxis: 1,
        }),
      )
    ).metadata()

    expect(metadata).toMatchObject({ width: 600, height: 400, orientation: 7 })
  })

  it('rejects invalid or out-of-bounds clean apertures before decoding', async () => {
    await expect(
      (
        await Image.open(
          heifFixture({ cleanAperture: { width: 600, widthDenominator: 0, height: 400 } }),
        )
      ).metadata(),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' })
    await expect(
      (
        await Image.open(
          heifFixture({ width: 640, height: 480, cleanAperture: { width: 641, height: 480 } }),
        )
      ).metadata(),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' })
  })

  it('rejects protected primary items explicitly', async () => {
    await expect(
      (await Image.open(heifFixture({ protectedItem: true }))).metadata(),
    ).rejects.toMatchObject({
      code: 'UNSUPPORTED_OPERATION',
    })
  })

  it('rejects external item data references explicitly', async () => {
    await expect(
      (await Image.open(heifFixture({ externalDataReference: true }))).metadata(),
    ).rejects.toMatchObject({ code: 'UNSUPPORTED_OPERATION' })
  })

  it('rejects item extents that escape their declared data source', async () => {
    await expect(
      inspectHeifBitstream(new MemorySource(heifFixture({ itemExtentLength: 0xffff_ffff }))),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' })
  })

  it('does not claim AVIF brands through the HEIF public codec', () => {
    const avifHeader = Uint8Array.from([
      ...box('ftyp', [...ascii('avif'), ...bytes32(0), ...ascii('avif'), ...ascii('mif1')]),
      ...box('free', []),
    ])

    expect(heifCodec.detect(avifHeader)).toBe(false)
  })

  it('rejects unknown essential primary-item properties explicitly', async () => {
    await expect(
      (await Image.open(heifFixture({ unknownEssentialProperty: true }))).metadata(),
    ).rejects.toMatchObject({ code: 'UNSUPPORTED_OPERATION' })
  })
})

describe('HEIF HEVC bitstream inspection', () => {
  it('parses hvcC parameter arrays and length-prefixed image NAL units', async () => {
    const inspection = await inspectHeifBitstream(new MemorySource(heifFixture()))

    expect(inspection).toMatchObject({
      primaryItemId: 1,
      primaryItemType: 'hvc1',
      codedImages: [
        {
          itemId: 1,
          itemBytes: 9,
          configuration: {
            profile: 1,
            level: 120,
            bitDepth: 8,
            chromaSubsampling: '420',
            lengthSize: 4,
          },
        },
      ],
    })
    expect(
      inspection.codedImages[0]?.configuration.arrays.map((array) => array.nalUnitType),
    ).toEqual([32, 33, 34])
    expect(inspection.codedImages[0]?.configuration.sps).toMatchObject([
      {
        id: 0,
        vpsId: 0,
        width: 4032,
        height: 3024,
        bitDepth: 8,
        chromaFormat: 1,
        log2CtbSize: 6,
        ctbWidth: 63,
        ctbHeight: 48,
        ctbCount: 3024,
        sampleAdaptiveOffset: false,
        scalingListsEnabled: false,
      },
    ])
    expect(inspection.codedImages[0]?.configuration.pps).toMatchObject([
      {
        id: 0,
        spsId: 0,
        constrainedIntraPrediction: true,
        tilesEnabled: false,
        tileColumns: 1,
        tileRows: 1,
        numExtraSliceHeaderBits: 0,
        initialQp: 26,
      },
    ])
    expect(inspection.codedImages[0]?.nalUnits.map((nal) => nal.type)).toEqual([19])
    expect(inspection.codedImages[0]?.slices).toMatchObject([
      {
        firstInPicture: true,
        address: 0,
        ppsId: 0,
        spsId: 0,
        sliceType: 2,
        payloadBytes: 2,
      },
    ])
  })

  it('reads a NAL across discontiguous item extents without materializing the item', async () => {
    const inspection = await inspectHeifBitstream(
      new MemorySource(heifFixture({ multipleExtents: true })),
    )

    expect(inspection.codedImages[0]?.itemBytes).toBe(9)
    expect(inspection.codedImages[0]?.nalUnits.map((nal) => nal.type)).toEqual([19])
  })

  it('resolves and bounds multiple independently coded slice headers', async () => {
    const inspection = await inspectHeifBitstream(
      new MemorySource(heifFixture({ sliceAddresses: [0, 20, 200] })),
    )

    expect(inspection.codedImages[0]?.slices.map((slice) => slice.address)).toEqual([0, 20, 200])
    expect(inspection.codedImages[0]?.slices.map((slice) => slice.sliceType)).toEqual([2, 2, 2])
  })

  it('rejects duplicate or decreasing slice-segment addresses', async () => {
    await expect(
      inspectHeifBitstream(new MemorySource(heifFixture({ sliceAddresses: [0, 200, 20] }))),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' })
  })

  it('rejects a slice-segment address outside the SPS CTB grid', async () => {
    await expect(
      inspectHeifBitstream(new MemorySource(heifFixture({ sliceAddresses: [0, 3024] }))),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' })
  })

  it('rejects non-IDR random-access pictures until their reference syntax is supported', async () => {
    await expect(
      inspectHeifBitstream(new MemorySource(heifFixture({ itemNalType: 21 }))),
    ).rejects.toMatchObject({ code: 'UNSUPPORTED_OPERATION' })
  })

  it('rejects profiles outside Main, Main 10, and Main Still Picture explicitly', async () => {
    await expect(
      inspectHeifBitstream(new MemorySource(heifFixture({ configurationProfile: 4 }))),
    ).rejects.toMatchObject({ code: 'UNSUPPORTED_OPERATION' })
  })

  it('rejects a PPS tile grid larger than the SPS CTB grid', async () => {
    await expect(
      inspectHeifBitstream(
        new MemorySource(heifFixture({ width: 64, height: 48, configurationPps: tiledPpsNal() })),
      ),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' })
  })

  it('validates a grid and inspects each coded tile independently', async () => {
    const input = heifGridFixture()
    const metadata = await (await Image.open(input)).metadata()
    const inspection = await inspectHeifBitstream(new MemorySource(input))

    expect(metadata).toMatchObject({ width: 15, height: 13, bitDepth: 8 })
    expect(inspection.primaryItemType).toBe('grid')
    expect(inspection.codedImages.map((image) => image.itemId)).toEqual([2, 3, 4, 5])
    expect(inspection.codedImages.map((image) => image.nalUnits[0]?.type)).toEqual([19, 19, 19, 19])
  })

  it('rejects a grid whose declared geometry and tile references disagree', async () => {
    await expect(
      inspectHeifBitstream(new MemorySource(heifGridFixture({ referencedTiles: [2, 3, 4] }))),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' })
  })

  it('rejects duplicate grid tile references before reconstruction', async () => {
    await expect(
      inspectHeifBitstream(new MemorySource(heifGridFixture({ referencedTiles: [2, 2, 4, 5] }))),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' })
  })

  it('rejects missing required HEVC parameter sets', async () => {
    await expect(
      inspectHeifBitstream(new MemorySource(heifFixture({ parameterTypes: [32, 33] }))),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' })
  })

  it('rejects spatial extents that disagree with the HEVC SPS', async () => {
    await expect(
      inspectHeifBitstream(new MemorySource(heifFixture({ width: 640, configurationWidth: 639 }))),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' })
  })

  it('rejects an inter-predicted picture from the still-image path', async () => {
    await expect(
      inspectHeifBitstream(new MemorySource(heifFixture({ itemNalType: 1 }))),
    ).rejects.toMatchObject({ code: 'UNSUPPORTED_OPERATION' })
  })

  it('exactly decodes a real independently encoded Main-profile HEIF picture', async () => {
    // x265 4.1 encoded this 64x64 testsrc2 picture. The decoded YUV planes are
    // checked byte-for-byte against FFmpeg in the HEVC picture tests; this hash
    // pins the public HEIF container, chroma-upsample, and RGBA conversion path.
    const decoder = await heifCodec.createDecoder?.(
      new MemorySource(decodedHeifFixture()),
      defaultImageLimits,
    )
    expect(decoder).toBeDefined()
    if (!decoder) throw new Error('HEIF decoder is unavailable')
    const blocks = []
    for await (const block of decoder.decode()) blocks.push(block)
    const rgba = new Uint8Array(blocks.reduce((size, block) => size + block.data.length, 0))
    let offset = 0
    for (const block of blocks) {
      rgba.set(block.data, offset)
      offset += block.data.length
    }

    expect(decoder).toMatchObject({ width: 64, height: 64, pixelFormat: 'rgba8' })
    expect(blocks.map((block) => [block.y, block.height])).toEqual([
      [0, 32],
      [32, 32],
    ])
    expect(createHash('sha256').update(rgba).digest('hex')).toBe(
      '16eef67ea16196265e393967205ded7ee45415c314125ff6cf5ce3cd8268ac89',
    )
  })

  it('decodes and tone-maps independently encoded Main 10 BT.2020 pictures', async () => {
    // x265 4.1 encoded this 32x32 testsrc2 picture as HEVC Main 10. The two SPS
    // variants and nclx properties signal limited-range BT.2020 PQ and HLG.
    const input = decodedMain10HeifFixture()
    await expect((await Image.open(input)).metadata()).resolves.toMatchObject({
      format: 'heif',
      width: 32,
      height: 32,
      bitDepth: 10,
      codecProfile: 2,
      colorSpace: 'rec2020',
    })

    const decoder = await heifCodec.createDecoder?.(new MemorySource(input), defaultImageLimits)
    if (!decoder) throw new Error('HEIF decoder is unavailable')
    const blocks = []
    for await (const block of decoder.decode()) blocks.push(block)
    const rgba = Uint8Array.from(blocks.flatMap((block) => [...block.data]))

    expect(decoder).toMatchObject({ width: 32, height: 32, pixelFormat: 'rgba8' })
    expect(createHash('sha256').update(rgba).digest('hex')).toBe(
      'e4db96d9a1211bfd1d02196e57d07398d7348c0f1fb6ba1660b8d509b0547f20',
    )

    const hlgDecoder = await heifCodec.createDecoder?.(
      new MemorySource(decodedMain10HeifFixture(18)),
      defaultImageLimits,
    )
    if (!hlgDecoder) throw new Error('HEIF decoder is unavailable')
    const hlg = []
    for await (const block of hlgDecoder.decode()) hlg.push(...block.data)
    expect(createHash('sha256').update(Uint8Array.from(hlg)).digest('hex')).toBe(
      'd448f14948c8193f6bc1d0bf1d5e94403d41c780c0fd37fab514d262b76246e9',
    )
  })

  it('parses HEIF prof transforms and rejects corrupt embedded profiles', async () => {
    const profiled = await Image.open(
      decodedHeifFixture(false, false, undefined, channelSwappingRgbProfile()),
    )
    await expect(profiled.metadata()).resolves.toMatchObject({ colorSpace: 'icc' })

    await expect(
      (
        await Image.open(decodedHeifFixture(false, false, undefined, Uint8Array.of(1, 2, 3)))
      ).metadata(),
    ).rejects.toMatchObject({ code: 'TRUNCATED_INPUT' })
  })

  it('converts Display-P3 nclx HEIF pixels to sRGB', async () => {
    const reference = await heifCodec.createDecoder?.(
      new MemorySource(decodedHeifFixture()),
      defaultImageLimits,
    )
    const displayP3 = await heifCodec.createDecoder?.(
      new MemorySource(decodedHeifFixture(false, false, undefined, undefined, true)),
      defaultImageLimits,
    )
    if (!reference || !displayP3) throw new Error('HEIF decoder is unavailable')
    const before = []
    const after = []
    for await (const block of reference.decode()) before.push(...block.data)
    for await (const block of displayP3.decode()) after.push(...block.data)
    const decodeSrgb = (value: number): number => {
      const encoded = value / 255
      return encoded <= 0.04045 ? encoded / 12.92 : ((encoded + 0.055) / 1.055) ** 2.4
    }
    const encodeSrgb = (value: number): number => {
      const linear = Math.max(0, Math.min(1, value))
      return Math.round(
        255 * (linear <= 0.0031308 ? linear * 12.92 : 1.055 * linear ** (1 / 2.4) - 0.055),
      )
    }
    for (let offset = 0; offset < before.length; offset += 4) {
      const red = decodeSrgb(before[offset] ?? 0)
      const green = decodeSrgb(before[offset + 1] ?? 0)
      const blue = decodeSrgb(before[offset + 2] ?? 0)
      const expected = [
        encodeSrgb(1.224745 * red - 0.224904 * green),
        encodeSrgb(-0.042058 * red + 1.042081 * green),
        encodeSrgb(-0.019642 * red - 0.078655 * green + 1.098537 * blue),
      ]
      for (let channel = 0; channel < 3; channel += 1) {
        expect(
          Math.abs((after[offset + channel] ?? 0) - (expected[channel] ?? 0)),
        ).toBeLessThanOrEqual(1)
      }
      expect(after[offset + 3]).toBe(before[offset + 3])
    }
  })

  it('applies clean aperture and validates region decode coordinates', async () => {
    const decoder = await heifCodec.createDecoder?.(
      new MemorySource(decodedHeifFixture(true)),
      defaultImageLimits,
    )
    expect(decoder).toMatchObject({ width: 48, height: 32 })
    if (!decoder) throw new Error('HEIF decoder is unavailable')
    const blocks = []
    for await (const block of decoder.decode({ x: 4, y: 3, width: 7, height: 5 })) {
      blocks.push(block)
    }
    expect(blocks).toHaveLength(1)
    expect(blocks[0]).toMatchObject({ x: 0, y: 0, width: 7, height: 5, stride: 28 })
    await expect(async () => {
      for await (const _block of decoder.decode({ x: 47, width: 2 })) {
        // Exhaust the generator so validation runs.
      }
    }).rejects.toMatchObject({ code: 'INVALID_INPUT' })
  })

  it('reconstructs grid edge crops and decodes only the requested tile row', async () => {
    const gridDecoder = await heifCodec.createDecoder?.(
      new MemorySource(decodedHeifFixture(false, true)),
      defaultImageLimits,
    )
    const tileDecoder = await heifCodec.createDecoder?.(
      new MemorySource(decodedHeifFixture()),
      defaultImageLimits,
    )
    expect(gridDecoder).toMatchObject({ width: 100, height: 90 })
    if (!gridDecoder || !tileDecoder) throw new Error('HEIF decoder is unavailable')
    const gridBlocks = []
    for await (const block of gridDecoder.decode({ x: 60, y: 60, width: 8, height: 8 })) {
      gridBlocks.push(block)
    }
    const tileBlocks = []
    for await (const block of tileDecoder.decode()) tileBlocks.push(block)
    const actual = Uint8Array.from(gridBlocks.flatMap((block) => [...block.data]))
    const tile = Uint8Array.from(tileBlocks.flatMap((block) => [...block.data]))
    const expected = new Uint8Array(8 * 8 * 4)
    for (let y = 0; y < 8; y += 1) {
      for (let x = 0; x < 8; x += 1) {
        const sourceX = (60 + x) % 64
        const sourceY = (60 + y) % 64
        expected.set(
          tile.subarray((sourceY * 64 + sourceX) * 4, (sourceY * 64 + sourceX + 1) * 4),
          (y * 8 + x) * 4,
        )
      }
    }
    expect(actual).toEqual(expected)
  })

  it('uses HEIC decode through the normal PNG pipeline', async () => {
    const png = await (await Image.open(decodedHeifFixture())).png().toBuffer()

    expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10])
    await expect((await Image.open(png)).metadata()).resolves.toMatchObject({
      format: 'png',
      width: 64,
      height: 64,
      hasAlpha: true,
    })
  })

  it('applies HEIF clean aperture before rotation through autoOrient', async () => {
    const png = await (await Image.open(decodedHeifFixture(true, false, 1)))
      .autoOrient()
      .png()
      .toBuffer()

    await expect((await Image.open(png)).metadata()).resolves.toMatchObject({
      width: 32,
      height: 48,
    })
  })
})

describe('HEVC parameter-set safety', () => {
  it('rejects an unescaped start-code pattern inside an SPS NAL unit', () => {
    expect(() => inspectHevcSps(Uint8Array.of(66, 1, 0, 0, 1))).toThrow(
      'missing emulation prevention',
    )
  })

  it('rejects a truncated SPS before reading unbounded Exp-Golomb syntax', () => {
    expect(() => inspectHevcSps(Uint8Array.of(66, 1, 128))).toThrow('truncated')
  })

  it('rejects parameter-set range extensions explicitly', () => {
    expect(() => inspectHevcSps(Uint8Array.from(parameterNal(33, 64, 48, true)))).toThrowError(
      /extensions are unsupported/,
    )
    expect(() => inspectHevcPps(Uint8Array.from(parameterNal(34, 64, 48, true)))).toThrowError(
      /extensions are unsupported/,
    )
  })

  it('requires exact RBSP trailing bits for parameter sets', () => {
    const nal = Uint8Array.from(parameterNal(34, 64, 48))
    const withTrailingData = Uint8Array.from([...nal, 0x80])
    expect(() => inspectHevcPps(withTrailingData)).toThrow('trailing data')
  })

  it('parses optional common SPS coding tools and color VUI fields', () => {
    const sps = inspectHevcSps(richSpsNal())
    expect(sps).toMatchObject({
      scalingListsEnabled: true,
      scalingListsPresent: true,
      adaptiveMotionPrediction: true,
      sampleAdaptiveOffset: true,
      pcmEnabled: true,
      temporalMotionVectorPrediction: true,
      strongIntraSmoothing: true,
      vui: {
        fullRange: true,
        colorPrimaries: 1,
        transferCharacteristics: 13,
        matrixCoefficients: 6,
        chromaLocationTop: 0,
        chromaLocationBottom: 0,
      },
    })
    expect(sps.scalingLists?.get(6)?.coefficients).toEqual(
      Uint8Array.from([
        16, 16, 16, 16, 17, 18, 21, 24, 16, 16, 16, 16, 17, 19, 22, 25, 16, 16, 17, 18, 20, 22, 25,
        29, 16, 16, 18, 21, 24, 27, 31, 36, 17, 17, 20, 24, 30, 35, 41, 47, 18, 19, 22, 27, 35, 44,
        54, 65, 21, 22, 25, 31, 41, 54, 70, 88, 24, 25, 29, 36, 47, 65, 88, 115,
      ]),
    )
    expect(sps.scalingLists?.get(0)?.coefficients).toEqual(new Uint8Array(16).fill(8))
  })

  it('parses tile, WPP, deblocking, and entry-point slice syntax', () => {
    const sps = inspectHevcSps(richSpsNal())
    const pps = inspectHevcPps(tiledPpsNal())

    expect(pps).toMatchObject({
      tilesEnabled: true,
      entropyCodingSynchronization: true,
      tileColumns: 2,
      tileRows: 2,
      uniformTileSpacing: false,
      tileColumnWidths: [1],
      tileRowHeights: [1],
      loopFilterAcrossSlices: true,
      deblockingFilterOverride: true,
      sliceHeaderExtensionPresent: true,
    })
    expect(inspectHevcSlice(tiledSliceNal(), 19, { sps: [sps], pps: [pps] })).toMatchObject({
      firstInPicture: true,
      sliceType: 2,
      entryPointOffsets: 1,
      payloadBytes: 6,
    })
    const data = readHevcSliceData(tiledSliceNal(), 19, { sps: [sps], pps: [pps] })
    expect(data.substreamByteOffsets[0]).toBe(data.headerBytes)
    expect(data.substreamByteOffsets[1]).toBeLessThan(data.headerBytes + 4)
  })
})
