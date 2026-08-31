import { throwIfAborted } from '../abort.ts'
import { invalidInput, limitExceeded, truncatedInput } from '../errors.ts'
import type { ImageSource } from '../source.ts'
import { readExactly, SourceReader } from '../source.ts'
import { parseIsoGainMapMetadata, type IsoGainMapMetadata } from './iso.ts'
import { parseBoundedXml, xmlAttribute, xmlElements } from './xml.ts'

const XMP_HEADER = 'http://ns.adobe.com/xap/1.0/\0'
const EXTENDED_XMP_HEADER = 'http://ns.adobe.com/xmp/extension/\0'
const ISO_HEADER = 'urn:iso:std:iso:ts:21496:-1\0'
const HDR_GAIN_MAP_NAMESPACE = 'http://ns.adobe.com/hdr-gain-map/1.0/'
const CONTAINER_NAMESPACE = 'http://ns.google.com/photos/1.0/container/'
const ITEM_NAMESPACE = 'http://ns.google.com/photos/1.0/container/item/'
const RDF_NAMESPACE = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#'
const XMP_NOTE_NAMESPACE = 'http://ns.adobe.com/xmp/note/'

const standaloneMarkers = new Set([
  0x01, 0xd8, 0xd9, 0xd0, 0xd1, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7,
])
const frameMarkers = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
])

export interface HdrJpegLimits {
  readonly maxMarkers?: number
  readonly maxAppSegments?: number
  readonly maxAppBytes?: number
  readonly maxXmpBytes?: number
  readonly maxExtendedXmpChunks?: number
  readonly maxMpfEntries?: number
  readonly maxEmbeddedImages?: number
}

interface ResolvedHdrJpegLimits {
  maxMarkers: number
  maxAppSegments: number
  maxAppBytes: number
  maxXmpBytes: number
  maxExtendedXmpChunks: number
  maxMpfEntries: number
  maxEmbeddedImages: number
}

export interface JpegByteRange {
  readonly start: number
  readonly end: number
}

export interface HdrJpegDimensions {
  readonly width: number
  readonly height: number
  readonly components: number
  readonly progressive: boolean
}

export interface HdrJpegApplicationSegment {
  readonly marker: 0xe1 | 0xe2
  readonly range: JpegByteRange
  readonly payloadRange: JpegByteRange
  readonly payload: Uint8Array
}

export interface HdrJpegHeaderInspection {
  readonly sourceStart: number
  readonly scanOffset: number
  readonly dimensions: HdrJpegDimensions
  readonly applicationSegments: readonly HdrJpegApplicationSegment[]
}

export interface MpfImageEntry {
  readonly attributes: number
  readonly dependentImage1: number
  readonly dependentImage2: number
  readonly range: JpegByteRange
}

export interface MpfInspection {
  readonly byteOrder: 'little-endian' | 'big-endian'
  readonly tiffOffset: number
  readonly images: readonly MpfImageEntry[]
}

export interface UltraHdrXmpMetadata {
  readonly version: '1.0'
  readonly baseRendition: 'sdr' | 'hdr'
  readonly minimum: readonly number[]
  readonly maximum: readonly number[]
  readonly gamma: readonly number[]
  readonly offsetSdr: readonly number[]
  readonly offsetHdr: readonly number[]
  readonly capacityMinimum: number
  readonly capacityMaximum: number
  readonly lexical: Readonly<Record<string, readonly string[] | string>>
}

export interface GContainerItem {
  readonly semantic: 'Primary' | 'GainMap'
  readonly mime: 'image/jpeg'
  readonly length?: number
  readonly padding: number
}

export interface HdrJpegInspection {
  readonly primary: JpegByteRange
  readonly gainMap?: JpegByteRange
  readonly primaryDimensions: HdrJpegDimensions
  readonly gainMapDimensions?: HdrJpegDimensions
  readonly mpf?: MpfInspection
  readonly gContainerItems: readonly GContainerItem[]
  readonly ultraHdr?: UltraHdrXmpMetadata
  readonly iso?: IsoGainMapMetadata
  readonly representations: readonly ('ultra-hdr-xmp' | 'iso-21496-1')[]
  readonly metadataRanges: readonly JpegByteRange[]
  readonly xmpPackets: readonly Uint8Array[]
}

const positive = (value: number | undefined, fallback: number, label: string): number => {
  const resolved = value ?? fallback
  if (!Number.isSafeInteger(resolved) || resolved < 1) {
    throw invalidInput(`${label} must be a positive safe integer`)
  }
  return resolved
}

const resolveLimits = (limits: Readonly<HdrJpegLimits>): ResolvedHdrJpegLimits => ({
  maxMarkers: positive(limits.maxMarkers, 10_000, 'HDR JPEG maxMarkers'),
  maxAppSegments: positive(limits.maxAppSegments, 256, 'HDR JPEG maxAppSegments'),
  maxAppBytes: positive(limits.maxAppBytes, 4 * 1024 * 1024, 'HDR JPEG maxAppBytes'),
  maxXmpBytes: positive(limits.maxXmpBytes, 1024 * 1024, 'HDR JPEG maxXmpBytes'),
  maxExtendedXmpChunks: positive(limits.maxExtendedXmpChunks, 256, 'HDR JPEG maxExtendedXmpChunks'),
  maxMpfEntries: positive(limits.maxMpfEntries, 4_096, 'HDR JPEG maxMpfEntries'),
  maxEmbeddedImages: positive(limits.maxEmbeddedImages, 16, 'HDR JPEG maxEmbeddedImages'),
})

const uint16 = (data: Uint8Array, offset: number): number => {
  const first = data[offset]
  const second = data[offset + 1]
  if (first === undefined || second === undefined) throw truncatedInput('JPEG integer is truncated')
  return first * 256 + second
}

const uint32BigEndian = (data: Uint8Array, offset: number): number => {
  if (offset < 0 || offset + 4 > data.byteLength) throw truncatedInput('JPEG integer is truncated')
  return new DataView(data.buffer, data.byteOffset + offset, 4).getUint32(0, false)
}

const range = (start: number, end: number, label: string): JpegByteRange => {
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end <= start) {
    throw invalidInput(`${label} range is invalid`)
  }
  return Object.freeze({ start, end })
}

const nextMarker = async (reader: SourceReader): Promise<number> => {
  if ((await reader.readByte()) !== 0xff) throw invalidInput('JPEG marker prefix is missing')
  let marker = await reader.readByte()
  while (marker === 0xff) marker = await reader.readByte()
  if (marker === 0x00) throw invalidInput('JPEG stuffed byte appears outside entropy data')
  return marker
}

export const inspectHdrJpegHeader = async (
  source: ImageSource,
  sourceStart = 0,
  options: Readonly<HdrJpegLimits & { readonly signal?: AbortSignal }> = {},
): Promise<HdrJpegHeaderInspection> => {
  const limits = resolveLimits(options)
  if (!Number.isSafeInteger(sourceStart) || sourceStart < 0 || sourceStart + 2 > source.size) {
    throw invalidInput('JPEG source start is invalid')
  }
  const reader = new SourceReader(source, sourceStart, 16_384)
  if ((await reader.readByte()) !== 0xff || (await reader.readByte()) !== 0xd8) {
    throw invalidInput('JPEG SOI marker is missing')
  }
  const applicationSegments: HdrJpegApplicationSegment[] = []
  let dimensions: HdrJpegDimensions | undefined
  let appBytes = 0
  for (let markers = 0; markers < limits.maxMarkers; markers += 1) {
    throwIfAborted(options.signal)
    const markerStart = reader.position
    const marker = await nextMarker(reader)
    if (marker === 0xd9) throw invalidInput('JPEG ended before scan data')
    if (standaloneMarkers.has(marker)) continue
    const length = uint16(await reader.read(2), 0)
    if (length < 2) throw invalidInput('JPEG marker length is invalid')
    const payloadStart = reader.position
    const payloadLength = length - 2
    const segmentEnd = payloadStart + payloadLength
    if (!Number.isSafeInteger(segmentEnd) || segmentEnd > source.size) {
      throw truncatedInput('JPEG marker payload is truncated')
    }
    if (marker === 0xda) {
      reader.skip(payloadLength)
      if (!dimensions) throw invalidInput('JPEG dimensions were not found before scan data')
      return Object.freeze({
        sourceStart,
        scanOffset: reader.position,
        dimensions,
        applicationSegments: Object.freeze(applicationSegments),
      })
    }
    if (frameMarkers.has(marker)) {
      const payload = await reader.read(payloadLength)
      if (payload.byteLength < 6) throw truncatedInput('JPEG frame header is truncated')
      const height = uint16(payload, 1)
      const width = uint16(payload, 3)
      const components = payload[5] ?? 0
      if (width < 1 || height < 1 || components < 1 || payload.byteLength < 6 + components * 3) {
        throw invalidInput('JPEG frame dimensions or components are invalid')
      }
      if (dimensions) throw invalidInput('JPEG contains multiple frame headers before its scan')
      dimensions = Object.freeze({ width, height, components, progressive: marker === 0xc2 })
      continue
    }
    if (marker === 0xe1 || marker === 0xe2) {
      appBytes += payloadLength
      if (applicationSegments.length >= limits.maxAppSegments) {
        throw limitExceeded('JPEG APP segments exceed the HDR limit')
      }
      if (appBytes > limits.maxAppBytes) throw limitExceeded('JPEG APP bytes exceed the HDR limit')
      applicationSegments.push(
        Object.freeze({
          marker,
          range: range(markerStart, segmentEnd, 'JPEG APP segment'),
          payloadRange: range(payloadStart, segmentEnd, 'JPEG APP payload'),
          payload: Uint8Array.from(await reader.read(payloadLength)),
        }),
      )
      continue
    }
    reader.skip(payloadLength)
  }
  throw limitExceeded('JPEG marker count exceeds the HDR limit')
}

export const findJpegEnd = async (
  source: ImageSource,
  sourceStart = 0,
  options: Readonly<HdrJpegLimits & { readonly signal?: AbortSignal }> = {},
): Promise<number> => {
  const header = await inspectHdrJpegHeader(source, sourceStart, options)
  const reader = new SourceReader(source, header.scanOffset, 65_536)
  let inEntropy = true
  let markers = 0
  while (reader.position < source.size) {
    throwIfAborted(options.signal)
    if (inEntropy) {
      if ((await reader.readByte()) !== 0xff) continue
      let marker = await reader.readByte()
      while (marker === 0xff) marker = await reader.readByte()
      if (marker === 0x00 || (marker >= 0xd0 && marker <= 0xd7)) continue
      if (marker === 0xd9) return reader.position
      if (standaloneMarkers.has(marker)) continue
      markers += 1
      if (markers > resolveLimits(options).maxMarkers) {
        throw limitExceeded('JPEG scan marker count exceeds the HDR limit')
      }
      const length = uint16(await reader.read(2), 0)
      if (length < 2) throw invalidInput('JPEG scan marker length is invalid')
      reader.skip(length - 2)
      inEntropy = marker === 0xda
      continue
    }
    const marker = await nextMarker(reader)
    if (marker === 0xd9) return reader.position
    if (standaloneMarkers.has(marker)) continue
    markers += 1
    if (markers > resolveLimits(options).maxMarkers) {
      throw limitExceeded('JPEG scan marker count exceeds the HDR limit')
    }
    const length = uint16(await reader.read(2), 0)
    if (length < 2) throw invalidInput('JPEG scan marker length is invalid')
    reader.skip(length - 2)
    inEntropy = marker === 0xda
  }
  throw truncatedInput('JPEG EOI marker is missing')
}

const asciiPrefix = (data: Uint8Array, value: string): boolean => {
  if (data.byteLength < value.length) return false
  for (let index = 0; index < value.length; index += 1) {
    if (data[index] !== value.charCodeAt(index)) return false
  }
  return true
}

const parseMpf = (
  segment: HdrJpegApplicationSegment,
  sourceStart: number,
  sourceSize: number,
  limits: ResolvedHdrJpegLimits,
): MpfInspection | undefined => {
  const data = segment.payload
  if (!asciiPrefix(data, 'MPF\0')) return undefined
  if (data.byteLength < 16) throw truncatedInput('MPF TIFF header is truncated')
  const littleEndian = data[4] === 0x49 && data[5] === 0x49
  const bigEndian = data[4] === 0x4d && data[5] === 0x4d
  if (!littleEndian && !bigEndian) throw invalidInput('MPF TIFF byte order is invalid')
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const read16 = (offset: number): number => {
    if (offset < 0 || offset + 2 > data.byteLength) throw truncatedInput('MPF value is truncated')
    return view.getUint16(offset, littleEndian)
  }
  const read32 = (offset: number): number => {
    if (offset < 0 || offset + 4 > data.byteLength) throw truncatedInput('MPF value is truncated')
    return view.getUint32(offset, littleEndian)
  }
  const tiff = 4
  if (read16(tiff + 2) !== 42) throw invalidInput('MPF TIFF marker is invalid')
  const ifd = tiff + read32(tiff + 4)
  const entryCount = read16(ifd)
  if (entryCount > limits.maxMpfEntries) throw limitExceeded('MPF IFD entries exceed the HDR limit')
  let imageCount: number | undefined
  let entryArrayOffset: number | undefined
  let entryArrayBytes: number | undefined
  for (let index = 0; index < entryCount; index += 1) {
    const entry = ifd + 2 + index * 12
    const tag = read16(entry)
    const type = read16(entry + 2)
    const count = read32(entry + 4)
    if (tag === 0xb001) {
      if (type !== 4 || count !== 1 || imageCount !== undefined) {
        throw invalidInput('MPF number-of-images entry is invalid or duplicated')
      }
      imageCount = read32(entry + 8)
    } else if (tag === 0xb002) {
      if (type !== 7 || entryArrayOffset !== undefined) {
        throw invalidInput('MPF image-entry array is invalid or duplicated')
      }
      entryArrayBytes = count
      entryArrayOffset = tiff + read32(entry + 8)
    }
  }
  if (
    imageCount === undefined ||
    imageCount < 1 ||
    imageCount > limits.maxEmbeddedImages ||
    entryArrayOffset === undefined ||
    entryArrayBytes !== imageCount * 16 ||
    entryArrayOffset + entryArrayBytes > data.byteLength
  ) {
    throw invalidInput('MPF image entries are missing or inconsistent')
  }
  const tiffAbsolute = segment.payloadRange.start + tiff
  const images: MpfImageEntry[] = []
  for (let index = 0; index < imageCount; index += 1) {
    const entry = entryArrayOffset + index * 16
    const attributes = read32(entry)
    const size = read32(entry + 4)
    const dataOffset = read32(entry + 8)
    const start = index === 0 ? sourceStart : tiffAbsolute + dataOffset
    const end = start + size
    if (size < 2 || !Number.isSafeInteger(end) || start < sourceStart || end > sourceSize) {
      throw invalidInput('MPF image range is outside the source')
    }
    const imageRange = range(start, end, 'MPF image')
    if (
      index > 0 &&
      images
        .slice(1)
        .some((image) => image.range.start < imageRange.end && imageRange.start < image.range.end)
    ) {
      throw invalidInput('MPF secondary image ranges overlap')
    }
    images.push(
      Object.freeze({
        attributes,
        dependentImage1: read16(entry + 12),
        dependentImage2: read16(entry + 14),
        range: imageRange,
      }),
    )
  }
  return Object.freeze({
    byteOrder: littleEndian ? 'little-endian' : 'big-endian',
    tiffOffset: tiffAbsolute,
    images: Object.freeze(images),
  })
}

const decimal = (value: string, label: string): number => {
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/u.test(value)) {
    throw invalidInput(`${label} is not a decimal number`)
  }
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) throw invalidInput(`${label} must be finite`)
  return parsed
}

const valueArray = (
  values: readonly string[] | undefined,
  label: string,
  fallback?: number,
): readonly number[] => {
  if (values === undefined) {
    if (fallback === undefined) throw invalidInput(`${label} is required`)
    return Object.freeze([fallback])
  }
  if (values.length !== 1 && values.length !== 3) {
    throw invalidInput(`${label} must contain one or three values`)
  }
  return Object.freeze(values.map((value, index) => decimal(value, `${label}[${index}]`)))
}

const hdrValues = (
  descriptions: ReturnType<typeof xmlElements>,
  localName: string,
): readonly string[] | undefined => {
  const attributes = descriptions
    .map((description) => xmlAttribute(description, HDR_GAIN_MAP_NAMESPACE, localName))
    .filter((value): value is string => value !== undefined)
  const propertyValues: string[][] = []
  for (const description of descriptions) {
    for (const property of xmlElements(description, HDR_GAIN_MAP_NAMESPACE, localName)) {
      if (property.children.length === 0) {
        const text = property.text.trim()
        if (text.length < 1) throw invalidInput(`Ultra HDR XMP ${localName} is empty`)
        propertyValues.push([text])
        continue
      }
      if (
        property.children.length !== 1 ||
        property.children[0]?.namespace !== RDF_NAMESPACE ||
        property.children[0].localName !== 'Seq'
      ) {
        throw invalidInput(`Ultra HDR XMP ${localName} must use an RDF sequence`)
      }
      const sequence = property.children[0]
      const values = sequence.children.map((item) => {
        if (
          item.namespace !== RDF_NAMESPACE ||
          item.localName !== 'li' ||
          item.children.length !== 0
        ) {
          throw invalidInput(`Ultra HDR XMP ${localName} has an invalid RDF sequence item`)
        }
        const text = item.text.trim()
        if (text.length < 1) throw invalidInput(`Ultra HDR XMP ${localName} has an empty value`)
        return text
      })
      propertyValues.push(values)
    }
  }
  if (attributes.length + propertyValues.length > 1) {
    throw invalidInput(`Ultra HDR XMP repeats ${localName}`)
  }
  const attribute = attributes[0]
  return attribute === undefined ? propertyValues[0] : Object.freeze([attribute])
}

const hdrScalar = (
  descriptions: ReturnType<typeof xmlElements>,
  localName: string,
): string | undefined => {
  const values = hdrValues(descriptions, localName)
  if (values === undefined) return undefined
  if (values.length !== 1 || values[0] === undefined) {
    throw invalidInput(`Ultra HDR XMP ${localName} must be scalar`)
  }
  return values[0]
}

const parseUltraHdr = (xml: Uint8Array, maxXmpBytes: number): UltraHdrXmpMetadata | undefined => {
  const root = parseBoundedXml(xml, { maxBytes: maxXmpBytes })
  const descriptions = xmlElements(root, RDF_NAMESPACE, 'Description')
  const version = hdrScalar(descriptions, 'Version')
  if (version === undefined) return undefined
  if (version !== '1.0') throw invalidInput('Ultra HDR XMP version is unsupported')
  const baseValue = hdrScalar(descriptions, 'BaseRenditionIsHDR') ?? 'False'
  if (baseValue !== 'False' && baseValue !== 'True') {
    throw invalidInput('Ultra HDR base rendition flag is invalid')
  }
  if (baseValue === 'True') {
    throw invalidInput('Ultra HDR v1.1 requires an SDR base rendition')
  }
  const fields = {
    minimum: hdrValues(descriptions, 'GainMapMin'),
    maximum: hdrValues(descriptions, 'GainMapMax'),
    gamma: hdrValues(descriptions, 'Gamma'),
    offsetSdr: hdrValues(descriptions, 'OffsetSDR'),
    offsetHdr: hdrValues(descriptions, 'OffsetHDR'),
    capacityMinimum: hdrScalar(descriptions, 'HDRCapacityMin'),
    capacityMaximum: hdrScalar(descriptions, 'HDRCapacityMax'),
  }
  if (Object.values(fields).every((value) => value === undefined)) return undefined
  const minimum = valueArray(fields.minimum, 'GainMapMin', 0)
  const maximum = valueArray(fields.maximum, 'GainMapMax')
  const gamma = valueArray(fields.gamma, 'Gamma', 1)
  const offsetSdr = valueArray(fields.offsetSdr, 'OffsetSDR', 1 / 64)
  const offsetHdr = valueArray(fields.offsetHdr, 'OffsetHDR', 1 / 64)
  const capacityMinimum = decimal(fields.capacityMinimum ?? '0', 'HDRCapacityMin')
  const capacityMaximum = decimal(fields.capacityMaximum ?? '', 'HDRCapacityMax')
  const cardinality = Math.max(
    minimum.length,
    maximum.length,
    gamma.length,
    offsetSdr.length,
    offsetHdr.length,
  )
  for (const [label, values] of Object.entries({ minimum, maximum, gamma, offsetSdr, offsetHdr })) {
    if (values.length !== 1 && values.length !== cardinality) {
      throw invalidInput(`Ultra HDR ${label} cardinality conflicts with other fields`)
    }
  }
  for (let channel = 0; channel < cardinality; channel += 1) {
    const at = (values: readonly number[]): number =>
      values.length === 1 ? (values[0] ?? 0) : (values[channel] ?? 0)
    if (at(gamma) <= 0 || at(minimum) > at(maximum)) {
      throw invalidInput('Ultra HDR gain range or gamma is invalid')
    }
    if (at(offsetSdr) < 0 || at(offsetHdr) < 0) {
      throw invalidInput('Ultra HDR offsets must be nonnegative')
    }
  }
  if (capacityMinimum < 0 || capacityMaximum <= capacityMinimum) {
    throw invalidInput('Ultra HDR display capacity is invalid')
  }
  const lexical: Record<string, readonly string[] | string> = {}
  for (const [name, value] of Object.entries(fields)) {
    if (value !== undefined)
      lexical[name] = ['capacityMinimum', 'capacityMaximum'].includes(name)
        ? value
        : Object.freeze(value)
  }
  return Object.freeze({
    version: '1.0',
    baseRendition: 'sdr',
    minimum,
    maximum,
    gamma,
    offsetSdr,
    offsetHdr,
    capacityMinimum,
    capacityMaximum,
    lexical: Object.freeze(lexical),
  })
}

const parseGContainer = (xml: Uint8Array, maxXmpBytes: number): readonly GContainerItem[] => {
  const root = parseBoundedXml(xml, { maxBytes: maxXmpBytes })
  const itemElements = xmlElements(root, CONTAINER_NAMESPACE, 'Item')
  const items: GContainerItem[] = []
  for (const element of itemElements) {
    const semantic = xmlAttribute(element, ITEM_NAMESPACE, 'Semantic')
    const mime = xmlAttribute(element, ITEM_NAMESPACE, 'Mime')
    if (semantic !== 'Primary' && semantic !== 'GainMap') continue
    if (mime !== 'image/jpeg') throw invalidInput('GContainer HDR item must use image/jpeg')
    const rawLength = xmlAttribute(element, ITEM_NAMESPACE, 'Length')
    const rawPadding = xmlAttribute(element, ITEM_NAMESPACE, 'Padding')
    const length = rawLength === undefined ? undefined : Number(rawLength)
    const padding = rawPadding === undefined ? 0 : Number(rawPadding)
    if (
      (length !== undefined && (!Number.isSafeInteger(length) || length < 0)) ||
      !Number.isSafeInteger(padding) ||
      padding < 0
    ) {
      throw invalidInput('GContainer item length or padding is invalid')
    }
    items.push(
      Object.freeze({
        semantic,
        mime,
        ...(length === undefined ? {} : { length }),
        padding,
      }),
    )
  }
  if (
    items.length > 0 &&
    (items[0]?.semantic !== 'Primary' ||
      items.filter((item) => item.semantic === 'Primary').length !== 1)
  ) {
    throw invalidInput('GContainer must begin with exactly one primary item')
  }
  if (items.filter((item) => item.semantic === 'GainMap').length > 1) {
    throw invalidInput('GContainer contains multiple gain maps')
  }
  return Object.freeze(items)
}

const standardXmp = (segments: readonly HdrJpegApplicationSegment[]): readonly Uint8Array[] => {
  const packets: Uint8Array[] = []
  for (const segment of segments) {
    if (segment.marker !== 0xe1 || !asciiPrefix(segment.payload, XMP_HEADER)) continue
    packets.push(segment.payload.subarray(XMP_HEADER.length))
  }
  return packets
}

const extendedXmpGuid = (
  packets: readonly Uint8Array[],
  maxXmpBytes: number,
): string | undefined => {
  const values: string[] = []
  for (const packet of packets) {
    const root = parseBoundedXml(packet, { maxBytes: maxXmpBytes })
    for (const description of xmlElements(root, RDF_NAMESPACE, 'Description')) {
      const attribute = xmlAttribute(description, XMP_NOTE_NAMESPACE, 'HasExtendedXMP')
      if (attribute !== undefined) values.push(attribute)
      for (const element of xmlElements(description, XMP_NOTE_NAMESPACE, 'HasExtendedXMP')) {
        if (element.children.length !== 0 || element.text.trim().length < 1) {
          throw invalidInput('Extended XMP GUID property is invalid')
        }
        values.push(element.text.trim())
      }
    }
  }
  if (values.length > 1) throw invalidInput('Standard XMP repeats the extended-packet GUID')
  const value = values[0]
  if (value !== undefined && !/^[0-9A-F]{32}$/u.test(value)) {
    throw invalidInput('Extended XMP GUID must contain 32 uppercase hexadecimal characters')
  }
  return value
}

const md5Hex = (data: Uint8Array): string => {
  const paddingBytes = (56 - ((data.byteLength + 1) % 64) + 64) % 64
  const bytes = new Uint8Array(data.byteLength + 1 + paddingBytes + 8)
  bytes.set(data)
  bytes[data.byteLength] = 0x80
  const bitLength = BigInt(data.byteLength) * 8n
  const tail = new DataView(bytes.buffer, bytes.byteLength - 8, 8)
  tail.setUint32(0, Number(bitLength & 0xffff_ffffn), true)
  tail.setUint32(4, Number(bitLength >> 32n), true)
  const shifts = [
    7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9,
    14, 20, 5, 9, 14, 20, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10, 15, 21,
    6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
  ] as const
  let a0 = 0x6745_2301
  let b0 = 0xefcd_ab89
  let c0 = 0x98ba_dcfe
  let d0 = 0x1032_5476
  const view = new DataView(bytes.buffer)
  for (let block = 0; block < bytes.byteLength; block += 64) {
    let a = a0
    let b = b0
    let c = c0
    let d = d0
    for (let index = 0; index < 64; index += 1) {
      let value: number
      let word: number
      if (index < 16) {
        value = (b & c) | (~b & d)
        word = index
      } else if (index < 32) {
        value = (d & b) | (~d & c)
        word = (5 * index + 1) % 16
      } else if (index < 48) {
        value = b ^ c ^ d
        word = (3 * index + 5) % 16
      } else {
        value = c ^ (b | ~d)
        word = (7 * index) % 16
      }
      const constant = Math.floor(Math.abs(Math.sin(index + 1)) * 0x1_0000_0000)
      const sum = (a + value + constant + view.getUint32(block + word * 4, true)) | 0
      const shift = shifts[index] ?? 0
      const rotated = (sum << shift) | (sum >>> (32 - shift))
      const next = d
      d = c
      c = b
      b = (b + rotated) | 0
      a = next
    }
    a0 = (a0 + a) | 0
    b0 = (b0 + b) | 0
    c0 = (c0 + c) | 0
    d0 = (d0 + d) | 0
  }
  const digest = new Uint8Array(16)
  const digestView = new DataView(digest.buffer)
  digestView.setUint32(0, a0, true)
  digestView.setUint32(4, b0, true)
  digestView.setUint32(8, c0, true)
  digestView.setUint32(12, d0, true)
  return Array.from(digest, (value) => value.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase()
}

const allXmp = (
  segments: readonly HdrJpegApplicationSegment[],
  limits: ResolvedHdrJpegLimits,
): readonly Uint8Array[] => {
  const standard = standardXmp(segments)
  const guid = extendedXmpGuid(standard, limits.maxXmpBytes)
  const chunks = segments.filter(
    (segment) => segment.marker === 0xe1 && asciiPrefix(segment.payload, EXTENDED_XMP_HEADER),
  )
  if (chunks.length === 0) {
    if (guid !== undefined)
      throw invalidInput('Extended XMP is declared but its chunks are missing')
    return standard
  }
  if (guid === undefined) throw invalidInput('Extended XMP chunks have no standard XMP declaration')
  if (chunks.length > limits.maxExtendedXmpChunks) {
    throw limitExceeded('Extended XMP chunks exceed the HDR limit')
  }
  const parts: Array<{ readonly offset: number; readonly data: Uint8Array }> = []
  let fullLength: number | undefined
  for (const segment of chunks) {
    const payload = segment.payload.subarray(EXTENDED_XMP_HEADER.length)
    if (payload.byteLength < 40) throw truncatedInput('Extended XMP chunk header is truncated')
    const chunkGuid = new TextDecoder('ascii').decode(payload.subarray(0, 32))
    if (chunkGuid !== guid)
      throw invalidInput('Extended XMP chunk GUID does not match its declaration')
    const length = uint32BigEndian(payload, 32)
    const offset = uint32BigEndian(payload, 36)
    const chunk = payload.subarray(40)
    if (length < 1 || length > limits.maxXmpBytes) {
      throw limitExceeded('Extended XMP packet exceeds the HDR XMP byte limit')
    }
    if (fullLength !== undefined && fullLength !== length) {
      throw invalidInput('Extended XMP chunks disagree on total length')
    }
    if (offset > length || chunk.byteLength > length - offset) {
      throw invalidInput('Extended XMP chunk range is outside the declared packet')
    }
    fullLength = length
    parts.push({ offset, data: chunk })
  }
  if (fullLength === undefined) throw invalidInput('Extended XMP packet is missing')
  parts.sort((left, right) => left.offset - right.offset)
  const packet = new Uint8Array(fullLength)
  let expectedOffset = 0
  for (const part of parts) {
    if (part.offset !== expectedOffset) {
      throw invalidInput('Extended XMP chunks overlap or leave a gap')
    }
    packet.set(part.data, part.offset)
    expectedOffset += part.data.byteLength
  }
  if (expectedOffset !== fullLength) throw invalidInput('Extended XMP packet is incomplete')
  parseBoundedXml(packet, { maxBytes: limits.maxXmpBytes })
  if (md5Hex(packet) !== guid) {
    throw invalidInput('Extended XMP packet digest does not match its declared GUID')
  }
  return Object.freeze([...standard, packet])
}

const isoPackets = (segments: readonly HdrJpegApplicationSegment[]): readonly Uint8Array[] => {
  const packets: Uint8Array[] = []
  for (const segment of segments) {
    if (segment.marker !== 0xe2 || !asciiPrefix(segment.payload, ISO_HEADER)) continue
    packets.push(segment.payload.subarray(ISO_HEADER.length))
  }
  return packets
}

const isHdrMetadataSegment = (segment: HdrJpegApplicationSegment): boolean =>
  (segment.marker === 0xe1 &&
    (asciiPrefix(segment.payload, XMP_HEADER) ||
      asciiPrefix(segment.payload, EXTENDED_XMP_HEADER))) ||
  (segment.marker === 0xe2 &&
    (asciiPrefix(segment.payload, 'MPF\0') || asciiPrefix(segment.payload, ISO_HEADER)))

const sortedUniqueRanges = (ranges: readonly JpegByteRange[]): readonly JpegByteRange[] => {
  const sorted = [...ranges].sort((left, right) => left.start - right.start || left.end - right.end)
  const result: JpegByteRange[] = []
  for (const candidate of sorted) {
    const previous = result.at(-1)
    if (!previous || previous.start !== candidate.start || previous.end !== candidate.end) {
      result.push(candidate)
    }
  }
  return Object.freeze(result)
}

const closeNumber = (left: number, right: number): boolean =>
  Math.abs(left - right) <= 1e-5 * Math.max(1, Math.abs(left), Math.abs(right))

const validateEquivalentMetadata = (iso: IsoGainMapMetadata, xmp: UltraHdrXmpMetadata): void => {
  if (iso.baseRendition !== xmp.baseRendition) {
    throw invalidInput('ISO and Ultra HDR metadata select different base renditions')
  }
  const pairs: readonly (readonly [readonly number[], readonly number[]])[] = [
    [iso.minimum, xmp.minimum],
    [iso.maximum, xmp.maximum],
    [iso.gamma, xmp.gamma],
    [iso.offsetSdr, xmp.offsetSdr],
    [iso.offsetHdr, xmp.offsetHdr],
  ]
  for (const [isoValues, xmpValues] of pairs) {
    for (let channel = 0; channel < 3; channel += 1) {
      const isoValue = isoValues[channel]
      const xmpValue = xmpValues.length === 1 ? xmpValues[0] : xmpValues[channel]
      if (isoValue === undefined || xmpValue === undefined || !closeNumber(isoValue, xmpValue)) {
        throw invalidInput('ISO and Ultra HDR metadata contain conflicting gain parameters')
      }
    }
  }
  if (
    !closeNumber(iso.capacityMinimum, xmp.capacityMinimum) ||
    !closeNumber(iso.capacityMaximum, xmp.capacityMaximum)
  ) {
    throw invalidInput('ISO and Ultra HDR metadata contain conflicting display capacities')
  }
}

const validateJpegRange = async (source: ImageSource, image: JpegByteRange): Promise<void> => {
  const [start, end] = await Promise.all([
    readExactly(source, image.start, 2),
    readExactly(source, image.end - 2, 2),
  ])
  if (start[0] !== 0xff || start[1] !== 0xd8 || end[0] !== 0xff || end[1] !== 0xd9) {
    throw invalidInput('MPF image range does not contain a complete JPEG')
  }
}

export const inspectHdrJpeg = async (
  source: ImageSource,
  options: Readonly<HdrJpegLimits & { readonly signal?: AbortSignal }> = {},
): Promise<HdrJpegInspection> => {
  const limits = resolveLimits(options)
  const header = await inspectHdrJpegHeader(source, 0, options)
  const mpfSegments = header.applicationSegments.filter(
    (segment) => segment.marker === 0xe2 && asciiPrefix(segment.payload, 'MPF\0'),
  )
  if (mpfSegments.length > 1) throw invalidInput('JPEG contains duplicate MPF indexes')
  const mpf = mpfSegments[0] ? parseMpf(mpfSegments[0], 0, source.size, limits) : undefined
  if (mpf?.images[0] && mpf.images[0].range.start !== 0) {
    throw invalidInput('MPF primary image does not begin at the source start')
  }
  const declaredPrimary = mpf?.images[0]?.range
  const firstSecondary = mpf?.images
    .slice(1)
    .reduce<MpfImageEntry | undefined>(
      (earliest, image) =>
        earliest === undefined || image.range.start < earliest.range.start ? image : earliest,
      undefined,
    )
  let primary = declaredPrimary
  if (declaredPrimary && firstSecondary && declaredPrimary.end !== firstSecondary.range.start) {
    const scannedPrimaryEnd = await findJpegEnd(source, 0, options)
    const boundedOverDeclaration = declaredPrimary.end - firstSecondary.range.start
    if (
      scannedPrimaryEnd !== firstSecondary.range.start ||
      boundedOverDeclaration < 1 ||
      boundedOverDeclaration > 65_535
    ) {
      throw invalidInput(
        'MPF declared primary size must end where the first secondary image begins',
      )
    }
    // Some Apple gain-map files over-declare the primary by a small APP-segment-sized amount.
    // Accept only when an independent EOI scan proves the exact secondary boundary.
    primary = range(0, scannedPrimaryEnd, 'JPEG primary')
  }
  primary ??= range(0, await findJpegEnd(source, 0, options), 'JPEG primary')
  await validateJpegRange(source, primary)
  if (mpf) {
    for (const image of mpf.images.slice(1)) {
      if (image.range.start < primary.end) {
        throw invalidInput('MPF secondary image overlaps the JPEG primary image')
      }
      await validateJpegRange(source, image.range)
    }
  }
  const primaryPackets = allXmp(header.applicationSegments, limits)
  const primaryIsoPackets = isoPackets(header.applicationSegments)
  if (primaryIsoPackets.length > 1)
    throw invalidInput('JPEG contains duplicate primary ISO metadata')
  if (primaryIsoPackets[0]) {
    if (
      primaryIsoPackets[0].byteLength !== 4 ||
      primaryIsoPackets[0][0] !== 0 ||
      primaryIsoPackets[0][1] !== 0
    ) {
      throw invalidInput('Primary JPEG ISO 21496-1 version marker is invalid')
    }
  }
  let ultraHdr: UltraHdrXmpMetadata | undefined
  let gContainerItems: readonly GContainerItem[] = []
  for (const packet of primaryPackets) {
    const parsed = parseUltraHdr(packet, limits.maxXmpBytes)
    if (parsed) {
      if (ultraHdr) throw invalidInput('JPEG contains duplicate Ultra HDR XMP packets')
      ultraHdr = parsed
    }
    const items = parseGContainer(packet, limits.maxXmpBytes)
    if (items.length > 0) {
      if (gContainerItems.length > 0)
        throw invalidInput('JPEG contains duplicate GContainer directories')
      gContainerItems = items
    }
  }
  const gainContainerItem = gContainerItems.find((item) => item.semantic === 'GainMap')
  const secondaryDetails = []
  for (const entry of mpf?.images.slice(1) ?? []) {
    const secondaryHeader = await inspectHdrJpegHeader(source, entry.range.start, options)
    const packets = allXmp(secondaryHeader.applicationSegments, limits)
    let secondaryUltraHdr: UltraHdrXmpMetadata | undefined
    for (const packet of packets) {
      const parsed = parseUltraHdr(packet, limits.maxXmpBytes)
      if (parsed) {
        if (secondaryUltraHdr)
          throw invalidInput('JPEG secondary contains duplicate Ultra HDR metadata')
        secondaryUltraHdr = parsed
      }
    }
    const secondaryIsoPackets = isoPackets(secondaryHeader.applicationSegments)
    if (secondaryIsoPackets.length > 1) {
      throw invalidInput('JPEG secondary contains duplicate ISO gain-map metadata')
    }
    secondaryDetails.push(
      Object.freeze({
        entry,
        header: secondaryHeader,
        packets,
        ...(secondaryUltraHdr ? { ultraHdr: secondaryUltraHdr } : {}),
        ...(secondaryIsoPackets[0] ? { iso: parseIsoGainMapMetadata(secondaryIsoPackets[0]) } : {}),
      }),
    )
  }
  const unique = <Value>(values: readonly Value[], label: string): Value | undefined => {
    if (values.length > 1) throw invalidInput(`${label} selects multiple MPF images`)
    return values[0]
  }
  const byContainer =
    gainContainerItem?.length === undefined
      ? undefined
      : unique(
          secondaryDetails.filter(
            (detail) =>
              detail.entry.range.end - detail.entry.range.start === gainContainerItem.length,
          ),
          'GContainer gain-map length',
        )
  if (gainContainerItem?.length !== undefined && !byContainer) {
    throw invalidInput('GContainer gain-map length does not match an MPF image')
  }
  const byMetadata = unique(
    secondaryDetails.filter((detail) => detail.iso !== undefined || detail.ultraHdr !== undefined),
    'Gain-map metadata',
  )
  if (byContainer && byMetadata && byContainer.entry.range.start !== byMetadata.entry.range.start) {
    throw invalidInput('GContainer and gain-map metadata select different MPF images')
  }
  const soleSemanticSecondary =
    secondaryDetails.length === 1 &&
    (gainContainerItem !== undefined || ultraHdr !== undefined || primaryIsoPackets.length > 0)
      ? secondaryDetails[0]
      : undefined
  const selectedGain = byContainer ?? byMetadata ?? soleSemanticSecondary
  const gainMap = selectedGain?.entry.range
  const gainMapDimensions = selectedGain?.header.dimensions
  const gainPackets = selectedGain?.packets ?? []
  const iso = selectedGain?.iso
  if (selectedGain?.ultraHdr) {
    if (ultraHdr) throw invalidInput('JPEG contains duplicate Ultra HDR metadata')
    ultraHdr = selectedGain.ultraHdr
  }
  if (primaryIsoPackets.length > 0 !== (iso !== undefined)) {
    throw invalidInput('JPEG ISO 21496-1 primary and gain-map metadata are incomplete')
  }
  if (gainContainerItem && gainMap && gainContainerItem.length !== gainMap.end - gainMap.start) {
    throw invalidInput('GContainer gain-map length conflicts with MPF')
  }
  if (ultraHdr && !gainMap) throw invalidInput('Ultra HDR metadata has no validated gain-map JPEG')
  if (iso && ultraHdr) validateEquivalentMetadata(iso, ultraHdr)
  if (
    iso &&
    gainMapDimensions &&
    iso.channelCount !== (gainMapDimensions.components === 1 ? 1 : 3)
  ) {
    throw invalidInput('ISO 21496-1 channel count conflicts with the gain-map JPEG')
  }
  const representations = Object.freeze([
    ...(iso ? ['iso-21496-1' as const] : []),
    ...(ultraHdr ? ['ultra-hdr-xmp' as const] : []),
  ])
  return Object.freeze({
    primary,
    ...(gainMap ? { gainMap } : {}),
    primaryDimensions: header.dimensions,
    ...(gainMapDimensions ? { gainMapDimensions } : {}),
    ...(mpf ? { mpf } : {}),
    gContainerItems,
    ...(ultraHdr ? { ultraHdr } : {}),
    ...(iso ? { iso } : {}),
    representations,
    xmpPackets: Object.freeze([...primaryPackets, ...gainPackets]),
    metadataRanges: sortedUniqueRanges([
      ...header.applicationSegments.filter(isHdrMetadataSegment).map((segment) => segment.range),
      ...(selectedGain?.header.applicationSegments ?? [])
        .filter(isHdrMetadataSegment)
        .map((segment) => segment.range),
    ]),
  })
}
