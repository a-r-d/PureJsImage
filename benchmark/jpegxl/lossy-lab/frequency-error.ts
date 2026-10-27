/** First-party orthonormal 8x8 DCT diagnostic on displayed XYB planes. */

import type { DisplayPlanes } from './libjxl-display-loss.ts'
import { dctBasis } from './transform-kernels.ts'
export const frequencyBands = ['dc', 'low', 'middle', 'high'] as const
export function frequencyBand(x: number, y: number): number {
  const sum = x + y
  return sum === 0 ? 0 : sum <= 2 ? 1 : sum <= 6 ? 2 : 3
}
function transform(
  source: Float32Array,
  width: number,
  x: number,
  y: number,
  scratch: Float64Array,
  out: Float64Array,
): void {
  const basis = dctBasis(8)
  for (let row = 0; row < 8; row++)
    for (let u = 0; u < 8; u++) {
      let value = 0
      for (let col = 0; col < 8; col++)
        value += (source[(y + row) * width + x + col] ?? 0) * (basis[u * 8 + col] ?? 0)
      scratch[row * 8 + u] = value
    }
  for (let v = 0; v < 8; v++)
    for (let u = 0; u < 8; u++) {
      let value = 0
      for (let row = 0; row < 8; row++)
        value += (scratch[row * 8 + u] ?? 0) * (basis[v * 8 + row] ?? 0)
      out[v * 8 + u] = value
    }
}
export function frequencyError(
  source: DisplayPlanes,
  decoded: DisplayPlanes,
  width: number,
  height: number,
) {
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width < 8 ||
    height < 8 ||
    width % 8 ||
    height % 8 ||
    [...source, ...decoded].some((p) => p.length !== width * height)
  )
    throw new Error('Expected complete 8x8 diagnostic tiles')
  const error = new Float64Array(12),
    signal = new Float64Array(12),
    lost = new Float64Array(12),
    added = new Float64Array(12)
  const coefficientError = new Float64Array(192),
    coefficientSignal = new Float64Array(192)
  const a = new Float64Array(64),
    b = new Float64Array(64),
    scratch = new Float64Array(64)
  for (let c = 0; c < 3; c++) {
    const src = source[c],
      dst = decoded[c]
    if (!src || !dst) throw new Error('Missing plane')
    for (let y = 0; y < height; y += 8)
      for (let x = 0; x < width; x += 8) {
        transform(src, width, x, y, scratch, a)
        transform(dst, width, x, y, scratch, b)
        for (let p = 0; p < 64; p++) {
          const at = c * 4 + frequencyBand(p % 8, Math.floor(p / 8)),
            av = a[p] ?? 0,
            bv = b[p] ?? 0
          error[at] = (error[at] ?? 0) + (av - bv) ** 2
          const frequency = c * 64 + p
          coefficientError[frequency] = (coefficientError[frequency] ?? 0) + (av - bv) ** 2
          coefficientSignal[frequency] = (coefficientSignal[frequency] ?? 0) + av * av
          signal[at] = (signal[at] ?? 0) + av * av
          lost[at] = (lost[at] ?? 0) + Math.max(0, av * av - bv * bv)
          added[at] = (added[at] ?? 0) + Math.max(0, bv * bv - av * av)
        }
      }
  }
  return {
    error: Array.from(error, (v) => v / (width * height)),
    signal: Array.from(signal, (v) => v / (width * height)),
    lost: Array.from(lost, (v) => v / (width * height)),
    added: Array.from(added, (v) => v / (width * height)),
    coefficientError: Array.from(coefficientError, (v) => v / (width * height)),
    coefficientSignal: Array.from(coefficientSignal, (v) => v / (width * height)),
  }
}
