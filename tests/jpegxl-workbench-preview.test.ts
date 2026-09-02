import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import generatedLossless from '../benchmark/jpegxl/generated-lossless-manifest.json' with {
  type: 'json',
}
import {
  jpegXlWorkbenchPreviewMode,
  jpegXlWorkbenchPreviewPixel,
  linearJpegXlWorkbenchPreviewByte,
} from '../docs-astro/src/scripts/jpegxl-workbench-preview.ts'
import { jpegxlCodec } from '../src/codecs/jpegxl.ts'
import { defaultImageLimits } from '../src/limits.ts'
import type { PixelBlock } from '../src/pixel.ts'
import { MemorySource } from '../src/source.ts'

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

  it('normalizes linear rgb16 channels with their declared 10-bit display ranges', () => {
    const ranges = Object.freeze([
      Object.freeze({ black: 0, white: 1_023 }),
      Object.freeze({ black: 0, white: 1_023 }),
      Object.freeze({ black: 0, white: 1_023 }),
    ])
    const data = Uint8Array.of(0x02, 0x00, 0x02, 0x00, 0x02, 0x00)
    const block: PixelBlock = {
      x: 0,
      y: 0,
      width: 1,
      height: 1,
      stride: 6,
      format: 'rgb16',
      data,
      displayRanges: ranges,
    }

    expect(jpegXlWorkbenchPreviewPixel(block, 0, 0, 'linear')).toEqual([188, 188, 188, 255])
    expect(block.data).toEqual(data)
    expect(block.displayRanges).toBe(ranges)
  })

  it('normalizes linear gray16 with its declared 12-bit display range', () => {
    const block: PixelBlock = {
      x: 0,
      y: 0,
      width: 1,
      height: 1,
      stride: 2,
      format: 'gray16',
      data: Uint8Array.of(0x08, 0x00),
      displayRanges: Object.freeze([Object.freeze({ black: 0, white: 4_095 })]),
    }

    expect(jpegXlWorkbenchPreviewPixel(block, 0, 0, 'linear')).toEqual([188, 188, 188, 255])
  })

  it('maps normalized sRGB samples directly and subtracts the declared black point', () => {
    const block: PixelBlock = {
      x: 0,
      y: 0,
      width: 1,
      height: 1,
      stride: 6,
      format: 'rgb16',
      data: Uint8Array.of(0x02, 0x64, 0x02, 0x64, 0x02, 0x64),
      displayRanges: Object.freeze([
        Object.freeze({ black: 100, white: 1_123 }),
        Object.freeze({ black: 100, white: 1_123 }),
        Object.freeze({ black: 100, white: 1_123 }),
      ]),
    }

    expect(jpegXlWorkbenchPreviewPixel(block, 0, 0, 'srgb')).toEqual([128, 128, 128, 255])
  })

  it('uses the independent alpha display range without an RGB transfer', () => {
    const block: PixelBlock = {
      x: 0,
      y: 0,
      width: 1,
      height: 1,
      stride: 8,
      format: 'rgba16',
      data: Uint8Array.of(0x08, 0x00, 0x08, 0x00, 0x08, 0x00, 0x00, 0x80),
      displayRanges: Object.freeze([
        Object.freeze({ black: 0, white: 4_095 }),
        Object.freeze({ black: 0, white: 4_095 }),
        Object.freeze({ black: 0, white: 4_095 }),
        Object.freeze({ black: 0, white: 255 }),
      ]),
    }

    expect(jpegXlWorkbenchPreviewPixel(block, 0, 0, 'linear')).toEqual([188, 188, 188, 128])
  })

  it('uses display ranges from the pinned 10-bit linear Modular decoder blocks', async () => {
    const fixture = generatedLossless.fixtures.find(({ id }) => id === 'rgb10-linear')
    if (!fixture) throw new Error('Pinned rgb10-linear JPEG XL fixture is missing')
    expect(fixture.options).toEqual([
      '--distance=0',
      '--modular=1',
      '--num_threads=0',
      '-x',
      'color_space=RGB_D65_SRG_Rel_Lin',
      '--effort=7',
    ])
    expect(fixture.jxlSha256).toBe(
      '778fb69767e47480adc8e190d0ace89a7da0bb941e575eeee3feedcb45425200',
    )
    const encoded = new Uint8Array(
      readFileSync('benchmark/fixtures/jpegxl/generated-lossless-v0.12.0/rgb10-linear.jxl'),
    )
    expect(createHash('sha256').update(encoded).digest('hex')).toBe(fixture.jxlSha256)
    const decoder = await jpegxlCodec.createDecoder?.(new MemorySource(encoded), defaultImageLimits)
    if (!decoder) throw new Error('JPEG XL decoder is unavailable')
    expect(decoder.pixelFormat).toBe('rgb16')
    const iterator = decoder.decode()[Symbol.asyncIterator]()
    const first = await iterator.next()
    if (first.done) throw new Error('Pinned rgb10-linear JPEG XL fixture decoded no blocks')
    const block = first.value
    try {
      expect(block.displayRanges).toEqual([
        { black: 0, white: 1_023 },
        { black: 0, white: 1_023 },
        { black: 0, white: 1_023 },
      ])
      const native = block.data.slice()
      expect(native.subarray(0, 6)).toEqual(Uint8Array.of(0, 0, 0, 255, 1, 254))
      expect(jpegXlWorkbenchPreviewPixel(block, 0, 0, 'linear')).toEqual([0, 137, 187, 255])
      expect(jpegXlWorkbenchPreviewPixel(block, 0, 0, 'linear')).not.toEqual([0, 13, 22, 255])
      expect(block.data).toEqual(native)
    } finally {
      block.release?.()
      await iterator.return?.()
    }
  })

  it('preserves full-range storage fallback when display ranges are absent', () => {
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

  it.each([
    Object.freeze({ displayRanges: Object.freeze([{ black: 0, white: 0 }]) }),
    Object.freeze({ displayRanges: Object.freeze([{ black: 2, white: 1 }]) }),
    Object.freeze({ displayRanges: Object.freeze([{ black: Number.NaN, white: 1 }]) }),
    Object.freeze({
      displayRanges: Object.freeze([{ black: 0, white: Number.POSITIVE_INFINITY }]),
    }),
  ] as const)('rejects an invalid gray display range %#', ({ displayRanges }) => {
    const block: PixelBlock = {
      x: 0,
      y: 0,
      width: 1,
      height: 1,
      stride: 2,
      format: 'gray16',
      data: Uint8Array.of(0, 1),
      displayRanges,
    }

    expect(() => jpegXlWorkbenchPreviewPixel(block, 0, 0, 'linear')).toThrow('display range')
  })

  it('rejects display ranges that omit a required channel', () => {
    const block: PixelBlock = {
      x: 0,
      y: 0,
      width: 1,
      height: 1,
      stride: 6,
      format: 'rgb16',
      data: Uint8Array.of(0, 1, 0, 1, 0, 1),
      displayRanges: Object.freeze([
        Object.freeze({ black: 0, white: 1_023 }),
        Object.freeze({ black: 0, white: 1_023 }),
      ]),
    }

    expect(() => jpegXlWorkbenchPreviewPixel(block, 0, 0, 'linear')).toThrow('display range')
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
