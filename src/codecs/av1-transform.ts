import { invalidInput, unsupportedOperation } from '../errors.ts'
import type { Av1FrameHeader } from './av1-frame.ts'

const dcQuant8 = [
  4, 8, 8, 9, 10, 11, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 23, 24, 25, 26, 26, 27,
  28, 29, 30, 31, 32, 32, 33, 34, 35, 36, 37, 38, 38, 39, 40, 41, 42, 43, 43, 44, 45, 46, 47, 48,
  48, 49, 50, 51, 52, 53, 53, 54, 55, 56, 57, 57, 58, 59, 60, 61, 62, 62, 63, 64, 65, 66, 66, 67,
  68, 69, 70, 70, 71, 72, 73, 74, 74, 75, 76, 77, 78, 78, 79, 80, 81, 81, 82, 83, 84, 85, 85, 87,
  88, 90, 92, 93, 95, 96, 98, 99, 101, 102, 104, 105, 107, 108, 110, 111, 113, 114, 116, 117, 118,
  120, 121, 123, 125, 127, 129, 131, 134, 136, 138, 140, 142, 144, 146, 148, 150, 152, 154, 156,
  158, 161, 164, 166, 169, 172, 174, 177, 180, 182, 185, 187, 190, 192, 195, 199, 202, 205, 208,
  211, 214, 217, 220, 223, 226, 230, 233, 237, 240, 243, 247, 250, 253, 257, 261, 265, 269, 272,
  276, 280, 284, 288, 292, 296, 300, 304, 309, 313, 317, 322, 326, 330, 335, 340, 344, 349, 354,
  359, 364, 369, 374, 379, 384, 389, 395, 400, 406, 411, 417, 423, 429, 435, 441, 447, 454, 461,
  467, 475, 482, 489, 497, 505, 513, 522, 530, 539, 549, 559, 569, 579, 590, 602, 614, 626, 640,
  654, 668, 684, 700, 717, 736, 755, 775, 796, 819, 843, 869, 896, 925, 955, 988, 1022, 1058, 1098,
  1139, 1184, 1232, 1282, 1336,
] as const
const acQuant8 = [
  4, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31,
  32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55,
  56, 57, 58, 59, 60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71, 72, 73, 74, 75, 76, 77, 78, 79,
  80, 81, 82, 83, 84, 85, 86, 87, 88, 89, 90, 91, 92, 93, 94, 95, 96, 97, 98, 99, 100, 101, 102,
  104, 106, 108, 110, 112, 114, 116, 118, 120, 122, 124, 126, 128, 130, 132, 134, 136, 138, 140,
  142, 144, 146, 148, 150, 152, 155, 158, 161, 164, 167, 170, 173, 176, 179, 182, 185, 188, 191,
  194, 197, 200, 203, 207, 211, 215, 219, 223, 227, 231, 235, 239, 243, 247, 251, 255, 260, 265,
  270, 275, 280, 285, 290, 295, 300, 305, 311, 317, 323, 329, 335, 341, 347, 353, 359, 366, 373,
  380, 387, 394, 401, 408, 416, 424, 432, 440, 448, 456, 465, 474, 483, 492, 501, 510, 520, 530,
  540, 550, 560, 571, 582, 593, 604, 615, 627, 639, 651, 663, 676, 689, 702, 715, 729, 743, 757,
  771, 786, 801, 816, 832, 848, 864, 881, 898, 915, 933, 951, 969, 988, 1007, 1026, 1046, 1066,
  1087, 1108, 1129, 1151, 1173, 1196, 1219, 1243, 1267, 1292, 1317, 1343, 1369, 1396, 1423, 1451,
  1479, 1508, 1537, 1567, 1597, 1628, 1660, 1692, 1725, 1759, 1793, 1828,
] as const

const roundedShift = (value: number, bits: number): number =>
  bits === 0 ? value : Math.floor((value + 2 ** (bits - 1)) / 2 ** bits)

const cosine = (angle: number): number => Math.round(4096 * Math.cos((angle * Math.PI) / 128))
const sine = (angle: number): number => cosine(angle - 64)

const butterfly = (
  values: number[],
  first: number,
  second: number,
  angle: number,
  flip: boolean,
): void => {
  const left = values[first] ?? 0
  const right = values[second] ?? 0
  const outputLeft = roundedShift(left * cosine(angle) - right * sine(angle), 12)
  const outputRight = roundedShift(left * sine(angle) + right * cosine(angle), 12)
  values[first] = flip ? outputRight : outputLeft
  values[second] = flip ? outputLeft : outputRight
}

const hadamard = (values: number[], first: number, second: number, flip = false): void => {
  const leftIndex = flip ? second : first
  const rightIndex = flip ? first : second
  const left = values[leftIndex] ?? 0
  const right = values[rightIndex] ?? 0
  values[leftIndex] = left + right
  values[rightIndex] = left - right
}

const inverseAdst4 = (input: ArrayLike<number>): readonly number[] => {
  const first = input[0] ?? 0
  const second = input[1] ?? 0
  const third = input[2] ?? 0
  const fourth = input[3] ?? 0
  let s0 = 1321 * first + 3803 * third
  let s1 = 2482 * first - 1321 * third
  const s3 = 3344 * second
  const s2 = 3344 * (first - third + fourth)
  s0 += 2482 * fourth
  s1 -= 3803 * fourth
  return [
    roundedShift(s0 + s3, 12),
    roundedShift(s1 + s3, 12),
    roundedShift(s2, 12),
    roundedShift(s0 + s1 - s3, 12),
  ]
}

const reversedBits = (value: number, bits: number): number => {
  let result = 0
  for (let index = 0; index < bits; index += 1)
    result |= ((value >> index) & 1) << (bits - 1 - index)
  return result
}

const inverseDct = (input: ArrayLike<number>): readonly number[] => {
  const bits = Math.log2(input.length)
  if (bits !== 2 && bits !== 3)
    throw unsupportedOperation(`Unsupported AV1 inverse DCT length ${input.length}`)
  const values = Array.from(
    { length: input.length },
    (_, index) => input[reversedBits(index, bits)] ?? 0,
  )
  if (bits >= 3) {
    butterfly(values, 4, 7, 56, false)
    butterfly(values, 5, 6, 24, false)
  }
  butterfly(values, 0, 1, 32, true)
  butterfly(values, 2, 3, 48, false)
  if (bits >= 3) {
    hadamard(values, 4, 5)
    hadamard(values, 6, 7, true)
  }
  hadamard(values, 0, 3)
  hadamard(values, 1, 2)
  if (bits >= 3) {
    butterfly(values, 6, 5, 32, true)
    for (let index = 0; index < 4; index += 1) hadamard(values, index, 7 - index)
  }
  return values
}

const inverseAdst8 = (input: ArrayLike<number>): readonly number[] => {
  const copied = Array.from(input)
  const values = Array.from({ length: 8 }, (_, index) => {
    const source = (index & 1) === 1 ? index - 1 : 7 - index
    return copied[source] ?? 0
  })
  for (let index = 0; index < 4; index += 1)
    butterfly(values, 2 * index, 2 * index + 1, 60 - 16 * index, true)
  for (let index = 0; index < 4; index += 1) hadamard(values, index, 4 + index)
  butterfly(values, 4, 5, 48, true)
  butterfly(values, 7, 6, 16, true)
  for (let index = 0; index < 2; index += 1) {
    hadamard(values, index, 2 + index)
    hadamard(values, 4 + index, 6 + index)
  }
  butterfly(values, 2, 3, 32, true)
  butterfly(values, 6, 7, 32, true)
  const output = [...values]
  for (let index = 0; index < 8; index += 1) {
    const a = (index >> 3) & 1
    const b = ((index >> 2) & 1) ^ ((index >> 3) & 1)
    const c = ((index >> 1) & 1) ^ ((index >> 2) & 1)
    const d = (index & 1) ^ ((index >> 1) & 1)
    const source = ((d << 3) | (c << 2) | (b << 1) | a) >> 1
    output[index] = (index & 1) === 1 ? -(values[source] ?? 0) : (values[source] ?? 0)
  }
  return output
}

const oneDimensional = (input: ArrayLike<number>, adst: boolean): readonly number[] => {
  if (!adst) return inverseDct(input)
  if (input.length === 4) return inverseAdst4(input)
  if (input.length === 8) return inverseAdst8(input)
  throw unsupportedOperation(`Unsupported AV1 inverse ADST length ${input.length}`)
}

export const inverseTransformSquare = (
  quantized: Int32Array,
  size: 4 | 8,
  transformType: number,
  plane: 0 | 1 | 2,
  header: Av1FrameHeader,
): Int32Array => {
  if (transformType < 0 || transformType > 3) {
    throw unsupportedOperation(`Unsupported AV1 transform type ${transformType}`)
  }
  const dcDelta = plane === 0 ? header.deltaYDc : plane === 1 ? header.deltaUDc : header.deltaVDc
  const acDelta = plane === 0 ? 0 : plane === 1 ? header.deltaUAc : header.deltaVAc
  const dc = dcQuant8[Math.max(0, Math.min(255, header.baseQuantizer + dcDelta))]
  const ac = acQuant8[Math.max(0, Math.min(255, header.baseQuantizer + acDelta))]
  if (dc === undefined || ac === undefined) throw invalidInput('AV1 quantizer index is invalid')

  const dequantized = new Int32Array(size * size)
  for (let index = 0; index < dequantized.length; index += 1) {
    dequantized[index] = Math.max(
      -32768,
      Math.min(32767, (quantized[index] ?? 0) * (index === 0 ? dc : ac)),
    )
  }
  const intermediate = new Int32Array(size * size)
  const rowUsesAdst = transformType === 2 || transformType === 3
  const columnUsesAdst = transformType === 1 || transformType === 3
  const rowShift = size === 8 ? 1 : 0
  for (let row = 0; row < size; row += 1) {
    const transformed = oneDimensional(
      dequantized.subarray(row * size, row * size + size),
      rowUsesAdst,
    )
    for (let column = 0; column < size; column += 1) {
      intermediate[row * size + column] = roundedShift(transformed[column] ?? 0, rowShift)
    }
  }
  const residual = new Int32Array(size * size)
  for (let column = 0; column < size; column += 1) {
    const transformed = oneDimensional(
      Array.from({ length: size }, (_, row) => intermediate[row * size + column] ?? 0),
      columnUsesAdst,
    )
    for (let row = 0; row < size; row += 1) {
      residual[row * size + column] = roundedShift(transformed[row] ?? 0, 4)
    }
  }
  return residual
}
