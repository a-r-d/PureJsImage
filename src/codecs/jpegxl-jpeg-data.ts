import { invalidInput, limitExceeded, unsupportedOperation } from '../errors.ts'
import type { JpegCoefficientImage } from './jpeg-coefficients.ts'
import type { JpegXlLimits } from './jpegxl-limits.ts'
import type {
  JpegXlJpegHuffmanTable,
  JpegXlJpegReconstructionBlobs,
  JpegXlJpegReconstructionHeader,
  JpegXlJpegScan,
} from './jpegxl-jpeg-reconstruction.ts'

interface ParsedJpegSegment {
  readonly marker: number
  readonly markerOffset: number
  readonly payloadOffset: number
  readonly end: number
}

export interface ParsedJpegReconstructionData {
  readonly header: JpegXlJpegReconstructionHeader
  readonly blobs: JpegXlJpegReconstructionBlobs
}

const byte = (data: Uint8Array, offset: number): number => {
  const value = data[offset]
  if (value === undefined) throw invalidInput('JPEG reconstruction input is truncated')
  return value
}

const uint16 = (data: Uint8Array, offset: number): number =>
  (byte(data, offset) << 8) | byte(data, offset + 1)

const markerSegment = (data: Uint8Array, markerOffset: number): ParsedJpegSegment => {
  const marker = byte(data, markerOffset + 1)
  if (marker === 0xd9) {
    return Object.freeze({ marker, markerOffset, payloadOffset: markerOffset + 2, end: markerOffset + 2 })
  }
  const length = uint16(data, markerOffset + 2)
  if (length < 2) throw invalidInput('JPEG reconstruction segment length is invalid')
  const end = markerOffset + 2 + length
  if (!Number.isSafeInteger(end) || end > data.byteLength) {
    throw invalidInput('JPEG reconstruction segment is truncated')
  }
  return Object.freeze({ marker, markerOffset, payloadOffset: markerOffset + 4, end })
}

const nextMarkerOffset = (data: Uint8Array, offset: number): number => {
  for (let position = offset; position + 1 < data.byteLength; position += 1) {
    if (data[position] !== 0xff) continue
    const marker = data[position + 1]
    if (marker === 0x00) {
      position += 1
      continue
    }
    if (marker !== undefined && marker >= 0xd0 && marker <= 0xd7) {
      position += 1
      continue
    }
    if (marker === 0xff) {
      throw unsupportedOperation('JPEG fill bytes between entropy data and markers are unsupported')
    }
    return position
  }
  throw invalidInput('JPEG reconstruction input has no end marker')
}

const terminalHuffmanTable = (
  kind: 'dc' | 'ac',
  slot: number,
  countsInput: readonly number[],
  valuesInput: readonly number[],
  lastInMarker: boolean,
): JpegXlJpegHuffmanTable => {
  const counts = [0, ...countsInput]
  let terminalLength = 0
  for (let bits = 16; bits >= 1; bits -= 1) {
    if ((counts[bits] ?? 0) !== 0) {
      terminalLength = bits
      break
    }
  }
  if (terminalLength === 0) throw invalidInput('JPEG Huffman table is empty')
  counts[terminalLength] = (counts[terminalLength] ?? 0) + 1

  let available = 1
  for (let bits = 1; bits <= 16; bits += 1) {
    available = available * 2 - (counts[bits] ?? 0)
    if (available < 0) throw invalidInput('JPEG Huffman table cannot accept reconstruction terminal')
  }
  return Object.freeze({
    kind,
    slot,
    lastInMarker,
    counts: Object.freeze(counts),
    values: Object.freeze([...valuesInput, 256]),
  })
}

const parseHuffmanMarker = (
  data: Uint8Array,
  segment: ParsedJpegSegment,
): readonly JpegXlJpegHuffmanTable[] => {
  const tables: JpegXlJpegHuffmanTable[] = []
  let offset = segment.payloadOffset
  while (offset < segment.end) {
    const descriptor = byte(data, offset++)
    const kind = (descriptor >>> 4) === 0 ? 'dc' : (descriptor >>> 4) === 1 ? 'ac' : undefined
    const slot = descriptor & 15
    if (!kind || slot > 3) throw invalidInput('JPEG Huffman table descriptor is invalid')
    const counts = Array.from({ length: 16 }, () => byte(data, offset++))
    const count = counts.reduce((sum, current) => sum + current, 0)
    if (offset + count > segment.end) throw invalidInput('JPEG Huffman values are truncated')
    const values = Array.from(data.subarray(offset, offset + count))
    offset += count
    tables.push(terminalHuffmanTable(kind, slot, counts, values, offset === segment.end))
  }
  if (offset !== segment.end) throw invalidInput('JPEG Huffman marker length is inconsistent')
  return Object.freeze(tables)
}

const parseQuantizationMarker = (
  data: Uint8Array,
  segment: ParsedJpegSegment,
): readonly Readonly<{ precision: 8 | 16; index: number; lastInMarker: boolean }>[] => {
  const tables: { precision: 8 | 16; index: number; lastInMarker: boolean }[] = []
  let offset = segment.payloadOffset
  while (offset < segment.end) {
    const descriptor = byte(data, offset++)
    const precision = descriptor >>> 4
    const index = descriptor & 15
    if ((precision !== 0 && precision !== 1) || index > 3) {
      throw invalidInput('JPEG quantization table descriptor is invalid')
    }
    offset += precision === 0 ? 64 : 128
    if (offset > segment.end) throw invalidInput('JPEG quantization table is truncated')
    tables.push(Object.freeze({ precision: precision === 0 ? 8 : 16, index, lastInMarker: offset === segment.end }))
  }
  if (offset !== segment.end) throw invalidInput('JPEG quantization marker length is inconsistent')
  return Object.freeze(tables)
}

const parseFrameComponents = (
  data: Uint8Array,
  segment: ParsedJpegSegment,
): Readonly<{ ids: readonly number[]; quantizationTables: readonly number[] }> => {
  if (byte(data, segment.payloadOffset) !== 8) {
    throw unsupportedOperation('Exact JPEG transcode requires 8-bit JPEG input')
  }
  const count = byte(data, segment.payloadOffset + 5)
  if (count !== 1 && count !== 3) {
    throw unsupportedOperation('Exact JPEG transcode requires grayscale or three-component JPEG')
  }
  if (segment.payloadOffset + 6 + count * 3 !== segment.end) {
    throw invalidInput('JPEG frame component descriptors are malformed')
  }
  const ids: number[] = []
  const quantizationTables: number[] = []
  for (let index = 0; index < count; index += 1) {
    ids.push(byte(data, segment.payloadOffset + 6 + index * 3))
    quantizationTables.push(byte(data, segment.payloadOffset + 8 + index * 3))
  }
  if (new Set(ids).size !== ids.length) throw invalidInput('JPEG component identifiers repeat')
  return Object.freeze({ ids: Object.freeze(ids), quantizationTables: Object.freeze(quantizationTables) })
}

const parseScan = (
  data: Uint8Array,
  segment: ParsedJpegSegment,
  componentIds: readonly number[],
): JpegXlJpegScan => {
  const count = byte(data, segment.payloadOffset)
  if (count < 1 || count > componentIds.length || segment.payloadOffset + 1 + count * 2 + 3 !== segment.end) {
    throw invalidInput('JPEG scan header is malformed')
  }
  const components = Array.from({ length: count }, (_, index) => {
    const id = byte(data, segment.payloadOffset + 1 + index * 2)
    const component = componentIds.indexOf(id)
    if (component < 0) throw invalidInput('JPEG scan references an unknown component')
    const tables = byte(data, segment.payloadOffset + 2 + index * 2)
    return Object.freeze({ component, dcTable: tables >>> 4, acTable: tables & 15 })
  })
  if (new Set(components.map(({ component }) => component)).size !== components.length) {
    throw invalidInput('JPEG scan repeats a component')
  }
  const spectralOffset = segment.payloadOffset + 1 + count * 2
  const successive = byte(data, spectralOffset + 2)
  return Object.freeze({
    spectralStart: byte(data, spectralOffset),
    spectralEnd: byte(data, spectralOffset + 1),
    successiveHigh: successive >>> 4,
    successiveLow: successive & 15,
    components: Object.freeze(components),
    lastNeededPass: 0,
    resetPoints: Object.freeze([]),
    extraZeroRuns: Object.freeze([]),
  })
}

const checkCoefficientAgreement = (
  componentIds: readonly number[],
  quantizationTables: readonly number[],
  image: JpegCoefficientImage,
): void => {
  if (image.components.length !== componentIds.length) {
    throw invalidInput('JPEG reconstruction component count disagrees with decoded coefficients')
  }
  for (let index = 0; index < image.components.length; index += 1) {
    const component = image.components[index]
    if (!component || component.id !== componentIds[index] || component.quantizationTable !== quantizationTables[index]) {
      throw invalidInput('JPEG reconstruction component descriptors disagree with decoded coefficients')
    }
  }
}

/** Parse the byte-layout data needed by JPEG XL exact JPEG reconstruction.
 *
 * The initial writer accepts only JPEGs whose entropy stream is reproduced by the canonical
 * reconstruction path. Callers must verify the reconstructed bytes before emitting a JXL file.
 */
export const parseJpegReconstructionData = (
  data: Uint8Array,
  image: JpegCoefficientImage,
  limits: Readonly<JpegXlLimits>,
): ParsedJpegReconstructionData => {
  if (data.byteLength > limits.maxReconstructedJpegBytes) {
    throw limitExceeded(`JPEG input has ${data.byteLength} bytes; maxReconstructedJpegBytes is ${limits.maxReconstructedJpegBytes}`)
  }
  if (data.byteLength < 4 || uint16(data, 0) !== 0xffd8) {
    throw invalidInput('JPEG start marker is missing')
  }
  const markerOrder: number[] = []
  const appMarkers: { type: 'unknown'; byteLength: number }[] = []
  const unknownAppMarkers: Uint8Array[] = []
  const commentByteLengths: number[] = []
  const comments: Uint8Array[] = []
  const quantizationTables: { precision: 8 | 16; index: number; lastInMarker: boolean }[] = []
  const huffmanTables: JpegXlJpegHuffmanTable[] = []
  const scans: JpegXlJpegScan[] = []
  let componentIds: readonly number[] | undefined
  let componentQuantizationTables: readonly number[] | undefined
  let restartInterval: number | undefined
  let offset = 2
  let tail = new Uint8Array()

  while (offset < data.byteLength) {
    if (byte(data, offset) !== 0xff || byte(data, offset + 1) === 0xff) {
      throw unsupportedOperation('JPEG inter-marker fill data is unsupported by exact transcode')
    }
    const segment = markerSegment(data, offset)
    markerOrder.push(segment.marker)
    if (markerOrder.length > limits.maxJpegMarkers) {
      throw limitExceeded(`JPEG has more than ${limits.maxJpegMarkers} markers`)
    }
    if ((segment.marker & 0xf0) === 0xe0) {
      const bytes = data.slice(segment.markerOffset + 1, segment.end)
      appMarkers.push(Object.freeze({ type: 'unknown', byteLength: bytes.byteLength }))
      unknownAppMarkers.push(bytes)
    } else if (segment.marker === 0xfe) {
      const bytes = data.slice(segment.markerOffset + 1, segment.end)
      commentByteLengths.push(bytes.byteLength)
      comments.push(bytes)
    } else if (segment.marker === 0xdb) {
      quantizationTables.push(...parseQuantizationMarker(data, segment))
    } else if (segment.marker === 0xc4) {
      huffmanTables.push(...parseHuffmanMarker(data, segment))
    } else if (segment.marker === 0xc0 || segment.marker === 0xc1 || segment.marker === 0xc2) {
      if (componentIds) throw invalidInput('JPEG contains multiple frames')
      const components = parseFrameComponents(data, segment)
      componentIds = components.ids
      componentQuantizationTables = components.quantizationTables
    } else if (segment.marker === 0xdd) {
      if (segment.end - segment.payloadOffset !== 2) throw invalidInput('JPEG restart interval is malformed')
      restartInterval = uint16(data, segment.payloadOffset)
    } else if (segment.marker === 0xda) {
      if (!componentIds) throw invalidInput('JPEG scan appears before its frame')
      scans.push(parseScan(data, segment, componentIds))
      if (scans.length > limits.maxJpegScans) throw limitExceeded(`JPEG has more than ${limits.maxJpegScans} scans`)
      offset = nextMarkerOffset(data, segment.end)
      continue
    } else if (segment.marker === 0xd9) {
      tail = data.slice(segment.end)
      offset = data.byteLength
      continue
    } else {
      throw unsupportedOperation(`JPEG marker 0x${segment.marker.toString(16).padStart(2, '0')} is unsupported by exact transcode`)
    }
    offset = segment.end
  }

  if (markerOrder.at(-1) !== 0xd9 || !componentIds || !componentQuantizationTables || scans.length === 0) {
    throw invalidInput('JPEG reconstruction structure is incomplete')
  }
  if (huffmanTables.length > limits.maxJpegHuffmanTables) {
    throw limitExceeded(`JPEG has more than ${limits.maxJpegHuffmanTables} Huffman tables`)
  }
  if (quantizationTables.length < 1 || quantizationTables.length > 3) {
    throw unsupportedOperation('Exact JPEG transcode requires one to three quantization tables')
  }
  checkCoefficientAgreement(componentIds, componentQuantizationTables, image)
  const decodedBytes = [...unknownAppMarkers, ...comments, tail].reduce((sum, bytes) => sum + bytes.byteLength, 0)
  if (decodedBytes > limits.maxMetadataBytes) {
    throw limitExceeded(`JPEG reconstruction metadata has ${decodedBytes} bytes; maxMetadataBytes is ${limits.maxMetadataBytes}`)
  }
  return Object.freeze({
    header: Object.freeze({
      markerOrder: Object.freeze(markerOrder),
      appMarkers: Object.freeze(appMarkers),
      commentByteLengths: Object.freeze(commentByteLengths),
      quantizationTables: Object.freeze(quantizationTables),
      componentIds,
      componentQuantizationTables,
      huffmanTables: Object.freeze(huffmanTables),
      scans: Object.freeze(scans),
      restartInterval,
      interMarkerByteLengths: Object.freeze([]),
      tailByteLength: tail.byteLength,
      paddingBits: Object.freeze([]),
      compressedDataOffset: 0,
      compressedDataBytes: 0,
    }),
    blobs: Object.freeze({
      unknownAppMarkers: Object.freeze(unknownAppMarkers),
      comments: Object.freeze(comments),
      interMarkerData: Object.freeze([]),
      tail,
      decodedBytes,
    }),
  })
}
