import type { EncodeRequest, ImageEncoder } from '../codec.ts'
import { invalidInput } from '../errors.ts'
import { iccColorSpace } from '../metadata.ts'
import type { PixelBlock, PixelFormat } from '../pixel.ts'
import type { ImageSink } from '../sink.ts'
import type { WebpKernel } from './webp-acceleration.ts'
import { vp8lDistanceMap } from './webp-lossless.ts'

interface BitOutput {
  writeBits(value: number, length: number): void
}

class BitCounter implements BitOutput {
  #bits = 0

  get bits(): number {
    return this.#bits
  }

  writeBits(_value: number, length: number): void {
    this.#bits += length
  }
}

class BitWriter implements BitOutput {
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

const buildHuffmanLengths = (frequencies: Uint32Array, maximumBits = 15): Uint8Array => {
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
  if (maximumLength <= maximumBits) return lengths

  // Extremely skewed histograms can exceed VP8L's bit limit. The fixed
  // complete tree is a rare, bounded fallback and still enables LZ77.
  return fixedHuffmanLengths(frequencies.length)
}

const buildHuffmanTable = (frequencies: Uint32Array, maximumBits = 15): HuffmanTable => {
  const lengths = buildHuffmanLengths(frequencies, maximumBits)
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

interface CodeLengthToken {
  readonly symbol: number
  readonly extra: number
  readonly extraBits: number
}

const codeLengthTokens = (lengths: Uint8Array): readonly CodeLengthToken[] => {
  const tokens: CodeLengthToken[] = []
  let index = 0
  let previous = 8
  while (index < lengths.length) {
    const length = lengths[index] ?? 0
    let run = 1
    while (index + run < lengths.length && (lengths[index + run] ?? 0) === length) run += 1
    index += run
    if (length === 0) {
      while (run >= 11) {
        const count = Math.min(run, 138)
        tokens.push({ symbol: 18, extra: count - 11, extraBits: 7 })
        run -= count
      }
      if (run >= 3) {
        const count = Math.min(run, 10)
        tokens.push({ symbol: 17, extra: count - 3, extraBits: 3 })
        run -= count
      }
      while (run > 0) {
        tokens.push({ symbol: 0, extra: 0, extraBits: 0 })
        run -= 1
      }
      continue
    }

    tokens.push({ symbol: length, extra: 0, extraBits: 0 })
    previous = length
    run -= 1
    while (run >= 3) {
      const count = Math.min(run, 6)
      tokens.push({ symbol: 16, extra: count - 3, extraBits: 2 })
      run -= count
    }
    while (run > 0) {
      tokens.push({ symbol: previous, extra: 0, extraBits: 0 })
      run -= 1
    }
  }
  return tokens
}

const writeHuffmanTree = (writer: BitOutput, table: HuffmanTable): void => {
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

  const tokens = codeLengthTokens(table.lengths)
  const frequencies = new Uint32Array(19)
  for (const token of tokens) {
    frequencies[token.symbol] = (frequencies[token.symbol] ?? 0) + 1
  }
  const codeLengthTable = buildHuffmanTable(frequencies, 7)
  let codeLengthCount = 4
  for (let index = codeLengthOrder.length - 1; index >= 4; index -= 1) {
    if ((codeLengthTable.lengths[codeLengthOrder[index] ?? 0] ?? 0) !== 0) {
      codeLengthCount = index + 1
      break
    }
  }

  writer.writeBits(0, 1)
  writer.writeBits(codeLengthCount - 4, 4)
  for (let index = 0; index < codeLengthCount; index += 1) {
    writer.writeBits(codeLengthTable.lengths[codeLengthOrder[index] ?? 0] ?? 0, 3)
  }
  writer.writeBits(0, 1)
  for (const token of tokens) {
    writeHuffmanSymbol(writer, codeLengthTable, token.symbol)
    writer.writeBits(token.extra, token.extraBits)
  }
}

const writeHuffmanSymbol = (writer: BitOutput, table: HuffmanTable, symbol: number): void => {
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
  kernel?: WebpKernel,
): void => {
  const height = pixels.length / width
  for (let y = 0; y < height; y += 1) {
    const rowOffset = y * width
    currentRow.set(pixels.subarray(rowOffset, rowOffset + width))
    if (
      kernel?.vp8lForwardPredictor(
        currentRow,
        y === 0 ? undefined : previousRow,
        modes,
        (y >>> predictorSizeBits) * modeWidth,
        modeWidth,
        predictorSizeBits,
        y,
        pixels.subarray(rowOffset, rowOffset + width),
      )
    ) {
      previousRow.set(currentRow)
      continue
    }
    for (let x = 0; x < width; x += 1) {
      const position = y * width + x
      const color = currentRow[x] ?? 0
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
interface EntropyMap {
  readonly bits: number
  readonly groups: Uint8Array
  readonly image: Uint32Array
  readonly count: number
  readonly width: number
}

const createPrefixHistograms = (cacheSize: number): PrefixHistograms => ({
  green: new Uint32Array(280 + cacheSize),
  red: new Uint32Array(256),
  blue: new Uint32Array(256),
  alpha: new Uint32Array(256),
  distance: new Uint32Array(40),
})

const createEntropyMap = (
  pixels: Uint32Array,
  width: number,
  height: number,
  bits: number,
): EntropyMap | undefined => {
  const blockSize = 1 << bits
  const mapWidth = Math.ceil(width / blockSize)
  const mapHeight = Math.ceil(height / blockSize)
  if (mapWidth * mapHeight < 4) return undefined
  const energies = new Float64Array(mapWidth * mapHeight)
  for (let blockY = 0; blockY < mapHeight; blockY += 1) {
    const startY = blockY * blockSize
    const endY = Math.min(height, startY + blockSize)
    for (let blockX = 0; blockX < mapWidth; blockX += 1) {
      const startX = blockX * blockSize
      const endX = Math.min(width, startX + blockSize)
      let energy = 0
      for (let y = startY; y < endY; y += 1) {
        for (let x = startX; x < endX; x += 1) {
          energy += residualCost(pixels[y * width + x] ?? 0)
        }
      }
      energies[blockY * mapWidth + blockX] = energy / ((endY - startY) * (endX - startX))
    }
  }
  const sorted = Array.from(energies).sort((left, right) => left - right)
  const first = sorted[Math.floor(sorted.length / 4)] ?? 0
  const second = sorted[Math.floor(sorted.length / 2)] ?? first
  const third = sorted[Math.floor((sorted.length * 3) / 4)] ?? second
  const labels = new Uint8Array(energies.length)
  const remap = new Int8Array(4)
  remap.fill(-1)
  let count = 0
  for (let index = 0; index < energies.length; index += 1) {
    const energy = energies[index] ?? 0
    const label = energy <= first ? 0 : energy <= second ? 1 : energy <= third ? 2 : 3
    if ((remap[label] ?? -1) < 0) {
      remap[label] = count
      count += 1
    }
    labels[index] = remap[label] ?? 0
  }
  if (count < 2) return undefined
  const image = new Uint32Array(labels.length)
  for (let index = 0; index < labels.length; index += 1) {
    image[index] = pack(255, 0, labels[index] ?? 0, 0)
  }
  return { bits, groups: labels, image, count, width: mapWidth }
}

const entropyGroup = (map: EntropyMap, position: number, imageWidth: number): number => {
  const x = position % imageWidth
  const y = Math.floor(position / imageWidth)
  return map.groups[(y >>> map.bits) * map.width + (x >>> map.bits)] ?? 0
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

interface MatchTable {
  readonly candidateCount: number
  readonly heads: Uint8Array
  readonly slots: Int32Array
}

const createMatchTable = (pixelCount: number, deepSearch: boolean): MatchTable => {
  const candidateCount = deepSearch ? matchCandidateCount(pixelCount) : 1
  return {
    candidateCount,
    heads: new Uint8Array(1 << 16),
    slots: new Int32Array((1 << 16) * candidateCount),
  }
}

const resetMatchTable = (matches: MatchTable): void => {
  matches.slots.fill(-1)
  matches.heads.fill(0)
}

const bestMatch = (
  pixels: Uint32Array,
  position: number,
  width: number,
  matches: MatchTable,
): { readonly distance: number; readonly length: number } => {
  const candidateCount = matches.candidateCount
  let distance = 1
  let length = matchLength(pixels, position, distance)
  const previousRow = matchLength(pixels, position, width)
  if (previousRow > length) {
    distance = width
    length = previousRow
  }
  const hash = matchHash(pixels, position)
  const bucket = hash * candidateCount
  const head = matches.heads[hash] ?? 0
  let index = head === 0 ? candidateCount - 1 : head - 1
  for (let visited = 0; visited < candidateCount; visited += 1) {
    const candidate = matches.slots[bucket + index] ?? -1
    const candidateDistance = position - candidate
    if (candidate >= 0 && candidateDistance <= 1_048_456) {
      const candidateLength = matchLength(pixels, position, candidateDistance)
      if (candidateLength > length) {
        distance = candidateDistance
        length = candidateLength
      }
    }
    index = index === 0 ? candidateCount - 1 : index - 1
  }
  return { length, distance }
}

const createDistanceCodeMap = (width: number): ReadonlyMap<number, number> => {
  const codes = new Map<number, number>()
  for (let code = 1; code <= 120; code += 1) {
    const offset = (code - 1) * 2
    const x = vp8lDistanceMap[offset] ?? 0
    const y = vp8lDistanceMap[offset + 1] ?? 0
    const distance = Math.max(1, x + y * width)
    if (!codes.has(distance)) codes.set(distance, code)
  }
  return codes
}

const distanceCode = (distance: number, codes: ReadonlyMap<number, number>): PrefixCode =>
  prefixCode(codes.get(distance) ?? distance + 120, 39)

const updateMatches = (
  matches: MatchTable,
  pixels: Uint32Array,
  position: number,
  length: number,
): void => {
  const candidateCount = matches.candidateCount
  const end = position + length
  for (let current = position; current < end; current += 1) {
    const hash = matchHash(pixels, current)
    const head = matches.heads[hash] ?? 0
    matches.slots[hash * candidateCount + head] = current
    matches.heads[hash] = head + 1 === candidateCount ? 0 : head + 1
  }
}

const TOKEN_LITERAL = 0
const TOKEN_CACHE = 1
const TOKEN_MATCH = 2

interface Lz77Stream {
  readonly count: number
  readonly distances: Int32Array
  readonly kinds: Uint8Array
  readonly lengths: Uint16Array
  readonly positions: Int32Array
  readonly values: Uint32Array
}

const recordToken = (
  stream: {
    count: number
    readonly distances: Int32Array
    readonly kinds: Uint8Array
    readonly lengths: Uint16Array
    readonly positions: Int32Array
    readonly values: Uint32Array
  },
  kind: number,
  value: number,
  length: number,
  distance: number,
  position: number,
): void => {
  const index = stream.count
  stream.kinds[index] = kind
  stream.values[index] = value
  stream.lengths[index] = length
  stream.distances[index] = distance
  stream.positions[index] = position
  stream.count += 1
}

const addHistogramToken = (
  histograms: PrefixHistograms,
  kind: number,
  value: number,
  length: number,
  distance: number,
  distanceCodes: ReadonlyMap<number, number>,
): void => {
  if (kind === TOKEN_MATCH) {
    const lengthCode = prefixCode(length, 23)
    histograms.green[256 + lengthCode.prefix] = (histograms.green[256 + lengthCode.prefix] ?? 0) + 1
    const coded = distanceCode(distance, distanceCodes)
    histograms.distance[coded.prefix] = (histograms.distance[coded.prefix] ?? 0) + 1
    return
  }
  if (kind === TOKEN_CACHE) {
    histograms.green[280 + value] = (histograms.green[280 + value] ?? 0) + 1
    return
  }
  histograms.green[channel(value, 8)] = (histograms.green[channel(value, 8)] ?? 0) + 1
  histograms.red[channel(value, 16)] = (histograms.red[channel(value, 16)] ?? 0) + 1
  histograms.blue[channel(value, 0)] = (histograms.blue[channel(value, 0)] ?? 0) + 1
  histograms.alpha[channel(value, 24)] = (histograms.alpha[channel(value, 24)] ?? 0) + 1
}

const collectLz77 = (
  pixels: Uint32Array,
  width: number,
  cacheBits: number,
  matches: MatchTable,
): { readonly histograms: PrefixHistograms; readonly stream: Lz77Stream } => {
  const cacheSize = cacheBits === 0 ? 0 : 1 << cacheBits
  const histograms = createPrefixHistograms(cacheSize)
  const stream = {
    count: 0,
    distances: new Int32Array(pixels.length),
    kinds: new Uint8Array(pixels.length),
    lengths: new Uint16Array(pixels.length),
    positions: new Int32Array(pixels.length),
    values: new Uint32Array(pixels.length),
  }
  resetMatchTable(matches)
  const cache = cacheBits === 0 ? undefined : new Uint32Array(cacheSize)
  const distanceCodes = createDistanceCodeMap(width)
  let position = 0
  while (position < pixels.length) {
    const match = bestMatch(pixels, position, width, matches)
    if (match.length >= 2) {
      recordToken(stream, TOKEN_MATCH, 0, match.length, match.distance, position)
      addHistogramToken(histograms, TOKEN_MATCH, 0, match.length, match.distance, distanceCodes)
      updateMatches(matches, pixels, position, match.length)
      updateColorCache(cache, cacheBits, pixels, position, match.length)
      position += match.length
      continue
    }
    const color = pixels[position] ?? 0
    const cacheEntry = cache ? colorCacheIndex(color, cacheBits) : -1
    if (cache && (cache[cacheEntry] ?? 0) === color) {
      recordToken(stream, TOKEN_CACHE, cacheEntry, 1, 0, position)
      addHistogramToken(histograms, TOKEN_CACHE, cacheEntry, 1, 0, distanceCodes)
      updateMatches(matches, pixels, position, 1)
      updateColorCache(cache, cacheBits, pixels, position, 1)
      position += 1
      continue
    }
    recordToken(stream, TOKEN_LITERAL, color, 1, 0, position)
    addHistogramToken(histograms, TOKEN_LITERAL, color, 1, 0, distanceCodes)
    updateMatches(matches, pixels, position, 1)
    updateColorCache(cache, cacheBits, pixels, position, 1)
    position += 1
  }
  return { histograms, stream }
}
const collectSpatialHistograms = (
  stream: Lz77Stream,
  width: number,
  cacheSize: number,
  map: EntropyMap,
): readonly PrefixHistograms[] => {
  const groups = Array.from({ length: map.count }, () => createPrefixHistograms(cacheSize))
  const distanceCodes = createDistanceCodeMap(width)
  for (let index = 0; index < stream.count; index += 1) {
    const histograms = groups[entropyGroup(map, stream.positions[index] ?? 0, width)]
    if (!histograms) throw invalidInput('WebP entropy group is missing')
    addHistogramToken(
      histograms,
      stream.kinds[index] ?? 0,
      stream.values[index] ?? 0,
      stream.lengths[index] ?? 0,
      stream.distances[index] ?? 0,
      distanceCodes,
    )
  }
  return groups
}

const buildPrefixTables = (histograms: PrefixHistograms): PrefixTables => ({
  green: buildHuffmanTable(histograms.green),
  red: buildHuffmanTable(histograms.red),
  blue: buildHuffmanTable(histograms.blue),
  alpha: buildHuffmanTable(histograms.alpha),
  distance: buildHuffmanTable(histograms.distance),
})

const huffmanDataBits = (frequencies: Uint32Array, table: HuffmanTable): number => {
  if (table.singleSymbol !== undefined) return 0
  let bits = 0
  for (let symbol = 0; symbol < frequencies.length; symbol += 1) {
    bits += (frequencies[symbol] ?? 0) * (table.lengths[symbol] ?? 0)
  }
  return bits
}

const prefixGroupBits = (histograms: PrefixHistograms, tables: PrefixTables): number => {
  const counter = new BitCounter()
  writeHuffmanTree(counter, tables.green)
  writeHuffmanTree(counter, tables.red)
  writeHuffmanTree(counter, tables.blue)
  writeHuffmanTree(counter, tables.alpha)
  writeHuffmanTree(counter, tables.distance)
  return (
    counter.bits +
    huffmanDataBits(histograms.green, tables.green) +
    huffmanDataBits(histograms.red, tables.red) +
    huffmanDataBits(histograms.blue, tables.blue) +
    huffmanDataBits(histograms.alpha, tables.alpha) +
    huffmanDataBits(histograms.distance, tables.distance)
  )
}
const writeStreamTokens = (
  writer: BitOutput,
  stream: Lz77Stream,
  width: number,
  tablesFor: (index: number) => PrefixTables,
): void => {
  const distanceCodes = createDistanceCodeMap(width)
  for (let index = 0; index < stream.count; index += 1) {
    const tables = tablesFor(index)
    const kind = stream.kinds[index] ?? 0
    if (kind === TOKEN_MATCH) {
      const lengthCode = prefixCode(stream.lengths[index] ?? 0, 23)
      writeHuffmanSymbol(writer, tables.green, 256 + lengthCode.prefix)
      writer.writeBits(lengthCode.extra, lengthCode.extraBits)
      const distance = distanceCode(stream.distances[index] ?? 0, distanceCodes)
      writeHuffmanSymbol(writer, tables.distance, distance.prefix)
      writer.writeBits(distance.extra, distance.extraBits)
      continue
    }
    if (kind === TOKEN_CACHE) {
      writeHuffmanSymbol(writer, tables.green, 280 + (stream.values[index] ?? 0))
      continue
    }
    const color = stream.values[index] ?? 0
    writeHuffmanSymbol(writer, tables.green, channel(color, 8))
    writeHuffmanSymbol(writer, tables.red, channel(color, 16))
    writeHuffmanSymbol(writer, tables.blue, channel(color, 0))
    writeHuffmanSymbol(writer, tables.alpha, channel(color, 24))
  }
}

const singleSymbolTable = (alphabetSize: number, symbol: number): HuffmanTable => {
  const frequencies = new Uint32Array(alphabetSize)
  frequencies[symbol] = 1
  return buildHuffmanTable(frequencies)
}

const writePredictorImage = (writer: BitOutput, modes: Uint32Array, modeWidth: number): void => {
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
  const collected = collectLz77(modes, modeWidth, 0, matches)
  const tables = buildPrefixTables(collected.histograms)
  writeHuffmanTree(writer, tables.green)
  writeHuffmanTree(writer, tables.red)
  writeHuffmanTree(writer, tables.blue)
  writeHuffmanTree(writer, tables.alpha)
  writeHuffmanTree(writer, tables.distance)
  writeStreamTokens(writer, collected.stream, modeWidth, () => tables)
}
const writeAuxiliaryImage = (writer: BitOutput, pixels: Uint32Array, width: number): void => {
  writer.writeBits(0, 1)
  const matches = createMatchTable(pixels.length, false)
  const collected = collectLz77(pixels, width, 0, matches)
  const tables = buildPrefixTables(collected.histograms)
  writeHuffmanTree(writer, tables.green)
  writeHuffmanTree(writer, tables.red)
  writeHuffmanTree(writer, tables.blue)
  writeHuffmanTree(writer, tables.alpha)
  writeHuffmanTree(writer, tables.distance)
  writeStreamTokens(writer, collected.stream, width, () => tables)
}

interface PaletteEncoding {
  readonly deltas: Uint32Array
  readonly height: number
  readonly palette: Uint32Array
  readonly pixels: Uint32Array
  readonly size: number
  readonly sourceWidth: number
  readonly width: number
  readonly widthBits: number
}

const createPaletteEncoding = (
  pixels: Uint32Array,
  width: number,
  height: number,
): PaletteEncoding | undefined => {
  const indices = new Map<number, number>()
  const palette: number[] = []
  for (const color of pixels) {
    if (indices.has(color)) continue
    if (palette.length === 256) return undefined
    indices.set(color, palette.length)
    palette.push(color)
  }
  if (palette.length < 2) return undefined

  const widthBits = palette.length <= 2 ? 3 : palette.length <= 4 ? 2 : palette.length <= 16 ? 1 : 0
  const packedWidth = Math.ceil(width / 2 ** widthBits)
  for (let y = 0; y < height; y += 1) {
    const inputStart = y * width
    const outputStart = y * packedWidth
    for (let packedX = 0; packedX < packedWidth; packedX += 1) {
      let packedIndex = 0
      const count = 1 << widthBits
      const indexBits = 8 >> widthBits
      for (let index = 0; index < count; index += 1) {
        const x = packedX * count + index
        if (x >= width) break
        const color = pixels[inputStart + x] ?? 0
        packedIndex |= (indices.get(color) ?? 0) << (index * indexBits)
      }
      pixels[outputStart + packedX] = pack(255, 0, packedIndex, 0)
    }
  }

  const deltas = new Uint32Array(palette.length)
  let previous = 0
  for (let index = 0; index < palette.length; index += 1) {
    const color = palette[index] ?? 0
    deltas[index] = pixelResidual(color, previous)
    previous = color
  }
  return {
    deltas,
    height,
    palette: Uint32Array.from(palette),
    pixels: pixels.subarray(0, packedWidth * height),
    size: palette.length,
    sourceWidth: width,
    width: packedWidth,
    widthBits,
  }
}

const restorePaletteEncoding = (pixels: Uint32Array, encoding: PaletteEncoding): void => {
  const indexBits = 8 >>> encoding.widthBits
  const mask = (1 << indexBits) - 1
  for (let y = encoding.height - 1; y >= 0; y -= 1) {
    for (let x = encoding.sourceWidth - 1; x >= 0; x -= 1) {
      const packed = encoding.pixels[y * encoding.width + (x >>> encoding.widthBits)] ?? 0
      const index =
        (channel(packed, 8) >>> ((x & ((1 << encoding.widthBits) - 1)) * indexBits)) & mask
      pixels[y * encoding.sourceWidth + x] = encoding.palette[index] ?? 0
    }
  }
}

const applySubtractGreen = (pixels: Uint32Array, kernel?: WebpKernel): void => {
  const batchPixels = 16_384
  for (let offset = 0; offset < pixels.length; offset += batchPixels) {
    const batch = pixels.subarray(offset, Math.min(pixels.length, offset + batchPixels))
    if (kernel?.vp8lForwardSubtractGreen(batch)) continue
    for (let index = 0; index < batch.length; index += 1) {
      batch[index] = subtractGreen(batch[index] ?? 0)
    }
  }
}

const signedByte = (value: number): number => (value < 128 ? value : value - 256)
const colorDelta = (transform: number, color: number): number =>
  (signedByte(transform) * signedByte(color)) >> 5

interface ColorTransformPlan {
  readonly elements: Uint32Array
  readonly width: number
}

const colorTransformSizeBits = 4
const colorTransformBlockSize = 1 << colorTransformSizeBits

const transformedColor = (color: number, element: number): number => {
  const green = channel(color, 8)
  const red = channel(color, 16)
  return pack(
    channel(color, 24),
    red - colorDelta(channel(element, 0), green),
    green,
    channel(color, 0) -
      colorDelta(channel(element, 8), green) -
      colorDelta(channel(element, 16), red),
  )
}

const selectColorTransform = (
  pixels: Uint32Array,
  width: number,
  height: number,
): ColorTransformPlan | undefined => {
  const transformWidth = Math.ceil(width / colorTransformBlockSize)
  const transformHeight = Math.ceil(height / colorTransformBlockSize)
  const elements = new Uint32Array(transformWidth * transformHeight)
  let transformedCost = 0
  let subtractGreenCost = 0
  for (let blockY = 0; blockY < transformHeight; blockY += 1) {
    const startY = blockY * colorTransformBlockSize
    const endY = Math.min(height, startY + colorTransformBlockSize)
    for (let blockX = 0; blockX < transformWidth; blockX += 1) {
      const startX = blockX * colorTransformBlockSize
      const endX = Math.min(width, startX + colorTransformBlockSize)
      let greenGreen = 0
      let redRed = 0
      let greenRed = 0
      let greenBlue = 0
      let redBlue = 0
      for (let y = startY; y < endY; y += 1) {
        for (let x = startX; x < endX; x += 1) {
          const color = pixels[y * width + x] ?? 0
          const green = signedByte(channel(color, 8))
          const red = signedByte(channel(color, 16))
          const blue = signedByte(channel(color, 0))
          greenGreen += green * green
          redRed += red * red
          greenRed += green * red
          greenBlue += green * blue
          redBlue += red * blue
          subtractGreenCost += residualCost(subtractGreen(color))
        }
      }
      const greenToRed =
        greenGreen === 0
          ? 0
          : Math.max(-128, Math.min(127, Math.round((32 * greenRed) / greenGreen)))
      const determinant = greenGreen * redRed - greenRed * greenRed
      const greenToBlue =
        determinant === 0
          ? greenGreen === 0
            ? 0
            : Math.max(-128, Math.min(127, Math.round((32 * greenBlue) / greenGreen)))
          : Math.max(
              -128,
              Math.min(
                127,
                Math.round((32 * (greenBlue * redRed - redBlue * greenRed)) / determinant),
              ),
            )
      const redToBlue =
        determinant === 0
          ? 0
          : Math.max(
              -128,
              Math.min(
                127,
                Math.round((32 * (redBlue * greenGreen - greenBlue * greenRed)) / determinant),
              ),
            )
      const element = pack(255, redToBlue, greenToBlue, greenToRed)
      elements[blockY * transformWidth + blockX] = element
      for (let y = startY; y < endY; y += 1) {
        for (let x = startX; x < endX; x += 1) {
          transformedCost += residualCost(transformedColor(pixels[y * width + x] ?? 0, element))
        }
      }
    }
  }
  return transformedCost * 5 + elements.length * 60 < subtractGreenCost * 4
    ? { elements, width: transformWidth }
    : undefined
}

const applyColorTransform = (
  pixels: Uint32Array,
  width: number,
  plan: ColorTransformPlan,
  kernel?: WebpKernel,
): void => {
  const height = pixels.length / width
  for (let y = 0; y < height; y += 1) {
    const row = pixels.subarray(y * width, (y + 1) * width)
    if (
      kernel?.vp8lForwardColor(
        row,
        plan.elements,
        (y >>> colorTransformSizeBits) * plan.width,
        plan.width,
        colorTransformSizeBits,
      )
    ) {
      continue
    }
    for (let x = 0; x < width; x += 1) {
      const element =
        plan.elements[
          (y >>> colorTransformSizeBits) * plan.width + (x >>> colorTransformSizeBits)
        ] ?? 0
      row[x] = transformedColor(row[x] ?? 0, element)
    }
  }
}
const applyNearLossless = (pixels: Uint32Array, quality: number): void => {
  if (quality >= 100) return
  const shift = Math.min(5, Math.max(1, Math.ceil((100 - quality) / 20)))
  const step = 1 << shift
  const half = step >> 1
  const quantize = (value: number): number => Math.min(255, ((value + half) >>> shift) << shift)
  for (let index = 0; index < pixels.length; index += 1) {
    const color = pixels[index] ?? 0
    pixels[index] = pack(
      channel(color, 24),
      quantize(channel(color, 16)),
      quantize(channel(color, 8)),
      quantize(channel(color, 0)),
    )
  }
}

const chooseColorCacheBits = (pixels: Uint32Array): number => {
  if (pixels.length < 4096) return 0
  const cache8 = new Uint32Array(256)
  const cache9 = new Uint32Array(512)
  const cache10 = new Uint32Array(1024)
  let hits8 = 0
  let hits9 = 0
  let hits10 = 0
  for (let position = 0; position < pixels.length; position += 1) {
    const color = pixels[position] ?? 0
    const index8 = colorCacheIndex(color, 8)
    const index9 = colorCacheIndex(color, 9)
    const index10 = colorCacheIndex(color, 10)
    if ((cache8[index8] ?? 0) === color) hits8 += 1
    if ((cache9[index9] ?? 0) === color) hits9 += 1
    if ((cache10[index10] ?? 0) === color) hits10 += 1
    cache8[index8] = color
    cache9[index9] = color
    cache10[index10] = color
  }
  let bestBits = 0
  let bestScore = 0
  const scores = [hits8 * 16 - 1024, hits9 * 15 - 2048, hits10 * 14 - 4096]
  const bits = [8, 9, 10]
  for (let index = 0; index < 3; index += 1) {
    const score = scores[index] ?? 0
    if (score > bestScore) {
      bestScore = score
      bestBits = bits[index] ?? 0
    }
  }
  return bestBits
}

const writePrefixTrees = (writer: BitOutput, tables: PrefixTables): void => {
  writeHuffmanTree(writer, tables.green)
  writeHuffmanTree(writer, tables.red)
  writeHuffmanTree(writer, tables.blue)
  writeHuffmanTree(writer, tables.alpha)
  writeHuffmanTree(writer, tables.distance)
}

const writeMainImage = (
  writer: BitOutput,
  pixels: Uint32Array,
  width: number,
  deepSearch: boolean,
  spatialBits: number | undefined,
): void => {
  const cacheBits = deepSearch ? chooseColorCacheBits(pixels) : 0
  writer.writeBits(cacheBits === 0 ? 0 : 1, 1)
  if (cacheBits !== 0) writer.writeBits(cacheBits, 4)
  const matches = createMatchTable(pixels.length, deepSearch)
  const collected = collectLz77(pixels, width, cacheBits, matches)
  const histograms = collected.histograms
  const tables = buildPrefixTables(histograms)
  const map =
    spatialBits === undefined
      ? undefined
      : createEntropyMap(pixels, width, pixels.length / width, spatialBits)
  const cacheSize = cacheBits === 0 ? 0 : 1 << cacheBits
  const spatialHistograms = map
    ? collectSpatialHistograms(collected.stream, width, cacheSize, map)
    : undefined
  const spatialTables = spatialHistograms?.map(buildPrefixTables)
  let useSpatial = false
  if (map && spatialHistograms && spatialTables) {
    const metadataBits = new BitCounter()
    metadataBits.writeBits(map.bits - 2, 3)
    writeAuxiliaryImage(metadataBits, map.image, map.width)
    let groupedBits = metadataBits.bits
    for (let index = 0; index < spatialTables.length; index += 1) {
      const groupHistograms = spatialHistograms[index]
      const groupTables = spatialTables[index]
      if (groupHistograms && groupTables) {
        groupedBits += prefixGroupBits(groupHistograms, groupTables)
      }
    }
    useSpatial = groupedBits < prefixGroupBits(histograms, tables)
  }

  writer.writeBits(useSpatial ? 1 : 0, 1)
  if (useSpatial && map && spatialTables) {
    writer.writeBits(map.bits - 2, 3)
    writeAuxiliaryImage(writer, map.image, map.width)
    for (const groupTables of spatialTables) writePrefixTrees(writer, groupTables)
    writeStreamTokens(writer, collected.stream, width, (index) => {
      const group = spatialTables[entropyGroup(map, collected.stream.positions[index] ?? 0, width)]
      if (!group) throw invalidInput('WebP entropy group is missing')
      return group
    })
  } else {
    writePrefixTrees(writer, tables)
    writeStreamTokens(writer, collected.stream, width, () => tables)
  }
}

const writeImageBits = (
  writer: BitOutput,
  pixels: Uint32Array,
  width: number,
  modes: Uint32Array,
  modeWidth: number,
  colorTransform: ColorTransformPlan | undefined,
  deepSearch: boolean,
  spatialBits: number | undefined,
): void => {
  writer.writeBits(1, 1)
  writer.writeBits(0, 2)
  writer.writeBits(predictorSizeBits - 2, 3)
  writePredictorImage(writer, modes, modeWidth)
  if (colorTransform) {
    writer.writeBits(1, 1)
    writer.writeBits(1, 2)
    writer.writeBits(colorTransformSizeBits - 2, 3)
    writeAuxiliaryImage(writer, colorTransform.elements, colorTransform.width)
  } else {
    writer.writeBits(1, 1)
    writer.writeBits(2, 2)
  }
  writer.writeBits(0, 1)
  writeMainImage(writer, pixels, width, deepSearch, spatialBits)
}

const encodeImageBits = (
  pixels: Uint32Array,
  width: number,
  modes: Uint32Array,
  modeWidth: number,
  colorTransform: ColorTransformPlan | undefined,
  deepSearch: boolean,
  spatialBits: number | undefined,
): Uint8Array => {
  const writer = new BitWriter()
  writeImageBits(writer, pixels, width, modes, modeWidth, colorTransform, deepSearch, spatialBits)
  return writer.finish()
}

const encodePaletteImageBits = (
  encoding: PaletteEncoding,
  deepSearch: boolean,
  spatialBits: number | undefined,
): Uint8Array => {
  const writer = new BitWriter()
  writer.writeBits(1, 1)
  writer.writeBits(3, 2)
  writer.writeBits(encoding.size - 1, 8)
  writeAuxiliaryImage(writer, encoding.deltas, encoding.size)
  writer.writeBits(0, 1)
  writeMainImage(writer, encoding.pixels, encoding.width, deepSearch, spatialBits)
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
  readonly #effort: number
  readonly #nearLossless: number
  readonly #kernel: WebpKernel | undefined
  #pixels: Uint32Array | undefined
  #previousRow: Uint32Array
  #currentRow: Uint32Array
  #expectedY = 0
  #finished = false

  constructor(
    sink: ImageSink,
    request: EncodeRequest,
    effort: number,
    nearLossless: number,
    kernel?: WebpKernel,
  ) {
    this.#sink = sink
    this.#width = request.width
    this.#height = request.height
    this.#format = request.pixelFormat
    this.#channels = channels(request.pixelFormat)
    this.#icc = request.metadata?.icc
    this.#exif = request.metadata?.exif
    this.#effort = effort
    this.#nearLossless = nearLossless
    this.#kernel = kernel
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
    applyNearLossless(pixels, this.#nearLossless)
    const spatialBits = this.#effort >= 4 ? (this.#effort === 6 ? 4 : 5) : undefined
    const palette =
      this.#effort >= 1 ? createPaletteEncoding(pixels, this.#width, this.#height) : undefined
    const paletteBits = palette
      ? encodePaletteImageBits(palette, this.#effort >= 3, spatialBits)
      : undefined
    if (palette) restorePaletteEncoding(pixels, palette)

    const simpleEncoding =
      this.#effort < 2 || (this.#nearLossless === 100 && prefersSimpleEncoding(pixels, this.#width))
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
      this.#kernel,
    )
    const colorTransform =
      this.#effort >= 3 ? selectColorTransform(pixels, this.#width, this.#height) : undefined
    const deepSearch = this.#effort >= 2 && !simpleEncoding
    if (colorTransform) applyColorTransform(pixels, this.#width, colorTransform, this.#kernel)
    else applySubtractGreen(pixels, this.#kernel)
    const predictiveBits = encodeImageBits(
      pixels,
      this.#width,
      predictor.modes,
      predictor.width,
      colorTransform,
      deepSearch,
      spatialBits,
    )
    const bits =
      paletteBits && paletteBits.byteLength < predictiveBits.byteLength
        ? paletteBits
        : predictiveBits
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
  kernel?: WebpKernel,
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
  const effort = request.options.effort ?? 4
  if (typeof effort !== 'number' || !Number.isInteger(effort) || effort < 0 || effort > 6) {
    throw invalidInput('WebP effort must be an integer from 0 to 6')
  }
  const nearLossless = request.options.nearLossless ?? 100
  if (
    typeof nearLossless !== 'number' ||
    !Number.isInteger(nearLossless) ||
    nearLossless < 0 ||
    nearLossless > 100
  ) {
    throw invalidInput('WebP nearLossless must be an integer from 0 to 100')
  }
  channels(request.pixelFormat)
  const icc = request.metadata?.icc
  if (icc && iccColorSpace(icc) !== 'rgb') {
    throw invalidInput('Preserved ICC profile does not match WebP RGB output pixels')
  }
  return new LosslessWebpEncoder(sink, request, effort, nearLossless, kernel)
}
