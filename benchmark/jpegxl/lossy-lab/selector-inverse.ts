import { inverseJpegXlDevelopmentTransform } from '../../../src/codecs/jpegxl-vardct-render.ts'
import {
  jpegXlVarDctStrategyBlockWidths,
  jpegXlVarDctStrategyBlockHeights,
} from '../../../src/codecs/jpegxl-vardct-jpeg.ts'
import { dctBasis } from './transform-kernels.ts'

/** First-party separable inverse DCT, reusing even/odd sums at mirrored pixels. */
export function inverseSelectorTransform(
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
  const horizontal = dctBasis(width),
    vertical = dctBasis(height)
  const scale = Math.sqrt(width * height)
  for (let v = 0; v < height; v++)
    for (let x = 0; x < width / 2; x++) {
      let even = 0,
        odd = 0
      for (let h = 0; h < width; h += 2) {
        even +=
          (coefficients[height >= width ? h * height + v : v * width + h] ?? 0) *
          (horizontal[h * width + x] ?? 0)
        odd +=
          (coefficients[height >= width ? (h + 1) * height + v : v * width + h + 1] ?? 0) *
          (horizontal[(h + 1) * width + x] ?? 0)
      }
      scratch[v * width + x] = even + odd
      scratch[v * width + width - 1 - x] = even - odd
    }
  for (let y = 0; y < height / 2; y++)
    for (let x = 0; x < width; x++) {
      let even = 0,
        odd = 0
      for (let v = 0; v < height; v += 2) {
        even += (scratch[v * width + x] ?? 0) * (vertical[v * height + y] ?? 0)
        odd += (scratch[(v + 1) * width + x] ?? 0) * (vertical[(v + 1) * height + y] ?? 0)
      }
      destination[y * width + x] = (even + odd) * scale
      destination[(height - 1 - y) * width + x] = (even - odd) * scale
    }
}
