import { expect, it } from 'vitest'
import {
  libjxlRoundtripLuma,
  libjxlChromaResidual,
} from '../benchmark/jpegxl/lossy-lab/libjxl-chroma-roundtrip-port.ts'
import { defaultJpegXlQuantizationBiases } from '../src/codecs/jpegxl-vardct-quantization.ts'

it('uses reconstructed luma without leaking luma error into the B-minus-Y plane', () => {
  const originalY = 0.2,
    reconstructedY = 0.125,
    originalBlue = 0.3,
    ratio = 0.1
  const residual = libjxlChromaResidual(
    originalBlue - originalY,
    originalY,
    reconstructedY,
    ratio,
    true,
  )
  expect(residual + (1 + ratio) * reconstructedY).toBeCloseTo(originalBlue, 12)
  const x = libjxlChromaResidual(0.04, originalY, reconstructedY, ratio, false)
  expect(x + ratio * reconstructedY).toBeCloseTo(0.04, 12)
})
it('reconstructs normative biased luma and writes the existing small-transform layout', () => {
  const source = new Float64Array(64),
    output = new Float64Array(64),
    target = new Int16Array(64)
  source[0] = 0.2
  source[1] = 1.3
  source[2] = -2.1
  libjxlRoundtripLuma(source, output, target, 0, 64, 1, 1, 1, new Float64Array(64).fill(1), {
    quantize: Math.round,
    readBlock: () => [],
  })
  expect(output[0]).toBe(0.2)
  expect(target[8]).toBe(1)
  expect(target[16]).toBe(-2)
  expect(output[1]).toBe(defaultJpegXlQuantizationBiases[1])
  expect(output[2]).toBeCloseTo(-2 + 0.145 / 2, 12)
})
