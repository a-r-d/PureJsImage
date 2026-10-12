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
    // Retain reflected sums in Float64 locals before the Float32 row boundary.
    const left0 = samples[y * 32 + 0] ?? 0,
      right0 = samples[y * 32 + 31] ?? 0,
      even0 = left0 + right0,
      odd0 = left0 - right0
    const left1 = samples[y * 32 + 1] ?? 0,
      right1 = samples[y * 32 + 30] ?? 0,
      even1 = left1 + right1,
      odd1 = left1 - right1
    const left2 = samples[y * 32 + 2] ?? 0,
      right2 = samples[y * 32 + 29] ?? 0,
      even2 = left2 + right2,
      odd2 = left2 - right2
    const left3 = samples[y * 32 + 3] ?? 0,
      right3 = samples[y * 32 + 28] ?? 0,
      even3 = left3 + right3,
      odd3 = left3 - right3
    const left4 = samples[y * 32 + 4] ?? 0,
      right4 = samples[y * 32 + 27] ?? 0,
      even4 = left4 + right4,
      odd4 = left4 - right4
    const left5 = samples[y * 32 + 5] ?? 0,
      right5 = samples[y * 32 + 26] ?? 0,
      even5 = left5 + right5,
      odd5 = left5 - right5
    const left6 = samples[y * 32 + 6] ?? 0,
      right6 = samples[y * 32 + 25] ?? 0,
      even6 = left6 + right6,
      odd6 = left6 - right6
    const left7 = samples[y * 32 + 7] ?? 0,
      right7 = samples[y * 32 + 24] ?? 0,
      even7 = left7 + right7,
      odd7 = left7 - right7
    const left8 = samples[y * 32 + 8] ?? 0,
      right8 = samples[y * 32 + 23] ?? 0,
      even8 = left8 + right8,
      odd8 = left8 - right8
    const left9 = samples[y * 32 + 9] ?? 0,
      right9 = samples[y * 32 + 22] ?? 0,
      even9 = left9 + right9,
      odd9 = left9 - right9
    const left10 = samples[y * 32 + 10] ?? 0,
      right10 = samples[y * 32 + 21] ?? 0,
      even10 = left10 + right10,
      odd10 = left10 - right10
    const left11 = samples[y * 32 + 11] ?? 0,
      right11 = samples[y * 32 + 20] ?? 0,
      even11 = left11 + right11,
      odd11 = left11 - right11
    const left12 = samples[y * 32 + 12] ?? 0,
      right12 = samples[y * 32 + 19] ?? 0,
      even12 = left12 + right12,
      odd12 = left12 - right12
    const left13 = samples[y * 32 + 13] ?? 0,
      right13 = samples[y * 32 + 18] ?? 0,
      even13 = left13 + right13,
      odd13 = left13 - right13
    const left14 = samples[y * 32 + 14] ?? 0,
      right14 = samples[y * 32 + 17] ?? 0,
      even14 = left14 + right14,
      odd14 = left14 - right14
    const left15 = samples[y * 32 + 15] ?? 0,
      right15 = samples[y * 32 + 16] ?? 0,
      even15 = left15 + right15,
      odd15 = left15 - right15
    for (let horizontal = 0; horizontal < frequencies; horizontal += 2) {
      let even = 0,
        odd = 0
      even += even0 * (basis32[horizontal * 32 + 0] ?? 0)
      odd += odd0 * (basis32[(horizontal + 1) * 32 + 0] ?? 0)
      even += even1 * (basis32[horizontal * 32 + 1] ?? 0)
      odd += odd1 * (basis32[(horizontal + 1) * 32 + 1] ?? 0)
      even += even2 * (basis32[horizontal * 32 + 2] ?? 0)
      odd += odd2 * (basis32[(horizontal + 1) * 32 + 2] ?? 0)
      even += even3 * (basis32[horizontal * 32 + 3] ?? 0)
      odd += odd3 * (basis32[(horizontal + 1) * 32 + 3] ?? 0)
      even += even4 * (basis32[horizontal * 32 + 4] ?? 0)
      odd += odd4 * (basis32[(horizontal + 1) * 32 + 4] ?? 0)
      even += even5 * (basis32[horizontal * 32 + 5] ?? 0)
      odd += odd5 * (basis32[(horizontal + 1) * 32 + 5] ?? 0)
      even += even6 * (basis32[horizontal * 32 + 6] ?? 0)
      odd += odd6 * (basis32[(horizontal + 1) * 32 + 6] ?? 0)
      even += even7 * (basis32[horizontal * 32 + 7] ?? 0)
      odd += odd7 * (basis32[(horizontal + 1) * 32 + 7] ?? 0)
      even += even8 * (basis32[horizontal * 32 + 8] ?? 0)
      odd += odd8 * (basis32[(horizontal + 1) * 32 + 8] ?? 0)
      even += even9 * (basis32[horizontal * 32 + 9] ?? 0)
      odd += odd9 * (basis32[(horizontal + 1) * 32 + 9] ?? 0)
      even += even10 * (basis32[horizontal * 32 + 10] ?? 0)
      odd += odd10 * (basis32[(horizontal + 1) * 32 + 10] ?? 0)
      even += even11 * (basis32[horizontal * 32 + 11] ?? 0)
      odd += odd11 * (basis32[(horizontal + 1) * 32 + 11] ?? 0)
      even += even12 * (basis32[horizontal * 32 + 12] ?? 0)
      odd += odd12 * (basis32[(horizontal + 1) * 32 + 12] ?? 0)
      even += even13 * (basis32[horizontal * 32 + 13] ?? 0)
      odd += odd13 * (basis32[(horizontal + 1) * 32 + 13] ?? 0)
      even += even14 * (basis32[horizontal * 32 + 14] ?? 0)
      odd += odd14 * (basis32[(horizontal + 1) * 32 + 14] ?? 0)
      even += even15 * (basis32[horizontal * 32 + 15] ?? 0)
      odd += odd15 * (basis32[(horizontal + 1) * 32 + 15] ?? 0)
      intermediate[y * 32 + horizontal] = even
      intermediate[y * 32 + horizontal + 1] = odd
    }
  }
  for (let horizontal = 0; horizontal < frequencies; horizontal++) {
    // Retain reflected sums in Float64 locals before the Float32 row boundary.
    const left0 = intermediate[0 + horizontal] ?? 0,
      right0 = intermediate[992 + horizontal] ?? 0,
      even0 = left0 + right0,
      odd0 = left0 - right0
    const left1 = intermediate[32 + horizontal] ?? 0,
      right1 = intermediate[960 + horizontal] ?? 0,
      even1 = left1 + right1,
      odd1 = left1 - right1
    const left2 = intermediate[64 + horizontal] ?? 0,
      right2 = intermediate[928 + horizontal] ?? 0,
      even2 = left2 + right2,
      odd2 = left2 - right2
    const left3 = intermediate[96 + horizontal] ?? 0,
      right3 = intermediate[896 + horizontal] ?? 0,
      even3 = left3 + right3,
      odd3 = left3 - right3
    const left4 = intermediate[128 + horizontal] ?? 0,
      right4 = intermediate[864 + horizontal] ?? 0,
      even4 = left4 + right4,
      odd4 = left4 - right4
    const left5 = intermediate[160 + horizontal] ?? 0,
      right5 = intermediate[832 + horizontal] ?? 0,
      even5 = left5 + right5,
      odd5 = left5 - right5
    const left6 = intermediate[192 + horizontal] ?? 0,
      right6 = intermediate[800 + horizontal] ?? 0,
      even6 = left6 + right6,
      odd6 = left6 - right6
    const left7 = intermediate[224 + horizontal] ?? 0,
      right7 = intermediate[768 + horizontal] ?? 0,
      even7 = left7 + right7,
      odd7 = left7 - right7
    const left8 = intermediate[256 + horizontal] ?? 0,
      right8 = intermediate[736 + horizontal] ?? 0,
      even8 = left8 + right8,
      odd8 = left8 - right8
    const left9 = intermediate[288 + horizontal] ?? 0,
      right9 = intermediate[704 + horizontal] ?? 0,
      even9 = left9 + right9,
      odd9 = left9 - right9
    const left10 = intermediate[320 + horizontal] ?? 0,
      right10 = intermediate[672 + horizontal] ?? 0,
      even10 = left10 + right10,
      odd10 = left10 - right10
    const left11 = intermediate[352 + horizontal] ?? 0,
      right11 = intermediate[640 + horizontal] ?? 0,
      even11 = left11 + right11,
      odd11 = left11 - right11
    const left12 = intermediate[384 + horizontal] ?? 0,
      right12 = intermediate[608 + horizontal] ?? 0,
      even12 = left12 + right12,
      odd12 = left12 - right12
    const left13 = intermediate[416 + horizontal] ?? 0,
      right13 = intermediate[576 + horizontal] ?? 0,
      even13 = left13 + right13,
      odd13 = left13 - right13
    const left14 = intermediate[448 + horizontal] ?? 0,
      right14 = intermediate[544 + horizontal] ?? 0,
      even14 = left14 + right14,
      odd14 = left14 - right14
    const left15 = intermediate[480 + horizontal] ?? 0,
      right15 = intermediate[512 + horizontal] ?? 0,
      even15 = left15 + right15,
      odd15 = left15 - right15
    for (let vertical = 0; vertical < frequencies; vertical += 2) {
      let even = 0,
        odd = 0
      even += even0 * (basis32[vertical * 32 + 0] ?? 0)
      odd += odd0 * (basis32[(vertical + 1) * 32 + 0] ?? 0)
      even += even1 * (basis32[vertical * 32 + 1] ?? 0)
      odd += odd1 * (basis32[(vertical + 1) * 32 + 1] ?? 0)
      even += even2 * (basis32[vertical * 32 + 2] ?? 0)
      odd += odd2 * (basis32[(vertical + 1) * 32 + 2] ?? 0)
      even += even3 * (basis32[vertical * 32 + 3] ?? 0)
      odd += odd3 * (basis32[(vertical + 1) * 32 + 3] ?? 0)
      even += even4 * (basis32[vertical * 32 + 4] ?? 0)
      odd += odd4 * (basis32[(vertical + 1) * 32 + 4] ?? 0)
      even += even5 * (basis32[vertical * 32 + 5] ?? 0)
      odd += odd5 * (basis32[(vertical + 1) * 32 + 5] ?? 0)
      even += even6 * (basis32[vertical * 32 + 6] ?? 0)
      odd += odd6 * (basis32[(vertical + 1) * 32 + 6] ?? 0)
      even += even7 * (basis32[vertical * 32 + 7] ?? 0)
      odd += odd7 * (basis32[(vertical + 1) * 32 + 7] ?? 0)
      even += even8 * (basis32[vertical * 32 + 8] ?? 0)
      odd += odd8 * (basis32[(vertical + 1) * 32 + 8] ?? 0)
      even += even9 * (basis32[vertical * 32 + 9] ?? 0)
      odd += odd9 * (basis32[(vertical + 1) * 32 + 9] ?? 0)
      even += even10 * (basis32[vertical * 32 + 10] ?? 0)
      odd += odd10 * (basis32[(vertical + 1) * 32 + 10] ?? 0)
      even += even11 * (basis32[vertical * 32 + 11] ?? 0)
      odd += odd11 * (basis32[(vertical + 1) * 32 + 11] ?? 0)
      even += even12 * (basis32[vertical * 32 + 12] ?? 0)
      odd += odd12 * (basis32[(vertical + 1) * 32 + 12] ?? 0)
      even += even13 * (basis32[vertical * 32 + 13] ?? 0)
      odd += odd13 * (basis32[(vertical + 1) * 32 + 13] ?? 0)
      even += even14 * (basis32[vertical * 32 + 14] ?? 0)
      odd += odd14 * (basis32[(vertical + 1) * 32 + 14] ?? 0)
      even += even15 * (basis32[vertical * 32 + 15] ?? 0)
      odd += odd15 * (basis32[(vertical + 1) * 32 + 15] ?? 0)
      coefficients[horizontal * 32 + vertical] = even / 32
      coefficients[horizontal * 32 + vertical + 1] = odd / 32
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
  for (let short = 0; short < 16; short++) {
    // Retain reflected sums in Float64 locals before the Float32 row boundary.
    const left0 = samples[short * rowStep + 0 * columnStep] ?? 0,
      right0 = samples[short * rowStep + 31 * columnStep] ?? 0,
      even0 = left0 + right0,
      odd0 = left0 - right0
    const left1 = samples[short * rowStep + 1 * columnStep] ?? 0,
      right1 = samples[short * rowStep + 30 * columnStep] ?? 0,
      even1 = left1 + right1,
      odd1 = left1 - right1
    const left2 = samples[short * rowStep + 2 * columnStep] ?? 0,
      right2 = samples[short * rowStep + 29 * columnStep] ?? 0,
      even2 = left2 + right2,
      odd2 = left2 - right2
    const left3 = samples[short * rowStep + 3 * columnStep] ?? 0,
      right3 = samples[short * rowStep + 28 * columnStep] ?? 0,
      even3 = left3 + right3,
      odd3 = left3 - right3
    const left4 = samples[short * rowStep + 4 * columnStep] ?? 0,
      right4 = samples[short * rowStep + 27 * columnStep] ?? 0,
      even4 = left4 + right4,
      odd4 = left4 - right4
    const left5 = samples[short * rowStep + 5 * columnStep] ?? 0,
      right5 = samples[short * rowStep + 26 * columnStep] ?? 0,
      even5 = left5 + right5,
      odd5 = left5 - right5
    const left6 = samples[short * rowStep + 6 * columnStep] ?? 0,
      right6 = samples[short * rowStep + 25 * columnStep] ?? 0,
      even6 = left6 + right6,
      odd6 = left6 - right6
    const left7 = samples[short * rowStep + 7 * columnStep] ?? 0,
      right7 = samples[short * rowStep + 24 * columnStep] ?? 0,
      even7 = left7 + right7,
      odd7 = left7 - right7
    const left8 = samples[short * rowStep + 8 * columnStep] ?? 0,
      right8 = samples[short * rowStep + 23 * columnStep] ?? 0,
      even8 = left8 + right8,
      odd8 = left8 - right8
    const left9 = samples[short * rowStep + 9 * columnStep] ?? 0,
      right9 = samples[short * rowStep + 22 * columnStep] ?? 0,
      even9 = left9 + right9,
      odd9 = left9 - right9
    const left10 = samples[short * rowStep + 10 * columnStep] ?? 0,
      right10 = samples[short * rowStep + 21 * columnStep] ?? 0,
      even10 = left10 + right10,
      odd10 = left10 - right10
    const left11 = samples[short * rowStep + 11 * columnStep] ?? 0,
      right11 = samples[short * rowStep + 20 * columnStep] ?? 0,
      even11 = left11 + right11,
      odd11 = left11 - right11
    const left12 = samples[short * rowStep + 12 * columnStep] ?? 0,
      right12 = samples[short * rowStep + 19 * columnStep] ?? 0,
      even12 = left12 + right12,
      odd12 = left12 - right12
    const left13 = samples[short * rowStep + 13 * columnStep] ?? 0,
      right13 = samples[short * rowStep + 18 * columnStep] ?? 0,
      even13 = left13 + right13,
      odd13 = left13 - right13
    const left14 = samples[short * rowStep + 14 * columnStep] ?? 0,
      right14 = samples[short * rowStep + 17 * columnStep] ?? 0,
      even14 = left14 + right14,
      odd14 = left14 - right14
    const left15 = samples[short * rowStep + 15 * columnStep] ?? 0,
      right15 = samples[short * rowStep + 16 * columnStep] ?? 0,
      even15 = left15 + right15,
      odd15 = left15 - right15
    for (let frequency = 0; frequency < longFrequencies; frequency += 2) {
      let even = 0,
        odd = 0
      even += even0 * (basis32[frequency * 32 + 0] ?? 0)
      odd += odd0 * (basis32[(frequency + 1) * 32 + 0] ?? 0)
      even += even1 * (basis32[frequency * 32 + 1] ?? 0)
      odd += odd1 * (basis32[(frequency + 1) * 32 + 1] ?? 0)
      even += even2 * (basis32[frequency * 32 + 2] ?? 0)
      odd += odd2 * (basis32[(frequency + 1) * 32 + 2] ?? 0)
      even += even3 * (basis32[frequency * 32 + 3] ?? 0)
      odd += odd3 * (basis32[(frequency + 1) * 32 + 3] ?? 0)
      even += even4 * (basis32[frequency * 32 + 4] ?? 0)
      odd += odd4 * (basis32[(frequency + 1) * 32 + 4] ?? 0)
      even += even5 * (basis32[frequency * 32 + 5] ?? 0)
      odd += odd5 * (basis32[(frequency + 1) * 32 + 5] ?? 0)
      even += even6 * (basis32[frequency * 32 + 6] ?? 0)
      odd += odd6 * (basis32[(frequency + 1) * 32 + 6] ?? 0)
      even += even7 * (basis32[frequency * 32 + 7] ?? 0)
      odd += odd7 * (basis32[(frequency + 1) * 32 + 7] ?? 0)
      even += even8 * (basis32[frequency * 32 + 8] ?? 0)
      odd += odd8 * (basis32[(frequency + 1) * 32 + 8] ?? 0)
      even += even9 * (basis32[frequency * 32 + 9] ?? 0)
      odd += odd9 * (basis32[(frequency + 1) * 32 + 9] ?? 0)
      even += even10 * (basis32[frequency * 32 + 10] ?? 0)
      odd += odd10 * (basis32[(frequency + 1) * 32 + 10] ?? 0)
      even += even11 * (basis32[frequency * 32 + 11] ?? 0)
      odd += odd11 * (basis32[(frequency + 1) * 32 + 11] ?? 0)
      even += even12 * (basis32[frequency * 32 + 12] ?? 0)
      odd += odd12 * (basis32[(frequency + 1) * 32 + 12] ?? 0)
      even += even13 * (basis32[frequency * 32 + 13] ?? 0)
      odd += odd13 * (basis32[(frequency + 1) * 32 + 13] ?? 0)
      even += even14 * (basis32[frequency * 32 + 14] ?? 0)
      odd += odd14 * (basis32[(frequency + 1) * 32 + 14] ?? 0)
      even += even15 * (basis32[frequency * 32 + 15] ?? 0)
      odd += odd15 * (basis32[(frequency + 1) * 32 + 15] ?? 0)
      intermediate[short * 32 + frequency] = even
      intermediate[short * 32 + frequency + 1] = odd
    }
  }
  for (let short = 0; short < shortFrequencies; short += 2)
    for (let long = 0; long < longFrequencies; long++) {
      let even = 0,
        odd = 0
      for (let position = 0; position < 8; position++) {
        const top = intermediate[position * 32 + long] ?? 0,
          bottom = intermediate[(15 - position) * 32 + long] ?? 0
        even += (top + bottom) * (basis16[short * 16 + position] ?? 0)
        odd += (top - bottom) * (basis16[(short + 1) * 16 + position] ?? 0)
      }
      coefficients[short * 32 + long] = even / Math.sqrt(512)
      coefficients[(short + 1) * 32 + long] = odd / Math.sqrt(512)
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
