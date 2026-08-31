import { describe, expect, it } from 'vitest'
import {
  planGainMapCrop,
  planGainMapOrientation,
  planGainMapQuarterTurn,
  planGainMapResize,
} from '../src/hdr/index.ts'

describe('paired gain-map geometry', () => {
  it('accepts floor-rounded gain-map geometry within one map pixel', () => {
    const plan = planGainMapResize(
      { base: { width: 4031, height: 3023 }, gainMap: { width: 1007, height: 755 } },
      { width: 1600, height: 1200 },
    )
    expect(plan.base).toEqual({ width: 1600, height: 1200 })
  })

  it('rejects materially stretched gain-map geometry', () => {
    expect(() =>
      planGainMapResize(
        { base: { width: 4031, height: 3023 }, gainMap: { width: 1007, height: 700 } },
        { width: 1600, height: 1200 },
      ),
    ).toThrow(/aspect ratio/u)
  })
  it('keeps fractional crop edges exact for a non-integral scale', () => {
    const plan = planGainMapCrop(
      { base: { width: 319, height: 187 }, gainMap: { width: 87, height: 51 } },
      { x: 7, y: 5, width: 203, height: 119 },
    )
    expect(plan.gainMapSourceRegion).toEqual({
      left: { numerator: 21, denominator: 11 },
      top: { numerator: 15, denominator: 11 },
      right: { numerator: 630, denominator: 11 },
      bottom: { numerator: 372, denominator: 11 },
    })
    expect(plan.base).toEqual({ width: 203, height: 119 })
    expect(
      Math.abs(plan.gainMap.width - (plan.base.width * plan.gainMap.height) / plan.base.height),
    ).toBeLessThanOrEqual(1)
    expect(
      Math.abs(plan.gainMap.height - (plan.base.height * plan.gainMap.width) / plan.base.width),
    ).toBeLessThanOrEqual(1)
  })

  it('preserves source map density within the one-map-pixel compatibility tolerance', () => {
    expect(
      planGainMapResize(
        { base: { width: 320, height: 180 }, gainMap: { width: 80, height: 45 } },
        { width: 1200, height: 675 },
      ),
    ).toMatchObject({ base: { width: 1200, height: 675 }, gainMap: { width: 300, height: 169 } })
    expect(
      planGainMapResize(
        { base: { width: 320, height: 180 }, gainMap: { width: 80, height: 45 } },
        { width: 1200, height: 675 },
        { gainMapDimensions: { width: 400, height: 225 }, kernel: 'bilinear' },
      ),
    ).toMatchObject({ gainMap: { width: 400, height: 225 }, kernel: 'bilinear' })
    expect(
      planGainMapResize(
        { base: { width: 320, height: 180 }, gainMap: { width: 80, height: 45 } },
        { width: 1200, height: 675 },
        { gainMapDimensions: { width: 300, height: 169 } },
      ),
    ).toMatchObject({ gainMap: { width: 300, height: 169 } })
  })

  it('does not inflate a co-prime crop to a full-density gain map', () => {
    const plan = planGainMapCrop(
      { base: { width: 319, height: 187 }, gainMap: { width: 79, height: 46 } },
      { x: 1, y: 1, width: 317, height: 185 },
    )
    expect(plan.base).toEqual({ width: 317, height: 185 })
    expect(plan.gainMap).toEqual({ width: 79, height: 46 })
    expect(plan.gainMap).not.toEqual(plan.base)
  })

  it('keeps small and prime-sized maps stable across repeated planning', () => {
    const small = planGainMapResize(
      { base: { width: 17, height: 13 }, gainMap: { width: 1, height: 1 } },
      { width: 5, height: 3 },
    )
    expect(small.gainMap).toEqual({ width: 1, height: 1 })

    const prime = planGainMapResize(
      { base: { width: 997, height: 613 }, gainMap: { width: 251, height: 154 } },
      { width: 613, height: 997 },
    )
    const repeated = planGainMapResize(prime, { width: 997, height: 613 })
    expect(prime.gainMap.width).toBeLessThan(prime.base.width)
    expect(prime.gainMap.height).toBeLessThan(prime.base.height)
    expect(Math.abs(repeated.gainMap.width - 251)).toBeLessThanOrEqual(1)
    expect(Math.abs(repeated.gainMap.height - 154)).toBeLessThanOrEqual(1)
  })

  it('applies gain-map pixel limits to density-derived candidates', () => {
    expect(() =>
      planGainMapResize(
        { base: { width: 320, height: 180 }, gainMap: { width: 80, height: 45 } },
        { width: 1200, height: 675 },
        { maxGainMapPixels: 50_000 },
      ),
    ).toThrow(/maxGainMapPixels/u)
  })

  it('swaps both geometries for quarter turns and orientations 5 through 8', () => {
    const state = { base: { width: 321, height: 183 }, gainMap: { width: 107, height: 61 } }
    expect(planGainMapQuarterTurn(state, 90)).toEqual({
      base: { width: 183, height: 321 },
      gainMap: { width: 61, height: 107 },
    })
    expect(planGainMapQuarterTurn(state, 180)).toEqual(state)
    expect(planGainMapOrientation(state, 6)).toEqual({
      base: { width: 183, height: 321 },
      gainMap: { width: 61, height: 107 },
    })
  })

  it('rejects incompatible explicit map geometry and unsafe crop regions', () => {
    const state = { base: { width: 320, height: 180 }, gainMap: { width: 80, height: 45 } }
    expect(() =>
      planGainMapResize(
        state,
        { width: 100, height: 100 },
        {
          gainMapDimensions: { width: 20, height: 18 },
        },
      ),
    ).toThrow(/aspect ratio/u)
    expect(() => planGainMapCrop(state, { x: 319, y: 0, width: 2, height: 1 })).toThrow(/outside/u)
  })
})
