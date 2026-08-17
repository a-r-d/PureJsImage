import { invalidInput, unsupportedOperation } from '../errors.ts'
import type { Av1FrameHeader } from './av1-frame.ts'
import { av1InverseQuantizationMatrix } from './av1-qmatrix.ts'
import { av1AcQuantizers, av1DcQuantizers } from './av1-quant.ts'

const roundedShift = (value: number, bits: number): number =>
  bits === 0 ? value : Math.floor((value + 2 ** (bits - 1)) / 2 ** bits)

const cosineTable = Int16Array.from({ length: 256 }, (_, angle) =>
  Math.round(4096 * Math.cos((angle * Math.PI) / 128)),
)
const cosine = (angle: number): number => cosineTable[angle & 255] ?? 0
const sine = (angle: number): number => cosine(angle - 64)

let transformClampMinimum = -32768
let transformClampMaximum = 32767
const clampTransform = (value: number): number =>
  Math.max(transformClampMinimum, Math.min(transformClampMaximum, value))

const butterfly = (
  values: Int32Array,
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

const hadamard = (values: Int32Array, first: number, second: number, flip = false): void => {
  const leftIndex = flip ? second : first
  const rightIndex = flip ? first : second
  const left = values[leftIndex] ?? 0
  const right = values[rightIndex] ?? 0
  values[leftIndex] = clampTransform(left + right)
  values[rightIndex] = clampTransform(left - right)
}

const transformValues = new Int32Array(64)
const transformOutput = new Int32Array(64)
const dequantScratch = new Int32Array(4096)
const intermediateScratch = new Int32Array(4096)
const residualScratch = new Int32Array(4096)
const columnInputScratch = new Int32Array(64)

const inverseAdst4 = (input: ArrayLike<number>): Int32Array => {
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
  transformOutput[0] = roundedShift(s0 + s3, 12)
  transformOutput[1] = roundedShift(s1 + s3, 12)
  transformOutput[2] = roundedShift(s2, 12)
  transformOutput[3] = roundedShift(s0 + s1 - s3, 12)
  return transformOutput
}

const reversedBits = (value: number, bits: number): number => {
  let result = 0
  for (let index = 0; index < bits; index += 1)
    result |= ((value >> index) & 1) << (bits - 1 - index)
  return result
}

const inverseDct = (input: ArrayLike<number>): Int32Array => {
  const bits = Math.log2(input.length)
  if (bits !== 2 && bits !== 3 && bits !== 4 && bits !== 5 && bits !== 6)
    throw unsupportedOperation(`Unsupported AV1 inverse DCT length ${input.length}`)
  const values = transformValues
  for (let index = 0; index < input.length; index += 1) {
    values[index] = input[reversedBits(index, bits)] ?? 0
  }
  if (bits === 6) {
    for (let index = 0; index < 16; index += 1) {
      butterfly(values, 32 + index, 63 - index, 63 - 4 * reversedBits(index, 4), false)
    }
  }
  if (bits >= 5) {
    for (let index = 0; index < 8; index += 1) {
      butterfly(values, 16 + index, 31 - index, 6 + (reversedBits(7 - index, 3) << 3), false)
    }
  }
  if (bits === 6) {
    for (let index = 0; index < 16; index += 1) {
      hadamard(values, 32 + 2 * index, 33 + 2 * index, (index & 1) === 1)
    }
  }
  if (bits >= 4) {
    for (let index = 0; index < 4; index += 1) {
      butterfly(values, 8 + index, 15 - index, 12 + (reversedBits(3 - index, 2) << 4), false)
    }
  }
  if (bits >= 5) {
    for (let index = 0; index < 8; index += 1) {
      hadamard(values, 16 + 2 * index, 17 + 2 * index, (index & 1) === 1)
    }
  }
  if (bits === 6) {
    for (let index = 0; index < 4; index += 1) {
      for (let inner = 0; inner < 2; inner += 1) {
        butterfly(
          values,
          62 - index * 4 - inner,
          33 + index * 4 + inner,
          60 - 16 * reversedBits(index, 2) + (inner << 6),
          true,
        )
      }
    }
  }
  if (bits >= 3) {
    butterfly(values, 4, 7, 56, false)
    butterfly(values, 5, 6, 24, false)
  }
  if (bits >= 4) {
    for (let index = 0; index < 4; index += 1) {
      hadamard(values, 8 + 2 * index, 9 + 2 * index, (index & 1) === 1)
    }
  }
  if (bits >= 5) {
    for (let index = 0; index < 2; index += 1) {
      for (let inner = 0; inner < 2; inner += 1) {
        butterfly(
          values,
          30 - 4 * index - inner,
          17 + 4 * index + inner,
          24 + (inner << 6) + ((1 - index) << 5),
          true,
        )
      }
    }
  }
  if (bits === 6) {
    for (let index = 0; index < 8; index += 1) {
      for (let inner = 0; inner < 2; inner += 1) {
        hadamard(values, 32 + index * 4 + inner, 35 + index * 4 - inner, (index & 1) === 1)
      }
    }
  }
  butterfly(values, 0, 1, 32, true)
  butterfly(values, 2, 3, 48, false)
  if (bits >= 3) {
    hadamard(values, 4, 5)
    hadamard(values, 6, 7, true)
  }
  if (bits >= 4) {
    butterfly(values, 14, 9, 48, true)
    butterfly(values, 13, 10, 112, true)
  }
  if (bits >= 5) {
    for (let index = 0; index < 4; index += 1) {
      for (let inner = 0; inner < 2; inner += 1) {
        hadamard(values, 16 + 4 * index + inner, 19 + 4 * index - inner, (index & 1) === 1)
      }
    }
  }
  if (bits === 6) {
    for (let index = 0; index < 2; index += 1) {
      for (let inner = 0; inner < 4; inner += 1) {
        butterfly(
          values,
          61 - index * 8 - inner,
          34 + index * 8 + inner,
          56 - index * 32 + ((inner >> 1) << 6),
          true,
        )
      }
    }
  }
  hadamard(values, 0, 3)
  hadamard(values, 1, 2)
  if (bits >= 3) {
    butterfly(values, 6, 5, 32, true)
    if (bits >= 4) {
      for (let index = 0; index < 2; index += 1) {
        for (let inner = 0; inner < 2; inner += 1) {
          hadamard(values, 8 + 4 * index + inner, 11 + 4 * index - inner, index === 1)
        }
      }
    }
    if (bits >= 5) {
      for (let index = 0; index < 4; index += 1) {
        butterfly(values, 29 - index, 18 + index, 48 + ((index >> 1) << 6), true)
      }
    }
    if (bits === 6) {
      for (let index = 0; index < 4; index += 1) {
        for (let inner = 0; inner < 4; inner += 1) {
          hadamard(values, 32 + index * 8 + inner, 39 + index * 8 - inner, (index & 1) === 1)
        }
      }
    }
    for (let index = 0; index < 4; index += 1) hadamard(values, index, 7 - index)
  }
  if (bits >= 4) {
    butterfly(values, 13, 10, 32, true)
    butterfly(values, 12, 11, 32, true)
    if (bits >= 5) {
      for (let index = 0; index < 2; index += 1) {
        for (let inner = 0; inner < 4; inner += 1) {
          hadamard(values, 16 + index * 8 + inner, 23 + index * 8 - inner, index === 1)
        }
      }
    }
    if (bits === 6) {
      for (let index = 0; index < 8; index += 1) {
        butterfly(values, 59 - index, 36 + index, index < 4 ? 48 : 112, true)
      }
    }
    for (let index = 0; index < 8; index += 1) hadamard(values, index, 15 - index)
  }
  if (bits >= 5) {
    for (let index = 0; index < 4; index += 1) {
      butterfly(values, 27 - index, 20 + index, 32, true)
    }
    if (bits === 6) {
      for (let index = 0; index < 8; index += 1) {
        hadamard(values, 32 + index, 47 - index)
        hadamard(values, 48 + index, 63 - index, true)
      }
    }
    for (let index = 0; index < 16; index += 1) hadamard(values, index, 31 - index)
  }
  if (bits === 6) {
    for (let index = 0; index < 8; index += 1) {
      butterfly(values, 55 - index, 40 + index, 32, true)
    }
    for (let index = 0; index < 32; index += 1) hadamard(values, index, 63 - index)
  }
  return values
}

const inverseAdst8 = (input: ArrayLike<number>): Int32Array => {
  const values = transformValues
  for (let index = 0; index < 8; index += 1) {
    const source = (index & 1) === 1 ? index - 1 : 7 - index
    values[index] = input[source] ?? 0
  }
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
  const output = transformOutput
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

const inverseAdst16 = (input: ArrayLike<number>): Int32Array => {
  const values = transformValues
  for (let index = 0; index < 16; index += 1) {
    const source = (index & 1) === 1 ? index - 1 : 15 - index
    values[index] = input[source] ?? 0
  }
  for (let index = 0; index < 8; index += 1) {
    butterfly(values, 2 * index, 2 * index + 1, 62 - 8 * index, true)
  }
  for (let index = 0; index < 8; index += 1) hadamard(values, index, 8 + index)
  for (let index = 0; index < 2; index += 1) {
    butterfly(values, 8 + 2 * index, 9 + 2 * index, 56 - 32 * index, true)
    butterfly(values, 13 + 2 * index, 12 + 2 * index, 8 + 32 * index, true)
  }
  for (let index = 0; index < 4; index += 1) {
    for (let group = 0; group < 2; group += 1) {
      hadamard(values, 8 * group + index, 4 + 8 * group + index)
    }
  }
  for (let index = 0; index < 2; index += 1) {
    for (let group = 0; group < 2; group += 1) {
      butterfly(values, 4 + 8 * group + 3 * index, 5 + 8 * group + index, 48 - 32 * index, true)
    }
  }
  for (let index = 0; index < 2; index += 1) {
    for (let group = 0; group < 4; group += 1) {
      hadamard(values, 4 * group + index, 2 + 4 * group + index)
    }
  }
  for (let index = 0; index < 4; index += 1) {
    butterfly(values, 2 + 4 * index, 3 + 4 * index, 32, true)
  }
  const output = transformOutput
  for (let index = 0; index < 16; index += 1) {
    const a = (index >> 3) & 1
    const b = ((index >> 2) & 1) ^ a
    const c = ((index >> 1) & 1) ^ ((index >> 2) & 1)
    const d = (index & 1) ^ ((index >> 1) & 1)
    const source = (d << 3) | (c << 2) | (b << 1) | a
    output[index] = (index & 1) === 1 ? -(values[source] ?? 0) : (values[source] ?? 0)
  }
  return output
}

const oneDimensional = (input: ArrayLike<number>, adst: boolean): Int32Array => {
  if (!adst) return inverseDct(input)
  if (input.length === 4) return inverseAdst4(input)
  if (input.length === 8) return inverseAdst8(input)
  if (input.length === 16) return inverseAdst16(input)
  throw unsupportedOperation(`Unsupported AV1 inverse ADST length ${input.length}`)
}

const inverseIdentity = (input: ArrayLike<number>): Int32Array => {
  let multiplier: number
  let shift = 0
  if (input.length === 4) {
    multiplier = 5793
    shift = 12
  } else if (input.length === 8) multiplier = 2
  else if (input.length === 16) {
    multiplier = 11586
    shift = 12
  } else if (input.length === 32) multiplier = 4
  else throw unsupportedOperation(`Unsupported AV1 inverse identity length ${input.length}`)
  const output = transformOutput
  for (let index = 0; index < input.length; index += 1) {
    const value = (input[index] ?? 0) * multiplier
    output[index] = shift === 0 ? value : roundedShift(value, shift)
  }
  return output
}
const inverseWht4 = (input: ArrayLike<number>, shift: number): Int32Array => {
  let a = (input[0] ?? 0) >> shift
  let c = (input[1] ?? 0) >> shift
  let d = (input[2] ?? 0) >> shift
  let b = (input[3] ?? 0) >> shift
  a += c
  d -= b
  const e = (a - d) >> 1
  b = e - b
  c = e - c
  a -= b
  d += c
  transformOutput[0] = a
  transformOutput[1] = b
  transformOutput[2] = c
  transformOutput[3] = d
  return transformOutput
}

const rowDctMask = (1 << 0) | (1 << 1) | (1 << 4) | (1 << 11)
const rowAdstMask =
  (1 << 2) | (1 << 3) | (1 << 5) | (1 << 6) | (1 << 7) | (1 << 8) | (1 << 13) | (1 << 15)
const columnDctMask = (1 << 0) | (1 << 2) | (1 << 5) | (1 << 10)
const columnAdstMask =
  (1 << 1) | (1 << 3) | (1 << 4) | (1 << 6) | (1 << 7) | (1 << 8) | (1 << 12) | (1 << 14)
const flippedRowMask = (1 << 4) | (1 << 6) | (1 << 8) | (1 << 14)
const flippedColumnMask = (1 << 5) | (1 << 6) | (1 << 7) | (1 << 15)

const dequantizeAv1Coefficients = (
  quantized: Int32Array,
  width: 4 | 8 | 16 | 32 | 64,
  height: 4 | 8 | 16 | 32 | 64,
  transformType: number,
  plane: 0 | 1 | 2,
  header: Av1FrameHeader,
  quantizer: number,
  bitDepth: 8 | 10 | 12,
): Int32Array => {
  const dcDelta = plane === 0 ? header.deltaYDc : plane === 1 ? header.deltaUDc : header.deltaVDc
  const acDelta = plane === 0 ? 0 : plane === 1 ? header.deltaUAc : header.deltaVAc
  const depthIndex = (bitDepth - 8) >> 1
  const dc = av1DcQuantizers[depthIndex]?.[Math.max(0, Math.min(255, quantizer + dcDelta))]
  const ac = av1AcQuantizers[depthIndex]?.[Math.max(0, Math.min(255, quantizer + acDelta))]
  if (dc === undefined || ac === undefined) throw invalidInput('AV1 quantizer index is invalid')
  const matrixLevel = plane === 0 ? header.qmY : plane === 1 ? header.qmU : header.qmV
  const matrix =
    header.usingQMatrix && !header.codedLossless && transformType < 9
      ? av1InverseQuantizationMatrix(matrixLevel, plane, width, height)
      : undefined

  const dequantized = dequantScratch
  const coefficientCount = width * height
  const matrixWidth = Math.min(width, 32)
  const matrixHeight = Math.min(height, 32)
  const rectangularScale = width * 2 === height || height * 2 === width
  const sizeContext = (Math.log2(width >> 2) + Math.log2(height >> 2) + 1) >> 1
  const dequantizerDivisor = 2 ** Math.max(0, sizeContext - 2)
  for (let index = 0; index < coefficientCount; index += 1) {
    const quantization = index === 0 ? dc : ac
    const row = Math.floor(index / width)
    const column = index % width
    // Transform coefficients use the opposite axis order from the normative matrix tables.
    const matrixWeight =
      matrix && row < matrixHeight && column < matrixWidth
        ? (matrix[column * matrixHeight + row] ?? 32)
        : 32
    const weighted = matrix ? roundedShift(quantization * matrixWeight, 5) : quantization
    const scaled = (quantized[index] ?? 0) * weighted
    const coefficientLimit = 2 ** (bitDepth + 7)
    const value = Math.max(
      -coefficientLimit,
      Math.min(
        coefficientLimit - 1,
        Math.sign(scaled) * Math.floor(Math.abs(scaled) / dequantizerDivisor),
      ),
    )
    dequantized[index] = rectangularScale ? roundedShift(value * 181, 8) : value
  }
  return dequantized
}

export const inverseTransform = (
  quantized: Int32Array,
  width: 4 | 8 | 16 | 32 | 64,
  height: 4 | 8 | 16 | 32 | 64,
  transformType: number,
  plane: 0 | 1 | 2,
  header: Av1FrameHeader,
  quantizer = header.baseQuantizer,
  bitDepth: 8 | 10 | 12 = 8,
): Int32Array => {
  if (transformType < 0 || transformType > 15) {
    throw unsupportedOperation(`Unsupported AV1 transform type ${transformType}`)
  }
  const dequantized = dequantizeAv1Coefficients(
    quantized,
    width,
    height,
    transformType,
    plane,
    header,
    quantizer,
    bitDepth,
  )
  if (header.codedLossless) {
    if (width !== 4 || height !== 4) {
      throw invalidInput(
        `Lossless AV1 transform dimensions must be 4x4, received ${width}x${height}`,
      )
    }
    const intermediate = intermediateScratch
    for (let row = 0; row < 4; row += 1) {
      const transformed = inverseWht4(dequantized.subarray(row * 4, row * 4 + 4), 2)
      for (let column = 0; column < 4; column += 1) {
        intermediate[row * 4 + column] = transformed[column] ?? 0
      }
    }
    const residual = residualScratch.subarray(0, 16)
    const columnInput = columnInputScratch
    for (let column = 0; column < 4; column += 1) {
      for (let row = 0; row < 4; row += 1) {
        columnInput[row] = intermediate[row * 4 + column] ?? 0
      }
      const transformed = inverseWht4(columnInput, 0)
      for (let row = 0; row < 4; row += 1) {
        residual[row * 4 + column] = transformed[row] ?? 0
      }
    }
    return residual
  }
  const intermediate = intermediateScratch
  const rowUsesDct = ((rowDctMask >>> transformType) & 1) !== 0
  const rowUsesAdst = ((rowAdstMask >>> transformType) & 1) !== 0
  const columnUsesDct = ((columnDctMask >>> transformType) & 1) !== 0
  const columnUsesAdst = ((columnAdstMask >>> transformType) & 1) !== 0
  const rowShift =
    width === height
      ? width >= 16
        ? 2
        : width === 8
          ? 1
          : 0
      : Math.max(width, height) / Math.min(width, height) >= 4
        ? Math.max(width, height) >= 32
          ? 2
          : 1
        : Math.min(width, height) >= 8
          ? 1
          : 0
  const rowClampMinimum = bitDepth === 8 ? -32768 : -(2 ** (bitDepth + 7))
  const rowClampMaximum = -rowClampMinimum - 1
  const columnClampMinimum = bitDepth === 8 ? -32768 : -(2 ** (bitDepth + 5))
  const columnClampMaximum = -columnClampMinimum - 1
  transformClampMinimum = rowClampMinimum
  transformClampMaximum = rowClampMaximum
  for (let row = 0; row < height; row += 1) {
    const rowOrigin = row * width
    let nonzero = false
    for (let column = 0; column < width; column += 1) {
      if ((dequantized[rowOrigin + column] ?? 0) !== 0) {
        nonzero = true
        break
      }
    }
    if (!nonzero) {
      for (let column = 0; column < width; column += 1) intermediate[rowOrigin + column] = 0
      continue
    }
    const input = dequantized.subarray(rowOrigin, rowOrigin + width)
    const transformed =
      rowUsesDct || rowUsesAdst ? oneDimensional(input, rowUsesAdst) : inverseIdentity(input)
    for (let column = 0; column < width; column += 1) {
      intermediate[rowOrigin + column] = Math.max(
        columnClampMinimum,
        Math.min(columnClampMaximum, roundedShift(transformed[column] ?? 0, rowShift)),
      )
    }
  }
  transformClampMinimum = columnClampMinimum
  transformClampMaximum = columnClampMaximum
  const residual = residualScratch.subarray(0, width * height)
  const columnInput = columnInputScratch.subarray(0, height)
  for (let column = 0; column < width; column += 1) {
    let nonzero = false
    for (let row = 0; row < height; row += 1) {
      const sample = intermediate[row * width + column] ?? 0
      columnInput[row] = sample
      if (sample !== 0) nonzero = true
    }
    if (!nonzero) {
      const targetColumn =
        ((flippedColumnMask >>> transformType) & 1) !== 0 ? width - column - 1 : column
      for (let row = 0; row < height; row += 1) {
        const targetRow = ((flippedRowMask >>> transformType) & 1) !== 0 ? height - row - 1 : row
        residual[targetRow * width + targetColumn] = 0
      }
      continue
    }
    const transformed =
      columnUsesDct || columnUsesAdst
        ? oneDimensional(columnInput, columnUsesAdst)
        : inverseIdentity(columnInput)
    for (let row = 0; row < height; row += 1) {
      const targetRow = ((flippedRowMask >>> transformType) & 1) !== 0 ? height - row - 1 : row
      const targetColumn =
        ((flippedColumnMask >>> transformType) & 1) !== 0 ? width - column - 1 : column
      residual[targetRow * width + targetColumn] = roundedShift(transformed[row] ?? 0, 4)
    }
  }
  return residual
}
