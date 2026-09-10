import { describe, expect, it } from 'vitest'
import {
  m7CompositeSample,
  m7DisplaySample,
  m7PqFromRelativeLight,
  m7RelativeLightFromPq,
} from '../benchmark/jpegxl/m7-hdr-mapping.ts'

describe('frozen M7 HDR and alpha metric domains', () => {
  it('maps absolute PQ anchors and preserves finite native light', () => {
    expect(m7PqFromRelativeLight(100 / 203)).toBeCloseTo(0.5080784215, 9)
    expect(m7PqFromRelativeLight(1000 / 203)).toBeCloseTo(0.7518270962, 9)
    expect(m7PqFromRelativeLight(10000 / 203)).toBeCloseTo(1, 12)
    for (const light of [0, 0.0001, 0.1, 1, 2, 4, 20, 10000 / 203])
      expect(m7RelativeLightFromPq(m7PqFromRelativeLight(light))).toBeCloseTo(light, 8)
    expect(m7PqFromRelativeLight(100)).toBe(1)
  })
  it('uses fixed exposure and clipping at every declared headroom', () => {
    expect(
      [1, 2, 4].map((headroom) => {
        if (headroom !== 1 && headroom !== 2 && headroom !== 4) throw new Error('Invalid test')
        return m7DisplaySample(1, headroom)
      }),
    ).toEqual([255, 188, 137])
    expect(m7DisplaySample(-0.1, 1)).toBe(0)
    expect(m7DisplaySample(5, 4)).toBe(255)
  })
  it('composites straight alpha in linear light on identical backgrounds', () => {
    expect(m7CompositeSample(0, 0, 1)).toBe(255)
    expect(m7CompositeSample(255, 0, 0)).toBe(0)
    expect(m7CompositeSample(128, 255, 1)).toBe(128)
    expect(m7CompositeSample(255, 128, 0)).toBe(188)
  })
  it('rejects nonfinite and out-of-domain metric input', () => {
    expect(() => m7PqFromRelativeLight(-1)).toThrow()
    expect(() => m7RelativeLightFromPq(2)).toThrow()
    expect(() => m7DisplaySample(Number.NaN, 1)).toThrow()
    expect(() => m7CompositeSample(256, 255, 0)).toThrow()
  })
})
