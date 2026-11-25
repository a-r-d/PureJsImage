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

const inverseAdst4 = (input: Int32Array, offset: number): Int32Array => {
  const first = input[offset] ?? 0
  const second = input[offset + 1] ?? 0
  const third = input[offset + 2] ?? 0
  const fourth = input[offset + 3] ?? 0
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

const dctStages = <T>(
  values: T,
  bits: number,
  butterfly: (values: T, first: number, second: number, angle: number, flip: boolean) => void,
  hadamard: (values: T, first: number, second: number, flip?: boolean) => void,
): void => {
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
}

const inverseDct = (input: Int32Array, offset: number, length: number): Int32Array => {
  const bits = Math.log2(length)
  if (bits !== 2 && bits !== 3 && bits !== 4 && bits !== 5 && bits !== 6)
    throw unsupportedOperation(`Unsupported AV1 inverse DCT length ${length}`)
  const values = transformValues
  for (let index = 0; index < length; index += 1) {
    values[index] = input[offset + reversedBits(index, bits)] ?? 0
  }
  dctStages(values, bits, butterfly, hadamard)
  return values
}

const adst8Stages = <T>(
  values: T,
  butterfly: (values: T, first: number, second: number, angle: number, flip: boolean) => void,
  hadamard: (values: T, first: number, second: number, flip?: boolean) => void,
): void => {
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
}

const adst16Stages = <T>(
  values: T,
  butterfly: (values: T, first: number, second: number, angle: number, flip: boolean) => void,
  hadamard: (values: T, first: number, second: number, flip?: boolean) => void,
): void => {
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
}

// Resolve operand order and rotation coefficients once for every supported length.
const parallelStagePlan = (bits: number, dct: boolean) => {
  const entries: number[] = []
  const rotate = (
    ops: number[],
    left: number,
    right: number,
    angle: number,
    flip: boolean,
  ): void => {
    const cos = cosine(angle)
    const sin = sine(angle)
    ops.push(left, right, flip ? sin : cos, flip ? cos : -sin, flip ? cos : sin, flip ? -sin : cos)
  }
  const add = (ops: number[], left: number, right: number, flip = false): void => {
    // A negative operand marks an add/subtract pair, including index zero.
    ops.push(~(flip ? right : left), flip ? left : right, 0, 0, 0, 0)
  }
  if (dct) dctStages(entries, bits, rotate, add)
  else if (bits === 3) adst8Stages(entries, rotate, add)
  else adst16Stages(entries, rotate, add)
  // Bound each lane by an integer multiple of the largest input sample.
  // Ceil at every rotation also covers its half-up rounding.
  const gains = new Uint16Array(1 << bits).fill(1)
  let maximumGain = 1
  for (let op = 0; op < entries.length; op += 6) {
    const left = entries[op] ?? 0
    const right = entries[op + 1] ?? 0
    if (left < 0) {
      const gain = (gains[~left] ?? 0) + (gains[right] ?? 0)
      gains[~left] = gain
      gains[right] = gain
      maximumGain = Math.max(maximumGain, gain)
    } else {
      const u = gains[left] ?? 0
      const v = gains[right] ?? 0
      gains[left] = Math.ceil(
        (u * Math.abs(entries[op + 2] ?? 0) + v * Math.abs(entries[op + 3] ?? 0)) / 4096,
      )
      gains[right] = Math.ceil(
        (u * Math.abs(entries[op + 4] ?? 0) + v * Math.abs(entries[op + 5] ?? 0)) / 4096,
      )
    }
  }
  return { operations: Int16Array.from(entries), maximumGain }
}
const dctPlans = [2, 3, 4, 5, 6].map((bits) => parallelStagePlan(bits, true))
const adstPlans = [3, 4].map((bits) => parallelStagePlan(bits, false))

const runParallelStages = (values: Int32Array, width: number, bits: number, dct: boolean): void => {
  const plan = dct ? dctPlans[bits - 2] : adstPlans[bits - 3]
  if (!plan) throw unsupportedOperation('Unsupported AV1 transform stages')
  const ops = plan.operations
  // Below this bound every stage addition already fits its required clamp.
  const safeInput = Math.floor(transformClampMaximum / plan.maximumGain)
  let unclipped = true
  for (let i = 0; i < width << bits; i += 1) {
    if (Math.abs(values[i] ?? 0) > safeInput) {
      unclipped = false
      break
    }
  }
  for (let op = 0; op < ops.length; op += 6) {
    const left = ops[op] ?? 0
    const b = (ops[op + 1] ?? 0) * width
    if (left < 0) {
      const a = ~left * width
      if (unclipped) {
        for (let i = 0; i < width; i += 1) {
          const u = values[a + i] ?? 0
          const v = values[b + i] ?? 0
          values[a + i] = u + v
          values[b + i] = u - v
        }
        continue
      }
      for (let i = 0; i < width; i += 1) {
        const u = values[a + i] ?? 0
        const v = values[b + i] ?? 0
        values[a + i] = clampTransform(u + v)
        values[b + i] = clampTransform(u - v)
      }
    } else {
      const a = left * width
      const aa = ops[op + 2] ?? 0
      const ab = ops[op + 3] ?? 0
      const ba = ops[op + 4] ?? 0
      const bb = ops[op + 5] ?? 0
      if (transformClampMaximum === 32767) {
        // With 16-bit inputs, the largest rotation numerator in any of the
        // fixed DCT/ADST stage plans is at most 189794304, including rounding.
        for (let i = 0; i < width; i += 1) {
          const u = values[a + i] ?? 0
          const v = values[b + i] ?? 0
          values[a + i] = (Math.imul(u, aa) + Math.imul(v, ab) + 2048) >> 12
          values[b + i] = (Math.imul(u, ba) + Math.imul(v, bb) + 2048) >> 12
        }
      } else {
        for (let i = 0; i < width; i += 1) {
          const u = values[a + i] ?? 0
          const v = values[b + i] ?? 0
          values[a + i] = Math.floor((u * aa + v * ab + 2048) / 4096)
          values[b + i] = Math.floor((u * ba + v * bb + 2048) / 4096)
        }
      }
    }
  }
}

const columnInputRow = (row: number, height: number, bits: number, dct: boolean): number =>
  dct ? reversedBits(row, bits) : (row & 1) === 0 ? row + 1 : height - 1 - row

const inverseAdst8 = (input: Int32Array, offset: number): Int32Array => {
  const values = transformValues
  for (let index = 0; index < 8; index += 1) {
    const source = (index & 1) === 1 ? index - 1 : 7 - index
    values[index] = input[offset + source] ?? 0
  }
  adst8Stages(values, butterfly, hadamard)
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

const inverseAdst16 = (input: Int32Array, offset: number): Int32Array => {
  const values = transformValues
  for (let index = 0; index < 16; index += 1) {
    const source = (index & 1) === 1 ? index - 1 : 15 - index
    values[index] = input[offset + source] ?? 0
  }
  adst16Stages(values, butterfly, hadamard)
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

const oneDimensional = (
  input: Int32Array,
  offset: number,
  length: number,
  adst: boolean,
): Int32Array => {
  if (!adst) return inverseDct(input, offset, length)
  if (length === 4) return inverseAdst4(input, offset)
  if (length === 8) return inverseAdst8(input, offset)
  if (length === 16) return inverseAdst16(input, offset)
  throw unsupportedOperation(`Unsupported AV1 inverse ADST length ${length}`)
}

const inverseIdentity = (input: Int32Array, offset: number, length: number): Int32Array => {
  let multiplier: number
  let shift = 0
  if (length === 4) {
    multiplier = 5793
    shift = 12
  } else if (length === 8) multiplier = 2
  else if (length === 16) {
    multiplier = 11586
    shift = 12
  } else if (length === 32) multiplier = 4
  else throw unsupportedOperation(`Unsupported AV1 inverse identity length ${length}`)
  const output = transformOutput
  for (let index = 0; index < length; index += 1) {
    const value = (input[offset + index] ?? 0) * multiplier
    output[index] = shift === 0 ? value : roundedShift(value, shift)
  }
  return output
}
const inverseWht4 = (input: Int32Array, offset: number, shift: number): Int32Array => {
  let a = (input[offset] ?? 0) >> shift
  let c = (input[offset + 1] ?? 0) >> shift
  let d = (input[offset + 2] ?? 0) >> shift
  let b = (input[offset + 3] ?? 0) >> shift
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
  activeRows: number,
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
  const coefficientCount = width * activeRows
  const matrixWidth = Math.min(width, 32)
  const matrixHeight = Math.min(height, 32)
  const rectangularScale = width * 2 === height || height * 2 === width
  const sizeContext = (Math.log2(width >> 2) + Math.log2(height >> 2) + 1) >> 1
  const dequantizerDivisor = 2 ** Math.max(0, sizeContext - 2)
  const coefficientLimit = 2 ** (bitDepth + 7)
  if (!matrix && !rectangularScale && dequantizerDivisor === 1) {
    const minimum = -coefficientLimit
    const maximum = coefficientLimit - 1
    dequantized[0] = Math.max(minimum, Math.min(maximum, (quantized[0] ?? 0) * dc))
    for (let index = 1; index < coefficientCount; index += 1) {
      dequantized[index] = Math.max(minimum, Math.min(maximum, (quantized[index] ?? 0) * ac))
    }
    return dequantized
  }
  for (let index = 0; index < coefficientCount; index += 1) {
    const level = quantized[index] ?? 0
    if (level === 0) {
      dequantized[index] = 0
      continue
    }
    const quantization = index === 0 ? dc : ac
    const row = Math.floor(index / width)
    const column = index % width
    // Transform coefficients use the opposite axis order from the normative matrix tables.
    const matrixWeight =
      matrix && row < matrixHeight && column < matrixWidth
        ? (matrix[column * matrixHeight + row] ?? 32)
        : 32
    const weighted = matrix ? roundedShift(quantization * matrixWeight, 5) : quantization
    const scaled = level * weighted
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

// A complete eight-bit destination can receive batched residuals directly.
// Other transforms return their bounded residual block to the caller.
export function inverseTransform(
  quantized: Int32Array,
  width: 4 | 8 | 16 | 32 | 64,
  height: 4 | 8 | 16 | 32 | 64,
  transformType: number,
  plane: 0 | 1 | 2,
  header: Av1FrameHeader,
  quantizer?: number,
  bitDepth?: 8 | 10 | 12,
  activeRows?: number,
): Int32Array
export function inverseTransform(
  quantized: Int32Array,
  width: 4 | 8 | 16 | 32 | 64,
  height: 4 | 8 | 16 | 32 | 64,
  transformType: number,
  plane: 0 | 1 | 2,
  header: Av1FrameHeader,
  quantizer: number,
  bitDepth: 8 | 10 | 12,
  activeRows: number,
  target8: Uint8ClampedArray | undefined,
  offset: number,
  stride: number,
): Int32Array | undefined
export function inverseTransform(
  quantized: Int32Array,
  width: 4 | 8 | 16 | 32 | 64,
  height: 4 | 8 | 16 | 32 | 64,
  transformType: number,
  plane: 0 | 1 | 2,
  header: Av1FrameHeader,
  quantizer = header.baseQuantizer,
  bitDepth: 8 | 10 | 12 = 8,
  activeRows: number = height,
  target8?: Uint8ClampedArray,
  offset = 0,
  stride: number = width,
): Int32Array | undefined {
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
    header.codedLossless ? height : activeRows,
  )
  if (header.codedLossless) {
    if (width !== 4 || height !== 4) {
      throw invalidInput(
        `Lossless AV1 transform dimensions must be 4x4, received ${width}x${height}`,
      )
    }
    const intermediate = intermediateScratch
    for (let row = 0; row < 4; row += 1) {
      const transformed = inverseWht4(dequantized, row * 4, 2)
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
      const transformed = inverseWht4(columnInput, 0, 0)
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
  const batchColumns =
    (columnUsesDct && activeRows > 1) || (columnUsesAdst && (height === 8 || height === 16))
  const columnBits = Math.log2(height)
  // Write rows directly in the input order of the vertical stages. Rows outside
  // the coded extent have no coefficients and may still contain the previous block.
  if (batchColumns && activeRows < height) intermediate.fill(0, 0, width * height)
  if (activeRows >= 2 && (rowUsesDct || (rowUsesAdst && (width === 8 || width === 16)))) {
    const bits = Math.log2(width)
    const values = residualScratch
    for (let lane = 0; lane < width; lane += 1) {
      const source = rowUsesDct
        ? reversedBits(lane, bits)
        : (lane & 1) === 1
          ? lane - 1
          : width - 1 - lane
      const origin = lane * activeRows
      for (let row = 0; row < activeRows; row += 1)
        values[origin + row] = dequantized[row * width + source] ?? 0
    }
    runParallelStages(values, activeRows, bits, rowUsesDct)
    for (let row = 0; row < activeRows; row += 1) {
      const destination =
        (batchColumns ? columnInputRow(row, height, columnBits, columnUsesDct) : row) * width
      for (let col = 0; col < width; col += 1) {
        const origin = rowUsesDct ? col : reversedBits(col ^ (col >> 1), bits)
        const value = values[origin * activeRows + row] ?? 0
        const signed = !rowUsesDct && (col & 1) !== 0 ? -value : value
        intermediate[destination + col] = Math.max(
          columnClampMinimum,
          Math.min(columnClampMaximum, roundedShift(signed, rowShift)),
        )
      }
    }
  } else {
    for (let row = 0; row < activeRows; row += 1) {
      const rowOrigin = row * width
      const targetOrigin = batchColumns
        ? columnInputRow(row, height, columnBits, columnUsesDct) * width
        : rowOrigin
      const dc = dequantized[rowOrigin] ?? 0
      let hasAc = false
      for (let column = 1; column < width; column += 1) {
        if ((dequantized[rowOrigin + column] ?? 0) !== 0) {
          hasAc = true
          break
        }
      }
      if (!hasAc && (dc === 0 || rowUsesDct)) {
        // A DC-only DCT broadcasts the same 45-degree rotation to every output.
        const rotated = clampTransform(roundedShift(dc * 2896, 12))
        const value = Math.max(
          columnClampMinimum,
          Math.min(columnClampMaximum, roundedShift(rotated, rowShift)),
        )
        intermediate.fill(value, targetOrigin, targetOrigin + width)
        continue
      }
      const transformed =
        rowUsesDct || rowUsesAdst
          ? oneDimensional(dequantized, rowOrigin, width, rowUsesAdst)
          : inverseIdentity(dequantized, rowOrigin, width)
      for (let column = 0; column < width; column += 1) {
        intermediate[targetOrigin + column] = Math.max(
          columnClampMinimum,
          Math.min(columnClampMaximum, roundedShift(transformed[column] ?? 0, rowShift)),
        )
      }
    }
  }
  transformClampMinimum = columnClampMinimum
  transformClampMaximum = columnClampMaximum
  const residual = residualScratch.subarray(0, width * height)
  if (batchColumns) {
    const bits = columnBits
    const values = intermediate
    runParallelStages(values, width, bits, columnUsesDct)
    const flipY = ((flippedRowMask >>> transformType) & 1) !== 0
    const flipX = ((flippedColumnMask >>> transformType) & 1) !== 0
    for (let r = 0; r < height; r += 1) {
      const gray = r ^ (r >> 1)
      const origin = (columnUsesDct ? r : reversedBits(gray, bits)) * width
      const row = flipY ? height - 1 - r : r
      const sign = columnUsesDct || (r & 1) === 0 ? 1 : -1
      if (target8) {
        let index = offset + row * stride + (flipX ? width - 1 : 0)
        const step = flipX ? -1 : 1
        for (let x = 0; x < width; x += 1) {
          target8[index] = (target8[index] ?? 0) + roundedShift(sign * (values[origin + x] ?? 0), 4)
          index += step
        }
        continue
      }
      const target = row * width
      for (let x = 0; x < width; x += 1) {
        residual[target + (flipX ? width - 1 - x : x)] = roundedShift(
          sign * (values[origin + x] ?? 0),
          4,
        )
      }
    }
    return target8 ? undefined : residual
  }
  const columnInput = columnInputScratch
  columnInput.fill(0, activeRows, height)
  for (let column = 0; column < width; column += 1) {
    const dc = intermediate[column] ?? 0
    columnInput[0] = dc
    let ac = 0
    for (let row = 1; row < activeRows; row += 1) {
      const sample = intermediate[row * width + column] ?? 0
      columnInput[row] = sample
      ac |= sample
    }
    if (ac === 0 && (dc === 0 || columnUsesDct)) {
      const value = roundedShift(clampTransform(roundedShift(dc * 2896, 12)), 4)
      const targetColumn =
        ((flippedColumnMask >>> transformType) & 1) !== 0 ? width - column - 1 : column
      for (let row = 0; row < height; row += 1) residual[row * width + targetColumn] = value
      continue
    }
    const transformed =
      columnUsesDct || columnUsesAdst
        ? oneDimensional(columnInput, 0, height, columnUsesAdst)
        : inverseIdentity(columnInput, 0, height)
    for (let row = 0; row < height; row += 1) {
      const targetRow = ((flippedRowMask >>> transformType) & 1) !== 0 ? height - row - 1 : row
      const targetColumn =
        ((flippedColumnMask >>> transformType) & 1) !== 0 ? width - column - 1 : column
      residual[targetRow * width + targetColumn] = roundedShift(transformed[row] ?? 0, 4)
    }
  }
  return residual
}
