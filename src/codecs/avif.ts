import type {
  ChromaSubsampling,
  DecodeRequest,
  ImageCodec,
  ImageDecoder,
  ImageMetadata,
} from '../codec.ts'
import { invalidInput, unsupportedOperation } from '../errors.ts'
import type { ImageLimits } from '../limits.ts'
import { validateImageDimensions } from '../limits.ts'
import type { PixelBlock } from '../pixel.ts'
import type { ImageSource } from '../source.ts'
import { readExactly } from '../source.ts'
import { av1ObuType, inspectAv1Bitstream } from './av1.ts'
import type { Av1Obu, Av1SequenceHeader } from './av1.ts'
import { parseAv1Frame } from './av1-frame.ts'
import { av1ToRgba, decodeRestrictedAv1Intra, type Av1DecodedFrame } from './av1-intra.ts'
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

const ALPHA_AUXILIARY_TYPES = new Set([
  'urn:mpeg:mpegB:cicp:systems:auxiliary:alpha',
  'urn:mpeg:hevc:2015:auxid:1',
])
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

type Property =
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
  const colorProperty = firstProperty(propertiesFor(meta, primaryItemId), 'colr')
  const colorTransform = colorProperty?.colorTransform
  const nclx = colorProperty?.nclx

  let colorItemIds: readonly number[]
  let grid: AvifGridDescription | undefined
  if (primaryType === 'av01') colorItemIds = [primaryItemId]
  else {
    grid = parseGrid(await readItemPayload(source, meta, primaryItemId))
    const dimensions = firstProperty(propertiesFor(meta, primaryItemId), 'ispe')
    if (!dimensions || dimensions.width !== grid.width || dimensions.height !== grid.height) {
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
      rotation: firstProperty(itemProperties, 'irot')?.angle ?? 0,
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
  const dimensions = firstProperty(primaryProperties, 'ispe')
  if (!dimensions) throw invalidInput('AVIF primary item has no spatial extents')
  validateImageDimensions(dimensions.width, dimensions.height, 1, limits)

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
  const rotation = firstProperty(primaryProperties, 'irot')
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
    width: dimensions.width,
    height: dimensions.height,
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

class AvifPixelDecoder implements ImageDecoder {
  readonly width: number
  readonly height: number
  readonly pixelFormat = 'rgba8' as const
  readonly capabilities = Object.freeze({
    sequential: true,
    regionDecode: false,
    scaledDecode: false,
    progressive: false,
  })
  readonly #pixels: Uint8Array

  constructor(width: number, height: number, pixels: Uint8Array) {
    this.width = width
    this.height = height
    this.#pixels = pixels
  }

  async *decode(request: DecodeRequest = {}): AsyncGenerator<PixelBlock> {
    const region = decodeRegion(this.width, this.height, request)
    const rowsPerBlock = 32
    for (let rowStart = 0; rowStart < region.height; rowStart += rowsPerBlock) {
      const blockHeight = Math.min(rowsPerBlock, region.height - rowStart)
      const stride = region.width * 4
      const data = new Uint8Array(stride * blockHeight)
      for (let row = 0; row < blockHeight; row += 1) {
        const sourceOffset = ((region.y + rowStart + row) * this.width + region.x) * 4
        data.set(this.#pixels.subarray(sourceOffset, sourceOffset + stride), row * stride)
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

const decodeCodedImage = (
  coded: AvifCodedImageInspection,
  limits: ImageLimits,
): Av1DecodedFrame => {
  validateImageDimensions(coded.width, coded.height, 1, limits)
  const frames = coded.obus.filter((obu) => obu.type === av1ObuType.frame)
  if (frames.length !== 1) {
    throw unsupportedOperation('Phase B2 requires one complete AV1 frame OBU per coded AVIF item')
  }
  const frame = parseAv1Frame(coded.sequence, frames[0]?.payload ?? new Uint8Array())
  if (frame.header.renderWidth !== coded.width || frame.header.renderHeight !== coded.height) {
    throw invalidInput(`AVIF item ${coded.itemId} dimensions do not match its AV1 frame`)
  }
  return decodeRestrictedAv1Intra(coded.sequence, frame)
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

const applyAlpha = (
  pixels: Uint8Array,
  width: number,
  height: number,
  colorRotation: number,
  alpha: AvifCodedImageInspection,
  alphaFrame: Av1DecodedFrame,
  premultiplied: boolean,
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
  const rotatedWidth = (rotation & 1) === 0 ? alphaFrame.width : alphaFrame.height
  const rotatedHeight = (rotation & 1) === 0 ? alphaFrame.height : alphaFrame.width
  if (rotatedWidth !== width || rotatedHeight !== height) {
    throw invalidInput('AVIF alpha dimensions do not align with the color item')
  }
  if (rotation === 0) {
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        pixels[(y * width + x) * 4 + 3] = alphaFrame.y[y * alphaFrame.yStride + x] ?? 0
      }
    }
  } else if (rotation === 1) {
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const sourceX = alphaFrame.width - 1 - y
        const sourceY = x
        pixels[(y * width + x) * 4 + 3] = alphaFrame.y[sourceY * alphaFrame.yStride + sourceX] ?? 0
      }
    }
  } else if (rotation === 2) {
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const sourceX = alphaFrame.width - 1 - x
        const sourceY = alphaFrame.height - 1 - y
        pixels[(y * width + x) * 4 + 3] = alphaFrame.y[sourceY * alphaFrame.yStride + sourceX] ?? 0
      }
    }
  } else {
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const sourceX = y
        const sourceY = alphaFrame.height - 1 - x
        pixels[(y * width + x) * 4 + 3] = alphaFrame.y[sourceY * alphaFrame.yStride + sourceX] ?? 0
      }
    }
  }
  if (premultiplied) unpremultiplyRgba(pixels)
}

const decodeGrid = (inspection: AvifBitstreamInspection, limits: ImageLimits): Uint8Array => {
  const grid = inspection.grid
  if (!grid) throw invalidInput('AVIF grid description is missing')
  if (inspection.alphaItemId !== undefined) {
    throw unsupportedOperation('Phase B2 does not yet decode AVIF grids with alpha')
  }
  const output = new Uint8Array(grid.width * grid.height * 4)
  let tileWidth = 0
  let tileHeight = 0
  for (let index = 0; index < inspection.colorItemIds.length; index += 1) {
    const itemId = inspection.colorItemIds[index]
    const coded = inspection.codedImages.find((image) => image.itemId === itemId)
    if (!coded) throw invalidInput(`AVIF grid tile ${itemId ?? 'missing'} is not coded`)
    if (coded.rotation !== 0) {
      throw unsupportedOperation('Phase B2 does not support independently rotated AVIF grid tiles')
    }
    const frame = decodeCodedImage(coded, limits)
    if (index === 0) {
      tileWidth = frame.width
      tileHeight = frame.height
      if (
        grid.width <= (grid.columns - 1) * tileWidth ||
        grid.width > grid.columns * tileWidth ||
        grid.height <= (grid.rows - 1) * tileHeight ||
        grid.height > grid.rows * tileHeight
      ) {
        throw invalidInput('AVIF grid output dimensions do not match its tile geometry')
      }
    } else if (frame.width !== tileWidth || frame.height !== tileHeight) {
      throw invalidInput('AVIF grid tiles have inconsistent dimensions')
    }
    const tile = av1ToRgba(coded.sequence, frame, inspection.nclx)
    const column = index % grid.columns
    const row = Math.floor(index / grid.columns)
    const outputX = column * tileWidth
    const outputY = row * tileHeight
    const copyWidth = Math.min(tileWidth, grid.width - outputX)
    const copyHeight = Math.min(tileHeight, grid.height - outputY)
    for (let y = 0; y < copyHeight; y += 1) {
      const sourceOffset = y * tileWidth * 4
      const targetOffset = ((outputY + y) * grid.width + outputX) * 4
      output.set(tile.subarray(sourceOffset, sourceOffset + copyWidth * 4), targetOffset)
    }
  }
  return output
}

const createAvifDecoder = async (
  source: ImageSource,
  limits: ImageLimits,
): Promise<ImageDecoder> => {
  const metadata = await inspectAvif(source, limits)
  const inspection = await inspectAvifBitstreams(source)
  let pixels: Uint8Array
  if (inspection.primaryItemType === 'grid') {
    pixels = decodeGrid(inspection, limits)
  } else {
    if (inspection.colorItemIds.length !== 1) {
      throw invalidInput('Single-image AVIF has an invalid color item count')
    }
    const coded = inspection.codedImages.find(
      (image) => image.itemId === inspection.primaryItemId && image.role === 'color',
    )
    if (!coded) throw invalidInput('AVIF has no coded primary color item')
    const frame = decodeCodedImage(coded, limits)
    if (frame.width !== metadata.width || frame.height !== metadata.height) {
      throw invalidInput('AVIF display dimensions do not match its AV1 frame')
    }
    pixels = av1ToRgba(coded.sequence, frame, inspection.nclx)
    if (inspection.alphaItemId !== undefined) {
      const alpha = inspection.codedImages.find(
        (image) => image.itemId === inspection.alphaItemId && image.role === 'alpha',
      )
      if (!alpha) throw invalidInput('AVIF alpha auxiliary item is not coded')
      applyAlpha(
        pixels,
        metadata.width,
        metadata.height,
        coded.rotation,
        alpha,
        decodeCodedImage(alpha, limits),
        inspection.premultipliedAlpha,
      )
    }
  }
  const decoder = new AvifPixelDecoder(metadata.width, metadata.height, pixels)
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
