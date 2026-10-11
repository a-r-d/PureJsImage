import { describe, expect, it } from 'vitest'
import { JpegXlWeightedPredictor } from '../src/codecs/jpegxl-decode.ts'

describe('JPEG XL weighted predictor integer boundaries', () => {
  it.each([
    { errors: [0, 0, 0, 0], weights: [0, 0, 0, 0] as const, prediction: 57 },
    { errors: [0, 0, 0, 0], weights: [15, 15, 15, 15] as const, prediction: 57 },
    { errors: [31, 32, 63, 64], weights: [13, 12, 12, 12] as const, prediction: 27 },
    { errors: [127, 128, 255, 256], weights: [0, 15, 1, 8] as const, prediction: 109 },
    {
      errors: [0xffffffff, 0xfffffffe, 0x80000000, 0x7fffffff],
      weights: [15, 0, 8, 1] as const,
      prediction: 57,
    },
  ])('preserves prediction and signed error for $errors with $weights', (fixture) => {
    const predictionErrors = Array.from({ length: 4 }, () => new Uint32Array(10))
    for (let channel = 0; channel < 4; channel++) {
      const row = predictionErrors[channel]
      if (!row) throw new Error('Missing predictor error row')
      row[6] = fixture.errors[channel] ?? 0
    }
    const errors = new Int32Array(10)
    errors[0] = 13
    errors[5] = -19
    errors[6] = 9
    errors[7] = -2
    const predictor = new JpegXlWeightedPredictor(
      3,
      {
        p1: 31,
        p2: 0,
        p3a: 31,
        p3b: 15,
        p3c: 7,
        p3d: 31,
        p3e: 1,
        weights: fixture.weights,
      },
      { predictions: new Float64Array(4), predictionErrors, errors },
    )
    const properties = new Int32Array(16)
    expect(predictor.predict(1, 1, 3, 109, -23, 51, 83, -14, properties)).toBe(fixture.prediction)
    expect(properties[15]).toBe(-19)
  })
})
