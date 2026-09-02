import {
  ImageError,
  invalidInput,
  limitExceeded,
  truncatedInput,
  unsupportedOperation,
} from '../errors.ts'
import type { PixelBlock } from '../pixel.ts'
import type { ImageSource } from '../source.ts'
import { SourceReader } from '../source.ts'
import {
  applyRgbIcc,
  type CmykIccTransform,
  type JpegIccTransform,
  parseJpegIccTransform,
  writeCmykIcc,
} from './icc.ts'
import {
  chrominanceAcCounts,
  chrominanceAcValues,
  chrominanceDcCounts,
  chrominanceDcValues,
  luminanceAcCounts,
  luminanceAcValues,
  luminanceDcCounts,
  luminanceDcValues,
} from './jpeg-encode.ts'
import {
  indexJpegEntropy,
  JpegEntropyReader,
  JpegUnexpectedRestart,
  JpegUnexpectedScanBoundary,
} from './jpeg-source.ts'

const zigZag = Int32Array.of(
  0,
  1,
  8,
  16,
  9,
  2,
  3,
  10,
  17,
  24,
  32,
  25,
  18,
  11,
  4,
  5,
  12,
  19,
  26,
  33,
  40,
  48,
  41,
  34,
  27,
  20,
  13,
  6,
  7,
  14,
  21,
  28,
  35,
  42,
  49,
  56,
  57,
  50,
  43,
  36,
  29,
  22,
  15,
  23,
  30,
  37,
  44,
  51,
  58,
  59,
  52,
  45,
  38,
  31,
  39,
  46,
  53,
  60,
  61,
  54,
  47,
  55,
  62,
  63,
)

const createIdctBasis = (size: number): Float64Array =>
  Float64Array.from({ length: size * size }, (_, index) => {
    const frequency = Math.floor(index / size)
    const position = index % size
    const normalization = frequency === 0 ? Math.SQRT1_2 : 1
    return 0.5 * normalization * Math.cos(((2 * position + 1) * frequency * Math.PI) / (2 * size))
  })

const idctBasis = createIdctBasis(8)
const idctBasis4 = createIdctBasis(4)
const idctBasis2 = createIdctBasis(2)
const idct4b00 = idctBasis4[0] ?? 0
const idct4b01 = idctBasis4[1] ?? 0
const idct4b02 = idctBasis4[2] ?? 0
const idct4b03 = idctBasis4[3] ?? 0
const idct4b10 = idctBasis4[4] ?? 0
const idct4b11 = idctBasis4[5] ?? 0
const idct4b12 = idctBasis4[6] ?? 0
const idct4b13 = idctBasis4[7] ?? 0
const idct4b20 = idctBasis4[8] ?? 0
const idct4b21 = idctBasis4[9] ?? 0
const idct4b22 = idctBasis4[10] ?? 0
const idct4b23 = idctBasis4[11] ?? 0
const idct4b30 = idctBasis4[12] ?? 0
const idct4b31 = idctBasis4[13] ?? 0
const idct4b32 = idctBasis4[14] ?? 0
const idct4b33 = idctBasis4[15] ?? 0

type JpegScaleDenominator = 1 | 2 | 4 | 8
type JpegCoefficients = Int16Array | Int32Array

type InverseDct = (
  coefficients: JpegCoefficients,
  quantization: Int32Array,
  workspace: Float64Array,
  activeRowIndices: Uint8Array,
  sampleWorkspace: Float64Array,
  output: Uint8Array,
  outputStride: number,
  blockX: number,
  blockY: number,
  coefficientOffset?: number,
) => void

interface HuffmanTable {
  readonly counts: Uint8Array
  readonly symbols: Uint8Array
  readonly firstCodes: Int32Array
  readonly firstSymbols: Int32Array
  readonly fastLengths: Uint8Array
  readonly fastSymbols: Uint8Array
}

interface FrameComponent {
  readonly id: number
  readonly horizontalSampling: number
  readonly verticalSampling: number
  readonly quantization: Int32Array
  readonly dcTable: HuffmanTable
  readonly acTable: HuffmanTable
}

interface RenderComponent {
  readonly horizontalSampling: number
  readonly verticalSampling: number
}

export type JpegColorTransform = 'cmyk' | 'components' | 'gray' | 'rgb' | 'ycbcr' | 'ycck'

interface RenderJpeg {
  readonly components: readonly RenderComponent[]
  readonly colorTransform: JpegColorTransform
  readonly iccTransform?: JpegIccTransform
  readonly maximumHorizontalSampling: number
  readonly maximumVerticalSampling: number
  readonly mcusPerLine: number
}

interface RenderPlan {
  readonly componentX: readonly Int32Array[]
  readonly componentRightX: readonly Int32Array[]
  readonly componentWidths: Int32Array
  readonly componentXWeights: readonly Uint16Array[]
  readonly haloRows: number
}

export interface BaselineJpeg {
  readonly data?: Uint8Array
  readonly source?: ImageSource
  readonly width: number
  readonly height: number
  readonly components: readonly FrameComponent[]
  readonly colorTransform: JpegColorTransform
  readonly iccTransform?: JpegIccTransform
  readonly maximumHorizontalSampling: number
  readonly maximumVerticalSampling: number
  readonly mcusPerLine: number
  readonly mcusPerColumn: number
  readonly restartInterval: number
  readonly scanOffset: number
}

export interface JpegRegion {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

export interface JpegDecodeMetrics {
  totalMcus: number
  entropyStartMcu: number
  entropyMcusDecoded: number
  blocksReconstructed: number
}

interface ParsedComponent {
  readonly id: number
  readonly horizontalSampling: number
  readonly verticalSampling: number
  readonly quantizationId: number
  dcTableId?: number
  acTableId?: number
}

interface ParsedFrame {
  readonly width: number
  readonly height: number
  readonly components: readonly ParsedComponent[]
}

const byte = (data: ArrayLike<number>, index: number): number => data[index] ?? 0
const isArithmeticFrameMarker = (marker: number): boolean =>
  marker === 0xc9 ||
  marker === 0xca ||
  marker === 0xcb ||
  marker === 0xcd ||
  marker === 0xce ||
  marker === 0xcf

const isAvi1Segment = (data: Uint8Array, start: number, end: number): boolean =>
  end - start >= 4 &&
  byte(data, start) === 0x41 &&
  byte(data, start + 1) === 0x56 &&
  byte(data, start + 2) === 0x49 &&
  byte(data, start + 3) === 0x31

const readUint16 = (data: Uint8Array, offset: number): number => {
  if (offset < 0 || offset + 2 > data.byteLength) throw truncatedInput('JPEG segment is truncated')
  return byte(data, offset) * 256 + byte(data, offset + 1)
}

const segmentEnd = (data: Uint8Array, offset: number): number => {
  const length = readUint16(data, offset)
  if (length < 2) throw invalidInput('JPEG segment length is invalid')
  if (offset + length > data.byteLength) throw truncatedInput('JPEG segment is truncated')
  return offset + length
}

const huffmanTable = (counts: Uint8Array, symbols: Uint8Array): HuffmanTable => {
  const firstCodes = new Int32Array(16)
  const firstSymbols = new Int32Array(16)
  const fastLengths = new Uint8Array(256)
  const fastSymbols = new Uint8Array(256)
  let code = 0
  let symbol = 0
  for (let index = 0; index < 16; index += 1) {
    const count = byte(counts, index)
    const length = index + 1
    firstCodes[index] = code
    firstSymbols[index] = symbol
    if (code + count > 1 << (index + 1)) throw invalidInput('JPEG Huffman table is oversubscribed')
    if (length <= 8) {
      const suffixCount = 1 << (8 - length)
      for (let symbolOffset = 0; symbolOffset < count; symbolOffset += 1) {
        const prefix = (code + symbolOffset) * suffixCount
        const value = byte(symbols, symbol + symbolOffset)
        for (let suffix = 0; suffix < suffixCount; suffix += 1) {
          const entry = prefix + suffix
          fastLengths[entry] = length
          fastSymbols[entry] = value
        }
      }
    }
    code = (code + count) << 1
    symbol += count
  }
  return { counts, symbols, firstCodes, firstSymbols, fastLengths, fastSymbols }
}
const installMjpegHuffmanTables = (
  dcTables: Map<number, HuffmanTable>,
  acTables: Map<number, HuffmanTable>,
): void => {
  if (!dcTables.has(0)) dcTables.set(0, huffmanTable(luminanceDcCounts, luminanceDcValues))
  if (!acTables.has(0)) acTables.set(0, huffmanTable(luminanceAcCounts, luminanceAcValues))
  if (!dcTables.has(1)) dcTables.set(1, huffmanTable(chrominanceDcCounts, chrominanceDcValues))
  if (!acTables.has(1)) acTables.set(1, huffmanTable(chrominanceAcCounts, chrominanceAcValues))
}

const parseQuantizationTables = (
  data: Uint8Array,
  start: number,
  end: number,
  tables: Map<number, Int32Array>,
): void => {
  let offset = start
  while (offset < end) {
    const specification = byte(data, offset)
    offset += 1
    const precision = specification >>> 4
    const table = new Int32Array(64)
    if (precision !== 0 && precision !== 1)
      throw invalidInput('JPEG quantization table precision is invalid')
    const sampleBytes = precision + 1
    if (offset + 64 * sampleBytes > end)
      throw truncatedInput('JPEG quantization table is truncated')
    for (let index = 0; index < 64; index += 1) {
      const target = byte(zigZag, index)
      table[target] = precision === 0 ? byte(data, offset) : readUint16(data, offset)
      offset += sampleBytes
    }
    tables.set(specification & 15, table)
  }
}

const parseHuffmanTables = (
  data: Uint8Array,
  start: number,
  end: number,
  dcTables: Map<number, HuffmanTable>,
  acTables: Map<number, HuffmanTable>,
): void => {
  let offset = start
  while (offset < end) {
    const specification = byte(data, offset)
    offset += 1
    if (offset + 16 > end) throw truncatedInput('JPEG Huffman table counts are truncated')
    const counts = data.slice(offset, offset + 16)
    offset += 16
    let symbolCount = 0
    for (const count of counts) symbolCount += count
    if (symbolCount < 1 || offset + symbolCount > end)
      throw truncatedInput('JPEG Huffman table symbols are truncated')
    const table = huffmanTable(counts, data.slice(offset, offset + symbolCount))
    offset += symbolCount
    const tableClass = specification >>> 4
    if (tableClass === 0) dcTables.set(specification & 15, table)
    else if (tableClass === 1) acTables.set(specification & 15, table)
    else throw invalidInput('JPEG Huffman table class is invalid')
  }
}

const parseFrame = (data: Uint8Array, start: number, end: number): ParsedFrame => {
  if (end - start < 6) throw truncatedInput('JPEG frame header is truncated')
  const precision = byte(data, start)
  if (precision === 12) throw unsupportedOperation('12-bit JPEG samples are unsupported')
  if (precision !== 8) throw invalidInput('JPEG precision must be 8 or 12 bits')
  const height = readUint16(data, start + 1)
  const width = readUint16(data, start + 3)
  const componentCount = byte(data, start + 5)
  if (
    (componentCount !== 1 && componentCount !== 3 && componentCount !== 4) ||
    start + 6 + componentCount * 3 !== end
  ) {
    throw invalidInput('JPEG must contain one, three, or four components')
  }
  const components: ParsedComponent[] = []
  let blocksPerMcu = 0
  for (let index = 0; index < componentCount; index += 1) {
    const offset = start + 6 + index * 3
    const sampling = byte(data, offset + 1)
    const horizontalSampling = sampling >>> 4
    const verticalSampling = sampling & 15
    if (
      horizontalSampling < 1 ||
      horizontalSampling > 4 ||
      verticalSampling < 1 ||
      verticalSampling > 4
    ) {
      throw invalidInput('JPEG component sampling factor is invalid')
    }
    blocksPerMcu += horizontalSampling * verticalSampling
    components.push({
      id: byte(data, offset),
      horizontalSampling,
      verticalSampling,
      quantizationId: byte(data, offset + 2),
    })
  }
  if (blocksPerMcu > 10) throw invalidInput('JPEG sampling factors exceed ten blocks per MCU')
  return { width, height, components }
}

const parseAdobeTransform = (data: Uint8Array, start: number, end: number): number | undefined => {
  if (
    end - start < 12 ||
    byte(data, start) !== 0x41 ||
    byte(data, start + 1) !== 0x64 ||
    byte(data, start + 2) !== 0x6f ||
    byte(data, start + 3) !== 0x62 ||
    byte(data, start + 4) !== 0x65 ||
    byte(data, start + 5) !== 0
  ) {
    return undefined
  }
  return byte(data, start + 11)
}

const colorTransform = (
  frame: ParsedFrame,
  adobeTransform: number | undefined,
  nativeComponents = false,
): JpegColorTransform => {
  if (frame.components.length === 1) return 'gray'
  if (frame.components.length === 3) {
    if (adobeTransform === 0) return 'rgb'
    if (adobeTransform === undefined) {
      const [red, green, blue] = frame.components
      if (red?.id === 0x52 && green?.id === 0x47 && blue?.id === 0x42) return 'rgb'
      return 'ycbcr'
    }
    if (adobeTransform === 1) return 'ycbcr'
    throw invalidInput(`Adobe transform ${adobeTransform} is invalid for a three-component JPEG`)
  }
  if (nativeComponents) return 'components'
  if (adobeTransform === 0) return 'cmyk'
  if (adobeTransform === 2) return 'ycck'
  if (adobeTransform === undefined) {
    throw invalidInput('Four-component JPEG requires an Adobe color-transform marker')
  }
  throw invalidInput(`Adobe transform ${adobeTransform} is invalid for a four-component JPEG`)
}

export interface JpegIccChunk {
  readonly sequence: number
  readonly count: number
  readonly data: Uint8Array
}

export const parseJpegIccChunk = (
  data: Uint8Array,
  start: number,
  end: number,
): JpegIccChunk | undefined => {
  const name = 'ICC_PROFILE\0'
  if (end - start < 14) return undefined
  for (let index = 0; index < name.length; index += 1) {
    if (byte(data, start + index) !== name.charCodeAt(index)) return undefined
  }
  const sequence = byte(data, start + 12)
  const count = byte(data, start + 13)
  if (sequence < 1 || count < 1 || sequence > count) {
    throw invalidInput('JPEG ICC chunk numbering is invalid')
  }
  return { sequence, count, data: data.slice(start + 14, end) }
}

export const assembleJpegIccProfile = (
  chunks: readonly JpegIccChunk[],
  maximumBytes = 16 * 1024 * 1024,
): Uint8Array | undefined => {
  if (chunks.length === 0) return undefined
  const count = chunks[0]?.count ?? 0
  if (count !== chunks.length || chunks.some((chunk) => chunk.count !== count)) {
    throw invalidInput('JPEG ICC profile chunks are incomplete')
  }
  const ordered = new Array<Uint8Array | undefined>(count)
  let bytes = 0
  for (const chunk of chunks) {
    if (ordered[chunk.sequence - 1]) throw invalidInput('JPEG ICC profile repeats a chunk')
    ordered[chunk.sequence - 1] = chunk.data
    bytes += chunk.data.byteLength
    if (bytes > maximumBytes) {
      throw limitExceeded(`JPEG ICC profile exceeds ${maximumBytes} bytes`)
    }
  }
  const profile = new Uint8Array(bytes)
  let offset = 0
  for (const chunk of ordered) {
    if (!chunk) throw invalidInput('JPEG ICC profile chunks are incomplete')
    profile.set(chunk, offset)
    offset += chunk.byteLength
  }
  return profile
}

const createIccTransform = (
  chunks: readonly JpegIccChunk[],
  jpegColorTransform: JpegColorTransform,
): JpegIccTransform | undefined => {
  const profile = assembleJpegIccProfile(chunks)
  if (!profile) return undefined
  const transform = parseJpegIccTransform(profile)
  const fourComponent = jpegColorTransform === 'cmyk' || jpegColorTransform === 'ycck'
  if (
    (fourComponent && transform.kind !== 'cmyk') ||
    (!fourComponent && transform.kind !== 'rgb')
  ) {
    throw invalidInput('JPEG components do not match the embedded ICC input color space')
  }
  return transform
}

export interface JpegCodestreamInspection {
  readonly sofMarker: number
  readonly precision: number
  readonly width: number
  readonly height: number
  readonly componentCount: number
  readonly eoiOffset: number
  readonly trailingByteCount: number
}

const isStartOfFrameMarker = (marker: number): boolean =>
  marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc

const scanJpegEntropy = (
  data: Uint8Array,
  start: number,
):
  | { readonly marker: number; readonly markerOffset: number; readonly afterMarker: number }
  | undefined => {
  let offset = start
  while (offset < data.byteLength) {
    if (byte(data, offset) !== 0xff) {
      offset += 1
      continue
    }
    offset += 1
    while (offset < data.byteLength && byte(data, offset) === 0xff) offset += 1
    if (offset >= data.byteLength) return undefined
    const marker = byte(data, offset)
    const markerOffset = offset - 1
    offset += 1
    if (marker === 0x00 || (marker >= 0xd0 && marker <= 0xd7)) continue
    return { marker, markerOffset, afterMarker: offset }
  }
  return undefined
}

export const inspectJpegCodestream = (data: Uint8Array): JpegCodestreamInspection => {
  if (data.byteLength < 4 || byte(data, 0) !== 0xff || byte(data, 1) !== 0xd8) {
    throw invalidInput('JPEG start marker is missing')
  }
  let offset = 2
  let sofMarker: number | undefined
  let precision = 0
  let width = 0
  let height = 0
  let componentCount = 0
  let eoiOffset = -1

  while (offset + 1 < data.byteLength) {
    if (byte(data, offset) !== 0xff) throw invalidInput('JPEG marker is missing')
    offset += 1
    let marker = byte(data, offset)
    offset += 1
    while (marker === 0xff && offset < data.byteLength) {
      marker = byte(data, offset)
      offset += 1
    }
    if (marker === 0xd9) {
      eoiOffset = offset - 2
      break
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue
    if (marker === 0xda) {
      offset = segmentEnd(data, offset)
      const next = scanJpegEntropy(data, offset)
      if (next === undefined) break
      if (next.marker === 0xd9) {
        eoiOffset = next.markerOffset
        break
      }
      offset = next.markerOffset
      continue
    }
    const end = segmentEnd(data, offset)
    if (isStartOfFrameMarker(marker)) {
      const start = offset + 2
      if (end - start < 6) throw truncatedInput('JPEG start-of-frame marker is truncated')
      sofMarker = marker
      precision = byte(data, start)
      height = readUint16(data, start + 1)
      width = readUint16(data, start + 3)
      componentCount = byte(data, start + 5)
    }
    offset = end
  }

  if (sofMarker === undefined) throw invalidInput('JPEG start-of-frame marker is missing')
  if (eoiOffset < 0) throw invalidInput('JPEG is missing EOI')
  return Object.freeze({
    sofMarker,
    precision,
    width,
    height,
    componentCount,
    eoiOffset,
    trailingByteCount: data.byteLength - (eoiOffset + 2),
  })
}

export const parseBaselineJpeg = (
  data: Uint8Array,
  applyIcc = true,
  nativeComponents = false,
): BaselineJpeg | undefined => {
  if (data.byteLength < 4 || readUint16(data, 0) !== 0xffd8)
    throw invalidInput('JPEG start marker is missing')
  const quantizationTables = new Map<number, Int32Array>()
  const dcTables = new Map<number, HuffmanTable>()
  const acTables = new Map<number, HuffmanTable>()
  let frame: ParsedFrame | undefined
  let adobeTransform: number | undefined
  const iccChunks: JpegIccChunk[] = []
  let restartInterval = 0
  let motionJpeg = false
  let offset = 2

  while (offset < data.byteLength) {
    while (byte(data, offset) === 0xff) offset += 1
    if (offset >= data.byteLength) throw truncatedInput('JPEG marker is truncated')
    const marker = byte(data, offset)
    offset += 1
    if (marker === 0xd9) throw invalidInput('JPEG ended before image data')
    if (marker === 0x00 || (marker >= 0xd0 && marker <= 0xd8))
      throw invalidInput('JPEG contains an unexpected standalone marker')
    const end = segmentEnd(data, offset)
    const start = offset + 2

    if (marker === 0xdb) parseQuantizationTables(data, start, end, quantizationTables)
    else if (marker === 0xc4) parseHuffmanTables(data, start, end, dcTables, acTables)
    else if (marker === 0xe0) motionJpeg ||= isAvi1Segment(data, start, end)
    else if (marker === 0xe2) {
      const chunk = parseJpegIccChunk(data, start, end)
      if (chunk) iccChunks.push(chunk)
    } else if (marker === 0xee) {
      adobeTransform = parseAdobeTransform(data, start, end) ?? adobeTransform
    } else if (isArithmeticFrameMarker(marker)) {
      throw unsupportedOperation('Arithmetic-coded JPEG images are unsupported')
    } else if (marker === 0xc0) frame = parseFrame(data, start, end)
    else if (marker === 0xc1 || marker === 0xc2) return undefined
    else if (marker === 0xdd) {
      if (end - start !== 2) throw invalidInput('JPEG restart interval is invalid')
      restartInterval = readUint16(data, start)
    } else if (marker === 0xda) {
      if (!frame) throw invalidInput('JPEG scan appears before its frame')
      const selectors = byte(data, start)
      if (selectors !== frame.components.length || start + 1 + selectors * 2 + 3 !== end) {
        return undefined
      }
      for (let index = 0; index < selectors; index += 1) {
        const selectorOffset = start + 1 + index * 2
        const component = frame.components.find(
          (candidate) => candidate.id === byte(data, selectorOffset),
        )
        if (!component) throw invalidInput('JPEG scan references an unknown component')
        const tables = byte(data, selectorOffset + 1)
        component.dcTableId = tables >>> 4
        component.acTableId = tables & 15
      }
      const spectralOffset = start + 1 + selectors * 2
      if (
        byte(data, spectralOffset) !== 0 ||
        byte(data, spectralOffset + 1) !== 63 ||
        byte(data, spectralOffset + 2) !== 0
      ) {
        return undefined
      }
      if (motionJpeg) installMjpegHuffmanTables(dcTables, acTables)
      let maximumHorizontalSampling = 1
      let maximumVerticalSampling = 1
      const components: FrameComponent[] = []
      const singleComponent = frame.components.length === 1
      for (const component of frame.components) {
        const quantization = quantizationTables.get(component.quantizationId)
        const dcTable =
          component.dcTableId === undefined ? undefined : dcTables.get(component.dcTableId)
        const acTable =
          component.acTableId === undefined ? undefined : acTables.get(component.acTableId)
        if (!quantization) throw invalidInput('JPEG scan references a missing quantization table')
        if (!dcTable || !acTable) {
          if (motionJpeg) {
            throw unsupportedOperation(
              'AVI1/MJPEG frames that omit nonstandard Huffman tables are unsupported',
            )
          }
          throw invalidInput('JPEG scan references a missing Huffman table')
        }
        const horizontalSampling = singleComponent ? 1 : component.horizontalSampling
        const verticalSampling = singleComponent ? 1 : component.verticalSampling
        maximumHorizontalSampling = Math.max(maximumHorizontalSampling, horizontalSampling)
        maximumVerticalSampling = Math.max(maximumVerticalSampling, verticalSampling)
        components.push({
          ...component,
          horizontalSampling,
          verticalSampling,
          quantization,
          dcTable,
          acTable,
        })
      }
      const jpegColorTransform = colorTransform(frame, adobeTransform, nativeComponents)
      const iccTransform =
        applyIcc && jpegColorTransform !== 'components'
          ? createIccTransform(iccChunks, jpegColorTransform)
          : undefined
      return {
        data,
        width: frame.width,
        height: frame.height,
        components,
        colorTransform: jpegColorTransform,
        ...(iccTransform ? { iccTransform } : {}),
        maximumHorizontalSampling,
        maximumVerticalSampling,
        mcusPerLine: Math.ceil(frame.width / (8 * maximumHorizontalSampling)),
        mcusPerColumn: Math.ceil(frame.height / (8 * maximumVerticalSampling)),
        restartInterval,
        scanOffset: end,
      }
    }
    offset = end
  }
  throw truncatedInput('JPEG is missing image data')
}

const nextSourceMarker = async (reader: SourceReader, tolerant = false): Promise<number> => {
  let prefix = await reader.readByte()
  if (prefix !== 0xff) {
    if (!tolerant) throw invalidInput('JPEG marker prefix is missing')
    let previous = prefix
    while (true) {
      const current = await reader.readByte()
      if (previous === 0xff && current === 0xd9) return current
      previous = current
    }
  }
  while (prefix === 0xff) prefix = await reader.readByte()
  if (prefix === 0x00 || (prefix >= 0xd0 && prefix <= 0xd8)) {
    throw invalidInput('JPEG contains an unexpected standalone marker')
  }
  return prefix
}

const sourceSegment = async (reader: SourceReader): Promise<Uint8Array> => {
  const lengthBytes = await reader.read(2)
  const length = readUint16(lengthBytes, 0)
  if (length < 2) throw invalidInput('JPEG segment length is invalid')
  return reader.read(length - 2)
}

export const parseBaselineJpegSource = async (
  source: ImageSource,
  applyIcc = true,
): Promise<BaselineJpeg | undefined> => {
  const reader = new SourceReader(source)
  const signature = await reader.read(2)
  if (readUint16(signature, 0) !== 0xffd8) throw invalidInput('JPEG start marker is missing')
  const quantizationTables = new Map<number, Int32Array>()
  const dcTables = new Map<number, HuffmanTable>()
  const acTables = new Map<number, HuffmanTable>()
  let frame: ParsedFrame | undefined
  let adobeTransform: number | undefined
  const iccChunks: JpegIccChunk[] = []
  let restartInterval = 0
  let motionJpeg = false

  while (reader.position < source.size) {
    const marker = await nextSourceMarker(reader)
    if (marker === 0xd9) throw invalidInput('JPEG ended before image data')
    const payload = await sourceSegment(reader)
    const start = 0
    const end = payload.byteLength
    if (marker === 0xdb) parseQuantizationTables(payload, start, end, quantizationTables)
    else if (marker === 0xc4) parseHuffmanTables(payload, start, end, dcTables, acTables)
    else if (marker === 0xe0) motionJpeg ||= isAvi1Segment(payload, start, end)
    else if (marker === 0xe2) {
      const chunk = parseJpegIccChunk(payload, start, end)
      if (chunk) iccChunks.push(chunk)
    } else if (marker === 0xee) {
      adobeTransform = parseAdobeTransform(payload, start, end) ?? adobeTransform
    } else if (isArithmeticFrameMarker(marker)) {
      throw unsupportedOperation('Arithmetic-coded JPEG images are unsupported')
    } else if (marker === 0xc0 || marker === 0xc1) {
      if (frame) throw invalidInput('JPEG contains multiple frames')
      frame = parseFrame(payload, start, end)
    } else if (marker === 0xc2) {
      return undefined
    } else if (marker === 0xdd) {
      if (end !== 2) throw invalidInput('JPEG restart interval is invalid')
      restartInterval = readUint16(payload, 0)
    } else if (marker === 0xda) {
      if (!frame) throw invalidInput('JPEG scan appears before its frame')
      const selectors = byte(payload, 0)
      if (selectors !== frame.components.length || 1 + selectors * 2 + 3 !== end) {
        return undefined
      }
      for (let index = 0; index < selectors; index += 1) {
        const selectorOffset = 1 + index * 2
        const component = frame.components.find(
          (candidate) => candidate.id === byte(payload, selectorOffset),
        )
        if (!component) throw invalidInput('JPEG scan references an unknown component')
        const tables = byte(payload, selectorOffset + 1)
        component.dcTableId = tables >>> 4
        component.acTableId = tables & 15
      }
      const spectralOffset = 1 + selectors * 2
      if (
        byte(payload, spectralOffset) !== 0 ||
        byte(payload, spectralOffset + 1) !== 63 ||
        byte(payload, spectralOffset + 2) !== 0
      ) {
        return undefined
      }
      if (motionJpeg) installMjpegHuffmanTables(dcTables, acTables)
      let maximumHorizontalSampling = 1
      let maximumVerticalSampling = 1
      const components: FrameComponent[] = []
      const singleComponent = frame.components.length === 1
      for (const component of frame.components) {
        const quantization = quantizationTables.get(component.quantizationId)
        const dcTable =
          component.dcTableId === undefined ? undefined : dcTables.get(component.dcTableId)
        const acTable =
          component.acTableId === undefined ? undefined : acTables.get(component.acTableId)
        if (!quantization) throw invalidInput('JPEG scan references a missing quantization table')
        if (!dcTable || !acTable) {
          if (motionJpeg) {
            throw unsupportedOperation(
              'AVI1/MJPEG frames that omit nonstandard Huffman tables are unsupported',
            )
          }
          throw invalidInput('JPEG scan references a missing Huffman table')
        }
        const horizontalSampling = singleComponent ? 1 : component.horizontalSampling
        const verticalSampling = singleComponent ? 1 : component.verticalSampling
        maximumHorizontalSampling = Math.max(maximumHorizontalSampling, horizontalSampling)
        maximumVerticalSampling = Math.max(maximumVerticalSampling, verticalSampling)
        components.push({
          ...component,
          horizontalSampling,
          verticalSampling,
          quantization,
          dcTable,
          acTable,
        })
      }
      const jpegColorTransform = colorTransform(frame, adobeTransform)
      const iccTransform = applyIcc ? createIccTransform(iccChunks, jpegColorTransform) : undefined
      return {
        source,
        width: frame.width,
        height: frame.height,
        components,
        colorTransform: jpegColorTransform,
        ...(iccTransform ? { iccTransform } : {}),
        maximumHorizontalSampling,
        maximumVerticalSampling,
        mcusPerLine: Math.ceil(frame.width / (8 * maximumHorizontalSampling)),
        mcusPerColumn: Math.ceil(frame.height / (8 * maximumVerticalSampling)),
        restartInterval,
        scanOffset: reader.position,
      }
    }
  }
  throw truncatedInput('JPEG is missing image data')
}

interface JpegBitReader {
  readBit(): number
  readBits(length: number): number
  peekBits(length: number): number | undefined
  skipBits(length: number): void
  receiveAndExtend(length: number): number
}

class EntropyReader implements JpegBitReader {
  readonly #data: Uint8Array
  readonly #tolerant: boolean
  #offset: number
  #bits = 0
  #ended = false
  #bitCount = 0

  constructor(data: Uint8Array, offset: number, tolerant = false) {
    this.#data = data
    this.#offset = offset
    this.#tolerant = tolerant
  }
  get ended(): boolean {
    return this.#ended
  }

  #tryFillBits(): boolean {
    if (this.#offset >= this.#data.byteLength) return false
    const value = byte(this.#data, this.#offset)
    if (value === 0xff) {
      if (this.#offset + 1 >= this.#data.byteLength) return false
      if (byte(this.#data, this.#offset + 1) !== 0) return false
      this.#offset += 2
    } else {
      this.#offset += 1
    }
    if (this.#bitCount === 0) this.#bits = 0
    this.#bits = ((this.#bits << 8) | value) >>> 0
    this.#bitCount += 8
    return true
  }

  #fillBits(): void {
    if (this.#tryFillBits()) return
    if (this.#offset >= this.#data.byteLength)
      throw truncatedInput('JPEG entropy data is truncated')
    const value = byte(this.#data, this.#offset)
    this.#offset += 1
    if (value === 0xff) {
      if (this.#offset >= this.#data.byteLength) {
        throw truncatedInput('JPEG entropy byte stuffing is truncated')
      }
      const stuffed = byte(this.#data, this.#offset)
      this.#offset += 1
      if (this.#tolerant && stuffed >= 0xd0 && stuffed <= 0xd7) {
        throw new JpegUnexpectedRestart(stuffed)
      }
      if (stuffed !== 0) throw invalidInput(`Unexpected JPEG marker ff${stuffed.toString(16)}`)
    }
    if (this.#bitCount === 0) this.#bits = 0
    this.#bits = ((this.#bits << 8) | value) >>> 0
    this.#bitCount += 8
  }

  readBit(): number {
    if (this.#bitCount === 0) this.#fillBits()
    this.#bitCount -= 1
    return (this.#bits >>> this.#bitCount) & 1
  }

  readBits(length: number): number {
    let value = 0
    let remaining = length
    while (remaining > 0) {
      if (this.#bitCount === 0) this.#fillBits()
      const take = Math.min(remaining, this.#bitCount)
      const shift = this.#bitCount - take
      value = (value << take) | ((this.#bits >>> shift) & ((1 << take) - 1))
      this.#bitCount -= take
      if (this.#bitCount === 0) this.#bits = 0
      remaining -= take
    }
    return value
  }

  peekBits(length: number): number | undefined {
    if (length <= 0) return 0
    while (this.#bitCount < length) {
      if (!this.#tryFillBits()) return undefined
    }
    return (this.#bits >>> (this.#bitCount - length)) & ((1 << length) - 1)
  }

  skipBits(length: number): void {
    let remaining = length
    while (remaining > 0) {
      if (this.#bitCount === 0) this.#fillBits()
      const take = Math.min(remaining, this.#bitCount)
      this.#bitCount -= take
      if (this.#bitCount === 0) this.#bits = 0
      remaining -= take
    }
  }

  receiveAndExtend(length: number): number {
    if (length === 0) return 0
    const value = this.readBits(length)
    return value >= 1 << (length - 1) ? value : value + (-1 << length) + 1
  }

  restart(expected: number): number {
    this.#bits = 0
    this.#bitCount = 0
    if (!this.#tolerant) {
      while (byte(this.#data, this.#offset) === 0xff) this.#offset += 1
      const marker = byte(this.#data, this.#offset)
      this.#offset += 1
      if (marker !== 0xd0 + (expected & 7)) {
        throw invalidInput(`Expected JPEG restart marker ${expected & 7}`)
      }
      return marker
    }
    const recoveryEnd = Math.min(this.#data.byteLength, this.#offset + 65_536)
    while (this.#offset < recoveryEnd) {
      if (byte(this.#data, this.#offset) !== 0xff) {
        this.#offset += 1
        continue
      }
      this.#offset += 1
      while (this.#offset < recoveryEnd && byte(this.#data, this.#offset) === 0xff) {
        this.#offset += 1
      }
      if (this.#offset >= recoveryEnd) break
      const marker = byte(this.#data, this.#offset)
      this.#offset += 1
      if (marker === 0) continue
      if (marker === 0xd9) {
        this.#ended = true
        return marker
      }
      if (marker >= 0xd0 && marker <= 0xd7) return marker
      throw invalidInput(`Expected JPEG restart marker ${expected & 7}`)
    }
    throw invalidInput('JPEG restart recovery exceeded 64 KiB')
  }

  scanEnd(): number {
    this.#bits = 0
    this.#bitCount = 0
    if (byte(this.#data, this.#offset) !== 0xff)
      throw invalidInput('JPEG scan contains trailing entropy data')
    return this.#offset
  }

  finish(): void {
    this.#bits = 0
    this.#bitCount = 0
    if (this.#ended) return
    while (this.#offset < this.#data.byteLength) {
      if (byte(this.#data, this.#offset) !== 0xff) {
        this.#offset += 1
        continue
      }
      this.#offset += 1
      while (this.#offset < this.#data.byteLength && byte(this.#data, this.#offset) === 0xff) {
        this.#offset += 1
      }
      if (this.#offset >= this.#data.byteLength) {
        throw truncatedInput('JPEG end marker is truncated')
      }
      const marker = byte(this.#data, this.#offset)
      this.#offset += 1
      if (marker === 0) continue
      if (marker === 0xd9) return
      throw invalidInput('Baseline JPEG contains additional unsupported scans')
    }
    throw truncatedInput('JPEG end marker is missing')
  }
}

const decodeHuffman = (reader: JpegBitReader, table: HuffmanTable): number => {
  const prefix = reader.peekBits(8)
  if (prefix !== undefined) {
    const length = byte(table.fastLengths, prefix)
    if (length !== 0) {
      reader.skipBits(length)
      return byte(table.fastSymbols, prefix)
    }
  }
  let code = 0
  for (let length = 0; length < 16; length += 1) {
    code = (code << 1) | reader.readBit()
    const count = byte(table.counts, length)
    const offset = code - byte(table.firstCodes, length)
    if (offset >= 0 && offset < count) {
      const symbol = table.symbols[byte(table.firstSymbols, length) + offset]
      if (symbol === undefined) throw invalidInput('JPEG Huffman symbol is missing')
      return symbol
    }
  }
  throw invalidInput('JPEG Huffman code is invalid')
}

const decodeBlock = (
  reader: JpegBitReader,
  component: FrameComponent,
  predictor: number,
  coefficients: Int32Array,
): number => {
  coefficients.fill(0)
  const dcLength = decodeHuffman(reader, component.dcTable)
  if (dcLength > 16) throw invalidInput('JPEG DC coefficient is invalid')
  const nextPredictor = predictor + reader.receiveAndExtend(dcLength)
  coefficients[0] = nextPredictor
  let index = 1
  while (index < 64) {
    const symbol = decodeHuffman(reader, component.acTable)
    const zeroes = symbol >>> 4
    const length = symbol & 15
    if (length === 0) {
      if (zeroes !== 15) break
      index += 16
      continue
    }
    index += zeroes
    if (index >= 64) throw invalidInput('JPEG AC coefficient exceeds its block')
    coefficients[byte(zigZag, index)] = reader.receiveAndExtend(length)
    index += 1
  }
  return nextPredictor
}

const lastZigZagForScale = (scaleDenominator: JpegScaleDenominator): number => {
  if (scaleDenominator === 1) return 63
  if (scaleDenominator === 2) return 24
  if (scaleDenominator === 4) return 4
  return 0
}

const clearReducedCoefficients = (coefficients: Int32Array, lastZigZag: number): void => {
  coefficients[0] = 0
  if (lastZigZag === 0) return
  coefficients[1] = 0
  coefficients[8] = 0
  coefficients[9] = 0
  if (lastZigZag === 4) return
  coefficients[2] = 0
  coefficients[3] = 0
  coefficients[10] = 0
  coefficients[11] = 0
  coefficients[16] = 0
  coefficients[17] = 0
  coefficients[18] = 0
  coefficients[19] = 0
  coefficients[24] = 0
  coefficients[25] = 0
  coefficients[26] = 0
  coefficients[27] = 0
}

const skipRemainingAc = (reader: JpegBitReader, table: HuffmanTable, startIndex: number): void => {
  const fastLengths = table.fastLengths
  const fastSymbols = table.fastSymbols
  let index =
    reader instanceof JpegEntropyReader
      ? reader.skipRemainingAc(fastLengths, fastSymbols, startIndex)
      : startIndex
  if (index < 0) return
  while (index < 64) {
    const prefix = reader.peekBits(8)
    if (prefix !== undefined) {
      const huffmanLength = fastLengths[prefix] ?? 0
      if (huffmanLength !== 0) {
        const symbol = fastSymbols[prefix] ?? 0
        const extra = symbol & 15
        reader.skipBits(huffmanLength + extra)
        if (extra === 0) {
          if (symbol >>> 4 !== 15) return
          index += 16
          continue
        }
        index += (symbol >>> 4) + 1
        if (index > 64) throw invalidInput('JPEG AC coefficient exceeds its block')
        continue
      }
    }
    const symbol = decodeHuffman(reader, table)
    const zeroes = symbol >>> 4
    const length = symbol & 15
    if (length === 0) {
      if (zeroes !== 15) return
      index += 16
      continue
    }
    index += zeroes
    if (index >= 64) throw invalidInput('JPEG AC coefficient exceeds its block')
    reader.skipBits(length)
    index += 1
  }
}

const decodeBlockLimited = (
  reader: JpegBitReader,
  component: FrameComponent,
  predictor: number,
  coefficients: Int32Array,
  lastZigZag: number,
): number => {
  if (lastZigZag >= 63) return decodeBlock(reader, component, predictor, coefficients)
  clearReducedCoefficients(coefficients, lastZigZag)
  const dcLength = decodeHuffman(reader, component.dcTable)
  if (dcLength > 16) throw invalidInput('JPEG DC coefficient is invalid')
  const nextPredictor = predictor + reader.receiveAndExtend(dcLength)
  coefficients[0] = nextPredictor
  if (lastZigZag === 0) {
    skipRemainingAc(reader, component.acTable, 1)
    return nextPredictor
  }
  const acTable = component.acTable
  const fastLengths = acTable.fastLengths
  const fastSymbols = acTable.fastSymbols
  let index = 1
  while (index < 64) {
    const prefix = reader.peekBits(8)
    let symbol: number
    if (prefix !== undefined) {
      const huffmanLength = fastLengths[prefix] ?? 0
      if (huffmanLength !== 0) {
        symbol = fastSymbols[prefix] ?? 0
        reader.skipBits(huffmanLength)
      } else {
        symbol = decodeHuffman(reader, acTable)
      }
    } else {
      symbol = decodeHuffman(reader, acTable)
    }
    const zeroes = symbol >>> 4
    const length = symbol & 15
    if (length === 0) {
      if (zeroes !== 15) break
      index += 16
      if (index > lastZigZag) {
        skipRemainingAc(reader, acTable, index)
        break
      }
      continue
    }
    index += zeroes
    if (index >= 64) throw invalidInput('JPEG AC coefficient exceeds its block')
    if (index <= lastZigZag) {
      coefficients[byte(zigZag, index)] = reader.receiveAndExtend(length)
    } else {
      reader.skipBits(length)
    }
    index += 1
    if (index > lastZigZag) {
      skipRemainingAc(reader, acTable, index)
      break
    }
  }
  return nextPredictor
}

const inverseDct = (
  coefficients: JpegCoefficients,
  quantization: Int32Array,
  workspace: Float64Array,
  activeRowIndices: Uint8Array,
  _sampleWorkspace: Float64Array,
  output: Uint8Array,
  outputStride: number,
  blockX: number,
  blockY: number,
  coefficientOffset = 0,
): void => {
  let activeRowCount = 0
  for (let vertical = 0; vertical < 8; vertical += 1) {
    const rowOffset = vertical * 8
    let rowActive = false
    for (let horizontal = 0; horizontal < 8; horizontal += 1) {
      const index = rowOffset + horizontal
      const coefficient = coefficients[coefficientOffset + index] ?? 0
      if (coefficient === 0) continue
      const scaled = coefficient * (quantization[index] ?? 0)
      const basisOffset = horizontal * 8
      const basis0 = idctBasis[basisOffset] ?? 0
      const basis1 = idctBasis[basisOffset + 1] ?? 0
      const basis2 = idctBasis[basisOffset + 2] ?? 0
      const basis3 = idctBasis[basisOffset + 3] ?? 0
      const basis4 = idctBasis[basisOffset + 4] ?? 0
      const basis5 = idctBasis[basisOffset + 5] ?? 0
      const basis6 = idctBasis[basisOffset + 6] ?? 0
      const basis7 = idctBasis[basisOffset + 7] ?? 0
      if (rowActive) {
        workspace[rowOffset] = (workspace[rowOffset] ?? 0) + scaled * basis0
        workspace[rowOffset + 1] = (workspace[rowOffset + 1] ?? 0) + scaled * basis1
        workspace[rowOffset + 2] = (workspace[rowOffset + 2] ?? 0) + scaled * basis2
        workspace[rowOffset + 3] = (workspace[rowOffset + 3] ?? 0) + scaled * basis3
        workspace[rowOffset + 4] = (workspace[rowOffset + 4] ?? 0) + scaled * basis4
        workspace[rowOffset + 5] = (workspace[rowOffset + 5] ?? 0) + scaled * basis5
        workspace[rowOffset + 6] = (workspace[rowOffset + 6] ?? 0) + scaled * basis6
        workspace[rowOffset + 7] = (workspace[rowOffset + 7] ?? 0) + scaled * basis7
      } else {
        workspace[rowOffset] = scaled * basis0
        workspace[rowOffset + 1] = scaled * basis1
        workspace[rowOffset + 2] = scaled * basis2
        workspace[rowOffset + 3] = scaled * basis3
        workspace[rowOffset + 4] = scaled * basis4
        workspace[rowOffset + 5] = scaled * basis5
        workspace[rowOffset + 6] = scaled * basis6
        workspace[rowOffset + 7] = scaled * basis7
        activeRowIndices[activeRowCount] = vertical
        activeRowCount += 1
        rowActive = true
      }
    }
  }
  for (let y = 0; y < 8; y += 1) {
    const outputOffset = (blockY * 8 + y) * outputStride + blockX * 8
    let value0 = 0
    let value1 = 0
    let value2 = 0
    let value3 = 0
    let value4 = 0
    let value5 = 0
    let value6 = 0
    let value7 = 0
    for (let activeIndex = 0; activeIndex < activeRowCount; activeIndex += 1) {
      const vertical = activeRowIndices[activeIndex] ?? 0
      const workspaceOffset = vertical * 8
      const basis = idctBasis[workspaceOffset + y] ?? 0
      value0 += basis * (workspace[workspaceOffset] ?? 0)
      value1 += basis * (workspace[workspaceOffset + 1] ?? 0)
      value2 += basis * (workspace[workspaceOffset + 2] ?? 0)
      value3 += basis * (workspace[workspaceOffset + 3] ?? 0)
      value4 += basis * (workspace[workspaceOffset + 4] ?? 0)
      value5 += basis * (workspace[workspaceOffset + 5] ?? 0)
      value6 += basis * (workspace[workspaceOffset + 6] ?? 0)
      value7 += basis * (workspace[workspaceOffset + 7] ?? 0)
    }
    const sample0 = Math.round(value0 + 128)
    const sample1 = Math.round(value1 + 128)
    const sample2 = Math.round(value2 + 128)
    const sample3 = Math.round(value3 + 128)
    const sample4 = Math.round(value4 + 128)
    const sample5 = Math.round(value5 + 128)
    const sample6 = Math.round(value6 + 128)
    const sample7 = Math.round(value7 + 128)
    output[outputOffset] = sample0 < 0 ? 0 : sample0 > 255 ? 255 : sample0
    output[outputOffset + 1] = sample1 < 0 ? 0 : sample1 > 255 ? 255 : sample1
    output[outputOffset + 2] = sample2 < 0 ? 0 : sample2 > 255 ? 255 : sample2
    output[outputOffset + 3] = sample3 < 0 ? 0 : sample3 > 255 ? 255 : sample3
    output[outputOffset + 4] = sample4 < 0 ? 0 : sample4 > 255 ? 255 : sample4
    output[outputOffset + 5] = sample5 < 0 ? 0 : sample5 > 255 ? 255 : sample5
    output[outputOffset + 6] = sample6 < 0 ? 0 : sample6 > 255 ? 255 : sample6
    output[outputOffset + 7] = sample7 < 0 ? 0 : sample7 > 255 ? 255 : sample7
  }
}

const inverseDct4: InverseDct = (
  coefficients,
  quantization,
  _workspace,
  _activeRowIndices,
  _sampleWorkspace,
  output,
  outputStride,
  blockX,
  blockY,
  coefficientOffset = 0,
): void => {
  const c00 = (coefficients[coefficientOffset] ?? 0) * (quantization[0] ?? 0)
  const c01 = (coefficients[coefficientOffset + 1] ?? 0) * (quantization[1] ?? 0)
  const c02 = (coefficients[coefficientOffset + 2] ?? 0) * (quantization[2] ?? 0)
  const c03 = (coefficients[coefficientOffset + 3] ?? 0) * (quantization[3] ?? 0)
  const c10 = (coefficients[coefficientOffset + 8] ?? 0) * (quantization[8] ?? 0)
  const c11 = (coefficients[coefficientOffset + 9] ?? 0) * (quantization[9] ?? 0)
  const c12 = (coefficients[coefficientOffset + 10] ?? 0) * (quantization[10] ?? 0)
  const c13 = (coefficients[coefficientOffset + 11] ?? 0) * (quantization[11] ?? 0)
  const c20 = (coefficients[coefficientOffset + 16] ?? 0) * (quantization[16] ?? 0)
  const c21 = (coefficients[coefficientOffset + 17] ?? 0) * (quantization[17] ?? 0)
  const c22 = (coefficients[coefficientOffset + 18] ?? 0) * (quantization[18] ?? 0)
  const c23 = (coefficients[coefficientOffset + 19] ?? 0) * (quantization[19] ?? 0)
  const c30 = (coefficients[coefficientOffset + 24] ?? 0) * (quantization[24] ?? 0)
  const c31 = (coefficients[coefficientOffset + 25] ?? 0) * (quantization[25] ?? 0)
  const c32 = (coefficients[coefficientOffset + 26] ?? 0) * (quantization[26] ?? 0)
  const c33 = (coefficients[coefficientOffset + 27] ?? 0) * (quantization[27] ?? 0)
  const w00 = c00 * idct4b00 + c01 * idct4b10 + c02 * idct4b20 + c03 * idct4b30
  const w01 = c00 * idct4b01 + c01 * idct4b11 + c02 * idct4b21 + c03 * idct4b31
  const w02 = c00 * idct4b02 + c01 * idct4b12 + c02 * idct4b22 + c03 * idct4b32
  const w03 = c00 * idct4b03 + c01 * idct4b13 + c02 * idct4b23 + c03 * idct4b33
  const w10 = c10 * idct4b00 + c11 * idct4b10 + c12 * idct4b20 + c13 * idct4b30
  const w11 = c10 * idct4b01 + c11 * idct4b11 + c12 * idct4b21 + c13 * idct4b31
  const w12 = c10 * idct4b02 + c11 * idct4b12 + c12 * idct4b22 + c13 * idct4b32
  const w13 = c10 * idct4b03 + c11 * idct4b13 + c12 * idct4b23 + c13 * idct4b33
  const w20 = c20 * idct4b00 + c21 * idct4b10 + c22 * idct4b20 + c23 * idct4b30
  const w21 = c20 * idct4b01 + c21 * idct4b11 + c22 * idct4b21 + c23 * idct4b31
  const w22 = c20 * idct4b02 + c21 * idct4b12 + c22 * idct4b22 + c23 * idct4b32
  const w23 = c20 * idct4b03 + c21 * idct4b13 + c22 * idct4b23 + c23 * idct4b33
  const w30 = c30 * idct4b00 + c31 * idct4b10 + c32 * idct4b20 + c33 * idct4b30
  const w31 = c30 * idct4b01 + c31 * idct4b11 + c32 * idct4b21 + c33 * idct4b31
  const w32 = c30 * idct4b02 + c31 * idct4b12 + c32 * idct4b22 + c33 * idct4b32
  const w33 = c30 * idct4b03 + c31 * idct4b13 + c32 * idct4b23 + c33 * idct4b33
  const s00 = Math.round(w00 * idct4b00 + w10 * idct4b10 + w20 * idct4b20 + w30 * idct4b30 + 128)
  const s01 = Math.round(w01 * idct4b00 + w11 * idct4b10 + w21 * idct4b20 + w31 * idct4b30 + 128)
  const s02 = Math.round(w02 * idct4b00 + w12 * idct4b10 + w22 * idct4b20 + w32 * idct4b30 + 128)
  const s03 = Math.round(w03 * idct4b00 + w13 * idct4b10 + w23 * idct4b20 + w33 * idct4b30 + 128)
  const s10 = Math.round(w00 * idct4b01 + w10 * idct4b11 + w20 * idct4b21 + w30 * idct4b31 + 128)
  const s11 = Math.round(w01 * idct4b01 + w11 * idct4b11 + w21 * idct4b21 + w31 * idct4b31 + 128)
  const s12 = Math.round(w02 * idct4b01 + w12 * idct4b11 + w22 * idct4b21 + w32 * idct4b31 + 128)
  const s13 = Math.round(w03 * idct4b01 + w13 * idct4b11 + w23 * idct4b21 + w33 * idct4b31 + 128)
  const s20 = Math.round(w00 * idct4b02 + w10 * idct4b12 + w20 * idct4b22 + w30 * idct4b32 + 128)
  const s21 = Math.round(w01 * idct4b02 + w11 * idct4b12 + w21 * idct4b22 + w31 * idct4b32 + 128)
  const s22 = Math.round(w02 * idct4b02 + w12 * idct4b12 + w22 * idct4b22 + w32 * idct4b32 + 128)
  const s23 = Math.round(w03 * idct4b02 + w13 * idct4b12 + w23 * idct4b22 + w33 * idct4b32 + 128)
  const s30 = Math.round(w00 * idct4b03 + w10 * idct4b13 + w20 * idct4b23 + w30 * idct4b33 + 128)
  const s31 = Math.round(w01 * idct4b03 + w11 * idct4b13 + w21 * idct4b23 + w31 * idct4b33 + 128)
  const s32 = Math.round(w02 * idct4b03 + w12 * idct4b13 + w22 * idct4b23 + w32 * idct4b33 + 128)
  const s33 = Math.round(w03 * idct4b03 + w13 * idct4b13 + w23 * idct4b23 + w33 * idct4b33 + 128)
  const row0 = blockY * 4 * outputStride + blockX * 4
  const row1 = row0 + outputStride
  const row2 = row1 + outputStride
  const row3 = row2 + outputStride
  output[row0] = s00 < 0 ? 0 : s00 > 255 ? 255 : s00
  output[row0 + 1] = s01 < 0 ? 0 : s01 > 255 ? 255 : s01
  output[row0 + 2] = s02 < 0 ? 0 : s02 > 255 ? 255 : s02
  output[row0 + 3] = s03 < 0 ? 0 : s03 > 255 ? 255 : s03
  output[row1] = s10 < 0 ? 0 : s10 > 255 ? 255 : s10
  output[row1 + 1] = s11 < 0 ? 0 : s11 > 255 ? 255 : s11
  output[row1 + 2] = s12 < 0 ? 0 : s12 > 255 ? 255 : s12
  output[row1 + 3] = s13 < 0 ? 0 : s13 > 255 ? 255 : s13
  output[row2] = s20 < 0 ? 0 : s20 > 255 ? 255 : s20
  output[row2 + 1] = s21 < 0 ? 0 : s21 > 255 ? 255 : s21
  output[row2 + 2] = s22 < 0 ? 0 : s22 > 255 ? 255 : s22
  output[row2 + 3] = s23 < 0 ? 0 : s23 > 255 ? 255 : s23
  output[row3] = s30 < 0 ? 0 : s30 > 255 ? 255 : s30
  output[row3 + 1] = s31 < 0 ? 0 : s31 > 255 ? 255 : s31
  output[row3 + 2] = s32 < 0 ? 0 : s32 > 255 ? 255 : s32
  output[row3 + 3] = s33 < 0 ? 0 : s33 > 255 ? 255 : s33
}

const inverseDct2: InverseDct = (
  coefficients,
  quantization,
  _workspace,
  _activeRowIndices,
  _sampleWorkspace,
  output,
  outputStride,
  blockX,
  blockY,
  coefficientOffset = 0,
): void => {
  const c00 = (coefficients[coefficientOffset] ?? 0) * (quantization[0] ?? 0)
  const c01 = (coefficients[coefficientOffset + 1] ?? 0) * (quantization[1] ?? 0)
  const c10 = (coefficients[coefficientOffset + 8] ?? 0) * (quantization[8] ?? 0)
  const c11 = (coefficients[coefficientOffset + 9] ?? 0) * (quantization[9] ?? 0)
  const b00 = idctBasis2[0] ?? 0
  const b01 = idctBasis2[1] ?? 0
  const b10 = idctBasis2[2] ?? 0
  const b11 = idctBasis2[3] ?? 0
  const w0 = c00 * b00 + c01 * b10
  const w1 = c00 * b01 + c01 * b11
  const w2 = c10 * b00 + c11 * b10
  const w3 = c10 * b01 + c11 * b11
  const s00 = Math.round(w0 * b00 + w2 * b10 + 128)
  const s01 = Math.round(w1 * b00 + w3 * b10 + 128)
  const s10 = Math.round(w0 * b01 + w2 * b11 + 128)
  const s11 = Math.round(w1 * b01 + w3 * b11 + 128)
  const row0 = blockY * 2 * outputStride + blockX * 2
  const row1 = row0 + outputStride
  output[row0] = s00 < 0 ? 0 : s00 > 255 ? 255 : s00
  output[row0 + 1] = s01 < 0 ? 0 : s01 > 255 ? 255 : s01
  output[row1] = s10 < 0 ? 0 : s10 > 255 ? 255 : s10
  output[row1 + 1] = s11 < 0 ? 0 : s11 > 255 ? 255 : s11
}

const inverseDct1: InverseDct = (
  coefficients,
  quantization,
  _workspace,
  _activeRowIndices,
  _sampleWorkspace,
  output,
  outputStride,
  blockX,
  blockY,
  coefficientOffset = 0,
): void => {
  const sample = Math.round(
    (byte(coefficients, coefficientOffset) * byte(quantization, 0)) / 8 + 128,
  )
  output[blockY * outputStride + blockX] = sample < 0 ? 0 : sample > 255 ? 255 : sample
}

const inverseDctForScale = (scaleDenominator: JpegScaleDenominator): InverseDct => {
  if (scaleDenominator === 1) return inverseDct
  if (scaleDenominator === 2) return inverseDct4
  if (scaleDenominator === 4) return inverseDct2
  return inverseDct1
}

const outputSizeForScale = (scaleDenominator: JpegScaleDenominator): number => 8 / scaleDenominator

const componentPlanes = (jpeg: RenderJpeg, blockSize: number): Uint8Array[] =>
  jpeg.components.map(
    (component) =>
      new Uint8Array(
        jpeg.mcusPerLine *
          component.horizontalSampling *
          blockSize *
          (component.verticalSampling + 2) *
          blockSize,
      ),
  )

const copyPlaneRow = (
  plane: Uint8Array,
  width: number,
  sourceRow: number,
  targetRow: number,
): void => {
  plane.copyWithin(targetRow * width, sourceRow * width, (sourceRow + 1) * width)
}

const replicateTopHalo = (
  jpeg: RenderJpeg,
  planes: readonly Uint8Array[],
  blockSize: number,
): void => {
  for (let componentIndex = 0; componentIndex < jpeg.components.length; componentIndex += 1) {
    const component = jpeg.components[componentIndex]
    const plane = planes[componentIndex]
    if (!component || !plane) throw invalidInput('JPEG component storage is missing')
    const width = jpeg.mcusPerLine * component.horizontalSampling * blockSize
    for (let row = 0; row < blockSize; row += 1) copyPlaneRow(plane, width, blockSize, row)
  }
}

const replicateBottomHalo = (
  jpeg: RenderJpeg,
  planes: readonly Uint8Array[],
  blockSize: number,
): void => {
  for (let componentIndex = 0; componentIndex < jpeg.components.length; componentIndex += 1) {
    const component = jpeg.components[componentIndex]
    const plane = planes[componentIndex]
    if (!component || !plane) throw invalidInput('JPEG component storage is missing')
    const width = jpeg.mcusPerLine * component.horizontalSampling * blockSize
    const lastCoreRow = blockSize + component.verticalSampling * blockSize - 1
    const bottom = blockSize + component.verticalSampling * blockSize
    for (let row = 0; row < blockSize; row += 1) {
      copyPlaneRow(plane, width, lastCoreRow, bottom + row)
    }
  }
}

const linkPlaneHalos = (
  jpeg: RenderJpeg,
  upper: readonly Uint8Array[],
  lower: readonly Uint8Array[],
  blockSize: number,
): void => {
  for (let componentIndex = 0; componentIndex < jpeg.components.length; componentIndex += 1) {
    const component = jpeg.components[componentIndex]
    const upperPlane = upper[componentIndex]
    const lowerPlane = lower[componentIndex]
    if (!component || !upperPlane || !lowerPlane) {
      throw invalidInput('JPEG component storage is missing')
    }
    const width = jpeg.mcusPerLine * component.horizontalSampling * blockSize
    const upperLastCore = blockSize + component.verticalSampling * blockSize - 1
    const upperBottom = blockSize + component.verticalSampling * blockSize
    const lowerFirstCore = blockSize
    for (let row = 0; row < blockSize; row += 1) {
      upperPlane.set(
        lowerPlane.subarray(lowerFirstCore * width, (lowerFirstCore + 1) * width),
        (upperBottom + row) * width,
      )
      lowerPlane.set(
        upperPlane.subarray(upperLastCore * width, (upperLastCore + 1) * width),
        row * width,
      )
    }
  }
}

const clamp = (value: number): number => (value < 0 ? 0 : value > 255 ? 255 : value)

const createRenderPlan = (jpeg: RenderJpeg, region: JpegRegion, blockSize: number): RenderPlan => {
  const componentX: Int32Array[] = []
  const componentRightX: Int32Array[] = []
  const componentXWeights: Uint16Array[] = []
  const componentWidths = new Int32Array(jpeg.components.length)
  for (let componentIndex = 0; componentIndex < jpeg.components.length; componentIndex += 1) {
    const component = jpeg.components[componentIndex]
    if (!component) throw invalidInput('JPEG component metadata is missing')
    componentWidths[componentIndex] = jpeg.mcusPerLine * component.horizontalSampling * blockSize
    const indices = new Int32Array(region.width)
    const rightIndices = new Int32Array(region.width)
    const weights = new Uint16Array(region.width)
    const maximumX = (componentWidths[componentIndex] ?? 1) - 1
    for (let x = 0; x < region.width; x += 1) {
      const coordinate =
        ((region.x + x + 0.5) * component.horizontalSampling) / jpeg.maximumHorizontalSampling - 0.5
      const left = Math.floor(coordinate)
      if (left < 0) {
        indices[x] = 0
        rightIndices[x] = 0
      } else if (left >= maximumX) {
        indices[x] = maximumX
        rightIndices[x] = maximumX
      } else {
        indices[x] = left
        rightIndices[x] = left + 1
        weights[x] = Math.round((coordinate - left) * 256)
      }
    }
    componentX.push(indices)
    componentRightX.push(rightIndices)
    componentXWeights.push(weights)
  }
  return { componentX, componentRightX, componentWidths, componentXWeights, haloRows: blockSize }
}

const renderGrayRows = (
  jpeg: RenderJpeg,
  planes: readonly Uint8Array[],
  region: JpegRegion,
  rowStart: number,
  first: number,
  height: number,
  data: Uint8Array,
  plan: RenderPlan,
): void => {
  const luminance = jpeg.components[0]
  const luminancePlane = planes[0]
  if (!luminance || !luminancePlane) throw invalidInput('JPEG luminance component is missing')
  const luminanceWidth = plan.componentWidths[0] ?? 0
  const luminanceX = plan.componentX[0]
  if (!luminanceX) throw invalidInput('JPEG luminance render plan is missing')
  for (let row = 0; row < height; row += 1) {
    const sourceY = first + row - rowStart
    const luminanceY =
      plan.haloRows +
      Math.floor((sourceY * luminance.verticalSampling) / jpeg.maximumVerticalSampling)
    for (let x = 0; x < region.width; x += 1) {
      const y = byte(luminancePlane, luminanceY * luminanceWidth + (luminanceX[x] ?? 0))
      const target = (row * region.width + x) * 3
      data[target] = y
      data[target + 1] = y
      data[target + 2] = y
    }
  }
}

const renderRgbRows = (
  jpeg: RenderJpeg,
  planes: readonly Uint8Array[],
  region: JpegRegion,
  rowStart: number,
  first: number,
  height: number,
  data: Uint8Array,
  plan: RenderPlan,
): void => {
  const firstComponent = jpeg.components[0]
  const secondComponent = jpeg.components[1]
  const thirdComponent = jpeg.components[2]
  const firstPlane = planes[0]
  const secondPlane = planes[1]
  const thirdPlane = planes[2]
  if (
    !firstComponent ||
    !secondComponent ||
    !thirdComponent ||
    !firstPlane ||
    !secondPlane ||
    !thirdPlane
  ) {
    throw invalidInput('JPEG color components are missing')
  }
  const firstWidth = plan.componentWidths[0] ?? 0
  const secondWidth = plan.componentWidths[1] ?? 0
  const thirdWidth = plan.componentWidths[2] ?? 0
  const firstX = plan.componentX[0]
  const secondX = plan.componentX[1]
  const thirdX = plan.componentX[2]
  if (!firstX || !secondX || !thirdX) throw invalidInput('JPEG color render plan is missing')
  for (let row = 0; row < height; row += 1) {
    const sourceY = first + row - rowStart
    const firstY =
      plan.haloRows +
      Math.floor((sourceY * firstComponent.verticalSampling) / jpeg.maximumVerticalSampling)
    const secondY =
      plan.haloRows +
      Math.floor((sourceY * secondComponent.verticalSampling) / jpeg.maximumVerticalSampling)
    const thirdY =
      plan.haloRows +
      Math.floor((sourceY * thirdComponent.verticalSampling) / jpeg.maximumVerticalSampling)
    for (let x = 0; x < region.width; x += 1) {
      const firstSample = byte(firstPlane, firstY * firstWidth + (firstX[x] ?? 0))
      const secondSample = byte(secondPlane, secondY * secondWidth + (secondX[x] ?? 0))
      const thirdSample = byte(thirdPlane, thirdY * thirdWidth + (thirdX[x] ?? 0))
      const target = (row * region.width + x) * 3
      data[target] = firstSample
      data[target + 1] = secondSample
      data[target + 2] = thirdSample
    }
  }
}

const renderNativeComponentRows = (
  jpeg: RenderJpeg,
  planes: readonly Uint8Array[],
  region: JpegRegion,
  rowStart: number,
  first: number,
  height: number,
  data: Uint8Array,
  plan: RenderPlan,
  channels: number,
): void => {
  if (channels < 1 || channels > jpeg.components.length) {
    throw invalidInput('JPEG native component count is invalid')
  }
  for (let row = 0; row < height; row += 1) {
    const sourceY = first + row - rowStart
    for (let x = 0; x < region.width; x += 1) {
      const target = (row * region.width + x) * channels
      for (let sample = 0; sample < channels; sample += 1) {
        const component = jpeg.components[sample]
        const plane = planes[sample]
        const sampleX = plan.componentX[sample]
        const width = plan.componentWidths[sample] ?? 0
        if (!component || !plane || !sampleX) {
          throw invalidInput('JPEG native component storage is missing')
        }
        const sampleY =
          plan.haloRows +
          Math.floor((sourceY * component.verticalSampling) / jpeg.maximumVerticalSampling)
        data[target + sample] = byte(plane, sampleY * width + (sampleX[x] ?? 0))
      }
    }
  }
}

const renderYcbcrRows = (
  jpeg: RenderJpeg,
  planes: readonly Uint8Array[],
  region: JpegRegion,
  rowStart: number,
  first: number,
  height: number,
  data: Uint8Array,
  plan: RenderPlan,
): void => {
  const luminance = jpeg.components[0]
  const blueChroma = jpeg.components[1]
  const redChroma = jpeg.components[2]
  const luminancePlane = planes[0]
  const blueChromaPlane = planes[1]
  const redChromaPlane = planes[2]
  if (
    !luminance ||
    !blueChroma ||
    !redChroma ||
    !luminancePlane ||
    !blueChromaPlane ||
    !redChromaPlane
  ) {
    throw invalidInput('JPEG color components are missing')
  }
  const luminanceWidth = plan.componentWidths[0] ?? 0
  const blueChromaWidth = plan.componentWidths[1] ?? 0
  const redChromaWidth = plan.componentWidths[2] ?? 0
  const luminanceX = plan.componentX[0]
  const blueChromaX = plan.componentX[1]
  const redChromaX = plan.componentX[2]
  const luminanceRightX = plan.componentRightX[0]
  const blueChromaRightX = plan.componentRightX[1]
  const redChromaRightX = plan.componentRightX[2]
  const luminanceXWeights = plan.componentXWeights[0]
  const blueChromaXWeights = plan.componentXWeights[1]
  const redChromaXWeights = plan.componentXWeights[2]
  if (
    !luminanceX ||
    !blueChromaX ||
    !redChromaX ||
    !luminanceRightX ||
    !blueChromaRightX ||
    !redChromaRightX ||
    !luminanceXWeights ||
    !blueChromaXWeights ||
    !redChromaXWeights
  ) {
    throw invalidInput('JPEG color render plan is missing')
  }
  if (
    luminance.horizontalSampling === jpeg.maximumHorizontalSampling &&
    luminance.verticalSampling === jpeg.maximumVerticalSampling &&
    blueChroma.horizontalSampling === jpeg.maximumHorizontalSampling &&
    blueChroma.verticalSampling === jpeg.maximumVerticalSampling &&
    redChroma.horizontalSampling === jpeg.maximumHorizontalSampling &&
    redChroma.verticalSampling === jpeg.maximumVerticalSampling
  ) {
    for (let row = 0; row < height; row += 1) {
      const sourceY = plan.haloRows + first + row - rowStart
      for (let x = 0; x < region.width; x += 1) {
        const y = byte(luminancePlane, sourceY * luminanceWidth + (luminanceX[x] ?? 0))
        const cb = byte(blueChromaPlane, sourceY * blueChromaWidth + (blueChromaX[x] ?? 0)) - 128
        const cr = byte(redChromaPlane, sourceY * redChromaWidth + (redChromaX[x] ?? 0)) - 128
        const target = (row * region.width + x) * 3
        data[target] = clamp(y + 1.402 * cr)
        data[target + 1] = clamp(y - 0.3441363 * cb - 0.71413636 * cr)
        data[target + 2] = clamp(y + 1.772 * cb)
      }
    }
    return
  }
  if (
    luminance.horizontalSampling === jpeg.maximumHorizontalSampling &&
    luminance.verticalSampling === jpeg.maximumVerticalSampling &&
    blueChroma.verticalSampling === jpeg.maximumVerticalSampling &&
    redChroma.verticalSampling === jpeg.maximumVerticalSampling
  ) {
    for (let row = 0; row < height; row += 1) {
      const sourceY = plan.haloRows + first + row - rowStart
      const lumaRow = sourceY * luminanceWidth
      const blueRow = sourceY * blueChromaWidth
      const redRow = sourceY * redChromaWidth
      for (let x = 0; x < region.width; x += 1) {
        const y = byte(luminancePlane, lumaRow + (luminanceX[x] ?? 0))
        const blueChromaXWeight = blueChromaXWeights[x] ?? 0
        const redChromaXWeight = redChromaXWeights[x] ?? 0
        const cb =
          ((byte(blueChromaPlane, blueRow + (blueChromaX[x] ?? 0)) * (256 - blueChromaXWeight) +
            byte(blueChromaPlane, blueRow + (blueChromaRightX[x] ?? 0)) * blueChromaXWeight +
            128) >>
            8) -
          128
        const cr =
          ((byte(redChromaPlane, redRow + (redChromaX[x] ?? 0)) * (256 - redChromaXWeight) +
            byte(redChromaPlane, redRow + (redChromaRightX[x] ?? 0)) * redChromaXWeight +
            128) >>
            8) -
          128
        const target = (row * region.width + x) * 3
        data[target] = clamp(y + 1.402 * cr)
        data[target + 1] = clamp(y - 0.3441363 * cb - 0.71413636 * cr)
        data[target + 2] = clamp(y + 1.772 * cb)
      }
    }
    return
  }
  if (
    luminance.horizontalSampling === jpeg.maximumHorizontalSampling &&
    luminance.verticalSampling === jpeg.maximumVerticalSampling
  ) {
    for (let row = 0; row < height; row += 1) {
      const outputY = first + row
      const lumaRow = (plan.haloRows + outputY - rowStart) * luminanceWidth
      const blueChromaPosition =
        ((outputY + 0.5) * blueChroma.verticalSampling) / jpeg.maximumVerticalSampling -
        0.5 -
        (rowStart * blueChroma.verticalSampling) / jpeg.maximumVerticalSampling +
        plan.haloRows
      const redChromaPosition =
        ((outputY + 0.5) * redChroma.verticalSampling) / jpeg.maximumVerticalSampling -
        0.5 -
        (rowStart * redChroma.verticalSampling) / jpeg.maximumVerticalSampling +
        plan.haloRows
      const blueChromaY = Math.floor(blueChromaPosition)
      const redChromaY = Math.floor(redChromaPosition)
      const blueChromaBottomY = blueChromaY + 1
      const redChromaBottomY = redChromaY + 1
      const blueChromaYWeight = Math.round((blueChromaPosition - blueChromaY) * 256)
      const redChromaYWeight = Math.round((redChromaPosition - redChromaY) * 256)
      for (let x = 0; x < region.width; x += 1) {
        const y = byte(luminancePlane, lumaRow + (luminanceX[x] ?? 0))
        const blueChromaXWeight = blueChromaXWeights[x] ?? 0
        const redChromaXWeight = redChromaXWeights[x] ?? 0
        const blueChromaTop =
          byte(blueChromaPlane, blueChromaY * blueChromaWidth + (blueChromaX[x] ?? 0)) *
            (256 - blueChromaXWeight) +
          byte(blueChromaPlane, blueChromaY * blueChromaWidth + (blueChromaRightX[x] ?? 0)) *
            blueChromaXWeight
        const blueChromaBottom =
          byte(blueChromaPlane, blueChromaBottomY * blueChromaWidth + (blueChromaX[x] ?? 0)) *
            (256 - blueChromaXWeight) +
          byte(blueChromaPlane, blueChromaBottomY * blueChromaWidth + (blueChromaRightX[x] ?? 0)) *
            blueChromaXWeight
        const redChromaTop =
          byte(redChromaPlane, redChromaY * redChromaWidth + (redChromaX[x] ?? 0)) *
            (256 - redChromaXWeight) +
          byte(redChromaPlane, redChromaY * redChromaWidth + (redChromaRightX[x] ?? 0)) *
            redChromaXWeight
        const redChromaBottom =
          byte(redChromaPlane, redChromaBottomY * redChromaWidth + (redChromaX[x] ?? 0)) *
            (256 - redChromaXWeight) +
          byte(redChromaPlane, redChromaBottomY * redChromaWidth + (redChromaRightX[x] ?? 0)) *
            redChromaXWeight
        const cb =
          ((blueChromaTop * (256 - blueChromaYWeight) +
            blueChromaBottom * blueChromaYWeight +
            32_768) >>
            16) -
          128
        const cr =
          ((redChromaTop * (256 - redChromaYWeight) +
            redChromaBottom * redChromaYWeight +
            32_768) >>
            16) -
          128
        const target = (row * region.width + x) * 3
        data[target] = clamp(y + 1.402 * cr)
        data[target + 1] = clamp(y - 0.3441363 * cb - 0.71413636 * cr)
        data[target + 2] = clamp(y + 1.772 * cb)
      }
    }
    return
  }
  for (let row = 0; row < height; row += 1) {
    const outputY = first + row
    const luminancePosition =
      ((outputY + 0.5) * luminance.verticalSampling) / jpeg.maximumVerticalSampling -
      0.5 -
      (rowStart * luminance.verticalSampling) / jpeg.maximumVerticalSampling +
      plan.haloRows
    const blueChromaPosition =
      ((outputY + 0.5) * blueChroma.verticalSampling) / jpeg.maximumVerticalSampling -
      0.5 -
      (rowStart * blueChroma.verticalSampling) / jpeg.maximumVerticalSampling +
      plan.haloRows
    const redChromaPosition =
      ((outputY + 0.5) * redChroma.verticalSampling) / jpeg.maximumVerticalSampling -
      0.5 -
      (rowStart * redChroma.verticalSampling) / jpeg.maximumVerticalSampling +
      plan.haloRows
    const luminanceY = Math.floor(luminancePosition)
    const blueChromaY = Math.floor(blueChromaPosition)
    const redChromaY = Math.floor(redChromaPosition)
    const luminanceBottomY = luminanceY + 1
    const blueChromaBottomY = blueChromaY + 1
    const redChromaBottomY = redChromaY + 1
    const luminanceYWeight = Math.round((luminancePosition - luminanceY) * 256)
    const blueChromaYWeight = Math.round((blueChromaPosition - blueChromaY) * 256)
    const redChromaYWeight = Math.round((redChromaPosition - redChromaY) * 256)
    for (let x = 0; x < region.width; x += 1) {
      const luminanceXWeight = luminanceXWeights[x] ?? 0
      const blueChromaXWeight = blueChromaXWeights[x] ?? 0
      const redChromaXWeight = redChromaXWeights[x] ?? 0
      const luminanceTop =
        byte(luminancePlane, luminanceY * luminanceWidth + (luminanceX[x] ?? 0)) *
          (256 - luminanceXWeight) +
        byte(luminancePlane, luminanceY * luminanceWidth + (luminanceRightX[x] ?? 0)) *
          luminanceXWeight
      const luminanceBottom =
        byte(luminancePlane, luminanceBottomY * luminanceWidth + (luminanceX[x] ?? 0)) *
          (256 - luminanceXWeight) +
        byte(luminancePlane, luminanceBottomY * luminanceWidth + (luminanceRightX[x] ?? 0)) *
          luminanceXWeight
      const blueChromaTop =
        byte(blueChromaPlane, blueChromaY * blueChromaWidth + (blueChromaX[x] ?? 0)) *
          (256 - blueChromaXWeight) +
        byte(blueChromaPlane, blueChromaY * blueChromaWidth + (blueChromaRightX[x] ?? 0)) *
          blueChromaXWeight
      const blueChromaBottom =
        byte(blueChromaPlane, blueChromaBottomY * blueChromaWidth + (blueChromaX[x] ?? 0)) *
          (256 - blueChromaXWeight) +
        byte(blueChromaPlane, blueChromaBottomY * blueChromaWidth + (blueChromaRightX[x] ?? 0)) *
          blueChromaXWeight
      const redChromaTop =
        byte(redChromaPlane, redChromaY * redChromaWidth + (redChromaX[x] ?? 0)) *
          (256 - redChromaXWeight) +
        byte(redChromaPlane, redChromaY * redChromaWidth + (redChromaRightX[x] ?? 0)) *
          redChromaXWeight
      const redChromaBottom =
        byte(redChromaPlane, redChromaBottomY * redChromaWidth + (redChromaX[x] ?? 0)) *
          (256 - redChromaXWeight) +
        byte(redChromaPlane, redChromaBottomY * redChromaWidth + (redChromaRightX[x] ?? 0)) *
          redChromaXWeight
      const y =
        (luminanceTop * (256 - luminanceYWeight) + luminanceBottom * luminanceYWeight + 32_768) >>
        16
      const cb =
        ((blueChromaTop * (256 - blueChromaYWeight) +
          blueChromaBottom * blueChromaYWeight +
          32_768) >>
          16) -
        128
      const cr =
        ((redChromaTop * (256 - redChromaYWeight) + redChromaBottom * redChromaYWeight + 32_768) >>
          16) -
        128
      const target = (row * region.width + x) * 3
      data[target] = clamp(y + 1.402 * cr)
      data[target + 1] = clamp(y - 0.3441363 * cb - 0.71413636 * cr)
      data[target + 2] = clamp(y + 1.772 * cb)
    }
  }
}

const renderFourComponentRows = (
  jpeg: RenderJpeg,
  planes: readonly Uint8Array[],
  region: JpegRegion,
  rowStart: number,
  first: number,
  height: number,
  data: Uint8Array,
  ycck: boolean,
  iccTransform: CmykIccTransform | undefined,
  plan: RenderPlan,
): void => {
  const firstComponent = jpeg.components[0]
  const secondComponent = jpeg.components[1]
  const thirdComponent = jpeg.components[2]
  const blackComponent = jpeg.components[3]
  const firstPlane = planes[0]
  const secondPlane = planes[1]
  const thirdPlane = planes[2]
  const blackPlane = planes[3]
  if (
    !firstComponent ||
    !secondComponent ||
    !thirdComponent ||
    !blackComponent ||
    !firstPlane ||
    !secondPlane ||
    !thirdPlane ||
    !blackPlane
  ) {
    throw invalidInput('JPEG CMYK components are missing')
  }
  const firstWidth = plan.componentWidths[0] ?? 0
  const secondWidth = plan.componentWidths[1] ?? 0
  const thirdWidth = plan.componentWidths[2] ?? 0
  const blackWidth = plan.componentWidths[3] ?? 0
  const firstX = plan.componentX[0]
  const secondX = plan.componentX[1]
  const thirdX = plan.componentX[2]
  const blackX = plan.componentX[3]
  if (!firstX || !secondX || !thirdX || !blackX) {
    throw invalidInput('JPEG CMYK render plan is missing')
  }
  for (let row = 0; row < height; row += 1) {
    const sourceY = first + row - rowStart
    const firstY =
      plan.haloRows +
      Math.floor((sourceY * firstComponent.verticalSampling) / jpeg.maximumVerticalSampling)
    const secondY =
      plan.haloRows +
      Math.floor((sourceY * secondComponent.verticalSampling) / jpeg.maximumVerticalSampling)
    const thirdY =
      plan.haloRows +
      Math.floor((sourceY * thirdComponent.verticalSampling) / jpeg.maximumVerticalSampling)
    const blackY =
      plan.haloRows +
      Math.floor((sourceY * blackComponent.verticalSampling) / jpeg.maximumVerticalSampling)
    for (let x = 0; x < region.width; x += 1) {
      const firstSample = byte(firstPlane, firstY * firstWidth + (firstX[x] ?? 0))
      const secondSample = byte(secondPlane, secondY * secondWidth + (secondX[x] ?? 0))
      const thirdSample = byte(thirdPlane, thirdY * thirdWidth + (thirdX[x] ?? 0))
      const black = byte(blackPlane, blackY * blackWidth + (blackX[x] ?? 0))
      const target = (row * region.width + x) * 3
      if (ycck) {
        const cb = secondSample - 128
        const cr = thirdSample - 128
        const cyan = clamp(firstSample + 1.402 * cr) | 0
        const magenta = clamp(firstSample - 0.3441363 * cb - 0.71413636 * cr) | 0
        const yellow = clamp(firstSample + 1.772 * cb) | 0
        if (iccTransform) {
          writeCmykIcc(iccTransform, cyan, magenta, yellow, 255 - black, data, target)
        } else {
          data[target] = Math.round(((255 - cyan) * black) / 255)
          data[target + 1] = Math.round(((255 - magenta) * black) / 255)
          data[target + 2] = Math.round(((255 - yellow) * black) / 255)
        }
      } else if (iccTransform) {
        writeCmykIcc(
          iccTransform,
          255 - firstSample,
          255 - secondSample,
          255 - thirdSample,
          255 - black,
          data,
          target,
        )
      } else {
        data[target] = Math.round((firstSample * black) / 255)
        data[target + 1] = Math.round((secondSample * black) / 255)
        data[target + 2] = Math.round((thirdSample * black) / 255)
      }
    }
  }
}

const renderRows = (
  jpeg: RenderJpeg,
  planes: readonly Uint8Array[],
  mcuRow: number,
  region: JpegRegion,
  plan: RenderPlan,
  data: Uint8Array,
  blockSize: number,
  nativeChannels?: number,
): PixelBlock | undefined => {
  const rowStart = mcuRow * jpeg.maximumVerticalSampling * blockSize
  const first = Math.max(region.y, rowStart)
  const last = Math.min(
    region.y + region.height,
    rowStart + jpeg.maximumVerticalSampling * blockSize,
  )
  if (first >= last) return undefined
  const height = last - first
  const bytesPerPixel = nativeChannels ?? 3
  const stride = region.width * bytesPerPixel

  if (nativeChannels !== undefined) {
    renderNativeComponentRows(
      jpeg,
      planes,
      region,
      rowStart,
      first,
      height,
      data,
      plan,
      nativeChannels,
    )
  } else if (jpeg.colorTransform === 'gray') {
    renderGrayRows(jpeg, planes, region, rowStart, first, height, data, plan)
  } else if (jpeg.colorTransform === 'rgb') {
    renderRgbRows(jpeg, planes, region, rowStart, first, height, data, plan)
    if (jpeg.iccTransform?.kind === 'rgb') applyRgbIcc(data, jpeg.iccTransform)
  } else if (jpeg.colorTransform === 'ycbcr') {
    renderYcbcrRows(jpeg, planes, region, rowStart, first, height, data, plan)
    if (jpeg.iccTransform?.kind === 'rgb') applyRgbIcc(data, jpeg.iccTransform)
  } else if (jpeg.colorTransform === 'components') {
    throw invalidInput('JPEG native component streams require the native sample decoder')
  } else {
    renderFourComponentRows(
      jpeg,
      planes,
      region,
      rowStart,
      first,
      height,
      data,
      jpeg.colorTransform === 'ycck',
      jpeg.iccTransform?.kind === 'cmyk' ? jpeg.iccTransform : undefined,
      plan,
    )
  }

  return {
    x: 0,
    y: first - region.y,
    width: region.width,
    height,
    stride,
    format: 'rgb8',
    data,
  }
}

export const decodeBaselineJpeg = async function* (
  jpeg: BaselineJpeg,
  region: JpegRegion,
  scaleDenominator: JpegScaleDenominator = 1,
  metrics?: JpegDecodeMetrics,
  tolerantDecoding = false,
  nativeChannels?: number,
): AsyncGenerator<PixelBlock> {
  const blockSize = outputSizeForScale(scaleDenominator)
  const mcuWidth = jpeg.maximumHorizontalSampling * blockSize
  const mcuHeight = jpeg.maximumVerticalSampling * blockSize
  const firstMcuColumn = Math.floor(region.x / mcuWidth)
  const lastMcuColumn = Math.floor((region.x + region.width - 1) / mcuWidth)
  const firstMcuRow = Math.floor(region.y / mcuHeight)
  const lastMcuRow = Math.floor((region.y + region.height - 1) / mcuHeight)
  const reconstructFirstColumn = Math.max(0, firstMcuColumn - 1)
  const reconstructLastColumn = Math.min(jpeg.mcusPerLine - 1, lastMcuColumn + 1)
  const reconstructFirstRow = Math.max(0, firstMcuRow - 1)
  const reconstructLastRow = Math.min(jpeg.mcusPerColumn - 1, lastMcuRow + 1)
  const scaledWidth = Math.ceil(jpeg.width / scaleDenominator)
  const scaledHeight = Math.ceil(jpeg.height / scaleDenominator)
  const cropped =
    region.x !== 0 ||
    region.y !== 0 ||
    region.width !== scaledWidth ||
    region.height !== scaledHeight
  const targetMcu = reconstructFirstRow * jpeg.mcusPerLine + reconstructFirstColumn
  const entropyIndex =
    cropped && jpeg.source
      ? await indexJpegEntropy(
          jpeg.source,
          jpeg.scanOffset,
          jpeg.restartInterval,
          jpeg.restartInterval > 0
            ? Math.ceil((jpeg.mcusPerLine * jpeg.mcusPerColumn - 1) / jpeg.restartInterval)
            : 0,
          targetMcu,
          tolerantDecoding,
        )
      : undefined
  const restartPoint = entropyIndex?.restart
  const initialMcu = restartPoint?.mcu ?? 0
  let nextRestartMcu =
    jpeg.restartInterval > 0 ? initialMcu + jpeg.restartInterval : Number.MAX_SAFE_INTEGER
  let restart = restartPoint ? restartPoint.marker - 0xd0 + 1 : 0
  const reader = jpeg.source
    ? new JpegEntropyReader(jpeg.source, restartPoint?.offset ?? jpeg.scanOffset, tolerantDecoding)
    : new EntropyReader(
        jpeg.data ??
          (() => {
            throw invalidInput('JPEG entropy source is missing')
          })(),
        jpeg.scanOffset,
        tolerantDecoding,
      )
  const predictors = new Int32Array(jpeg.components.length)
  const coefficients = new Int32Array(64)
  const workspace = new Float64Array(64)
  const activeRowIndices = new Uint8Array(8)
  const sampleWorkspace = new Float64Array(8)
  const inverseBlock = inverseDctForScale(scaleDenominator)
  const lastNeededZigZag = lastZigZagForScale(scaleDenominator)
  const plan = createRenderPlan(jpeg, region, blockSize)
  let currentPlanes = componentPlanes(jpeg, blockSize)
  let pendingPlanes: Uint8Array[] | undefined
  let pendingRow = -1
  const recycledOutput: Uint8Array[] = []
  const outputBytes =
    region.width * (nativeChannels ?? 3) * jpeg.maximumVerticalSampling * blockSize

  const totalMcus = jpeg.mcusPerLine * jpeg.mcusPerColumn
  if (metrics) {
    metrics.totalMcus = totalMcus
    metrics.entropyStartMcu = initialMcu
    metrics.entropyMcusDecoded = 0
    metrics.blocksReconstructed = 0
  }
  let entropyEnded = false
  for (let mcu = initialMcu; mcu < totalMcus; mcu += 1) {
    if (metrics) metrics.entropyMcusDecoded += 1
    const mcuRow = Math.floor(mcu / jpeg.mcusPerLine)
    const mcuColumn = mcu % jpeg.mcusPerLine
    const reconstruct =
      mcuRow >= reconstructFirstRow &&
      mcuRow <= reconstructLastRow &&
      mcuColumn >= reconstructFirstColumn &&
      mcuColumn <= reconstructLastColumn
    if (!entropyEnded && reader instanceof JpegEntropyReader && reader.available < 8_192) {
      await reader.refill()
    }
    if (mcu === nextRestartMcu) {
      const marker = reader.restart(restart)
      if (marker === 0xd9) {
        entropyEnded = true
        nextRestartMcu = Number.MAX_SAFE_INTEGER
      } else {
        restart = marker - 0xd0 + 1
        predictors.fill(0)
        nextRestartMcu += jpeg.restartInterval
      }
    }
    if (!entropyEnded) {
      let unexpectedRestart: JpegUnexpectedRestart | undefined
      try {
        for (let componentIndex = 0; componentIndex < jpeg.components.length; componentIndex += 1) {
          const component = jpeg.components[componentIndex]
          const plane = currentPlanes[componentIndex]
          if (!component || !plane) throw invalidInput('JPEG component storage is missing')
          const planeWidth = jpeg.mcusPerLine * component.horizontalSampling * blockSize
          for (let blockY = 0; blockY < component.verticalSampling; blockY += 1) {
            for (let blockX = 0; blockX < component.horizontalSampling; blockX += 1) {
              predictors[componentIndex] = decodeBlockLimited(
                reader,
                component,
                byte(predictors, componentIndex),
                coefficients,
                reconstruct ? lastNeededZigZag : 0,
              )
              if (reconstruct) {
                if (metrics) metrics.blocksReconstructed += 1
                inverseBlock(
                  coefficients,
                  component.quantization,
                  workspace,
                  activeRowIndices,
                  sampleWorkspace,
                  plane,
                  planeWidth,
                  mcuColumn * component.horizontalSampling + blockX,
                  blockY + 1,
                )
              }
            }
          }
        }
      } catch (error) {
        if (!(error instanceof JpegUnexpectedRestart)) throw error
        unexpectedRestart = error
      }
      if (unexpectedRestart) {
        if (jpeg.restartInterval === 0) {
          throw invalidInput('JPEG restart marker has no restart interval')
        }
        restart = unexpectedRestart.marker - 0xd0 + 1
        predictors.fill(0)
        nextRestartMcu = mcu + 1 + jpeg.restartInterval
      }
    }
    if (mcuColumn !== jpeg.mcusPerLine - 1) continue
    if (mcuRow < reconstructFirstRow) continue
    if (!pendingPlanes) {
      if (mcuRow === 0) replicateTopHalo(jpeg, currentPlanes, blockSize)
    } else {
      linkPlaneHalos(jpeg, pendingPlanes, currentPlanes, blockSize)
      const data = recycledOutput.pop() ?? new Uint8Array(outputBytes)
      const output = renderRows(
        jpeg,
        pendingPlanes,
        pendingRow,
        region,
        plan,
        data,
        blockSize,
        nativeChannels,
      )
      if (output) {
        let released = false
        yield {
          ...output,
          release: () => {
            if (released) return
            released = true
            recycledOutput.push(data)
          },
        }
      } else {
        recycledOutput.push(data)
      }
      if (pendingRow >= lastMcuRow) return
    }
    const previous = pendingPlanes
    pendingPlanes = currentPlanes
    pendingRow = mcuRow
    currentPlanes = previous ?? componentPlanes(jpeg, blockSize)
    for (const plane of currentPlanes) plane.fill(0)
  }
  await reader.finish()
  if (!pendingPlanes) return
  replicateBottomHalo(jpeg, pendingPlanes, blockSize)
  const data = recycledOutput.pop() ?? new Uint8Array(outputBytes)
  const output = renderRows(
    jpeg,
    pendingPlanes,
    pendingRow,
    region,
    plan,
    data,
    blockSize,
    nativeChannels,
  )
  if (!output) return
  let released = false
  yield {
    ...output,
    release: () => {
      if (released) return
      released = true
      recycledOutput.push(data)
    },
  }
}

export const decodeBaselineJpegNative = async (
  jpeg: BaselineJpeg,
  region: JpegRegion,
): Promise<Uint8Array> => {
  const channels = jpeg.components.length
  if (channels < 1) throw invalidInput('JPEG native decode requires at least one component')
  const output = new Uint8Array(region.width * region.height * channels)
  for await (const block of decodeBaselineJpeg(jpeg, region, 1, undefined, false, channels)) {
    const rowBytes = block.width * channels
    if (
      block.x !== 0 ||
      block.width !== region.width ||
      block.stride < rowBytes ||
      block.y < 0 ||
      block.height < 1 ||
      block.y + block.height > region.height
    ) {
      throw invalidInput('JPEG native decoder produced a malformed sample block')
    }
    for (let row = 0; row < block.height; row += 1) {
      const sourceStart = row * block.stride
      output.set(
        block.data.subarray(sourceStart, sourceStart + rowBytes),
        ((block.y + row) * region.width + block.x) * channels,
      )
    }
    block.release?.()
  }
  return output
}

interface ProgressiveFrameComponent extends RenderComponent {
  readonly id: number
  readonly quantizationId: number
  readonly blocksPerLine: number
  readonly blocksPerColumn: number
  readonly blocksPerLineForMcu: number
  readonly blocksPerColumnForMcu: number
  readonly coefficients: Int16Array
  readonly successiveBits: Int8Array
}

export interface JpegCoefficientRenderComponent extends RenderComponent {
  readonly blocksPerLineForMcu: number
  readonly quantization: Int32Array
  readonly coefficients: Int16Array
}

export interface JpegCoefficientRenderImage extends RenderJpeg {
  readonly width: number
  readonly height: number
  readonly components: readonly JpegCoefficientRenderComponent[]
  readonly mcusPerColumn: number
}

interface ProgressiveComponent extends ProgressiveFrameComponent {
  readonly quantization: Int32Array
}

export interface ProgressiveJpeg extends RenderJpeg {
  readonly width: number
  readonly height: number
  readonly components: readonly ProgressiveComponent[]
  readonly mcusPerColumn: number
  readonly progressive: boolean
  readonly restartInterval: number
  readonly scans: readonly JpegCoefficientScan[]
}

export interface JpegCoefficientScanComponent {
  readonly component: number
  readonly id: number
  readonly dcTable: number
  readonly acTable: number
}

export interface JpegCoefficientScan {
  readonly components: readonly JpegCoefficientScanComponent[]
  readonly spectralStart: number
  readonly spectralEnd: number
  readonly successiveHigh: number
  readonly successiveLow: number
}

interface ProgressiveScanComponent {
  readonly component: ProgressiveFrameComponent
  readonly componentIndex: number
  readonly dcTable?: HuffmanTable
  readonly acTable?: HuffmanTable
  readonly dcTableId: number
  readonly acTableId: number
}

interface ProgressiveScan {
  readonly components: readonly ProgressiveScanComponent[]
  readonly spectralStart: number
  readonly spectralEnd: number
  readonly successiveHigh: number
  readonly successiveLow: number
}

const coefficientScan = (scan: ProgressiveScan): JpegCoefficientScan =>
  Object.freeze({
    components: Object.freeze(
      scan.components.map(({ component, componentIndex, dcTableId, acTableId }) =>
        Object.freeze({
          component: componentIndex,
          id: component.id,
          dcTable: dcTableId,
          acTable: acTableId,
        }),
      ),
    ),
    spectralStart: scan.spectralStart,
    spectralEnd: scan.spectralEnd,
    successiveHigh: scan.successiveHigh,
    successiveLow: scan.successiveLow,
  })

interface ProgressiveState {
  eobRun: number
}

const coefficientOffset = (
  component: Readonly<{ readonly blocksPerLineForMcu: number }>,
  blockX: number,
  blockY: number,
): number => (blockY * component.blocksPerLineForMcu + blockX) * 64

const setCoefficient = (coefficients: Int16Array, index: number, value: number): void => {
  if (value < -32_768 || value > 32_767)
    throw invalidInput('Progressive JPEG coefficient exceeds 16-bit storage')
  coefficients[index] = value
}

const decodeProgressiveDcFirst = (
  reader: JpegBitReader,
  selected: ProgressiveScanComponent,
  predictors: Int32Array,
  blockOffset: number,
  successiveLow: number,
): void => {
  if (!selected.dcTable) throw invalidInput('Progressive JPEG DC table is missing')
  const length = decodeHuffman(reader, selected.dcTable)
  if (length > 11) throw invalidInput('Progressive JPEG DC coefficient is invalid')
  const predictor = byte(predictors, selected.componentIndex) + reader.receiveAndExtend(length)
  predictors[selected.componentIndex] = predictor
  setCoefficient(selected.component.coefficients, blockOffset, predictor * 2 ** successiveLow)
}

const decodeProgressiveDcRefinement = (
  reader: JpegBitReader,
  component: ProgressiveFrameComponent,
  blockOffset: number,
  successiveLow: number,
): void => {
  if (reader.readBit() === 0) return
  const value = byte(component.coefficients, blockOffset)
  setCoefficient(component.coefficients, blockOffset, value | (1 << successiveLow))
}

const decodeProgressiveAcFirst = (
  reader: JpegBitReader,
  selected: ProgressiveScanComponent,
  blockOffset: number,
  scan: ProgressiveScan,
  state: ProgressiveState,
): void => {
  if (!selected.acTable) throw invalidInput('Progressive JPEG AC table is missing')
  if (state.eobRun > 0) {
    state.eobRun -= 1
    return
  }
  let spectral = scan.spectralStart
  while (spectral <= scan.spectralEnd) {
    const symbol = decodeHuffman(reader, selected.acTable)
    const zeroes = symbol >>> 4
    const length = symbol & 15
    if (length === 0) {
      if (zeroes === 15) {
        spectral += 16
        continue
      }
      state.eobRun = (1 << zeroes) + reader.readBits(zeroes) - 1
      return
    }
    if (length > 10) throw invalidInput('Progressive JPEG AC coefficient is invalid')
    spectral += zeroes
    if (spectral > scan.spectralEnd)
      throw invalidInput('Progressive JPEG AC coefficient exceeds its spectral band')
    const target = blockOffset + byte(zigZag, spectral)
    setCoefficient(
      selected.component.coefficients,
      target,
      reader.receiveAndExtend(length) * 2 ** scan.successiveLow,
    )
    spectral += 1
  }
}

const refineNonzeroCoefficient = (
  reader: JpegBitReader,
  coefficients: Int16Array,
  index: number,
  bit: number,
): void => {
  const value = byte(coefficients, index)
  if (reader.readBit() === 0 || (Math.abs(value) & bit) !== 0) return
  setCoefficient(coefficients, index, value + (value > 0 ? bit : -bit))
}

const decodeProgressiveAcRefinement = (
  reader: JpegBitReader,
  selected: ProgressiveScanComponent,
  blockOffset: number,
  scan: ProgressiveScan,
  state: ProgressiveState,
): void => {
  if (!selected.acTable) throw invalidInput('Progressive JPEG AC table is missing')
  const coefficients = selected.component.coefficients
  const bit = 1 << scan.successiveLow
  let spectral = scan.spectralStart

  if (state.eobRun > 0) {
    for (; spectral <= scan.spectralEnd; spectral += 1) {
      const target = blockOffset + byte(zigZag, spectral)
      if (byte(coefficients, target) !== 0)
        refineNonzeroCoefficient(reader, coefficients, target, bit)
    }
    state.eobRun -= 1
    return
  }

  while (spectral <= scan.spectralEnd) {
    const symbol = decodeHuffman(reader, selected.acTable)
    let zeroes = symbol >>> 4
    const length = symbol & 15
    if (length === 0) {
      if (zeroes !== 15) {
        state.eobRun = (1 << zeroes) + reader.readBits(zeroes) - 1
        for (; spectral <= scan.spectralEnd; spectral += 1) {
          const target = blockOffset + byte(zigZag, spectral)
          if (byte(coefficients, target) !== 0)
            refineNonzeroCoefficient(reader, coefficients, target, bit)
        }
        return
      }
      zeroes = 16
      while (spectral <= scan.spectralEnd && zeroes > 0) {
        const target = blockOffset + byte(zigZag, spectral)
        if (byte(coefficients, target) !== 0) {
          refineNonzeroCoefficient(reader, coefficients, target, bit)
        } else {
          zeroes -= 1
        }
        spectral += 1
      }
      continue
    }
    if (length !== 1) throw invalidInput('Progressive JPEG AC refinement coefficient is invalid')
    const newCoefficient = reader.readBit() === 1 ? bit : -bit

    while (spectral <= scan.spectralEnd) {
      const target = blockOffset + byte(zigZag, spectral)
      if (byte(coefficients, target) !== 0) {
        refineNonzeroCoefficient(reader, coefficients, target, bit)
      } else {
        if (zeroes === 0) break
        zeroes -= 1
      }
      spectral += 1
    }
    if (spectral > scan.spectralEnd)
      throw invalidInput('Progressive JPEG AC refinement exceeds its spectral band')
    setCoefficient(coefficients, blockOffset + byte(zigZag, spectral), newCoefficient)
    spectral += 1
  }
}

const validateProgressiveScan = (scan: ProgressiveScan): void => {
  const { spectralStart, spectralEnd, successiveHigh, successiveLow } = scan
  if (
    spectralStart > spectralEnd ||
    spectralEnd > 63 ||
    successiveHigh > 13 ||
    successiveLow > 13 ||
    (successiveHigh !== 0 && successiveHigh !== successiveLow + 1)
  ) {
    throw invalidInput('Progressive JPEG scan parameters are invalid')
  }
  if (spectralStart === 0 && spectralEnd !== 0)
    throw invalidInput('Progressive JPEG DC scan must contain only coefficient zero')
  if (spectralStart > 0 && scan.components.length !== 1)
    throw invalidInput('Progressive JPEG AC scan must contain one component')

  for (const selected of scan.components) {
    const progression = selected.component.successiveBits
    for (let spectral = spectralStart; spectral <= spectralEnd; spectral += 1) {
      const previous = progression[spectral] ?? -1
      if (
        (successiveHigh === 0 && previous !== -1) ||
        (successiveHigh !== 0 && previous !== successiveHigh)
      ) {
        throw invalidInput('Progressive JPEG scan order is invalid')
      }
      progression[spectral] = successiveLow
    }
  }
}

const decodeProgressiveScan = (
  data: Uint8Array,
  offset: number,
  scan: ProgressiveScan,
  mcusPerLine: number,
  mcusPerColumn: number,
  restartInterval: number,
): number => {
  validateProgressiveScan(scan)
  const reader = new EntropyReader(data, offset)
  const predictors = new Int32Array(
    Math.max(...scan.components.map((selected) => selected.componentIndex)) + 1,
  )
  const state: ProgressiveState = { eobRun: 0 }
  const single = scan.components.length === 1 ? scan.components[0] : undefined
  const scanMcusPerLine = single ? single.component.blocksPerLine : mcusPerLine
  const scanMcusPerColumn = single ? single.component.blocksPerColumn : mcusPerColumn
  let mcu = 0
  let restart = 0

  for (let mcuY = 0; mcuY < scanMcusPerColumn; mcuY += 1) {
    for (let mcuX = 0; mcuX < scanMcusPerLine; mcuX += 1) {
      if (restartInterval > 0 && mcu > 0 && mcu % restartInterval === 0) {
        reader.restart(restart)
        restart += 1
        predictors.fill(0)
        state.eobRun = 0
      }
      for (const selected of scan.components) {
        const blocksWide = single ? 1 : selected.component.horizontalSampling
        const blocksHigh = single ? 1 : selected.component.verticalSampling
        for (let blockY = 0; blockY < blocksHigh; blockY += 1) {
          for (let blockX = 0; blockX < blocksWide; blockX += 1) {
            const x = single ? mcuX : mcuX * blocksWide + blockX
            const y = single ? mcuY : mcuY * blocksHigh + blockY
            const target = coefficientOffset(selected.component, x, y)
            if (scan.spectralStart === 0) {
              if (scan.successiveHigh === 0) {
                decodeProgressiveDcFirst(reader, selected, predictors, target, scan.successiveLow)
              } else {
                decodeProgressiveDcRefinement(
                  reader,
                  selected.component,
                  target,
                  scan.successiveLow,
                )
              }
            } else if (scan.successiveHigh === 0) {
              decodeProgressiveAcFirst(reader, selected, target, scan, state)
            } else {
              decodeProgressiveAcRefinement(reader, selected, target, scan, state)
            }
          }
        }
      }
      mcu += 1
    }
  }
  return reader.scanEnd()
}

const progressiveFrameComponents = (
  frame: ParsedFrame,
  maximumHorizontalSampling: number,
  maximumVerticalSampling: number,
  mcusPerLine: number,
  mcusPerColumn: number,
  maximumCoefficientBytes = Number.MAX_SAFE_INTEGER,
): ProgressiveFrameComponent[] => {
  let coefficientBytes = 0n
  for (const component of frame.components) {
    coefficientBytes +=
      BigInt(mcusPerLine) *
      BigInt(component.horizontalSampling) *
      BigInt(mcusPerColumn) *
      BigInt(component.verticalSampling) *
      64n *
      2n
  }
  if (coefficientBytes > BigInt(maximumCoefficientBytes)) {
    throw limitExceeded(
      `JPEG coefficient storage is ${coefficientBytes} bytes; limit is ${maximumCoefficientBytes}`,
    )
  }
  return frame.components.map((component) => {
    const blocksPerLine = Math.ceil(
      (Math.ceil(frame.width / 8) * component.horizontalSampling) / maximumHorizontalSampling,
    )
    const blocksPerColumn = Math.ceil(
      (Math.ceil(frame.height / 8) * component.verticalSampling) / maximumVerticalSampling,
    )
    const blocksPerLineForMcu = mcusPerLine * component.horizontalSampling
    const blocksPerColumnForMcu = mcusPerColumn * component.verticalSampling
    const successiveBits = new Int8Array(64)
    successiveBits.fill(-1)
    return {
      ...component,
      blocksPerLine,
      blocksPerColumn,
      blocksPerLineForMcu,
      blocksPerColumnForMcu,
      coefficients: new Int16Array(blocksPerLineForMcu * blocksPerColumnForMcu * 64),
      successiveBits,
    }
  })
}

export const parseProgressiveJpeg = (
  data: Uint8Array,
  validateDimensions: (width: number, height: number) => void,
  applyIcc = true,
): ProgressiveJpeg | undefined => {
  if (data.byteLength < 4 || readUint16(data, 0) !== 0xffd8)
    throw invalidInput('JPEG start marker is missing')
  const quantizationTables = new Map<number, Int32Array>()
  const dcTables = new Map<number, HuffmanTable>()
  const acTables = new Map<number, HuffmanTable>()
  let frame: ParsedFrame | undefined
  let adobeTransform: number | undefined
  const iccChunks: JpegIccChunk[] = []
  let components: ProgressiveFrameComponent[] | undefined
  let maximumHorizontalSampling = 1
  let maximumVerticalSampling = 1
  let mcusPerLine = 0
  let mcusPerColumn = 0
  let restartInterval = 0
  let sawScan = false
  const scans: JpegCoefficientScan[] = []
  let offset = 2

  while (offset < data.byteLength) {
    while (byte(data, offset) === 0xff) offset += 1
    if (offset >= data.byteLength) throw truncatedInput('JPEG marker is truncated')
    const marker = byte(data, offset)
    offset += 1
    if (marker === 0xd9) {
      if (!frame || !components || !sawScan)
        throw invalidInput('Progressive JPEG ended before image data')
      const outputComponents: ProgressiveComponent[] = components.map((component) => {
        const quantization = quantizationTables.get(component.quantizationId)
        if (!quantization)
          throw invalidInput('Progressive JPEG component references a missing quantization table')
        return { ...component, quantization }
      })
      const jpegColorTransform = colorTransform(frame, adobeTransform)
      const iccTransform = applyIcc ? createIccTransform(iccChunks, jpegColorTransform) : undefined
      return {
        width: frame.width,
        height: frame.height,
        components: outputComponents,
        colorTransform: jpegColorTransform,
        ...(iccTransform ? { iccTransform } : {}),
        maximumHorizontalSampling,
        maximumVerticalSampling,
        mcusPerLine,
        mcusPerColumn,
        progressive: true,
        restartInterval,
        scans: Object.freeze(scans),
      }
    }
    if (marker === 0x00 || (marker >= 0xd0 && marker <= 0xd8))
      throw invalidInput('JPEG contains an unexpected standalone marker')
    const end = segmentEnd(data, offset)
    const start = offset + 2

    if (marker === 0xdb) parseQuantizationTables(data, start, end, quantizationTables)
    else if (marker === 0xc4) parseHuffmanTables(data, start, end, dcTables, acTables)
    else if (marker === 0xe2) {
      const chunk = parseJpegIccChunk(data, start, end)
      if (chunk) iccChunks.push(chunk)
    } else if (marker === 0xee) {
      adobeTransform = parseAdobeTransform(data, start, end) ?? adobeTransform
    } else if (marker === 0xc0 || marker === 0xc1) return undefined
    else if (isArithmeticFrameMarker(marker))
      throw unsupportedOperation('Arithmetic-coded JPEG images are unsupported')
    else if (marker === 0xc2) {
      if (frame) throw invalidInput('Progressive JPEG contains multiple frames')
      frame = parseFrame(data, start, end)
      validateDimensions(frame.width, frame.height)
      for (const component of frame.components) {
        maximumHorizontalSampling = Math.max(
          maximumHorizontalSampling,
          component.horizontalSampling,
        )
        maximumVerticalSampling = Math.max(maximumVerticalSampling, component.verticalSampling)
      }
      mcusPerLine = Math.ceil(frame.width / (8 * maximumHorizontalSampling))
      mcusPerColumn = Math.ceil(frame.height / (8 * maximumVerticalSampling))
      components = progressiveFrameComponents(
        frame,
        maximumHorizontalSampling,
        maximumVerticalSampling,
        mcusPerLine,
        mcusPerColumn,
      )
    } else if (marker === 0xdd) {
      if (end - start !== 2) throw invalidInput('JPEG restart interval is invalid')
      restartInterval = readUint16(data, start)
    } else if (marker === 0xda) {
      if (!frame || !components) throw invalidInput('JPEG scan appears before its frame')
      const selectorCount = byte(data, start)
      if (
        selectorCount < 1 ||
        selectorCount > components.length ||
        start + 1 + selectorCount * 2 + 3 !== end
      ) {
        throw invalidInput('Progressive JPEG scan header is invalid')
      }
      const selected: ProgressiveScanComponent[] = []
      const selectedIds = new Set<number>()
      for (let index = 0; index < selectorCount; index += 1) {
        const selectorOffset = start + 1 + index * 2
        const selectedId = byte(data, selectorOffset)
        if (selectedIds.has(selectedId))
          throw invalidInput('Progressive JPEG scan repeats a component')
        selectedIds.add(selectedId)
        const component = components.find((candidate) => candidate.id === selectedId)
        if (!component) throw invalidInput('JPEG scan references an unknown component')
        const componentIndex = components.indexOf(component)
        const tables = byte(data, selectorOffset + 1)
        const dcTable = dcTables.get(tables >>> 4)
        const acTable = acTables.get(tables & 15)
        selected.push({
          component,
          componentIndex,
          dcTableId: tables >>> 4,
          acTableId: tables & 15,
          ...(dcTable ? { dcTable } : {}),
          ...(acTable ? { acTable } : {}),
        })
      }
      const spectralOffset = start + 1 + selectorCount * 2
      const successive = byte(data, spectralOffset + 2)
      const scan: ProgressiveScan = {
        components: selected,
        spectralStart: byte(data, spectralOffset),
        spectralEnd: byte(data, spectralOffset + 1),
        successiveHigh: successive >>> 4,
        successiveLow: successive & 15,
      }
      scans.push(coefficientScan(scan))
      offset = decodeProgressiveScan(data, end, scan, mcusPerLine, mcusPerColumn, restartInterval)
      sawScan = true
      continue
    }
    offset = end
  }
  throw truncatedInput('Progressive JPEG is missing its end marker')
}

interface ProgressiveSourceScanResult {
  readonly offset: number
  readonly recovered: boolean
}

const decodeProgressiveSourceScan = async (
  source: ImageSource,
  offset: number,
  scan: ProgressiveScan,
  mcusPerLine: number,
  mcusPerColumn: number,
  restartInterval: number,
  tolerantDecoding = false,
): Promise<ProgressiveSourceScanResult> => {
  validateProgressiveScan(scan)
  const reader = new JpegEntropyReader(source, offset, false, tolerantDecoding)
  const predictors = new Int32Array(
    Math.max(...scan.components.map((selected) => selected.componentIndex)) + 1,
  )
  const state: ProgressiveState = { eobRun: 0 }
  const single = scan.components.length === 1 ? scan.components[0] : undefined
  const scanMcusPerLine = single ? single.component.blocksPerLine : mcusPerLine
  const scanMcusPerColumn = single ? single.component.blocksPerColumn : mcusPerColumn
  let mcu = 0
  let restart = 0

  for (let mcuY = 0; mcuY < scanMcusPerColumn; mcuY += 1) {
    for (let mcuX = 0; mcuX < scanMcusPerLine; mcuX += 1) {
      if (reader.available < 8_192) await reader.refill()
      if (restartInterval > 0 && mcu > 0 && mcu % restartInterval === 0) {
        reader.restart(restart)
        restart += 1
        predictors.fill(0)
        state.eobRun = 0
      }
      try {
        for (const selected of scan.components) {
          const blocksWide = single ? 1 : selected.component.horizontalSampling
          const blocksHigh = single ? 1 : selected.component.verticalSampling
          for (let blockY = 0; blockY < blocksHigh; blockY += 1) {
            for (let blockX = 0; blockX < blocksWide; blockX += 1) {
              const x = single ? mcuX : mcuX * blocksWide + blockX
              const y = single ? mcuY : mcuY * blocksHigh + blockY
              const target = coefficientOffset(selected.component, x, y)
              if (scan.spectralStart === 0) {
                if (scan.successiveHigh === 0) {
                  decodeProgressiveDcFirst(reader, selected, predictors, target, scan.successiveLow)
                } else {
                  decodeProgressiveDcRefinement(
                    reader,
                    selected.component,
                    target,
                    scan.successiveLow,
                  )
                }
              } else if (scan.successiveHigh === 0) {
                decodeProgressiveAcFirst(reader, selected, target, scan, state)
              } else {
                decodeProgressiveAcRefinement(reader, selected, target, scan, state)
              }
            }
          }
        }
      } catch (error) {
        if (
          !tolerantDecoding ||
          !(error instanceof JpegUnexpectedScanBoundary) ||
          (error.marker !== 0xc4 && error.marker !== 0xda && error.marker !== 0xd9)
        ) {
          throw error
        }
        return { offset: error.offset, recovered: true }
      }
      mcu += 1
    }
  }
  if (reader.available === 0) await reader.refill()
  return { offset: reader.scanEnd(), recovered: false }
}

const decodeSequentialSourceScan = async (
  source: ImageSource,
  offset: number,
  scan: ProgressiveScan,
  mcusPerLine: number,
  mcusPerColumn: number,
  restartInterval: number,
  quantizationTables: ReadonlyMap<number, Int32Array>,
): Promise<number> => {
  if (
    scan.spectralStart !== 0 ||
    scan.spectralEnd !== 63 ||
    scan.successiveHigh !== 0 ||
    scan.successiveLow !== 0
  ) {
    throw invalidInput('Sequential JPEG scan parameters are invalid')
  }
  const selectedComponents = scan.components.map((selected) => {
    const quantization = quantizationTables.get(selected.component.quantizationId)
    if (!quantization || !selected.dcTable || !selected.acTable) {
      throw invalidInput('Sequential JPEG scan references a missing coding table')
    }
    return {
      selected,
      decoder: {
        id: selected.component.id,
        horizontalSampling: selected.component.horizontalSampling,
        verticalSampling: selected.component.verticalSampling,
        quantization,
        dcTable: selected.dcTable,
        acTable: selected.acTable,
      } satisfies FrameComponent,
    }
  })
  const reader = new JpegEntropyReader(source, offset)
  const predictors = new Int32Array(
    Math.max(...scan.components.map((selected) => selected.componentIndex)) + 1,
  )
  const coefficients = new Int32Array(64)
  const single = selectedComponents.length === 1 ? selectedComponents[0] : undefined
  const scanMcusPerLine = single ? single.selected.component.blocksPerLine : mcusPerLine
  const scanMcusPerColumn = single ? single.selected.component.blocksPerColumn : mcusPerColumn
  let mcu = 0
  let restart = 0
  for (let mcuY = 0; mcuY < scanMcusPerColumn; mcuY += 1) {
    for (let mcuX = 0; mcuX < scanMcusPerLine; mcuX += 1) {
      if (reader.available < 8_192) await reader.refill()
      if (restartInterval > 0 && mcu > 0 && mcu % restartInterval === 0) {
        reader.restart(restart)
        restart += 1
        predictors.fill(0)
      }
      for (const entry of selectedComponents) {
        const blocksWide = single ? 1 : entry.selected.component.horizontalSampling
        const blocksHigh = single ? 1 : entry.selected.component.verticalSampling
        for (let blockY = 0; blockY < blocksHigh; blockY += 1) {
          for (let blockX = 0; blockX < blocksWide; blockX += 1) {
            const x = single ? mcuX : mcuX * blocksWide + blockX
            const y = single ? mcuY : mcuY * blocksHigh + blockY
            const predictor = decodeBlock(
              reader,
              entry.decoder,
              predictors[entry.selected.componentIndex] ?? 0,
              coefficients,
            )
            predictors[entry.selected.componentIndex] = predictor
            const target = coefficientOffset(entry.selected.component, x, y)
            for (let coefficient = 0; coefficient < 64; coefficient += 1) {
              setCoefficient(
                entry.selected.component.coefficients,
                target + coefficient,
                coefficients[coefficient] ?? 0,
              )
            }
          }
        }
      }
      mcu += 1
    }
  }
  if (reader.available === 0) await reader.refill()
  return reader.scanEnd()
}

export const parseCoefficientJpegSource = async (
  source: ImageSource,
  validateDimensions: (width: number, height: number) => void,
  applyIcc = true,
  maximumCoefficientBytes = Number.MAX_SAFE_INTEGER,
  tolerantDecoding = false,
): Promise<ProgressiveJpeg | undefined> => {
  let reader = new SourceReader(source)
  const signature = await reader.read(2)
  if (readUint16(signature, 0) !== 0xffd8) throw invalidInput('JPEG start marker is missing')
  const quantizationTables = new Map<number, Int32Array>()
  const dcTables = new Map<number, HuffmanTable>()
  const acTables = new Map<number, HuffmanTable>()
  let frame: ParsedFrame | undefined
  let progressive = false
  let adobeTransform: number | undefined
  const iccChunks: JpegIccChunk[] = []
  let components: ProgressiveFrameComponent[] | undefined
  let maximumHorizontalSampling = 1
  let maximumVerticalSampling = 1
  let mcusPerLine = 0
  let mcusPerColumn = 0
  let restartInterval = 0
  let scanCount = 0
  let recoveredProgressiveScan = false
  const scans: JpegCoefficientScan[] = []
  const sequentialSeen = new Set<number>()

  while (reader.position < source.size) {
    const marker = await nextSourceMarker(reader, tolerantDecoding && scanCount > 0)
    if (marker === 0xd9) {
      if (!frame || !components || scanCount === 0) {
        throw invalidInput('JPEG ended before complete image data')
      }
      if (!progressive && sequentialSeen.size !== components.length) {
        throw invalidInput('Sequential JPEG is missing component scans')
      }
      const outputComponents: ProgressiveComponent[] = components.map((component) => {
        const quantization = quantizationTables.get(component.quantizationId)
        if (!quantization) {
          throw invalidInput('JPEG component references a missing quantization table')
        }
        return { ...component, quantization }
      })
      const jpegColorTransform = colorTransform(frame, adobeTransform)
      let iccTransform: JpegIccTransform | undefined
      if (applyIcc) {
        try {
          iccTransform = createIccTransform(iccChunks, jpegColorTransform)
        } catch (error) {
          if (
            !recoveredProgressiveScan ||
            !(error instanceof ImageError) ||
            (error.code !== 'INVALID_INPUT' && error.code !== 'TRUNCATED_INPUT')
          ) {
            throw error
          }
        }
      }
      return {
        width: frame.width,
        height: frame.height,
        components: outputComponents,
        colorTransform: jpegColorTransform,
        ...(iccTransform ? { iccTransform } : {}),
        maximumHorizontalSampling,
        maximumVerticalSampling,
        mcusPerLine,
        mcusPerColumn,
        progressive,
        restartInterval,
        scans: Object.freeze(scans),
      }
    }
    const payload = await sourceSegment(reader)
    const end = payload.byteLength
    if (marker === 0xdb) parseQuantizationTables(payload, 0, end, quantizationTables)
    else if (marker === 0xc4) parseHuffmanTables(payload, 0, end, dcTables, acTables)
    else if (marker === 0xe2) {
      const chunk = parseJpegIccChunk(payload, 0, end)
      if (chunk) iccChunks.push(chunk)
    } else if (marker === 0xee) {
      adobeTransform = parseAdobeTransform(payload, 0, end) ?? adobeTransform
    } else if (isArithmeticFrameMarker(marker)) {
      throw unsupportedOperation('Arithmetic-coded JPEG images are unsupported')
    } else if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) {
      if (frame) throw invalidInput('JPEG contains multiple frames')
      progressive = marker === 0xc2
      frame = parseFrame(payload, 0, end)
      validateDimensions(frame.width, frame.height)
      for (const component of frame.components) {
        maximumHorizontalSampling = Math.max(
          maximumHorizontalSampling,
          component.horizontalSampling,
        )
        maximumVerticalSampling = Math.max(maximumVerticalSampling, component.verticalSampling)
      }
      mcusPerLine = Math.ceil(frame.width / (8 * maximumHorizontalSampling))
      mcusPerColumn = Math.ceil(frame.height / (8 * maximumVerticalSampling))
      components = progressiveFrameComponents(
        frame,
        maximumHorizontalSampling,
        maximumVerticalSampling,
        mcusPerLine,
        mcusPerColumn,
        maximumCoefficientBytes,
      )
    } else if (marker >= 0xc3 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8) {
      return undefined
    } else if (marker === 0xdd) {
      if (end !== 2) throw invalidInput('JPEG restart interval is invalid')
      restartInterval = readUint16(payload, 0)
    } else if (marker === 0xda) {
      if (!frame || !components) throw invalidInput('JPEG scan appears before its frame')
      scanCount += 1
      if (scanCount > 1_024) throw invalidInput('JPEG scan count exceeds 1024')
      const selectorCount = byte(payload, 0)
      if (
        selectorCount < 1 ||
        selectorCount > components.length ||
        1 + selectorCount * 2 + 3 !== end
      ) {
        throw invalidInput('JPEG scan header is invalid')
      }
      const selected: ProgressiveScanComponent[] = []
      const selectedIds = new Set<number>()
      for (let index = 0; index < selectorCount; index += 1) {
        const selectorOffset = 1 + index * 2
        const selectedId = byte(payload, selectorOffset)
        if (selectedIds.has(selectedId)) throw invalidInput('JPEG scan repeats a component')
        if (!progressive && sequentialSeen.has(selectedId)) {
          throw invalidInput('Sequential JPEG repeats a component scan')
        }
        selectedIds.add(selectedId)
        const component = components.find((candidate) => candidate.id === selectedId)
        if (!component) throw invalidInput('JPEG scan references an unknown component')
        const componentIndex = components.indexOf(component)
        const tables = byte(payload, selectorOffset + 1)
        const dcTable = dcTables.get(tables >>> 4)
        const acTable = acTables.get(tables & 15)
        selected.push({
          component,
          componentIndex,
          dcTableId: tables >>> 4,
          acTableId: tables & 15,
          ...(dcTable ? { dcTable } : {}),
          ...(acTable ? { acTable } : {}),
        })
      }
      const spectralOffset = 1 + selectorCount * 2
      const successive = byte(payload, spectralOffset + 2)
      const scan: ProgressiveScan = {
        components: selected,
        spectralStart: byte(payload, spectralOffset),
        spectralEnd: byte(payload, spectralOffset + 1),
        successiveHigh: successive >>> 4,
        successiveLow: successive & 15,
      }
      scans.push(coefficientScan(scan))
      let nextOffset: number
      if (progressive) {
        const result = await decodeProgressiveSourceScan(
          source,
          reader.position,
          scan,
          mcusPerLine,
          mcusPerColumn,
          restartInterval,
          tolerantDecoding,
        )
        nextOffset = result.offset
        recoveredProgressiveScan ||= result.recovered
      } else {
        nextOffset = await decodeSequentialSourceScan(
          source,
          reader.position,
          scan,
          mcusPerLine,
          mcusPerColumn,
          restartInterval,
          quantizationTables,
        )
      }
      if (!progressive) for (const id of selectedIds) sequentialSeen.add(id)
      reader = new SourceReader(source, nextOffset)
    }
  }
  throw truncatedInput('JPEG is missing its end marker')
}

export const decodeJpegCoefficientImage = async function* (
  jpeg: JpegCoefficientRenderImage,
  region: JpegRegion,
  scaleDenominator: JpegScaleDenominator = 1,
): AsyncGenerator<PixelBlock> {
  const workspace = new Float64Array(64)
  const activeRowIndices = new Uint8Array(8)
  const sampleWorkspace = new Float64Array(8)
  const blockSize = outputSizeForScale(scaleDenominator)
  const inverseBlock = inverseDctForScale(scaleDenominator)
  const plan = createRenderPlan(jpeg, region, blockSize)
  const mcuWidth = jpeg.maximumHorizontalSampling * blockSize
  const mcuHeight = jpeg.maximumVerticalSampling * blockSize
  const firstMcuColumn = Math.max(0, Math.floor(region.x / mcuWidth) - 1)
  const lastMcuColumn = Math.min(
    jpeg.mcusPerLine - 1,
    Math.floor((region.x + region.width - 1) / mcuWidth) + 1,
  )
  const firstMcuRow = Math.max(0, Math.floor(region.y / mcuHeight) - 1)
  const lastOutputMcuRow = Math.floor((region.y + region.height - 1) / mcuHeight)
  const lastMcuRow = Math.min(jpeg.mcusPerColumn - 1, lastOutputMcuRow + 1)
  let currentPlanes = componentPlanes(jpeg, blockSize)
  let pendingPlanes: Uint8Array[] | undefined
  let pendingRow = -1
  const recycledOutput: Uint8Array[] = []
  const outputBytes = region.width * 3 * jpeg.maximumVerticalSampling * blockSize
  for (let mcuRow = firstMcuRow; mcuRow <= lastMcuRow; mcuRow += 1) {
    for (let componentIndex = 0; componentIndex < jpeg.components.length; componentIndex += 1) {
      const component = jpeg.components[componentIndex]
      const plane = currentPlanes[componentIndex]
      if (!component || !plane) throw invalidInput('JPEG component storage is missing')
      const planeWidth = jpeg.mcusPerLine * component.horizontalSampling * blockSize
      for (let blockY = 0; blockY < component.verticalSampling; blockY += 1) {
        const sourceBlockY = mcuRow * component.verticalSampling + blockY
        for (let mcuColumn = firstMcuColumn; mcuColumn <= lastMcuColumn; mcuColumn += 1) {
          for (let blockX = 0; blockX < component.horizontalSampling; blockX += 1) {
            const sourceBlockX = mcuColumn * component.horizontalSampling + blockX
            inverseBlock(
              component.coefficients,
              component.quantization,
              workspace,
              activeRowIndices,
              sampleWorkspace,
              plane,
              planeWidth,
              sourceBlockX,
              blockY + 1,
              coefficientOffset(component, sourceBlockX, sourceBlockY),
            )
          }
        }
      }
    }
    if (!pendingPlanes) {
      if (mcuRow === 0) replicateTopHalo(jpeg, currentPlanes, blockSize)
    } else {
      linkPlaneHalos(jpeg, pendingPlanes, currentPlanes, blockSize)
      const data = recycledOutput.pop() ?? new Uint8Array(outputBytes)
      const output = renderRows(jpeg, pendingPlanes, pendingRow, region, plan, data, blockSize)
      if (output) {
        let released = false
        yield {
          ...output,
          release: () => {
            if (released) return
            released = true
            recycledOutput.push(data)
          },
        }
      } else {
        recycledOutput.push(data)
      }
      if (pendingRow >= lastOutputMcuRow) return
    }
    const previous = pendingPlanes
    pendingPlanes = currentPlanes
    pendingRow = mcuRow
    currentPlanes = previous ?? componentPlanes(jpeg, blockSize)
    for (const plane of currentPlanes) plane.fill(0)
  }
  if (!pendingPlanes) return
  replicateBottomHalo(jpeg, pendingPlanes, blockSize)
  const data = recycledOutput.pop() ?? new Uint8Array(outputBytes)
  const output = renderRows(jpeg, pendingPlanes, pendingRow, region, plan, data, blockSize)
  if (!output) return
  let released = false
  yield {
    ...output,
    release: () => {
      if (released) return
      released = true
      recycledOutput.push(data)
    },
  }
}

export const decodeProgressiveJpeg = decodeJpegCoefficientImage
