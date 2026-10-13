/**
 * Source: libjxl lib/jxl/enc_adaptive_quantization.cc, v0.12.0,
 * a7a9c787341cf703dede03c2009fa460cae5e5df.
 * Copyright (c) the JPEG XL Project Authors. BSD-3-Clause
 * Ported: RatioOfDerivativesOfCubicRootToSimpleGamma, pixel Laplacian mask,
 * and Blur1x1Masking weights. Changes: scalar TypeScript, existing XYB input,
 * padded image extents and clamped borders, managed lab-only plane buffers.
 */
import type { JpegXlDevelopmentTransformContext } from '../../../src/codecs/jpegxl-development-decisions.ts'
import type { VarDctCoefficientGeometry } from '../../../src/codecs/jpegxl-jpeg-encode.ts'

export function libjxlStrategyMask(
  base: VarDctCoefficientGeometry,
  context: JpegXlDevelopmentTransformContext,
): Float32Array {
  const memory = base.memory
  if (!memory) throw new Error('Missing strategy mask memory ledger')
  const width = base.blocksWide * 8,
    height = base.blocksHigh * 8
  const luma = memory.allocate(Float32Array, width * height)
  const raw = memory.allocate(Float32Array, luma.length)
  const blurred = memory.allocate(Float32Array, luma.length)
  for (let by = 0; by < base.blocksHigh; by++)
    for (let bx = 0; bx < base.blocksWide; bx++) {
      const block = context.readBlock(bx, by, false)[1]
      if (!block) throw new Error('Missing strategy mask luminance')
      for (let y = 0; y < 8; y++)
        for (let x = 0; x < 8; x++) luma[(by * 8 + y) * width + bx * 8 + x] = block[y * 8 + x] ?? 0
    }
  const sgMul = 226.77216153508914
  const sgReturn = (18.6580932135 * Math.LN2) / 73.377132366608819
  const numeratorMul = sgReturn * 3 * sgMul
  const denominatorMul = Math.LN2 * sgMul
  const offset = 7.7825991679894591 * Math.LN2 + 0.01
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const at = y * width + x,
        value = luma[at] ?? 0
      const average =
        0.25 *
        ((luma[Math.max(0, y - 1) * width + x] ?? 0) +
          (luma[Math.min(height - 1, y + 1) * width + x] ?? 0) +
          (luma[y * width + Math.max(0, x - 1)] ?? 0) +
          (luma[y * width + Math.min(width - 1, x + 1)] ?? 0))
      const v = Math.max(0, value + 0.019)
      const gamma = (denominatorMul * v * v * v + offset) / (numeratorMul * v * v + 0.01)
      raw[at] = 1 / (Math.log1p(Math.abs(gamma * (value - average))) + 0.01)
    }
  memory.release(luma)
  const adjacent = 0.364911248,
    diagonal = 0.05,
    farAxis = 0.1688888021,
    mixed = 0.221069183,
    farDiagonal = 0.306563504
  const normalization = 1 / (1 + 4 * (adjacent + diagonal + farAxis + farDiagonal + 2 * mixed))
  const kernel = Float64Array.of(
    1,
    adjacent,
    farAxis,
    adjacent,
    diagonal,
    mixed,
    farAxis,
    mixed,
    farDiagonal,
  )
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      let sum = 0
      for (let dy = -2; dy <= 2; dy++)
        for (let dx = -2; dx <= 2; dx++) {
          const weight = kernel[Math.abs(dy) * 3 + Math.abs(dx)] ?? 0
          sum +=
            weight *
            (raw[
              Math.min(height - 1, Math.max(0, y + dy)) * width +
                Math.min(width - 1, Math.max(0, x + dx))
            ] ?? 0)
        }
      blurred[y * width + x] = sum * normalization
    }
  memory.release(raw)
  return blurred
}
