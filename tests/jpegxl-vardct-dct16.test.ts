import { describe, expect, it } from 'vitest'
import {
  forwardJpegXlDct16,
  forwardJpegXlDct16Lf,
} from '../src/codecs/jpegxl-vardct-forward-transforms.ts'

const basis = (frequency: number, position: number): number =>
  Math.sqrt(2 / 16) *
  (frequency === 0 ? Math.SQRT1_2 : 1) *
  Math.cos(((2 * position + 1) * frequency * Math.PI) / 32)

/** Direct separable basis with the encoder's Float32 row boundary. */
const reference = (samples: Float32Array): Float32Array => {
  const intermediate = new Float32Array(256),
    output = new Float32Array(256)
  for (let y = 0; y < 16; y++)
    for (let h = 0; h < 16; h++) {
      let sum = 0
      for (let x = 0; x < 16; x++) sum += (samples[y * 16 + x] ?? 0) * basis(h, x)
      intermediate[y * 16 + h] = sum
    }
  for (let h = 0; h < 16; h++)
    for (let v = 0; v < 16; v++) {
      let sum = 0
      for (let y = 0; y < 16; y++) sum += (intermediate[y * 16 + h] ?? 0) * basis(v, y)
      output[h * 16 + v] = sum / 16
    }
  return output
}

describe('JPEG XL DCT16 forward transform', () => {
  it('preserves mean, orientation, energy and the direct cosine transform', () => {
    let seed = 0x31415926
    const noise = Float32Array.from({ length: 256 }, () => {
      seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0
      return seed / 2 ** 32 - 0.5
    })
    const impulse = new Float32Array(256)
    impulse[5 * 16 + 9] = 1
    const mode = Float32Array.from({ length: 256 }, (_, i) => basis(13, i & 15) * basis(7, i >>> 4))
    const ramp = Float32Array.from({ length: 256 }, (_, i) => ((i & 15) * 3 - (i >>> 4) * 5) / 128)
    for (const samples of [
      new Float32Array(256),
      new Float32Array(256).fill(0.25),
      impulse,
      mode,
      ramp,
      noise,
    ]) {
      const before = samples.slice(),
        intermediate = new Float32Array(256),
        coefficients = new Float32Array(256),
        expected = reference(samples)
      forwardJpegXlDct16(samples, intermediate, coefficients)
      let error = 0,
        sourceEnergy = 0,
        coefficientEnergy = 0
      for (let i = 0; i < 256; i++) {
        error = Math.max(error, Math.abs((coefficients[i] ?? 0) - (expected[i] ?? 0)))
        sourceEnergy += (samples[i] ?? 0) ** 2 / 256
        coefficientEnergy += (coefficients[i] ?? 0) ** 2
      }
      expect(error).toBeLessThan(8e-8)
      expect(Math.abs(sourceEnergy - coefficientEnergy)).toBeLessThan(1e-7)
      expect(samples).toEqual(before)
      for (let h = 0; h < 2; h++)
        for (let v = 0; v < 2; v++) expect(coefficients[h * 16 + v]).toBe(expected[h * 16 + v])
    }
    const output = new Float32Array(256)
    forwardJpegXlDct16(mode, new Float32Array(256), output)
    expect(output[13 * 16 + 7]).toBeCloseTo(1 / 16, 8)
    forwardJpegXlDct16(new Float32Array(256).fill(0.25), new Float32Array(256), output)
    expect(output[0]).toBeCloseTo(0.25, 7)
  })

  it('computes exact compact DC while preserving samples and the unused footprint', () => {
    let seed = 0x27182818
    const footprint = new Set([0, 1, 16, 17])
    for (let trial = 0; trial < 32; trial++) {
      const samples = new Float32Array(256)
      for (let p = 0; p < samples.length; p++) {
        seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0
        samples[p] = trial === 0 ? 0 : trial === 1 ? 0.25 : seed / 2 ** 31 - 1
      }
      const before = samples.slice(),
        expected = reference(samples),
        intermediate = new Float32Array(256).fill(456),
        output = new Float32Array(256).fill(789)
      forwardJpegXlDct16Lf(samples, intermediate, output)
      expect(samples).toEqual(before)
      for (let p = 0; p < output.length; p++) {
        expect(output[p]).toBe(footprint.has(p) ? expected[p] : 789)
        if ((p & 15) >= 2) expect(intermediate[p]).toBe(456)
      }
    }
  })

  it.each(['full', 'lf'] as const)('rejects incorrect %s extents before writing', (kind) => {
    const transform = kind === 'full' ? forwardJpegXlDct16 : forwardJpegXlDct16Lf
    for (const missing of [0, 1, 2]) {
      const samples = new Float32Array(missing === 0 ? 255 : 256).fill(123),
        intermediate = new Float32Array(missing === 1 ? 255 : 256).fill(456),
        output = new Float32Array(missing === 2 ? 255 : 256).fill(789)
      expect(() => transform(samples, intermediate, output)).toThrow()
      expect(intermediate).toEqual(new Float32Array(intermediate.length).fill(456))
      expect(output).toEqual(new Float32Array(output.length).fill(789))
    }
  })
})
