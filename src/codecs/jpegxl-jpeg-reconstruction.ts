import { invalidInput, limitExceeded } from '../errors.ts'
import { decodeUncompressedBrotli } from './brotli.ts'
import { JpegXlBitReader } from './jpegxl-bitstream.ts'
import type { JpegXlLimits } from './jpegxl-limits.ts'

export type JpegXlJpegAppMarkerType = 'unknown' | 'icc' | 'exif' | 'xmp'

export interface JpegXlJpegAppMarker {
  readonly type: JpegXlJpegAppMarkerType
  readonly byteLength: number
}

export interface JpegXlJpegQuantizationTable {
  readonly precision: 8 | 16
  readonly index: number
  readonly lastInMarker: boolean
}

export interface JpegXlJpegHuffmanTable {
  readonly slot: number
  readonly kind: 'dc' | 'ac'
  readonly lastInMarker: boolean
  readonly counts: readonly number[]
  readonly values: readonly number[]
}

export interface JpegXlJpegScanComponent {
  readonly component: number
  readonly dcTable: number
  readonly acTable: number
}

export interface JpegXlJpegExtraZeroRun {
  readonly block: number
  readonly runs: number
}

export interface JpegXlJpegScan {
  readonly spectralStart: number
  readonly spectralEnd: number
  readonly successiveLow: number
  readonly successiveHigh: number
  readonly components: readonly JpegXlJpegScanComponent[]
  readonly lastNeededPass: number
  readonly resetPoints: readonly number[]
  readonly extraZeroRuns: readonly JpegXlJpegExtraZeroRun[]
}

export interface JpegXlJpegReconstructionHeader {
  readonly markerOrder: readonly number[]
  readonly appMarkers: readonly JpegXlJpegAppMarker[]
  readonly commentByteLengths: readonly number[]
  readonly quantizationTables: readonly JpegXlJpegQuantizationTable[]
  readonly componentIds: readonly number[]
  readonly componentQuantizationTables: readonly number[]
  readonly huffmanTables: readonly JpegXlJpegHuffmanTable[]
  readonly scans: readonly JpegXlJpegScan[]
  readonly restartInterval: number | undefined
  readonly interMarkerByteLengths: readonly number[]
  readonly tailByteLength: number
  readonly paddingBits: readonly number[]
  readonly compressedDataOffset: number
  readonly compressedDataBytes: number
}

export interface JpegXlJpegReconstructionBlobs {
  readonly unknownAppMarkers: readonly Uint8Array[]
  readonly comments: readonly Uint8Array[]
  readonly interMarkerData: readonly Uint8Array[]
  readonly tail: Uint8Array
  readonly decodedBytes: number
}

type U32Distribution =
  | Readonly<{ readonly value: number }>
  | Readonly<{ readonly offset: number; readonly bits: number }>

const value = (constant: number): U32Distribution => Object.freeze({ value: constant })
const bits = (width: number, offset = 0): U32Distribution => Object.freeze({ offset, bits: width })

const readU32 = (reader: JpegXlBitReader, distributions: readonly U32Distribution[]): number => {
  const distribution = distributions[reader.readBits(2)]
  if (!distribution) throw invalidInput('JPEG XL reconstruction integer selector is invalid')
  return 'value' in distribution
    ? distribution.value
    : distribution.offset + reader.readBits(distribution.bits)
}

const freezeNumbers = (numbers: number[]): readonly number[] => Object.freeze(numbers)

const appMarkerTypes: readonly JpegXlJpegAppMarkerType[] = Object.freeze([
  'unknown',
  'icc',
  'exif',
  'xmp',
])

const checkedDeltaIndex = (previous: number, delta: number, label: string): number => {
  const index = previous + 1 + delta
  if (!Number.isSafeInteger(index) || index < 0 || index >= 3 * 2 ** 26) {
    throw invalidInput(`JPEG XL reconstruction ${label} is out of range`)
  }
  return index
}

const readMarkerOrder = (
  reader: JpegXlBitReader,
  limits: JpegXlLimits,
): {
  readonly markers: readonly number[]
  readonly appCount: number
  readonly commentCount: number
  readonly scanCount: number
  readonly interMarkerCount: number
  readonly hasRestartInterval: boolean
} => {
  const markers: number[] = []
  let appCount = 0
  let commentCount = 0
  let scanCount = 0
  let interMarkerCount = 0
  let hasRestartInterval = false
  while (markers.length < limits.maxJpegMarkers) {
    const marker = 0xc0 + reader.readBits(6)
    markers.push(marker)
    if ((marker & 0xf0) === 0xe0) appCount += 1
    if (marker === 0xfe) commentCount += 1
    if (marker === 0xda) scanCount += 1
    if (marker === 0xff) interMarkerCount += 1
    if (marker === 0xdd) hasRestartInterval = true
    if (marker === 0xd9) break
  }
  if (markers.at(-1) !== 0xd9) {
    if (markers.length >= limits.maxJpegMarkers) {
      throw limitExceeded(
        `JPEG XL reconstruction has at least ${markers.length} markers; maxJpegMarkers is ${limits.maxJpegMarkers}`,
      )
    }
    throw invalidInput('JPEG XL reconstruction marker order has no EOI')
  }
  if (scanCount === 0) throw invalidInput('JPEG XL reconstruction has no JPEG scans')
  if (scanCount > limits.maxJpegScans) {
    throw limitExceeded(
      `JPEG XL reconstruction has ${scanCount} scans; maxJpegScans is ${limits.maxJpegScans}`,
    )
  }
  return Object.freeze({
    markers: freezeNumbers(markers),
    appCount,
    commentCount,
    scanCount,
    interMarkerCount,
    hasRestartInterval,
  })
}

const readAppMarkers = (reader: JpegXlBitReader, count: number): readonly JpegXlJpegAppMarker[] =>
  Object.freeze(
    Array.from({ length: count }, () => {
      const typeIndex = readU32(reader, [value(0), value(1), bits(1, 2), bits(2, 4)])
      const type = appMarkerTypes[typeIndex]
      if (!type) throw invalidInput('JPEG XL reconstruction APP marker type is invalid')
      const byteLength = reader.readBits(16) + 1
      if (byteLength < 3) {
        throw invalidInput('JPEG XL reconstruction APP marker is shorter than its JPEG header')
      }
      return Object.freeze({ type, byteLength })
    }),
  )

const readQuantizationTables = (
  reader: JpegXlBitReader,
): readonly JpegXlJpegQuantizationTable[] => {
  const count = readU32(reader, [value(1), value(2), value(3), value(4)])
  if (count === 4) throw invalidInput('JPEG XL reconstruction has an invalid quantization count')
  return Object.freeze(
    Array.from({ length: count }, (_, table) => {
      const precision = reader.readBits(1) === 0 ? 8 : 16
      const index = reader.readBits(2)
      const lastInMarker = reader.readBits(1) !== 0
      if (index > 3) throw invalidInput('JPEG XL reconstruction quantization index is invalid')
      if (table === 0 && index !== 0) {
        throw invalidInput('JPEG XL reconstruction first quantization table index is invalid')
      }
      return Object.freeze({ precision, index, lastInMarker })
    }),
  )
}

const readComponents = (
  reader: JpegXlBitReader,
  gray: boolean,
  quantizationTableCount: number,
): {
  readonly ids: readonly number[]
  readonly quantizationTables: readonly number[]
} => {
  const componentType = reader.readBits(2)
  let ids: number[]
  if (componentType === 0) ids = [1]
  else if (componentType === 1) ids = [1, 2, 3]
  else if (componentType === 2) ids = [0x52, 0x47, 0x42]
  else {
    const count = readU32(reader, [value(1), value(2), value(3), value(4)])
    if (count !== 1 && count !== 3) {
      throw invalidInput('JPEG XL reconstruction component count is unsupported')
    }
    ids = Array.from({ length: count }, () => reader.readBits(8))
  }
  const expectedCount = gray ? 1 : 3
  if (ids.length !== expectedCount) {
    throw invalidInput('JPEG XL reconstruction grayscale and component fields disagree')
  }
  if (new Set(ids).size !== ids.length) {
    throw invalidInput('JPEG XL reconstruction component identifiers repeat')
  }
  const quantizationTables = ids.map(() => reader.readBits(2))
  if (quantizationTables.some((index) => index >= quantizationTableCount)) {
    throw invalidInput('JPEG XL reconstruction component references a missing quantization table')
  }
  return Object.freeze({
    ids: freezeNumbers(ids),
    quantizationTables: freezeNumbers(quantizationTables),
  })
}

const readHuffmanTables = (
  reader: JpegXlBitReader,
  limits: JpegXlLimits,
): readonly JpegXlJpegHuffmanTable[] => {
  const count = readU32(reader, [value(4), bits(3, 2), bits(4, 10), bits(6, 26)])
  if (count > limits.maxJpegHuffmanTables) {
    throw limitExceeded(
      `JPEG XL reconstruction has ${count} Huffman tables; maxJpegHuffmanTables is ${limits.maxJpegHuffmanTables}`,
    )
  }
  return Object.freeze(
    Array.from({ length: count }, () => {
      const kind = reader.readBits(1) === 0 ? 'dc' : 'ac'
      const slot = reader.readBits(2)
      const lastInMarker = reader.readBits(1) !== 0
      const counts = Array.from({ length: 17 }, () =>
        readU32(reader, [value(0), value(1), bits(3, 2), bits(8)]),
      )
      const symbolCount = counts.reduce((sum, current) => sum + current, 0)
      if (symbolCount > 257) {
        throw invalidInput('JPEG XL reconstruction Huffman table has too many symbols')
      }
      const values = Array.from({ length: symbolCount }, () =>
        readU32(reader, [bits(2), bits(2, 4), bits(4, 8), bits(8, 1)]),
      )
      if (symbolCount !== 0) {
        if (values.at(-1) !== 256) {
          throw invalidInput('JPEG XL reconstruction Huffman table has no terminal symbol')
        }
        if (new Set(values).size !== values.length) {
          throw invalidInput('JPEG XL reconstruction Huffman table repeats a symbol')
        }
        if (kind === 'dc' && values.some((symbol) => symbol !== 256 && symbol >= 12)) {
          throw invalidInput('JPEG XL reconstruction DC Huffman symbol is invalid')
        }
      }
      return Object.freeze({
        slot,
        kind,
        lastInMarker,
        counts: freezeNumbers(counts),
        values: freezeNumbers(values),
      })
    }),
  )
}

const readDeltaIndexes = (
  reader: JpegXlBitReader,
  count: number,
  label: string,
): readonly number[] => {
  const indexes: number[] = []
  let previous = -1
  for (let index = 0; index < count; index += 1) {
    const delta = readU32(reader, [value(0), bits(3, 1), bits(5, 9), bits(28, 41)])
    previous = checkedDeltaIndex(previous, delta, label)
    indexes.push(previous)
  }
  return freezeNumbers(indexes)
}

const readScans = (
  reader: JpegXlBitReader,
  count: number,
  componentCount: number,
): readonly JpegXlJpegScan[] => {
  const headers = Array.from({ length: count }, () => {
    const scanComponentCount = readU32(reader, [value(1), value(2), value(3), value(4)])
    if (scanComponentCount >= 4 || scanComponentCount > componentCount) {
      throw invalidInput('JPEG XL reconstruction scan component count is invalid')
    }
    const spectralStart = reader.readBits(6)
    const spectralEnd = reader.readBits(6)
    const successiveLow = reader.readBits(4)
    const successiveHigh = reader.readBits(4)
    if (spectralEnd < spectralStart) {
      throw invalidInput('JPEG XL reconstruction scan spectral range is invalid')
    }
    const components = Object.freeze(
      Array.from({ length: scanComponentCount }, () => {
        const component = reader.readBits(2)
        const acTable = reader.readBits(2)
        const dcTable = reader.readBits(2)
        if (component >= componentCount) {
          throw invalidInput('JPEG XL reconstruction scan references a missing component')
        }
        return Object.freeze({ component, dcTable, acTable })
      }),
    )
    if (new Set(components.map(({ component }) => component)).size !== components.length) {
      throw invalidInput('JPEG XL reconstruction scan repeats a component')
    }
    const lastNeededPass = readU32(reader, [value(0), value(1), value(2), bits(3, 3)])
    return { spectralStart, spectralEnd, successiveLow, successiveHigh, components, lastNeededPass }
  })
  return Object.freeze(
    headers.map((header) =>
      Object.freeze({
        ...header,
        resetPoints: Object.freeze([]),
        extraZeroRuns: Object.freeze([]),
      }),
    ),
  )
}

export const parseJpegXlJpegReconstructionHeader = (
  payload: Uint8Array,
  limits: JpegXlLimits,
): JpegXlJpegReconstructionHeader => {
  if (payload.byteLength > limits.maxMetadataBytes) {
    throw limitExceeded(
      `JPEG XL jbrd has ${payload.byteLength} bytes; maxMetadataBytes is ${limits.maxMetadataBytes}`,
    )
  }
  const reader = new JpegXlBitReader(payload)
  const gray = reader.readBits(1) !== 0
  const markerOrder = readMarkerOrder(reader, limits)
  const appMarkers = readAppMarkers(reader, markerOrder.appCount)
  const commentByteLengths = freezeNumbers(
    Array.from({ length: markerOrder.commentCount }, () => {
      const byteLength = reader.readBits(16) + 1
      if (byteLength < 3) {
        throw invalidInput('JPEG XL reconstruction COM marker is shorter than its JPEG header')
      }
      return byteLength
    }),
  )
  const quantizationTables = readQuantizationTables(reader)
  const components = readComponents(reader, gray, quantizationTables.length)
  const huffmanTables = readHuffmanTables(reader, limits)
  const scans = readScans(reader, markerOrder.scanCount, components.ids.length)
  const restartInterval = markerOrder.hasRestartInterval ? reader.readBits(16) : undefined

  const scansWithExactness = Object.freeze(
    scans.map((scan) => {
      const resetPointCount = readU32(reader, [value(0), bits(2, 1), bits(4, 4), bits(16, 20)])
      const resetPoints = readDeltaIndexes(reader, resetPointCount, 'reset point')
      const extraZeroRunCount = readU32(reader, [value(0), bits(2, 1), bits(4, 4), bits(16, 20)])
      const extraZeroRuns: JpegXlJpegExtraZeroRun[] = []
      let previous = -1
      for (let index = 0; index < extraZeroRunCount; index += 1) {
        const runs = readU32(reader, [value(1), bits(2, 2), bits(4, 5), bits(8, 20)])
        if (runs > 4) throw invalidInput('JPEG XL reconstruction extra zero-run count is invalid')
        const delta = readU32(reader, [value(0), bits(3, 1), bits(5, 9), bits(28, 41)])
        previous = checkedDeltaIndex(previous, delta, 'extra zero-run block')
        extraZeroRuns.push(Object.freeze({ block: previous, runs }))
      }
      return Object.freeze({ ...scan, resetPoints, extraZeroRuns: Object.freeze(extraZeroRuns) })
    }),
  )
  const interMarkerByteLengths = freezeNumbers(
    Array.from({ length: markerOrder.interMarkerCount }, () => reader.readBits(16)),
  )
  const tailByteLength = readU32(reader, [value(0), bits(8, 1), bits(16, 257), bits(22, 65_793)])
  const hasPaddingBits = reader.readBits(1) !== 0
  let paddingBits: readonly number[] = Object.freeze([])
  if (hasPaddingBits) {
    const count = reader.readBits(24)
    if (count > limits.maxJpegPaddingBits) {
      throw limitExceeded(
        `JPEG XL reconstruction has ${count} padding bits; maxJpegPaddingBits is ${limits.maxJpegPaddingBits}`,
      )
    }
    paddingBits = freezeNumbers(Array.from({ length: count }, () => reader.readBits(1)))
  }
  reader.alignToByte()
  const compressedDataOffset = reader.bitPosition / 8
  return Object.freeze({
    markerOrder: markerOrder.markers,
    appMarkers,
    commentByteLengths,
    quantizationTables,
    componentIds: components.ids,
    componentQuantizationTables: components.quantizationTables,
    huffmanTables,
    scans: scansWithExactness,
    restartInterval,
    interMarkerByteLengths,
    tailByteLength,
    paddingBits,
    compressedDataOffset,
    compressedDataBytes: payload.byteLength - compressedDataOffset,
  })
}

const checkedTotal = (values: readonly number[], limit: number): number => {
  let total = 0
  for (const value of values) {
    if (!Number.isSafeInteger(value) || value < 0 || total > limit - value) {
      throw limitExceeded(
        `JPEG XL reconstruction opaque data exceeds the ${limit}-byte metadata limit`,
      )
    }
    total += value
  }
  return total
}

const takeBlobs = (
  decoded: Uint8Array,
  lengths: readonly number[],
  offset: number,
): { readonly blobs: readonly Uint8Array[]; readonly offset: number } => {
  const blobs: Uint8Array[] = []
  let next = offset
  for (const length of lengths) {
    const end = next + length
    if (!Number.isSafeInteger(end) || end > decoded.byteLength) {
      throw invalidInput('JPEG XL reconstruction opaque data is truncated')
    }
    blobs.push(decoded.slice(next, end))
    next = end
  }
  return Object.freeze({ blobs: Object.freeze(blobs), offset: next })
}

export const decodeJpegXlJpegReconstructionBlobs = (
  payload: Uint8Array,
  header: JpegXlJpegReconstructionHeader,
  limits: JpegXlLimits,
): JpegXlJpegReconstructionBlobs => {
  if (
    header.compressedDataOffset < 0 ||
    header.compressedDataBytes < 0 ||
    header.compressedDataOffset + header.compressedDataBytes !== payload.byteLength
  ) {
    throw invalidInput('JPEG XL reconstruction compressed-data extent is invalid')
  }
  const unknownAppLengths = header.appMarkers
    .filter(({ type }) => type === 'unknown')
    .map(({ byteLength }) => byteLength)
  const expectedBytes = checkedTotal(
    [
      ...unknownAppLengths,
      ...header.commentByteLengths,
      ...header.interMarkerByteLengths,
      header.tailByteLength,
    ],
    limits.maxMetadataBytes,
  )
  const decoded = decodeUncompressedBrotli(payload.subarray(header.compressedDataOffset), {
    maxOutputBytes: expectedBytes,
    maxMetadataBytes: limits.maxMetadataBytes,
  })
  if (decoded.byteLength !== expectedBytes) {
    throw invalidInput(
      `JPEG XL reconstruction opaque data has ${decoded.byteLength} bytes; expected ${expectedBytes}`,
    )
  }
  const apps = takeBlobs(decoded, unknownAppLengths, 0)
  const comments = takeBlobs(decoded, header.commentByteLengths, apps.offset)
  const interMarker = takeBlobs(decoded, header.interMarkerByteLengths, comments.offset)
  const tailEnd = interMarker.offset + header.tailByteLength
  if (tailEnd !== decoded.byteLength) {
    throw invalidInput('JPEG XL reconstruction opaque data length is inconsistent')
  }
  return Object.freeze({
    unknownAppMarkers: apps.blobs,
    comments: comments.blobs,
    interMarkerData: interMarker.blobs,
    tail: decoded.slice(interMarker.offset, tailEnd),
    decodedBytes: decoded.byteLength,
  })
}
