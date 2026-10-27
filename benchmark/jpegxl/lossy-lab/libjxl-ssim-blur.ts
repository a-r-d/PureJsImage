/**
 * Source: libjxl tools/gauss_blur.cc, CreateRecursiveGaussian, v0.12.0,
 * a7a9c787341cf703dede03c2009fa460cae5e5df.
 * Copyright (c) the JPEG XL Project Authors. BSD-3-Clause
 * Changes: scalar sigma-1.5 coefficient construction. Evaluate the equivalent
 * finite cosine kernel directly instead of porting recursive SIMD, threading or
 * image infrastructure. Uses Float64 math; native float recurrence drift is not
 * reproduced. This development diagnostic is not part of the public bundle.
 */
export function ssimCosineKernel(): Float64Array {
  const sigma = 1.5,
    radius = Math.round(3.2795 * sigma + 0.2546)
  const omega = Float64Array.of(
    Math.PI / (2 * radius),
    (3 * Math.PI) / (2 * radius),
    (5 * Math.PI) / (2 * radius),
  )
  const p = Float64Array.from(omega, (w, i) => (i === 1 ? -1 : 1) / Math.tan(w / 2))
  const r = Float64Array.from(
    omega,
    (w, i) => ((i === 1 ? -1 : 1) * (p[i] ?? 0) ** 2) / Math.sin(w),
  )
  const rho = Float64Array.from(omega, (w) => Math.exp(-0.5 * sigma * sigma * w * w) / radius)
  const d13 = (p[0] ?? 0) * (r[1] ?? 0) - (r[0] ?? 0) * (p[1] ?? 0)
  const z15 = ((p[1] ?? 0) * (r[2] ?? 0) - (r[1] ?? 0) * (p[2] ?? 0)) / d13
  const z35 = ((p[2] ?? 0) * (r[0] ?? 0) - (r[2] ?? 0) * (p[0] ?? 0)) / d13
  const matrix = Float64Array.of(
    p[0] ?? 0,
    p[1] ?? 0,
    p[2] ?? 0,
    1,
    r[0] ?? 0,
    r[1] ?? 0,
    r[2] ?? 0,
    radius * radius - sigma * sigma,
    z15,
    z35,
    1,
    z15 * (rho[0] ?? 0) + z35 * (rho[1] ?? 0) + (rho[2] ?? 0),
  )
  // Three-equation scalar solve, only during diagnostic module initialization.
  for (let column = 0; column < 3; column++) {
    let pivot = column
    for (let row = column + 1; row < 3; row++)
      if (Math.abs(matrix[row * 4 + column] ?? 0) > Math.abs(matrix[pivot * 4 + column] ?? 0))
        pivot = row
    for (let c = column; c < 4; c++) {
      const temp = matrix[column * 4 + c] ?? 0
      matrix[column * 4 + c] = matrix[pivot * 4 + c] ?? 0
      matrix[pivot * 4 + c] = temp
    }
    const divisor = matrix[column * 4 + column] ?? 0
    if (Math.abs(divisor) < 1e-15) throw new Error('Singular blur coefficient system')
    for (let c = column; c < 4; c++)
      matrix[column * 4 + c] = (matrix[column * 4 + c] ?? 0) / divisor
    for (let row = 0; row < 3; row++)
      if (row !== column) {
        const factor = matrix[row * 4 + column] ?? 0
        for (let c = column; c < 4; c++)
          matrix[row * 4 + c] = (matrix[row * 4 + c] ?? 0) - factor * (matrix[column * 4 + c] ?? 0)
      }
  }
  const result = new Float64Array(2 * radius - 1)
  for (let x = -radius + 1; x < radius; x++) {
    let value = 0
    for (let c = 0; c < 3; c++) value += (matrix[c * 4 + 3] ?? 0) * Math.cos((omega[c] ?? 0) * x)
    result[x + radius - 1] = value
  }
  return result
}
