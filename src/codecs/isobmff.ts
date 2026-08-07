import { invalidInput } from '../errors.ts'
import type { ImageSource } from '../source.ts'
import { readExactly } from '../source.ts'
import { ascii, uint16BigEndian, uint32BigEndian } from './helpers.ts'

const MAX_BOXES = 100_000
const MAX_METADATA_BOX_BYTES = 16 * 1024 * 1024
const MAX_ITEM_EXTENTS = 4096

export interface IsobmffBox {
  readonly type: string
  readonly start: number
  readonly contentStart: number
  readonly end: number
}

export interface IsobmffReader {
  readonly context: string
  readonly source: ImageSource
  boxes(start: number, end: number): Promise<readonly IsobmffBox[]>
  payload(box: IsobmffBox, maximum?: number): Promise<Uint8Array>
}

export interface IsobmffItemInfo {
  readonly id: number
  readonly protectionIndex: number
  readonly type: string
}

export interface IsobmffItemExtent {
  readonly offset: number
  readonly length: number
}

export interface IsobmffItemLocation {
  readonly baseOffset: number
  readonly constructionMethod: 0 | 1
  readonly dataReferenceIndex: number
  readonly extents: readonly IsobmffItemExtent[]
  readonly itemId: number
}

export interface IsobmffPropertyAssociation {
  readonly essential: boolean
  readonly index: number
}

export interface IsobmffItemReference {
  readonly type: string
  readonly fromItemId: number
  readonly toItemIds: readonly number[]
}

export interface IsobmffMeta<Property> {
  primaryItemId?: number
  idat?: IsobmffBox
  readonly items: Map<number, IsobmffItemInfo>
  readonly locations: Map<number, IsobmffItemLocation>
  readonly properties: Property[]
  readonly associations: Map<number, IsobmffPropertyAssociation[]>
  readonly references: IsobmffItemReference[]
}

export type IsobmffPropertyParser<Property> = (
  reader: IsobmffReader,
  box: IsobmffBox,
) => Promise<Property>

export const checkedAdd = (left: number, right: number, message: string): number => {
  const result = left + right
  if (!Number.isSafeInteger(result)) throw invalidInput(message)
  return result
}

const uint64BigEndian = (data: Uint8Array, offset: number, context: string): number => {
  const high = uint32BigEndian(data, offset)
  const low = uint32BigEndian(data, offset + 4)
  const value = BigInt(high) * 0x1_0000_0000n + BigInt(low)
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw invalidInput(`${context} box size exceeds the JavaScript safe integer range`)
  }
  return Number(value)
}

export const createIsobmffReader = (source: ImageSource, context: string): IsobmffReader => {
  const readBox = async (start: number, parentEnd: number): Promise<IsobmffBox> => {
    if (parentEnd - start < 8) {
      throw invalidInput(`${context} box header is truncated at offset ${start}`)
    }
    const header = await readExactly(source, start, Math.min(32, parentEnd - start))
    const size32 = uint32BigEndian(header, 0)
    const type = ascii(header, 4, 4)
    let headerSize = 8
    let size = size32

    if (size32 === 1) {
      if (header.byteLength < 16) {
        throw invalidInput(`Extended ${context} box is truncated at offset ${start}`)
      }
      size = uint64BigEndian(header, 8, context)
      headerSize = 16
    } else if (size32 === 0) {
      size = parentEnd - start
    }

    if (type === 'uuid') headerSize += 16
    if (size < headerSize) throw invalidInput(`${context} ${type} box is smaller than its header`)
    const end = checkedAdd(start, size, `${context} ${type} box end overflows`)
    if (end > parentEnd) throw invalidInput(`${context} ${type} box extends beyond its parent`)

    return { type, start, contentStart: start + headerSize, end }
  }

  const boxes = async (start: number, end: number): Promise<readonly IsobmffBox[]> => {
    const result: IsobmffBox[] = []
    let offset = start
    while (offset < end) {
      if (result.length >= MAX_BOXES) throw invalidInput(`${context} contains too many boxes`)
      const box = await readBox(offset, end)
      result.push(box)
      offset = box.end
    }
    return result
  }

  const payload = async (
    box: IsobmffBox,
    maximum = MAX_METADATA_BOX_BYTES,
  ): Promise<Uint8Array> => {
    const length = box.end - box.contentStart
    if (length > maximum) {
      throw invalidInput(`${context} ${box.type} metadata box is unreasonably large`)
    }
    return readExactly(source, box.contentStart, length)
  }

  return { context, source, boxes, payload }
}

export const parseFullBox = (
  data: Uint8Array,
  type: string,
  context: string,
): { version: number; flags: number; offset: 4 } => {
  if (data.byteLength < 4) throw invalidInput(`${context} ${type} full box is truncated`)
  return {
    version: data[0] ?? 0,
    flags: ((data[1] ?? 0) << 16) | ((data[2] ?? 0) << 8) | (data[3] ?? 0),
    offset: 4,
  }
}

export const readSizedInteger = (
  data: Uint8Array,
  offset: number,
  size: number,
  context: string,
): number => {
  if (size === 0) return 0
  if (size !== 4 && size !== 8) throw invalidInput(`Unsupported ${context} integer size: ${size}`)
  let value = 0n
  for (let index = 0; index < size; index += 1) {
    const byte = data[offset + index]
    if (byte === undefined) throw invalidInput(`${context} item location is truncated`)
    value = value * 256n + BigInt(byte)
  }
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw invalidInput(`${context} item location exceeds the JavaScript safe integer range`)
  }
  return Number(value)
}

export const parseBrands = (data: Uint8Array, context: string): readonly string[] => {
  if (data.byteLength < 8 || data.byteLength % 4 !== 0) {
    throw invalidInput(`${context} ftyp box is malformed`)
  }
  const brands: string[] = []
  brands.push(ascii(data, 0, 4))
  for (let offset = 8; offset < data.byteLength; offset += 4) {
    brands.push(ascii(data, offset, 4))
  }
  return brands
}

export const detectIsobmffBrands = (data: Uint8Array): readonly string[] => {
  if (data.byteLength < 16 || ascii(data, 4, 4) !== 'ftyp') return []
  const size32 = uint32BigEndian(data, 0)
  let contentStart = 8
  let declaredSize = size32
  if (size32 === 0) declaredSize = data.byteLength
  else if (size32 === 1) {
    if (data.byteLength < 24) return []
    const high = uint32BigEndian(data, 8)
    const low = uint32BigEndian(data, 12)
    const extended = BigInt(high) * 0x1_0000_0000n + BigInt(low)
    if (extended > BigInt(Number.MAX_SAFE_INTEGER)) return []
    declaredSize = Number(extended)
    contentStart = 16
  }

  const end = Math.min(declaredSize, data.byteLength)
  if (end - contentStart < 8) return []
  const brands = [ascii(data, contentStart, 4)]
  for (let offset = contentStart + 8; offset + 4 <= end; offset += 4) {
    brands.push(ascii(data, offset, 4))
  }
  return brands
}

const parseItemInfo = async <Property>(
  reader: IsobmffReader,
  box: IsobmffBox,
  meta: IsobmffMeta<Property>,
): Promise<void> => {
  if (box.end - box.contentStart < 6) {
    throw invalidInput(`${reader.context} iinf box is truncated`)
  }
  const fullHeader = await readExactly(reader.source, box.contentStart, 4)
  const header = parseFullBox(fullHeader, box.type, reader.context)
  if (header.version > 1 || header.flags !== 0) {
    throw invalidInput(`${reader.context} iinf box has an unsupported version or flags`)
  }
  const countBytes = header.version === 0 ? 2 : 4
  if (box.end - box.contentStart < 4 + countBytes) {
    throw invalidInput(`${reader.context} iinf box is truncated`)
  }
  const countData = await readExactly(reader.source, box.contentStart + 4, countBytes)
  const expectedCount =
    countBytes === 2 ? uint16BigEndian(countData, 0) : uint32BigEndian(countData, 0)
  const children = await reader.boxes(box.contentStart + 4 + countBytes, box.end)
  if (children.length !== expectedCount) {
    throw invalidInput(`${reader.context} iinf item count does not match`)
  }

  for (const child of children) {
    if (child.type !== 'infe') {
      throw invalidInput(`${reader.context} iinf contains a non-infe child`)
    }
    const data = await reader.payload(child)
    const itemHeader = parseFullBox(data, child.type, reader.context)
    if ((itemHeader.version !== 2 && itemHeader.version !== 3) || (itemHeader.flags & ~1) !== 0) {
      throw invalidInput(`${reader.context} infe box has an unsupported version or flags`)
    }
    let offset = 4
    const id =
      itemHeader.version === 2 ? uint16BigEndian(data, offset) : uint32BigEndian(data, offset)
    offset += itemHeader.version === 2 ? 2 : 4
    const protectionIndex = uint16BigEndian(data, offset)
    offset += 2
    const type = ascii(data, offset, 4)
    offset += 4
    if (id === 0 || data.indexOf(0, offset) === -1) {
      throw invalidInput(`${reader.context} item info is malformed`)
    }
    if (meta.items.has(id)) {
      throw invalidInput(`${reader.context} contains duplicate item ID ${id}`)
    }
    meta.items.set(id, { id, protectionIndex, type })
  }
}

const parseItemLocations = async <Property>(
  reader: IsobmffReader,
  box: IsobmffBox,
  meta: IsobmffMeta<Property>,
): Promise<void> => {
  const data = await reader.payload(box)
  const header = parseFullBox(data, box.type, reader.context)
  if (header.version > 2 || header.flags !== 0) {
    throw invalidInput(`${reader.context} iloc box has an unsupported version or flags`)
  }
  const firstSizes = data[4]
  const secondSizes = data[5]
  if (firstSizes === undefined || secondSizes === undefined) {
    throw invalidInput(`${reader.context} iloc size fields are truncated`)
  }
  const offsetSize = firstSizes >>> 4
  const lengthSize = firstSizes & 0x0f
  const baseOffsetSize = secondSizes >>> 4
  const indexSize = secondSizes & 0x0f
  for (const size of [offsetSize, lengthSize, baseOffsetSize, indexSize]) {
    if (size !== 0 && size !== 4 && size !== 8) {
      throw invalidInput(`Unsupported ${reader.context} iloc field size: ${size}`)
    }
  }
  if (header.version === 0 && indexSize !== 0) {
    throw invalidInput(`${reader.context} iloc version 0 has reserved bits set`)
  }

  let offset = 6
  const itemCount =
    header.version < 2 ? uint16BigEndian(data, offset) : uint32BigEndian(data, offset)
  offset += header.version < 2 ? 2 : 4
  for (let itemIndex = 0; itemIndex < itemCount; itemIndex += 1) {
    const itemId =
      header.version < 2 ? uint16BigEndian(data, offset) : uint32BigEndian(data, offset)
    offset += header.version < 2 ? 2 : 4
    let constructionMethod: 0 | 1 = 0
    if (header.version > 0) {
      const encodedMethod = uint16BigEndian(data, offset)
      offset += 2
      if ((encodedMethod & 0xfff0) !== 0 || (encodedMethod & 0x0f) > 1) {
        throw invalidInput(`${reader.context} iloc construction method is unsupported`)
      }
      constructionMethod = (encodedMethod & 0x0f) === 0 ? 0 : 1
    }
    const dataReferenceIndex = uint16BigEndian(data, offset)
    offset += 2
    if (itemId === 0) throw invalidInput(`${reader.context} iloc item ID must not be zero`)
    const baseOffset = readSizedInteger(data, offset, baseOffsetSize, reader.context)
    offset += baseOffsetSize
    const extentCount = uint16BigEndian(data, offset)
    offset += 2
    if (extentCount > MAX_ITEM_EXTENTS) {
      throw invalidInput(`${reader.context} item ${itemId} contains too many extents`)
    }
    const extents: IsobmffItemExtent[] = []
    for (let extentIndex = 0; extentIndex < extentCount; extentIndex += 1) {
      offset += indexSize
      const extentOffset = readSizedInteger(data, offset, offsetSize, reader.context)
      offset += offsetSize
      const length = readSizedInteger(data, offset, lengthSize, reader.context)
      offset += lengthSize
      extents.push({ offset: extentOffset, length })
    }
    if (meta.locations.has(itemId)) {
      throw invalidInput(`${reader.context} contains duplicate iloc item ${itemId}`)
    }
    meta.locations.set(itemId, {
      itemId,
      constructionMethod,
      dataReferenceIndex,
      baseOffset,
      extents,
    })
  }
  if (offset !== data.byteLength) {
    throw invalidInput(`${reader.context} iloc box has trailing data`)
  }
}

const parsePropertyAssociations = async <Property>(
  reader: IsobmffReader,
  box: IsobmffBox,
  meta: IsobmffMeta<Property>,
): Promise<void> => {
  const data = await reader.payload(box)
  const header = parseFullBox(data, box.type, reader.context)
  if (header.version > 1 || (header.flags & ~1) !== 0) {
    throw invalidInput(`${reader.context} ipma box has an unsupported version or flags`)
  }
  let offset = 4
  const entryCount = uint32BigEndian(data, offset)
  offset += 4
  const wide = (header.flags & 1) !== 0
  for (let entry = 0; entry < entryCount; entry += 1) {
    const itemId =
      header.version === 0 ? uint16BigEndian(data, offset) : uint32BigEndian(data, offset)
    offset += header.version === 0 ? 2 : 4
    const count = data[offset]
    if (count === undefined) {
      throw invalidInput(`${reader.context} ipma association count is truncated`)
    }
    offset += 1
    const associations = meta.associations.get(itemId) ?? []
    for (let index = 0; index < count; index += 1) {
      const encoded = wide ? uint16BigEndian(data, offset) : data[offset]
      if (encoded === undefined) {
        throw invalidInput(`${reader.context} ipma association is truncated`)
      }
      offset += wide ? 2 : 1
      const propertyIndex = encoded & (wide ? 0x7fff : 0x7f)
      if (propertyIndex !== 0) {
        associations.push({
          essential: (encoded & (wide ? 0x8000 : 0x80)) !== 0,
          index: propertyIndex,
        })
      }
    }
    meta.associations.set(itemId, associations)
  }
  if (offset !== data.byteLength) {
    throw invalidInput(`${reader.context} ipma box has trailing data`)
  }
}

const parseItemProperties = async <Property>(
  reader: IsobmffReader,
  box: IsobmffBox,
  meta: IsobmffMeta<Property>,
  parseProperty: IsobmffPropertyParser<Property>,
): Promise<void> => {
  for (const child of await reader.boxes(box.contentStart, box.end)) {
    if (child.type === 'ipco') {
      for (const property of await reader.boxes(child.contentStart, child.end)) {
        meta.properties.push(await parseProperty(reader, property))
      }
    } else if (child.type === 'ipma') {
      await parsePropertyAssociations(reader, child, meta)
    }
  }
}

const parseItemReferences = async <Property>(
  reader: IsobmffReader,
  box: IsobmffBox,
  meta: IsobmffMeta<Property>,
): Promise<void> => {
  if (box.end - box.contentStart < 4) {
    throw invalidInput(`${reader.context} iref box is truncated`)
  }
  const fullHeader = await readExactly(reader.source, box.contentStart, 4)
  const header = parseFullBox(fullHeader, box.type, reader.context)
  if (header.version > 1 || header.flags !== 0) {
    throw invalidInput(`${reader.context} iref box has an unsupported version or flags`)
  }
  const idBytes = header.version === 0 ? 2 : 4
  for (const reference of await reader.boxes(box.contentStart + 4, box.end)) {
    const data = await reader.payload(reference)
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
    if (offset !== data.byteLength) {
      throw invalidInput(`${reader.context} ${reference.type} reference is malformed`)
    }
    meta.references.push({ type: reference.type, fromItemId, toItemIds })
  }
}

export const parseIsobmffMeta = async <Property>(
  reader: IsobmffReader,
  box: IsobmffBox,
  parseProperty: IsobmffPropertyParser<Property>,
): Promise<IsobmffMeta<Property>> => {
  if (box.end - box.contentStart < 4) {
    throw invalidInput(`${reader.context} meta box is truncated`)
  }
  const fullHeader = await readExactly(reader.source, box.contentStart, 4)
  const header = parseFullBox(fullHeader, box.type, reader.context)
  if (header.version !== 0 || header.flags !== 0) {
    throw invalidInput(`${reader.context} meta box has an unsupported version or flags`)
  }
  const meta: IsobmffMeta<Property> = {
    items: new Map(),
    locations: new Map(),
    properties: [],
    associations: new Map(),
    references: [],
  }
  for (const child of await reader.boxes(box.contentStart + 4, box.end)) {
    if (child.type === 'pitm') {
      const data = await reader.payload(child, 8)
      const primaryHeader = parseFullBox(data, child.type, reader.context)
      if (primaryHeader.version > 1 || primaryHeader.flags !== 0) {
        throw invalidInput(`${reader.context} pitm box has an unsupported version or flags`)
      }
      if (data.byteLength !== (primaryHeader.version === 0 ? 6 : 8)) {
        throw invalidInput(`${reader.context} pitm box is malformed`)
      }
      if (meta.primaryItemId !== undefined) {
        throw invalidInput(`${reader.context} meta box contains multiple pitm boxes`)
      }
      meta.primaryItemId =
        primaryHeader.version === 0 ? uint16BigEndian(data, 4) : uint32BigEndian(data, 4)
    } else if (child.type === 'iinf') {
      await parseItemInfo(reader, child, meta)
    } else if (child.type === 'iloc') {
      await parseItemLocations(reader, child, meta)
    } else if (child.type === 'iprp') {
      await parseItemProperties(reader, child, meta, parseProperty)
    } else if (child.type === 'iref') {
      await parseItemReferences(reader, child, meta)
    } else if (child.type === 'idat') {
      if (meta.idat) {
        throw invalidInput(`${reader.context} meta box contains multiple idat boxes`)
      }
      meta.idat = child
    }
  }
  return meta
}
