import { describe, expect, it } from 'vitest'

import {
  compositeOmeZarrSample,
  normalizeOmeZarrSample,
  omeZarrChannelColor,
  omeZarrDisplayRange,
  omeZarrLabelColor,
  overlayOmeZarrLabel,
} from '../docs-astro/src/scripts/ome-zarr-render.ts'

describe('OME-Zarr viewport channel rendering', () => {
  it('maps three channels to RGB and safely clamps pseudocolor sums', () => {
    const rgba = new Uint8ClampedArray([0, 0, 0, 255, 0, 0, 0, 255])
    compositeOmeZarrSample(rgba, 0, 32 / 255, omeZarrChannelColor(3, 0, undefined))
    compositeOmeZarrSample(rgba, 0, 64 / 255, omeZarrChannelColor(3, 1, undefined))
    compositeOmeZarrSample(rgba, 0, 128 / 255, omeZarrChannelColor(3, 2, undefined))
    expect([...rgba.slice(0, 4)]).toEqual([32, 64, 128, 255])

    compositeOmeZarrSample(rgba, 1, 1, [255, 128, 64])
    compositeOmeZarrSample(rgba, 1, 1, [255, 200, 255])
    expect([...rgba.slice(4)]).toEqual([255, 255, 255, 255])
  })

  it('uses grayscale for one channel even when color metadata exists', () => {
    expect(omeZarrChannelColor(1, 0, 0xff0000)).toEqual([255, 255, 255])
  })

  it('uses stable integer ranges, tile-local float ranges, and rejects 64-bit display', () => {
    expect(omeZarrDisplayRange('uint16')).toEqual({ minimum: 0, maximum: 65_535 })
    expect(omeZarrDisplayRange('int16')).toEqual({ minimum: -32_768, maximum: 32_767 })
    expect(omeZarrDisplayRange('float32')).toBeUndefined()
    expect(() => omeZarrDisplayRange('uint64')).toThrow('does not support uint64')
    expect(() => omeZarrDisplayRange('int64')).toThrow('does not support int64')
  })

  it('applies bounded channel windows and gamma without leaking invalid values', () => {
    expect(normalizeOmeZarrSample(50, 0, 100, 1)).toBeCloseTo(0.5)
    expect(normalizeOmeZarrSample(25, 0, 100, 2)).toBeCloseTo(0.5)
    expect(normalizeOmeZarrSample(-1, 0, 100, 1)).toBe(0)
    expect(normalizeOmeZarrSample(200, 0, 100, 1)).toBe(1)
    expect(normalizeOmeZarrSample(Number.NaN, 0, 100, 1)).toBe(0)
  })

  it('uses explicit label colors, stable fallbacks, and alpha-composites overlays', () => {
    const colors = new Map<number, readonly [number, number, number, number]>([
      [1, [255, 0, 0, 128]],
    ])
    expect(omeZarrLabelColor(1, colors)).toEqual([255, 0, 0, 128])
    expect(omeZarrLabelColor(7, colors)).toEqual(omeZarrLabelColor(7, colors))
    const rgba = new Uint8ClampedArray([0, 0, 255, 255])
    overlayOmeZarrLabel(rgba, 0, [255, 0, 0, 128], 1)
    expect([...rgba]).toEqual([128, 0, 127, 255])
  })
})
