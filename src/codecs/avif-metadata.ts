import type {
  ChromaSubsampling,
  DecoderOptions,
  ImageMetadata,
  MetadataPreservationOptions,
  PreservedMetadata,
} from '../codec.ts'
import { invalidInput, unsupportedOperation } from '../errors.ts'
import type { GainMapExactIsoMetadata } from '../hdr/model.ts'
import { type ImageLimits, validateImageDimensions } from '../limits.ts'
import { type ImageSource, readExactly } from '../source.ts'
import {
  type Av1Obu,
  type Av1SequenceHeader,
  av1ObuType,
  inspectAv1Bitstream,
  parseAv1Obus,
} from './av1.ts'
import { validateAvifWorkingBytes } from './avif-validation.ts'
import { ascii, uint16BigEndian, uint32BigEndian } from './helpers.ts'
import {
  createNclxSrgbTransform,
  inspectIccProfile,
  parseRgbIccTransform,
  type RgbIccTransform,
} from './icc.ts'
import {
  type IsobmffBox as Box,
  type IsobmffMeta,
  type IsobmffReader,
  type IsobmffSampleTable,
  checkedAdd,
  createIsobmffReader,
  parseBrands,
  parseFullBox,
  parseIsobmffMeta,
  parseIsobmffSampleTable,
} from './isobmff.ts'

const ALPHA_AUXILIARY_TYPES = new Set([
  'urn:mpeg:mpegB:cicp:systems:auxiliary:alpha',
  'urn:mpeg:hevc:2015:auxid:1',
])
const MAX_METADATA_BOX_BYTES = 16 * 1024 * 1024
const MAX_AVIF_TRACKS = 8

interface Av1Configuration {
  readonly bitDepth: number
  readonly chromaSubsampling: ChromaSubsampling
  readonly level: number
  readonly profile: number
  readonly tier: number
}
export interface NclxColor {
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
  readonly baseRendition: 'sdr' | 'hdr'
  readonly channelCount: 1 | 3
  readonly exactIso: GainMapExactIsoMetadata
  readonly minimumVersion: 0
  readonly writerVersion: number
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

export interface PixelRegion {
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
      readonly icc?: Uint8Array
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

export const childBoxes = async (
  source: ImageSource,
  start: number,
  end: number,
): Promise<readonly Box[]> => {
  return createIsobmffReader(source, 'AVIF').boxes(start, end)
}

export const payload = async (
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
        icc,
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

export const parseMeta = async (source: ImageSource, box: Box): Promise<MetaDescription> => {
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

export const inspectAvifTracks = async (
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

export const readItemPayload = async (
  source: ImageSource,
  meta: MetaDescription,
  itemId: number,
  maximumBytes = MAX_ITEM_PAYLOAD_BYTES,
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
    if (total > maximumBytes) {
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

export const rationalValue = (value: Rational): number => value.numerator / value.denominator

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
  const baseRendition =
    rationalValue(alternateHdrHeadroom) < rationalValue(baseHdrHeadroom) ? 'hdr' : 'sdr'
  const baseOffsets = [first.baseOffset, second.baseOffset, third.baseOffset] as const
  const alternateOffsets = [
    first.alternateOffset,
    second.alternateOffset,
    third.alternateOffset,
  ] as const
  const exactIso = Object.freeze<GainMapExactIsoMetadata>({
    minimum: [first.minimum, second.minimum, third.minimum],
    maximum: [first.maximum, second.maximum, third.maximum],
    gamma: [first.gamma, second.gamma, third.gamma],
    offsetSdr: baseRendition === 'sdr' ? baseOffsets : alternateOffsets,
    offsetHdr: baseRendition === 'sdr' ? alternateOffsets : baseOffsets,
    capacityMinimum: baseRendition === 'sdr' ? baseHdrHeadroom : alternateHdrHeadroom,
    capacityMaximum: baseRendition === 'sdr' ? alternateHdrHeadroom : baseHdrHeadroom,
  })
  return {
    minimumVersion: 0,
    writerVersion,
    channelCount,
    baseRendition,
    exactIso,
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

export const nclxSrgbTransform = (color: NclxColor | undefined): RgbIccTransform | undefined => {
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

export const inspectAvifTrackFrame = async (
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

export const inspectAvif = async (
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
const MAX_PRESERVED_METADATA_BYTES = 16 * 1024 * 1024

const metadataItem = (
  meta: MetaDescription,
  primaryItemId: number,
  type: string,
): number | undefined => {
  const candidates = [...meta.items.values()].filter((item) => item.type === type)
  const linked = candidates.filter((item) =>
    meta.references.some(
      (reference) =>
        reference.type === 'cdsc' &&
        reference.fromItemId === item.id &&
        reference.toItemIds.includes(primaryItemId),
    ),
  )
  const usable = linked.length > 0 ? linked : candidates
  if (usable.length > 1) throw invalidInput(`AVIF contains multiple ${type} metadata items`)
  return usable[0]?.id
}

const preservedAvifExif = async (
  source: ImageSource,
  meta: MetaDescription,
  primaryItemId: number,
): Promise<Uint8Array | undefined> => {
  const itemId = metadataItem(meta, primaryItemId, 'Exif')
  if (itemId === undefined) return undefined
  const data = await readItemPayload(source, meta, itemId, MAX_PRESERVED_METADATA_BYTES)
  if (data.byteLength < 12) throw invalidInput('AVIF EXIF item is truncated')
  const tiffOffset = checkedAdd(4, uint32BigEndian(data, 0), 'AVIF EXIF offset overflows')
  const littleEndian = data[tiffOffset] === 0x49 && data[tiffOffset + 1] === 0x49
  const bigEndian = data[tiffOffset] === 0x4d && data[tiffOffset + 1] === 0x4d
  const magic = littleEndian
    ? (data[tiffOffset + 2] ?? 0) + (data[tiffOffset + 3] ?? 0) * 256
    : (data[tiffOffset + 2] ?? 0) * 256 + (data[tiffOffset + 3] ?? 0)
  if (tiffOffset + 8 > data.byteLength || (!littleEndian && !bigEndian) || magic !== 42) {
    throw invalidInput('AVIF EXIF item has an invalid TIFF header')
  }
  return Uint8Array.from(data.subarray(tiffOffset))
}

export const preservedAvifMetadata = async (
  source: ImageSource,
  limits: ImageLimits,
  options?: Readonly<MetadataPreservationOptions>,
): Promise<PreservedMetadata> => {
  const topLevel = await childBoxes(source, 0, source.size)
  const fileType = topLevel.find((box) => box.type === 'ftyp')
  const metaBox = topLevel.find((box) => box.type === 'meta')
  if (!fileType || !metaBox) throw invalidInput('AVIF requires ftyp and meta boxes')
  const brands = parseBrands(await payload(source, fileType, 4096), 'AVIF')
  const tracks = brands.includes('avis')
    ? await inspectAvifTracks(source, limits.maxFrames, topLevel)
    : undefined
  await inspectAvif(
    source,
    limits,
    options?.frame === undefined ? {} : { frame: options.frame },
    tracks,
    topLevel,
  )
  const meta = await parseMeta(source, metaBox)
  const primaryItemId = meta.primaryItemId
  if (primaryItemId === undefined) throw invalidInput('AVIF has no primary item')
  const exif =
    options?.exif === false ? undefined : await preservedAvifExif(source, meta, primaryItemId)
  const color = tracks?.color.color ?? firstProperty(propertiesFor(meta, primaryItemId), 'colr')
  const icc = options?.icc === false ? undefined : color?.icc
  return {
    ...(exif === undefined ? {} : { exif }),
    ...(icc === undefined ? {} : { icc: Uint8Array.from(icc) }),
  }
}

export const isHdrTransfer = (transferCharacteristics: number): boolean =>
  transferCharacteristics === 16 || transferCharacteristics === 18
