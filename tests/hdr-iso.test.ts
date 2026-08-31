import { describe, expect, it } from 'vitest'
import {
  encodeIsoGainMapMetadata,
  parseIsoGainMapMetadata,
  type GainMapExactIsoMetadata,
  type GainMapRational,
} from '../src/hdr/index.ts'

const r = (numerator: number, denominator = 64): GainMapRational =>
  Object.freeze({ numerator, denominator })

const triplet = (
  red: GainMapRational,
  green = red,
  blue = red,
): readonly [GainMapRational, GainMapRational, GainMapRational] => Object.freeze([red, green, blue])

const exact = Object.freeze<GainMapExactIsoMetadata>({
  minimum: triplet(r(-64)),
  maximum: triplet(r(128)),
  gamma: triplet(r(64)),
  offsetSdr: triplet(r(1)),
  offsetHdr: triplet(r(1)),
  capacityMinimum: r(0),
  capacityMaximum: r(128),
})

describe('ISO 21496-1 gain-map metadata', () => {
  it.each(['sdr', 'hdr'] as const)(
    'round trips exact one-channel %s-base rationals',
    (baseRendition) => {
      const encoded = encodeIsoGainMapMetadata({
        channelCount: 1,
        baseRendition,
        useBaseColorSpace: true,
        writerVersion: 7,
        exact,
      })
      const decoded = parseIsoGainMapMetadata(encoded)
      expect(decoded).toMatchObject({
        minimumVersion: 0,
        writerVersion: 7,
        channelCount: 1,
        baseRendition,
        useBaseColorSpace: true,
        minimum: [-1, -1, -1],
        maximum: [2, 2, 2],
        gamma: [1, 1, 1],
        offsetSdr: [1 / 64, 1 / 64, 1 / 64],
        capacityMinimum: 0,
        capacityMaximum: 2,
      })
      expect(decoded.exact).toEqual(exact)
      expect(encodeIsoGainMapMetadata(decoded)).toEqual(encoded)
    },
  )

  it('round trips independent RGB rationals without a common denominator', () => {
    const rgb = Object.freeze<GainMapExactIsoMetadata>({
      ...exact,
      minimum: triplet(r(-1, 2), r(-2, 3), r(-3, 4)),
      maximum: triplet(r(3, 2), r(5, 3), r(7, 4)),
      gamma: triplet(r(1, 1), r(5, 4), r(3, 2)),
    })
    const encoded = encodeIsoGainMapMetadata({
      channelCount: 3,
      baseRendition: 'sdr',
      useBaseColorSpace: false,
      exact: rgb,
    })
    const decoded = parseIsoGainMapMetadata(encoded)
    expect(decoded.channelCount).toBe(3)
    expect(decoded.exact).toEqual(rgb)
    expect(decoded.minimum).toEqual([-0.5, -2 / 3, -0.75])
  })

  it('rejects unsupported versions, reserved flags, zero denominators, and trailing bytes', () => {
    const encoded = encodeIsoGainMapMetadata({
      channelCount: 1,
      baseRendition: 'sdr',
      useBaseColorSpace: true,
      exact,
    })
    const version = Uint8Array.from(encoded)
    version[1] = 1
    expect(() => parseIsoGainMapMetadata(version)).toThrow(/version/u)
    const flags = Uint8Array.from(encoded)
    flags[4] = (flags[4] ?? 0) | 1
    expect(() => parseIsoGainMapMetadata(flags)).toThrow(/reserved/u)
    const denominator = Uint8Array.from(encoded)
    denominator.fill(0, 5, 9)
    expect(() => parseIsoGainMapMetadata(denominator)).toThrow(/denominator/u)
    expect(() => parseIsoGainMapMetadata(Uint8Array.from([...encoded, 0]))).toThrow(/trailing/u)
    expect(() => parseIsoGainMapMetadata(encoded.subarray(0, encoded.length - 1))).toThrow(
      /truncated/u,
    )
  })

  it('rejects values that cannot be represented by their signed or unsigned fields', () => {
    expect(() =>
      encodeIsoGainMapMetadata({
        channelCount: 1,
        baseRendition: 'sdr',
        useBaseColorSpace: true,
        exact: Object.freeze({
          ...exact,
          minimum: triplet(r(0x8000_0000)),
        }),
      }),
    ).toThrow(/integer range|gain range/u)
    expect(() =>
      encodeIsoGainMapMetadata({
        channelCount: 1,
        baseRendition: 'sdr',
        useBaseColorSpace: true,
        exact: Object.freeze({
          ...exact,
          capacityMaximum: r(-1),
        }),
      }),
    ).toThrow(/integer range|headroom/u)
  })
})
