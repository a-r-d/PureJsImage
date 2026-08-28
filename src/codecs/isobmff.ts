import { invalidInput, limitExceeded } from '../errors.ts'
import type { ImageSource } from '../source.ts'
import { readExactly } from '../source.ts'
import { ascii, uint16BigEndian, uint32BigEndian } from './helpers.ts'

const MAX_BOXES = 100_000
const MAX_METADATA_BOX_BYTES = 16 * 1024 * 1024
const MAX_ITEM_EXTENTS = 4096
const MAX_TRACK_SAMPLES = 100_000

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

export interface IsobmffSampleTable {
  readonly durations: Uint32Array
  readonly offsets: Float64Array
  readonly sampleDescriptionIndices: Uint32Array
  readonly sizes: Uint32Array
  readonly syncSamples: Uint8Array
}

export interface IsobmffItemInfo {
  readonly id: number
  readonly protectionIndex: number
  readonly type: string
  readonly contentType?: string
  readonly contentEncoding?: string
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

export interface IsobmffEntityGroup {
  readonly entityIds: readonly number[]
  readonly groupId: number
  readonly type: string
}

export interface IsobmffMeta<Property> {
  primaryItemId?: number
  idat?: IsobmffBox
  readonly items: Map<number, IsobmffItemInfo>
  readonly locations: Map<number, IsobmffItemLocation>
  readonly properties: Property[]
  readonly associations: Map<number, IsobmffPropertyAssociation[]>
  readonly references: IsobmffItemReference[]
  readonly groups: IsobmffEntityGroup[]
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

export const checkedMultiply = (left: number, right: number, message: string): number => {
  const result = left * right
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

const singleChildBox = (
  boxes: readonly IsobmffBox[],
  type: string,
  context: string,
): IsobmffBox => {
  const matches = boxes.filter((box) => box.type === type)
  if (matches.length !== 1 || !matches[0]) {
    throw invalidInput(`${context} requires exactly one ${type} box`)
  }
  return matches[0]
}

const tablePayload = async (
  reader: IsobmffReader,
  boxes: readonly IsobmffBox[],
  type: string,
): Promise<Uint8Array> => {
  const data = await reader.payload(
    singleChildBox(boxes, type, `${reader.context} sample table`),
    MAX_METADATA_BOX_BYTES,
  )
  const full = parseFullBox(data, type, reader.context)
  if (full.version !== 0 || full.flags !== 0) {
    throw invalidInput(`${reader.context} ${type} version or flags are unsupported`)
  }
  return data
}

export const parseIsobmffSampleTable = async (
  reader: IsobmffReader,
  sampleTable: IsobmffBox,
  maximumSamples = MAX_TRACK_SAMPLES,
): Promise<IsobmffSampleTable> => {
  const boxes = await reader.boxes(sampleTable.contentStart, sampleTable.end)
  const sizeData = await tablePayload(reader, boxes, 'stsz')
  if (sizeData.byteLength < 12) throw invalidInput(`${reader.context} stsz box is truncated`)
  const constantSize = uint32BigEndian(sizeData, 4)
  const sampleCount = uint32BigEndian(sizeData, 8)
  if (sampleCount === 0) throw invalidInput(`${reader.context} AV1 track has no samples`)
  if (sampleCount > MAX_TRACK_SAMPLES) {
    throw invalidInput(`${reader.context} AV1 track has too many samples`)
  }
  if (sampleCount > maximumSamples) {
    throw limitExceeded(
      `${reader.context} AV1 track has ${sampleCount} samples; maxFrames is ${maximumSamples}`,
    )
  }
  const documentedSizeBytes = checkedMultiply(
    sampleCount,
    constantSize === 0 ? 4 : 0,
    `${reader.context} stsz entry bytes overflow`,
  )
  if (sizeData.byteLength !== 12 + documentedSizeBytes) {
    throw invalidInput(`${reader.context} stsz sample sizes are malformed`)
  }
  const sizes = new Uint32Array(sampleCount)
  if (constantSize !== 0) sizes.fill(constantSize)
  else {
    for (let index = 0; index < sampleCount; index += 1) {
      const size = uint32BigEndian(sizeData, 12 + index * 4)
      if (size === 0) throw invalidInput(`${reader.context} AV1 sample has zero size`)
      sizes[index] = size
    }
  }

  const timingData = await tablePayload(reader, boxes, 'stts')
  if (timingData.byteLength < 8) throw invalidInput(`${reader.context} stts box is truncated`)
  const timingEntryCount = uint32BigEndian(timingData, 4)
  const timingBytes = checkedMultiply(
    timingEntryCount,
    8,
    `${reader.context} stts entry bytes overflow`,
  )
  if (timingEntryCount > sampleCount || timingData.byteLength !== 8 + timingBytes) {
    throw invalidInput(`${reader.context} stts entries are malformed`)
  }
  const durations = new Uint32Array(sampleCount)
  let timedSamples = 0
  let totalDuration = 0
  for (let entry = 0; entry < timingEntryCount; entry += 1) {
    const count = uint32BigEndian(timingData, 8 + entry * 8)
    const duration = uint32BigEndian(timingData, 12 + entry * 8)
    if (count === 0 || duration === 0 || count > sampleCount - timedSamples) {
      throw invalidInput(`${reader.context} stts entry has an invalid count or duration`)
    }
    durations.fill(duration, timedSamples, timedSamples + count)
    timedSamples += count
    totalDuration = checkedAdd(
      totalDuration,
      checkedMultiply(count, duration, `${reader.context} track duration overflows`),
      `${reader.context} track duration overflows`,
    )
  }
  if (timedSamples !== sampleCount || totalDuration === 0) {
    throw invalidInput(`${reader.context} stts does not describe every sample`)
  }

  const chunkOffset32 = boxes.filter((box) => box.type === 'stco')
  const chunkOffset64 = boxes.filter((box) => box.type === 'co64')
  if (chunkOffset32.length + chunkOffset64.length !== 1) {
    throw invalidInput(`${reader.context} sample table requires exactly one stco or co64 box`)
  }
  const chunkType = chunkOffset32.length === 1 ? 'stco' : 'co64'
  const chunkData = await tablePayload(reader, boxes, chunkType)
  if (chunkData.byteLength < 8)
    throw invalidInput(`${reader.context} ${chunkType} box is truncated`)
  const chunkCount = uint32BigEndian(chunkData, 4)
  if (chunkCount === 0 || chunkCount > sampleCount) {
    throw invalidInput(`${reader.context} ${chunkType} has an invalid chunk count`)
  }
  const chunkIntegerSize = chunkType === 'stco' ? 4 : 8
  const chunkBytes = checkedMultiply(
    chunkCount,
    chunkIntegerSize,
    `${reader.context} chunk offset bytes overflow`,
  )
  if (chunkData.byteLength !== 8 + chunkBytes) {
    throw invalidInput(`${reader.context} ${chunkType} offsets are malformed`)
  }

  const chunkMapData = await tablePayload(reader, boxes, 'stsc')
  if (chunkMapData.byteLength < 8) throw invalidInput(`${reader.context} stsc box is truncated`)
  const chunkMapCount = uint32BigEndian(chunkMapData, 4)
  const chunkMapBytes = checkedMultiply(
    chunkMapCount,
    12,
    `${reader.context} stsc entry bytes overflow`,
  )
  if (
    chunkMapCount === 0 ||
    chunkMapCount > chunkCount ||
    chunkMapData.byteLength !== 8 + chunkMapBytes
  ) {
    throw invalidInput(`${reader.context} stsc entries are malformed`)
  }
  const firstChunk = new Uint32Array(chunkMapCount)
  const samplesPerChunk = new Uint32Array(chunkMapCount)
  const descriptionIndices = new Uint32Array(chunkMapCount)
  for (let entry = 0; entry < chunkMapCount; entry += 1) {
    const offset = 8 + entry * 12
    const first = uint32BigEndian(chunkMapData, offset)
    const samples = uint32BigEndian(chunkMapData, offset + 4)
    const description = uint32BigEndian(chunkMapData, offset + 8)
    if (
      first === 0 ||
      samples === 0 ||
      description === 0 ||
      first > chunkCount ||
      (entry === 0 ? first !== 1 : first <= (firstChunk[entry - 1] ?? 0))
    ) {
      throw invalidInput(`${reader.context} stsc entry is invalid`)
    }
    firstChunk[entry] = first
    samplesPerChunk[entry] = samples
    descriptionIndices[entry] = description
  }

  const offsets = new Float64Array(sampleCount)
  const sampleDescriptionIndices = new Uint32Array(sampleCount)
  let sampleIndex = 0
  let chunkMapIndex = 0
  for (let chunkIndex = 0; chunkIndex < chunkCount; chunkIndex += 1) {
    const chunkNumber = chunkIndex + 1
    if (
      chunkMapIndex + 1 < chunkMapCount &&
      chunkNumber >= (firstChunk[chunkMapIndex + 1] ?? Number.MAX_SAFE_INTEGER)
    ) {
      chunkMapIndex += 1
    }
    const count = samplesPerChunk[chunkMapIndex] ?? 0
    if (count > sampleCount - sampleIndex) {
      throw invalidInput(`${reader.context} stsc describes too many samples`)
    }
    let sampleOffset = readSizedInteger(
      chunkData,
      8 + chunkIndex * chunkIntegerSize,
      chunkIntegerSize,
      `${reader.context} ${chunkType}`,
    )
    for (let indexInChunk = 0; indexInChunk < count; indexInChunk += 1) {
      const size = sizes[sampleIndex] ?? 0
      const sampleEnd = checkedAdd(
        sampleOffset,
        size,
        `${reader.context} AV1 sample extent overflows`,
      )
      if (sampleOffset < 0 || sampleEnd > reader.source.size) {
        throw invalidInput(`${reader.context} AV1 sample extends beyond the source`)
      }
      offsets[sampleIndex] = sampleOffset
      sampleDescriptionIndices[sampleIndex] = descriptionIndices[chunkMapIndex] ?? 0
      sampleOffset = sampleEnd
      sampleIndex += 1
    }
  }
  if (sampleIndex !== sampleCount) {
    throw invalidInput(`${reader.context} stsc does not describe every sample`)
  }

  const syncSamples = new Uint8Array(sampleCount)
  const syncBoxes = boxes.filter((box) => box.type === 'stss')
  if (syncBoxes.length === 0) syncSamples.fill(1)
  else {
    const syncData = await tablePayload(reader, boxes, 'stss')
    if (syncData.byteLength < 8) throw invalidInput(`${reader.context} stss box is truncated`)
    const syncCount = uint32BigEndian(syncData, 4)
    const syncBytes = checkedMultiply(syncCount, 4, `${reader.context} stss entry bytes overflow`)
    if (syncCount > sampleCount || syncData.byteLength !== 8 + syncBytes) {
      throw invalidInput(`${reader.context} stss entries are malformed`)
    }
    let previous = 0
    for (let entry = 0; entry < syncCount; entry += 1) {
      const sampleNumber = uint32BigEndian(syncData, 8 + entry * 4)
      if (sampleNumber === 0 || sampleNumber > sampleCount || sampleNumber <= previous) {
        throw invalidInput(`${reader.context} stss sample number is invalid`)
      }
      syncSamples[sampleNumber - 1] = 1
      previous = sampleNumber
    }
  }

  return { durations, offsets, sampleDescriptionIndices, sizes, syncSamples }
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
    let contentType: string | undefined
    let contentEncoding: string | undefined
    if (type === 'mime') {
      offset = data.indexOf(0, offset) + 1
      const typeEnd = data.indexOf(0, offset)
      if (typeEnd === -1) {
        throw invalidInput(`${reader.context} MIME item has no content type`)
      }
      contentType = ascii(data, offset, typeEnd - offset)
      if (contentType.length === 0) {
        throw invalidInput(`${reader.context} MIME item has an empty content type`)
      }
      offset = typeEnd + 1
      if (offset < data.byteLength) {
        const encodingEnd = data.indexOf(0, offset)
        if (encodingEnd === -1) {
          throw invalidInput(`${reader.context} MIME item content encoding is malformed`)
        }
        contentEncoding = ascii(data, offset, encodingEnd - offset)
      }
    }
    if (meta.items.has(id)) {
      throw invalidInput(`${reader.context} contains duplicate item ID ${id}`)
    }
    meta.items.set(id, {
      id,
      protectionIndex,
      type,
      ...(contentType === undefined ? {} : { contentType }),
      ...(contentEncoding ? { contentEncoding } : {}),
    })
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

const parseEntityGroups = async <Property>(
  reader: IsobmffReader,
  box: IsobmffBox,
  meta: IsobmffMeta<Property>,
): Promise<void> => {
  for (const groupBox of await reader.boxes(box.contentStart, box.end)) {
    const data = await reader.payload(groupBox)
    if (data.byteLength < 12) {
      throw invalidInput(`${reader.context} ${groupBox.type} entity group is truncated`)
    }
    const header = parseFullBox(data, groupBox.type, reader.context)
    if (groupBox.type === 'altr' && (header.version !== 0 || header.flags !== 0)) {
      throw invalidInput(`${reader.context} altr entity group has unsupported version or flags`)
    }
    const groupId = uint32BigEndian(data, 4)
    const entityCount = uint32BigEndian(data, 8)
    if (entityCount > (data.byteLength - 12) / 4 || data.byteLength !== 12 + entityCount * 4) {
      throw invalidInput(`${reader.context} ${groupBox.type} entity group is malformed`)
    }
    const entityIds: number[] = []
    for (let index = 0; index < entityCount; index += 1) {
      entityIds.push(uint32BigEndian(data, 12 + index * 4))
    }
    if (new Set(entityIds).size !== entityIds.length) {
      throw invalidInput(`${reader.context} ${groupBox.type} entity group repeats an entity`)
    }
    if (
      meta.groups.some(
        (group) =>
          (group.type === groupBox.type && group.groupId === groupId) ||
          (group.type === 'altr' &&
            groupBox.type === 'altr' &&
            group.entityIds.some((entityId) => entityIds.includes(entityId))),
      )
    ) {
      throw invalidInput(
        `${reader.context} ${groupBox.type} entity group conflicts with another group`,
      )
    }
    meta.groups.push({ type: groupBox.type, groupId, entityIds })
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
    groups: [],
  }
  let groupsListSeen = false
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
    } else if (child.type === 'grpl') {
      if (groupsListSeen) {
        throw invalidInput(`${reader.context} meta box contains multiple grpl boxes`)
      }
      groupsListSeen = true
      await parseEntityGroups(reader, child, meta)
    } else if (child.type === 'idat') {
      if (meta.idat) {
        throw invalidInput(`${reader.context} meta box contains multiple idat boxes`)
      }
      meta.idat = child
    }
  }
  return meta
}
