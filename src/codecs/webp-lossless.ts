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

const distanceMap = Int8Array.of(
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
  const x = distanceMap[offset]
  const y = distanceMap[offset + 1]
  if (x === undefined || y === undefined) throw invalidInput('WebP distance code is invalid')
  return Math.max(1, x + y * width)
}

const cacheIndex = (color: number, bits: number): number =>
  Math.imul(0x1e35a7bd, color) >>> (32 - bits)

const insertCache = (cache: Uint32Array | undefined, bits: number, color: number): void => {
  if (cache) cache[cacheIndex(color, bits)] = color
}

const decodeImageData = (
  reader: BitReader,
  width: number,
  height: number,
  spatial: boolean,
): Uint32Array => {
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

  const pixels = new Uint32Array(width * height)
  let position = 0
  while (position < pixels.length) {
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
      pixels[position] = color
      insertCache(cache, cacheBits, color)
      position += 1
      continue
    }
    if (symbol < 280) {
      const length = prefixValue(reader, symbol - 256)
      const distancePrefix = readHuffmanSymbol(reader, group.distance)
      const distanceCode = prefixValue(reader, distancePrefix)
      const distance = distanceValue(distanceCode, width)
      if (distance > position || position + length > pixels.length)
        throw invalidInput(
          `WebP backward reference exceeds decoded pixels (${position}, length ${length}, distance prefix ${distancePrefix}, code ${distanceCode}, distance ${distance}, size ${pixels.length})`,
        )
      for (let index = 0; index < length; index += 1) {
        const color = pixels[position - distance] ?? 0
        pixels[position] = color
        insertCache(cache, cacheBits, color)
        position += 1
      }
      continue
    }
    const cacheEntry = symbol - 280
    if (!cache || cacheEntry >= cache.length) throw invalidInput('WebP color cache code is invalid')
    const color = cache[cacheEntry] ?? 0
    pixels[position] = color
    insertCache(cache, cacheBits, color)
    position += 1
  }
  return pixels
}

const channel = (color: number, shift: number): number => (color >>> shift) & 255
const pack = (alpha: number, red: number, green: number, blue: number): number =>
  (((alpha & 255) << 24) | ((red & 255) << 16) | ((green & 255) << 8) | (blue & 255)) >>> 0
const clamp = (value: number): number => (value < 0 ? 0 : value > 255 ? 255 : value)

const componentTransform = (
  first: number,
  second: number,
  operation: (a: number, b: number) => number,
): number =>
  pack(
    operation(channel(first, 24), channel(second, 24)),
    operation(channel(first, 16), channel(second, 16)),
    operation(channel(first, 8), channel(second, 8)),
    operation(channel(first, 0), channel(second, 0)),
  )

const componentTransform3 = (
  first: number,
  second: number,
  third: number,
  operation: (a: number, b: number, c: number) => number,
): number =>
  pack(
    operation(channel(first, 24), channel(second, 24), channel(third, 24)),
    operation(channel(first, 16), channel(second, 16), channel(third, 16)),
    operation(channel(first, 8), channel(second, 8), channel(third, 8)),
    operation(channel(first, 0), channel(second, 0), channel(third, 0)),
  )

const average = (first: number, second: number): number =>
  componentTransform(first, second, (a, b) => (a + b) >>> 1)

const select = (left: number, top: number, topLeft: number): number => {
  let leftDistance = 0
  let topDistance = 0
  for (const shift of [24, 16, 8, 0]) {
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
  if (mode === 12) return componentTransform3(left, top, topLeft, (a, b, c) => clamp(a + b - c))
  if (mode === 13) {
    const base = average(left, top)
    return componentTransform(base, topLeft, (a, b) => clamp(a + Math.trunc((a - b) / 2)))
  }
  throw invalidInput('WebP predictor mode is invalid')
}

const addPixels = (residual: number, predicted: number): number =>
  componentTransform(residual, predicted, (a, b) => (a + b) & 255)

const inversePredictor = (
  pixels: Uint32Array,
  width: number,
  transform: Extract<Transform, { type: 'predictor' }>,
): void => {
  for (let position = 0; position < pixels.length; position += 1) {
    const x = position % width
    const y = Math.floor(position / width)
    let predicted: number
    if (position === 0) predicted = 0xff000000
    else if (y === 0) predicted = pixels[position - 1] ?? 0
    else if (x === 0) predicted = pixels[position - width] ?? 0
    else {
      const modePosition = (y >>> transform.sizeBits) * transform.width + (x >>> transform.sizeBits)
      const mode = ((transform.data[modePosition] ?? 0) >>> 8) & 255
      predicted = predictor(
        mode,
        pixels[position - 1] ?? 0,
        pixels[position - width] ?? 0,
        pixels[position - width - 1] ?? 0,
        x === width - 1 ? (pixels[y * width] ?? 0) : (pixels[position - width + 1] ?? 0),
      )
    }
    pixels[position] = addPixels(pixels[position] ?? 0, predicted)
  }
}

const signedByte = (value: number): number => (value < 128 ? value : value - 256)
const colorDelta = (transform: number, color: number): number =>
  (signedByte(transform) * signedByte(color)) >> 5

const inverseColor = (
  pixels: Uint32Array,
  width: number,
  transform: Extract<Transform, { type: 'color' }>,
): void => {
  for (let position = 0; position < pixels.length; position += 1) {
    const x = position % width
    const y = Math.floor(position / width)
    const element =
      transform.data[(y >>> transform.sizeBits) * transform.width + (x >>> transform.sizeBits)] ?? 0
    const color = pixels[position] ?? 0
    const green = channel(color, 8)
    const red = (channel(color, 16) + colorDelta(channel(element, 0), green)) & 255
    const blue =
      (channel(color, 0) +
        colorDelta(channel(element, 8), green) +
        colorDelta(channel(element, 16), red)) &
      255
    pixels[position] = pack(channel(color, 24), red, green, blue)
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

const inverseColorIndexing = (
  pixels: Uint32Array,
  height: number,
  transform: Extract<Transform, { type: 'color-indexing' }>,
): Uint32Array => {
  const output = new Uint32Array(transform.width * height)
  const packedWidth = Math.ceil(transform.width / 2 ** transform.widthBits)
  const mask = (1 << (8 >>> transform.widthBits)) - 1
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < transform.width; x += 1) {
      const packed = pixels[y * packedWidth + (x >>> transform.widthBits)] ?? 0
      const index =
        (channel(packed, 8) >>>
          ((x & ((1 << transform.widthBits) - 1)) * (8 >>> transform.widthBits))) &
        mask
      output[y * transform.width + x] = transform.palette[index] ?? 0
    }
  }
  return output
}

export interface LosslessWebpImage {
  readonly width: number
  readonly height: number
  readonly pixels: Uint32Array
}

const decodeLosslessImage = (reader: BitReader, width: number, height: number): Uint32Array => {
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

  let pixels = decodeImageData(reader, encodedWidth, height, true)
  let currentWidth = encodedWidth
  for (let index = transforms.length - 1; index >= 0; index -= 1) {
    const transform = transforms[index]
    if (!transform) continue
    if (transform.type === 'color-indexing') {
      pixels = inverseColorIndexing(pixels, height, transform)
      currentWidth = transform.width
    } else if (transform.type === 'subtract-green') inverseSubtractGreen(pixels)
    else if (transform.type === 'color') inverseColor(pixels, currentWidth, transform)
    else inversePredictor(pixels, currentWidth, transform)
  }
  if (currentWidth !== width || pixels.length !== width * height) {
    throw invalidInput('WebP lossless transforms produced invalid dimensions')
  }
  return pixels
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
  return { width, height, pixels: decodeLosslessImage(reader, width, height) }
}

export const decodeLosslessWebpAlpha = (
  data: Uint8Array,
  offset: number,
  length: number,
  width: number,
  height: number,
): Uint8Array => {
  const pixels = decodeLosslessImage(new BitReader(data, offset, length), width, height)
  return Uint8Array.from(pixels, (pixel) => (pixel >>> 8) & 255)
}
