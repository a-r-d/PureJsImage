import { describe, expect, it } from 'vitest'
import { m7DiagnosticCases, m7DiagnosticGeometry } from '../benchmark/jpegxl/m7-diagnostic-cases.ts'
import corpus from '../benchmark/jpegxl/production-program/m7-corpus-selection.json' with {
  type: 'json',
}

describe('M7 fast development diagnostic', () => {
  it('keeps every diagnostic in the development split and bounds derived inputs', () => {
    expect(new Set(m7DiagnosticCases.map((entry) => entry.id)).size).toBe(8)
    for (const entry of m7DiagnosticCases) {
      const source = corpus.cases.find((source) => source.id === entry.id)
      expect(source?.split).toBe('development')
      if (!source) throw new Error('Missing development source')
      const geometry = m7DiagnosticGeometry(source.width, source.height, entry.preparation)
      expect(geometry.width * geometry.height).toBeLessThanOrEqual(1024 * 1024)
    }
  })
  it('preserves native text scale and clamps crops to the image', () => {
    expect(m7DiagnosticGeometry(2550, 4200, { kind: 'crop', centerX: 1, centerY: 0 })).toEqual({
      left: 1526,
      top: 0,
      width: 1024,
      height: 1024,
    })
  })
  it('preserves photographic aspect ratio and never enlarges small inputs', () => {
    expect(m7DiagnosticGeometry(4000, 3000, { kind: 'resize' })).toEqual({
      left: 0,
      top: 0,
      width: 1024,
      height: 768,
    })
    expect(m7DiagnosticGeometry(32, 16, { kind: 'resize' })).toEqual({
      left: 0,
      top: 0,
      width: 32,
      height: 16,
    })
  })
  it('rejects invalid source dimensions and crop coordinates', () => {
    expect(() => m7DiagnosticGeometry(0, 32, { kind: 'resize' })).toThrow()
    expect(() => m7DiagnosticGeometry(32, 32, { kind: 'crop', centerX: NaN, centerY: 0 })).toThrow()
  })
})
