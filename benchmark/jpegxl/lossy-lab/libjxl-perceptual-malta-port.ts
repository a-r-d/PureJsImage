/**
 * Source: libjxl lib/jxl/butteraugli/butteraugli.cc, v0.12.0,
 * a7a9c787341cf703dede03c2009fa460cae5e5df.
 * Copyright (c) the JPEG XL Project Authors. BSD-3-Clause
 * Changes: scalar TypeScript diagnostic of MaltaUnit and MaltaDiffMapT; explicit
 * coordinate stencils and a zero-padded Float64 plane replace SIMD and pointers.
 * Fixed hf_asymmetry=1, no native allocation or threading infrastructure.
 */

// Each row contains (dx,dy) pairs. Retain the source's repeated UHF directions.
const lowStencils = [
  [-4, 0, -2, 0, 0, 0, 2, 0, 4, 0],
  [0, -4, 0, -2, 0, 0, 0, 2, 0, 4],
  [-3, -3, -2, -2, 0, 0, 2, 2, 3, 3],
  [3, -3, 2, -2, 0, 0, -2, 2, -3, 3],
  [1, -4, 1, -2, 0, 0, -1, 2, -1, 4],
  [-1, -4, -1, -2, 0, 0, 1, 2, 1, 4],
  [-4, -1, -2, -1, 0, 0, 2, 1, 4, 1],
  [-4, 1, -2, 1, 0, 0, 2, -1, 4, -1],
  [-2, -3, -1, -2, 0, 0, 1, 2, 2, 3],
  [2, -3, 1, -2, 0, 0, -1, 2, -2, 3],
  [-3, -2, -2, -1, 0, 0, 2, 1, 3, 2],
  [3, -2, 2, -1, 0, 0, -2, 1, -3, 2],
  [-4, 2, -2, 1, 0, 0, 2, -1, 4, -2],
  [-4, -2, -2, -1, 0, 0, 2, 1, 4, 2],
  [-2, -4, -1, -2, 0, 0, 1, 2, 2, 4],
  [2, -4, 1, -2, 0, 0, -1, 2, -2, 4],
].map((row) => Int8Array.from(row))
const highStencils = [
  [-4, 0, -3, 0, -2, 0, -1, 0, 0, 0, 1, 0, 2, 0, 3, 0, 4, 0],
  [0, -4, 0, -3, 0, -2, 0, -1, 0, 0, 0, 1, 0, 2, 0, 3, 0, 4],
  [-3, -3, -2, -2, -1, -1, 0, 0, 1, 1, 2, 2, 3, 3],
  [3, -3, 2, -2, 1, -1, 0, 0, -1, 1, -2, 2, -3, 3],
  [1, -4, 1, -3, 1, -2, 0, -1, 0, 0, 0, 1, -1, 2, -1, 3, -1, 4],
  [-1, -4, -1, -3, -1, -2, 0, -1, 0, 0, 0, 1, 1, 2, 1, 3, 1, 4],
  [-4, -1, -3, -1, -2, -1, -1, 0, 0, 0, 1, 0, 2, 1, 3, 1, 4, 1],
  [-4, 1, -3, 1, -2, 1, -1, 0, 0, 0, 1, 0, 2, -1, 3, -1, 4, -1],
  [-2, -3, -1, -2, -1, -1, 0, 0, 1, 1, 1, 2, 2, 3],
  [2, -3, 1, -2, 1, -1, 0, 0, -1, 1, -1, 2, -2, 3],
  [-3, -2, -2, -1, -1, -1, 0, 0, 1, 1, 2, 1, 3, 2],
  [3, -2, 2, -1, 1, -1, 0, 0, -1, 1, -2, 1, -3, 2],
  [-4, 1, -3, 1, -2, 1, -1, 0, 0, 0, 1, 0, 2, -1, 3, -1, 4, -1],
  [-4, -1, -3, -1, -2, -1, -1, 0, 0, 0, 1, 0, 2, 1, 3, 1, 4, 1],
  [-1, -4, -1, -3, -1, -2, 0, -1, 0, 0, 0, 1, 1, 2, 1, 3, 1, 4],
  [1, -4, 1, -3, 1, -2, 0, -1, 0, 0, 0, 1, -1, 2, -1, 3, -1, 4],
].map((row) => Int8Array.from(row))

export function maltaDirectionalCost(
  source: Float64Array,
  decoded: Float64Array,
  width: number,
  height: number,
  weight: number,
  norm: number,
  band: 'low' | 'high',
): Float64Array {
  if (
    source.length !== width * height ||
    decoded.length !== source.length ||
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width < 1 ||
    height < 1 ||
    !Number.isFinite(weight) ||
    weight < 0 ||
    !Number.isFinite(norm) ||
    norm <= 0
  )
    throw new Error('Invalid Malta input')
  const stride = width + 8,
    padded = new Float64Array(stride * (height + 8)),
    out = new Float64Array(source.length),
    multiplier = band === 'low' ? 0.611612573796 : 0.39905817637,
    symmetric = (multiplier * Math.sqrt(0.5 * weight)) / 8.5,
    asymmetric = (multiplier * Math.sqrt(0.33 * weight)) / 8.5,
    stencils = (band === 'low' ? lowStencils : highStencils).map((row) =>
      Int32Array.from(
        { length: row.length / 2 },
        (_, i) => (row[2 * i] ?? 0) + stride * (row[2 * i + 1] ?? 0),
      ),
    )
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const p = y * width + x,
        a = source[p] ?? 0,
        b = decoded[p] ?? 0,
        scale = norm / (norm + 0.5 * (Math.abs(a) + Math.abs(b))),
        sign = a < 0 ? -1 : 1,
        signed = sign * b,
        lo = 0.55 * Math.abs(a),
        hi = 1.05 * Math.abs(a),
        penalty = signed < lo ? lo - signed : signed > hi ? hi - signed : 0
      padded[(y + 4) * stride + x + 4] = scale * (symmetric * (a - b) + asymmetric * sign * penalty)
    }
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const p = (y + 4) * stride + x + 4
      let cost = 0
      for (let k = 0; k < stencils.length; k++) {
        const offsets = stencils[k]
        if (!offsets) throw new Error('Missing Malta stencil')
        let sum = 0
        for (let j = 0; j < offsets.length; j++) sum += padded[p + (offsets[j] ?? 0)] ?? 0
        cost += sum * sum
      }
      out[y * width + x] = cost
    }
  return out
}

/** Adds the six source-weighted directional components to the quadratic map. */
export function perceptualDirectionalMap(
  source: import('./libjxl-perceptual-local-port.ts').PerceptualImage,
  decoded: import('./libjxl-perceptual-local-port.ts').PerceptualImage,
  quadratic: Float64Array,
): Float64Array {
  if (
    source.width !== decoded.width ||
    source.height !== decoded.height ||
    quadratic.length !== source.width * source.height
  )
    throw new Error('Malta dimensions differ')
  const out = new Float64Array(quadratic.length),
    costs = new Float64Array(out.length)
  const bands = [
    {
      a: source.uhf[1],
      b: decoded.uhf[1],
      weight: 1.10039032555,
      norm: 71.7800275169,
      band: 'high',
    },
    { a: source.uhf[0], b: decoded.uhf[0], weight: 173.5, norm: 5, band: 'high' },
    { a: source.hf[1], b: decoded.hf[1], weight: 18.7237414387, norm: 4498534.45232, band: 'low' },
    { a: source.hf[0], b: decoded.hf[0], weight: 6923.99476109, norm: 8051.15833247, band: 'low' },
    { a: source.mf[1], b: decoded.mf[1], weight: 37.0819870399, norm: 130262059.556, band: 'low' },
    { a: source.mf[0], b: decoded.mf[0], weight: 8246.75321353, norm: 1009002.70582, band: 'low' },
  ] as const
  for (const item of bands) {
    const cost = maltaDirectionalCost(
      item.a,
      item.b,
      source.width,
      source.height,
      item.weight,
      item.norm,
      item.band,
    )
    for (let p = 0; p < costs.length; p++) costs[p] = (costs[p] ?? 0) + (cost[p] ?? 0)
  }
  const scale = 1 / (17.83 * 0.79079917404)
  for (let p = 0; p < out.length; p++) {
    const mask =
      (scale * (1 + 2.5485944793 / (0.451936922203 * (source.mask[p] ?? 0) + 0.829591754942))) ** 2
    out[p] = Math.sqrt((quadratic[p] ?? 0) ** 2 + mask * (costs[p] ?? 0))
  }
  return out
}

/** Source AddSupersampled2x at w=0.5; half-resolution samples use linear RGB. */
export function mixPerceptualScales(
  fine: Float64Array,
  half: Float64Array,
  width: number,
  height: number,
): Float64Array {
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width < 1 ||
    height < 1 ||
    fine.length !== width * height ||
    half.length !== Math.ceil(width / 2) * Math.ceil(height / 2)
  )
    throw new Error('Invalid perceptual scale extent')
  const out = fine.slice(),
    stride = Math.ceil(width / 2)
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      out[y * width + x] =
        0.85 * (fine[y * width + x] ?? 0) +
        0.5 * (half[Math.floor(y / 2) * stride + Math.floor(x / 2)] ?? 0)
  return out
}
