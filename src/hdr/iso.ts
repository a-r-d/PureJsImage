import { invalidInput, truncatedInput } from '../errors.ts'
import type {
  GainMapChannelCount,
  GainMapExactIsoMetadata,
  GainMapRational,
  GainMapTriplet,
} from './model.ts'

const MULTI_CHANNEL = 0x80
const USE_BASE_COLOR_SPACE = 0x40
const COMMON_DENOMINATOR = 0x08
const BACKWARD_DIRECTION = 0x04
const KNOWN_FLAGS = MULTI_CHANNEL | USE_BASE_COLOR_SPACE | COMMON_DENOMINATOR | BACKWARD_DIRECTION

type RationalTriplet = readonly [GainMapRational, GainMapRational, GainMapRational]

export interface IsoGainMapMetadata {
  readonly minimumVersion: 0
  readonly writerVersion: number
  readonly channelCount: GainMapChannelCount
  readonly baseRendition: 'sdr' | 'hdr'
  readonly useBaseColorSpace: boolean
  readonly exact: GainMapExactIsoMetadata
  readonly minimum: GainMapTriplet
  readonly maximum: GainMapTriplet
  readonly gamma: GainMapTriplet
  readonly offsetSdr: GainMapTriplet
  readonly offsetHdr: GainMapTriplet
  readonly capacityMinimum: number
  readonly capacityMaximum: number
}

export interface EncodeIsoGainMapMetadata {
  readonly writerVersion?: number
  readonly channelCount: GainMapChannelCount
  readonly baseRendition: 'sdr' | 'hdr'
  readonly useBaseColorSpace: boolean
  readonly exact: GainMapExactIsoMetadata
}

const rational = (numerator: number, denominator: number, label: string): GainMapRational => {
  if (!Number.isInteger(numerator) || numerator < -0x8000_0000 || numerator > 0xffff_ffff) {
    throw invalidInput(`${label} numerator is outside the ISO 21496-1 integer range`)
  }
  if (!Number.isInteger(denominator) || denominator < 1 || denominator > 0xffff_ffff) {
    throw invalidInput(`${label} denominator is outside the ISO 21496-1 integer range`)
  }
  return Object.freeze({ numerator, denominator })
}

const value = (item: GainMapRational): number => item.numerator / item.denominator

const compare = (left: GainMapRational, right: GainMapRational): number => {
  const difference =
    BigInt(left.numerator) * BigInt(right.denominator) -
    BigInt(right.numerator) * BigInt(left.denominator)
  return difference < 0n ? -1 : difference > 0n ? 1 : 0
}

const repeat = (items: readonly GainMapRational[]): RationalTriplet => {
  const first = items[0]
  if (!first) throw invalidInput('ISO 21496-1 channel metadata is missing')
  if (items.length === 1) return Object.freeze([first, first, first])
  const second = items[1]
  const third = items[2]
  if (!second || !third || items.length !== 3) {
    throw invalidInput('ISO 21496-1 metadata must contain one or three channels')
  }
  return Object.freeze([first, second, third])
}

const numbers = (items: RationalTriplet): GainMapTriplet =>
  Object.freeze([value(items[0]), value(items[1]), value(items[2])])

const validateExact = (exact: GainMapExactIsoMetadata, baseRendition: 'sdr' | 'hdr'): void => {
  const validateRational = (
    item: GainMapRational,
    label: string,
    signedNumerator: boolean,
  ): void => {
    const minimum = signedNumerator ? -0x8000_0000 : 0
    const maximum = signedNumerator ? 0x7fff_ffff : 0xffff_ffff
    if (
      !Number.isInteger(item.numerator) ||
      item.numerator < minimum ||
      item.numerator > maximum ||
      !Number.isInteger(item.denominator) ||
      item.denominator < 1 ||
      item.denominator > 0xffff_ffff
    ) {
      throw invalidInput(`${label} is outside the ISO 21496-1 integer range`)
    }
  }
  for (let channel = 0; channel < 3; channel += 1) {
    const minimum = exact.minimum[channel]
    const maximum = exact.maximum[channel]
    const gamma = exact.gamma[channel]
    const offsetSdr = exact.offsetSdr[channel]
    const offsetHdr = exact.offsetHdr[channel]
    if (
      !minimum ||
      !maximum ||
      !gamma ||
      !offsetSdr ||
      !offsetHdr ||
      compare(minimum, maximum) > 0 ||
      gamma.numerator <= 0 ||
      offsetSdr.numerator < 0 ||
      offsetHdr.numerator < 0
    ) {
      throw invalidInput('ISO 21496-1 gain range, gamma, or offsets are invalid')
    }
    validateRational(minimum, `minimum channel ${channel}`, true)
    validateRational(maximum, `maximum channel ${channel}`, true)
    validateRational(gamma, `gamma channel ${channel}`, false)
    validateRational(offsetSdr, `SDR offset channel ${channel}`, true)
    validateRational(offsetHdr, `HDR offset channel ${channel}`, true)
  }
  validateRational(exact.capacityMinimum, 'minimum HDR headroom', false)
  validateRational(exact.capacityMaximum, 'maximum HDR headroom', false)
  if (
    compare(exact.capacityMinimum, exact.capacityMaximum) >= 0 ||
    exact.capacityMinimum.numerator < 0 ||
    (baseRendition !== 'sdr' && baseRendition !== 'hdr')
  ) {
    throw invalidInput('ISO 21496-1 HDR headroom range is invalid')
  }
}

export const parseIsoGainMapMetadata = (data: Uint8Array): IsoGainMapMetadata => {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  let offset = 0
  const need = (bytes: number): void => {
    if (offset + bytes > data.byteLength) throw truncatedInput('ISO 21496-1 metadata is truncated')
  }
  const u8 = (): number => {
    need(1)
    return view.getUint8(offset++)
  }
  const u16 = (): number => {
    need(2)
    const result = view.getUint16(offset, false)
    offset += 2
    return result
  }
  const u32 = (): number => {
    need(4)
    const result = view.getUint32(offset, false)
    offset += 4
    return result
  }
  const s32 = (): number => {
    need(4)
    const result = view.getInt32(offset, false)
    offset += 4
    return result
  }
  const minimumVersion = u16()
  const writerVersion = u16()
  if (minimumVersion !== 0) throw invalidInput('ISO 21496-1 minimum version is unsupported')
  const flags = u8()
  if ((flags & ~KNOWN_FLAGS) !== 0) throw invalidInput('ISO 21496-1 reserved flags are set')
  const channelCount: GainMapChannelCount = (flags & MULTI_CHANNEL) === 0 ? 1 : 3
  const baseRendition = (flags & BACKWARD_DIRECTION) === 0 ? 'sdr' : 'hdr'
  const common = (flags & COMMON_DENOMINATOR) !== 0
  const minimum: GainMapRational[] = []
  const maximum: GainMapRational[] = []
  const gamma: GainMapRational[] = []
  const baseOffset: GainMapRational[] = []
  const alternateOffset: GainMapRational[] = []
  let baseHeadroom: GainMapRational
  let alternateHeadroom: GainMapRational
  if (common) {
    const denominator = u32()
    if (denominator === 0) throw invalidInput('ISO 21496-1 common denominator is zero')
    baseHeadroom = rational(u32(), denominator, 'base HDR headroom')
    alternateHeadroom = rational(u32(), denominator, 'alternate HDR headroom')
    for (let channel = 0; channel < channelCount; channel += 1) {
      minimum.push(rational(s32(), denominator, 'gain minimum'))
      maximum.push(rational(s32(), denominator, 'gain maximum'))
      gamma.push(rational(u32(), denominator, 'gain gamma'))
      baseOffset.push(rational(s32(), denominator, 'base offset'))
      alternateOffset.push(rational(s32(), denominator, 'alternate offset'))
    }
  } else {
    baseHeadroom = rational(u32(), u32(), 'base HDR headroom')
    alternateHeadroom = rational(u32(), u32(), 'alternate HDR headroom')
    for (let channel = 0; channel < channelCount; channel += 1) {
      minimum.push(rational(s32(), u32(), 'gain minimum'))
      maximum.push(rational(s32(), u32(), 'gain maximum'))
      gamma.push(rational(u32(), u32(), 'gain gamma'))
      baseOffset.push(rational(s32(), u32(), 'base offset'))
      alternateOffset.push(rational(s32(), u32(), 'alternate offset'))
    }
  }
  if (offset !== data.byteLength) throw invalidInput('ISO 21496-1 metadata has trailing bytes')
  const exactMinimum = repeat(minimum)
  const exactMaximum = repeat(maximum)
  const exactGamma = repeat(gamma)
  const exactBaseOffset = repeat(baseOffset)
  const exactAlternateOffset = repeat(alternateOffset)
  const capacityMinimum = baseRendition === 'sdr' ? baseHeadroom : alternateHeadroom
  const capacityMaximum = baseRendition === 'sdr' ? alternateHeadroom : baseHeadroom
  const exact = Object.freeze<GainMapExactIsoMetadata>({
    minimum: exactMinimum,
    maximum: exactMaximum,
    gamma: exactGamma,
    offsetSdr: baseRendition === 'sdr' ? exactBaseOffset : exactAlternateOffset,
    offsetHdr: baseRendition === 'sdr' ? exactAlternateOffset : exactBaseOffset,
    capacityMinimum,
    capacityMaximum,
  })
  validateExact(exact, baseRendition)
  return Object.freeze({
    minimumVersion: 0,
    writerVersion,
    channelCount,
    baseRendition,
    useBaseColorSpace: (flags & USE_BASE_COLOR_SPACE) !== 0,
    exact,
    minimum: numbers(exact.minimum),
    maximum: numbers(exact.maximum),
    gamma: numbers(exact.gamma),
    offsetSdr: numbers(exact.offsetSdr),
    offsetHdr: numbers(exact.offsetHdr),
    capacityMinimum: value(exact.capacityMinimum),
    capacityMaximum: value(exact.capacityMaximum),
  })
}

const allEqual = (items: RationalTriplet): boolean =>
  items[0].numerator === items[1].numerator &&
  items[0].numerator === items[2].numerator &&
  items[0].denominator === items[1].denominator &&
  items[0].denominator === items[2].denominator

const channelValue = (items: RationalTriplet, channel: number): GainMapRational => {
  const result = items[channel]
  if (!result) throw invalidInput('ISO 21496-1 channel is missing')
  return result
}

export const encodeIsoGainMapMetadata = (metadata: EncodeIsoGainMapMetadata): Uint8Array => {
  validateExact(metadata.exact, metadata.baseRendition)
  if (metadata.channelCount !== 1 && metadata.channelCount !== 3) {
    throw invalidInput('ISO 21496-1 channel count must be one or three')
  }
  if (
    metadata.channelCount === 1 &&
    ![
      metadata.exact.minimum,
      metadata.exact.maximum,
      metadata.exact.gamma,
      metadata.exact.offsetSdr,
      metadata.exact.offsetHdr,
    ].every(allEqual)
  ) {
    throw invalidInput('One-channel ISO 21496-1 metadata must be identical across RGB')
  }
  const writerVersion = metadata.writerVersion ?? 0
  if (!Number.isInteger(writerVersion) || writerVersion < 0 || writerVersion > 0xffff) {
    throw invalidInput('ISO 21496-1 writer version is invalid')
  }
  const baseHeadroom =
    metadata.baseRendition === 'sdr'
      ? metadata.exact.capacityMinimum
      : metadata.exact.capacityMaximum
  const alternateHeadroom =
    metadata.baseRendition === 'sdr'
      ? metadata.exact.capacityMaximum
      : metadata.exact.capacityMinimum
  const baseOffset =
    metadata.baseRendition === 'sdr' ? metadata.exact.offsetSdr : metadata.exact.offsetHdr
  const alternateOffset =
    metadata.baseRendition === 'sdr' ? metadata.exact.offsetHdr : metadata.exact.offsetSdr
  const rationals: GainMapRational[] = [baseHeadroom, alternateHeadroom]
  for (let channel = 0; channel < metadata.channelCount; channel += 1) {
    rationals.push(
      channelValue(metadata.exact.minimum, channel),
      channelValue(metadata.exact.maximum, channel),
      channelValue(metadata.exact.gamma, channel),
      channelValue(baseOffset, channel),
      channelValue(alternateOffset, channel),
    )
  }
  const denominator = rationals[0]?.denominator
  const common =
    denominator !== undefined && rationals.every((item) => item.denominator === denominator)
  const bytes = 5 + (common ? 12 + metadata.channelCount * 20 : 16 + metadata.channelCount * 40)
  const output = new Uint8Array(bytes)
  const view = new DataView(output.buffer)
  let offset = 0
  const u8 = (item: number): void => {
    view.setUint8(offset, item)
    offset += 1
  }
  const u16 = (item: number): void => {
    view.setUint16(offset, item, false)
    offset += 2
  }
  const u32 = (item: number): void => {
    view.setUint32(offset, item, false)
    offset += 4
  }
  const s32 = (item: number): void => {
    view.setInt32(offset, item, false)
    offset += 4
  }
  u16(0)
  u16(writerVersion)
  let flags = metadata.channelCount === 3 ? MULTI_CHANNEL : 0
  if (metadata.useBaseColorSpace) flags |= USE_BASE_COLOR_SPACE
  if (metadata.baseRendition === 'hdr') flags |= BACKWARD_DIRECTION
  if (common) flags |= COMMON_DENOMINATOR
  u8(flags)
  if (common && denominator !== undefined) {
    u32(denominator)
    u32(baseHeadroom.numerator)
    u32(alternateHeadroom.numerator)
    for (let channel = 0; channel < metadata.channelCount; channel += 1) {
      s32(channelValue(metadata.exact.minimum, channel).numerator)
      s32(channelValue(metadata.exact.maximum, channel).numerator)
      u32(channelValue(metadata.exact.gamma, channel).numerator)
      s32(channelValue(baseOffset, channel).numerator)
      s32(channelValue(alternateOffset, channel).numerator)
    }
  } else {
    u32(baseHeadroom.numerator)
    u32(baseHeadroom.denominator)
    u32(alternateHeadroom.numerator)
    u32(alternateHeadroom.denominator)
    for (let channel = 0; channel < metadata.channelCount; channel += 1) {
      const values = [
        channelValue(metadata.exact.minimum, channel),
        channelValue(metadata.exact.maximum, channel),
        channelValue(metadata.exact.gamma, channel),
        channelValue(baseOffset, channel),
        channelValue(alternateOffset, channel),
      ] as const
      s32(values[0].numerator)
      u32(values[0].denominator)
      s32(values[1].numerator)
      u32(values[1].denominator)
      u32(values[2].numerator)
      u32(values[2].denominator)
      s32(values[3].numerator)
      u32(values[3].denominator)
      s32(values[4].numerator)
      u32(values[4].denominator)
    }
  }
  return output
}
