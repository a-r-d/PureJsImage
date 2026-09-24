import { invalidInput } from '../errors.ts'

const basis = Float32Array.from({ length: 64 }, (_, index) => {
  const frequency = index >>> 3
  return (
    ((frequency === 0 ? Math.SQRT1_2 : 1) *
      Math.cos(((2 * (index & 7) + 1) * frequency * Math.PI) / 16)) /
    2
  )
})

/** A separable forward transform in the decoder's transposed, mean-normalized convention. */
export const forwardJpegXlDct8 = (
  samples: Float32Array,
  intermediate: Float32Array,
  coefficients: Float32Array,
): void => {
  if (samples.length !== 64 || intermediate.length !== 64 || coefficients.length !== 64)
    throw invalidInput('JPEG XL DCT8 requires three 64-value buffers')
  for (let y = 0; y < 8; y++) {
    const row = y * 8
    const a0 = (samples[row] ?? 0) + (samples[row + 7] ?? 0),
      a1 = (samples[row + 1] ?? 0) + (samples[row + 6] ?? 0),
      a2 = (samples[row + 2] ?? 0) + (samples[row + 5] ?? 0),
      a3 = (samples[row + 3] ?? 0) + (samples[row + 4] ?? 0)
    const b0 = (samples[row] ?? 0) - (samples[row + 7] ?? 0),
      b1 = (samples[row + 1] ?? 0) - (samples[row + 6] ?? 0),
      b2 = (samples[row + 2] ?? 0) - (samples[row + 5] ?? 0),
      b3 = (samples[row + 3] ?? 0) - (samples[row + 4] ?? 0)
    for (let h = 0; h < 8; h += 2) {
      const index = h * 8
      intermediate[row + h] =
        a0 * (basis[index] ?? 0) +
        a1 * (basis[index + 1] ?? 0) +
        a2 * (basis[index + 2] ?? 0) +
        a3 * (basis[index + 3] ?? 0)
      intermediate[row + h + 1] =
        b0 * (basis[index + 8] ?? 0) +
        b1 * (basis[index + 9] ?? 0) +
        b2 * (basis[index + 10] ?? 0) +
        b3 * (basis[index + 11] ?? 0)
    }
  }
  for (let h = 0; h < 8; h++) {
    const a0 = (intermediate[h] ?? 0) + (intermediate[56 + h] ?? 0),
      a1 = (intermediate[8 + h] ?? 0) + (intermediate[48 + h] ?? 0),
      a2 = (intermediate[16 + h] ?? 0) + (intermediate[40 + h] ?? 0),
      a3 = (intermediate[24 + h] ?? 0) + (intermediate[32 + h] ?? 0)
    const b0 = (intermediate[h] ?? 0) - (intermediate[56 + h] ?? 0),
      b1 = (intermediate[8 + h] ?? 0) - (intermediate[48 + h] ?? 0),
      b2 = (intermediate[16 + h] ?? 0) - (intermediate[40 + h] ?? 0),
      b3 = (intermediate[24 + h] ?? 0) - (intermediate[32 + h] ?? 0)
    for (let v = 0; v < 8; v += 2) {
      const index = v * 8
      coefficients[h * 8 + v] =
        (a0 * (basis[index] ?? 0) +
          a1 * (basis[index + 1] ?? 0) +
          a2 * (basis[index + 2] ?? 0) +
          a3 * (basis[index + 3] ?? 0)) /
        8
      coefficients[h * 8 + v + 1] =
        (b0 * (basis[index + 8] ?? 0) +
          b1 * (basis[index + 9] ?? 0) +
          b2 * (basis[index + 10] ?? 0) +
          b3 * (basis[index + 11] ?? 0)) /
        8
    }
  }
}

export const forwardJpegXlHornuss = (samples: Float32Array, coefficients: Float32Array): void => {
  for (let cellY = 0; cellY < 2; cellY++)
    for (let cellX = 0; cellX < 2; cellX++) {
      const origin = cellY * 32 + cellX * 4
      const center = samples[origin + 9] ?? 0
      let sum = 0
      for (let y = 0; y < 4; y++)
        for (let x = 0; x < 4; x++) {
          const sample = samples[origin + y * 8 + x] ?? 0
          sum += sample
          coefficients[(cellY + y * 2) * 8 + cellX + x * 2] =
            y === 1 && x === 1 ? (samples[origin] ?? 0) - center : sample - center
        }
      coefficients[cellY * 8 + cellX] = sum / 16
    }
  const a = coefficients[0] ?? 0,
    b = coefficients[1] ?? 0,
    c = coefficients[8] ?? 0,
    d = coefficients[9] ?? 0
  coefficients[0] = (a + b + c + d) / 4
  coefficients[1] = (a + b - c - d) / 4
  coefficients[8] = (a - b + c - d) / 4
  coefficients[9] = (a - b - c + d) / 4
}

const basis4 = Float32Array.from(
  { length: 16 },
  (_, index) =>
    ((index >>> 2 === 0 ? Math.SQRT1_2 : 1) *
      Math.cos(((2 * (index & 3) + 1) * (index >>> 2) * Math.PI) / 8)) /
    Math.SQRT2,
)
export const forwardJpegXlDctHalves = (
  samples: Float32Array,
  intermediate: Float32Array,
  coefficients: Float32Array,
  horizontal: boolean,
): void => {
  const rowStep = horizontal ? 8 : 1
  const columnStep = horizontal ? 1 : 8
  for (let half = 0; half < 2; half++) {
    const origin = half * 4 * columnStep
    for (let y = 0; y < 8; y++)
      for (let h = 0; h < 4; h++) {
        let sum = 0
        for (let x = 0; x < 4; x++)
          sum += (samples[origin + y * rowStep + x * columnStep] ?? 0) * (basis4[h * 4 + x] ?? 0)
        intermediate[y * 4 + h] = sum
      }
    for (let h = 0; h < 4; h++)
      for (let v = 0; v < 8; v++) {
        let sum = 0
        for (let y = 0; y < 8; y++) sum += (intermediate[y * 4 + h] ?? 0) * (basis[v * 8 + y] ?? 0)
        coefficients[(half + h * 2) * 8 + v] = sum / Math.sqrt(32)
      }
  }
  const first = coefficients[0] ?? 0,
    second = coefficients[8] ?? 0
  coefficients[0] = (first + second) / 2
  coefficients[8] = (first - second) / 2
}

const basis16 = Float64Array.from({ length: 256 }, (_, index) => {
  const frequency = index >>> 4
  const position = index & 15
  return (
    Math.sqrt(2 / 16) *
    (frequency === 0 ? Math.SQRT1_2 : 1) *
    Math.cos(((2 * position + 1) * frequency * Math.PI) / 32)
  )
})

/** Forward DCT16 in the decoder's transposed, mean-normalized coefficient order. */
export const forwardJpegXlDct16 = (
  samples: Float32Array,
  intermediate: Float32Array,
  coefficients: Float32Array,
): void => {
  if (samples.length !== 256 || intermediate.length !== 256 || coefficients.length !== 256)
    throw invalidInput('JPEG XL DCT16 requires three 256-value buffers')
  for (let y = 0; y < 16; y++) {
    for (let horizontal = 0; horizontal < 16; horizontal++) {
      let sum = 0
      for (let x = 0; x < 16; x++)
        sum += (samples[y * 16 + x] ?? 0) * (basis16[horizontal * 16 + x] ?? 0)
      intermediate[y * 16 + horizontal] = sum
    }
  }
  for (let horizontal = 0; horizontal < 16; horizontal++) {
    for (let vertical = 0; vertical < 16; vertical++) {
      let sum = 0
      for (let y = 0; y < 16; y++)
        sum += (intermediate[y * 16 + horizontal] ?? 0) * (basis16[vertical * 16 + y] ?? 0)
      coefficients[horizontal * 16 + vertical] = sum / 16
    }
  }
}
