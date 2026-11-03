/**
 * Source: libjxl tools/ssimulacra2.cc, SSIMMap, v0.12.0,
 * a7a9c787341cf703dede03c2009fa460cae5e5df.
 * Copyright (c) the JPEG XL Project Authors. BSD-3-Clause
 * Changes: reuses the structure denominator and 0.0009
 * stabilizer. First-party 8x8 box moments on preconditioned luma replace Gaussian
 * display moments; DC, other channels, scales and edge terms are excluded.
 * No peer decisions. This is not a metric implementation or public encoder.
 */
export function selectorRegularizedDetailLoss(
  source: Float32Array,
  error: Float32Array,
  width: number,
  height: number,
  scale: number,
): number {
  let total = 0
  for (let by = 0; by < height; by += 8)
    for (let bx = 0; bx < width; bx += 8) {
      let sum = 0,
        sumError = 0,
        square = 0,
        squareError = 0,
        cross = 0
      for (let y = 0; y < 8; y++)
        for (let x = 0; x < 8; x++) {
          const at = (by + y) * width + bx + x
          const value = source[at] ?? 0
          const residual = (error[at] ?? 0) * scale
          sum += value
          sumError += residual
          square += value * value
          squareError += residual * residual
          cross += value * residual
        }
      const variance = Math.max(0, square - (sum * sum) / 64)
      const errorVariance = Math.max(0, squareError - (sumError * sumError) / 64)
      const covariance = cross - (sum * sumError) / 64
      const reconstructed = Math.max(0, variance + errorVariance - 2 * covariance)
      const epsilon = 64 * 0.0009
      total += Math.min(1, errorVariance / (variance + reconstructed + epsilon))
    }
  return total / ((width * height) / 64)
}
