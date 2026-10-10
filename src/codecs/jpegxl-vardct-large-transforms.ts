import { invalidJpegXlInput } from './jpegxl-errors.ts'

const basis32 = Float64Array.from({ length: 1024 }, (_, index) => {
  const frequency = index >>> 5
  return (
    Math.sqrt(2 / 32) *
    (frequency === 0 ? Math.SQRT1_2 : 1) *
    Math.cos(((2 * (index & 31) + 1) * frequency * Math.PI) / 64)
  )
})
const basisDct32Lf4 = Float64Array.from({ length: 16 }, (_, index) => {
  const frequency = index >>> 2
  return (
    Math.sqrt(2 / 4) *
    (frequency === 0 ? Math.SQRT1_2 : 1) *
    Math.cos(((2 * (index & 3) + 1) * frequency * Math.PI) / 8)
  )
})
const dct32LfScales = Float64Array.from(
  { length: 4 },
  (_, frequency) =>
    1 /
    (Math.cos((frequency * Math.PI) / 64) *
      Math.cos((frequency * Math.PI) / 32) *
      Math.cos((frequency * Math.PI) / 16)),
)

/** First-party separable DCT32, with the existing decoder's transposed mean normalization. */
export const forwardJpegXlDct32 = (
  samples: Float32Array,
  intermediate: Float32Array,
  coefficients: Float32Array,
  lfOnly = false,
): void => {
  if (samples.length !== 1024 || intermediate.length !== 1024 || coefficients.length !== 1024)
    throw invalidJpegXlInput('DCT32 requires three 1024-value buffers')
  const frequencies = lfOnly ? 4 : 32
  for (let y = 0; y < 32; y++) {
    for (let horizontal = 0; horizontal < frequencies; horizontal++) {
      let sum = 0
      for (let x = 0; x < 32; x++)
        sum += (samples[y * 32 + x] ?? 0) * (basis32[horizontal * 32 + x] ?? 0)
      intermediate[y * 32 + horizontal] = sum
    }
  }
  for (let horizontal = 0; horizontal < frequencies; horizontal++) {
    for (let vertical = 0; vertical < frequencies; vertical++) {
      let sum = 0
      for (let y = 0; y < 32; y++)
        sum += (intermediate[y * 32 + horizontal] ?? 0) * (basis32[vertical * 32 + y] ?? 0)
      coefficients[horizontal * 32 + vertical] = sum / 32
    }
  }
}

/** Encode the lowest 4x4 coefficients as compact DC samples, then measure their exact error. */
export const quantizeJpegXlDct32Dc = (
  coefficients: Float32Array,
  step: number,
  destination: Int32Array,
  offset: number,
): number => {
  if (
    coefficients.length !== 1024 ||
    !Number.isFinite(step) ||
    step <= 0 ||
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    offset + 16 > destination.length
  )
    throw invalidJpegXlInput('DCT32 DC extent or step is invalid')
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 4; x++) {
      let sum = 0
      for (let horizontal = 0; horizontal < 4; horizontal++) {
        for (let vertical = 0; vertical < 4; vertical++) {
          sum +=
            ((coefficients[horizontal * 32 + vertical] ?? 0) *
              (basisDct32Lf4[horizontal * 4 + x] ?? 0) *
              (basisDct32Lf4[vertical * 4 + y] ?? 0)) /
            ((dct32LfScales[horizontal] ?? 1) * (dct32LfScales[vertical] ?? 1))
        }
      }
      destination[offset + y * 4 + x] = Math.round((sum * 4) / step)
    }
  }
  let squaredError = 0
  for (let horizontal = 0; horizontal < 4; horizontal++) {
    for (let vertical = 0; vertical < 4; vertical++) {
      let sum = 0
      for (let y = 0; y < 4; y++) {
        for (let x = 0; x < 4; x++) {
          sum +=
            (destination[offset + y * 4 + x] ?? 0) *
            step *
            (basisDct32Lf4[horizontal * 4 + x] ?? 0) *
            (basisDct32Lf4[vertical * 4 + y] ?? 0)
        }
      }
      const reconstructed =
        (sum / 4) * (dct32LfScales[horizontal] ?? 1) * (dct32LfScales[vertical] ?? 1)
      const error = (coefficients[horizontal * 32 + vertical] ?? 0) - reconstructed
      squaredError += error * error
    }
  }
  return squaredError
}

const basis16 = Float64Array.from(
  { length: 256 },
  (_, index) =>
    Math.sqrt(2 / 16) *
    (index >>> 4 === 0 ? Math.SQRT1_2 : 1) *
    Math.cos(((2 * (index & 15) + 1) * (index >>> 4) * Math.PI) / 32),
)
const basis2 = Float64Array.from(
  { length: 4 },
  (_, index) =>
    (index >>> 1 === 0 ? Math.SQRT1_2 : 1) *
    Math.cos(((2 * (index & 1) + 1) * (index >>> 1) * Math.PI) / 4),
)
const shortScales = Float64Array.from(
  { length: 2 },
  (_, frequency) =>
    1 /
    (Math.cos((frequency * Math.PI) / 32) *
      Math.cos((frequency * Math.PI) / 16) *
      Math.cos((frequency * Math.PI) / 8)),
)

/** Canonical short-frequency rows and long-frequency columns for both orientations. */
export const forwardJpegXlRectangle32 = (
  samples: Float32Array,
  intermediate: Float32Array,
  coefficients: Float32Array,
  horizontal: boolean,
  lfOnly = false,
): void => {
  if (samples.length !== 512 || intermediate.length !== 512 || coefficients.length !== 512)
    throw invalidJpegXlInput('16x32 transform requires three 512-value buffers')
  const rowStep = horizontal ? 32 : 1,
    columnStep = horizontal ? 1 : 16,
    longFrequencies = lfOnly ? 4 : 32,
    shortFrequencies = lfOnly ? 2 : 16
  for (let short = 0; short < 16; short++)
    for (let frequency = 0; frequency < longFrequencies; frequency++) {
      let sum = 0
      for (let long = 0; long < 32; long++)
        sum +=
          (samples[short * rowStep + long * columnStep] ?? 0) *
          (basis32[frequency * 32 + long] ?? 0)
      intermediate[short * 32 + frequency] = sum
    }
  for (let short = 0; short < shortFrequencies; short++)
    for (let long = 0; long < longFrequencies; long++) {
      let sum = 0
      for (let position = 0; position < 16; position++)
        sum += (intermediate[position * 32 + long] ?? 0) * (basis16[short * 16 + position] ?? 0)
      coefficients[short * 32 + long] = sum / Math.sqrt(512)
    }
}

/** Compact physical 2x4 or 4x2 DC samples and exact mean-normalized DC error. */
export const quantizeJpegXlRectangle32Dc = (
  coefficients: Float32Array,
  step: number,
  destination: Int32Array,
  offset: number,
  horizontal: boolean,
): number => {
  if (
    coefficients.length !== 512 ||
    !Number.isFinite(step) ||
    step <= 0 ||
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    offset + 8 > destination.length
  )
    throw invalidJpegXlInput('16x32 DC extent or step is invalid')
  const width = horizontal ? 4 : 2,
    height = horizontal ? 2 : 4
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const shortPosition = horizontal ? y : x,
        longPosition = horizontal ? x : y
      let sum = 0
      for (let short = 0; short < 2; short++)
        for (let long = 0; long < 4; long++)
          sum +=
            ((coefficients[short * 32 + long] ?? 0) *
              (basis2[short * 2 + shortPosition] ?? 0) *
              (basisDct32Lf4[long * 4 + longPosition] ?? 0)) /
            ((shortScales[short] ?? 1) * (dct32LfScales[long] ?? 1))
      destination[offset + y * width + x] = Math.round((sum * Math.sqrt(8)) / step)
    }
  let error = 0
  for (let short = 0; short < 2; short++)
    for (let long = 0; long < 4; long++) {
      let sum = 0
      for (let y = 0; y < height; y++)
        for (let x = 0; x < width; x++)
          sum +=
            (destination[offset + y * width + x] ?? 0) *
            step *
            (basis2[short * 2 + (horizontal ? y : x)] ?? 0) *
            (basisDct32Lf4[long * 4 + (horizontal ? x : y)] ?? 0)
      const decoded = (sum / Math.sqrt(8)) * (shortScales[short] ?? 1) * (dct32LfScales[long] ?? 1)
      error += ((coefficients[short * 32 + long] ?? 0) - decoded) ** 2
    }
  return error
}
