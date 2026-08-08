import type {
  DecoderOptions,
  DecodeRequest,
  EncodeRequest,
  ImageCodec,
  ImageDecoder,
  ImageEncoder,
  ImageMetadata,
  PreservedMetadata,
} from '../codec.ts'
import { invalidInput, limitExceeded, truncatedInput, unsupportedOperation } from '../errors.ts'
import type { ImageLimits } from '../limits.ts'
import { validateImageDimensions } from '../limits.ts'
import { iccColorSpace } from '../metadata.ts'
import type { PixelBlock, PixelFormat } from '../pixel.ts'
import type { ImageSink } from '../sink.ts'
import type { ImageSource } from '../source.ts'
import { MemorySource, readExactly } from '../source.ts'
import {
  ColorManagedDecoder,
  MAX_ICC_PROFILE_BYTES,
  parseRgbIccTransform,
  type RgbIccTransform,
} from './icc.ts'
import { jpegCodec } from './jpeg.ts'

const blockRows = 32
const compressionNone = 1
const compressionCcittModifiedHuffman = 2
const compressionCcittGroup3 = 3
const compressionCcittGroup4 = 4
const compressionLzw = 5
const compressionOldJpeg = 6
const compressionJpeg = 7
const compressionDeflate = 8
const compressionAdobeDeflate = 32946
const compressionPackBits = 32773
const photometricWhiteIsZero = 0
const photometricBlackIsZero = 1
const photometricRgb = 2
const photometricPalette = 3
const photometricSeparated = 5
const photometricYCbCr = 6
const faxLookupBits = 13
const faxLookupSize = 1 << faxLookupBits

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
  readonly valueOffset: number
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
  readonly bitsPerPixel: number
  readonly sampleBitOffsets: Uint32Array
  readonly rowBytes: Uint32Array
  readonly compression: number
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
  readonly alphaSample: number | undefined
  readonly associatedAlpha: boolean
  readonly orientation: number
  readonly frames: number
  readonly pixelFormat: 'gray8' | 'rgb8' | 'rgba8'
  readonly colorTransform: RgbIccTransform | undefined
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
    if (entries.has(tag)) throw invalidInput(`TIFF IFD contains duplicate tag ${tag}`)
    const count = layout.bigTiff
      ? uint64(bytes, entryOffset + 4, littleEndian, `tag ${tag} count`)
      : uint32(bytes, entryOffset + 4, littleEndian)
    const valuePosition = entryOffset + (layout.bigTiff ? 12 : 8)
    entries.set(tag, {
      fieldType: uint16(bytes, entryOffset + 2, littleEndian),
      count,
      valueOffset: offsetValue(bytes, valuePosition, littleEndian, layout, `tag ${tag} offset`),
      inline: bytes.slice(valuePosition, valuePosition + layout.inlineBytes),
    })
  }

  const nextPosition = layout.countBytes + entryCount * layout.entryBytes
  return {
    offset,
    entries,
    nextOffset: offsetValue(bytes, nextPosition, littleEndian, layout, 'next IFD offset'),
  }
}

const fieldBytes = (fieldType: number): number => {
  if (fieldType === 1) return 1
  if (fieldType === 3) return 2
  if (fieldType === 4) return 4
  if (fieldType === 5) return 8
  if (fieldType === 16 || fieldType === 18) return 8
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
  const bytes =
    byteLength <= entry.inline.byteLength
      ? entry.inline.subarray(0, byteLength)
      : await readExactly(
          source,
          entry.valueOffset,
          checkedEnd(entry.valueOffset, byteLength, source.size, `tag ${tag}`) - entry.valueOffset,
        )
  const values = new Float64Array(entry.count)
  for (let index = 0; index < entry.count; index += 1) {
    const valueOffset = index * bytesPerValue
    values[index] =
      entry.fieldType === 1
        ? (bytes[valueOffset] ?? 0)
        : entry.fieldType === 3
          ? uint16(bytes, valueOffset, littleEndian)
          : entry.fieldType === 4
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
  const bytes =
    byteLength <= entry.inline.byteLength
      ? entry.inline.subarray(0, byteLength)
      : await readExactly(
          source,
          entry.valueOffset,
          checkedEnd(entry.valueOffset, byteLength, source.size, `tag ${tag}`) - entry.valueOffset,
        )
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
  tag: number,
): Promise<Uint8Array> => {
  if (entry.fieldType !== 7) throw invalidInput(`TIFF tag ${tag} must use the UNDEFINED field type`)
  if (entry.count < 1) throw invalidInput(`TIFF tag ${tag} is empty`)
  if (entry.count > MAX_ICC_PROFILE_BYTES) {
    throw limitExceeded(`TIFF tag ${tag} exceeds 16 MiB`)
  }
  return entry.count <= entry.inline.byteLength
    ? entry.inline.subarray(0, entry.count)
    : readExactly(
        source,
        entry.valueOffset,
        checkedEnd(entry.valueOffset, entry.count, source.size, `tag ${tag}`) - entry.valueOffset,
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

const countFrames = async (
  source: ImageSource,
  first: TiffIfd,
  littleEndian: boolean,
  layout: TiffLayout,
  limits: ImageLimits,
): Promise<number> => {
  let frames = 1
  let nextOffset = first.nextOffset
  const seen = new Set([first.offset])
  while (nextOffset !== 0) {
    if (seen.has(nextOffset)) throw invalidInput('TIFF top-level IFD chain contains a loop')
    seen.add(nextOffset)
    frames += 1
    if (frames > limits.maxFrames) {
      throw limitExceeded(`TIFF frame count exceeds maxFrames ${limits.maxFrames}`)
    }
    nextOffset = (await readIfd(source, nextOffset, littleEndian, layout)).nextOffset
  }
  return frames
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
    palette[index * 3] = (values[index] ?? 0) >>> 8
    palette[index * 3 + 1] = (values[colors + index] ?? 0) >>> 8
    palette[index * 3 + 2] = (values[colors * 2 + index] ?? 0) >>> 8
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

const describeTiff = async (source: ImageSource, limits: ImageLimits): Promise<TiffDescription> => {
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
  const firstIfdOffset = layout.bigTiff
    ? uint64(header, 8, littleEndian, 'first IFD offset')
    : uint32(header, 4, littleEndian)
  if (firstIfdOffset < (layout.bigTiff ? 16 : 8)) {
    throw invalidInput('TIFF first IFD offset is invalid')
  }
  const ifd = await readIfd(source, firstIfdOffset, littleEndian, layout)
  const width = await singleValue(source, ifd, littleEndian, 256)
  const height = await singleValue(source, ifd, littleEndian, 257)
  const frames = await countFrames(source, ifd, littleEndian, layout, limits)
  validateImageDimensions(width, height, frames, limits)

  const samplesPerPixel = await singleValue(source, ifd, littleEndian, 277, 1)
  if (!Number.isSafeInteger(samplesPerPixel) || samplesPerPixel < 1 || samplesPerPixel > 4) {
    throw unsupportedOperation(`TIFF SamplesPerPixel ${samplesPerPixel} is unsupported`)
  }
  const rawBits =
    (await optionalValues(source, ifd, littleEndian, 258, samplesPerPixel)) ?? Float64Array.of(1)
  if (rawBits.some((bits) => !Number.isSafeInteger(bits) || bits < 1 || bits > 32)) {
    throw invalidInput('TIFF BitsPerSample contains an invalid value')
  }
  const bitsPerSample =
    rawBits.length === 1 && samplesPerPixel > 1
      ? new Uint32Array(samplesPerPixel).fill(rawBits[0] ?? 1)
      : Uint32Array.from(rawBits)
  if (bitsPerSample.length !== samplesPerPixel) {
    throw invalidInput('TIFF BitsPerSample count does not match SamplesPerPixel')
  }

  const sampleFormats =
    (await optionalValues(source, ifd, littleEndian, 339, samplesPerPixel)) ?? Uint32Array.of(1)
  if (sampleFormats.some((format) => format !== 1)) {
    throw unsupportedOperation('TIFF currently supports only unsigned integer samples')
  }
  const compression = await singleValue(source, ifd, littleEndian, 259, compressionNone)
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
    compression !== compressionPackBits
  ) {
    throw unsupportedOperation(`TIFF compression ${compression} is unsupported`)
  }
  const photometric = await singleValue(source, ifd, littleEndian, 262)
  if (
    photometric !== photometricWhiteIsZero &&
    photometric !== photometricBlackIsZero &&
    photometric !== photometricRgb &&
    photometric !== photometricPalette &&
    photometric !== photometricSeparated &&
    photometric !== photometricYCbCr
  ) {
    throw unsupportedOperation(`TIFF photometric interpretation ${photometric} is unsupported`)
  }
  const baseSamples =
    photometric === photometricRgb || photometric === photometricYCbCr
      ? 3
      : photometric === photometricSeparated
        ? 4
        : 1
  if (samplesPerPixel < baseSamples || samplesPerPixel > baseSamples + 1) {
    throw unsupportedOperation('TIFF supports at most one alpha sample')
  }
  const alphaSample = samplesPerPixel === baseSamples + 1 ? baseSamples : undefined
  const extraSamples =
    (await optionalValues(source, ifd, littleEndian, 338, samplesPerPixel - baseSamples)) ??
    new Uint32Array()
  if (
    extraSamples.length > 1 ||
    extraSamples.some((value) => value !== 0 && value !== 1 && value !== 2)
  ) {
    throw unsupportedOperation('TIFF extra sample metadata is unsupported')
  }
  if (extraSamples.length > 0 && alphaSample === undefined) {
    throw invalidInput('TIFF ExtraSamples does not match SamplesPerPixel')
  }

  const baseBitDepth = bitsPerSample[0] ?? 0
  if (photometric === photometricRgb || photometric === photometricSeparated) {
    if (
      (baseBitDepth !== 8 && baseBitDepth !== 16) ||
      bitsPerSample.some((bits) => bits !== baseBitDepth)
    ) {
      throw unsupportedOperation('TIFF color decoding requires uniform 8-bit or 16-bit samples')
    }
  } else if (photometric === photometricYCbCr) {
    if (bitsPerSample.some((bits) => bits !== 8)) {
      throw unsupportedOperation('TIFF YCbCr decoding requires 8-bit samples')
    }
  } else if (![1, 2, 4, 8, 16].includes(baseBitDepth)) {
    throw unsupportedOperation(`TIFF ${baseBitDepth}-bit grayscale or palette data is unsupported`)
  }
  if (
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
  if (fillOrder !== 1 && !(fillOrder === 2 && faxCompression)) {
    throw unsupportedOperation(`TIFF FillOrder ${fillOrder} is unsupported`)
  }
  const planarConfiguration = await singleValue(source, ifd, littleEndian, 284, 1)
  if (planarConfiguration !== 1 && planarConfiguration !== 2) {
    throw unsupportedOperation(`TIFF PlanarConfiguration ${planarConfiguration} is unsupported`)
  }
  if (planarConfiguration === 1 && alphaSample !== undefined && baseBitDepth < 8) {
    throw unsupportedOperation('TIFF packed grayscale or palette alpha requires planar storage')
  }
  const predictor = await singleValue(source, ifd, littleEndian, 317, 1)
  if (predictor !== 1 && predictor !== 2) {
    throw unsupportedOperation(`TIFF Predictor ${predictor} is unsupported`)
  }
  if (
    predictor === 2 &&
    (bitsPerSample.some((bits) => bits !== baseBitDepth) ||
      (baseBitDepth !== 8 && baseBitDepth !== 16))
  ) {
    throw unsupportedOperation(
      'TIFF horizontal prediction requires uniform 8-bit or 16-bit samples',
    )
  }
  if (faxCompression && (samplesPerPixel !== 1 || baseBitDepth !== 1 || predictor !== 1)) {
    throw unsupportedOperation('TIFF CCITT fax decoding requires one 1-bit bilevel sample')
  }
  const jpegCompression = compression === compressionOldJpeg || compression === compressionJpeg
  const jpegSamplesMatchPhotometric =
    (samplesPerPixel === 1 && photometric === photometricBlackIsZero) ||
    (samplesPerPixel === 3 &&
      (photometric === photometricRgb || photometric === photometricYCbCr)) ||
    (samplesPerPixel === 4 && photometric === photometricSeparated)
  if (
    jpegCompression &&
    (!jpegSamplesMatchPhotometric ||
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

  const tileTags = [322, 323, 324, 325]
  const presentTileTags = tileTags.filter((tag) => ifd.entries.has(tag)).length
  if (presentTileTags !== 0 && presentTileTags !== tileTags.length) {
    throw invalidInput('TIFF tiled image is missing a required tile tag')
  }
  const tiled = presentTileTags === tileTags.length
  const presentStripTags = Number(ifd.entries.has(273)) + Number(ifd.entries.has(279))
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
    offsetTag = 324
    byteCountTag = 325
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
  if (photometric === photometricSeparated) {
    const inkSet = await singleValue(source, ifd, littleEndian, 332, 1)
    const numberOfInks = await singleValue(source, ifd, littleEndian, 334, 4)
    if (inkSet !== 1 || numberOfInks !== 4 || samplesPerPixel !== 4) {
      throw unsupportedOperation('TIFF separated decoding currently supports four-component CMYK')
    }
    const maximum = (1 << baseBitDepth) - 1
    const rawDotRange = await optionalValues(source, ifd, littleEndian, 336, 8)
    if (rawDotRange && rawDotRange.length !== 2 && rawDotRange.length !== 8) {
      throw invalidInput('TIFF CMYK DotRange must contain 2 or 8 values')
    }
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

  let ycbcr: YCbCrDescription | undefined
  if (photometric === photometricYCbCr && !jpegCompression) {
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
    photometric === photometricPalette
      ? await paletteFor(source, ifd, littleEndian, baseBitDepth)
      : undefined
  const iccEntry = ifd.entries.get(34675)
  let colorTransform: RgbIccTransform | undefined
  let iccProfile: Uint8Array | undefined
  if (iccEntry) {
    if (photometric !== photometricRgb && photometric !== photometricPalette && !jpegCompression) {
      throw unsupportedOperation(
        'TIFF ICC color management is not implemented for this color space',
      )
    }
    iccProfile = Uint8Array.from(await undefinedEntryBytes(source, iccEntry, 34675))
    colorTransform = parseRgbIccTransform(iccProfile)
  }
  const jpegTablesEntry = ifd.entries.get(347)
  const jpegTables = jpegTablesEntry
    ? (await undefinedEntryBytes(source, jpegTablesEntry, 347)).slice()
    : undefined
  let jpegInterchange: Uint8Array | undefined
  if (interchangeOffset !== undefined && interchangeLength !== undefined) {
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
  if (planarConfiguration === 1) {
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

  return {
    littleEndian,
    width,
    height,
    bitsPerSample,
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
    alphaSample,
    associatedAlpha: extraSamples[0] === 1,
    orientation,
    frames,
    pixelFormat: jpegCompression
      ? 'rgb8'
      : alphaSample !== undefined
        ? 'rgba8'
        : photometric === photometricWhiteIsZero || photometric === photometricBlackIsZero
          ? 'gray8'
          : 'rgb8',
    colorTransform,
    iccProfile,
    jpegTables,
    jpegInterchange,
    oldJpeg,
  }
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

const decodeCcittGroup3 = (
  encoded: Uint8Array,
  width: number,
  rows: number,
  rowBytes: number,
  fillOrder: number,
  twoDimensional: boolean,
): Uint8Array => {
  const output = new Uint8Array(rowBytes * rows)
  const reader = new FaxBitReader(encoded, fillOrder)
  let referenceChanges = new Int32Array(width + 2)
  let codingChanges = new Int32Array(width + 2)
  referenceChanges[0] = width
  referenceChanges[1] = width
  let referenceCount = 2
  for (let row = 0; row < rows; row += 1) {
    readFaxEol(reader)
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

class LzwBitReader {
  readonly #data: Uint8Array
  #bitOffset = 0

  constructor(data: Uint8Array) {
    this.#data = data
  }

  read(width: number): number | undefined {
    if (this.#bitOffset + width > this.#data.byteLength * 8) return undefined
    let value = 0
    for (let bit = 0; bit < width; bit += 1) {
      const absolute = this.#bitOffset + bit
      const byte = this.#data[absolute >>> 3] ?? 0
      value = (value << 1) | ((byte >>> (7 - (absolute & 7))) & 1)
    }
    this.#bitOffset += width
    return value
  }
}

const decodeLzw = (encoded: Uint8Array, expectedBytes: number): Uint8Array => {
  const clearCode = 256
  const endCode = 257
  const prefixes = new Uint16Array(4096)
  const suffixes = new Uint8Array(4096)
  const stack = new Uint8Array(4096)
  const output = new Uint8Array(expectedBytes)
  const reader = new LzwBitReader(encoded)
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
    if (outputOffset + length > expectedBytes) {
      throw invalidInput('TIFF LZW output exceeds the declared strip size')
    }
    for (let index = length - 1; index >= 0; index -= 1) {
      output[outputOffset] = stack[index] ?? 0
      outputOffset += 1
    }
  }

  while (outputOffset < expectedBytes) {
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
      if (outputOffset >= expectedBytes) {
        throw invalidInput('TIFF LZW special code exceeds the declared strip size')
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
      if (codeWidth < 12 && nextCode === (1 << codeWidth) - 1) codeWidth += 1
    }
    previousCode = code
  }

  if (outputOffset !== expectedBytes) {
    throw truncatedInput(`TIFF LZW produced ${outputOffset} of ${expectedBytes} bytes`)
  }
  if (!ended) {
    const end = reader.read(codeWidth)
    if (end !== undefined && end !== endCode) {
      throw invalidInput('TIFF LZW data continues past the declared strip size')
    }
  }
  return output
}

const decodeDeflate = async (
  encoded: Uint8Array,
  expectedBytes: number,
  maximumBytes: number,
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
        throw invalidInput('TIFF Deflate output exceeds RowsPerStrip')
      }
      output.set(result.value, offset)
      offset += result.value.byteLength
    }
  } catch (error) {
    if (error instanceof Error && error.name === 'ImageError') throw error
    throw invalidInput('TIFF Deflate strip is invalid')
  } finally {
    reader?.releaseLock()
  }
  if (offset < expectedBytes) {
    throw truncatedInput(`TIFF Deflate produced ${offset} of at least ${expectedBytes} bytes`)
  }
  return output.subarray(0, expectedBytes)
}

const reversePredictor = (
  data: Uint8Array,
  rowBytes: number,
  rows: number,
  stride: number,
  bitDepth: number,
  littleEndian: boolean,
): void => {
  if (bitDepth === 16) {
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
    const samplesPerRow = rowBytes >>> 1
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
  for (let row = 0; row < rows; row += 1) {
    const rowOffset = row * rowBytes
    for (let offset = stride; offset < rowBytes; offset += 1) {
      const index = rowOffset + offset
      data[index] = ((data[index] ?? 0) + (data[index - stride] ?? 0)) & 0xff
    }
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
  if (description.compression === compressionNone) {
    if (encoded.byteLength !== expectedBytes) {
      throw invalidInput(
        `TIFF uncompressed strip has ${encoded.byteLength}, expected ${expectedBytes} bytes`,
      )
    }
    decoded = encoded.slice()
  } else if (description.compression === compressionPackBits) {
    decoded = decodePackBits(encoded, expectedBytes)
  } else if (description.compression === compressionLzw) {
    decoded = decodeLzw(encoded, expectedBytes)
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
  if (description.predictor === 2) {
    const bitDepth =
      description.planarConfiguration === 1
        ? (description.bitsPerSample[0] ?? 8)
        : (description.bitsPerSample[Math.floor(physicalSegment / description.segmentsPerPlane)] ??
          8)
    reversePredictor(decoded, rowBytes, rows, predictorStride, bitDepth, description.littleEndian)
  }
  return decoded
}

const hasJpegBoundary = (data: Uint8Array, first: number, second: number): boolean =>
  data[0] === first && data[1] === second

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
  if (!hasJpegBoundary(encoded, 0xff, 0xd8) && description.jpegInterchange) {
    encoded = description.jpegInterchange
  }
  if (description.compression === compressionJpeg && description.jpegTables) {
    encoded = jpegWithTables(description.jpegTables, encoded)
  } else if (
    description.compression === compressionOldJpeg &&
    !hasJpegBoundary(encoded, 0xff, 0xd8)
  ) {
    encoded = oldJpegStream(description, encoded, rows)
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
  const byte = data[bitOffset >>> 3]
  if (byte === undefined) throw truncatedInput('TIFF packed sample is truncated')
  const shift = 8 - bitDepth - (bitOffset & 7)
  if (shift < 0) throw unsupportedOperation('TIFF samples crossing byte boundaries are unsupported')
  return (byte >>> shift) & ((1 << bitDepth) - 1)
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
    return packedSample(
      plane,
      rowWithinStrip * rowBytes * 8 + x * bitDepth,
      bitDepth,
      description.littleEndian,
    )
  }

  const plane = planes[0]
  if (!plane) throw truncatedInput('TIFF chunky strip is missing')
  const pixelBits = description.bitsPerPixel
  const rowBytes = description.rowBytes[0]
  const sampleOffset = description.sampleBitOffsets[sample]
  if (rowBytes === undefined || sampleOffset === undefined) {
    throw invalidInput('TIFF chunky sample layout is missing')
  }
  return packedSample(
    plane,
    rowWithinStrip * rowBytes * 8 + x * pixelBits + sampleOffset,
    bitDepth,
    description.littleEndian,
  )
}

const scaleSample = (value: number, bits: number): number =>
  bits === 8 ? value : Math.round((value * 255) / ((1 << bits) - 1))

const clampByte = (value: number): number => Math.max(0, Math.min(255, Math.round(value)))

const cmykCoverage = (value: number, sample: number, description: TiffDescription): number => {
  const low = description.cmykDotRange?.[sample * 2] ?? 0
  const high = description.cmykDotRange?.[sample * 2 + 1] ?? 255
  return clampByte(((value - low) * 255) / (high - low))
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

const unassociate = (value: number, alpha: number): number =>
  alpha === 0 ? 0 : alpha === 255 ? value : Math.min(255, Math.round((value * 255) / alpha))

class TiffDecoder implements ImageDecoder {
  readonly width: number
  readonly height: number
  readonly pixelFormat: PixelFormat
  readonly capabilities
  readonly #source: ImageSource
  readonly #description: TiffDescription
  readonly #limits: ImageLimits

  constructor(source: ImageSource, description: TiffDescription, limits: ImageLimits) {
    this.#source = source
    this.#description = description
    this.#limits = limits
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
    const region = regionFor(this.#description, request)
    const outputChannels = this.pixelFormat === 'gray8' ? 1 : this.pixelFormat === 'rgb8' ? 3 : 4
    const directChunkyChannels =
      this.#description.compression === compressionOldJpeg ||
      this.#description.compression === compressionJpeg
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
    const firstSegmentRow = Math.floor(region.y / this.#description.segmentHeight)
    const lastSegmentRow = Math.floor(
      (region.y + region.height - 1) / this.#description.segmentHeight,
    )
    const firstSegmentColumn = Math.floor(region.x / this.#description.segmentWidth)
    const lastSegmentColumn = Math.floor(
      (region.x + region.width - 1) / this.#description.segmentWidth,
    )

    for (let segmentRow = firstSegmentRow; segmentRow <= lastSegmentRow; segmentRow += 1) {
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
        if (
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
        const output = new Uint8Array(region.width * rows * outputChannels)
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
                localY * region.width * outputChannels + outputStartX * outputChannels
              output.set(plane.subarray(sourceStart, sourceStart + copyBytes), targetStart)
            }
            continue
          }
          for (let localY = 0; localY < rows; localY += 1) {
            const rowWithinSegment = imageY + localY - segmentY
            for (let localX = 0; localX < copyWidth; localX += 1) {
              const sourceX = localStartX + localX
              const outputX = outputStartX + localX
              const target = (localY * region.width + outputX) * outputChannels
              const alpha =
                this.#description.alphaSample === undefined
                  ? 255
                  : scaleSample(
                      sampleAt(
                        planes,
                        this.#description,
                        rowWithinSegment,
                        sourceX,
                        this.#description.alphaSample,
                      ),
                      this.#description.bitsPerSample[this.#description.alphaSample] ?? 8,
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
                  sampleAt(planes, this.#description, rowWithinSegment, sourceX, 0),
                  0,
                  this.#description,
                )
                const magenta = cmykCoverage(
                  sampleAt(planes, this.#description, rowWithinSegment, sourceX, 1),
                  1,
                  this.#description,
                )
                const yellow = cmykCoverage(
                  sampleAt(planes, this.#description, rowWithinSegment, sourceX, 2),
                  2,
                  this.#description,
                )
                const black = cmykCoverage(
                  sampleAt(planes, this.#description, rowWithinSegment, sourceX, 3),
                  3,
                  this.#description,
                )
                red = Math.round(((255 - cyan) * (255 - black)) / 255)
                green = Math.round(((255 - magenta) * (255 - black)) / 255)
                blue = Math.round(((255 - yellow) * (255 - black)) / 255)
              } else if (this.#description.photometric === photometricRgb) {
                red = scaleSample(
                  sampleAt(planes, this.#description, rowWithinSegment, sourceX, 0),
                  this.#description.bitsPerSample[0] ?? 8,
                )
                green = scaleSample(
                  sampleAt(planes, this.#description, rowWithinSegment, sourceX, 1),
                  this.#description.bitsPerSample[1] ?? 8,
                )
                blue = scaleSample(
                  sampleAt(planes, this.#description, rowWithinSegment, sourceX, 2),
                  this.#description.bitsPerSample[2] ?? 8,
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
                )
                if (this.#description.photometric === photometricWhiteIsZero) gray = 255 - gray
                red = gray
                green = gray
                blue = gray
              }
              if (this.#description.associatedAlpha) {
                red = unassociate(red, alpha)
                green = unassociate(green, alpha)
                blue = unassociate(blue, alpha)
              }
              if (this.pixelFormat === 'gray8') {
                output[target] = red
              } else {
                output[target] = red
                output[target + 1] = green
                output[target + 2] = blue
                if (this.pixelFormat === 'rgba8') output[target + 3] = alpha
              }
            }
          }
        }
        yield {
          x: 0,
          y: imageY - region.y,
          width: region.width,
          height: rows,
          stride: region.width * outputChannels,
          format: this.pixelFormat,
          data: output,
        }
      }
    }
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const validateEncoderOptions = (options: unknown): void => {
  if (!isRecord(options)) throw invalidInput('TIFF encoder options must be an object')
  const compression = options.compression
  if (compression !== undefined && compression !== 'none') {
    throw unsupportedOperation('TIFF encoding currently supports only compression: none')
  }
}

const writeIfdEntry = (
  view: DataView,
  offset: number,
  tag: number,
  fieldType: number,
  count: number,
  value: number,
): void => {
  view.setUint16(offset, tag, true)
  view.setUint16(offset + 2, fieldType, true)
  view.setUint32(offset + 4, count, true)
  if (fieldType === 3 && count === 1) view.setUint16(offset + 8, value, true)
  else view.setUint32(offset + 8, value, true)
}

const tiffHeader = (
  width: number,
  height: number,
  format: PixelFormat,
  icc: Uint8Array | undefined,
): Uint8Array => {
  const samples = format === 'gray8' ? 1 : format === 'rgb8' ? 3 : 4
  const entryCount = (format === 'rgba8' ? 12 : 11) + (icc ? 1 : 0)
  const ifdOffset = 8
  const ifdBytes = 2 + entryCount * 12 + 4
  const bitsBytes = samples === 1 ? 0 : samples * 2
  const iccOffset = ifdOffset + ifdBytes + bitsBytes
  const pixelOffset = iccOffset + (icc?.byteLength ?? 0)
  const output = new Uint8Array(pixelOffset)
  const view = new DataView(output.buffer)
  output.set([0x49, 0x49, 0x2a, 0])
  view.setUint32(4, ifdOffset, true)
  view.setUint16(ifdOffset, entryCount, true)
  let entryOffset = ifdOffset + 2
  const entry = (tag: number, fieldType: number, count: number, value: number): void => {
    writeIfdEntry(view, entryOffset, tag, fieldType, count, value)
    entryOffset += 12
  }
  entry(256, 4, 1, width)
  entry(257, 4, 1, height)
  entry(258, 3, samples, samples === 1 ? 8 : ifdOffset + ifdBytes)
  entry(259, 3, 1, compressionNone)
  entry(262, 3, 1, format === 'gray8' ? photometricBlackIsZero : photometricRgb)
  entry(273, 4, 1, pixelOffset)
  entry(274, 3, 1, 1)
  entry(277, 3, 1, samples)
  entry(278, 4, 1, height)
  entry(279, 4, 1, width * height * samples)
  entry(284, 3, 1, 1)
  if (format === 'rgba8') entry(338, 3, 1, 2)
  if (icc) entry(34675, 7, icc.byteLength, iccOffset)
  view.setUint32(entryOffset, 0, true)
  if (samples > 1) {
    for (let sample = 0; sample < samples; sample += 1) {
      view.setUint16(ifdOffset + ifdBytes + sample * 2, 8, true)
    }
  }
  if (icc) output.set(icc, iccOffset)
  return output
}

class TiffEncoder implements ImageEncoder {
  readonly #sink: ImageSink
  readonly #width: number
  readonly #height: number
  readonly #format: 'gray8' | 'rgb8' | 'rgba8'
  #y = 0

  private constructor(
    sink: ImageSink,
    width: number,
    height: number,
    format: 'gray8' | 'rgb8' | 'rgba8',
  ) {
    this.#sink = sink
    this.#width = width
    this.#height = height
    this.#format = format
  }

  static async create(sink: ImageSink, request: EncodeRequest): Promise<TiffEncoder> {
    validateEncoderOptions(request.options)
    if (
      request.pixelFormat !== 'gray8' &&
      request.pixelFormat !== 'rgb8' &&
      request.pixelFormat !== 'rgba8'
    ) {
      throw unsupportedOperation(`TIFF encoding does not support ${request.pixelFormat} pixels`)
    }
    if (request.metadata?.exif)
      throw unsupportedOperation('Preserving EXIF into TIFF output is not implemented')
    const icc = request.metadata?.icc
    if (icc) {
      const colorSpace = iccColorSpace(icc)
      if (
        colorSpace === 'other' ||
        (request.pixelFormat === 'gray8' && colorSpace !== 'gray') ||
        (request.pixelFormat !== 'gray8' && colorSpace !== 'rgb')
      ) {
        throw invalidInput('Preserved ICC profile does not match TIFF output pixels')
      }
    }
    await sink.write(tiffHeader(request.width, request.height, request.pixelFormat, icc))
    return new TiffEncoder(sink, request.width, request.height, request.pixelFormat)
  }

  async write(block: PixelBlock): Promise<void> {
    const channels = this.#format === 'gray8' ? 1 : this.#format === 'rgb8' ? 3 : 4
    if (
      block.x !== 0 ||
      block.y !== this.#y ||
      block.width !== this.#width ||
      block.height < 1 ||
      block.format !== this.#format ||
      block.stride < this.#width * channels ||
      block.data.byteLength < block.stride * block.height ||
      this.#y + block.height > this.#height
    ) {
      throw invalidInput('TIFF encoder received a non-sequential or malformed pixel block')
    }
    const rowBytes = this.#width * channels
    for (let row = 0; row < block.height; row += 1) {
      await this.#sink.write(block.data.subarray(row * block.stride, row * block.stride + rowBytes))
      this.#y += 1
    }
  }

  async finish(): Promise<void> {
    if (this.#y !== this.#height) {
      throw truncatedInput(`TIFF encoder received ${this.#y} of ${this.#height} rows`)
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
      ? 'srgb'
      : description.photometric === photometricSeparated
        ? 'cmyk'
        : description.photometric === photometricYCbCr
          ? 'ycbcr'
          : description.photometric === photometricPalette
            ? 'indexed'
            : 'gray',
  bitDepth: Math.max(...description.bitsPerSample),
  frames: description.frames,
})

export const tiffCodec: ImageCodec = {
  format: 'tiff',
  mimeTypes: ['image/tiff', 'image/x-tiff'],
  minimumBytes: 4,
  detect: isTiff,
  metadata: async (source, limits) => metadata(await describeTiff(source, limits)),
  preservedMetadata: async (source, limits, options): Promise<PreservedMetadata> => {
    if (options?.exif)
      throw unsupportedOperation('Preserving EXIF from TIFF input is not implemented')
    const description = await describeTiff(source, limits)
    return description.iccProfile ? { icc: Uint8Array.from(description.iccProfile) } : {}
  },
  createDecoder: async (source, limits, options: Readonly<DecoderOptions> = {}) => {
    const description = await describeTiff(source, limits)
    const decoder = new TiffDecoder(source, description, limits)
    return description.colorTransform && options.preserveIcc !== true
      ? new ColorManagedDecoder(decoder, description.colorTransform)
      : decoder
  },
  createEncoder: async (sink, request) => TiffEncoder.create(sink, request),
}
