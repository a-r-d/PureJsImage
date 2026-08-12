import type {
  ChromaSubsampling,
  DecodeRequest,
  DecoderOptions,
  ImageCodec,
  ImageDecoder,
  ImageMetadata,
} from '../codec.ts'
import { invalidInput, limitExceeded, unsupportedOperation } from '../errors.ts'
import type { ImageLimits } from '../limits.ts'
import { validateImageDimensions } from '../limits.ts'
import type { PixelBlock } from '../pixel.ts'
import type { ImageSource } from '../source.ts'
import { readExactly } from '../source.ts'
import {
  type Av1Obu,
  type Av1SequenceHeader,
  av1ObuType,
  inspectAv1Bitstream,
  parseAv1Obus,
} from './av1.ts'
import { type Av1Frame, inspectAv1FrameHeader, parseAv1FrameObus } from './av1-frame.ts'
import {
  type Av1DecodedFrame,
  av1ToRgbaRegion,
  decodeRestrictedAv1Intra,
  decodeRestrictedAv1IntraRows,
  estimateRestrictedAv1RowWorkingBytes,
  estimateRestrictedAv1WorkingBytes,
  supportsRestrictedAv1IntraRows,
} from './av1-intra.ts'
import { createAvifEncoder } from './avif-encode.ts'
import { ascii, uint16BigEndian, uint32BigEndian } from './helpers.ts'
import {
  ColorManagedDecoder,
  createNclxHdrToneMap,
  createNclxSrgbTransform,
  inspectIccProfile,
  linearToSrgb,
  nclxToLinear,
  parseRgbIccTransform,
  type NclxHdrToneMap,
  type RgbIccTransform,
} from './icc.ts'
import type {
  IsobmffBox as Box,
  IsobmffMeta,
  IsobmffReader,
  IsobmffSampleTable,
} from './isobmff.ts'
import {
  checkedAdd,
  createIsobmffReader,
  detectIsobmffBrands,
  parseBrands,
  parseFullBox,
  parseIsobmffMeta,
  parseIsobmffSampleTable,
} from './isobmff.ts'

const MAX_BOUNDED_AVIF_WORKING_BYTES = 64 * 1_024 * 1_024

const ALPHA_AUXILIARY_TYPES = new Set([
  'urn:mpeg:mpegB:cicp:systems:auxiliary:alpha',
  'urn:mpeg:hevc:2015:auxid:1',
])
export const validateAvifWorkingBytes = (workingBytes: number): void => {
  if (!Number.isSafeInteger(workingBytes) || workingBytes > MAX_BOUNDED_AVIF_WORKING_BYTES) {
    throw limitExceeded(
      `AVIF decoder working set ${workingBytes} exceeds ${MAX_BOUNDED_AVIF_WORKING_BYTES} bytes`,
    )
  }
}
const MAX_METADATA_BOX_BYTES = 16 * 1024 * 1024
const MAX_AVIF_TRACKS = 8

interface Av1Configuration {
  readonly bitDepth: number
  readonly chromaSubsampling: ChromaSubsampling
  readonly level: number
  readonly profile: number
  readonly tier: number
}
interface NclxColor {
  readonly fullRange: boolean
  readonly matrixCoefficients: number
  readonly primaries: number
  readonly transferCharacteristics: number
}
interface Rational {
  readonly numerator: number
  readonly denominator: number
}

export interface AvifGainMapMetadata {
  readonly alternateHdrHeadroom: Rational
  readonly alternateOffset: readonly [Rational, Rational, Rational]
  readonly baseHdrHeadroom: Rational
  readonly baseOffset: readonly [Rational, Rational, Rational]
  readonly gainMapGamma: readonly [Rational, Rational, Rational]
  readonly gainMapMax: readonly [Rational, Rational, Rational]
  readonly gainMapMin: readonly [Rational, Rational, Rational]
  readonly useBaseColorSpace: boolean
}

interface CleanAperture {
  readonly width: Rational
  readonly height: Rational
  readonly horizontalOffset: Rational
  readonly verticalOffset: Rational
}

interface PixelRegion {
  readonly height: number
  readonly width: number
  readonly x: number
  readonly y: number
}

type Property =
  | { readonly type: 'clap'; readonly aperture: CleanAperture }
  | { readonly type: 'av1C'; readonly configuration: Av1Configuration }
  | { readonly type: 'a1lx'; readonly layerSizes: readonly number[] }
  | { readonly type: 'a1op'; readonly operatingPointIndex: number }
  | { readonly type: 'auxC'; readonly auxiliaryType: string }
  | {
      readonly type: 'colr'
      readonly colorSpace: string
      readonly colorTransform?: RgbIccTransform
      readonly iccDescription?: string
      readonly nclx?: NclxColor
    }
  | { readonly type: 'imir'; readonly axis: 0 | 1 }
  | { readonly type: 'irot'; readonly angle: number }
  | { readonly type: 'ispe'; readonly width: number; readonly height: number }
  | { readonly type: 'lsel'; readonly layerId: number }
  | { readonly type: 'pixi'; readonly bitDepth: number }
  | { readonly type: 'unknown' }

type MetaDescription = IsobmffMeta<Property>

interface AvifTrackTiming {
  readonly duration: number
  readonly timescale: number
}

interface AvifTrackDescription {
  readonly auxiliaryForTrackIds: readonly number[]
  readonly auxiliaryType: string | undefined
  readonly color: Extract<Property, { type: 'colr' }> | undefined
  readonly configuration: Av1Configuration
  readonly configurationObus: Uint8Array
  readonly handlerType: string
  readonly height: number
  readonly samples: IsobmffSampleTable
  readonly timescale: number
  readonly trackId: number
  readonly width: number
}

interface AvifTrackInspection {
  readonly alpha: AvifTrackDescription | undefined
  readonly color: AvifTrackDescription
  readonly frames: number
}

const childBoxes = async (
  source: ImageSource,
  start: number,
  end: number,
): Promise<readonly Box[]> => {
  return createIsobmffReader(source, 'AVIF').boxes(start, end)
}

const payload = async (
  source: ImageSource,
  box: Box,
  maximum = MAX_METADATA_BOX_BYTES,
): Promise<Uint8Array> => {
  return createIsobmffReader(source, 'AVIF').payload(box, maximum)
}

const fullBox = (data: Uint8Array, type: string): { version: number; flags: number; offset: 4 } => {
  return parseFullBox(data, type, 'AVIF')
}

const parseAv1Configuration = (data: Uint8Array): Av1Configuration => {
  if (data.byteLength < 4) throw invalidInput('AVIF av1C property is truncated')
  const markerAndVersion = data[0] ?? 0
  if ((markerAndVersion & 0x80) === 0 || (markerAndVersion & 0x7f) !== 1) {
    throw invalidInput('AVIF av1C property has an unsupported marker or version')
  }

  const profileAndLevel = data[1] ?? 0
  const fields = data[2] ?? 0
  const highBitDepth = (fields & 0x40) !== 0
  const twelveBit = (fields & 0x20) !== 0
  const monochrome = (fields & 0x10) !== 0
  const subsamplingX = (fields & 0x08) !== 0
  const subsamplingY = (fields & 0x04) !== 0
  if (twelveBit && !highBitDepth) throw invalidInput('AVIF av1C has invalid bit-depth flags')
  if (!subsamplingX && subsamplingY) throw invalidInput('AVIF av1C has invalid chroma subsampling')

  const chromaSubsampling: ChromaSubsampling = monochrome
    ? '400'
    : subsamplingX
      ? subsamplingY
        ? '420'
        : '422'
      : '444'

  return {
    profile: profileAndLevel >>> 5,
    level: profileAndLevel & 0x1f,
    tier: (fields >>> 7) & 1,
    bitDepth: twelveBit ? 12 : highBitDepth ? 10 : 8,
    chromaSubsampling,
  }
}

const colorSpaceName = (
  primaries: number,
  transfer: number,
  matrix: number,
  fullRange: boolean,
): string => {
  if (primaries === 1 && transfer === 13) return 'srgb'
  if (primaries === 12 && transfer === 13) return 'display-p3'
  if (primaries === 9) return 'rec2020'
  return `nclx:${primaries}/${transfer}/${matrix}/${fullRange ? 'full' : 'limited'}`
}

const int32BigEndian = (data: Uint8Array, offset: number): number => {
  const value = uint32BigEndian(data, offset)
  return value > 0x7fff_ffff ? value - 0x1_0000_0000 : value
}

const parseProperty = async (source: ImageSource, box: Box): Promise<Property> => {
  if (box.type === 'ispe') {
    const data = await payload(source, box, 12)
    const { version, flags } = fullBox(data, box.type)
    if (version !== 0 || flags !== 0) throw invalidInput('AVIF ispe property has invalid flags')
    if (data.byteLength !== 12) throw invalidInput('AVIF ispe property has an invalid size')
    return { type: 'ispe', width: uint32BigEndian(data, 4), height: uint32BigEndian(data, 8) }
  }
  if (box.type === 'pixi') {
    const data = await payload(source, box, 4096)
    const { version, flags } = fullBox(data, box.type)
    if (version !== 0) throw invalidInput('AVIF pixi property has an unsupported version')
    if ((flags & ~1) !== 0) throw invalidInput('AVIF pixi property has unsupported flags')
    const channels = data[4]
    if (channels === undefined || channels < 1 || data.byteLength < 5 + channels) {
      throw invalidInput('AVIF pixi property has invalid channel metadata')
    }
    let bitDepth = 0
    for (let index = 0; index < channels; index += 1) {
      const channelDepth = data[5 + index]
      if (channelDepth === undefined || channelDepth < 1) {
        throw invalidInput('AVIF pixi property has an invalid channel depth')
      }
      if (bitDepth !== 0 && channelDepth !== bitDepth) {
        throw invalidInput('AVIF pixi property uses inconsistent channel depths')
      }
      bitDepth = channelDepth
    }
    let offset = 5 + channels
    if ((flags & 1) !== 0) {
      for (let index = 0; index < channels; index += 1) {
        const descriptor = data[offset]
        if (descriptor === undefined) throw invalidInput('AVIF extended pixi channel is truncated')
        offset += 1
        if ((descriptor & 0x10) !== 0 || (descriptor & 0x0c) !== 0) {
          throw invalidInput('AVIF extended pixi channel has unsupported fields')
        }
        if ((descriptor & 0x02) !== 0) {
          if (data[offset] === undefined) {
            throw invalidInput('AVIF extended pixi subsampling is truncated')
          }
          offset += 1
        }
        if ((descriptor & 0x01) !== 0) {
          const terminator = data.indexOf(0, offset)
          if (terminator === -1) throw invalidInput('AVIF extended pixi label is truncated')
          offset = terminator + 1
        }
      }
    }
    if (offset !== data.byteLength) throw invalidInput('AVIF pixi property has trailing data')
    return { type: 'pixi', bitDepth }
  }
  if (box.type === 'a1op') {
    const data = await payload(source, box, 1)
    if (data.byteLength !== 1) throw invalidInput('AVIF a1op property has an invalid size')
    return { type: 'a1op', operatingPointIndex: data[0] ?? 0 }
  }
  if (box.type === 'lsel') {
    const data = await payload(source, box, 2)
    if (data.byteLength !== 2) throw invalidInput('AVIF lsel property has an invalid size')
    const layerId = uint16BigEndian(data, 0)
    if (layerId > 3 && layerId !== 0xffff) {
      throw invalidInput('AVIF lsel property selects an invalid spatial layer')
    }
    return { type: 'lsel', layerId }
  }
  if (box.type === 'a1lx') {
    const data = await payload(source, box, 13)
    const first = data[0]
    if (first === undefined || (first & 0xfe) !== 0) {
      throw invalidInput('AVIF a1lx property has invalid reserved bits')
    }
    const fieldBytes = (first & 1) === 0 ? 2 : 4
    if (data.byteLength !== 1 + fieldBytes * 3) {
      throw invalidInput('AVIF a1lx property has an invalid size')
    }
    const layerSizes: number[] = []
    let ended = false
    for (let index = 0; index < 3; index += 1) {
      const offset = 1 + index * fieldBytes
      const layerSize =
        fieldBytes === 2 ? uint16BigEndian(data, offset) : uint32BigEndian(data, offset)
      if (layerSize === 0) ended = true
      else {
        if (ended) throw invalidInput('AVIF a1lx layer sizes continue after a zero entry')
        layerSizes.push(layerSize)
      }
    }
    return { type: 'a1lx', layerSizes }
  }
  if (box.type === 'av1C') {
    return { type: 'av1C', configuration: parseAv1Configuration(await payload(source, box, 64)) }
  }
  if (box.type === 'auxC') {
    const data = await payload(source, box, 1024)
    const { version, flags } = fullBox(data, box.type)
    if (version !== 0 || flags !== 0) throw invalidInput('AVIF auxC property has invalid flags')
    const terminator = data.indexOf(0, 4)
    if (terminator === -1) throw invalidInput('AVIF auxC property has no type terminator')
    return { type: 'auxC', auxiliaryType: ascii(data, 4, terminator - 4) }
  }
  if (box.type === 'colr') {
    const data = await payload(source, box)
    if (data.byteLength < 4) throw invalidInput('AVIF colr property is truncated')
    const method = ascii(data, 0, 4)
    if (method === 'nclx') {
      if (data.byteLength < 11) throw invalidInput('AVIF nclx color property is truncated')
      const primaries = uint16BigEndian(data, 4)
      const transfer = uint16BigEndian(data, 6)
      const matrixCoefficients = uint16BigEndian(data, 8)
      const fullRange = ((data[10] ?? 0) & 0x80) !== 0
      return {
        type: 'colr',
        colorSpace: colorSpaceName(primaries, transfer, matrixCoefficients, fullRange),
        nclx: {
          primaries,
          transferCharacteristics: transfer,
          matrixCoefficients,
          fullRange,
        },
      }
    }
    if (method === 'prof' || method === 'rICC') {
      const icc = data.subarray(4)
      const description = inspectIccProfile(icc).description
      return {
        type: 'colr',
        colorSpace: 'icc',
        ...(description === undefined ? {} : { iccDescription: description }),
        colorTransform: parseRgbIccTransform(icc),
      }
    }
  }
  if (box.type === 'irot') {
    const data = await payload(source, box, 1)
    if (data.byteLength !== 1 || ((data[0] ?? 0) & 0xfc) !== 0) {
      throw invalidInput('AVIF irot property is invalid')
    }
    return { type: 'irot', angle: (data[0] ?? 0) & 3 }
  }
  if (box.type === 'imir') {
    const data = await payload(source, box, 1)
    if (data.byteLength !== 1 || ((data[0] ?? 0) & 0xfe) !== 0) {
      throw invalidInput('AVIF imir property is invalid')
    }
    return { type: 'imir', axis: (data[0] ?? 0) === 0 ? 0 : 1 }
  }
  if (box.type === 'clap') {
    const data = await payload(source, box, 32)
    if (data.byteLength !== 32) throw invalidInput('AVIF clap property is invalid')
    const aperture: CleanAperture = {
      width: { numerator: uint32BigEndian(data, 0), denominator: uint32BigEndian(data, 4) },
      height: { numerator: uint32BigEndian(data, 8), denominator: uint32BigEndian(data, 12) },
      horizontalOffset: {
        numerator: int32BigEndian(data, 16),
        denominator: uint32BigEndian(data, 20),
      },
      verticalOffset: {
        numerator: int32BigEndian(data, 24),
        denominator: uint32BigEndian(data, 28),
      },
    }
    for (const value of Object.values(aperture)) {
      if (value.denominator === 0) throw invalidInput('AVIF clap denominator must not be zero')
    }
    if (aperture.width.numerator === 0 || aperture.height.numerator === 0) {
      throw invalidInput('AVIF clap dimensions must be positive')
    }
    return { type: 'clap', aperture }
  }
  return { type: 'unknown' }
}

const parseMeta = async (source: ImageSource, box: Box): Promise<MetaDescription> => {
  const reader = createIsobmffReader(source, 'AVIF')
  const meta = await parseIsobmffMeta(
    reader,
    box,
    async (propertyReader: IsobmffReader, propertyBox: Box): Promise<Property> =>
      parseProperty(propertyReader.source, propertyBox),
  )
  if ([...meta.items.values()].some((item) => item.protectionIndex !== 0)) {
    throw invalidInput('AVIF protected item info is unsupported')
  }
  if ([...meta.locations.values()].some((location) => location.dataReferenceIndex !== 0)) {
    throw invalidInput('AVIF external item location is unsupported')
  }
  return meta
}

const singleAvifBox = (
  boxes: readonly Box[],
  type: string,
  context: string,
  required = true,
): Box | undefined => {
  const matches = boxes.filter((box) => box.type === type)
  if (matches.length > 1 || (required && matches.length !== 1)) {
    throw invalidInput(`${context} requires ${required ? 'exactly' : 'at most'} one ${type} box`)
  }
  return matches[0]
}

const parseTrackId = async (reader: IsobmffReader, trackBoxes: readonly Box[]): Promise<number> => {
  const box = singleAvifBox(trackBoxes, 'tkhd', 'AVIF track')
  if (!box) throw invalidInput('AVIF track has no header')
  const data = await reader.payload(box, 128)
  const { version } = parseFullBox(data, 'tkhd', 'AVIF')
  const offset = version === 0 ? 12 : version === 1 ? 20 : -1
  if (offset < 0 || data.byteLength < offset + 4) {
    throw invalidInput('AVIF track header is truncated or has an unsupported version')
  }
  const trackId = uint32BigEndian(data, offset)
  if (trackId === 0) throw invalidInput('AVIF track ID must not be zero')
  return trackId
}

const greatestCommonDivisor = (left: number, right: number): number => {
  let dividend = left
  let divisor = right
  while (divisor !== 0) {
    const remainder = dividend % divisor
    dividend = divisor
    divisor = remainder
  }
  return dividend
}

const reducedRationalTimesEqual = (
  leftTicks: number,
  leftTimescale: number,
  rightTicks: number,
  rightTimescale: number,
): boolean => {
  const leftDivisor = greatestCommonDivisor(leftTicks, leftTimescale)
  const rightDivisor = greatestCommonDivisor(rightTicks, rightTimescale)
  return (
    leftTicks / leftDivisor === rightTicks / rightDivisor &&
    leftTimescale / leftDivisor === rightTimescale / rightDivisor
  )
}

const parseMovieTimescale = async (
  reader: IsobmffReader,
  movieBoxes: readonly Box[],
): Promise<number> => {
  const box = singleAvifBox(movieBoxes, 'mvhd', 'Animated AVIF movie')
  if (!box) throw invalidInput('Animated AVIF has no movie header')
  const data = await reader.payload(box, 128)
  const { version, flags } = parseFullBox(data, 'mvhd', 'AVIF')
  if (flags !== 0) throw invalidInput('AVIF mvhd flags are unsupported')
  const offset =
    version === 0 && data.byteLength >= 20 ? 12 : version === 1 && data.byteLength >= 32 ? 20 : -1
  if (offset < 0) {
    throw invalidInput('AVIF mvhd box is truncated or has an unsupported version')
  }
  const timescale = uint32BigEndian(data, offset)
  if (timescale === 0) throw invalidInput('AVIF movie timescale must be positive')
  return timescale
}

const parseTrackTiming = async (
  reader: IsobmffReader,
  mediaBoxes: readonly Box[],
): Promise<AvifTrackTiming> => {
  const box = singleAvifBox(mediaBoxes, 'mdhd', 'AVIF media')
  if (!box) throw invalidInput('AVIF track has no media header')
  const data = await reader.payload(box, 64)
  const { version, flags } = parseFullBox(data, 'mdhd', 'AVIF')
  if (flags !== 0) throw invalidInput('AVIF mdhd flags are unsupported')
  let timescale: number
  let duration: number
  if (version === 0 && data.byteLength >= 24) {
    timescale = uint32BigEndian(data, 12)
    duration = uint32BigEndian(data, 16)
  } else if (version === 1 && data.byteLength >= 36) {
    const durationHigh = uint32BigEndian(data, 24)
    if (durationHigh !== 0) throw invalidInput('AVIF track duration exceeds the supported range')
    timescale = uint32BigEndian(data, 20)
    duration = uint32BigEndian(data, 28)
  } else {
    throw invalidInput('AVIF mdhd box is truncated or has an unsupported version')
  }
  if (timescale === 0 || duration === 0) {
    throw invalidInput('AVIF track timescale and duration must be positive')
  }
  return { duration, timescale }
}

const validateTrackSampleDuration = (
  timing: AvifTrackTiming,
  samples: IsobmffSampleTable,
): void => {
  let sampleDuration = 0
  for (const value of samples.durations) {
    sampleDuration = checkedAdd(sampleDuration, value, 'AVIF sample durations overflow')
  }
  if (timing.duration !== sampleDuration) {
    throw invalidInput('AVIF media duration does not match its samples')
  }
}

const validateTrackEdits = async (
  reader: IsobmffReader,
  trackBoxes: readonly Box[],
  timing: AvifTrackTiming,
  movieTimescale: number,
): Promise<void> => {
  const editBox = singleAvifBox(trackBoxes, 'edts', 'AVIF track', false)
  if (!editBox) return
  const editBoxes = await reader.boxes(editBox.contentStart, editBox.end)
  const listBox = singleAvifBox(editBoxes, 'elst', 'AVIF edit list')
  if (!listBox) throw invalidInput('AVIF edit list is missing')
  if (editBoxes.length !== 1) {
    throw unsupportedOperation('Animated AVIF track edit lists are not supported')
  }
  const data = await reader.payload(listBox, 64)
  const { version, flags } = parseFullBox(data, 'elst', 'AVIF')
  if ((flags & ~1) !== 0 || (version !== 0 && version !== 1)) {
    throw invalidInput('AVIF edit list version or flags are unsupported')
  }
  const entryBytes = version === 0 ? 12 : 20
  if (data.byteLength !== 8 + entryBytes || uint32BigEndian(data, 4) !== 1) {
    throw unsupportedOperation('Animated AVIF track edit lists are not supported')
  }
  let segmentDuration: number
  let mediaTimeIsZero: boolean
  let rateOffset: number
  if (version === 0) {
    segmentDuration = uint32BigEndian(data, 8)
    mediaTimeIsZero = int32BigEndian(data, 12) === 0
    rateOffset = 16
  } else {
    if (uint32BigEndian(data, 8) !== 0) {
      throw unsupportedOperation('Animated AVIF track edit lists are not supported')
    }
    segmentDuration = uint32BigEndian(data, 12)
    mediaTimeIsZero = uint32BigEndian(data, 16) === 0 && uint32BigEndian(data, 20) === 0
    rateOffset = 24
  }
  if (
    segmentDuration === 0 ||
    !mediaTimeIsZero ||
    uint16BigEndian(data, rateOffset) !== 1 ||
    uint16BigEndian(data, rateOffset + 2) !== 0 ||
    !reducedRationalTimesEqual(segmentDuration, movieTimescale, timing.duration, timing.timescale)
  ) {
    throw unsupportedOperation('Animated AVIF track edit lists are not supported')
  }
}

const validateCompositionOffsets = async (
  reader: IsobmffReader,
  sampleBoxes: readonly Box[],
  sampleCount: number,
): Promise<void> => {
  const box = singleAvifBox(sampleBoxes, 'ctts', 'AVIF sample table', false)
  if (!box) return
  const data = await reader.payload(box, MAX_METADATA_BOX_BYTES)
  const { version, flags } = parseFullBox(data, 'ctts', 'AVIF')
  if (flags !== 0 || (version !== 0 && version !== 1) || data.byteLength < 8) {
    throw invalidInput('AVIF composition offsets are malformed')
  }
  const count = uint32BigEndian(data, 4)
  if (count > sampleCount || data.byteLength !== 8 + count * 8) {
    throw invalidInput('AVIF composition offsets are malformed')
  }
  let described = 0
  for (let entry = 0; entry < count; entry += 1) {
    const samples = uint32BigEndian(data, 8 + entry * 8)
    const compositionOffset =
      version === 0 ? uint32BigEndian(data, 12 + entry * 8) : int32BigEndian(data, 12 + entry * 8)
    if (samples === 0 || samples > sampleCount - described) {
      throw invalidInput('AVIF composition offsets have an invalid sample count')
    }
    if (compositionOffset !== 0) {
      throw unsupportedOperation('AVIF nonzero composition offsets are not supported')
    }
    described += samples
  }
  if (described !== sampleCount) {
    throw invalidInput('AVIF composition offsets do not describe every sample')
  }
}

const parseTrackReferences = async (
  reader: IsobmffReader,
  trackBoxes: readonly Box[],
): Promise<readonly number[]> => {
  const referenceBox = singleAvifBox(trackBoxes, 'tref', 'AVIF track', false)
  if (!referenceBox) return []
  const references = await reader.boxes(referenceBox.contentStart, referenceBox.end)
  const auxiliary = singleAvifBox(references, 'auxl', 'AVIF track references', false)
  if (!auxiliary) return []
  const data = await reader.payload(auxiliary, 4096)
  if (data.byteLength === 0 || data.byteLength % 4 !== 0) {
    throw invalidInput('AVIF auxiliary track references are malformed')
  }
  const trackIds: number[] = []
  for (let offset = 0; offset < data.byteLength; offset += 4) {
    const trackId = uint32BigEndian(data, offset)
    if (trackId === 0) throw invalidInput('AVIF auxiliary track references track ID zero')
    trackIds.push(trackId)
  }
  return trackIds
}

const parseAuxiliaryTrackType = async (
  reader: IsobmffReader,
  boxes: readonly Box[],
): Promise<string | undefined> => {
  const box = singleAvifBox(boxes, 'auxi', 'AVIF sample entry', false)
  if (!box) return undefined
  const data = await reader.payload(box, 1024)
  const { version, flags } = parseFullBox(data, 'auxi', 'AVIF')
  if (version !== 0 || flags !== 0) throw invalidInput('AVIF auxi flags are unsupported')
  const terminator = data.indexOf(0, 4)
  if (terminator === -1 || terminator !== data.byteLength - 1) {
    throw invalidInput('AVIF auxi type is malformed')
  }
  return ascii(data, 4, terminator - 4)
}

const parseAvifTrack = async (
  reader: IsobmffReader,
  track: Box,
  maximumFrames: number,
  movieTimescale: number,
): Promise<AvifTrackDescription | undefined> => {
  const trackBoxes = await reader.boxes(track.contentStart, track.end)
  const trackId = await parseTrackId(reader, trackBoxes)
  const media = singleAvifBox(trackBoxes, 'mdia', `AVIF track ${trackId}`)
  if (!media) throw invalidInput(`AVIF track ${trackId} has no media box`)
  const mediaBoxes = await reader.boxes(media.contentStart, media.end)
  const timing = await parseTrackTiming(reader, mediaBoxes)
  await validateTrackEdits(reader, trackBoxes, timing, movieTimescale)
  const handler = singleAvifBox(mediaBoxes, 'hdlr', `AVIF track ${trackId}`)
  if (!handler) throw invalidInput(`AVIF track ${trackId} has no handler`)
  const handlerData = await reader.payload(handler, 4096)
  const handlerFull = parseFullBox(handlerData, 'hdlr', 'AVIF')
  if (handlerFull.version !== 0 || handlerFull.flags !== 0 || handlerData.byteLength < 12) {
    throw invalidInput(`AVIF track ${trackId} handler is malformed`)
  }
  const handlerType = ascii(handlerData, 8, 4)

  const mediaInformation = singleAvifBox(mediaBoxes, 'minf', `AVIF track ${trackId}`)
  if (!mediaInformation) throw invalidInput(`AVIF track ${trackId} has no media information`)
  const mediaInformationBoxes = await reader.boxes(
    mediaInformation.contentStart,
    mediaInformation.end,
  )
  const sampleTableBox = singleAvifBox(mediaInformationBoxes, 'stbl', `AVIF track ${trackId}`)
  if (!sampleTableBox) throw invalidInput(`AVIF track ${trackId} has no sample table`)
  const sampleBoxes = await reader.boxes(sampleTableBox.contentStart, sampleTableBox.end)
  const sampleDescription = singleAvifBox(sampleBoxes, 'stsd', `AVIF track ${trackId} sample table`)
  if (!sampleDescription) throw invalidInput(`AVIF track ${trackId} has no sample descriptions`)
  const descriptionData = await readExactly(reader.source, sampleDescription.contentStart, 8)
  const descriptionFull = parseFullBox(descriptionData, 'stsd', 'AVIF')
  if (descriptionFull.version !== 0 || descriptionFull.flags !== 0) {
    throw invalidInput(`AVIF track ${trackId} sample descriptions are malformed`)
  }
  const descriptionCount = uint32BigEndian(descriptionData, 4)
  const descriptions = await reader.boxes(sampleDescription.contentStart + 8, sampleDescription.end)
  if (descriptionCount !== descriptions.length) {
    throw invalidInput(`AVIF track ${trackId} sample description count is inconsistent`)
  }
  const av1Descriptions = descriptions
    .map((description, index) => ({ description, index: index + 1 }))
    .filter((entry) => entry.description.type === 'av01')
  if (av1Descriptions.length === 0) return undefined
  if (av1Descriptions.length !== 1 || !av1Descriptions[0]) {
    throw unsupportedOperation(`AVIF track ${trackId} has multiple AV1 sample descriptions`)
  }

  const entry = av1Descriptions[0].description
  if (entry.end - entry.contentStart < 78) {
    throw invalidInput(`AVIF track ${trackId} AV1 sample entry is truncated`)
  }
  const visualEntry = await readExactly(reader.source, entry.contentStart, 78)
  if (uint16BigEndian(visualEntry, 6) !== 1) {
    throw unsupportedOperation(`AVIF track ${trackId} uses an external data reference`)
  }
  const width = uint16BigEndian(visualEntry, 24)
  const height = uint16BigEndian(visualEntry, 26)
  if (width === 0 || height === 0) {
    throw invalidInput(`AVIF track ${trackId} has invalid dimensions`)
  }
  const entryBoxes = await reader.boxes(entry.contentStart + 78, entry.end)
  if (entryBoxes.some((box) => box.type === 'clap')) {
    throw unsupportedOperation('Animated AVIF track-level clean apertures are not supported')
  }
  const configurationBox = singleAvifBox(entryBoxes, 'av1C', `AVIF track ${trackId} sample entry`)
  if (!configurationBox) throw invalidInput(`AVIF track ${trackId} has no AV1 configuration`)
  const configurationData = await reader.payload(configurationBox, 4096)
  const configuration = parseAv1Configuration(configurationData)
  const colorBox = singleAvifBox(entryBoxes, 'colr', `AVIF track ${trackId} sample entry`, false)
  const parsedColor = colorBox ? await parseProperty(reader.source, colorBox) : undefined
  const color = parsedColor?.type === 'colr' ? parsedColor : undefined
  const auxiliaryType = await parseAuxiliaryTrackType(reader, entryBoxes)
  const auxiliaryForTrackIds = await parseTrackReferences(reader, trackBoxes)

  const samples = await parseIsobmffSampleTable(reader, sampleTableBox, maximumFrames)
  if (samples.sampleDescriptionIndices.some((index) => index !== av1Descriptions[0]?.index)) {
    throw unsupportedOperation(`AVIF track ${trackId} switches AV1 sample descriptions`)
  }
  validateTrackSampleDuration(timing, samples)
  const { timescale } = timing
  await validateCompositionOffsets(reader, sampleBoxes, samples.sizes.length)

  return {
    trackId,
    handlerType,
    width,
    height,
    timescale,
    configuration,
    configurationObus: configurationData.slice(4),
    color,
    auxiliaryType,
    auxiliaryForTrackIds,
    samples,
  }
}

const validateAlignedTrackTiming = (
  color: AvifTrackDescription,
  alpha: AvifTrackDescription,
): void => {
  let colorTimestamp = 0
  let alphaTimestamp = 0
  for (let frame = 0; frame < color.samples.durations.length; frame += 1) {
    const colorDuration = color.samples.durations[frame]
    const alphaDuration = alpha.samples.durations[frame]
    if (colorDuration === undefined || alphaDuration === undefined) {
      throw invalidInput('Animated AVIF sample timing is incomplete')
    }
    if (
      !reducedRationalTimesEqual(colorDuration, color.timescale, alphaDuration, alpha.timescale) ||
      !reducedRationalTimesEqual(colorTimestamp, color.timescale, alphaTimestamp, alpha.timescale)
    ) {
      throw unsupportedOperation('Animated AVIF alpha and color sample timing does not align')
    }
    colorTimestamp = checkedAdd(
      colorTimestamp,
      colorDuration,
      'Animated AVIF color sample timestamps overflow',
    )
    alphaTimestamp = checkedAdd(
      alphaTimestamp,
      alphaDuration,
      'Animated AVIF alpha sample timestamps overflow',
    )
  }
  if (
    !reducedRationalTimesEqual(colorTimestamp, color.timescale, alphaTimestamp, alpha.timescale)
  ) {
    throw unsupportedOperation('Animated AVIF alpha and color sample timing does not align')
  }
}

const inspectAvifTracks = async (
  source: ImageSource,
  maximumFrames: number,
  topLevel?: readonly Box[],
): Promise<AvifTrackInspection> => {
  const reader = createIsobmffReader(source, 'AVIF')
  const boxes = topLevel ?? (await reader.boxes(0, source.size))
  const movie = singleAvifBox(boxes, 'moov', 'Animated AVIF')
  if (!movie) throw invalidInput('Animated AVIF has no movie box')
  const movieBoxes = await reader.boxes(movie.contentStart, movie.end)
  const movieTimescale = await parseMovieTimescale(reader, movieBoxes)
  const trackBoxes = movieBoxes.filter((box) => box.type === 'trak')
  if (trackBoxes.length === 0 || trackBoxes.length > MAX_AVIF_TRACKS) {
    throw invalidInput('Animated AVIF has an invalid track count')
  }
  const tracks: AvifTrackDescription[] = []
  for (const box of trackBoxes) {
    const track = await parseAvifTrack(reader, box, maximumFrames, movieTimescale)
    if (track) tracks.push(track)
  }
  if (new Set(tracks.map((track) => track.trackId)).size !== tracks.length) {
    throw invalidInput('Animated AVIF has duplicate track IDs')
  }
  const colorTracks = tracks.filter(
    (track) => track.handlerType === 'pict' && track.auxiliaryType === undefined,
  )
  if (colorTracks.length !== 1 || !colorTracks[0]) {
    throw unsupportedOperation('Animated AVIF requires exactly one AV1 color track')
  }
  const color = colorTracks[0]
  const alphaTracks = tracks.filter(
    (track) =>
      track.handlerType === 'auxv' &&
      track.auxiliaryType !== undefined &&
      ALPHA_AUXILIARY_TYPES.has(track.auxiliaryType) &&
      track.auxiliaryForTrackIds.includes(color.trackId),
  )
  if (alphaTracks.length > 1) {
    throw invalidInput('Animated AVIF color track has multiple alpha tracks')
  }
  const alpha = alphaTracks[0]
  const frames = color.samples.sizes.length
  if (alpha) {
    if (
      alpha.width !== color.width ||
      alpha.height !== color.height ||
      alpha.samples.sizes.length !== frames
    ) {
      throw invalidInput('Animated AVIF alpha track geometry or sample count does not match color')
    }
    validateAlignedTrackTiming(color, alpha)
  }
  return { color, alpha, frames }
}

const propertiesFor = (meta: MetaDescription, itemId: number): readonly Property[] => {
  return (meta.associations.get(itemId) ?? []).map((association) => {
    const property = meta.properties[association.index - 1]
    if (!property) throw invalidInput(`AVIF item references missing property ${association.index}`)
    return property
  })
}

const firstProperty = <Type extends Property['type']>(
  properties: readonly Property[],
  type: Type,
): Extract<Property, { type: Type }> | undefined => {
  return properties.find(
    (property): property is Extract<Property, { type: Type }> => property.type === type,
  )
}

const oneProperty = <Type extends Property['type']>(
  properties: readonly Property[],
  type: Type,
): Extract<Property, { type: Type }> | undefined => {
  const matches = properties.filter(
    (property): property is Extract<Property, { type: Type }> => property.type === type,
  )
  if (matches.length > 1) throw invalidInput(`AVIF item has conflicting ${type} properties`)
  return matches[0]
}

const cleanApertureAxis = (
  sourceSize: number,
  apertureSize: Rational,
  apertureOffset: Rational,
): { readonly origin: number; readonly size: number } => {
  if (apertureSize.numerator % apertureSize.denominator !== 0) {
    throw unsupportedOperation('Fractional AVIF clean-aperture dimensions are unsupported')
  }
  const size = apertureSize.numerator / apertureSize.denominator

  // ISO/IEC 14496-12 locates the leftmost clean-aperture sample at
  // offset + (sourceSize - size) / 2. Preserve that sample lattice exactly:
  // integer coordinates index their sample, while half coordinates index the
  // next sample. Other fractions would require resampling.
  const doubledOffsetNumerator = apertureOffset.numerator * 2
  if (doubledOffsetNumerator % apertureOffset.denominator !== 0) {
    throw unsupportedOperation(
      'AVIF clean-aperture origins must resolve to integer or half-integer sample coordinates',
    )
  }
  const doubledOrigin = sourceSize - size + doubledOffsetNumerator / apertureOffset.denominator
  const doubledEnd = doubledOrigin + size * 2
  if (!Number.isSafeInteger(doubledOrigin) || !Number.isSafeInteger(doubledEnd)) {
    throw invalidInput('AVIF clean-aperture arithmetic exceeds the safe integer range')
  }
  if (doubledOrigin < 0 || doubledEnd > sourceSize * 2) {
    throw invalidInput('AVIF clean aperture exceeds its source image')
  }
  return { origin: Math.ceil(doubledOrigin / 2), size }
}

const cleanApertureRegion = (
  source: { readonly width: number; readonly height: number },
  aperture: CleanAperture | undefined,
): PixelRegion => {
  if (!aperture) return { x: 0, y: 0, ...source }
  const horizontal = cleanApertureAxis(source.width, aperture.width, aperture.horizontalOffset)
  const vertical = cleanApertureAxis(source.height, aperture.height, aperture.verticalOffset)
  return {
    x: horizontal.origin,
    y: vertical.origin,
    width: horizontal.size,
    height: vertical.size,
  }
}

interface OrientationMatrix {
  readonly xx: -1 | 0 | 1
  readonly xy: -1 | 0 | 1
  readonly yx: -1 | 0 | 1
  readonly yy: -1 | 0 | 1
}

const orientationMatrices: Readonly<Record<number, OrientationMatrix>> = Object.freeze({
  1: { xx: 1, xy: 0, yx: 0, yy: 1 },
  2: { xx: -1, xy: 0, yx: 0, yy: 1 },
  3: { xx: -1, xy: 0, yx: 0, yy: -1 },
  4: { xx: 1, xy: 0, yx: 0, yy: -1 },
  5: { xx: 0, xy: 1, yx: 1, yy: 0 },
  6: { xx: 0, xy: -1, yx: 1, yy: 0 },
  7: { xx: 0, xy: -1, yx: -1, yy: 0 },
  8: { xx: 0, xy: 1, yx: -1, yy: 0 },
})

const orientationComponent = (value: number): -1 | 0 | 1 => {
  if (value === -1 || value === 0 || value === 1) return value
  throw invalidInput('AVIF orientation matrix is invalid')
}

const multiplyOrientation = (
  next: OrientationMatrix,
  current: OrientationMatrix,
): OrientationMatrix => ({
  xx: orientationComponent(next.xx * current.xx + next.xy * current.yx),
  xy: orientationComponent(next.xx * current.xy + next.xy * current.yy),
  yx: orientationComponent(next.yx * current.xx + next.yy * current.yx),
  yy: orientationComponent(next.yx * current.xy + next.yy * current.yy),
})

const orientationFor = (properties: readonly Property[]): number | undefined => {
  const transforms = properties.filter(
    (property): property is Extract<Property, { type: 'imir' | 'irot' }> =>
      property.type === 'imir' || property.type === 'irot',
  )
  if (transforms.length === 0) return undefined
  let matrix = orientationMatrices[1]
  if (!matrix) throw invalidInput('AVIF identity orientation is unavailable')
  for (const transform of transforms) {
    const orientation =
      transform.type === 'irot'
        ? transform.angle === 0
          ? 1
          : transform.angle === 1
            ? 8
            : transform.angle === 2
              ? 3
              : 6
        : transform.axis === 0
          ? 4
          : 2
    const next = orientationMatrices[orientation]
    if (!next) throw invalidInput('AVIF transform orientation is invalid')
    matrix = multiplyOrientation(next, matrix)
  }
  for (const [orientation, candidate] of Object.entries(orientationMatrices)) {
    if (
      candidate.xx === matrix.xx &&
      candidate.xy === matrix.xy &&
      candidate.yx === matrix.yx &&
      candidate.yy === matrix.yy
    ) {
      return Number(orientation)
    }
  }
  throw invalidInput('AVIF transforms do not map to an EXIF orientation')
}

const validateTransformProperties = (properties: readonly Property[]): void => {
  const ranks: Readonly<Record<'clap' | 'imir' | 'irot', number>> = {
    clap: 0,
    irot: 1,
    imir: 2,
  }
  let previousRank = -1
  for (const property of properties) {
    if (property.type !== 'clap' && property.type !== 'irot' && property.type !== 'imir') continue
    const rank = ranks[property.type]
    if (rank < previousRank) {
      throw invalidInput('AVIF transformative properties are associated in an invalid order')
    }
    previousRank = rank
  }
  oneProperty(properties, 'clap')
  oneProperty(properties, 'irot')
  oneProperty(properties, 'imir')
}

const MAX_ITEM_PAYLOAD_BYTES = 128 * 1024 * 1024

const readItemPayload = async (
  source: ImageSource,
  meta: MetaDescription,
  itemId: number,
): Promise<Uint8Array> => {
  const location = meta.locations.get(itemId)
  if (!location || location.extents.length === 0) {
    throw invalidInput(`AVIF item ${itemId} has no payload location`)
  }
  let base = location.baseOffset
  if (location.constructionMethod === 1) {
    if (!meta.idat) throw invalidInput(`AVIF item ${itemId} requires a missing idat box`)
    base = checkedAdd(
      meta.idat.contentStart,
      location.baseOffset,
      `AVIF item ${itemId} base offset overflows`,
    )
  }
  let total = 0
  const ranges = location.extents.map((extent) => {
    const start = checkedAdd(base, extent.offset, `AVIF item ${itemId} extent offset overflows`)
    const end = checkedAdd(start, extent.length, `AVIF item ${itemId} extent end overflows`)
    const boundary = location.constructionMethod === 1 ? meta.idat?.end : source.size
    if (boundary === undefined || end > boundary) {
      throw invalidInput(`AVIF item ${itemId} extent exceeds its data source`)
    }
    total = checkedAdd(total, extent.length, `AVIF item ${itemId} total size overflows`)
    if (total > MAX_ITEM_PAYLOAD_BYTES) {
      throw invalidInput(`AVIF item ${itemId} payload is unreasonably large`)
    }
    return { start, length: extent.length }
  })
  if (ranges.length === 1) {
    const range = ranges[0]
    if (!range) throw invalidInput(`AVIF item ${itemId} has no extent`)
    return readExactly(source, range.start, range.length)
  }
  const output = new Uint8Array(total)
  let outputOffset = 0
  for (const range of ranges) {
    const bytes = await readExactly(source, range.start, range.length)
    output.set(bytes, outputOffset)
    outputOffset += bytes.byteLength
  }
  return output
}

export interface AvifGridDescription {
  readonly columns: number
  readonly height: number
  readonly rows: number
  readonly width: number
}

const parseGrid = (data: Uint8Array): AvifGridDescription => {
  const version = data[0]
  const flags = data[1]
  const rowsMinusOne = data[2]
  const columnsMinusOne = data[3]
  if (
    version !== 0 ||
    flags === undefined ||
    (flags & ~1) !== 0 ||
    rowsMinusOne === undefined ||
    columnsMinusOne === undefined
  ) {
    throw invalidInput('AVIF grid item header is invalid')
  }
  const wide = (flags & 1) !== 0
  const expectedLength = wide ? 12 : 8
  if (data.byteLength !== expectedLength) throw invalidInput('AVIF grid item has an invalid size')
  return {
    rows: rowsMinusOne + 1,
    columns: columnsMinusOne + 1,
    width: wide ? uint32BigEndian(data, 4) : uint16BigEndian(data, 4),
    height: wide ? uint32BigEndian(data, 8) : uint16BigEndian(data, 6),
  }
}

interface GainMapChannelMetadata {
  readonly alternateOffset: Rational
  readonly baseOffset: Rational
  readonly gamma: Rational
  readonly maximum: Rational
  readonly minimum: Rational
}

const signedInt32 = (data: Uint8Array, offset: number): number => {
  const value = uint32BigEndian(data, offset)
  return value > 0x7fff_ffff ? value - 0x1_0000_0000 : value
}

const parseGainMapChannel = (data: Uint8Array, offset: number): GainMapChannelMetadata => ({
  minimum: {
    numerator: signedInt32(data, offset),
    denominator: uint32BigEndian(data, offset + 4),
  },
  maximum: {
    numerator: signedInt32(data, offset + 8),
    denominator: uint32BigEndian(data, offset + 12),
  },
  gamma: {
    numerator: uint32BigEndian(data, offset + 16),
    denominator: uint32BigEndian(data, offset + 20),
  },
  baseOffset: {
    numerator: signedInt32(data, offset + 24),
    denominator: uint32BigEndian(data, offset + 28),
  },
  alternateOffset: {
    numerator: signedInt32(data, offset + 32),
    denominator: uint32BigEndian(data, offset + 36),
  },
})

const rationalValue = (value: Rational): number => value.numerator / value.denominator

const validateGainMapChannel = (channel: GainMapChannelMetadata): void => {
  if (
    channel.minimum.denominator === 0 ||
    channel.maximum.denominator === 0 ||
    channel.gamma.denominator === 0 ||
    channel.baseOffset.denominator === 0 ||
    channel.alternateOffset.denominator === 0
  ) {
    throw invalidInput('AVIF gain-map metadata has a zero channel denominator')
  }
  if (channel.gamma.numerator === 0) {
    throw invalidInput('AVIF gain-map metadata has zero gamma')
  }
  if (rationalValue(channel.maximum) < rationalValue(channel.minimum)) {
    throw invalidInput('AVIF gain-map metadata maximum is below its minimum')
  }
}

const parseGainMapMetadata = (data: Uint8Array): AvifGainMapMetadata => {
  if (data.byteLength < 22) throw invalidInput('AVIF tmap item is truncated')
  const version = data[0] ?? 0
  const minimumVersion = uint16BigEndian(data, 1)
  const writerVersion = uint16BigEndian(data, 3)
  if (version !== 0) throw unsupportedOperation(`AVIF tmap version ${version} is not supported`)
  if (minimumVersion > 0) {
    throw unsupportedOperation(`AVIF tmap minimum version ${minimumVersion} is not supported`)
  }
  if (writerVersion < minimumVersion) throw invalidInput('AVIF tmap writer version is invalid')
  const flags = data[5] ?? 0
  if ((flags & 0x3f) !== 0) throw invalidInput('AVIF gain-map metadata reserved bits are nonzero')
  const channelCount = (flags & 0x80) !== 0 ? 3 : 1
  const expectedBytes = 22 + channelCount * 40
  if (
    data.byteLength < expectedBytes ||
    (writerVersion === 0 && data.byteLength !== expectedBytes)
  ) {
    throw invalidInput('AVIF tmap item has an invalid size')
  }
  const baseHdrHeadroom = {
    numerator: uint32BigEndian(data, 6),
    denominator: uint32BigEndian(data, 10),
  }
  const alternateHdrHeadroom = {
    numerator: uint32BigEndian(data, 14),
    denominator: uint32BigEndian(data, 18),
  }
  if (baseHdrHeadroom.denominator === 0 || alternateHdrHeadroom.denominator === 0) {
    throw invalidInput('AVIF gain-map metadata has a zero headroom denominator')
  }
  const first = parseGainMapChannel(data, 22)
  const second = channelCount === 3 ? parseGainMapChannel(data, 62) : first
  const third = channelCount === 3 ? parseGainMapChannel(data, 102) : first
  validateGainMapChannel(first)
  validateGainMapChannel(second)
  validateGainMapChannel(third)
  return {
    useBaseColorSpace: (flags & 0x40) !== 0,
    baseHdrHeadroom,
    alternateHdrHeadroom,
    gainMapMin: [first.minimum, second.minimum, third.minimum],
    gainMapMax: [first.maximum, second.maximum, third.maximum],
    gainMapGamma: [first.gamma, second.gamma, third.gamma],
    baseOffset: [first.baseOffset, second.baseOffset, third.baseOffset],
    alternateOffset: [first.alternateOffset, second.alternateOffset, third.alternateOffset],
  }
}

export interface AvifGainMapGridInspection {
  readonly description: AvifGridDescription
  readonly itemIds: readonly number[]
  readonly nclx?: NclxColor
}

export interface AvifGainMapInspection {
  readonly alternateColor: NclxColor
  readonly gainMapItemId: number
  readonly gainMapItemType: 'av01' | 'grid'
  readonly grid?: AvifGainMapGridInspection
  readonly metadata: AvifGainMapMetadata
  readonly toneMapItemId: number
}

const inspectGainMap = async (
  source: ImageSource,
  meta: MetaDescription,
  primaryItemId: number,
): Promise<AvifGainMapInspection | undefined> => {
  const candidates: AvifGainMapInspection[] = []
  for (const [toneMapItemId, item] of meta.items) {
    if (item.type !== 'tmap') continue
    const derivedItems = meta.references
      .filter((reference) => reference.type === 'dimg' && reference.fromItemId === toneMapItemId)
      .flatMap((reference) => reference.toItemIds)
    if (derivedItems[0] !== primaryItemId) continue
    const preferred = meta.groups.some((group) => {
      if (group.type !== 'altr') return false
      const toneMapIndex = group.entityIds.indexOf(toneMapItemId)
      const primaryIndex = group.entityIds.indexOf(primaryItemId)
      return toneMapIndex >= 0 && primaryIndex > toneMapIndex
    })
    if (!preferred) continue
    if (derivedItems.length !== 2) {
      throw invalidInput('AVIF tmap item must reference one base image and one gain map')
    }
    const gainMapItemId = derivedItems[1]
    if (gainMapItemId === undefined) throw invalidInput('AVIF tmap item has no gain-map image')
    const gainMapItemType = meta.items.get(gainMapItemId)?.type
    if (gainMapItemType !== 'av01' && gainMapItemType !== 'grid') {
      throw invalidInput('AVIF tmap item references an unsupported gain-map image type')
    }
    const alternateColors = propertiesFor(meta, toneMapItemId).flatMap((property) =>
      property.type === 'colr' && property.nclx ? [property.nclx] : [],
    )
    if (alternateColors.length !== 1) {
      throw unsupportedOperation('AVIF gain-map alternate NCLX color signaling is required')
    }
    const alternateColor = alternateColors[0]
    if (!alternateColor) throw invalidInput('AVIF gain-map alternate color is missing')
    let grid: AvifGainMapGridInspection | undefined
    if (gainMapItemType === 'grid') {
      const gridProperties = propertiesFor(meta, gainMapItemId)
      const dimensions = firstProperty(gridProperties, 'ispe')
      if (!dimensions) throw invalidInput('AVIF gain-map grid has no spatial extents')
      const description = parseGrid(await readItemPayload(source, meta, gainMapItemId))
      if (dimensions.width !== description.width || dimensions.height !== description.height) {
        throw invalidInput('AVIF gain-map grid dimensions do not match its spatial extents')
      }
      const itemIds = meta.references
        .filter((reference) => reference.type === 'dimg' && reference.fromItemId === gainMapItemId)
        .flatMap((reference) => reference.toItemIds)
      if (
        itemIds.length !== description.rows * description.columns ||
        itemIds.some((itemId) => meta.items.get(itemId)?.type !== 'av01')
      ) {
        throw invalidInput('AVIF gain-map grid tile layout is invalid')
      }
      const gridNclx = firstProperty(gridProperties, 'colr')?.nclx
      grid = {
        description,
        itemIds,
        ...(gridNclx ? { nclx: gridNclx } : {}),
      }
    }
    candidates.push({
      toneMapItemId,
      gainMapItemId,
      gainMapItemType,
      alternateColor,
      ...(grid ? { grid } : {}),
      metadata: parseGainMapMetadata(await readItemPayload(source, meta, toneMapItemId)),
    })
  }
  if (candidates.length > 1) throw invalidInput('AVIF primary image has multiple gain maps')
  return candidates[0]
}

const nclxSrgbTransform = (color: NclxColor | undefined): RgbIccTransform | undefined => {
  if (
    !color ||
    isHdrTransfer(color.transferCharacteristics) ||
    color.primaries === 2 ||
    color.transferCharacteristics === 2 ||
    (color.primaries === 1 && color.transferCharacteristics === 13)
  ) {
    return undefined
  }
  if (
    ![1, 9, 12].includes(color.primaries) ||
    ![1, 6, 8, 13, 14, 15].includes(color.transferCharacteristics)
  ) {
    return undefined
  }
  return createNclxSrgbTransform(color.primaries, color.transferCharacteristics)
}

export interface AvifCodedImageInspection {
  readonly configurationMatchesSequence: boolean
  readonly height: number
  readonly itemId: number
  readonly layerSizes?: readonly number[]
  readonly nclx?: NclxColor
  readonly layerSelector?: number
  readonly obus: readonly Av1Obu[]
  readonly operatingPointIndex?: number
  readonly payloadBytes: number
  readonly role: 'alpha' | 'color' | 'gain-map'
  readonly mirroring: number
  readonly rotation: number
  readonly sequence: Av1SequenceHeader
  readonly width: number
}

export interface AvifAlphaAssociation {
  readonly alphaItemId: number
  readonly colorItemId: number
}

export interface AvifBitstreamInspection {
  readonly alphaItemId?: number
  readonly alphaAssociations: readonly AvifAlphaAssociation[]
  readonly codedImages: readonly AvifCodedImageInspection[]
  readonly colorItemIds: readonly number[]
  readonly gainMap?: AvifGainMapInspection
  readonly displayRegion: PixelRegion
  readonly colorTransform?: RgbIccTransform
  readonly nclx?: NclxColor
  readonly mirroring: number
  readonly grid?: AvifGridDescription
  readonly premultipliedAlpha: boolean
  readonly rotation: number
  readonly primaryItemId: number
  readonly primaryItemType: 'av01' | 'grid'
}

const av1ConfigurationMatches = (
  configuration: Av1Configuration,
  sequence: Av1SequenceHeader,
): boolean => {
  const operatingPoint = sequence.operatingPoints[0]
  if (!operatingPoint) return false
  return (
    configuration.profile === sequence.profile &&
    configuration.bitDepth === sequence.bitDepth &&
    configuration.chromaSubsampling === sequence.chromaSubsampling &&
    configuration.level === operatingPoint.level &&
    configuration.tier === operatingPoint.tier
  )
}

export const inspectAvifBitstreams = async (
  source: ImageSource,
): Promise<AvifBitstreamInspection> => {
  const topLevel = await childBoxes(source, 0, source.size)
  const metaBox = topLevel.find((box) => box.type === 'meta')
  if (!metaBox) throw invalidInput('AVIF requires a meta box')
  const meta = await parseMeta(source, metaBox)
  const primaryItemId = meta.primaryItemId
  if (primaryItemId === undefined) throw invalidInput('AVIF has no primary item')
  const primaryType = meta.items.get(primaryItemId)?.type
  if (primaryType !== 'av01' && primaryType !== 'grid') {
    throw invalidInput(`Unsupported AVIF primary item type: ${primaryType ?? 'missing'}`)
  }
  const primaryProperties = propertiesFor(meta, primaryItemId)
  validateTransformProperties(primaryProperties)
  const primaryDimensions = firstProperty(primaryProperties, 'ispe')
  if (!primaryDimensions) throw invalidInput('AVIF primary item has no spatial extents')
  const displayRegion = cleanApertureRegion(
    primaryDimensions,
    oneProperty(primaryProperties, 'clap')?.aperture,
  )
  const colorProperty = firstProperty(primaryProperties, 'colr')
  const nclx = colorProperty?.nclx
  const colorTransform = colorProperty?.colorTransform ?? nclxSrgbTransform(nclx)

  let colorItemIds: readonly number[]
  let grid: AvifGridDescription | undefined
  if (primaryType === 'av01') colorItemIds = [primaryItemId]
  else {
    grid = parseGrid(await readItemPayload(source, meta, primaryItemId))
    if (primaryDimensions.width !== grid.width || primaryDimensions.height !== grid.height) {
      throw invalidInput('AVIF grid dimensions do not match its spatial extents')
    }
    const references = meta.references
      .filter((reference) => reference.type === 'dimg' && reference.fromItemId === primaryItemId)
      .flatMap((reference) => reference.toItemIds)
    if (references.length !== grid.rows * grid.columns) {
      throw invalidInput('AVIF grid dimensions do not match its tile references')
    }
    if (references.some((itemId) => meta.items.get(itemId)?.type !== 'av01')) {
      throw invalidInput('AVIF grid references a non-AV1 tile')
    }
    colorItemIds = references
  }
  const gainMap = await inspectGainMap(source, meta, primaryItemId)

  const isAlphaAuxiliaryItem = (itemId: number): boolean =>
    propertiesFor(meta, itemId).some(
      (property) => property.type === 'auxC' && ALPHA_AUXILIARY_TYPES.has(property.auxiliaryType),
    )
  const alphaAssociations: AvifAlphaAssociation[] = []
  const associatedAlphaItemIds: number[] = []
  for (const reference of meta.references) {
    if (reference.type !== 'auxl' || !isAlphaAuxiliaryItem(reference.fromItemId)) continue
    const alphaItemId = reference.fromItemId
    const alphaType = meta.items.get(alphaItemId)?.type
    for (const targetItemId of reference.toItemIds) {
      if (colorItemIds.includes(targetItemId)) {
        if (alphaType !== 'av01') {
          throw invalidInput('AVIF alpha auxiliary item for a coded image is not AV1-coded')
        }
        alphaAssociations.push({ alphaItemId, colorItemId: targetItemId })
        associatedAlphaItemIds.push(alphaItemId)
        continue
      }
      if (targetItemId !== primaryItemId || primaryType !== 'grid') continue
      if (alphaType !== 'grid' || !grid) {
        throw invalidInput('AVIF grid alpha auxiliary item is not an image grid')
      }
      const alphaProperties = propertiesFor(meta, alphaItemId)
      const alphaDimensions = firstProperty(alphaProperties, 'ispe')
      if (!alphaDimensions) throw invalidInput('AVIF alpha grid has no spatial extents')
      const alphaGrid = parseGrid(await readItemPayload(source, meta, alphaItemId))
      if (
        alphaDimensions.width !== alphaGrid.width ||
        alphaDimensions.height !== alphaGrid.height ||
        alphaGrid.width !== grid.width ||
        alphaGrid.height !== grid.height ||
        alphaGrid.rows !== grid.rows ||
        alphaGrid.columns !== grid.columns
      ) {
        throw invalidInput('AVIF alpha grid geometry does not match the color grid')
      }
      const alphaTileIds = meta.references
        .filter((candidate) => candidate.type === 'dimg' && candidate.fromItemId === alphaItemId)
        .flatMap((candidate) => candidate.toItemIds)
      if (
        alphaTileIds.length !== colorItemIds.length ||
        alphaTileIds.some((itemId) => meta.items.get(itemId)?.type !== 'av01')
      ) {
        throw invalidInput('AVIF alpha grid tile layout is invalid')
      }
      for (let index = 0; index < colorItemIds.length; index += 1) {
        const colorItemId = colorItemIds[index]
        const alphaTileItemId = alphaTileIds[index]
        if (colorItemId === undefined || alphaTileItemId === undefined) {
          throw invalidInput('AVIF alpha grid tile layout is incomplete')
        }
        alphaAssociations.push({ alphaItemId: alphaTileItemId, colorItemId })
        associatedAlphaItemIds.push(alphaTileItemId)
      }
    }
  }
  if (
    new Set(alphaAssociations.map((association) => association.colorItemId)).size !==
    alphaAssociations.length
  ) {
    throw invalidInput('AVIF color item has multiple alpha auxiliary items')
  }
  if (alphaAssociations.length !== 0 && alphaAssociations.length !== colorItemIds.length) {
    throw invalidInput('AVIF grid has incomplete alpha auxiliary coverage')
  }
  if (associatedAlphaItemIds.some((itemId) => colorItemIds.includes(itemId))) {
    throw invalidInput('AVIF alpha auxiliary item is also referenced as color')
  }

  const alphaItemId = associatedAlphaItemIds[0]
  const premultipliedAlpha =
    alphaItemId !== undefined &&
    meta.references.some(
      (reference) =>
        reference.type === 'prem' &&
        (reference.fromItemId === primaryItemId || colorItemIds.includes(reference.fromItemId)) &&
        reference.toItemIds.some(
          (itemId) => itemId === alphaItemId || associatedAlphaItemIds.includes(itemId),
        ),
    )
  const roles = new Map<number, 'alpha' | 'color' | 'gain-map'>()
  for (const itemId of colorItemIds) roles.set(itemId, 'color')
  for (const itemId of associatedAlphaItemIds) roles.set(itemId, 'alpha')
  const gainMapItemIds =
    gainMap?.gainMapItemType === 'av01' ? [gainMap.gainMapItemId] : (gainMap?.grid?.itemIds ?? [])
  for (const itemId of gainMapItemIds) {
    if (roles.has(itemId)) {
      throw invalidInput('AVIF gain-map item is also referenced as color or alpha')
    }
    roles.set(itemId, 'gain-map')
  }
  const codedImages: AvifCodedImageInspection[] = []
  for (const [itemId, role] of roles) {
    const itemProperties = propertiesFor(meta, itemId)
    validateTransformProperties(itemProperties)
    const operatingPointIndex = oneProperty(itemProperties, 'a1op')?.operatingPointIndex
    const layerSelector = oneProperty(itemProperties, 'lsel')?.layerId
    const layerSizes = oneProperty(itemProperties, 'a1lx')?.layerSizes
    const configuration = firstProperty(itemProperties, 'av1C')?.configuration
    if (!configuration) throw invalidInput(`AVIF item ${itemId} has no av1C property`)
    const dimensions = firstProperty(itemProperties, 'ispe')
    if (!dimensions) throw invalidInput(`AVIF item ${itemId} has no spatial extents`)
    const data = await readItemPayload(source, meta, itemId)
    const stream = inspectAv1Bitstream(data)
    const itemNclx = firstProperty(itemProperties, 'colr')?.nclx
    if (
      operatingPointIndex !== undefined &&
      operatingPointIndex >= stream.sequence.operatingPoints.length
    ) {
      throw invalidInput(`AVIF item ${itemId} selects a missing AV1 operating point`)
    }
    if (layerSizes) {
      let documentedBytes = 0
      for (const size of layerSizes) {
        documentedBytes = checkedAdd(
          documentedBytes,
          size,
          `AVIF item ${itemId} a1lx layer sizes overflow`,
        )
      }
      if (documentedBytes >= data.byteLength) {
        throw invalidInput(`AVIF item ${itemId} a1lx layer sizes exceed its payload`)
      }
    }
    codedImages.push({
      itemId,
      role,
      width: dimensions.width,
      height: dimensions.height,
      mirroring: oneProperty(itemProperties, 'imir')?.axis ?? -1,
      rotation: oneProperty(itemProperties, 'irot')?.angle ?? 0,
      configurationMatchesSequence: av1ConfigurationMatches(configuration, stream.sequence),
      payloadBytes: data.byteLength,
      obus: stream.obus,
      sequence: stream.sequence,
      ...(operatingPointIndex === undefined ? {} : { operatingPointIndex }),
      ...(layerSelector === undefined ? {} : { layerSelector }),
      ...(layerSizes === undefined ? {} : { layerSizes }),
      ...(itemNclx ? { nclx: itemNclx } : {}),
    })
  }

  return {
    primaryItemId,
    alphaAssociations,
    primaryItemType: primaryType,
    colorItemIds,
    mirroring: oneProperty(primaryProperties, 'imir')?.axis ?? -1,
    premultipliedAlpha,
    displayRegion,
    rotation: oneProperty(primaryProperties, 'irot')?.angle ?? 0,
    ...(colorTransform ? { colorTransform } : {}),
    ...(grid ? { grid } : {}),
    ...(alphaItemId !== undefined ? { alphaItemId } : {}),
    ...(nclx ? { nclx } : {}),
    ...(gainMap ? { gainMap } : {}),
    codedImages,
  }
}

const inspectTrackSample = async (
  source: ImageSource,
  track: AvifTrackDescription,
  frame: number,
  role: 'alpha' | 'color',
): Promise<AvifCodedImageInspection> => {
  const size = track.samples.sizes[frame]
  const offset = track.samples.offsets[frame]
  if (size === undefined || offset === undefined || size === 0) {
    throw invalidInput(`Animated AVIF ${role} sample ${frame} is missing`)
  }
  const sample = await readExactly(source, offset, size)
  const sampleObus = parseAv1Obus(sample)
  const sequenceCount = sampleObus.filter((obu) => obu.type === av1ObuType.sequenceHeader).length
  let data = sample
  if (sequenceCount === 0 && track.configurationObus.byteLength !== 0) {
    const combinedBytes = checkedAdd(
      track.configurationObus.byteLength,
      sample.byteLength,
      'Animated AVIF sample bytes overflow',
    )
    validateAvifWorkingBytes(combinedBytes)
    data = new Uint8Array(combinedBytes)
    data.set(track.configurationObus)
    data.set(sample, track.configurationObus.byteLength)
  }
  const stream = inspectAv1Bitstream(data)
  if (!av1ConfigurationMatches(track.configuration, stream.sequence)) {
    throw invalidInput(`Animated AVIF ${role} track configuration does not match its sequence`)
  }
  return {
    itemId: track.trackId,
    role,
    width: track.width,
    height: track.height,
    mirroring: -1,
    rotation: 0,
    configurationMatchesSequence: true,
    payloadBytes: data.byteLength,
    obus: stream.obus,
    sequence: stream.sequence,
    ...(track.color?.nclx ? { nclx: track.color.nclx } : {}),
  }
}

const inspectAvifTrackFrame = async (
  source: ImageSource,
  tracks: AvifTrackInspection,
  frame: number,
): Promise<AvifBitstreamInspection> => {
  if (!Number.isSafeInteger(frame) || frame < 0 || frame >= tracks.frames) {
    throw invalidInput(`AVIF frame ${frame} is out of range for ${tracks.frames} frames`)
  }
  if (tracks.color.samples.syncSamples[frame] !== 1) {
    throw unsupportedOperation(
      `Animated AVIF frame ${frame} is dependent; AV1 inter-frame reconstruction is not supported`,
    )
  }
  if (tracks.alpha && tracks.alpha.samples.syncSamples[frame] !== 1) {
    throw unsupportedOperation(
      `Animated AVIF alpha frame ${frame} is dependent; AV1 inter-frame reconstruction is not supported`,
    )
  }
  let selectedPayloadBytes = tracks.color.samples.sizes[frame] ?? 0
  if (tracks.alpha) {
    selectedPayloadBytes = checkedAdd(
      selectedPayloadBytes,
      tracks.alpha.samples.sizes[frame] ?? 0,
      'Animated AVIF selected sample bytes overflow',
    )
  }
  validateAvifWorkingBytes(selectedPayloadBytes)
  const color = await inspectTrackSample(source, tracks.color, frame, 'color')
  const alpha = tracks.alpha
    ? await inspectTrackSample(source, tracks.alpha, frame, 'alpha')
    : undefined
  const nclx = tracks.color.color?.nclx
  const colorTransform = tracks.color.color?.colorTransform ?? nclxSrgbTransform(nclx)
  return {
    primaryItemId: color.itemId,
    primaryItemType: 'av01',
    colorItemIds: [color.itemId],
    alphaAssociations: alpha ? [{ alphaItemId: alpha.itemId, colorItemId: color.itemId }] : [],
    codedImages: alpha ? [color, alpha] : [color],
    displayRegion: { x: 0, y: 0, width: color.width, height: color.height },
    mirroring: -1,
    premultipliedAlpha: false,
    rotation: 0,
    ...(alpha ? { alphaItemId: alpha.itemId } : {}),
    ...(nclx ? { nclx } : {}),
    ...(colorTransform ? { colorTransform } : {}),
  }
}

const inspectAvif = async (
  source: ImageSource,
  limits: ImageLimits,
  options: Readonly<DecoderOptions> = {},
  knownTracks?: AvifTrackInspection,
  knownTopLevel?: readonly Box[],
): Promise<ImageMetadata> => {
  if (options.frame !== undefined && (!Number.isSafeInteger(options.frame) || options.frame < 0)) {
    throw invalidInput('AVIF frame must be a non-negative safe integer')
  }
  const topLevel = knownTopLevel ?? (await childBoxes(source, 0, source.size))
  const fileType = topLevel.find((box) => box.type === 'ftyp')
  const metaBox = topLevel.find((box) => box.type === 'meta')
  if (!fileType || !metaBox) throw invalidInput('AVIF requires ftyp and meta boxes')

  const brands = parseBrands(await payload(source, fileType, 4096), 'AVIF')
  const avifBrand = brands.some((brand) => brand === 'avif' || brand === 'avis')
  const sequenceBrand = brands.includes('avis')
  if (!avifBrand) throw invalidInput('File does not declare an AVIF brand')
  const tracks = sequenceBrand
    ? (knownTracks ?? (await inspectAvifTracks(source, limits.maxFrames, topLevel)))
    : undefined
  if (tracks && options.frame !== undefined && options.frame >= tracks.frames) {
    throw invalidInput(`AVIF frame ${options.frame} is out of range for ${tracks.frames} frames`)
  }
  if (!tracks && options.frame !== undefined && options.frame !== 0) {
    throw invalidInput('AVIF still image only has frame 0')
  }

  const meta = await parseMeta(source, metaBox)
  if (meta.primaryItemId === undefined) throw invalidInput('AVIF has no primary item')
  const primaryItemId = meta.primaryItemId
  const primaryProperties = propertiesFor(meta, primaryItemId)
  validateTransformProperties(primaryProperties)
  const dimensions = firstProperty(primaryProperties, 'ispe')
  if (!dimensions) throw invalidInput('AVIF primary item has no spatial extents')
  validateImageDimensions(
    tracks?.color.width ?? dimensions.width,
    tracks?.color.height ?? dimensions.height,
    tracks?.frames ?? 1,
    limits,
  )
  const displayRegion = cleanApertureRegion(
    dimensions,
    oneProperty(primaryProperties, 'clap')?.aperture,
  )

  const relatedItemIds = meta.references
    .filter((reference) => reference.fromItemId === primaryItemId && reference.type === 'dimg')
    .flatMap((reference) => reference.toItemIds)
  const configuration =
    firstProperty(primaryProperties, 'av1C')?.configuration ??
    relatedItemIds
      .map((itemId) => firstProperty(propertiesFor(meta, itemId), 'av1C')?.configuration)
      .find((value): value is Av1Configuration => value !== undefined)
  const pixelInformation = firstProperty(primaryProperties, 'pixi')
  if (pixelInformation && configuration && pixelInformation.bitDepth !== configuration.bitDepth) {
    throw invalidInput('AVIF pixi and av1C bit depths do not match')
  }
  const color = firstProperty(primaryProperties, 'colr')
  const orientation = orientationFor(primaryProperties)
  const alphaTargets = new Set([primaryItemId, ...relatedItemIds])
  const hasAlpha = meta.references.some(
    (reference) =>
      reference.type === 'auxl' &&
      reference.toItemIds.some((itemId) => alphaTargets.has(itemId)) &&
      propertiesFor(meta, reference.fromItemId).some(
        (property) => property.type === 'auxC' && ALPHA_AUXILIARY_TYPES.has(property.auxiliaryType),
      ),
  )
  const bitDepth = pixelInformation?.bitDepth ?? configuration?.bitDepth
  const metadataConfiguration = tracks?.color.configuration ?? configuration
  const metadataColor = tracks?.color.color ?? color
  const metadataWidth = tracks?.color.width ?? displayRegion.width
  const metadataHeight = tracks?.color.height ?? displayRegion.height
  const metadataHasAlpha = tracks ? tracks.alpha !== undefined : hasAlpha
  const metadataBitDepth = tracks?.color.configuration.bitDepth ?? bitDepth

  return {
    format: 'avif',
    mimeType: 'image/avif',
    width: metadataWidth,
    height: metadataHeight,
    hasAlpha: metadataHasAlpha,
    frames: tracks?.frames ?? 1,
    ...(metadataBitDepth !== undefined ? { bitDepth: metadataBitDepth } : {}),
    ...(metadataConfiguration
      ? {
          chromaSubsampling: metadataConfiguration.chromaSubsampling,
          codecProfile: metadataConfiguration.profile,
        }
      : {}),
    ...(metadataColor ? { colorSpace: metadataColor.colorSpace } : {}),
    ...(metadataColor?.iccDescription !== undefined
      ? { colorProfile: { kind: 'icc' as const, description: metadataColor.iccDescription } }
      : metadataColor?.colorSpace === 'icc'
        ? { colorProfile: { kind: 'icc' as const } }
        : metadataColor?.nclx
          ? { colorProfile: { kind: 'nclx' as const, ...metadataColor.nclx } }
          : {}),
    ...(orientation !== undefined ? { orientation } : {}),
  }
}
const isHdrTransfer = (transferCharacteristics: number): boolean =>
  transferCharacteristics === 16 || transferCharacteristics === 18

const gainMapWeight = (metadata: AvifGainMapMetadata, hdrHeadroom = 0): number => {
  const base = rationalValue(metadata.baseHdrHeadroom)
  const alternate = rationalValue(metadata.alternateHdrHeadroom)
  if (base === alternate) return 0
  const interpolation = Math.max(0, Math.min(1, (hdrHeadroom - base) / (alternate - base)))
  return alternate < base ? -interpolation : interpolation
}

const validateHdrNclxMatrix = (color: NclxColor): void => {
  if (![0, 1, 5, 6, 9, 10, 12].includes(color.matrixCoefficients)) {
    throw unsupportedOperation(
      `HDR AVIF NCLX matrix coefficients ${color.matrixCoefficients} are not supported`,
    )
  }
  if (color.matrixCoefficients === 10 && color.primaries !== 9) {
    throw unsupportedOperation('HDR AVIF NCLX matrix coefficients 10 require color primaries 9')
  }
}

const nclxHdrToneMap = (color: NclxColor | undefined): NclxHdrToneMap | undefined => {
  if (!color || !isHdrTransfer(color.transferCharacteristics)) return undefined
  if (![1, 9, 12].includes(color.primaries)) {
    throw unsupportedOperation(`HDR AVIF NCLX color primaries ${color.primaries} are not supported`)
  }
  validateHdrNclxMatrix(color)
  const transfer = color.transferCharacteristics
  if (transfer !== 16 && transfer !== 18) return undefined
  return createNclxHdrToneMap(color.primaries, transfer)
}

const av1CicpIsAllUnspecified = (sequence: Av1SequenceHeader): boolean =>
  sequence.colorPrimaries === 2 &&
  sequence.transferCharacteristics === 2 &&
  sequence.matrixCoefficients === 2

const validateHdrCicpConsistency = (
  images: readonly AvifCodedImageInspection[],
  color: NclxColor,
): void => {
  for (const image of images) {
    const sequence = image.sequence
    if (av1CicpIsAllUnspecified(sequence)) continue
    if (
      sequence.colorPrimaries !== color.primaries ||
      sequence.transferCharacteristics !== color.transferCharacteristics ||
      sequence.matrixCoefficients !== color.matrixCoefficients ||
      sequence.fullRange !== color.fullRange
    ) {
      throw invalidInput('AVIF HDR container and AV1 color signaling do not match')
    }
  }
}

const validateSdrPixelDecode = (inspection: AvifBitstreamInspection): void => {
  const colorImages = inspection.codedImages.filter((image) => image.role === 'color')
  const hdrImages = colorImages.filter((image) =>
    isHdrTransfer(image.sequence.transferCharacteristics),
  )
  const color = inspection.nclx
  const containerHdr = isHdrTransfer(color?.transferCharacteristics ?? 0)
  const hdr = containerHdr || hdrImages.length !== 0
  if (color?.matrixCoefficients === 10 && color.transferCharacteristics !== 16) {
    throw unsupportedOperation(
      'AVIF NCLX matrix coefficients 10 are supported only with PQ transfer characteristics 16',
    )
  }
  if (containerHdr && color && color.matrixCoefficients !== 2) validateHdrNclxMatrix(color)
  if (hdr && color) {
    validateHdrCicpConsistency(colorImages, color)
  }
  const gainMapApplies =
    inspection.gainMap !== undefined && gainMapWeight(inspection.gainMap.metadata) !== 0
  if (hdr && gainMapApplies) {
    if (
      !inspection.gainMap ||
      isHdrTransfer(inspection.gainMap.alternateColor.transferCharacteristics)
    ) {
      throw unsupportedOperation('HDR AVIF gain-map alternate must use an SDR transfer')
    }
    return
  }
  if (hdr) {
    if (!color || !containerHdr) {
      throw unsupportedOperation('HDR AVIF pixel decode requires explicit HDR NCLX color signaling')
    }
    nclxHdrToneMap(color)
    return
  }
  if (
    color &&
    color.primaries !== 2 &&
    color.transferCharacteristics !== 2 &&
    color.primaries !== 1 &&
    !nclxSrgbTransform(color)
  ) {
    throw unsupportedOperation('AVIF NCLX color conversion is not supported')
  }
}

const decodeRegion = (
  width: number,
  height: number,
  request: DecodeRequest,
): { readonly x: number; readonly y: number; readonly width: number; readonly height: number } => {
  const x = request.x ?? 0
  const y = request.y ?? 0
  const outputWidth = request.width ?? width - x
  const outputHeight = request.height ?? height - y
  if (
    !Number.isSafeInteger(x) ||
    !Number.isSafeInteger(y) ||
    !Number.isSafeInteger(outputWidth) ||
    !Number.isSafeInteger(outputHeight) ||
    x < 0 ||
    y < 0 ||
    outputWidth < 1 ||
    outputHeight < 1 ||
    x + outputWidth > width ||
    y + outputHeight > height
  ) {
    throw invalidInput('AVIF decode region is invalid')
  }
  return { x, y, width: outputWidth, height: outputHeight }
}

const decodeScaleDenominator = (request: DecodeRequest): 1 | 2 | 4 | 8 => {
  const scale = request.scaleDenominator ?? 1
  if (scale !== 1 && scale !== 2 && scale !== 4 && scale !== 8) {
    throw invalidInput('AVIF decode scale denominator must be 1, 2, 4, or 8')
  }
  return scale
}

const scaledBandRange = (
  sourceY: number,
  outputHeight: number,
  scale: number,
  bandY: number,
  bandHeight: number,
): { readonly start: number; readonly end: number } => ({
  start: Math.max(0, Math.ceil((bandY - sourceY) / scale)),
  end: Math.min(outputHeight, Math.ceil((bandY + bandHeight - sourceY) / scale)),
})

interface AvifAlphaFrame {
  readonly coded: AvifCodedImageInspection
  readonly frame: Av1DecodedFrame
}

class AvifFrameDecoder implements ImageDecoder {
  readonly width: number
  readonly height: number
  readonly pixelFormat = 'rgba8' as const
  readonly capabilities = Object.freeze({
    sequential: true,
    regionDecode: false,
    scaledDecode: false,
    progressive: false,
  })
  readonly #alpha: AvifAlphaFrame | undefined
  readonly #coded: AvifCodedImageInspection
  readonly #color: NclxColor | undefined
  readonly #displayRegion: PixelRegion
  readonly #frame: Av1DecodedFrame
  readonly #premultipliedAlpha: boolean
  readonly #toneMap: NclxHdrToneMap | undefined

  constructor(
    coded: AvifCodedImageInspection,
    frame: Av1DecodedFrame,
    displayRegion: PixelRegion,
    color: NclxColor | undefined,
    alpha: AvifAlphaFrame | undefined,
    premultipliedAlpha: boolean,
    toneMap?: NclxHdrToneMap,
  ) {
    this.width = displayRegion.width
    this.height = displayRegion.height
    this.#coded = coded
    this.#frame = frame
    this.#displayRegion = displayRegion
    this.#color = color
    this.#alpha = alpha
    this.#premultipliedAlpha = premultipliedAlpha
    this.#toneMap = toneMap
    if (alpha) validateAlphaFrame(frame.width, frame.height, alpha)
  }

  async *decode(request: DecodeRequest = {}): AsyncGenerator<PixelBlock> {
    const region = decodeRegion(this.width, this.height, request)
    const sourceX = this.#displayRegion.x + region.x
    const rowsPerBlock = 32
    for (let rowStart = 0; rowStart < region.height; rowStart += rowsPerBlock) {
      const blockHeight = Math.min(rowsPerBlock, region.height - rowStart)
      const sourceY = this.#displayRegion.y + region.y + rowStart
      const data = av1ToRgbaRegion(
        this.#coded.sequence,
        this.#frame,
        { x: sourceX, y: sourceY, width: region.width, height: blockHeight },
        this.#color,
        1,
        this.#toneMap,
      )
      if (this.#alpha) {
        applyAlphaRegion(
          data,
          { x: sourceX, y: sourceY, width: region.width, height: blockHeight },
          this.#alpha,
          this.#premultipliedAlpha,
        )
      }
      yield {
        x: 0,
        y: rowStart,
        width: region.width,
        height: blockHeight,
        stride: region.width * 4,
        format: this.pixelFormat,
        data,
      }
    }
  }
}

export const validateAvifFrameDimensions = (
  coded: Pick<AvifCodedImageInspection, 'height' | 'itemId' | 'width'>,
  frame: Av1Frame,
): void => {
  if (frame.header.upscaledWidth !== coded.width || frame.header.frameHeight !== coded.height) {
    throw invalidInput(`AVIF item ${coded.itemId} dimensions do not match its AV1 frame`)
  }
}

interface Av1FrameUnit {
  readonly obus: readonly Av1Obu[]
  readonly spatialId: number
  readonly temporalId: number
}

const av1FrameUnits = (obus: readonly Av1Obu[]): readonly Av1FrameUnit[] => {
  const units: Av1FrameUnit[] = []
  let splitFrame: Av1Obu[] | undefined
  const commitSplitFrame = (): void => {
    if (!splitFrame) return
    const header = splitFrame[0]
    if (!header) throw invalidInput('AV1 split frame has no frame header')
    units.push({ obus: splitFrame, spatialId: header.spatialId, temporalId: header.temporalId })
    splitFrame = undefined
  }
  for (const obu of obus) {
    if (obu.type === av1ObuType.frame) {
      commitSplitFrame()
      units.push({ obus: [obu], spatialId: obu.spatialId, temporalId: obu.temporalId })
    } else if (obu.type === av1ObuType.frameHeader) {
      commitSplitFrame()
      splitFrame = [obu]
    } else if (obu.type === av1ObuType.tileGroup) {
      const header = splitFrame?.[0]
      if (!splitFrame || !header) {
        throw invalidInput('AV1 tile-group OBU has no preceding frame header')
      }
      if (obu.spatialId !== header.spatialId || obu.temporalId !== header.temporalId) {
        throw invalidInput('AV1 tile-group OBU does not match its frame-header layer')
      }
      splitFrame.push(obu)
    } else if (obu.type === av1ObuType.temporalDelimiter) {
      commitSplitFrame()
    }
  }
  commitSplitFrame()
  return units
}

const obuBelongsToOperatingPoint = (
  obu: Pick<Av1Obu, 'spatialId' | 'temporalId'>,
  operatingPointIdc: number,
): boolean =>
  operatingPointIdc === 0 ||
  (((operatingPointIdc >>> obu.temporalId) & 1) !== 0 &&
    ((operatingPointIdc >>> (obu.spatialId + 8)) & 1) !== 0)

const validateLayerIndexing = (
  coded: AvifCodedImageInspection,
  units: readonly Av1FrameUnit[],
): void => {
  if (!coded.layerSizes) return
  const boundaries: number[] = []
  let end = 0
  for (const size of coded.layerSizes) {
    end = checkedAdd(end, size, `AVIF item ${coded.itemId} a1lx layer sizes overflow`)
    boundaries.push(end)
  }
  boundaries.push(coded.payloadBytes)
  let start = 0
  for (const boundary of boundaries) {
    const layerUnits = units.filter((unit) => {
      const first = unit.obus[0]
      const last = unit.obus[unit.obus.length - 1]
      if (!first || !last) return false
      return first.offset >= start && last.offset + last.totalBytes <= boundary
    })
    if (layerUnits.length !== 1) {
      throw invalidInput(`AVIF item ${coded.itemId} a1lx range does not contain one complete frame`)
    }
    start = boundary
  }
  if (boundaries.length !== units.length) {
    throw invalidInput(`AVIF item ${coded.itemId} a1lx layer count does not match its AV1 frames`)
  }
}

const selectCodedImageFrameObus = (coded: AvifCodedImageInspection): readonly Av1Obu[] => {
  const operatingPointIndex = coded.operatingPointIndex ?? 0
  const operatingPoint = coded.sequence.operatingPoints[operatingPointIndex]
  if (!operatingPoint) {
    throw invalidInput(`AVIF item ${coded.itemId} selects a missing AV1 operating point`)
  }
  const units = av1FrameUnits(coded.obus)
  if (units.length === 0) {
    throw unsupportedOperation(
      'AVIF decode requires one complete AV1 frame OBU or one frame-header OBU followed by tile groups',
    )
  }
  validateLayerIndexing(coded, units)
  const eligible = units.filter((unit) => obuBelongsToOperatingPoint(unit, operatingPoint.idc))
  if (eligible.length === 0) {
    throw invalidInput(`AVIF item ${coded.itemId} has no frame in its selected operating point`)
  }
  const selectedSpatialId =
    coded.layerSelector === undefined || coded.layerSelector === 0xffff
      ? Math.max(...eligible.map((unit) => unit.spatialId))
      : coded.layerSelector
  const selected = eligible.filter((unit) => unit.spatialId === selectedSpatialId).at(-1)
  if (!selected) {
    throw invalidInput(
      `AVIF item ${coded.itemId} has no output frame for selected spatial layer ${selectedSpatialId}`,
    )
  }
  const frameHeaderObu = selected.obus.find(
    (obu) => obu.type === av1ObuType.frame || obu.type === av1ObuType.frameHeader,
  )
  if (!frameHeaderObu) {
    throw invalidInput(`AVIF item ${coded.itemId} selected frame has no frame header`)
  }
  const frameHeader = inspectAv1FrameHeader(coded.sequence, frameHeaderObu.payload)
  if (frameHeader.kind === 'show-existing') {
    throw unsupportedOperation('AV1 show-existing-frame decode is not supported')
  }
  if (frameHeader.kind === 'inter' || frameHeader.kind === 'switch') {
    const dependsOnLowerSpatialLayer = eligible.some((unit) => unit.spatialId < selectedSpatialId)
    throw unsupportedOperation(
      dependsOnLowerSpatialLayer
        ? `AVIF dependent AV1 spatial enhancement layer ${selectedSpatialId} decode is not supported`
        : `AV1 ${frameHeader.kind} frame decode is not supported`,
    )
  }
  return selected.obus
}

const parseCodedImageFrame = (coded: AvifCodedImageInspection, limits: ImageLimits): Av1Frame => {
  validateImageDimensions(coded.width, coded.height, 1, limits)
  const frame = parseAv1FrameObus(coded.sequence, selectCodedImageFrameObus(coded))
  validateAvifFrameDimensions(coded, frame)
  return frame
}

const decodeCodedImage = (coded: AvifCodedImageInspection, limits: ImageLimits): Av1DecodedFrame =>
  decodeRestrictedAv1Intra(coded.sequence, parseCodedImageFrame(coded, limits))

class AvifRowDecoder implements ImageDecoder {
  readonly width: number
  readonly height: number
  readonly pixelFormat = 'rgba8' as const
  readonly capabilities: ImageDecoder['capabilities']
  readonly #coded: AvifCodedImageInspection
  readonly #color: NclxColor | undefined
  readonly #displayRegion: PixelRegion
  readonly #frame: Av1Frame
  readonly #toneMap: NclxHdrToneMap | undefined

  constructor(
    coded: AvifCodedImageInspection,
    frame: Av1Frame,
    displayRegion: PixelRegion,
    color: NclxColor | undefined,
    toneMap?: NclxHdrToneMap,
  ) {
    const scaledDecode =
      displayRegion.x === 0 &&
      displayRegion.y === 0 &&
      displayRegion.width === frame.header.upscaledWidth &&
      displayRegion.height === frame.header.frameHeight
    this.capabilities = Object.freeze({
      sequential: true,
      regionDecode: false,
      scaledDecode,
      progressive: false,
    })
    this.width = displayRegion.width
    this.height = displayRegion.height
    this.#coded = coded
    this.#frame = frame
    this.#displayRegion = displayRegion
    this.#color = color
    this.#toneMap = toneMap
  }

  async *decode(request: DecodeRequest = {}): AsyncGenerator<PixelBlock> {
    const scale = decodeScaleDenominator(request)
    if (scale !== 1 && !this.capabilities.scaledDecode) {
      throw unsupportedOperation('Scaled AVIF decode requires a full coded image aperture')
    }
    const scaledWidth = Math.ceil(this.width / scale)
    const scaledHeight = Math.ceil(this.height / scale)
    const region = decodeRegion(scaledWidth, scaledHeight, request)
    const sourceX = this.#displayRegion.x + region.x * scale
    const sourceY = this.#displayRegion.y + region.y * scale
    for (const band of decodeRestrictedAv1IntraRows(this.#coded.sequence, this.#frame)) {
      const range = scaledBandRange(sourceY, region.height, scale, band.y, band.height)
      for (let outputY = range.start; outputY < range.end; outputY += 32) {
        const blockHeight = Math.min(32, range.end - outputY)
        yield {
          x: 0,
          y: outputY,
          width: region.width,
          height: blockHeight,
          stride: region.width * 4,
          format: this.pixelFormat,
          data: av1ToRgbaRegion(
            this.#coded.sequence,
            band.frame,
            {
              x: sourceX,
              y: sourceY + outputY * scale,
              width: region.width,
              height: blockHeight,
            },
            this.#color,
            scale,
            this.#toneMap,
          ),
        }
      }
    }
  }
}

const unpremultiplyRgba = (pixels: Uint8Array): void => {
  for (let offset = 0; offset < pixels.byteLength; offset += 4) {
    const alpha = pixels[offset + 3] ?? 0
    if (alpha === 255) continue
    if (alpha === 0) {
      pixels[offset] = 0
      pixels[offset + 1] = 0
      pixels[offset + 2] = 0
      continue
    }
    pixels[offset] = Math.min(255, Math.round(((pixels[offset] ?? 0) * 255) / alpha))
    pixels[offset + 1] = Math.min(255, Math.round(((pixels[offset + 1] ?? 0) * 255) / alpha))
    pixels[offset + 2] = Math.min(255, Math.round(((pixels[offset + 2] ?? 0) * 255) / alpha))
  }
}

const validateAlphaCoding = (
  width: number,
  height: number,
  alpha: AvifCodedImageInspection,
): void => {
  if (!alpha.sequence.monochrome || alpha.sequence.chromaSubsampling !== '400') {
    throw unsupportedOperation('AVIF alpha must use a monochrome AV1 sequence')
  }
  if (alpha.width !== width || alpha.height !== height) {
    throw invalidInput('AVIF alpha dimensions do not align with the color item')
  }
}

const validateAlphaFrame = (width: number, height: number, alpha: AvifAlphaFrame): void => {
  validateAlphaCoding(width, height, alpha.coded)
  if (alpha.frame.width !== alpha.coded.width || alpha.frame.height !== alpha.coded.height) {
    throw invalidInput('AVIF alpha frame dimensions do not match its coded item')
  }
}

const applyAlphaRegion = (
  pixels: Uint8Array,
  region: PixelRegion,
  alpha: AvifAlphaFrame,
  premultiplied: boolean,
  scaleDenominator: 1 | 2 | 4 | 8 = 1,
): void => {
  const storageHeight = Math.floor(alpha.frame.y.length / alpha.frame.yStride)
  const sampleShift = alpha.coded.sequence.bitDepth - 8
  const alphaMinimum = alpha.coded.sequence.fullRange ? 0 : 16 * 2 ** sampleShift
  const alphaRange = alpha.coded.sequence.fullRange
    ? 2 ** alpha.coded.sequence.bitDepth - 1
    : 219 * 2 ** sampleShift
  const directSamples = alphaMinimum === 0 && alphaRange === 255
  for (let localY = 0; localY < region.height; localY += 1) {
    const y = region.y + localY * scaleDenominator
    for (let localX = 0; localX < region.width; localX += 1) {
      const sourceX = region.x + localX * scaleDenominator
      const sourceY = y
      const storageY = sourceY - (alpha.frame.yOrigin ?? 0)
      let sample = 0
      if (scaleDenominator === 1) {
        sample =
          storageY < 0 || storageY >= storageHeight
            ? 0
            : (alpha.frame.y[storageY * alpha.frame.yStride + sourceX] ?? 0)
      } else {
        for (let deltaY = 0; deltaY < scaleDenominator; deltaY += 1) {
          const sampleY =
            Math.min(alpha.frame.height - 1, sourceY + deltaY) - (alpha.frame.yOrigin ?? 0)
          for (let deltaX = 0; deltaX < scaleDenominator; deltaX += 1) {
            const sampleX = Math.min(alpha.frame.width - 1, sourceX + deltaX)
            sample +=
              sampleY < 0 || sampleY >= storageHeight
                ? 0
                : (alpha.frame.y[sampleY * alpha.frame.yStride + sampleX] ?? 0)
          }
        }
        sample = Math.round(sample / (scaleDenominator * scaleDenominator))
      }
      pixels[(localY * region.width + localX) * 4 + 3] = directSamples
        ? sample
        : Math.max(0, Math.min(255, Math.round(((sample - alphaMinimum) * 255) / alphaRange)))
    }
  }
  if (premultiplied) unpremultiplyRgba(pixels)
}

class AvifAlphaRowDecoder implements ImageDecoder {
  readonly width: number
  readonly height: number
  readonly pixelFormat = 'rgba8' as const
  readonly capabilities: ImageDecoder['capabilities']
  readonly #alphaCoded: AvifCodedImageInspection
  readonly #alphaFrame: Av1Frame
  readonly #coded: AvifCodedImageInspection
  readonly #color: NclxColor | undefined
  readonly #displayRegion: PixelRegion
  readonly #frame: Av1Frame
  readonly #premultipliedAlpha: boolean
  readonly #toneMap: NclxHdrToneMap | undefined

  constructor(
    coded: AvifCodedImageInspection,
    frame: Av1Frame,
    displayRegion: PixelRegion,
    color: NclxColor | undefined,
    alphaCoded: AvifCodedImageInspection,
    alphaFrame: Av1Frame,
    premultipliedAlpha: boolean,
    toneMap?: NclxHdrToneMap,
  ) {
    const scaledDecode =
      displayRegion.x === 0 &&
      displayRegion.y === 0 &&
      displayRegion.width === frame.header.frameWidth &&
      displayRegion.height === frame.header.frameHeight
    this.capabilities = Object.freeze({
      sequential: true,
      regionDecode: false,
      scaledDecode,
      progressive: false,
    })
    this.width = displayRegion.width
    this.height = displayRegion.height
    this.#coded = coded
    this.#frame = frame
    this.#displayRegion = displayRegion
    this.#color = color
    this.#alphaCoded = alphaCoded
    this.#alphaFrame = alphaFrame
    this.#premultipliedAlpha = premultipliedAlpha
    this.#toneMap = toneMap
  }

  async *decode(request: DecodeRequest = {}): AsyncGenerator<PixelBlock> {
    const scale = decodeScaleDenominator(request)
    const scaledWidth = Math.ceil(this.width / scale)
    const scaledHeight = Math.ceil(this.height / scale)
    if (scale !== 1 && !this.capabilities.scaledDecode) {
      throw unsupportedOperation('Scaled AVIF decode requires a full coded image aperture')
    }
    const region = decodeRegion(scaledWidth, scaledHeight, request)
    const sourceX = this.#displayRegion.x + region.x * scale
    const sourceY = this.#displayRegion.y + region.y * scale
    const alphaBands = decodeRestrictedAv1IntraRows(this.#alphaCoded.sequence, this.#alphaFrame)[
      Symbol.iterator
    ]()
    let alphaBand = alphaBands.next()
    for (const colorBand of decodeRestrictedAv1IntraRows(this.#coded.sequence, this.#frame)) {
      const range = scaledBandRange(sourceY, region.height, scale, colorBand.y, colorBand.height)
      for (let outputY = range.start; outputY < range.end; outputY += 32) {
        const blockHeight = Math.min(32, range.end - outputY)
        const blockSourceY = sourceY + outputY * scale
        const blockSourceEndY = blockSourceY + (blockHeight - 1) * scale
        while (!alphaBand.done && blockSourceY >= alphaBand.value.y + alphaBand.value.height) {
          alphaBand = alphaBands.next()
        }
        if (
          alphaBand.done ||
          blockSourceY < alphaBand.value.y ||
          blockSourceEndY >= alphaBand.value.y + alphaBand.value.height
        ) {
          throw invalidInput('AVIF alpha row bands do not align with the color item')
        }
        const data = av1ToRgbaRegion(
          this.#coded.sequence,
          colorBand.frame,
          {
            x: sourceX,
            y: blockSourceY,
            width: region.width,
            height: blockHeight,
          },
          this.#color,
          scale,
          this.#toneMap,
        )
        applyAlphaRegion(
          data,
          { x: sourceX, y: blockSourceY, width: region.width, height: blockHeight },
          { coded: this.#alphaCoded, frame: alphaBand.value.frame },
          this.#premultipliedAlpha,
          scale,
        )
        yield {
          x: 0,
          y: outputY,
          width: region.width,
          height: blockHeight,
          stride: region.width * 4,
          format: this.pixelFormat,
          data,
        }
      }
    }
  }
}
interface AvifGridDecoderSource {
  readonly alphaAssociations: readonly AvifAlphaAssociation[]
  readonly codedImages: readonly AvifCodedImageInspection[]
  readonly color: NclxColor | undefined
  readonly mirroring: number
  readonly displayRegion: PixelRegion
  readonly grid: AvifGridDescription
  readonly itemIds: readonly number[]
  readonly rotation: number
  readonly premultipliedAlpha: boolean
  readonly toneMap?: NclxHdrToneMap
}

class AvifGridDecoder implements ImageDecoder {
  readonly width: number
  readonly height: number
  readonly pixelFormat = 'rgba8' as const
  readonly capabilities = Object.freeze({
    sequential: true,
    regionDecode: false,
    scaledDecode: false,
    progressive: false,
  })
  readonly estimatedWorkingBytes: number
  readonly #alphaTiles: readonly (AvifCodedImageInspection | undefined)[]
  readonly #color: NclxColor | undefined
  readonly #displayRegion: PixelRegion
  readonly #grid: NonNullable<AvifBitstreamInspection['grid']>
  readonly #limits: ImageLimits
  readonly #premultipliedAlpha: boolean
  readonly #tileHeight: number
  readonly #tiles: readonly AvifCodedImageInspection[]
  readonly #tileWidth: number
  readonly #toneMap: NclxHdrToneMap | undefined

  constructor(source: AvifGridDecoderSource, limits: ImageLimits) {
    const grid = source.grid
    if (source.itemIds.length !== grid.rows * grid.columns) {
      throw invalidInput('AVIF grid item count does not match its dimensions')
    }
    const tiles = source.itemIds.map((itemId) => {
      const coded = source.codedImages.find((image) => image.itemId === itemId)
      if (!coded) throw invalidInput(`AVIF grid tile ${itemId} is not coded`)
      if (coded.rotation !== source.rotation || coded.mirroring !== source.mirroring) {
        throw unsupportedOperation(
          'Phase B2 does not support independently transformed AVIF grid tiles',
        )
      }
      return coded
    })
    const alphaTiles = source.itemIds.map((colorItemId) => {
      const association = source.alphaAssociations.find(
        (candidate) => candidate.colorItemId === colorItemId,
      )
      if (!association) return undefined
      const alpha = source.codedImages.find(
        (image) => image.itemId === association.alphaItemId && image.role === 'alpha',
      )
      if (!alpha) throw invalidInput(`AVIF grid alpha tile ${association.alphaItemId} is not coded`)
      return alpha
    })
    const first = tiles[0]
    if (!first) throw invalidInput('AVIF grid has no coded tiles')
    for (const tile of tiles) {
      if (tile.width !== first.width || tile.height !== first.height) {
        throw invalidInput('AVIF grid tiles have inconsistent dimensions')
      }
    }
    for (let index = 0; index < tiles.length; index += 1) {
      const alpha = alphaTiles[index]
      if (alpha) validateAlphaCoding(first.width, first.height, alpha)
    }
    if (
      grid.width <= (grid.columns - 1) * first.width ||
      grid.width > grid.columns * first.width ||
      grid.height <= (grid.rows - 1) * first.height ||
      grid.height > grid.rows * first.height
    ) {
      throw invalidInput('AVIF grid output dimensions do not match its tile geometry')
    }
    let payloadBytes = 0
    for (let index = 0; index < tiles.length; index += 1) {
      payloadBytes += tiles[index]?.payloadBytes ?? 0
      payloadBytes += alphaTiles[index]?.payloadBytes ?? 0
    }
    let maximumWorkingBytes = 0
    for (let row = 0; row < grid.rows; row += 1) {
      let workingBytes = payloadBytes + source.displayRegion.width * Math.min(32, grid.height) * 4
      for (let column = 0; column < grid.columns; column += 1) {
        const tile = tiles[row * grid.columns + column]
        if (!tile) throw invalidInput('AVIF grid tile layout is incomplete')
        const frame = parseCodedImageFrame(tile, limits)
        workingBytes += estimateRestrictedAv1WorkingBytes(tile.sequence, frame)
        const alpha = alphaTiles[row * grid.columns + column]
        if (alpha) {
          const alphaFrame = parseCodedImageFrame(alpha, limits)
          workingBytes += estimateRestrictedAv1WorkingBytes(alpha.sequence, alphaFrame)
        }
      }
      maximumWorkingBytes = Math.max(maximumWorkingBytes, workingBytes)
    }
    validateAvifWorkingBytes(maximumWorkingBytes)
    this.estimatedWorkingBytes = maximumWorkingBytes
    this.#alphaTiles = alphaTiles
    this.width = source.displayRegion.width
    this.height = source.displayRegion.height
    this.#color = source.color
    this.#displayRegion = source.displayRegion
    this.#grid = grid
    this.#limits = limits
    this.#premultipliedAlpha = source.premultipliedAlpha
    this.#tileHeight = first.height
    this.#tiles = tiles
    this.#tileWidth = first.width
    this.#toneMap = source.toneMap
  }

  async *decode(request: DecodeRequest = {}): AsyncGenerator<PixelBlock> {
    const region = decodeRegion(this.width, this.height, request)
    const sourceX = this.#displayRegion.x + region.x
    const sourceY = this.#displayRegion.y + region.y
    const sourceRight = sourceX + region.width
    const sourceBottom = sourceY + region.height
    const firstColumn = Math.floor(sourceX / this.#tileWidth)
    const lastColumn = Math.floor((sourceRight - 1) / this.#tileWidth)
    const firstRow = Math.floor(sourceY / this.#tileHeight)
    const lastRow = Math.floor((sourceBottom - 1) / this.#tileHeight)
    const rowsPerBlock = 32
    for (let tileRow = firstRow; tileRow <= lastRow; tileRow += 1) {
      const decodedTiles: Av1DecodedFrame[] = []
      const decodedAlphaTiles: (Av1DecodedFrame | undefined)[] = []
      for (let column = firstColumn; column <= lastColumn; column += 1) {
        const coded = this.#tiles[tileRow * this.#grid.columns + column]
        if (!coded) throw invalidInput('AVIF grid tile layout is incomplete')
        decodedTiles.push(decodeCodedImage(coded, this.#limits))
        const alphaCoded = this.#alphaTiles[tileRow * this.#grid.columns + column]
        decodedAlphaTiles.push(alphaCoded ? decodeCodedImage(alphaCoded, this.#limits) : undefined)
      }
      const rowStart = Math.max(sourceY, tileRow * this.#tileHeight)
      const rowEnd = Math.min(sourceBottom, (tileRow + 1) * this.#tileHeight)
      for (let blockY = rowStart; blockY < rowEnd; blockY += rowsPerBlock) {
        const blockHeight = Math.min(rowsPerBlock, rowEnd - blockY)
        const stride = region.width * 4
        const data = new Uint8Array(stride * blockHeight)
        for (let column = firstColumn; column <= lastColumn; column += 1) {
          const coded = this.#tiles[tileRow * this.#grid.columns + column]
          const frame = decodedTiles[column - firstColumn]
          if (!coded || !frame) throw invalidInput('AVIF grid tile layout is incomplete')
          const alphaCoded = this.#alphaTiles[tileRow * this.#grid.columns + column]
          const alphaFrame = decodedAlphaTiles[column - firstColumn]
          const tileStart = column * this.#tileWidth
          const copyStart = Math.max(sourceX, tileStart)
          const copyEnd = Math.min(sourceRight, tileStart + this.#tileWidth)
          const copyWidth = copyEnd - copyStart
          const tile = av1ToRgbaRegion(
            coded.sequence,
            frame,
            {
              x: copyStart - tileStart,
              y: blockY - tileRow * this.#tileHeight,
              width: copyWidth,
              height: blockHeight,
            },
            this.#color,
            1,
            this.#toneMap,
          )
          if (alphaCoded && alphaFrame) {
            applyAlphaRegion(
              tile,
              {
                x: copyStart - tileStart,
                y: blockY - tileRow * this.#tileHeight,
                width: copyWidth,
                height: blockHeight,
              },
              { coded: alphaCoded, frame: alphaFrame },
              this.#premultipliedAlpha,
            )
          }
          const outputX = copyStart - sourceX
          for (let localY = 0; localY < blockHeight; localY += 1) {
            const sourceOffset = localY * copyWidth * 4
            const targetOffset = localY * stride + outputX * 4
            data.set(tile.subarray(sourceOffset, sourceOffset + copyWidth * 4), targetOffset)
          }
        }
        yield {
          x: 0,
          y: blockY - sourceY,
          width: region.width,
          height: blockHeight,
          stride,
          format: this.pixelFormat,
          data,
        }
      }
    }
  }
}

const bilinearSourceCoordinate = (target: number, sourceSize: number, targetSize: number): number =>
  Math.max(0, Math.min(sourceSize - 1, ((target + 0.5) * sourceSize) / targetSize - 0.5))

class AvifGainMapScaleDecoder implements ImageDecoder {
  readonly width: number
  readonly height: number
  readonly pixelFormat = 'rgba8' as const
  readonly capabilities = Object.freeze({
    sequential: true,
    regionDecode: false,
    scaledDecode: false,
    progressive: false,
  })
  readonly #source: ImageDecoder

  constructor(source: ImageDecoder, width: number, height: number) {
    if (source.width > width || source.height > height) {
      throw unsupportedOperation('AVIF gain-map downsampling is not supported')
    }
    this.#source = source
    this.width = width
    this.height = height
  }

  async *decode(request: DecodeRequest = {}): AsyncGenerator<PixelBlock> {
    if (decodeScaleDenominator(request) !== 1) {
      throw unsupportedOperation('Scaled AVIF gain-map decode is not supported')
    }
    const region = decodeRegion(this.width, this.height, request)
    const x0 = new Int32Array(region.width)
    const x1 = new Int32Array(region.width)
    const xWeight = new Uint16Array(region.width)
    let sourceLeft = this.#source.width
    let sourceRight = 0
    for (let x = 0; x < region.width; x += 1) {
      const coordinate = bilinearSourceCoordinate(region.x + x, this.#source.width, this.width)
      const first = Math.floor(coordinate)
      const second = Math.min(this.#source.width - 1, first + 1)
      x0[x] = first
      x1[x] = second
      xWeight[x] = Math.round((coordinate - first) * 256)
      sourceLeft = Math.min(sourceLeft, first)
      sourceRight = Math.max(sourceRight, second + 1)
    }
    const firstY = Math.floor(bilinearSourceCoordinate(region.y, this.#source.height, this.height))
    const lastY = Math.min(
      this.#source.height - 1,
      Math.floor(
        bilinearSourceCoordinate(region.y + region.height - 1, this.#source.height, this.height),
      ) + 1,
    )
    const sourceWidth = sourceRight - sourceLeft
    const sourceRows = [new Uint8Array(sourceWidth * 4), new Uint8Array(sourceWidth * 4)] as const
    const sourceRowY = new Int32Array([-1, -1])
    let nextSourceSlot: 0 | 1 = 0
    let outputY = 0
    let blockY = 0
    let blockRows = 0
    let output = new Uint8Array(region.width * Math.min(32, region.height) * 4)
    const source = this.#source.decode({
      x: sourceLeft,
      y: firstY,
      width: sourceWidth,
      height: lastY - firstY + 1,
    })
    for await (const block of source) {
      if (
        block.x !== 0 ||
        block.width !== sourceWidth ||
        block.stride < sourceWidth * 4 ||
        block.format !== 'rgba8'
      ) {
        throw invalidInput('AVIF gain-map resampling source rows are invalid')
      }
      for (let localY = 0; localY < block.height; localY += 1) {
        const sourceY = firstY + block.y + localY
        const slot = nextSourceSlot
        sourceRows[slot].set(
          block.data.subarray(localY * block.stride, localY * block.stride + sourceWidth * 4),
        )
        sourceRowY[slot] = sourceY
        nextSourceSlot = nextSourceSlot === 0 ? 1 : 0
        while (outputY < region.height) {
          const coordinate = bilinearSourceCoordinate(
            region.y + outputY,
            this.#source.height,
            this.height,
          )
          const y0 = Math.floor(coordinate)
          const y1 = Math.min(this.#source.height - 1, y0 + 1)
          if (y1 > sourceY) break
          const firstSlot: 0 | 1 | undefined =
            sourceRowY[0] === y0 ? 0 : sourceRowY[1] === y0 ? 1 : undefined
          const secondSlot: 0 | 1 | undefined =
            sourceRowY[0] === y1 ? 0 : sourceRowY[1] === y1 ? 1 : undefined
          if (firstSlot === undefined || secondSlot === undefined) {
            throw invalidInput('AVIF gain-map resampling rows are not contiguous')
          }
          const yWeight = Math.round((coordinate - y0) * 256)
          const firstRow = sourceRows[firstSlot]
          const secondRow = sourceRows[secondSlot]
          const targetRow = blockRows * region.width * 4
          for (let x = 0; x < region.width; x += 1) {
            const firstX = ((x0[x] ?? 0) - sourceLeft) * 4
            const secondX = ((x1[x] ?? 0) - sourceLeft) * 4
            const horizontalWeight = xWeight[x] ?? 0
            const target = targetRow + x * 4
            for (let channel = 0; channel < 4; channel += 1) {
              const top =
                ((firstRow[firstX + channel] ?? 0) * (256 - horizontalWeight) +
                  (firstRow[secondX + channel] ?? 0) * horizontalWeight +
                  128) >>
                8
              const bottom =
                ((secondRow[firstX + channel] ?? 0) * (256 - horizontalWeight) +
                  (secondRow[secondX + channel] ?? 0) * horizontalWeight +
                  128) >>
                8
              output[target + channel] = (top * (256 - yWeight) + bottom * yWeight + 128) >> 8
            }
          }
          outputY += 1
          blockRows += 1
          if (blockRows === 32) {
            yield {
              x: 0,
              y: blockY,
              width: region.width,
              height: blockRows,
              stride: region.width * 4,
              format: this.pixelFormat,
              data: output,
            }
            blockY += blockRows
            blockRows = 0
            output = new Uint8Array(region.width * Math.min(32, region.height - outputY) * 4)
          }
        }
      }
    }
    if (outputY !== region.height) {
      throw invalidInput('AVIF gain-map resampling source ended before its output')
    }
    if (blockRows > 0) {
      yield {
        x: 0,
        y: blockY,
        width: region.width,
        height: blockRows,
        stride: region.width * 4,
        format: this.pixelFormat,
        data: output,
      }
    }
  }
}

const alignedRgbaBlocks = async function* (
  blocks: AsyncIterable<PixelBlock>,
  width: number,
): AsyncGenerator<PixelBlock> {
  let expectedY = 0
  let blockY = 0
  let rows = 0
  let output = new Uint8Array(width * 32 * 4)
  for await (const block of blocks) {
    if (
      block.x !== 0 ||
      block.y !== expectedY ||
      block.width !== width ||
      block.stride < width * 4 ||
      block.format !== 'rgba8'
    ) {
      throw invalidInput('AVIF gain-map rows are not contiguous')
    }
    for (let sourceY = 0; sourceY < block.height; sourceY += 1) {
      output.set(
        block.data.subarray(sourceY * block.stride, sourceY * block.stride + width * 4),
        rows * width * 4,
      )
      rows += 1
      expectedY += 1
      if (rows === 32) {
        yield {
          x: 0,
          y: blockY,
          width,
          height: rows,
          stride: width * 4,
          format: 'rgba8',
          data: output,
        }
        blockY += rows
        rows = 0
        output = new Uint8Array(width * 32 * 4)
      }
    }
  }
  if (rows > 0) {
    yield {
      x: 0,
      y: blockY,
      width,
      height: rows,
      stride: width * 4,
      format: 'rgba8',
      data: output.subarray(0, rows * width * 4),
    }
  }
}

const GAIN_MAP_SRGB_LUT_STEPS = 4095

class AvifGainMapDecoder implements ImageDecoder {
  readonly width: number
  readonly height: number
  readonly pixelFormat = 'rgba8' as const
  readonly capabilities: ImageDecoder['capabilities']
  readonly #alternateOffset: Float64Array
  readonly #base: ImageDecoder
  readonly #baseLinear: Float64Array
  readonly #baseOffset: Float64Array
  readonly #gainMap: ImageDecoder
  readonly #gainMultiplier: Float64Array
  readonly #linearToSrgb: Uint8Array

  constructor(
    base: ImageDecoder,
    gainMap: ImageDecoder,
    baseColor: NclxColor,
    alternateColor: NclxColor,
    metadata: AvifGainMapMetadata,
  ) {
    const scaledGainMap =
      base.width === gainMap.width && base.height === gainMap.height
        ? gainMap
        : new AvifGainMapScaleDecoder(gainMap, base.width, base.height)
    if (
      (baseColor.primaries !== 1 && baseColor.primaries !== 2) ||
      alternateColor.primaries !== 1 ||
      alternateColor.transferCharacteristics !== 13
    ) {
      throw unsupportedOperation(
        'AVIF gain-map SDR decode currently requires sRGB alternate color primaries',
      )
    }
    this.width = base.width
    this.height = base.height
    this.capabilities = Object.freeze({ ...base.capabilities, scaledDecode: false })
    this.#base = base
    this.#gainMap = scaledGainMap
    this.#baseLinear = Float64Array.from({ length: 256 }, (_, value) =>
      nclxToLinear(baseColor.transferCharacteristics, value / 255),
    )
    this.#baseOffset = Float64Array.from(metadata.baseOffset, rationalValue)
    this.#alternateOffset = Float64Array.from(metadata.alternateOffset, rationalValue)
    const weight = gainMapWeight(metadata)
    this.#gainMultiplier = new Float64Array(3 * 256)
    for (let channel = 0; channel < 3; channel += 1) {
      const minimum = rationalValue(metadata.gainMapMin[channel] ?? metadata.gainMapMin[0])
      const maximum = rationalValue(metadata.gainMapMax[channel] ?? metadata.gainMapMax[0])
      const gammaInverse =
        1 / rationalValue(metadata.gainMapGamma[channel] ?? metadata.gainMapGamma[0])
      for (let value = 0; value < 256; value += 1) {
        const gainLog = minimum + (maximum - minimum) * (value / 255) ** gammaInverse
        this.#gainMultiplier[channel * 256 + value] = 2 ** (gainLog * weight)
      }
    }
    this.#linearToSrgb = Uint8Array.from({ length: GAIN_MAP_SRGB_LUT_STEPS + 1 }, (_, value) =>
      Math.max(0, Math.min(255, Math.round(linearToSrgb(value / GAIN_MAP_SRGB_LUT_STEPS) * 255))),
    )
  }

  async *decode(request: DecodeRequest = {}): AsyncGenerator<PixelBlock> {
    if (decodeScaleDenominator(request) !== 1) {
      throw unsupportedOperation('Scaled AVIF gain-map decode is not supported')
    }
    const region = decodeRegion(this.width, this.height, request)
    const baseIterator = alignedRgbaBlocks(this.#base.decode(request), region.width)[
      Symbol.asyncIterator
    ]()
    const gainMapIterator = alignedRgbaBlocks(this.#gainMap.decode(request), region.width)[
      Symbol.asyncIterator
    ]()
    try {
      while (true) {
        const [baseResult, gainMapResult] = await Promise.all([
          baseIterator.next(),
          gainMapIterator.next(),
        ])
        if (baseResult.done || gainMapResult.done) {
          if (baseResult.done !== gainMapResult.done) {
            throw invalidInput('AVIF gain-map rows do not align with the base image')
          }
          return
        }
        const baseBlock = baseResult.value
        const gainMapBlock = gainMapResult.value
        if (
          baseBlock.x !== gainMapBlock.x ||
          baseBlock.y !== gainMapBlock.y ||
          baseBlock.width !== gainMapBlock.width ||
          baseBlock.height !== gainMapBlock.height ||
          baseBlock.stride !== gainMapBlock.stride ||
          baseBlock.format !== 'rgba8' ||
          gainMapBlock.format !== 'rgba8'
        ) {
          throw invalidInput('AVIF gain-map rows do not align with the base image')
        }
        for (let offset = 0; offset < baseBlock.data.byteLength; offset += 4) {
          for (let channel = 0; channel < 3; channel += 1) {
            const baseEncoded = baseBlock.data[offset + channel] ?? 0
            const gainEncoded = gainMapBlock.data[offset + channel] ?? 0
            const alternateLinear =
              ((this.#baseLinear[baseEncoded] ?? 0) + (this.#baseOffset[channel] ?? 0)) *
                (this.#gainMultiplier[channel * 256 + gainEncoded] ?? 1) -
              (this.#alternateOffset[channel] ?? 0)
            const encodedIndex = Math.max(
              0,
              Math.min(
                GAIN_MAP_SRGB_LUT_STEPS,
                Math.round(alternateLinear * GAIN_MAP_SRGB_LUT_STEPS),
              ),
            )
            baseBlock.data[offset + channel] = this.#linearToSrgb[encodedIndex] ?? 0
          }
        }
        yield baseBlock
      }
    } finally {
      await baseIterator.return?.(undefined)
      await gainMapIterator.return?.(undefined)
    }
  }
}
interface AvifDecoderWorkingSet {
  readonly decoder: ImageDecoder
  readonly workingBytes: number
}

const decodedFrameBytes = (frame: Av1DecodedFrame): number =>
  frame.y.byteLength + frame.u.byteLength + frame.v.byteLength

const createCodedAvifDecoder = (
  coded: AvifCodedImageInspection,
  displayRegion: PixelRegion,
  color: NclxColor | undefined,
  limits: ImageLimits,
  toneMap?: NclxHdrToneMap,
): AvifDecoderWorkingSet => {
  const frame = parseCodedImageFrame(coded, limits)
  if (supportsRestrictedAv1IntraRows(frame)) {
    const workingBytes =
      coded.payloadBytes + estimateRestrictedAv1RowWorkingBytes(coded.sequence, frame)
    validateAvifWorkingBytes(workingBytes)
    return {
      decoder: new AvifRowDecoder(coded, frame, displayRegion, color, toneMap),
      workingBytes,
    }
  }
  validateAvifWorkingBytes(
    coded.payloadBytes + estimateRestrictedAv1WorkingBytes(coded.sequence, frame),
  )
  const decoded = decodeRestrictedAv1Intra(coded.sequence, frame)
  return {
    decoder: new AvifFrameDecoder(coded, decoded, displayRegion, color, undefined, false, toneMap),
    workingBytes:
      coded.payloadBytes +
      decodedFrameBytes(decoded) +
      displayRegion.width * Math.min(32, displayRegion.height) * 4,
  }
}

const createSingleAvifDecoder = (
  inspection: AvifBitstreamInspection,
  limits: ImageLimits,
  toneMap?: NclxHdrToneMap,
): AvifDecoderWorkingSet => {
  if (inspection.colorItemIds.length !== 1) {
    throw invalidInput('Single-image AVIF has an invalid color item count')
  }
  const coded = inspection.codedImages.find(
    (image) => image.itemId === inspection.primaryItemId && image.role === 'color',
  )
  if (!coded) throw invalidInput('AVIF has no coded primary color item')
  const parsedFrame = parseCodedImageFrame(coded, limits)
  let alpha: AvifCodedImageInspection | undefined
  let parsedAlphaFrame: Av1Frame | undefined
  if (inspection.alphaItemId !== undefined) {
    alpha = inspection.codedImages.find(
      (image) => image.itemId === inspection.alphaItemId && image.role === 'alpha',
    )
    if (!alpha) throw invalidInput('AVIF alpha auxiliary item is not coded')
    parsedAlphaFrame = parseCodedImageFrame(alpha, limits)
    validateAlphaCoding(coded.width, coded.height, alpha)
  }
  const colorRowsSupported = supportsRestrictedAv1IntraRows(parsedFrame)
  const alphaRowsSupported =
    !alpha || (!!parsedAlphaFrame && supportsRestrictedAv1IntraRows(parsedAlphaFrame))
  if (colorRowsSupported && alphaRowsSupported) {
    let workingBytes =
      coded.payloadBytes + estimateRestrictedAv1RowWorkingBytes(coded.sequence, parsedFrame)
    if (alpha && parsedAlphaFrame) {
      workingBytes +=
        alpha.payloadBytes + estimateRestrictedAv1RowWorkingBytes(alpha.sequence, parsedAlphaFrame)
    }
    validateAvifWorkingBytes(workingBytes)
    return {
      decoder:
        alpha && parsedAlphaFrame
          ? new AvifAlphaRowDecoder(
              coded,
              parsedFrame,
              inspection.displayRegion,
              inspection.nclx,
              alpha,
              parsedAlphaFrame,
              inspection.premultipliedAlpha,
              toneMap,
            )
          : new AvifRowDecoder(
              coded,
              parsedFrame,
              inspection.displayRegion,
              inspection.nclx,
              toneMap,
            ),
      workingBytes,
    }
  }
  if (alpha && parsedAlphaFrame) {
    const payloadBytes = coded.payloadBytes + alpha.payloadBytes
    validateAvifWorkingBytes(
      payloadBytes + estimateRestrictedAv1WorkingBytes(alpha.sequence, parsedAlphaFrame),
    )
    const alphaDecoded = decodeRestrictedAv1Intra(alpha.sequence, parsedAlphaFrame)
    const retainedAlphaBytes = decodedFrameBytes(alphaDecoded)
    validateAvifWorkingBytes(
      payloadBytes +
        retainedAlphaBytes +
        estimateRestrictedAv1WorkingBytes(coded.sequence, parsedFrame),
    )
    const frame = decodeRestrictedAv1Intra(coded.sequence, parsedFrame)
    if (frame.width !== coded.width || frame.height !== coded.height) {
      throw invalidInput('AVIF display dimensions do not match its AV1 frame')
    }
    return {
      decoder: new AvifFrameDecoder(
        coded,
        frame,
        inspection.displayRegion,
        inspection.nclx,
        { coded: alpha, frame: alphaDecoded },
        inspection.premultipliedAlpha,
        toneMap,
      ),
      workingBytes:
        payloadBytes +
        retainedAlphaBytes +
        decodedFrameBytes(frame) +
        inspection.displayRegion.width * Math.min(32, inspection.displayRegion.height) * 4,
    }
  }
  return createCodedAvifDecoder(coded, inspection.displayRegion, inspection.nclx, limits, toneMap)
}

const createGridAvifDecoder = (
  source: AvifGridDecoderSource,
  limits: ImageLimits,
): AvifDecoderWorkingSet => {
  const decoder = new AvifGridDecoder(source, limits)
  return { decoder, workingBytes: decoder.estimatedWorkingBytes }
}

const createGainMapGridAvifDecoder = (
  grid: NonNullable<AvifGainMapInspection['grid']>,
  codedImages: readonly AvifCodedImageInspection[],
  color: NclxColor | undefined,
  limits: ImageLimits,
): AvifDecoderWorkingSet => {
  const tiles = grid.itemIds.map((itemId) => {
    const coded = codedImages.find((image) => image.itemId === itemId && image.role === 'gain-map')
    if (!coded) throw invalidInput(`AVIF gain-map grid tile ${itemId} is not coded`)
    return { coded, parsed: parseCodedImageFrame(coded, limits) }
  })
  const first = tiles[0]
  if (!first) throw invalidInput('AVIF gain-map grid has no coded tiles')
  if (tiles.length !== grid.description.rows * grid.description.columns) {
    throw invalidInput('AVIF gain-map grid item count does not match its dimensions')
  }
  for (const tile of tiles) {
    if (
      tile.coded.width !== first.coded.width ||
      tile.coded.height !== first.coded.height ||
      tile.coded.sequence.bitDepth !== first.coded.sequence.bitDepth ||
      tile.coded.sequence.chromaSubsampling !== first.coded.sequence.chromaSubsampling ||
      tile.coded.sequence.fullRange !== first.coded.sequence.fullRange
    ) {
      throw unsupportedOperation('AVIF gain-map grid tiles must use matching pixel formats')
    }
  }
  const sequence = first.coded.sequence
  const chromaShiftX = sequence.monochrome || sequence.chromaSubsampling === '444' ? 0 : 1
  const chromaShiftY = sequence.chromaSubsampling === '420' ? 1 : 0
  const chromaWidth = sequence.monochrome
    ? 0
    : Math.ceil(grid.description.width / 2 ** chromaShiftX)
  const chromaHeight = sequence.monochrome
    ? 0
    : Math.ceil(grid.description.height / 2 ** chromaShiftY)
  const sampleBytes = sequence.bitDepth > 8 ? 2 : 1
  const stitchedBytes =
    (grid.description.width * grid.description.height + 2 * chromaWidth * chromaHeight) *
    sampleBytes
  const payloadBytes = tiles.reduce((total, tile) => total + tile.coded.payloadBytes, 0)
  const maximumTileWorkingBytes = Math.max(
    ...tiles.map((tile) => estimateRestrictedAv1WorkingBytes(tile.coded.sequence, tile.parsed)),
  )
  const outputBytes = grid.description.width * Math.min(32, grid.description.height) * 4
  const workingBytes = payloadBytes + stitchedBytes + maximumTileWorkingBytes + outputBytes
  validateAvifWorkingBytes(workingBytes)

  const y =
    sequence.bitDepth > 8
      ? new Uint16Array(grid.description.width * grid.description.height)
      : new Uint8Array(grid.description.width * grid.description.height)
  const u =
    sequence.bitDepth > 8
      ? new Uint16Array(chromaWidth * chromaHeight)
      : new Uint8Array(chromaWidth * chromaHeight)
  const v =
    sequence.bitDepth > 8
      ? new Uint16Array(chromaWidth * chromaHeight)
      : new Uint8Array(chromaWidth * chromaHeight)
  const copyPlane = (
    source: Uint8Array | Uint16Array,
    sourceStride: number,
    sourceWidth: number,
    sourceHeight: number,
    target: Uint8Array | Uint16Array,
    targetStride: number,
    targetX: number,
    targetY: number,
  ): void => {
    const width = Math.min(sourceWidth, targetStride - targetX)
    const height = Math.min(sourceHeight, Math.floor(target.length / targetStride) - targetY)
    for (let row = 0; row < height; row += 1) {
      target.set(
        source.subarray(row * sourceStride, row * sourceStride + width),
        (targetY + row) * targetStride + targetX,
      )
    }
  }
  for (let index = 0; index < tiles.length; index += 1) {
    const tile = tiles[index]
    if (!tile) continue
    const frame = decodeRestrictedAv1Intra(tile.coded.sequence, tile.parsed)
    const row = Math.floor(index / grid.description.columns)
    const column = index % grid.description.columns
    copyPlane(
      frame.y,
      frame.yStride,
      frame.width,
      frame.height,
      y,
      grid.description.width,
      column * frame.width,
      row * frame.height,
    )
    if (!sequence.monochrome) {
      copyPlane(
        frame.u,
        frame.chromaStride,
        frame.chromaWidth,
        frame.chromaHeight,
        u,
        chromaWidth,
        column * frame.chromaWidth,
        row * frame.chromaHeight,
      )
      copyPlane(
        frame.v,
        frame.chromaStride,
        frame.chromaWidth,
        frame.chromaHeight,
        v,
        chromaWidth,
        column * frame.chromaWidth,
        row * frame.chromaHeight,
      )
    }
  }
  const frame: Av1DecodedFrame = {
    width: grid.description.width,
    height: grid.description.height,
    y,
    yStride: grid.description.width,
    u,
    v,
    chromaWidth,
    chromaHeight,
    chromaStride: chromaWidth,
  }
  return {
    decoder: new AvifFrameDecoder(
      first.coded,
      frame,
      { x: 0, y: 0, width: frame.width, height: frame.height },
      color,
      undefined,
      false,
    ),
    workingBytes,
  }
}

const createAvifDecoder = async (
  source: ImageSource,
  limits: ImageLimits,
  options: Readonly<DecoderOptions> = {},
): Promise<ImageDecoder> => {
  const topLevel = await childBoxes(source, 0, source.size)
  const fileType = topLevel.find((box) => box.type === 'ftyp')
  if (!fileType) throw invalidInput('AVIF requires an ftyp box')
  const brands = parseBrands(await payload(source, fileType, 4096), 'AVIF')
  const sequenceBrand = brands.includes('avis')
  const tracks = sequenceBrand
    ? await inspectAvifTracks(source, limits.maxFrames, topLevel)
    : undefined
  const metadata = await inspectAvif(source, limits, options, tracks, topLevel)
  let inspection: AvifBitstreamInspection
  if (tracks) {
    if (options.frame === undefined) {
      throw unsupportedOperation(
        `Animated AVIF has ${tracks.frames} frames; pass { frame } to explicitly select an independently decodable key frame`,
      )
    }
    inspection = await inspectAvifTrackFrame(source, tracks, options.frame)
  } else {
    inspection = await inspectAvifBitstreams(source)
  }
  validateSdrPixelDecode(inspection)
  const gainMapApplies =
    inspection.gainMap !== undefined && gainMapWeight(inspection.gainMap.metadata) !== 0
  const toneMap = gainMapApplies ? undefined : nclxHdrToneMap(inspection.nclx)
  let base: AvifDecoderWorkingSet
  if (inspection.primaryItemType === 'grid') {
    const grid = inspection.grid
    if (!grid) throw invalidInput('AVIF grid description is missing')
    base = createGridAvifDecoder(
      {
        grid,
        itemIds: inspection.colorItemIds,
        codedImages: inspection.codedImages,
        alphaAssociations: inspection.alphaAssociations,
        displayRegion: inspection.displayRegion,
        mirroring: inspection.mirroring,
        color: inspection.nclx,
        premultipliedAlpha: inspection.premultipliedAlpha,
        rotation: inspection.rotation,
        ...(toneMap ? { toneMap } : {}),
      },
      limits,
    )
  } else {
    base = createSingleAvifDecoder(inspection, limits, toneMap)
  }
  if (toneMap) {
    validateAvifWorkingBytes(
      base.workingBytes +
        toneMap.encodedToLinear.byteLength +
        toneMap.linearToSrgb.byteLength +
        toneMap.sourceToSrgb.byteLength,
    )
  }

  let decoder = base.decoder
  if (gainMapApplies) {
    const gainMap = inspection.gainMap
    if (!gainMap) throw invalidInput('AVIF gain-map metadata is missing')
    if (!inspection.nclx) {
      throw unsupportedOperation('AVIF gain-map base color signaling is required')
    }
    let gain: AvifDecoderWorkingSet
    if (gainMap.gainMapItemType === 'av01') {
      const gainMapCoded = inspection.codedImages.find(
        (image) => image.itemId === gainMap.gainMapItemId && image.role === 'gain-map',
      )
      if (!gainMapCoded) throw invalidInput('AVIF gain-map image is not coded')
      gain = createCodedAvifDecoder(
        gainMapCoded,
        { x: 0, y: 0, width: gainMapCoded.width, height: gainMapCoded.height },
        gainMapCoded.nclx,
        limits,
      )
    } else {
      const grid = gainMap.grid
      if (!grid) throw invalidInput('AVIF gain-map grid description is missing')
      const color =
        grid.nclx ??
        inspection.codedImages.find(
          (image) => image.itemId === grid.itemIds[0] && image.role === 'gain-map',
        )?.nclx
      gain = createGainMapGridAvifDecoder(grid, inspection.codedImages, color, limits)
    }
    const resamplingBytes =
      base.decoder.width === gain.decoder.width && base.decoder.height === gain.decoder.height
        ? 0
        : base.decoder.width * 32 * 8 + gain.decoder.width * 8 + base.decoder.width * 10
    validateAvifWorkingBytes(base.workingBytes + gain.workingBytes + resamplingBytes)
    decoder = new AvifGainMapDecoder(
      base.decoder,
      gain.decoder,
      inspection.nclx,
      gainMap.alternateColor,
      gainMap.metadata,
    )
  }
  if (
    metadata.width !== inspection.displayRegion.width ||
    metadata.height !== inspection.displayRegion.height
  ) {
    throw invalidInput('AVIF clean-aperture metadata is inconsistent')
  }
  return inspection.colorTransform && !gainMapApplies
    ? new ColorManagedDecoder(decoder, inspection.colorTransform)
    : decoder
}

export const avifCodec: ImageCodec = {
  format: 'avif',
  mimeTypes: ['image/avif'],
  minimumBytes: 32,
  selection: { frames: true, resolutionLevels: false },
  detect(header) {
    return detectIsobmffBrands(header).some((brand) => brand === 'avif' || brand === 'avis')
  },
  metadata: inspectAvif,
  createEncoder: createAvifEncoder,
  createDecoder: createAvifDecoder,
}
