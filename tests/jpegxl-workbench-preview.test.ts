import { describe, expect, it } from 'vitest'
import {
  jpegXlWorkbenchPreviewMode,
  jpegXlWorkbenchPreviewPixel,
  linearJpegXlWorkbenchPreviewByte,
} from '../docs-astro/src/scripts/jpegxl-workbench-preview.ts'
import type { PixelBlock } from '../src/pixel.ts'

const linearSemantics = Object.freeze({
  family: 'rgb' as const,
  primaries: 'srgb' as const,
  transfer: Object.freeze({ kind: 'linear' as const }),
  matrix: 'identity' as const,
  range: 'full' as const,
  alpha: 'none' as const,
  provenance: 'container-signaled' as const,
  renderingIntent: 'relative' as const,
})

describe('JPEG XL workbench preview conversion', () => {
  it.each([
    [0, 0],
    [0.0031308, 10],
    [0.18, 118],
    [0.5, 188],
    [1, 255],
  ] as const)('maps linear sample %s to sRGB byte %s', (linear, expected) => {
    expect(linearJpegXlWorkbenchPreviewByte(linear)).toBe(expected)
  })

  it('converts linear gray and RGB while preserving straight alpha', () => {
    const gray: PixelBlock = {
      x: 0,
      y: 0,
      width: 1,
      height: 1,
      stride: 1,
      format: 'gray8',
      data: Uint8Array.of(128),
    }
    expect(jpegXlWorkbenchPreviewPixel(gray, 0, 0, 'linear')).toEqual([188, 188, 188, 255])

    const rgba16: PixelBlock = {
      x: 0,
      y: 0,
      width: 1,
      height: 1,
      stride: 8,
      format: 'rgba16',
      data: Uint8Array.of(0x80, 0x00, 0x40, 0x00, 0xff, 0xff, 0x80, 0x00),
    }
    expect(jpegXlWorkbenchPreviewPixel(rgba16, 0, 0, 'linear')).toEqual([188, 137, 255, 128])
  })

  it('preserves sRGB bytes and rejects unspecified transfer semantics', () => {
    expect(jpegXlWorkbenchPreviewMode(linearSemantics)).toBe('linear')
    expect(
      jpegXlWorkbenchPreviewMode({
        ...linearSemantics,
        transfer: { kind: 'srgb' },
      }),
    ).toBe('srgb')
    expect(() =>
      jpegXlWorkbenchPreviewMode({
        ...linearSemantics,
        transfer: { kind: 'unspecified' },
      }),
    ).toThrow('does not support')
  })
})
