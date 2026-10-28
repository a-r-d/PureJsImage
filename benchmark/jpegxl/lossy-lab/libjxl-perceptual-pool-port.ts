/**
 * Source: libjxl lib/extras/metrics.cc, ComputeDistanceP, v0.12.0,
 * a7a9c787341cf703dede03c2009fa460cae5e5df.
 * Copyright (c) the JPEG XL Project Authors. BSD-3-Clause
 * Changes: scalar TypeScript Float64 accumulation at fixed p=3; validates
 * finite nonnegative input and returns the maximum alongside the native
 * average of L3, L6 and L12. No SIMD or native memory infrastructure.
 */
export function poolNativePerceptual(map: Float64Array | Float32Array) {
  let maximum = 0,
    cube = 0,
    sixth = 0,
    twelfth = 0
  for (let p = 0; p < map.length; p++) {
    const value = map[p] ?? 0
    if (!Number.isFinite(value) || value < 0) throw new Error('Invalid perceptual distance')
    maximum = Math.max(maximum, value)
    const v3 = value ** 3,
      v6 = v3 * v3
    cube += v3
    sixth += v6
    twelfth += v6 * v6
  }
  const norm3 = map.length
    ? (Math.cbrt(cube / map.length) +
        (sixth / map.length) ** (1 / 6) +
        (twelfth / map.length) ** (1 / 12)) /
      3
    : 0
  if (!Number.isFinite(norm3)) throw new Error('Perceptual distance overflow')
  return { maximum, norm3 }
}
