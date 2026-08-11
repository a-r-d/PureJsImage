import { invalidInput, limitExceeded, truncatedInput, unsupportedOperation } from '../../errors.ts'
import type { ImageLimitOptions, ImageLimits } from '../../limits.ts'
import { resolveLimits, validateImageDimensions } from '../../limits.ts'
import { rasterSampleBytes, type RasterBlock, type RasterSampleType } from '../../raster.ts'
import { createImageSource, readExactly, type ImageInput, type ImageSource } from '../../source.ts'
import type {
  MultidimensionalRasterDataset,
  RasterChannelInfo,
  RasterPlaneRequest,
} from '../dataset.ts'

const cardBytes = 80
const blockBytes = 2_880
const supportedBitpix = new Set([8, 16, 32, 64, -32, -64])

export type FitsHeaderValue = string | boolean | number | bigint

/** One immutable 80-byte FITS header card. Repeated COMMENT and HISTORY cards are retained. */
export interface FitsHeaderCard {
  readonly keyword: string
  readonly kind: 'value' | 'comment' | 'history' | 'blank' | 'end' | 'other'
  readonly value?: FitsHeaderValue
  readonly comment?: string
  readonly text?: string
  readonly raw: string
}

/** Inspectable metadata for one FITS Header/Data Unit. */
export interface FitsHdu {
  readonly index: number
  readonly primary: boolean
  readonly extensionType?: string
  readonly bitpix: number
  readonly dimensions: readonly number[]
  readonly dataByteOffset: number
  readonly dataByteLength: number
  readonly canOpenRaster: boolean
  readonly cards: readonly FitsHeaderCard[]
}

export interface FitsOpenOptions extends ImageLimitOptions {
  readonly rowsPerBlock?: number
  readonly maxHeaderBlocks?: number
}

/** A FITS primary array or IMAGE extension exposed as a lazy numeric raster. */
export interface FitsDataset extends MultidimensionalRasterDataset {
  readonly format: 'fits'
  readonly hdu: FitsHdu
  readonly bitpix: number
  readonly bscale: number
  readonly bzero: number
  readonly blank?: number
  readonly storedSampleType: RasterSampleType
  readonly sourceBytesRead: number
}

/**
 * Parsed FITS document metadata. Opening the document reads headers but leaves
 * image arrays lazy. `openImage()` rejects tables, compressed images, random
 * groups, BITPIX=64 arrays, and arrays with more than three axes.
 */
export interface FitsDocument {
  readonly hdus: readonly FitsHdu[]
  readonly sourceBytesRead: number
  openImage(index: number): Promise<FitsDataset>
}

interface ParsedHdu extends FitsHdu {
  readonly pcount: number
  readonly gcount: number
}

class CountingSource implements ImageSource {
  readonly size: number
  readonly #source: ImageSource
  bytesRead = 0

  constructor(source: ImageSource) {
    this.#source = source
    this.size = source.size
  }

  async read(offset: number, length: number): Promise<Uint8Array> {
    const data = await this.#source.read(offset, length)
    this.bytesRead += data.byteLength
    return data
  }
}

const alignBlock = (value: bigint): bigint =>
  ((value + BigInt(blockBytes - 1)) / BigInt(blockBytes)) * BigInt(blockBytes)

const safeNumber = (value: bigint, label: string): number => {
  if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw limitExceeded(`FITS ${label} exceeds the safe integer range`)
  }
  return Number(value)
}

const positiveIntegerOption = (name: string, value: number): number => {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw invalidInput(`${name} must be a positive safe integer`)
  }
  return value
}

const splitValueComment = (
  field: string,
): { readonly value: string; readonly comment?: string } => {
  let quoted = false
  for (let index = 0; index < field.length; index += 1) {
    const character = field[index]
    if (character === "'") {
      if (quoted && field[index + 1] === "'") {
        index += 1
      } else {
        quoted = !quoted
      }
    } else if (character === '/' && !quoted) {
      const comment = field.slice(index + 1).trim()
      return {
        value: field.slice(0, index).trim(),
        ...(comment.length === 0 ? {} : { comment }),
      }
    }
  }
  if (quoted) throw invalidInput('FITS header contains an unterminated quoted string')
  return { value: field.trim() }
}

const parseQuotedString = (raw: string): string => {
  let result = ''
  let index = 1
  while (index < raw.length) {
    const character = raw[index]
    if (character === "'") {
      if (raw[index + 1] === "'") {
        result += "'"
        index += 2
        continue
      }
      if (raw.slice(index + 1).trim().length !== 0) {
        throw invalidInput('FITS string value contains data after its closing quote')
      }
      return result.replace(/ +$/u, '')
    }
    result += character
    index += 1
  }
  throw invalidInput('FITS header contains an unterminated quoted string')
}

const parseHeaderValue = (raw: string): FitsHeaderValue => {
  if (raw.length === 0) throw invalidInput('FITS value card has an empty value field')
  if (raw.startsWith("'")) return parseQuotedString(raw)
  if (raw === 'T') return true
  if (raw === 'F') return false
  if (/^[+-]?[0-9]+$/u.test(raw)) {
    const integer = BigInt(raw)
    return integer >= BigInt(Number.MIN_SAFE_INTEGER) && integer <= BigInt(Number.MAX_SAFE_INTEGER)
      ? Number(integer)
      : integer
  }
  if (/^[+-]?(?:[0-9]+\.?[0-9]*|\.[0-9]+)(?:[ED][+-]?[0-9]+)?$/iu.test(raw)) {
    const value = Number(raw.replace(/[dD]/u, 'E'))
    if (!Number.isFinite(value))
      throw invalidInput('FITS floating-point header value is not finite')
    return value
  }
  throw invalidInput(`FITS header value ${raw} is unsupported or malformed`)
}

const parseCard = (raw: string): FitsHeaderCard => {
  const keywordField = raw.slice(0, 8)
  const keyword = keywordField.trimEnd()
  if (keyword.length === 0) {
    return Object.freeze({ keyword: '', kind: 'blank', text: raw.slice(8).trimEnd(), raw })
  }
  if (!/^[A-Z0-9_-]+$/u.test(keyword) || keywordField !== keyword.padEnd(8, ' ')) {
    throw invalidInput(`FITS header keyword ${keyword} is malformed`)
  }
  if (keyword === 'END') {
    if (raw.slice(8).trim().length !== 0)
      throw invalidInput('FITS END card must be blank after END')
    return Object.freeze({ keyword, kind: 'end', raw })
  }
  if (keyword === 'COMMENT' || keyword === 'HISTORY') {
    return Object.freeze({
      keyword,
      kind: keyword === 'COMMENT' ? 'comment' : 'history',
      text: raw.slice(8).trimEnd(),
      raw,
    })
  }
  if (raw.slice(8, 10) !== '= ') {
    return Object.freeze({ keyword, kind: 'other', text: raw.slice(8).trimEnd(), raw })
  }
  const split = splitValueComment(raw.slice(10))
  return Object.freeze({
    keyword,
    kind: 'value',
    value: parseHeaderValue(split.value),
    ...(split.comment === undefined ? {} : { comment: split.comment }),
    raw,
  })
}

const valueCards = (cards: readonly FitsHeaderCard[]): ReadonlyMap<string, FitsHeaderValue> => {
  const values = new Map<string, FitsHeaderValue>()
  for (const card of cards) {
    if (card.kind !== 'value' || card.value === undefined) continue
    if (values.has(card.keyword)) throw invalidInput(`FITS header repeats ${card.keyword}`)
    values.set(card.keyword, card.value)
  }
  return values
}

const requiredNumber = (values: ReadonlyMap<string, FitsHeaderValue>, keyword: string): number => {
  const value = values.get(keyword)
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw invalidInput(`FITS ${keyword} must be a safe integer`)
  }
  return value
}

const optionalNumber = (
  values: ReadonlyMap<string, FitsHeaderValue>,
  keyword: string,
  fallback: number,
): number => {
  const value = values.get(keyword)
  if (value === undefined) return fallback
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw invalidInput(`FITS ${keyword} must be numeric`)
  }
  return value
}

const requiredOrder = (cards: readonly FitsHeaderCard[], primary: boolean, naxis: number): void => {
  const expected = [primary ? 'SIMPLE' : 'XTENSION', 'BITPIX', 'NAXIS']
  for (let axis = 1; axis <= naxis; axis += 1) expected.push(`NAXIS${axis}`)
  if (!primary) expected.push('PCOUNT', 'GCOUNT')
  for (let index = 0; index < expected.length; index += 1) {
    if (cards[index]?.keyword !== expected[index]) {
      throw invalidInput(`FITS required card ${expected[index]} is out of order or missing`)
    }
  }
}

const readHeader = async (
  source: ImageSource,
  offset: number,
  maxHeaderBlocks: number,
): Promise<{ readonly cards: readonly FitsHeaderCard[]; readonly nextOffset: number }> => {
  const cards: FitsHeaderCard[] = []
  for (let block = 0; block < maxHeaderBlocks; block += 1) {
    const blockOffset = offset + block * blockBytes
    if (blockOffset + blockBytes > source.size)
      throw truncatedInput('FITS header is truncated or missing END')
    const bytes = await readExactly(source, blockOffset, blockBytes)
    for (const byte of bytes) {
      if (byte < 0x20 || byte > 0x7e) throw invalidInput('FITS header contains non-ASCII content')
    }
    const text = new TextDecoder('ascii').decode(bytes)
    for (let card = 0; card < blockBytes / cardBytes; card += 1) {
      const parsed = parseCard(text.slice(card * cardBytes, (card + 1) * cardBytes))
      cards.push(parsed)
      if (parsed.kind === 'end') {
        return {
          cards: Object.freeze(cards),
          nextOffset: blockOffset + blockBytes,
        }
      }
    }
  }
  throw limitExceeded(`FITS header exceeds ${maxHeaderBlocks} blocks`)
}

const parseHdu = async (
  source: ImageSource,
  index: number,
  offset: number,
  maxHeaderBlocks: number,
): Promise<{ readonly hdu: ParsedHdu; readonly nextOffset: number }> => {
  const header = await readHeader(source, offset, maxHeaderBlocks)
  const primary = index === 0
  const values = valueCards(header.cards)
  if (primary && values.get('SIMPLE') !== true)
    throw invalidInput('FITS primary HDU requires SIMPLE = T')
  const extensionValue = primary ? undefined : values.get('XTENSION')
  if (!primary && typeof extensionValue !== 'string') {
    throw invalidInput('FITS extension requires a string XTENSION value')
  }
  const extensionType = typeof extensionValue === 'string' ? extensionValue.trim() : undefined
  const bitpix = requiredNumber(values, 'BITPIX')
  if (!supportedBitpix.has(bitpix)) throw invalidInput(`FITS BITPIX ${bitpix} is invalid`)
  const naxis = requiredNumber(values, 'NAXIS')
  if (naxis < 0 || naxis > 999) throw invalidInput('FITS NAXIS must be between 0 and 999')
  requiredOrder(header.cards, primary, naxis)
  const dimensions: number[] = []
  for (let axis = 1; axis <= naxis; axis += 1) {
    const dimension = requiredNumber(values, `NAXIS${axis}`)
    if (dimension < 0) throw invalidInput(`FITS NAXIS${axis} must be non-negative`)
    dimensions.push(dimension)
  }
  const pcount = primary ? 0 : requiredNumber(values, 'PCOUNT')
  const gcount = primary ? 1 : requiredNumber(values, 'GCOUNT')
  if (pcount < 0 || gcount < 1) throw invalidInput('FITS PCOUNT/GCOUNT values are invalid')
  if (primary && values.get('GROUPS') === true) {
    throw unsupportedOperation('FITS random groups are unsupported')
  }
  const arrayValues =
    naxis === 0 || dimensions.some((dimension) => dimension === 0)
      ? 0n
      : dimensions.reduce((product, dimension) => product * BigInt(dimension), 1n)
  const bytesPerValue = BigInt(Math.abs(bitpix) / 8)
  const dataLength = bytesPerValue * BigInt(gcount) * (BigInt(pcount) + arrayValues)
  const dataByteLength = safeNumber(dataLength, 'data length')
  const dataByteOffset = header.nextOffset
  const paddedEnd = alignBlock(BigInt(dataByteOffset) + dataLength)
  if (paddedEnd > BigInt(source.size)) throw truncatedInput('FITS data unit is truncated')
  const imageType = primary || extensionType === 'IMAGE'
  const canOpenRaster =
    imageType &&
    naxis >= 1 &&
    naxis <= 3 &&
    dimensions.every((dimension) => dimension > 0) &&
    bitpix !== 64 &&
    (primary || (pcount === 0 && gcount === 1))
  const hdu = Object.freeze({
    index,
    primary,
    ...(extensionType === undefined ? {} : { extensionType }),
    bitpix,
    dimensions: Object.freeze(dimensions),
    dataByteOffset,
    dataByteLength,
    canOpenRaster,
    cards: header.cards,
    pcount,
    gcount,
  })
  return { hdu, nextOffset: safeNumber(paddedEnd, 'next HDU offset') }
}

const cardValue = (hdu: FitsHdu, keyword: string): FitsHeaderValue | undefined =>
  hdu.cards.find((card) => card.keyword === keyword && card.kind === 'value')?.value

const storedSampleType = (bitpix: number): RasterSampleType => {
  if (bitpix === 8) return 'uint8'
  if (bitpix === 16) return 'int16'
  if (bitpix === 32) return 'int32'
  if (bitpix === -32) return 'float32'
  if (bitpix === -64) return 'float64'
  return 'uint64'
}

const outputSampleType = (
  bitpix: number,
  bscale: number,
  bzero: number,
  blank: number | undefined,
): RasterSampleType => {
  if (blank !== undefined) return 'float64'
  if (bscale === 1 && bzero === 0) return storedSampleType(bitpix)
  if (bscale === 1 && bitpix === 16 && bzero === 32_768) return 'uint16'
  if (bscale === 1 && bitpix === 32 && bzero === 2_147_483_648) return 'uint32'
  if (bscale === 1 && bitpix === 8 && bzero === -128) return 'int8'
  return 'float64'
}

const validateRequest = (
  request: Readonly<RasterPlaneRequest>,
  width: number,
  height: number,
  depth: number,
): { readonly x: number; readonly y: number; readonly width: number; readonly height: number } => {
  if (!Number.isSafeInteger(request.z) || request.z < 0 || request.z >= depth || request.t !== 0) {
    throw invalidInput('FITS Z/T plane coordinate is outside the image array')
  }
  if (request.resolutionLevel !== undefined && request.resolutionLevel !== 0) {
    throw invalidInput('FITS resolutionLevel must be 0')
  }
  const channels =
    request.c === undefined ? [0] : typeof request.c === 'number' ? [request.c] : request.c
  if (channels.length !== 1 || channels[0] !== 0)
    throw invalidInput('FITS channel selection must be 0')
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
    throw invalidInput('FITS raster region is outside the image array')
  }
  return { x, y, width: selectedWidth, height: selectedHeight }
}

const storedValue = (view: DataView, offset: number, bitpix: number): number => {
  if (bitpix === 8) return view.getUint8(offset)
  if (bitpix === 16) return view.getInt16(offset, false)
  if (bitpix === 32) return view.getInt32(offset, false)
  if (bitpix === -32) return view.getFloat32(offset, false)
  return view.getFloat64(offset, false)
}

const writeConverted = (
  output: DataView,
  offset: number,
  sampleType: RasterSampleType,
  value: number,
): void => {
  if (sampleType === 'int8') output.setInt8(offset, value)
  else if (sampleType === 'uint16') output.setUint16(offset, value, false)
  else if (sampleType === 'uint32') output.setUint32(offset, value, false)
  else output.setFloat64(offset, value, false)
}

class FitsRasterDataset implements FitsDataset {
  readonly format = 'fits' as const
  readonly hdu: FitsHdu
  readonly bitpix: number
  readonly bscale: number
  readonly bzero: number
  readonly blank?: number
  readonly storedSampleType: RasterSampleType
  readonly sampleType: RasterSampleType
  readonly sizeX: number
  readonly sizeY: number
  readonly sizeZ: number
  readonly sizeC = 1
  readonly sizeT = 1
  readonly dimensionOrder = 'XYZCT'
  readonly channels: readonly RasterChannelInfo[]
  readonly metadata: Readonly<Record<string, string>>
  readonly #source: CountingSource
  readonly #limits: Readonly<ImageLimits>
  readonly #rowsPerBlock: number

  constructor(
    source: CountingSource,
    hdu: FitsHdu,
    limits: Readonly<ImageLimits>,
    rowsPerBlock: number,
  ) {
    this.#source = source
    this.#limits = limits
    this.#rowsPerBlock = rowsPerBlock
    this.hdu = hdu
    this.bitpix = hdu.bitpix
    this.storedSampleType = storedSampleType(hdu.bitpix)
    this.bscale = optionalNumber(valueCards(hdu.cards), 'BSCALE', 1)
    this.bzero = optionalNumber(valueCards(hdu.cards), 'BZERO', 0)
    const blankValue = cardValue(hdu, 'BLANK')
    if (blankValue !== undefined) {
      if (hdu.bitpix < 0 || typeof blankValue !== 'number' || !Number.isSafeInteger(blankValue)) {
        throw invalidInput('FITS BLANK is allowed only as an integer value for integer arrays')
      }
      this.blank = blankValue
    }
    this.sampleType = outputSampleType(hdu.bitpix, this.bscale, this.bzero, this.blank)
    this.sizeX = hdu.dimensions[0] ?? 0
    this.sizeY = hdu.dimensions[1] ?? 1
    this.sizeZ = hdu.dimensions[2] ?? 1
    const unit = cardValue(hdu, 'BUNIT')
    this.channels = Object.freeze([
      Object.freeze({ samplesPerPixel: 1, ...(typeof unit === 'string' ? { unit } : {}) }),
    ])
    this.metadata = Object.freeze(
      Object.fromEntries(
        hdu.cards.flatMap((card) =>
          card.kind === 'value' && card.value !== undefined
            ? [[card.keyword, String(card.value)] as const]
            : [],
        ),
      ),
    )
  }

  get sourceBytesRead(): number {
    return this.#source.bytesRead
  }

  async *readPlane(request: Readonly<RasterPlaneRequest>): AsyncGenerator<RasterBlock> {
    const region = validateRequest(request, this.sizeX, this.sizeY, this.sizeZ)
    const inputBytes = Math.abs(this.bitpix) / 8
    const outputBytes = rasterSampleBytes(this.sampleType)
    const rowBytes = region.width * outputBytes
    if (rowBytes > this.#limits.maxDecodedBytes) {
      throw limitExceeded('FITS selected raster row exceeds maxDecodedBytes')
    }
    const rowsPerBlock = Math.min(
      this.#rowsPerBlock,
      Math.max(1, Math.floor(this.#limits.maxDecodedBytes / rowBytes)),
    )
    const preserve = this.sampleType === this.storedSampleType
    for (let localY = 0; localY < region.height; localY += rowsPerBlock) {
      const blockHeight = Math.min(rowsPerBlock, region.height - localY)
      const output = new Uint8Array(rowBytes * blockHeight)
      const outputView = new DataView(output.buffer)
      for (let row = 0; row < blockHeight; row += 1) {
        const sampleIndex =
          request.z * this.sizeX * this.sizeY + (region.y + localY + row) * this.sizeX + region.x
        const inputOffset = this.hdu.dataByteOffset + sampleIndex * inputBytes
        const input = await readExactly(this.#source, inputOffset, region.width * inputBytes)
        const targetOffset = row * rowBytes
        if (preserve) {
          output.set(input, targetOffset)
          continue
        }
        const inputView = new DataView(input.buffer, input.byteOffset, input.byteLength)
        for (let column = 0; column < region.width; column += 1) {
          const stored = storedValue(inputView, column * inputBytes, this.bitpix)
          const physical =
            this.blank !== undefined && stored === this.blank
              ? Number.NaN
              : this.bzero + this.bscale * stored
          writeConverted(outputView, targetOffset + column * outputBytes, this.sampleType, physical)
        }
      }
      yield {
        x: region.x,
        y: region.y + localY,
        width: region.width,
        height: blockHeight,
        stride: rowBytes,
        format: Object.freeze({ sampleType: this.sampleType, channels: 1, planar: false }),
        data: output,
      }
    }
  }
}

class ParsedFitsDocument implements FitsDocument {
  readonly hdus: readonly ParsedHdu[]
  readonly #source: CountingSource
  readonly #limits: Readonly<ImageLimits>
  readonly #rowsPerBlock: number

  constructor(
    source: CountingSource,
    hdus: readonly ParsedHdu[],
    limits: Readonly<ImageLimits>,
    rowsPerBlock: number,
  ) {
    this.#source = source
    this.hdus = hdus
    this.#limits = limits
    this.#rowsPerBlock = rowsPerBlock
  }

  get sourceBytesRead(): number {
    return this.#source.bytesRead
  }

  async openImage(index: number): Promise<FitsDataset> {
    if (!Number.isSafeInteger(index) || index < 0 || index >= this.hdus.length) {
      throw invalidInput('FITS HDU index is outside the document')
    }
    const hdu = this.hdus[index]
    if (!hdu) throw invalidInput('FITS HDU index is outside the document')
    if (!hdu.primary && hdu.extensionType !== 'IMAGE') {
      throw unsupportedOperation(
        `FITS ${hdu.extensionType ?? 'unknown'} extension is not an image array`,
      )
    }
    if (hdu.dimensions.length === 0 || hdu.dimensions.some((dimension) => dimension === 0)) {
      throw unsupportedOperation('FITS HDU has no image array')
    }
    if (hdu.dimensions.length > 3) {
      throw unsupportedOperation('FITS image arrays with more than three axes are unsupported')
    }
    if (hdu.bitpix === 64) {
      throw unsupportedOperation(
        'FITS BITPIX=64 raster opening is unsupported without lossless signed int64 samples',
      )
    }
    if (!hdu.canOpenRaster) throw unsupportedOperation('FITS HDU cannot be opened as a raster')
    if (!hdu.primary && (hdu.pcount !== 0 || hdu.gcount !== 1)) {
      throw unsupportedOperation('FITS IMAGE extensions require PCOUNT=0 and GCOUNT=1')
    }
    const width = hdu.dimensions[0] ?? 0
    const height = hdu.dimensions[1] ?? 1
    const depth = hdu.dimensions[2] ?? 1
    validateImageDimensions(width, height, depth, this.#limits)
    return new FitsRasterDataset(this.#source, hdu, this.#limits, this.#rowsPerBlock)
  }
}

/**
 * Parses a FITS document from any `ImageInput`. Header blocks are read eagerly
 * so callers can inspect all HDUs; image-array bytes remain lazy and are read
 * only by `openImage(...).readPlane(...)`.
 */
export const openFits = async (
  input: ImageInput,
  options: Readonly<FitsOpenOptions> = {},
): Promise<FitsDocument> => {
  const limits = resolveLimits(options)
  const rowsPerBlock = positiveIntegerOption('rowsPerBlock', options.rowsPerBlock ?? 16)
  const maxHeaderBlocks = positiveIntegerOption('maxHeaderBlocks', options.maxHeaderBlocks ?? 1_024)
  const source = new CountingSource(await createImageSource(input, limits))
  const hdus: ParsedHdu[] = []
  let offset = 0
  while (offset < source.size) {
    const parsed = await parseHdu(source, hdus.length, offset, maxHeaderBlocks)
    hdus.push(parsed.hdu)
    offset = parsed.nextOffset
  }
  if (hdus.length === 0) throw truncatedInput('FITS document contains no primary HDU')
  return new ParsedFitsDocument(source, Object.freeze(hdus), limits, rowsPerBlock)
}
