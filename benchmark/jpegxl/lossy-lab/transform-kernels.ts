import { inverseJpegXlDevelopmentTransform } from '../../../src/codecs/jpegxl-vardct-render.ts'
import {
  jpegXlVarDctStrategyBlockWidths,
  jpegXlVarDctStrategyBlockHeights,
} from '../../../src/codecs/jpegxl-vardct-jpeg.ts'

const bases = new Map<number, Float64Array>()
export function dctBasis(size: number): Float64Array {
  const cached = bases.get(size)
  if (cached) return cached
  const basis = new Float64Array(size * size)
  for (let k = 0; k < size; k++)
    for (let x = 0; x < size; x++)
      basis[k * size + x] =
        Math.sqrt(2 / size) *
        (k === 0 ? Math.SQRT1_2 : 1) *
        Math.cos(((2 * x + 1) * k * Math.PI) / (2 * size))
  bases.set(size, basis)
  return basis
}

const smallMatrices = new Map<number, Float64Array>()
/** Invert our decoder's linear transform, rather than borrowing an encoder implementation. */
function smallForwardMatrix(strategy: number): Float64Array {
  const cached = smallMatrices.get(strategy)
  if (cached) return cached
  const stride = 128,
    augmented = new Float64Array(64 * stride)
  const coefficients = new Float64Array(64),
    intermediate = new Float64Array(128)
  const pixels = new Float32Array(64),
    active = new Uint16Array(8)
  for (let column = 0; column < 64; column++) {
    coefficients.fill(0)
    coefficients[column] = 1
    inverseJpegXlDevelopmentTransform(strategy, coefficients, intermediate, pixels, active)
    for (let row = 0; row < 64; row++) augmented[row * stride + column] = pixels[row] ?? 0
    augmented[column * stride + 64 + column] = 1
  }
  for (let column = 0; column < 64; column++) {
    let pivot = column
    for (let row = column + 1; row < 64; row++)
      if (
        Math.abs(augmented[row * stride + column] ?? 0) >
        Math.abs(augmented[pivot * stride + column] ?? 0)
      )
        pivot = row
    if (Math.abs(augmented[pivot * stride + column] ?? 0) < 1e-12)
      throw new Error('Singular reference transform')
    if (pivot !== column)
      for (let k = 0; k < stride; k++) {
        const value = augmented[column * stride + k] ?? 0
        augmented[column * stride + k] = augmented[pivot * stride + k] ?? 0
        augmented[pivot * stride + k] = value
      }
    const divisor = augmented[column * stride + column] ?? 0
    for (let k = 0; k < stride; k++)
      augmented[column * stride + k] = (augmented[column * stride + k] ?? 0) / divisor
    for (let row = 0; row < 64; row++)
      if (row !== column) {
        const factor = augmented[row * stride + column] ?? 0
        for (let k = 0; k < stride; k++)
          augmented[row * stride + k] =
            (augmented[row * stride + k] ?? 0) - factor * (augmented[column * stride + k] ?? 0)
      }
  }
  const forward = new Float64Array(4096)
  for (let row = 0; row < 64; row++)
    for (let column = 0; column < 64; column++)
      forward[row * 64 + column] = augmented[row * stride + 64 + column] ?? 0
  smallMatrices.set(strategy, forward)
  return forward
}

export function forwardDevelopmentTransform(
  strategy: number,
  pixels: Float32Array,
  intermediate: Float64Array,
  coefficients: Float64Array,
): void {
  const width = (jpegXlVarDctStrategyBlockWidths[strategy] ?? 0) * 8
  const height = (jpegXlVarDctStrategyBlockHeights[strategy] ?? 0) * 8
  if (width < 8 || height < 8 || width > 64 || height > 64)
    throw new Error('Development transform extent unsupported')
  if (width === 8 && height === 8) {
    const matrix = smallForwardMatrix(strategy)
    for (let coefficient = 0; coefficient < 64; coefficient++) {
      let sum = 0
      for (let pixel = 0; pixel < 64; pixel++)
        sum += (matrix[coefficient * 64 + pixel] ?? 0) * (pixels[pixel] ?? 0)
      coefficients[coefficient] = sum
    }
    return
  }
  const horizontal = dctBasis(width),
    vertical = dctBasis(height),
    scale = 1 / Math.sqrt(width * height)
  for (let y = 0; y < height; y++)
    for (let h = 0; h < width; h++) {
      let sum = 0
      for (let x = 0; x < width; x++)
        sum += (pixels[y * width + x] ?? 0) * (horizontal[h * width + x] ?? 0)
      intermediate[y * width + h] = sum
    }
  for (let h = 0; h < width; h++)
    for (let v = 0; v < height; v++) {
      let sum = 0
      for (let y = 0; y < height; y++)
        sum += (intermediate[y * width + h] ?? 0) * (vertical[v * height + y] ?? 0)
      coefficients[height >= width ? h * height + v : v * width + h] = sum * scale
    }
}

/** Recover the compact DC grid whose normative upsampling produces these low frequencies. */
const lfScales = new Map<number, Float64Array>()
function inverseLfScales(size: number): Float64Array {
  const cached = lfScales.get(size)
  if (cached) return cached
  const values = new Float64Array(size)
  for (let k = 0; k < size; k++)
    values[k] =
      Math.cos((k * Math.PI) / (size * 16)) *
      Math.cos((k * Math.PI) / (size * 8)) *
      Math.cos((k * Math.PI) / (size * 4))
  lfScales.set(size, values)
  return values
}
export function developmentDcGrid(
  coefficients: Float64Array,
  bw: number,
  bh: number,
  output: Float64Array,
): void {
  const hx = dctBasis(bw),
    vy = dctBasis(bh),
    scale = Math.sqrt(bw * bh)
  const horizontalScales = inverseLfScales(bw),
    verticalScales = inverseLfScales(bh)
  for (let y = 0; y < bh; y++)
    for (let x = 0; x < bw; x++) {
      let sum = 0
      for (let v = 0; v < bh; v++)
        for (let h = 0; h < bw; h++) {
          const index = bh >= bw ? h * bh * 8 + v : v * bw * 8 + h
          sum +=
            (coefficients[index] ?? 0) *
            (horizontalScales[h] ?? 0) *
            (verticalScales[v] ?? 0) *
            (hx[h * bw + x] ?? 0) *
            (vy[v * bh + y] ?? 0)
        }
      output[y * bw + x] = sum * scale
    }
}
