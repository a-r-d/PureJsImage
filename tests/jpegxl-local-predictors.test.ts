import { expect, it } from 'vitest'
import {
  localErrorPredictors,
  localWindowErrors,
  predictionAgreement,
  predictorLuma,
} from '../benchmark/jpegxl/lossy-lab/local-error-predictors.ts'

it('uses decoded display samples and the sRGB transfer curve for luma', () => {
  const rgba = Uint8Array.of(0, 0, 0, 255, 255, 255, 255, 0, 128, 128, 128, 255)
  const display = predictorLuma(rgba, 'display'),
    linear = predictorLuma(rgba, 'linear')
  expect(display[0]).toBe(0)
  expect(display[1]).toBe(1)
  expect(display[2]).toBeCloseTo(128 / 255, 14)
  expect(linear[2]).toBeCloseTo(((128 / 255 + 0.055) / 1.055) ** 2.4, 14)
  expect(() => predictorLuma(rgba.subarray(1), 'linear')).toThrow('extent')
})
it('distinguishes brightness bias from removal of local variation', () => {
  const source = Float64Array.of(0.2, 0.4, 0.2, 0.4),
    bias = Float64Array.of(0.3, 0.5, 0.3, 0.5),
    flat = Float64Array.of(0.3, 0.3, 0.3, 0.3),
    box = { x: 0, y: 0, width: 2, height: 2 }
  const shifted = localWindowErrors(source, bias, 2, 2, box),
    flattened = localWindowErrors(source, flat, 2, 2, box)
  expect(shifted[0]).toBeCloseTo(flattened[0] ?? 0, 14)
  expect(shifted[2]).toBeCloseTo(0, 14)
  expect(flattened[2]).toBeGreaterThan(0.9)
  expect(shifted[3]).toBeCloseTo(0, 14)
  expect(flattened[3]).toBeGreaterThan(0.9)
})
it('pools fixed windows without losing sparse errors or dividing by a flat source', () => {
  const source = new Float64Array(64),
    changed = source.slice()
  changed[0] = 1
  const identical = localErrorPredictors(source, source, 8, 8, 4),
    result = localErrorPredictors(source, changed, 8, 8, 4)
  for (const [name, score] of Object.entries(result)) {
    expect(identical[name]).toEqual({ maximum: 0, norm3: 0 })
    expect(Number.isFinite(score.maximum)).toBe(true)
    expect(score.maximum).toBeGreaterThan(score.norm3)
    expect(score.norm3).toBeGreaterThan(0)
  }
  expect(() => localErrorPredictors(source, changed, 8, 8, 3)).toThrow('window')
})
it('reports abstentions and the trivial always-worse baseline separately', () => {
  const score = predictionAgreement(
    [
      { predicted: 1, actual: 2 },
      { predicted: 0, actual: 2 },
      { predicted: 1, actual: -2 },
      { predicted: 1, actual: 0 },
    ],
    0.1,
  )
  expect(score).toMatchObject({
    material: 3,
    correct: 1,
    abstained: 1,
    missedHarm: 1,
    falseAlarm: 1,
    worsened: 2,
    improved: 1,
    accuracy: 1 / 3,
    alwaysWorseAccuracy: 2 / 3,
  })
  expect(() => predictionAgreement([{ predicted: NaN, actual: 1 }], 0.1)).toThrow('Nonfinite')
})
