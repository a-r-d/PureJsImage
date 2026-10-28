/**
 * Source: libjxl lib/jxl/butteraugli/butteraugli.cc and .h, v0.12.0,
 * a7a9c787341cf703dede03c2009fa460cae5e5df.
 * Copyright (c) the JPEG XL Project Authors. BSD-3-Clause
 * Changes: offline scalar TypeScript diagnostic, fixed SDR intensity 80,
 * Float64 planes, direct normalized Gaussian convolution and Math.log.
 * Ports local adaptation, frequency separation, range shaping, masking and
 * quadratic/asymmetric costs. Omits Malta directional costs and coarse-scale
 * mixing. This is a component ablation, not the native metric or an encoder rule.
 * No SIMD, threading, allocation infrastructure or peer decisions are ported.
 */
import { type DisplayPlanes, displayLinearPlanes } from './libjxl-display-loss.ts'

export type PerceptualPlanes = readonly [Float64Array, Float64Array, Float64Array]
const planes = (n: number): PerceptualPlanes => [
  new Float64Array(n),
  new Float64Array(n),
  new Float64Array(n),
]
const remove = (v: number, r: number) => Math.sign(v) * Math.max(0, Math.abs(v) - r)
const amplify = (v: number, r: number) => v + Math.sign(v) * Math.min(Math.abs(v), r)
const clamp = (v: number, limit: number) =>
  Math.abs(v) <= limit ? v : Math.sign(v) * (limit + (Math.abs(v) - limit) * 0.724216145665)

/** Five-tap kernels mirror edges; larger kernels renormalize their truncated support. */
export function perceptualBlur(
  input: Float64Array | Float32Array,
  width: number,
  height: number,
  sigma: number,
): Float64Array {
  if (
    input.length !== width * height ||
    width < 1 ||
    height < 1 ||
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    !Number.isFinite(sigma) ||
    sigma <= 0
  )
    throw new Error('Invalid perceptual blur')
  const radius = Math.max(1, Math.floor(2.25 * sigma)),
    kernel = Float64Array.from({ length: 2 * radius + 1 }, (_, i) =>
      Math.exp(-((i - radius) ** 2) / (2 * sigma ** 2)),
    ),
    temp = new Float64Array(input.length),
    out = new Float64Array(input.length)
  const mirror = (v: number, n: number) => {
    let p = ((v % (2 * n)) + 2 * n) % (2 * n)
    if (p >= n) p = 2 * n - 1 - p
    return p
  }
  for (let axis = 0; axis < 2; axis++) {
    const src = axis === 0 ? input : temp,
      dst = axis === 0 ? temp : out,
      extent = axis === 0 ? width : height
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        let sum = 0,
          weights = 0
        for (let k = -radius; k <= radius; k++) {
          let p = (axis === 0 ? x : y) + k
          if (radius === 2) p = mirror(p, extent)
          else if (p < 0 || p >= extent) continue
          const weight = kernel[k + radius] ?? 0
          sum += weight * (src[axis === 0 ? y * width + p : p * width + x] ?? 0)
          weights += weight
        }
        dst[y * width + x] = sum / weights
      }
  }
  return out
}

function opsin(rgb: DisplayPlanes, width: number, height: number): PerceptualPlanes {
  const smooth = rgb.map((p) => perceptualBlur(p, width, height, 1.2)),
    out = planes(width * height)
  const matrix = [
    [0.29956550340058319, 0.63373087833825936, 0.077705617820981968, 1.7557483643287353],
    [0.22158691104574774, 0.69391388044116142, 0.0987313588422, 1.7557483643287353],
    [0.02, 0.02, 0.20480129041026129, 12.226454707163354],
  ]
  for (let c = 0; c < 3; c++) {
    const coefficients = matrix[c],
      dst = out[c]
    if (!coefficients || !dst) throw new Error('Missing perceptual channel')
    for (let p = 0; p < dst.length; p++) {
      const bias = coefficients[3] ?? 0
      let average = bias,
        current = bias
      for (let color = 0; color < 3; color++) {
        const weight = 80 * (coefficients[color] ?? 0)
        average += weight * (smooth[color]?.[p] ?? 0)
        current += weight * (rgb[color]?.[p] ?? 0)
      }
      average = Math.max(bias, average, 1e-4)
      const sensitivity = Math.max(
        1e-4,
        (19.245013259874995 * Math.log(average + 9.9710635769299145) - 23.16046239805755) / average,
      )
      dst[p] = Math.max(bias, current * sensitivity)
    }
  }
  for (let p = 0; p < out[0].length; p++) {
    const l = out[0][p] ?? 0,
      m = out[1][p] ?? 0
    out[0][p] = l - m
    out[1][p] = l + m
  }
  return out
}

export interface PerceptualImage {
  readonly width: number
  readonly height: number
  readonly lf: PerceptualPlanes
  readonly mf: PerceptualPlanes
  readonly hf: readonly [Float64Array, Float64Array]
  readonly uhf: readonly [Float64Array, Float64Array]
  readonly blurredActivity: Float64Array
  readonly mask: Float64Array
}

export function preparePerceptualImage(
  rgba: Uint8Array,
  width: number,
  height: number,
): PerceptualImage {
  return preparePerceptualLinear(displayLinearPlanes(rgba, width, height), width, height)
}

export function preparePerceptualLinear(
  rgb: DisplayPlanes,
  width: number,
  height: number,
): PerceptualImage {
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width < 1 ||
    height < 1 ||
    rgb.some((p) => p.length !== width * height)
  )
    throw new Error('Invalid perceptual RGB extent')
  const xyb = opsin(rgb, width, height),
    lf = planes(width * height),
    mf = planes(width * height),
    hf: [Float64Array, Float64Array] = [
      new Float64Array(width * height),
      new Float64Array(width * height),
    ],
    uhf: [Float64Array, Float64Array] = [
      new Float64Array(width * height),
      new Float64Array(width * height),
    ]
  for (let c = 0; c < 3; c++) {
    const src = xyb[c],
      low = lf[c],
      middle = mf[c]
    if (!src || !low || !middle) throw new Error('Missing perceptual band')
    low.set(perceptualBlur(src, width, height, 7.15593339443))
    for (let p = 0; p < src.length; p++) middle[p] = (src[p] ?? 0) - (low[p] ?? 0)
    const blurred = perceptualBlur(middle, width, height, 3.22489901262),
      high = hf[c]
    if (c === 2) {
      middle.set(blurred)
      continue
    }
    if (!high) throw new Error('Missing HF plane')
    for (let p = 0; p < src.length; p++) {
      high[p] = (middle[p] ?? 0) - (blurred[p] ?? 0)
      middle[p] = c === 0 ? remove(blurred[p] ?? 0, 0.29) : amplify(blurred[p] ?? 0, 0.1)
    }
  }
  for (let p = 0; p < width * height; p++) {
    const y = lf[1][p] ?? 0,
      hy = hf[1][p] ?? 0
    lf[2][p] = ((lf[2][p] ?? 0) - 0.362267051518 * y) * 49.8798465144
    lf[0][p] = (lf[0][p] ?? 0) * 33.83283718626
    lf[1][p] = y * 14.45826810057
    hf[0][p] = (hf[0][p] ?? 0) * (0.653020556257 + ((1 - 0.653020556257) * 46) / (hy * hy + 46))
  }
  for (let c = 0; c < 2; c++) {
    const high = hf[c],
      ultra = uhf[c]
    if (!high || !ultra) throw new Error('Missing high-frequency plane')
    const blurred = perceptualBlur(high, width, height, 1.56416327805)
    for (let p = 0; p < high.length; p++) {
      const value = blurred[p] ?? 0
      if (c === 0) {
        ultra[p] = remove((high[p] ?? 0) - value, 0.04)
        high[p] = remove(value, 1.5)
      } else {
        const limited = clamp(value, 28.4691806922)
        ultra[p] = clamp((high[p] ?? 0) - limited, 5.19175294647) * 2.69313763794
        high[p] = amplify(limited * 2.155, 0.132)
      }
    }
  }
  const activity = new Float64Array(width * height),
    mask = new Float64Array(activity.length)
  for (let p = 0; p < activity.length; p++) {
    const x = 2.5 * ((hf[0][p] ?? 0) + (uhf[0][p] ?? 0)),
      y = 0.4 * ((hf[1][p] ?? 0) + (uhf[1][p] ?? 0))
    activity[p] =
      Math.sqrt(6.19424080439 * (Math.hypot(x, y) + 12.61050594197)) -
      Math.sqrt(6.19424080439 * 12.61050594197)
  }
  const blurredActivity = perceptualBlur(activity, width, height, 2.7)
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      let a = blurredActivity[y * width + x] ?? 0,
        b = 2 * a,
        c = b
      for (let dy = -3; dy <= 3; dy += 3)
        for (let dx = -3; dx <= 3; dx += 3) {
          if (
            (dx === 0 && dy === 0) ||
            x + dx < 0 ||
            x + dx >= width ||
            y + dy < 0 ||
            y + dy >= height
          )
            continue
          const value = blurredActivity[(y + dy) * width + x + dx] ?? 0
          if (value < c) {
            if (value < a) {
              c = b
              b = a
              a = value
            } else if (value < b) {
              c = b
              b = value
            } else c = value
          }
        }
      mask[y * width + x] = 0.45 * a + 0.3 * b + 0.25 * c
    }
  return { width, height, lf, mf, hf, uhf, blurredActivity, mask }
}

export function perceptualQuadraticMaps(source: PerceptualImage, decoded: PerceptualImage) {
  if (source.width !== decoded.width || source.height !== decoded.height)
    throw new Error('Perceptual dimensions differ')
  const unmasked = new Float64Array(source.mask.length),
    masked = new Float64Array(unmasked.length),
    asymmetric = new Float64Array(unmasked.length),
    lowWeights = [29.2353797994, 0.844626970982, 0.703646627719],
    middleWeights = [2150, 10.6195433239, 16.2176043152],
    highWeights = [400, 1.50815703118],
    scale = 1 / (17.83 * 0.79079917404)
  for (let p = 0; p < unmasked.length; p++) {
    let dc = 0,
      ac = 0,
      extra = 0
    for (let c = 0; c < 3; c++) {
      dc += (lowWeights[c] ?? 0) * ((source.lf[c]?.[p] ?? 0) - (decoded.lf[c]?.[p] ?? 0)) ** 2
      ac += (middleWeights[c] ?? 0) * ((source.mf[c]?.[p] ?? 0) - (decoded.mf[c]?.[p] ?? 0)) ** 2
      if (c < 2) {
        const a = source.hf[c]?.[p] ?? 0,
          b = decoded.hf[c]?.[p] ?? 0,
          min = 0.4 * Math.abs(a),
          max = Math.abs(a),
          signed = a < 0 ? -b : b,
          penalty = signed < min ? min - signed : signed > max ? signed - max : 0,
          weight = 0.8 * (highWeights[c] ?? 0)
        ac += weight * (a - b) ** 2
        extra += weight * penalty ** 2
      }
    }
    ac += 10 * ((source.blurredActivity[p] ?? 0) - (decoded.blurredActivity[p] ?? 0)) ** 2
    const value = source.mask[p] ?? 0,
      acMask = (scale * (1 + 2.5485944793 / (0.451936922203 * value + 0.829591754942))) ** 2,
      dcMask = (scale * (1 + 0.505054525019 / (3.87449418804 * value + 0.20025578522))) ** 2
    unmasked[p] = Math.sqrt(dc + ac)
    masked[p] = Math.sqrt(dcMask * dc + acMask * ac)
    asymmetric[p] = Math.sqrt(dcMask * dc + acMask * (ac + extra))
  }
  return { unmasked, masked, asymmetric }
}

export function poolPerceptualMap(map: Float64Array) {
  let maximum = 0,
    cube = 0
  for (let p = 0; p < map.length; p++) {
    const value = map[p] ?? 0
    maximum = Math.max(maximum, value)
    cube += value ** 3
  }
  return { maximum, norm3: Math.cbrt(cube / map.length) }
}
