/**
 * Sources: libjxl lib/jxl/enc_adaptive_quantization.cc (InitialQuantField,
 * ComputeTile, FuzzyErosion, PerBlockModulations, InitialQuantDC and
 * AdjustQuantField), lib/jxl/quantizer.cc (ComputeGlobalScaleAndQuant),
 * lib/jxl/quant_weights.h (DC matrix), lib/jxl/enc_frame.cc
 * (LoopFilterFromParams), lib/jxl/enc_heuristics.cc and
 * lib/jxl/enc_ac_strategy.cc (EstimateEntropy), v0.12.0,
 * a7a9c787341cf703dede03c2009fa460cae5e5df.
 * Copyright (c) the JPEG XL Project Authors. BSD-3-Clause
 * Changes: scalar TypeScript with Math exp/log instead of SIMD approximations.
 * XYB blocks come from our encoder, whose third plane stores B-Y. Luma uses a
 * three-block-row ring and quarter-size scratch from the encoder memory ledger.
 * First-party policy: high-frequency masking at 0.625 strength, the masking
 * term at 0.75 strength, DC steps scaled by 0.75 for X/B and 0.5 for Y, at most
 * one EPF iteration, and AC precision raised by up to 10% between internal
 * distances 1.5 and 3. A requested distance maps to an internal distance so that
 * median SSIMULACRA2 on 64 development photos matches libjxl at the same
 * distance, and Gaborish strength fades from off at distance 1.5 to libjxl's
 * default weights at 2.5. The sixteenth norm is scale-normalized to avoid
 * overflow. No threading, native code or metric search.
 */
import type { JpegXlEncoderMemory } from './jpegxl-encoder-memory.ts'
import { invalidJpegXlInput } from './jpegxl-errors.ts'

/** XYB 8x8 blocks from the encoder. Correlated reads also update rate-aware rounding state. */
export interface JpegXlBlockSource {
  readBlock(x: number, y: number, correlated: boolean): readonly Float32Array[]
  quantize(value: number, channel: number): number
  readonly zeroQuantizationThresholds: readonly number[]
}

export interface JpegXlLibjxlFrameParameters {
  readonly globalScale: number
  /** Physical DC steps for X, Y and B-Y before the encoder's distance normalization. */
  readonly dcSteps: readonly [number, number, number]
  /** 0 turns Gaborish off; 1 uses libjxl's default weights. */
  readonly gaborishStrength: number
  readonly epfIterations: number
  readonly sharpness: number
}

const numeratorMul = (18.6580932135 * Math.LN2 * 3 * 226.77216153508914) / 73.377132366608819
const denominatorMul = Math.LN2 * 226.77216153508914
const gammaOffset = 7.7825991679894591 * Math.LN2 + 0.01
const gammaRatio = (value: number): number => {
  const v = Math.max(0, value)
  return (numeratorMul * v * v + 0.01) / (denominatorMul * v * v * v + gammaOffset)
}

/** Internal distance and Gaborish strength for a requested distance. */
export interface JpegXlLibjxlPolicyDistance {
  readonly distance: number
  readonly gaborishStrength: number
}

// Internal distance divided by requested distance, interpolated in log distance. Measured on
// 64 development crops so median SSIMULACRA2 matches wasm-vips 0.0.19 (libjxl, effort 7) at the
// same distance; the knots from 1.5 to 2.5 include the Gaborish fade.
const distanceRatios: readonly (readonly [number, number])[] = [
  [0.25, 0.78],
  [0.75, 0.785],
  [1.3, 0.83],
  [1.5, 0.856],
  [1.65, 0.888],
  [1.85, 0.957],
  [2.05, 1.025],
  [2.25, 1.093],
  [2.5, 1.19],
  [5.6, 1.19],
  [8, 1.14],
  [11.6, 1.09],
  [16.7, 1],
]
const gaborishStart = 1.5,
  gaborishFull = 2.5

/** Map a requested distance to the policy's internal distance and Gaborish strength. */
export const jpegXlLibjxlPolicyDistance = (distance: number): JpegXlLibjxlPolicyDistance => {
  if (!(distance >= 0.25 && distance <= 25))
    throw invalidJpegXlInput('libjxl policy distance must be between 0.25 and 25')
  let ratio = 1
  for (let i = 1; i < distanceRatios.length; i++) {
    const [from, start] = distanceRatios[i - 1] ?? [1, 1]
    const [to, end] = distanceRatios[i] ?? [1, 1]
    if (distance <= to) {
      ratio =
        start + ((end - start) * Math.log(Math.max(distance, from) / from)) / Math.log(to / from)
      break
    }
  }
  // Fading Gaborish in over a band keeps file size falling as distance rises; a hard switch
  // grew some photos by more than 25%.
  const fade = Math.log(distance / gaborishStart) / Math.log(gaborishFull / gaborishStart)
  return {
    distance: Math.min(25, ratio * distance),
    gaborishStrength: Math.max(0, Math.min(1, fade)),
  }
}

/** Frame-wide decisions for the libjxl-derived effort-7 policy at an internal distance. */
export const jpegXlLibjxlFrameParameters = (
  distance: number,
  gaborishStrength: number,
): JpegXlLibjxlFrameParameters => {
  if (!(distance >= 0.1 && distance <= 25) || !(gaborishStrength >= 0 && gaborishStrength <= 1))
    throw invalidJpegXlInput('libjxl policy internal distance or Gaborish strength is invalid')
  const dcDistance = Math.max(0.5 * distance, Math.min(distance, 0.3 * (distance / 0.3) ** 0.83))
  const quant = Math.min(1.095924047623553 / dcDistance, 50)
  const steps = [1 / (4096 * quant), 1 / (512 * quant), 1 / (256 * quant)] as const
  // Keep InitialQuantDC's round trip through the Y step; it defines the global scale bound.
  const quantDc = 1 / (512 * steps[1])
  return {
    globalScale: Math.max(
      1,
      Math.min(32768, Math.floor((65536 * 0.39) / distance / 5), Math.floor(quantDc * 4096 * 1.6)),
    ),
    dcSteps: [steps[0] * 0.75, steps[1] * 0.5, steps[2] * 0.75],
    gaborishStrength,
    epfIterations: Math.min(
      1,
      Number(distance >= 0.7) + Number(distance >= 1.5) + Number(distance >= 4),
    ),
    sharpness: 4,
  }
}

/** Floating raw-field precision per block. The caller rounds after AdjustQuantField. */
export const jpegXlLibjxlInitialQuantField = (
  source: JpegXlBlockSource,
  blocksWide: number,
  blocksHigh: number,
  globalScale: number,
  distance: number,
  memory: JpegXlEncoderMemory,
): Float32Array => {
  if (!(globalScale > 0) || !(distance > 0 && distance <= 25))
    throw invalidJpegXlInput('libjxl quant field input is invalid')
  const hfScale = 0.625
  const width = blocksWide * 8,
    height = blocksHigh * 8
  const rows = Math.min(24, height)
  const luma = memory.allocate(Float32Array, width * rows)
  const quarterWidth = width / 4,
    quarterHeight = height / 4
  const pre = memory.allocate(Float32Array, quarterWidth * quarterHeight)
  const field = memory.allocate(Float32Array, blocksWide * blocksHigh)
  const minima = memory.allocate(Float64Array, 4)
  const loadBlockRow = (by: number): void => {
    for (let bx = 0; bx < blocksWide; bx++) {
      const block = source.readBlock(bx, by, false)[1]
      if (!block) throw invalidJpegXlInput('libjxl quant field luma is missing')
      for (let y = 0; y < 8; y++)
        for (let x = 0; x < 8; x++)
          luma[((by * 8 + y) % rows) * width + bx * 8 + x] = block[y * 8 + x] ?? 0
    }
  }
  loadBlockRow(0)
  const maskingMul = Math.sqrt(211.66567973503678 * 1e8)
  for (let y = 0; y < height; y++) {
    if (y % 8 === 0 && y / 8 + 1 < blocksHigh) loadBlockRow(y / 8 + 1)
    const row = (y % rows) * width
    const previous = (Math.max(0, y - 1) % rows) * width
    const next = (Math.min(height - 1, y + 1) % rows) * width
    for (let x = 0; x < width; x++) {
      const value = luma[row + x] ?? 0
      const average =
        0.25 *
        ((luma[previous + x] ?? 0) +
          (luma[next + x] ?? 0) +
          (luma[row + Math.max(0, x - 1)] ?? 0) +
          (luma[row + Math.min(width - 1, x + 1)] ?? 0))
      const diff = (value - average) / gammaRatio(value + 0.019)
      const at = Math.floor(y / 4) * quarterWidth + Math.floor(x / 4)
      pre[at] =
        (pre[at] ?? 0) +
        0.0625 * Math.sqrt(Math.min(0.2, diff * diff) * maskingMul + 27.505837037000106)
    }
  }
  const erosionRamp = Math.max(0, (2 - distance) / 2)
  const w0 = 0.125,
    w1 = 0.1 * (1 - erosionRamp),
    w2 = 0.09 * (1 - erosionRamp),
    w3 = 0.06 * (1 - erosionRamp)
  const erosionScale = 0.29959705784054957 / (w0 + w1 + w2 + w3)
  for (let y = 0; y < quarterHeight; y++)
    for (let x = 0; x < quarterWidth; x++) {
      minima.fill(Infinity)
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const v =
            pre[
              Math.max(0, Math.min(quarterHeight - 1, y + dy)) * quarterWidth +
                Math.max(0, Math.min(quarterWidth - 1, x + dx))
            ] ?? 0
          for (let i = 0; i < 4; i++)
            if (v < (minima[i] ?? Infinity)) {
              for (let j = 3; j > i; j--) minima[j] = minima[j - 1] ?? 0
              minima[i] = v
              break
            }
        }
      const at = Math.floor(y / 2) * blocksWide + Math.floor(x / 2)
      field[at] =
        (field[at] ?? 0) +
        erosionScale *
          (w0 * (minima[0] ?? 0) +
            w1 * (minima[1] ?? 0) +
            w2 * (minima[2] ?? 0) +
            w3 * (minima[3] ?? 0))
    }
  memory.release(luma)
  memory.release(pre)
  memory.release(minima)
  const dampen = Math.max(0, Math.min(1, 1 - (distance - 2) / 12))
  const scale = (0.765 / distance) * (65536 / globalScale)
  for (let by = 0; by < blocksHigh; by++)
    for (let bx = 0; bx < blocksWide; bx++) {
      const block = source.readBlock(bx, by, false)
      const xx = block[0],
        yy = block[1],
        bb = block[2]
      if (!xx || !yy || !bb) throw invalidJpegXlInput('libjxl quant field color is missing')
      let gamma = 0,
        hf = 0,
        blue = 0
      for (let y = 0; y < 8; y++)
        for (let x = 0; x < 8; x++) {
          const at = y * 8 + x,
            v = yy[at] ?? 0,
            chroma = xx[at] ?? 0
          gamma += gammaRatio(v + 0.16 - chroma) + gammaRatio(v + 0.16 + chroma)
          if (x < 7) hf += Math.min(0.0206, Math.abs(v - (yy[at + 1] ?? 0)))
          if (y < 7) hf += Math.min(0.0206, Math.abs(v - (yy[at + 8] ?? 0)))
          // Our third plane stores B-Y; native opsin stores B.
          blue += Math.max(
            0,
            Math.min(
              0.010474084867598155,
              (bb[at] ?? 0) - 0.0031994768654636393 - Math.abs(chroma),
            ),
          )
        }
      if (blue >= 32 * 0.010474084867598155) blue = 64 * 0.010474084867598155 - blue
      blue = Math.min(blue, 15.463398341612438 * 0.010474084867598155) * 0.90590804735610064
      const at = by * blocksWide + bx
      const v = Math.max(0.001, (field[at] ?? 0) * 0.80061762862741759)
      const mask =
        -0.7647 +
        9.4708735624378946 / (v * v + 0.25 * 3.7179635626140772) +
        17.35036561631863 / (v + 302.59587815579727) +
        6.7943250517376494 / (v * v + 3.7179635626140772)
      const exponent =
        0.75 * mask +
        0.1005613337192697 * Math.log2(gamma / 128) +
        Math.min(0.42 - 0.38 * hf * hfScale, blue)
      field[at] = scale * (dampen * Math.exp(exponent) + (1 - dampen) * 0.48)
    }
  return field
}

/** First-party coarse-distance allocation: up to 10% more AC precision from distance 1.5 to 3. */
export const raiseJpegXlLibjxlCoarsePrecision = (field: Float32Array, distance: number): void => {
  const precision = 1 + 0.1 * Math.max(0, Math.min(1, (distance - 1.5) / 1.5))
  if (precision !== 1) for (let i = 0; i < field.length; i++) field[i] = (field[i] ?? 0) * precision
}

/**
 * Raw quantizer for a transform footprint. Selection uses the scale-normalized
 * sixteenth norm; the final field uses AdjustQuantField's maximum/mean blend.
 */
export const jpegXlLibjxlTransformQuantization = (
  field: Float32Array,
  stride: number,
  x: number,
  y: number,
  width: number,
  height: number,
  distance: number,
  selection: boolean,
): number => {
  let maximum = 0,
    sum = 0
  const count = width * height
  for (let dy = 0; dy < height; dy++)
    for (let dx = 0; dx < width; dx++) {
      const q = field[(y + dy) * stride + x + dx] ?? 0
      if (!(q > 0) || !Number.isFinite(q)) throw invalidJpegXlInput('libjxl quant field is invalid')
      maximum = Math.max(maximum, q)
      sum += q
    }
  if (count <= 2) return maximum
  if (!selection) {
    const mixer = Math.max(0, 1 - Math.max(0, distance - 1.54138) * 0.56391)
    return mixer * maximum + ((1 - mixer) * sum) / count
  }
  let norm = 0
  for (let dy = 0; dy < height; dy++)
    for (let dx = 0; dx < width; dx++)
      norm += ((field[(y + dy) * stride + x + dx] ?? 0) / maximum) ** 16
  return maximum * (norm / count) ** (1 / 16)
}
