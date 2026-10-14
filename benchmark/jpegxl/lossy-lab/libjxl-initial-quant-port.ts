/**
 * Source: libjxl lib/jxl/enc_adaptive_quantization.cc (InitialQuantField,
 * ComputeTile, FuzzyErosion, PerBlockModulations), lib/jxl/quantizer.cc
 * (ComputeGlobalScaleAndQuant), and lib/jxl/enc_heuristics.cc, v0.12.0,
 * a7a9c787341cf703dede03c2009fa460cae5e5df.
 * Copyright (c) the JPEG XL Project Authors. BSD-3-Clause
 * Changes: scalar TypeScript, Math exp/log rather than SIMD approximations,
 * padded XYB blocks supplied by our encoder, managed luma and quarter-size
 * scratch, optionally a three-block-row luma ring. HF strength can be reduced
 * in a separate first-party diagnostic. No threading, native code, peer maps or iterative metric search.
 */
import type { JpegXlDevelopmentTransformContext } from '../../../src/codecs/jpegxl-development-decisions.ts'
import type { VarDctCoefficientGeometry } from '../../../src/codecs/jpegxl-jpeg-encode.ts'

const numeratorMul = (18.6580932135 * Math.LN2 * 3 * 226.77216153508914) / 73.377132366608819
const denominatorMul = Math.LN2 * 226.77216153508914
const offset = 7.7825991679894591 * Math.LN2 + 0.01
function gammaRatio(value: number): number {
  const v = Math.max(0, value)
  return (numeratorMul * v * v + 0.01) / (denominatorMul * v * v * v + offset)
}

export function libjxlInitialGlobalScale(distance: number, quantDc: number): number {
  if (!(distance >= 0.25 && distance <= 25) || !(quantDc > 0))
    throw new Error('Invalid initial quantization parameters')
  return Math.max(
    1,
    Math.min(32768, Math.floor((65536 * 0.39) / distance / 5), Math.floor(quantDc * 4096 * 1.6)),
  )
}

/** Floating precision in raw-field units. Round only after AdjustQuantField. */
export function libjxlInitialQuantField(
  base: VarDctCoefficientGeometry,
  context: JpegXlDevelopmentTransformContext,
  distance: number,
  hfScale = 1,
  bounded = false,
  darkHf = false,
): Float32Array {
  const memory = base.memory
  if (!memory || !base.globalScale || !(distance > 0 && distance <= 25))
    throw new Error('Missing initial quantization input')
  const width = base.blocksWide * 8,
    height = base.blocksHigh * 8
  const rows = bounded ? Math.min(24, height) : height
  const luma = memory.allocate(Float32Array, width * rows)
  const quarterWidth = width / 4,
    quarterHeight = height / 4
  const pre = memory.allocate(Float32Array, quarterWidth * quarterHeight)
  const field = memory.allocate(Float32Array, base.blocksWide * base.blocksHigh)
  const minima = memory.allocate(Float64Array, 4)
  const loadBlockRow = (by: number): void => {
    for (let bx = 0; bx < base.blocksWide; bx++) {
      const block = context.readBlock(bx, by, false)[1]
      if (!block) throw new Error('Missing initial quantization luminance')
      for (let y = 0; y < 8; y++)
        for (let x = 0; x < 8; x++)
          luma[((by * 8 + y) % rows) * width + bx * 8 + x] = block[y * 8 + x] ?? 0
    }
  }
  if (bounded) loadBlockRow(0)
  else for (let by = 0; by < base.blocksHigh; by++) loadBlockRow(by)
  const maskingMul = Math.sqrt(211.66567973503678 * 1e8)
  for (let y = 0; y < height; y++) {
    if (bounded && y % 8 === 0 && y / 8 + 1 < base.blocksHigh) loadBlockRow(y / 8 + 1)
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
      const at = Math.floor(y / 2) * base.blocksWide + Math.floor(x / 2)
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
  const scale = (0.765 / distance) * (65536 / base.globalScale)
  for (let by = 0; by < base.blocksHigh; by++)
    for (let bx = 0; bx < base.blocksWide; bx++) {
      const block = context.readBlock(bx, by, false)
      const xx = block[0],
        yy = block[1],
        bb = block[2]
      if (!xx || !yy || !bb) throw new Error('Missing initial quantization color')
      let gamma = 0,
        hf = 0,
        blue = 0,
        luminance = 0
      for (let y = 0; y < 8; y++)
        for (let x = 0; x < 8; x++) {
          const at = y * 8 + x,
            v = yy[at] ?? 0,
            chroma = xx[at] ?? 0
          luminance += v
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
      const at = by * base.blocksWide + bx
      const v = Math.max(0.001, (field[at] ?? 0) * 0.80061762862741759)
      const mask =
        -0.7647 +
        9.4708735624378946 / (v * v + 0.25 * 3.7179635626140772) +
        17.35036561631863 / (v + 302.59587815579727) +
        6.7943250517376494 / (v * v + 3.7179635626140772)
      // Preserve stronger masking for dark grain; blend continuously toward
      // the half-strength texture policy by mean XYB luminance 0.4.
      const strength = darkHf
        ? 0.5 + 0.5 * Math.max(0, Math.min(1, (0.4 - luminance / 64) / 0.2))
        : hfScale
      const exponent =
        mask +
        0.1005613337192697 * Math.log2(gamma / 128) +
        Math.min(0.42 - 0.38 * hf * strength, blue)
      field[at] = scale * (dampen * Math.exp(exponent) + (1 - dampen) * 0.48)
    }
  return field
}
