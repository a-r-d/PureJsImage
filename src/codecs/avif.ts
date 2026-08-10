import type {
  ChromaSubsampling,
  DecodeRequest,
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
import { inspectAv1Bitstream } from './av1.ts'
import type { Av1Obu, Av1SequenceHeader } from './av1.ts'
import { parseAv1FrameObus, type Av1Frame } from './av1-frame.ts'
import {
  av1ToRgbaRegion,
  estimateRestrictedAv1RowWorkingBytes,
  estimateRestrictedAv1WorkingBytes,
  decodeRestrictedAv1Intra,
  decodeRestrictedAv1IntraRows,
  supportsRestrictedAv1IntraRows,
  type Av1DecodedFrame,
} from './av1-intra.ts'
import { ascii, uint16BigEndian, uint32BigEndian } from './helpers.ts'
import {
  ColorManagedDecoder,
  createDisplayP3Transform,
  inspectIccProfile,
  parseRgbIccTransform,
  type RgbIccTransform,
} from './icc.ts'
import {
  checkedAdd,
  createIsobmffReader,
  detectIsobmffBrands,
  parseBrands,
  parseFullBox,
  parseIsobmffMeta,
} from './isobmff.ts'
import type { IsobmffBox as Box, IsobmffMeta, IsobmffReader } from './isobmff.ts'
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
  | { readonly type: 'auxC'; readonly auxiliaryType: string }
  | {
      readonly type: 'colr'
      readonly colorSpace: string
      readonly colorTransform?: RgbIccTransform
      readonly iccDescription?: string
      readonly nclx?: NclxColor
    }
  | { readonly type: 'irot'; readonly angle: number }
  | { readonly type: 'ispe'; readonly width: number; readonly height: number }
  | { readonly type: 'pixi'; readonly bitDepth: number }
  | { readonly type: 'unknown' }

type MetaDescription = IsobmffMeta<Property>

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
        ...(primaries === 12 && transfer === 13
          ? { colorTransform: createDisplayP3Transform() }
          : {}),
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

const cleanApertureRegion = (
  source: { readonly width: number; readonly height: number },
  aperture: CleanAperture | undefined,
): PixelRegion => {
  if (!aperture) return { x: 0, y: 0, ...source }
  const width = aperture.width.numerator / aperture.width.denominator
  const height = aperture.height.numerator / aperture.height.denominator
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height)) {
    throw unsupportedOperation('Fractional AVIF clean-aperture dimensions are unsupported')
  }
  const horizontalOffset =
    aperture.horizontalOffset.numerator / aperture.horizontalOffset.denominator
  const verticalOffset = aperture.verticalOffset.numerator / aperture.verticalOffset.denominator
  const x = (source.width - width) / 2 + horizontalOffset
  const y = (source.height - height) / 2 + verticalOffset
  if (x < 0 || y < 0 || x + width > source.width || y + height > source.height) {
    throw invalidInput('AVIF clean aperture exceeds its source image')
  }
  if (!Number.isSafeInteger(x) || !Number.isSafeInteger(y)) {
    throw unsupportedOperation('Fractional AVIF clean-aperture origins are unsupported')
  }
  return { x, y, width, height }
}

const validateTransformProperties = (properties: readonly Property[]): void => {
  let seenRotation = false
  for (const property of properties) {
    if (property.type === 'irot') seenRotation = true
    else if (property.type === 'clap' && seenRotation) {
      throw invalidInput('AVIF transformative properties are associated in an invalid order')
    }
  }
  oneProperty(properties, 'clap')
  oneProperty(properties, 'irot')
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

export interface AvifCodedImageInspection {
  readonly configurationMatchesSequence: boolean
  readonly height: number
  readonly itemId: number
  readonly obus: readonly Av1Obu[]
  readonly payloadBytes: number
  readonly role: 'alpha' | 'color'
  readonly rotation: number
  readonly sequence: Av1SequenceHeader
  readonly width: number
}

export interface AvifBitstreamInspection {
  readonly alphaItemId?: number
  readonly codedImages: readonly AvifCodedImageInspection[]
  readonly colorItemIds: readonly number[]
  readonly displayRegion: PixelRegion
  readonly colorTransform?: RgbIccTransform
  readonly nclx?: NclxColor
  readonly grid?: AvifGridDescription
  readonly premultipliedAlpha: boolean
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
  const colorTransform = colorProperty?.colorTransform
  const nclx = colorProperty?.nclx

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

  const alphaItemIds = meta.references
    .filter((reference) => reference.type === 'auxl' && reference.toItemIds.includes(primaryItemId))
    .map((reference) => reference.fromItemId)
    .filter((itemId) =>
      propertiesFor(meta, itemId).some(
        (property) => property.type === 'auxC' && ALPHA_AUXILIARY_TYPES.has(property.auxiliaryType),
      ),
    )
  if (alphaItemIds.length > 1) throw invalidInput('AVIF has multiple alpha auxiliary items')
  const alphaItemId = alphaItemIds[0]
  if (alphaItemId !== undefined && meta.items.get(alphaItemId)?.type !== 'av01') {
    throw invalidInput('AVIF alpha auxiliary item is not AV1-coded')
  }
  if (alphaItemId !== undefined && colorItemIds.includes(alphaItemId)) {
    throw invalidInput('AVIF alpha auxiliary item is also referenced as color')
  }

  const premultipliedAlpha =
    alphaItemId !== undefined &&
    meta.references.some(
      (reference) =>
        reference.type === 'prem' &&
        reference.fromItemId === primaryItemId &&
        reference.toItemIds.includes(alphaItemId),
    )
  const roles = new Map<number, 'alpha' | 'color'>()
  for (const itemId of colorItemIds) roles.set(itemId, 'color')
  if (alphaItemId !== undefined) roles.set(alphaItemId, 'alpha')
  const codedImages: AvifCodedImageInspection[] = []
  for (const [itemId, role] of roles) {
    const itemProperties = propertiesFor(meta, itemId)
    const configuration = firstProperty(itemProperties, 'av1C')?.configuration
    if (!configuration) throw invalidInput(`AVIF item ${itemId} has no av1C property`)
    const dimensions = firstProperty(itemProperties, 'ispe')
    if (!dimensions) throw invalidInput(`AVIF item ${itemId} has no spatial extents`)
    const data = await readItemPayload(source, meta, itemId)
    const stream = inspectAv1Bitstream(data)
    codedImages.push({
      itemId,
      role,
      width: dimensions.width,
      height: dimensions.height,
      rotation: oneProperty(itemProperties, 'irot')?.angle ?? 0,
      configurationMatchesSequence: av1ConfigurationMatches(configuration, stream.sequence),
      payloadBytes: data.byteLength,
      obus: stream.obus,
      sequence: stream.sequence,
    })
  }

  return {
    primaryItemId,
    primaryItemType: primaryType,
    colorItemIds,
    premultipliedAlpha,
    displayRegion,
    ...(colorTransform ? { colorTransform } : {}),
    ...(grid ? { grid } : {}),
    ...(alphaItemId !== undefined ? { alphaItemId } : {}),
    ...(nclx ? { nclx } : {}),
    codedImages,
  }
}

const inspectAvif = async (source: ImageSource, limits: ImageLimits): Promise<ImageMetadata> => {
  const topLevel = await childBoxes(source, 0, source.size)
  const fileType = topLevel.find((box) => box.type === 'ftyp')
  const metaBox = topLevel.find((box) => box.type === 'meta')
  if (!fileType || !metaBox) throw invalidInput('AVIF requires ftyp and meta boxes')

  const brands = parseBrands(await payload(source, fileType, 4096), 'AVIF')
  const avifBrand = brands.some((brand) => brand === 'avif' || brand === 'avis')
  const sequenceBrand = brands.includes('avis')
  if (!avifBrand) throw invalidInput('File does not declare an AVIF brand')

  const meta = await parseMeta(source, metaBox)
  if (meta.primaryItemId === undefined) throw invalidInput('AVIF has no primary item')
  const primaryItemId = meta.primaryItemId
  const primaryProperties = propertiesFor(meta, primaryItemId)
  validateTransformProperties(primaryProperties)
  const dimensions = firstProperty(primaryProperties, 'ispe')
  if (!dimensions) throw invalidInput('AVIF primary item has no spatial extents')
  validateImageDimensions(dimensions.width, dimensions.height, 1, limits)
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
  const rotation = oneProperty(primaryProperties, 'irot')
  const hasAlpha = meta.references.some(
    (reference) =>
      reference.type === 'auxl' &&
      reference.toItemIds.includes(primaryItemId) &&
      propertiesFor(meta, reference.fromItemId).some(
        (property) => property.type === 'auxC' && ALPHA_AUXILIARY_TYPES.has(property.auxiliaryType),
      ),
  )
  const bitDepth = pixelInformation?.bitDepth ?? configuration?.bitDepth

  const orientation =
    rotation?.angle === 1 ? 8 : rotation?.angle === 2 ? 3 : rotation?.angle === 3 ? 6 : undefined
  return {
    format: 'avif',
    mimeType: 'image/avif',
    width: displayRegion.width,
    height: displayRegion.height,
    hasAlpha,
    ...(!sequenceBrand ? { frames: 1 } : {}),
    ...(bitDepth !== undefined ? { bitDepth } : {}),
    ...(configuration
      ? {
          chromaSubsampling: configuration.chromaSubsampling,
          codecProfile: configuration.profile,
        }
      : {}),
    ...(color ? { colorSpace: color.colorSpace } : {}),
    ...(color?.iccDescription !== undefined
      ? { colorProfile: { kind: 'icc' as const, description: color.iccDescription } }
      : color?.colorSpace === 'icc'
        ? { colorProfile: { kind: 'icc' as const } }
        : color?.nclx
          ? { colorProfile: { kind: 'nclx' as const, ...color.nclx } }
          : {}),
    ...(orientation !== undefined ? { orientation } : {}),
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

  constructor(
    coded: AvifCodedImageInspection,
    frame: Av1DecodedFrame,
    displayRegion: PixelRegion,
    color: NclxColor | undefined,
    alpha: AvifAlphaFrame | undefined,
    premultipliedAlpha: boolean,
  ) {
    this.width = displayRegion.width
    this.height = displayRegion.height
    this.#coded = coded
    this.#frame = frame
    this.#displayRegion = displayRegion
    this.#color = color
    this.#alpha = alpha
    this.#premultipliedAlpha = premultipliedAlpha
    if (alpha) validateAlphaFrame(frame.width, frame.height, coded.rotation, alpha)
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
      )
      if (this.#alpha) {
        applyAlphaRegion(
          data,
          { x: sourceX, y: sourceY, width: region.width, height: blockHeight },
          this.#coded.rotation,
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
  if (
    frame.header.upscaledWidth !== coded.width ||
    frame.header.frameHeight !== coded.height ||
    frame.header.renderWidth !== coded.width ||
    frame.header.renderHeight !== coded.height
  ) {
    throw invalidInput(`AVIF item ${coded.itemId} dimensions do not match its AV1 frame`)
  }
}

const parseCodedImageFrame = (coded: AvifCodedImageInspection, limits: ImageLimits): Av1Frame => {
  validateImageDimensions(coded.width, coded.height, 1, limits)
  const frame = parseAv1FrameObus(coded.sequence, coded.obus)
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

  constructor(
    coded: AvifCodedImageInspection,
    frame: Av1Frame,
    displayRegion: PixelRegion,
    color: NclxColor | undefined,
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
  colorRotation: number,
  alpha: AvifCodedImageInspection,
): void => {
  if (
    !alpha.sequence.monochrome ||
    alpha.sequence.bitDepth !== 8 ||
    !alpha.sequence.fullRange ||
    alpha.sequence.chromaSubsampling !== '400'
  ) {
    throw unsupportedOperation('Phase B2 supports full-range 8-bit monochrome AVIF alpha only')
  }
  const rotation = (alpha.rotation - colorRotation + 4) & 3
  const rotatedWidth = (rotation & 1) === 0 ? alpha.width : alpha.height
  const rotatedHeight = (rotation & 1) === 0 ? alpha.height : alpha.width
  if (rotatedWidth !== width || rotatedHeight !== height) {
    throw invalidInput('AVIF alpha dimensions do not align with the color item')
  }
}

const validateAlphaFrame = (
  width: number,
  height: number,
  colorRotation: number,
  alpha: AvifAlphaFrame,
): void => {
  validateAlphaCoding(width, height, colorRotation, alpha.coded)
  if (alpha.frame.width !== alpha.coded.width || alpha.frame.height !== alpha.coded.height) {
    throw invalidInput('AVIF alpha frame dimensions do not match its coded item')
  }
}

const applyAlphaRegion = (
  pixels: Uint8Array,
  region: PixelRegion,
  colorRotation: number,
  alpha: AvifAlphaFrame,
  premultiplied: boolean,
  scaleDenominator: 1 | 2 | 4 | 8 = 1,
): void => {
  const rotation = (alpha.coded.rotation - colorRotation + 4) & 3
  const storageHeight = Math.floor(alpha.frame.y.length / alpha.frame.yStride)
  if (scaleDenominator !== 1 && rotation !== 0) {
    throw unsupportedOperation('Scaled AVIF alpha decode requires aligned alpha orientation')
  }
  for (let localY = 0; localY < region.height; localY += 1) {
    const y = region.y + localY * scaleDenominator
    for (let localX = 0; localX < region.width; localX += 1) {
      const x = region.x + localX * scaleDenominator
      let sourceX = x
      let sourceY = y
      if (rotation === 1) {
        sourceX = alpha.frame.width - 1 - y
        sourceY = x
      } else if (rotation === 2) {
        sourceX = alpha.frame.width - 1 - x
        sourceY = alpha.frame.height - 1 - y
      } else if (rotation === 3) {
        sourceX = y
        sourceY = alpha.frame.height - 1 - x
      }
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
      pixels[(localY * region.width + localX) * 4 + 3] = sample
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

  constructor(
    coded: AvifCodedImageInspection,
    frame: Av1Frame,
    displayRegion: PixelRegion,
    color: NclxColor | undefined,
    alphaCoded: AvifCodedImageInspection,
    alphaFrame: Av1Frame,
    premultipliedAlpha: boolean,
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
        )
        applyAlphaRegion(
          data,
          { x: sourceX, y: blockSourceY, width: region.width, height: blockHeight },
          this.#coded.rotation,
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
  readonly #color: NclxColor | undefined
  readonly #displayRegion: PixelRegion
  readonly #grid: NonNullable<AvifBitstreamInspection['grid']>
  readonly #limits: ImageLimits
  readonly #tileHeight: number
  readonly #tiles: readonly AvifCodedImageInspection[]
  readonly #tileWidth: number

  constructor(inspection: AvifBitstreamInspection, limits: ImageLimits) {
    const grid = inspection.grid
    if (!grid) throw invalidInput('AVIF grid description is missing')
    if (inspection.alphaItemId !== undefined) {
      throw unsupportedOperation('Phase B2 does not yet decode AVIF grids with alpha')
    }
    if (inspection.colorItemIds.length !== grid.rows * grid.columns) {
      throw invalidInput('AVIF grid item count does not match its dimensions')
    }
    const tiles = inspection.colorItemIds.map((itemId) => {
      const coded = inspection.codedImages.find((image) => image.itemId === itemId)
      if (!coded) throw invalidInput(`AVIF grid tile ${itemId} is not coded`)
      if (coded.rotation !== 0) {
        throw unsupportedOperation(
          'Phase B2 does not support independently rotated AVIF grid tiles',
        )
      }
      return coded
    })
    const first = tiles[0]
    if (!first) throw invalidInput('AVIF grid has no coded tiles')
    for (const tile of tiles) {
      if (tile.width !== first.width || tile.height !== first.height) {
        throw invalidInput('AVIF grid tiles have inconsistent dimensions')
      }
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
    for (const tile of tiles) payloadBytes += tile.payloadBytes
    let maximumWorkingBytes = 0
    for (let row = 0; row < grid.rows; row += 1) {
      let workingBytes =
        payloadBytes + inspection.displayRegion.width * Math.min(32, grid.height) * 4
      for (let column = 0; column < grid.columns; column += 1) {
        const tile = tiles[row * grid.columns + column]
        if (!tile) throw invalidInput('AVIF grid tile layout is incomplete')
        const frame = parseCodedImageFrame(tile, limits)
        workingBytes += estimateRestrictedAv1WorkingBytes(tile.sequence, frame)
      }
      maximumWorkingBytes = Math.max(maximumWorkingBytes, workingBytes)
    }
    validateAvifWorkingBytes(maximumWorkingBytes)
    this.width = inspection.displayRegion.width
    this.height = inspection.displayRegion.height
    this.#color = inspection.nclx
    this.#displayRegion = inspection.displayRegion
    this.#grid = grid
    this.#limits = limits
    this.#tileHeight = first.height
    this.#tiles = tiles
    this.#tileWidth = first.width
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
      for (let column = firstColumn; column <= lastColumn; column += 1) {
        const coded = this.#tiles[tileRow * this.#grid.columns + column]
        if (!coded) throw invalidInput('AVIF grid tile layout is incomplete')
        decodedTiles.push(decodeCodedImage(coded, this.#limits))
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
          )
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

const createAvifDecoder = async (
  source: ImageSource,
  limits: ImageLimits,
): Promise<ImageDecoder> => {
  const metadata = await inspectAvif(source, limits)
  const inspection = await inspectAvifBitstreams(source)
  let decoder: ImageDecoder
  if (inspection.primaryItemType === 'grid') {
    decoder = new AvifGridDecoder(inspection, limits)
  } else {
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
      validateAlphaCoding(coded.width, coded.height, coded.rotation, alpha)
    }
    const colorRowsSupported = supportsRestrictedAv1IntraRows(parsedFrame)
    const alphaRowsSupported =
      !alpha ||
      (!!parsedAlphaFrame &&
        alpha.rotation === coded.rotation &&
        supportsRestrictedAv1IntraRows(parsedAlphaFrame))
    if (colorRowsSupported && alphaRowsSupported) {
      let workingBytes =
        coded.payloadBytes + estimateRestrictedAv1RowWorkingBytes(coded.sequence, parsedFrame)
      if (alpha && parsedAlphaFrame) {
        workingBytes +=
          alpha.payloadBytes +
          estimateRestrictedAv1RowWorkingBytes(alpha.sequence, parsedAlphaFrame)
      }
      validateAvifWorkingBytes(workingBytes)
      decoder =
        alpha && parsedAlphaFrame
          ? new AvifAlphaRowDecoder(
              coded,
              parsedFrame,
              inspection.displayRegion,
              inspection.nclx,
              alpha,
              parsedAlphaFrame,
              inspection.premultipliedAlpha,
            )
          : new AvifRowDecoder(coded, parsedFrame, inspection.displayRegion, inspection.nclx)
    } else {
      let workingBytes =
        coded.payloadBytes + estimateRestrictedAv1WorkingBytes(coded.sequence, parsedFrame)
      if (alpha && parsedAlphaFrame) {
        workingBytes +=
          alpha.payloadBytes + estimateRestrictedAv1WorkingBytes(alpha.sequence, parsedAlphaFrame)
      }
      validateAvifWorkingBytes(workingBytes)
      const frame = decodeRestrictedAv1Intra(coded.sequence, parsedFrame)
      if (frame.width !== coded.width || frame.height !== coded.height) {
        throw invalidInput('AVIF display dimensions do not match its AV1 frame')
      }
      const alphaFrame =
        alpha && parsedAlphaFrame
          ? { coded: alpha, frame: decodeRestrictedAv1Intra(alpha.sequence, parsedAlphaFrame) }
          : undefined
      decoder = new AvifFrameDecoder(
        coded,
        frame,
        inspection.displayRegion,
        inspection.nclx,
        alphaFrame,
        inspection.premultipliedAlpha,
      )
    }
  }
  if (
    metadata.width !== inspection.displayRegion.width ||
    metadata.height !== inspection.displayRegion.height
  ) {
    throw invalidInput('AVIF clean-aperture metadata is inconsistent')
  }
  return inspection.colorTransform
    ? new ColorManagedDecoder(decoder, inspection.colorTransform)
    : decoder
}

export const avifCodec: ImageCodec = {
  format: 'avif',
  mimeTypes: ['image/avif'],
  minimumBytes: 32,
  detect(header) {
    return detectIsobmffBrands(header).some((brand) => brand === 'avif' || brand === 'avis')
  },
  metadata: inspectAvif,
  createDecoder: createAvifDecoder,
}
