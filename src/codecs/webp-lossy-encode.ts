import type { ImageEncoder, PreservedMetadata } from '../codec.ts'
import { invalidInput } from '../errors.ts'
import { iccColorSpace } from '../metadata.ts'
import type { PixelBlock, PixelFormat } from '../pixel.ts'
import type { ImageSink } from '../sink.ts'
import { addInverseVp8Block, vp8AcQuantizers, vp8DcQuantizers } from './vp8.ts'
import {
  coefficientUpdateProbabilities,
  defaultCoefficientProbabilities,
  keyframeBlockModeProbabilities,
} from './vp8-tables.ts'
import type { WebpKernel } from './webp-acceleration.ts'

const blockPrediction = 4
const macroToSubMode = Uint8Array.of(0, 2, 3, 1) // DC, vertical, horizontal, true motion
const maxPredictionPartitionLength = (1 << 19) - 1

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

  get byteLength(): number {
    return this.#length
  }

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
  let coefficient = type === 0 ? 1 : 0
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
  const stride = width + 6
  return { data: new Uint8Array((height + 2) * stride), stride, origin: stride + 1 }
}

// Extend only the edge macroblocks. Aligned interior rows use the source
// directly; the final row (or an unaligned width) fits in a single band.
const padBand = (
  source: Uint8Array,
  width: number,
  height: number,
  y: number,
  stride: number,
  size: number,
  scratch: Uint8Array,
): Uint8Array => {
  if (width === stride && y + size <= height) return source
  for (let i = 0; i < size; i++) {
    const start = Math.min(height - 1, y + i) * width
    scratch.set(source.subarray(start, start + width), i * stride)
    scratch.fill(source[start + width - 1] ?? 0, i * stride + width, (i + 1) * stride)
  }
  return scratch
}

const finalizeChroma = (
  source: Uint16Array,
  width: number,
  height: number,
  chromaWidth: number,
  chromaHeight: number,
): Uint8Array => {
  const bytes = new Uint8Array(source.buffer, source.byteOffset, chromaWidth * chromaHeight)
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

const squareDc = (
  plane: ReconstructionPlane,
  offset: number,
  row: number,
  column: number,
  size: number,
): number => {
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
    : (total + (row > 0 && column > 0 ? size : size >> 1)) >>
        ((size === 8 ? 3 : 4) + Number(row > 0 && column > 0))
}

// RFC 6386 sections 11 and 12. The bit strings are paths through the
// keyframe mode trees. Costs are measured in bits at the same probabilities.
const squarePaths = ['0', '10', '110', '111']
const bitCost = (bit: number, probability: number): number =>
  -Math.log2((bit === 0 ? probability : 256 - probability) / 256)

const squareModeCost = Float64Array.from(squarePaths, (path) => {
  let bits = 0
  for (let i = 0; i < path.length; i++)
    bits += bitCost(Number(path[i]), uvModeProbabilities[i] ?? 128)
  return bits
})

const chromaZero = bitCost(0, defaultCoefficientProbabilities[probabilityOffset(2, 0, 0)] ?? 128)
const chromaNonzero = bitCost(1, defaultCoefficientProbabilities[probabilityOffset(2, 0, 0)] ?? 128)
// Four samples from one 4x4 chroma block have a signed sum in
// [-1020, 1020]. The DC reconstruction and its estimated rate depend
// only on that sum and the frame quantizer.
const chromaDcCosts = (step: number): Float64Array => {
  const costs = new Float64Array(2041)
  const lambda = (step * step) / 96
  for (let sum = -1020; sum <= 1020; sum++) {
    const level = Math.round((2 * Math.abs(sum)) / step) * Math.sign(sum)
    const reconstructed = (level * step + 4) >> 3
    const bits = level === 0 ? chromaZero : chromaNonzero + 1 + Math.log2(Math.abs(level))
    costs[sum + 1020] = 4 * reconstructed * reconstructed - 2 * sum * reconstructed + lambda * bits
  }
  return costs
}

const scoreChromaModes = (
  scores: Float64Array,
  source: Uint8Array,
  start: number,
  width: number,
  plane: ReconstructionPlane,
  out: number,
  costs: Float64Array,
  dc: number,
): void => {
  const top = out - plane.stride
  const corner = plane.data[top - 1] ?? 0
  for (let mode = 0; mode < 4; mode++) {
    let score = scores[mode] ?? 0
    for (let by = 0; by < 8; by += 4)
      for (let bx = 0; bx < 8; bx += 4) {
        let sum = 0
        let square = 0
        for (let y = by; y < by + 4; y += 2) {
          const left = plane.data[out + y * plane.stride - 1] ?? 0
          for (let x = bx; x < bx + 4; x += 2) {
            const above = plane.data[top + x] ?? 0
            const pred =
              mode === 0
                ? dc
                : mode === 1
                  ? above
                  : mode === 2
                    ? left
                    : clampByte(above + left - corner)
            const delta = (source[start + y * width + x] ?? 0) - pred
            sum += delta
            square += delta * delta
          }
        }
        score += square + (costs[sum + 1020] ?? 0)
      }
    scores[mode] = score
  }
}

const predictSquareInto = (
  plane: ReconstructionPlane,
  offset: number,
  size: number,
  mode: number,
  dc: number,
): void => {
  const data = plane.data
  const top = offset - plane.stride
  const corner = data[top - 1] ?? 0
  for (let y = 0; y < size; y++) {
    const row = offset + y * plane.stride
    const left = data[row - 1] ?? 0
    if (mode === 0 || mode === 2) data.fill(mode === 0 ? dc : left, row, row + size)
    else if (mode === 1) data.copyWithin(row, top, top + size)
    else
      for (let x = 0; x < size; x++) data[row + x] = clampByte(left + (data[top + x] ?? 0) - corner)
  }
}

const residual4 = (
  source: Uint8Array,
  start: number,
  width: number,
  plane: ReconstructionPlane,
  output: number,
  residual: Int16Array,
): number => {
  let nonzero = 0
  for (let y = 0; y < 4; y++) {
    const src = start + y * width
    const dst = output + y * plane.stride
    for (let x = 0; x < 4; x++) {
      const value = (source[src + x] ?? 0) - (plane.data[dst + x] ?? 0)
      residual[y * 4 + x] = value
      nonzero |= value
    }
  }
  return nonzero
}

// Transform the 16 luma DC coefficients by rows and columns. Scale the
// two-pass forward result by 1/2 and the inverse by 1/8 (RFC 6386, 14.3).
const walsh4x4 = (
  input: Int32Array,
  work: Int32Array,
  result: Int32Array,
  inverse: boolean,
): void => {
  for (let i = 0; i < 4; i++) {
    const a = (input[i] ?? 0) + (input[i + 12] ?? 0)
    const b = (input[i + 4] ?? 0) + (input[i + 8] ?? 0)
    const c = (input[i + 4] ?? 0) - (input[i + 8] ?? 0)
    const d = (input[i] ?? 0) - (input[i + 12] ?? 0)
    work[i] = a + b
    work[i + 4] = d + c
    work[i + 8] = a - b
    work[i + 12] = d - c
  }
  const bias = inverse ? 3 : 1
  const shift = inverse ? 3 : 1
  for (let i = 0; i < 16; i += 4) {
    const a = (work[i] ?? 0) + (work[i + 3] ?? 0)
    const b = (work[i + 1] ?? 0) + (work[i + 2] ?? 0)
    const c = (work[i + 1] ?? 0) - (work[i + 2] ?? 0)
    const d = (work[i] ?? 0) - (work[i + 3] ?? 0)
    result[i] = (a + b + bias) >> shift
    result[i + 1] = (d + c + bias) >> shift
    result[i + 2] = (a - b + bias) >> shift
    result[i + 3] = (d - c + bias) >> shift
  }
}

const lumaModeCost = Float64Array.from([0, 1, 2, 3, 4], (mode) =>
  mode === 4
    ? bitCost(0, 145)
    : bitCost(1, 145) + bitCost(mode >> 1, 156) + bitCost(mode & 1, mode < 2 ? 163 : 128),
)

// Estimate residual rate from the default EOB probabilities at the first
// coefficient of each block type. The predictor error and one sample per
// 4x4 block let us compare partitions before transforming the winner.
const firstTokenCost = (type: number, nonzero: number): number =>
  bitCost(
    nonzero,
    defaultCoefficientProbabilities[probabilityOffset(type, type === 0 ? 1 : 0, 0)] ?? 128,
  )

const macroZeroCost = firstTokenCost(0, 0)
const macroNonzeroCost = firstTokenCost(0, 1)

const subblockZeroCost = firstTokenCost(3, 0)
const subblockNonzeroCost = firstTokenCost(3, 1)

const subblockPartitionBits =
  (lumaModeCost[4] ?? 0) + 16 * bitCost(0, keyframeBlockModeProbabilities[0] ?? 128)

const chooseLumaMode = (
  src: Uint8Array,
  start: number,
  width: number,
  plane: ReconstructionPlane,
  out: number,
  dc: number,
  ac: number,
  scores: Float64Array,
): number => {
  const lambda = (ac * ac) / 64
  for (let mode = 0; mode < 4; mode++) scores[mode] = (lumaModeCost[mode] ?? 0) * lambda
  let small = subblockPartitionBits * lambda
  const top = out - plane.stride
  const corner = plane.data[top - 1] ?? 0

  const threshold = (ac / 8) ** 2
  for (let y = 0; y < 16; y += 4) {
    const left = plane.data[out + (y + 1) * plane.stride - 1] ?? 0
    for (let x = 0; x < 16; x += 4) {
      const above = plane.data[top + x + 1] ?? 0
      const p = start + (y + 1) * width + x + 1
      const value = src[p] ?? 0
      const d0 = (value - dc) ** 2
      const d1 = (value - above) ** 2
      const d2 = (value - left) ** 2
      const d3 = (value - clampByte(above + left - corner)) ** 2
      scores[0] =
        (scores[0] ?? 0) + d0 + lambda * (d0 > threshold ? macroNonzeroCost : macroZeroCost)
      scores[1] =
        (scores[1] ?? 0) + d1 + lambda * (d1 > threshold ? macroNonzeroCost : macroZeroCost)
      scores[2] =
        (scores[2] ?? 0) + d2 + lambda * (d2 > threshold ? macroNonzeroCost : macroZeroCost)
      scores[3] =
        (scores[3] ?? 0) + d3 + lambda * (d3 > threshold ? macroNonzeroCost : macroZeroCost)
      const localTop = y === 0 ? above : (src[start + (y - 1) * width + x + 1] ?? 0)
      const localLeft = x === 0 ? left : (src[p - 2] ?? 0)
      const err = (value - ((localTop + localLeft + 1) >> 1)) ** 2
      small += err + lambda * (err > threshold ? subblockNonzeroCost : subblockZeroCost)
    }
  }
  // Reserve the 16x16 partition for smooth prediction. Textured blocks
  // pay a larger token cost when their DC values move into Y2.
  let winner = blockPrediction
  let best = Math.min(small, 16 * (ac / 5) ** 2)
  for (let mode = 0; mode < 4; mode++)
    if ((scores[mode] ?? 0) < best) {
      best = scores[mode] ?? 0
      winner = mode
    }
  return winner
}

// Nodes and leaves of the RFC 6386 keyframe subblock tree (section 11.2).
const subTree = Int8Array.of(0, 2, -1, 4, -2, 6, 8, 12, -3, 10, -5, -6, -4, 14, -7, 16, -8, -9)
const subBits = new Uint8Array(10)
const subLengths = new Uint8Array(10)
const subCosts = new Float64Array(1000)
const initSubTree = (node: number, bits: number, length: number): void => {
  for (let bit = 0; bit <= 1; bit++) {
    const child = subTree[node + bit] ?? 0
    const code = (bits << 1) | bit
    if (child > 0) initSubTree(child, code, length + 1)
    else {
      const mode = -child
      subBits[mode] = code
      subLengths[mode] = length + 1
      for (let context = 0; context < 100; context++) {
        let cost = 0
        let index = 0
        for (let shift = length; shift >= 0; shift--) {
          const branch = (code >> shift) & 1
          cost += bitCost(branch, keyframeBlockModeProbabilities[context * 9 + (index >> 1)] ?? 128)
          index = subTree[index + branch] ?? 0
        }
        subCosts[context * 10 + mode] = cost
      }
    }
  }
}
initSubTree(0, 0, 0)

const writeSubMode = (header: BooleanEncoder, context: number, mode: number): void => {
  const code = subBits[mode] ?? 0
  let node = 0
  for (let shift = (subLengths[mode] ?? 0) - 1; shift >= 0; shift--) {
    const bit = (code >> shift) & 1
    header.bit(bit, keyframeBlockModeProbabilities[context * 9 + (node >> 1)])
    node = subTree[node + bit] ?? 0
  }
}

// Boundary coordinates run from L (0) through the corner (4) to H (12).
// Slots 0..12 hold weighted three-tap averages. Slots 13..25 hold adjacent
// pair averages and slot 26 repeats the bottom left sample.
const directionalSamples = new Uint8Array(8 * 16)
for (let y = 0; y < 4; y++)
  for (let x = 0; x < 4; x++) {
    const p = y * 4 + x
    directionalSamples[p] = 5 + x // VE
    directionalSamples[16 + p] = 3 - y // HE
    directionalSamples[32 + p] = Math.min(12, 6 + x + y) // LD
    directionalSamples[48 + p] = 4 + x - y // RD
    const vr = 2 * x - y
    directionalSamples[64 + p] =
      vr < 0 ? 4 + vr + 1 : vr % 2 === 0 ? 13 + 4 + (vr >> 1) : 5 + (vr >> 1)
    const vl = 2 * x + y
    directionalSamples[80 + p] =
      vl >= 8 ? 6 + (vl - 8) + 4 : vl % 2 === 0 ? 13 + 5 + (vl >> 1) : 6 + (vl >> 1)
    const hd = 2 * y - x
    directionalSamples[96 + p] =
      hd < 0 ? 4 - hd - 1 : hd % 2 === 0 ? 13 + 3 - (hd >> 1) : 3 - (hd >> 1)
    const hu = 2 * y + x
    directionalSamples[112 + p] = hu >= 6 ? 26 : hu % 2 === 0 ? 13 + 2 - (hu >> 1) : 2 - (hu >> 1)
  }

// Estimates in the coefficient domain. Each slot includes the zero/nonzero
// decision, the small-magnitude token and its sign, under the default context.
const tokenCosts = new Float32Array(16 * 3 * 32)
const endCosts = new Float32Array(16 * 3)
const continueCosts = new Float32Array(16 * 3)
for (let i = 0; i < 16; i++)
  for (let c = 0; c < 3; c++) {
    const key = i * 3 + c
    const offset = probabilityOffset(3, i, c)
    const prob = defaultCoefficientProbabilities
    endCosts[key] = bitCost(0, prob[offset] ?? 128)
    continueCosts[key] = bitCost(1, prob[offset] ?? 128)
    for (let m = 0; m < 32; m++) {
      let cost = bitCost(Number(m !== 0), prob[offset + 1] ?? 128)
      if (m) {
        cost += 1 + bitCost(Number(m !== 1), prob[offset + 2] ?? 128)
        if (m > 1) {
          cost += bitCost(Number(m > 4), prob[offset + 3] ?? 128)
          if (m <= 4) {
            cost += bitCost(Number(m !== 2), prob[offset + 4] ?? 128)
            if (m > 2) cost += bitCost(Number(m === 4), prob[offset + 5] ?? 128)
          } else cost += 2 + Math.log2(m)
        }
      }
      tokenCosts[key * 32 + m] = cost
    }
  }

const scoreQuantized = (
  dct: Int32Array,
  dc: number,
  ac: number,
  lambda: number,
  modeCost: number,
): number => {
  let distortion = 0
  let bits = modeCost
  let context = 0
  let last = 0
  let pending = 0
  let lastContext = 0
  for (let i = 0; i < 16; i++) {
    const value = Math.abs(dct[zigzag[i] ?? 0] ?? 0)
    const step = i === 0 ? dc : ac
    const m = Math.round(value / step)
    const error = value - m * step
    distortion += error * error
    const key = i * 3 + context
    if (i === last) pending += continueCosts[key] ?? 0
    pending += tokenCosts[key * 32 + Math.min(31, m)] ?? 0
    context = m === 0 ? 0 : m === 1 ? 1 : 2
    if (m) {
      bits += pending
      pending = 0
      last = i + 1
      lastContext = context
    }
  }
  // A trailing zero run is represented by a single EOB.
  if (last < 16) bits += endCosts[last * 3 + lastContext] ?? 0
  return distortion + lambda * bits
}

const flatSubModes = Uint8Array.from({ length: 100 }, (_, context) => {
  let best = 0
  for (let i = 1; i < 10; i++)
    if ((subCosts[context * 10 + i] ?? 0) < (subCosts[context * 10 + best] ?? 0)) best = i
  return best
})

const squared = (x: number): number => x * x

const nominateSubMode = (
  src: Uint8Array,
  start: number,
  width: number,
  dc: number,
  context: number,
  scratch: MacroblockScratch,
): number => {
  const { edges, averages, yAc } = scratch
  const a = src[start] ?? 0
  const b = src[start + 2] ?? 0
  const c = src[start + 2 * width] ?? 0
  const d = src[start + width * 2 + 2] ?? 0
  const offset = context * 10
  const lambda = (yAc * yAc) / 32
  let winner = 0
  let best =
    squared(a - dc) +
    squared(b - dc) +
    squared(c - dc) +
    squared(d - dc) +
    lambda * (subCosts[offset] ?? 0)
  const corner = edges[4] ?? 0
  const x0 = (edges[5] ?? 0) - corner
  const x2 = (edges[7] ?? 0) - corner
  const l0 = edges[3] ?? 0
  const l2 = edges[1] ?? 0
  const tm =
    squared(a - clampByte(l0 + x0)) +
    squared(b - clampByte(l0 + x2)) +
    squared(c - clampByte(l2 + x0)) +
    squared(d - clampByte(l2 + x2)) +
    lambda * (subCosts[offset + 1] ?? 0)
  if (tm < best) {
    best = tm
    winner = 1
  }
  for (let mode = 2; mode < 10; mode++) {
    const i = (mode - 2) * 16
    const score =
      squared(a - (averages[directionalSamples[i] ?? 0] ?? 0)) +
      squared(b - (averages[directionalSamples[i + 2] ?? 0] ?? 0)) +
      squared(c - (averages[directionalSamples[i + 8] ?? 0] ?? 0)) +
      squared(d - (averages[directionalSamples[i + 10] ?? 0] ?? 0)) +
      lambda * (subCosts[offset + mode] ?? 0)
    if (score < best) {
      best = score
      winner = mode
    }
  }
  return winner
}

const chooseSubMode = (
  plane: ReconstructionPlane,
  out: number,
  src: Uint8Array,
  start: number,
  width: number,
  context: number,
  scratch: MacroblockScratch,
): number => {
  const { edges, averages, residual, dctTemporary, transformed, bestDct, yDc, yAc } = scratch
  const data = plane.data
  const stride = plane.stride
  const top = out - stride
  for (let i = 0; i < 4; i++) edges[3 - i] = data[out + i * stride - 1] ?? 0
  for (let i = 0; i < 9; i++) edges[4 + i] = data[top + i - 1] ?? 0
  const dc = predictDc4(plane, out)
  let flat = true
  for (let i = 0; i < 13; i++)
    if (edges[i] !== dc) {
      flat = false
      break
    }
  let mode = 0
  if (!flat) {
    for (let i = 0; i < 13; i++) {
      const a = edges[Math.max(0, i - 1)] ?? 0
      const b = edges[i] ?? 0
      const c = edges[Math.min(i + 1, 12)] ?? 0
      averages[i] = (a + 2 * b + c + 2) >> 2
      averages[13 + i] = (b + c + 1) >> 1
    }
    averages[26] = edges[0] ?? 0
    mode = nominateSubMode(src, start, width, dc, context, scratch)
  }
  // The DC alternative never reads the predicted plane. Only overwrite the
  // directional predictor if the coded DC residual actually wins.
  for (let y = 0; y < 4; y++)
    for (let x = 0; x < 4; x++) residual[y * 4 + x] = (src[start + y * width + x] ?? 0) - dc
  forwardDct(residual, dctTemporary, mode === 0 ? bestDct : transformed)
  if (mode !== 0) {
    const dcScore = scoreQuantized(
      transformed,
      yDc,
      yAc,
      yAc * yAc * 0.12,
      subCosts[context * 10] ?? 0,
    )
    for (let y = 0; y < 4; y++)
      for (let x = 0; x < 4; x++) {
        const k = y * 4 + x
        const pred =
          mode === 1
            ? clampByte((edges[3 - y] ?? 0) + (edges[5 + x] ?? 0) - (edges[4] ?? 0))
            : (averages[directionalSamples[(mode - 2) * 16 + k] ?? 0] ?? 0)
        data[out + y * stride + x] = pred
        residual[k] = (src[start + y * width + x] ?? 0) - pred
      }
    forwardDct(residual, dctTemporary, bestDct)
    const directionalScore = scoreQuantized(
      bestDct,
      yDc,
      yAc,
      yAc * yAc * 0.12,
      subCosts[context * 10 + mode] ?? 0,
    )
    if (directionalScore <= dcScore) return mode
    bestDct.set(transformed)
  }
  for (let y = 0; y < 4; y++) data.fill(dc, out + y * stride, out + y * stride + 4)
  return flat ? (flatSubModes[context] ?? 0) : 0
}

const createMacroblockScratch = (yDc: number, yAc: number) => ({
  yDc,
  yAc,
  uvDc: Math.min(132, yDc),
  uvAc: yAc,
  y2Dc: yDc * 2,
  y2Ac: Math.max(8, Math.floor((yAc * 155) / 100)),
  coefficients: new Int32Array(25 * 16),
  residual: new Int16Array(16),
  dctTemporary: new Int32Array(16),
  transformed: new Int32Array(16),
  reconstructed: new Int32Array(16),
  bestDct: new Int32Array(16),
  dcBlock: new Int32Array(16),
  coded: new Uint8Array(16),
  scores: new Float64Array(4),
  edges: new Uint8Array(13),
  averages: new Uint8Array(27),
})
type MacroblockScratch = ReturnType<typeof createMacroblockScratch>

const encodeLuma16 = (
  yPadded: Uint8Array,
  yStart: number,
  paddedYWidth: number,
  yPlane: ReconstructionPlane,
  yOffset: number,
  yMode: number,
  yPredictDc: number,
  scratch: MacroblockScratch,
): void => {
  const {
    yDc,
    yAc,
    y2Dc,
    y2Ac,
    coefficients,
    residual,
    dctTemporary,
    transformed,
    reconstructed,
    dcBlock,
    coded,
  } = scratch
  predictSquareInto(yPlane, yOffset, 16, yMode, yPredictDc)
  for (let block = 0; block < 16; block++) {
    const dx = (block & 3) * 4
    const dy = (block >> 2) * 4
    if (
      !residual4(
        yPadded,
        yStart + dy * paddedYWidth + dx,
        paddedYWidth,
        yPlane,
        yOffset + dy * yPlane.stride + dx,
        residual,
      )
    ) {
      dcBlock[block] = 0
      coefficients.fill(0, block * 16, block * 16 + 16)
      coded[block] = 0
      continue
    }
    coded[block] = 1
    forwardDct(residual, dctTemporary, transformed)
    dcBlock[block] = transformed[0] ?? 0
    quantize(transformed, yDc, yAc, coefficients, block * 16)
  }
  walsh4x4(dcBlock, dctTemporary, transformed, false)
  quantize(transformed, y2Dc, y2Ac, coefficients, 384)
  reconstructCoefficients(coefficients, 384, y2Dc, y2Ac, transformed)
  walsh4x4(transformed, dctTemporary, dcBlock, true)
  for (let block = 0; block < 16; block++) {
    if (coded[block] === 0 && dcBlock[block] === 0) continue
    reconstructCoefficients(coefficients, block * 16, yDc, yAc, reconstructed)
    reconstructed[0] = dcBlock[block] ?? 0
    addInverseVp8Block(
      yPlane.data,
      yPlane.stride,
      yOffset + (block >> 2) * 4 * yPlane.stride + (block & 3) * 4,
      reconstructed,
      dctTemporary,
    )
  }
}

const encodeLuma4 = (
  header: BooleanEncoder,
  yPadded: Uint8Array,
  yStart: number,
  paddedYWidth: number,
  yPlane: ReconstructionPlane,
  yOffset: number,
  firstRow: boolean,
  rightEdge: boolean,
  column: number,
  aboveModes: Uint8Array,
  leftModes: Uint8Array,
  scratch: MacroblockScratch,
): void => {
  const { yDc, yAc, coefficients, dctTemporary, reconstructed, bestDct } = scratch
  // Rightmost subblocks in every subblock row use the same four
  // above-right samples from the macroblock above (section 12.3).
  const aboveRight = yOffset - yPlane.stride + 16
  if (rightEdge || firstRow)
    yPlane.data.fill(
      firstRow ? 127 : (yPlane.data[aboveRight - 1] ?? 0),
      aboveRight,
      aboveRight + 4,
    )
  for (let y = 3; y < 12; y += 4)
    yPlane.data.copyWithin(yOffset + y * yPlane.stride + 16, aboveRight, aboveRight + 4)
  for (let block = 0; block < 16; block += 1) {
    const blockX = (block & 3) * 4
    const blockY = (block >> 2) * 4
    const output = yOffset + (block >> 2) * 4 * yPlane.stride + (block & 3) * 4
    const sampleRow = yStart + blockY * paddedYWidth + blockX
    const ai = column * 4 + (block & 3)
    const li = block >> 2
    const context = (aboveModes[ai] ?? 0) * 10 + (leftModes[li] ?? 0)
    const mode = chooseSubMode(yPlane, output, yPadded, sampleRow, paddedYWidth, context, scratch)
    writeSubMode(header, context, mode)
    aboveModes[ai] = mode
    leftModes[li] = mode
    const coefficientOffset = block * 16
    quantize(bestDct, yDc, yAc, coefficients, coefficientOffset)
    reconstructCoefficients(coefficients, coefficientOffset, yDc, yAc, reconstructed)
    addInverseVp8Block(yPlane.data, yPlane.stride, output, reconstructed, dctTemporary)
  }
}

const encodeChroma = (
  chromaSource: Uint8Array,
  start: number,
  paddedCWidth: number,
  plane: ReconstructionPlane,
  output: number,
  uvMode: number,
  dc: number,
  base: number,
  scratch: MacroblockScratch,
): void => {
  const { uvDc, uvAc, residual, dctTemporary, transformed, coefficients, reconstructed } = scratch
  predictSquareInto(plane, output, 8, uvMode, dc)
  for (let block = 0; block < 4; block += 1) {
    const blockX = (block & 1) * 4
    const blockY = (block >> 1) * 4
    const sampleRow = start + blockY * paddedCWidth + blockX
    const coefficientOffset = base + block * 16
    if (
      !residual4(
        chromaSource,
        sampleRow,
        paddedCWidth,
        plane,
        output + (block >> 1) * 4 * plane.stride + (block & 1) * 4,
        residual,
      )
    ) {
      coefficients.fill(0, coefficientOffset, coefficientOffset + 16)
      continue
    }
    forwardDct(residual, dctTemporary, transformed)
    quantize(transformed, uvDc, uvAc, coefficients, coefficientOffset)
    reconstructCoefficients(coefficients, coefficientOffset, uvDc, uvAc, reconstructed)
    addInverseVp8Block(
      plane.data,
      plane.stride,
      output + (block >> 1) * 4 * plane.stride + (block & 1) * 4,
      reconstructed,
      dctTemporary,
    )
  }
}

const writeTokens = (
  tokens: BooleanEncoder,
  yMode: number,
  coefficients: Int32Array,
  left: Int8Array,
  aboveContext: Int8Array,
): void => {
  const probabilities = defaultCoefficientProbabilities
  if (yMode !== blockPrediction) {
    const nonzero = writeCoefficientBlock(
      tokens,
      probabilities,
      coefficients,
      384,
      1,
      (left[8] ?? 0) + (aboveContext[8] ?? 0),
    )
    left[8] = aboveContext[8] = Number(nonzero)
  }
  for (let block = 0; block < 24; block += 1) {
    const type = block < 16 ? (yMode === blockPrediction ? 3 : 0) : 2
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
  const tokens = new BooleanEncoder()
  const aboveModes = new Uint8Array(columns * 4)
  const leftModes = new Uint8Array(4)
  const scratch = createMacroblockScratch(yDc, yAc)
  const uvCosts = chromaDcCosts(scratch.uvDc)
  const { scores, coefficients } = scratch
  const yPlane = createPlane(columns * 16, 16)
  const uPlane = createPlane(columns * 8, 8)
  const vPlane = createPlane(columns * 8, 8)
  const above = Array.from({ length: columns }, () => new Int8Array(9))
  const paddedYWidth = columns * 16
  const paddedCWidth = columns * 8
  const yScratch = new Uint8Array(
    width === paddedYWidth && height % 16 === 0 ? 0 : paddedYWidth * 16,
  )
  const cScratchSize = chromaWidth === paddedCWidth && chromaHeight % 8 === 0 ? 0 : paddedCWidth * 8
  const uScratch = new Uint8Array(cScratchSize)
  const vScratch = new Uint8Array(cScratchSize)
  for (let row = 0; row < rows; row++) {
    const yPadded = padBand(ySource, width, height, row * 16, paddedYWidth, 16, yScratch)
    const uPadded = padBand(uSource, chromaWidth, chromaHeight, row * 8, paddedCWidth, 8, uScratch)
    const vPadded = padBand(vSource, chromaWidth, chromaHeight, row * 8, paddedCWidth, 8, vScratch)
    const yBase = yPadded === ySource ? row * 16 * paddedYWidth : 0
    const cBase = uPadded === uSource ? row * 8 * paddedCWidth : 0
    if (row > 0) {
      yPlane.data.copyWithin(0, 16 * yPlane.stride, 17 * yPlane.stride)
      uPlane.data.copyWithin(0, 8 * uPlane.stride, 9 * uPlane.stride)
      vPlane.data.copyWithin(0, 8 * vPlane.stride, 9 * vPlane.stride)
    }
    leftModes.fill(0)
    const left = new Int8Array(9)
    for (let column = 0; column < columns; column += 1) {
      const aboveContext = above[column] ?? new Int8Array(9)
      const yOffset = yPlane.origin + column * 16
      prepareEdges(yPlane, yOffset, 16, row, column)
      const yStart = yBase + column * 16
      const yPredictDc = squareDc(yPlane, yOffset, row, column, 16)
      // The keyframe tag has only 19 bits for this partition. For every
      // starting arithmetic range, sixteen DC luma/UV records take at most
      // 55 renormalization bits. Reserve seven bytes per group plus space
      // for the current block's longest mode paths and coder termination.
      const remaining = (rows - row) * columns - column
      const reserveHeader =
        header.byteLength + 7 * Math.ceil(remaining / 16) + 256 > maxPredictionPartitionLength
      const yMode = reserveHeader
        ? 0
        : chooseLumaMode(yPadded, yStart, paddedYWidth, yPlane, yOffset, yPredictDc, yAc, scores)
      header.bit(Number(yMode !== blockPrediction), yModeProbabilities[0])
      if (yMode !== blockPrediction) {
        header.bit(yMode >> 1, yModeProbabilities[1])
        header.bit(yMode & 1, yModeProbabilities[yMode < 2 ? 2 : 3])
        encodeLuma16(yPadded, yStart, paddedYWidth, yPlane, yOffset, yMode, yPredictDc, scratch)
        const mapped = macroToSubMode[yMode] ?? 0
        aboveModes.fill(mapped, column * 4, column * 4 + 4)
        leftModes.fill(mapped)
      } else {
        encodeLuma4(
          header,
          yPadded,
          yStart,
          paddedYWidth,
          yPlane,
          yOffset,
          row === 0,
          column === columns - 1,
          column,
          aboveModes,
          leftModes,
          scratch,
        )
      }
      const chromaStart = cBase + column * 8
      const chromaOut = uPlane.origin + column * 8
      prepareEdges(uPlane, chromaOut, 8, row, column)
      prepareEdges(vPlane, chromaOut, 8, row, column)
      const uDc = squareDc(uPlane, chromaOut, row, column, 8)
      const vDc = squareDc(vPlane, chromaOut, row, column, 8)
      for (let mode = 0; mode < 4; mode++)
        scores[mode] = ((squareModeCost[mode] ?? 0) * uvAc * uvAc) / 64
      scoreChromaModes(scores, uPadded, chromaStart, paddedCWidth, uPlane, chromaOut, uvCosts, uDc)
      scoreChromaModes(scores, vPadded, chromaStart, paddedCWidth, vPlane, chromaOut, uvCosts, vDc)
      let uvMode = 0
      for (let mode = 1; mode < 4; mode++)
        if ((scores[mode] ?? 0) < (scores[uvMode] ?? 0)) uvMode = mode
      if (reserveHeader) uvMode = 0
      const path = squarePaths[uvMode] ?? '0'
      for (let i = 0; i < path.length; i++) header.bit(Number(path[i]), uvModeProbabilities[i])
      encodeChroma(uPadded, chromaStart, paddedCWidth, uPlane, chromaOut, uvMode, uDc, 256, scratch)
      encodeChroma(vPadded, chromaStart, paddedCWidth, vPlane, chromaOut, uvMode, vDc, 320, scratch)
      writeTokens(tokens, yMode, coefficients, left, aboveContext)
      above[column] = aboveContext
    }
  }
  const firstPartition = header.finish()
  if (firstPartition.length > maxPredictionPartitionLength)
    throw invalidInput('VP8 prediction partition exceeds the frame tag')
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
  readonly #u: Uint8Array | undefined
  readonly #v: Uint8Array | undefined
  readonly #uAcc: Uint16Array | undefined
  readonly #vAcc: Uint16Array | undefined
  readonly #pendingRgb: Uint8Array | undefined
  readonly #alpha: Uint8Array | undefined
  readonly #kernel: WebpKernel | undefined
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
    kernel?: WebpKernel,
  ) {
    if (width > 0x3fff || height > 0x3fff)
      throw invalidInput('Lossy VP8 dimensions must fit in 14 bits')
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
    const directRgb = this.#channels === 3 && kernel === undefined
    this.#u = directRgb ? new Uint8Array(chromaPixels) : undefined
    this.#v = directRgb ? new Uint8Array(chromaPixels) : undefined
    this.#uAcc = directRgb ? undefined : new Uint16Array(chromaPixels)
    this.#vAcc = directRgb ? undefined : new Uint16Array(chromaPixels)
    this.#pendingRgb = directRgb ? new Uint8Array(width * 3) : undefined
    this.#alpha = format === 'rgba8' ? new Uint8Array(width * height) : undefined
    this.#kernel = kernel
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
    if (this.#channels === 3 && this.#kernel === undefined) {
      const u = this.#u
      const v = this.#v
      const pending = this.#pendingRgb
      if (!u || !v || !pending) throw invalidInput('WebP encoder is missing RGB planes')
      let row = 0
      if (this.#hasPendingRgb) {
        writeRgb8Pair(pending, 0, block.data, 0, this.#width, this.#expectedY - 1, this.#y, u, v)
        this.#hasPendingRgb = false
        row = 1
      }
      while (row + 1 < block.height) {
        writeRgb8Pair(
          block.data,
          row * block.stride,
          block.data,
          (row + 1) * block.stride,
          this.#width,
          this.#expectedY + row,
          this.#y,
          u,
          v,
        )
        row += 2
      }
      if (row < block.height) {
        pending.set(block.data.subarray(row * block.stride, row * block.stride + this.#width * 3))
        this.#hasPendingRgb = true
      }
      this.#expectedY += block.height
      return
    }
    const accelerated = this.#kernel?.vp8RgbToYuv420(
      block.data,
      block.stride,
      this.#width,
      block.height,
      this.#channels as 1 | 3 | 4,
      this.#expectedY,
    )
    if (accelerated) {
      const uAcc = this.#uAcc
      const vAcc = this.#vAcc
      if (!uAcc || !vAcc) throw invalidInput('WebP encoder is missing chroma accumulators')
      for (let row = 0; row < block.height; row += 1) {
        this.#y.set(
          accelerated.y.subarray(row * this.#width, (row + 1) * this.#width),
          (this.#expectedY + row) * this.#width,
        )
        if (this.#alpha && accelerated.alpha) {
          const source = accelerated.alpha.subarray(row * this.#width, (row + 1) * this.#width)
          this.#alpha.set(source, (this.#expectedY + row) * this.#width)
          for (const alpha of source) this.#hasAlpha ||= alpha !== 255
        }
      }
      const chromaOffset = accelerated.chromaStartY * chromaWidth
      for (let index = 0; index < accelerated.u.length; index += 1) {
        uAcc[chromaOffset + index] = (uAcc[chromaOffset + index] ?? 0) + (accelerated.u[index] ?? 0)
        vAcc[chromaOffset + index] = (vAcc[chromaOffset + index] ?? 0) + (accelerated.v[index] ?? 0)
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
    if (this.#hasPendingRgb && this.#pendingRgb && this.#u && this.#v) {
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
    const u = uAcc
      ? finalizeChroma(uAcc, this.#width, this.#height, chromaWidth, chromaHeight)
      : this.#u
    const v = vAcc
      ? finalizeChroma(vAcc, this.#width, this.#height, chromaWidth, chromaHeight)
      : this.#v
    if (!u || !v) throw invalidInput('WebP encoder is missing chroma planes')
    const vp8 = encodeVp8(this.#width, this.#height, this.#y, u, v, this.#quality)
    const alpha = this.#hasAlpha ? this.#alpha : undefined
    // ALPH header 1 selects VP8L compression with no filtering or level
    // reduction, so alpha stays exact. Raw alpha (header 0) is kept when
    // compression does not make it smaller.
    let alphaHeader = 0
    let alphaPayload = alpha
    if (alpha) {
      const { encodeAlphaImageStream } = await import('./webp-lossless-encode.ts')
      const stream = encodeAlphaImageStream(alpha, this.#width, this.#height, this.#kernel)
      if (stream.byteLength < alpha.byteLength) {
        alphaHeader = 1
        alphaPayload = stream
      }
    }
    const icc = this.#metadata?.icc
    const exif = this.#metadata?.exif
    if (icc && iccColorSpace(icc) !== 'rgb')
      throw invalidInput('Preserved ICC profile does not match WebP RGB output pixels')
    const extended = alpha !== undefined || icc !== undefined || exif !== undefined
    const vp8Padding = vp8.length & 1
    const alphaLength = alphaPayload ? 1 + alphaPayload.byteLength : 0
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
      if (alphaPayload) {
        output.set([65, 76, 80, 72], offset)
        uint32(output, offset + 4, alphaLength)
        output[offset + 8] = alphaHeader
        output.set(alphaPayload, offset + 9)
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
