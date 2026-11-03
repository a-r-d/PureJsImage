import { inverseSelectorTransform } from '../benchmark/jpegxl/lossy-lab/selector-inverse.ts'
import { inverseWeightedSelectorTransform } from '../benchmark/jpegxl/lossy-lab/selector-inverse-weights.ts'
import { describe, expect, it } from 'vitest'
import {
  forwardSelectorTransform,
  forwardSymmetricSelectorTransform,
  forwardPairedSelectorTransform,
} from '../benchmark/jpegxl/lossy-lab/selector-transforms.ts'
import {
  forwardDevelopmentTransform,
  developmentDcGrid,
} from '../benchmark/jpegxl/lossy-lab/transform-kernels.ts'
import {
  inverseJpegXlDevelopmentTransform,
  populateJpegXlDevelopmentLowestFrequencies,
} from '../src/codecs/jpegxl-vardct-render.ts'
import {
  jpegXlVarDctStrategyBlockWidths,
  jpegXlVarDctStrategyBlockHeights,
} from '../src/codecs/jpegxl-vardct-jpeg.ts'

describe('development normative transform kernels', () => {
  it('preserves paired forward sums across large square and rectangular kernels', () => {
    for (const strategy of [4, 5, 6, 7, 10, 11, 18, 19, 20]) {
      const size =
        (jpegXlVarDctStrategyBlockWidths[strategy] ?? 0) *
        (jpegXlVarDctStrategyBlockHeights[strategy] ?? 0) *
        64
      for (const amplitude of [0, 0.0001, 1, 1000]) {
        for (const pattern of [0, 1, 2]) {
          const input = Float32Array.from({ length: size }, (_, i) =>
            pattern === 0
              ? Math.sin(i * 7.13) * amplitude
              : pattern === 1
                ? i === size - 1
                  ? amplitude
                  : 0
                : i % 2
                  ? -amplitude
                  : amplitude,
          )
          const expected = new Float64Array(size),
            actual = new Float64Array(size)
          const scratch = new Float64Array(size)
          forwardSymmetricSelectorTransform(strategy, input, scratch, expected)
          forwardPairedSelectorTransform(strategy, input, scratch, actual, new Float64Array(64))
          expect(actual).toEqual(expected)
        }
      }
    }
  })
  for (const strategy of [
    0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20,
  ]) {
    it(`reconstructs spatial samples and compact DC for strategy ${strategy}`, () => {
      const bw = jpegXlVarDctStrategyBlockWidths[strategy] ?? 0,
        bh = jpegXlVarDctStrategyBlockHeights[strategy] ?? 0
      const width = bw * 8,
        height = bh * 8,
        size = width * height
      const input = Float32Array.from(
        { length: size },
        (_, i) =>
          0.4 +
          0.1 * Math.sin((i % width) / 7) +
          0.05 * Math.cos(Math.floor(i / width) / 5) +
          (i % 17) / 1024,
      )
      const coefficients = new Float64Array(size),
        scratch = new Float64Array(Math.max(128, size)),
        pixels = new Float32Array(size)
      forwardDevelopmentTransform(strategy, input, scratch, coefficients)
      const fast = new Float64Array(size)
      forwardSelectorTransform(strategy, input, scratch, fast)
      for (let i = 0; i < size; i++) expect(fast[i]).toBeCloseTo(coefficients[i] ?? 0, 6)
      forwardSymmetricSelectorTransform(strategy, input, scratch, fast)
      for (let i = 0; i < size; i++) expect(fast[i]).toBeCloseTo(coefficients[i] ?? 0, 6)
      const paired = new Float64Array(size)
      forwardPairedSelectorTransform(strategy, input, scratch, paired, new Float64Array(64))
      expect(paired).toEqual(fast)
      coefficients.set(fast)
      const dc = new Float64Array(bw * bh),
        frequencies = new Float64Array(bw * bh)
      developmentDcGrid(coefficients, bw, bh, dc)
      populateJpegXlDevelopmentLowestFrequencies(coefficients, dc, bw, bh, frequencies)
      inverseJpegXlDevelopmentTransform(
        strategy,
        coefficients,
        scratch,
        pixels,
        new Uint16Array(height),
      )
      const reference = pixels.slice()
      inverseSelectorTransform(strategy, coefficients, scratch, pixels, new Uint16Array(height))
      for (let i = 0; i < size; i++) expect(pixels[i]).toBeCloseTo(reference[i] ?? 0, 6)
      const exact = pixels.slice()
      inverseWeightedSelectorTransform(
        strategy,
        coefficients,
        scratch,
        pixels,
        new Uint16Array(height),
      )
      expect(pixels).toEqual(exact)
      let maximum = 0
      for (let i = 0; i < size; i++)
        maximum = Math.max(maximum, Math.abs((pixels[i] ?? 0) - (input[i] ?? 0)))
      expect(maximum).toBeLessThan(1e-5)
    })
  }
})
