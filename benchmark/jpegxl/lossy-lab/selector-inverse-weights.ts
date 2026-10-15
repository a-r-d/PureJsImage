import { inverseJpegXlDevelopmentTransform } from '../../../src/codecs/jpegxl-vardct-render.ts'
import {
  jpegXlVarDctStrategyBlockWidths,
  jpegXlVarDctStrategyBlockHeights,
} from '../../../src/codecs/jpegxl-vardct-jpeg.ts'
import { dctBasis } from './transform-kernels.ts'

const inverseWeights = new Map<number, Float64Array>()
function weights(size: number): Float64Array {
  const previous = inverseWeights.get(size)
  if (previous) return previous
  const forward = dctBasis(size)
  const result = new Float64Array((size * size) / 2)
  for (let x = 0; x < size / 2; x++)
    for (let k = 0; k < size; k++) result[x * size + k] = forward[k * size + x] ?? 0
  inverseWeights.set(size, result)
  return result
}

/** First-party inverse DCT with cached weights contiguous in dot-product order. */
export function inverseWeightedSelectorTransform(
  strategy: number,
  coefficients: Float64Array,
  scratch: Float64Array,
  destination: Float32Array,
  active: Uint16Array,
): void {
  const width = (jpegXlVarDctStrategyBlockWidths[strategy] ?? 0) * 8
  const height = (jpegXlVarDctStrategyBlockHeights[strategy] ?? 0) * 8
  if (width === 8 && height === 8) {
    inverseJpegXlDevelopmentTransform(strategy, coefficients, scratch, destination, active)
    return
  }
  if (width < 8 || height < 8 || width > 64 || height > 64)
    throw new Error('Invalid selector inverse extent')
  const horizontal = weights(width),
    vertical = weights(height),
    stride = height >= width ? height : 1,
    pairStride = 2 * stride,
    scale = Math.sqrt(width * height)
  for (let v = 0; v < height; v++) {
    const row = height >= width ? v : v * width
    for (let x = 0; x < width / 2; x++) {
      let even = 0,
        odd = 0,
        at = row
      const offset = x * width
      for (let h = 0; h < width; h += 2) {
        even += (coefficients[at] ?? 0) * (horizontal[offset + h] ?? 0)
        odd += (coefficients[at + stride] ?? 0) * (horizontal[offset + h + 1] ?? 0)
        at += pairStride
      }
      scratch[v * width + x] = even + odd
      scratch[v * width + width - 1 - x] = even - odd
    }
  }
  for (let y = 0; y < height / 2; y++) {
    const offset = y * height
    for (let x = 0; x < width; x++) {
      let even = 0,
        odd = 0,
        at = x
      for (let v = 0; v < height; v += 2) {
        even += (scratch[at] ?? 0) * (vertical[offset + v] ?? 0)
        odd += (scratch[at + width] ?? 0) * (vertical[offset + v + 1] ?? 0)
        at += 2 * width
      }
      destination[y * width + x] = (even + odd) * scale
      destination[(height - 1 - y) * width + x] = (even - odd) * scale
    }
  }
}
