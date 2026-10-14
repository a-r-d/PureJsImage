/**
 * Sources: libjxl lib/jxl/enc_ac_strategy.cc (EstimateEntropy) and
 * lib/jxl/enc_adaptive_quantization.cc (AdjustQuantField), v0.12.0,
 * a7a9c787341cf703dede03c2009fa460cae5e5df.
 * Copyright (c) the JPEG XL Project Authors. BSD-3-Clause
 * Changes: scalar TypeScript over our raw integer quantization field. The
 * sixteenth norm is scale-normalized to avoid overflow; final adjusted values
 * are rounded to the existing wire integer precision. Development only.
 */
export function libjxlTransformQuantization(
  field: ArrayLike<number>,
  stride: number,
  x: number,
  y: number,
  width: number,
  height: number,
  distance: number,
  selection: boolean,
): number {
  let maximum = 0,
    sum = 0
  const count = width * height
  for (let dy = 0; dy < height; dy++)
    for (let dx = 0; dx < width; dx++) {
      const q = field[(y + dy) * stride + x + dx] ?? 0
      if (!(q > 0) || !Number.isFinite(q)) throw new Error('Invalid source quantization field')
      maximum = Math.max(maximum, q)
      sum += q
    }
  if (count <= 2) return maximum
  if (!selection) {
    const mixer = Math.max(0, 1 - Math.max(0, distance - 1.54138) * 0.56391)
    return Math.max(1, Math.round(mixer * maximum + ((1 - mixer) * sum) / count))
  }
  let norm = 0
  for (let dy = 0; dy < height; dy++)
    for (let dx = 0; dx < width; dx++)
      norm += ((field[(y + dy) * stride + x + dx] ?? 0) / maximum) ** 16
  return maximum * (norm / count) ** (1 / 16)
}
