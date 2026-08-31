import { invalidInput, limitExceeded } from '../errors.ts'
import { decodeUncompressedBrotli, encodeUncompressedBrotli } from './brotli.ts'
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

class JpegXlReconstructionBitWriter {
  #bytes = new Uint8Array(256)
  #bitPosition = 0

  writeBits(value: number, count: number): void {
    if (
      !Number.isSafeInteger(value) ||
      !Number.isSafeInteger(count) ||
      count < 0 ||
      count > 32 ||
      value < 0 ||
      value >= 2 ** count
    ) {
      throw invalidInput('JPEG XL reconstruction output bit field is invalid')
    }
    this.#ensure(this.#bitPosition + count)
    for (let index = 0; index < count; index += 1) {
      const position = this.#bitPosition + index
      if ((Math.floor(value / 2 ** index) & 1) !== 0) {
        this.#bytes[position >>> 3] =
          (this.#bytes[position >>> 3] ?? 0) | (1 << (position & 7))
      }
    }
    this.#bitPosition += count
  }

  finish(): Uint8Array {
    const padding = (8 - (this.#bitPosition & 7)) & 7
    if (padding !== 0) this.writeBits(0, padding)
    return this.#bytes.slice(0, this.#bitPosition >>> 3)
  }

  #ensure(bitsNeeded: number): void {
    const bytesNeeded = Math.ceil(bitsNeeded / 8)
    if (bytesNeeded <= this.#bytes.byteLength) return
    let length = this.#bytes.byteLength
    while (length < bytesNeeded) length *= 2
    const grown = new Uint8Array(length)
    grown.set(this.#bytes)
    this.#bytes = grown
  }
}

const readU32 = (reader: JpegXlBitReader, distributions: readonly U32Distribution[]): number => {
  const distribution = distributions[reader.readBits(2)]
  if (!distribution) throw invalidInput('JPEG XL reconstruction integer selector is invalid')
  return 'value' in distribution
    ? distribution.value
    : distribution.offset + reader.readBits(distribution.bits)
}

const writeU32 = (
  writer: JpegXlReconstructionBitWriter,
  number: number,
  distributions: readonly U32Distribution[],
): void => {
  for (let selector = 0; selector < distributions.length; selector += 1) {
    const distribution = distributions[selector]
    if (!distribution) continue
    if ('value' in distribution) {
      if (distribution.value !== number) continue
      writer.writeBits(selector, 2)
      return
    }
    const encoded = number - distribution.offset
    if (encoded < 0 || encoded >= 2 ** distribution.bits) continue
    writer.writeBits(selector, 2)
    writer.writeBits(encoded, distribution.bits)
    return
  }
  throw invalidInput('JPEG XL reconstruction integer is outside its distribution')
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

const appMarkerTypeIndex = (type: JpegXlJpegAppMarkerType): number => {
  const index = appMarkerTypes.indexOf(type)
  if (index < 0) throw invalidInput('JPEG XL reconstruction APP marker type is invalid')
  return index
}

const writeDeltaIndexes = (
  writer: JpegXlReconstructionBitWriter,
  indexes: readonly number[],
): void => {
  let previous = -1
  for (const index of indexes) {
    const delta = index - previous - 1
    if (delta < 0) throw invalidInput('JPEG XL reconstruction indexes are not increasing')
    writeU32(writer, delta, [value(0), bits(3, 1), bits(5, 9), bits(28, 41)])
    previous = index
  }
}

const concatenate = (parts: readonly Uint8Array[]): Uint8Array => {
  const length = parts.reduce((sum, part) => sum + part.byteLength, 0)
  if (!Number.isSafeInteger(length)) throw limitExceeded('JPEG XL reconstruction data is too large')
  const output = new Uint8Array(length)
  let offset = 0
  for (const part of parts) {
    output.set(part, offset)
    offset += part.byteLength
  }
  return output
}

/** Encode the JPEG XL `jbrd` reconstruction payload used by exact JPEG transcoding. */
export const encodeJpegXlJpegReconstruction = (
  header: JpegXlJpegReconstructionHeader,
  blobs: JpegXlJpegReconstructionBlobs,
  limits: Readonly<JpegXlLimits>,
): Uint8Array => {
  const writer = new JpegXlReconstructionBitWriter()
  const gray = header.componentIds.length === 1
  if (!gray && header.componentIds.length !== 3) {
    throw invalidInput('JPEG XL reconstruction component count is unsupported')
  }
  writer.writeBits(gray ? 1 : 0, 1)
  for (const marker of header.markerOrder) {
    if (!Number.isInteger(marker) || marker < 0xc0 || marker > 0xff) {
      throw invalidInput('JPEG XL reconstruction marker is invalid')
    }
    writer.writeBits(marker - 0xc0, 6)
  }
  if (header.markerOrder.at(-1) !== 0xd9) {
    throw invalidInput('JPEG XL reconstruction marker order has no EOI')
  }
  for (const app of header.appMarkers) {
    writeU32(writer, appMarkerTypeIndex(app.type), [value(0), value(1), bits(1, 2), bits(2, 4)])
    if (app.byteLength < 3 || app.byteLength > 65_536) {
      throw invalidInput('JPEG XL reconstruction APP marker length is invalid')
    }
    writer.writeBits(app.byteLength - 1, 16)
  }
  for (const byteLength of header.commentByteLengths) {
    if (byteLength < 3 || byteLength > 65_536) {
      throw invalidInput('JPEG XL reconstruction COM marker length is invalid')
    }
    writer.writeBits(byteLength - 1, 16)
  }
  writeU32(writer, header.quantizationTables.length, [value(1), value(2), value(3), value(4)])
  for (const table of header.quantizationTables) {
    writer.writeBits(table.precision === 8 ? 0 : 1, 1)
    writer.writeBits(table.index, 2)
    writer.writeBits(table.lastInMarker ? 1 : 0, 1)
  }

  if (header.componentIds.length !== header.componentQuantizationTables.length) {
    throw invalidInput('JPEG XL reconstruction component descriptors disagree')
  }
  const ids = header.componentIds
  if (ids.length === 1 && ids[0] === 1) writer.writeBits(0, 2)
  else if (ids.length === 3 && ids[0] === 1 && ids[1] === 2 && ids[2] === 3) {
    writer.writeBits(1, 2)
  } else if (ids.length === 3 && ids[0] === 0x52 && ids[1] === 0x47 && ids[2] === 0x42) {
    writer.writeBits(2, 2)
  } else {
    writer.writeBits(3, 2)
    writeU32(writer, ids.length, [value(1), value(2), value(3), value(4)])
    for (const id of ids) writer.writeBits(id, 8)
  }
  for (const table of header.componentQuantizationTables) writer.writeBits(table, 2)

  writeU32(writer, header.huffmanTables.length, [value(4), bits(3, 2), bits(4, 10), bits(6, 26)])
  for (const table of header.huffmanTables) {
    writer.writeBits(table.kind === 'dc' ? 0 : 1, 1)
    writer.writeBits(table.slot, 2)
    writer.writeBits(table.lastInMarker ? 1 : 0, 1)
    if (table.counts.length !== 17) throw invalidInput('JPEG XL reconstruction Huffman counts are incomplete')
    for (const count of table.counts) {
      writeU32(writer, count, [value(0), value(1), bits(3, 2), bits(8)])
    }
    for (const symbol of table.values) {
      writeU32(writer, symbol, [bits(2), bits(2, 4), bits(4, 8), bits(8, 1)])
    }
  }

  for (const scan of header.scans) {
    writeU32(writer, scan.components.length, [value(1), value(2), value(3), value(4)])
    writer.writeBits(scan.spectralStart, 6)
    writer.writeBits(scan.spectralEnd, 6)
    writer.writeBits(scan.successiveLow, 4)
    writer.writeBits(scan.successiveHigh, 4)
    for (const component of scan.components) {
      writer.writeBits(component.component, 2)
      writer.writeBits(component.acTable, 2)
      writer.writeBits(component.dcTable, 2)
    }
    writeU32(writer, scan.lastNeededPass, [value(0), value(1), value(2), bits(3, 3)])
  }
  if (header.restartInterval !== undefined) writer.writeBits(header.restartInterval, 16)

  for (const scan of header.scans) {
    writeU32(writer, scan.resetPoints.length, [value(0), bits(2, 1), bits(4, 4), bits(16, 20)])
    writeDeltaIndexes(writer, scan.resetPoints)
    writeU32(writer, scan.extraZeroRuns.length, [value(0), bits(2, 1), bits(4, 4), bits(16, 20)])
    let previous = -1
    for (const extra of scan.extraZeroRuns) {
      writeU32(writer, extra.runs, [value(1), bits(2, 2), bits(4, 5), bits(8, 20)])
      const delta = extra.block - previous - 1
      if (delta < 0) throw invalidInput('JPEG XL reconstruction zero-run indexes are not increasing')
      writeU32(writer, delta, [value(0), bits(3, 1), bits(5, 9), bits(28, 41)])
      previous = extra.block
    }
  }
  for (const byteLength of header.interMarkerByteLengths) writer.writeBits(byteLength, 16)
  writeU32(writer, header.tailByteLength, [value(0), bits(8, 1), bits(16, 257), bits(22, 65_793)])
  writer.writeBits(header.paddingBits.length === 0 ? 0 : 1, 1)
  if (header.paddingBits.length !== 0) {
    if (header.paddingBits.length > limits.maxJpegPaddingBits) {
      throw limitExceeded(`JPEG XL reconstruction has more than ${limits.maxJpegPaddingBits} padding bits`)
    }
    writer.writeBits(header.paddingBits.length, 24)
    for (const bit of header.paddingBits) writer.writeBits(bit, 1)
  }

  const opaque = concatenate([
    ...blobs.unknownAppMarkers,
    ...blobs.comments,
    ...blobs.interMarkerData,
    blobs.tail,
  ])
  if (opaque.byteLength !== blobs.decodedBytes || opaque.byteLength > limits.maxMetadataBytes) {
    throw invalidInput('JPEG XL reconstruction opaque data length is inconsistent')
  }
  const encoded = concatenate([writer.finish(), encodeUncompressedBrotli(opaque)])
  if (encoded.byteLength > limits.maxMetadataBytes) {
    throw limitExceeded(`JPEG XL jbrd has ${encoded.byteLength} bytes; maxMetadataBytes is ${limits.maxMetadataBytes}`)
  }
  return encoded
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
