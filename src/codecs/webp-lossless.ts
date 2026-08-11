import { invalidInput, truncatedInput } from '../errors.ts'

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

export const vp8lDistanceMap = Int8Array.of(
  0,
  1,
  1,
  0,
  1,
  1,
  -1,
  1,
  0,
  2,
  2,
  0,
  1,
  2,
  -1,
  2,
  2,
  1,
  -2,
  1,
  2,
  2,
  -2,
  2,
  0,
  3,
  3,
  0,
  1,
  3,
  -1,
  3,
  3,
  1,
  -3,
  1,
  2,
  3,
  -2,
  3,
  3,
  2,
  -3,
  2,
  0,
  4,
  4,
  0,
  1,
  4,
  -1,
  4,
  4,
  1,
  -4,
  1,
  3,
  3,
  -3,
  3,
  2,
  4,
  -2,
  4,
  4,
  2,
  -4,
  2,
  0,
  5,
  3,
  4,
  -3,
  4,
  4,
  3,
  -4,
  3,
  5,
  0,
  1,
  5,
  -1,
  5,
  5,
  1,
  -5,
  1,
  2,
  5,
  -2,
  5,
  5,
  2,
  -5,
  2,
  4,
  4,
  -4,
  4,
  3,
  5,
  -3,
  5,
  5,
  3,
  -5,
  3,
  0,
  6,
  6,
  0,
  1,
  6,
  -1,
  6,
  6,
  1,
  -6,
  1,
  2,
  6,
  -2,
  6,
  6,
  2,
  -6,
  2,
  4,
  5,
  -4,
  5,
  5,
  4,
  -5,
  4,
  3,
  6,
  -3,
  6,
  6,
  3,
  -6,
  3,
  0,
  7,
  7,
  0,
  1,
  7,
  -1,
  7,
  5,
  5,
  -5,
  5,
  7,
  1,
  -7,
  1,
  4,
  6,
  -4,
  6,
  6,
  4,
  -6,
  4,
  2,
  7,
  -2,
  7,
  7,
  2,
  -7,
  2,
  3,
  7,
  -3,
  7,
  7,
  3,
  -7,
  3,
  5,
  6,
  -5,
  6,
  6,
  5,
  -6,
  5,
  8,
  0,
  4,
  7,
  -4,
  7,
  7,
  4,
  -7,
  4,
  8,
  1,
  8,
  2,
  6,
  6,
  -6,
  6,
  8,
  3,
  5,
  7,
  -5,
  7,
  7,
  5,
  -7,
  5,
  8,
  4,
  6,
  7,
  -6,
  7,
  7,
  6,
  -7,
  6,
  8,
  5,
  7,
  7,
  -7,
  7,
  8,
  6,
  8,
  7,
)

class BitReader {
  readonly #data: Uint8Array
  readonly #end: number
  #offset: number
  #bits = 0
  #bitCount = 0

  constructor(data: Uint8Array, offset: number, length: number) {
    this.#data = data
    this.#offset = offset
    this.#end = offset + length
  }

  readBits(length: number): number {
    if (length < 0 || length > 24) throw invalidInput('WebP bit length is invalid')
    let value = 0
    let written = 0
    while (written < length) {
      if (this.#bitCount === 0) {
        const next = this.#data[this.#offset]
        if (next === undefined || this.#offset >= this.#end)
          throw truncatedInput('WebP lossless bitstream is truncated')
        this.#bits = next
        this.#offset += 1
        this.#bitCount = 8
      }
      const take = Math.min(this.#bitCount, length - written)
      value |= (this.#bits & ((1 << take) - 1)) << written
      this.#bits >>>= take
      this.#bitCount -= take
      written += take
    }
    return value
  }
}

interface HuffmanCode {
  readonly symbols: ReadonlyMap<number, number>
  readonly maximumLength: number
  readonly singleSymbol?: number
}

interface PrefixGroup {
  readonly green: HuffmanCode
  readonly red: HuffmanCode
  readonly blue: HuffmanCode
  readonly alpha: HuffmanCode
  readonly distance: HuffmanCode
}

const reverseBits = (value: number, length: number): number => {
  let reversed = 0
  for (let index = 0; index < length; index += 1) {
    reversed = (reversed << 1) | ((value >>> index) & 1)
  }
  return reversed
}

type Transform =
  | {
      readonly type: 'predictor'
      readonly sizeBits: number
      readonly width: number
      readonly data: Uint32Array
    }
  | {
      readonly type: 'color'
      readonly sizeBits: number
      readonly width: number
      readonly data: Uint32Array
    }
  | { readonly type: 'subtract-green' }
  | {
      readonly type: 'color-indexing'
      readonly width: number
      readonly widthBits: number
      readonly palette: Uint32Array
    }

const buildHuffmanCode = (lengths: Uint8Array): HuffmanCode => {
  const counts = new Uint16Array(16)
  let symbolCount = 0
  let maximumLength = 0
  let singleSymbol: number | undefined
  for (let symbol = 0; symbol < lengths.length; symbol += 1) {
    const length = lengths[symbol] ?? 0
    if (length > 15) throw invalidInput('WebP Huffman code length exceeds 15 bits')
    if (length === 0) continue
    counts[length] = (counts[length] ?? 0) + 1
    maximumLength = Math.max(maximumLength, length)
    singleSymbol = symbol
    symbolCount += 1
  }
  if (symbolCount === 0) return { symbols: new Map(), maximumLength: 0, singleSymbol: 0 }

  let available = 1
  for (let length = 1; length <= 15; length += 1) {
    available = available * 2 - (counts[length] ?? 0)
    if (available < 0) throw invalidInput('WebP Huffman tree is oversubscribed')
  }
  if (symbolCount > 1 && available !== 0) throw invalidInput('WebP Huffman tree is incomplete')
  if (symbolCount === 1) {
    if (singleSymbol === undefined) throw invalidInput('WebP Huffman symbol is missing')
    return { symbols: new Map(), maximumLength: 0, singleSymbol }
  }

  const nextCode = new Uint16Array(16)
  let code = 0
  for (let length = 1; length <= 15; length += 1) {
    code = (code + (counts[length - 1] ?? 0)) << 1
    nextCode[length] = code
  }
  const symbols = new Map<number, number>()
  for (let symbol = 0; symbol < lengths.length; symbol += 1) {
    const length = lengths[symbol] ?? 0
    if (length === 0) continue
    const canonical = nextCode[length] ?? 0
    nextCode[length] = canonical + 1
    symbols.set((1 << length) | reverseBits(canonical, length), symbol)
  }
  return { symbols, maximumLength }
}

const readHuffmanSymbol = (reader: BitReader, code: HuffmanCode): number => {
  if (code.singleSymbol !== undefined) return code.singleSymbol
  let bits = 0
  for (let length = 1; length <= code.maximumLength; length += 1) {
    bits |= reader.readBits(1) << (length - 1)
    const symbol = code.symbols.get((1 << length) | bits)
    if (symbol !== undefined) return symbol
  }
  throw invalidInput('WebP Huffman symbol is invalid')
}

const readHuffmanCode = (reader: BitReader, alphabetSize: number): HuffmanCode => {
  const lengths = new Uint8Array(alphabetSize)
  if (reader.readBits(1) === 1) {
    const symbols = reader.readBits(1) + 1
    const first = reader.readBits(1 + 7 * reader.readBits(1))
    if (first >= alphabetSize) throw invalidInput('WebP simple Huffman symbol exceeds its alphabet')
    lengths[first] = 1
    if (symbols === 2) {
      const second = reader.readBits(8)
      if (second >= alphabetSize)
        throw invalidInput('WebP simple Huffman symbol exceeds its alphabet')
      lengths[second] = 1
    }
    return buildHuffmanCode(lengths)
  }

  const codeLengthLengths = new Uint8Array(19)
  const count = 4 + reader.readBits(4)
  for (let index = 0; index < count; index += 1) {
    codeLengthLengths[codeLengthOrder[index] ?? 0] = reader.readBits(3)
  }
  const codeLengthCode = buildHuffmanCode(codeLengthLengths)
  const useMaximum = reader.readBits(1)
  const maximumCodes =
    useMaximum === 0 ? alphabetSize : 2 + reader.readBits(2 + 2 * reader.readBits(3))
  if (maximumCodes > alphabetSize)
    throw invalidInput('WebP Huffman symbol count exceeds its alphabet')

  let index = 0
  let codesRead = 0
  let previous = 8
  while (index < alphabetSize && codesRead < maximumCodes) {
    const symbol = readHuffmanSymbol(reader, codeLengthCode)
    codesRead += 1
    if (symbol < 16) {
      lengths[index] = symbol
      if (symbol !== 0) previous = symbol
      index += 1
      continue
    }
    const repeat =
      symbol === 16
        ? 3 + reader.readBits(2)
        : symbol === 17
          ? 3 + reader.readBits(3)
          : symbol === 18
            ? 11 + reader.readBits(7)
            : 0
    if (repeat === 0 || index + repeat > alphabetSize)
      throw invalidInput('WebP Huffman code-length repeat is invalid')
    const value = symbol === 16 ? previous : 0
    const end = index + repeat
    lengths.fill(value, index, end)
    index = end
  }
  return buildHuffmanCode(lengths)
}

const prefixValue = (reader: BitReader, prefix: number): number => {
  if (prefix < 4) return prefix + 1
  const extraBits = (prefix - 2) >>> 1
  const offset = (2 + (prefix & 1)) << extraBits
  return offset + reader.readBits(extraBits) + 1
}

const distanceValue = (code: number, width: number): number => {
  if (code > 120) return code - 120
  const offset = (code - 1) * 2
  const x = vp8lDistanceMap[offset]
  const y = vp8lDistanceMap[offset + 1]
  if (x === undefined || y === undefined) throw invalidInput('WebP distance code is invalid')
  return Math.max(1, x + y * width)
}

const cacheIndex = (color: number, bits: number): number =>
  Math.imul(0x1e35a7bd, color) >>> (32 - bits)

const insertCache = (cache: Uint32Array | undefined, bits: number, color: number): void => {
  if (cache) cache[cacheIndex(color, bits)] = color
}

const maximumBackwardDistance = 1_048_576

function* decodeImageRows(
  reader: BitReader,
  width: number,
  height: number,
  spatial: boolean,
): IterableIterator<Uint32Array> {
  let cacheBits = 0
  let cache: Uint32Array | undefined
  if (reader.readBits(1) === 1) {
    cacheBits = reader.readBits(4)
    if (cacheBits < 1 || cacheBits > 11) throw invalidInput('WebP color cache size is invalid')
    cache = new Uint32Array(1 << cacheBits)
  }

  let prefixBits = 0
  let prefixWidth = 1
  let metaCodes: Uint32Array | undefined
  let groupCount = 1
  if (spatial && reader.readBits(1) === 1) {
    prefixBits = reader.readBits(3) + 2
    prefixWidth = Math.ceil(width / 2 ** prefixBits)
    const prefixHeight = Math.ceil(height / 2 ** prefixBits)
    metaCodes = decodeImageData(reader, prefixWidth, prefixHeight, false)
    let maximum = 0
    for (const pixel of metaCodes) maximum = Math.max(maximum, (pixel >>> 8) & 0xffff)
    groupCount = maximum + 1
  }

  const groups: PrefixGroup[] = []
  const cacheSize = cache?.length ?? 0
  for (let index = 0; index < groupCount; index += 1) {
    groups.push({
      green: readHuffmanCode(reader, 256 + 24 + cacheSize),
      red: readHuffmanCode(reader, 256),
      blue: readHuffmanCode(reader, 256),
      alpha: readHuffmanCode(reader, 256),
      distance: readHuffmanCode(reader, 40),
    })
  }

  const pixelCount = width * height
  const history = new Uint32Array(Math.min(pixelCount, maximumBackwardDistance))
  let row = new Uint32Array(width)
  let position = 0
  const write = (color: number): Uint32Array | undefined => {
    history[position % history.length] = color
    row[position % width] = color
    insertCache(cache, cacheBits, color)
    position += 1
    if (position % width !== 0) return undefined
    const completed = row
    row = new Uint32Array(width)
    return completed
  }
  while (position < pixelCount) {
    const x = position % width
    const y = Math.floor(position / width)
    const metaIndex = (y >>> prefixBits) * prefixWidth + (x >>> prefixBits)
    const groupIndex = metaCodes ? ((metaCodes[metaIndex] ?? 0) >>> 8) & 0xffff : 0
    const group = groups[groupIndex]
    if (!group) throw invalidInput('WebP meta prefix code is invalid')
    const symbol = readHuffmanSymbol(reader, group.green)
    if (symbol < 256) {
      const red = readHuffmanSymbol(reader, group.red)
      const blue = readHuffmanSymbol(reader, group.blue)
      const alpha = readHuffmanSymbol(reader, group.alpha)
      const color = ((alpha << 24) | (red << 16) | (symbol << 8) | blue) >>> 0
      const completed = write(color)
      if (completed) yield completed
      continue
    }
    if (symbol < 280) {
      const length = prefixValue(reader, symbol - 256)
      const distancePrefix = readHuffmanSymbol(reader, group.distance)
      const distanceCode = prefixValue(reader, distancePrefix)
      const distance = distanceValue(distanceCode, width)
      if (distance > position || position + length > pixelCount)
        throw invalidInput(
          `WebP backward reference exceeds decoded pixels (${position}, length ${length}, distance prefix ${distancePrefix}, code ${distanceCode}, distance ${distance}, size ${pixelCount})`,
        )
      for (let index = 0; index < length; index += 1) {
        const color = history[(position - distance) % history.length] ?? 0
        const completed = write(color)
        if (completed) yield completed
      }
      continue
    }
    const cacheEntry = symbol - 280
    if (!cache || cacheEntry >= cache.length) throw invalidInput('WebP color cache code is invalid')
    const color = cache[cacheEntry] ?? 0
    const completed = write(color)
    if (completed) yield completed
  }
}

const decodeImageData = (
  reader: BitReader,
  width: number,
  height: number,
  spatial: boolean,
): Uint32Array => {
  const pixels = new Uint32Array(width * height)
  let offset = 0
  for (const row of decodeImageRows(reader, width, height, spatial)) {
    pixels.set(row, offset)
    offset += row.length
  }
  return pixels
}

const channel = (color: number, shift: number): number => (color >>> shift) & 255
const pack = (alpha: number, red: number, green: number, blue: number): number =>
  (((alpha & 255) << 24) | ((red & 255) << 16) | ((green & 255) << 8) | (blue & 255)) >>> 0
const clamp = (value: number): number => (value < 0 ? 0 : value > 255 ? 255 : value)

const average = (first: number, second: number): number =>
  pack(
    (channel(first, 24) + channel(second, 24)) >>> 1,
    (channel(first, 16) + channel(second, 16)) >>> 1,
    (channel(first, 8) + channel(second, 8)) >>> 1,
    (channel(first, 0) + channel(second, 0)) >>> 1,
  )

const select = (left: number, top: number, topLeft: number): number => {
  let leftDistance = 0
  let topDistance = 0
  for (let shift = 24; shift >= 0; shift -= 8) {
    const estimate = channel(left, shift) + channel(top, shift) - channel(topLeft, shift)
    leftDistance += Math.abs(estimate - channel(left, shift))
    topDistance += Math.abs(estimate - channel(top, shift))
  }
  return leftDistance < topDistance ? left : top
}

const predictor = (
  mode: number,
  left: number,
  top: number,
  topLeft: number,
  topRight: number,
): number => {
  if (mode === 0) return 0xff000000
  if (mode === 1) return left
  if (mode === 2) return top
  if (mode === 3) return topRight
  if (mode === 4) return topLeft
  if (mode === 5) return average(average(left, topRight), top)
  if (mode === 6) return average(left, topLeft)
  if (mode === 7) return average(left, top)
  if (mode === 8) return average(topLeft, top)
  if (mode === 9) return average(top, topRight)
  if (mode === 10) return average(average(left, topLeft), average(top, topRight))
  if (mode === 11) return select(left, top, topLeft)
  if (mode === 12) {
    return pack(
      clamp(channel(left, 24) + channel(top, 24) - channel(topLeft, 24)),
      clamp(channel(left, 16) + channel(top, 16) - channel(topLeft, 16)),
      clamp(channel(left, 8) + channel(top, 8) - channel(topLeft, 8)),
      clamp(channel(left, 0) + channel(top, 0) - channel(topLeft, 0)),
    )
  }
  if (mode === 13) {
    const base = average(left, top)
    const baseAlpha = channel(base, 24)
    const baseRed = channel(base, 16)
    const baseGreen = channel(base, 8)
    const baseBlue = channel(base, 0)
    return pack(
      clamp(baseAlpha + Math.trunc((baseAlpha - channel(topLeft, 24)) / 2)),
      clamp(baseRed + Math.trunc((baseRed - channel(topLeft, 16)) / 2)),
      clamp(baseGreen + Math.trunc((baseGreen - channel(topLeft, 8)) / 2)),
      clamp(baseBlue + Math.trunc((baseBlue - channel(topLeft, 0)) / 2)),
    )
  }
  throw invalidInput('WebP predictor mode is invalid')
}

const addPixels = (residual: number, predicted: number): number =>
  pack(
    channel(residual, 24) + channel(predicted, 24),
    channel(residual, 16) + channel(predicted, 16),
    channel(residual, 8) + channel(predicted, 8),
    channel(residual, 0) + channel(predicted, 0),
  )

const inversePredictorRow = (
  row: Uint32Array,
  width: number,
  y: number,
  previous: Uint32Array | undefined,
  transform: Extract<Transform, { type: 'predictor' }>,
): void => {
  for (let x = 0; x < width; x += 1) {
    let predicted: number
    if (y === 0 && x === 0) predicted = 0xff000000
    else if (y === 0) predicted = row[x - 1] ?? 0
    else if (x === 0) predicted = previous?.[0] ?? 0
    else {
      const modePosition = (y >>> transform.sizeBits) * transform.width + (x >>> transform.sizeBits)
      const mode = ((transform.data[modePosition] ?? 0) >>> 8) & 255
      predicted = predictor(
        mode,
        row[x - 1] ?? 0,
        previous?.[x] ?? 0,
        previous?.[x - 1] ?? 0,
        x === width - 1 ? (row[0] ?? 0) : (previous?.[x + 1] ?? 0),
      )
    }
    row[x] = addPixels(row[x] ?? 0, predicted)
  }
}

const signedByte = (value: number): number => (value < 128 ? value : value - 256)
const colorDelta = (transform: number, color: number): number =>
  (signedByte(transform) * signedByte(color)) >> 5

const inverseColorRow = (
  row: Uint32Array,
  width: number,
  y: number,
  transform: Extract<Transform, { type: 'color' }>,
): void => {
  for (let x = 0; x < width; x += 1) {
    const element =
      transform.data[(y >>> transform.sizeBits) * transform.width + (x >>> transform.sizeBits)] ?? 0
    const color = row[x] ?? 0
    const green = channel(color, 8)
    const red = (channel(color, 16) + colorDelta(channel(element, 0), green)) & 255
    const blue =
      (channel(color, 0) +
        colorDelta(channel(element, 8), green) +
        colorDelta(channel(element, 16), red)) &
      255
    row[x] = pack(channel(color, 24), red, green, blue)
  }
}

const inverseSubtractGreen = (pixels: Uint32Array): void => {
  for (let index = 0; index < pixels.length; index += 1) {
    const color = pixels[index] ?? 0
    const green = channel(color, 8)
    pixels[index] = pack(
      channel(color, 24),
      channel(color, 16) + green,
      green,
      channel(color, 0) + green,
    )
  }
}

const addPaletteDeltas = (deltas: Uint32Array): Uint32Array => {
  const palette = new Uint32Array(deltas.length)
  let previous = 0
  for (let index = 0; index < deltas.length; index += 1) {
    previous = addPixels(previous, deltas[index] ?? 0)
    palette[index] = previous
  }
  return palette
}

const inverseColorIndexingRow = (
  row: Uint32Array,
  transform: Extract<Transform, { type: 'color-indexing' }>,
): Uint32Array => {
  const output = new Uint32Array(transform.width)
  const packedWidth = Math.ceil(transform.width / 2 ** transform.widthBits)
  if (row.length !== packedWidth) throw invalidInput('WebP color-index row width is invalid')
  const mask = (1 << (8 >>> transform.widthBits)) - 1
  for (let x = 0; x < transform.width; x += 1) {
    const packed = row[x >>> transform.widthBits] ?? 0
    const index =
      (channel(packed, 8) >>>
        ((x & ((1 << transform.widthBits) - 1)) * (8 >>> transform.widthBits))) &
      mask
    output[x] = transform.palette[index] ?? 0
  }
  return output
}

export interface LosslessWebpImage {
  readonly width: number
  readonly height: number
  rows(): Iterable<LosslessWebpRows>
}

export interface LosslessWebpRows {
  readonly y: number
  readonly pixels: Uint32Array
}

function* decodeLosslessImageRows(
  reader: BitReader,
  width: number,
  height: number,
): IterableIterator<LosslessWebpRows> {
  const transforms: Transform[] = []
  const seen = new Set<number>()
  let encodedWidth = width
  while (reader.readBits(1) === 1) {
    const type = reader.readBits(2)
    if (seen.has(type)) throw invalidInput('WebP lossless transform is repeated')
    seen.add(type)
    if (type === 0 || type === 1) {
      const sizeBits = reader.readBits(3) + 2
      const transformWidth = Math.ceil(encodedWidth / 2 ** sizeBits)
      const data = decodeImageData(reader, transformWidth, Math.ceil(height / 2 ** sizeBits), false)
      transforms.push({
        type: type === 0 ? 'predictor' : 'color',
        sizeBits,
        width: transformWidth,
        data,
      })
    } else if (type === 2) {
      transforms.push({ type: 'subtract-green' })
    } else {
      const paletteSize = reader.readBits(8) + 1
      const palette = addPaletteDeltas(decodeImageData(reader, paletteSize, 1, false))
      const widthBits = paletteSize <= 2 ? 3 : paletteSize <= 4 ? 2 : paletteSize <= 16 ? 1 : 0
      transforms.push({ type: 'color-indexing', width: encodedWidth, widthBits, palette })
      encodedWidth = Math.ceil(encodedWidth / 2 ** widthBits)
    }
  }

  let predictorPrevious: Uint32Array | undefined
  let y = 0
  for (const encodedRow of decodeImageRows(reader, encodedWidth, height, true)) {
    let row = encodedRow
    let currentWidth = encodedWidth
    for (let index = transforms.length - 1; index >= 0; index -= 1) {
      const transform = transforms[index]
      if (!transform) continue
      if (transform.type === 'color-indexing') {
        row = inverseColorIndexingRow(row, transform)
        currentWidth = transform.width
      } else if (transform.type === 'subtract-green') inverseSubtractGreen(row)
      else if (transform.type === 'color') inverseColorRow(row, currentWidth, y, transform)
      else {
        inversePredictorRow(row, currentWidth, y, predictorPrevious, transform)
        predictorPrevious = Uint32Array.from(row)
      }
    }
    if (currentWidth !== width || row.length !== width) {
      throw invalidInput('WebP lossless transforms produced invalid dimensions')
    }
    yield { y, pixels: row }
    y += 1
  }
}

export const decodeLosslessWebp = (
  data: Uint8Array,
  offset: number,
  length: number,
  validateDimensions: (width: number, height: number) => void,
): LosslessWebpImage => {
  if (data[offset] !== 0x2f) throw invalidInput('WebP lossless signature is invalid')
  const reader = new BitReader(data, offset + 1, length - 1)
  const width = reader.readBits(14) + 1
  const height = reader.readBits(14) + 1
  reader.readBits(1)
  if (reader.readBits(3) !== 0) throw invalidInput('WebP lossless version is unsupported')
  validateDimensions(width, height)
  return {
    width,
    height,
    *rows(): IterableIterator<LosslessWebpRows> {
      const imageReader = new BitReader(data, offset + 1, length - 1)
      imageReader.readBits(14)
      imageReader.readBits(14)
      imageReader.readBits(1)
      imageReader.readBits(3)
      yield* decodeLosslessImageRows(imageReader, width, height)
    },
  }
}

export const decodeLosslessWebpAlpha = (
  data: Uint8Array,
  offset: number,
  length: number,
  width: number,
  height: number,
): LosslessWebpImage => ({
  width,
  height,
  *rows(): IterableIterator<LosslessWebpRows> {
    yield* decodeLosslessImageRows(new BitReader(data, offset, length), width, height)
  },
})
