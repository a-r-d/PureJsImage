/**
 * Source: libjxl lib/jxl/butteraugli/butteraugli.cc, v0.12.0,
 * a7a9c787341cf703dede03c2009fa460cae5e5df.
 * Copyright (c) the JPEG XL Project Authors. BSD-3-Clause
 * Changes: scalar TypeScript diagnostic of MaltaUnit and MaltaDiffMapT; explicit
 * coordinate stencils and a zero-padded Float64 plane replace SIMD and pointers.
 * Fixed hf_asymmetry=1, no native allocation or threading infrastructure.
 * Optional output windows bound the padded difference plane to requested support.
 * Fixed directional kernels preserve each sum and cost addition order.
 * Identical high-frequency stencils reuse their sum at the original positions.
 * Six bands reuse padded scratch and accumulate directly in original order.
 */
import { type PerceptualWindow, perceptualWindow } from './libjxl-perceptual-local-port.ts'

export function maltaDirectionalCost(
  source: Float64Array,
  decoded: Float64Array,
  width: number,
  height: number,
  weight: number,
  norm: number,
  band: 'low' | 'high',
  box?: PerceptualWindow,
): Float64Array {
  return directionalCost(source, decoded, width, height, weight, norm, band, box)
}

function directionalCost(
  source: Float64Array,
  decoded: Float64Array,
  width: number,
  height: number,
  weight: number,
  norm: number,
  band: 'low' | 'high',
  box?: PerceptualWindow,
  scratch?: { readonly padded: Float64Array; readonly out: Float64Array },
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
  const window = perceptualWindow(width, height, box),
    stride = window.width + 8,
    padded = scratch?.padded ?? new Float64Array(stride * (window.height + 8)),
    out = scratch?.out ?? new Float64Array(window.width * window.height),
    multiplier = band === 'low' ? 0.611612573796 : 0.39905817637,
    symmetric = (multiplier * Math.sqrt(0.5 * weight)) / 8.5,
    asymmetric = (multiplier * Math.sqrt(0.33 * weight)) / 8.5
  for (let y = Math.max(0, window.y - 4); y < Math.min(height, window.y + window.height + 4); y++)
    for (let x = Math.max(0, window.x - 4); x < Math.min(width, window.x + window.width + 4); x++) {
      const p = y * width + x,
        a = source[p] ?? 0,
        b = decoded[p] ?? 0,
        scale = norm / (norm + 0.5 * (Math.abs(a) + Math.abs(b))),
        sign = a < 0 ? -1 : 1,
        signed = sign * b,
        lo = 0.55 * Math.abs(a),
        hi = 1.05 * Math.abs(a),
        penalty = signed < lo ? lo - signed : signed > hi ? hi - signed : 0
      padded[(y - window.y + 4) * stride + x - window.x + 4] =
        scale * (symmetric * (a - b) + asymmetric * sign * penalty)
    }
  if (band === 'low') lowDirectionalSums(padded, out, window.width, window.height, stride)
  else highDirectionalSums(padded, out, window.width, window.height, stride)
  return out
}

/** Adds the six source-weighted directional components to the quadratic map. */
export function perceptualDirectionalMap(
  source: import('./libjxl-perceptual-local-port.ts').PerceptualImage,
  decoded: import('./libjxl-perceptual-local-port.ts').PerceptualImage,
  quadratic: Float64Array,
  box?: PerceptualWindow,
): Float64Array {
  const window = perceptualWindow(source.width, source.height, box)
  if (
    source.width !== decoded.width ||
    source.height !== decoded.height ||
    quadratic.length !== window.width * window.height
  )
    throw new Error('Malta dimensions differ')
  const out = new Float64Array(quadratic.length),
    costs = new Float64Array(out.length),
    scratch = { padded: new Float64Array((window.width + 8) * (window.height + 8)), out: costs }
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
    directionalCost(
      item.a,
      item.b,
      source.width,
      source.height,
      item.weight,
      item.norm,
      item.band,
      window,
      scratch,
    )
  }
  const scale = 1 / (17.83 * 0.79079917404)
  for (let y = 0; y < window.height; y++)
    for (let x = 0; x < window.width; x++) {
      const p = y * window.width + x,
        q = (y + window.y) * source.width + x + window.x
      const mask =
        (scale * (1 + 2.5485944793 / (0.451936922203 * (source.mask[q] ?? 0) + 0.829591754942))) **
        2
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

function lowDirectionalSums(
  padded: Float64Array,
  out: Float64Array,
  width: number,
  height: number,
  stride: number,
): void {
  const r1 = stride,
    r2 = 2 * stride,
    r3 = 3 * stride,
    r4 = 4 * stride
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const p = (y + 4) * stride + x + 4
      const s0 =
        0 +
        (padded[p - 4] ?? 0) +
        (padded[p - 2] ?? 0) +
        (padded[p] ?? 0) +
        (padded[p + 2] ?? 0) +
        (padded[p + 4] ?? 0)
      const s1 =
        0 +
        (padded[p - r4] ?? 0) +
        (padded[p - r2] ?? 0) +
        (padded[p] ?? 0) +
        (padded[p + r2] ?? 0) +
        (padded[p + r4] ?? 0)
      const s2 =
        0 +
        (padded[p - r3 - 3] ?? 0) +
        (padded[p - r2 - 2] ?? 0) +
        (padded[p] ?? 0) +
        (padded[p + r2 + 2] ?? 0) +
        (padded[p + r3 + 3] ?? 0)
      const s3 =
        0 +
        (padded[p - r3 + 3] ?? 0) +
        (padded[p - r2 + 2] ?? 0) +
        (padded[p] ?? 0) +
        (padded[p + r2 - 2] ?? 0) +
        (padded[p + r3 - 3] ?? 0)
      const s4 =
        0 +
        (padded[p - r4 + 1] ?? 0) +
        (padded[p - r2 + 1] ?? 0) +
        (padded[p] ?? 0) +
        (padded[p + r2 - 1] ?? 0) +
        (padded[p + r4 - 1] ?? 0)
      const s5 =
        0 +
        (padded[p - r4 - 1] ?? 0) +
        (padded[p - r2 - 1] ?? 0) +
        (padded[p] ?? 0) +
        (padded[p + r2 + 1] ?? 0) +
        (padded[p + r4 + 1] ?? 0)
      const s6 =
        0 +
        (padded[p - r1 - 4] ?? 0) +
        (padded[p - r1 - 2] ?? 0) +
        (padded[p] ?? 0) +
        (padded[p + r1 + 2] ?? 0) +
        (padded[p + r1 + 4] ?? 0)
      const s7 =
        0 +
        (padded[p + r1 - 4] ?? 0) +
        (padded[p + r1 - 2] ?? 0) +
        (padded[p] ?? 0) +
        (padded[p - r1 + 2] ?? 0) +
        (padded[p - r1 + 4] ?? 0)
      const s8 =
        0 +
        (padded[p - r3 - 2] ?? 0) +
        (padded[p - r2 - 1] ?? 0) +
        (padded[p] ?? 0) +
        (padded[p + r2 + 1] ?? 0) +
        (padded[p + r3 + 2] ?? 0)
      const s9 =
        0 +
        (padded[p - r3 + 2] ?? 0) +
        (padded[p - r2 + 1] ?? 0) +
        (padded[p] ?? 0) +
        (padded[p + r2 - 1] ?? 0) +
        (padded[p + r3 - 2] ?? 0)
      const s10 =
        0 +
        (padded[p - r2 - 3] ?? 0) +
        (padded[p - r1 - 2] ?? 0) +
        (padded[p] ?? 0) +
        (padded[p + r1 + 2] ?? 0) +
        (padded[p + r2 + 3] ?? 0)
      const s11 =
        0 +
        (padded[p - r2 + 3] ?? 0) +
        (padded[p - r1 + 2] ?? 0) +
        (padded[p] ?? 0) +
        (padded[p + r1 - 2] ?? 0) +
        (padded[p + r2 - 3] ?? 0)
      const s12 =
        0 +
        (padded[p + r2 - 4] ?? 0) +
        (padded[p + r1 - 2] ?? 0) +
        (padded[p] ?? 0) +
        (padded[p - r1 + 2] ?? 0) +
        (padded[p - r2 + 4] ?? 0)
      const s13 =
        0 +
        (padded[p - r2 - 4] ?? 0) +
        (padded[p - r1 - 2] ?? 0) +
        (padded[p] ?? 0) +
        (padded[p + r1 + 2] ?? 0) +
        (padded[p + r2 + 4] ?? 0)
      const s14 =
        0 +
        (padded[p - r4 - 2] ?? 0) +
        (padded[p - r2 - 1] ?? 0) +
        (padded[p] ?? 0) +
        (padded[p + r2 + 1] ?? 0) +
        (padded[p + r4 + 2] ?? 0)
      const s15 =
        0 +
        (padded[p - r4 + 2] ?? 0) +
        (padded[p - r2 + 1] ?? 0) +
        (padded[p] ?? 0) +
        (padded[p + r2 - 1] ?? 0) +
        (padded[p + r4 - 2] ?? 0)
      let cost = 0
      cost += s0 * s0
      cost += s1 * s1
      cost += s2 * s2
      cost += s3 * s3
      cost += s4 * s4
      cost += s5 * s5
      cost += s6 * s6
      cost += s7 * s7
      cost += s8 * s8
      cost += s9 * s9
      cost += s10 * s10
      cost += s11 * s11
      cost += s12 * s12
      cost += s13 * s13
      cost += s14 * s14
      cost += s15 * s15
      const index = y * width + x
      out[index] = (out[index] ?? 0) + cost
    }
}

function highDirectionalSums(
  padded: Float64Array,
  out: Float64Array,
  width: number,
  height: number,
  stride: number,
): void {
  const r1 = stride,
    r2 = 2 * stride,
    r3 = 3 * stride,
    r4 = 4 * stride
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const p = (y + 4) * stride + x + 4
      const s0 =
        0 +
        (padded[p - 4] ?? 0) +
        (padded[p - 3] ?? 0) +
        (padded[p - 2] ?? 0) +
        (padded[p - 1] ?? 0) +
        (padded[p] ?? 0) +
        (padded[p + 1] ?? 0) +
        (padded[p + 2] ?? 0) +
        (padded[p + 3] ?? 0) +
        (padded[p + 4] ?? 0)
      const s1 =
        0 +
        (padded[p - r4] ?? 0) +
        (padded[p - r3] ?? 0) +
        (padded[p - r2] ?? 0) +
        (padded[p - r1] ?? 0) +
        (padded[p] ?? 0) +
        (padded[p + r1] ?? 0) +
        (padded[p + r2] ?? 0) +
        (padded[p + r3] ?? 0) +
        (padded[p + r4] ?? 0)
      const s2 =
        0 +
        (padded[p - r3 - 3] ?? 0) +
        (padded[p - r2 - 2] ?? 0) +
        (padded[p - r1 - 1] ?? 0) +
        (padded[p] ?? 0) +
        (padded[p + r1 + 1] ?? 0) +
        (padded[p + r2 + 2] ?? 0) +
        (padded[p + r3 + 3] ?? 0)
      const s3 =
        0 +
        (padded[p - r3 + 3] ?? 0) +
        (padded[p - r2 + 2] ?? 0) +
        (padded[p - r1 + 1] ?? 0) +
        (padded[p] ?? 0) +
        (padded[p + r1 - 1] ?? 0) +
        (padded[p + r2 - 2] ?? 0) +
        (padded[p + r3 - 3] ?? 0)
      const s4 =
        0 +
        (padded[p - r4 + 1] ?? 0) +
        (padded[p - r3 + 1] ?? 0) +
        (padded[p - r2 + 1] ?? 0) +
        (padded[p - r1] ?? 0) +
        (padded[p] ?? 0) +
        (padded[p + r1] ?? 0) +
        (padded[p + r2 - 1] ?? 0) +
        (padded[p + r3 - 1] ?? 0) +
        (padded[p + r4 - 1] ?? 0)
      const s5 =
        0 +
        (padded[p - r4 - 1] ?? 0) +
        (padded[p - r3 - 1] ?? 0) +
        (padded[p - r2 - 1] ?? 0) +
        (padded[p - r1] ?? 0) +
        (padded[p] ?? 0) +
        (padded[p + r1] ?? 0) +
        (padded[p + r2 + 1] ?? 0) +
        (padded[p + r3 + 1] ?? 0) +
        (padded[p + r4 + 1] ?? 0)
      const s6 =
        0 +
        (padded[p - r1 - 4] ?? 0) +
        (padded[p - r1 - 3] ?? 0) +
        (padded[p - r1 - 2] ?? 0) +
        (padded[p - 1] ?? 0) +
        (padded[p] ?? 0) +
        (padded[p + 1] ?? 0) +
        (padded[p + r1 + 2] ?? 0) +
        (padded[p + r1 + 3] ?? 0) +
        (padded[p + r1 + 4] ?? 0)
      const s7 =
        0 +
        (padded[p + r1 - 4] ?? 0) +
        (padded[p + r1 - 3] ?? 0) +
        (padded[p + r1 - 2] ?? 0) +
        (padded[p - 1] ?? 0) +
        (padded[p] ?? 0) +
        (padded[p + 1] ?? 0) +
        (padded[p - r1 + 2] ?? 0) +
        (padded[p - r1 + 3] ?? 0) +
        (padded[p - r1 + 4] ?? 0)
      const s8 =
        0 +
        (padded[p - r3 - 2] ?? 0) +
        (padded[p - r2 - 1] ?? 0) +
        (padded[p - r1 - 1] ?? 0) +
        (padded[p] ?? 0) +
        (padded[p + r1 + 1] ?? 0) +
        (padded[p + r2 + 1] ?? 0) +
        (padded[p + r3 + 2] ?? 0)
      const s9 =
        0 +
        (padded[p - r3 + 2] ?? 0) +
        (padded[p - r2 + 1] ?? 0) +
        (padded[p - r1 + 1] ?? 0) +
        (padded[p] ?? 0) +
        (padded[p + r1 - 1] ?? 0) +
        (padded[p + r2 - 1] ?? 0) +
        (padded[p + r3 - 2] ?? 0)
      const s10 =
        0 +
        (padded[p - r2 - 3] ?? 0) +
        (padded[p - r1 - 2] ?? 0) +
        (padded[p - r1 - 1] ?? 0) +
        (padded[p] ?? 0) +
        (padded[p + r1 + 1] ?? 0) +
        (padded[p + r1 + 2] ?? 0) +
        (padded[p + r2 + 3] ?? 0)
      const s11 =
        0 +
        (padded[p - r2 + 3] ?? 0) +
        (padded[p - r1 + 2] ?? 0) +
        (padded[p - r1 + 1] ?? 0) +
        (padded[p] ?? 0) +
        (padded[p + r1 - 1] ?? 0) +
        (padded[p + r1 - 2] ?? 0) +
        (padded[p + r2 - 3] ?? 0)
      let cost = 0
      cost += s0 * s0
      cost += s1 * s1
      cost += s2 * s2
      cost += s3 * s3
      cost += s4 * s4
      cost += s5 * s5
      cost += s6 * s6
      cost += s7 * s7
      cost += s8 * s8
      cost += s9 * s9
      cost += s10 * s10
      cost += s11 * s11
      cost += s7 * s7
      cost += s6 * s6
      cost += s5 * s5
      cost += s4 * s4
      const index = y * width + x
      out[index] = (out[index] ?? 0) + cost
    }
}
