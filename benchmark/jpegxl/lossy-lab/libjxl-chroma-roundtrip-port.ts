/**
 * Source: libjxl lib/jxl/enc_group.cc, QuantizeRoundtripYBlockAC and
 * ComputeCoefficients, v0.12.0, a7a9c787341cf703dede03c2009fa460cae5e5df.
 * Copyright (c) the JPEG XL Project Authors. BSD-3-Clause
 * Changes: scalar TypeScript quantizes Y with our existing rounding policy,
 * reconstructs normative biased values, and writes our coefficient layout.
 * No native threshold adjustment, SIMD or infrastructure is copied.
 */
import type { JpegXlDevelopmentTransformContext } from '../../../src/codecs/jpegxl-development-decisions.ts'
import { defaultJpegXlQuantizationBiases } from '../../../src/codecs/jpegxl-vardct-quantization.ts'

export function libjxlRoundtripLuma(
  source: Float64Array,
  reconstructed: Float64Array,
  target: Int16Array,
  offset: number,
  size: number,
  blocksWide: number,
  blocksHigh: number,
  scale: number,
  matrix: Float64Array,
  context: JpegXlDevelopmentTransformContext,
): void {
  const naturalWidth = Math.max(blocksWide, blocksHigh) * 8
  for (let p = 0; p < size; p++) {
    const original = source[p] ?? 0
    if (
      p % naturalWidth < Math.max(blocksWide, blocksHigh) &&
      Math.floor(p / naturalWidth) < Math.min(blocksWide, blocksHigh)
    ) {
      reconstructed[p] = original
      continue
    }
    const step = scale * (matrix[p] ?? 0)
    const value = context.quantize(original / step, 1)
    if (!Number.isFinite(value) || Math.abs(value) > 4095)
      throw new Error('Roundtrip luma coefficient exceeds writer range')
    target[offset + (size === 64 ? (p & 7) * 8 + (p >>> 3) : p)] = value
    const corrected =
      value === 0
        ? 0
        : Math.abs(value) === 1
          ? Math.sign(value) * (defaultJpegXlQuantizationBiases[1] ?? 1)
          : value - 0.145 / value
    reconstructed[p] = corrected * step
  }
}

/** Bridge our B-minus-original-Y working plane to native reconstructed-Y CfL. */
export function libjxlChromaResidual(
  value: number,
  originalY: number,
  reconstructedY: number,
  ratio: number,
  blue: boolean,
): number {
  return blue ? value + originalY - (1 + ratio) * reconstructedY : value - ratio * reconstructedY
}
