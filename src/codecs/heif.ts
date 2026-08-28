import type {
  ChromaSubsampling,
  DecodeRequest,
  DecoderOptions,
  ImageCodec,
  ImageDecoder,
  ImageMetadata,
  MetadataPreservationOptions,
  PreservedMetadata,
} from '../codec.ts'
import { ImageError, invalidInput, unsupportedOperation } from '../errors.ts'
import type { ImageLimits } from '../limits.ts'
import { validateImageDimensions } from '../limits.ts'
import { exifOrientation } from '../metadata.ts'
import type { PixelBlock } from '../pixel.ts'
import type { ImageSource } from '../source.ts'
import { readExactly } from '../source.ts'
import {
  decodeUncompressedRgba,
  parseCmpC,
  parseCmpd,
  parseIcef,
  parseUncC,
  type UncompressedConfig,
} from './heif-uncompressed.ts'
import { ascii, uint16BigEndian, uint32BigEndian } from './helpers.ts'
import type {
  HevcPpsInspection,
  HevcSliceInspection,
  HevcSpsInspection,
  HevcVpsInspection,
} from './hevc.ts'
import { inspectHevcPps, inspectHevcSlice, inspectHevcSps, inspectHevcVps } from './hevc.ts'
import { type DecodedHevcPicture, decodeHevcIntraSlices } from './hevc-picture.ts'
import {
  ColorManagedDecoder,
  createDisplayP3Transform,
  inspectIccProfile,
  parseRgbIccTransform,
  type RgbIccTransform,
} from './icc.ts'
import type { IsobmffBox, IsobmffMeta, IsobmffReader } from './isobmff.ts'
import {
  checkedAdd,
  createIsobmffReader,
  detectIsobmffBrands,
  parseBrands,
  parseFullBox,
  parseIsobmffMeta,
} from './isobmff.ts'

const HEVC_BRANDS = new Set(['heic', 'heix', 'heim', 'heis', 'hevc', 'hevx', 'hevm', 'hevs'])
const GENERIC_HEIF_BRANDS = new Set(['mif1', 'mif3', 'miaf'])
const SEQUENCE_BRANDS = new Set(['heis', 'hevs', 'msf1'])
const ALPHA_AUXILIARY_TYPES = new Set([
  'urn:mpeg:mpegB:cicp:systems:auxiliary:alpha',
  'urn:mpeg:hevc:2015:auxid:1',
])
const AVIF_BRANDS = new Set(['avif', 'avis'])
const MAX_CONFIGURATION_BYTES = 1024 * 1024
const MAX_ITEM_BYTES = 128 * 1024 * 1024
const MAX_NAL_UNITS = 16_384
const MAX_NAL_BYTES = 32 * 1024 * 1024
const MAX_PRESERVED_METADATA_BYTES = 16 * 1024 * 1024
const MAX_IDENTITY_DEPTH = 16
const XMP_CONTENT_TYPE = 'application/rdf+xml'

export interface HevcNalUnit {
  readonly data: Uint8Array
  readonly layerId: number
  readonly temporalId: number
  readonly type: number
}

export interface HevcConfigurationArray {
  readonly arrayCompleteness: boolean
  readonly nalUnitType: number
  readonly nalUnits: readonly HevcNalUnit[]
}

export interface HevcConfiguration {
  readonly arrays: readonly HevcConfigurationArray[]
  readonly bitDepth: number
  readonly chromaSubsampling: ChromaSubsampling
  readonly level: number
  readonly lengthSize: 1 | 2 | 4
  readonly pps: readonly HevcPpsInspection[]
  readonly profile: number
  readonly sps: readonly HevcSpsInspection[]
  readonly tier: number
  readonly vps: readonly HevcVpsInspection[]
}

type Property =
  | { readonly type: 'auxC'; readonly auxiliaryType: string }
  | { readonly type: 'clap'; readonly aperture: CleanAperture }
  | {
      readonly type: 'colr'
      readonly colorSpace: string
      readonly icc?: Uint8Array
      readonly iccDescription?: string
      readonly nclx?: NclxColor
      readonly colorTransform?: RgbIccTransform
    }
  | {
      readonly type: 'cmpC'
      readonly compression: UncompressedConfig['compression']
      readonly compressedUnit: 0 | 1 | 2
    }
  | { readonly type: 'cmpd'; readonly componentTypes: readonly number[] }
  | { readonly type: 'hvcC'; readonly configuration: HevcConfiguration }
  | { readonly type: 'icef'; readonly sizes: readonly number[] }
  | { readonly type: 'imir'; readonly axis: 0 | 1 }
  | { readonly type: 'irot'; readonly angle: number }
  | { readonly type: 'ispe'; readonly width: number; readonly height: number }
  | { readonly type: 'pasp' }
  | { readonly type: 'pixi'; readonly bitDepth: number }
  | { readonly type: 'rref'; readonly referenceTypes: readonly string[] }
  | { readonly type: 'uncC'; readonly data: Uint8Array }
  | { readonly type: 'unknown' }

interface Rational {
  readonly numerator: number
  readonly denominator: number
}

interface CleanAperture {
  readonly width: Rational
  readonly height: Rational
  readonly horizontalOffset: Rational
  readonly verticalOffset: Rational
}

interface NclxColor {
  readonly fullRange: boolean
  readonly matrixCoefficients: number
  readonly primaries: number
  readonly transferCharacteristics: number
}

type MetaDescription = IsobmffMeta<Property>

const byte = (data: Uint8Array, offset: number, message: string): number => {
  const value = data[offset]
  if (value === undefined) throw invalidInput(message)
  return value
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

const parseNalUnit = (data: Uint8Array, context: string): HevcNalUnit => {
  if (data.byteLength < 2) throw invalidInput(`${context} HEVC NAL unit is truncated`)
  const first = data[0] ?? 0
  const second = data[1] ?? 0
  if ((first & 0x80) !== 0) throw invalidInput(`${context} HEVC NAL forbidden-zero bit is set`)
  if ((second & 0x07) === 0) throw invalidInput(`${context} HEVC NAL temporal ID is zero`)
  return {
    type: (first >>> 1) & 0x3f,
    layerId: ((first & 1) << 5) | (second >>> 3),
    temporalId: (second & 0x07) - 1,
    data,
  }
}

const parseHevcConfiguration = (data: Uint8Array): HevcConfiguration => {
  if (data.byteLength < 23) throw invalidInput('HEIF hvcC property is truncated')
  if (byte(data, 0, 'HEIF hvcC version is missing') !== 1) {
    throw invalidInput('HEIF hvcC property has an unsupported version')
  }
  if ((uint16BigEndian(data, 13) & 0xf000) !== 0xf000) {
    throw invalidInput('HEIF hvcC spatial-segmentation reserved bits are invalid')
  }
  if ((byte(data, 15, 'HEIF hvcC parallelism field is missing') & 0xfc) !== 0xfc) {
    throw invalidInput('HEIF hvcC parallelism reserved bits are invalid')
  }
  const chromaField = byte(data, 16, 'HEIF hvcC chroma field is missing')
  const lumaDepthField = byte(data, 17, 'HEIF hvcC luma depth is missing')
  const chromaDepthField = byte(data, 18, 'HEIF hvcC chroma depth is missing')
  if ((chromaField & 0xfc) !== 0xfc || (lumaDepthField & 0xf8) !== 0xf8) {
    throw invalidInput('HEIF hvcC chroma or luma reserved bits are invalid')
  }
  if ((chromaDepthField & 0xf8) !== 0xf8) {
    throw invalidInput('HEIF hvcC chroma-depth reserved bits are invalid')
  }
  const lumaDepth = 8 + (lumaDepthField & 0x07)
  const chromaDepth = 8 + (chromaDepthField & 0x07)
  if (lumaDepth !== chromaDepth) throw invalidInput('HEIF hvcC luma and chroma depths differ')
  const chromaFormat = chromaField & 0x03
  const chromaSubsampling: ChromaSubsampling =
    chromaFormat === 0 ? '400' : chromaFormat === 1 ? '420' : chromaFormat === 2 ? '422' : '444'
  const packedTemporal = byte(data, 21, 'HEIF hvcC temporal fields are missing')
  const encodedLengthSize = packedTemporal & 0x03
  if (encodedLengthSize === 2) throw invalidInput('HEIF hvcC uses a reserved NAL length size')
  const lengthSize: 1 | 2 | 4 = encodedLengthSize === 0 ? 1 : encodedLengthSize === 1 ? 2 : 4
  const arrayCount = byte(data, 22, 'HEIF hvcC array count is missing')
  let offset = 23
  let nalCount = 0
  const arrays: HevcConfigurationArray[] = []
  for (let arrayIndex = 0; arrayIndex < arrayCount; arrayIndex += 1) {
    const arrayHeader = byte(data, offset, 'HEIF hvcC array header is truncated')
    offset += 1
    const count = uint16BigEndian(data, offset)
    offset += 2
    const nalUnits: HevcNalUnit[] = []
    for (let index = 0; index < count; index += 1) {
      nalCount += 1
      if (nalCount > MAX_NAL_UNITS) throw invalidInput('HEIF hvcC contains too many NAL units')
      const length = uint16BigEndian(data, offset)
      offset += 2
      if (length < 2 || offset + length > data.byteLength) {
        throw invalidInput('HEIF hvcC NAL unit extent is invalid')
      }
      const nal = parseNalUnit(data.slice(offset, offset + length), 'HEIF hvcC')
      const declaredType = arrayHeader & 0x3f
      if (nal.type !== declaredType)
        throw invalidInput('HEIF hvcC NAL type does not match its array')
      nalUnits.push(nal)
      offset += length
    }
    arrays.push({
      arrayCompleteness: (arrayHeader & 0x40) !== 0,
      nalUnitType: arrayHeader & 0x3f,
      nalUnits,
    })
  }
  if (offset !== data.byteLength) throw invalidInput('HEIF hvcC property has trailing data')

  const profile = byte(data, 1, 'HEIF hvcC profile is missing') & 0x1f
  const tier = (byte(data, 1, 'HEIF hvcC profile is missing') >>> 5) & 1
  const level = byte(data, 12, 'HEIF hvcC level is missing')
  const unitsOfType = (type: number): readonly HevcNalUnit[] =>
    arrays.filter((array) => array.nalUnitType === type).flatMap((array) => array.nalUnits)
  const vps = unitsOfType(32).map((nal) => inspectHevcVps(nal.data))
  const sps = unitsOfType(33).map((nal) => inspectHevcSps(nal.data))
  const pps = unitsOfType(34).map((nal) => inspectHevcPps(nal.data))
  if (vps.length === 0 || sps.length === 0 || pps.length === 0) {
    throw invalidInput('HEIF hvcC must contain VPS, SPS, and PPS parameter sets')
  }
  if (new Set(vps.map((parameterSet) => parameterSet.id)).size !== vps.length) {
    throw invalidInput('HEIF hvcC contains duplicate VPS IDs')
  }
  if (new Set(sps.map((parameterSet) => parameterSet.id)).size !== sps.length) {
    throw invalidInput('HEIF hvcC contains duplicate SPS IDs')
  }
  if (new Set(pps.map((parameterSet) => parameterSet.id)).size !== pps.length) {
    throw invalidInput('HEIF hvcC contains duplicate PPS IDs')
  }
  if (sps.some((parameterSet) => !vps.some((candidate) => candidate.id === parameterSet.vpsId))) {
    throw invalidInput('HEIF hvcC SPS references a missing VPS')
  }
  if (pps.some((parameterSet) => !sps.some((candidate) => candidate.id === parameterSet.spsId))) {
    throw invalidInput('HEIF hvcC PPS references a missing SPS')
  }
  for (const parameterSet of pps) {
    const sequence = sps.find((candidate) => candidate.id === parameterSet.spsId)
    if (!sequence) throw invalidInput('HEIF hvcC PPS references a missing SPS')
    if (
      parameterSet.tileColumns > sequence.ctbWidth ||
      parameterSet.tileRows > sequence.ctbHeight
    ) {
      throw invalidInput('HEIF hvcC PPS tile grid exceeds its SPS picture geometry')
    }
    if (!parameterSet.uniformTileSpacing) {
      const explicitWidth = parameterSet.tileColumnWidths.reduce((sum, width) => sum + width, 0)
      const explicitHeight = parameterSet.tileRowHeights.reduce((sum, height) => sum + height, 0)
      if (explicitWidth >= sequence.ctbWidth || explicitHeight >= sequence.ctbHeight) {
        throw invalidInput('HEIF hvcC PPS tile dimensions exceed its SPS picture geometry')
      }
    }
  }
  const chromaSubsamplingFromSps = (value: HevcSpsInspection['chromaFormat']): ChromaSubsampling =>
    value === 0 ? '400' : value === 1 ? '420' : value === 2 ? '422' : '444'
  if (
    sps.some(
      (parameterSet) =>
        parameterSet.profile !== profile ||
        parameterSet.tier !== tier ||
        parameterSet.level !== level ||
        parameterSet.bitDepth !== lumaDepth ||
        chromaSubsamplingFromSps(parameterSet.chromaFormat) !== chromaSubsampling,
    )
  ) {
    throw invalidInput('HEIF hvcC fields do not match its SPS')
  }
  if (
    vps.some(
      (parameterSet) =>
        parameterSet.profile !== profile ||
        parameterSet.tier !== tier ||
        parameterSet.level !== level,
    )
  ) {
    throw invalidInput('HEIF hvcC fields do not match its VPS')
  }
  if (arrays.some((array) => array.nalUnits.some((nal) => nal.layerId !== 0))) {
    throw unsupportedOperation('Multilayer HEIF parameter sets are unsupported')
  }
  if (
    arrays.some(
      (array) =>
        (array.nalUnitType === 32 || array.nalUnitType === 33) &&
        array.nalUnits.some((nal) => nal.temporalId !== 0),
    )
  ) {
    throw invalidInput('HEIF VPS and SPS parameter sets must have temporal ID zero')
  }

  return {
    arrays,
    profile,
    tier,
    level,
    bitDepth: lumaDepth,
    chromaSubsampling,
    lengthSize,
    vps,
    sps,
    pps,
  }
}

const parseProperty = async (reader: IsobmffReader, box: IsobmffBox): Promise<Property> => {
  if (box.type === 'auxC') {
    const data = await reader.payload(box, 4096)
    const header = parseFullBox(data, box.type, 'HEIF')
    const terminator = data.indexOf(0, 4)
    if (header.version !== 0 || header.flags !== 0 || terminator < 5) {
      throw invalidInput('HEIF auxC property is malformed')
    }
    return { type: 'auxC', auxiliaryType: ascii(data, 4, terminator - 4) }
  }
  if (box.type === 'ispe') {
    const data = await reader.payload(box, 12)
    const header = parseFullBox(data, box.type, 'HEIF')
    if (header.version !== 0 || header.flags !== 0 || data.byteLength !== 12) {
      throw invalidInput('HEIF ispe property is malformed')
    }
    return { type: 'ispe', width: uint32BigEndian(data, 4), height: uint32BigEndian(data, 8) }
  }
  if (box.type === 'pixi') {
    const data = await reader.payload(box, 256)
    const header = parseFullBox(data, box.type, 'HEIF')
    const channels = byte(data, 4, 'HEIF pixi channel count is missing')
    if (
      header.version !== 0 ||
      header.flags !== 0 ||
      channels < 1 ||
      data.byteLength !== 5 + channels
    ) {
      throw invalidInput('HEIF pixi property is malformed')
    }
    const bitDepth = byte(data, 5, 'HEIF pixi channel depth is missing')
    for (let index = 1; index < channels; index += 1) {
      if (byte(data, 5 + index, 'HEIF pixi channel depth is truncated') !== bitDepth) {
        throw invalidInput('HEIF pixi channel depths differ')
      }
    }
    return { type: 'pixi', bitDepth }
  }
  if (box.type === 'hvcC') {
    return {
      type: 'hvcC',
      configuration: parseHevcConfiguration(await reader.payload(box, MAX_CONFIGURATION_BYTES)),
    }
  }
  if (box.type === 'colr') {
    const data = await reader.payload(box)
    if (data.byteLength < 4) throw invalidInput('HEIF colr property is truncated')
    const method = ascii(data, 0, 4)
    if (method === 'nclx') {
      if (data.byteLength !== 11) throw invalidInput('HEIF nclx color property is malformed')
      const primaries = uint16BigEndian(data, 4)
      const transferCharacteristics = uint16BigEndian(data, 6)
      const matrixCoefficients = uint16BigEndian(data, 8)
      const fullRange = ((data[10] ?? 0) & 0x80) !== 0
      return {
        type: 'colr',
        colorSpace: colorSpaceName(
          primaries,
          transferCharacteristics,
          matrixCoefficients,
          fullRange,
        ),
        nclx: { primaries, transferCharacteristics, matrixCoefficients, fullRange },
        ...(primaries === 12 && transferCharacteristics === 13
          ? { colorTransform: createDisplayP3Transform() }
          : {}),
      }
    }
    if (method === 'prof' || method === 'rICC') {
      const icc = data.slice(4)
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
    const data = await reader.payload(box, 1)
    if (data.byteLength !== 1 || ((data[0] ?? 0) & 0xfc) !== 0) {
      throw invalidInput('HEIF irot property is invalid')
    }
    return { type: 'irot', angle: (data[0] ?? 0) & 3 }
  }
  if (box.type === 'imir') {
    const data = await reader.payload(box, 1)
    if (data.byteLength !== 1 || ((data[0] ?? 0) & 0xfe) !== 0) {
      throw invalidInput('HEIF imir property is invalid')
    }
    return { type: 'imir', axis: (data[0] ?? 0) === 0 ? 0 : 1 }
  }
  if (box.type === 'clap') {
    const data = await reader.payload(box, 32)
    if (data.byteLength !== 32) throw invalidInput('HEIF clap property is invalid')
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
      if (value.denominator === 0) throw invalidInput('HEIF clap denominator must not be zero')
    }
    if (aperture.width.numerator === 0 || aperture.height.numerator === 0) {
      throw invalidInput('HEIF clap dimensions must be positive')
    }
    return { type: 'clap', aperture }
  }
  if (box.type === 'pasp') {
    await reader.payload(box, 8)
    return { type: 'pasp' }
  }
  if (box.type === 'rref') {
    const data = await reader.payload(box, 256)
    const header = parseFullBox(data, box.type, 'HEIF')
    if (header.version !== 0 || data.byteLength < 8)
      throw invalidInput('HEIF rref property is malformed')
    const count = uint32BigEndian(data, 4)
    const referenceTypes: string[] = []
    let offset = 8
    for (let index = 0; index < count; index += 1) {
      if (offset + 4 > data.byteLength) throw invalidInput('HEIF rref property is truncated')
      referenceTypes.push(ascii(data, offset, 4))
      offset += 4
    }
    return { type: 'rref', referenceTypes }
  }
  if (box.type === 'cmpd') {
    return { type: 'cmpd', componentTypes: parseCmpd(await reader.payload(box, 256)) }
  }
  if (box.type === 'uncC') {
    return { type: 'uncC', data: await reader.payload(box, 4096) }
  }
  if (box.type === 'cmpC') {
    const parsed = parseCmpC(await reader.payload(box, 64))
    return {
      type: 'cmpC',
      compression: parsed.compression,
      compressedUnit: parsed.compressedUnit ?? 0,
    }
  }
  if (box.type === 'icef') {
    return { type: 'icef', sizes: parseIcef(await reader.payload(box, 64 * 1024)) }
  }
  return { type: 'unknown' }
}

const propertiesFor = (meta: MetaDescription, itemId: number): readonly Property[] =>
  (meta.associations.get(itemId) ?? []).map((association) => {
    const property = meta.properties[association.index - 1]
    if (!property) throw invalidInput(`HEIF item references missing property ${association.index}`)
    if (association.essential && property.type === 'unknown') {
      throw unsupportedOperation(`HEIF item requires unsupported property ${association.index}`)
    }
    return property
  })

const oneProperty = <Type extends Property['type']>(
  properties: readonly Property[],
  type: Type,
): Extract<Property, { type: Type }> | undefined => {
  const matches = properties.filter(
    (property): property is Extract<Property, { type: Type }> => property.type === type,
  )
  if (matches.length > 1) throw invalidInput(`HEIF item has conflicting ${type} properties`)
  return matches[0]
}

interface PixelRegion {
  readonly height: number
  readonly width: number
  readonly x: number
  readonly y: number
}

const cleanApertureRegion = (
  source: { readonly width: number; readonly height: number },
  aperture: CleanAperture | undefined,
): PixelRegion => {
  if (!aperture) return { x: 0, y: 0, ...source }
  const width = aperture.width.numerator / aperture.width.denominator
  const height = aperture.height.numerator / aperture.height.denominator
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height)) {
    throw unsupportedOperation('Fractional HEIF clean-aperture dimensions are unsupported')
  }
  const horizontalOffset =
    aperture.horizontalOffset.numerator / aperture.horizontalOffset.denominator
  const verticalOffset = aperture.verticalOffset.numerator / aperture.verticalOffset.denominator
  const left = (source.width - width) / 2 + horizontalOffset
  const top = (source.height - height) / 2 + verticalOffset
  if (left < 0 || top < 0 || left + width > source.width || top + height > source.height) {
    throw invalidInput('HEIF clean aperture exceeds its source image')
  }
  if (!Number.isSafeInteger(left) || !Number.isSafeInteger(top)) {
    throw unsupportedOperation('Fractional HEIF clean-aperture origins are unsupported')
  }
  return { x: left, y: top, width, height }
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
  throw invalidInput('HEIF orientation matrix is invalid')
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
  if (!matrix) throw invalidInput('HEIF identity orientation is unavailable')
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
    if (!next) throw invalidInput('HEIF transform orientation is invalid')
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
  throw invalidInput('HEIF transforms do not map to an EXIF orientation')
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
      throw invalidInput('HEIF transformative properties are associated in an invalid order')
    }
    previousRank = rank
  }
  oneProperty(properties, 'clap')
  oneProperty(properties, 'irot')
  oneProperty(properties, 'imir')
}

interface ItemRange {
  readonly start: number
  readonly length: number
}

const itemRanges = (
  reader: IsobmffReader,
  meta: MetaDescription,
  itemId: number,
): { readonly ranges: readonly ItemRange[]; readonly length: number } => {
  const location = meta.locations.get(itemId)
  if (!location || location.extents.length === 0) {
    throw invalidInput(`HEIF item ${itemId} has no payload location`)
  }
  let base = location.baseOffset
  let boundary = reader.source.size
  if (location.constructionMethod === 1) {
    if (!meta.idat) throw invalidInput(`HEIF item ${itemId} requires a missing idat box`)
    base = checkedAdd(meta.idat.contentStart, base, `HEIF item ${itemId} base offset overflows`)
    boundary = meta.idat.end
  }
  let total = 0
  const ranges = location.extents.map((extent) => {
    const start = checkedAdd(base, extent.offset, `HEIF item ${itemId} extent offset overflows`)
    const end = checkedAdd(start, extent.length, `HEIF item ${itemId} extent end overflows`)
    if (end > boundary) throw invalidInput(`HEIF item ${itemId} extent exceeds its data source`)
    total = checkedAdd(total, extent.length, `HEIF item ${itemId} total length overflows`)
    if (total > MAX_ITEM_BYTES)
      throw invalidInput(`HEIF item ${itemId} payload is unreasonably large`)
    return { start, length: extent.length }
  })
  return { ranges, length: total }
}

interface GridDescription {
  readonly columns: number
  readonly height: number
  readonly rows: number
  readonly width: number
}

interface UncompressedImage {
  readonly config: UncompressedConfig
  readonly itemId: number
}

interface GridLayout extends GridDescription {
  readonly tileHeight: number
  readonly tileWidth: number
}

const parseGrid = (data: Uint8Array): GridDescription => {
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
    throw invalidInput('HEIF grid item header is invalid')
  }
  const wide = (flags & 1) !== 0
  if (data.byteLength !== (wide ? 12 : 8)) {
    throw invalidInput('HEIF grid item has an invalid size')
  }
  return {
    rows: rowsMinusOne + 1,
    columns: columnsMinusOne + 1,
    width: wide ? uint32BigEndian(data, 4) : uint16BigEndian(data, 4),
    height: wide ? uint32BigEndian(data, 8) : uint16BigEndian(data, 6),
  }
}

interface CodedImageDescription {
  readonly configuration: HevcConfiguration
  readonly dimensions: { readonly width: number; readonly height: number }
  readonly itemId: number
  readonly properties: readonly Property[]
}

interface ParsedHeif {
  readonly brands: readonly string[]
  readonly codedImages: readonly CodedImageDescription[]
  readonly dimensions: { readonly width: number; readonly height: number }
  readonly grid: GridLayout | undefined
  readonly meta: MetaDescription
  readonly primaryItemId: number
  readonly primaryItemType: 'grid' | 'hvc1' | 'iden' | 'unci'
  readonly properties: readonly Property[]
  readonly reader: IsobmffReader
  readonly uncompressed: UncompressedImage | undefined
}

const codedImageDescription = (meta: MetaDescription, itemId: number): CodedImageDescription => {
  const item = meta.items.get(itemId)
  if (!item) throw invalidInput(`HEIF coded item ${itemId} has no item information`)
  if (item.protectionIndex !== 0) throw unsupportedOperation('Protected HEIF items are unsupported')
  if (item.type !== 'hvc1') {
    throw unsupportedOperation(`Unsupported HEIF coded item type: ${item.type}`)
  }
  const properties = propertiesFor(meta, itemId)
  const dimensions = oneProperty(properties, 'ispe')
  if (!dimensions) throw invalidInput(`HEIF item ${itemId} has no spatial extents`)
  const configuration = oneProperty(properties, 'hvcC')?.configuration
  if (!configuration) throw invalidInput(`HEIF item ${itemId} has no hvcC property`)
  const pixelInformation = oneProperty(properties, 'pixi')
  if (pixelInformation && pixelInformation.bitDepth !== configuration.bitDepth) {
    throw invalidInput(`HEIF item ${itemId} pixi and hvcC bit depths do not match`)
  }
  if (
    configuration.sps.some(
      (parameterSet) =>
        parameterSet.width !== dimensions.width || parameterSet.height !== dimensions.height,
    )
  ) {
    throw invalidInput(`HEIF item ${itemId} spatial extents do not match its SPS`)
  }
  return { itemId, configuration, dimensions, properties }
}

const codedGridFromItem = async (
  reader: IsobmffReader,
  meta: MetaDescription,
  itemId: number,
): Promise<{
  readonly codedImages: readonly CodedImageDescription[]
  readonly grid: GridLayout
}> => {
  const gridItem = itemRanges(reader, meta, itemId)
  if (gridItem.length > 12) throw invalidInput('HEIF grid item is unreasonably large')
  const grid = parseGrid(await readAcrossRanges(reader.source, gridItem.ranges, 0, gridItem.length))
  const tileItemIds = dimgInputs(meta, itemId)
  if (tileItemIds.length !== grid.rows * grid.columns) {
    throw invalidInput('HEIF grid dimensions do not match its tile references')
  }
  if (new Set(tileItemIds).size !== tileItemIds.length) {
    throw invalidInput('HEIF grid contains duplicate tile references')
  }
  for (const tileItemId of tileItemIds) {
    if (hasTransformativeProperties(meta, tileItemId)) {
      throw invalidInput('HEIF grid input tiles must not have transformative properties')
    }
  }
  const codedImages = tileItemIds.map((tileItemId) => codedImageDescription(meta, tileItemId))
  const firstTile = codedImages[0]
  if (!firstTile) throw invalidInput('HEIF grid has no coded tiles')
  for (const tile of codedImages) {
    if (
      tile.dimensions.width !== firstTile.dimensions.width ||
      tile.dimensions.height !== firstTile.dimensions.height
    ) {
      throw invalidInput('HEIF grid tiles have inconsistent dimensions')
    }
    if (
      tile.configuration.profile !== firstTile.configuration.profile ||
      tile.configuration.tier !== firstTile.configuration.tier ||
      tile.configuration.level !== firstTile.configuration.level ||
      tile.configuration.bitDepth !== firstTile.configuration.bitDepth ||
      tile.configuration.chromaSubsampling !== firstTile.configuration.chromaSubsampling ||
      tile.configuration.lengthSize !== firstTile.configuration.lengthSize
    ) {
      throw invalidInput('HEIF grid tiles have inconsistent HEVC configurations')
    }
    const firstColor = oneProperty(firstTile.properties, 'colr')?.colorSpace
    const tileColor = oneProperty(tile.properties, 'colr')?.colorSpace
    if (tileColor !== firstColor) {
      throw invalidInput('HEIF grid tiles have inconsistent color descriptions')
    }
  }
  if (
    grid.width <= firstTile.dimensions.width * (grid.columns - 1) ||
    grid.width > firstTile.dimensions.width * grid.columns ||
    grid.height <= firstTile.dimensions.height * (grid.rows - 1) ||
    grid.height > firstTile.dimensions.height * grid.rows
  ) {
    throw invalidInput('HEIF grid canvas is inconsistent with its tile geometry')
  }
  return {
    codedImages,
    grid: {
      ...grid,
      tileWidth: firstTile.dimensions.width,
      tileHeight: firstTile.dimensions.height,
    },
  }
}

const dimgInputs = (meta: MetaDescription, itemId: number): readonly number[] =>
  meta.references
    .filter((reference) => reference.type === 'dimg' && reference.fromItemId === itemId)
    .flatMap((reference) => reference.toItemIds)

const hasTransformativeProperties = (meta: MetaDescription, itemId: number): boolean =>
  propertiesFor(meta, itemId).some(
    (property) => property.type === 'clap' || property.type === 'imir' || property.type === 'irot',
  )

const resolveCodedPrimary = (
  meta: MetaDescription,
  primaryItemId: number,
): { readonly itemId: number; readonly type: 'grid' | 'hvc1' | 'unci' } => {
  const visited = new Set<number>()
  let itemId = primaryItemId
  for (let depth = 0; depth <= MAX_IDENTITY_DEPTH; depth += 1) {
    const item = meta.items.get(itemId)
    if (!item) throw invalidInput(`HEIF item ${itemId} has no item information`)
    if (item.protectionIndex !== 0) {
      throw unsupportedOperation('Protected HEIF items are unsupported')
    }
    if (item.type === 'hvc1' || item.type === 'grid' || item.type === 'unci') {
      return { itemId, type: item.type }
    }
    if (item.type !== 'iden') {
      throw unsupportedOperation(`Unsupported HEIF primary item type: ${item.type}`)
    }
    if (visited.has(itemId)) {
      throw invalidInput('HEIF identity derived image contains a reference loop')
    }
    visited.add(itemId)
    const inputs = dimgInputs(meta, itemId)
    const inputId = inputs[0]
    if (inputs.length !== 1 || inputId === undefined) {
      throw invalidInput('HEIF identity derived image must reference exactly one input')
    }
    itemId = inputId
  }
  throw invalidInput('HEIF identity derived image is nested too deeply')
}

const parseHeif = async (source: ImageSource): Promise<ParsedHeif> => {
  const reader = createIsobmffReader(source, 'HEIF')
  const topLevel = await reader.boxes(0, source.size)
  const fileType = topLevel.find((box) => box.type === 'ftyp')
  const metaBox = topLevel.find((box) => box.type === 'meta')
  const movieBox = topLevel.find((box) => box.type === 'moov')
  if (!fileType) throw invalidInput('HEIF requires an ftyp box')
  const brands = parseBrands(await reader.payload(fileType, 4096), 'HEIF')
  if (brands.some((brand) => AVIF_BRANDS.has(brand))) {
    throw unsupportedOperation('AV1-coded AVIF must be opened through the AVIF codec')
  }
  if (!brands.some((brand) => HEVC_BRANDS.has(brand) || GENERIC_HEIF_BRANDS.has(brand))) {
    throw invalidInput('File does not declare a supported HEIF brand')
  }
  if (!metaBox) {
    if (topLevel.some((box) => box.type === 'mini')) {
      throw unsupportedOperation('HEIF Mini bitstream is unsupported')
    }
    if (movieBox || brands.some((brand) => SEQUENCE_BRANDS.has(brand))) {
      throw unsupportedOperation('Timed HEIF image sequences are unsupported')
    }
    throw invalidInput('HEIF requires ftyp and meta boxes')
  }
  if (brands.some((brand) => SEQUENCE_BRANDS.has(brand))) {
    throw unsupportedOperation('Timed HEIF image sequences are unsupported')
  }

  const meta = await parseIsobmffMeta(reader, metaBox, parseProperty)
  if ([...meta.locations.values()].some((location) => location.dataReferenceIndex !== 0)) {
    throw unsupportedOperation('HEIF external item data references are unsupported')
  }
  const primaryItemId = meta.primaryItemId
  if (primaryItemId === undefined) throw invalidInput('HEIF has no primary item')
  const item = meta.items.get(primaryItemId)
  if (!item) throw invalidInput('HEIF primary item has no item information')
  if (item.protectionIndex !== 0) throw unsupportedOperation('Protected HEIF items are unsupported')
  const codedPrimary = resolveCodedPrimary(meta, primaryItemId)
  const properties = propertiesFor(meta, primaryItemId)
  validateTransformProperties(properties)
  const dimensions = oneProperty(properties, 'ispe')
  if (!dimensions) throw invalidInput('HEIF primary item has no spatial extents')
  let codedImages: readonly CodedImageDescription[] = []
  let gridLayout: GridLayout | undefined
  let uncompressed: UncompressedImage | undefined
  if (codedPrimary.type === 'hvc1') {
    codedImages = [codedImageDescription(meta, codedPrimary.itemId)]
    const coded = codedImages[0]
    if (
      item.type === 'iden' &&
      coded &&
      (coded.dimensions.width !== dimensions.width || coded.dimensions.height !== dimensions.height)
    ) {
      throw invalidInput('HEIF identity derived image extents do not match its input')
    }
  } else if (codedPrimary.type === 'unci') {
    const unciProperties = propertiesFor(meta, codedPrimary.itemId)
    const types = oneProperty(unciProperties, 'cmpd')?.componentTypes ?? []
    const uncC = oneProperty(unciProperties, 'uncC')
    if (!uncC) throw invalidInput('HEIF uncompressed item has no uncC property')
    let config = parseUncC(uncC.data, types)
    const cmpC = oneProperty(unciProperties, 'cmpC')
    const icef = oneProperty(unciProperties, 'icef')
    if (cmpC) {
      config = {
        ...config,
        compression: cmpC.compression,
        compressedUnit: cmpC.compressedUnit,
        ...(icef ? { compressedExtents: icef.sizes } : {}),
      }
    }
    uncompressed = { config, itemId: codedPrimary.itemId }
  } else {
    const derived = await codedGridFromItem(reader, meta, codedPrimary.itemId)
    if (derived.grid.width !== dimensions.width || derived.grid.height !== dimensions.height) {
      throw invalidInput('HEIF grid dimensions do not match its spatial extents')
    }
    codedImages = derived.codedImages
    gridLayout = derived.grid
  }
  return {
    brands,
    codedImages,
    dimensions,
    grid: gridLayout,
    meta,
    primaryItemId,
    primaryItemType: item.type === 'iden' ? 'iden' : codedPrimary.type,
    properties,
    reader,
    uncompressed,
  }
}

const readAcrossRanges = async (
  source: ImageSource,
  ranges: readonly ItemRange[],
  offset: number,
  length: number,
): Promise<Uint8Array> => {
  const output = new Uint8Array(length)
  let logicalStart = 0
  let outputOffset = 0
  for (const range of ranges) {
    const logicalEnd = logicalStart + range.length
    if (offset < logicalEnd && offset + length > logicalStart) {
      const withinRange = Math.max(0, offset - logicalStart)
      const amount = Math.min(range.length - withinRange, length - outputOffset)
      output.set(await readExactly(source, range.start + withinRange, amount), outputOffset)
      outputOffset += amount
      if (outputOffset === length) return output
    }
    logicalStart = logicalEnd
  }
  throw invalidInput('HEIF item NAL extent is truncated')
}

const colorPropertiesFor = (parsed: ParsedHeif): readonly Property[] =>
  oneProperty(parsed.properties, 'colr')
    ? parsed.properties
    : (parsed.codedImages[0]?.properties ?? parsed.properties)

const isAlphaAuxiliary = (property: Property): boolean =>
  property.type === 'auxC' && ALPHA_AUXILIARY_TYPES.has(property.auxiliaryType)

const findHeifAlphaItemId = (parsed: ParsedHeif): number | undefined => {
  const alphaItemIds = [...parsed.meta.items.keys()].filter((itemId) =>
    propertiesFor(parsed.meta, itemId).some(isAlphaAuxiliary),
  )
  const linked = parsed.meta.references.flatMap((reference) => {
    if (reference.type !== 'auxl') return []
    if (
      alphaItemIds.includes(reference.fromItemId) &&
      reference.toItemIds.includes(parsed.primaryItemId)
    ) {
      return [reference.fromItemId]
    }
    if (
      reference.fromItemId === parsed.primaryItemId &&
      reference.toItemIds.some((itemId) => alphaItemIds.includes(itemId))
    ) {
      return reference.toItemIds.filter((itemId) => alphaItemIds.includes(itemId))
    }
    return []
  })
  const unique = [...new Set(linked.length > 0 ? linked : alphaItemIds)]
  if (unique.length > 1) throw invalidInput('HEIF primary image has multiple alpha auxiliary items')
  return unique[0]
}

const heifAlphaIsPremultiplied = (parsed: ParsedHeif, alphaItemId: number): boolean =>
  parsed.meta.references.some(
    (reference) =>
      reference.type === 'prem' &&
      ((reference.fromItemId === parsed.primaryItemId &&
        reference.toItemIds.includes(alphaItemId)) ||
        (reference.fromItemId === alphaItemId &&
          reference.toItemIds.includes(parsed.primaryItemId))),
  )

type HeifAlphaSource =
  | { readonly coded: CodedImageDescription; readonly itemId: number; readonly kind: 'direct' }
  | {
      readonly codedImages: readonly CodedImageDescription[]
      readonly grid: GridLayout
      readonly itemId: number
      readonly kind: 'grid'
    }

const resolveHeifAlphaSource = async (parsed: ParsedHeif): Promise<HeifAlphaSource | undefined> => {
  const alphaItemId = findHeifAlphaItemId(parsed)
  if (alphaItemId === undefined) return undefined
  const coded = resolveCodedPrimary(parsed.meta, alphaItemId)
  if (coded.type === 'grid') {
    const derived = await codedGridFromItem(parsed.reader, parsed.meta, coded.itemId)
    return {
      kind: 'grid',
      itemId: alphaItemId,
      codedImages: derived.codedImages,
      grid: derived.grid,
    }
  }
  return {
    kind: 'direct',
    itemId: alphaItemId,
    coded: codedImageDescription(parsed.meta, coded.itemId),
  }
}

const metadataItem = (
  parsed: ParsedHeif,
  match: string | ((item: { readonly contentType?: string; readonly type: string }) => boolean),
):
  | { readonly contentEncoding?: string; readonly id: number; readonly protectionIndex: number }
  | undefined => {
  const candidates = [...parsed.meta.items.values()].filter((item) =>
    typeof match === 'string' ? item.type === match : match(item),
  )
  const linked = candidates.filter((item) =>
    parsed.meta.references.some(
      (reference) =>
        reference.type === 'cdsc' &&
        reference.fromItemId === item.id &&
        reference.toItemIds.includes(parsed.primaryItemId),
    ),
  )
  const usable = linked.length > 0 ? linked : candidates
  const label = typeof match === 'string' ? match : 'XMP'
  if (usable.length > 1) throw invalidInput(`HEIF contains multiple ${label} metadata items`)
  const item = usable[0]
  return item
    ? {
        id: item.id,
        protectionIndex: item.protectionIndex,
        ...(item.contentEncoding === undefined ? {} : { contentEncoding: item.contentEncoding }),
      }
    : undefined
}

const readMetadataItem = async (parsed: ParsedHeif, itemId: number): Promise<Uint8Array> => {
  const item = itemRanges(parsed.reader, parsed.meta, itemId)
  if (item.length > MAX_PRESERVED_METADATA_BYTES) {
    throw invalidInput(`HEIF metadata item ${itemId} is unreasonably large`)
  }
  return readAcrossRanges(parsed.reader.source, item.ranges, 0, item.length)
}

const preservedExif = async (parsed: ParsedHeif): Promise<Uint8Array | undefined> => {
  const item = metadataItem(parsed, 'Exif')
  if (!item) return undefined
  if (item.protectionIndex !== 0) {
    throw unsupportedOperation('Protected HEIF EXIF metadata is unsupported')
  }
  const data = await readMetadataItem(parsed, item.id)
  if (data.byteLength < 12) throw invalidInput('HEIF EXIF item is truncated')
  const tiffOffset = checkedAdd(4, uint32BigEndian(data, 0), 'HEIF EXIF offset overflows')
  const littleEndian = data[tiffOffset] === 0x49 && data[tiffOffset + 1] === 0x49
  const bigEndian = data[tiffOffset] === 0x4d && data[tiffOffset + 1] === 0x4d
  const magic = littleEndian
    ? (data[tiffOffset + 2] ?? 0) + (data[tiffOffset + 3] ?? 0) * 256
    : (data[tiffOffset + 2] ?? 0) * 256 + (data[tiffOffset + 3] ?? 0)
  if (tiffOffset + 8 > data.byteLength || (!littleEndian && !bigEndian) || magic !== 42) {
    throw invalidInput('HEIF EXIF item has an invalid TIFF header')
  }
  return data.slice(tiffOffset)
}

const preservedXmp = async (parsed: ParsedHeif): Promise<Uint8Array | undefined> => {
  const item = metadataItem(
    parsed,
    (candidate) => candidate.type === 'mime' && candidate.contentType === XMP_CONTENT_TYPE,
  )
  if (!item) return undefined
  if (item.protectionIndex !== 0) {
    throw unsupportedOperation('Protected HEIF XMP metadata is unsupported')
  }
  if (item.contentEncoding) {
    throw unsupportedOperation('Compressed HEIF XMP metadata is unsupported')
  }
  const data = await readMetadataItem(parsed, item.id)
  if (data.byteLength === 0) throw invalidInput('HEIF XMP item is empty')
  return data
}

const preservedHeifMetadata = async (
  source: ImageSource,
  limits: ImageLimits,
  options?: Readonly<MetadataPreservationOptions>,
): Promise<PreservedMetadata> => {
  const parsed = await parseHeif(source)
  validateImageDimensions(parsed.dimensions.width, parsed.dimensions.height, 1, limits)
  const keepExif = options?.exif ?? true
  const keepIcc = options?.icc ?? true
  const keepXmp = options?.xmp === true
  const exif = keepExif ? await preservedExif(parsed) : undefined
  const icc = keepIcc ? oneProperty(colorPropertiesFor(parsed), 'colr')?.icc : undefined
  const xmp = keepXmp ? await preservedXmp(parsed) : undefined
  return {
    ...(exif === undefined ? {} : { exif }),
    ...(icc === undefined ? {} : { icc }),
    ...(xmp === undefined ? {} : { xmp }),
  }
}

const readLength = (data: Uint8Array): number => {
  let value = 0
  for (const part of data) value = value * 256 + part
  return value
}

export interface HeifCodedImageInspection {
  readonly configuration: HevcConfiguration
  readonly itemBytes: number
  readonly itemId: number
  readonly nalUnits: readonly HevcNalUnit[]
  readonly slices: readonly HevcSliceInspection[]
}

export interface HeifBitstreamInspection {
  readonly codedImages: readonly HeifCodedImageInspection[]
  readonly primaryItemId: number
  readonly primaryItemType: 'grid' | 'hvc1' | 'iden' | 'unci'
}

const hevcStillImageSupported = (
  configuration: HevcConfiguration,
  role: 'alpha' | 'color',
): boolean => {
  if (configuration.bitDepth > 10) return false
  const profile = configuration.profile
  const allowedProfile = profile === 1 || profile === 2 || profile === 3 || profile === 4
  if (!allowedProfile) return false
  const tenBit = profile === 2 && configuration.bitDepth === 10
  const eightBit = configuration.bitDepth === 8
  if (!eightBit && !tenBit) return false
  if (profile === 4 && !eightBit) return false
  if (role === 'alpha' && configuration.chromaSubsampling === '400') return true
  if (configuration.chromaSubsampling === '420') return true
  if (configuration.chromaSubsampling === '444' && eightBit) return true
  return false
}

const inspectHeifCodedImages = async (
  parsed: ParsedHeif,
  images: readonly CodedImageDescription[],
  role: 'alpha' | 'color',
): Promise<readonly HeifCodedImageInspection[]> => {
  const codedImages: HeifCodedImageInspection[] = []
  for (const coded of images) {
    const item = itemRanges(parsed.reader, parsed.meta, coded.itemId)
    if (item.length === 0) throw invalidInput(`HEIF item ${coded.itemId} payload is empty`)
    const nalUnits: HevcNalUnit[] = []
    let offset = 0
    while (offset < item.length) {
      if (nalUnits.length >= MAX_NAL_UNITS) {
        throw invalidInput(`HEIF item ${coded.itemId} contains too many NAL units`)
      }
      if (item.length - offset < coded.configuration.lengthSize) {
        throw invalidInput(`HEIF item ${coded.itemId} NAL length is truncated`)
      }
      const length = readLength(
        await readAcrossRanges(
          parsed.reader.source,
          item.ranges,
          offset,
          coded.configuration.lengthSize,
        ),
      )
      offset += coded.configuration.lengthSize
      if (length < 2 || length > MAX_NAL_BYTES || length > item.length - offset) {
        throw invalidInput(`HEIF item ${coded.itemId} NAL length is invalid`)
      }
      nalUnits.push(
        parseNalUnit(
          await readAcrossRanges(parsed.reader.source, item.ranges, offset, length),
          `HEIF item ${coded.itemId}`,
        ),
      )
      offset += length
    }
    if (nalUnits.some((nal) => nal.layerId !== 0)) {
      throw unsupportedOperation(`Multilayer HEIF item ${coded.itemId} is unsupported`)
    }
    if (
      coded.configuration.vps.some(
        (parameterSet) => parameterSet.maxLayers !== 1 || parameterSet.maxSubLayers !== 1,
      ) ||
      coded.configuration.sps.some((parameterSet) => parameterSet.maxSubLayers !== 1)
    ) {
      throw unsupportedOperation(
        `Multilayer or multi-sublayer HEIF item ${coded.itemId} is unsupported`,
      )
    }
    if (!hevcStillImageSupported(coded.configuration, role)) {
      throw unsupportedOperation(
        `HEIF item ${coded.itemId} uses an unsupported HEVC profile, chroma format, or bit depth`,
      )
    }
    const pictureNalUnits = nalUnits.filter((nal) => nal.type <= 31)
    if (pictureNalUnits.length === 0) {
      throw invalidInput(`HEIF item ${coded.itemId} contains no coded picture slices`)
    }
    if (pictureNalUnits.some((nal) => nal.type < 16 || nal.type > 23)) {
      throw unsupportedOperation(`Inter-predicted HEIF item ${coded.itemId} is unsupported`)
    }
    if (pictureNalUnits.some((nal) => nal.temporalId !== 0)) {
      throw invalidInput(`HEIF item ${coded.itemId} IRAP slices must have temporal ID zero`)
    }
    if (pictureNalUnits.some((nal) => nal.type !== pictureNalUnits[0]?.type)) {
      throw invalidInput(`HEIF item ${coded.itemId} slices have inconsistent NAL types`)
    }
    const slices = pictureNalUnits.map((nal) =>
      inspectHevcSlice(nal.data, nal.type, coded.configuration),
    )
    if (slices.filter((slice) => slice.firstInPicture).length !== 1 || !slices[0]?.firstInPicture) {
      throw invalidInput(`HEIF item ${coded.itemId} has an invalid first-slice declaration`)
    }
    for (let index = 1; index < slices.length; index += 1) {
      const previous = slices[index - 1]
      const current = slices[index]
      if (!previous || !current || current.address <= previous.address) {
        throw invalidInput(`HEIF item ${coded.itemId} slice addresses are not strictly increasing`)
      }
      if (current.ppsId !== slices[0]?.ppsId) {
        throw invalidInput(`HEIF item ${coded.itemId} slices reference inconsistent PPS IDs`)
      }
    }
    codedImages.push({
      configuration: coded.configuration,
      itemBytes: item.length,
      itemId: coded.itemId,
      nalUnits,
      slices,
    })
  }
  return codedImages
}

const inspectParsedHeifBitstream = async (parsed: ParsedHeif): Promise<HeifBitstreamInspection> => {
  return {
    codedImages: await inspectHeifCodedImages(parsed, parsed.codedImages, 'color'),
    primaryItemId: parsed.primaryItemId,
    primaryItemType: parsed.primaryItemType,
  }
}

export const inspectHeifBitstream = async (source: ImageSource): Promise<HeifBitstreamInspection> =>
  inspectParsedHeifBitstream(await parseHeif(source))

const inspectHeifMetadata = async (
  source: ImageSource,
  limits: ImageLimits,
): Promise<ImageMetadata> => {
  const parsed = await parseHeif(source)
  validateImageDimensions(parsed.dimensions.width, parsed.dimensions.height, 1, limits)
  for (const codedImage of parsed.codedImages) {
    validateImageDimensions(codedImage.dimensions.width, codedImage.dimensions.height, 1, limits)
  }
  const uncompressed = parsed.uncompressed
  const configuration = parsed.codedImages[0]?.configuration
  if (!configuration && !uncompressed)
    throw invalidInput('HEIF image has no coded image configuration')
  const color = oneProperty(parsed.properties, 'colr')
  const aperture = oneProperty(parsed.properties, 'clap')?.aperture
  const dimensions = cleanApertureRegion(parsed.dimensions, aperture)
  let orientation = orientationFor(parsed.properties)
  if (orientation === undefined) {
    try {
      const exif = await preservedExif(parsed)
      orientation = exif === undefined ? undefined : exifOrientation(exif)
    } catch (error) {
      if (!(error instanceof ImageError)) throw error
      orientation = undefined
    }
  }
  const bitDepth = configuration?.bitDepth ?? uncompressed?.config.components[0]?.bitDepth ?? 8
  const chromaSubsampling =
    configuration?.chromaSubsampling ??
    (uncompressed?.config.sampling === 2
      ? '420'
      : uncompressed?.config.sampling === 1
        ? '422'
        : '444')
  return {
    format: 'heif',
    mimeType: 'image/heif',
    width: dimensions.width,
    height: dimensions.height,
    hasAlpha:
      findHeifAlphaItemId(parsed) !== undefined ||
      (uncompressed?.config.components.some((component) => component.type === 7) ?? false),
    frames: 1,
    bitDepth: bitDepth === 10 ? 10 : 8,
    chromaSubsampling,
    ...(configuration ? { codecProfile: configuration.profile } : {}),
    ...(color ? { colorSpace: color.colorSpace } : {}),
    ...(color?.icc
      ? {
          colorProfile: {
            kind: 'icc' as const,
            ...(color.iccDescription === undefined ? {} : { description: color.iccDescription }),
          },
        }
      : color?.nclx
        ? { colorProfile: { kind: 'nclx' as const, ...color.nclx } }
        : {}),
    ...(orientation !== undefined ? { orientation } : {}),
  }
}

const decodeRegion = (width: number, height: number, request: DecodeRequest): PixelRegion => {
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
    throw invalidInput('HEIF decode region is invalid')
  }
  return { x, y, width: outputWidth, height: outputHeight }
}

interface HeifColorConversion {
  readonly chromaLocation: 0 | 1 | 2 | 3 | 4 | 5
  readonly colorPrimaries: number | undefined
  readonly fullRange: boolean
  readonly matrixCoefficients: 1 | 5 | 6 | 9
  readonly transferCharacteristics: number | undefined
}

export interface HeifColorMatrixEvidence {
  readonly brands: readonly string[]
  readonly chromaSubsampling: ChromaSubsampling
  readonly colorPrimaries: number | undefined
  readonly hasIcc: boolean
  readonly nclxMatrix: number | undefined
  readonly profile: number
  readonly transferCharacteristics: number | undefined
  readonly vuiMatrix: number | undefined
}

const chromaLocationValue = (value: number | undefined): 0 | 1 | 2 | 3 | 4 | 5 => {
  if (value === undefined) return 0
  if (value === 0 || value === 1 || value === 2 || value === 3 || value === 4 || value === 5) {
    return value
  }
  throw unsupportedOperation(`Unsupported HEVC chroma sample location: ${value}`)
}

const matrixCoefficientValue = (value: number): 1 | 5 | 6 | 9 => {
  if (value === 1 || value === 5 || value === 6 || value === 9) return value
  throw unsupportedOperation(`Unsupported HEIF color matrix: ${value}`)
}

const specifiedColorValue = (
  containerValue: number | undefined,
  bitstreamValue: number | undefined,
): number | undefined =>
  containerValue !== undefined && containerValue !== 2 ? containerValue : bitstreamValue

export const resolveHeifColorMatrix = (evidence: HeifColorMatrixEvidence): 1 | 5 | 6 | 9 => {
  const nclxMatrix = evidence.nclxMatrix === 2 ? undefined : evidence.nclxMatrix
  const vuiMatrix = evidence.vuiMatrix === 2 ? undefined : evidence.vuiMatrix
  if (nclxMatrix !== undefined && vuiMatrix !== undefined && nclxMatrix !== vuiMatrix) {
    throw unsupportedOperation(
      `Conflicting HEIF color matrices: nclx ${nclxMatrix}, VUI ${vuiMatrix}`,
    )
  }
  const declaredMatrix = nclxMatrix ?? vuiMatrix
  if (declaredMatrix !== undefined) return matrixCoefficientValue(declaredMatrix)

  const sdrPrimaries =
    evidence.colorPrimaries === undefined ||
    evidence.colorPrimaries === 1 ||
    evidence.colorPrimaries === 2
  const sdrTransfer =
    evidence.transferCharacteristics === undefined ||
    evidence.transferCharacteristics === 2 ||
    evidence.transferCharacteristics === 13
  const compatibleProfile =
    evidence.profile === 1 || evidence.profile === 3 || evidence.profile === 4
  const hevcStillImageBrand = evidence.brands.some((brand) => HEVC_BRANDS.has(brand))
  const compatibleChroma =
    evidence.chromaSubsampling === '420' || evidence.chromaSubsampling === '444'
  if (
    compatibleChroma &&
    compatibleProfile &&
    hevcStillImageBrand &&
    (evidence.hasIcc || (sdrPrimaries && sdrTransfer))
  ) {
    // This is the HEIF/libheif SDR compatibility convention, not a generic
    // YCbCr default. It is deliberately gated by codec family, profile,
    // subsampling, and SDR/ICC evidence so ambiguous HDR and other profiles fail.
    return 6
  }
  throw unsupportedOperation('Unresolved HEIF color matrix')
}

const colorConversionFor = (
  properties: readonly Property[],
  sequence: HevcSpsInspection,
  configuration: HevcConfiguration,
  brands: readonly string[],
): HeifColorConversion => {
  const colorProperty = oneProperty(properties, 'colr')
  const nclx = colorProperty?.nclx
  const topLocation = sequence.vui?.chromaLocationTop
  const bottomLocation = sequence.vui?.chromaLocationBottom
  if (topLocation !== undefined && bottomLocation !== undefined && topLocation !== bottomLocation) {
    throw unsupportedOperation('Different top and bottom HEVC chroma locations are unsupported')
  }
  const colorPrimaries = specifiedColorValue(nclx?.primaries, sequence.vui?.colorPrimaries)
  const transferCharacteristics = specifiedColorValue(
    nclx?.transferCharacteristics,
    sequence.vui?.transferCharacteristics,
  )
  return {
    fullRange: nclx?.fullRange ?? sequence.vui?.fullRange ?? false,
    colorPrimaries,
    matrixCoefficients: resolveHeifColorMatrix({
      brands,
      chromaSubsampling: configuration.chromaSubsampling,
      colorPrimaries,
      hasIcc: colorProperty?.icc !== undefined,
      nclxMatrix: nclx?.matrixCoefficients,
      profile: configuration.profile,
      transferCharacteristics,
      vuiMatrix: sequence.vui?.matrixCoefficients,
    }),
    transferCharacteristics,
    chromaLocation: chromaLocationValue(topLocation ?? bottomLocation),
  }
}

const clampByte = (value: number): number => Math.max(0, Math.min(255, Math.round(value)))

const sampleHevcChroma = (
  plane: Uint16Array,
  width: number,
  height: number,
  x: number,
  y: number,
  _location: HeifColorConversion['chromaLocation'],
): number => plane[Math.min(height - 1, y >>> 1) * width + Math.min(width - 1, x >>> 1)] ?? 0

const samplePictureChroma = (
  picture: DecodedHevcPicture,
  plane: Uint16Array,
  x: number,
  y: number,
  location: HeifColorConversion['chromaLocation'],
): number => {
  if (picture.chromaFormat === 3) {
    return (
      plane[Math.min(picture.height - 1, y) * picture.width + Math.min(picture.width - 1, x)] ?? 0
    )
  }
  return sampleHevcChroma(
    plane,
    Math.ceil(picture.width / 2),
    Math.ceil(picture.height / 2),
    x,
    y,
    location,
  )
}

interface HeifRgbaCoefficients {
  readonly blueChroma: number
  readonly blueGreenChroma: number
  readonly chromaCenter: number
  readonly chromaRange: number
  readonly lumaOffset: number
  readonly lumaRange: number
  readonly redChroma: number
  readonly redGreenChroma: number
}

const rgbaCoefficients = (color: HeifColorConversion, bitDepth: 8 | 10): HeifRgbaCoefficients => {
  const depthShift = bitDepth - 8
  const redWeight =
    color.matrixCoefficients === 1 ? 0.2126 : color.matrixCoefficients === 9 ? 0.2627 : 0.299
  const blueWeight =
    color.matrixCoefficients === 1 ? 0.0722 : color.matrixCoefficients === 9 ? 0.0593 : 0.114
  const greenWeight = 1 - redWeight - blueWeight
  return {
    lumaOffset: color.fullRange ? 0 : 16 << depthShift,
    lumaRange: (color.fullRange ? 255 : 219) << depthShift,
    chromaRange: (color.fullRange ? 255 : 224) << depthShift,
    chromaCenter: 128 << depthShift,
    redChroma: 2 * (1 - redWeight),
    blueChroma: 2 * (1 - blueWeight),
    redGreenChroma: (2 * redWeight * (1 - redWeight)) / greenWeight,
    blueGreenChroma: (2 * blueWeight * (1 - blueWeight)) / greenWeight,
  }
}

const TONE_MAP_LUT_MAX = 4096
interface HeifHlgDisplayMap {
  readonly encodedToLinear: Float32Array
  readonly linearToSrgb: Uint8Array
  readonly rec2020ToSrgb: boolean
}

const hlgToLinear = (encoded: number): number => {
  const a = 0.17883277
  const b = 1 - 4 * a
  const c = 0.5 - a * Math.log(4 * a)
  return encoded <= 0.5 ? (encoded * encoded) / 3 : (Math.exp((encoded - c) / a) + b) / 12
}

const createHeifHlgDisplayMap = (
  color: HeifColorConversion,
  bitDepth: 8 | 10,
): HeifHlgDisplayMap | undefined => {
  if (bitDepth !== 10) return undefined
  const transfer = color.transferCharacteristics
  if (transfer !== 18) return undefined
  const encodedToLinear = new Float32Array(TONE_MAP_LUT_MAX + 1)
  const linearToSrgb = new Uint8Array(TONE_MAP_LUT_MAX + 1)
  for (let index = 0; index <= TONE_MAP_LUT_MAX; index += 1) {
    const encoded = index / TONE_MAP_LUT_MAX
    encodedToLinear[index] = hlgToLinear(encoded)
    const srgb = encoded <= 0.0031308 ? encoded * 12.92 : 1.055 * encoded ** (1 / 2.4) - 0.055
    linearToSrgb[index] = clampByte(srgb * 255)
  }
  return {
    encodedToLinear,
    linearToSrgb,
    rec2020ToSrgb: color.colorPrimaries === 9,
  }
}

const lookupLinear = (table: Float32Array, value: number): number =>
  table[Math.max(0, Math.min(TONE_MAP_LUT_MAX, Math.round(value * TONE_MAP_LUT_MAX)))] ?? 0

const lookupSrgb = (table: Uint8Array, value: number): number =>
  table[Math.max(0, Math.min(TONE_MAP_LUT_MAX, Math.round(value * TONE_MAP_LUT_MAX)))] ?? 0

const samplePqDisplayChroma = (
  plane: Uint16Array,
  width: number,
  height: number,
  x: number,
  y: number,
): number => plane[Math.min(height - 1, y >>> 1) * width + Math.min(width - 1, x >>> 1)] ?? 0

const writeHevcRgbaPixel = (
  picture: DecodedHevcPicture,
  color: HeifColorConversion,
  coefficients: HeifRgbaCoefficients,
  sourceX: number,
  sourceY: number,
  data: Uint8Array,
  target: number,
): void => {
  const luma = picture.y[sourceY * picture.width + sourceX] ?? 0
  const cb =
    samplePictureChroma(picture, picture.u, sourceX, sourceY, color.chromaLocation) -
    coefficients.chromaCenter
  const cr =
    samplePictureChroma(picture, picture.v, sourceX, sourceY, color.chromaLocation) -
    coefficients.chromaCenter
  const adjustedLuma = (luma - coefficients.lumaOffset) / coefficients.lumaRange
  const adjustedCb = cb / coefficients.chromaRange
  const adjustedCr = cr / coefficients.chromaRange
  data[target] = clampByte((adjustedLuma + coefficients.redChroma * adjustedCr) * 255)
  data[target + 1] = clampByte(
    (adjustedLuma -
      coefficients.redGreenChroma * adjustedCr -
      coefficients.blueGreenChroma * adjustedCb) *
      255,
  )
  data[target + 2] = clampByte((adjustedLuma + coefficients.blueChroma * adjustedCb) * 255)
  data[target + 3] = 255
}

const writeHevcHlgDisplayRgbaPixel = (
  picture: DecodedHevcPicture,
  color: HeifColorConversion,
  coefficients: HeifRgbaCoefficients,
  displayMap: HeifHlgDisplayMap,
  sourceX: number,
  sourceY: number,
  data: Uint8Array,
  target: number,
): void => {
  const chromaWidth = Math.ceil(picture.width / 2)
  const chromaHeight = Math.ceil(picture.height / 2)
  const luma = picture.y[sourceY * picture.width + sourceX] ?? 0
  const cb =
    sampleHevcChroma(picture.u, chromaWidth, chromaHeight, sourceX, sourceY, color.chromaLocation) -
    coefficients.chromaCenter
  const cr =
    sampleHevcChroma(picture.v, chromaWidth, chromaHeight, sourceX, sourceY, color.chromaLocation) -
    coefficients.chromaCenter
  const adjustedLuma = (luma - coefficients.lumaOffset) / coefficients.lumaRange
  const adjustedCb = cb / coefficients.chromaRange
  const adjustedCr = cr / coefficients.chromaRange
  let red = lookupLinear(
    displayMap.encodedToLinear,
    adjustedLuma + coefficients.redChroma * adjustedCr,
  )
  let green = lookupLinear(
    displayMap.encodedToLinear,
    adjustedLuma -
      coefficients.redGreenChroma * adjustedCr -
      coefficients.blueGreenChroma * adjustedCb,
  )
  let blue = lookupLinear(
    displayMap.encodedToLinear,
    adjustedLuma + coefficients.blueChroma * adjustedCb,
  )
  if (displayMap.rec2020ToSrgb) {
    const sourceRed = red
    const sourceGreen = green
    const sourceBlue = blue
    red = 1.660491 * sourceRed - 0.587641 * sourceGreen - 0.07285 * sourceBlue
    green = -0.12455 * sourceRed + 1.1329 * sourceGreen - 0.008349 * sourceBlue
    blue = -0.018151 * sourceRed - 0.100579 * sourceGreen + 1.11873 * sourceBlue
  }
  const luminance = Math.max(0, 0.2126 * red + 0.7152 * green + 0.0722 * blue)
  const mappedLuminance = luminance / (1 + luminance) / 0.5
  const scale = luminance === 0 ? 0 : mappedLuminance / luminance
  data[target] = lookupSrgb(displayMap.linearToSrgb, red * scale)
  data[target + 1] = lookupSrgb(displayMap.linearToSrgb, green * scale)
  data[target + 2] = lookupSrgb(displayMap.linearToSrgb, blue * scale)
  data[target + 3] = 255
}

const writeHevcPqDisplayRgbaPixel = (
  picture: DecodedHevcPicture,
  coefficients: HeifRgbaCoefficients,
  sourceX: number,
  sourceY: number,
  data: Uint8Array,
  target: number,
): void => {
  const chromaWidth = Math.ceil(picture.width / 2)
  const chromaHeight = Math.ceil(picture.height / 2)
  const luma = picture.y[sourceY * picture.width + sourceX] ?? 0
  const cb =
    samplePqDisplayChroma(picture.u, chromaWidth, chromaHeight, sourceX, sourceY) -
    coefficients.chromaCenter
  const cr =
    samplePqDisplayChroma(picture.v, chromaWidth, chromaHeight, sourceX, sourceY) -
    coefficients.chromaCenter
  const adjustedLuma = (luma - coefficients.lumaOffset) / coefficients.lumaRange
  const adjustedCb = cb / coefficients.chromaRange
  const adjustedCr = cr / coefficients.chromaRange
  // Match libheif's displayed 8-bit compatibility path: preserve PQ code values,
  // apply the signaled YCbCr matrix, and hard-clip to the SDR display gamut.
  data[target] = clampByte((adjustedLuma + coefficients.redChroma * adjustedCr) * 255)
  data[target + 1] = clampByte(
    (adjustedLuma -
      coefficients.redGreenChroma * adjustedCr -
      coefficients.blueGreenChroma * adjustedCb) *
      255,
  )
  data[target + 2] = clampByte((adjustedLuma + coefficients.blueChroma * adjustedCb) * 255)
  data[target + 3] = 255
}

interface HeifAlphaPlane {
  readonly fullRange: boolean
  readonly originX: number
  readonly originY: number
  readonly picture: DecodedHevcPicture
  readonly premultiplied: boolean
  readonly sampleHeight: number
  readonly sampleWidth: number
}

const mapHeifAlphaCoordinate = (source: number, sourceSize: number, destSize: number): number => {
  if (sourceSize <= 0 || destSize <= 0) return 0
  if (sourceSize === destSize) return source
  return Math.min(destSize - 1, Math.floor((source * destSize) / sourceSize))
}

const sampleHeifAlpha = (
  picture: DecodedHevcPicture,
  x: number,
  y: number,
  fullRange: boolean,
): number => {
  const boundedX = Math.max(0, Math.min(picture.width - 1, x | 0))
  const boundedY = Math.max(0, Math.min(picture.height - 1, y | 0))
  const luma = picture.y[boundedY * picture.width + boundedX] ?? 0
  if (fullRange && picture.bitDepth === 8) return luma
  const shift = picture.bitDepth - 8
  const minimum = fullRange ? 0 : 16 << shift
  const range = fullRange ? (1 << picture.bitDepth) - 1 : 219 << shift
  return clampByte(((luma - minimum) * 255) / range)
}

const overlayHeifAlpha = (
  data: Uint8Array,
  alpha: HeifAlphaPlane,
  displayWidth: number,
  displayHeight: number,
  regionX: number,
  regionY: number,
  rowStart: number,
  blockHeight: number,
  regionWidth: number,
): void => {
  const sameSize = alpha.sampleWidth === displayWidth && alpha.sampleHeight === displayHeight
  for (let row = 0; row < blockHeight; row += 1) {
    const displayY = regionY + rowStart + row
    for (let x = 0; x < regionWidth; x += 1) {
      const displayX = regionX + x
      const alphaX = sameSize
        ? alpha.originX + displayX
        : alpha.originX + mapHeifAlphaCoordinate(displayX, displayWidth, alpha.sampleWidth)
      const alphaY = sameSize
        ? alpha.originY + displayY
        : alpha.originY + mapHeifAlphaCoordinate(displayY, displayHeight, alpha.sampleHeight)
      data[(row * regionWidth + x) * 4 + 3] = sampleHeifAlpha(
        alpha.picture,
        alphaX,
        alphaY,
        alpha.fullRange,
      )
    }
  }
  if (alpha.premultiplied) unpremultiplyRgba(data)
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

class HeifPixelDecoder implements ImageDecoder {
  readonly width: number
  readonly height: number
  readonly pixelFormat = 'rgba8' as const
  readonly capabilities = Object.freeze({
    sequential: true,
    regionDecode: false,
    scaledDecode: false,
    progressive: false,
  })
  readonly #aperture: PixelRegion
  readonly #color: HeifColorConversion
  readonly #coefficients: HeifRgbaCoefficients
  readonly #picture: DecodedHevcPicture
  readonly #pqDisplay: boolean
  readonly #hlgDisplay: HeifHlgDisplayMap | undefined
  readonly #alpha: HeifAlphaPlane | undefined

  constructor(
    picture: DecodedHevcPicture,
    aperture: PixelRegion,
    color: HeifColorConversion,
    alpha?: HeifAlphaPlane,
  ) {
    this.#picture = picture
    this.#aperture = aperture
    this.#color = color
    this.#coefficients = rgbaCoefficients(color, picture.bitDepth)
    this.#pqDisplay = picture.bitDepth === 10 && color.transferCharacteristics === 16
    this.#hlgDisplay = createHeifHlgDisplayMap(color, picture.bitDepth)
    this.#alpha = alpha
    this.width = aperture.width
    this.height = aperture.height
  }

  async *decode(request: DecodeRequest = {}): AsyncGenerator<PixelBlock> {
    const region = decodeRegion(this.width, this.height, request)
    const rowsPerBlock = 32
    for (let rowStart = 0; rowStart < region.height; rowStart += rowsPerBlock) {
      const blockHeight = Math.min(rowsPerBlock, region.height - rowStart)
      const stride = region.width * 4
      const data = new Uint8Array(stride * blockHeight)
      for (let row = 0; row < blockHeight; row += 1) {
        const sourceY = this.#aperture.y + region.y + rowStart + row
        if (this.#pqDisplay) {
          for (let x = 0; x < region.width; x += 1) {
            writeHevcPqDisplayRgbaPixel(
              this.#picture,
              this.#coefficients,
              this.#aperture.x + region.x + x,
              sourceY,
              data,
              (row * region.width + x) * 4,
            )
          }
        } else if (this.#hlgDisplay) {
          for (let x = 0; x < region.width; x += 1) {
            writeHevcHlgDisplayRgbaPixel(
              this.#picture,
              this.#color,
              this.#coefficients,
              this.#hlgDisplay,
              this.#aperture.x + region.x + x,
              sourceY,
              data,
              (row * region.width + x) * 4,
            )
          }
        } else {
          for (let x = 0; x < region.width; x += 1) {
            writeHevcRgbaPixel(
              this.#picture,
              this.#color,
              this.#coefficients,
              this.#aperture.x + region.x + x,
              sourceY,
              data,
              (row * region.width + x) * 4,
            )
          }
        }
      }
      if (this.#alpha) {
        overlayHeifAlpha(
          data,
          this.#alpha,
          this.width,
          this.height,
          region.x,
          region.y,
          rowStart,
          blockHeight,
          region.width,
        )
      }
      yield {
        x: 0,
        y: rowStart,
        width: region.width,
        height: blockHeight,
        stride,
        format: this.pixelFormat,
        data,
      }
    }
  }
}

const decodeCodedHeifPicture = (coded: HeifCodedImageInspection): DecodedHevcPicture => {
  const pictureNalUnits = coded.nalUnits.filter((nal) => nal.type <= 31)
  if (pictureNalUnits.length === 0) throw invalidInput('HEIF image has no coded picture slice')
  return decodeHevcIntraSlices(
    pictureNalUnits.map((nal) => ({ data: nal.data, type: nal.type })),
    coded.configuration,
  )
}

class HeifGridPixelDecoder implements ImageDecoder {
  readonly width: number
  readonly height: number
  readonly pixelFormat = 'rgba8' as const
  readonly capabilities = Object.freeze({
    sequential: true,
    regionDecode: true,
    scaledDecode: false,
    progressive: false,
  })
  readonly #aperture: PixelRegion
  readonly #codedImages: readonly HeifCodedImageInspection[]
  readonly #color: HeifColorConversion
  readonly #coefficients: HeifRgbaCoefficients
  readonly #grid: GridLayout
  readonly #pqDisplay: boolean
  readonly #hlgDisplay: HeifHlgDisplayMap | undefined
  readonly #alphaCodedImages: readonly HeifCodedImageInspection[] | undefined
  readonly #alphaFullRange: boolean
  readonly #alphaGrid: GridLayout | undefined
  readonly #alphaPicture: HeifAlphaPlane | undefined
  readonly #alphaPremultiplied: boolean

  constructor(
    codedImages: readonly HeifCodedImageInspection[],
    grid: GridLayout,
    aperture: PixelRegion,
    color: HeifColorConversion,
    alpha?: {
      readonly codedImages?: readonly HeifCodedImageInspection[]
      readonly fullRange?: boolean
      readonly grid?: GridLayout
      readonly picture?: HeifAlphaPlane
      readonly premultiplied?: boolean
    },
  ) {
    this.#codedImages = codedImages
    this.#grid = grid
    this.#aperture = aperture
    this.#color = color
    this.#alphaCodedImages = alpha?.codedImages
    this.#alphaGrid = alpha?.grid
    this.#alphaPicture = alpha?.picture
    this.#alphaFullRange = alpha?.fullRange ?? true
    this.#alphaPremultiplied = alpha?.premultiplied ?? false
    const bitDepth = codedImages[0]?.configuration.bitDepth
    if (bitDepth !== 8 && bitDepth !== 10) {
      throw unsupportedOperation(`Unsupported HEIF grid bit depth: ${bitDepth ?? 'none'}`)
    }
    this.#coefficients = rgbaCoefficients(color, bitDepth)
    this.#pqDisplay = bitDepth === 10 && color.transferCharacteristics === 16
    this.#hlgDisplay = createHeifHlgDisplayMap(color, bitDepth)
    this.width = aperture.width
    this.height = aperture.height
  }

  async *decode(request: DecodeRequest = {}): AsyncGenerator<PixelBlock> {
    const region = decodeRegion(this.width, this.height, request)
    const sourceRegion = {
      x: this.#aperture.x + region.x,
      y: this.#aperture.y + region.y,
      width: region.width,
      height: region.height,
    }
    const firstTileRow = Math.floor(sourceRegion.y / this.#grid.tileHeight)
    const lastTileRow = Math.floor(
      (sourceRegion.y + sourceRegion.height - 1) / this.#grid.tileHeight,
    )
    const firstTileColumn = Math.floor(sourceRegion.x / this.#grid.tileWidth)
    const lastTileColumn = Math.floor(
      (sourceRegion.x + sourceRegion.width - 1) / this.#grid.tileWidth,
    )
    for (let tileRow = firstTileRow; tileRow <= lastTileRow; tileRow += 1) {
      const pictures = new Map<number, DecodedHevcPicture>()
      const alphaPictures = new Map<number, DecodedHevcPicture>()
      for (let tileColumn = firstTileColumn; tileColumn <= lastTileColumn; tileColumn += 1) {
        const coded = this.#codedImages[tileRow * this.#grid.columns + tileColumn]
        if (!coded) throw invalidInput('HEIF grid tile is missing during reconstruction')
        const picture = decodeCodedHeifPicture(coded)
        if (picture.width !== this.#grid.tileWidth || picture.height !== this.#grid.tileHeight) {
          throw invalidInput('HEIF decoded grid tile dimensions are inconsistent')
        }
        pictures.set(tileColumn, picture)
        const alphaCoded =
          this.#alphaCodedImages?.[
            tileRow * (this.#alphaGrid?.columns ?? this.#grid.columns) + tileColumn
          ]
        if (alphaCoded) alphaPictures.set(tileColumn, decodeCodedHeifPicture(alphaCoded))
      }
      const firstPicture = pictures.get(firstTileColumn)
      if (!firstPicture) throw invalidInput('HEIF grid row has no decoded tiles')
      const sourceRowStart = Math.max(sourceRegion.y, tileRow * this.#grid.tileHeight)
      const sourceRowEnd = Math.min(
        sourceRegion.y + sourceRegion.height,
        (tileRow + 1) * this.#grid.tileHeight,
      )
      for (let sourceRow = sourceRowStart; sourceRow < sourceRowEnd; sourceRow += 32) {
        const blockHeight = Math.min(32, sourceRowEnd - sourceRow)
        const stride = sourceRegion.width * 4
        const data = new Uint8Array(stride * blockHeight)
        for (let row = 0; row < blockHeight; row += 1) {
          const sourceY = sourceRow + row
          if (this.#pqDisplay) {
            for (let x = 0; x < sourceRegion.width; x += 1) {
              const sourceX = sourceRegion.x + x
              const tileColumn = Math.floor(sourceX / this.#grid.tileWidth)
              const picture = pictures.get(tileColumn)
              if (!picture) throw invalidInput('HEIF grid tile is missing during output')
              writeHevcPqDisplayRgbaPixel(
                picture,
                this.#coefficients,
                sourceX - tileColumn * this.#grid.tileWidth,
                sourceY - tileRow * this.#grid.tileHeight,
                data,
                (row * sourceRegion.width + x) * 4,
              )
            }
          } else if (this.#hlgDisplay) {
            for (let x = 0; x < sourceRegion.width; x += 1) {
              const sourceX = sourceRegion.x + x
              const tileColumn = Math.floor(sourceX / this.#grid.tileWidth)
              const picture = pictures.get(tileColumn)
              if (!picture) throw invalidInput('HEIF grid tile is missing during output')
              writeHevcHlgDisplayRgbaPixel(
                picture,
                this.#color,
                this.#coefficients,
                this.#hlgDisplay,
                sourceX - tileColumn * this.#grid.tileWidth,
                sourceY - tileRow * this.#grid.tileHeight,
                data,
                (row * sourceRegion.width + x) * 4,
              )
            }
          } else {
            for (let x = 0; x < sourceRegion.width; x += 1) {
              const sourceX = sourceRegion.x + x
              const tileColumn = Math.floor(sourceX / this.#grid.tileWidth)
              const picture = pictures.get(tileColumn)
              if (!picture) throw invalidInput('HEIF grid tile is missing during output')
              writeHevcRgbaPixel(
                picture,
                this.#color,
                this.#coefficients,
                sourceX - tileColumn * this.#grid.tileWidth,
                sourceY - tileRow * this.#grid.tileHeight,
                data,
                (row * sourceRegion.width + x) * 4,
              )
            }
          }
        }
        if (this.#alphaPicture) {
          overlayHeifAlpha(
            data,
            this.#alphaPicture,
            this.width,
            this.height,
            region.x,
            region.y,
            sourceRow - sourceRegion.y,
            blockHeight,
            sourceRegion.width,
          )
        } else if (this.#alphaCodedImages) {
          for (let row = 0; row < blockHeight; row += 1) {
            const sourceY = sourceRow + row
            for (let x = 0; x < sourceRegion.width; x += 1) {
              const sourceX = sourceRegion.x + x
              const tileColumn = Math.floor(sourceX / this.#grid.tileWidth)
              const alphaPicture = alphaPictures.get(tileColumn)
              if (!alphaPicture) {
                throw invalidInput('HEIF grid alpha tile is missing during output')
              }
              const localX = sourceX - tileColumn * this.#grid.tileWidth
              const localY = sourceY - tileRow * this.#grid.tileHeight
              data[(row * sourceRegion.width + x) * 4 + 3] = sampleHeifAlpha(
                alphaPicture,
                mapHeifAlphaCoordinate(localX, this.#grid.tileWidth, alphaPicture.width),
                mapHeifAlphaCoordinate(localY, this.#grid.tileHeight, alphaPicture.height),
                this.#alphaFullRange,
              )
            }
          }
          if (this.#alphaPremultiplied) unpremultiplyRgba(data)
        }
        yield {
          x: 0,
          y: sourceRow - sourceRegion.y,
          width: sourceRegion.width,
          height: blockHeight,
          stride,
          format: this.pixelFormat,
          data,
        }
      }
    }
  }
}

const heifAlphaIsFullRange = (coded: CodedImageDescription, sequence: HevcSpsInspection): boolean =>
  oneProperty(coded.properties, 'colr')?.nclx?.fullRange ?? sequence.vui?.fullRange ?? false

const decodeHeifAlphaPlane = (
  parsed: ParsedHeif,
  coded: CodedImageDescription,
  inspection: HeifCodedImageInspection,
  originX: number,
  originY: number,
  alphaItemId: number,
): HeifAlphaPlane => {
  const picture = decodeCodedHeifPicture(inspection)
  const sequence = coded.configuration.sps[0]
  if (!sequence) throw invalidInput('HEIF alpha image has no sequence parameter set')
  if (picture.width !== sequence.codedWidth || picture.height !== sequence.codedHeight) {
    throw invalidInput('HEIF decoded alpha dimensions do not match its spatial extents')
  }
  return {
    picture,
    originX: originX + sequence.conformanceX,
    originY: originY + sequence.conformanceY,
    sampleWidth: coded.dimensions.width,
    sampleHeight: coded.dimensions.height,
    fullRange: heifAlphaIsFullRange(coded, sequence),
    premultiplied: heifAlphaIsPremultiplied(parsed, alphaItemId),
  }
}

class HeifUncompressedPixelDecoder implements ImageDecoder {
  readonly width: number
  readonly height: number
  readonly pixelFormat = 'rgba8' as const
  readonly capabilities = Object.freeze({
    sequential: true,
    regionDecode: true,
    scaledDecode: false,
    progressive: false,
  })
  readonly #pixels: Uint8Array
  readonly #aperture: PixelRegion
  readonly #imageWidth: number

  constructor(pixels: Uint8Array, imageWidth: number, aperture: PixelRegion) {
    this.#pixels = pixels
    this.#imageWidth = imageWidth
    this.#aperture = aperture
    this.width = aperture.width
    this.height = aperture.height
  }

  async *decode(request: DecodeRequest = {}): AsyncGenerator<PixelBlock> {
    const region = decodeRegion(this.width, this.height, request)
    const stride = region.width * 4
    for (let rowStart = 0; rowStart < region.height; rowStart += 32) {
      const blockHeight = Math.min(32, region.height - rowStart)
      const data = new Uint8Array(stride * blockHeight)
      for (let row = 0; row < blockHeight; row += 1) {
        const sourceY = this.#aperture.y + region.y + rowStart + row
        const sourceX = this.#aperture.x + region.x
        const start = (sourceY * this.#imageWidth + sourceX) * 4
        data.set(this.#pixels.subarray(start, start + stride), row * stride)
      }
      yield {
        x: 0,
        y: rowStart,
        width: region.width,
        height: blockHeight,
        stride,
        format: this.pixelFormat,
        data,
      }
    }
  }
}

const createHeifDecoder = async (
  source: ImageSource,
  limits: ImageLimits,
  options: Readonly<DecoderOptions> = {},
): Promise<ImageDecoder> => {
  const parsed = await parseHeif(source)
  validateImageDimensions(parsed.dimensions.width, parsed.dimensions.height, 1, limits)
  if (parsed.uncompressed) {
    const item = itemRanges(parsed.reader, parsed.meta, parsed.uncompressed.itemId)
    const payload = await readAcrossRanges(parsed.reader.source, item.ranges, 0, item.length)
    const nclx = oneProperty(parsed.properties, 'colr')?.nclx
    const pixels = await decodeUncompressedRgba(
      payload,
      parsed.uncompressed.config,
      parsed.dimensions.width,
      parsed.dimensions.height,
      nclx?.fullRange ?? true,
    )
    const aperture = cleanApertureRegion(
      parsed.dimensions,
      oneProperty(parsed.properties, 'clap')?.aperture,
    )
    const decoder: ImageDecoder = new HeifUncompressedPixelDecoder(
      pixels,
      parsed.dimensions.width,
      aperture,
    )
    const colorTransform = oneProperty(parsed.properties, 'colr')?.colorTransform
    return colorTransform && !options.preserveIcc
      ? new ColorManagedDecoder(decoder, colorTransform)
      : decoder
  }
  const alphaSource = await resolveHeifAlphaSource(parsed)
  const inspection = await inspectParsedHeifBitstream(parsed)
  const coded = inspection.codedImages[0]
  if (!coded) throw invalidInput('HEIF image has no coded image')
  const aperture = cleanApertureRegion(
    parsed.dimensions,
    oneProperty(parsed.properties, 'clap')?.aperture,
  )

  const sequence = coded.configuration.sps[0]
  if (!sequence) throw invalidInput('HEIF image has no sequence parameter set')
  const colorProperties = colorPropertiesFor(parsed)
  const color = colorConversionFor(colorProperties, sequence, coded.configuration, parsed.brands)
  let decoder: ImageDecoder
  if (parsed.grid) {
    let gridAlpha:
      | {
          readonly codedImages?: readonly HeifCodedImageInspection[]
          readonly fullRange?: boolean
          readonly grid?: GridLayout
          readonly picture?: HeifAlphaPlane
          readonly premultiplied?: boolean
        }
      | undefined
    if (alphaSource?.kind === 'grid') {
      if (
        alphaSource.grid.rows !== parsed.grid.rows ||
        alphaSource.grid.columns !== parsed.grid.columns
      ) {
        throw unsupportedOperation('HEIF grid alpha layout does not match the primary grid')
      }
      const alphaInspection = await inspectHeifCodedImages(parsed, alphaSource.codedImages, 'alpha')
      const firstAlpha = alphaSource.codedImages[0]
      const firstAlphaSequence = firstAlpha?.configuration.sps[0]
      if (!firstAlpha || !firstAlphaSequence) {
        throw invalidInput('HEIF grid alpha has no sequence parameter set')
      }
      gridAlpha = {
        codedImages: alphaInspection,
        grid: alphaSource.grid,
        fullRange: heifAlphaIsFullRange(firstAlpha, firstAlphaSequence),
        premultiplied: heifAlphaIsPremultiplied(parsed, alphaSource.itemId),
      }
    } else if (alphaSource?.kind === 'direct') {
      const alphaInspection = await inspectHeifCodedImages(parsed, [alphaSource.coded], 'alpha')
      const alphaCodedImage = alphaInspection[0]
      if (!alphaCodedImage) throw invalidInput('HEIF alpha auxiliary item is not coded')
      gridAlpha = {
        picture: decodeHeifAlphaPlane(
          parsed,
          alphaSource.coded,
          alphaCodedImage,
          0,
          0,
          alphaSource.itemId,
        ),
      }
    }
    decoder = new HeifGridPixelDecoder(
      inspection.codedImages,
      parsed.grid,
      aperture,
      color,
      gridAlpha,
    )
  } else {
    if (inspection.codedImages.length !== 1) {
      throw invalidInput('Direct HEIF primary image has multiple coded items')
    }
    if (alphaSource?.kind === 'grid') {
      throw unsupportedOperation('HEIF grid auxiliary alpha on a direct primary is unsupported')
    }
    const picture = decodeCodedHeifPicture(coded)
    if (picture.width !== sequence.codedWidth || picture.height !== sequence.codedHeight) {
      throw invalidInput('HEIF decoded picture dimensions do not match its spatial extents')
    }
    let alpha: HeifAlphaPlane | undefined
    if (alphaSource?.kind === 'direct') {
      const alphaInspection = await inspectHeifCodedImages(parsed, [alphaSource.coded], 'alpha')
      const alphaCodedImage = alphaInspection[0]
      if (!alphaCodedImage) throw invalidInput('HEIF alpha auxiliary item is not coded')
      const sameDisplay =
        alphaSource.coded.dimensions.width === aperture.width &&
        alphaSource.coded.dimensions.height === aperture.height
      alpha = decodeHeifAlphaPlane(
        parsed,
        alphaSource.coded,
        alphaCodedImage,
        sameDisplay ? aperture.x : 0,
        sameDisplay ? aperture.y : 0,
        alphaSource.itemId,
      )
    }
    decoder = new HeifPixelDecoder(
      picture,
      {
        ...aperture,
        x: aperture.x + sequence.conformanceX,
        y: aperture.y + sequence.conformanceY,
      },
      color,
      alpha,
    )
  }
  const colorTransform = oneProperty(colorProperties, 'colr')?.colorTransform
  return colorTransform && !options.preserveIcc
    ? new ColorManagedDecoder(decoder, colorTransform)
    : decoder
}

export const heifCodec: ImageCodec = {
  format: 'heif',
  mimeTypes: ['image/heif', 'image/heic'],
  minimumBytes: 32,
  detect(header) {
    const brands = detectIsobmffBrands(header)
    if (brands.some((brand) => AVIF_BRANDS.has(brand))) return false
    return brands.some((brand) => HEVC_BRANDS.has(brand) || GENERIC_HEIF_BRANDS.has(brand))
  },
  metadata: inspectHeifMetadata,
  preservedMetadata: preservedHeifMetadata,
  createDecoder: createHeifDecoder,
}

export const heicCodec = heifCodec
