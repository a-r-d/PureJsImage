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

const pixelResidual = (color: number, predicted: number): number => {
  const alpha = (channel(color, 24) - channel(predicted, 24)) & 255
  const green = (channel(color, 8) - channel(predicted, 8)) & 255
  const red = (channel(color, 16) - channel(predicted, 16)) & 255
  const blue = (channel(color, 0) - channel(predicted, 0)) & 255
  return pack(alpha, red, green, blue)
}

const subtractGreen = (color: number): number => {
  const green = channel(color, 8)
  return pack(channel(color, 24), channel(color, 16) - green, green, channel(color, 0) - green)
}

const clampByte = (value: number): number => (value < 0 ? 0 : value > 255 ? 255 : value)

const averageColors = (first: number, second: number): number =>
  pack(
    (channel(first, 24) + channel(second, 24)) >>> 1,
    (channel(first, 16) + channel(second, 16)) >>> 1,
    (channel(first, 8) + channel(second, 8)) >>> 1,
    (channel(first, 0) + channel(second, 0)) >>> 1,
  )

const selectColor = (left: number, top: number, topLeft: number): number => {
  const blueEstimate = channel(left, 0) + channel(top, 0) - channel(topLeft, 0)
  const greenEstimate = channel(left, 8) + channel(top, 8) - channel(topLeft, 8)
  const redEstimate = channel(left, 16) + channel(top, 16) - channel(topLeft, 16)
  const alphaEstimate = channel(left, 24) + channel(top, 24) - channel(topLeft, 24)
  const leftDistance =
    Math.abs(blueEstimate - channel(left, 0)) +
    Math.abs(greenEstimate - channel(left, 8)) +
    Math.abs(redEstimate - channel(left, 16)) +
    Math.abs(alphaEstimate - channel(left, 24))
  const topDistance =
    Math.abs(blueEstimate - channel(top, 0)) +
    Math.abs(greenEstimate - channel(top, 8)) +
    Math.abs(redEstimate - channel(top, 16)) +
    Math.abs(alphaEstimate - channel(top, 24))
  return leftDistance < topDistance ? left : top
}

const predictedColor = (
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
  if (mode === 5) return averageColors(averageColors(left, topRight), top)
  if (mode === 6) return averageColors(left, topLeft)
  if (mode === 7) return averageColors(left, top)
  if (mode === 8) return averageColors(topLeft, top)
  if (mode === 9) return averageColors(top, topRight)
  if (mode === 10) return averageColors(averageColors(left, topLeft), averageColors(top, topRight))
  if (mode === 11) return selectColor(left, top, topLeft)
  if (mode === 12) {
    return pack(
      clampByte(channel(left, 24) + channel(top, 24) - channel(topLeft, 24)),
      clampByte(channel(left, 16) + channel(top, 16) - channel(topLeft, 16)),
      clampByte(channel(left, 8) + channel(top, 8) - channel(topLeft, 8)),
      clampByte(channel(left, 0) + channel(top, 0) - channel(topLeft, 0)),
    )
  }
  if (mode === 13) {
    const base = averageColors(left, top)
    return pack(
      clampByte(channel(base, 24) + Math.trunc((channel(base, 24) - channel(topLeft, 24)) / 2)),
      clampByte(channel(base, 16) + Math.trunc((channel(base, 16) - channel(topLeft, 16)) / 2)),
      clampByte(channel(base, 8) + Math.trunc((channel(base, 8) - channel(topLeft, 8)) / 2)),
      clampByte(channel(base, 0) + Math.trunc((channel(base, 0) - channel(topLeft, 0)) / 2)),
    )
  }
  throw invalidInput('WebP predictor mode is invalid')
}

const residualCost = (residual: number): number => {
  const blue = channel(residual, 0)
  const green = channel(residual, 8)
  const red = channel(residual, 16)
  const alpha = channel(residual, 24)
  return (
    Math.min(blue, 256 - blue) +
    Math.min(green, 256 - green) +
    Math.min(red, 256 - red) +
    Math.min(alpha, 256 - alpha)
  )
}

const predictorSizeBits = 4
const predictorBlockSize = 1 << predictorSizeBits

const selectPredictorModes = (
  pixels: Uint32Array,
  width: number,
  height: number,
): { readonly modes: Uint32Array; readonly width: number } => {
  const modeWidth = Math.ceil(width / predictorBlockSize)
  const modeHeight = Math.ceil(height / predictorBlockSize)
  const modes = new Uint32Array(modeWidth * modeHeight)
  for (let blockY = 0; blockY < modeHeight; blockY += 1) {
    const startY = blockY * predictorBlockSize
    const endY = Math.min(height, startY + predictorBlockSize)
    for (let blockX = 0; blockX < modeWidth; blockX += 1) {
      const startX = blockX * predictorBlockSize
      const endX = Math.min(width, startX + predictorBlockSize)
      let bestMode = 0
      let bestCost = Number.POSITIVE_INFINITY
      for (let mode = 0; mode <= 13; mode += 1) {
        let cost = 0
        for (let y = Math.max(1, startY); y < endY; y += 1) {
          for (let x = Math.max(1, startX); x < endX; x += 1) {
            const position = y * width + x
            const predicted = predictedColor(
              mode,
              pixels[position - 1] ?? 0,
              pixels[position - width] ?? 0,
              pixels[position - width - 1] ?? 0,
              x === width - 1 ? (pixels[y * width] ?? 0) : (pixels[position - width + 1] ?? 0),
            )
            cost += residualCost(subtractGreen(pixelResidual(pixels[position] ?? 0, predicted)))
          }
        }
        if (cost < bestCost) {
          bestCost = cost
          bestMode = mode
        }
      }
      modes[blockY * modeWidth + blockX] = pack(0, 0, bestMode, 0)
    }
  }
  return { modes, width: modeWidth }
}

const leftPredictorModes = (
  width: number,
  height: number,
): { readonly modes: Uint32Array; readonly width: number } => {
  const modeWidth = Math.ceil(width / predictorBlockSize)
  const modes = new Uint32Array(modeWidth * Math.ceil(height / predictorBlockSize))
  modes.fill(pack(0, 0, 1, 0))
  return { modes, width: modeWidth }
}

const prefersSimpleEncoding = (pixels: Uint32Array, width: number): boolean => {
  let equalNeighbors = 0
  let comparisons = 0
  for (let position = 0; position < pixels.length; position += 1) {
    const color = pixels[position] ?? 0
    if (position % width !== 0) {
      if ((pixels[position - 1] ?? 1) === color) equalNeighbors += 1
      comparisons += 1
    }
    if (position >= width) {
      if ((pixels[position - width] ?? 1) === color) equalNeighbors += 1
      comparisons += 1
    }
  }
  // Flat graphics already compress well with the previous single-left path.
  // Keep that smaller working set when at least three quarters of neighbors match.
  return equalNeighbors * 4 >= comparisons * 3
}

const applyPredictorTransform = (
  pixels: Uint32Array,
  width: number,
  modes: Uint32Array,
  modeWidth: number,
  previousRow: Uint32Array,
  currentRow: Uint32Array,
): void => {
  const height = pixels.length / width
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const position = y * width + x
      const color = pixels[position] ?? 0
      currentRow[x] = color
      let predicted: number
      if (position === 0) predicted = 0xff000000
      else if (y === 0) predicted = currentRow[x - 1] ?? 0
      else if (x === 0) predicted = previousRow[x] ?? 0
      else {
        const modePosition = (y >>> predictorSizeBits) * modeWidth + (x >>> predictorSizeBits)
        const mode = channel(modes[modePosition] ?? 0, 8)
        predicted = predictedColor(
          mode,
          currentRow[x - 1] ?? 0,
          previousRow[x] ?? 0,
          previousRow[x - 1] ?? 0,
          x === width - 1 ? (currentRow[0] ?? 0) : (previousRow[x + 1] ?? 0),
        )
      }
      pixels[position] = pixelResidual(color, predicted)
    }
    previousRow.set(currentRow)
  }
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

const colorCacheIndex = (color: number, bits: number): number =>
  Math.imul(0x1e35a7bd, color) >>> (32 - bits)

const updateColorCache = (
  cache: Uint32Array | undefined,
  bits: number,
  pixels: Uint32Array,
  position: number,
  length: number,
): void => {
  if (!cache) return
  const end = position + length
  for (let current = position; current < end; current += 1) {
    const color = pixels[current] ?? 0
    cache[colorCacheIndex(color, bits)] = color
  }
}

// Sixteen recent entries materially improve screenshot-sized output while keeping
// the table fixed at 4 MiB instead of scaling with the source pixel count.
const matchCandidateCount = (pixelCount: number): number => (pixelCount < 16_384 ? 1 : 16)

const createMatchTable = (pixelCount: number, deepSearch: boolean): Int32Array =>
  new Int32Array((1 << 16) * (deepSearch ? matchCandidateCount(pixelCount) : 1))

const bestMatch = (
  pixels: Uint32Array,
  position: number,
  width: number,
  matches: Int32Array,
): { readonly distance: number; readonly length: number } => {
  const candidateCount = matches.length >>> 16
  let distance = 1
  let length = matchLength(pixels, position, distance)
  const previousRow = matchLength(pixels, position, width)
  if (previousRow > length) {
    distance = width
    length = previousRow
  }
  const bucket = matchHash(pixels, position) * candidateCount
  for (let index = 0; index < candidateCount; index += 1) {
    const candidate = matches[bucket + index] ?? -1
    const candidateDistance = position - candidate
    if (candidate >= 0 && candidateDistance <= 1_048_456) {
      const candidateLength = matchLength(pixels, position, candidateDistance)
      if (candidateLength > length) {
        distance = candidateDistance
        length = candidateLength
      }
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
  const candidateCount = matches.length >>> 16
  const end = position + length
  for (let current = position; current < end; current += 1) {
    const bucket = matchHash(pixels, current) * candidateCount
    for (let index = candidateCount - 1; index > 0; index -= 1) {
      matches[bucket + index] = matches[bucket + index - 1] ?? -1
    }
    matches[bucket] = current
  }
}

const collectHistograms = (
  pixels: Uint32Array,
  width: number,
  cacheBits: number,
  matches: Int32Array,
): PrefixHistograms => {
  const cacheSize = cacheBits === 0 ? 0 : 1 << cacheBits
  const histograms: PrefixHistograms = {
    green: new Uint32Array(280 + cacheSize),
    red: new Uint32Array(256),
    blue: new Uint32Array(256),
    alpha: new Uint32Array(256),
    distance: new Uint32Array(40),
  }
  matches.fill(-1)
  const cache = cacheBits === 0 ? undefined : new Uint32Array(cacheSize)
  let position = 0
  while (position < pixels.length) {
    const match = bestMatch(pixels, position, width, matches)
    if (match.length >= 2) {
      const lengthCode = prefixCode(match.length, 23)
      histograms.green[256 + lengthCode.prefix] =
        (histograms.green[256 + lengthCode.prefix] ?? 0) + 1
      const distance = distanceCode(match.distance, width)
      histograms.distance[distance.prefix] = (histograms.distance[distance.prefix] ?? 0) + 1
      updateMatches(matches, pixels, position, match.length)
      updateColorCache(cache, cacheBits, pixels, position, match.length)
      position += match.length
      continue
    }
    const color = pixels[position] ?? 0
    const cacheEntry = cache ? colorCacheIndex(color, cacheBits) : -1
    if (cache && (cache[cacheEntry] ?? 0) === color) {
      histograms.green[280 + cacheEntry] = (histograms.green[280 + cacheEntry] ?? 0) + 1
      updateMatches(matches, pixels, position, 1)
      updateColorCache(cache, cacheBits, pixels, position, 1)
      position += 1
      continue
    }
    const green = channel(color, 8)
    const red = channel(color, 16)
    const blue = channel(color, 0)
    const alpha = channel(color, 24)
    histograms.green[green] = (histograms.green[green] ?? 0) + 1
    histograms.red[red] = (histograms.red[red] ?? 0) + 1
    histograms.blue[blue] = (histograms.blue[blue] ?? 0) + 1
    histograms.alpha[alpha] = (histograms.alpha[alpha] ?? 0) + 1
    updateMatches(matches, pixels, position, 1)
    updateColorCache(cache, cacheBits, pixels, position, 1)
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
  cacheBits: number,
  tables: PrefixTables,
  matches: Int32Array,
): void => {
  matches.fill(-1)
  const cache = cacheBits === 0 ? undefined : new Uint32Array(1 << cacheBits)
  let position = 0
  while (position < pixels.length) {
    const match = bestMatch(pixels, position, width, matches)
    if (match.length >= 2) {
      const lengthCode = prefixCode(match.length, 23)
      writeHuffmanSymbol(writer, tables.green, 256 + lengthCode.prefix)
      writer.writeBits(lengthCode.extra, lengthCode.extraBits)
      const distance = distanceCode(match.distance, width)
      writeHuffmanSymbol(writer, tables.distance, distance.prefix)
      writer.writeBits(distance.extra, distance.extraBits)
      updateMatches(matches, pixels, position, match.length)
      updateColorCache(cache, cacheBits, pixels, position, match.length)
      position += match.length
      continue
    }
    const color = pixels[position] ?? 0
    const cacheEntry = cache ? colorCacheIndex(color, cacheBits) : -1
    if (cache && (cache[cacheEntry] ?? 0) === color) {
      writeHuffmanSymbol(writer, tables.green, 280 + cacheEntry)
      updateMatches(matches, pixels, position, 1)
      updateColorCache(cache, cacheBits, pixels, position, 1)
      position += 1
      continue
    }
    writeHuffmanSymbol(writer, tables.green, channel(color, 8))
    writeHuffmanSymbol(writer, tables.red, channel(color, 16))
    writeHuffmanSymbol(writer, tables.blue, channel(color, 0))
    writeHuffmanSymbol(writer, tables.alpha, channel(color, 24))
    updateMatches(matches, pixels, position, 1)
    updateColorCache(cache, cacheBits, pixels, position, 1)
    position += 1
  }
}

const singleSymbolTable = (alphabetSize: number, symbol: number): HuffmanTable => {
  const frequencies = new Uint32Array(alphabetSize)
  frequencies[symbol] = 1
  return buildHuffmanTable(frequencies)
}

const writePredictorImage = (writer: BitWriter, modes: Uint32Array, modeWidth: number): void => {
  writer.writeBits(0, 1)
  let singleMode = channel(modes[0] ?? 0, 8)
  for (let index = 1; index < modes.length; index += 1) {
    if (channel(modes[index] ?? 0, 8) !== singleMode) {
      singleMode = -1
      break
    }
  }
  if (singleMode >= 0) {
    writeHuffmanTree(writer, singleSymbolTable(280, singleMode))
    writeHuffmanTree(writer, singleSymbolTable(256, 0))
    writeHuffmanTree(writer, singleSymbolTable(256, 0))
    writeHuffmanTree(writer, singleSymbolTable(256, 0))
    writeHuffmanTree(writer, singleSymbolTable(40, 0))
    return
  }
  const matches = createMatchTable(modes.length, false)
  const tables = buildPrefixTables(collectHistograms(modes, modeWidth, 0, matches))
  writeHuffmanTree(writer, tables.green)
  writeHuffmanTree(writer, tables.red)
  writeHuffmanTree(writer, tables.blue)
  writeHuffmanTree(writer, tables.alpha)
  writeHuffmanTree(writer, tables.distance)
  writeImageTokens(writer, modes, modeWidth, 0, tables, matches)
}

const applySubtractGreen = (pixels: Uint32Array): void => {
  for (let index = 0; index < pixels.length; index += 1) {
    pixels[index] = subtractGreen(pixels[index] ?? 0)
  }
}

const chooseColorCacheBits = (pixels: Uint32Array): number => {
  if (pixels.length < 4096) return 0
  let bestBits = 0
  let bestScore = 0
  for (let bits = 8; bits <= 10; bits += 1) {
    const cache = new Uint32Array(1 << bits)
    let hits = 0
    for (let position = 0; position < pixels.length; position += 1) {
      const color = pixels[position] ?? 0
      const index = colorCacheIndex(color, bits)
      if ((cache[index] ?? 0) === color) hits += 1
      cache[index] = color
    }
    // Approximate the three omitted channel symbols minus the larger green tree.
    const score = hits * (24 - bits) - (1 << bits) * 4
    if (score > bestScore) {
      bestScore = score
      bestBits = bits
    }
  }
  return bestBits
}

const encodeImageBits = (
  pixels: Uint32Array,
  width: number,
  modes: Uint32Array,
  modeWidth: number,
  deepSearch: boolean,
): Uint8Array => {
  const writer = new BitWriter()
  writer.writeBits(1, 1)
  writer.writeBits(0, 2)
  writer.writeBits(predictorSizeBits - 2, 3)
  writePredictorImage(writer, modes, modeWidth)
  writer.writeBits(1, 1)
  writer.writeBits(2, 2)
  writer.writeBits(0, 1)
  const cacheBits = deepSearch ? chooseColorCacheBits(pixels) : 0
  writer.writeBits(cacheBits === 0 ? 0 : 1, 1)
  if (cacheBits !== 0) writer.writeBits(cacheBits, 4)
  writer.writeBits(0, 1)

  const matches = createMatchTable(pixels.length, deepSearch)
  const tables = buildPrefixTables(collectHistograms(pixels, width, cacheBits, matches))
  writeHuffmanTree(writer, tables.green)
  writeHuffmanTree(writer, tables.red)
  writeHuffmanTree(writer, tables.blue)
  writeHuffmanTree(writer, tables.alpha)
  writeHuffmanTree(writer, tables.distance)
  writeImageTokens(writer, pixels, width, cacheBits, tables, matches)
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
        pixels[y * this.#width + x] = color
      }
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
    const simpleEncoding = prefersSimpleEncoding(pixels, this.#width)
    const predictor = simpleEncoding
      ? leftPredictorModes(this.#width, this.#height)
      : selectPredictorModes(pixels, this.#width, this.#height)
    applyPredictorTransform(
      pixels,
      this.#width,
      predictor.modes,
      predictor.width,
      this.#previousRow,
      this.#currentRow,
    )
    applySubtractGreen(pixels)
    const bits = encodeImageBits(
      pixels,
      this.#width,
      predictor.modes,
      predictor.width,
      !simpleEncoding,
    )
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
