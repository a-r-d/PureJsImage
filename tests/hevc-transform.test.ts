import { describe, expect, it } from 'vitest'
import { inverseHevcTransform } from '../src/codecs/hevc-transform.ts'

describe('HEVC inverse transforms', () => {
  it('reconstructs constant residuals from DCT DC coefficients at every size', () => {
    const expectedBySize = new Map([
      [4, 10],
      [8, 5],
      [16, 3],
      [32, 1],
    ])
    for (const size of [4, 8, 16, 32] as const) {
      const coefficients = new Int32Array(size * size)
      coefficients[0] = 64
      const output = inverseHevcTransform(coefficients, size, {
        bitDepth: 8,
        component: 1,
        intra: true,
        qp: 0,
        transformSkipped: false,
        transquantBypass: false,
      })
      expect(new Set(output)).toEqual(new Set([expectedBySize.get(size)]))
    }
  })

  it('uses the specified 4x4 DST for intra luma', () => {
    const coefficients = new Int32Array(16)
    coefficients[0] = 32
    expect(
      Array.from(
        inverseHevcTransform(coefficients, 4, {
          bitDepth: 8,
          component: 0,
          intra: true,
          qp: 0,
          transformSkipped: false,
          transquantBypass: false,
        }),
      ),
    ).toEqual([1, 2, 3, 3, 2, 4, 5, 6, 3, 5, 7, 8, 3, 6, 8, 9])
  })

  it('handles transform skip, transquant bypass, and 10-bit QP ranges', () => {
    const coefficients = new Int32Array(16)
    coefficients[0] = -3
    expect(
      inverseHevcTransform(coefficients, 4, {
        bitDepth: 10,
        component: 0,
        intra: true,
        qp: 63,
        transformSkipped: true,
        transquantBypass: false,
      })[0],
    ).toBe(-2736)
    expect(
      inverseHevcTransform(coefficients, 4, {
        bitDepth: 8,
        component: 0,
        intra: true,
        qp: 0,
        transformSkipped: false,
        transquantBypass: true,
      }),
    ).toEqual(coefficients)
  })

  it('rejects malformed dimensions and scaling lists', () => {
    expect(() =>
      inverseHevcTransform(new Int32Array(15), 4, {
        bitDepth: 8,
        component: 0,
        intra: true,
        qp: 0,
        transformSkipped: false,
        transquantBypass: false,
      }),
    ).toThrow(/dimensions/)
    expect(() =>
      inverseHevcTransform(new Int32Array(16), 4, {
        bitDepth: 8,
        component: 0,
        intra: true,
        qp: 0,
        scalingFactors: new Int16Array(4),
        transformSkipped: false,
        transquantBypass: false,
      }),
    ).toThrow(/scaling-list dimensions/)
  })
})
