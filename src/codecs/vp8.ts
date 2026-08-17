import { invalidInput, truncatedInput, unsupportedOperation } from '../errors.ts'
import {
  coefficientUpdateProbabilities,
  defaultCoefficientProbabilities,
  keyframeBlockModeProbabilities,
} from './vp8-tables.ts'

export interface DecodedVp8Rows {
  readonly y: number
  readonly height: number
  readonly pixels: Uint32Array
}

export interface DecodedVp8 {
  readonly width: number
  readonly height: number
  rows(): Iterable<DecodedVp8Rows>
}

const DC = 0
const VERTICAL = 1
const HORIZONTAL = 2
const TRUE_MOTION = 3
const BLOCK = 4

const keyframeYModeTree = Int8Array.of(-BLOCK, 2, 4, 6, -DC, -VERTICAL, -HORIZONTAL, -TRUE_MOTION)
const uvModeTree = Int8Array.of(-DC, 2, -VERTICAL, 4, -HORIZONTAL, -TRUE_MOTION)
const blockModeTree = Int8Array.of(
  -0,
  2,
  -1,
  4,
  -2,
  6,
  8,
  12,
  -3,
  10,
  -5,
  -6,
  -4,
  14,
  -7,
  16,
  -8,
  -9,
)
const keyframeYModeProbabilities = Uint8Array.of(145, 156, 163, 128)
const keyframeUvModeProbabilities = Uint8Array.of(142, 114, 183)
const coefficientBands = Uint8Array.of(0, 1, 2, 3, 6, 4, 5, 6, 6, 6, 6, 6, 6, 6, 6, 7)
const zigzag = Uint8Array.of(0, 1, 4, 8, 5, 2, 3, 6, 9, 12, 13, 10, 7, 11, 14, 15)
const leftContextIndex = Uint8Array.of(
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
  8,
)
const aboveContextIndex = Uint8Array.of(
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
  8,
)

export const vp8DcQuantizers = new Uint16Array([
  4, 5, 6, 7, 8, 9, 10, 10, 11, 12, 13, 14, 15, 16, 17, 17, 18, 19, 20, 20, 21, 21, 22, 22, 23, 23,
  24, 25, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 37, 38, 39, 40, 41, 42, 43, 44, 45,
  46, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 62, 63, 64, 65, 66, 67, 68,
  69, 70, 71, 72, 73, 74, 75, 76, 76, 77, 78, 79, 80, 81, 82, 83, 84, 85, 86, 87, 88, 89, 91, 93,
  95, 96, 98, 100, 101, 102, 104, 106, 108, 110, 112, 114, 116, 118, 122, 124, 126, 128, 130, 132,
  134, 136, 138, 140, 143, 145, 148, 151, 154, 157,
])
export const vp8AcQuantizers = new Uint16Array([
  4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29,
  30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53,
  54, 55, 56, 57, 58, 60, 62, 64, 66, 68, 70, 72, 74, 76, 78, 80, 82, 84, 86, 88, 90, 92, 94, 96,
  98, 100, 102, 104, 106, 108, 110, 112, 114, 116, 119, 122, 125, 128, 131, 134, 137, 140, 143, 146,
  149, 152, 155, 158, 161, 164, 167, 170, 173, 177, 181, 185, 189, 193, 197, 201, 205, 209, 213,
  217, 221, 225, 229, 234, 239, 245, 249, 254, 259, 264, 269, 274, 279, 284,
])

class BooleanDecoder {
  readonly #data: Uint8Array
  readonly #end: number
  #offset: number
  #range = 255
  #value: number
  #bitCount = 0

  constructor(data: Uint8Array, offset: number, length: number) {
    if (length < 0 || offset < 0 || offset + length > data.byteLength) {
      throw truncatedInput('VP8 boolean partition is truncated')
    }
    this.#data = data
    this.#offset = offset + 2
    this.#end = offset + length
    this.#value = ((data[offset] ?? 0) << 8) | (data[offset + 1] ?? 0)
  }

  bit(probability = 128): number {
    const split = 1 + (((this.#range - 1) * probability) >> 8)
    const boundary = split << 8
    let result = 0
    if (this.#value >= boundary) {
      result = 1
      this.#range -= split
      this.#value -= boundary
    } else this.#range = split

    while (this.#range < 128) {
      this.#value <<= 1
      this.#range <<= 1
      this.#bitCount += 1
      if (this.#bitCount === 8) {
        this.#bitCount = 0
        this.#value |= this.#offset < this.#end ? (this.#data[this.#offset] ?? 0) : 0
        this.#offset += 1
      }
    }
    return result
  }

  uint(bits: number): number {
    let value = 0
    for (let bit = bits - 1; bit >= 0; bit -= 1) value |= this.bit() << bit
    return value
  }

  signed(bits: number): number {
    const value = this.uint(bits)
    return this.bit() === 1 ? -value : value
  }
}

const readTree = (
  decoder: BooleanDecoder,
  tree: ArrayLike<number>,
  probabilities: ArrayLike<number>,
  probabilityOffset = 0,
): number => {
  let index = 0
  while (true) {
    const next = tree[index + decoder.bit(probabilities[probabilityOffset + (index >> 1)] ?? 128)]
    if (next === undefined) throw invalidInput('VP8 probability tree is invalid')
    if (next <= 0) return -next
    index = next
  }
}

interface Segmentation {
  readonly enabled: boolean
  readonly updateMap: boolean
  readonly absolute: boolean
  readonly quantizers: Int16Array
  readonly filterLevels: Int16Array
  readonly treeProbabilities: Uint8Array
}

interface LoopFilter {
  readonly simple: boolean
  readonly level: number
  readonly sharpness: number
  readonly deltaEnabled: boolean
  readonly referenceDeltas: Int16Array
  readonly modeDeltas: Int16Array
}

interface Quantization {
  readonly index: number
  readonly y1Dc: number
  readonly y2Dc: number
  readonly y2Ac: number
  readonly uvDc: number
  readonly uvAc: number
}

interface Factors {
  readonly y1: readonly [number, number]
  readonly y2: readonly [number, number]
  readonly uv: readonly [number, number]
}

interface Macroblock {
  yMode: number
  uvMode: number
  readonly modes: Int8Array
  segment: number
  skip: boolean
  hasCoefficients: boolean
}

interface Plane {
  readonly data: Uint8Array
  readonly stride: number
  readonly origin: number
}

const maybeSigned = (decoder: BooleanDecoder, bits: number): number =>
  decoder.bit() === 1 ? decoder.signed(bits) : 0

const parseSegmentation = (decoder: BooleanDecoder): Segmentation => {
  const enabled = decoder.bit() === 1
  const quantizers = new Int16Array(4)
  const filterLevels = new Int16Array(4)
  const treeProbabilities = new Uint8Array([255, 255, 255])
  if (!enabled) {
    return {
      enabled,
      updateMap: false,
      absolute: false,
      quantizers,
      filterLevels,
      treeProbabilities,
    }
  }
  const updateMap = decoder.bit() === 1
  const updateData = decoder.bit() === 1
  let absolute = false
  if (updateData) {
    absolute = decoder.bit() === 1
    for (let index = 0; index < 4; index += 1) quantizers[index] = maybeSigned(decoder, 7)
    for (let index = 0; index < 4; index += 1) filterLevels[index] = maybeSigned(decoder, 6)
  }
  if (updateMap) {
    for (let index = 0; index < 3; index += 1) {
      treeProbabilities[index] = decoder.bit() === 1 ? decoder.uint(8) : 255
    }
  }
  return { enabled, updateMap, absolute, quantizers, filterLevels, treeProbabilities }
}

const parseLoopFilter = (decoder: BooleanDecoder): LoopFilter => {
  const simple = decoder.bit() === 1
  const level = decoder.uint(6)
  const sharpness = decoder.uint(3)
  const deltaEnabled = decoder.bit() === 1
  const referenceDeltas = new Int16Array(4)
  const modeDeltas = new Int16Array(4)
  if (deltaEnabled && decoder.bit() === 1) {
    for (let index = 0; index < 4; index += 1) referenceDeltas[index] = maybeSigned(decoder, 6)
    for (let index = 0; index < 4; index += 1) modeDeltas[index] = maybeSigned(decoder, 6)
  }
  return { simple, level, sharpness, deltaEnabled, referenceDeltas, modeDeltas }
}

const parseQuantization = (decoder: BooleanDecoder): Quantization => ({
  index: decoder.uint(7),
  y1Dc: maybeSigned(decoder, 4),
  y2Dc: maybeSigned(decoder, 4),
  y2Ac: maybeSigned(decoder, 4),
  uvDc: maybeSigned(decoder, 4),
  uvAc: maybeSigned(decoder, 4),
})

const clampQuantizer = (value: number): number => Math.max(0, Math.min(127, value))
const factorSet = (segment: number, segmentation: Segmentation, quant: Quantization): Factors => {
  const segmentValue = segmentation.quantizers[segment] ?? 0
  const index = segmentation.enabled
    ? segmentation.absolute
      ? segmentValue
      : quant.index + segmentValue
    : quant.index
  const dc = (delta: number): number => vp8DcQuantizers[clampQuantizer(index + delta)] ?? 4
  const ac = (delta = 0): number => vp8AcQuantizers[clampQuantizer(index + delta)] ?? 4
  return {
    y1: [dc(quant.y1Dc), ac()],
    y2: [dc(quant.y2Dc) * 2, Math.max(8, Math.trunc((ac(quant.y2Ac) * 155) / 100))],
    uv: [Math.min(132, dc(quant.uvDc)), ac(quant.uvAc)],
  }
}

const macroblock = (): Macroblock => ({
  yMode: DC,
  uvMode: DC,
  modes: new Int8Array(16),
  segment: 0,
  skip: false,
  hasCoefficients: false,
})

const macroToBlockMode = (block: Macroblock, position: number): number => {
  if (block.yMode === BLOCK) return block.modes[position] ?? 0
  if (block.yMode === TRUE_MOTION) return 1
  if (block.yMode === VERTICAL) return 2
  if (block.yMode === HORIZONTAL) return 3
  return 0
}

const decodeModeRow = (
  decoder: BooleanDecoder,
  columns: number,
  above: Macroblock[],
  segmentation: Segmentation,
  skipEnabled: boolean,
  skipProbability: number,
): Macroblock[] => {
  const currentRow: Macroblock[] = []
  let left = macroblock()
  for (let column = 0; column < columns; column += 1) {
    const current = macroblock()
    if (segmentation.updateMap) {
      current.segment =
        decoder.bit(segmentation.treeProbabilities[0]) === 1
          ? 2 + decoder.bit(segmentation.treeProbabilities[2])
          : decoder.bit(segmentation.treeProbabilities[1])
    }
    if (skipEnabled) current.skip = decoder.bit(skipProbability) === 1
    current.yMode = readTree(decoder, keyframeYModeTree, keyframeYModeProbabilities)
    const aboveMacroblock = above[column] ?? macroblock()
    if (current.yMode === BLOCK) {
      for (let block = 0; block < 16; block += 1) {
        const aboveMode =
          block < 4
            ? macroToBlockMode(aboveMacroblock, block + 12)
            : (current.modes[block - 4] ?? 0)
        const leftMode =
          (block & 3) === 0 ? macroToBlockMode(left, block + 3) : (current.modes[block - 1] ?? 0)
        current.modes[block] = readTree(
          decoder,
          blockModeTree,
          keyframeBlockModeProbabilities,
          (aboveMode * 10 + leftMode) * 9,
        )
      }
    }
    current.uvMode = readTree(decoder, uvModeTree, keyframeUvModeProbabilities)
    currentRow.push(current)
    above[column] = current
    left = current
  }
  return currentRow
}

const probabilityIndex = (type: number, coefficient: number, context: number): number =>
  ((type * 8 + (coefficientBands[coefficient] ?? 0)) * 3 + context) * 11

const extraBits = [
  { base: 5, probabilities: [159] },
  { base: 7, probabilities: [145, 165] },
  { base: 11, probabilities: [140, 148, 173] },
  { base: 19, probabilities: [135, 140, 155, 176] },
  { base: 35, probabilities: [130, 134, 141, 157, 180] },
  { base: 67, probabilities: [129, 130, 133, 140, 153, 177, 196, 230, 243, 254, 254] },
]

const readMagnitude = (
  decoder: BooleanDecoder,
  probabilities: Uint8Array,
  offset: number,
): number => {
  if (decoder.bit(probabilities[offset + 3]) === 0) {
    if (decoder.bit(probabilities[offset + 4]) === 0) return 2
    return decoder.bit(probabilities[offset + 5]) === 0 ? 3 : 4
  }
  let category = 0
  if (decoder.bit(probabilities[offset + 6]) === 0) {
    category = decoder.bit(probabilities[offset + 7]) === 0 ? 0 : 1
  } else if (decoder.bit(probabilities[offset + 8]) === 0) {
    category = decoder.bit(probabilities[offset + 9]) === 0 ? 2 : 3
  } else category = decoder.bit(probabilities[offset + 10]) === 0 ? 4 : 5
  const extra = extraBits[category]
  if (!extra) throw invalidInput('VP8 coefficient category is invalid')
  let value = extra.base
  for (let bit = extra.probabilities.length - 1; bit >= 0; bit -= 1) {
    value += decoder.bit(extra.probabilities[bit]) << bit
  }
  return value
}

const decodeCoefficientBlock = (
  decoder: BooleanDecoder,
  probabilities: Uint8Array,
  type: number,
  context: number,
  factors: readonly [number, number],
  output: Int32Array,
  outputOffset: number,
): boolean => {
  const first = type === 0 ? 1 : 0
  let coefficient = first
  let nextContext = context
  let nonzero = false
  let checkEnd = true
  while (coefficient < 16) {
    const offset = probabilityIndex(type, coefficient, nextContext)
    if (checkEnd && decoder.bit(probabilities[offset]) === 0) break
    if (decoder.bit(probabilities[offset + 1]) === 0) {
      coefficient += 1
      nextContext = 0
      checkEnd = false
      continue
    }
    const magnitude =
      decoder.bit(probabilities[offset + 2]) === 0
        ? 1
        : readMagnitude(decoder, probabilities, offset)
    const signed = decoder.bit() === 1 ? -magnitude : magnitude
    output[outputOffset + (zigzag[coefficient] ?? 0)] = signed * factors[coefficient === 0 ? 0 : 1]
    nonzero = true
    nextContext = magnitude === 1 ? 1 : 2
    checkEnd = true
    coefficient += 1
  }
  return nonzero
}

const decodeMacroblockCoefficients = (
  decoder: BooleanDecoder,
  probabilities: Uint8Array,
  block: Macroblock,
  factors: Factors,
  left: Int8Array,
  above: Int8Array,
  coefficients: Int32Array,
): void => {
  coefficients.fill(0)
  const blockMode = block.yMode === BLOCK
  const count = blockMode ? 24 : 25
  for (let iteration = 0; iteration < count; iteration += 1) {
    const index = blockMode ? iteration : iteration === 0 ? 24 : iteration - 1
    const type = index === 24 ? 1 : index >= 16 ? 2 : block.yMode === BLOCK ? 3 : 0
    const factor = type === 1 ? factors.y2 : type === 2 ? factors.uv : factors.y1
    const leftIndex = leftContextIndex[index] ?? 0
    const aboveIndex = aboveContextIndex[index] ?? 0
    const nonzero = decodeCoefficientBlock(
      decoder,
      probabilities,
      type,
      (left[leftIndex] ?? 0) + (above[aboveIndex] ?? 0),
      factor,
      coefficients,
      index * 16,
    )
    left[leftIndex] = nonzero ? 1 : 0
    above[aboveIndex] = nonzero ? 1 : 0
    block.hasCoefficients ||= nonzero
  }
}

const createPlane = (width: number, height: number): Plane => {
  const stride = width + 6
  return { data: new Uint8Array((height + 2) * stride), stride, origin: stride + 1 }
}

const fixLeft = (plane: Plane, offset: number, size: number, row: number, mode: number): void => {
  if (mode === DC && row > 0) {
    for (let index = 0; index < size; index += 1) {
      plane.data[offset - 1 + index * plane.stride] = plane.data[offset - plane.stride + index] ?? 0
    }
    return
  }
  for (let index = -1; index < size; index += 1) {
    plane.data[offset - 1 + index * plane.stride] = 129
  }
}

const fixAbove = (
  plane: Plane,
  offset: number,
  size: number,
  column: number,
  mode: number,
): void => {
  if (mode === DC && column > 0) {
    for (let index = 0; index < size; index += 1) {
      plane.data[offset - plane.stride + index] = plane.data[offset - 1 + index * plane.stride] ?? 0
    }
  } else plane.data.fill(127, offset - plane.stride - 1, offset - plane.stride + size)
  plane.data.fill(127, offset - plane.stride + size, offset - plane.stride + size + 4)
}

const clampByte = (value: number): number => Math.max(0, Math.min(255, value))
const average2 = (a: number, b: number): number => (a + b + 1) >> 1
const average3 = (a: number, b: number, c: number): number => (a + 2 * b + c + 2) >> 2

const predictSquare = (plane: Plane, offset: number, size: number, mode: number): void => {
  let dc = 0
  if (mode === DC) {
    for (let index = 0; index < size; index += 1) {
      dc += plane.data[offset - plane.stride + index] ?? 0
      dc += plane.data[offset - 1 + index * plane.stride] ?? 0
    }
    dc = (dc + size) >> (size === 16 ? 5 : size === 8 ? 4 : 3)
  }
  const topLeft = plane.data[offset - plane.stride - 1] ?? 0
  for (let y = 0; y < size; y += 1) {
    const left = plane.data[offset - 1 + y * plane.stride] ?? 0
    for (let x = 0; x < size; x += 1) {
      const above = plane.data[offset - plane.stride + x] ?? 0
      plane.data[offset + y * plane.stride + x] =
        mode === VERTICAL
          ? above
          : mode === HORIZONTAL
            ? left
            : mode === TRUE_MOTION
              ? clampByte(left + above - topLeft)
              : dc
    }
  }
}

const writePredictRow = (
  data: Uint8Array,
  row: number,
  a: number,
  b: number,
  c: number,
  d: number,
): void => {
  data[row] = a
  data[row + 1] = b
  data[row + 2] = c
  data[row + 3] = d
}

const predictBlock = (plane: Plane, offset: number, mode: number): void => {
  if (mode <= 1) {
    predictSquare(plane, offset, 4, mode === 1 ? TRUE_MOTION : DC)
    return
  }
  const data = plane.data
  const stride = plane.stride
  const above = offset - stride
  const t0 = data[above] ?? 0
  const t1 = data[above + 1] ?? 0
  const t2 = data[above + 2] ?? 0
  const t3 = data[above + 3] ?? 0
  const t4 = data[above + 4] ?? 0
  const t5 = data[above + 5] ?? 0
  const t6 = data[above + 6] ?? 0
  const t7 = data[above + 7] ?? 0
  const l0 = data[offset - 1] ?? 0
  const l1 = data[offset - 1 + stride] ?? 0
  const l2 = data[offset - 1 + stride * 2] ?? 0
  const l3 = data[offset - 1 + stride * 3] ?? 0
  const corner = data[above - 1] ?? 0
  const row0 = offset
  const row1 = offset + stride
  const row2 = offset + stride * 2
  const row3 = offset + stride * 3
  if (mode === 2) {
    const c0 = average3(corner, t0, t1)
    const c1 = average3(t0, t1, t2)
    const c2 = average3(t1, t2, t3)
    const c3 = average3(t2, t3, t4)
    writePredictRow(data, row0, c0, c1, c2, c3)
    writePredictRow(data, row1, c0, c1, c2, c3)
    writePredictRow(data, row2, c0, c1, c2, c3)
    writePredictRow(data, row3, c0, c1, c2, c3)
    return
  }
  if (mode === 3) {
    const c0 = average3(corner, l0, l1)
    const c1 = average3(l0, l1, l2)
    const c2 = average3(l1, l2, l3)
    const c3 = average3(l2, l3, l3)
    writePredictRow(data, row0, c0, c0, c0, c0)
    writePredictRow(data, row1, c1, c1, c1, c1)
    writePredictRow(data, row2, c2, c2, c2, c2)
    writePredictRow(data, row3, c3, c3, c3, c3)
    return
  }
  if (mode === 4) {
    const a01 = average3(t0, t1, t2)
    const a12 = average3(t1, t2, t3)
    const a23 = average3(t2, t3, t4)
    const a34 = average3(t3, t4, t5)
    const a45 = average3(t4, t5, t6)
    const a56 = average3(t5, t6, t7)
    const a67 = average3(t6, t7, t7)
    writePredictRow(data, row0, a01, a12, a23, a34)
    writePredictRow(data, row1, a12, a23, a34, a45)
    writePredictRow(data, row2, a23, a34, a45, a56)
    writePredictRow(data, row3, a34, a45, a56, a67)
    return
  }
  if (mode === 7) {
    writePredictRow(
      data,
      row0,
      average2(t0, t1),
      average2(t1, t2),
      average2(t2, t3),
      average2(t3, t4),
    )
    writePredictRow(
      data,
      row1,
      average3(t0, t1, t2),
      average3(t1, t2, t3),
      average3(t2, t3, t4),
      average3(t3, t4, t5),
    )
    writePredictRow(
      data,
      row2,
      average2(t1, t2),
      average2(t2, t3),
      average2(t3, t4),
      average3(t4, t5, t6),
    )
    writePredictRow(
      data,
      row3,
      average3(t1, t2, t3),
      average3(t2, t3, t4),
      average3(t3, t4, t5),
      average3(t5, t6, t7),
    )
    return
  }
  if (mode === 5) {
    writePredictRow(
      data,
      row0,
      average3(l0, corner, t0),
      average3(corner, t0, t1),
      average3(t0, t1, t2),
      average3(t1, t2, t3),
    )
    writePredictRow(
      data,
      row1,
      average3(l1, l0, corner),
      average3(l0, corner, t0),
      average3(corner, t0, t1),
      average3(t0, t1, t2),
    )
    writePredictRow(
      data,
      row2,
      average3(l2, l1, l0),
      average3(l1, l0, corner),
      average3(l0, corner, t0),
      average3(corner, t0, t1),
    )
    writePredictRow(
      data,
      row3,
      average3(l3, l2, l1),
      average3(l2, l1, l0),
      average3(l1, l0, corner),
      average3(l0, corner, t0),
    )
    return
  }
  if (mode === 6) {
    const a0 = average2(corner, t0)
    const a1 = average2(t0, t1)
    const a2 = average2(t1, t2)
    const a3 = average2(t2, t3)
    const b0 = average3(l0, corner, t0)
    const b1 = average3(corner, t0, t1)
    const b2 = average3(t0, t1, t2)
    writePredictRow(data, row0, a0, a1, a2, a3)
    writePredictRow(data, row1, b0, b1, b2, average3(t1, t2, t3))
    writePredictRow(data, row2, average3(l1, l0, corner), a0, a1, a2)
    writePredictRow(data, row3, average3(l2, l1, l0), b0, b1, b2)
    return
  }
  if (mode === 8) {
    const a0 = average2(l0, corner)
    const a1 = average3(l0, corner, t0)
    const b0 = average2(l1, l0)
    const b1 = average3(l1, l0, corner)
    const c0 = average2(l2, l1)
    const c1 = average3(l2, l1, l0)
    writePredictRow(data, row0, a0, a1, average3(corner, t0, t1), average3(t0, t1, t2))
    writePredictRow(data, row1, b0, b1, a0, a1)
    writePredictRow(data, row2, c0, c1, b0, b1)
    writePredictRow(data, row3, average2(l3, l2), average3(l3, l2, l1), c0, c1)
    return
  }
  writePredictRow(
    data,
    row0,
    average2(l0, l1),
    average3(l0, l1, l2),
    average2(l1, l2),
    average3(l1, l2, l3),
  )
  writePredictRow(
    data,
    row1,
    average2(l1, l2),
    average3(l1, l2, l3),
    average2(l2, l3),
    average3(l2, l3, l3),
  )
  writePredictRow(
    data,
    row2,
    average2(l2, l3),
    average3(l2, l3, l3),
    average2(l3, l3),
    average3(l3, l3, l3),
  )
  writePredictRow(
    data,
    row3,
    average2(l3, l3),
    average3(l3, l3, l3),
    average2(l3, l3),
    average3(l3, l3, l3),
  )
}

const walsh = (
  input: Int32Array,
  offset: number,
  temporary: Int32Array,
  output: Int32Array,
): void => {
  for (let x = 0; x < 4; x += 1) {
    const a = (input[offset + x] ?? 0) + (input[offset + 12 + x] ?? 0)
    const b = (input[offset + 4 + x] ?? 0) + (input[offset + 8 + x] ?? 0)
    const c = (input[offset + 4 + x] ?? 0) - (input[offset + 8 + x] ?? 0)
    const d = (input[offset + x] ?? 0) - (input[offset + 12 + x] ?? 0)
    temporary[x] = a + b
    temporary[4 + x] = c + d
    temporary[8 + x] = a - b
    temporary[12 + x] = d - c
  }
  for (let y = 0; y < 4; y += 1) {
    const offsetY = y * 4
    const a = (temporary[offsetY] ?? 0) + (temporary[offsetY + 3] ?? 0)
    const b = (temporary[offsetY + 1] ?? 0) + (temporary[offsetY + 2] ?? 0)
    const c = (temporary[offsetY + 1] ?? 0) - (temporary[offsetY + 2] ?? 0)
    const d = (temporary[offsetY] ?? 0) - (temporary[offsetY + 3] ?? 0)
    output[offsetY] = (a + b + 3) >> 3
    output[offsetY + 1] = (c + d + 3) >> 3
    output[offsetY + 2] = (a - b + 3) >> 3
    output[offsetY + 3] = (d - c + 3) >> 3
  }
}

const inverseDctAdd = (
  plane: Plane,
  offset: number,
  coefficients: Int32Array,
  coefficientOffset: number,
  temporary: Int32Array,
): void => {
  for (let x = 0; x < 4; x += 1) {
    const a =
      (coefficients[coefficientOffset + x] ?? 0) + (coefficients[coefficientOffset + 8 + x] ?? 0)
    const b =
      (coefficients[coefficientOffset + x] ?? 0) - (coefficients[coefficientOffset + 8 + x] ?? 0)
    const one = coefficients[coefficientOffset + 4 + x] ?? 0
    const three = coefficients[coefficientOffset + 12 + x] ?? 0
    const c = ((one * 35468) >> 16) - three - ((three * 20091) >> 16)
    const d = one + ((one * 20091) >> 16) + ((three * 35468) >> 16)
    temporary[x] = a + d
    temporary[12 + x] = a - d
    temporary[4 + x] = b + c
    temporary[8 + x] = b - c
  }
  for (let y = 0; y < 4; y += 1) {
    const row = y * 4
    const a = (temporary[row] ?? 0) + (temporary[row + 2] ?? 0)
    const b = (temporary[row] ?? 0) - (temporary[row + 2] ?? 0)
    const one = temporary[row + 1] ?? 0
    const three = temporary[row + 3] ?? 0
    const c = ((one * 35468) >> 16) - three - ((three * 20091) >> 16)
    const d = one + ((one * 20091) >> 16) + ((three * 35468) >> 16)
    const pixel = offset + y * plane.stride
    plane.data[pixel] = clampByte((plane.data[pixel] ?? 0) + ((a + d + 4) >> 3))
    plane.data[pixel + 1] = clampByte((plane.data[pixel + 1] ?? 0) + ((b + c + 4) >> 3))
    plane.data[pixel + 2] = clampByte((plane.data[pixel + 2] ?? 0) + ((b - c + 4) >> 3))
    plane.data[pixel + 3] = clampByte((plane.data[pixel + 3] ?? 0) + ((a - d + 4) >> 3))
  }
}

export const addInverseVp8Block = (
  data: Uint8Array,
  stride: number,
  offset: number,
  coefficients: Int32Array,
  temporary = new Int32Array(16),
): void => inverseDctAdd({ data, stride, origin: 0 }, offset, coefficients, 0, temporary)

const reconstruct = (
  yPlane: Plane,
  uPlane: Plane,
  vPlane: Plane,
  row: number,
  column: number,
  block: Macroblock,
  coefficients: Int32Array,
  rightEdge: boolean,
  inverseDctTemporary: Int32Array,
  walshTemporary: Int32Array,
  walshOutput: Int32Array,
): void => {
  const yOffset = yPlane.origin + row * 16 * yPlane.stride + column * 16
  const uOffset = uPlane.origin + row * 8 * uPlane.stride + column * 8
  const vOffset = vPlane.origin + row * 8 * vPlane.stride + column * 8
  if (column === 0) {
    fixLeft(yPlane, yOffset, 16, row, block.yMode)
    fixLeft(uPlane, uOffset, 8, row, block.uvMode)
    fixLeft(vPlane, vOffset, 8, row, block.uvMode)
  }
  if (row === 0) {
    fixAbove(yPlane, yOffset, 16, column, block.yMode)
    fixAbove(uPlane, uOffset, 8, column, block.uvMode)
    fixAbove(vPlane, vOffset, 8, column, block.uvMode)
  }

  if (block.yMode === BLOCK) {
    const aboveRight = yOffset - yPlane.stride + 16
    if (rightEdge) {
      yPlane.data.fill(yPlane.data[aboveRight - 1] ?? 127, aboveRight, aboveRight + 4)
    }
    for (const y of [3, 7, 11]) {
      yPlane.data.copyWithin(yOffset + y * yPlane.stride + 16, aboveRight, aboveRight + 4)
    }
    for (let index = 0; index < 16; index += 1) {
      const offset = yOffset + (index >> 2) * 4 * yPlane.stride + (index & 3) * 4
      predictBlock(yPlane, offset, block.modes[index] ?? 0)
      inverseDctAdd(yPlane, offset, coefficients, index * 16, inverseDctTemporary)
    }
  } else {
    walsh(coefficients, 24 * 16, walshTemporary, walshOutput)
    predictSquare(yPlane, yOffset, 16, block.yMode)
    for (let index = 0; index < 16; index += 1) {
      coefficients[index * 16] = walshOutput[index] ?? 0
      inverseDctAdd(
        yPlane,
        yOffset + (index >> 2) * 4 * yPlane.stride + (index & 3) * 4,
        coefficients,
        index * 16,
        inverseDctTemporary,
      )
    }
  }
  predictSquare(uPlane, uOffset, 8, block.uvMode)
  predictSquare(vPlane, vOffset, 8, block.uvMode)
  for (let index = 0; index < 4; index += 1) {
    const local = (index >> 1) * 4 * uPlane.stride + (index & 1) * 4
    inverseDctAdd(uPlane, uOffset + local, coefficients, (16 + index) * 16, inverseDctTemporary)
    inverseDctAdd(vPlane, vOffset + local, coefficients, (20 + index) * 16, inverseDctTemporary)
  }
}

const saturateInt8 = (value: number): number => Math.max(-128, Math.min(127, value))

const simpleFilterThreshold = (
  plane: Plane,
  offset: number,
  step: number,
  limit: number,
): boolean => {
  const p1 = plane.data[offset - 2 * step] ?? 0
  const p0 = plane.data[offset - step] ?? 0
  const q0 = plane.data[offset] ?? 0
  const q1 = plane.data[offset + step] ?? 0
  return Math.abs(p0 - q0) * 2 + (Math.abs(p1 - q1) >> 1) <= limit
}

const normalFilterThreshold = (
  plane: Plane,
  offset: number,
  step: number,
  edgeLimit: number,
  interiorLimit: number,
): boolean => {
  if (!simpleFilterThreshold(plane, offset, step, edgeLimit * 2 + interiorLimit)) return false
  const p3 = plane.data[offset - 4 * step] ?? 0
  const p2 = plane.data[offset - 3 * step] ?? 0
  const p1 = plane.data[offset - 2 * step] ?? 0
  const p0 = plane.data[offset - step] ?? 0
  const q0 = plane.data[offset] ?? 0
  const q1 = plane.data[offset + step] ?? 0
  const q2 = plane.data[offset + 2 * step] ?? 0
  const q3 = plane.data[offset + 3 * step] ?? 0
  return (
    Math.abs(p3 - p2) <= interiorLimit &&
    Math.abs(p2 - p1) <= interiorLimit &&
    Math.abs(p1 - p0) <= interiorLimit &&
    Math.abs(q0 - q1) <= interiorLimit &&
    Math.abs(q1 - q2) <= interiorLimit &&
    Math.abs(q2 - q3) <= interiorLimit
  )
}

const highEdgeVariance = (plane: Plane, offset: number, step: number, threshold: number): boolean =>
  Math.abs((plane.data[offset - 2 * step] ?? 0) - (plane.data[offset - step] ?? 0)) > threshold ||
  Math.abs((plane.data[offset + step] ?? 0) - (plane.data[offset] ?? 0)) > threshold

const filterCommon = (plane: Plane, offset: number, step: number, outerTaps: boolean): void => {
  const p1Offset = offset - 2 * step
  const p0Offset = offset - step
  const q0Offset = offset
  const q1Offset = offset + step
  const p1 = plane.data[p1Offset] ?? 0
  const p0 = plane.data[p0Offset] ?? 0
  const q0 = plane.data[q0Offset] ?? 0
  const q1 = plane.data[q1Offset] ?? 0
  let adjustment = 3 * (q0 - p0)
  if (outerTaps) adjustment += saturateInt8(p1 - q1)
  adjustment = saturateInt8(adjustment)
  const first = Math.min(127, adjustment + 4) >> 3
  const second = Math.min(127, adjustment + 3) >> 3
  plane.data[p0Offset] = clampByte(p0 + second)
  plane.data[q0Offset] = clampByte(q0 - first)
  if (!outerTaps) {
    const outer = (first + 1) >> 1
    plane.data[p1Offset] = clampByte(p1 + outer)
    plane.data[q1Offset] = clampByte(q1 - outer)
  }
}

const filterMacroblockEdge = (plane: Plane, offset: number, step: number): void => {
  const p2Offset = offset - 3 * step
  const p1Offset = offset - 2 * step
  const p0Offset = offset - step
  const q0Offset = offset
  const q1Offset = offset + step
  const q2Offset = offset + 2 * step
  const p1 = plane.data[p1Offset] ?? 0
  const p0 = plane.data[p0Offset] ?? 0
  const q0 = plane.data[q0Offset] ?? 0
  const q1 = plane.data[q1Offset] ?? 0
  const weight = saturateInt8(saturateInt8(p1 - q1) + 3 * (q0 - p0))
  const adjust = (coefficient: number): number => (coefficient * weight + 63) >> 7
  plane.data[p0Offset] = clampByte(p0 + adjust(27))
  plane.data[q0Offset] = clampByte(q0 - adjust(27))
  plane.data[p1Offset] = clampByte(p1 + adjust(18))
  plane.data[q1Offset] = clampByte(q1 - adjust(18))
  plane.data[p2Offset] = clampByte((plane.data[p2Offset] ?? 0) + adjust(9))
  plane.data[q2Offset] = clampByte((plane.data[q2Offset] ?? 0) - adjust(9))
}

const filterNormalEdge = (
  plane: Plane,
  offset: number,
  step: number,
  advance: number,
  length: number,
  edgeLimit: number,
  interiorLimit: number,
  varianceThreshold: number,
  macroblockEdge: boolean,
): void => {
  for (let index = 0; index < length; index += 1) {
    const pixel = offset + index * advance
    if (!normalFilterThreshold(plane, pixel, step, edgeLimit, interiorLimit)) continue
    const highVariance = highEdgeVariance(plane, pixel, step, varianceThreshold)
    if (macroblockEdge && !highVariance) filterMacroblockEdge(plane, pixel, step)
    else filterCommon(plane, pixel, step, highVariance || macroblockEdge)
  }
}

const filterSimpleEdge = (
  plane: Plane,
  offset: number,
  step: number,
  advance: number,
  length: number,
  limit: number,
): void => {
  for (let index = 0; index < length; index += 1) {
    const pixel = offset + index * advance
    if (simpleFilterThreshold(plane, pixel, step, limit)) filterCommon(plane, pixel, step, true)
  }
}

const loopFilterParameters = (
  block: Macroblock,
  segmentation: Segmentation,
  filter: LoopFilter,
): readonly [number, number, number] => {
  let level = filter.level
  if (segmentation.enabled) {
    const segmentLevel = segmentation.filterLevels[block.segment] ?? 0
    level = segmentation.absolute ? segmentLevel : level + segmentLevel
  }
  level = Math.max(0, Math.min(63, level))
  if (filter.deltaEnabled) {
    level += filter.referenceDeltas[0] ?? 0
    if (block.yMode === BLOCK) level += filter.modeDeltas[0] ?? 0
  }
  level = Math.max(0, Math.min(63, level))
  let interior = level
  if (filter.sharpness > 0) {
    interior >>= filter.sharpness > 4 ? 2 : 1
    interior = Math.min(interior, 9 - filter.sharpness)
  }
  interior = Math.max(1, interior)
  const variance = Number(level >= 15) + Number(level >= 40)
  return [level, interior, variance]
}

const applyLoopFilterRow = (
  yPlane: Plane,
  uPlane: Plane,
  vPlane: Plane,
  blocks: readonly Macroblock[],
  planeRow: number,
  imageRow: number,
  segmentation: Segmentation,
  filter: LoopFilter,
): void => {
  if (filter.level === 0 && !segmentation.enabled) return
  for (let column = 0; column < blocks.length; column += 1) {
    const block = blocks[column]
    if (!block) continue
    const [level, interior, variance] = loopFilterParameters(block, segmentation, filter)
    if (level === 0) continue
    const y = yPlane.origin + planeRow * 16 * yPlane.stride + column * 16
    const u = uPlane.origin + planeRow * 8 * uPlane.stride + column * 8
    const v = vPlane.origin + planeRow * 8 * vPlane.stride + column * 8
    const subblocks = block.hasCoefficients || block.yMode === BLOCK
    if (filter.simple) {
      const macroblockLimit = (level + 2) * 2 + interior
      const subblockLimit = level * 2 + interior
      if (column > 0) filterSimpleEdge(yPlane, y, 1, yPlane.stride, 16, macroblockLimit)
      if (subblocks) {
        for (const edge of [4, 8, 12]) {
          filterSimpleEdge(yPlane, y + edge, 1, yPlane.stride, 16, subblockLimit)
        }
      }
      if (imageRow > 0) filterSimpleEdge(yPlane, y, yPlane.stride, 1, 16, macroblockLimit)
      if (subblocks) {
        for (const edge of [4, 8, 12]) {
          filterSimpleEdge(yPlane, y + edge * yPlane.stride, yPlane.stride, 1, 16, subblockLimit)
        }
      }
      continue
    }
    if (column > 0) {
      filterNormalEdge(yPlane, y, 1, yPlane.stride, 16, level + 2, interior, variance, true)
      filterNormalEdge(uPlane, u, 1, uPlane.stride, 8, level + 2, interior, variance, true)
      filterNormalEdge(vPlane, v, 1, vPlane.stride, 8, level + 2, interior, variance, true)
    }
    if (subblocks) {
      for (const edge of [4, 8, 12]) {
        filterNormalEdge(yPlane, y + edge, 1, yPlane.stride, 16, level, interior, variance, false)
      }
      filterNormalEdge(uPlane, u + 4, 1, uPlane.stride, 8, level, interior, variance, false)
      filterNormalEdge(vPlane, v + 4, 1, vPlane.stride, 8, level, interior, variance, false)
    }
    if (imageRow > 0) {
      filterNormalEdge(yPlane, y, yPlane.stride, 1, 16, level + 2, interior, variance, true)
      filterNormalEdge(uPlane, u, uPlane.stride, 1, 8, level + 2, interior, variance, true)
      filterNormalEdge(vPlane, v, vPlane.stride, 1, 8, level + 2, interior, variance, true)
    }
    if (subblocks) {
      for (const edge of [4, 8, 12]) {
        filterNormalEdge(
          yPlane,
          y + edge * yPlane.stride,
          yPlane.stride,
          1,
          16,
          level,
          interior,
          variance,
          false,
        )
      }
      filterNormalEdge(
        uPlane,
        u + 4 * uPlane.stride,
        uPlane.stride,
        1,
        8,
        level,
        interior,
        variance,
        false,
      )
      filterNormalEdge(
        vPlane,
        v + 4 * vPlane.stride,
        vPlane.stride,
        1,
        8,
        level,
        interior,
        variance,
        false,
      )
    }
  }
}

const yuvToArgb = (y: number, u: number, v: number): number => {
  const luminance = 76283 * Math.max(0, y - 16)
  const blue = clampByte((luminance + 132252 * (u - 128) + 32768) >> 16)
  const green = clampByte((luminance - 25624 * (u - 128) - 53281 * (v - 128) + 32768) >> 16)
  const red = clampByte((luminance + 104595 * (v - 128) + 32768) >> 16)
  return (0xff000000 | (red << 16) | (green << 8) | blue) >>> 0
}

const uint24 = (data: Uint8Array, offset: number): number =>
  (data[offset] ?? 0) | ((data[offset + 1] ?? 0) << 8) | ((data[offset + 2] ?? 0) << 16)

const physicalRowOffset = (plane: Plane, pixelRow: number): number =>
  plane.origin - 1 + pixelRow * plane.stride

const copyPlaneMacroblockRow = (plane: Plane, rowHeight: number): void => {
  const target = physicalRowOffset(plane, 0)
  const source = physicalRowOffset(plane, rowHeight)
  plane.data.copyWithin(target, source, source + rowHeight * plane.stride)
}

const savePlaneRow = (plane: Plane, pixelRow: number): Uint8Array => {
  const offset = physicalRowOffset(plane, pixelRow)
  return plane.data.slice(offset, offset + plane.stride)
}

const restorePlaneRow = (plane: Plane, pixelRow: number, row: Uint8Array): void => {
  plane.data.set(row, physicalRowOffset(plane, pixelRow))
}

const convertVp8Rows = (
  yPlane: Plane,
  uPlane: Plane,
  vPlane: Plane,
  width: number,
  height: number,
): Uint32Array => {
  const pixels = new Uint32Array(width * height)
  const yData = yPlane.data
  const uData = uPlane.data
  const vData = vPlane.data
  let pixelOffset = 0
  for (let y = 0; y < height; y += 1) {
    const yOffset = yPlane.origin + y * yPlane.stride
    const uvOffset = uPlane.origin + (y >> 1) * uPlane.stride
    const vvOffset = vPlane.origin + (y >> 1) * vPlane.stride
    let x = 0
    for (; x + 1 < width; x += 2) {
      const chromaOffset = x >> 1
      const u = uData[uvOffset + chromaOffset] ?? 0
      const v = vData[vvOffset + chromaOffset] ?? 0
      pixels[pixelOffset + x] = yuvToArgb(yData[yOffset + x] ?? 0, u, v)
      pixels[pixelOffset + x + 1] = yuvToArgb(yData[yOffset + x + 1] ?? 0, u, v)
    }
    if (x < width) {
      const chromaOffset = x >> 1
      pixels[pixelOffset + x] = yuvToArgb(
        yData[yOffset + x] ?? 0,
        uData[uvOffset + chromaOffset] ?? 0,
        vData[vvOffset + chromaOffset] ?? 0,
      )
    }
    pixelOffset += width
  }
  return pixels
}

export const decodeVp8 = (
  data: Uint8Array,
  offset: number,
  length: number,
  validateDimensions: (width: number, height: number) => void,
): DecodedVp8 => {
  if (length < 10 || offset < 0 || offset + length > data.byteLength) {
    throw truncatedInput('VP8 key frame is truncated')
  }
  const tag = uint24(data, offset)
  if ((tag & 1) !== 0) throw unsupportedOperation('WebP VP8 interframes are unsupported')
  const version = (tag >>> 1) & 7
  if (version > 3) throw unsupportedOperation(`VP8 bitstream version ${version} is unsupported`)
  const firstPartitionLength = tag >>> 5
  const firstPartitionOffset = offset + 10
  if (firstPartitionOffset + firstPartitionLength > offset + length) {
    throw truncatedInput('VP8 first partition is truncated')
  }
  const width = ((data[offset + 6] ?? 0) | ((data[offset + 7] ?? 0) << 8)) & 0x3fff
  const height = ((data[offset + 8] ?? 0) | ((data[offset + 9] ?? 0) << 8)) & 0x3fff
  validateDimensions(width, height)
  return {
    width,
    height,
    *rows(): IterableIterator<DecodedVp8Rows> {
      const header = new BooleanDecoder(data, firstPartitionOffset, firstPartitionLength)
      if (header.uint(2) !== 0)
        throw unsupportedOperation('VP8 reserved color-space bits are unsupported')
      const segmentation = parseSegmentation(header)
      const loopFilter = parseLoopFilter(header)
      const partitionCount = 1 << header.uint(2)
      const quantization = parseQuantization(header)
      header.bit()
      const probabilities = defaultCoefficientProbabilities.slice()
      for (let index = 0; index < probabilities.length; index += 1) {
        if (header.bit(coefficientUpdateProbabilities[index]) === 1)
          probabilities[index] = header.uint(8)
      }
      const skipEnabled = header.bit() === 1
      const skipProbability = skipEnabled ? header.uint(8) : 0
      const macroblockRows = Math.ceil(height / 16)
      const columns = Math.ceil(width / 16)
      const modeAbove = Array.from({ length: columns }, macroblock)

      const sizeTableOffset = firstPartitionOffset + firstPartitionLength
      const tokenOffset = sizeTableOffset + 3 * (partitionCount - 1)
      if (tokenOffset > offset + length)
        throw truncatedInput('VP8 token partition table is truncated')
      const tokenDecoders: BooleanDecoder[] = []
      let currentOffset = tokenOffset
      for (let index = 0; index < partitionCount; index += 1) {
        const partitionLength =
          index + 1 < partitionCount
            ? uint24(data, sizeTableOffset + index * 3)
            : offset + length - currentOffset
        if (currentOffset + partitionLength > offset + length) {
          throw truncatedInput('VP8 token partition is truncated')
        }
        tokenDecoders.push(new BooleanDecoder(data, currentOffset, partitionLength))
        currentOffset += partitionLength
      }

      const yPlane = createPlane(columns * 16, 32)
      const uPlane = createPlane(columns * 8, 16)
      const vPlane = createPlane(columns * 8, 16)
      const aboveContexts = Array.from({ length: columns }, () => new Int8Array(9))
      const inverseDctTemporary = new Int32Array(16)
      const walshTemporary = new Int32Array(16)
      const walshOutput = new Int32Array(16)
      const coefficients = new Int32Array(25 * 16)
      const factors = Array.from({ length: 4 }, (_, segment) =>
        factorSet(segment, segmentation, quantization),
      )
      let unfilteredYAbove: Uint8Array | undefined
      let unfilteredUAbove: Uint8Array | undefined
      let unfilteredVAbove: Uint8Array | undefined

      for (let row = 0; row < macroblockRows; row += 1) {
        const planeRow = row === 0 ? 0 : 1
        let filteredYAbove: Uint8Array | undefined
        let filteredUAbove: Uint8Array | undefined
        let filteredVAbove: Uint8Array | undefined
        if (row > 0) {
          filteredYAbove = savePlaneRow(yPlane, 15)
          filteredUAbove = savePlaneRow(uPlane, 7)
          filteredVAbove = savePlaneRow(vPlane, 7)
          if (!unfilteredYAbove || !unfilteredUAbove || !unfilteredVAbove) {
            throw invalidInput('VP8 predictor row is missing')
          }
          restorePlaneRow(yPlane, 15, unfilteredYAbove)
          restorePlaneRow(uPlane, 7, unfilteredUAbove)
          restorePlaneRow(vPlane, 7, unfilteredVAbove)
        }

        const blocks = decodeModeRow(
          header,
          columns,
          modeAbove,
          segmentation,
          skipEnabled,
          skipProbability,
        )
        const leftContext = new Int8Array(9)
        const tokenDecoder = tokenDecoders[row % partitionCount]
        if (!tokenDecoder) throw invalidInput('VP8 token partition is missing')
        for (let column = 0; column < columns; column += 1) {
          const block = blocks[column]
          const aboveContext = aboveContexts[column]
          if (!block || !aboveContext) throw invalidInput('VP8 macroblock state is missing')
          if (block.skip) {
            coefficients.fill(0)
            leftContext.fill(0, 0, 8)
            aboveContext.fill(0, 0, 8)
            if (block.yMode !== BLOCK) {
              leftContext[8] = 0
              aboveContext[8] = 0
            }
          } else {
            decodeMacroblockCoefficients(
              tokenDecoder,
              probabilities,
              block,
              factors[block.segment] ?? factorSet(0, segmentation, quantization),
              leftContext,
              aboveContext,
              coefficients,
            )
          }
          reconstruct(
            yPlane,
            uPlane,
            vPlane,
            planeRow,
            column,
            block,
            coefficients,
            column + 1 === columns,
            inverseDctTemporary,
            walshTemporary,
            walshOutput,
          )
        }

        unfilteredYAbove = savePlaneRow(yPlane, planeRow * 16 + 15)
        unfilteredUAbove = savePlaneRow(uPlane, planeRow * 8 + 7)
        unfilteredVAbove = savePlaneRow(vPlane, planeRow * 8 + 7)
        if (row > 0) {
          if (!filteredYAbove || !filteredUAbove || !filteredVAbove) {
            throw invalidInput('VP8 filtered row is missing')
          }
          restorePlaneRow(yPlane, 15, filteredYAbove)
          restorePlaneRow(uPlane, 7, filteredUAbove)
          restorePlaneRow(vPlane, 7, filteredVAbove)
        }
        applyLoopFilterRow(yPlane, uPlane, vPlane, blocks, planeRow, row, segmentation, loopFilter)

        if (row > 0) {
          const outputY = (row - 1) * 16
          const outputHeight = Math.min(16, height - outputY)
          yield {
            y: outputY,
            height: outputHeight,
            pixels: convertVp8Rows(yPlane, uPlane, vPlane, width, outputHeight),
          }
          copyPlaneMacroblockRow(yPlane, 16)
          copyPlaneMacroblockRow(uPlane, 8)
          copyPlaneMacroblockRow(vPlane, 8)
        }
      }

      const outputY = (macroblockRows - 1) * 16
      const outputHeight = height - outputY
      yield {
        y: outputY,
        height: outputHeight,
        pixels: convertVp8Rows(yPlane, uPlane, vPlane, width, outputHeight),
      }
    },
  }
}
