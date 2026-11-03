import {
  jpegXlVarDctStrategyBlockWidths,
  jpegXlVarDctStrategyBlockHeights,
} from '../../../src/codecs/jpegxl-vardct-jpeg.ts'
import { dctBasis, forwardDevelopmentTransform } from './transform-kernels.ts'

// First-party forward formulas derived from our normative inverse transforms.
// Float64 arithmetic avoids per-candidate allocations and dense 64x64 products.
function mixDc(coefficients: Float64Array): void {
  const a = coefficients[0] ?? 0,
    b = coefficients[1] ?? 0,
    c = coefficients[8] ?? 0,
    d = coefficients[9] ?? 0
  coefficients[0] = (a + b + c + d) / 4
  coefficients[1] = (a + b - c - d) / 4
  coefficients[8] = (a - b + c - d) / 4
  coefficients[9] = (a - b - c + d) / 4
}

export function forwardSelectorTransform(
  strategy: number,
  pixels: Float32Array,
  scratch: Float64Array,
  coefficients: Float64Array,
): void {
  if (strategy === 1) {
    for (let cy = 0; cy < 2; cy++)
      for (let cx = 0; cx < 2; cx++) {
        const origin = cy * 32 + cx * 4
        const center = pixels[origin + 9] ?? 0
        let sum = 0
        for (let y = 0; y < 4; y++)
          for (let x = 0; x < 4; x++) {
            const sample = pixels[origin + y * 8 + x] ?? 0
            sum += sample
            coefficients[(cy + y * 2) * 8 + cx + x * 2] =
              y === 1 && x === 1 ? (pixels[origin] ?? 0) - center : sample - center
          }
        coefficients[cy * 8 + cx] = sum / 16
      }
    mixDc(coefficients)
    return
  }
  if (strategy === 2) {
    for (let i = 0; i < 64; i++) coefficients[i] = pixels[i] ?? 0
    for (let size = 8; size >= 2; size /= 2) {
      const half = size / 2
      for (let y = 0; y < half; y++)
        for (let x = 0; x < half; x++) {
          const at = y * 16 + x * 2
          const a = coefficients[at] ?? 0,
            b = coefficients[at + 1] ?? 0,
            c = coefficients[at + 8] ?? 0,
            d = coefficients[at + 9] ?? 0
          scratch[y * 8 + x] = (a + b + c + d) / 4
          scratch[y * 8 + half + x] = (a + b - c - d) / 4
          scratch[(y + half) * 8 + x] = (a - b + c - d) / 4
          scratch[(y + half) * 8 + half + x] = (a - b - c + d) / 4
        }
      for (let y = 0; y < size; y++)
        for (let x = 0; x < size; x++) coefficients[y * 8 + x] = scratch[y * 8 + x] ?? 0
    }
    return
  }
  if (strategy !== 0 && strategy !== 3 && strategy !== 12 && strategy !== 13) {
    forwardDevelopmentTransform(strategy, pixels, scratch, coefficients)
    return
  }
  const width = strategy === 3 || strategy === 13 ? 4 : 8
  const height = strategy === 3 || strategy === 12 ? 4 : 8
  const horizontal = dctBasis(width),
    vertical = dctBasis(height)
  const scale = 1 / Math.sqrt(width * height)
  for (let oy = 0; oy < 8; oy += height)
    for (let ox = 0; ox < 8; ox += width) {
      for (let y = 0; y < height; y++)
        for (let h = 0; h < width; h++) {
          let sum = 0
          for (let x = 0; x < width; x++)
            sum += (pixels[(oy + y) * 8 + ox + x] ?? 0) * (horizontal[h * width + x] ?? 0)
          scratch[y * width + h] = sum
        }
      for (let h = 0; h < width; h++)
        for (let v = 0; v < height; v++) {
          let sum = 0
          for (let y = 0; y < height; y++)
            sum += (scratch[y * width + h] ?? 0) * (vertical[v * height + y] ?? 0)
          const native = height >= width ? h * height + v : v * width + h
          const at =
            strategy === 0
              ? native
              : strategy === 3
                ? (oy / 4 + h * 2) * 8 + ox / 4 + v * 2
                : (Math.floor(native / 8) * 2 + (strategy === 12 ? oy : ox) / 4) * 8 + (native % 8)
          coefficients[at] = sum * scale
        }
    }
  if (strategy === 3) mixDc(coefficients)
  else if (strategy === 12 || strategy === 13) {
    const a = coefficients[0] ?? 0,
      b = coefficients[8] ?? 0
    coefficients[0] = (a + b) / 2
    coefficients[8] = (a - b) / 2
  }
}

/** Even/odd DCT symmetry halves the dot products for the large selector candidates. */
export function forwardSymmetricSelectorTransform(
  strategy: number,
  pixels: Float32Array,
  scratch: Float64Array,
  coefficients: Float64Array,
): void {
  const width = (jpegXlVarDctStrategyBlockWidths[strategy] ?? 0) * 8
  const height = (jpegXlVarDctStrategyBlockHeights[strategy] ?? 0) * 8
  if (width === 8 && height === 8) {
    forwardSelectorTransform(strategy, pixels, scratch, coefficients)
    return
  }
  if (width < 8 || height < 8 || width > 64 || height > 64)
    throw new Error('Invalid symmetric transform extent')
  const horizontal = dctBasis(width),
    vertical = dctBasis(height)
  const scale = 1 / Math.sqrt(width * height)
  for (let y = 0; y < height; y++)
    for (let h = 0; h < width; h++) {
      let sum = 0
      const sign = h % 2 === 0 ? 1 : -1
      for (let x = 0; x < width / 2; x++)
        sum +=
          ((pixels[y * width + x] ?? 0) + sign * (pixels[y * width + width - 1 - x] ?? 0)) *
          (horizontal[h * width + x] ?? 0)
      scratch[y * width + h] = sum
    }
  for (let h = 0; h < width; h++)
    for (let v = 0; v < height; v++) {
      let sum = 0
      const sign = v % 2 === 0 ? 1 : -1
      for (let y = 0; y < height / 2; y++)
        sum +=
          ((scratch[y * width + h] ?? 0) + sign * (scratch[(height - 1 - y) * width + h] ?? 0)) *
          (vertical[v * height + y] ?? 0)
      coefficients[height >= width ? h * height + v : v * width + h] = sum * scale
    }
}

/** Reuse mirrored input sums for every frequency, preserving dot-product order. */
export function forwardPairedSelectorTransform(
  strategy: number,
  pixels: Float32Array,
  scratch: Float64Array,
  coefficients: Float64Array,
  pairs: Float64Array,
): void {
  const width = (jpegXlVarDctStrategyBlockWidths[strategy] ?? 0) * 8
  const height = (jpegXlVarDctStrategyBlockHeights[strategy] ?? 0) * 8
  if (width === 8 && height === 8) {
    forwardSelectorTransform(strategy, pixels, scratch, coefficients)
    return
  }
  if (width < 8 || height < 8 || width > 64 || height > 64 || pairs.length < 64)
    throw new Error('Invalid paired transform extent')
  const horizontal = dctBasis(width),
    vertical = dctBasis(height)
  const scale = 1 / Math.sqrt(width * height)
  const halfWidth = width / 2,
    halfHeight = height / 2
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < halfWidth; x++) {
      const a = pixels[y * width + x] ?? 0,
        b = pixels[y * width + width - 1 - x] ?? 0
      pairs[x] = a + b
      pairs[halfWidth + x] = a - b
    }
    for (let h = 0; h < width; h += 4) {
      let s0 = 0,
        s1 = 0,
        s2 = 0,
        s3 = 0
      const at = h * width
      for (let x = 0; x < halfWidth; x++) {
        const even = pairs[x] ?? 0,
          odd = pairs[halfWidth + x] ?? 0
        s0 += even * (horizontal[at + x] ?? 0)
        s1 += odd * (horizontal[at + width + x] ?? 0)
        s2 += even * (horizontal[at + 2 * width + x] ?? 0)
        s3 += odd * (horizontal[at + 3 * width + x] ?? 0)
      }
      scratch[y * width + h] = s0
      scratch[y * width + h + 1] = s1
      scratch[y * width + h + 2] = s2
      scratch[y * width + h + 3] = s3
    }
  }
  for (let h = 0; h < width; h++) {
    for (let y = 0; y < halfHeight; y++) {
      const a = scratch[y * width + h] ?? 0,
        b = scratch[(height - 1 - y) * width + h] ?? 0
      pairs[y] = a + b
      pairs[halfHeight + y] = a - b
    }
    for (let v = 0; v < height; v += 4) {
      let s0 = 0,
        s1 = 0,
        s2 = 0,
        s3 = 0
      const at = v * height
      for (let y = 0; y < halfHeight; y++) {
        const even = pairs[y] ?? 0,
          odd = pairs[halfHeight + y] ?? 0
        s0 += even * (vertical[at + y] ?? 0)
        s1 += odd * (vertical[at + height + y] ?? 0)
        s2 += even * (vertical[at + 2 * height + y] ?? 0)
        s3 += odd * (vertical[at + 3 * height + y] ?? 0)
      }
      const out = height >= width ? h * height + v : v * width + h
      const step = height >= width ? 1 : width
      coefficients[out] = s0 * scale
      coefficients[out + step] = s1 * scale
      coefficients[out + 2 * step] = s2 * scale
      coefficients[out + 3 * step] = s3 * scale
    }
  }
}
