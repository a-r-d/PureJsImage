import type { ImageEncoder } from '../codec.ts'
import { invalidInput } from '../errors.ts'
import type { PixelBlock, PixelFormat } from '../pixel.ts'
import type { ImageSink } from '../sink.ts'
import { addInverseVp8Block, vp8AcQuantizers, vp8DcQuantizers } from './vp8.ts'
import {
  coefficientUpdateProbabilities,
  defaultCoefficientProbabilities,
  keyframeBlockModeProbabilities,
} from './vp8-tables.ts'

const yModeTree = [-4, 2, 4, 6, 0, -1, -2, -3]
const uvModeTree = [0, 2, -1, 4, -2, -3]
const blockModeTree = [0, 2, -1, 4, -2, 6, 8, 12, -3, 10, -5, -6, -4, 14, -7, 16, -8, -9]
const yModeProbabilities = [145, 156, 163, 128]
const uvModeProbabilities = [142, 114, 183]
const bands = [0, 1, 2, 3, 6, 4, 5, 6, 6, 6, 6, 6, 6, 6, 6, 7]
const zigzag = [0, 1, 4, 8, 5, 2, 3, 6, 9, 12, 13, 10, 7, 11, 14, 15]
const leftIndexes = [0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7]
const aboveIndexes = [0, 1, 2, 3, 0, 1, 2, 3, 0, 1, 2, 3, 0, 1, 2, 3, 4, 5, 4, 5, 6, 7, 6, 7]

class BooleanEncoder {
  readonly #bytes: number[] = []
  #range = 255
  #bottom = 0
  #bitCount = 24

  bit(value: number, probability = 128): void {
    const split = 1 + (((this.#range - 1) * probability) >> 8)
    if (value !== 0) {
      this.#bottom = (this.#bottom + split) >>> 0
      this.#range -= split
    } else this.#range = split
    while (this.#range < 128) {
      this.#range <<= 1
      if ((this.#bottom & 0x80000000) !== 0) this.#carry()
      this.#bottom = (this.#bottom << 1) >>> 0
      this.#bitCount -= 1
      if (this.#bitCount === 0) {
        this.#bytes.push(this.#bottom >>> 24)
        this.#bottom &= 0x00ffffff
        this.#bitCount = 8
      }
    }
  }

  uint(value: number, bits: number): void {
    for (let bit = bits - 1; bit >= 0; bit -= 1) this.bit((value >>> bit) & 1)
  }

  finish(): Uint8Array {
    let count = this.#bitCount
    let value = this.#bottom
    if ((value & (2 ** (32 - count))) !== 0) this.#carry()
    value = (value << (count & 7)) >>> 0
    count >>= 3
    while (--count >= 0) value = (value << 8) >>> 0
    for (let index = 0; index < 4; index += 1) {
      this.#bytes.push(value >>> 24)
      value = (value << 8) >>> 0
    }
    return Uint8Array.from(this.#bytes)
  }

  #carry(): void {
    let index = this.#bytes.length - 1
    while (index >= 0 && this.#bytes[index] === 255) {
      this.#bytes[index] = 0
      index -= 1
    }
    if (index < 0) throw invalidInput('VP8 boolean encoder carry underflow')
    this.#bytes[index] = (this.#bytes[index] ?? 0) + 1
  }
}

const writeTree = (
  encoder: BooleanEncoder,
  tree: readonly number[],
  probabilities: ArrayLike<number>,
  symbol: number,
  probabilityOffset = 0,
): void => {
  const visit = (node: number): readonly number[] | undefined => {
    for (let bit = 0; bit < 2; bit += 1) {
      const next = tree[node + bit]
      if (next === undefined) continue
      if (next <= 0 && -next === symbol) return [bit]
      if (next > 0) {
        const suffix = visit(next)
        if (suffix) return [bit, ...suffix]
      }
    }
    return undefined
  }
  const path = visit(0)
  if (!path) throw invalidInput(`VP8 tree cannot encode symbol ${symbol}`)
  let node = 0
  for (const bit of path) {
    encoder.bit(bit, probabilities[probabilityOffset + (node >> 1)] ?? 128)
    const next = tree[node + bit] ?? 0
    if (next > 0) node = next
  }
}

const probabilityOffset = (type: number, coefficient: number, context: number): number =>
  ((type * 8 + (bands[coefficient] ?? 0)) * 3 + context) * 11

const categories = [
  { base: 5, probabilities: [159] },
  { base: 7, probabilities: [145, 165] },
  { base: 11, probabilities: [140, 148, 173] },
  { base: 19, probabilities: [135, 140, 155, 176] },
  { base: 35, probabilities: [130, 134, 141, 157, 180] },
  { base: 67, probabilities: [129, 130, 133, 140, 153, 177, 196, 230, 243, 254, 254] },
]

const writeMagnitude = (
  encoder: BooleanEncoder,
  probabilities: Uint8Array,
  offset: number,
  magnitude: number,
): void => {
  if (magnitude === 1) {
    encoder.bit(0, probabilities[offset + 2])
    return
  }
  encoder.bit(1, probabilities[offset + 2])
  if (magnitude <= 4) {
    encoder.bit(0, probabilities[offset + 3])
    encoder.bit(Number(magnitude !== 2), probabilities[offset + 4])
    if (magnitude !== 2) encoder.bit(Number(magnitude === 4), probabilities[offset + 5])
    return
  }
  encoder.bit(1, probabilities[offset + 3])
  const category =
    magnitude <= 6
      ? 0
      : magnitude <= 10
        ? 1
        : magnitude <= 18
          ? 2
          : magnitude <= 34
            ? 3
            : magnitude <= 66
              ? 4
              : 5
  encoder.bit(Number(category >= 2), probabilities[offset + 6])
  if (category < 2) encoder.bit(category, probabilities[offset + 7])
  else {
    encoder.bit(Number(category >= 4), probabilities[offset + 8])
    if (category < 4) encoder.bit(category - 2, probabilities[offset + 9])
    else encoder.bit(category - 4, probabilities[offset + 10])
  }
  const descriptor = categories[category]
  if (!descriptor) throw invalidInput('VP8 coefficient category is invalid')
  const extra = magnitude - descriptor.base
  for (let bit = descriptor.probabilities.length - 1; bit >= 0; bit -= 1) {
    encoder.bit((extra >>> bit) & 1, descriptor.probabilities[bit])
  }
}

const writeCoefficientBlock = (
  encoder: BooleanEncoder,
  probabilities: Uint8Array,
  coefficients: Int32Array,
  type: number,
  context: number,
): boolean => {
  let coefficient = 0
  let nextContext = context
  let checkEnd = true
  const values = zigzag.map((position) => coefficients[position] ?? 0)
  while (coefficient < 16) {
    const offset = probabilityOffset(type, coefficient, nextContext)
    let nextNonzero = coefficient
    while (nextNonzero < 16 && values[nextNonzero] === 0) nextNonzero += 1
    if (checkEnd) {
      encoder.bit(Number(nextNonzero < 16), probabilities[offset])
      if (nextNonzero === 16) return values.some((value) => value !== 0)
    }
    if (values[coefficient] === 0) {
      encoder.bit(0, probabilities[offset + 1])
      coefficient += 1
      nextContext = 0
      checkEnd = false
      continue
    }
    encoder.bit(1, probabilities[offset + 1])
    const value = values[coefficient] ?? 0
    const magnitude = Math.abs(value)
    writeMagnitude(encoder, probabilities, offset, magnitude)
    encoder.bit(Number(value < 0))
    coefficient += 1
    nextContext = magnitude === 1 ? 1 : 2
    checkEnd = true
  }
  return values.some((value) => value !== 0)
}

const clampByte = (value: number): number => Math.max(0, Math.min(255, value))

const forwardDct = (residual: Int16Array): Int32Array => {
  const temporary = new Int32Array(16)
  const output = new Int32Array(16)
  for (let row = 0; row < 4; row += 1) {
    const offset = row * 4
    const a = ((residual[offset] ?? 0) + (residual[offset + 3] ?? 0)) << 3
    const b = ((residual[offset + 1] ?? 0) + (residual[offset + 2] ?? 0)) << 3
    const c = ((residual[offset + 1] ?? 0) - (residual[offset + 2] ?? 0)) << 3
    const d = ((residual[offset] ?? 0) - (residual[offset + 3] ?? 0)) << 3
    temporary[offset] = a + b
    temporary[offset + 2] = a - b
    temporary[offset + 1] = (c * 2217 + d * 5352 + 14500) >> 12
    temporary[offset + 3] = (d * 2217 - c * 5352 + 7500) >> 12
  }
  for (let column = 0; column < 4; column += 1) {
    const a = (temporary[column] ?? 0) + (temporary[12 + column] ?? 0)
    const b = (temporary[4 + column] ?? 0) + (temporary[8 + column] ?? 0)
    const c = (temporary[4 + column] ?? 0) - (temporary[8 + column] ?? 0)
    const d = (temporary[column] ?? 0) - (temporary[12 + column] ?? 0)
    output[column] = (a + b + 7) >> 4
    output[8 + column] = (a - b + 7) >> 4
    output[4 + column] = ((c * 2217 + d * 5352 + 12000) >> 16) + Number(d !== 0)
    output[12 + column] = (d * 2217 - c * 5352 + 51000) >> 16
  }
  return output
}

const quantize = (coefficients: Int32Array, dc: number, ac: number): Int32Array =>
  Int32Array.from(coefficients, (value, index) => {
    const factor = index === 0 ? dc : ac
    const magnitude = Math.min(2114, Math.floor((Math.abs(value) + factor / 2) / factor))
    return value < 0 ? -magnitude : magnitude
  })

interface ReconstructionPlane {
  readonly data: Uint8Array
  readonly stride: number
  readonly origin: number
}

const createPlane = (width: number, height: number): ReconstructionPlane => {
  const stride = width + 2
  return { data: new Uint8Array((height + 2) * stride), stride, origin: stride + 1 }
}

const prepareEdges = (
  plane: ReconstructionPlane,
  offset: number,
  size: number,
  row: number,
  column: number,
): void => {
  if (column === 0) {
    for (let index = -1; index < size; index += 1)
      plane.data[offset - 1 + index * plane.stride] = 129
  }
  if (row === 0) plane.data.fill(127, offset - plane.stride - 1, offset - plane.stride + size)
}

const predictDc = (plane: ReconstructionPlane, offset: number, size: number): number => {
  let total = 0
  for (let index = 0; index < size; index += 1) {
    total += plane.data[offset - plane.stride + index] ?? 0
    total += plane.data[offset - 1 + index * plane.stride] ?? 0
  }
  const value = (total + size) >> (size === 8 ? 4 : 3)
  for (let y = 0; y < size; y += 1)
    plane.data.fill(value, offset + y * plane.stride, offset + y * plane.stride + size)
  return value
}

const encodeVp8 = (
  width: number,
  height: number,
  ySource: Uint8Array,
  uSource: Uint16Array,
  vSource: Uint16Array,
  quality: number,
): Uint8Array => {
  const columns = Math.ceil(width / 16)
  const rows = Math.ceil(height / 16)
  const chromaWidth = Math.ceil(width / 2)
  const chromaHeight = Math.ceil(height / 2)
  const q = Math.round(((100 - quality) * 127) / 99)
  const yDc = vp8DcQuantizers[q] ?? 4
  const yAc = vp8AcQuantizers[q] ?? 4
  const uvDc = Math.min(132, yDc)
  const uvAc = yAc

  const header = new BooleanEncoder()
  header.uint(0, 2)
  header.bit(0)
  header.bit(0)
  header.uint(0, 6)
  header.uint(0, 3)
  header.bit(0)
  header.uint(0, 2)
  header.uint(q, 7)
  for (let index = 0; index < 5; index += 1) header.bit(0)
  header.bit(0)
  for (let index = 0; index < coefficientUpdateProbabilities.length; index += 1) {
    header.bit(0, coefficientUpdateProbabilities[index])
  }
  header.bit(0)
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      writeTree(header, yModeTree, yModeProbabilities, 4)
      for (let block = 0; block < 16; block += 1) {
        writeTree(header, blockModeTree, keyframeBlockModeProbabilities, 0, 0)
      }
      writeTree(header, uvModeTree, uvModeProbabilities, 0)
    }
  }

  const tokens = new BooleanEncoder()
  const probabilities = defaultCoefficientProbabilities
  const yPlane = createPlane(columns * 16, rows * 16)
  const uPlane = createPlane(columns * 8, rows * 8)
  const vPlane = createPlane(columns * 8, rows * 8)
  const above = Array.from({ length: columns }, () => new Int8Array(8))
  const sourceY = (x: number, y: number): number =>
    ySource[Math.min(height - 1, y) * width + Math.min(width - 1, x)] ?? 0
  const sourceChroma = (source: Uint16Array, x: number, y: number): number => {
    const sourceX = Math.min(chromaWidth - 1, x)
    const sourceY = Math.min(chromaHeight - 1, y)
    const count = (sourceX * 2 + 1 < width ? 2 : 1) * (sourceY * 2 + 1 < height ? 2 : 1)
    return Math.round((source[sourceY * chromaWidth + sourceX] ?? 0) / count)
  }
  for (let row = 0; row < rows; row += 1) {
    const left = new Int8Array(8)
    for (let column = 0; column < columns; column += 1) {
      const aboveContext = above[column] ?? new Int8Array(8)
      const coefficients: Int32Array[] = []
      const yOffset = yPlane.origin + row * 16 * yPlane.stride + column * 16
      prepareEdges(yPlane, yOffset, 16, row, column)
      for (let block = 0; block < 16; block += 1) {
        const blockX = column * 16 + (block & 3) * 4
        const blockY = row * 16 + (block >> 2) * 4
        const output = yOffset + (block >> 2) * 4 * yPlane.stride + (block & 3) * 4
        const predictor = predictDc(yPlane, output, 4)
        const residual = Int16Array.from(
          { length: 16 },
          (_, index) => sourceY(blockX + (index & 3), blockY + (index >> 2)) - predictor,
        )
        const quantized = quantize(forwardDct(residual), yDc, yAc)
        coefficients.push(quantized)
        const reconstructed = Int32Array.from(
          quantized,
          (value, index) => value * (index === 0 ? yDc : yAc),
        )
        addInverseVp8Block(yPlane.data, yPlane.stride, output, reconstructed)
      }
      for (const [plane, source] of [
        [uPlane, uSource],
        [vPlane, vSource],
      ] as const) {
        const output = plane.origin + row * 8 * plane.stride + column * 8
        prepareEdges(plane, output, 8, row, column)
        const predictor = predictDc(plane, output, 8)
        for (let block = 0; block < 4; block += 1) {
          const blockX = column * 8 + (block & 1) * 4
          const blockY = row * 8 + (block >> 1) * 4
          const residual = Int16Array.from(
            { length: 16 },
            (_, index) =>
              sourceChroma(source, blockX + (index & 3), blockY + (index >> 2)) - predictor,
          )
          const quantized = quantize(forwardDct(residual), uvDc, uvAc)
          coefficients.push(quantized)
          const reconstructed = Int32Array.from(
            quantized,
            (value, index) => value * (index === 0 ? uvDc : uvAc),
          )
          addInverseVp8Block(
            plane.data,
            plane.stride,
            output + (block >> 1) * 4 * plane.stride + (block & 1) * 4,
            reconstructed,
          )
        }
      }
      for (let block = 0; block < 24; block += 1) {
        const type = block < 16 ? 3 : 2
        const leftIndex = leftIndexes[block] ?? 0
        const aboveIndex = aboveIndexes[block] ?? 0
        const nonzero = writeCoefficientBlock(
          tokens,
          probabilities,
          coefficients[block] ?? new Int32Array(16),
          type,
          (left[leftIndex] ?? 0) + (aboveContext[aboveIndex] ?? 0),
        )
        left[leftIndex] = nonzero ? 1 : 0
        aboveContext[aboveIndex] = nonzero ? 1 : 0
      }
      above[column] = aboveContext
    }
  }
  const firstPartition = header.finish()
  const tokenPartition = tokens.finish()
  const output = new Uint8Array(10 + firstPartition.length + tokenPartition.length)
  const tag = (firstPartition.length << 5) | 0x10
  output[0] = tag & 255
  output[1] = (tag >>> 8) & 255
  output[2] = tag >>> 16
  output.set([0x9d, 0x01, 0x2a], 3)
  output[6] = width & 255
  output[7] = width >>> 8
  output[8] = height & 255
  output[9] = height >>> 8
  output.set(firstPartition, 10)
  output.set(tokenPartition, 10 + firstPartition.length)
  return output
}

const channels = (format: PixelFormat): number =>
  format === 'gray8' ? 1 : format === 'rgb8' ? 3 : format === 'rgba8' ? 4 : 0
const uint24 = (data: Uint8Array, offset: number, value: number): void => {
  data[offset] = value & 255
  data[offset + 1] = (value >>> 8) & 255
  data[offset + 2] = (value >>> 16) & 255
}
const uint32 = (data: Uint8Array, offset: number, value: number): void =>
  new DataView(data.buffer, data.byteOffset, data.byteLength).setUint32(offset, value, true)

export class LossyWebpEncoder implements ImageEncoder {
  readonly #sink: ImageSink
  readonly #width: number
  readonly #height: number
  readonly #format: PixelFormat
  readonly #channels: number
  readonly #quality: number
  readonly #y: Uint8Array
  readonly #u: Uint16Array
  readonly #v: Uint16Array
  readonly #alpha: Uint8Array | undefined
  #hasAlpha = false
  #expectedY = 0
  #finished = false

  constructor(
    sink: ImageSink,
    width: number,
    height: number,
    format: PixelFormat,
    quality: number,
  ) {
    this.#sink = sink
    this.#width = width
    this.#height = height
    this.#format = format
    this.#channels = channels(format)
    if (this.#channels === 0) throw invalidInput(`WebP encoder does not support ${format} pixels`)
    this.#quality = quality
    this.#y = new Uint8Array(width * height)
    const chromaPixels = Math.ceil(width / 2) * Math.ceil(height / 2)
    this.#u = new Uint16Array(chromaPixels)
    this.#v = new Uint16Array(chromaPixels)
    this.#alpha = format === 'rgba8' ? new Uint8Array(width * height) : undefined
  }

  async write(block: PixelBlock): Promise<void> {
    const rowBytes = this.#width * this.#channels
    if (
      this.#finished ||
      block.x !== 0 ||
      block.y !== this.#expectedY ||
      block.width !== this.#width ||
      block.format !== this.#format ||
      block.height < 1 ||
      block.y + block.height > this.#height ||
      block.stride < rowBytes ||
      block.data.byteLength < block.stride * (block.height - 1) + rowBytes
    )
      throw invalidInput('WebP encoder requires ordered, full-width pixel blocks')
    const chromaWidth = Math.ceil(this.#width / 2)
    for (let row = 0; row < block.height; row += 1)
      for (let x = 0; x < this.#width; x += 1) {
        const source = row * block.stride + x * this.#channels
        const red = block.data[source] ?? 0
        const green = this.#channels === 1 ? red : (block.data[source + 1] ?? 0)
        const blue = this.#channels === 1 ? red : (block.data[source + 2] ?? 0)
        const y = this.#expectedY + row
        this.#y[y * this.#width + x] = clampByte(
          ((66 * red + 129 * green + 25 * blue + 128) >> 8) + 16,
        )
        const chroma = (y >> 1) * chromaWidth + (x >> 1)
        this.#u[chroma] =
          (this.#u[chroma] ?? 0) +
          clampByte(((-38 * red - 74 * green + 112 * blue + 128) >> 8) + 128)
        this.#v[chroma] =
          (this.#v[chroma] ?? 0) +
          clampByte(((112 * red - 94 * green - 18 * blue + 128) >> 8) + 128)
        if (this.#alpha) {
          const alpha = block.data[source + 3] ?? 0
          this.#alpha[y * this.#width + x] = alpha
          this.#hasAlpha ||= alpha !== 255
        }
      }
    this.#expectedY += block.height
  }

  async finish(): Promise<void> {
    if (this.#finished || this.#expectedY !== this.#height)
      throw invalidInput('WebP encoder received incomplete pixels')
    this.#finished = true
    const vp8 = encodeVp8(this.#width, this.#height, this.#y, this.#u, this.#v, this.#quality)
    const alpha = this.#hasAlpha ? this.#alpha : undefined
    const extended = alpha !== undefined
    const vp8Padding = vp8.length & 1
    const alphaLength = extended ? 1 + alpha.length : 0
    const alphaPadding = alphaLength & 1
    const bodyLength = extended
      ? 4 + 18 + 8 + alphaLength + alphaPadding + 8 + vp8.length + vp8Padding
      : 4 + 8 + vp8.length + vp8Padding
    const output = new Uint8Array(8 + bodyLength)
    output.set([82, 73, 70, 70], 0)
    uint32(output, 4, bodyLength)
    output.set([87, 69, 66, 80], 8)
    let offset = 12
    if (extended) {
      output.set([86, 80, 56, 88], offset)
      uint32(output, offset + 4, 10)
      output[offset + 8] = 0x10
      uint24(output, offset + 12, this.#width - 1)
      uint24(output, offset + 15, this.#height - 1)
      offset += 18
      output.set([65, 76, 80, 72], offset)
      uint32(output, offset + 4, alphaLength)
      output[offset + 8] = 0
      output.set(alpha, offset + 9)
      offset += 8 + alphaLength + alphaPadding
    }
    output.set([86, 80, 56, 32], offset)
    uint32(output, offset + 4, vp8.length)
    output.set(vp8, offset + 8)
    await this.#sink.write(output)
  }

  async abort(): Promise<void> {
    this.#finished = true
  }
}
