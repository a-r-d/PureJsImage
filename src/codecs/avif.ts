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
import { decodeRestrictedAv1Intra, yuv420ToRgba } from './av1-intra.ts'
import { ascii, uint16BigEndian, uint32BigEndian } from './helpers.ts'

const MAX_METADATA_BOX_BYTES = 16 * 1024 * 1024
const MAX_BOXES = 100_000
const ALPHA_AUXILIARY_TYPES = new Set([
  'urn:mpeg:mpegB:cicp:systems:auxiliary:alpha',
  'urn:mpeg:hevc:2015:auxid:1',
])

interface Box {
  readonly type: string
  readonly start: number
  readonly contentStart: number
  readonly end: number
}

interface Av1Configuration {
  readonly bitDepth: number
  readonly chromaSubsampling: ChromaSubsampling
  readonly level: number
  readonly profile: number
  readonly tier: number
}

interface ItemInfo {
  readonly id: number
  readonly type: string
}

interface ItemExtent {
  readonly offset: number
  readonly length: number
}

interface ItemLocation {
  readonly baseOffset: number
  readonly constructionMethod: 0 | 1
  readonly extents: readonly ItemExtent[]
  readonly itemId: number
}

type Property =
  | { readonly type: 'av1C'; readonly configuration: Av1Configuration }
  | { readonly type: 'auxC'; readonly auxiliaryType: string }
  | { readonly type: 'colr'; readonly colorSpace: string }
  | { readonly type: 'irot'; readonly angle: number }
  | { readonly type: 'ispe'; readonly width: number; readonly height: number }
  | { readonly type: 'pixi'; readonly bitDepth: number }
  | { readonly type: 'unknown' }

interface ItemReference {
  readonly type: string
  readonly fromItemId: number
  readonly toItemIds: readonly number[]
}

interface MetaDescription {
  primaryItemId?: number
  idat?: Box
  readonly items: Map<number, ItemInfo>
  readonly locations: Map<number, ItemLocation>
  readonly properties: Property[]
  readonly associations: Map<number, number[]>
  readonly references: ItemReference[]
}

const checkedAdd = (left: number, right: number, message: string): number => {
  const result = left + right
  if (!Number.isSafeInteger(result)) throw invalidInput(message)
  return result
}

const uint64BigEndian = (data: Uint8Array, offset: number): number => {
  const high = uint32BigEndian(data, offset)
  const low = uint32BigEndian(data, offset + 4)
  const value = BigInt(high) * 0x1_0000_0000n + BigInt(low)
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw invalidInput('AVIF box size exceeds the JavaScript safe integer range')
  }
  return Number(value)
}

const readBox = async (source: ImageSource, start: number, parentEnd: number): Promise<Box> => {
  if (parentEnd - start < 8) throw invalidInput(`AVIF box header is truncated at offset ${start}`)
  const header = await readExactly(source, start, Math.min(32, parentEnd - start))
  const size32 = uint32BigEndian(header, 0)
  const type = ascii(header, 4, 4)
  let headerSize = 8
  let size = size32

  if (size32 === 1) {
    if (header.byteLength < 16)
      throw invalidInput(`Extended AVIF box is truncated at offset ${start}`)
    size = uint64BigEndian(header, 8)
    headerSize = 16
  } else if (size32 === 0) {
    size = parentEnd - start
  }

  if (type === 'uuid') headerSize += 16
  if (size < headerSize) throw invalidInput(`AVIF ${type} box is smaller than its header`)
  const end = checkedAdd(start, size, `AVIF ${type} box end overflows`)
  if (end > parentEnd) throw invalidInput(`AVIF ${type} box extends beyond its parent`)

  return { type, start, contentStart: start + headerSize, end }
}

const childBoxes = async (
  source: ImageSource,
  start: number,
  end: number,
): Promise<readonly Box[]> => {
  const boxes: Box[] = []
  let offset = start
  while (offset < end) {
    if (boxes.length >= MAX_BOXES) throw invalidInput('AVIF contains too many boxes')
    const box = await readBox(source, offset, end)
    boxes.push(box)
    offset = box.end
  }
  return boxes
}

const payload = async (
  source: ImageSource,
  box: Box,
  maximum = MAX_METADATA_BOX_BYTES,
): Promise<Uint8Array> => {
  const length = box.end - box.contentStart
  if (length > maximum) throw invalidInput(`AVIF ${box.type} metadata box is unreasonably large`)
  return readExactly(source, box.contentStart, length)
}

const fullBox = (data: Uint8Array, type: string): { version: number; flags: number; offset: 4 } => {
  if (data.byteLength < 4) throw invalidInput(`AVIF ${type} full box is truncated`)
  return {
    version: data[0] ?? 0,
    flags: ((data[1] ?? 0) << 16) | ((data[2] ?? 0) << 8) | (data[3] ?? 0),
    offset: 4,
  }
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
      return {
        type: 'colr',
        colorSpace: colorSpaceName(
          uint16BigEndian(data, 4),
          uint16BigEndian(data, 6),
          uint16BigEndian(data, 8),
          ((data[10] ?? 0) & 0x80) !== 0,
        ),
      }
    }
    if (method === 'prof' || method === 'rICC') return { type: 'colr', colorSpace: 'icc' }
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

const parseIpco = async (source: ImageSource, box: Box, meta: MetaDescription): Promise<void> => {
  for (const propertyBox of await childBoxes(source, box.contentStart, box.end)) {
    meta.properties.push(await parseProperty(source, propertyBox))
  }
}

const parseIpma = async (source: ImageSource, box: Box, meta: MetaDescription): Promise<void> => {
  const data = await payload(source, box)
  const { version, flags } = fullBox(data, box.type)
  if (version > 1 || (flags & ~1) !== 0) {
    throw invalidInput('AVIF ipma box has an unsupported version or flags')
  }
  let offset = 4
  const entryCount = uint32BigEndian(data, offset)
  offset += 4
  const wideIndex = (flags & 1) !== 0

  for (let entry = 0; entry < entryCount; entry += 1) {
    const itemId = version < 1 ? uint16BigEndian(data, offset) : uint32BigEndian(data, offset)
    offset += version < 1 ? 2 : 4
    const associationCount = data[offset]
    if (associationCount === undefined) throw invalidInput('AVIF ipma entry is truncated')
    offset += 1
    const associations = meta.associations.get(itemId) ?? []
    for (let index = 0; index < associationCount; index += 1) {
      const encoded = wideIndex ? uint16BigEndian(data, offset) : data[offset]
      if (encoded === undefined) throw invalidInput('AVIF ipma association is truncated')
      offset += wideIndex ? 2 : 1
      const propertyIndex = encoded & (wideIndex ? 0x7fff : 0x7f)
      if (propertyIndex !== 0) associations.push(propertyIndex)
    }
    meta.associations.set(itemId, associations)
  }
  if (offset !== data.byteLength)
    throw invalidInput('AVIF ipma property associations have trailing data')
}

const parseIprp = async (source: ImageSource, box: Box, meta: MetaDescription): Promise<void> => {
  for (const child of await childBoxes(source, box.contentStart, box.end)) {
    if (child.type === 'ipco') await parseIpco(source, child, meta)
    else if (child.type === 'ipma') await parseIpma(source, child, meta)
  }
}

const parseIref = async (source: ImageSource, box: Box, meta: MetaDescription): Promise<void> => {
  const header = await readExactly(source, box.contentStart, 4)
  const { version, flags } = fullBox(header, box.type)
  if (version > 1 || flags !== 0) {
    throw invalidInput('AVIF iref box has an unsupported version or flags')
  }
  const idBytes = version === 0 ? 2 : 4
  for (const reference of await childBoxes(source, box.contentStart + 4, box.end)) {
    const data = await payload(source, reference)
    let offset = 0
    const fromItemId = idBytes === 2 ? uint16BigEndian(data, offset) : uint32BigEndian(data, offset)
    offset += idBytes
    const count = uint16BigEndian(data, offset)
    offset += 2
    const toItemIds: number[] = []
    for (let index = 0; index < count; index += 1) {
      toItemIds.push(idBytes === 2 ? uint16BigEndian(data, offset) : uint32BigEndian(data, offset))
      offset += idBytes
    }
    if (offset !== data.byteLength)
      throw invalidInput(`AVIF ${reference.type} reference is malformed`)
    meta.references.push({ type: reference.type, fromItemId, toItemIds })
  }
}

const parseIinf = async (source: ImageSource, box: Box, meta: MetaDescription): Promise<void> => {
  const headerLength = 4
  const header = await readExactly(source, box.contentStart, headerLength)
  const { version, flags } = fullBox(header, box.type)
  if (version > 1 || flags !== 0) {
    throw invalidInput('AVIF iinf box has an unsupported version or flags')
  }
  const countBytes = version === 0 ? 2 : 4
  const countData = await readExactly(source, box.contentStart + headerLength, countBytes)
  const expectedCount =
    countBytes === 2 ? uint16BigEndian(countData, 0) : uint32BigEndian(countData, 0)
  const children = await childBoxes(source, box.contentStart + headerLength + countBytes, box.end)
  if (children.length !== expectedCount) throw invalidInput('AVIF iinf item count does not match')

  for (const child of children) {
    if (child.type !== 'infe') throw invalidInput('AVIF iinf contains a non-infe child')
    const data = await payload(source, child)
    const itemHeader = fullBox(data, child.type)
    if ((itemHeader.version !== 2 && itemHeader.version !== 3) || (itemHeader.flags & ~1) !== 0) {
      throw invalidInput('AVIF infe box has an unsupported version or flags')
    }
    let offset = 4
    const id =
      itemHeader.version === 2 ? uint16BigEndian(data, offset) : uint32BigEndian(data, offset)
    offset += itemHeader.version === 2 ? 2 : 4
    const protectionIndex = uint16BigEndian(data, offset)
    offset += 2
    if (id === 0 || protectionIndex !== 0) throw invalidInput('AVIF item info is unsupported')
    const type = ascii(data, offset, 4)
    offset += 4
    if (data.indexOf(0, offset) === -1) throw invalidInput('AVIF item name is truncated')
    if (meta.items.has(id)) throw invalidInput(`AVIF contains duplicate item ID ${id}`)
    meta.items.set(id, { id, type })
  }
}

const sizedInteger = (data: Uint8Array, offset: number, size: number): number => {
  if (size === 0) return 0
  if (size !== 4 && size !== 8) throw invalidInput(`Unsupported AVIF integer size: ${size}`)
  let value = 0n
  for (let index = 0; index < size; index += 1) {
    const byte = data[offset + index]
    if (byte === undefined) throw invalidInput('AVIF item location is truncated')
    value = value * 256n + BigInt(byte)
  }
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw invalidInput('AVIF item location exceeds the JavaScript safe integer range')
  }
  return Number(value)
}

const parseIloc = async (source: ImageSource, box: Box, meta: MetaDescription): Promise<void> => {
  const data = await payload(source, box)
  const { version, flags } = fullBox(data, box.type)
  if (version > 2 || flags !== 0) {
    throw invalidInput('AVIF iloc box has an unsupported version or flags')
  }
  const firstSizes = data[4]
  const secondSizes = data[5]
  if (firstSizes === undefined || secondSizes === undefined) {
    throw invalidInput('AVIF iloc size fields are truncated')
  }
  const offsetSize = firstSizes >>> 4
  const lengthSize = firstSizes & 0x0f
  const baseOffsetSize = secondSizes >>> 4
  const indexSize = secondSizes & 0x0f
  for (const size of [offsetSize, lengthSize, baseOffsetSize, indexSize]) {
    if (size !== 0 && size !== 4 && size !== 8) {
      throw invalidInput(`Unsupported AVIF iloc field size: ${size}`)
    }
  }
  if (version === 0 && indexSize !== 0)
    throw invalidInput('AVIF iloc version 0 has reserved bits set')

  let offset = 6
  const itemCount = version < 2 ? uint16BigEndian(data, offset) : uint32BigEndian(data, offset)
  offset += version < 2 ? 2 : 4
  for (let itemIndex = 0; itemIndex < itemCount; itemIndex += 1) {
    const itemId = version < 2 ? uint16BigEndian(data, offset) : uint32BigEndian(data, offset)
    offset += version < 2 ? 2 : 4
    let constructionMethod: 0 | 1 = 0
    if (version > 0) {
      const encodedMethod = uint16BigEndian(data, offset)
      offset += 2
      if ((encodedMethod & 0xfff0) !== 0 || (encodedMethod & 0x0f) > 1) {
        throw invalidInput('AVIF iloc construction method is unsupported')
      }
      constructionMethod = (encodedMethod & 0x0f) as 0 | 1
    }
    const dataReferenceIndex = uint16BigEndian(data, offset)
    offset += 2
    if (itemId === 0 || dataReferenceIndex !== 0) {
      throw invalidInput('AVIF external or zero-ID item location is unsupported')
    }
    const baseOffset = sizedInteger(data, offset, baseOffsetSize)
    offset += baseOffsetSize
    const extentCount = uint16BigEndian(data, offset)
    offset += 2
    const extents: ItemExtent[] = []
    for (let extentIndex = 0; extentIndex < extentCount; extentIndex += 1) {
      offset += indexSize
      const extentOffset = sizedInteger(data, offset, offsetSize)
      offset += offsetSize
      const length = sizedInteger(data, offset, lengthSize)
      offset += lengthSize
      extents.push({ offset: extentOffset, length })
    }
    if (meta.locations.has(itemId))
      throw invalidInput(`AVIF contains duplicate iloc item ${itemId}`)
    meta.locations.set(itemId, { itemId, constructionMethod, baseOffset, extents })
  }
  if (offset !== data.byteLength) throw invalidInput('AVIF iloc box has trailing data')
}

const parseMeta = async (source: ImageSource, box: Box): Promise<MetaDescription> => {
  const header = await readExactly(source, box.contentStart, 4)
  const metaHeader = fullBox(header, box.type)
  if (metaHeader.version !== 0 || metaHeader.flags !== 0) {
    throw invalidInput('AVIF meta box has an unsupported version or flags')
  }
  const meta: MetaDescription = {
    items: new Map(),
    locations: new Map(),
    properties: [],
    associations: new Map(),
    references: [],
  }

  for (const child of await childBoxes(source, box.contentStart + 4, box.end)) {
    if (child.type === 'pitm') {
      const data = await payload(source, child, 8)
      const { version, flags } = fullBox(data, child.type)
      if (version > 1 || flags !== 0) {
        throw invalidInput('AVIF pitm box has an unsupported version or flags')
      }
      meta.primaryItemId = version === 0 ? uint16BigEndian(data, 4) : uint32BigEndian(data, 4)
    } else if (child.type === 'iinf') await parseIinf(source, child, meta)
    else if (child.type === 'iloc') await parseIloc(source, child, meta)
    else if (child.type === 'iprp') await parseIprp(source, child, meta)
    else if (child.type === 'iref') await parseIref(source, child, meta)
    else if (child.type === 'idat') {
      if (meta.idat) throw invalidInput('AVIF meta box contains multiple idat boxes')
      meta.idat = child
    }
  }
  return meta
}

const propertiesFor = (meta: MetaDescription, itemId: number): readonly Property[] => {
  return (meta.associations.get(itemId) ?? []).map((index) => {
    const property = meta.properties[index - 1]
    if (!property) throw invalidInput(`AVIF item references missing property ${index}`)
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

interface GridDescription {
  readonly columns: number
  readonly height: number
  readonly rows: number
  readonly width: number
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
  readonly itemId: number
  readonly obus: readonly Av1Obu[]
  readonly payloadBytes: number
  readonly role: 'alpha' | 'color'
  readonly sequence: Av1SequenceHeader
}

export interface AvifBitstreamInspection {
  readonly alphaItemId?: number
  readonly codedImages: readonly AvifCodedImageInspection[]
  readonly colorItemIds: readonly number[]
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

  let colorItemIds: readonly number[]
  if (primaryType === 'av01') colorItemIds = [primaryItemId]
  else {
    const grid = parseGrid(await readItemPayload(source, meta, primaryItemId))
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

  const roles = new Map<number, 'alpha' | 'color'>()
  for (const itemId of colorItemIds) roles.set(itemId, 'color')
  if (alphaItemId !== undefined) roles.set(alphaItemId, 'alpha')
  const codedImages: AvifCodedImageInspection[] = []
  for (const [itemId, role] of roles) {
    const configuration = firstProperty(propertiesFor(meta, itemId), 'av1C')?.configuration
    if (!configuration) throw invalidInput(`AVIF item ${itemId} has no av1C property`)
    const data = await readItemPayload(source, meta, itemId)
    const stream = inspectAv1Bitstream(data)
    codedImages.push({
      itemId,
      role,
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
    ...(alphaItemId !== undefined ? { alphaItemId } : {}),
    codedImages,
  }
}

const inspectAvif = async (source: ImageSource, limits: ImageLimits): Promise<ImageMetadata> => {
  const topLevel = await childBoxes(source, 0, source.size)
  const fileType = topLevel.find((box) => box.type === 'ftyp')
  const metaBox = topLevel.find((box) => box.type === 'meta')
  if (!fileType || !metaBox) throw invalidInput('AVIF requires ftyp and meta boxes')

  const brands = await payload(source, fileType, 4096)
  if (brands.byteLength < 8) throw invalidInput('AVIF ftyp box is truncated')
  let avifBrand = false
  let sequenceBrand = false
  for (let offset = 0; offset + 4 <= brands.byteLength; offset += 4) {
    const brand = ascii(brands, offset, 4)
    if (brand === 'avif' || brand === 'avis') avifBrand = true
    if (brand === 'avis') sequenceBrand = true
  }
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

const createAvifDecoder = async (
  source: ImageSource,
  limits: ImageLimits,
): Promise<ImageDecoder> => {
  const metadata = await inspectAvif(source, limits)
  const inspection = await inspectAvifBitstreams(source)
  if (inspection.primaryItemType !== 'av01' || inspection.colorItemIds.length !== 1) {
    throw unsupportedOperation('Phase B2 does not yet decode AVIF image grids')
  }
  if (inspection.alphaItemId !== undefined) {
    throw unsupportedOperation('Phase B2 does not yet decode AVIF alpha auxiliary items')
  }
  const coded = inspection.codedImages.find((image) => image.role === 'color')
  if (!coded) throw invalidInput('AVIF has no coded color item')
  const frames = coded.obus.filter((obu) => obu.type === av1ObuType.frame)
  if (frames.length !== 1) {
    throw unsupportedOperation('Phase B2 requires one complete AV1 frame OBU')
  }
  const frame = parseAv1Frame(coded.sequence, frames[0]?.payload ?? new Uint8Array())
  if (
    frame.header.renderWidth !== metadata.width ||
    frame.header.renderHeight !== metadata.height
  ) {
    throw invalidInput('AVIF display dimensions do not match its AV1 frame')
  }
  const pixels = yuv420ToRgba(coded.sequence, decodeRestrictedAv1Intra(coded.sequence, frame))
  return new AvifPixelDecoder(metadata.width, metadata.height, pixels)
}

export const avifCodec: ImageCodec = {
  format: 'avif',
  mimeTypes: ['image/avif'],
  minimumBytes: 32,
  detect(header) {
    if (header.byteLength < 12 || ascii(header, 4, 4) !== 'ftyp') return false
    for (let offset = 8; offset + 4 <= header.byteLength; offset += 4) {
      const brand = ascii(header, offset, 4)
      if (brand === 'avif' || brand === 'avis') return true
    }
    return false
  },
  metadata: inspectAvif,
  createDecoder: createAvifDecoder,
}
