import { describe, expect, it } from 'vitest'

import { renderGeoTileDisplay } from '../docs-astro/src/scripts/geo-showcase-display.ts'
import type { GeoNumericTile } from '../src/geo/index.ts'

const tileFor = (data: Float32Array, width: number, height = 1): GeoNumericTile => ({
  x: 0,
  y: 0,
  width,
  height,
  sampleType: 'float32',
  componentCount: 1,
  layout: 'interleaved',
  rowStrideElements: width,
  data,
  fixedIndices: [],
  sourceBands: [0],
  levelId: '0',
  release() {},
})

describe('Geo showcase display', () => {
  it('excludes numeric nodata from the elevation contrast range', () => {
    const display = renderGeoTileDisplay(tileFor(new Float32Array([-9999, 100, 200]), 3), [
      { kind: 'value', value: -9999 },
    ])

    expect(display.ranges).toEqual([[100, 200]])
    expect(display.noDataPixels).toBe(1)
    expect(display.dataRegion).toEqual({ x: 1, y: 0, width: 2, height: 1 })
    expect([...display.rgba]).toEqual([12, 18, 14, 255, 0, 0, 0, 255, 255, 255, 255, 255])
  })

  it('uses a safe display range when a viewport has no valid samples', () => {
    const display = renderGeoTileDisplay(
      tileFor(new Float32Array([Number.NaN, Number.POSITIVE_INFINITY]), 2),
      [{ kind: 'nan' }],
    )

    expect(display.ranges).toEqual([[0, 1]])
    expect(display.noDataPixels).toBe(2)
    expect(display.dataRegion).toBeUndefined()
    expect([...display.rgba]).toEqual([12, 18, 14, 255, 12, 18, 14, 255])
  })
})
