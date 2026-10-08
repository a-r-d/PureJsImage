import { describe, expect, it } from 'vitest'
import {
  forwardJpegXlDct32,
  forwardJpegXlRectangle32,
  quantizeJpegXlDct32Dc,
  quantizeJpegXlRectangle32Dc,
} from '../src/codecs/jpegxl-vardct-large-transforms.ts'

const basis = (size: number, frequency: number, position: number): number =>
  Math.sqrt(2 / size) *
  (frequency === 0 ? Math.SQRT1_2 : 1) *
  Math.cos(((2 * position + 1) * frequency * Math.PI) / (2 * size))
const scale = (size: number, frequency: number): number =>
  1 /
  (Math.cos((frequency * Math.PI) / (2 * size)) *
    Math.cos((frequency * Math.PI) / size) *
    Math.cos((frequency * Math.PI * 2) / size))
const shapes = [
  { name: '32x32', width: 32, height: 32, square: true, horizontal: false },
  { name: '16x32', width: 16, height: 32, square: false, horizontal: false },
  { name: '32x16', width: 32, height: 16, square: false, horizontal: true },
] as const

type Shape = (typeof shapes)[number]
const position = (shape: Shape, h: number, v: number): number =>
  shape.square ? h * 32 + v : shape.horizontal ? v * 32 + h : h * 32 + v
const forward = (shape: Shape, samples: Float32Array): Float32Array => {
  const intermediate = new Float32Array(samples.length)
  const output = new Float32Array(samples.length)
  if (shape.square) forwardJpegXlDct32(samples, intermediate, output)
  else forwardJpegXlRectangle32(samples, intermediate, output, shape.horizontal)
  return output
}
const compact = (
  shape: Shape,
  coefficients: Float32Array,
  step: number,
  destination: Int32Array,
  offset: number,
): number =>
  shape.square
    ? quantizeJpegXlDct32Dc(coefficients, step, destination, offset)
    : quantizeJpegXlRectangle32Dc(coefficients, step, destination, offset, shape.horizontal)

/** Direct double-precision basis, independent of the kernels' Float32 intermediate. */
const reference = (shape: Shape, input: Float32Array, inverse: boolean): Float64Array => {
  const { width, height } = shape
  const scratch = new Float64Array(input.length)
  const output = new Float64Array(input.length)
  const normalization = Math.sqrt(input.length)
  if (inverse) {
    for (let v = 0; v < height; v++)
      for (let x = 0; x < width; x++) {
        let sum = 0
        for (let h = 0; h < width; h++)
          sum += (input[position(shape, h, v)] ?? 0) * basis(width, h, x)
        scratch[v * width + x] = sum
      }
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        let sum = 0
        for (let v = 0; v < height; v++) sum += (scratch[v * width + x] ?? 0) * basis(height, v, y)
        output[y * width + x] = sum * normalization
      }
  } else {
    for (let y = 0; y < height; y++)
      for (let h = 0; h < width; h++) {
        let sum = 0
        for (let x = 0; x < width; x++) sum += (input[y * width + x] ?? 0) * basis(width, h, x)
        scratch[y * width + h] = sum
      }
    for (let h = 0; h < width; h++)
      for (let v = 0; v < height; v++) {
        let sum = 0
        for (let y = 0; y < height; y++) sum += (scratch[y * width + h] ?? 0) * basis(height, v, y)
        output[position(shape, h, v)] = sum / normalization
      }
  }
  return output
}

for (const shape of shapes) {
  describe(`JPEG XL ${shape.name} forward transform`, () => {
    it('preserves mean normalization, orientation and all samples on inversion', () => {
      const size = shape.width * shape.height
      let seed = 0x31415926
      const noise = Float32Array.from({ length: size }, () => {
        seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0
        return seed / 2 ** 32 - 0.5
      })
      const ramp = Float32Array.from(
        { length: size },
        (_, i) => ((i % shape.width) * 3 - Math.floor(i / shape.width) * 5) / 128,
      )
      const mode = Float32Array.from(
        { length: size },
        (_, i) =>
          basis(shape.width, 7, i % shape.width) *
          basis(shape.height, 3, Math.floor(i / shape.width)),
      )
      const impulse = new Float32Array(size)
      impulse[shape.width * 5 + 9] = 1
      for (const samples of [new Float32Array(size).fill(0.25), ramp, noise, mode, impulse]) {
        const before = samples.slice()
        const coefficients = forward(shape, samples)
        const expected = reference(shape, samples, false)
        const reconstructed = reference(shape, coefficients, true)
        let maximumCoefficientError = 0,
          maximumSampleError = 0,
          sourceEnergy = 0,
          coefficientEnergy = 0
        for (let i = 0; i < size; i++) {
          maximumCoefficientError = Math.max(
            maximumCoefficientError,
            Math.abs((coefficients[i] ?? 0) - (expected[i] ?? 0)),
          )
          maximumSampleError = Math.max(
            maximumSampleError,
            Math.abs((samples[i] ?? 0) - (reconstructed[i] ?? 0)),
          )
          sourceEnergy += (samples[i] ?? 0) ** 2 / size
          coefficientEnergy += (coefficients[i] ?? 0) ** 2
        }
        expect(maximumCoefficientError).toBeLessThan(8e-8)
        expect(maximumSampleError).toBeLessThan(2e-7)
        expect(Math.abs(sourceEnergy - coefficientEnergy)).toBeLessThan(1e-7)
        expect(samples).toEqual(before)
      }
      const coefficients = forward(shape, mode)
      expect(coefficients[position(shape, 7, 3)]).toBeCloseTo(1 / Math.sqrt(size), 8)
      expect(forward(shape, new Float32Array(size).fill(0.25))[0]).toBeCloseTo(0.25, 7)
    })

    it('roundtrips asymmetric compact DC words and leaves AC and destination margins unchanged', () => {
      const width = shape.width / 8,
        height = shape.height / 8,
        count = width * height,
        step = 1 / 1024,
        coefficients = new Float32Array(shape.width * shape.height),
        words = Int32Array.from({ length: count }, (_, i) => ((i * 7) % 23) - 11)
      for (let h = 0; h < width; h++)
        for (let v = 0; v < height; v++) {
          let sum = 0
          for (let y = 0; y < height; y++)
            for (let x = 0; x < width; x++)
              sum += (words[y * width + x] ?? 0) * step * basis(width, h, x) * basis(height, v, y)
          coefficients[position(shape, h, v)] =
            (sum / Math.sqrt(count)) * scale(shape.width, h) * scale(shape.height, v)
        }
      coefficients[position(shape, 7, 5)] = 17.25
      const before = coefficients.slice(),
        destination = new Int32Array(count + 6).fill(12345),
        error = compact(shape, coefficients, step, destination, 3)
      expect(destination.subarray(3, count + 3)).toEqual(words)
      expect(destination.subarray(0, 3)).toEqual(Int32Array.of(12345, 12345, 12345))
      expect(destination.subarray(count + 3)).toEqual(Int32Array.of(12345, 12345, 12345))
      expect(error).toBeLessThan(1e-15)
      expect(coefficients).toEqual(before)
      coefficients[position(shape, 7, 5)] = -99
      expect(compact(shape, coefficients, step, destination, 3)).toBe(error)
    })

    it('rejects invalid buffer extents and DC steps before writing', () => {
      const size = shape.width * shape.height,
        samples = new Float32Array(size),
        scratch = new Float32Array(size),
        output = new Float32Array(size),
        dc = new Int32Array(shape.square ? 16 : 8).fill(123)
      for (const missing of [0, 1, 2]) {
        const a = missing === 0 ? samples.subarray(1) : samples,
          b = missing === 1 ? scratch.subarray(1) : scratch,
          c = missing === 2 ? output.subarray(1) : output
        expect(() =>
          shape.square
            ? forwardJpegXlDct32(a, b, c)
            : forwardJpegXlRectangle32(a, b, c, shape.horizontal),
        ).toThrow()
      }
      for (const step of [0, -1, Number.NaN, Number.POSITIVE_INFINITY])
        expect(() => compact(shape, output, step, dc, 0)).toThrow()
      for (const offset of [-1, 0.5, 1, Number.MAX_SAFE_INTEGER])
        expect(() => compact(shape, output, 1, dc, offset)).toThrow()
      expect(() => compact(shape, output.subarray(1), 1, dc, 0)).toThrow()
      expect(dc).toEqual(new Int32Array(dc.length).fill(123))
    })
  })
}
