import type { EncodeRequest, ImageEncoder } from '../codec.ts'
import { invalidInput, limitExceeded } from '../errors.ts'
import { defaultImageLimits } from '../limits.ts'
import { iccColorSpace } from '../metadata.ts'
import type { PixelBlock, PixelFormat } from '../pixel.ts'
import type { ImageSink } from '../sink.ts'
import {
  chrominanceAcCounts,
  chrominanceAcValues,
  chrominanceDcCounts,
  chrominanceDcValues,
  luminanceAcCounts,
  luminanceAcValues,
  luminanceDcCounts,
  luminanceDcValues,
} from './jpeg-huffman-tables.ts'

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

const luminanceQuantization = Uint8Array.of(
  16,
  11,
  10,
  16,
  24,
  40,
  51,
  61,
  12,
  12,
  14,
  19,
  26,
  58,
  60,
  55,
  14,
  13,
  16,
  24,
  40,
  57,
  69,
  56,
  14,
  17,
  22,
  29,
  51,
  87,
  80,
  62,
  18,
  22,
  37,
  56,
  68,
  109,
  103,
  77,
  24,
  35,
  55,
  64,
  81,
  104,
  113,
  92,
  49,
  64,
  78,
  87,
  103,
  121,
  120,
  101,
  72,
  92,
  95,
  98,
  112,
  100,
  103,
  99,
)
const chrominanceQuantization = Uint8Array.of(
  17,
  18,
  24,
  47,
  99,
  99,
  99,
  99,
  18,
  21,
  26,
  66,
  99,
  99,
  99,
  99,
  24,
  26,
  56,
  99,
  99,
  99,
  99,
  99,
  47,
  66,
  99,
  99,
  99,
  99,
  99,
  99,
  99,
  99,
  99,
  99,
  99,
  99,
  99,
  99,
  99,
  99,
  99,
  99,
  99,
  99,
  99,
  99,
  99,
  99,
  99,
  99,
  99,
  99,
  99,
  99,
  99,
  99,
  99,
  99,
  99,
  99,
  99,
  99,
)

interface HuffmanCodes {
  readonly values: Uint16Array
  readonly lengths: Uint8Array
}

interface OptimizedHuffmanTable extends HuffmanCodes {
  readonly counts: Uint8Array
  readonly symbols: Uint8Array
}

interface EncoderOptions {
  readonly quality: number
  readonly progressive: boolean
  readonly background: readonly [number, number, number]
  readonly chromaSubsampling: '420' | '422' | '444'
  readonly restartInterval: number
}

const channels = (format: PixelFormat): number => {
  if (format === 'gray8') return 1
  if (format === 'rgb8') return 3
  if (format === 'rgba8') return 4
  throw invalidInput(`JPEG encoding does not support ${format} pixels`)
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const options = (value: unknown): EncoderOptions => {
  if (!isRecord(value)) throw invalidInput('JPEG encoder options must be an object')
  const quality = value.quality ?? 80
  if (typeof quality !== 'number' || !Number.isInteger(quality) || quality < 1 || quality > 100) {
    throw invalidInput('JPEG quality must be an integer from 1 to 100')
  }
  const progressive = value.progressive ?? false
  if (typeof progressive !== 'boolean') throw invalidInput('JPEG progressive must be a boolean')
  const chromaSubsampling = value.chromaSubsampling ?? '420'
  if (chromaSubsampling !== '420' && chromaSubsampling !== '422' && chromaSubsampling !== '444') {
    throw invalidInput('JPEG chromaSubsampling must be 420, 422, or 444')
  }
  const restartInterval = value.restartInterval ?? 0
  if (
    typeof restartInterval !== 'number' ||
    !Number.isInteger(restartInterval) ||
    restartInterval < 0 ||
    restartInterval > 65_535
  ) {
    throw invalidInput('JPEG restartInterval must be an integer from 0 to 65535')
  }
  const background = value.background
  if (background === undefined || background === 'transparent') {
    return {
      quality,
      progressive,
      background: [255, 255, 255],
      chromaSubsampling,
      restartInterval,
    }
  }
  if (typeof background !== 'string' || !/^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(background)) {
    throw invalidInput('JPEG background must be transparent, #RRGGBB, or #RRGGBBAA')
  }
  return {
    quality,
    progressive,
    chromaSubsampling,
    restartInterval,
    background: [
      Number.parseInt(background.slice(1, 3), 16),
      Number.parseInt(background.slice(3, 5), 16),
      Number.parseInt(background.slice(5, 7), 16),
    ],
  }
}

const quantizationTable = (base: Uint8Array, quality: number): Uint8Array => {
  const scale = quality < 50 ? Math.floor(5000 / quality) : 200 - quality * 2
  return Uint8Array.from(base, (value) =>
    Math.max(1, Math.min(255, Math.floor((value * scale + 50) / 100))),
  )
}

const huffmanCodes = (counts: Uint8Array, symbols: Uint8Array): HuffmanCodes => {
  const values = new Uint16Array(256)
  const lengths = new Uint8Array(256)
  let code = 0
  let valueIndex = 0
  for (let length = 1; length <= 16; length += 1) {
    const count = counts[length - 1] ?? 0
    for (let index = 0; index < count; index += 1) {
      const symbol = symbols[valueIndex]
      if (symbol === undefined) throw new Error('Standard JPEG Huffman table is invalid')
      values[symbol] = code
      lengths[symbol] = length
      code += 1
      valueIndex += 1
    }
    code <<= 1
  }
  return { values, lengths }
}

const optimizedHuffmanTable = (sourceFrequencies: Uint32Array): OptimizedHuffmanTable => {
  const frequencies = new Float64Array(257)
  let usedSymbols = 0
  for (let symbol = 0; symbol < 256; symbol += 1) {
    const frequency = sourceFrequencies[symbol] ?? 0
    frequencies[symbol] = frequency
    if (frequency > 0) usedSymbols += 1
  }
  if (usedSymbols === 0) {
    frequencies[0] = 1
    usedSymbols = 1
  }

  // The dummy symbol prevents the all-ones code that JPEG reserves for marker padding.
  frequencies[256] = 1
  const codeSizes = new Uint16Array(257)
  const others = new Int16Array(257)
  others.fill(-1)

  while (true) {
    let first = -1
    let firstFrequency = Number.POSITIVE_INFINITY
    for (let symbol = 0; symbol <= 256; symbol += 1) {
      const frequency = frequencies[symbol] ?? 0
      if (frequency > 0 && frequency <= firstFrequency) {
        first = symbol
        firstFrequency = frequency
      }
    }
    let second = -1
    let secondFrequency = Number.POSITIVE_INFINITY
    for (let symbol = 0; symbol <= 256; symbol += 1) {
      const frequency = frequencies[symbol] ?? 0
      if (symbol !== first && frequency > 0 && frequency <= secondFrequency) {
        second = symbol
        secondFrequency = frequency
      }
    }
    if (second < 0) break
    if (first < 0) throw new Error('JPEG Huffman frequency tree is empty')

    frequencies[first] = firstFrequency + secondFrequency
    frequencies[second] = 0
    codeSizes[first] = (codeSizes[first] ?? 0) + 1
    let branch = first
    while ((others[branch] ?? -1) >= 0) {
      branch = others[branch] ?? -1
      codeSizes[branch] = (codeSizes[branch] ?? 0) + 1
    }
    others[branch] = second
    codeSizes[second] = (codeSizes[second] ?? 0) + 1
    branch = second
    while ((others[branch] ?? -1) >= 0) {
      branch = others[branch] ?? -1
      codeSizes[branch] = (codeSizes[branch] ?? 0) + 1
    }
  }

  const lengthCounts = new Uint16Array(257)
  for (const size of codeSizes) {
    if (size > 0) lengthCounts[size] = (lengthCounts[size] ?? 0) + 1
  }
  for (let length = 256; length > 16; length -= 1) {
    while ((lengthCounts[length] ?? 0) > 0) {
      let shorter = length - 2
      while (shorter > 0 && (lengthCounts[shorter] ?? 0) === 0) shorter -= 1
      if (shorter === 0 || (lengthCounts[length] ?? 0) < 2) {
        throw new Error('JPEG Huffman code lengths cannot be limited to 16 bits')
      }
      lengthCounts[length] = (lengthCounts[length] ?? 0) - 2
      lengthCounts[length - 1] = (lengthCounts[length - 1] ?? 0) + 1
      lengthCounts[shorter + 1] = (lengthCounts[shorter + 1] ?? 0) + 2
      lengthCounts[shorter] = (lengthCounts[shorter] ?? 0) - 1
    }
  }

  let longest = 16
  while (longest > 0 && (lengthCounts[longest] ?? 0) === 0) longest -= 1
  if (longest === 0) throw new Error('JPEG Huffman table has no real symbols')
  lengthCounts[longest] = (lengthCounts[longest] ?? 0) - 1

  const counts = new Uint8Array(16)
  let encodedSymbols = 0
  for (let length = 1; length <= 16; length += 1) {
    const count = lengthCounts[length] ?? 0
    if (count > 255) throw new Error('JPEG Huffman code-length count exceeds one byte')
    counts[length - 1] = count
    encodedSymbols += count
  }
  if (encodedSymbols !== usedSymbols) throw new Error('JPEG Huffman symbol count is inconsistent')

  const symbols = new Uint8Array(usedSymbols)
  let output = 0
  for (let length = 1; length <= 256; length += 1) {
    for (let symbol = 0; symbol < 256; symbol += 1) {
      if ((codeSizes[symbol] ?? 0) !== length) continue
      symbols[output] = symbol
      output += 1
    }
  }
  if (output !== usedSymbols) throw new Error('JPEG Huffman symbol ordering is inconsistent')
  return { counts, symbols, ...huffmanCodes(counts, symbols) }
}

interface BaselineAcCodes extends HuffmanCodes {
  readonly shortCoefficients: Uint32Array
}

const baselineAcCodes = (counts: Uint8Array, symbols: Uint8Array): BaselineAcCodes => {
  const codes = huffmanCodes(counts, symbols)
  const shortCoefficients = new Uint32Array(16 * 64)
  for (let run = 0; run < 16; run += 1) {
    for (let value = -31; value <= 31; value += 1) {
      if (value === 0) continue
      const category = 32 - Math.clz32(Math.abs(value))
      const symbol = (run << 4) | category
      const length = codes.lengths[symbol] ?? 0
      if (length === 0) throw invalidInput('Incomplete baseline JPEG AC table')
      const magnitude = value < 0 ? value + (1 << category) - 1 : value
      const bits = ((codes.values[symbol] ?? 0) << category) | magnitude
      shortCoefficients[(run << 6) + value + 31] = (bits << 5) | (length + category)
    }
  }
  return { ...codes, shortCoefficients }
}

const luminanceDcCodes = huffmanCodes(luminanceDcCounts, luminanceDcValues)
const luminanceAcCodes = baselineAcCodes(luminanceAcCounts, luminanceAcValues)
const chrominanceDcCodes = huffmanCodes(chrominanceDcCounts, chrominanceDcValues)
const chrominanceAcCodes = baselineAcCodes(chrominanceAcCounts, chrominanceAcValues)

class ByteWriter {
  #bytes = new Uint8Array(8_192)
  #length = 0
  #pending = 0
  #pendingBits = 0

  get length(): number {
    return this.#length
  }

  byte(value: number): void {
    if (this.#length === this.#bytes.byteLength) {
      const expanded = new Uint8Array(this.#bytes.byteLength * 2)
      expanded.set(this.#bytes)
      this.#bytes = expanded
    }
    this.#bytes[this.#length] = value
    this.#length += 1
  }

  word(value: number): void {
    this.byte(value >>> 8)
    this.byte(value)
  }

  bytes(values: Uint8Array): void {
    for (const value of values) this.byte(value)
  }

  bits(value: number, length: number): void {
    this.#pending = (this.#pending << length) | (value & ((1 << length) - 1))
    this.#pendingBits += length
    while (this.#pendingBits >= 8) {
      const remaining = this.#pendingBits - 8
      const output = (this.#pending >>> remaining) & 0xff
      this.byte(output)
      if (output === 0xff) this.byte(0)
      this.#pendingBits = remaining
      this.#pending &= remaining === 0 ? 0 : (1 << remaining) - 1
    }
  }

  code(table: HuffmanCodes, symbol: number): void {
    const length = table.lengths[symbol] ?? 0
    if (length === 0) throw invalidInput(`JPEG coefficient has no Huffman code: ${symbol}`)
    this.bits(table.values[symbol] ?? 0, length)
  }

  flushBits(): void {
    if (this.#pendingBits === 0) return
    this.bits((1 << (8 - this.#pendingBits)) - 1, 8 - this.#pendingBits)
  }

  take(): Uint8Array {
    const output = this.#bytes.slice(0, this.#length)
    this.#length = 0
    return output
  }
}

const writeTable = (
  writer: ByteWriter,
  tableClass: number,
  tableId: number,
  counts: Uint8Array,
  values: Uint8Array,
): void => {
  writer.byte((tableClass << 4) | tableId)
  for (const count of counts) writer.byte(count)
  for (const value of values) writer.byte(value)
}

interface HuffmanTableDefinition {
  readonly tableClass: 0 | 1
  readonly tableId: 0 | 1
  readonly table: OptimizedHuffmanTable
}

const writeHuffmanTables = (
  writer: ByteWriter,
  definitions: readonly HuffmanTableDefinition[],
): void => {
  let length = 2
  for (const definition of definitions) length += 17 + definition.table.symbols.byteLength
  writer.word(0xffc4)
  writer.word(length)
  for (const definition of definitions) {
    writeTable(
      writer,
      definition.tableClass,
      definition.tableId,
      definition.table.counts,
      definition.table.symbols,
    )
  }
}

const jpegHeader = (
  width: number,
  height: number,
  luminance: Uint8Array,
  chrominance: Uint8Array,
  luminanceSampling: number,
  metadata: EncodeRequest['metadata'],
  grayscale: boolean,
  restartInterval: number,
  progressive: boolean,
): Uint8Array => {
  const writer = new ByteWriter()
  writer.word(0xffd8)
  writer.word(0xffe0)
  writer.word(16)
  for (const value of [0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]) writer.byte(value)

  if (metadata?.exif) {
    if (metadata.exif.byteLength > 65_527)
      throw invalidInput('Preserved EXIF data exceeds one JPEG APP1 segment')
    writer.word(0xffe1)
    writer.word(metadata.exif.byteLength + 8)
    writer.bytes(Uint8Array.of(0x45, 0x78, 0x69, 0x66, 0, 0))
    writer.bytes(metadata.exif)
  }
  if (metadata?.icc) {
    if (grayscale) throw invalidInput('Preserved ICC profile does not match JPEG grayscale output')
    if (iccColorSpace(metadata.icc) !== 'rgb')
      throw invalidInput('Preserved ICC profile does not match JPEG RGB output pixels')
    const chunkBytes = 65_519
    const count = Math.ceil(metadata.icc.byteLength / chunkBytes)
    if (count > 255) throw invalidInput('Preserved ICC profile needs too many JPEG APP2 segments')
    const signature = Uint8Array.of(
      0x49,
      0x43,
      0x43,
      0x5f,
      0x50,
      0x52,
      0x4f,
      0x46,
      0x49,
      0x4c,
      0x45,
      0,
    )
    for (let index = 0; index < count; index += 1) {
      const chunk = metadata.icc.subarray(
        index * chunkBytes,
        Math.min(metadata.icc.byteLength, (index + 1) * chunkBytes),
      )
      writer.word(0xffe2)
      writer.word(chunk.byteLength + 16)
      writer.bytes(signature)
      writer.byte(index + 1)
      writer.byte(count)
      writer.bytes(chunk)
    }
  }

  writer.word(0xffdb)
  writer.word(grayscale ? 67 : 132)
  writer.byte(0)
  for (let index = 0; index < 64; index += 1) writer.byte(luminance[zigZag[index] ?? 0] ?? 0)
  if (!grayscale) {
    writer.byte(1)
    for (let index = 0; index < 64; index += 1) {
      writer.byte(chrominance[zigZag[index] ?? 0] ?? 0)
    }
  }

  writer.word(progressive ? 0xffc2 : 0xffc0)
  writer.word(grayscale ? 11 : 17)
  writer.byte(8)
  writer.word(height)
  writer.word(width)
  writer.byte(grayscale ? 1 : 3)
  const components = grayscale ? grayscaleScanComponents : colorScanComponents
  for (const { id, table } of components) {
    writer.byte(id)
    writer.byte(id === 1 ? luminanceSampling : 0x11)
    writer.byte(table)
  }

  if (!progressive) {
    writer.word(0xffc4)
    writer.word(grayscale ? 210 : 418)
    writeTable(writer, 0, 0, luminanceDcCounts, luminanceDcValues)
    writeTable(writer, 1, 0, luminanceAcCounts, luminanceAcValues)
    if (!grayscale) {
      writeTable(writer, 0, 1, chrominanceDcCounts, chrominanceDcValues)
      writeTable(writer, 1, 1, chrominanceAcCounts, chrominanceAcValues)
    }
  }

  if (restartInterval > 0) {
    writer.word(0xffdd)
    writer.word(4)
    writer.word(restartInterval)
  }

  if (!progressive) writeScanHeader(writer, components, 0, 63, 0, 0)
  return writer.take()
}

const dctBasis = Float64Array.from({ length: 64 }, (_, index) => {
  const frequency = Math.floor(index / 8)
  const position = index % 8
  const normalization = frequency === 0 ? Math.SQRT1_2 : 1
  return 0.5 * normalization * Math.cos(((2 * position + 1) * frequency * Math.PI) / 16)
})

// The orthonormal eight-point DCT uses cos(k*pi/16)/2 for the AC frequencies.
const dcScale = dctBasis[0] ?? 0
const cos1 = dctBasis[8] ?? 0
const cos2 = dctBasis[16] ?? 0
const cos3 = dctBasis[9] ?? 0
const cos5 = dctBasis[10] ?? 0
const cos6 = dctBasis[17] ?? 0
const cos7 = dctBasis[11] ?? 0

const forwardDctPass = (input: Float64Array, output: Float64Array, offset: number): void => {
  for (let row = 0; row < 8; row += 1) {
    const start = row * 8
    const s0 = input[start] ?? 0
    const s1 = input[start + 1] ?? 0
    const s2 = input[start + 2] ?? 0
    const s3 = input[start + 3] ?? 0
    const s4 = input[start + 4] ?? 0
    const s5 = input[start + 5] ?? 0
    const s6 = input[start + 6] ?? 0
    const s7 = input[start + 7] ?? 0
    const outer = s0 + s7
    const inner = s3 + s4
    const middle1 = s1 + s6
    const middle2 = s2 + s5
    const even0 = outer + inner
    const even1 = middle1 + middle2
    const even2 = outer - inner
    const even3 = middle1 - middle2
    const d0 = s0 - s7
    const d1 = s1 - s6
    const d2 = s2 - s5
    const d3 = s3 - s4

    // Transposed output makes the second pass another set of contiguous rows.
    const index = offset + row
    output[index] = dcScale * (even0 + even1)
    output[index + 8] = cos1 * d0 + cos3 * d1 + cos5 * d2 + cos7 * d3
    output[index + 16] = cos2 * even2 + cos6 * even3
    output[index + 24] = cos3 * d0 - cos7 * d1 - cos1 * d2 - cos5 * d3
    output[index + 32] = dcScale * (even0 - even1)
    output[index + 40] = cos5 * d0 - cos1 * d1 + cos7 * d2 + cos3 * d3
    output[index + 48] = cos6 * even2 - cos2 * even3
    output[index + 56] = cos7 * d0 - cos5 * d1 + cos3 * d2 - cos1 * d3
  }
}

// Each DCT sums eight terms on each axis. With 8-bit samples and basis weights
// at most 0.5, a 1e-15 difference in a symmetric weight contributes less than
// 1e-11 to a coefficient. Allow 1e-8 for both passes and their rounding.
const safeRoundingDistance = 0.5 - 1e-8

const directDctCoefficient = (samples: Float64Array, index: number): number => {
  const horizontal = (index % 8) * 8
  const vertical = index - (index % 8)
  let result = 0
  for (let row = 0; row < 8; row += 1) {
    let horizontalSum = 0
    for (let x = 0; x < 8; x += 1) {
      horizontalSum += (samples[row * 8 + x] ?? 0) * (dctBasis[horizontal + x] ?? 0)
    }
    result += horizontalSum * (dctBasis[vertical + row] ?? 0)
  }
  return result
}

const quantizedCoefficient = (
  samples: Float64Array,
  table: Uint8Array,
  intermediate: Float64Array,
  i: number,
): number => {
  const divisor = table[i] ?? 1
  const coefficient = intermediate[64 + i] ?? 0
  if (Math.abs(coefficient) < divisor * safeRoundingDistance) return 0
  const value = coefficient / divisor
  // An orthonormal 8x8 DCT on centered 8-bit samples has magnitude <= 1024.
  // After this positive offset, truncation rounds to nearest. The direct
  // calculation below handles every near-half tie, including negative ties.
  const rounded = ((value + 2048.5) | 0) - 2048
  // Preserve the direct evaluation order near a rounding boundary.
  return Math.abs(value - rounded) > safeRoundingDistance
    ? Math.round(directDctCoefficient(samples, i) / divisor)
    : rounded
}

const quantize = (
  samples: Float64Array,
  table: Uint8Array,
  intermediate: Float64Array,
  output: Int32Array,
): void => {
  forwardDctPass(samples, intermediate, 0)
  forwardDctPass(intermediate, intermediate, 64)
  for (let i = 0; i < 64; i += 1) {
    output[i] = quantizedCoefficient(samples, table, intermediate, i)
  }
}

const encodeBlock = (
  writer: ByteWriter,
  samples: Float64Array,
  table: Uint8Array,
  intermediate: Float64Array,
  previousDc: number,
  dcCodes: HuffmanCodes,
  acCodes: BaselineAcCodes,
): number => {
  forwardDctPass(samples, intermediate, 0)
  forwardDctPass(intermediate, intermediate, 64)
  const dc = quantizedCoefficient(samples, table, intermediate, 0)
  const difference = dc - previousDc
  const dcCategory = difference === 0 ? 0 : 32 - Math.clz32(Math.abs(difference))
  writer.code(dcCodes, dcCategory)
  if (dcCategory > 0) {
    writer.bits(difference < 0 ? difference + (1 << dcCategory) - 1 : difference, dcCategory)
  }

  let zeroes = 0
  for (let index = 1; index < 64; index += 1) {
    const coefficient = quantizedCoefficient(samples, table, intermediate, zigZag[index] ?? 0)
    if (coefficient === 0) {
      zeroes += 1
      continue
    }
    while (zeroes >= 16) {
      writer.code(acCodes, 0xf0)
      zeroes -= 16
    }
    if (coefficient >= -31 && coefficient <= 31) {
      // Up to five magnitude bits and a 16-bit prefix fit in one writer call.
      const packed = acCodes.shortCoefficients[(zeroes << 6) + coefficient + 31] ?? 0
      writer.bits(packed >>> 5, packed & 31)
      zeroes = 0
      continue
    }
    const category = 32 - Math.clz32(Math.abs(coefficient))
    writer.code(acCodes, (zeroes << 4) | category)
    writer.bits(coefficient < 0 ? coefficient + (1 << category) - 1 : coefficient, category)
    zeroes = 0
  }
  if (zeroes > 0) writer.code(acCodes, 0)
  return dc
}

interface ProgressivePlane {
  readonly coefficients: Int16Array
  readonly blocksPerLine: number
  readonly blocksPerColumn: number
  readonly storageBlocksPerLine: number
}

interface ProgressiveDcTables {
  readonly luminance: OptimizedHuffmanTable
  readonly chrominance?: OptimizedHuffmanTable
}

interface ScanComponent {
  readonly id: 1 | 2 | 3
  readonly table: 0 | 1
}

const luminanceScanComponent = Object.freeze({ id: 1, table: 0 } as const)
const blueDifferenceScanComponent = Object.freeze({ id: 2, table: 1 } as const)
const redDifferenceScanComponent = Object.freeze({ id: 3, table: 1 } as const)
const grayscaleScanComponents = Object.freeze([luminanceScanComponent])
const colorScanComponents = Object.freeze([
  luminanceScanComponent,
  blueDifferenceScanComponent,
  redDifferenceScanComponent,
])

const writeScanHeader = (
  writer: ByteWriter,
  components: readonly ScanComponent[],
  spectralStart: number,
  spectralEnd: number,
  successiveHigh: number,
  successiveLow: number,
): void => {
  writer.word(0xffda)
  writer.word(6 + components.length * 2)
  writer.byte(components.length)
  for (const component of components) {
    writer.byte(component.id)
    writer.byte((component.table << 4) | component.table)
  }
  writer.byte(spectralStart)
  writer.byte(spectralEnd)
  writer.byte((successiveHigh << 4) | successiveLow)
}

const coefficientMagnitude = (value: number): number =>
  value === 0 ? 0 : 32 - Math.clz32(Math.abs(value))

const writeSignedBits = (writer: ByteWriter, value: number, length: number): void => {
  writer.bits(value < 0 ? value + (1 << length) - 1 : value, length)
}

const encodeProgressiveDcFirst = (
  writer: ByteWriter,
  coefficient: number,
  previousDc: number,
  codes: HuffmanCodes,
  successiveLow: number,
): number => {
  const dc = coefficient >> successiveLow
  const difference = dc - previousDc
  const category = coefficientMagnitude(difference)
  writer.code(codes, category)
  if (category > 0) writeSignedBits(writer, difference, category)
  return dc
}

const encodeProgressiveAcFirst = (
  writer: ByteWriter,
  coefficients: Int16Array,
  offset: number,
  codes: HuffmanCodes,
  spectralStart: number,
  spectralEnd: number,
  successiveLow: number,
): void => {
  const divisor = 2 ** successiveLow
  let zeroes = 0
  for (let spectral = spectralStart; spectral <= spectralEnd; spectral += 1) {
    const coefficient = Math.trunc((coefficients[offset + (zigZag[spectral] ?? 0)] ?? 0) / divisor)
    if (coefficient === 0) {
      zeroes += 1
      continue
    }
    while (zeroes >= 16) {
      writer.code(codes, 0xf0)
      zeroes -= 16
    }
    const category = coefficientMagnitude(coefficient)
    writer.code(codes, (zeroes << 4) | category)
    writeSignedBits(writer, coefficient, category)
    zeroes = 0
  }
  if (zeroes > 0) writer.code(codes, 0)
}

const countProgressiveAcFirst = (
  frequencies: Uint32Array,
  coefficients: Int16Array,
  offset: number,
  spectralStart: number,
  spectralEnd: number,
  successiveLow: number,
): void => {
  const divisor = 2 ** successiveLow
  let zeroes = 0
  for (let spectral = spectralStart; spectral <= spectralEnd; spectral += 1) {
    const coefficient = Math.trunc((coefficients[offset + (zigZag[spectral] ?? 0)] ?? 0) / divisor)
    if (coefficient === 0) {
      zeroes += 1
      continue
    }
    while (zeroes >= 16) {
      frequencies[0xf0] = (frequencies[0xf0] ?? 0) + 1
      zeroes -= 16
    }
    const symbol = (zeroes << 4) | coefficientMagnitude(coefficient)
    frequencies[symbol] = (frequencies[symbol] ?? 0) + 1
    zeroes = 0
  }
  if (zeroes > 0) frequencies[0] = (frequencies[0] ?? 0) + 1
}

const isExistingRefinementCoefficient = (coefficient: number, bit: number): boolean =>
  Math.abs(coefficient) >= bit * 2

const refinementBit = (coefficient: number, bit: number): number =>
  (Math.abs(coefficient) & bit) === 0 ? 0 : 1

const encodeProgressiveAcRefinement = (
  writer: ByteWriter,
  coefficients: Int16Array,
  offset: number,
  codes: HuffmanCodes,
  spectralStart: number,
  spectralEnd: number,
  successiveLow: number,
): void => {
  const bit = 1 << successiveLow
  let spectral = spectralStart
  while (spectral <= spectralEnd) {
    let zeroes = 0
    let newCoefficient = -1
    for (let candidate = spectral; candidate <= spectralEnd; candidate += 1) {
      const coefficient = coefficients[offset + (zigZag[candidate] ?? 0)] ?? 0
      if (isExistingRefinementCoefficient(coefficient, bit)) continue
      if (Math.abs(coefficient) === bit) {
        newCoefficient = candidate
        break
      }
      zeroes += 1
    }

    if (newCoefficient < 0) {
      writer.code(codes, 0)
      for (; spectral <= spectralEnd; spectral += 1) {
        const coefficient = coefficients[offset + (zigZag[spectral] ?? 0)] ?? 0
        if (isExistingRefinementCoefficient(coefficient, bit)) {
          writer.bits(refinementBit(coefficient, bit), 1)
        }
      }
      return
    }

    if (zeroes >= 16) {
      writer.code(codes, 0xf0)
      let remainingZeroes = 16
      while (spectral <= spectralEnd && remainingZeroes > 0) {
        const coefficient = coefficients[offset + (zigZag[spectral] ?? 0)] ?? 0
        if (isExistingRefinementCoefficient(coefficient, bit)) {
          writer.bits(refinementBit(coefficient, bit), 1)
        } else {
          remainingZeroes -= 1
        }
        spectral += 1
      }
      continue
    }

    const coefficient = coefficients[offset + (zigZag[newCoefficient] ?? 0)] ?? 0
    writer.code(codes, (zeroes << 4) | 1)
    writer.bits(coefficient > 0 ? 1 : 0, 1)
    for (; spectral < newCoefficient; spectral += 1) {
      const preceding = coefficients[offset + (zigZag[spectral] ?? 0)] ?? 0
      if (isExistingRefinementCoefficient(preceding, bit)) {
        writer.bits(refinementBit(preceding, bit), 1)
      }
    }
    spectral += 1
  }
}

const countProgressiveAcRefinement = (
  frequencies: Uint32Array,
  coefficients: Int16Array,
  offset: number,
  spectralStart: number,
  spectralEnd: number,
  successiveLow: number,
): void => {
  const bit = 1 << successiveLow
  let spectral = spectralStart
  while (spectral <= spectralEnd) {
    let zeroes = 0
    let newCoefficient = -1
    for (let candidate = spectral; candidate <= spectralEnd; candidate += 1) {
      const coefficient = coefficients[offset + (zigZag[candidate] ?? 0)] ?? 0
      if (isExistingRefinementCoefficient(coefficient, bit)) continue
      if (Math.abs(coefficient) === bit) {
        newCoefficient = candidate
        break
      }
      zeroes += 1
    }

    if (newCoefficient < 0) {
      frequencies[0] = (frequencies[0] ?? 0) + 1
      return
    }
    if (zeroes >= 16) {
      frequencies[0xf0] = (frequencies[0xf0] ?? 0) + 1
      let remainingZeroes = 16
      while (spectral <= spectralEnd && remainingZeroes > 0) {
        const coefficient = coefficients[offset + (zigZag[spectral] ?? 0)] ?? 0
        if (!isExistingRefinementCoefficient(coefficient, bit)) remainingZeroes -= 1
        spectral += 1
      }
      continue
    }

    const symbol = (zeroes << 4) | 1
    frequencies[symbol] = (frequencies[symbol] ?? 0) + 1
    spectral = newCoefficient + 1
  }
}

const progressiveAcTable = (
  plane: ProgressivePlane,
  refinement: boolean,
  successiveLow: number,
): OptimizedHuffmanTable => {
  const frequencies = new Uint32Array(256)
  for (let blockY = 0; blockY < plane.blocksPerColumn; blockY += 1) {
    for (let blockX = 0; blockX < plane.blocksPerLine; blockX += 1) {
      const offset = (blockY * plane.storageBlocksPerLine + blockX) * 64
      if (refinement) {
        countProgressiveAcRefinement(frequencies, plane.coefficients, offset, 1, 63, successiveLow)
      } else {
        countProgressiveAcFirst(frequencies, plane.coefficients, offset, 1, 63, successiveLow)
      }
    }
  }
  return optimizedHuffmanTable(frequencies)
}

const storeQuantizedBlock = (
  target: Int16Array,
  offset: number,
  coefficients: Int32Array,
): void => {
  for (let index = 0; index < 64; index += 1) {
    const coefficient = coefficients[index] ?? 0
    if (coefficient < -32_768 || coefficient > 32_767) {
      throw invalidInput('JPEG coefficient exceeds progressive 16-bit storage')
    }
    target[offset + index] = coefficient
  }
}

interface SamplingGeometry {
  readonly fillChroma: typeof fillChroma420
  readonly luminanceHorizontal: 1 | 2
  readonly luminanceVertical: 1 | 2
  readonly mcuWidth: 8 | 16
  readonly rowHeight: 8 | 16
}

const samplingGeometry = (chromaSubsampling: '420' | '422' | '444'): SamplingGeometry => {
  const horizontal = chromaSubsampling === '444' ? 1 : 2
  const vertical = chromaSubsampling === '420' ? 2 : 1
  return {
    luminanceHorizontal: horizontal,
    luminanceVertical: vertical,
    mcuWidth: horizontal === 1 ? 8 : 16,
    rowHeight: vertical === 1 ? 8 : 16,
    fillChroma: vertical === 2 ? fillChroma420 : horizontal === 2 ? fillChroma422 : fillChroma444,
  }
}

interface ProgressivePlanes {
  readonly luminance: ProgressivePlane
  readonly blueDifference?: ProgressivePlane
  readonly redDifference?: ProgressivePlane
}

const planeCoefficientCount = (blocksPerLine: number, blocksPerColumn: number): bigint =>
  BigInt(blocksPerLine) * BigInt(blocksPerColumn) * 64n

const createProgressivePlane = (
  blocksPerLine: number,
  blocksPerColumn: number,
  storageBlocksPerLine = blocksPerLine,
  storageBlocksPerColumn = blocksPerColumn,
): ProgressivePlane => ({
  blocksPerLine,
  blocksPerColumn,
  storageBlocksPerLine,
  coefficients: new Int16Array(
    Number(planeCoefficientCount(storageBlocksPerLine, storageBlocksPerColumn)),
  ),
})

const createProgressivePlanes = (
  width: number,
  height: number,
  sampling: SamplingGeometry,
  grayscale: boolean,
  maximumCoefficientBytes: number,
): ProgressivePlanes => {
  const mcusPerLine = Math.ceil(width / sampling.mcuWidth)
  const mcusPerColumn = Math.ceil(height / sampling.rowHeight)
  const luminanceBlocksPerLine = mcusPerLine * sampling.luminanceHorizontal
  const luminanceBlocksPerColumn = mcusPerColumn * sampling.luminanceVertical
  const luminanceCoefficients = planeCoefficientCount(
    luminanceBlocksPerLine,
    luminanceBlocksPerColumn,
  )
  const chrominanceCoefficients = grayscale
    ? 0n
    : planeCoefficientCount(mcusPerLine, mcusPerColumn) * 2n
  const coefficientBytes = (luminanceCoefficients + chrominanceCoefficients) * 2n
  if (coefficientBytes > BigInt(maximumCoefficientBytes)) {
    throw limitExceeded(
      `Progressive JPEG coefficient storage is ${coefficientBytes} bytes; maxDecodedBytes is ${maximumCoefficientBytes}`,
    )
  }
  const imageBlocksPerLine = Math.ceil(width / 8)
  const imageBlocksPerColumn = Math.ceil(height / 8)
  const luminance = createProgressivePlane(
    imageBlocksPerLine,
    imageBlocksPerColumn,
    luminanceBlocksPerLine,
    luminanceBlocksPerColumn,
  )
  if (grayscale) return { luminance }
  return {
    luminance,
    blueDifference: createProgressivePlane(
      Math.ceil(imageBlocksPerLine / sampling.luminanceHorizontal),
      Math.ceil(imageBlocksPerColumn / sampling.luminanceVertical),
      mcusPerLine,
      mcusPerColumn,
    ),
    redDifference: createProgressivePlane(
      Math.ceil(imageBlocksPerLine / sampling.luminanceHorizontal),
      Math.ceil(imageBlocksPerColumn / sampling.luminanceVertical),
      mcusPerLine,
      mcusPerColumn,
    ),
  }
}

const fillLuminance8 = (
  rows: Uint8Array,
  width: number,
  originX: number,
  originY: number,
  output: Float64Array,
): void => {
  const lastX = width - 1
  for (let y = 0; y < 8; y += 1) {
    let source = (originY + y) * width * 3 + Math.min(originX, lastX) * 3
    const rowEnd = (originY + y) * width * 3 + lastX * 3
    let target = y * 8
    for (let x = 0; x < 8; x += 1) {
      const red = rows[source] ?? 0
      const green = rows[source + 1] ?? 0
      const blue = rows[source + 2] ?? 0
      output[target] = 0.299 * red + 0.587 * green + 0.114 * blue - 128
      source = source < rowEnd ? source + 3 : rowEnd
      target += 1
    }
  }
}

const fillGray8 = (
  rows: Uint8Array,
  width: number,
  originX: number,
  output: Float64Array,
): void => {
  const lastX = width - 1
  for (let y = 0; y < 8; y += 1) {
    let source = y * width + Math.min(originX, lastX)
    const rowEnd = y * width + lastX
    let target = y * 8
    for (let x = 0; x < 8; x += 1) {
      output[target] = (rows[source] ?? 0) - 128
      source = source < rowEnd ? source + 1 : rowEnd
      target += 1
    }
  }
}

const fillChroma444 = (
  rows: Uint8Array,
  width: number,
  originX: number,
  blueDifference: Float64Array,
  redDifference: Float64Array,
): void => {
  const lastX = width - 1
  for (let y = 0; y < 8; y += 1) {
    let source = y * width * 3 + originX * 3
    const rowEnd = y * width * 3 + lastX * 3
    let target = y * 8
    for (let x = 0; x < 8; x += 1) {
      const red = rows[source] ?? 0
      const green = rows[source + 1] ?? 0
      const blue = rows[source + 2] ?? 0
      blueDifference[target] = -0.168736 * red - 0.331264 * green + 0.5 * blue
      redDifference[target] = 0.5 * red - 0.418688 * green - 0.081312 * blue
      source = source < rowEnd ? source + 3 : rowEnd
      target += 1
    }
  }
}

const fillChroma422 = (
  rows: Uint8Array,
  width: number,
  originX: number,
  blueDifference: Float64Array,
  redDifference: Float64Array,
): void => {
  const lastX = width - 1
  for (let y = 0; y < 8; y += 1) {
    const rowStart = y * width * 3
    let target = y * 8
    for (let x = 0; x < 8; x += 1) {
      const firstX = Math.min(originX + x * 2, lastX)
      const secondX = Math.min(firstX + 1, lastX)
      const first = rowStart + firstX * 3
      const second = rowStart + secondX * 3
      const red = (rows[first] ?? 0) + (rows[second] ?? 0)
      const green = (rows[first + 1] ?? 0) + (rows[second + 1] ?? 0)
      const blue = (rows[first + 2] ?? 0) + (rows[second + 2] ?? 0)
      blueDifference[target] = -0.084368 * red - 0.165632 * green + 0.25 * blue
      redDifference[target] = 0.25 * red - 0.209344 * green - 0.040656 * blue
      target += 1
    }
  }
}

const fillChroma420 = (
  rows: Uint8Array,
  width: number,
  originX: number,
  blueDifference: Float64Array,
  redDifference: Float64Array,
): void => {
  const lastX = width - 1
  for (let y = 0; y < 8; y += 1) {
    const firstRow = y * 2 * width * 3
    const secondRow = firstRow + width * 3
    let target = y * 8
    for (let x = 0; x < 8; x += 1) {
      const firstX = Math.min(originX + x * 2, lastX)
      const secondX = Math.min(firstX + 1, lastX)
      const first = firstX * 3
      const second = secondX * 3
      const red =
        (rows[firstRow + first] ?? 0) +
        (rows[firstRow + second] ?? 0) +
        (rows[secondRow + first] ?? 0) +
        (rows[secondRow + second] ?? 0)
      const green =
        (rows[firstRow + first + 1] ?? 0) +
        (rows[firstRow + second + 1] ?? 0) +
        (rows[secondRow + first + 1] ?? 0) +
        (rows[secondRow + second + 1] ?? 0)
      const blue =
        (rows[firstRow + first + 2] ?? 0) +
        (rows[firstRow + second + 2] ?? 0) +
        (rows[secondRow + first + 2] ?? 0) +
        (rows[secondRow + second + 2] ?? 0)
      blueDifference[target] = -0.042184 * red - 0.082816 * green + 0.125 * blue
      redDifference[target] = 0.125 * red - 0.104672 * green - 0.020328 * blue
      target += 1
    }
  }
}

class JpegEncoder implements ImageEncoder {
  readonly #sink: ImageSink
  readonly #width: number
  readonly #height: number
  readonly #format: PixelFormat
  readonly #metadata: EncodeRequest['metadata']
  readonly #sourceChannels: number
  readonly #grayscale: boolean
  readonly #progressive: boolean
  readonly #background: readonly [number, number, number]
  readonly #sampling: SamplingGeometry
  readonly #restartInterval: number
  readonly #luminanceTable: Uint8Array
  readonly #chrominanceTable: Uint8Array
  readonly #rows: Uint8Array
  readonly #writer = new ByteWriter()
  readonly #luminanceSamples = new Float64Array(64)
  readonly #blueDifferenceSamples = new Float64Array(64)
  readonly #redDifferenceSamples = new Float64Array(64)
  readonly #intermediate = new Float64Array(128)
  readonly #coefficients = new Int32Array(64)
  #progressivePlanes: ProgressivePlanes | undefined
  #receivedRows = 0
  #bufferedRows = 0
  #mcuRow = 0
  #previousY = 0
  #previousCb = 0
  #previousCr = 0
  #mcu = 0
  #restart = 0
  #finished = false

  constructor(
    sink: ImageSink,
    width: number,
    height: number,
    format: PixelFormat,
    encoderOptions: EncoderOptions,
    metadata: EncodeRequest['metadata'],
    maximumCoefficientBytes: number,
  ) {
    this.#sink = sink
    this.#width = width
    this.#height = height
    this.#format = format
    this.#metadata = metadata
    this.#sourceChannels = channels(format)
    this.#grayscale = format === 'gray8'
    this.#progressive = encoderOptions.progressive
    this.#background = encoderOptions.background
    this.#sampling = samplingGeometry(this.#grayscale ? '444' : encoderOptions.chromaSubsampling)
    this.#restartInterval = encoderOptions.restartInterval
    this.#luminanceTable = quantizationTable(luminanceQuantization, encoderOptions.quality)
    this.#chrominanceTable = quantizationTable(chrominanceQuantization, encoderOptions.quality)
    this.#rows = new Uint8Array(width * this.#sampling.rowHeight * (this.#grayscale ? 1 : 3))
    this.#progressivePlanes = this.#progressive
      ? createProgressivePlanes(
          width,
          height,
          this.#sampling,
          this.#grayscale,
          maximumCoefficientBytes,
        )
      : undefined
  }

  async start(): Promise<void> {
    await this.#sink.write(
      jpegHeader(
        this.#width,
        this.#height,
        this.#luminanceTable,
        this.#chrominanceTable,
        (this.#sampling.luminanceHorizontal << 4) | this.#sampling.luminanceVertical,
        this.#metadata,
        this.#grayscale,
        this.#restartInterval,
        this.#progressive,
      ),
    )
  }

  async write(block: PixelBlock): Promise<void> {
    if (this.#finished) throw new Error('Cannot write to a finished JPEG encoder')
    if (
      block.x !== 0 ||
      block.y !== this.#receivedRows ||
      block.width !== this.#width ||
      block.height < 1 ||
      block.y + block.height > this.#height ||
      block.format !== this.#format
    ) {
      throw invalidInput('JPEG encoder requires ordered, full-width pixel blocks')
    }
    const sourceRowBytes = this.#width * this.#sourceChannels
    if (
      block.stride < sourceRowBytes ||
      block.data.byteLength < block.stride * (block.height - 1) + sourceRowBytes
    ) {
      throw invalidInput('JPEG encoder pixel block data is truncated')
    }

    for (let row = 0; row < block.height; row += 1) {
      this.#appendRow(block.data, row * block.stride)
      this.#receivedRows += 1
      if (this.#bufferedRows === this.#sampling.rowHeight) await this.#encodeRows()
    }
  }

  #appendRow(source: Uint8Array, sourceOffset: number): void {
    const targetOffset = this.#bufferedRows * this.#width * (this.#grayscale ? 1 : 3)
    if (this.#format === 'gray8' || this.#format === 'rgb8') {
      const rowBytes = this.#width * this.#sourceChannels
      this.#rows.set(source.subarray(sourceOffset, sourceOffset + rowBytes), targetOffset)
    } else {
      const pixels = new DataView(source.buffer, source.byteOffset + sourceOffset, this.#width * 4)
      const [red, green, blue] = this.#background
      const rows = this.#rows
      for (
        let input = 0, output = targetOffset;
        input < pixels.byteLength;
        input += 4, output += 3
      ) {
        const pixel = pixels.getUint32(input, true)
        const alpha = pixel >>> 24
        const inverse = 255 - alpha
        // An integer numerator divided by 255 rounds up from remainder 128.
        rows[output] = (((pixel & 255) * alpha + red * inverse + 127) / 255) | 0
        rows[output + 1] = ((((pixel >>> 8) & 255) * alpha + green * inverse + 127) / 255) | 0
        rows[output + 2] = ((((pixel >>> 16) & 255) * alpha + blue * inverse + 127) / 255) | 0
      }
    }
    this.#bufferedRows += 1
  }

  #captureProgressiveRows(planes: ProgressivePlanes): void {
    const mcus = Math.ceil(this.#width / this.#sampling.mcuWidth)
    const { fillChroma } = this.#sampling
    for (let mcuX = 0; mcuX < mcus; mcuX += 1) {
      if (this.#grayscale) {
        fillGray8(this.#rows, this.#width, mcuX * 8, this.#luminanceSamples)
        quantize(
          this.#luminanceSamples,
          this.#luminanceTable,
          this.#intermediate,
          this.#coefficients,
        )
        const offset = (this.#mcuRow * planes.luminance.storageBlocksPerLine + mcuX) * 64
        storeQuantizedBlock(planes.luminance.coefficients, offset, this.#coefficients)
        continue
      }

      for (let blockY = 0; blockY < this.#sampling.luminanceVertical; blockY += 1) {
        for (let blockX = 0; blockX < this.#sampling.luminanceHorizontal; blockX += 1) {
          fillLuminance8(
            this.#rows,
            this.#width,
            mcuX * this.#sampling.mcuWidth + blockX * 8,
            blockY * 8,
            this.#luminanceSamples,
          )
          quantize(
            this.#luminanceSamples,
            this.#luminanceTable,
            this.#intermediate,
            this.#coefficients,
          )
          const x = mcuX * this.#sampling.luminanceHorizontal + blockX
          const y = this.#mcuRow * this.#sampling.luminanceVertical + blockY
          storeQuantizedBlock(
            planes.luminance.coefficients,
            (y * planes.luminance.storageBlocksPerLine + x) * 64,
            this.#coefficients,
          )
        }
      }

      const blueDifference = planes.blueDifference
      const redDifference = planes.redDifference
      if (!blueDifference || !redDifference) {
        throw invalidInput('Progressive JPEG chrominance coefficient storage is missing')
      }
      const originX = mcuX * this.#sampling.mcuWidth
      fillChroma(
        this.#rows,
        this.#width,
        originX,
        this.#blueDifferenceSamples,
        this.#redDifferenceSamples,
      )
      const chrominanceOffset = (this.#mcuRow * blueDifference.storageBlocksPerLine + mcuX) * 64
      quantize(
        this.#blueDifferenceSamples,
        this.#chrominanceTable,
        this.#intermediate,
        this.#coefficients,
      )
      storeQuantizedBlock(blueDifference.coefficients, chrominanceOffset, this.#coefficients)
      quantize(
        this.#redDifferenceSamples,
        this.#chrominanceTable,
        this.#intermediate,
        this.#coefficients,
      )
      storeQuantizedBlock(redDifference.coefficients, chrominanceOffset, this.#coefficients)
    }
    this.#mcuRow += 1
    this.#bufferedRows = 0
  }

  async #encodeRows(): Promise<void> {
    if (this.#progressivePlanes) {
      this.#captureProgressiveRows(this.#progressivePlanes)
      return
    }
    const mcus = Math.ceil(this.#width / this.#sampling.mcuWidth)
    const { fillChroma } = this.#sampling
    for (let mcuX = 0; mcuX < mcus; mcuX += 1) {
      if (this.#restartInterval > 0 && this.#mcu > 0 && this.#mcu % this.#restartInterval === 0) {
        this.#writer.flushBits()
        this.#writer.word(0xffd0 + (this.#restart & 7))
        this.#restart += 1
        this.#previousY = 0
        this.#previousCb = 0
        this.#previousCr = 0
      }
      if (this.#grayscale) {
        fillGray8(this.#rows, this.#width, mcuX * 8, this.#luminanceSamples)
        this.#previousY = encodeBlock(
          this.#writer,
          this.#luminanceSamples,
          this.#luminanceTable,
          this.#intermediate,
          this.#previousY,
          luminanceDcCodes,
          luminanceAcCodes,
        )
        this.#mcu += 1
        continue
      }
      for (let blockY = 0; blockY < this.#sampling.luminanceVertical; blockY += 1) {
        for (let blockX = 0; blockX < this.#sampling.luminanceHorizontal; blockX += 1) {
          fillLuminance8(
            this.#rows,
            this.#width,
            mcuX * this.#sampling.mcuWidth + blockX * 8,
            blockY * 8,
            this.#luminanceSamples,
          )
          this.#previousY = encodeBlock(
            this.#writer,
            this.#luminanceSamples,
            this.#luminanceTable,
            this.#intermediate,
            this.#previousY,
            luminanceDcCodes,
            luminanceAcCodes,
          )
        }
      }

      const originX = mcuX * this.#sampling.mcuWidth
      fillChroma(
        this.#rows,
        this.#width,
        originX,
        this.#blueDifferenceSamples,
        this.#redDifferenceSamples,
      )
      this.#previousCb = encodeBlock(
        this.#writer,
        this.#blueDifferenceSamples,
        this.#chrominanceTable,
        this.#intermediate,
        this.#previousCb,
        chrominanceDcCodes,
        chrominanceAcCodes,
      )
      this.#previousCr = encodeBlock(
        this.#writer,
        this.#redDifferenceSamples,
        this.#chrominanceTable,
        this.#intermediate,
        this.#previousCr,
        chrominanceDcCodes,
        chrominanceAcCodes,
      )
      this.#mcu += 1
    }
    this.#bufferedRows = 0
    const output = this.#writer.take()
    if (output.byteLength > 0) await this.#sink.write(output)
  }

  async #writePending(force = false): Promise<void> {
    if (!force && this.#writer.length < 65_536) return
    const output = this.#writer.take()
    if (output.byteLength > 0) await this.#sink.write(output)
  }

  #progressiveDcTables(planes: ProgressivePlanes): ProgressiveDcTables {
    const luminanceFrequencies = new Uint32Array(256)
    const chrominanceFrequencies = new Uint32Array(256)
    const mcusPerLine = Math.ceil(this.#width / this.#sampling.mcuWidth)
    const mcusPerColumn = Math.ceil(this.#height / this.#sampling.rowHeight)
    const blueDifference = planes.blueDifference
    const redDifference = planes.redDifference
    let previousY = 0
    let previousCb = 0
    let previousCr = 0
    let mcu = 0
    for (let mcuY = 0; mcuY < mcusPerColumn; mcuY += 1) {
      for (let mcuX = 0; mcuX < mcusPerLine; mcuX += 1) {
        if (this.#restartInterval > 0 && mcu > 0 && mcu % this.#restartInterval === 0) {
          previousY = 0
          previousCb = 0
          previousCr = 0
        }
        for (let blockY = 0; blockY < this.#sampling.luminanceVertical; blockY += 1) {
          for (let blockX = 0; blockX < this.#sampling.luminanceHorizontal; blockX += 1) {
            const x = mcuX * this.#sampling.luminanceHorizontal + blockX
            const y = mcuY * this.#sampling.luminanceVertical + blockY
            const coefficient =
              planes.luminance.coefficients[(y * planes.luminance.storageBlocksPerLine + x) * 64] ??
              0
            const dc = coefficient >> 1
            const category = coefficientMagnitude(dc - previousY)
            luminanceFrequencies[category] = (luminanceFrequencies[category] ?? 0) + 1
            previousY = dc
          }
        }
        if (!this.#grayscale) {
          if (!blueDifference || !redDifference) {
            throw invalidInput('Progressive JPEG chrominance coefficient storage is missing')
          }
          const offset = (mcuY * blueDifference.storageBlocksPerLine + mcuX) * 64
          const cb = (blueDifference.coefficients[offset] ?? 0) >> 1
          const cr = (redDifference.coefficients[offset] ?? 0) >> 1
          const cbCategory = coefficientMagnitude(cb - previousCb)
          const crCategory = coefficientMagnitude(cr - previousCr)
          chrominanceFrequencies[cbCategory] = (chrominanceFrequencies[cbCategory] ?? 0) + 1
          chrominanceFrequencies[crCategory] = (chrominanceFrequencies[crCategory] ?? 0) + 1
          previousCb = cb
          previousCr = cr
        }
        mcu += 1
      }
    }
    const luminance = optimizedHuffmanTable(luminanceFrequencies)
    return this.#grayscale
      ? { luminance }
      : { luminance, chrominance: optimizedHuffmanTable(chrominanceFrequencies) }
  }

  async #writeProgressiveDcScan(planes: ProgressivePlanes, refinement: boolean): Promise<void> {
    let luminanceCodes: HuffmanCodes = luminanceDcCodes
    let chrominanceCodes: HuffmanCodes = chrominanceDcCodes
    if (!refinement) {
      const tables = this.#progressiveDcTables(planes)
      const definitions: HuffmanTableDefinition[] = [
        { tableClass: 0, tableId: 0, table: tables.luminance },
      ]
      if (tables.chrominance) {
        chrominanceCodes = tables.chrominance
        definitions.push({ tableClass: 0, tableId: 1, table: tables.chrominance })
      }
      luminanceCodes = tables.luminance
      writeHuffmanTables(this.#writer, definitions)
    }
    writeScanHeader(
      this.#writer,
      this.#grayscale ? grayscaleScanComponents : colorScanComponents,
      0,
      0,
      refinement ? 1 : 0,
      refinement ? 0 : 1,
    )
    await this.#writePending(true)
    const mcusPerLine = Math.ceil(this.#width / this.#sampling.mcuWidth)
    const mcusPerColumn = Math.ceil(this.#height / this.#sampling.rowHeight)
    const blueDifference = planes.blueDifference
    const redDifference = planes.redDifference
    let previousY = 0
    let previousCb = 0
    let previousCr = 0
    let mcu = 0
    let restart = 0
    for (let mcuY = 0; mcuY < mcusPerColumn; mcuY += 1) {
      for (let mcuX = 0; mcuX < mcusPerLine; mcuX += 1) {
        if (this.#restartInterval > 0 && mcu > 0 && mcu % this.#restartInterval === 0) {
          this.#writer.flushBits()
          this.#writer.word(0xffd0 + (restart & 7))
          restart += 1
          previousY = 0
          previousCb = 0
          previousCr = 0
          await this.#writePending()
        }
        for (let blockY = 0; blockY < this.#sampling.luminanceVertical; blockY += 1) {
          for (let blockX = 0; blockX < this.#sampling.luminanceHorizontal; blockX += 1) {
            const x = mcuX * this.#sampling.luminanceHorizontal + blockX
            const y = mcuY * this.#sampling.luminanceVertical + blockY
            const coefficient =
              planes.luminance.coefficients[(y * planes.luminance.storageBlocksPerLine + x) * 64] ??
              0
            if (refinement) this.#writer.bits(coefficient & 1, 1)
            else {
              previousY = encodeProgressiveDcFirst(
                this.#writer,
                coefficient,
                previousY,
                luminanceCodes,
                1,
              )
            }
          }
        }
        if (!this.#grayscale) {
          if (!blueDifference || !redDifference) {
            throw invalidInput('Progressive JPEG chrominance coefficient storage is missing')
          }
          const offset = (mcuY * blueDifference.storageBlocksPerLine + mcuX) * 64
          const cb = blueDifference.coefficients[offset] ?? 0
          const cr = redDifference.coefficients[offset] ?? 0
          if (refinement) {
            this.#writer.bits(cb & 1, 1)
            this.#writer.bits(cr & 1, 1)
          } else {
            previousCb = encodeProgressiveDcFirst(this.#writer, cb, previousCb, chrominanceCodes, 1)
            previousCr = encodeProgressiveDcFirst(this.#writer, cr, previousCr, chrominanceCodes, 1)
          }
        }
        mcu += 1
        await this.#writePending()
      }
    }
    this.#writer.flushBits()
    await this.#writePending(true)
  }

  async #writeProgressiveAcScan(
    plane: ProgressivePlane,
    component: ScanComponent,
    refinement: boolean,
  ): Promise<void> {
    const successiveLow = refinement ? 0 : component.id === 1 ? 1 : 0
    const codes = progressiveAcTable(plane, refinement, successiveLow)
    writeHuffmanTables(this.#writer, [{ tableClass: 1, tableId: component.table, table: codes }])
    writeScanHeader(
      this.#writer,
      [component],
      1,
      63,
      refinement ? 1 : 0,
      refinement ? 0 : component.id === 1 ? 1 : 0,
    )
    await this.#writePending(true)
    let block = 0
    let restart = 0
    for (let blockY = 0; blockY < plane.blocksPerColumn; blockY += 1) {
      for (let blockX = 0; blockX < plane.blocksPerLine; blockX += 1) {
        if (this.#restartInterval > 0 && block > 0 && block % this.#restartInterval === 0) {
          this.#writer.flushBits()
          this.#writer.word(0xffd0 + (restart & 7))
          restart += 1
          await this.#writePending()
        }
        const offset = (blockY * plane.storageBlocksPerLine + blockX) * 64
        if (refinement) {
          encodeProgressiveAcRefinement(
            this.#writer,
            plane.coefficients,
            offset,
            codes,
            1,
            63,
            successiveLow,
          )
        } else {
          encodeProgressiveAcFirst(
            this.#writer,
            plane.coefficients,
            offset,
            codes,
            1,
            63,
            successiveLow,
          )
        }
        block += 1
        await this.#writePending()
      }
    }
    this.#writer.flushBits()
    await this.#writePending(true)
  }

  async #writeProgressiveScans(planes: ProgressivePlanes): Promise<void> {
    await this.#writeProgressiveDcScan(planes, false)
    await this.#writeProgressiveDcScan(planes, true)
    await this.#writeProgressiveAcScan(planes.luminance, luminanceScanComponent, false)
    if (!this.#grayscale) {
      if (!planes.blueDifference || !planes.redDifference) {
        throw invalidInput('Progressive JPEG chrominance coefficient storage is missing')
      }
      await this.#writeProgressiveAcScan(planes.blueDifference, blueDifferenceScanComponent, false)
      await this.#writeProgressiveAcScan(planes.redDifference, redDifferenceScanComponent, false)
    }
    await this.#writeProgressiveAcScan(planes.luminance, luminanceScanComponent, true)
  }

  async finish(): Promise<void> {
    if (this.#finished) throw new Error('JPEG encoder is already finished')
    this.#finished = true
    if (this.#receivedRows !== this.#height) {
      throw invalidInput(`JPEG encoder received ${this.#receivedRows} of ${this.#height} rows`)
    }
    if (this.#bufferedRows > 0) {
      const rowBytes = this.#width * (this.#grayscale ? 1 : 3)
      const lastOffset = (this.#bufferedRows - 1) * rowBytes
      while (this.#bufferedRows < this.#sampling.rowHeight) {
        this.#rows.copyWithin(this.#bufferedRows * rowBytes, lastOffset, lastOffset + rowBytes)
        this.#bufferedRows += 1
      }
      await this.#encodeRows()
    }
    const progressivePlanes = this.#progressivePlanes
    if (progressivePlanes) {
      try {
        await this.#writeProgressiveScans(progressivePlanes)
      } finally {
        this.#progressivePlanes = undefined
      }
      await this.#sink.write(Uint8Array.of(0xff, 0xd9))
      return
    }
    this.#writer.flushBits()
    const remaining = this.#writer.take()
    if (remaining.byteLength > 0) await this.#sink.write(remaining)
    await this.#sink.write(Uint8Array.of(0xff, 0xd9))
  }

  async abort(): Promise<void> {
    this.#finished = true
    this.#progressivePlanes = undefined
  }
}

export const createBaselineJpegEncoder = async (
  sink: ImageSink,
  request: EncodeRequest,
): Promise<ImageEncoder> => {
  if (
    !Number.isSafeInteger(request.width) ||
    !Number.isSafeInteger(request.height) ||
    request.width < 1 ||
    request.height < 1 ||
    request.width > 65_535 ||
    request.height > 65_535
  ) {
    throw invalidInput(`Invalid JPEG output dimensions: ${request.width}x${request.height}`)
  }
  const encoderOptions = options(request.options)
  const encoder = new JpegEncoder(
    sink,
    request.width,
    request.height,
    request.pixelFormat,
    encoderOptions,
    request.metadata,
    request.limits?.maxDecodedBytes ?? defaultImageLimits.maxDecodedBytes,
  )
  await encoder.start()
  return encoder
}

export const encodeJpegIdentityComponents = (
  width: number,
  height: number,
  channels: number,
  pixels: Uint8Array,
  abbreviated = false,
): { readonly tables: Uint8Array; readonly stream: Uint8Array } => {
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    !Number.isSafeInteger(channels) ||
    width < 1 ||
    height < 1 ||
    channels < 1 ||
    channels > 4 ||
    pixels.byteLength < width * height * channels
  ) {
    throw invalidInput('JPEG identity component image is invalid')
  }
  const quantization = new Uint8Array(64).fill(1)
  const writer = new ByteWriter()
  const samples = new Float64Array(64)
  const intermediate = new Float64Array(128)
  const predictors = new Int32Array(channels)
  for (let originY = 0; originY < height; originY += 8) {
    for (let originX = 0; originX < width; originX += 8) {
      for (let channel = 0; channel < channels; channel += 1) {
        for (let localY = 0; localY < 8; localY += 1) {
          const y = Math.min(originY + localY, height - 1)
          for (let localX = 0; localX < 8; localX += 1) {
            const x = Math.min(originX + localX, width - 1)
            samples[localY * 8 + localX] = (pixels[(y * width + x) * channels + channel] ?? 0) - 128
          }
        }
        predictors[channel] = encodeBlock(
          writer,
          samples,
          quantization,
          intermediate,
          predictors[channel] ?? 0,
          luminanceDcCodes,
          luminanceAcCodes,
        )
      }
    }
  }
  writer.flushBits()
  const entropy = writer.take()
  const tablesWriter = new ByteWriter()
  tablesWriter.byte(0xff)
  tablesWriter.byte(0xd8)
  tablesWriter.byte(0xff)
  tablesWriter.byte(0xdb)
  tablesWriter.word(67)
  tablesWriter.byte(0)
  tablesWriter.bytes(quantization)
  tablesWriter.byte(0xff)
  tablesWriter.byte(0xd9)
  const stream = new ByteWriter()
  stream.byte(0xff)
  stream.byte(0xd8)
  if (!abbreviated) {
    stream.byte(0xff)
    stream.byte(0xdb)
    stream.word(67)
    stream.byte(0)
    stream.bytes(quantization)
  }
  const frame = new Uint8Array(6 + channels * 3)
  frame[0] = 8
  frame[1] = height >>> 8
  frame[2] = height & 0xff
  frame[3] = width >>> 8
  frame[4] = width & 0xff
  frame[5] = channels
  for (let channel = 0; channel < channels; channel += 1) {
    frame[6 + channel * 3] = channel
    frame[7 + channel * 3] = 0x11
    frame[8 + channel * 3] = 0
  }
  stream.byte(0xff)
  stream.byte(0xc0)
  stream.word(frame.byteLength + 2)
  stream.bytes(frame)
  stream.byte(0xff)
  stream.byte(0xc4)
  stream.word(3 + luminanceDcCounts.byteLength + luminanceDcValues.byteLength)
  writeTable(stream, 0, 0, luminanceDcCounts, luminanceDcValues)
  stream.byte(0xff)
  stream.byte(0xc4)
  stream.word(3 + luminanceAcCounts.byteLength + luminanceAcValues.byteLength)
  writeTable(stream, 1, 0, luminanceAcCounts, luminanceAcValues)
  const scan = new Uint8Array(1 + channels * 2 + 3)
  scan[0] = channels
  for (let channel = 0; channel < channels; channel += 1) {
    scan[1 + channel * 2] = channel
    scan[2 + channel * 2] = 0
  }
  scan[scan.byteLength - 3] = 0
  scan[scan.byteLength - 2] = 63
  scan[scan.byteLength - 1] = 0
  stream.byte(0xff)
  stream.byte(0xda)
  stream.word(scan.byteLength + 2)
  stream.bytes(scan)
  stream.bytes(entropy)
  stream.byte(0xff)
  stream.byte(0xd9)
  return { tables: tablesWriter.take(), stream: stream.take() }
}
