import { invalidInput, unsupportedOperation } from '../errors.ts'

const LEVEL_SCALE = [40, 45, 51, 57, 64, 72] as const

// The first 16 columns of the integer transform matrix from H.265 8.6.4.2.
// The remaining columns are its even/odd mirror, which avoids storing a
// second copy of the same constants.
const TRANSFORM_FIRST_HALF: readonly (readonly number[])[] = [
  [64, 64, 64, 64, 64, 64, 64, 64, 64, 64, 64, 64, 64, 64, 64, 64],
  [90, 90, 88, 85, 82, 78, 73, 67, 61, 54, 46, 38, 31, 22, 13, 4],
  [90, 87, 80, 70, 57, 43, 25, 9, -9, -25, -43, -57, -70, -80, -87, -90],
  [90, 82, 67, 46, 22, -4, -31, -54, -73, -85, -90, -88, -78, -61, -38, -13],
  [89, 75, 50, 18, -18, -50, -75, -89, -89, -75, -50, -18, 18, 50, 75, 89],
  [88, 67, 31, -13, -54, -82, -90, -78, -46, -4, 38, 73, 90, 85, 61, 22],
  [87, 57, 9, -43, -80, -90, -70, -25, 25, 70, 90, 80, 43, -9, -57, -87],
  [85, 46, -13, -67, -90, -73, -22, 38, 82, 88, 54, -4, -61, -90, -78, -31],
  [83, 36, -36, -83, -83, -36, 36, 83, 83, 36, -36, -83, -83, -36, 36, 83],
  [82, 22, -54, -90, -61, 13, 78, 85, 31, -46, -90, -67, 4, 73, 88, 38],
  [80, 9, -70, -87, -25, 57, 90, 43, -43, -90, -57, 25, 87, 70, -9, -80],
  [78, -4, -82, -73, 13, 85, 67, -22, -88, -61, 31, 90, 54, -38, -90, -46],
  [75, -18, -89, -50, 50, 89, 18, -75, -75, 18, 89, 50, -50, -89, -18, 75],
  [73, -31, -90, -22, 78, 67, -38, -90, -13, 82, 61, -46, -88, -4, 85, 54],
  [70, -43, -87, 9, 90, 25, -80, -57, 57, 80, -25, -90, -9, 87, 43, -70],
  [67, -54, -78, 38, 85, -22, -90, 4, 90, 13, -88, -31, 82, 46, -73, -61],
  [64, -64, -64, 64, 64, -64, -64, 64, 64, -64, -64, 64, 64, -64, -64, 64],
  [61, -73, -46, 82, 31, -88, -13, 90, -4, -90, 22, 85, -38, -78, 54, 67],
  [57, -80, -25, 90, -9, -87, 43, 70, -70, -43, 87, 9, -90, 25, 80, -57],
  [54, -85, -4, 88, -46, -61, 82, 13, -90, 38, 67, -78, -22, 90, -31, -73],
  [50, -89, 18, 75, -75, -18, 89, -50, -50, 89, -18, -75, 75, 18, -89, 50],
  [46, -90, 38, 54, -90, 31, 61, -88, 22, 67, -85, 13, 73, -82, 4, 78],
  [43, -90, 57, 25, -87, 70, 9, -80, 80, -9, -70, 87, -25, -57, 90, -43],
  [38, -88, 73, -4, -67, 90, -46, -31, 85, -78, 13, 61, -90, 54, 22, -82],
  [36, -83, 83, -36, -36, 83, -83, 36, 36, -83, 83, -36, -36, 83, -83, 36],
  [31, -78, 90, -61, 4, 54, -88, 82, -38, -22, 73, -90, 67, -13, -46, 85],
  [25, -70, 90, -80, 43, 9, -57, 87, -87, 57, -9, -43, 80, -90, 70, -25],
  [22, -61, 85, -90, 73, -38, -4, 46, -78, 90, -82, 54, -13, -31, 67, -88],
  [18, -50, 75, -89, 89, -75, 50, -18, -18, 50, -75, 89, -89, 75, -50, 18],
  [13, -38, 61, -78, 88, -90, 85, -73, 54, -31, 4, 22, -46, 67, -82, 90],
  [9, -25, 43, -57, 70, -80, 87, -90, 90, -87, 80, -70, 57, -43, 25, -9],
  [4, -13, 22, -31, 38, -46, 54, -61, 67, -73, 78, -82, 85, -88, 90, -90],
] as const

const DST_4 = [29, 55, 74, 84, 74, 74, 0, -74, 84, -29, -74, 55, 55, -84, 74, -29] as const

const clip = (value: number, minimum: number, maximum: number): number =>
  Math.max(minimum, Math.min(maximum, value))

const roundedShift = (value: number, shift: number): number => {
  if (shift < 1 || shift > 30) throw invalidInput('HEVC transform shift is invalid')
  return Math.floor((value + 2 ** (shift - 1)) / 2 ** shift)
}

const transformCoefficient = (size: number, row: number, column: number): number => {
  const sourceRow = TRANSFORM_FIRST_HALF[column << (5 - Math.log2(size))]
  if (!sourceRow) throw invalidInput('HEVC transform row is invalid')
  if (row < 16) {
    const value = sourceRow[row]
    if (value === undefined) throw invalidInput('HEVC transform column is invalid')
    return value
  }
  const value = sourceRow[31 - row]
  if (value === undefined) throw invalidInput('HEVC transform column is invalid')
  return (column & 1) === 0 ? value : -value
}

const transformOneDimensional = (input: Int32Array, size: number, useDst: boolean): Int32Array => {
  const output = new Int32Array(size)
  for (let row = 0; row < size; row += 1) {
    let sum = 0
    for (let column = 0; column < size; column += 1) {
      const matrix = useDst ? DST_4[column * 4 + row] : transformCoefficient(size, row, column)
      if (matrix === undefined) throw invalidInput('HEVC transform coefficient is missing')
      sum += matrix * (input[column] ?? 0)
    }
    output[row] = sum
  }
  return output
}

export interface HevcInverseTransformOptions {
  readonly bitDepth: number
  readonly component: 0 | 1 | 2
  readonly intra: boolean
  readonly qp: number
  readonly scalingFactors?: Int16Array
  readonly transformSkipped: boolean
  readonly transquantBypass: boolean
}

export const inverseHevcTransform = (
  coefficients: Int32Array,
  size: number,
  options: HevcInverseTransformOptions,
): Int32Array => {
  if (![4, 8, 16, 32].includes(size) || coefficients.length !== size * size) {
    throw invalidInput('HEVC inverse-transform dimensions are invalid')
  }
  if (options.bitDepth !== 8 && options.bitDepth !== 10) {
    throw unsupportedOperation(`Unsupported HEVC transform bit depth: ${options.bitDepth}`)
  }
  const qpOffset = 6 * (options.bitDepth - 8)
  if (!Number.isInteger(options.qp) || options.qp < 0 || options.qp > 51 + qpOffset) {
    throw invalidInput('HEVC transform QP is invalid')
  }
  if (options.scalingFactors && options.scalingFactors.length !== coefficients.length) {
    throw invalidInput('HEVC scaling-list dimensions are invalid')
  }
  if (options.transquantBypass) return coefficients.slice()

  const log2Size = Math.log2(size)
  const scaled = new Int32Array(coefficients.length)
  const scaleShift = options.bitDepth + log2Size + 10 - 15
  const levelScale = LEVEL_SCALE[options.qp % 6]
  if (levelScale === undefined) throw invalidInput('HEVC quantizer scale is invalid')
  const qpScale = 2 ** Math.floor(options.qp / 6)
  for (let index = 0; index < coefficients.length; index += 1) {
    const factor = options.scalingFactors?.[index] ?? 16
    if (factor < 1 || factor > 255) throw invalidInput('HEVC scaling-list factor is invalid')
    scaled[index] = clip(
      roundedShift((coefficients[index] ?? 0) * factor * levelScale * qpScale, scaleShift),
      -32768,
      32767,
    )
  }

  // Extended-precision processing would impose a minimum shift of 11, but
  // range-extension SPS syntax is rejected by the supported profile subset.
  const finalShift = 20 - options.bitDepth
  if (options.transformSkipped) {
    const transformSkipShift = 5 + log2Size
    for (let index = 0; index < scaled.length; index += 1) {
      scaled[index] = roundedShift((scaled[index] ?? 0) * 2 ** transformSkipShift, finalShift)
    }
    return scaled
  }

  const useDst = options.intra && options.component === 0 && size === 4
  const intermediate = new Int32Array(coefficients.length)
  const column = new Int32Array(size)
  for (let x = 0; x < size; x += 1) {
    for (let y = 0; y < size; y += 1) column[y] = scaled[y * size + x] ?? 0
    const transformed = transformOneDimensional(column, size, useDst)
    for (let y = 0; y < size; y += 1) {
      intermediate[y * size + x] = clip(roundedShift(transformed[y] ?? 0, 7), -32768, 32767)
    }
  }
  const output = new Int32Array(coefficients.length)
  const row = new Int32Array(size)
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) row[x] = intermediate[y * size + x] ?? 0
    const transformed = transformOneDimensional(row, size, useDst)
    for (let x = 0; x < size; x += 1) {
      output[y * size + x] = roundedShift(transformed[x] ?? 0, finalShift)
    }
  }
  return output
}
