import { invalidInput, limitExceeded, truncatedInput, unsupportedOperation } from '../../errors.ts'
import type { ImageLimitOptions, ImageLimits } from '../../limits.ts'
import { resolveLimits, validateImageDimensions } from '../../limits.ts'
import { rasterSampleBytes, type RasterBlock, type RasterSampleType } from '../../raster.ts'
import {
  createImageSource,
  readExactly,
  type ImageInput,
  type ImageSource,
  type ImageSourceReadOptions,
} from '../../source.ts'
import type {
  MultidimensionalRasterDataset,
  RasterChannelInfo,
  RasterPlaneRequest,
} from '../dataset.ts'
import { writeRasterSample } from '../samples.ts'

const binaryMarker = Uint8Array.of(0x0c, 0x1a, 0x04, 0xd5)
const sectionBoundary = '--CIF-BINARY-FORMAT-SECTION--'
const closingBoundary = '--CIF-BINARY-FORMAT-SECTION----'

export type CbfEncoding = 'x-CBF_BYTE_OFFSET'
export type CbfElementType =
  | 'signed 8-bit integer'
  | 'unsigned 8-bit integer'
  | 'signed 16-bit integer'
  | 'unsigned 16-bit integer'
  | 'signed 32-bit integer'
  | 'unsigned 32-bit integer'

export interface CbfDetectorMetadata {
  readonly detectorName?: string
  readonly exposureTimeSeconds?: number
  readonly wavelengthAngstroms?: number
}

export interface CbfOpenOptions extends ImageLimitOptions {
  readonly maxHeaderBytes?: number
  readonly rowsPerBlock?: number
}

/** A lazy native-count raster for one supported CBF area-detector frame. */
export interface CbfDataset extends MultidimensionalRasterDataset {
  readonly format: 'cbf'
  readonly encoding: CbfEncoding
  readonly elementType: CbfElementType
  readonly detector: CbfDetectorMetadata
  readonly binarySectionOffset: number
  readonly binarySectionBytes: number
  readonly sourceBytesRead: number
}

interface ParsedCbf {
  readonly width: number
  readonly height: number
  readonly elementCount: number
  readonly sampleType: RasterSampleType
  readonly elementType: CbfElementType
  readonly encoding: CbfEncoding
  readonly binarySectionOffset: number
  readonly binarySectionBytes: number
  readonly binarySectionEnd: number
  readonly paddingBytes: number
  readonly metadata: Readonly<Record<string, string>>
  readonly detector: CbfDetectorMetadata
}

class CountingSource implements ImageSource {
  readonly size: number
  readonly #source: ImageSource
  bytesRead = 0

  constructor(source: ImageSource) {
    this.#source = source
    this.size = source.size
  }

  async read(
    offset: number,
    length: number,
    options: Readonly<ImageSourceReadOptions> = {},
  ): Promise<Uint8Array> {
    const data = await this.#source.read(offset, length, options)
    this.bytesRead += data.byteLength
    return data
  }
}

class BoundedByteReader {
  readonly #source: ImageSource
  readonly #end: number
  readonly #signal: AbortSignal | undefined
  #buffer: Uint8Array<ArrayBufferLike> = new Uint8Array()
  #bufferStart = 0
  position: number

  constructor(source: ImageSource, start: number, end: number, signal: AbortSignal | undefined) {
    this.#source = source
    this.position = start
    this.#end = end
    this.#signal = signal
  }

  async read(length: number): Promise<Uint8Array> {
    if (!Number.isSafeInteger(length) || length < 0) {
      throw invalidInput('CBF compressed read length is invalid')
    }
    if (this.position + length > this.#end) {
      throw truncatedInput('CBF byte-offset escape sequence is truncated')
    }
    const bufferOffset = this.position - this.#bufferStart
    if (bufferOffset >= 0 && bufferOffset + length <= this.#buffer.byteLength) {
      const result = this.#buffer.subarray(bufferOffset, bufferOffset + length)
      this.position += length
      return result
    }
    const amount = Math.min(this.#end - this.position, Math.max(length, 65_536))
    this.#bufferStart = this.position
    this.#buffer = await readExactly(this.#source, this.position, amount, {
      ...(this.#signal === undefined ? {} : { signal: this.#signal }),
    })
    const result = this.#buffer.subarray(0, length)
    this.position += length
    return result
  }

  async readSignedByte(): Promise<number> {
    const data = await this.read(1)
    return new DataView(data.buffer, data.byteOffset, 1).getInt8(0)
  }
}

const positiveIntegerOption = (name: string, value: number): number => {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw invalidInput(`${name} must be a positive safe integer`)
  }
  return value
}

const findBytes = (data: Uint8Array, needle: Uint8Array): number => {
  const maximum = data.byteLength - needle.byteLength
  for (let offset = 0; offset <= maximum; offset += 1) {
    let matches = true
    for (let index = 0; index < needle.byteLength; index += 1) {
      if (data[offset + index] !== needle[index]) {
        matches = false
        break
      }
    }
    if (matches) return offset
  }
  return -1
}

const decodedText = (bytes: Uint8Array, name: string): string => {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    throw invalidInput(`CBF ${name} is not valid UTF-8 text`)
  }
}

const parseMimeHeaders = (text: string): ReadonlyMap<string, string> => {
  const boundary = text.lastIndexOf(sectionBoundary)
  if (boundary < 0) throw invalidInput('CBF binary MIME boundary is missing')
  const lines = text
    .slice(boundary + sectionBoundary.length)
    .replaceAll('\r\n', '\n')
    .split('\n')
  const headers = new Map<string, string>()
  let currentKey: string | undefined
  for (const line of lines) {
    if (line.trim().length === 0) continue
    if (/^[ \t]/u.test(line)) {
      if (currentKey === undefined) throw invalidInput('CBF MIME header continuation is invalid')
      headers.set(currentKey, `${headers.get(currentKey) ?? ''} ${line.trim()}`)
      continue
    }
    const colon = line.indexOf(':')
    if (colon < 1) throw invalidInput('CBF MIME header line is malformed')
    const key = line.slice(0, colon).trim().toLowerCase()
    if (!/^[a-z0-9-]+$/u.test(key) || headers.has(key)) {
      throw invalidInput(`CBF MIME header ${key} is invalid or repeated`)
    }
    headers.set(key, line.slice(colon + 1).trim())
    currentKey = key
  }
  return headers
}

const requiredHeader = (headers: ReadonlyMap<string, string>, name: string): string => {
  const value = headers.get(name.toLowerCase())
  if (value === undefined || value.length === 0) throw invalidInput(`CBF requires ${name}`)
  return value
}

const integerHeader = (
  headers: ReadonlyMap<string, string>,
  name: string,
  optional = false,
): number | undefined => {
  const raw = headers.get(name.toLowerCase())
  if (raw === undefined && optional) return undefined
  if (raw === undefined || !/^[0-9]+$/u.test(raw.trim())) {
    throw invalidInput(`CBF ${name} must be a non-negative integer`)
  }
  const value = Number(raw.trim())
  if (!Number.isSafeInteger(value)) throw limitExceeded(`CBF ${name} is too large`)
  return value
}

const unquoted = (value: string): string => {
  const trimmed = value.trim()
  if (
    trimmed.length >= 2 &&
    ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'")))
  ) {
    return trimmed.slice(1, -1)
  }
  return trimmed
}

const elementType = (
  raw: string,
): { readonly elementType: CbfElementType; readonly sampleType: RasterSampleType } => {
  const normalized = unquoted(raw).toLowerCase().replaceAll(/\s+/gu, ' ')
  if (normalized === 'signed 8-bit integer') return { elementType: normalized, sampleType: 'int8' }
  if (normalized === 'unsigned 8-bit integer')
    return { elementType: normalized, sampleType: 'uint8' }
  if (normalized === 'signed 16-bit integer')
    return { elementType: normalized, sampleType: 'int16' }
  if (normalized === 'unsigned 16-bit integer') {
    return { elementType: normalized, sampleType: 'uint16' }
  }
  if (normalized === 'signed 32-bit integer')
    return { elementType: normalized, sampleType: 'int32' }
  if (normalized === 'unsigned 32-bit integer') {
    return { elementType: normalized, sampleType: 'uint32' }
  }
  throw unsupportedOperation(`CBF element type ${unquoted(raw)} is unsupported`)
}

const cifMetadata = (text: string): Readonly<Record<string, string>> => {
  const boundary = text.lastIndexOf(sectionBoundary)
  const result: Record<string, string> = {}
  const lines = text.slice(0, boundary).replaceAll('\r\n', '\n').split('\n')
  for (const line of lines) {
    const match = line.match(/^(_[A-Za-z0-9_.-]+)[ \t]+(.+?)\s*$/u)
    if (!match) continue
    const key = match[1]
    const value = match[2]
    if (key !== undefined && value !== undefined && Object.keys(result).length < 10_000) {
      result[key] = unquoted(value)
    }
  }
  return Object.freeze(result)
}

const numericMetadata = (
  metadata: Readonly<Record<string, string>>,
  keys: readonly string[],
): number | undefined => {
  for (const key of keys) {
    const raw = metadata[key]
    if (raw === undefined) continue
    const match = raw.match(/^[ \t]*([+-]?(?:[0-9]+\.?[0-9]*|\.[0-9]+)(?:[Ee][+-]?[0-9]+)?)/u)
    if (!match) continue
    const value = Number(match[1])
    if (Number.isFinite(value)) return value
  }
  return undefined
}

const headerComment = (text: string, name: string): string | undefined => {
  const escaped = name.replaceAll(/[.*+?^${}()|[\]\\]/gu, '\\$&')
  return text.match(new RegExp(`^#[ \\t]*${escaped}(?::|[ \\t]+)[ \\t]*(.+?)[ \\t]*$`, 'imu'))?.[1]
}

const numericComment = (text: string, name: string): number | undefined => {
  const raw = headerComment(text, name)
  if (raw === undefined) return undefined
  const match = raw.match(/^([+-]?(?:[0-9]+\.?[0-9]*|\.[0-9]+)(?:[Ee][+-]?[0-9]+)?)/u)
  const value = match === null ? Number.NaN : Number(match[1])
  return Number.isFinite(value) ? value : undefined
}

const detectorMetadata = (
  metadata: Readonly<Record<string, string>>,
  headerText: string,
): CbfDetectorMetadata => {
  const detectorName =
    metadata['_diffrn_detector.detector'] ??
    metadata['_diffrn_detector.type'] ??
    headerComment(headerText, 'Detector')
  const exposureTimeSeconds =
    numericMetadata(metadata, ['_diffrn_scan_frame.integration_time']) ??
    numericComment(headerText, 'Exposure_time')
  const wavelengthAngstroms =
    numericMetadata(metadata, ['_diffrn_radiation_wavelength.wavelength']) ??
    numericComment(headerText, 'Wavelength')
  return Object.freeze({
    ...(detectorName === undefined ? {} : { detectorName }),
    ...(exposureTimeSeconds === undefined ? {} : { exposureTimeSeconds }),
    ...(wavelengthAngstroms === undefined ? {} : { wavelengthAngstroms }),
  })
}

const checkedEnd = (offset: number, length: number, name: string): number => {
  const end = offset + length
  if (!Number.isSafeInteger(end))
    throw limitExceeded(`CBF ${name} overflows the safe integer range`)
  return end
}

const parseCbf = async (source: ImageSource, maxHeaderBytes: number): Promise<ParsedCbf> => {
  const probeLength = Math.min(source.size, maxHeaderBytes)
  const probe = await readExactly(source, 0, probeLength)
  const markerOffset = findBytes(probe, binaryMarker)
  if (markerOffset < 0) {
    if (source.size > maxHeaderBytes) {
      throw limitExceeded(`CBF binary marker is not within maxHeaderBytes ${maxHeaderBytes}`)
    }
    throw truncatedInput('CBF binary section marker is missing')
  }
  const headerText = decodedText(probe.subarray(0, markerOffset), 'header')
  if (!/^\uFEFF?###CBF:/u.test(headerText.trimStart())) {
    throw invalidInput('CBF identification line is missing')
  }
  const headers = parseMimeHeaders(headerText)
  const transfer = unquoted(requiredHeader(headers, 'Content-Transfer-Encoding')).toUpperCase()
  if (transfer !== 'BINARY') {
    throw unsupportedOperation(`CBF Content-Transfer-Encoding ${transfer} is unsupported`)
  }
  const contentType = requiredHeader(headers, 'Content-Type')
  const conversionMatch = contentType.match(/conversions\s*=\s*"?([^";\s]+)/iu)
  const conversion = conversionMatch?.[1]?.toUpperCase()
  if (conversion !== 'X-CBF_BYTE_OFFSET') {
    throw unsupportedOperation(`CBF compression ${conversion ?? 'unspecified'} is unsupported`)
  }
  const byteOrder = unquoted(requiredHeader(headers, 'X-Binary-Element-Byte-Order')).toUpperCase()
  if (byteOrder !== 'LITTLE_ENDIAN') {
    throw unsupportedOperation(`CBF byte order ${byteOrder} is unsupported for byte-offset data`)
  }
  const binarySectionBytes = integerHeader(headers, 'X-Binary-Size') ?? 0
  if (binarySectionBytes < 1) throw invalidInput('CBF X-Binary-Size must be positive')
  const elementCount = integerHeader(headers, 'X-Binary-Number-of-Elements') ?? 0
  const width = integerHeader(headers, 'X-Binary-Size-Fastest-Dimension') ?? 0
  const height = integerHeader(headers, 'X-Binary-Size-Second-Dimension') ?? 0
  const depth = integerHeader(headers, 'X-Binary-Size-Third-Dimension', true) ?? 1
  const paddingBytes = integerHeader(headers, 'X-Binary-Size-Padding', true) ?? 0
  if (width < 1 || height < 1 || depth !== 1) {
    throw unsupportedOperation('CBF reader requires one positive two-dimensional detector frame')
  }
  if (BigInt(width) * BigInt(height) !== BigInt(elementCount)) {
    throw invalidInput('CBF dimensions do not match X-Binary-Number-of-Elements')
  }
  const parsedElement = elementType(requiredHeader(headers, 'X-Binary-Element-Type'))
  const binarySectionOffset = markerOffset + binaryMarker.byteLength
  const binarySectionEnd = checkedEnd(binarySectionOffset, binarySectionBytes, 'binary section end')
  const footerOffset = checkedEnd(binarySectionEnd, paddingBytes, 'padding end')
  if (footerOffset > source.size) throw truncatedInput('CBF binary section is truncated')
  const footerBytes = Math.min(64, source.size - footerOffset)
  const footer = decodedText(await readExactly(source, footerOffset, footerBytes), 'footer')
  const normalizedFooter = footer.startsWith('\r\n')
    ? footer.slice(2)
    : footer.startsWith('\n')
      ? footer.slice(1)
      : footer
  if (!normalizedFooter.startsWith(closingBoundary)) {
    throw invalidInput('CBF closing binary boundary is missing at the declared offset')
  }
  const metadata = cifMetadata(headerText)
  return {
    width,
    height,
    elementCount,
    sampleType: parsedElement.sampleType,
    elementType: parsedElement.elementType,
    encoding: 'x-CBF_BYTE_OFFSET',
    binarySectionOffset,
    binarySectionBytes,
    binarySectionEnd,
    paddingBytes,
    metadata,
    detector: detectorMetadata(metadata, headerText),
  }
}

const sampleRange = (sampleType: RasterSampleType): readonly [bigint, bigint] => {
  if (sampleType === 'int8') return [-128n, 127n]
  if (sampleType === 'uint8') return [0n, 255n]
  if (sampleType === 'int16') return [-32_768n, 32_767n]
  if (sampleType === 'uint16') return [0n, 65_535n]
  if (sampleType === 'int32') return [-2_147_483_648n, 2_147_483_647n]
  return [0n, 4_294_967_295n]
}

const decodeDelta = async (reader: BoundedByteReader): Promise<bigint> => {
  const first = await reader.readSignedByte()
  if (first !== -128) return BigInt(first)
  const shortBytes = await reader.read(2)
  const short = new DataView(shortBytes.buffer, shortBytes.byteOffset, 2).getInt16(0, true)
  if (short !== -32_768) return BigInt(short)
  const intBytes = await reader.read(4)
  const integer = new DataView(intBytes.buffer, intBytes.byteOffset, 4).getInt32(0, true)
  if (integer !== -2_147_483_648) return BigInt(integer)
  const longBytes = await reader.read(8)
  return new DataView(longBytes.buffer, longBytes.byteOffset, 8).getBigInt64(0, true)
}

const validateRequest = (
  request: Readonly<RasterPlaneRequest>,
  width: number,
  height: number,
): { readonly x: number; readonly y: number; readonly width: number; readonly height: number } => {
  if (request.z !== 0 || request.t !== 0) throw invalidInput('CBF Z/T plane coordinate must be 0')
  if (request.resolutionLevel !== undefined && request.resolutionLevel !== 0) {
    throw invalidInput('CBF resolutionLevel must be 0')
  }
  const channels =
    request.c === undefined ? [0] : typeof request.c === 'number' ? [request.c] : request.c
  if (channels.length !== 1 || channels[0] !== 0) throw invalidInput('CBF channel must be 0')
  const x = request.x ?? 0
  const y = request.y ?? 0
  const selectedWidth = request.width ?? width - x
  const selectedHeight = request.height ?? height - y
  if (
    !Number.isSafeInteger(x) ||
    !Number.isSafeInteger(y) ||
    !Number.isSafeInteger(selectedWidth) ||
    !Number.isSafeInteger(selectedHeight) ||
    x < 0 ||
    y < 0 ||
    selectedWidth < 1 ||
    selectedHeight < 1 ||
    x + selectedWidth > width ||
    y + selectedHeight > height
  ) {
    throw invalidInput('CBF raster region is outside the detector frame')
  }
  return { x, y, width: selectedWidth, height: selectedHeight }
}

class CbfRasterDataset implements CbfDataset {
  readonly format = 'cbf' as const
  readonly encoding: CbfEncoding
  readonly elementType: CbfElementType
  readonly detector: CbfDetectorMetadata
  readonly binarySectionOffset: number
  readonly binarySectionBytes: number
  readonly sizeX: number
  readonly sizeY: number
  readonly sizeZ = 1
  readonly sizeC = 1
  readonly sizeT = 1
  readonly sampleType: RasterSampleType
  readonly dimensionOrder = 'XYZCT'
  readonly channels: readonly RasterChannelInfo[] = Object.freeze([
    { name: 'Detector counts', samplesPerPixel: 1, unit: 'counts' },
  ])
  readonly metadata: Readonly<Record<string, string>>
  readonly #source: CountingSource
  readonly #binarySectionEnd: number
  readonly #limits: Readonly<ImageLimits>
  readonly #rowsPerBlock: number
  readonly #elementCount: number

  constructor(
    source: CountingSource,
    parsed: ParsedCbf,
    limits: Readonly<ImageLimits>,
    rowsPerBlock: number,
  ) {
    this.#source = source
    this.#limits = limits
    this.#rowsPerBlock = rowsPerBlock
    this.#elementCount = parsed.elementCount
    this.#binarySectionEnd = parsed.binarySectionEnd
    this.sizeX = parsed.width
    this.sizeY = parsed.height
    this.sampleType = parsed.sampleType
    this.elementType = parsed.elementType
    this.encoding = parsed.encoding
    this.detector = parsed.detector
    this.binarySectionOffset = parsed.binarySectionOffset
    this.binarySectionBytes = parsed.binarySectionBytes
    this.metadata = parsed.metadata
  }

  get sourceBytesRead(): number {
    return this.#source.bytesRead
  }

  async *readPlane(request: Readonly<RasterPlaneRequest>): AsyncGenerator<RasterBlock> {
    const region = validateRequest(request, this.sizeX, this.sizeY)
    const bytesPerSample = rasterSampleBytes(this.sampleType)
    const rowBytes = region.width * bytesPerSample
    if (rowBytes > this.#limits.maxDecodedBytes) {
      throw limitExceeded('CBF selected detector row exceeds maxDecodedBytes')
    }
    const rowsPerBlock = Math.min(
      this.#rowsPerBlock,
      Math.max(1, Math.floor(this.#limits.maxDecodedBytes / rowBytes)),
    )
    const reader = new BoundedByteReader(
      this.#source,
      this.binarySectionOffset,
      this.#binarySectionEnd,
      request.signal,
    )
    const [minimum, maximum] = sampleRange(this.sampleType)
    let base = 0n
    let output: Uint8Array | undefined
    let outputView: DataView | undefined
    let outputStartY = 0
    let outputHeight = 0
    for (let index = 0; index < this.#elementCount; index += 1) {
      base += await decodeDelta(reader)
      if (base < minimum || base > maximum) {
        throw invalidInput('CBF byte-offset value exceeds the declared element type')
      }
      const y = Math.floor(index / this.sizeX)
      const x = index - y * this.sizeX
      if (
        y < region.y ||
        y >= region.y + region.height ||
        x < region.x ||
        x >= region.x + region.width
      ) {
        continue
      }
      if (output === undefined || outputView === undefined) {
        outputStartY = y
        outputHeight = Math.min(rowsPerBlock, region.y + region.height - outputStartY)
        output = new Uint8Array(rowBytes * outputHeight)
        outputView = new DataView(output.buffer)
      }
      const target = (y - outputStartY) * rowBytes + (x - region.x) * bytesPerSample
      writeRasterSample(outputView, target, this.sampleType, Number(base))
      if (x === region.x + region.width - 1 && y === outputStartY + outputHeight - 1) {
        yield {
          x: region.x,
          y: outputStartY,
          width: region.width,
          height: outputHeight,
          stride: rowBytes,
          format: Object.freeze({ sampleType: this.sampleType, channels: 1, planar: false }),
          data: output,
        }
        output = undefined
        outputView = undefined
      }
    }
    if (output !== undefined) throw invalidInput('CBF selected output rows are incomplete')
    if (reader.position !== this.#binarySectionEnd) {
      throw invalidInput('CBF compressed byte count does not match the declared element count')
    }
  }
}

/**
 * Opens one CBF area-detector frame using the binary MIME section and
 * `x-CBF_BYTE_OFFSET` compression. Detector counts remain signed or unsigned
 * native integers until explicit scientific rendering. Decoding is sequential
 * and retains only one compressed read buffer and the selected output rows.
 */
export const openCbf = async (
  input: ImageInput,
  options: Readonly<CbfOpenOptions> = {},
): Promise<CbfDataset> => {
  const limits = resolveLimits(options)
  const maxHeaderBytes = positiveIntegerOption(
    'maxHeaderBytes',
    options.maxHeaderBytes ?? 1_048_576,
  )
  const rowsPerBlock = positiveIntegerOption('rowsPerBlock', options.rowsPerBlock ?? 16)
  const source = new CountingSource(await createImageSource(input, limits))
  const parsed = await parseCbf(source, maxHeaderBytes)
  validateImageDimensions(parsed.width, parsed.height, 1, limits)
  return new CbfRasterDataset(source, parsed, limits, rowsPerBlock)
}
