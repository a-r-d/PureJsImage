import { describe, expect, it } from 'vitest'
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
      let maximum = 0
      for (let i = 0; i < size; i++)
        maximum = Math.max(maximum, Math.abs((pixels[i] ?? 0) - (input[i] ?? 0)))
      expect(maximum).toBeLessThan(1e-5)
    })
  }
})
