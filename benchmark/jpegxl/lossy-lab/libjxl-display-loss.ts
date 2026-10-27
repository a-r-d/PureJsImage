/**
 * Sources: libjxl tools/ssimulacra2.cc (Downsample, MakePositiveXYB, SSIMMap,
 * EdgeDiffMap, Msssim::Score) and lib/jxl/enc_xyb.cc, v0.12.0,
 * a7a9c787341cf703dede03c2009fa460cae5e5df. tools/gauss_blur.cc and .h
 * supply the sigma-1.5 radius (five) and zero-padding comparison.
 * Copyright (c) the JPEG XL Project Authors. BSD-3-Clause
 * Changes: offline scalar TypeScript diagnostic on displayed RGB. Compares RGB
 * and XYB scale construction with three or six scales. Reuses attributed weights;
 * compares seven/eleven-tap Gaussian and source-derived nine-tap cosine blur,
 * clamped/zero borders and float/double moments. Direct convolution and Math.cbrt
 * replace native recursive/SIMD math; numerical equivalence is not claimed.
 * This is not the native metric and is never imported by the public encoder.
 */
import { ssimCosineKernel } from './libjxl-ssim-blur.ts'
import { filterMetricWeights } from './libjxl-ssim-weights.ts'
const cosineKernel = ssimCosineKernel()
export type DisplayPlanes = readonly [Float32Array, Float32Array, Float32Array]
const bias = 0.0037930732552754493
const rootBias = Math.cbrt(bias)
const kernel = Float64Array.from({ length: 7 }, (_, i) => Math.exp(-((i - 3) ** 2) / 4.5))
const normalization = kernel.reduce((sum, value) => sum + value, 0)
for (let i = 0; i < 7; i++) kernel[i] = (kernel[i] ?? 0) / normalization

const wideKernel = Float64Array.from({ length: 11 }, (_, i) => Math.exp(-((i - 5) ** 2) / 4.5))
const wideNormalization = wideKernel.reduce((a, b) => a + b, 0)
for (let i = 0; i < 11; i++) wideKernel[i] = (wideKernel[i] ?? 0) / wideNormalization
export interface DisplayBlur {
  radius: 3 | 4 | 5
  border: 'clamp' | 'zero'
  float32?: boolean
  moment64?: boolean
}
const defaultBlur: DisplayBlur = { radius: 3, border: 'clamp' }

export function displayLinearPlanes(
  bytes: Uint8Array,
  width: number,
  height: number,
): DisplayPlanes {
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width < 1 ||
    height < 1 ||
    bytes.length !== width * height * 4
  )
    throw new Error('Invalid display image extent')
  const planes: DisplayPlanes = [
    new Float32Array(width * height),
    new Float32Array(width * height),
    new Float32Array(width * height),
  ]
  for (let p = 0; p < width * height; p++) {
    if (bytes[p * 4 + 3] !== 255) throw new Error('Display diagnostic requires opaque RGB')
    for (let c = 0; c < 3; c++) {
      const value = (bytes[p * 4 + c] ?? 0) / 255
      const plane = planes[c]
      if (plane) plane[p] = value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
    }
  }
  return planes
}
export function displayXyb(rgb: DisplayPlanes): DisplayPlanes {
  const n = rgb[0].length
  const result: DisplayPlanes = [new Float32Array(n), new Float32Array(n), new Float32Array(n)]
  for (let p = 0; p < n; p++) {
    const r = rgb[0][p] ?? 0,
      g = rgb[1][p] ?? 0,
      b = rgb[2][p] ?? 0
    const l = Math.cbrt(0.3 * r + 0.622 * g + 0.078 * b + bias) - rootBias
    const m = Math.cbrt(0.23 * r + 0.692 * g + 0.078 * b + bias) - rootBias
    const y = (l + m) / 2
    result[0][p] = (l - m) * 7 + 0.42
    result[1][p] = y + 0.01
    result[2][p] =
      Math.cbrt(0.2434226894556144 * r + 0.20476744435558894 * g + 0.5518098669709147 * b + bias) -
      rootBias -
      y +
      0.55
  }
  return result
}
export function downsampleDisplay(
  planes: DisplayPlanes,
  width: number,
  height: number,
): DisplayPlanes {
  const w = Math.ceil(width / 2),
    h = Math.ceil(height / 2)
  const result: DisplayPlanes = [
    new Float32Array(w * h),
    new Float32Array(w * h),
    new Float32Array(w * h),
  ]
  for (let c = 0; c < 3; c++) {
    const src = planes[c],
      dst = result[c]
    if (!src || !dst) throw new Error('Missing display plane')
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const top = 2 * y * width,
          bottom = Math.min(height - 1, 2 * y + 1) * width
        const left = x * 2,
          right = Math.min(width - 1, left + 1)
        dst[y * w + x] =
          ((src[top + left] ?? 0) +
            (src[top + right] ?? 0) +
            (src[bottom + left] ?? 0) +
            (src[bottom + right] ?? 0)) /
          4
      }
  }
  return result
}
function scaleLoss(
  a: DisplayPlanes,
  b: DisplayPlanes,
  w: number,
  h: number,
  scale: number,
  blurOptions: DisplayBlur,
): number {
  const n = w * h,
    radius = blurOptions.radius,
    weights = radius === 3 ? kernel : radius === 4 ? cosineKernel : wideKernel
  const means = Array.from({ length: 5 }, () =>
    blurOptions.moment64 ? new Float64Array(n) : new Float32Array(n),
  )
  let total = 0
  for (let c = 0; c < 3; c++) {
    const src = a[c],
      dst = b[c]
    if (!src || !dst) throw new Error('Missing color plane')
    const [ha, hb, haa, hbb, hab] = means
    if (!ha || !hb || !haa || !hbb || !hab) throw new Error('Missing moments')
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        let sa = 0,
          sb = 0,
          saa = 0,
          sbb = 0,
          sab = 0
        for (let k = -radius; k <= radius; k++) {
          if (blurOptions.border === 'zero' && (x + k < 0 || x + k >= w)) continue
          const p = y * w + Math.max(0, Math.min(w - 1, x + k)),
            weight = weights[k + radius] ?? 0,
            av = src[p] ?? 0,
            bv = dst[p] ?? 0
          sa += weight * av
          sb += weight * bv
          saa += weight * av * av
          sbb += weight * bv * bv
          sab += weight * av * bv
        }
        const p = y * w + x
        ha[p] = sa
        hb[p] = sb
        haa[p] = saa
        hbb[p] = sbb
        hab[p] = sab
      }
    let structure = 0,
      structure4 = 0,
      ring = 0,
      ring4 = 0,
      blur = 0,
      blur4 = 0
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        let ma = 0,
          mb = 0,
          qa = 0,
          qb = 0,
          qab = 0
        for (let k = -radius; k <= radius; k++) {
          if (blurOptions.border === 'zero' && (y + k < 0 || y + k >= h)) continue
          const p = Math.max(0, Math.min(h - 1, y + k)) * w + x,
            weight = weights[k + radius] ?? 0
          ma += weight * (ha[p] ?? 0)
          mb += weight * (hb[p] ?? 0)
          qa += weight * (haa[p] ?? 0)
          qb += weight * (hbb[p] ?? 0)
          qab += weight * (hab[p] ?? 0)
        }
        if (blurOptions.float32) {
          ma = Math.fround(ma)
          mb = Math.fround(mb)
          qa = Math.fround(qa)
          qb = Math.fround(qb)
          qab = Math.fround(qab)
        }
        let d = Math.max(
          0,
          1 -
            ((1 - (ma - mb) ** 2) * (2 * (qab - ma * mb) + 0.0009)) /
              (qa - ma * ma + qb - mb * mb + 0.0009),
        )
        if (blurOptions.float32) {
          const f = Math.fround,
            delta = f(ma - mb),
            mu11 = f(ma * ma),
            mu22 = f(mb * mb),
            mu12 = f(ma * mb)
          const numM = f(1 - f(delta * delta)),
            numS = f(f(2 * f(qab - mu12)) + f(0.0009)),
            denom = f(f(f(qa - mu11) + f(qb - mu22)) + f(0.0009))
          d = Math.max(0, 1 - f(f(numM * numS) / denom))
        }
        const p = y * w + x,
          edge = (1 + Math.abs((dst[p] ?? 0) - mb)) / (1 + Math.abs((src[p] ?? 0) - ma)) - 1
        const added = Math.max(0, edge),
          lost = Math.max(0, -edge)
        structure += d
        structure4 += d ** 4
        ring += added
        ring4 += added ** 4
        blur += lost
        blur4 += lost ** 4
      }
    const at = (c * 6 + scale) * 6
    total +=
      ((filterMetricWeights[at] ?? 0) * structure) / n +
      ((filterMetricWeights[at + 1] ?? 0) * ring) / n +
      ((filterMetricWeights[at + 2] ?? 0) * blur) / n +
      (filterMetricWeights[at + 3] ?? 0) * (structure4 / n) ** 0.25 +
      (filterMetricWeights[at + 4] ?? 0) * (ring4 / n) ** 0.25 +
      (filterMetricWeights[at + 5] ?? 0) * (blur4 / n) ** 0.25
  }
  return total
}
export function displayLossPyramid(
  source: DisplayPlanes,
  output: DisplayPlanes,
  width: number,
  height: number,
  pooling: 'rgb' | 'xyb',
  scales = 6,
  blurOptions: DisplayBlur = defaultBlur,
): number[] {
  if (
    source.some((p) => p.length !== width * height) ||
    output.some((p) => p.length !== width * height) ||
    !Number.isInteger(scales) ||
    scales < 1 ||
    scales > 6
  )
    throw new Error('Invalid pyramid extent')
  let a = pooling === 'xyb' ? displayXyb(source) : source,
    b = pooling === 'xyb' ? displayXyb(output) : output,
    w = width,
    h = height
  const losses = []
  for (let scale = 0; scale < scales && w >= 8 && h >= 8; scale++) {
    losses.push(
      scaleLoss(
        pooling === 'rgb' ? displayXyb(a) : a,
        pooling === 'rgb' ? displayXyb(b) : b,
        w,
        h,
        scale,
        blurOptions,
      ),
    )
    if (scale + 1 < scales) {
      a = downsampleDisplay(a, w, h)
      b = downsampleDisplay(b, w, h)
      w = Math.ceil(w / 2)
      h = Math.ceil(h / 2)
    }
  }
  return losses
}
