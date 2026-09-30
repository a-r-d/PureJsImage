import { describe, expect, it } from 'vitest'
import { useLargeDocumentModularCandidate } from '../src/codecs/jpegxl-modular-encode.ts'

const srgb = {
  family: 'rgb',
  primaries: 'srgb',
  transfer: { kind: 'srgb' },
  matrix: 'identity',
  range: 'full',
  alpha: 'none',
  provenance: 'assumed-default',
  renderingIntent: 'relative',
} as const

describe('JPEG XL large-document lossy selection', () => {
  it('limits the optional Modular search to large white RGB8 effort-7 documents', () => {
    const width = 2800,
      height = 3000,
      pixels = new Uint8Array(width * height * 3)
    pixels.fill(255)
    const options = {
      effort: 7,
      distance: 3,
      progressive: false,
      sampleBitDepth: 8,
      colorSemantics: srgb,
    } as const
    expect(useLargeDocumentModularCandidate(pixels, width, height, 'rgb8', options)).toBe(true)
    expect(
      useLargeDocumentModularCandidate(pixels, width, height, 'rgb8', {
        ...options,
        effort: 3,
      }),
    ).toBe(false)
    expect(
      useLargeDocumentModularCandidate(pixels, width, height, 'rgb8', {
        ...options,
        distance: 1,
      }),
    ).toBe(false)
    expect(useLargeDocumentModularCandidate(pixels, width, height, 'rgba8', options)).toBe(false)
    pixels.fill(0)
    expect(useLargeDocumentModularCandidate(pixels, width, height, 'rgb8', options)).toBe(false)
  })
})
