import type { ImageEncoder, PreservedMetadata } from '../codec.ts'
import { invalidInput } from '../errors.ts'
import { iccColorSpace } from '../metadata.ts'
import type { PixelBlock, PixelFormat } from '../pixel.ts'
import type { ImageSink } from '../sink.ts'
import { vp8AcQuantizers, vp8DcQuantizers } from './vp8.ts'
import {
  coefficientUpdateProbabilities,
  defaultCoefficientProbabilities,
  keyframeBlockModeProbabilities,
} from './vp8-tables.ts'

const yModeProbabilities = Uint8Array.of(145, 156, 163, 128)
const uvModeProbabilities = Uint8Array.of(142, 114, 183)
const bands = Uint8Array.of(0, 1, 2, 3, 6, 4, 5, 6, 6, 6, 6, 6, 6, 6, 6, 7)
const zigzag = Uint8Array.of(0, 1, 4, 8, 5, 2, 3, 6, 9, 12, 13, 10, 7, 11, 14, 15)
const leftIndexes = Uint8Array.of(
  0,
  0,
  0,
  0,
  1,
  1,
  1,
  1,
  2,
  2,
  2,
  2,
  3,
  3,
  3,
  3,
  4,
  4,
  5,
  5,
  6,
  6,
  7,
  7,
)
const aboveIndexes = Uint8Array.of(
  0,
  1,
  2,
  3,
  0,
  1,
  2,
  3,
  0,
  1,
  2,
  3,
  0,
  1,
  2,
  3,
  4,
  5,
  4,
  5,
  6,
  7,
  6,
  7,
)

class BooleanEncoder {
  #bytes = new Uint8Array(4096)
  #length = 0
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
        this.#append(this.#bottom >>> 24)
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
      this.#append(value >>> 24)
      value = (value << 8) >>> 0
    }
    return this.#bytes.slice(0, this.#length)
  }

  #carry(): void {
    let index = this.#length - 1
    while (index >= 0 && this.#bytes[index] === 255) {
      this.#bytes[index] = 0
      index -= 1
    }
    if (index < 0) throw invalidInput('VP8 boolean encoder carry underflow')
    this.#bytes[index] = (this.#bytes[index] ?? 0) + 1
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
  coefficientOffset: number,
  type: number,
  context: number,
): boolean => {
  let coefficient = 0
  let nextContext = context
  let checkEnd = true
  let hasNonzero = false
  while (coefficient < 16) {
    const offset = probabilityOffset(type, coefficient, nextContext)
    let nextNonzero = coefficient
    while (
      nextNonzero < 16 &&
      (coefficients[coefficientOffset + (zigzag[nextNonzero] ?? 0)] ?? 0) === 0
    ) {
      nextNonzero += 1
    }
    if (checkEnd) {
      encoder.bit(Number(nextNonzero < 16), probabilities[offset])
      if (nextNonzero === 16) return hasNonzero
    }
    const value = coefficients[coefficientOffset + (zigzag[coefficient] ?? 0)] ?? 0
    if (value === 0) {
      encoder.bit(0, probabilities[offset + 1])
      coefficient += 1
      nextContext = 0
      checkEnd = false
      continue
    }
    encoder.bit(1, probabilities[offset + 1])
    hasNonzero = true
    const magnitude = Math.abs(value)
    writeMagnitude(encoder, probabilities, offset, magnitude)
    encoder.bit(Number(value < 0))
    coefficient += 1
    nextContext = magnitude === 1 ? 1 : 2
    checkEnd = true
  }
  return hasNonzero
}

const clampByte = (value: number): number => Math.max(0, Math.min(255, value))

const forwardDct = (residual: Int16Array, temporary: Int32Array, output: Int32Array): void => {
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
}

const quantize = (
  input: Int32Array,
  dc: number,
  ac: number,
  output: Int32Array,
  outputOffset: number,
): void => {
  for (let index = 0; index < 16; index += 1) {
    const value = input[index] ?? 0
    const factor = index === 0 ? dc : ac
    const magnitude = Math.min(2114, Math.floor((Math.abs(value) + factor / 2) / factor))
    output[outputOffset + index] = value < 0 ? -magnitude : magnitude
  }
}

interface ReconstructionPlane {
  readonly data: Uint8Array
  readonly stride: number
  readonly origin: number
}

const createPlane = (width: number, height: number): ReconstructionPlane => {
  const stride = width + 2
  return { data: new Uint8Array((height + 2) * stride), stride, origin: stride + 1 }
}

const padPlane = (
  source: Uint8Array,
  sourceWidth: number,
  sourceHeight: number,
  paddedWidth: number,
  paddedHeight: number,
): Uint8Array => {
  if (sourceWidth === paddedWidth && sourceHeight === paddedHeight) return source
  const padded = new Uint8Array(paddedWidth * paddedHeight)
  for (let y = 0; y < paddedHeight; y += 1) {
    const sourceY = y < sourceHeight ? y : sourceHeight - 1
    const sourceRow = sourceY * sourceWidth
    const paddedRow = y * paddedWidth
    padded.set(source.subarray(sourceRow, sourceRow + sourceWidth), paddedRow)
    if (paddedWidth > sourceWidth) {
      padded.fill(
        source[sourceRow + sourceWidth - 1] ?? 0,
        paddedRow + sourceWidth,
        paddedRow + paddedWidth,
      )
    }
  }
  return padded
}

const finalizeChroma = (
  source: Uint16Array,
  width: number,
  height: number,
  chromaWidth: number,
  chromaHeight: number,
): Uint8Array => {
  const bytes = new Uint8Array(chromaWidth * chromaHeight)
  if ((width & 1) === 0 && (height & 1) === 0) {
    const pixels = chromaWidth * chromaHeight
    for (let index = 0; index < pixels; index += 1) {
      bytes[index] = ((source[index] ?? 0) + 2) >> 2
    }
    return bytes
  }
  for (let y = 0; y < chromaHeight; y += 1) {
    const row = y * chromaWidth
    const yCount = y * 2 + 1 < height ? 2 : 1
    for (let x = 0; x < chromaWidth; x += 1) {
      const count = (x * 2 + 1 < width ? 2 : 1) * yCount
      bytes[row + x] = Math.round((source[row + x] ?? 0) / count)
    }
  }
  return bytes
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

const predictDc4 = (plane: ReconstructionPlane, offset: number): number => {
  const data = plane.data
  const stride = plane.stride
  const top = offset - stride
  return (
    ((data[top] ?? 0) +
      (data[top + 1] ?? 0) +
      (data[top + 2] ?? 0) +
      (data[top + 3] ?? 0) +
      (data[offset - 1] ?? 0) +
      (data[offset - 1 + stride] ?? 0) +
      (data[offset - 1 + stride * 2] ?? 0) +
      (data[offset - 1 + stride * 3] ?? 0) +
      4) >>
    3
  )
}

const reconstructCoefficients = (
  coefficients: Int32Array,
  coefficientOffset: number,
  dc: number,
  ac: number,
  output: Int32Array,
): void => {
  output[0] = (coefficients[coefficientOffset] ?? 0) * dc
  for (let index = 1; index < 16; index += 1) {
    output[index] = (coefficients[coefficientOffset + index] ?? 0) * ac
  }
}

const addPredictedInverseVp8Block = (
  data: Uint8Array,
  stride: number,
  offset: number,
  coefficients: Int32Array,
  temporary: Int32Array,
  predictor: number,
): void => {
  for (let x = 0; x < 4; x += 1) {
    const top = coefficients[x] ?? 0
    const mid = coefficients[8 + x] ?? 0
    const one = coefficients[4 + x] ?? 0
    const three = coefficients[12 + x] ?? 0
    const c = ((one * 35468) >> 16) - three - ((three * 20091) >> 16)
    const d = one + ((one * 20091) >> 16) + ((three * 35468) >> 16)
    temporary[x] = top + mid + d
    temporary[12 + x] = top + mid - d
    temporary[4 + x] = top - mid + c
    temporary[8 + x] = top - mid - c
  }
  for (let y = 0; y < 4; y += 1) {
    const row = y * 4
    const a = (temporary[row] ?? 0) + (temporary[row + 2] ?? 0)
    const b = (temporary[row] ?? 0) - (temporary[row + 2] ?? 0)
    const one = temporary[row + 1] ?? 0
    const three = temporary[row + 3] ?? 0
    const c = ((one * 35468) >> 16) - three - ((three * 20091) >> 16)
    const d = one + ((one * 20091) >> 16) + ((three * 35468) >> 16)
    const pixel = offset + y * stride
    data[pixel] = clampByte(predictor + ((a + d + 4) >> 3))
    data[pixel + 1] = clampByte(predictor + ((b + c + 4) >> 3))
    data[pixel + 2] = clampByte(predictor + ((b - c + 4) >> 3))
    data[pixel + 3] = clampByte(predictor + ((a - d + 4) >> 3))
  }
}

const predictChromaDc = (
  plane: ReconstructionPlane,
  offset: number,
  row: number,
  column: number,
): number => {
  const size = 8
  let total = 0
  if (row > 0) {
    for (let index = 0; index < size; index += 1) {
      total += plane.data[offset - plane.stride + index] ?? 0
    }
  }
  if (column > 0) {
    for (let index = 0; index < size; index += 1) {
      total += plane.data[offset - 1 + index * plane.stride] ?? 0
    }
  }
  return row === 0 && column === 0
    ? 128
    : (total + (row > 0 && column > 0 ? size : size >> 1)) >> (row > 0 && column > 0 ? 4 : 3)
}

const encodeVp8 = (
  width: number,
  height: number,
  ySource: Uint8Array,
  uSource: Uint8Array,
  vSource: Uint8Array,
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
      header.bit(0, yModeProbabilities[0])
      for (let block = 0; block < 16; block += 1) {
        header.bit(0, keyframeBlockModeProbabilities[0])
      }
      header.bit(0, uvModeProbabilities[0])
    }
  }

  const tokens = new BooleanEncoder()
  const probabilities = defaultCoefficientProbabilities
  const yPlane = createPlane(columns * 16, rows * 16)
  const uPlane = createPlane(columns * 8, rows * 8)
  const vPlane = createPlane(columns * 8, rows * 8)
  const above = Array.from({ length: columns }, () => new Int8Array(8))
  const coefficients = new Int32Array(24 * 16)
  const residual = new Int16Array(16)
  const dctTemporary = new Int32Array(16)
  const transformed = new Int32Array(16)
  const reconstructed = new Int32Array(16)
  const paddedYWidth = columns * 16
  const paddedYHeight = rows * 16
  const paddedCWidth = columns * 8
  const paddedCHeight = rows * 8
  const yPadded = padPlane(ySource, width, height, paddedYWidth, paddedYHeight)
  const uPadded = padPlane(uSource, chromaWidth, chromaHeight, paddedCWidth, paddedCHeight)
  const vPadded = padPlane(vSource, chromaWidth, chromaHeight, paddedCWidth, paddedCHeight)
  for (let row = 0; row < rows; row += 1) {
    const left = new Int8Array(8)
    for (let column = 0; column < columns; column += 1) {
      const aboveContext = above[column] ?? new Int8Array(8)
      const yOffset = yPlane.origin + row * 16 * yPlane.stride + column * 16
      prepareEdges(yPlane, yOffset, 16, row, column)
      for (let block = 0; block < 16; block += 1) {
        const blockX = column * 16 + (block & 3) * 4
        const blockY = row * 16 + (block >> 2) * 4
        const output = yOffset + (block >> 2) * 4 * yPlane.stride + (block & 3) * 4
        const predictor = predictDc4(yPlane, output)
        const sampleRow = blockY * paddedYWidth + blockX
        residual[0] = (yPadded[sampleRow] ?? 0) - predictor
        residual[1] = (yPadded[sampleRow + 1] ?? 0) - predictor
        residual[2] = (yPadded[sampleRow + 2] ?? 0) - predictor
        residual[3] = (yPadded[sampleRow + 3] ?? 0) - predictor
        residual[4] = (yPadded[sampleRow + paddedYWidth] ?? 0) - predictor
        residual[5] = (yPadded[sampleRow + paddedYWidth + 1] ?? 0) - predictor
        residual[6] = (yPadded[sampleRow + paddedYWidth + 2] ?? 0) - predictor
        residual[7] = (yPadded[sampleRow + paddedYWidth + 3] ?? 0) - predictor
        residual[8] = (yPadded[sampleRow + paddedYWidth * 2] ?? 0) - predictor
        residual[9] = (yPadded[sampleRow + paddedYWidth * 2 + 1] ?? 0) - predictor
        residual[10] = (yPadded[sampleRow + paddedYWidth * 2 + 2] ?? 0) - predictor
        residual[11] = (yPadded[sampleRow + paddedYWidth * 2 + 3] ?? 0) - predictor
        residual[12] = (yPadded[sampleRow + paddedYWidth * 3] ?? 0) - predictor
        residual[13] = (yPadded[sampleRow + paddedYWidth * 3 + 1] ?? 0) - predictor
        residual[14] = (yPadded[sampleRow + paddedYWidth * 3 + 2] ?? 0) - predictor
        residual[15] = (yPadded[sampleRow + paddedYWidth * 3 + 3] ?? 0) - predictor
        forwardDct(residual, dctTemporary, transformed)
        const coefficientOffset = block * 16
        quantize(transformed, yDc, yAc, coefficients, coefficientOffset)
        reconstructCoefficients(coefficients, coefficientOffset, yDc, yAc, reconstructed)
        addPredictedInverseVp8Block(
          yPlane.data,
          yPlane.stride,
          output,
          reconstructed,
          dctTemporary,
          predictor,
        )
      }
      for (let planeIndex = 0; planeIndex < 2; planeIndex += 1) {
        const plane = planeIndex === 0 ? uPlane : vPlane
        const output = plane.origin + row * 8 * plane.stride + column * 8
        prepareEdges(plane, output, 8, row, column)
        const predictor = predictChromaDc(plane, output, row, column)
        const chromaSource = planeIndex === 0 ? uPadded : vPadded
        for (let block = 0; block < 4; block += 1) {
          const blockX = column * 8 + (block & 1) * 4
          const blockY = row * 8 + (block >> 1) * 4
          const sampleRow = blockY * paddedCWidth + blockX
          residual[0] = (chromaSource[sampleRow] ?? 0) - predictor
          residual[1] = (chromaSource[sampleRow + 1] ?? 0) - predictor
          residual[2] = (chromaSource[sampleRow + 2] ?? 0) - predictor
          residual[3] = (chromaSource[sampleRow + 3] ?? 0) - predictor
          residual[4] = (chromaSource[sampleRow + paddedCWidth] ?? 0) - predictor
          residual[5] = (chromaSource[sampleRow + paddedCWidth + 1] ?? 0) - predictor
          residual[6] = (chromaSource[sampleRow + paddedCWidth + 2] ?? 0) - predictor
          residual[7] = (chromaSource[sampleRow + paddedCWidth + 3] ?? 0) - predictor
          residual[8] = (chromaSource[sampleRow + paddedCWidth * 2] ?? 0) - predictor
          residual[9] = (chromaSource[sampleRow + paddedCWidth * 2 + 1] ?? 0) - predictor
          residual[10] = (chromaSource[sampleRow + paddedCWidth * 2 + 2] ?? 0) - predictor
          residual[11] = (chromaSource[sampleRow + paddedCWidth * 2 + 3] ?? 0) - predictor
          residual[12] = (chromaSource[sampleRow + paddedCWidth * 3] ?? 0) - predictor
          residual[13] = (chromaSource[sampleRow + paddedCWidth * 3 + 1] ?? 0) - predictor
          residual[14] = (chromaSource[sampleRow + paddedCWidth * 3 + 2] ?? 0) - predictor
          residual[15] = (chromaSource[sampleRow + paddedCWidth * 3 + 3] ?? 0) - predictor
          forwardDct(residual, dctTemporary, transformed)
          const coefficientOffset = (16 + planeIndex * 4 + block) * 16
          quantize(transformed, uvDc, uvAc, coefficients, coefficientOffset)
          reconstructCoefficients(coefficients, coefficientOffset, uvDc, uvAc, reconstructed)
          addPredictedInverseVp8Block(
            plane.data,
            plane.stride,
            output + (block >> 1) * 4 * plane.stride + (block & 1) * 4,
            reconstructed,
            dctTemporary,
            predictor,
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
          coefficients,
          block * 16,
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

const clampChannel = (value: number): number => (value < 0 ? 0 : value > 255 ? 255 : value)

const writeRgb8Pair = (
  top: Uint8Array,
  topOffset: number,
  bottom: Uint8Array | undefined,
  bottomOffset: number,
  width: number,
  y: number,
  yPlane: Uint8Array,
  uPlane: Uint8Array,
  vPlane: Uint8Array,
): void => {
  const chromaWidth = (width + 1) >> 1
  const yRow = y * width
  const lowerRow = yRow + width
  const chromaRow = (y >> 1) * chromaWidth
  const evenWidth = width & ~1
  for (let x = 0; x < evenWidth; x += 2) {
    const topSource = topOffset + x * 3
    const red0 = top[topSource] ?? 0
    const green0 = top[topSource + 1] ?? 0
    const blue0 = top[topSource + 2] ?? 0
    const red1 = top[topSource + 3] ?? 0
    const green1 = top[topSource + 4] ?? 0
    const blue1 = top[topSource + 5] ?? 0
    const y00 = clampChannel(((66 * red0 + 129 * green0 + 25 * blue0 + 128) >> 8) + 16)
    const y01 = clampChannel(((66 * red1 + 129 * green1 + 25 * blue1 + 128) >> 8) + 16)
    yPlane[yRow + x] = y00
    yPlane[yRow + x + 1] = y01
    const u00 = clampChannel(((-38 * red0 - 74 * green0 + 112 * blue0 + 128) >> 8) + 128)
    const u01 = clampChannel(((-38 * red1 - 74 * green1 + 112 * blue1 + 128) >> 8) + 128)
    const v00 = clampChannel(((112 * red0 - 94 * green0 - 18 * blue0 + 128) >> 8) + 128)
    const v01 = clampChannel(((112 * red1 - 94 * green1 - 18 * blue1 + 128) >> 8) + 128)
    if (bottom) {
      const bottomSource = bottomOffset + x * 3
      const red2 = bottom[bottomSource] ?? 0
      const green2 = bottom[bottomSource + 1] ?? 0
      const blue2 = bottom[bottomSource + 2] ?? 0
      const red3 = bottom[bottomSource + 3] ?? 0
      const green3 = bottom[bottomSource + 4] ?? 0
      const blue3 = bottom[bottomSource + 5] ?? 0
      yPlane[lowerRow + x] = clampChannel(((66 * red2 + 129 * green2 + 25 * blue2 + 128) >> 8) + 16)
      yPlane[lowerRow + x + 1] = clampChannel(
        ((66 * red3 + 129 * green3 + 25 * blue3 + 128) >> 8) + 16,
      )
      const u =
        u00 +
        u01 +
        clampChannel(((-38 * red2 - 74 * green2 + 112 * blue2 + 128) >> 8) + 128) +
        clampChannel(((-38 * red3 - 74 * green3 + 112 * blue3 + 128) >> 8) + 128)
      const v =
        v00 +
        v01 +
        clampChannel(((112 * red2 - 94 * green2 - 18 * blue2 + 128) >> 8) + 128) +
        clampChannel(((112 * red3 - 94 * green3 - 18 * blue3 + 128) >> 8) + 128)
      uPlane[chromaRow + (x >> 1)] = (u + 2) >> 2
      vPlane[chromaRow + (x >> 1)] = (v + 2) >> 2
    } else {
      uPlane[chromaRow + (x >> 1)] = (u00 + u01 + 1) >> 1
      vPlane[chromaRow + (x >> 1)] = (v00 + v01 + 1) >> 1
    }
  }
  if (evenWidth < width) {
    const topSource = topOffset + evenWidth * 3
    const red0 = top[topSource] ?? 0
    const green0 = top[topSource + 1] ?? 0
    const blue0 = top[topSource + 2] ?? 0
    yPlane[yRow + evenWidth] = clampChannel(
      ((66 * red0 + 129 * green0 + 25 * blue0 + 128) >> 8) + 16,
    )
    const u0 = clampChannel(((-38 * red0 - 74 * green0 + 112 * blue0 + 128) >> 8) + 128)
    const v0 = clampChannel(((112 * red0 - 94 * green0 - 18 * blue0 + 128) >> 8) + 128)
    if (bottom) {
      const bottomSource = bottomOffset + evenWidth * 3
      const red1 = bottom[bottomSource] ?? 0
      const green1 = bottom[bottomSource + 1] ?? 0
      const blue1 = bottom[bottomSource + 2] ?? 0
      yPlane[lowerRow + evenWidth] = clampChannel(
        ((66 * red1 + 129 * green1 + 25 * blue1 + 128) >> 8) + 16,
      )
      uPlane[chromaRow + (evenWidth >> 1)] =
        (u0 + clampChannel(((-38 * red1 - 74 * green1 + 112 * blue1 + 128) >> 8) + 128) + 1) >> 1
      vPlane[chromaRow + (evenWidth >> 1)] =
        (v0 + clampChannel(((112 * red1 - 94 * green1 - 18 * blue1 + 128) >> 8) + 128) + 1) >> 1
    } else {
      uPlane[chromaRow + (evenWidth >> 1)] = u0
      vPlane[chromaRow + (evenWidth >> 1)] = v0
    }
  }
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
  readonly #metadata: Readonly<PreservedMetadata> | undefined
  readonly #y: Uint8Array
  readonly #u: Uint8Array
  readonly #v: Uint8Array
  readonly #uAcc: Uint16Array | undefined
  readonly #vAcc: Uint16Array | undefined
  readonly #pendingRgb: Uint8Array | undefined
  readonly #alpha: Uint8Array | undefined
  #hasPendingRgb = false
  #hasAlpha = false
  #expectedY = 0
  #finished = false

  constructor(
    sink: ImageSink,
    width: number,
    height: number,
    format: PixelFormat,
    quality: number,
    metadata: Readonly<PreservedMetadata> | undefined,
  ) {
    this.#sink = sink
    this.#width = width
    this.#height = height
    this.#format = format
    this.#channels = channels(format)
    if (this.#channels === 0) throw invalidInput(`WebP encoder does not support ${format} pixels`)
    this.#quality = quality
    this.#metadata = metadata
    this.#y = new Uint8Array(width * height)
    const chromaPixels = Math.ceil(width / 2) * Math.ceil(height / 2)
    this.#u = new Uint8Array(chromaPixels)
    this.#v = new Uint8Array(chromaPixels)
    this.#uAcc = this.#channels === 3 ? undefined : new Uint16Array(chromaPixels)
    this.#vAcc = this.#channels === 3 ? undefined : new Uint16Array(chromaPixels)
    this.#pendingRgb = this.#channels === 3 ? new Uint8Array(width * 3) : undefined
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
    if (this.#channels === 3) {
      const data = block.data
      const width = this.#width
      const yPlane = this.#y
      const uPlane = this.#u
      const vPlane = this.#v
      const pending = this.#pendingRgb
      let row = 0
      if (this.#hasPendingRgb && pending) {
        writeRgb8Pair(pending, 0, data, 0, width, this.#expectedY - 1, yPlane, uPlane, vPlane)
        this.#hasPendingRgb = false
        row = 1
      }
      while (row + 1 < block.height) {
        writeRgb8Pair(
          data,
          row * block.stride,
          data,
          (row + 1) * block.stride,
          width,
          this.#expectedY + row,
          yPlane,
          uPlane,
          vPlane,
        )
        row += 2
      }
      if (row < block.height && pending) {
        pending.set(data.subarray(row * block.stride, row * block.stride + width * 3))
        this.#hasPendingRgb = true
      }
    } else {
      const uAcc = this.#uAcc
      const vAcc = this.#vAcc
      if (!uAcc || !vAcc) throw invalidInput('WebP encoder is missing chroma accumulators')
      for (let row = 0; row < block.height; row += 1) {
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
          uAcc[chroma] =
            (uAcc[chroma] ?? 0) +
            clampByte(((-38 * red - 74 * green + 112 * blue + 128) >> 8) + 128)
          vAcc[chroma] =
            (vAcc[chroma] ?? 0) + clampByte(((112 * red - 94 * green - 18 * blue + 128) >> 8) + 128)
          if (this.#alpha) {
            const alpha = block.data[source + 3] ?? 0
            this.#alpha[y * this.#width + x] = alpha
            this.#hasAlpha ||= alpha !== 255
          }
        }
      }
    }
    this.#expectedY += block.height
  }

  async finish(): Promise<void> {
    if (this.#finished || this.#expectedY !== this.#height)
      throw invalidInput('WebP encoder received incomplete pixels')
    this.#finished = true
    if (this.#hasPendingRgb && this.#pendingRgb) {
      writeRgb8Pair(
        this.#pendingRgb,
        0,
        undefined,
        0,
        this.#width,
        this.#height - 1,
        this.#y,
        this.#u,
        this.#v,
      )
      this.#hasPendingRgb = false
    }
    const uAcc = this.#uAcc
    const vAcc = this.#vAcc
    const chromaWidth = Math.ceil(this.#width / 2)
    const chromaHeight = Math.ceil(this.#height / 2)
    const u =
      uAcc === undefined
        ? this.#u
        : finalizeChroma(uAcc, this.#width, this.#height, chromaWidth, chromaHeight)
    const v =
      vAcc === undefined
        ? this.#v
        : finalizeChroma(vAcc, this.#width, this.#height, chromaWidth, chromaHeight)
    const vp8 = encodeVp8(this.#width, this.#height, this.#y, u, v, this.#quality)
    const alpha = this.#hasAlpha ? this.#alpha : undefined
    const icc = this.#metadata?.icc
    const exif = this.#metadata?.exif
    if (icc && iccColorSpace(icc) !== 'rgb')
      throw invalidInput('Preserved ICC profile does not match WebP RGB output pixels')
    const extended = alpha !== undefined || icc !== undefined || exif !== undefined
    const vp8Padding = vp8.length & 1
    const alphaLength = alpha ? 1 + alpha.length : 0
    const alphaPadding = alphaLength & 1
    const iccBytes = icc ? 8 + icc.byteLength + (icc.byteLength & 1) : 0
    const exifBytes = exif ? 8 + exif.byteLength + (exif.byteLength & 1) : 0
    const bodyLength = extended
      ? 4 +
        18 +
        iccBytes +
        (alpha ? 8 + alphaLength + alphaPadding : 0) +
        8 +
        vp8.length +
        vp8Padding +
        exifBytes
      : 4 + 8 + vp8.length + vp8Padding
    const output = new Uint8Array(8 + bodyLength)
    output.set([82, 73, 70, 70], 0)
    uint32(output, 4, bodyLength)
    output.set([87, 69, 66, 80], 8)
    let offset = 12
    if (extended) {
      output.set([86, 80, 56, 88], offset)
      uint32(output, offset + 4, 10)
      output[offset + 8] = (icc ? 0x20 : 0) | (alpha ? 0x10 : 0) | (exif ? 0x08 : 0)
      uint24(output, offset + 12, this.#width - 1)
      uint24(output, offset + 15, this.#height - 1)
      offset += 18
      if (icc) {
        output.set([73, 67, 67, 80], offset)
        uint32(output, offset + 4, icc.byteLength)
        output.set(icc, offset + 8)
        offset += iccBytes
      }
      if (alpha) {
        output.set([65, 76, 80, 72], offset)
        uint32(output, offset + 4, alphaLength)
        output[offset + 8] = 0
        output.set(alpha, offset + 9)
        offset += 8 + alphaLength + alphaPadding
      }
    }
    output.set([86, 80, 56, 32], offset)
    uint32(output, offset + 4, vp8.length)
    output.set(vp8, offset + 8)
    offset += 8 + vp8.length + vp8Padding
    if (exif) {
      output.set([69, 88, 73, 70], offset)
      uint32(output, offset + 4, exif.byteLength)
      output.set(exif, offset + 8)
    }
    await this.#sink.write(output)
  }

  async abort(): Promise<void> {
    this.#finished = true
  }
}
