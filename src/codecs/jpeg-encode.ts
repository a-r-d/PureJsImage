import type { EncodeRequest, ImageEncoder } from '../codec.ts'
import { invalidInput } from '../errors.ts'
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

interface HuffmanCode {
  readonly value: number
  readonly length: number
}

interface EncoderOptions {
  readonly quality: number
  readonly background: readonly [number, number, number]
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
  const background = value.background
  if (background === undefined || background === 'transparent') {
    return { quality, background: [255, 255, 255] }
  }
  if (typeof background !== 'string' || !/^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(background)) {
    throw invalidInput('JPEG background must be transparent, #RRGGBB, or #RRGGBBAA')
  }
  return {
    quality,
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

const huffmanCodes = (counts: Uint8Array, values: Uint8Array): ReadonlyMap<number, HuffmanCode> => {
  const result = new Map<number, HuffmanCode>()
  let code = 0
  let valueIndex = 0
  for (let length = 1; length <= 16; length += 1) {
    const count = counts[length - 1] ?? 0
    for (let index = 0; index < count; index += 1) {
      const symbol = values[valueIndex]
      if (symbol === undefined) throw new Error('Standard JPEG Huffman table is invalid')
      result.set(symbol, { value: code, length })
      code += 1
      valueIndex += 1
    }
    code <<= 1
  }
  return result
}

const luminanceDcCodes = huffmanCodes(luminanceDcCounts, luminanceDcValues)
const luminanceAcCodes = huffmanCodes(luminanceAcCounts, luminanceAcValues)
const chrominanceDcCodes = huffmanCodes(chrominanceDcCounts, chrominanceDcValues)
const chrominanceAcCodes = huffmanCodes(chrominanceAcCounts, chrominanceAcValues)

class ByteWriter {
  readonly #bytes: number[] = []
  #pending = 0
  #pendingBits = 0

  byte(value: number): void {
    this.#bytes.push(value & 255)
  }

  word(value: number): void {
    this.byte(value >>> 8)
    this.byte(value)
  }

  bits(value: number, length: number): void {
    for (let position = length - 1; position >= 0; position -= 1) {
      this.#pending = (this.#pending << 1) | ((value >>> position) & 1)
      this.#pendingBits += 1
      if (this.#pendingBits === 8) {
        this.byte(this.#pending)
        if (this.#pending === 0xff) this.byte(0)
        this.#pending = 0
        this.#pendingBits = 0
      }
    }
  }

  code(table: ReadonlyMap<number, HuffmanCode>, symbol: number): void {
    const code = table.get(symbol)
    if (!code) throw invalidInput(`JPEG coefficient has no Huffman code: ${symbol}`)
    this.bits(code.value, code.length)
  }

  flushBits(): void {
    if (this.#pendingBits === 0) return
    this.bits((1 << (8 - this.#pendingBits)) - 1, 8 - this.#pendingBits)
  }

  take(): Uint8Array {
    const output = Uint8Array.from(this.#bytes)
    this.#bytes.length = 0
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
): Uint8Array => {
  const writer = new ByteWriter()
  writer.word(0xffd8)
  writer.word(0xffe0)
  writer.word(16)
  for (const value of [0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]) writer.byte(value)

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
    writer.byte(0x11)
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

const magnitude = (value: number): { readonly category: number; readonly bits: number } => {
  if (value === 0) return { category: 0, bits: 0 }
  const category = Math.floor(Math.log2(Math.abs(value))) + 1
  return {
    category,
    bits: value < 0 ? value + (1 << category) - 1 : value,
  }
}

const encodeBlock = (
  writer: ByteWriter,
  coefficients: Int32Array,
  previousDc: number,
  dcCodes: ReadonlyMap<number, HuffmanCode>,
  acCodes: ReadonlyMap<number, HuffmanCode>,
): number => {
  const dc = coefficients[0] ?? 0
  const difference = magnitude(dc - previousDc)
  writer.code(dcCodes, difference.category)
  if (difference.category > 0) writer.bits(difference.bits, difference.category)

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
    const encoded = magnitude(coefficient)
    writer.code(acCodes, (zeroes << 4) | encoded.category)
    writer.bits(encoded.bits, encoded.category)
    zeroes = 0
  }
  if (zeroes > 0) writer.code(acCodes, 0)
  return dc
}

class BaselineJpegEncoder implements ImageEncoder {
  readonly #sink: ImageSink
  readonly #width: number
  readonly #height: number
  readonly #format: PixelFormat
  readonly #sourceChannels: number
  readonly #background: readonly [number, number, number]
  readonly #luminanceTable: Uint8Array
  readonly #chrominanceTable: Uint8Array
  readonly #rows: Uint8Array
  readonly #writer = new ByteWriter()
  readonly #samples = new Float64Array(64)
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
  ) {
    this.#sink = sink
    this.#width = width
    this.#height = height
    this.#format = format
    this.#sourceChannels = channels(format)
    this.#background = encoderOptions.background
    this.#luminanceTable = quantizationTable(luminanceQuantization, encoderOptions.quality)
    this.#chrominanceTable = quantizationTable(chrominanceQuantization, encoderOptions.quality)
    this.#rows = new Uint8Array(width * 8 * 3)
  }

  async start(): Promise<void> {
    await this.#sink.write(
      jpegHeader(this.#width, this.#height, this.#luminanceTable, this.#chrominanceTable),
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
      if (this.#bufferedRows === 8) await this.#encodeRows()
    }
  }

  #appendRow(source: Uint8Array, sourceOffset: number): void {
    const targetOffset = this.#bufferedRows * this.#width * 3
    for (let x = 0; x < this.#width; x += 1) {
      const input = sourceOffset + x * this.#sourceChannels
      const output = targetOffset + x * 3
      if (this.#format === 'gray8') {
        const gray = source[input] ?? 0
        this.#rows[output] = gray
        this.#rows[output + 1] = gray
        this.#rows[output + 2] = gray
      } else if (this.#format === 'rgb8') {
        this.#rows[output] = source[input] ?? 0
        this.#rows[output + 1] = source[input + 1] ?? 0
        this.#rows[output + 2] = source[input + 2] ?? 0
      } else {
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

  #fillSamples(blockX: number, component: 0 | 1 | 2): void {
    for (let y = 0; y < 8; y += 1) {
      for (let x = 0; x < 8; x += 1) {
        const sourceX = Math.min(this.#width - 1, blockX * 8 + x)
        const source = (y * this.#width + sourceX) * 3
        const red = this.#rows[source] ?? 0
        const green = this.#rows[source + 1] ?? 0
        const blue = this.#rows[source + 2] ?? 0
        let value = 0
        if (component === 0) value = 0.299 * red + 0.587 * green + 0.114 * blue
        else if (component === 1) value = -0.168736 * red - 0.331264 * green + 0.5 * blue + 128
        else value = 0.5 * red - 0.418688 * green - 0.081312 * blue + 128
        this.#samples[y * 8 + x] = value - 128
      }
    }
  }

  async #encodeRows(): Promise<void> {
    const blocks = Math.ceil(this.#width / 8)
    for (let blockX = 0; blockX < blocks; blockX += 1) {
      this.#fillSamples(blockX, 0)
      quantize(this.#samples, this.#luminanceTable, this.#intermediate, this.#coefficients)
      this.#previousY = encodeBlock(
        this.#writer,
        this.#coefficients,
        this.#previousY,
        luminanceDcCodes,
        luminanceAcCodes,
      )

      this.#fillSamples(blockX, 1)
      quantize(this.#samples, this.#chrominanceTable, this.#intermediate, this.#coefficients)
      this.#previousCb = encodeBlock(
        this.#writer,
        this.#coefficients,
        this.#previousCb,
        chrominanceDcCodes,
        chrominanceAcCodes,
      )

      this.#fillSamples(blockX, 2)
      quantize(this.#samples, this.#chrominanceTable, this.#intermediate, this.#coefficients)
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
      const last = this.#rows.slice(
        (this.#bufferedRows - 1) * this.#width * 3,
        this.#bufferedRows * this.#width * 3,
      )
      while (this.#bufferedRows < 8) {
        this.#rows.set(last, this.#bufferedRows * this.#width * 3)
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
  )
  await encoder.start()
  return encoder
}
