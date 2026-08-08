import type { EncodeRequest, ImageEncoder } from '../codec.ts'
import { invalidInput } from '../errors.ts'
import { iccColorSpace } from '../metadata.ts'
import type { PixelBlock, PixelFormat } from '../pixel.ts'
import type { ImageSink } from '../sink.ts'

class BitWriter {
  #bytes = new Uint8Array(4096)
  #length = 0
  #current = 0
  #bitCount = 0

  writeBits(value: number, length: number): void {
    let remaining = length
    let bits = value
    while (remaining > 0) {
      const count = Math.min(8 - this.#bitCount, remaining)
      this.#current |= (bits & ((1 << count) - 1)) << this.#bitCount
      this.#bitCount += count
      remaining -= count
      bits >>>= count
      if (this.#bitCount === 8) {
        this.#append(this.#current)
        this.#current = 0
        this.#bitCount = 0
      }
    }
  }

  finish(): Uint8Array {
    if (this.#bitCount > 0) this.#append(this.#current)
    this.#current = 0
    this.#bitCount = 0
    return this.#bytes.slice(0, this.#length)
  }

  #append(value: number): void {
    if (this.#length === this.#bytes.length) {
      const grown = new Uint8Array(this.#bytes.length * 2)
      grown.set(this.#bytes)
      this.#bytes = grown
    }
    this.#bytes[this.#length] = value
    this.#length += 1
  }
}

interface HuffmanNode {
  readonly left?: HuffmanNode
  readonly minimumSymbol: number
  readonly right?: HuffmanNode
  readonly symbol?: number
  readonly weight: number
}

interface HuffmanTable {
  readonly codes: Uint16Array
  readonly lengths: Uint8Array
  readonly singleSymbol?: number
}

const reverseBits = (value: number, length: number): number => {
  let reversed = 0
  for (let bit = 0; bit < length; bit += 1) {
    reversed = (reversed << 1) | ((value >>> bit) & 1)
  }
  return reversed
}

const fixedHuffmanLengths = (alphabetSize: number): Uint8Array => {
  const lengths = new Uint8Array(alphabetSize)
  const shortLength = Math.floor(Math.log2(alphabetSize))
  const longSymbols = 2 * (alphabetSize - 2 ** shortLength)
  const shortSymbols = alphabetSize - longSymbols
  lengths.fill(shortLength, 0, shortSymbols)
  lengths.fill(shortLength + 1, shortSymbols)
  return lengths
}

const buildHuffmanLengths = (frequencies: Uint32Array): Uint8Array => {
  const active: HuffmanNode[] = []
  for (let symbol = 0; symbol < frequencies.length; symbol += 1) {
    const weight = frequencies[symbol] ?? 0
    if (weight !== 0) active.push({ weight, symbol, minimumSymbol: symbol })
  }
  if (active.length === 0)
    return Uint8Array.from({ length: frequencies.length }, (_, i) => (i === 0 ? 1 : 0))
  if (active.length === 1) {
    const lengths = new Uint8Array(frequencies.length)
    const symbol = active[0]?.symbol
    if (symbol === undefined) throw invalidInput('WebP Huffman symbol is missing')
    lengths[symbol] = 1
    return lengths
  }

  while (active.length > 1) {
    active.sort(
      (left, right) => left.weight - right.weight || left.minimumSymbol - right.minimumSymbol,
    )
    const left = active.shift()
    const right = active.shift()
    if (!left || !right) throw invalidInput('WebP Huffman tree is incomplete')
    active.push({
      weight: left.weight + right.weight,
      minimumSymbol: Math.min(left.minimumSymbol, right.minimumSymbol),
      left,
      right,
    })
  }

  const lengths = new Uint8Array(frequencies.length)
  const stack: Array<{ readonly depth: number; readonly node: HuffmanNode }> = []
  const root = active[0]
  if (!root) throw invalidInput('WebP Huffman root is missing')
  stack.push({ node: root, depth: 0 })
  let maximumLength = 0
  while (stack.length > 0) {
    const entry = stack.pop()
    if (!entry) continue
    if (entry.node.symbol !== undefined) {
      const length = Math.max(1, entry.depth)
      lengths[entry.node.symbol] = length
      maximumLength = Math.max(maximumLength, length)
      continue
    }
    if (entry.node.right) stack.push({ node: entry.node.right, depth: entry.depth + 1 })
    if (entry.node.left) stack.push({ node: entry.node.left, depth: entry.depth + 1 })
  }
  if (maximumLength <= 15) return lengths

  // Extremely skewed histograms can exceed VP8L's 15-bit limit. The fixed
  // complete tree is a rare, bounded fallback and still enables LZ77.
  return fixedHuffmanLengths(frequencies.length)
}

const buildHuffmanTable = (frequencies: Uint32Array): HuffmanTable => {
  const lengths = buildHuffmanLengths(frequencies)
  const counts = new Uint16Array(16)
  for (const length of lengths) {
    if (length > 15) throw invalidInput('WebP Huffman code length exceeds 15 bits')
    if (length !== 0) counts[length] = (counts[length] ?? 0) + 1
  }
  const nextCode = new Uint16Array(16)
  let code = 0
  for (let length = 1; length <= 15; length += 1) {
    code = (code + (counts[length - 1] ?? 0)) << 1
    nextCode[length] = code
  }
  const codes = new Uint16Array(lengths.length)
  for (let symbol = 0; symbol < lengths.length; symbol += 1) {
    const length = lengths[symbol] ?? 0
    if (length === 0) continue
    const canonical = nextCode[length] ?? 0
    nextCode[length] = canonical + 1
    codes[symbol] = reverseBits(canonical, length)
  }
  let singleSymbol: number | undefined
  let symbolCount = 0
  for (let symbol = 0; symbol < lengths.length; symbol += 1) {
    if ((lengths[symbol] ?? 0) === 0) continue
    singleSymbol = symbol
    symbolCount += 1
  }
  return symbolCount === 1 && singleSymbol !== undefined
    ? { lengths, codes, singleSymbol }
    : { lengths, codes }
}

const codeLengthOrder = Uint8Array.of(
  17,
  18,
  0,
  1,
  2,
  3,
  4,
  5,
  16,
  6,
  7,
  8,
  9,
  10,
  11,
  12,
  13,
  14,
  15,
)

const writeHuffmanTree = (writer: BitWriter, table: HuffmanTable): void => {
  let symbolCount = 0
  let singleSymbol = 0
  for (let symbol = 0; symbol < table.lengths.length; symbol += 1) {
    if ((table.lengths[symbol] ?? 0) === 0) continue
    symbolCount += 1
    singleSymbol = symbol
  }
  if (symbolCount === 1 && singleSymbol <= 255) {
    writer.writeBits(1, 1)
    writer.writeBits(0, 1)
    const useEightBits = singleSymbol > 1
    writer.writeBits(useEightBits ? 1 : 0, 1)
    writer.writeBits(singleSymbol, useEightBits ? 8 : 1)
    return
  }

  writer.writeBits(0, 1)
  writer.writeBits(15, 4)
  for (const symbol of codeLengthOrder) writer.writeBits(symbol <= 15 ? 4 : 0, 3)
  writer.writeBits(0, 1)
  for (const length of table.lengths) writer.writeBits(reverseBits(length, 4), 4)
}

const writeHuffmanSymbol = (writer: BitWriter, table: HuffmanTable, symbol: number): void => {
  if (table.singleSymbol !== undefined) {
    if (symbol !== table.singleSymbol) throw invalidInput(`WebP Huffman symbol ${symbol} is absent`)
    return
  }
  const length = table.lengths[symbol] ?? 0
  if (length === 0) {
    throw invalidInput(`WebP Huffman symbol ${symbol} is absent`)
  }
  writer.writeBits(table.codes[symbol] ?? 0, length)
}

interface PrefixCode {
  readonly extra: number
  readonly extraBits: number
  readonly prefix: number
}

const prefixCode = (value: number, maximumPrefix: number): PrefixCode => {
  if (value < 1) throw invalidInput('WebP prefix value must be positive')
  for (let prefix = 0; prefix <= maximumPrefix; prefix += 1) {
    if (prefix < 4) {
      if (value === prefix + 1) return { prefix, extra: 0, extraBits: 0 }
      continue
    }
    const extraBits = (prefix - 2) >>> 1
    const offset = (2 + (prefix & 1)) << extraBits
    const extra = value - offset - 1
    if (extra >= 0 && extra < 2 ** extraBits) return { prefix, extra, extraBits }
  }
  throw invalidInput(`WebP prefix value ${value} exceeds its alphabet`)
}

const channel = (color: number, shift: number): number => (color >>> shift) & 255
const pack = (alpha: number, red: number, green: number, blue: number): number =>
  (((alpha & 255) << 24) | ((red & 255) << 16) | ((green & 255) << 8) | (blue & 255)) >>> 0

const transformedResidual = (color: number, predicted: number): number => {
  const alpha = (channel(color, 24) - channel(predicted, 24)) & 255
  const green = (channel(color, 8) - channel(predicted, 8)) & 255
  const red = (channel(color, 16) - channel(predicted, 16) - green) & 255
  const blue = (channel(color, 0) - channel(predicted, 0) - green) & 255
  return pack(alpha, red, green, blue)
}

interface PrefixHistograms {
  readonly alpha: Uint32Array
  readonly blue: Uint32Array
  readonly distance: Uint32Array
  readonly green: Uint32Array
  readonly red: Uint32Array
}

interface PrefixTables {
  readonly alpha: HuffmanTable
  readonly blue: HuffmanTable
  readonly distance: HuffmanTable
  readonly green: HuffmanTable
  readonly red: HuffmanTable
}

const matchLength = (pixels: Uint32Array, position: number, distance: number): number => {
  if (position < distance) return 0
  const maximum = Math.min(4096, pixels.length - position)
  let length = 0
  while (
    length < maximum &&
    (pixels[position + length] ?? 0) === (pixels[position + length - distance] ?? 1)
  ) {
    length += 1
  }
  return length
}

const matchHash = (pixels: Uint32Array, position: number): number => {
  const first = pixels[position] ?? 0
  const second = pixels[position + 1] ?? 0
  const third = pixels[position + 2] ?? 0
  return (
    (Math.imul(first ^ (first >>> 16), 0x1e35a7bd) ^
      Math.imul(second ^ (second >>> 15), 0x9e3779b1) ^
      third) >>>
    16
  )
}

const bestMatch = (
  pixels: Uint32Array,
  position: number,
  width: number,
  candidate: number,
): { readonly distance: number; readonly length: number } => {
  let distance = 1
  let length = matchLength(pixels, position, distance)
  const previousRow = matchLength(pixels, position, width)
  if (previousRow > length) {
    distance = width
    length = previousRow
  }
  const candidateDistance = position - candidate
  if (candidate >= 0 && candidateDistance <= 1_048_456) {
    const candidateLength = matchLength(pixels, position, candidateDistance)
    if (candidateLength > length) {
      distance = candidateDistance
      length = candidateLength
    }
  }
  return { length, distance }
}

const distanceCode = (distance: number, width: number): PrefixCode => {
  if (distance === width) return prefixCode(1, 39)
  if (distance === 1) return prefixCode(2, 39)
  return prefixCode(distance + 120, 39)
}

const updateMatches = (
  matches: Int32Array,
  pixels: Uint32Array,
  position: number,
  length: number,
): void => {
  const end = position + length
  for (let current = position; current < end; current += 1) {
    matches[matchHash(pixels, current)] = current
  }
}

const collectHistograms = (pixels: Uint32Array, width: number): PrefixHistograms => {
  const histograms: PrefixHistograms = {
    green: new Uint32Array(280),
    red: new Uint32Array(256),
    blue: new Uint32Array(256),
    alpha: new Uint32Array(256),
    distance: new Uint32Array(40),
  }
  const matches = new Int32Array(1 << 16)
  matches.fill(-1)
  let position = 0
  while (position < pixels.length) {
    const match = bestMatch(pixels, position, width, matches[matchHash(pixels, position)] ?? -1)
    if (match.length >= 2) {
      const lengthCode = prefixCode(match.length, 23)
      histograms.green[256 + lengthCode.prefix] =
        (histograms.green[256 + lengthCode.prefix] ?? 0) + 1
      const distance = distanceCode(match.distance, width)
      histograms.distance[distance.prefix] = (histograms.distance[distance.prefix] ?? 0) + 1
      updateMatches(matches, pixels, position, match.length)
      position += match.length
      continue
    }
    const color = pixels[position] ?? 0
    const green = channel(color, 8)
    const red = channel(color, 16)
    const blue = channel(color, 0)
    const alpha = channel(color, 24)
    histograms.green[green] = (histograms.green[green] ?? 0) + 1
    histograms.red[red] = (histograms.red[red] ?? 0) + 1
    histograms.blue[blue] = (histograms.blue[blue] ?? 0) + 1
    histograms.alpha[alpha] = (histograms.alpha[alpha] ?? 0) + 1
    updateMatches(matches, pixels, position, 1)
    position += 1
  }
  return histograms
}

const buildPrefixTables = (histograms: PrefixHistograms): PrefixTables => ({
  green: buildHuffmanTable(histograms.green),
  red: buildHuffmanTable(histograms.red),
  blue: buildHuffmanTable(histograms.blue),
  alpha: buildHuffmanTable(histograms.alpha),
  distance: buildHuffmanTable(histograms.distance),
})

const writeImageTokens = (
  writer: BitWriter,
  pixels: Uint32Array,
  width: number,
  tables: PrefixTables,
): void => {
  const matches = new Int32Array(1 << 16)
  matches.fill(-1)
  let position = 0
  while (position < pixels.length) {
    const match = bestMatch(pixels, position, width, matches[matchHash(pixels, position)] ?? -1)
    if (match.length >= 2) {
      const lengthCode = prefixCode(match.length, 23)
      writeHuffmanSymbol(writer, tables.green, 256 + lengthCode.prefix)
      writer.writeBits(lengthCode.extra, lengthCode.extraBits)
      const distance = distanceCode(match.distance, width)
      writeHuffmanSymbol(writer, tables.distance, distance.prefix)
      writer.writeBits(distance.extra, distance.extraBits)
      updateMatches(matches, pixels, position, match.length)
      position += match.length
      continue
    }
    const color = pixels[position] ?? 0
    writeHuffmanSymbol(writer, tables.green, channel(color, 8))
    writeHuffmanSymbol(writer, tables.red, channel(color, 16))
    writeHuffmanSymbol(writer, tables.blue, channel(color, 0))
    writeHuffmanSymbol(writer, tables.alpha, channel(color, 24))
    updateMatches(matches, pixels, position, 1)
    position += 1
  }
}

const singleSymbolTable = (alphabetSize: number, symbol: number): HuffmanTable => {
  const frequencies = new Uint32Array(alphabetSize)
  frequencies[symbol] = 1
  return buildHuffmanTable(frequencies)
}

const writePredictorImage = (writer: BitWriter): void => {
  writer.writeBits(0, 1)
  const tables: PrefixTables = {
    green: singleSymbolTable(280, 1),
    red: singleSymbolTable(256, 0),
    blue: singleSymbolTable(256, 0),
    alpha: singleSymbolTable(256, 0),
    distance: singleSymbolTable(40, 0),
  }
  writeHuffmanTree(writer, tables.green)
  writeHuffmanTree(writer, tables.red)
  writeHuffmanTree(writer, tables.blue)
  writeHuffmanTree(writer, tables.alpha)
  writeHuffmanTree(writer, tables.distance)
}

const encodeImageBits = (pixels: Uint32Array, width: number): Uint8Array => {
  const writer = new BitWriter()
  writer.writeBits(1, 1)
  writer.writeBits(0, 2)
  writer.writeBits(0, 3)
  writePredictorImage(writer)
  writer.writeBits(1, 1)
  writer.writeBits(2, 2)
  writer.writeBits(0, 1)
  writer.writeBits(0, 1)
  writer.writeBits(0, 1)

  const tables = buildPrefixTables(collectHistograms(pixels, width))
  writeHuffmanTree(writer, tables.green)
  writeHuffmanTree(writer, tables.red)
  writeHuffmanTree(writer, tables.blue)
  writeHuffmanTree(writer, tables.alpha)
  writeHuffmanTree(writer, tables.distance)
  writeImageTokens(writer, pixels, width, tables)
  return writer.finish()
}

const uint32 = (data: Uint8Array, offset: number, value: number): void => {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  view.setUint32(offset, value, true)
}

const uint24 = (data: Uint8Array, offset: number, value: number): void => {
  data[offset] = value & 255
  data[offset + 1] = (value >>> 8) & 255
  data[offset + 2] = (value >>> 16) & 255
}

const channels = (format: PixelFormat): number => {
  if (format === 'gray8') return 1
  if (format === 'rgb8') return 3
  if (format === 'rgba8') return 4
  throw invalidInput(`WebP encoder does not support ${format} pixels`)
}

const writeChunk = async (sink: ImageSink, type: Uint8Array, data: Uint8Array): Promise<void> => {
  const output = new Uint8Array(8 + data.byteLength + (data.byteLength & 1))
  output.set(type)
  uint32(output, 4, data.byteLength)
  output.set(data, 8)
  await sink.write(output)
}

class LosslessWebpEncoder implements ImageEncoder {
  readonly #sink: ImageSink
  readonly #width: number
  readonly #height: number
  readonly #format: PixelFormat
  readonly #channels: number
  readonly #icc: Uint8Array | undefined
  readonly #exif: Uint8Array | undefined
  #pixels: Uint32Array | undefined
  #previousRow: Uint32Array
  #currentRow: Uint32Array
  #expectedY = 0
  #finished = false

  constructor(sink: ImageSink, request: EncodeRequest) {
    this.#sink = sink
    this.#width = request.width
    this.#height = request.height
    this.#format = request.pixelFormat
    this.#channels = channels(request.pixelFormat)
    this.#icc = request.metadata?.icc
    this.#exif = request.metadata?.exif
    this.#pixels = new Uint32Array(request.width * request.height)
    this.#previousRow = new Uint32Array(request.width)
    this.#currentRow = new Uint32Array(request.width)
  }

  async write(block: PixelBlock): Promise<void> {
    if (this.#finished) throw new Error('Cannot write to a finished WebP encoder')
    const pixels = this.#pixels
    if (!pixels) throw new Error('WebP encoder pixel storage was released')
    const rowBytes = this.#width * this.#channels
    if (
      block.x !== 0 ||
      block.y !== this.#expectedY ||
      block.width !== this.#width ||
      block.height < 1 ||
      block.y + block.height > this.#height ||
      block.format !== this.#format ||
      block.stride < rowBytes ||
      block.data.byteLength < block.stride * (block.height - 1) + rowBytes
    ) {
      throw invalidInput('WebP encoder requires ordered, full-width pixel blocks')
    }

    for (let row = 0; row < block.height; row += 1) {
      const y = this.#expectedY + row
      for (let x = 0; x < this.#width; x += 1) {
        const offset = row * block.stride + x * this.#channels
        const red = block.data[offset] ?? 0
        const green = this.#channels === 1 ? red : (block.data[offset + 1] ?? 0)
        const blue = this.#channels === 1 ? red : (block.data[offset + 2] ?? 0)
        const alpha = this.#channels === 4 ? (block.data[offset + 3] ?? 0) : 255
        const color = pack(alpha, red, green, blue)
        this.#currentRow[x] = color
        const predicted =
          y === 0
            ? x === 0
              ? 0xff000000
              : (this.#currentRow[x - 1] ?? 0)
            : x === 0
              ? (this.#previousRow[x] ?? 0)
              : (this.#currentRow[x - 1] ?? 0)
        pixels[y * this.#width + x] = transformedResidual(color, predicted)
      }
      const previous = this.#previousRow
      this.#previousRow = this.#currentRow
      this.#currentRow = previous
    }
    this.#expectedY += block.height
  }

  async finish(): Promise<void> {
    if (this.#finished) throw new Error('WebP encoder is already finished')
    this.#finished = true
    if (this.#expectedY !== this.#height) {
      throw invalidInput(`WebP encoder received ${this.#expectedY} of ${this.#height} rows`)
    }
    const pixels = this.#pixels
    if (!pixels) throw new Error('WebP encoder pixel storage was released')
    const bits = encodeImageBits(pixels, this.#width)
    this.#pixels = undefined
    this.#previousRow = new Uint32Array(0)
    this.#currentRow = new Uint32Array(0)

    const payload = new Uint8Array(5 + bits.byteLength)
    payload[0] = 0x2f
    uint32(
      payload,
      1,
      (this.#width - 1) | ((this.#height - 1) << 14) | (this.#format === 'rgba8' ? 1 << 28 : 0),
    )
    payload.set(bits, 5)

    const iccBytes = this.#icc ? 8 + this.#icc.byteLength + (this.#icc.byteLength & 1) : 0
    const exifBytes = this.#exif ? 8 + this.#exif.byteLength + (this.#exif.byteLength & 1) : 0
    const extended = this.#icc !== undefined || this.#exif !== undefined
    const bodyLength =
      4 +
      (extended ? 18 + iccBytes : 0) +
      8 +
      payload.byteLength +
      (payload.byteLength & 1) +
      exifBytes
    const header = new Uint8Array(12 + (extended ? 18 : 0))
    header.set([0x52, 0x49, 0x46, 0x46], 0)
    uint32(header, 4, bodyLength)
    header.set([0x57, 0x45, 0x42, 0x50], 8)
    if (extended) {
      header.set([0x56, 0x50, 0x38, 0x58], 12)
      uint32(header, 16, 10)
      header[20] =
        (this.#icc ? 0x20 : 0) | (this.#format === 'rgba8' ? 0x10 : 0) | (this.#exif ? 0x08 : 0)
      uint24(header, 24, this.#width - 1)
      uint24(header, 27, this.#height - 1)
    }
    await this.#sink.write(header)
    if (this.#icc) await writeChunk(this.#sink, Uint8Array.of(73, 67, 67, 80), this.#icc)
    await writeChunk(this.#sink, Uint8Array.of(86, 80, 56, 76), payload)
    if (this.#exif) await writeChunk(this.#sink, Uint8Array.of(69, 88, 73, 70), this.#exif)
  }

  async abort(): Promise<void> {
    this.#finished = true
    this.#pixels = undefined
    this.#previousRow = new Uint32Array(0)
    this.#currentRow = new Uint32Array(0)
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

export const createLosslessWebpEncoder = async (
  sink: ImageSink,
  request: EncodeRequest,
): Promise<ImageEncoder> => {
  if (
    !Number.isSafeInteger(request.width) ||
    !Number.isSafeInteger(request.height) ||
    request.width < 1 ||
    request.height < 1 ||
    request.width > 16_384 ||
    request.height > 16_384
  ) {
    throw invalidInput(
      `Invalid lossless WebP output dimensions: ${request.width}x${request.height}`,
    )
  }
  if (!isRecord(request.options) || request.options.lossless !== true) {
    throw invalidInput('Lossless WebP encoding requires lossless: true')
  }
  channels(request.pixelFormat)
  const icc = request.metadata?.icc
  if (icc && iccColorSpace(icc) !== 'rgb') {
    throw invalidInput('Preserved ICC profile does not match WebP RGB output pixels')
  }
  return new LosslessWebpEncoder(sink, request)
}
