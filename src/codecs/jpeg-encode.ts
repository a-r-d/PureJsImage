import type { EncodeRequest, ImageEncoder } from '../codec.ts'
import { invalidInput } from '../errors.ts'
import { iccColorSpace } from '../metadata.ts'
import type { PixelBlock, PixelFormat } from '../pixel.ts'
import type { ImageSink } from '../sink.ts'

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

const luminanceDcCounts = Uint8Array.of(0, 1, 5, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0)
const luminanceDcValues = Uint8Array.of(0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11)
const luminanceAcCounts = Uint8Array.of(0, 2, 1, 3, 3, 2, 4, 3, 5, 5, 4, 4, 0, 0, 1, 0x7d)
const luminanceAcValues = Uint8Array.of(
  0x01,
  0x02,
  0x03,
  0x00,
  0x04,
  0x11,
  0x05,
  0x12,
  0x21,
  0x31,
  0x41,
  0x06,
  0x13,
  0x51,
  0x61,
  0x07,
  0x22,
  0x71,
  0x14,
  0x32,
  0x81,
  0x91,
  0xa1,
  0x08,
  0x23,
  0x42,
  0xb1,
  0xc1,
  0x15,
  0x52,
  0xd1,
  0xf0,
  0x24,
  0x33,
  0x62,
  0x72,
  0x82,
  0x09,
  0x0a,
  0x16,
  0x17,
  0x18,
  0x19,
  0x1a,
  0x25,
  0x26,
  0x27,
  0x28,
  0x29,
  0x2a,
  0x34,
  0x35,
  0x36,
  0x37,
  0x38,
  0x39,
  0x3a,
  0x43,
  0x44,
  0x45,
  0x46,
  0x47,
  0x48,
  0x49,
  0x4a,
  0x53,
  0x54,
  0x55,
  0x56,
  0x57,
  0x58,
  0x59,
  0x5a,
  0x63,
  0x64,
  0x65,
  0x66,
  0x67,
  0x68,
  0x69,
  0x6a,
  0x73,
  0x74,
  0x75,
  0x76,
  0x77,
  0x78,
  0x79,
  0x7a,
  0x83,
  0x84,
  0x85,
  0x86,
  0x87,
  0x88,
  0x89,
  0x8a,
  0x92,
  0x93,
  0x94,
  0x95,
  0x96,
  0x97,
  0x98,
  0x99,
  0x9a,
  0xa2,
  0xa3,
  0xa4,
  0xa5,
  0xa6,
  0xa7,
  0xa8,
  0xa9,
  0xaa,
  0xb2,
  0xb3,
  0xb4,
  0xb5,
  0xb6,
  0xb7,
  0xb8,
  0xb9,
  0xba,
  0xc2,
  0xc3,
  0xc4,
  0xc5,
  0xc6,
  0xc7,
  0xc8,
  0xc9,
  0xca,
  0xd2,
  0xd3,
  0xd4,
  0xd5,
  0xd6,
  0xd7,
  0xd8,
  0xd9,
  0xda,
  0xe1,
  0xe2,
  0xe3,
  0xe4,
  0xe5,
  0xe6,
  0xe7,
  0xe8,
  0xe9,
  0xea,
  0xf1,
  0xf2,
  0xf3,
  0xf4,
  0xf5,
  0xf6,
  0xf7,
  0xf8,
  0xf9,
  0xfa,
)
const chrominanceDcCounts = Uint8Array.of(0, 3, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0)
const chrominanceDcValues = luminanceDcValues
const chrominanceAcCounts = Uint8Array.of(0, 2, 1, 2, 4, 4, 3, 4, 7, 5, 4, 4, 0, 1, 2, 0x77)
const chrominanceAcValues = Uint8Array.of(
  0x00,
  0x01,
  0x02,
  0x03,
  0x11,
  0x04,
  0x05,
  0x21,
  0x31,
  0x06,
  0x12,
  0x41,
  0x51,
  0x07,
  0x61,
  0x71,
  0x13,
  0x22,
  0x32,
  0x81,
  0x08,
  0x14,
  0x42,
  0x91,
  0xa1,
  0xb1,
  0xc1,
  0x09,
  0x23,
  0x33,
  0x52,
  0xf0,
  0x15,
  0x62,
  0x72,
  0xd1,
  0x0a,
  0x16,
  0x24,
  0x34,
  0xe1,
  0x25,
  0xf1,
  0x17,
  0x18,
  0x19,
  0x1a,
  0x26,
  0x27,
  0x28,
  0x29,
  0x2a,
  0x35,
  0x36,
  0x37,
  0x38,
  0x39,
  0x3a,
  0x43,
  0x44,
  0x45,
  0x46,
  0x47,
  0x48,
  0x49,
  0x4a,
  0x53,
  0x54,
  0x55,
  0x56,
  0x57,
  0x58,
  0x59,
  0x5a,
  0x63,
  0x64,
  0x65,
  0x66,
  0x67,
  0x68,
  0x69,
  0x6a,
  0x73,
  0x74,
  0x75,
  0x76,
  0x77,
  0x78,
  0x79,
  0x7a,
  0x82,
  0x83,
  0x84,
  0x85,
  0x86,
  0x87,
  0x88,
  0x89,
  0x8a,
  0x92,
  0x93,
  0x94,
  0x95,
  0x96,
  0x97,
  0x98,
  0x99,
  0x9a,
  0xa2,
  0xa3,
  0xa4,
  0xa5,
  0xa6,
  0xa7,
  0xa8,
  0xa9,
  0xaa,
  0xb2,
  0xb3,
  0xb4,
  0xb5,
  0xb6,
  0xb7,
  0xb8,
  0xb9,
  0xba,
  0xc2,
  0xc3,
  0xc4,
  0xc5,
  0xc6,
  0xc7,
  0xc8,
  0xc9,
  0xca,
  0xd2,
  0xd3,
  0xd4,
  0xd5,
  0xd6,
  0xd7,
  0xd8,
  0xd9,
  0xda,
  0xe2,
  0xe3,
  0xe4,
  0xe5,
  0xe6,
  0xe7,
  0xe8,
  0xe9,
  0xea,
  0xf2,
  0xf3,
  0xf4,
  0xf5,
  0xf6,
  0xf7,
  0xf8,
  0xf9,
  0xfa,
)

interface HuffmanCodes {
  readonly values: Uint16Array
  readonly lengths: Uint8Array
}

interface EncoderOptions {
  readonly quality: number
  readonly background: readonly [number, number, number]
  readonly chromaSubsampling: '420' | '422' | '444'
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
  if (value.progressive === true)
    throw invalidInput('Progressive JPEG encoding is not supported yet')
  const chromaSubsampling = value.chromaSubsampling ?? '420'
  if (chromaSubsampling !== '420' && chromaSubsampling !== '422' && chromaSubsampling !== '444') {
    throw invalidInput('JPEG chromaSubsampling must be 420, 422, or 444')
  }
  const background = value.background
  if (background === undefined || background === 'transparent') {
    return { quality, background: [255, 255, 255], chromaSubsampling }
  }
  if (typeof background !== 'string' || !/^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(background)) {
    throw invalidInput('JPEG background must be transparent, #RRGGBB, or #RRGGBBAA')
  }
  return {
    quality,
    chromaSubsampling,
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

const luminanceDcCodes = huffmanCodes(luminanceDcCounts, luminanceDcValues)
const luminanceAcCodes = huffmanCodes(luminanceAcCounts, luminanceAcValues)
const chrominanceDcCodes = huffmanCodes(chrominanceDcCounts, chrominanceDcValues)
const chrominanceAcCodes = huffmanCodes(chrominanceAcCounts, chrominanceAcValues)

class ByteWriter {
  #bytes = new Uint8Array(8_192)
  #length = 0
  #pending = 0
  #pendingBits = 0

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

const jpegHeader = (
  width: number,
  height: number,
  luminance: Uint8Array,
  chrominance: Uint8Array,
  luminanceSampling: number,
  metadata: EncodeRequest['metadata'],
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
  writer.word(132)
  writer.byte(0)
  for (let index = 0; index < 64; index += 1) writer.byte(luminance[zigZag[index] ?? 0] ?? 0)
  writer.byte(1)
  for (let index = 0; index < 64; index += 1) writer.byte(chrominance[zigZag[index] ?? 0] ?? 0)

  writer.word(0xffc0)
  writer.word(17)
  writer.byte(8)
  writer.word(height)
  writer.word(width)
  writer.byte(3)
  for (const [id, table] of [
    [1, 0],
    [2, 1],
    [3, 1],
  ] as const) {
    writer.byte(id)
    writer.byte(id === 1 ? luminanceSampling : 0x11)
    writer.byte(table)
  }

  writer.word(0xffc4)
  writer.word(418)
  writeTable(writer, 0, 0, luminanceDcCounts, luminanceDcValues)
  writeTable(writer, 1, 0, luminanceAcCounts, luminanceAcValues)
  writeTable(writer, 0, 1, chrominanceDcCounts, chrominanceDcValues)
  writeTable(writer, 1, 1, chrominanceAcCounts, chrominanceAcValues)

  writer.word(0xffda)
  writer.word(12)
  writer.byte(3)
  writer.byte(1)
  writer.byte(0x00)
  writer.byte(2)
  writer.byte(0x11)
  writer.byte(3)
  writer.byte(0x11)
  writer.byte(0)
  writer.byte(63)
  writer.byte(0)
  return writer.take()
}

const dctBasis = Float64Array.from({ length: 64 }, (_, index) => {
  const frequency = Math.floor(index / 8)
  const position = index % 8
  const normalization = frequency === 0 ? Math.SQRT1_2 : 1
  return 0.5 * normalization * Math.cos(((2 * position + 1) * frequency * Math.PI) / 16)
})

const quantize = (
  samples: Float64Array,
  table: Uint8Array,
  intermediate: Float64Array,
  output: Int32Array,
): void => {
  for (let row = 0; row < 8; row += 1) {
    for (let frequency = 0; frequency < 8; frequency += 1) {
      let value = 0
      for (let x = 0; x < 8; x += 1) {
        value += (samples[row * 8 + x] ?? 0) * (dctBasis[frequency * 8 + x] ?? 0)
      }
      intermediate[row * 8 + frequency] = value
    }
  }
  for (let vertical = 0; vertical < 8; vertical += 1) {
    for (let horizontal = 0; horizontal < 8; horizontal += 1) {
      let value = 0
      for (let y = 0; y < 8; y += 1) {
        value += (dctBasis[vertical * 8 + y] ?? 0) * (intermediate[y * 8 + horizontal] ?? 0)
      }
      output[vertical * 8 + horizontal] = Math.round(
        value / (table[vertical * 8 + horizontal] ?? 1),
      )
    }
  }
}

const encodeBlock = (
  writer: ByteWriter,
  coefficients: Int32Array,
  previousDc: number,
  dcCodes: HuffmanCodes,
  acCodes: HuffmanCodes,
): number => {
  const dc = coefficients[0] ?? 0
  const difference = dc - previousDc
  const dcCategory = difference === 0 ? 0 : 32 - Math.clz32(Math.abs(difference))
  writer.code(dcCodes, dcCategory)
  if (dcCategory > 0) {
    writer.bits(difference < 0 ? difference + (1 << dcCategory) - 1 : difference, dcCategory)
  }

  let zeroes = 0
  for (let index = 1; index < 64; index += 1) {
    const coefficient = coefficients[zigZag[index] ?? 0] ?? 0
    if (coefficient === 0) {
      zeroes += 1
      continue
    }
    while (zeroes >= 16) {
      writer.code(acCodes, 0xf0)
      zeroes -= 16
    }
    const category = 32 - Math.clz32(Math.abs(coefficient))
    writer.code(acCodes, (zeroes << 4) | category)
    writer.bits(coefficient < 0 ? coefficient + (1 << category) - 1 : coefficient, category)
    zeroes = 0
  }
  if (zeroes > 0) writer.code(acCodes, 0)
  return dc
}

interface SamplingGeometry {
  readonly chromaSubsampling: '420' | '422' | '444'
  readonly luminanceHorizontal: 1 | 2
  readonly luminanceVertical: 1 | 2
  readonly mcuWidth: 8 | 16
  readonly rowHeight: 8 | 16
}

const samplingGeometry = (chromaSubsampling: '420' | '422' | '444'): SamplingGeometry => {
  if (chromaSubsampling === '420') {
    return {
      chromaSubsampling,
      luminanceHorizontal: 2,
      luminanceVertical: 2,
      mcuWidth: 16,
      rowHeight: 16,
    }
  }
  if (chromaSubsampling === '422') {
    return {
      chromaSubsampling,
      luminanceHorizontal: 2,
      luminanceVertical: 1,
      mcuWidth: 16,
      rowHeight: 8,
    }
  }
  return {
    chromaSubsampling,
    luminanceHorizontal: 1,
    luminanceVertical: 1,
    mcuWidth: 8,
    rowHeight: 8,
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

class BaselineJpegEncoder implements ImageEncoder {
  readonly #sink: ImageSink
  readonly #width: number
  readonly #height: number
  readonly #format: PixelFormat
  readonly #metadata: EncodeRequest['metadata']
  readonly #sourceChannels: number
  readonly #background: readonly [number, number, number]
  readonly #sampling: SamplingGeometry
  readonly #luminanceTable: Uint8Array
  readonly #chrominanceTable: Uint8Array
  readonly #rows: Uint8Array
  readonly #writer = new ByteWriter()
  readonly #luminanceSamples = new Float64Array(64)
  readonly #blueDifferenceSamples = new Float64Array(64)
  readonly #redDifferenceSamples = new Float64Array(64)
  readonly #intermediate = new Float64Array(64)
  readonly #coefficients = new Int32Array(64)
  #receivedRows = 0
  #bufferedRows = 0
  #previousY = 0
  #previousCb = 0
  #previousCr = 0
  #finished = false

  constructor(
    sink: ImageSink,
    width: number,
    height: number,
    format: PixelFormat,
    encoderOptions: EncoderOptions,
    metadata: EncodeRequest['metadata'],
  ) {
    this.#sink = sink
    this.#width = width
    this.#height = height
    this.#format = format
    this.#metadata = metadata
    this.#sourceChannels = channels(format)
    this.#background = encoderOptions.background
    this.#sampling = samplingGeometry(encoderOptions.chromaSubsampling)
    this.#luminanceTable = quantizationTable(luminanceQuantization, encoderOptions.quality)
    this.#chrominanceTable = quantizationTable(chrominanceQuantization, encoderOptions.quality)
    this.#rows = new Uint8Array(width * this.#sampling.rowHeight * 3)
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
    const targetOffset = this.#bufferedRows * this.#width * 3
    if (this.#format === 'gray8') {
      for (let x = 0; x < this.#width; x += 1) {
        const input = sourceOffset + x
        const output = targetOffset + x * 3
        const gray = source[input] ?? 0
        this.#rows[output] = gray
        this.#rows[output + 1] = gray
        this.#rows[output + 2] = gray
      }
    } else if (this.#format === 'rgb8') {
      for (let x = 0; x < this.#width; x += 1) {
        const input = sourceOffset + x * 3
        const output = targetOffset + x * 3
        this.#rows[output] = source[input] ?? 0
        this.#rows[output + 1] = source[input + 1] ?? 0
        this.#rows[output + 2] = source[input + 2] ?? 0
      }
    } else {
      for (let x = 0; x < this.#width; x += 1) {
        const input = sourceOffset + x * 4
        const output = targetOffset + x * 3
        const alpha = source[input + 3] ?? 0
        const inverse = 255 - alpha
        this.#rows[output] = Math.round(
          ((source[input] ?? 0) * alpha + this.#background[0] * inverse) / 255,
        )
        this.#rows[output + 1] = Math.round(
          ((source[input + 1] ?? 0) * alpha + this.#background[1] * inverse) / 255,
        )
        this.#rows[output + 2] = Math.round(
          ((source[input + 2] ?? 0) * alpha + this.#background[2] * inverse) / 255,
        )
      }
    }
    this.#bufferedRows += 1
  }

  async #encodeRows(): Promise<void> {
    const mcus = Math.ceil(this.#width / this.#sampling.mcuWidth)
    const fillChroma =
      this.#sampling.chromaSubsampling === '420'
        ? fillChroma420
        : this.#sampling.chromaSubsampling === '422'
          ? fillChroma422
          : fillChroma444
    for (let mcuX = 0; mcuX < mcus; mcuX += 1) {
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
          this.#previousY = encodeBlock(
            this.#writer,
            this.#coefficients,
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
      quantize(
        this.#blueDifferenceSamples,
        this.#chrominanceTable,
        this.#intermediate,
        this.#coefficients,
      )
      this.#previousCb = encodeBlock(
        this.#writer,
        this.#coefficients,
        this.#previousCb,
        chrominanceDcCodes,
        chrominanceAcCodes,
      )
      quantize(
        this.#redDifferenceSamples,
        this.#chrominanceTable,
        this.#intermediate,
        this.#coefficients,
      )
      this.#previousCr = encodeBlock(
        this.#writer,
        this.#coefficients,
        this.#previousCr,
        chrominanceDcCodes,
        chrominanceAcCodes,
      )
    }
    this.#bufferedRows = 0
    const output = this.#writer.take()
    if (output.byteLength > 0) await this.#sink.write(output)
  }

  async finish(): Promise<void> {
    if (this.#finished) throw new Error('JPEG encoder is already finished')
    this.#finished = true
    if (this.#receivedRows !== this.#height) {
      throw invalidInput(`JPEG encoder received ${this.#receivedRows} of ${this.#height} rows`)
    }
    if (this.#bufferedRows > 0) {
      const rowBytes = this.#width * 3
      const lastOffset = (this.#bufferedRows - 1) * rowBytes
      while (this.#bufferedRows < this.#sampling.rowHeight) {
        this.#rows.copyWithin(this.#bufferedRows * rowBytes, lastOffset, lastOffset + rowBytes)
        this.#bufferedRows += 1
      }
      await this.#encodeRows()
    }
    this.#writer.flushBits()
    const remaining = this.#writer.take()
    if (remaining.byteLength > 0) await this.#sink.write(remaining)
    await this.#sink.write(Uint8Array.of(0xff, 0xd9))
  }

  async abort(): Promise<void> {
    this.#finished = true
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
  const encoder = new BaselineJpegEncoder(
    sink,
    request.width,
    request.height,
    request.pixelFormat,
    options(request.options),
    request.metadata,
  )
  await encoder.start()
  return encoder
}
