import type { AbortOptions } from '../abort.ts'
import { throwIfAborted } from '../abort.ts'
import type {
  DecoderOptions,
  DecodeRequest,
  ImageCodec,
  ImageDecoder,
  ImageMetadata,
  PreservedMetadata,
} from '../codec.ts'
import {
  ImageError,
  invalidInput,
  limitExceeded,
  truncatedInput,
  unsupportedOperation,
} from '../errors.ts'
import type { ImageLimits } from '../limits.ts'
import { resolveLimits, validateImageDimensions, validateInputSize } from '../limits.ts'
import type { PixelBlock, PixelFormat, PixelSampleDisplayRange } from '../pixel.ts'
import type {
  RasterBlock,
  RasterDecodeRequest,
  RasterDecoder,
  RasterFormat,
  RasterSampleType,
} from '../raster.ts'
import type { ImageSource } from '../source.ts'
import { bindImageSourceSignal, MemorySource, readExactly } from '../source.ts'
import type {
  TiffDirectory,
  TiffDocument,
  TiffDocumentOptions,
  TiffByteReadOptions,
  TiffTagReadOptions,
  TiffTagValue,
} from '../tiff/types.ts'
import { decodeZstd } from '../compression/zstd/index.ts'
import { decodeLerc2 } from './tiff-lerc.ts'
import {
  type CmykIccTransform,
  ColorManagedDecoder,
  tiffCieLabToSrgb,
  MAX_ICC_PROFILE_BYTES,
  parseCmykIccTransform,
  parseRgbIccTransform,
  type RgbIccTransform,
  writeCmykIcc,
} from './icc.ts'
import { jpegCodec } from './jpeg.ts'
import { createJpeg2000CodestreamDecoder } from './jpeg2000.ts'
import { decodeLogLuvSegment, type LogLuvEncoding } from './tiff-logluv.ts'
import { TiffEncoder } from './tiff-encode.ts'
export { encodeTiffDocument } from './tiff-encode.ts'
export type {
  TiffDocumentEncodeRequest,
  TiffEncodeOptions,
  TiffPageEncodeRequest,
} from './tiff-encode.ts'

const blockRows = 32
const compressionNone = 1
const compressionCcittModifiedHuffman = 2
const compressionCcittGroup3 = 3
const compressionCcittGroup4 = 4
const compressionLzw = 5
const compressionOldJpeg = 6
const compressionLerc = 34887
const compressionJpeg = 7
const compressionDeflate = 8
const compressionAdobeDeflate = 32946
const compressionPackBits = 32773
const compressionZstandard = 50000
const compressionWebp = 50001
const compressionAperioJpeg2000Ycbcr = 33003
const compressionAperioJpeg2000Mct = 33005
const compressionSgiLog = 34676
const compressionSgiLog24 = 34677
const sampleFormatUnsigned = 1
const sampleFormatSigned = 2
const sampleFormatFloat = 3
const photometricWhiteIsZero = 0
const photometricBlackIsZero = 1
const photometricRgb = 2
const photometricPalette = 3
const photometricSeparated = 5
const photometricYCbCr = 6
const photometricCieLab = 8
const photometricLogL = 32844
const photometricLogLuv = 32845
const faxLookupBits = 13
const faxLookupSize = 1 << faxLookupBits
const reversedNibbles = Uint8Array.of(0, 8, 4, 12, 2, 10, 6, 14, 1, 9, 5, 13, 3, 11, 7, 15)

interface FaxCode {
  readonly run: number
  readonly bits: string
}

interface FaxCodeLookup {
  readonly runs: Int16Array
  readonly lengths: Uint8Array
}

const whiteTerminatingCodes = [
  '00110101',
  '000111',
  '0111',
  '1000',
  '1011',
  '1100',
  '1110',
  '1111',
  '10011',
  '10100',
  '00111',
  '01000',
  '001000',
  '000011',
  '110100',
  '110101',
  '101010',
  '101011',
  '0100111',
  '0001100',
  '0001000',
  '0010111',
  '0000011',
  '0000100',
  '0101000',
  '0101011',
  '0010011',
  '0100100',
  '0011000',
  '00000010',
  '00000011',
  '00011010',
  '00011011',
  '00010010',
  '00010011',
  '00010100',
  '00010101',
  '00010110',
  '00010111',
  '00101000',
  '00101001',
  '00101010',
  '00101011',
  '00101100',
  '00101101',
  '00000100',
  '00000101',
  '00001010',
  '00001011',
  '01010010',
  '01010011',
  '01010100',
  '01010101',
  '00100100',
  '00100101',
  '01011000',
  '01011001',
  '01011010',
  '01011011',
  '01001010',
  '01001011',
  '00110010',
  '00110011',
  '00110100',
] as const

const blackTerminatingCodes = [
  '0000110111',
  '010',
  '11',
  '10',
  '011',
  '0011',
  '0010',
  '00011',
  '000101',
  '000100',
  '0000100',
  '0000101',
  '0000111',
  '00000100',
  '00000111',
  '000011000',
  '0000010111',
  '0000011000',
  '0000001000',
  '00001100111',
  '00001101000',
  '00001101100',
  '00000110111',
  '00000101000',
  '00000010111',
  '00000011000',
  '000011001010',
  '000011001011',
  '000011001100',
  '000011001101',
  '000001101000',
  '000001101001',
  '000001101010',
  '000001101011',
  '000011010010',
  '000011010011',
  '000011010100',
  '000011010101',
  '000011010110',
  '000011010111',
  '000001101100',
  '000001101101',
  '000011011010',
  '000011011011',
  '000001010100',
  '000001010101',
  '000001010110',
  '000001010111',
  '000001100100',
  '000001100101',
  '000001010010',
  '000001010011',
  '000000100100',
  '000000110111',
  '000000111000',
  '000000100111',
  '000000101000',
  '000001011000',
  '000001011001',
  '000000101011',
  '000000101100',
  '000001011010',
  '000001100110',
  '000001100111',
] as const

const whiteMakeupCodes: readonly FaxCode[] = [
  { run: 64, bits: '11011' },
  { run: 128, bits: '10010' },
  { run: 192, bits: '010111' },
  { run: 256, bits: '0110111' },
  { run: 320, bits: '00110110' },
  { run: 384, bits: '00110111' },
  { run: 448, bits: '01100100' },
  { run: 512, bits: '01100101' },
  { run: 576, bits: '01101000' },
  { run: 640, bits: '01100111' },
  { run: 704, bits: '011001100' },
  { run: 768, bits: '011001101' },
  { run: 832, bits: '011010010' },
  { run: 896, bits: '011010011' },
  { run: 960, bits: '011010100' },
  { run: 1024, bits: '011010101' },
  { run: 1088, bits: '011010110' },
  { run: 1152, bits: '011010111' },
  { run: 1216, bits: '011011000' },
  { run: 1280, bits: '011011001' },
  { run: 1344, bits: '011011010' },
  { run: 1408, bits: '011011011' },
  { run: 1472, bits: '010011000' },
  { run: 1536, bits: '010011001' },
  { run: 1600, bits: '010011010' },
  { run: 1664, bits: '011000' },
  { run: 1728, bits: '010011011' },
]

const blackMakeupCodes: readonly FaxCode[] = [
  { run: 64, bits: '0000001111' },
  { run: 128, bits: '000011001000' },
  { run: 192, bits: '000011001001' },
  { run: 256, bits: '000001011011' },
  { run: 320, bits: '000000110011' },
  { run: 384, bits: '000000110100' },
  { run: 448, bits: '000000110101' },
  { run: 512, bits: '0000001101100' },
  { run: 576, bits: '0000001101101' },
  { run: 640, bits: '0000001001010' },
  { run: 704, bits: '0000001001011' },
  { run: 768, bits: '0000001001100' },
  { run: 832, bits: '0000001001101' },
  { run: 896, bits: '0000001110010' },
  { run: 960, bits: '0000001110011' },
  { run: 1024, bits: '0000001110100' },
  { run: 1088, bits: '0000001110101' },
  { run: 1152, bits: '0000001110110' },
  { run: 1216, bits: '0000001110111' },
  { run: 1280, bits: '0000001010010' },
  { run: 1344, bits: '0000001010011' },
  { run: 1408, bits: '0000001010100' },
  { run: 1472, bits: '0000001010101' },
  { run: 1536, bits: '0000001011010' },
  { run: 1600, bits: '0000001011011' },
  { run: 1664, bits: '0000001100100' },
  { run: 1728, bits: '0000001100101' },
]

const additionalMakeupCodes: readonly FaxCode[] = [
  { run: 1792, bits: '00000001000' },
  { run: 1856, bits: '00000001100' },
  { run: 1920, bits: '00000001101' },
  { run: 1984, bits: '000000010010' },
  { run: 2048, bits: '000000010011' },
  { run: 2112, bits: '000000010100' },
  { run: 2176, bits: '000000010101' },
  { run: 2240, bits: '000000010110' },
  { run: 2304, bits: '000000010111' },
  { run: 2368, bits: '000000011100' },
  { run: 2432, bits: '000000011101' },
  { run: 2496, bits: '000000011110' },
  { run: 2560, bits: '000000011111' },
]

const buildFaxCodeLookup = (
  terminatingCodes: readonly string[],
  makeupCodes: readonly FaxCode[],
): FaxCodeLookup => {
  const runs = new Int16Array(faxLookupSize)
  const lengths = new Uint8Array(faxLookupSize)
  const add = (run: number, bits: string): void => {
    const length = bits.length
    const prefix = Number.parseInt(bits, 2) << (faxLookupBits - length)
    const variants = 1 << (faxLookupBits - length)
    for (let suffix = 0; suffix < variants; suffix += 1) {
      const index = prefix | suffix
      if ((lengths[index] ?? 0) !== 0) throw new Error('Conflicting CCITT Huffman codes')
      runs[index] = run
      lengths[index] = length
    }
  }
  for (let run = 0; run < terminatingCodes.length; run += 1) {
    const bits = terminatingCodes[run]
    if (bits === undefined) throw new Error('Missing CCITT terminating code')
    add(run, bits)
  }
  for (const code of makeupCodes) add(code.run, code.bits)
  for (const code of additionalMakeupCodes) add(code.run, code.bits)
  return { runs, lengths }
}

const whiteFaxCodes = buildFaxCodeLookup(whiteTerminatingCodes, whiteMakeupCodes)
const blackFaxCodes = buildFaxCodeLookup(blackTerminatingCodes, blackMakeupCodes)

interface IfdEntry {
  readonly fieldType: number
  readonly count: number
  readonly inline: Uint8Array
}

interface TiffLayout {
  readonly bigTiff: boolean
  readonly countBytes: 2 | 8
  readonly entryBytes: 12 | 20
  readonly inlineBytes: 4 | 8
  readonly nextOffsetBytes: 4 | 8
}

interface TiffIfd {
  readonly offset: number
  readonly entries: ReadonlyMap<number, IfdEntry>
  readonly nextOffset: number
}

const classicTiffLayout: TiffLayout = {
  bigTiff: false,
  countBytes: 2,
  entryBytes: 12,
  inlineBytes: 4,
  nextOffsetBytes: 4,
}

const bigTiffLayout: TiffLayout = {
  bigTiff: true,
  countBytes: 8,
  entryBytes: 20,
  inlineBytes: 8,
  nextOffsetBytes: 8,
}

interface TiffDescription {
  readonly littleEndian: boolean
  readonly width: number
  readonly height: number
  readonly bitsPerSample: Uint32Array
  readonly sampleFormats: Uint32Array
  readonly bitsPerPixel: number
  readonly sampleBitOffsets: Uint32Array
  readonly rowBytes: Uint32Array
  readonly compression: number
  readonly lercAdditionalCompression: 0 | 1
  readonly group3TwoDimensional: boolean
  readonly photometric: number
  readonly fillOrder: number
  readonly samplesPerPixel: number
  readonly tiled: boolean
  readonly segmentWidth: number
  readonly segmentHeight: number
  readonly segmentsAcross: number
  readonly segmentsDown: number
  readonly segmentsPerPlane: number
  readonly segmentOffsets: Float64Array
  readonly segmentByteCounts: Float64Array
  readonly planarConfiguration: number
  readonly predictor: number
  readonly palette: Uint8Array | undefined
  readonly cmykDotRange: Uint32Array | undefined
  readonly ycbcr: YCbCrDescription | undefined
  readonly logLuvEncoding: LogLuvEncoding | undefined
  readonly alphaSample: number | undefined
  readonly associatedAlpha: boolean
  readonly orientation: number
  readonly frames: number
  readonly resolutionLevels: number
  readonly pixelFormat: PixelFormat | undefined
  readonly displayRanges: readonly PixelSampleDisplayRange[] | undefined
  readonly colorTransform: RgbIccTransform | undefined
  readonly cmykColorTransform: CmykIccTransform | undefined
  readonly cieLabSamples: 1 | 3 | undefined
  readonly iccProfile: Uint8Array | undefined
  readonly jpegTables: Uint8Array | undefined
  readonly jpegInterchange: Uint8Array | undefined
  readonly oldJpeg: OldJpegDescription | undefined
}

interface YCbCrDescription {
  readonly horizontalSubsampling: number
  readonly verticalSubsampling: number
  readonly lumaRed: number
  readonly lumaGreen: number
  readonly lumaBlue: number
  readonly referenceBlackWhite: Float64Array
}

interface OldJpegDescription {
  readonly quantizationTables: readonly Uint8Array[]
  readonly dcTables: readonly Uint8Array[]
  readonly acTables: readonly Uint8Array[]
  readonly restartInterval: number
  readonly horizontalSampling: Uint8Array
  readonly verticalSampling: Uint8Array
}

interface Region {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

const isTiff = (header: Uint8Array): boolean =>
  (header[0] === 0x49 &&
    header[1] === 0x49 &&
    ((header[2] === 0x2a && header[3] === 0) || (header[2] === 0x2b && header[3] === 0))) ||
  (header[0] === 0x4d &&
    header[1] === 0x4d &&
    ((header[2] === 0 && header[3] === 0x2a) || (header[2] === 0 && header[3] === 0x2b)))

const checkedEnd = (offset: number, length: number, size: number, label: string): number => {
  if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 0) {
    throw invalidInput(`TIFF ${label} extent is invalid`)
  }
  const end = offset + length
  if (!Number.isSafeInteger(end) || end > size) {
    throw truncatedInput(`TIFF ${label} exceeds the input`)
  }
  return end
}

const uint16 = (bytes: Uint8Array, offset: number, littleEndian: boolean): number => {
  if (offset < 0 || offset + 2 > bytes.byteLength) throw truncatedInput('TIFF SHORT is truncated')
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 2).getUint16(0, littleEndian)
}

const uint32 = (bytes: Uint8Array, offset: number, littleEndian: boolean): number => {
  if (offset < 0 || offset + 4 > bytes.byteLength) throw truncatedInput('TIFF LONG is truncated')
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0, littleEndian)
}

const uint64 = (
  bytes: Uint8Array,
  offset: number,
  littleEndian: boolean,
  label: string,
): number => {
  if (offset < 0 || offset + 8 > bytes.byteLength)
    throw truncatedInput(`TIFF ${label} is truncated`)
  const value = new DataView(bytes.buffer, bytes.byteOffset + offset, 8).getBigUint64(
    0,
    littleEndian,
  )
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw invalidInput(`TIFF ${label} exceeds the safe integer range`)
  }
  return Number(value)
}

const offsetValue = (
  bytes: Uint8Array,
  offset: number,
  littleEndian: boolean,
  layout: TiffLayout,
  label: string,
): number =>
  layout.bigTiff ? uint64(bytes, offset, littleEndian, label) : uint32(bytes, offset, littleEndian)

const readIfd = async (
  source: ImageSource,
  offset: number,
  littleEndian: boolean,
  layout: TiffLayout,
): Promise<TiffIfd> => {
  checkedEnd(offset, layout.countBytes, source.size, 'IFD header')
  const countBytes = await readExactly(source, offset, layout.countBytes)
  const entryCount = layout.bigTiff
    ? uint64(countBytes, 0, littleEndian, 'IFD entry count')
    : uint16(countBytes, 0, littleEndian)
  if (entryCount > 65_535) throw invalidInput(`TIFF IFD has too many entries: ${entryCount}`)
  const ifdBytes = layout.countBytes + entryCount * layout.entryBytes + layout.nextOffsetBytes
  checkedEnd(offset, ifdBytes, source.size, 'IFD')
  const bytes = await readExactly(source, offset, ifdBytes)
  const entries = new Map<number, IfdEntry>()

  for (let index = 0; index < entryCount; index += 1) {
    const entryOffset = layout.countBytes + index * layout.entryBytes
    const tag = uint16(bytes, entryOffset, littleEndian)
    const fieldType = uint16(bytes, entryOffset + 2, littleEndian)
    const count = layout.bigTiff
      ? uint64(bytes, entryOffset + 4, littleEndian, `tag ${tag} count`)
      : uint32(bytes, entryOffset + 4, littleEndian)
    const valuePosition = entryOffset + (layout.bigTiff ? 12 : 8)
    const inline = bytes.slice(valuePosition, valuePosition + layout.inlineBytes)
    if (tag === 0 && fieldType === 0 && count === 0 && inline.every((value) => value === 0))
      continue
    if (entries.has(tag)) throw invalidInput(`TIFF IFD contains duplicate tag ${tag}`)
    entries.set(tag, {
      fieldType,
      count,
      inline,
    })
  }

  const nextPosition = layout.countBytes + entryCount * layout.entryBytes
  return {
    offset,
    entries,
    nextOffset: offsetValue(bytes, nextPosition, littleEndian, layout, 'next IFD offset'),
  }
}
const externalValueOffset = (entry: IfdEntry, littleEndian: boolean, tag: number): number =>
  entry.inline.byteLength === 8
    ? uint64(entry.inline, 0, littleEndian, `tag ${tag} offset`)
    : uint32(entry.inline, 0, littleEndian)

const fieldBytes = (fieldType: number): number => {
  if (fieldType === 1) return 1
  if (fieldType === 3) return 2
  if (fieldType === 4 || fieldType === 13) return 4
  if (fieldType === 5 || fieldType === 16 || fieldType === 18) return 8
  throw invalidInput(`TIFF field type ${fieldType} is unsupported for this tag`)
}

const entryValues = async (
  source: ImageSource,
  entry: IfdEntry,
  littleEndian: boolean,
  tag: number,
  maximumCount: number,
): Promise<Float64Array> => {
  if (entry.count < 1 || entry.count > maximumCount) {
    throw invalidInput(`TIFF tag ${tag} has invalid count ${entry.count}`)
  }
  const bytesPerValue = fieldBytes(entry.fieldType)
  if (entry.fieldType === 5) throw invalidInput(`TIFF tag ${tag} must contain integer values`)
  const byteLength = entry.count * bytesPerValue
  if (!Number.isSafeInteger(byteLength)) throw invalidInput(`TIFF tag ${tag} is too large`)
  let bytes: Uint8Array
  if (byteLength <= entry.inline.byteLength) {
    bytes = entry.inline.subarray(0, byteLength)
  } else {
    const valueOffset = externalValueOffset(entry, littleEndian, tag)
    bytes = await readExactly(
      source,
      valueOffset,
      checkedEnd(valueOffset, byteLength, source.size, `tag ${tag}`) - valueOffset,
    )
  }
  const values = new Float64Array(entry.count)
  for (let index = 0; index < entry.count; index += 1) {
    const valueOffset = index * bytesPerValue
    values[index] =
      entry.fieldType === 1
        ? (bytes[valueOffset] ?? 0)
        : entry.fieldType === 3
          ? uint16(bytes, valueOffset, littleEndian)
          : entry.fieldType === 4 || entry.fieldType === 13
            ? uint32(bytes, valueOffset, littleEndian)
            : uint64(bytes, valueOffset, littleEndian, `tag ${tag} value`)
  }
  return values
}

const requiredValues = async (
  source: ImageSource,
  ifd: TiffIfd,
  littleEndian: boolean,
  tag: number,
  maximumCount: number,
): Promise<Float64Array> => {
  const entry = ifd.entries.get(tag)
  if (!entry) throw invalidInput(`TIFF required tag ${tag} is missing`)
  return entryValues(source, entry, littleEndian, tag, maximumCount)
}

const optionalValues = async (
  source: ImageSource,
  ifd: TiffIfd,
  littleEndian: boolean,
  tag: number,
  maximumCount: number,
): Promise<Float64Array | undefined> => {
  const entry = ifd.entries.get(tag)
  return entry ? entryValues(source, entry, littleEndian, tag, maximumCount) : undefined
}

const numericFieldBytes = (fieldType: number, tag: number): 1 | 2 | 4 | 8 => {
  if (fieldType === 1 || fieldType === 6) return 1
  if (fieldType === 3 || fieldType === 8) return 2
  if (fieldType === 4 || fieldType === 9 || fieldType === 11) return 4
  if (fieldType === 12 || fieldType === 16) return 8
  throw invalidInput(`TIFF tag ${tag} has unsupported numeric field type ${fieldType}`)
}

const numericOptionalValues = async (
  source: ImageSource,
  ifd: TiffIfd,
  littleEndian: boolean,
  tag: number,
  maximumCount: number,
): Promise<Float64Array | undefined> => {
  const entry = ifd.entries.get(tag)
  if (!entry) return undefined
  if (entry.count < 1 || entry.count > maximumCount) {
    throw invalidInput(`TIFF tag ${tag} has invalid count ${entry.count}`)
  }
  const bytesPerValue = numericFieldBytes(entry.fieldType, tag)
  const byteLength = entry.count * bytesPerValue
  let bytes: Uint8Array
  if (byteLength <= entry.inline.byteLength) {
    bytes = entry.inline.subarray(0, byteLength)
  } else {
    const valueOffset = externalValueOffset(entry, littleEndian, tag)
    bytes = await readExactly(
      source,
      valueOffset,
      checkedEnd(valueOffset, byteLength, source.size, `tag ${tag}`) - valueOffset,
    )
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const values = new Float64Array(entry.count)
  for (let index = 0; index < entry.count; index += 1) {
    const offset = index * bytesPerValue
    if (entry.fieldType === 1) values[index] = view.getUint8(offset)
    else if (entry.fieldType === 3) values[index] = view.getUint16(offset, littleEndian)
    else if (entry.fieldType === 4) values[index] = view.getUint32(offset, littleEndian)
    else if (entry.fieldType === 6) values[index] = view.getInt8(offset)
    else if (entry.fieldType === 8) values[index] = view.getInt16(offset, littleEndian)
    else if (entry.fieldType === 9) values[index] = view.getInt32(offset, littleEndian)
    else if (entry.fieldType === 11) values[index] = view.getFloat32(offset, littleEndian)
    else if (entry.fieldType === 12) values[index] = view.getFloat64(offset, littleEndian)
    else {
      const lowOffset = littleEndian ? offset : offset + 4
      const highOffset = littleEndian ? offset + 4 : offset
      values[index] =
        view.getUint32(highOffset, littleEndian) * 4_294_967_296 +
        view.getUint32(lowOffset, littleEndian)
    }
  }
  return values
}

const rationalValues = async (
  source: ImageSource,
  ifd: TiffIfd,
  littleEndian: boolean,
  tag: number,
  expectedCount: number,
): Promise<Float64Array | undefined> => {
  const entry = ifd.entries.get(tag)
  if (!entry) return undefined
  if (entry.fieldType !== 5) throw invalidInput(`TIFF tag ${tag} must use the RATIONAL field type`)
  if (entry.count !== expectedCount) {
    throw invalidInput(`TIFF tag ${tag} must contain ${expectedCount} values`)
  }
  const byteLength = entry.count * 8
  let bytes: Uint8Array
  if (byteLength <= entry.inline.byteLength) {
    bytes = entry.inline.subarray(0, byteLength)
  } else {
    const valueOffset = externalValueOffset(entry, littleEndian, tag)
    bytes = await readExactly(
      source,
      valueOffset,
      checkedEnd(valueOffset, byteLength, source.size, `tag ${tag}`) - valueOffset,
    )
  }
  const values = new Float64Array(entry.count)
  for (let index = 0; index < entry.count; index += 1) {
    const numerator = uint32(bytes, index * 8, littleEndian)
    const denominator = uint32(bytes, index * 8 + 4, littleEndian)
    if (denominator === 0) throw invalidInput(`TIFF tag ${tag} has a zero denominator`)
    values[index] = numerator / denominator
  }
  return values
}

const undefinedEntryBytes = async (
  source: ImageSource,
  entry: IfdEntry,
  littleEndian: boolean,
  tag: number,
): Promise<Uint8Array> => {
  if (entry.fieldType !== 7) throw invalidInput(`TIFF tag ${tag} must use the UNDEFINED field type`)
  if (entry.count < 1) throw invalidInput(`TIFF tag ${tag} is empty`)
  if (entry.count > MAX_ICC_PROFILE_BYTES) {
    throw limitExceeded(`TIFF tag ${tag} exceeds 16 MiB`)
  }
  if (entry.count <= entry.inline.byteLength) return entry.inline.subarray(0, entry.count)
  const valueOffset = externalValueOffset(entry, littleEndian, tag)
  return readExactly(
    source,
    valueOffset,
    checkedEnd(valueOffset, entry.count, source.size, `tag ${tag}`) - valueOffset,
  )
}

const singleValue = async (
  source: ImageSource,
  ifd: TiffIfd,
  littleEndian: boolean,
  tag: number,
  fallback?: number,
): Promise<number> => {
  const values = await optionalValues(source, ifd, littleEndian, tag, 1)
  const value = values?.[0] ?? fallback
  if (value === undefined) throw invalidInput(`TIFF required tag ${tag} is missing`)
  return value
}

interface TiffIfdGraph {
  readonly littleEndian: boolean
  readonly layout: TiffLayout
  readonly topLevel: readonly TiffIfd[]
  readonly directories: ReadonlyMap<number, TiffIfd>
  readonly descendants: ReadonlyMap<number, readonly TiffIfd[]>
}

interface SelectedTiffIfd {
  readonly ifd: TiffIfd
  readonly frames: number
  readonly resolutionLevels: number
}

const subIfdOffsets = async (
  source: ImageSource,
  ifd: TiffIfd,
  littleEndian: boolean,
  maximumCount: number,
): Promise<Float64Array> => {
  const entry = ifd.entries.get(330)
  if (!entry) return new Float64Array()
  if (
    entry.fieldType !== 4 &&
    entry.fieldType !== 13 &&
    entry.fieldType !== 16 &&
    entry.fieldType !== 18
  ) {
    throw invalidInput('TIFF SubIFDs must contain IFD offsets')
  }
  return entryValues(source, entry, littleEndian, 330, maximumCount)
}

const readTiffIfdGraph = async (
  source: ImageSource,
  limits: ImageLimits,
): Promise<TiffIfdGraph> => {
  if (source.size < 8) throw truncatedInput('TIFF header is truncated')
  const header = await readExactly(source, 0, Math.min(source.size, 16))
  if (!isTiff(header)) throw invalidInput('TIFF byte order or version is invalid')
  const littleEndian = header[0] === 0x49
  const version = uint16(header, 2, littleEndian)
  const layout = version === 43 ? bigTiffLayout : classicTiffLayout
  if (layout.bigTiff) {
    if (header.byteLength < 16) throw truncatedInput('BigTIFF header is truncated')
    if (uint16(header, 4, littleEndian) !== 8 || uint16(header, 6, littleEndian) !== 0) {
      throw invalidInput('BigTIFF offset size or reserved field is invalid')
    }
  }
  const minimumIfdOffset = layout.bigTiff ? 16 : 8
  const firstIfdOffset = layout.bigTiff
    ? uint64(header, 8, littleEndian, 'first IFD offset')
    : uint32(header, 4, littleEndian)
  if (firstIfdOffset < minimumIfdOffset) throw invalidInput('TIFF first IFD offset is invalid')

  const topLevel: TiffIfd[] = []
  const directories = new Map<number, TiffIfd>()
  const topLevelOffsets = new Set<number>()
  let nextOffset = firstIfdOffset
  while (nextOffset !== 0) {
    if (nextOffset < minimumIfdOffset) throw invalidInput('TIFF IFD offset is invalid')
    if (topLevelOffsets.has(nextOffset)) {
      throw invalidInput('TIFF top-level IFD chain contains a loop')
    }
    if (directories.size >= limits.maxFrames) {
      throw limitExceeded(`TIFF image directory count exceeds maxFrames ${limits.maxFrames}`)
    }
    const ifd = await readIfd(source, nextOffset, littleEndian, layout)
    directories.set(nextOffset, ifd)
    topLevelOffsets.add(nextOffset)
    topLevel.push(ifd)
    nextOffset = ifd.nextOffset
  }

  const descendants = new Map<number, readonly TiffIfd[]>()
  for (const root of topLevel) {
    const levels: TiffIfd[] = []
    const active = new Set<number>([root.offset])
    const reachable = new Set<number>()
    const visit = async (offset: number): Promise<void> => {
      if (offset < minimumIfdOffset) throw invalidInput('TIFF SubIFD offset is invalid')
      if (active.has(offset)) throw invalidInput('TIFF SubIFD graph contains a loop')
      if (reachable.has(offset)) return
      let ifd = directories.get(offset)
      if (!ifd) {
        if (directories.size >= limits.maxFrames) {
          throw limitExceeded(`TIFF image directory count exceeds maxFrames ${limits.maxFrames}`)
        }
        ifd = await readIfd(source, offset, littleEndian, layout)
        directories.set(offset, ifd)
      }
      active.add(offset)
      reachable.add(offset)
      levels.push(ifd)
      const childOffsets = await subIfdOffsets(source, ifd, littleEndian, limits.maxFrames)
      for (const childOffset of childOffsets) await visit(childOffset)
      if (ifd.nextOffset !== 0) await visit(ifd.nextOffset)
      active.delete(offset)
    }
    const offsets = await subIfdOffsets(source, root, littleEndian, limits.maxFrames)
    for (const offset of offsets) await visit(offset)
    descendants.set(root.offset, levels)
  }
  return { littleEndian, layout, topLevel, directories, descendants }
}

const selectTiffIfd = async (
  source: ImageSource,
  graph: TiffIfdGraph,
  options: Readonly<DecoderOptions>,
): Promise<SelectedTiffIfd> => {
  const frame = options.frame ?? 0
  const resolutionLevel = options.resolutionLevel ?? 0
  if (!Number.isSafeInteger(frame) || frame < 0) {
    throw invalidInput('TIFF frame must be a non-negative safe integer')
  }
  if (!Number.isSafeInteger(resolutionLevel) || resolutionLevel < 0) {
    throw invalidInput('TIFF resolutionLevel must be a non-negative safe integer')
  }
  const root = graph.topLevel[frame]
  if (!root) {
    throw invalidInput(`TIFF frame ${frame} is outside the ${graph.topLevel.length}-frame image`)
  }
  const rootWidth = await singleValue(source, root, graph.littleEndian, 256)
  const rootHeight = await singleValue(source, root, graph.littleEndian, 257)
  const reduced: { readonly ifd: TiffIfd; readonly pixels: bigint }[] = []
  for (const candidate of graph.descendants.get(root.offset) ?? []) {
    const width = await singleValue(source, candidate, graph.littleEndian, 256)
    const height = await singleValue(source, candidate, graph.littleEndian, 257)
    const newSubfileType = await singleValue(source, candidate, graph.littleEndian, 254, 0)
    const isMask = (newSubfileType & 4) !== 0
    const isReduced =
      (newSubfileType & 1) !== 0 ||
      (width <= rootWidth && height <= rootHeight && (width < rootWidth || height < rootHeight))
    if (!isMask && isReduced) {
      reduced.push({ ifd: candidate, pixels: BigInt(width) * BigInt(height) })
    }
  }
  reduced.sort((left, right) =>
    left.pixels === right.pixels ? 0 : left.pixels > right.pixels ? -1 : 1,
  )
  const levels = [root, ...reduced.map((level) => level.ifd)]
  const ifd = levels[resolutionLevel]
  if (!ifd) {
    throw invalidInput(
      `TIFF resolutionLevel ${resolutionLevel} is outside the ${levels.length}-level frame ${frame}`,
    )
  }
  return {
    ifd,
    frames: graph.topLevel.length,
    resolutionLevels: levels.length,
  }
}

const paletteFor = async (
  source: ImageSource,
  ifd: TiffIfd,
  littleEndian: boolean,
  bitDepth: number,
): Promise<Uint8Array> => {
  const colors = 2 ** bitDepth
  const values = await requiredValues(source, ifd, littleEndian, 320, colors * 3)
  if (values.length !== colors * 3) {
    throw invalidInput(`TIFF color map must contain ${colors * 3} entries`)
  }
  const palette = new Uint8Array(colors * 3)
  for (let index = 0; index < colors; index += 1) {
    palette[index * 3] = Math.floor(((values[index] ?? 0) * 255) / 65_535)
    palette[index * 3 + 1] = Math.floor(((values[colors + index] ?? 0) * 255) / 65_535)
    palette[index * 3 + 2] = Math.floor(((values[colors * 2 + index] ?? 0) * 255) / 65_535)
  }
  return palette
}

const oldJpegFixedTables = async (
  source: ImageSource,
  offsets: Float64Array,
  bytesPerTable: number,
  label: string,
): Promise<readonly Uint8Array[]> => {
  const tables: Uint8Array[] = []
  for (let index = 0; index < offsets.length; index += 1) {
    const offset = offsets[index]
    if (offset === undefined) throw invalidInput(`TIFF ${label} table offset is missing`)
    checkedEnd(offset, bytesPerTable, source.size, `${label} table ${index}`)
    tables.push((await readExactly(source, offset, bytesPerTable)).slice())
  }
  return tables
}

const oldJpegHuffmanTables = async (
  source: ImageSource,
  offsets: Float64Array,
  label: string,
): Promise<readonly Uint8Array[]> => {
  const tables: Uint8Array[] = []
  for (let index = 0; index < offsets.length; index += 1) {
    const offset = offsets[index]
    if (offset === undefined) throw invalidInput(`TIFF ${label} table offset is missing`)
    checkedEnd(offset, 16, source.size, `${label} table ${index}`)
    const counts = await readExactly(source, offset, 16)
    let values = 0
    for (const count of counts) values += count
    if (values < 1 || values > 256) throw invalidInput(`TIFF ${label} table ${index} is invalid`)
    const byteLength = 16 + values
    checkedEnd(offset, byteLength, source.size, `${label} table ${index}`)
    tables.push((await readExactly(source, offset, byteLength)).slice())
  }
  return tables
}

const describeOldJpeg = async (
  source: ImageSource,
  ifd: TiffIfd,
  littleEndian: boolean,
  samplesPerPixel: number,
  photometric: number,
): Promise<OldJpegDescription | undefined> => {
  const quantizationOffsets = await optionalValues(source, ifd, littleEndian, 519, samplesPerPixel)
  const dcOffsets = await optionalValues(source, ifd, littleEndian, 520, samplesPerPixel)
  const acOffsets = await optionalValues(source, ifd, littleEndian, 521, samplesPerPixel)
  if (!quantizationOffsets && !dcOffsets && !acOffsets) return undefined
  if (
    quantizationOffsets?.length !== samplesPerPixel ||
    dcOffsets?.length !== samplesPerPixel ||
    acOffsets?.length !== samplesPerPixel
  ) {
    throw invalidInput('TIFF old-style JPEG requires Q, DC, and AC tables for every component')
  }
  const process = await singleValue(source, ifd, littleEndian, 512)
  if (process !== 1) {
    throw unsupportedOperation(`TIFF old-style JPEG process ${process} is unsupported`)
  }
  const restartInterval = await singleValue(source, ifd, littleEndian, 515, 0)
  if (!Number.isSafeInteger(restartInterval) || restartInterval < 0 || restartInterval > 65_535) {
    throw invalidInput('TIFF JPEGRestartInterval is invalid')
  }
  const horizontalSampling = new Uint8Array(samplesPerPixel).fill(1)
  const verticalSampling = new Uint8Array(samplesPerPixel).fill(1)
  if (photometric === photometricYCbCr) {
    const subsampling =
      (await optionalValues(source, ifd, littleEndian, 530, 2)) ?? Float64Array.of(2, 2)
    if (
      subsampling.length !== 2 ||
      ![1, 2, 4].includes(subsampling[0] ?? 0) ||
      ![1, 2, 4].includes(subsampling[1] ?? 0)
    ) {
      throw unsupportedOperation('TIFF old-style JPEG subsampling factors are unsupported')
    }
    horizontalSampling[0] = subsampling[0] ?? 1
    verticalSampling[0] = subsampling[1] ?? 1
  }
  return {
    quantizationTables: await oldJpegFixedTables(source, quantizationOffsets, 64, 'JPEGQTables'),
    dcTables: await oldJpegHuffmanTables(source, dcOffsets, 'JPEGDCTables'),
    acTables: await oldJpegHuffmanTables(source, acOffsets, 'JPEGACTables'),
    restartInterval,
    horizontalSampling,
    verticalSampling,
  }
}

type TiffDescriptionMode = 'pixels' | 'raster'

const describeTiffIfd = async (
  source: ImageSource,
  limits: ImageLimits,
  graph: TiffIfdGraph,
  selected: SelectedTiffIfd,
  options: Readonly<DecoderOptions>,
  mode: TiffDescriptionMode,
): Promise<TiffDescription> => {
  const { ifd, frames, resolutionLevels } = selected
  const { littleEndian } = graph
  const width = await singleValue(source, ifd, littleEndian, 256)
  const height = await singleValue(source, ifd, littleEndian, 257)
  validateImageDimensions(width, height, 1, limits)

  const samplesPerPixel = await singleValue(source, ifd, littleEndian, 277, 1)
  const maximumSamples = mode === 'raster' ? 65_535 : 5
  if (
    !Number.isSafeInteger(samplesPerPixel) ||
    samplesPerPixel < 1 ||
    samplesPerPixel > maximumSamples
  ) {
    throw unsupportedOperation(`TIFF SamplesPerPixel ${samplesPerPixel} is unsupported`)
  }
  const rawBits =
    (await optionalValues(source, ifd, littleEndian, 258, samplesPerPixel)) ?? Float64Array.of(1)
  if (rawBits.some((bits) => !Number.isSafeInteger(bits) || bits < 1 || bits > 64)) {
    throw invalidInput('TIFF BitsPerSample contains an invalid value')
  }
  const bitsPerSample =
    rawBits.length === 1 && samplesPerPixel > 1
      ? new Uint32Array(samplesPerPixel).fill(rawBits[0] ?? 1)
      : Uint32Array.from(rawBits)
  if (bitsPerSample.length !== samplesPerPixel) {
    throw invalidInput('TIFF BitsPerSample count does not match SamplesPerPixel')
  }

  const rawSampleFormats =
    (await optionalValues(source, ifd, littleEndian, 339, samplesPerPixel)) ??
    Float64Array.of(sampleFormatUnsigned)
  if (
    rawSampleFormats.some(
      (format) =>
        !Number.isSafeInteger(format) ||
        (format !== sampleFormatUnsigned &&
          format !== sampleFormatSigned &&
          format !== sampleFormatFloat),
    )
  ) {
    throw unsupportedOperation('TIFF SampleFormat contains an unsupported value')
  }
  const sampleFormats =
    rawSampleFormats.length === 1 && samplesPerPixel > 1
      ? new Uint32Array(samplesPerPixel).fill(rawSampleFormats[0] ?? sampleFormatUnsigned)
      : Uint32Array.from(rawSampleFormats)
  if (sampleFormats.length !== samplesPerPixel) {
    throw invalidInput('TIFF SampleFormat count does not match SamplesPerPixel')
  }
  const baseSampleFormat = sampleFormats[0] ?? sampleFormatUnsigned
  if (sampleFormats.some((format) => format !== baseSampleFormat)) {
    throw unsupportedOperation('TIFF mixed sample formats are unsupported')
  }

  const compression = await singleValue(source, ifd, littleEndian, 259, compressionNone)
  const rawLercParameters =
    compression === compressionLerc
      ? await optionalValues(source, ifd, littleEndian, 50674, 2)
      : undefined
  if (
    compression === compressionLerc &&
    (rawLercParameters === undefined ||
      rawLercParameters.length !== 2 ||
      !Number.isSafeInteger(rawLercParameters[0]) ||
      (rawLercParameters[0] ?? 0) < 2 ||
      (rawLercParameters[0] ?? 0) > 6)
  ) {
    throw invalidInput('TIFF LercParameters must declare a supported LERC2 version')
  }
  const rawLercAdditionalCompression = rawLercParameters?.[1] ?? 0
  if (!Number.isSafeInteger(rawLercAdditionalCompression) || rawLercAdditionalCompression < 0) {
    throw invalidInput('TIFF LERC additional compression is invalid')
  }
  if (rawLercAdditionalCompression === 2) {
    throw unsupportedOperation('TIFF LERC plus Zstandard compression is unsupported')
  }
  if (rawLercAdditionalCompression > 2) {
    throw invalidInput('TIFF LERC additional compression is invalid')
  }
  const lercAdditionalCompression: 0 | 1 = rawLercAdditionalCompression === 1 ? 1 : 0
  if (
    compression !== compressionNone &&
    compression !== compressionCcittModifiedHuffman &&
    compression !== compressionCcittGroup3 &&
    compression !== compressionCcittGroup4 &&
    compression !== compressionLzw &&
    compression !== compressionOldJpeg &&
    compression !== compressionJpeg &&
    compression !== compressionDeflate &&
    compression !== compressionAdobeDeflate &&
    compression !== compressionPackBits &&
    compression !== compressionSgiLog &&
    compression !== compressionSgiLog24 &&
    compression !== compressionZstandard &&
    compression !== compressionLerc &&
    compression !== compressionWebp &&
    compression !== compressionAperioJpeg2000Ycbcr &&
    compression !== compressionAperioJpeg2000Mct
  ) {
    throw unsupportedOperation(`TIFF compression ${compression} is unsupported`)
  }
  const byteRasterCompression =
    compression === compressionNone ||
    compression === compressionLzw ||
    compression === compressionDeflate ||
    compression === compressionAdobeDeflate ||
    compression === compressionZstandard ||
    compression === compressionPackBits ||
    compression === compressionLerc
  if (mode === 'raster' && !byteRasterCompression) {
    throw unsupportedOperation(
      'TIFF raster decoding supports uncompressed, PackBits, LZW, Deflate, Zstandard, and LERC segments',
    )
  }
  const photometric = await singleValue(source, ifd, littleEndian, 262)
  if (
    mode === 'pixels' &&
    photometric !== photometricWhiteIsZero &&
    photometric !== photometricBlackIsZero &&
    photometric !== photometricRgb &&
    photometric !== photometricPalette &&
    photometric !== photometricSeparated &&
    photometric !== photometricYCbCr &&
    photometric !== photometricCieLab &&
    photometric !== photometricLogL &&
    photometric !== photometricLogLuv
  ) {
    throw unsupportedOperation(`TIFF photometric interpretation ${photometric} is unsupported`)
  }
  const baseSamples =
    mode === 'raster'
      ? samplesPerPixel
      : photometric === photometricCieLab
        ? samplesPerPixel <= 2
          ? 1
          : 3
        : photometric === photometricRgb ||
            photometric === photometricYCbCr ||
            photometric === photometricLogLuv
          ? 3
          : photometric === photometricSeparated
            ? 4
            : 1
  if (mode === 'pixels' && (samplesPerPixel < baseSamples || samplesPerPixel > baseSamples + 1)) {
    throw unsupportedOperation('TIFF supports at most one alpha sample')
  }
  const alphaSample =
    mode === 'pixels' && samplesPerPixel === baseSamples + 1 ? baseSamples : undefined
  const extraSamples =
    mode === 'pixels'
      ? ((await optionalValues(source, ifd, littleEndian, 338, samplesPerPixel - baseSamples)) ??
        new Uint32Array())
      : new Uint32Array()
  if (
    mode === 'pixels' &&
    (extraSamples.length > 1 ||
      extraSamples.some((value) => value !== 0 && value !== 1 && value !== 2))
  ) {
    throw unsupportedOperation('TIFF extra sample metadata is unsupported')
  }
  if (mode === 'pixels' && extraSamples.length > 0 && alphaSample === undefined) {
    throw invalidInput('TIFF ExtraSamples does not match SamplesPerPixel')
  }
  if (mode === 'pixels' && baseSampleFormat !== sampleFormatUnsigned && alphaSample !== undefined) {
    throw unsupportedOperation('TIFF signed or floating-point alpha samples are unsupported')
  }
  if (mode === 'pixels' && photometric === photometricCieLab && extraSamples[0] === 1) {
    throw unsupportedOperation('TIFF CIELab associated alpha is unsupported')
  }
  if (mode === 'pixels' && photometric === photometricCieLab && !byteRasterCompression) {
    throw unsupportedOperation(
      'TIFF CIELab decoding supports uncompressed, PackBits, LZW, and Deflate segments',
    )
  }
  const logLuvPhotometric = photometric === photometricLogL || photometric === photometricLogLuv
  if (
    mode === 'pixels' &&
    baseSampleFormat !== sampleFormatUnsigned &&
    !logLuvPhotometric &&
    photometric !== photometricWhiteIsZero &&
    photometric !== photometricBlackIsZero &&
    photometric !== photometricRgb &&
    photometric !== photometricSeparated
  ) {
    throw unsupportedOperation(
      'TIFF signed or floating-point decoding supports only grayscale, RGB, CMYK, and LogLuv photometrics',
    )
  }

  const baseBitDepth = bitsPerSample[0] ?? 0
  const uniformBitDepth = bitsPerSample.every((bits) => bits === baseBitDepth)
  if (!uniformBitDepth) {
    throw unsupportedOperation('TIFF decoding requires uniform sample depths')
  }
  const logLuvEncoding: LogLuvEncoding | undefined =
    mode === 'raster'
      ? undefined
      : photometric === photometricLogL
        ? 'logl16'
        : photometric === photometricLogLuv
          ? compression === compressionSgiLog24
            ? 'logluv24'
            : 'logluv32'
          : undefined
  if (logLuvEncoding) {
    const validCompression =
      compression === compressionSgiLog ||
      (compression === compressionSgiLog24 && photometric === photometricLogLuv)
    if (
      !validCompression ||
      baseSampleFormat !== sampleFormatSigned ||
      baseBitDepth !== 16 ||
      samplesPerPixel !== baseSamples ||
      alphaSample !== undefined
    ) {
      throw unsupportedOperation(
        'TIFF LogLuv decoding requires signed 16-bit LogL or chunky three-sample LogLuv data with SGILog compression',
      )
    }
  } else if (compression === compressionSgiLog || compression === compressionSgiLog24) {
    throw unsupportedOperation('TIFF SGILog compression requires LogL or LogLuv photometric data')
  }
  if (mode === 'raster') {
    const validRasterDepth =
      baseSampleFormat === sampleFormatUnsigned
        ? [8, 16, 32, 64].includes(baseBitDepth)
        : baseSampleFormat === sampleFormatSigned
          ? [8, 16, 32].includes(baseBitDepth)
          : [16, 32, 64].includes(baseBitDepth)
    if (!validRasterDepth) {
      throw unsupportedOperation(
        `TIFF raster decoding does not support SampleFormat ${baseSampleFormat} with ${baseBitDepth}-bit samples`,
      )
    }
  } else if (logLuvEncoding) {
    // SGILog defines its own signed logarithmic sample representation.
  } else if (baseSampleFormat === sampleFormatUnsigned) {
    if (photometric === photometricRgb || photometric === photometricSeparated) {
      const supportedColorDepth =
        photometric === photometricRgb
          ? [2, 4, 8, 10, 12, 14, 16, 24, 32, 64].includes(baseBitDepth)
          : baseBitDepth === 8 || baseBitDepth === 16
      if (!supportedColorDepth) {
        throw unsupportedOperation('TIFF color decoding requires supported unsigned sample depths')
      }
    } else if (photometric === photometricYCbCr) {
      if (baseBitDepth !== 8) {
        throw unsupportedOperation('TIFF YCbCr decoding requires 8-bit samples')
      }
    } else if (photometric === photometricCieLab) {
      if (baseBitDepth !== 8) {
        throw unsupportedOperation('TIFF CIELab decoding requires unsigned 8-bit samples')
      }
    } else if (photometric === photometricPalette) {
      if (![1, 2, 4, 8, 16].includes(baseBitDepth)) {
        throw unsupportedOperation(`TIFF ${baseBitDepth}-bit palette data is unsupported`)
      }
    } else if (![1, 2, 4, 6, 8, 10, 12, 14, 16, 24, 32, 64].includes(baseBitDepth)) {
      throw unsupportedOperation(`TIFF ${baseBitDepth}-bit grayscale data is unsupported`)
    }
  } else if (baseSampleFormat === sampleFormatSigned) {
    if (baseBitDepth !== 8 && baseBitDepth !== 16) {
      throw unsupportedOperation(
        'TIFF signed integer decoding supports only 8-bit and 16-bit samples',
      )
    }
  } else if (![16, 32, 64].includes(baseBitDepth)) {
    throw unsupportedOperation(
      'TIFF floating-point decoding supports only 16-bit, 32-bit, and 64-bit samples',
    )
  }
  if (
    mode === 'pixels' &&
    alphaSample !== undefined &&
    bitsPerSample[alphaSample] !== 8 &&
    bitsPerSample[alphaSample] !== 16
  ) {
    throw unsupportedOperation('TIFF alpha decoding requires an 8-bit or 16-bit alpha sample')
  }

  const fillOrder = await singleValue(source, ifd, littleEndian, 266, 1)
  const faxCompression =
    compression === compressionCcittModifiedHuffman ||
    compression === compressionCcittGroup3 ||
    compression === compressionCcittGroup4
  if (fillOrder !== 1 && !(fillOrder === 2 && (faxCompression || byteRasterCompression))) {
    throw unsupportedOperation(`TIFF FillOrder ${fillOrder} is unsupported`)
  }
  const planarConfiguration = await singleValue(source, ifd, littleEndian, 284, 1)
  if (planarConfiguration !== 1 && planarConfiguration !== 2) {
    throw unsupportedOperation(`TIFF PlanarConfiguration ${planarConfiguration} is unsupported`)
  }
  if (logLuvEncoding && planarConfiguration !== 1) {
    throw unsupportedOperation('TIFF LogLuv decoding requires chunky planar configuration')
  }
  if (planarConfiguration === 1 && alphaSample !== undefined && baseBitDepth < 8) {
    throw unsupportedOperation('TIFF packed grayscale or palette alpha requires planar storage')
  }
  const predictor = await singleValue(source, ifd, littleEndian, 317, 1)
  if (predictor !== 1 && predictor !== 2 && predictor !== 3) {
    throw unsupportedOperation(`TIFF Predictor ${predictor} is unsupported`)
  }
  if (logLuvEncoding && predictor !== 1) {
    throw unsupportedOperation('TIFF LogLuv decoding does not use TIFF predictors')
  }
  if (compression === compressionLerc && (fillOrder !== 1 || predictor !== 1)) {
    throw unsupportedOperation('TIFF LERC compression requires FillOrder 1 and no TIFF predictor')
  }
  const supportedHorizontalDepth =
    baseSampleFormat === sampleFormatUnsigned
      ? [2, 4, 6, 8, 10, 12, 14, 16, 24, 32, 64].includes(baseBitDepth)
      : baseSampleFormat === sampleFormatSigned
        ? mode === 'raster'
          ? [8, 16, 32].includes(baseBitDepth)
          : baseBitDepth === 8 || baseBitDepth === 16
        : baseBitDepth === 16 || baseBitDepth === 32 || baseBitDepth === 64
  if (predictor === 2 && !supportedHorizontalDepth) {
    throw unsupportedOperation('TIFF horizontal prediction is unsupported for this sample layout')
  }
  if (
    predictor === 3 &&
    (baseSampleFormat !== sampleFormatFloat || ![16, 32, 64].includes(baseBitDepth))
  ) {
    throw unsupportedOperation(
      'TIFF floating-point prediction requires 16-bit, 32-bit, or 64-bit floating samples',
    )
  }
  if (compression === compressionLerc) {
    const supportedLercSamples =
      (baseSampleFormat === sampleFormatUnsigned &&
        (baseBitDepth === 8 || baseBitDepth === 16 || baseBitDepth === 32)) ||
      (baseSampleFormat === sampleFormatSigned &&
        (baseBitDepth === 8 || baseBitDepth === 16 || baseBitDepth === 32)) ||
      (baseSampleFormat === sampleFormatFloat && (baseBitDepth === 32 || baseBitDepth === 64))
    if (!supportedLercSamples) {
      throw unsupportedOperation('TIFF LERC compression does not support this sample type')
    }
  }

  const wideUnsigned =
    baseSampleFormat === sampleFormatUnsigned && (baseBitDepth === 24 || baseBitDepth > 16)
  const rawMinimums =
    mode === 'raster' ||
    logLuvEncoding ||
    (baseSampleFormat === sampleFormatUnsigned && !wideUnsigned)
      ? undefined
      : await numericOptionalValues(source, ifd, littleEndian, 340, samplesPerPixel)
  const rawMaximums =
    mode === 'raster' ||
    logLuvEncoding ||
    (baseSampleFormat === sampleFormatUnsigned && !wideUnsigned)
      ? undefined
      : await numericOptionalValues(source, ifd, littleEndian, 341, samplesPerPixel)
  if (
    (rawMinimums !== undefined &&
      rawMinimums.length !== 1 &&
      rawMinimums.length !== samplesPerPixel) ||
    (rawMaximums !== undefined &&
      rawMaximums.length !== 1 &&
      rawMaximums.length !== samplesPerPixel)
  ) {
    throw invalidInput('TIFF SMinSampleValue and SMaxSampleValue counts are invalid')
  }
  let displayRanges: readonly PixelSampleDisplayRange[] | undefined
  if (
    mode === 'pixels' &&
    !logLuvEncoding &&
    (baseSampleFormat !== sampleFormatUnsigned || wideUnsigned)
  ) {
    const defaultMinimum =
      baseSampleFormat === sampleFormatFloat
        ? 0
        : baseSampleFormat === sampleFormatUnsigned
          ? 0
          : baseBitDepth === 8
            ? -128
            : -32_768
    const defaultMaximum =
      baseSampleFormat === sampleFormatFloat
        ? 1
        : baseSampleFormat === sampleFormatUnsigned
          ? 2 ** baseBitDepth - 1
          : baseBitDepth === 8
            ? 127
            : 32_767
    const ranges: PixelSampleDisplayRange[] = []
    for (let sample = 0; sample < baseSamples; sample += 1) {
      const minimum = rawMinimums?.[rawMinimums.length === 1 ? 0 : sample] ?? defaultMinimum
      const maximum = rawMaximums?.[rawMaximums.length === 1 ? 0 : sample] ?? defaultMaximum
      if (!Number.isFinite(minimum) || !Number.isFinite(maximum) || minimum >= maximum) {
        throw invalidInput('TIFF numeric sample display range is invalid')
      }
      ranges.push(
        photometric === photometricWhiteIsZero
          ? Object.freeze({ black: maximum, white: minimum })
          : Object.freeze({ black: minimum, white: maximum }),
      )
    }
    displayRanges = Object.freeze(ranges)
  }
  if (
    faxCompression &&
    (baseSampleFormat !== sampleFormatUnsigned ||
      samplesPerPixel !== 1 ||
      baseBitDepth !== 1 ||
      predictor !== 1)
  ) {
    throw unsupportedOperation('TIFF CCITT fax decoding requires one 1-bit bilevel sample')
  }
  if (
    compression === compressionWebp &&
    (baseSampleFormat !== sampleFormatUnsigned ||
      photometric !== photometricRgb ||
      (samplesPerPixel !== 3 && samplesPerPixel !== 4) ||
      bitsPerSample.some((bits) => bits !== 8) ||
      predictor !== 1 ||
      planarConfiguration !== 1 ||
      (alphaSample !== undefined && extraSamples[0] !== 2))
  ) {
    throw unsupportedOperation(
      'TIFF WebP decoding requires chunky 8-bit RGB or unassociated RGBA samples',
    )
  }
  const jpeg2000Compression =
    compression === compressionAperioJpeg2000Ycbcr || compression === compressionAperioJpeg2000Mct
  if (
    jpeg2000Compression &&
    (baseSampleFormat !== sampleFormatUnsigned ||
      samplesPerPixel !== 3 ||
      (photometric !== photometricRgb && photometric !== photometricYCbCr) ||
      bitsPerSample.some((bits) => bits !== 8) ||
      predictor !== 1 ||
      planarConfiguration !== 1 ||
      alphaSample !== undefined)
  ) {
    throw unsupportedOperation(
      'Aperio JPEG 2000 TIFF decoding requires chunky unsigned 8-bit RGB or YCbCr samples',
    )
  }
  const jpegCompression =
    compression === compressionOldJpeg || compression === compressionJpeg || jpeg2000Compression
  const jpegSamplesMatchPhotometric =
    (samplesPerPixel === 1 && photometric === photometricBlackIsZero) ||
    (samplesPerPixel === 3 &&
      (photometric === photometricRgb || photometric === photometricYCbCr)) ||
    (samplesPerPixel === 4 && photometric === photometricSeparated)
  if (
    jpegCompression &&
    (baseSampleFormat !== sampleFormatUnsigned ||
      !jpegSamplesMatchPhotometric ||
      bitsPerSample.some((bits) => bits !== 8) ||
      predictor !== 1 ||
      planarConfiguration !== 1)
  ) {
    throw unsupportedOperation(
      'TIFF JPEG decoding requires chunky 8-bit grayscale, RGB, YCbCr, or CMYK samples',
    )
  }
  const oldJpeg =
    compression === compressionOldJpeg
      ? await describeOldJpeg(source, ifd, littleEndian, samplesPerPixel, photometric)
      : undefined
  const jpegInterchangeOffset = await optionalValues(source, ifd, littleEndian, 513, 1)
  const jpegInterchangeLength = await optionalValues(source, ifd, littleEndian, 514, 1)
  if ((jpegInterchangeOffset === undefined) !== (jpegInterchangeLength === undefined)) {
    throw invalidInput('TIFF JPEGInterchangeFormat and length must be provided together')
  }
  const interchangeOffset = jpegInterchangeOffset?.[0]
  const interchangeLength = jpegInterchangeLength?.[0]
  let group3TwoDimensional = false
  if (compression === compressionCcittGroup3) {
    const t4Options = await singleValue(source, ifd, littleEndian, 292, 0)
    if ((t4Options & ~7) !== 0) {
      throw unsupportedOperation(`TIFF T4Options ${t4Options} contains unsupported flags`)
    }
    group3TwoDimensional = (t4Options & 1) !== 0
  }
  if (compression === compressionCcittGroup4) {
    const t6Options = await singleValue(source, ifd, littleEndian, 293, 0)
    if ((t6Options & ~2) !== 0) {
      throw unsupportedOperation(`TIFF T6Options ${t6Options} contains unsupported flags`)
    }
  }

  const tileDimensionTags = [322, 323]
  const presentTileDimensionTags = tileDimensionTags.filter((tag) => ifd.entries.has(tag)).length
  if (presentTileDimensionTags === 1) {
    throw invalidInput('TIFF tiled image is missing a required tile tag')
  }
  const tileStorageTags = [324, 325]
  const presentTileStorageTags = tileStorageTags.filter((tag) => ifd.entries.has(tag)).length
  if (presentTileStorageTags === 1) {
    throw invalidInput('TIFF tiled image is missing a required tile tag')
  }
  const presentStripTags = Number(ifd.entries.has(273)) + Number(ifd.entries.has(279))
  if (presentTileStorageTags === tileStorageTags.length && presentTileDimensionTags === 0) {
    throw invalidInput('TIFF tiled image is missing required tile dimensions')
  }
  const tiled = presentTileDimensionTags === tileDimensionTags.length
  const legacyTileStorage = tiled && presentTileStorageTags === 0
  if (legacyTileStorage && (!ifd.entries.has(273) || !ifd.entries.has(279))) {
    throw invalidInput('TIFF tiled image is missing required tile offsets and byte counts')
  }
  if (presentStripTags === 1) throw invalidInput('TIFF strip layout is missing a required tag')
  const interchangeOnly =
    compression === compressionOldJpeg &&
    presentStripTags === 0 &&
    interchangeOffset !== undefined &&
    interchangeLength !== undefined
  let segmentWidth: number
  let segmentHeight: number
  let segmentsAcross: number
  let segmentsDown: number
  let offsetTag: number
  let byteCountTag: number
  if (tiled) {
    segmentWidth = await singleValue(source, ifd, littleEndian, 322)
    segmentHeight = await singleValue(source, ifd, littleEndian, 323)
    if (
      !Number.isSafeInteger(segmentWidth) ||
      !Number.isSafeInteger(segmentHeight) ||
      segmentWidth < 1 ||
      segmentHeight < 1
    ) {
      throw invalidInput('TIFF tile dimensions must be positive')
    }
    segmentsAcross = Math.ceil(width / segmentWidth)
    segmentsDown = Math.ceil(height / segmentHeight)
    offsetTag = legacyTileStorage ? 273 : 324
    byteCountTag = legacyTileStorage ? 279 : 325
  } else if (interchangeOnly) {
    segmentWidth = width
    segmentHeight = height
    segmentsAcross = 1
    segmentsDown = 1
    offsetTag = 513
    byteCountTag = 514
  } else {
    const declaredRowsPerStrip = await singleValue(source, ifd, littleEndian, 278, 0xffffffff)
    if (declaredRowsPerStrip < 1) throw invalidInput('TIFF RowsPerStrip must be positive')
    segmentWidth = width
    segmentHeight = Math.min(declaredRowsPerStrip, height)
    segmentsAcross = 1
    segmentsDown = Math.ceil(height / segmentHeight)
    offsetTag = 273
    byteCountTag = 279
  }
  const segmentsPerPlane = segmentsAcross * segmentsDown
  if (!Number.isSafeInteger(segmentsPerPlane)) throw invalidInput('TIFF segment count is invalid')
  const expectedSegments = segmentsPerPlane * (planarConfiguration === 2 ? samplesPerPixel : 1)
  const segmentOffsets = await requiredValues(
    source,
    ifd,
    littleEndian,
    offsetTag,
    expectedSegments,
  )
  const segmentByteCounts = await requiredValues(
    source,
    ifd,
    littleEndian,
    byteCountTag,
    expectedSegments,
  )
  if (segmentOffsets.length !== expectedSegments || segmentByteCounts.length !== expectedSegments) {
    throw invalidInput(`TIFF expected ${expectedSegments} segment offsets and byte counts`)
  }
  for (let index = 0; index < expectedSegments; index += 1) {
    checkedEnd(
      segmentOffsets[index] ?? -1,
      segmentByteCounts[index] ?? -1,
      source.size,
      `segment ${index}`,
    )
  }

  let cmykDotRange: Uint32Array | undefined
  if (mode === 'pixels' && photometric === photometricSeparated) {
    const inkSet = await singleValue(source, ifd, littleEndian, 332, 1)
    const numberOfInks = await singleValue(source, ifd, littleEndian, 334, 4)
    if (inkSet !== 1 || numberOfInks !== 4 || (samplesPerPixel !== 4 && samplesPerPixel !== 5)) {
      throw unsupportedOperation(
        'TIFF separated decoding currently supports four-component CMYK with optional alpha',
      )
    }
    const rawDotRange = await optionalValues(source, ifd, littleEndian, 336, 8)
    if (rawDotRange && rawDotRange.length !== 2 && rawDotRange.length !== 8) {
      throw invalidInput('TIFF CMYK DotRange must contain 2 or 8 values')
    }
    if (baseSampleFormat !== sampleFormatUnsigned && rawDotRange) {
      throw unsupportedOperation('TIFF DotRange is supported only for unsigned CMYK samples')
    }
    if (baseSampleFormat === sampleFormatUnsigned) {
      const maximum = 2 ** baseBitDepth - 1
      cmykDotRange = new Uint32Array(8)
      for (let sample = 0; sample < 4; sample += 1) {
        const pair = rawDotRange?.length === 8 ? sample * 2 : 0
        const low = rawDotRange?.[pair] ?? 0
        const high = rawDotRange?.[pair + 1] ?? maximum
        if (low < 0 || high > maximum || low >= high) {
          throw invalidInput('TIFF CMYK DotRange is invalid')
        }
        cmykDotRange[sample * 2] = low
        cmykDotRange[sample * 2 + 1] = high
      }
    }
  }

  let ycbcr: YCbCrDescription | undefined
  if (mode === 'pixels' && photometric === photometricYCbCr && !jpegCompression) {
    if (samplesPerPixel !== 3) throw invalidInput('TIFF YCbCr requires three samples per pixel')
    const subsampling =
      (await optionalValues(source, ifd, littleEndian, 530, 2)) ?? Float64Array.of(2, 2)
    if (subsampling.length !== 2) throw invalidInput('TIFF YCbCrSubSampling must contain 2 values')
    const horizontalSubsampling = subsampling[0] ?? 0
    const verticalSubsampling = subsampling[1] ?? 0
    if (
      ![1, 2, 4].includes(horizontalSubsampling) ||
      ![1, 2, 4].includes(verticalSubsampling) ||
      verticalSubsampling > horizontalSubsampling
    ) {
      throw unsupportedOperation('TIFF YCbCr subsampling factors are unsupported')
    }
    if (predictor !== 1) throw unsupportedOperation('TIFF YCbCr prediction is unsupported')
    if (planarConfiguration === 2 && (horizontalSubsampling !== 1 || verticalSubsampling !== 1)) {
      throw unsupportedOperation('TIFF planar YCbCr decoding requires 1x1 chroma sampling')
    }
    const positioning = await singleValue(source, ifd, littleEndian, 531, 1)
    if (positioning !== 1 && positioning !== 2) {
      throw invalidInput(`TIFF YCbCrPositioning ${positioning} is invalid`)
    }
    const coefficients =
      (await rationalValues(source, ifd, littleEndian, 529, 3)) ??
      Float64Array.of(0.299, 0.587, 0.114)
    const referenceBlackWhite =
      (await rationalValues(source, ifd, littleEndian, 532, 6)) ??
      Float64Array.of(0, 255, 128, 255, 128, 255)
    const lumaRed = coefficients[0] ?? 0
    const lumaGreen = coefficients[1] ?? 0
    const lumaBlue = coefficients[2] ?? 0
    if (
      lumaRed <= 0 ||
      lumaGreen <= 0 ||
      lumaBlue <= 0 ||
      Math.abs(lumaRed + lumaGreen + lumaBlue - 1) > 0.001
    ) {
      throw invalidInput('TIFF YCbCrCoefficients are invalid')
    }
    for (let pair = 0; pair < 3; pair += 1) {
      if ((referenceBlackWhite[pair * 2 + 1] ?? 0) <= (referenceBlackWhite[pair * 2] ?? 0)) {
        throw invalidInput('TIFF ReferenceBlackWhite range is invalid')
      }
    }
    ycbcr = {
      horizontalSubsampling,
      verticalSubsampling,
      lumaRed,
      lumaGreen,
      lumaBlue,
      referenceBlackWhite,
    }
  }

  const orientation = await singleValue(source, ifd, littleEndian, 274, 1)
  if (orientation < 1 || orientation > 8)
    throw invalidInput(`TIFF Orientation ${orientation} is invalid`)
  const palette =
    mode === 'pixels' && photometric === photometricPalette
      ? await paletteFor(source, ifd, littleEndian, baseBitDepth)
      : undefined
  const iccEntry = mode === 'pixels' ? ifd.entries.get(34675) : undefined
  let colorTransform: RgbIccTransform | undefined
  let cmykColorTransform: CmykIccTransform | undefined
  let iccProfile: Uint8Array | undefined
  if (iccEntry) {
    if (baseSampleFormat !== sampleFormatUnsigned || baseBitDepth > 16) {
      throw unsupportedOperation(
        'TIFF ICC color management is not implemented for signed, floating-point, or wide unsigned samples',
      )
    }
    iccProfile = Uint8Array.from(await undefinedEntryBytes(source, iccEntry, littleEndian, 34675))
    if (photometric === photometricSeparated && !jpegCompression) {
      if (options.preserveIcc === true) {
        throw unsupportedOperation(
          'Preserving a CMYK TIFF ICC profile requires a raw CMYK pixel format',
        )
      }
      cmykColorTransform = parseCmykIccTransform(iccProfile)
    } else if (
      photometric === photometricRgb ||
      photometric === photometricPalette ||
      jpegCompression
    ) {
      colorTransform = parseRgbIccTransform(iccProfile)
    } else if (photometric === photometricCieLab) {
      throw unsupportedOperation('TIFF CIELab ICC transforms are not implemented')
    } else {
      throw unsupportedOperation(
        'TIFF ICC color management is not implemented for this color space',
      )
    }
  }
  const jpegTablesEntry = mode === 'pixels' ? ifd.entries.get(347) : undefined
  const jpegTables = jpegTablesEntry
    ? (await undefinedEntryBytes(source, jpegTablesEntry, littleEndian, 347)).slice()
    : undefined
  let jpegInterchange: Uint8Array | undefined
  if (mode === 'pixels' && interchangeOffset !== undefined && interchangeLength !== undefined) {
    jpegInterchange = (
      await readExactly(
        source,
        interchangeOffset,
        checkedEnd(interchangeOffset, interchangeLength, source.size, 'JPEG interchange data') -
          interchangeOffset,
      )
    ).slice()
  }
  const sampleBitOffsets = new Uint32Array(samplesPerPixel)
  let bitsPerPixel = 0
  for (let sample = 0; sample < samplesPerPixel; sample += 1) {
    sampleBitOffsets[sample] = bitsPerPixel
    bitsPerPixel += bitsPerSample[sample] ?? 0
  }
  const rowBytes = new Uint32Array(planarConfiguration === 2 ? samplesPerPixel : 1)
  const checkedRowBytes = (bits: bigint): number => {
    const bytes = (bits + 7n) / 8n
    if (bytes > 0xffff_ffffn) throw limitExceeded('TIFF segment row is too large')
    return Number(bytes)
  }
  if (logLuvEncoding) {
    rowBytes[0] = checkedRowBytes(
      BigInt(segmentWidth) * BigInt(logLuvEncoding === 'logl16' ? 32 : 96),
    )
  } else if (planarConfiguration === 1) {
    rowBytes[0] = ycbcr
      ? checkedRowBytes(
          BigInt(Math.ceil(segmentWidth / ycbcr.horizontalSubsampling)) *
            BigInt(ycbcr.horizontalSubsampling * ycbcr.verticalSubsampling + 2) *
            8n,
        )
      : checkedRowBytes(BigInt(segmentWidth) * BigInt(bitsPerPixel))
  } else {
    for (let sample = 0; sample < samplesPerPixel; sample += 1) {
      rowBytes[sample] = checkedRowBytes(BigInt(segmentWidth) * BigInt(bitsPerSample[sample] ?? 0))
    }
  }
  let maximumSegmentBytes = 0n
  for (const bytes of rowBytes) {
    const rows =
      ycbcr && planarConfiguration === 1
        ? Math.ceil(segmentHeight / ycbcr.verticalSubsampling)
        : segmentHeight
    maximumSegmentBytes += BigInt(bytes) * BigInt(rows)
  }
  if (maximumSegmentBytes > BigInt(limits.maxDecodedBytes)) {
    throw limitExceeded(
      `TIFF segment needs ${maximumSegmentBytes} bytes; maxDecodedBytes is ${limits.maxDecodedBytes}`,
    )
  }

  const preserve16 =
    baseSampleFormat === sampleFormatUnsigned &&
    baseBitDepth > 8 &&
    (photometric === photometricWhiteIsZero ||
      photometric === photometricBlackIsZero ||
      photometric === photometricRgb)
  let pixelFormat: TiffDescription['pixelFormat']
  if (mode === 'raster') {
    pixelFormat = undefined
  } else if (logLuvEncoding) {
    pixelFormat = logLuvEncoding === 'logl16' ? 'yf32' : 'xyzf32'
  } else if (photometric === photometricSeparated && baseSampleFormat !== sampleFormatUnsigned) {
    pixelFormat = 'rgb8'
  } else if (wideUnsigned) {
    if (baseSamples === 1) pixelFormat = baseBitDepth <= 32 ? 'gray32' : 'gray64'
    else pixelFormat = baseBitDepth <= 32 ? 'rgb32' : 'rgb64'
  } else if (baseSampleFormat === sampleFormatSigned) {
    if (baseSamples === 1) pixelFormat = baseBitDepth === 8 ? 'grayi8' : 'grayi16'
    else pixelFormat = baseBitDepth === 8 ? 'rgbi8' : 'rgbi16'
  } else if (baseSampleFormat === sampleFormatFloat) {
    if (baseSamples === 1) {
      pixelFormat = baseBitDepth === 16 ? 'grayf16' : baseBitDepth === 32 ? 'grayf32' : 'grayf64'
    } else {
      pixelFormat = baseBitDepth === 16 ? 'rgbf16' : baseBitDepth === 32 ? 'rgbf32' : 'rgbf64'
    }
  } else {
    pixelFormat = jpegCompression
      ? 'rgb8'
      : alphaSample !== undefined
        ? preserve16
          ? 'rgba16'
          : 'rgba8'
        : photometric === photometricWhiteIsZero || photometric === photometricBlackIsZero
          ? preserve16
            ? 'gray16'
            : 'gray8'
          : photometric === photometricRgb && preserve16
            ? 'rgb16'
            : 'rgb8'
  }
  return {
    littleEndian,
    width,
    height,
    bitsPerSample,
    sampleFormats,
    bitsPerPixel,
    sampleBitOffsets,
    rowBytes,
    compression,
    group3TwoDimensional,
    photometric,
    fillOrder,
    samplesPerPixel,
    tiled,
    segmentWidth,
    segmentHeight,
    segmentsAcross,
    segmentsDown,
    segmentsPerPlane,
    segmentOffsets,
    segmentByteCounts,
    planarConfiguration,
    predictor,
    palette,
    cmykDotRange,
    ycbcr,
    logLuvEncoding,
    alphaSample,
    associatedAlpha: extraSamples[0] === 1,
    orientation,
    frames,
    lercAdditionalCompression,
    resolutionLevels,
    pixelFormat,
    displayRanges,
    colorTransform,
    cmykColorTransform,
    cieLabSamples: photometric === photometricCieLab ? (baseSamples === 1 ? 1 : 3) : undefined,
    iccProfile,
    jpegTables,
    jpegInterchange,
    oldJpeg,
  }
}

const describeTiff = async (
  source: ImageSource,
  limits: ImageLimits,
  options: Readonly<DecoderOptions> = {},
): Promise<TiffDescription> => {
  const graph = await readTiffIfdGraph(source, limits)
  const selected = await selectTiffIfd(source, graph, options)
  return describeTiffIfd(source, limits, graph, selected, options, 'pixels')
}

const decodePackBits = (encoded: Uint8Array, expectedBytes: number): Uint8Array => {
  const output = new Uint8Array(expectedBytes)
  let sourceOffset = 0
  let outputOffset = 0
  while (sourceOffset < encoded.byteLength && outputOffset < expectedBytes) {
    const controlByte = encoded[sourceOffset]
    if (controlByte === undefined) break
    sourceOffset += 1
    const control = controlByte > 127 ? controlByte - 256 : controlByte
    if (control >= 0) {
      const count = control + 1
      if (sourceOffset + count > encoded.byteLength || outputOffset + count > expectedBytes) {
        throw truncatedInput('TIFF PackBits literal run exceeds its strip')
      }
      output.set(encoded.subarray(sourceOffset, sourceOffset + count), outputOffset)
      sourceOffset += count
      outputOffset += count
    } else if (control >= -127) {
      const value = encoded[sourceOffset]
      const count = 1 - control
      if (value === undefined || outputOffset + count > expectedBytes) {
        throw truncatedInput('TIFF PackBits repeat run exceeds its strip')
      }
      output.fill(value, outputOffset, outputOffset + count)
      sourceOffset += 1
      outputOffset += count
    }
  }
  if (outputOffset !== expectedBytes) {
    throw truncatedInput(`TIFF PackBits produced ${outputOffset} of ${expectedBytes} bytes`)
  }
  return output
}

class FaxBitReader {
  readonly #data: Uint8Array
  readonly #fillOrder: number
  #bitOffset = 0

  constructor(data: Uint8Array, fillOrder: number) {
    this.#data = data
    this.#fillOrder = fillOrder
  }

  get remaining(): number {
    return this.#data.byteLength * 8 - this.#bitOffset
  }

  readBit(): number | undefined {
    if (this.#bitOffset >= this.#data.byteLength * 8) return undefined
    const byte = this.#data[this.#bitOffset >>> 3] ?? 0
    const bitWithinByte = this.#bitOffset & 7
    this.#bitOffset += 1
    return (byte >>> (this.#fillOrder === 1 ? 7 - bitWithinByte : bitWithinByte)) & 1
  }

  peek(width: number): number {
    let value = 0
    for (let bit = 0; bit < width; bit += 1) {
      const absolute = this.#bitOffset + bit
      value <<= 1
      if (absolute >= this.#data.byteLength * 8) continue
      const byte = this.#data[absolute >>> 3] ?? 0
      const bitWithinByte = absolute & 7
      value |= (byte >>> (this.#fillOrder === 1 ? 7 - bitWithinByte : bitWithinByte)) & 1
    }
    return value
  }

  skip(width: number): boolean {
    if (width > this.remaining) return false
    this.#bitOffset += width
    return true
  }

  alignByte(): void {
    const padding = -this.#bitOffset & 7
    if (padding <= this.remaining) this.#bitOffset += padding
  }
}

const faxBit = (reader: FaxBitReader, label: string): number => {
  const bit = reader.readBit()
  if (bit === undefined) throw truncatedInput(`TIFF CCITT Group 4 ${label} is truncated`)
  return bit
}

const decodeFaxMode = (reader: FaxBitReader): number => {
  let leadingZeros = 0
  while (faxBit(reader, 'mode code') === 0) {
    leadingZeros += 1
    if (leadingZeros > 6) throw invalidInput('TIFF CCITT Group 4 mode code is invalid')
  }
  if (leadingZeros === 0) return 0
  if (leadingZeros === 1) return faxBit(reader, 'vertical mode') === 1 ? 1 : -1
  if (leadingZeros === 2) return 4
  if (leadingZeros === 3) return 5
  if (leadingZeros === 4) return faxBit(reader, 'vertical mode') === 1 ? 2 : -2
  if (leadingZeros === 5) return faxBit(reader, 'vertical mode') === 1 ? 3 : -3
  throw unsupportedOperation('TIFF CCITT Group 4 uncompressed mode is unsupported')
}

const decodeFaxRun = (reader: FaxBitReader, lookup: FaxCodeLookup, maximumRun: number): number => {
  let total = 0
  while (true) {
    if (reader.remaining === 0) throw truncatedInput('TIFF CCITT Group 4 run is truncated')
    const index = reader.peek(faxLookupBits)
    const length = lookup.lengths[index] ?? 0
    if (length === 0) {
      if (reader.remaining < faxLookupBits) {
        throw truncatedInput('TIFF CCITT Group 4 run is truncated')
      }
      throw invalidInput('TIFF CCITT Group 4 run code is invalid')
    }
    if (!reader.skip(length)) throw truncatedInput('TIFF CCITT Group 4 run is truncated')
    const run = lookup.runs[index] ?? 0
    total += run
    if (total > maximumRun) throw invalidInput('TIFF CCITT Group 4 run exceeds the row')
    if (run < 64) return total
  }
}

const fillFaxBlack = (output: Uint8Array, rowOffset: number, start: number, end: number): void => {
  let x = start
  while (x < end && (x & 7) !== 0) {
    const offset = rowOffset + (x >>> 3)
    output[offset] = (output[offset] ?? 0) | (0x80 >>> (x & 7))
    x += 1
  }
  const fullByteEnd = end & ~7
  if (x < fullByteEnd) {
    output.fill(0xff, rowOffset + (x >>> 3), rowOffset + (fullByteEnd >>> 3))
    x = fullByteEnd
  }
  while (x < end) {
    const offset = rowOffset + (x >>> 3)
    output[offset] = (output[offset] ?? 0) | (0x80 >>> (x & 7))
    x += 1
  }
}

const finishFaxChanges = (changes: Int32Array, count: number, width: number): number => {
  let outputCount = count
  while (
    outputCount < 2 ||
    changes[outputCount - 1] !== width ||
    changes[outputCount - 2] !== width
  ) {
    if (outputCount >= changes.length) {
      throw invalidInput('TIFF CCITT fax row has too many changing elements')
    }
    changes[outputCount] = width
    outputCount += 1
  }
  return outputCount
}

const decodeFax1dRow = (
  reader: FaxBitReader,
  width: number,
  output: Uint8Array,
  rowOffset: number,
  changes: Int32Array,
): number => {
  let x = 0
  let color = 0
  let changeCount = 0
  let runs = 0
  while (x < width) {
    runs += 1
    if (runs > width * 2 + 4) throw invalidInput('TIFF CCITT fax row does not make progress')
    const run = decodeFaxRun(reader, color === 0 ? whiteFaxCodes : blackFaxCodes, width - x)
    const end = x + run
    if (color === 1) fillFaxBlack(output, rowOffset, x, end)
    if (changeCount >= changes.length) {
      throw invalidInput('TIFF CCITT fax row has too many changing elements')
    }
    changes[changeCount] = end
    changeCount += 1
    x = end
    color ^= 1
  }
  return finishFaxChanges(changes, changeCount, width)
}

const decodeFax2dRow = (
  reader: FaxBitReader,
  width: number,
  output: Uint8Array,
  rowOffset: number,
  referenceChanges: Int32Array,
  referenceCount: number,
  codingChanges: Int32Array,
): number => {
  let a0 = 0
  let codingColor = 0
  let codingCount = 0
  let atLineStart = true
  let modes = 0

  while (a0 < width) {
    modes += 1
    if (modes > width * 2 + 4) throw invalidInput('TIFF CCITT fax row does not make progress')
    const mode = decodeFaxMode(reader)
    if (mode === 4) {
      const firstRun = decodeFaxRun(
        reader,
        codingColor === 0 ? whiteFaxCodes : blackFaxCodes,
        width - a0,
      )
      const a1 = a0 + firstRun
      const secondRun = decodeFaxRun(
        reader,
        codingColor === 0 ? blackFaxCodes : whiteFaxCodes,
        width - a1,
      )
      const a2 = a1 + secondRun
      if (a2 <= a0) throw invalidInput('TIFF CCITT fax horizontal mode is empty')
      if (codingColor === 0) fillFaxBlack(output, rowOffset, a1, a2)
      else fillFaxBlack(output, rowOffset, a0, a1)
      if (codingCount + 2 > codingChanges.length) {
        throw invalidInput('TIFF CCITT fax row has too many changing elements')
      }
      codingChanges[codingCount] = a1
      codingChanges[codingCount + 1] = a2
      codingCount += 2
      a0 = a2
      atLineStart = false
      continue
    }

    let referenceIndex = codingColor === 0 ? 0 : 1
    while (referenceIndex < referenceCount) {
      const change = referenceChanges[referenceIndex] ?? width
      if (change > a0 || (atLineStart && change === a0)) break
      referenceIndex += 2
    }
    const b1 = referenceChanges[referenceIndex] ?? width
    const b2 = referenceChanges[referenceIndex + 1] ?? width
    if (mode === 5) {
      if (b2 <= a0 || b2 > width) throw invalidInput('TIFF CCITT fax pass mode is invalid')
      if (codingColor === 1) fillFaxBlack(output, rowOffset, a0, b2)
      a0 = b2
      atLineStart = false
      continue
    }

    const a1 = b1 + mode
    if (a1 < a0 || a1 > width) {
      throw invalidInput('TIFF CCITT fax vertical mode exceeds the row')
    }
    if (codingColor === 1) fillFaxBlack(output, rowOffset, a0, a1)
    if (codingCount >= codingChanges.length) {
      throw invalidInput('TIFF CCITT fax row has too many changing elements')
    }
    codingChanges[codingCount] = a1
    codingCount += 1
    a0 = a1
    codingColor ^= 1
    atLineStart = false
  }
  return finishFaxChanges(codingChanges, codingCount, width)
}

const decodeCcittGroup4 = (
  encoded: Uint8Array,
  width: number,
  rows: number,
  rowBytes: number,
  fillOrder: number,
): Uint8Array => {
  const output = new Uint8Array(rowBytes * rows)
  const reader = new FaxBitReader(encoded, fillOrder)
  let referenceChanges = new Int32Array(width + 2)
  let codingChanges = new Int32Array(width + 2)
  referenceChanges[0] = width
  referenceChanges[1] = width
  let referenceCount = 2

  for (let row = 0; row < rows; row += 1) {
    const codingCount = decodeFax2dRow(
      reader,
      width,
      output,
      row * rowBytes,
      referenceChanges,
      referenceCount,
      codingChanges,
    )
    const previousReference = referenceChanges
    referenceChanges = codingChanges
    referenceCount = codingCount
    codingChanges = previousReference
  }

  return output
}

const readFaxEol = (reader: FaxBitReader): void => {
  let zeros = 0
  while (true) {
    const bit = faxBit(reader, 'end-of-line code')
    if (bit === 0) {
      zeros += 1
      continue
    }
    if (zeros < 11) throw invalidInput('TIFF CCITT Group 3 end-of-line code is invalid')
    return
  }
}

const decodeCcittModifiedHuffman = (
  encoded: Uint8Array,
  width: number,
  rows: number,
  rowBytes: number,
  fillOrder: number,
): Uint8Array => {
  const output = new Uint8Array(rowBytes * rows)
  const reader = new FaxBitReader(encoded, fillOrder)
  const changes = new Int32Array(width + 2)
  for (let row = 0; row < rows; row += 1) {
    decodeFax1dRow(reader, width, output, row * rowBytes, changes)
    reader.alignByte()
  }
  return output
}

const decodeCcittGroup3Rows = (
  encoded: Uint8Array,
  width: number,
  rows: number,
  rowBytes: number,
  fillOrder: number,
  twoDimensional: boolean,
  requireEndOfLine: boolean,
): Uint8Array => {
  const output = new Uint8Array(rowBytes * rows)
  const reader = new FaxBitReader(encoded, fillOrder)
  let referenceChanges = new Int32Array(width + 2)
  let codingChanges = new Int32Array(width + 2)
  referenceChanges[0] = width
  referenceChanges[1] = width
  let referenceCount = 2
  for (let row = 0; row < rows; row += 1) {
    if (requireEndOfLine) readFaxEol(reader)
    const oneDimensional = !twoDimensional || faxBit(reader, 'line mode') === 1
    if (row === 0 && !oneDimensional) {
      throw invalidInput('TIFF CCITT Group 3 strip must begin with a one-dimensional row')
    }
    const codingCount = oneDimensional
      ? decodeFax1dRow(reader, width, output, row * rowBytes, codingChanges)
      : decodeFax2dRow(
          reader,
          width,
          output,
          row * rowBytes,
          referenceChanges,
          referenceCount,
          codingChanges,
        )
    const previousReference = referenceChanges
    referenceChanges = codingChanges
    referenceCount = codingCount
    codingChanges = previousReference
  }
  return output
}

const decodeCcittGroup3 = (
  encoded: Uint8Array,
  width: number,
  rows: number,
  rowBytes: number,
  fillOrder: number,
  twoDimensional: boolean,
): Uint8Array => {
  try {
    return decodeCcittGroup3Rows(encoded, width, rows, rowBytes, fillOrder, twoDimensional, true)
  } catch (error) {
    if (
      twoDimensional ||
      !(error instanceof ImageError) ||
      (error.code !== 'INVALID_INPUT' && error.code !== 'TRUNCATED_INPUT')
    ) {
      throw error
    }
    return decodeCcittGroup3Rows(encoded, width, rows, rowBytes, fillOrder, false, false)
  }
}

class LzwBitReader {
  readonly #data: Uint8Array
  readonly #leastSignificantBitFirst: boolean
  #bitOffset = 0

  constructor(data: Uint8Array, leastSignificantBitFirst = false) {
    this.#data = data
    this.#leastSignificantBitFirst = leastSignificantBitFirst
  }

  read(width: number): number | undefined {
    if (this.#bitOffset + width > this.#data.byteLength * 8) return undefined
    let value = 0
    for (let bit = 0; bit < width; bit += 1) {
      const absolute = this.#bitOffset + bit
      const byte = this.#data[absolute >>> 3] ?? 0
      const bitValue =
        (byte >>> (this.#leastSignificantBitFirst ? absolute & 7 : 7 - (absolute & 7))) & 1
      value = this.#leastSignificantBitFirst ? value | (bitValue << bit) : (value << 1) | bitValue
    }
    this.#bitOffset += width
    return value
  }
}

const decodeLzw = (
  encoded: Uint8Array,
  expectedBytes: number,
  maximumBytes = expectedBytes,
): Uint8Array => {
  const clearCode = 256
  const endCode = 257
  const prefixes = new Uint16Array(4096)
  const suffixes = new Uint8Array(4096)
  const stack = new Uint8Array(4096)
  const output = new Uint8Array(maximumBytes)
  const standardInitialCode = new LzwBitReader(encoded).read(9)
  const legacyInitialCode = new LzwBitReader(encoded, true).read(9)
  const legacyBitPacking = standardInitialCode !== clearCode && legacyInitialCode === clearCode
  const reader = new LzwBitReader(encoded, legacyBitPacking)
  let nextCode = 258
  let codeWidth = 9
  let previousCode = -1
  let outputOffset = 0
  let ended = false

  const reset = (): void => {
    nextCode = 258
    codeWidth = 9
    previousCode = -1
  }

  const expand = (code: number): { first: number; length: number } => {
    let current = code
    let length = 0
    while (current >= 256) {
      if (current >= nextCode || length >= stack.byteLength) {
        throw invalidInput('TIFF LZW dictionary reference is invalid')
      }
      stack[length] = suffixes[current] ?? 0
      length += 1
      current = prefixes[current] ?? 0
    }
    if (length >= stack.byteLength) throw invalidInput('TIFF LZW dictionary chain is invalid')
    stack[length] = current
    return { first: current, length: length + 1 }
  }

  const writeExpanded = (length: number): void => {
    if (outputOffset + length > maximumBytes) {
      throw invalidInput('TIFF LZW output exceeds the maximum strip size')
    }
    for (let index = length - 1; index >= 0; index -= 1) {
      output[outputOffset] = stack[index] ?? 0
      outputOffset += 1
    }
  }

  while (outputOffset < maximumBytes) {
    const code = reader.read(codeWidth)
    if (code === undefined) break
    if (code === clearCode) {
      reset()
      continue
    }
    if (code === endCode) {
      ended = true
      break
    }

    let first: number
    if (code < nextCode) {
      const sequence = expand(code)
      first = sequence.first
      writeExpanded(sequence.length)
    } else if (code === nextCode && previousCode >= 0) {
      const sequence = expand(previousCode)
      first = sequence.first
      writeExpanded(sequence.length)
      if (outputOffset >= maximumBytes) {
        throw invalidInput('TIFF LZW special code exceeds the maximum strip size')
      }
      output[outputOffset] = first
      outputOffset += 1
    } else {
      throw invalidInput(`TIFF LZW code ${code} is invalid`)
    }

    if (previousCode >= 0 && nextCode < 4096) {
      prefixes[nextCode] = previousCode
      suffixes[nextCode] = first
      nextCode += 1
      const widthLimit = legacyBitPacking ? 1 << codeWidth : (1 << codeWidth) - 1
      if (codeWidth < 12 && nextCode === widthLimit) codeWidth += 1
    }
    previousCode = code
  }

  if (outputOffset < expectedBytes) {
    throw truncatedInput(`TIFF LZW produced ${outputOffset} of at least ${expectedBytes} bytes`)
  }
  if (!ended) {
    const end = reader.read(codeWidth)
    if (end !== undefined && end !== endCode) {
      throw invalidInput('TIFF LZW data continues past the declared strip size')
    }
  }
  return output.subarray(0, expectedBytes)
}
const decodeDeflateBounded = async (
  encoded: Uint8Array,
  maximumBytes: number,
  label: string,
): Promise<Uint8Array> => {
  const output = new Uint8Array(maximumBytes)
  let offset = 0
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
  try {
    const stream = new Blob([encoded.slice()])
      .stream()
      .pipeThrough(new DecompressionStream('deflate'))
    reader = stream.getReader()
    while (true) {
      const result = await reader.read()
      if (result.done) break
      if (offset + result.value.byteLength > maximumBytes) {
        throw invalidInput(`${label} output exceeds its bounded segment size`)
      }
      output.set(result.value, offset)
      offset += result.value.byteLength
    }
  } catch (error) {
    if (error instanceof Error && error.name === 'ImageError') throw error
    throw invalidInput(`${label} stream is invalid`)
  } finally {
    reader?.releaseLock()
  }
  return output.subarray(0, offset)
}

const decodeDeflate = async (
  encoded: Uint8Array,
  expectedBytes: number,
  maximumBytes: number,
): Promise<Uint8Array> => {
  const output = await decodeDeflateBounded(encoded, maximumBytes, 'TIFF Deflate')
  if (output.byteLength < expectedBytes) {
    throw truncatedInput(
      `TIFF Deflate produced ${output.byteLength} of at least ${expectedBytes} bytes`,
    )
  }
  return output.subarray(0, expectedBytes)
}
const lercDataTypeForSegment = (
  description: TiffDescription,
  physicalSegment: number,
): 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 => {
  const sample =
    description.planarConfiguration === 1
      ? 0
      : Math.floor(physicalSegment / description.segmentsPerPlane)
  const bits = description.bitsPerSample[sample]
  const format = description.sampleFormats[sample]
  if (format === sampleFormatSigned) {
    if (bits === 8) return 0
    if (bits === 16) return 2
    if (bits === 32) return 4
  } else if (format === sampleFormatUnsigned) {
    if (bits === 8) return 1
    if (bits === 16) return 3
    if (bits === 32) return 5
  } else if (format === sampleFormatFloat) {
    if (bits === 32) return 6
    if (bits === 64) return 7
  }
  throw unsupportedOperation('TIFF LERC compression does not support this sample type')
}

const swapSampleBytes = (data: Uint8Array, bytesPerSample: number): void => {
  for (let offset = 0; offset < data.byteLength; offset += bytesPerSample) {
    for (let left = 0, right = bytesPerSample - 1; left < right; left += 1, right -= 1) {
      const value = data[offset + left] ?? 0
      data[offset + left] = data[offset + right] ?? 0
      data[offset + right] = value
    }
  }
}

const decodeLercSegment = async (
  encoded: Uint8Array,
  description: TiffDescription,
  physicalSegment: number,
  expectedBytes: number,
  rows: number,
): Promise<Uint8Array> => {
  const maximumLercBytes = expectedBytes + Math.floor(expectedBytes / 3) + 256
  if (!Number.isSafeInteger(maximumLercBytes)) throw limitExceeded('TIFF LERC segment is too large')
  const blob =
    description.lercAdditionalCompression === 1
      ? await decodeDeflateBounded(encoded, maximumLercBytes, 'TIFF LERC Deflate')
      : encoded
  const decoded = decodeLerc2(blob)
  const dataType = lercDataTypeForSegment(description, physicalSegment)
  const expectedDepth = description.planarConfiguration === 1 ? description.samplesPerPixel : 1
  const alphaFromMask =
    description.planarConfiguration === 1 &&
    dataType === 1 &&
    description.alphaSample === description.samplesPerPixel - 1 &&
    !description.associatedAlpha &&
    decoded.depth === expectedDepth - 1
  if (
    decoded.width !== description.segmentWidth ||
    decoded.height !== rows ||
    decoded.dataType !== dataType ||
    (!alphaFromMask && decoded.depth !== expectedDepth)
  ) {
    throw invalidInput('TIFF LERC segment dimensions or sample type do not match its directory')
  }
  let output: Uint8Array
  if (alphaFromMask) {
    const pixels = decoded.width * decoded.height
    output = new Uint8Array(expectedBytes)
    for (let pixel = 0; pixel < pixels; pixel += 1) {
      const sourceOffset = pixel * decoded.depth
      const targetOffset = pixel * expectedDepth
      output.set(decoded.data.subarray(sourceOffset, sourceOffset + decoded.depth), targetOffset)
      output[targetOffset + expectedDepth - 1] = decoded.mask[pixel] === 0 ? 0 : 255
    }
  } else {
    if (decoded.data.byteLength !== expectedBytes) {
      throw invalidInput(
        `TIFF LERC decoder produced ${decoded.data.byteLength}, expected ${expectedBytes} bytes`,
      )
    }
    output = decoded.data
    if (dataType === 6 || dataType === 7) {
      const view = new DataView(output.buffer, output.byteOffset, output.byteLength)
      const samplesPerPixel = decoded.depth
      for (let pixel = 0; pixel < decoded.mask.length; pixel += 1) {
        for (let sample = 0; sample < samplesPerPixel; sample += 1) {
          const sampleMask = decoded.sampleMasks[sample] ?? decoded.mask
          if (sampleMask[pixel] !== 0) continue
          const index = pixel * samplesPerPixel + sample
          if (dataType === 6) view.setFloat32(index * 4, Number.NaN, true)
          else view.setFloat64(index * 8, Number.NaN, true)
        }
      }
    }
  }
  if (!description.littleEndian && decoded.bytesPerSample > 1) {
    swapSampleBytes(output, decoded.bytesPerSample)
  }
  return output
}

const readPackedUnsigned = (data: Uint8Array, bitOffset: number, bitDepth: number): number => {
  if (
    bitOffset < 0 ||
    bitDepth < 1 ||
    bitDepth > 14 ||
    bitOffset + bitDepth > data.byteLength * 8
  ) {
    throw truncatedInput('TIFF packed sample is truncated')
  }
  const byteOffset = bitOffset >>> 3
  const bitWithinByte = bitOffset & 7
  const word =
    ((data[byteOffset] ?? 0) << 16) |
    ((data[byteOffset + 1] ?? 0) << 8) |
    (data[byteOffset + 2] ?? 0)
  return (word >>> (24 - bitWithinByte - bitDepth)) & (2 ** bitDepth - 1)
}

const writePackedUnsigned = (
  data: Uint8Array,
  bitOffset: number,
  bitDepth: number,
  value: number,
): void => {
  for (let bit = 0; bit < bitDepth; bit += 1) {
    const outputBit = bitOffset + bit
    const byteOffset = outputBit >>> 3
    const shift = 7 - (outputBit & 7)
    const mask = 1 << shift
    if (((value >>> (bitDepth - bit - 1)) & 1) === 0) {
      data[byteOffset] = (data[byteOffset] ?? 0) & ~mask
    } else {
      data[byteOffset] = (data[byteOffset] ?? 0) | mask
    }
  }
}

const reversePredictor = (
  data: Uint8Array,
  rowBytes: number,
  rows: number,
  samplesPerRow: number,
  stride: number,
  bitDepth: number,
  littleEndian: boolean,
): void => {
  if (bitDepth === 24) {
    for (let row = 0; row < rows; row += 1) {
      const rowSample = row * samplesPerRow
      for (let sample = stride; sample < samplesPerRow; sample += 1) {
        const offset = (rowSample + sample) * 3
        const previousOffset = (rowSample + sample - stride) * 3
        const value = littleEndian
          ? (data[offset] ?? 0) | ((data[offset + 1] ?? 0) << 8) | ((data[offset + 2] ?? 0) << 16)
          : ((data[offset] ?? 0) << 16) | ((data[offset + 1] ?? 0) << 8) | (data[offset + 2] ?? 0)
        const previous = littleEndian
          ? (data[previousOffset] ?? 0) |
            ((data[previousOffset + 1] ?? 0) << 8) |
            ((data[previousOffset + 2] ?? 0) << 16)
          : ((data[previousOffset] ?? 0) << 16) |
            ((data[previousOffset + 1] ?? 0) << 8) |
            (data[previousOffset + 2] ?? 0)
        const sum = (value + previous) & 0xff_ffff
        if (littleEndian) {
          data[offset] = sum
          data[offset + 1] = sum >>> 8
          data[offset + 2] = sum >>> 16
        } else {
          data[offset] = sum >>> 16
          data[offset + 1] = sum >>> 8
          data[offset + 2] = sum
        }
      }
    }
    return
  }
  if (bitDepth === 64) {
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
    for (let row = 0; row < rows; row += 1) {
      const rowSample = row * samplesPerRow
      for (let sample = stride; sample < samplesPerRow; sample += 1) {
        const offset = (rowSample + sample) * 8
        const previousOffset = (rowSample + sample - stride) * 8
        const lowOffset = littleEndian ? offset : offset + 4
        const highOffset = littleEndian ? offset + 4 : offset
        const previousLowOffset = littleEndian ? previousOffset : previousOffset + 4
        const previousHighOffset = littleEndian ? previousOffset + 4 : previousOffset
        const low = view.getUint32(lowOffset, littleEndian)
        const previousLow = view.getUint32(previousLowOffset, littleEndian)
        const sumLow = (low + previousLow) >>> 0
        const carry = sumLow < low ? 1 : 0
        const sumHigh =
          (view.getUint32(highOffset, littleEndian) +
            view.getUint32(previousHighOffset, littleEndian) +
            carry) >>>
          0
        view.setUint32(lowOffset, sumLow, littleEndian)
        view.setUint32(highOffset, sumHigh, littleEndian)
      }
    }
    return
  }
  if (bitDepth === 32) {
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
    for (let row = 0; row < rows; row += 1) {
      const rowSample = row * samplesPerRow
      for (let sample = stride; sample < samplesPerRow; sample += 1) {
        const offset = (rowSample + sample) * 4
        const previousOffset = (rowSample + sample - stride) * 4
        view.setUint32(
          offset,
          (view.getUint32(offset, littleEndian) + view.getUint32(previousOffset, littleEndian)) >>>
            0,
          littleEndian,
        )
      }
    }
    return
  }
  if (bitDepth === 16) {
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
    for (let row = 0; row < rows; row += 1) {
      const rowSample = row * samplesPerRow
      for (let sample = stride; sample < samplesPerRow; sample += 1) {
        const offset = (rowSample + sample) * 2
        const previousOffset = (rowSample + sample - stride) * 2
        const value =
          (view.getUint16(offset, littleEndian) + view.getUint16(previousOffset, littleEndian)) &
          0xffff
        view.setUint16(offset, value, littleEndian)
      }
    }
    return
  }
  if (bitDepth === 8) {
    for (let row = 0; row < rows; row += 1) {
      const rowOffset = row * rowBytes
      for (let sample = stride; sample < samplesPerRow; sample += 1) {
        const index = rowOffset + sample
        data[index] = ((data[index] ?? 0) + (data[index - stride] ?? 0)) & 0xff
      }
    }
    return
  }
  const maximum = 2 ** bitDepth - 1
  const samples = new Uint16Array(samplesPerRow)
  for (let row = 0; row < rows; row += 1) {
    const rowBitOffset = row * rowBytes * 8
    for (let sample = 0; sample < samplesPerRow; sample += 1) {
      samples[sample] = readPackedUnsigned(data, rowBitOffset + sample * bitDepth, bitDepth)
    }
    for (let sample = stride; sample < samplesPerRow; sample += 1) {
      samples[sample] = ((samples[sample] ?? 0) + (samples[sample - stride] ?? 0)) & maximum
    }
    for (let sample = 0; sample < samplesPerRow; sample += 1) {
      writePackedUnsigned(data, rowBitOffset + sample * bitDepth, bitDepth, samples[sample] ?? 0)
    }
  }
}

const reverseFloatingPredictor = (
  data: Uint8Array,
  rowBytes: number,
  rows: number,
  stride: number,
  bitDepth: number,
  littleEndian: boolean,
): void => {
  const bytesPerSample = bitDepth / 8
  if (
    !Number.isSafeInteger(bytesPerSample) ||
    rowBytes % (bytesPerSample * stride) !== 0 ||
    rowBytes * rows > data.byteLength
  ) {
    throw invalidInput('TIFF floating-point predictor row layout is invalid')
  }
  const samplesPerRow = rowBytes / bytesPerSample
  const scratch = new Uint8Array(rowBytes)
  for (let row = 0; row < rows; row += 1) {
    const rowOffset = row * rowBytes
    for (let index = stride; index < rowBytes; index += 1) {
      const offset = rowOffset + index
      data[offset] = ((data[offset] ?? 0) + (data[offset - stride] ?? 0)) & 0xff
    }
    scratch.set(data.subarray(rowOffset, rowOffset + rowBytes))
    for (let sample = 0; sample < samplesPerRow; sample += 1) {
      const outputOffset = rowOffset + sample * bytesPerSample
      for (let byte = 0; byte < bytesPerSample; byte += 1) {
        const plane = littleEndian ? bytesPerSample - byte - 1 : byte
        data[outputOffset + byte] = scratch[plane * samplesPerRow + sample] ?? 0
      }
    }
  }
}

const reverseFillOrder = (data: Uint8Array): void => {
  for (let offset = 0; offset < data.byteLength; offset += 1) {
    const value = data[offset] ?? 0
    data[offset] = ((reversedNibbles[value & 0x0f] ?? 0) << 4) | (reversedNibbles[value >>> 4] ?? 0)
  }
}

const decodeSegment = async (
  source: ImageSource,
  description: TiffDescription,
  physicalSegment: number,
  expectedBytes: number,
  rowBytes: number,
  rows: number,
  predictorStride: number,
): Promise<Uint8Array> => {
  const offset = description.segmentOffsets[physicalSegment]
  const byteCount = description.segmentByteCounts[physicalSegment]
  if (offset === undefined || byteCount === undefined) throw invalidInput('TIFF segment is missing')
  const encoded = await readExactly(source, offset, byteCount)
  let decoded: Uint8Array
  if (description.logLuvEncoding) {
    decoded = decodeLogLuvSegment(
      encoded,
      description.segmentWidth,
      rows,
      description.logLuvEncoding,
    )
    if (decoded.byteLength !== expectedBytes) {
      throw invalidInput(
        `TIFF SGILog decoder produced ${decoded.byteLength}, expected ${expectedBytes} bytes`,
      )
    }
  } else if (description.compression === compressionNone) {
    if (encoded.byteLength !== expectedBytes) {
      throw invalidInput(
        `TIFF uncompressed strip has ${encoded.byteLength}, expected ${expectedBytes} bytes`,
      )
    }
    decoded = Uint8Array.from(encoded)
  } else if (description.compression === compressionPackBits) {
    decoded = decodePackBits(encoded, expectedBytes)
  } else if (description.compression === compressionLzw) {
    const maximumBytes = description.ycbcr
      ? rowBytes * Math.ceil(description.segmentHeight / description.ycbcr.verticalSubsampling)
      : expectedBytes
    decoded = decodeLzw(encoded, expectedBytes, maximumBytes)
  } else if (description.compression === compressionLerc) {
    decoded = await decodeLercSegment(encoded, description, physicalSegment, expectedBytes, rows)
  } else if (description.compression === compressionZstandard) {
    decoded = decodeZstd(encoded, {
      expectedOutputBytes: expectedBytes,
      maxOutputBytes: expectedBytes,
    })
  } else if (description.compression === compressionCcittModifiedHuffman) {
    decoded = decodeCcittModifiedHuffman(
      encoded,
      description.segmentWidth,
      rows,
      rowBytes,
      description.fillOrder,
    )
  } else if (description.compression === compressionCcittGroup3) {
    decoded = decodeCcittGroup3(
      encoded,
      description.segmentWidth,
      rows,
      rowBytes,
      description.fillOrder,
      description.group3TwoDimensional,
    )
  } else if (description.compression === compressionCcittGroup4) {
    decoded = decodeCcittGroup4(
      encoded,
      description.segmentWidth,
      rows,
      rowBytes,
      description.fillOrder,
    )
  } else {
    const maximumBytes = description.ycbcr
      ? rowBytes * Math.ceil(description.segmentHeight / description.ycbcr.verticalSubsampling)
      : rowBytes * description.segmentHeight
    decoded = await decodeDeflate(encoded, expectedBytes, maximumBytes)
  }
  if (
    description.fillOrder === 2 &&
    description.compression !== compressionCcittModifiedHuffman &&
    description.compression !== compressionCcittGroup3 &&
    description.compression !== compressionCcittGroup4
  ) {
    reverseFillOrder(decoded)
  }
  if (description.predictor === 2) {
    const bitDepth =
      description.planarConfiguration === 1
        ? (description.bitsPerSample[0] ?? 8)
        : (description.bitsPerSample[Math.floor(physicalSegment / description.segmentsPerPlane)] ??
          8)
    reversePredictor(
      decoded,
      rowBytes,
      rows,
      description.segmentWidth * predictorStride,
      predictorStride,
      bitDepth,
      description.littleEndian,
    )
  }
  if (description.predictor === 3) {
    const bitDepth =
      description.planarConfiguration === 1
        ? (description.bitsPerSample[0] ?? 8)
        : (description.bitsPerSample[Math.floor(physicalSegment / description.segmentsPerPlane)] ??
          8)
    reverseFloatingPredictor(
      decoded,
      rowBytes,
      rows,
      predictorStride,
      bitDepth,
      description.littleEndian,
    )
  }
  return decoded
}

const hasJpegBoundary = (data: Uint8Array, first: number, second: number): boolean =>
  data[0] === first && data[1] === second

const jpegEntropyData = (data: Uint8Array): Uint8Array | undefined => {
  if (!hasJpegBoundary(data, 0xff, 0xd8)) return undefined
  let offset = 2
  while (offset + 1 < data.byteLength) {
    if (data[offset] !== 0xff) throw invalidInput('TIFF JPEG interchange marker is invalid')
    while (data[offset] === 0xff) offset += 1
    const marker = data[offset]
    offset += 1
    if (marker === undefined || marker === 0xd9) return undefined
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue
    const high = data[offset]
    const low = data[offset + 1]
    if (high === undefined || low === undefined) {
      throw truncatedInput('TIFF JPEG interchange marker is truncated')
    }
    const length = (high << 8) | low
    if (length < 2 || offset + length > data.byteLength) {
      throw truncatedInput('TIFF JPEG interchange marker is truncated')
    }
    offset += length
    if (marker === 0xda) {
      const end =
        data[data.byteLength - 2] === 0xff && data[data.byteLength - 1] === 0xd9
          ? data.byteLength - 2
          : data.byteLength
      return data.subarray(offset, end)
    }
  }
  return undefined
}

const oldJpegStripEntropy = (data: Uint8Array): Uint8Array => {
  if (!hasJpegBoundary(data, 0xff, 0xda)) return data
  const high = data[2]
  const low = data[3]
  if (high === undefined || low === undefined) {
    throw truncatedInput('TIFF old-style JPEG scan header is truncated')
  }
  const length = (high << 8) | low
  if (length < 2 || length + 2 > data.byteLength) {
    throw truncatedInput('TIFF old-style JPEG scan header is truncated')
  }
  return data.subarray(length + 2)
}

const jpegWithTables = (tables: Uint8Array, segment: Uint8Array): Uint8Array => {
  if (
    !hasJpegBoundary(tables, 0xff, 0xd8) ||
    tables[tables.byteLength - 2] !== 0xff ||
    tables[tables.byteLength - 1] !== 0xd9
  ) {
    throw invalidInput('TIFF JPEGTables must be bounded by SOI and EOI markers')
  }
  if (!hasJpegBoundary(segment, 0xff, 0xd8)) {
    throw invalidInput('TIFF JPEG segment is missing its SOI marker')
  }
  const output = new Uint8Array(tables.byteLength + segment.byteLength - 4)
  output.set(tables.subarray(0, tables.byteLength - 2))
  output.set(segment.subarray(2), tables.byteLength - 2)
  return output
}

const pushJpegMarker = (output: number[], marker: number, payload: Uint8Array): void => {
  const length = payload.byteLength + 2
  output.push(0xff, marker, length >>> 8, length & 0xff)
  for (const value of payload) output.push(value)
}

const oldJpegStream = (
  description: TiffDescription,
  entropy: Uint8Array,
  rows: number,
): Uint8Array => {
  const oldJpeg = description.oldJpeg
  if (!oldJpeg) {
    throw unsupportedOperation(
      'TIFF old-style JPEG strips require a complete stream or JPEG table tags',
    )
  }
  if (description.segmentWidth > 65_535 || rows > 65_535) {
    throw unsupportedOperation('TIFF old-style JPEG segment dimensions exceed baseline JPEG limits')
  }
  const header: number[] = [0xff, 0xd8]
  if (
    description.photometric === photometricRgb ||
    description.photometric === photometricSeparated
  ) {
    pushJpegMarker(header, 0xee, Uint8Array.of(0x41, 0x64, 0x6f, 0x62, 0x65, 0, 0, 100, 0, 0, 0, 0))
  }
  for (let sample = 0; sample < description.samplesPerPixel; sample += 1) {
    const quantization = oldJpeg.quantizationTables[sample]
    const dc = oldJpeg.dcTables[sample]
    const ac = oldJpeg.acTables[sample]
    if (!quantization || !dc || !ac) throw invalidInput('TIFF old-style JPEG table is missing')
    const dqt = new Uint8Array(65)
    dqt[0] = sample
    dqt.set(quantization, 1)
    pushJpegMarker(header, 0xdb, dqt)
    const dhtDc = new Uint8Array(dc.byteLength + 1)
    dhtDc[0] = sample
    dhtDc.set(dc, 1)
    pushJpegMarker(header, 0xc4, dhtDc)
    const dhtAc = new Uint8Array(ac.byteLength + 1)
    dhtAc[0] = 0x10 | sample
    dhtAc.set(ac, 1)
    pushJpegMarker(header, 0xc4, dhtAc)
  }
  if (oldJpeg.restartInterval > 0) {
    pushJpegMarker(
      header,
      0xdd,
      Uint8Array.of(oldJpeg.restartInterval >>> 8, oldJpeg.restartInterval & 0xff),
    )
  }
  const frame = new Uint8Array(6 + description.samplesPerPixel * 3)
  frame[0] = 8
  frame[1] = rows >>> 8
  frame[2] = rows & 0xff
  frame[3] = description.segmentWidth >>> 8
  frame[4] = description.segmentWidth & 0xff
  frame[5] = description.samplesPerPixel
  for (let sample = 0; sample < description.samplesPerPixel; sample += 1) {
    const component = 6 + sample * 3
    frame[component] =
      description.photometric === photometricRgb
        ? ([0x52, 0x47, 0x42][sample] ?? sample + 1)
        : sample + 1
    frame[component + 1] =
      ((oldJpeg.horizontalSampling[sample] ?? 1) << 4) | (oldJpeg.verticalSampling[sample] ?? 1)
    frame[component + 2] = sample
  }
  pushJpegMarker(header, 0xc0, frame)
  const scan = new Uint8Array(1 + description.samplesPerPixel * 2 + 3)
  scan[0] = description.samplesPerPixel
  for (let sample = 0; sample < description.samplesPerPixel; sample += 1) {
    scan[1 + sample * 2] = frame[6 + sample * 3] ?? sample + 1
    scan[2 + sample * 2] = (sample << 4) | sample
  }
  scan[scan.byteLength - 3] = 0
  scan[scan.byteLength - 2] = 63
  scan[scan.byteLength - 1] = 0
  pushJpegMarker(header, 0xda, scan)
  const entropyLength =
    entropy[entropy.byteLength - 2] === 0xff && entropy[entropy.byteLength - 1] === 0xd9
      ? entropy.byteLength - 2
      : entropy.byteLength
  const output = new Uint8Array(header.length + entropyLength + 2)
  output.set(header)
  output.set(entropy.subarray(0, entropyLength), header.length)
  output.set([0xff, 0xd9], header.length + entropyLength)
  return output
}

const decodeJpegSegment = async (
  source: ImageSource,
  description: TiffDescription,
  limits: ImageLimits,
  physicalSegment: number,
  rows: number,
): Promise<Uint8Array> => {
  const offset = description.segmentOffsets[physicalSegment]
  const byteCount = description.segmentByteCounts[physicalSegment]
  if (offset === undefined || byteCount === undefined) throw invalidInput('TIFF segment is missing')
  let encoded = await readExactly(source, offset, byteCount)
  if (
    description.compression === compressionOldJpeg &&
    description.oldJpeg &&
    !hasJpegBoundary(encoded, 0xff, 0xd8)
  ) {
    const interchangeEntropy =
      description.segmentOffsets.length === 1 && description.jpegInterchange
        ? jpegEntropyData(description.jpegInterchange)
        : undefined
    encoded = oldJpegStream(description, oldJpegStripEntropy(interchangeEntropy ?? encoded), rows)
  } else if (!hasJpegBoundary(encoded, 0xff, 0xd8) && description.jpegInterchange) {
    encoded = description.jpegInterchange
  }
  if (description.compression === compressionJpeg && description.jpegTables) {
    encoded = jpegWithTables(description.jpegTables, encoded)
  } else if (!hasJpegBoundary(encoded, 0xff, 0xd8)) {
    throw invalidInput('TIFF JPEG segment is missing its SOI marker')
  }
  const createDecoder = jpegCodec.createDecoder
  if (!createDecoder) throw unsupportedOperation('JPEG decoder is unavailable')
  const decoder = await createDecoder(new MemorySource(encoded), limits)
  if (
    decoder.pixelFormat !== 'rgb8' ||
    decoder.width !== description.segmentWidth ||
    decoder.height < rows
  ) {
    throw invalidInput(
      `TIFF JPEG segment dimensions ${decoder.width}x${decoder.height} do not match ${description.segmentWidth}x${rows}`,
    )
  }
  const output = new Uint8Array(description.segmentWidth * rows * 3)
  for await (const block of decoder.decode({
    x: 0,
    y: 0,
    width: description.segmentWidth,
    height: rows,
  })) {
    if (block.format !== 'rgb8') throw invalidInput('TIFF JPEG segment changed pixel format')
    for (let row = 0; row < block.height; row += 1) {
      const sourceStart = row * block.stride
      const targetStart = ((block.y + row) * description.segmentWidth + block.x) * 3
      output.set(block.data.subarray(sourceStart, sourceStart + block.width * 3), targetStart)
    }
  }
  return output
}

const decodeJpeg2000Segment = async (
  source: ImageSource,
  description: TiffDescription,
  limits: ImageLimits,
  physicalSegment: number,
  rows: number,
): Promise<Uint8Array> => {
  const offset = description.segmentOffsets[physicalSegment]
  const byteCount = description.segmentByteCounts[physicalSegment]
  if (offset === undefined || byteCount === undefined) throw invalidInput('TIFF segment is missing')
  const encoded = await readExactly(source, offset, byteCount)
  const decoder = createJpeg2000CodestreamDecoder(encoded, {
    ...limits,
    colorSpace: description.compression === compressionAperioJpeg2000Ycbcr ? 'ycbcr' : 'rgb',
  })
  if (
    decoder.pixelFormat !== 'rgb8' ||
    decoder.width !== description.segmentWidth ||
    decoder.height < rows
  ) {
    throw invalidInput(
      `TIFF JPEG 2000 segment dimensions ${decoder.width}x${decoder.height} do not match ${description.segmentWidth}x${rows}`,
    )
  }
  const output = new Uint8Array(description.segmentWidth * rows * 3)
  for await (const block of decoder.decode({
    x: 0,
    y: 0,
    width: description.segmentWidth,
    height: rows,
  })) {
    if (block.format !== 'rgb8') throw invalidInput('TIFF JPEG 2000 segment changed pixel format')
    for (let row = 0; row < block.height; row += 1) {
      const sourceStart = row * block.stride
      const targetStart = ((block.y + row) * description.segmentWidth + block.x) * 3
      output.set(block.data.subarray(sourceStart, sourceStart + block.width * 3), targetStart)
    }
  }
  return output
}

const decodeWebpSegment = async (
  source: ImageSource,
  description: TiffDescription,
  limits: ImageLimits,
  webpCodec: ImageCodec | undefined,
  physicalSegment: number,
  rows: number,
): Promise<Uint8Array> => {
  const createDecoder = webpCodec?.createDecoder
  if (!createDecoder) {
    throw unsupportedOperation('TIFF WebP compression requires an explicitly composed WebP codec')
  }
  const offset = description.segmentOffsets[physicalSegment]
  const byteCount = description.segmentByteCounts[physicalSegment]
  if (offset === undefined || byteCount === undefined) throw invalidInput('TIFF segment is missing')
  const encoded = await readExactly(source, offset, byteCount)
  const decoder = await createDecoder(new MemorySource(encoded), limits)
  if (decoder.width !== description.segmentWidth || decoder.height !== rows) {
    throw invalidInput(
      `TIFF WebP segment dimensions ${decoder.width}x${decoder.height} do not match ${description.segmentWidth}x${rows}`,
    )
  }
  if (decoder.pixelFormat !== 'rgb8' && decoder.pixelFormat !== 'rgba8') {
    throw invalidInput(`TIFF WebP segment produced ${decoder.pixelFormat} pixels`)
  }
  if (description.samplesPerPixel === 4 && decoder.pixelFormat !== 'rgba8') {
    throw invalidInput('TIFF WebP RGBA segment did not produce alpha')
  }
  const output = new Uint8Array(description.segmentWidth * rows * description.samplesPerPixel)
  let nextRow = 0
  for await (const block of decoder.decode()) {
    const sourceChannels = block.format === 'rgb8' ? 3 : block.format === 'rgba8' ? 4 : 0
    if (
      sourceChannels === 0 ||
      block.format !== decoder.pixelFormat ||
      block.x !== 0 ||
      block.y !== nextRow ||
      block.width !== description.segmentWidth ||
      block.height < 1 ||
      block.y + block.height > rows ||
      block.stride < block.width * sourceChannels ||
      block.data.byteLength < block.stride * block.height
    ) {
      throw invalidInput('TIFF WebP segment produced malformed pixel rows')
    }
    for (let row = 0; row < block.height; row += 1) {
      const sourceRow = row * block.stride
      const targetRow = (block.y + row) * description.segmentWidth * description.samplesPerPixel
      if (sourceChannels === description.samplesPerPixel) {
        output.set(
          block.data.subarray(
            sourceRow,
            sourceRow + description.segmentWidth * description.samplesPerPixel,
          ),
          targetRow,
        )
      } else {
        for (let x = 0; x < description.segmentWidth; x += 1) {
          const sourcePixel = sourceRow + x * sourceChannels
          const targetPixel = targetRow + x * description.samplesPerPixel
          output[targetPixel] = block.data[sourcePixel] ?? 0
          output[targetPixel + 1] = block.data[sourcePixel + 1] ?? 0
          output[targetPixel + 2] = block.data[sourcePixel + 2] ?? 0
        }
      }
    }
    nextRow += block.height
  }
  if (nextRow !== rows) {
    throw truncatedInput(`TIFF WebP segment produced ${nextRow} of ${rows} rows`)
  }
  return output
}

const chunkySegmentBytes = (
  description: TiffDescription,
  rowBytes: number,
  rows: number,
): number =>
  description.ycbcr
    ? rowBytes * Math.ceil(rows / description.ycbcr.verticalSubsampling)
    : rowBytes * rows

const regionFor = (description: TiffDescription, request: DecodeRequest): Region => {
  const x = request.x ?? 0
  const y = request.y ?? 0
  const width = request.width ?? description.width - x
  const height = request.height ?? description.height - y
  if (
    !Number.isSafeInteger(x) ||
    !Number.isSafeInteger(y) ||
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    x < 0 ||
    y < 0 ||
    width < 1 ||
    height < 1 ||
    x + width > description.width ||
    y + height > description.height
  ) {
    throw invalidInput('TIFF decode region is invalid')
  }
  return { x, y, width, height }
}

const packedSample = (
  data: Uint8Array,
  bitOffset: number,
  bitDepth: number,
  littleEndian: boolean,
): number => {
  if (bitDepth === 16) {
    if ((bitOffset & 7) !== 0) {
      throw unsupportedOperation('TIFF 16-bit samples must be byte-aligned')
    }
    return uint16(data, bitOffset >>> 3, littleEndian)
  }
  if (bitDepth <= 8) {
    const byte = data[bitOffset >>> 3]
    if (byte === undefined) throw truncatedInput('TIFF packed sample is truncated')
    const shift = 8 - bitDepth - (bitOffset & 7)
    if (shift >= 0) return (byte >>> shift) & ((1 << bitDepth) - 1)
  }
  return readPackedUnsigned(data, bitOffset, bitDepth)
}

const sampleAt = (
  planes: readonly Uint8Array[],
  description: TiffDescription,
  rowWithinStrip: number,
  x: number,
  sample: number,
): number => {
  const bitDepth = description.bitsPerSample[sample]
  if (bitDepth === undefined) throw invalidInput('TIFF sample index is invalid')
  if (description.planarConfiguration === 2) {
    const plane = planes[sample]
    if (!plane) throw truncatedInput('TIFF sample plane is missing')
    const rowBytes = description.rowBytes[sample]
    if (rowBytes === undefined) throw invalidInput('TIFF sample row size is missing')
    const bitOffset = rowWithinStrip * rowBytes * 8 + x * bitDepth
    if (bitDepth === 8) {
      const value = plane[bitOffset >>> 3]
      if (value === undefined) throw truncatedInput('TIFF sample is truncated')
      return value
    }
    return packedSample(plane, bitOffset, bitDepth, description.littleEndian)
  }

  const plane = planes[0]
  if (!plane) throw truncatedInput('TIFF chunky strip is missing')
  const pixelBits = description.bitsPerPixel
  const rowBytes = description.rowBytes[0]
  const sampleOffset = description.sampleBitOffsets[sample]
  if (rowBytes === undefined || sampleOffset === undefined) {
    throw invalidInput('TIFF chunky sample layout is missing')
  }
  const bitOffset = rowWithinStrip * rowBytes * 8 + x * pixelBits + sampleOffset
  if (bitDepth === 8) {
    const value = plane[bitOffset >>> 3]
    if (value === undefined) throw truncatedInput('TIFF sample is truncated')
    return value
  }
  return packedSample(plane, bitOffset, bitDepth, description.littleEndian)
}

const halfFloatValue = (bits: number): number => {
  const sign = (bits & 0x8000) === 0 ? 1 : -1
  const exponent = (bits >>> 10) & 0x1f
  const fraction = bits & 0x03ff
  if (exponent === 0) return sign * 2 ** -14 * (fraction / 1024)
  if (exponent === 0x1f) return fraction === 0 ? sign * Number.POSITIVE_INFINITY : Number.NaN
  return sign * 2 ** (exponent - 15) * (1 + fraction / 1024)
}

const numericSampleAt = (
  views: readonly DataView[],
  description: TiffDescription,
  rowWithinSegment: number,
  x: number,
  sample: number,
): number => {
  const bitDepth = description.bitsPerSample[sample]
  if (bitDepth === undefined || (bitDepth & 7) !== 0) {
    throw invalidInput('TIFF numeric CMYK sample layout is invalid')
  }
  const bytesPerSample = bitDepth >>> 3
  const planeIndex = description.planarConfiguration === 2 ? sample : 0
  const view = views[planeIndex]
  let source: number
  if (description.planarConfiguration === 2) {
    const rowBytes = description.rowBytes[sample]
    if (rowBytes === undefined) throw invalidInput('TIFF numeric CMYK row size is missing')
    source = rowWithinSegment * rowBytes + x * bytesPerSample
  } else {
    const rowBytes = description.rowBytes[0]
    const sampleBitOffset = description.sampleBitOffsets[sample]
    if (rowBytes === undefined || sampleBitOffset === undefined || (sampleBitOffset & 7) !== 0) {
      throw invalidInput('TIFF numeric CMYK chunky layout is invalid')
    }
    source =
      rowWithinSegment * rowBytes + x * (description.bitsPerPixel >>> 3) + (sampleBitOffset >>> 3)
  }
  if (!view || source < 0 || source + bytesPerSample > view.byteLength) {
    throw truncatedInput('TIFF numeric CMYK sample is truncated')
  }
  const sampleFormat = description.sampleFormats[sample]
  if (sampleFormat === sampleFormatSigned) {
    if (bitDepth === 8) return view.getInt8(source)
    if (bitDepth === 16) return view.getInt16(source, description.littleEndian)
  } else if (sampleFormat === sampleFormatFloat) {
    if (bitDepth === 16) {
      return halfFloatValue(view.getUint16(source, description.littleEndian))
    }
    if (bitDepth === 32) return view.getFloat32(source, description.littleEndian)
    if (bitDepth === 64) return view.getFloat64(source, description.littleEndian)
  }
  throw invalidInput('TIFF numeric CMYK sample format is invalid')
}

const writeRawSample = (
  output: Uint8Array,
  target: number,
  planes: readonly Uint8Array[],
  description: TiffDescription,
  rowWithinSegment: number,
  x: number,
  sample: number,
  outputBytesPerSample: 1 | 2 | 4 | 8,
): void => {
  const bitDepth = description.bitsPerSample[sample]
  if (bitDepth === undefined || (bitDepth & 7) !== 0) {
    throw invalidInput('TIFF raw numeric sample layout is invalid')
  }
  const bytesPerSample = bitDepth >>> 3
  let plane: Uint8Array | undefined
  let source: number
  if (description.planarConfiguration === 2) {
    plane = planes[sample]
    const rowBytes = description.rowBytes[sample]
    if (rowBytes === undefined) throw invalidInput('TIFF numeric sample row size is missing')
    source = rowWithinSegment * rowBytes + x * bytesPerSample
  } else {
    plane = planes[0]
    const rowBytes = description.rowBytes[0]
    const sampleBitOffset = description.sampleBitOffsets[sample]
    if (rowBytes === undefined || sampleBitOffset === undefined || (sampleBitOffset & 7) !== 0) {
      throw invalidInput('TIFF numeric chunky sample layout is invalid')
    }
    source =
      rowWithinSegment * rowBytes + x * (description.bitsPerPixel >>> 3) + (sampleBitOffset >>> 3)
  }
  if (!plane || source < 0 || source + bytesPerSample > plane.byteLength) {
    throw truncatedInput('TIFF numeric sample is truncated')
  }
  const padding = outputBytesPerSample - bytesPerSample
  output.fill(0, target, target + padding)
  const outputStart = target + padding
  if (bytesPerSample === 1 || !description.littleEndian) {
    output.set(plane.subarray(source, source + bytesPerSample), outputStart)
    return
  }
  for (let byte = 0; byte < bytesPerSample; byte += 1) {
    output[outputStart + byte] = plane[source + bytesPerSample - byte - 1] ?? 0
  }
}

const scaleSample = (value: number, bits: number, maximum: 255 | 65_535): number => {
  if (maximum === 255) {
    return bits === 8 ? value : Math.floor((value * 255) / ((1 << bits) - 1))
  }
  return bits === 16 ? value : Math.round((value * 65_535) / (2 ** bits - 1))
}

const clampByte = (value: number): number => Math.max(0, Math.min(255, Math.round(value)))

const cmykCoverage = (value: number, sample: number, description: TiffDescription): number => {
  if (description.sampleFormats[sample] === sampleFormatUnsigned) {
    const low = description.cmykDotRange?.[sample * 2] ?? 0
    const high = description.cmykDotRange?.[sample * 2 + 1] ?? 255
    return clampByte(((value - low) * 255) / (high - low))
  }
  const range = description.displayRanges?.[sample]
  if (!range) throw invalidInput('TIFF numeric CMYK display range is missing')
  if (Number.isNaN(value) || value <= range.black) return 0
  if (value >= range.white) return 255
  return Math.floor(
    Math.round(((value - range.black) * 65_535) / (range.white - range.black)) / 257,
  )
}

const ycbcrSampleAt = (
  planes: readonly Uint8Array[],
  description: TiffDescription,
  row: number,
  x: number,
  sample: number,
): number => {
  const ycbcr = description.ycbcr
  if (!ycbcr) throw invalidInput('TIFF YCbCr metadata is missing')
  if (description.planarConfiguration === 2) {
    return sampleAt(planes, description, row, x, sample)
  }
  const plane = planes[0]
  if (!plane) throw truncatedInput('TIFF YCbCr segment is missing')
  const horizontal = ycbcr.horizontalSubsampling
  const vertical = ycbcr.verticalSubsampling
  const unitYCount = horizontal * vertical
  const unitBytes = unitYCount + 2
  const unitsAcross = Math.ceil(description.segmentWidth / horizontal)
  const unitX = Math.floor(x / horizontal)
  const unitY = Math.floor(row / vertical)
  const unitOffset = (unitY * unitsAcross + unitX) * unitBytes
  const offset =
    sample === 0
      ? unitOffset + (row % vertical) * horizontal + (x % horizontal)
      : unitOffset + unitYCount + sample - 1
  const value = plane[offset]
  if (value === undefined) throw truncatedInput('TIFF YCbCr data unit is truncated')
  return value
}

const ycbcrRgb = (
  planes: readonly Uint8Array[],
  description: TiffDescription,
  row: number,
  x: number,
): number => {
  const ycbcr = description.ycbcr
  if (!ycbcr) throw invalidInput('TIFF YCbCr metadata is missing')
  const reference = ycbcr.referenceBlackWhite
  const y =
    ((ycbcrSampleAt(planes, description, row, x, 0) - (reference[0] ?? 0)) * 255) /
    ((reference[1] ?? 255) - (reference[0] ?? 0))
  const cb =
    ((ycbcrSampleAt(planes, description, row, x, 1) - (reference[2] ?? 128)) * 127) /
    ((reference[3] ?? 255) - (reference[2] ?? 128))
  const cr =
    ((ycbcrSampleAt(planes, description, row, x, 2) - (reference[4] ?? 128)) * 127) /
    ((reference[5] ?? 255) - (reference[4] ?? 128))
  const red = y + cr * (2 - 2 * ycbcr.lumaRed)
  const blue = y + cb * (2 - 2 * ycbcr.lumaBlue)
  const green = (y - ycbcr.lumaBlue * blue - ycbcr.lumaRed * red) / ycbcr.lumaGreen
  return (clampByte(red) << 16) | (clampByte(green) << 8) | clampByte(blue)
}

const unassociate = (value: number, alpha: number, maximum: 255 | 65_535): number =>
  alpha === 0
    ? 0
    : alpha === maximum
      ? value
      : Math.min(maximum, Math.round((value * maximum) / alpha))

const writeUint16BigEndian = (output: Uint8Array, offset: number, value: number): void => {
  output[offset] = value >>> 8
  output[offset + 1] = value
}

const rasterSampleType = (description: TiffDescription): RasterSampleType => {
  const bits = description.bitsPerSample[0]
  const format = description.sampleFormats[0]
  if (format === sampleFormatUnsigned) {
    if (bits === 8) return 'uint8'
    if (bits === 16) return 'uint16'
    if (bits === 32) return 'uint32'
    if (bits === 64) return 'uint64'
  } else if (format === sampleFormatSigned) {
    if (bits === 8) return 'int8'
    if (bits === 16) return 'int16'
    if (bits === 32) return 'int32'
  } else if (format === sampleFormatFloat) {
    if (bits === 16) return 'float16'
    if (bits === 32) return 'float32'
    if (bits === 64) return 'float64'
  }
  throw unsupportedOperation('TIFF raster sample type is unsupported')
}

const decodeRasterPlanes = async (
  source: ImageSource,
  description: TiffDescription,
  logicalSegment: number,
  segmentRows: number,
): Promise<readonly Uint8Array[]> => {
  if (description.planarConfiguration === 1) {
    const rowBytes = description.rowBytes[0]
    if (rowBytes === undefined) throw invalidInput('TIFF chunky row size is missing')
    return [
      await decodeSegment(
        source,
        description,
        logicalSegment,
        rowBytes * segmentRows,
        rowBytes,
        segmentRows,
        description.samplesPerPixel,
      ),
    ]
  }
  const planes: Uint8Array[] = []
  for (let sample = 0; sample < description.samplesPerPixel; sample += 1) {
    const rowBytes = description.rowBytes[sample]
    if (rowBytes === undefined) throw invalidInput('TIFF planar row size is missing')
    planes.push(
      await decodeSegment(
        source,
        description,
        sample * description.segmentsPerPlane + logicalSegment,
        rowBytes * segmentRows,
        rowBytes,
        segmentRows,
        1,
      ),
    )
  }
  return planes
}

class TiffRasterDecoder implements RasterDecoder {
  readonly width: number
  readonly height: number
  readonly format: RasterFormat
  readonly #source: ImageSource
  readonly #description: TiffDescription
  readonly #limits: ImageLimits
  readonly #bytesPerSample: 1 | 2 | 4 | 8

  constructor(source: ImageSource, description: TiffDescription, limits: ImageLimits) {
    this.#source = source
    this.#description = description
    this.#limits = limits
    this.width = description.width
    this.height = description.height
    const bits = description.bitsPerSample[0] ?? 0
    this.#bytesPerSample = (bits >>> 3) as 1 | 2 | 4 | 8
    this.format = Object.freeze({
      sampleType: rasterSampleType(description),
      channels: description.samplesPerPixel,
      planar: description.planarConfiguration === 2,
    })
  }

  async *decode(request: RasterDecodeRequest = {}): AsyncGenerator<RasterBlock> {
    throwIfAborted(request.signal)
    const region = regionFor(this.#description, request)
    const firstSegmentRow = Math.floor(region.y / this.#description.segmentHeight)
    const lastSegmentRow = Math.floor(
      (region.y + region.height - 1) / this.#description.segmentHeight,
    )
    const firstSegmentColumn = Math.floor(region.x / this.#description.segmentWidth)
    const lastSegmentColumn = Math.floor(
      (region.x + region.width - 1) / this.#description.segmentWidth,
    )
    const rowBytes =
      region.width * this.#bytesPerSample * (this.format.planar ? 1 : this.format.channels)
    if (!Number.isSafeInteger(rowBytes)) throw limitExceeded('TIFF raster row is too large')

    for (let segmentRow = firstSegmentRow; segmentRow <= lastSegmentRow; segmentRow += 1) {
      throwIfAborted(request.signal)
      const segmentY = segmentRow * this.#description.segmentHeight
      const segmentRows = this.#description.tiled
        ? this.#description.segmentHeight
        : Math.min(this.#description.segmentHeight, this.height - segmentY)
      const decodedSegments: (readonly Uint8Array[])[] = []
      for (
        let segmentColumn = firstSegmentColumn;
        segmentColumn <= lastSegmentColumn;
        segmentColumn += 1
      ) {
        const logicalSegment = segmentRow * this.#description.segmentsAcross + segmentColumn
        decodedSegments.push(
          await decodeRasterPlanes(this.#source, this.#description, logicalSegment, segmentRows),
        )
      }
      const intersectionStart = Math.max(region.y, segmentY)
      const intersectionEnd = Math.min(
        region.y + region.height,
        segmentY + segmentRows,
        this.height,
      )
      for (let imageY = intersectionStart; imageY < intersectionEnd; imageY += blockRows) {
        throwIfAborted(request.signal)
        const rows = Math.min(blockRows, intersectionEnd - imageY)
        const planeStride = rowBytes * rows
        const outputBytes = planeStride * (this.format.planar ? this.format.channels : 1)
        if (!Number.isSafeInteger(outputBytes) || outputBytes > this.#limits.maxDecodedBytes) {
          throw limitExceeded(
            `TIFF raster block needs ${outputBytes} bytes; maxDecodedBytes is ${this.#limits.maxDecodedBytes}`,
          )
        }
        const output = new Uint8Array(outputBytes)
        for (
          let segmentColumn = firstSegmentColumn;
          segmentColumn <= lastSegmentColumn;
          segmentColumn += 1
        ) {
          const planes = decodedSegments[segmentColumn - firstSegmentColumn]
          if (!planes) throw truncatedInput('TIFF decoded raster segment is missing')
          const segmentX = segmentColumn * this.#description.segmentWidth
          const copyStart = Math.max(region.x, segmentX)
          const copyEnd = Math.min(
            region.x + region.width,
            segmentX + this.#description.segmentWidth,
            this.width,
          )
          const copyWidth = copyEnd - copyStart
          const localStartX = copyStart - segmentX
          const outputStartX = copyStart - region.x
          for (let localY = 0; localY < rows; localY += 1) {
            const rowWithinSegment = imageY + localY - segmentY
            for (let localX = 0; localX < copyWidth; localX += 1) {
              const sourceX = localStartX + localX
              const outputX = outputStartX + localX
              for (let sample = 0; sample < this.format.channels; sample += 1) {
                const target = this.format.planar
                  ? sample * planeStride + localY * rowBytes + outputX * this.#bytesPerSample
                  : localY * rowBytes +
                    (outputX * this.format.channels + sample) * this.#bytesPerSample
                writeRawSample(
                  output,
                  target,
                  planes,
                  this.#description,
                  rowWithinSegment,
                  sourceX,
                  sample,
                  this.#bytesPerSample,
                )
              }
            }
          }
        }
        throwIfAborted(request.signal)
        yield {
          x: 0,
          y: imageY - region.y,
          width: region.width,
          height: rows,
          stride: rowBytes,
          ...(this.format.planar ? { planeStride } : {}),
          format: this.format,
          data: output,
        }
      }
    }
  }
}

class TiffDecoder implements ImageDecoder {
  readonly width: number
  readonly height: number
  readonly pixelFormat: PixelFormat
  readonly capabilities
  readonly #source: ImageSource
  readonly #description: TiffDescription
  readonly #limits: ImageLimits
  readonly #webpCodec: ImageCodec | undefined

  constructor(
    source: ImageSource,
    description: TiffDescription,
    limits: ImageLimits,
    webpCodec?: ImageCodec,
  ) {
    if (description.pixelFormat === undefined) {
      throw invalidInput('TIFF display decoder requires a display pixel format')
    }
    this.#source = source
    this.#description = description
    this.#limits = limits
    this.#webpCodec = webpCodec
    this.width = description.width
    this.height = description.height
    this.pixelFormat = description.pixelFormat
    this.capabilities = Object.freeze({
      sequential: true,
      regionDecode: true,
      scaledDecode: false,
      progressive: false,
    })
  }

  async *decode(request: DecodeRequest = {}): AsyncGenerator<PixelBlock> {
    throwIfAborted(request.signal)
    const region = regionFor(this.#description, request)
    const sourceBitDepth = this.#description.bitsPerSample[0] ?? 8
    const numericCmyk =
      this.#description.photometric === photometricSeparated &&
      this.#description.sampleFormats[0] !== sampleFormatUnsigned
    const rawNumeric =
      !numericCmyk &&
      (this.#description.logLuvEncoding !== undefined ||
        this.#description.sampleFormats[0] !== sampleFormatUnsigned ||
        sourceBitDepth > 16)
    const output16 =
      this.pixelFormat === 'gray16' || this.pixelFormat === 'rgb16' || this.pixelFormat === 'rgba16'
    const outputMaximum = output16 ? 65_535 : 255
    const outputChannels = this.#description.logLuvEncoding
      ? this.#description.logLuvEncoding === 'logl16'
        ? 1
        : 3
      : rawNumeric
        ? this.#description.samplesPerPixel
        : this.pixelFormat === 'gray8' || this.pixelFormat === 'gray16'
          ? 1
          : this.pixelFormat === 'rgb8' || this.pixelFormat === 'rgb16'
            ? 3
            : 4
    const outputBytesPerSample: 1 | 2 | 4 | 8 = this.#description.logLuvEncoding
      ? 4
      : rawNumeric
        ? sourceBitDepth === 24
          ? 4
          : ((sourceBitDepth >>> 3) as 1 | 2 | 4 | 8)
        : output16
          ? 2
          : 1
    const outputBytesPerPixel = outputChannels * outputBytesPerSample
    const directChunkyChannels =
      this.#description.compression === compressionOldJpeg ||
      this.#description.compression === compressionJpeg ||
      this.#description.compression === compressionAperioJpeg2000Ycbcr ||
      this.#description.compression === compressionAperioJpeg2000Mct
        ? 3
        : this.#description.planarConfiguration === 1 &&
            this.#description.alphaSample === undefined &&
            this.#description.bitsPerSample.every((bits) => bits === 8)
          ? this.#description.photometric === photometricRgb
            ? 3
            : this.#description.photometric === photometricBlackIsZero
              ? 1
              : 0
          : 0
    const directLogLuvBytesPerPixel = this.#description.logLuvEncoding
      ? this.#description.logLuvEncoding === 'logl16'
        ? 4
        : 12
      : 0
    const directPackedRgb16Bits =
      this.pixelFormat === 'rgb16' &&
      this.#description.planarConfiguration === 1 &&
      this.#description.alphaSample === undefined &&
      this.#description.photometric === photometricRgb &&
      this.#description.bitsPerSample.length === 3 &&
      this.#description.bitsPerSample.every(
        (bits) => bits === this.#description.bitsPerSample[0],
      ) &&
      (this.#description.bitsPerSample[0] === 10 ||
        this.#description.bitsPerSample[0] === 12 ||
        this.#description.bitsPerSample[0] === 14)
        ? this.#description.bitsPerSample[0]
        : 0
    const directPalette8 =
      this.pixelFormat === 'rgb8' &&
      this.#description.photometric === photometricPalette &&
      this.#description.samplesPerPixel === 1 &&
      this.#description.bitsPerSample[0] === 8
    const firstSegmentRow = Math.floor(region.y / this.#description.segmentHeight)
    const lastSegmentRow = Math.floor(
      (region.y + region.height - 1) / this.#description.segmentHeight,
    )
    const firstSegmentColumn = Math.floor(region.x / this.#description.segmentWidth)
    const lastSegmentColumn = Math.floor(
      (region.x + region.width - 1) / this.#description.segmentWidth,
    )

    for (let segmentRow = firstSegmentRow; segmentRow <= lastSegmentRow; segmentRow += 1) {
      throwIfAborted(request.signal)
      const segmentY = segmentRow * this.#description.segmentHeight
      const segmentRows = this.#description.tiled
        ? this.#description.segmentHeight
        : Math.min(this.#description.segmentHeight, this.height - segmentY)
      const decodedSegments: Uint8Array[][] = []
      for (
        let segmentColumn = firstSegmentColumn;
        segmentColumn <= lastSegmentColumn;
        segmentColumn += 1
      ) {
        const logicalSegment = segmentRow * this.#description.segmentsAcross + segmentColumn
        const planes: Uint8Array[] = []
        if (this.#description.compression === compressionWebp) {
          planes.push(
            await decodeWebpSegment(
              this.#source,
              this.#description,
              this.#limits,
              this.#webpCodec,
              logicalSegment,
              segmentRows,
            ),
          )
        } else if (
          this.#description.compression === compressionAperioJpeg2000Ycbcr ||
          this.#description.compression === compressionAperioJpeg2000Mct
        ) {
          planes.push(
            await decodeJpeg2000Segment(
              this.#source,
              this.#description,
              this.#limits,
              logicalSegment,
              segmentRows,
            ),
          )
        } else if (
          this.#description.compression === compressionOldJpeg ||
          this.#description.compression === compressionJpeg
        ) {
          planes.push(
            await decodeJpegSegment(
              this.#source,
              this.#description,
              this.#limits,
              logicalSegment,
              segmentRows,
            ),
          )
        } else if (this.#description.planarConfiguration === 1) {
          const rowBytes = this.#description.rowBytes[0]
          if (rowBytes === undefined) throw invalidInput('TIFF chunky row size is missing')
          const expectedBytes = chunkySegmentBytes(this.#description, rowBytes, segmentRows)
          planes.push(
            await decodeSegment(
              this.#source,
              this.#description,
              logicalSegment,
              expectedBytes,
              rowBytes,
              segmentRows,
              this.#description.samplesPerPixel,
            ),
          )
        } else {
          for (let sample = 0; sample < this.#description.samplesPerPixel; sample += 1) {
            const rowBytes = this.#description.rowBytes[sample]
            if (rowBytes === undefined) throw invalidInput('TIFF planar row size is missing')
            planes.push(
              await decodeSegment(
                this.#source,
                this.#description,
                sample * this.#description.segmentsPerPlane + logicalSegment,
                rowBytes * segmentRows,
                rowBytes,
                segmentRows,
                1,
              ),
            )
          }
        }
        decodedSegments.push(planes)
      }

      const intersectionStart = Math.max(region.y, segmentY)
      const intersectionEnd = Math.min(
        region.y + region.height,
        segmentY + segmentRows,
        this.height,
      )
      for (let imageY = intersectionStart; imageY < intersectionEnd; imageY += blockRows) {
        const rows = Math.min(blockRows, intersectionEnd - imageY)
        const output = new Uint8Array(region.width * rows * outputBytesPerPixel)
        for (
          let segmentColumn = firstSegmentColumn;
          segmentColumn <= lastSegmentColumn;
          segmentColumn += 1
        ) {
          const planes = decodedSegments[segmentColumn - firstSegmentColumn]
          if (!planes) throw truncatedInput('TIFF decoded segment is missing')
          const segmentX = segmentColumn * this.#description.segmentWidth
          const copyStart = Math.max(region.x, segmentX)
          const copyEnd = Math.min(
            region.x + region.width,
            segmentX + this.#description.segmentWidth,
            this.width,
          )
          const copyWidth = copyEnd - copyStart
          const localStartX = copyStart - segmentX
          const outputStartX = copyStart - region.x
          if (directLogLuvBytesPerPixel > 0) {
            const plane = planes[0]
            if (!plane) throw truncatedInput('TIFF LogLuv segment is missing')
            const sourceRowBytes = this.#description.segmentWidth * directLogLuvBytesPerPixel
            const copyBytes = copyWidth * directLogLuvBytesPerPixel
            for (let localY = 0; localY < rows; localY += 1) {
              const rowWithinSegment = imageY + localY - segmentY
              const sourceStart =
                rowWithinSegment * sourceRowBytes + localStartX * directLogLuvBytesPerPixel
              const targetStart =
                localY * region.width * outputBytesPerPixel + outputStartX * outputBytesPerPixel
              output.set(plane.subarray(sourceStart, sourceStart + copyBytes), targetStart)
            }
            continue
          }
          if (directChunkyChannels > 0) {
            const plane = planes[0]
            if (!plane) throw truncatedInput('TIFF chunky segment is missing')
            const sourceRowBytes = this.#description.segmentWidth * directChunkyChannels
            const copyBytes = copyWidth * directChunkyChannels
            for (let localY = 0; localY < rows; localY += 1) {
              const rowWithinSegment = imageY + localY - segmentY
              const sourceStart =
                rowWithinSegment * sourceRowBytes + localStartX * directChunkyChannels
              const targetStart =
                localY * region.width * outputBytesPerPixel + outputStartX * outputBytesPerPixel
              output.set(plane.subarray(sourceStart, sourceStart + copyBytes), targetStart)
            }
            continue
          }
          if (directPackedRgb16Bits > 0) {
            const plane = planes[0]
            const sourceRowBytes = this.#description.rowBytes[0]
            if (!plane || sourceRowBytes === undefined) {
              throw truncatedInput('TIFF packed RGB segment is missing')
            }
            const sourceMaximum = (1 << directPackedRgb16Bits) - 1
            for (let localY = 0; localY < rows; localY += 1) {
              const rowWithinSegment = imageY + localY - segmentY
              let sourceBit =
                rowWithinSegment * sourceRowBytes * 8 + localStartX * directPackedRgb16Bits * 3
              let target =
                localY * region.width * outputBytesPerPixel + outputStartX * outputBytesPerPixel
              for (let localX = 0; localX < copyWidth; localX += 1) {
                const red = readPackedUnsigned(plane, sourceBit, directPackedRgb16Bits)
                sourceBit += directPackedRgb16Bits
                const green = readPackedUnsigned(plane, sourceBit, directPackedRgb16Bits)
                sourceBit += directPackedRgb16Bits
                const blue = readPackedUnsigned(plane, sourceBit, directPackedRgb16Bits)
                sourceBit += directPackedRgb16Bits
                writeUint16BigEndian(output, target, Math.round((red * 65_535) / sourceMaximum))
                writeUint16BigEndian(
                  output,
                  target + 2,
                  Math.round((green * 65_535) / sourceMaximum),
                )
                writeUint16BigEndian(
                  output,
                  target + 4,
                  Math.round((blue * 65_535) / sourceMaximum),
                )
                target += 6
              }
            }
            continue
          }
          if (directPalette8) {
            const plane = planes[0]
            const sourceRowBytes = this.#description.rowBytes[0]
            const palette = this.#description.palette
            if (!plane || sourceRowBytes === undefined || !palette) {
              throw truncatedInput('TIFF palette segment is missing')
            }
            for (let localY = 0; localY < rows; localY += 1) {
              const rowWithinSegment = imageY + localY - segmentY
              let source = rowWithinSegment * sourceRowBytes + localStartX
              let target =
                localY * region.width * outputBytesPerPixel + outputStartX * outputBytesPerPixel
              for (let localX = 0; localX < copyWidth; localX += 1) {
                const paletteOffset = (plane[source] ?? 0) * 3
                output[target] = palette[paletteOffset] ?? 0
                output[target + 1] = palette[paletteOffset + 1] ?? 0
                output[target + 2] = palette[paletteOffset + 2] ?? 0
                source += 1
                target += 3
              }
            }
            continue
          }
          const numericCmykViews = numericCmyk
            ? planes.map((plane) => new DataView(plane.buffer, plane.byteOffset, plane.byteLength))
            : undefined
          for (let localY = 0; localY < rows; localY += 1) {
            const rowWithinSegment = imageY + localY - segmentY
            for (let localX = 0; localX < copyWidth; localX += 1) {
              const sourceX = localStartX + localX
              const outputX = outputStartX + localX
              const target = (localY * region.width + outputX) * outputBytesPerPixel
              if (rawNumeric) {
                for (let sample = 0; sample < outputChannels; sample += 1) {
                  writeRawSample(
                    output,
                    target + sample * outputBytesPerSample,
                    planes,
                    this.#description,
                    rowWithinSegment,
                    sourceX,
                    sample,
                    outputBytesPerSample,
                  )
                }
                continue
              }
              const alpha =
                this.#description.alphaSample === undefined
                  ? outputMaximum
                  : scaleSample(
                      sampleAt(
                        planes,
                        this.#description,
                        rowWithinSegment,
                        sourceX,
                        this.#description.alphaSample,
                      ),
                      this.#description.bitsPerSample[this.#description.alphaSample] ?? 8,
                      outputMaximum,
                    )
              let red: number
              let green: number
              let blue: number
              if (this.#description.photometric === photometricYCbCr) {
                const rgb = ycbcrRgb(planes, this.#description, rowWithinSegment, sourceX)
                red = rgb >>> 16
                green = (rgb >>> 8) & 0xff
                blue = rgb & 0xff
              } else if (this.#description.photometric === photometricSeparated) {
                const cyan = cmykCoverage(
                  numericCmykViews
                    ? numericSampleAt(
                        numericCmykViews,
                        this.#description,
                        rowWithinSegment,
                        sourceX,
                        0,
                      )
                    : sampleAt(planes, this.#description, rowWithinSegment, sourceX, 0),
                  0,
                  this.#description,
                )
                const magenta = cmykCoverage(
                  numericCmykViews
                    ? numericSampleAt(
                        numericCmykViews,
                        this.#description,
                        rowWithinSegment,
                        sourceX,
                        1,
                      )
                    : sampleAt(planes, this.#description, rowWithinSegment, sourceX, 1),
                  1,
                  this.#description,
                )
                const yellow = cmykCoverage(
                  numericCmykViews
                    ? numericSampleAt(
                        numericCmykViews,
                        this.#description,
                        rowWithinSegment,
                        sourceX,
                        2,
                      )
                    : sampleAt(planes, this.#description, rowWithinSegment, sourceX, 2),
                  2,
                  this.#description,
                )
                const black = cmykCoverage(
                  numericCmykViews
                    ? numericSampleAt(
                        numericCmykViews,
                        this.#description,
                        rowWithinSegment,
                        sourceX,
                        3,
                      )
                    : sampleAt(planes, this.#description, rowWithinSegment, sourceX, 3),
                  3,
                  this.#description,
                )
                if (this.#description.cmykColorTransform) {
                  writeCmykIcc(
                    this.#description.cmykColorTransform,
                    cyan,
                    magenta,
                    yellow,
                    black,
                    output,
                    target,
                  )
                  red = output[target] ?? 0
                  green = output[target + 1] ?? 0
                  blue = output[target + 2] ?? 0
                } else {
                  red = Math.round(((255 - cyan) * (255 - black)) / 255)
                  green = Math.round(((255 - magenta) * (255 - black)) / 255)
                  blue = Math.round(((255 - yellow) * (255 - black)) / 255)
                }
              } else if (this.#description.photometric === photometricCieLab) {
                const lightness =
                  (sampleAt(planes, this.#description, rowWithinSegment, sourceX, 0) * 100) / 255
                let a = 0
                let b = 0
                if (this.#description.cieLabSamples === 3) {
                  const encodedA = sampleAt(planes, this.#description, rowWithinSegment, sourceX, 1)
                  const encodedB = sampleAt(planes, this.#description, rowWithinSegment, sourceX, 2)
                  a = encodedA < 128 ? encodedA : encodedA - 256
                  b = encodedB < 128 ? encodedB : encodedB - 256
                  if (a === -128 || b === -128) {
                    throw invalidInput('TIFF CIELab a* and b* samples must be within -127 to 127')
                  }
                }
                const rgb = tiffCieLabToSrgb(lightness, a, b)
                red = rgb >>> 16
                green = (rgb >>> 8) & 0xff
                blue = rgb & 0xff
              } else if (this.#description.photometric === photometricRgb) {
                red = scaleSample(
                  sampleAt(planes, this.#description, rowWithinSegment, sourceX, 0),
                  this.#description.bitsPerSample[0] ?? 8,
                  outputMaximum,
                )
                green = scaleSample(
                  sampleAt(planes, this.#description, rowWithinSegment, sourceX, 1),
                  this.#description.bitsPerSample[1] ?? 8,
                  outputMaximum,
                )
                blue = scaleSample(
                  sampleAt(planes, this.#description, rowWithinSegment, sourceX, 2),
                  this.#description.bitsPerSample[2] ?? 8,
                  outputMaximum,
                )
              } else if (this.#description.photometric === photometricPalette) {
                const index = sampleAt(planes, this.#description, rowWithinSegment, sourceX, 0)
                const paletteOffset = index * 3
                red = this.#description.palette?.[paletteOffset] ?? 0
                green = this.#description.palette?.[paletteOffset + 1] ?? 0
                blue = this.#description.palette?.[paletteOffset + 2] ?? 0
              } else {
                const bits = this.#description.bitsPerSample[0] ?? 8
                let gray = scaleSample(
                  sampleAt(planes, this.#description, rowWithinSegment, sourceX, 0),
                  bits,
                  outputMaximum,
                )
                if (this.#description.photometric === photometricWhiteIsZero) {
                  gray = outputMaximum - gray
                }
                red = gray
                green = gray
                blue = gray
              }
              if (this.#description.associatedAlpha) {
                red = unassociate(red, alpha, outputMaximum)
                green = unassociate(green, alpha, outputMaximum)
                blue = unassociate(blue, alpha, outputMaximum)
              }
              if (this.pixelFormat === 'gray8') {
                output[target] = red
              } else if (this.pixelFormat === 'gray16') {
                writeUint16BigEndian(output, target, red)
              } else if (output16) {
                writeUint16BigEndian(output, target, red)
                writeUint16BigEndian(output, target + 2, green)
                writeUint16BigEndian(output, target + 4, blue)
                if (this.pixelFormat === 'rgba16') {
                  writeUint16BigEndian(output, target + 6, alpha)
                }
              } else {
                output[target] = red
                output[target + 1] = green
                output[target + 2] = blue
                if (this.pixelFormat === 'rgba8') output[target + 3] = alpha
              }
            }
          }
        }
        throwIfAborted(request.signal)
        yield {
          x: 0,
          y: imageY - region.y,
          width: region.width,
          height: rows,
          stride: region.width * outputBytesPerPixel,
          format: this.pixelFormat,
          data: output,
          ...(this.#description.displayRanges
            ? { displayRanges: this.#description.displayRanges }
            : {}),
        }
      }
    }
  }
}

const metadata = (description: TiffDescription): ImageMetadata => ({
  width: description.width,
  height: description.height,
  format: 'tiff',
  mimeType: 'image/tiff',
  hasAlpha: description.alphaSample !== undefined,
  orientation: description.orientation,
  colorSpace:
    description.photometric === photometricRgb
      ? description.sampleFormats[0] === sampleFormatUnsigned
        ? 'srgb'
        : 'rgb'
      : description.photometric === photometricLogLuv
        ? 'cie-xyz'
        : description.photometric === photometricCieLab
          ? 'cie-lab'
          : description.photometric === photometricSeparated
            ? 'cmyk'
            : description.photometric === photometricYCbCr
              ? 'ycbcr'
              : description.photometric === photometricPalette
                ? 'indexed'
                : 'gray',
  bitDepth: description.logLuvEncoding ? 32 : Math.max(...description.bitsPerSample),
  sampleFormat: description.logLuvEncoding
    ? 'floating-point'
    : description.sampleFormats[0] === sampleFormatSigned
      ? 'signed-integer'
      : description.sampleFormats[0] === sampleFormatFloat
        ? 'floating-point'
        : 'unsigned-integer',
  frames: description.frames,
  resolutionLevels: description.resolutionLevels,
})

const tagFieldBytes = (fieldType: number, tag: number): 1 | 2 | 4 | 8 => {
  if (fieldType === 1 || fieldType === 2 || fieldType === 6 || fieldType === 7) return 1
  if (fieldType === 3 || fieldType === 8) return 2
  if (fieldType === 4 || fieldType === 9 || fieldType === 11 || fieldType === 13) return 4
  if (
    fieldType === 5 ||
    fieldType === 10 ||
    fieldType === 12 ||
    fieldType === 16 ||
    fieldType === 17 ||
    fieldType === 18
  ) {
    return 8
  }
  throw invalidInput(`TIFF tag ${tag} has unsupported field type ${fieldType}`)
}

interface PublicTagReadRequest {
  readonly entry: IfdEntry
  readonly maximumBytes: number
}

const publicTagReadRequest = (
  ifd: TiffIfd,
  tag: number,
  options: Readonly<TiffTagReadOptions>,
): PublicTagReadRequest | undefined => {
  if (!Number.isSafeInteger(tag) || tag < 0 || tag > 65_535) {
    throw invalidInput('TIFF tag number must be an unsigned 16-bit integer')
  }
  const entry = ifd.entries.get(tag)
  if (!entry) return undefined
  const maximumBytes = options.maxBytes ?? 1_048_576
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1) {
    throw invalidInput('TIFF tag maxBytes must be a positive safe integer')
  }
  const byteLength = entry.count * tagFieldBytes(entry.fieldType, tag)
  if (!Number.isSafeInteger(byteLength) || byteLength < 0) {
    throw invalidInput(`TIFF tag ${tag} byte length is invalid`)
  }
  if (byteLength > maximumBytes) {
    throw limitExceeded(`TIFF tag ${tag} needs ${byteLength} bytes; maxBytes is ${maximumBytes}`)
  }
  return { entry, maximumBytes }
}

const tagPayload = async (
  source: ImageSource,
  entry: IfdEntry,
  littleEndian: boolean,
  tag: number,
  maximumBytes: number,
): Promise<Uint8Array> => {
  const bytesPerValue = tagFieldBytes(entry.fieldType, tag)
  const byteLength = entry.count * bytesPerValue
  if (!Number.isSafeInteger(byteLength) || byteLength < 0) {
    throw invalidInput(`TIFF tag ${tag} byte length is invalid`)
  }
  if (byteLength > maximumBytes) {
    throw limitExceeded(`TIFF tag ${tag} needs ${byteLength} bytes; maxBytes is ${maximumBytes}`)
  }
  if (byteLength <= entry.inline.byteLength) return entry.inline.slice(0, byteLength)
  const offset = externalValueOffset(entry, littleEndian, tag)
  checkedEnd(offset, byteLength, source.size, `tag ${tag}`)
  return Uint8Array.from(await readExactly(source, offset, byteLength))
}

const readPublicTag = async (
  source: ImageSource,
  ifd: TiffIfd,
  littleEndian: boolean,
  tag: number,
  options: Readonly<TiffTagReadOptions>,
): Promise<TiffTagValue | undefined> => {
  const request = publicTagReadRequest(ifd, tag, options)
  if (!request) return undefined
  const bytes = await tagPayload(source, request.entry, littleEndian, tag, request.maximumBytes)
  const { entry } = request
  if (entry.fieldType === 2) {
    let end = bytes.byteLength
    while (end > 0 && bytes[end - 1] === 0) end -= 1
    if (bytes.subarray(0, end).includes(0)) {
      throw invalidInput(`TIFF ASCII tag ${tag} contains NUL`)
    }
    try {
      return {
        kind: 'ascii',
        value: new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, end)),
      }
    } catch {
      throw invalidInput(`TIFF ASCII tag ${tag} is not valid UTF-8`)
    }
  }
  if (entry.fieldType === 7) return { kind: 'bytes', value: bytes }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (entry.fieldType === 16 || entry.fieldType === 17 || entry.fieldType === 18) {
    const values: bigint[] = []
    for (let index = 0; index < entry.count; index += 1) {
      const offset = index * 8
      values.push(
        entry.fieldType === 17
          ? view.getBigInt64(offset, littleEndian)
          : view.getBigUint64(offset, littleEndian),
      )
    }
    return { kind: 'bigints', values: Object.freeze(values) }
  }
  const values: number[] = []
  for (let index = 0; index < entry.count; index += 1) {
    const offset = index * tagFieldBytes(entry.fieldType, tag)
    if (entry.fieldType === 1) values.push(view.getUint8(offset))
    else if (entry.fieldType === 3) values.push(view.getUint16(offset, littleEndian))
    else if (entry.fieldType === 4 || entry.fieldType === 13) {
      values.push(view.getUint32(offset, littleEndian))
    } else if (entry.fieldType === 5) {
      const denominator = view.getUint32(offset + 4, littleEndian)
      if (denominator === 0) throw invalidInput(`TIFF tag ${tag} has a zero denominator`)
      values.push(view.getUint32(offset, littleEndian) / denominator)
    } else if (entry.fieldType === 6) values.push(view.getInt8(offset))
    else if (entry.fieldType === 8) values.push(view.getInt16(offset, littleEndian))
    else if (entry.fieldType === 9) values.push(view.getInt32(offset, littleEndian))
    else if (entry.fieldType === 10) {
      const denominator = view.getInt32(offset + 4, littleEndian)
      if (denominator === 0) throw invalidInput(`TIFF tag ${tag} has a zero denominator`)
      values.push(view.getInt32(offset, littleEndian) / denominator)
    } else if (entry.fieldType === 11) values.push(view.getFloat32(offset, littleEndian))
    else if (entry.fieldType === 12) values.push(view.getFloat64(offset, littleEndian))
  }
  return { kind: 'numbers', values: Object.freeze(values) }
}

const cachedPublicTag = (value: TiffTagValue | undefined): TiffTagValue | undefined =>
  value === undefined ? undefined : Object.freeze(value)

const publicTagResult = (value: TiffTagValue | undefined): TiffTagValue | undefined =>
  value?.kind === 'bytes' ? Object.freeze({ kind: 'bytes', value: value.value.slice() }) : value

class PublicTiffDirectory implements TiffDirectory {
  readonly index: number
  readonly offset: number
  readonly width: number
  readonly height: number
  readonly compression: number
  readonly photometric: number
  readonly samplesPerPixel: number
  readonly bitsPerSample: readonly number[]
  readonly sampleFormats: readonly number[]
  readonly planar: boolean
  readonly tiled: boolean
  readonly tileWidth?: number
  readonly tileHeight?: number
  #subIfds: readonly TiffDirectory[] = Object.freeze([])
  readonly #source: ImageSource
  readonly #limits: ImageLimits
  readonly #graph: TiffIfdGraph
  readonly #ifd: TiffIfd
  readonly #embeddedCodecs: readonly ImageCodec[]
  readonly #tagCache = new Map<number, Promise<TiffTagValue | undefined>>()

  private constructor(options: {
    readonly index: number
    readonly source: ImageSource
    readonly limits: ImageLimits
    readonly graph: TiffIfdGraph
    readonly ifd: TiffIfd
    readonly embeddedCodecs: readonly ImageCodec[]
    readonly width: number
    readonly height: number
    readonly compression: number
    readonly photometric: number
    readonly samplesPerPixel: number
    readonly bitsPerSample: readonly number[]
    readonly sampleFormats: readonly number[]
    readonly planar: boolean
    readonly tiled: boolean
    readonly tileWidth?: number
    readonly tileHeight?: number
  }) {
    this.index = options.index
    this.offset = options.ifd.offset
    this.#source = options.source
    this.#limits = options.limits
    this.#graph = options.graph
    this.#ifd = options.ifd
    this.#embeddedCodecs = options.embeddedCodecs
    this.width = options.width
    this.height = options.height
    this.compression = options.compression
    this.photometric = options.photometric
    this.samplesPerPixel = options.samplesPerPixel
    this.bitsPerSample = options.bitsPerSample
    this.sampleFormats = options.sampleFormats
    this.planar = options.planar
    this.tiled = options.tiled
    if (options.tileWidth !== undefined) this.tileWidth = options.tileWidth
    if (options.tileHeight !== undefined) this.tileHeight = options.tileHeight
  }

  static async create(options: {
    readonly index: number
    readonly source: ImageSource
    readonly limits: ImageLimits
    readonly graph: TiffIfdGraph
    readonly ifd: TiffIfd
    readonly embeddedCodecs: readonly ImageCodec[]
  }): Promise<PublicTiffDirectory> {
    const { source, graph, ifd, limits } = options
    const width = await singleValue(source, ifd, graph.littleEndian, 256)
    const height = await singleValue(source, ifd, graph.littleEndian, 257)
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1) {
      throw invalidInput(`Invalid TIFF directory dimensions: ${width}x${height}`)
    }
    if (width > limits.maxWidth || height > limits.maxHeight) {
      throw limitExceeded(`TIFF directory ${width}x${height} exceeds configured dimensions`)
    }
    const samplesPerPixel = await singleValue(source, ifd, graph.littleEndian, 277, 1)
    if (!Number.isSafeInteger(samplesPerPixel) || samplesPerPixel < 1 || samplesPerPixel > 65_535) {
      throw invalidInput(`TIFF SamplesPerPixel ${samplesPerPixel} is invalid`)
    }
    const rawBits =
      (await optionalValues(source, ifd, graph.littleEndian, 258, samplesPerPixel)) ??
      Float64Array.of(1)
    const bitsPerSample =
      rawBits.length === 1 && samplesPerPixel > 1
        ? new Array<number>(samplesPerPixel).fill(rawBits[0] ?? 1)
        : Array.from(rawBits)
    if (
      bitsPerSample.length !== samplesPerPixel ||
      bitsPerSample.some((bits) => !Number.isSafeInteger(bits) || bits < 1 || bits > 64)
    ) {
      throw invalidInput('TIFF BitsPerSample is invalid')
    }
    const rawFormats =
      (await optionalValues(source, ifd, graph.littleEndian, 339, samplesPerPixel)) ??
      Float64Array.of(sampleFormatUnsigned)
    const sampleFormats =
      rawFormats.length === 1 && samplesPerPixel > 1
        ? new Array<number>(samplesPerPixel).fill(rawFormats[0] ?? sampleFormatUnsigned)
        : Array.from(rawFormats)
    if (sampleFormats.length !== samplesPerPixel) {
      throw invalidInput('TIFF SampleFormat count does not match SamplesPerPixel')
    }
    const tiled = ifd.entries.has(322) || ifd.entries.has(323)
    const tileWidth = tiled ? await singleValue(source, ifd, graph.littleEndian, 322) : undefined
    const tileHeight = tiled ? await singleValue(source, ifd, graph.littleEndian, 323) : undefined
    return new PublicTiffDirectory({
      ...options,
      width,
      height,
      compression: await singleValue(source, ifd, graph.littleEndian, 259, compressionNone),
      photometric: await singleValue(source, ifd, graph.littleEndian, 262),
      samplesPerPixel,
      bitsPerSample: Object.freeze(bitsPerSample),
      sampleFormats: Object.freeze(sampleFormats),
      planar: (await singleValue(source, ifd, graph.littleEndian, 284, 1)) === 2,
      tiled,
      ...(tileWidth === undefined ? {} : { tileWidth }),
      ...(tileHeight === undefined ? {} : { tileHeight }),
    })
  }

  get subIfds(): readonly TiffDirectory[] {
    return this.#subIfds
  }

  setSubIfds(subIfds: readonly TiffDirectory[]): void {
    this.#subIfds = Object.freeze([...subIfds])
  }

  async getTag(
    tag: number,
    options: Readonly<TiffTagReadOptions> = {},
  ): Promise<TiffTagValue | undefined> {
    const request = publicTagReadRequest(this.#ifd, tag, options)
    if (!request) return undefined
    const source = bindImageSourceSignal(this.#source, options.signal)
    if (options.signal !== undefined) {
      return publicTagResult(
        await readPublicTag(source, this.#ifd, this.#graph.littleEndian, tag, {
          maxBytes: request.maximumBytes,
        }),
      )
    }
    let pending = this.#tagCache.get(tag)
    if (!pending) {
      pending = readPublicTag(source, this.#ifd, this.#graph.littleEndian, tag, {
        maxBytes: request.maximumBytes,
      }).then(cachedPublicTag)
      this.#tagCache.set(tag, pending)
      pending.catch(() => {
        if (this.#tagCache.get(tag) === pending) this.#tagCache.delete(tag)
      })
    }
    return publicTagResult(await pending)
  }

  async createImageDecoder(options: Readonly<AbortOptions> = {}): Promise<ImageDecoder> {
    const source = bindImageSourceSignal(this.#source, options.signal)
    const selected = { ifd: this.#ifd, frames: 1, resolutionLevels: this.#subIfds.length + 1 }
    const description = await describeTiffIfd(
      source,
      this.#limits,
      this.#graph,
      selected,
      {},
      'pixels',
    )
    const webpCodec = this.#embeddedCodecs.find((codec) => codec.format === 'webp')
    const applyColorTransform = description.colorTransform !== undefined
    const decoderDescription: TiffDescription =
      applyColorTransform && description.pixelFormat === 'rgb16'
        ? { ...description, pixelFormat: 'rgb8' }
        : description
    const decoder = new TiffDecoder(source, decoderDescription, this.#limits, webpCodec)
    return applyColorTransform
      ? new ColorManagedDecoder(decoder, description.colorTransform)
      : decoder
  }

  async createRasterDecoder(options: Readonly<AbortOptions> = {}): Promise<RasterDecoder> {
    const source = bindImageSourceSignal(this.#source, options.signal)
    const selected = { ifd: this.#ifd, frames: 1, resolutionLevels: this.#subIfds.length + 1 }
    return new TiffRasterDecoder(
      source,
      await describeTiffIfd(source, this.#limits, this.#graph, selected, {}, 'raster'),
      this.#limits,
    )
  }
}

class PublicTiffDocument implements TiffDocument {
  readonly littleEndian: boolean
  readonly bigTiff: boolean
  readonly directories: readonly TiffDirectory[]
  readonly topLevelDirectories: readonly TiffDirectory[]
  readonly #source: ImageSource
  readonly #byOffset: ReadonlyMap<number, TiffDirectory>

  constructor(
    source: ImageSource,
    graph: TiffIfdGraph,
    directories: readonly TiffDirectory[],
    topLevelDirectories: readonly TiffDirectory[],
    byOffset: ReadonlyMap<number, TiffDirectory>,
  ) {
    this.#source = source
    this.#byOffset = byOffset
    this.littleEndian = graph.littleEndian
    this.bigTiff = graph.layout.bigTiff
    this.directories = Object.freeze([...directories])
    this.topLevelDirectories = Object.freeze([...topLevelDirectories])
  }

  getDirectory(index: number): TiffDirectory | undefined {
    return Number.isSafeInteger(index) && index >= 0 ? this.directories[index] : undefined
  }

  getDirectoryByOffset(offset: number): TiffDirectory | undefined {
    return Number.isSafeInteger(offset) && offset >= 0 ? this.#byOffset.get(offset) : undefined
  }

  async readBytes(
    offset: number,
    length: number,
    options: Readonly<TiffByteReadOptions>,
  ): Promise<Uint8Array> {
    const maximumBytes = options?.maxBytes
    if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1) {
      throw invalidInput('TIFF byte read maxBytes must be a positive safe integer')
    }
    if (!Number.isSafeInteger(length) || length < 0) {
      throw invalidInput('TIFF byte read length must be a non-negative safe integer')
    }
    if (length > maximumBytes) {
      throw limitExceeded(`TIFF byte read needs ${length} bytes; maxBytes is ${maximumBytes}`)
    }
    checkedEnd(offset, length, this.#source.size, 'profile byte read')
    return Uint8Array.from(await readExactly(this.#source, offset, length, options))
  }
}

export const openTiffDocument = async (
  source: ImageSource,
  options: Readonly<TiffDocumentOptions> = {},
): Promise<TiffDocument> => {
  throwIfAborted(options.signal)
  const documentSource = bindImageSourceSignal(source, options.signal)
  const limits = resolveLimits(options)
  validateInputSize(documentSource.size, limits)
  const graph = await readTiffIfdGraph(documentSource, limits)
  const ifds = [...graph.directories.values()]
  const directories = await Promise.all(
    ifds.map((ifd, index) =>
      PublicTiffDirectory.create({
        index,
        source: documentSource,
        limits,
        graph,
        ifd,
        embeddedCodecs: options.embeddedCodecs ?? [],
      }),
    ),
  )
  const byOffset = new Map<number, PublicTiffDirectory>()
  for (let index = 0; index < ifds.length; index += 1) {
    throwIfAborted(options.signal)
    const ifd = ifds[index]
    const directory = directories[index]
    if (ifd && directory) byOffset.set(ifd.offset, directory)
  }
  for (let index = 0; index < ifds.length; index += 1) {
    throwIfAborted(options.signal)
    const ifd = ifds[index]
    const directory = directories[index]
    if (!ifd || !directory) continue
    const offsets = await subIfdOffsets(documentSource, ifd, graph.littleEndian, limits.maxFrames)
    const children = Array.from(offsets, (offset) => byOffset.get(offset)).filter(
      (child): child is PublicTiffDirectory => child !== undefined,
    )
    directory.setSubIfds(children)
  }
  const topLevelDirectories = graph.topLevel
    .map((ifd) => byOffset.get(ifd.offset))
    .filter((directory): directory is PublicTiffDirectory => directory !== undefined)
  throwIfAborted(options.signal)
  return new PublicTiffDocument(documentSource, graph, directories, topLevelDirectories, byOffset)
}

export interface TiffCodecOptions {
  readonly embeddedCodecs?: readonly ImageCodec[]
}

export const createTiffCodec = (options: Readonly<TiffCodecOptions> = {}): ImageCodec => {
  const webpCodec = options.embeddedCodecs?.find((codec) => codec.format === 'webp')
  return {
    format: 'tiff',
    mimeTypes: ['image/tiff', 'image/x-tiff'],
    minimumBytes: 4,
    selection: { frames: true, resolutionLevels: true },
    detect: isTiff,
    metadata: async (source, limits, decoderOptions = {}) => {
      const boundSource = bindImageSourceSignal(source, decoderOptions.signal)
      return metadata(await describeTiff(boundSource, limits, decoderOptions))
    },
    preservedMetadata: async (source, limits, preserveOptions): Promise<PreservedMetadata> => {
      if (preserveOptions?.exif)
        throw unsupportedOperation('Preserving EXIF from TIFF input is not implemented')
      const boundSource = bindImageSourceSignal(source, preserveOptions?.signal)
      const description = await describeTiff(boundSource, limits, preserveOptions)
      return description.iccProfile ? { icc: Uint8Array.from(description.iccProfile) } : {}
    },
    createDecoder: async (source, limits, decoderOptions: Readonly<DecoderOptions> = {}) => {
      const boundSource = bindImageSourceSignal(source, decoderOptions.signal)
      const description = await describeTiff(boundSource, limits, decoderOptions)
      const applyColorTransform = description.colorTransform && decoderOptions.preserveIcc !== true
      const decoderDescription: TiffDescription =
        applyColorTransform && description.pixelFormat === 'rgb16'
          ? { ...description, pixelFormat: 'rgb8' }
          : description
      const decoder = new TiffDecoder(boundSource, decoderDescription, limits, webpCodec)
      return applyColorTransform
        ? new ColorManagedDecoder(decoder, description.colorTransform)
        : decoder
    },
    createEncoder: async (sink, request) => TiffEncoder.create(sink, request),
  }
}

export const tiffCodec = createTiffCodec()
