import { describe, expect, it } from 'vitest'
import type { GainMapMetadata } from '../src/hdr/index.ts'
import {
  composeGainMapLinearF32,
  decodeBaseRgb8ToLinearF32,
  gainMapDisplayWeight,
  gainMapLinearOutputSemantics,
  gainMapLinearF32ToRgba16,
  ImageSourceRange,
  normalizeGainMapMetadata,
} from '../src/hdr/index.ts'
import { MemorySource } from '../src/source.ts'

const color = Object.freeze({
  family: 'rgb',
  primaries: 'srgb',
  transfer: Object.freeze({ kind: 'linear' }),
  matrix: 'identity',
  range: 'full',
  alpha: 'none',
  provenance: 'container-signaled',
})

const metadata = (overrides: Readonly<Record<string, unknown>> = {}): GainMapMetadata =>
  normalizeGainMapMetadata({
    baseRendition: 'sdr',
    channelCount: 1,
    baseDimensions: { width: 2, height: 1 },
    gainMapDimensions: { width: 2, height: 1 },
    minimum: 0,
    maximum: 2,
    gamma: 1,
    offsetSdr: 0,
    offsetHdr: 0,
    capacityMinimum: 0,
    capacityMaximum: 2,
    useBaseColorSpace: true,
    baseColor: color,
    alternateColor: color,
    gainMapColor: { ...color, family: 'gray' },
    container: 'jpeg',
    representations: ['ultra-hdr-xmp'],
    selectedRepresentation: 'ultra-hdr-xmp',
    metadataRanges: [],
    orientation: 1,
    warnings: [],
    ...overrides,
  })

describe('gain-map metadata', () => {
  it('expands scalar values and preserves exact source forms', () => {
    const result = metadata({
      minimum: [-1],
      ultraHdrLexical: { minimum: ['-1.000'], capacityMaximum: '2.0' },
      exactIso: {
        minimum: [
          { numerator: -1, denominator: 1 },
          { numerator: -1, denominator: 1 },
          { numerator: -1, denominator: 1 },
        ],
        maximum: [
          { numerator: 2, denominator: 1 },
          { numerator: 2, denominator: 1 },
          { numerator: 2, denominator: 1 },
        ],
        gamma: [
          { numerator: 1, denominator: 1 },
          { numerator: 1, denominator: 1 },
          { numerator: 1, denominator: 1 },
        ],
        offsetSdr: [
          { numerator: 0, denominator: 1 },
          { numerator: 0, denominator: 1 },
          { numerator: 0, denominator: 1 },
        ],
        offsetHdr: [
          { numerator: 0, denominator: 1 },
          { numerator: 0, denominator: 1 },
          { numerator: 0, denominator: 1 },
        ],
        capacityMinimum: { numerator: 0, denominator: 1 },
        capacityMaximum: { numerator: 2, denominator: 1 },
      },
    })

    expect(result.minimum).toEqual([-1, -1, -1])
    expect(result.sourceCardinality).toBe('scalar')
    expect(result.ultraHdrLexical?.minimum).toEqual(['-1.000'])
    expect(result.exactIso?.minimum[0]).toEqual({ numerator: -1, denominator: 1 })
    expect(Object.isFrozen(result)).toBe(true)
  })

  it('retains RGB metadata only for a three-channel map', () => {
    const result = metadata({
      channelCount: 3,
      minimum: [-1, 0, 1],
      maximum: [1, 2, 3],
      gamma: [1, 2, 3],
      offsetSdr: [0, 0.1, 0.2],
      offsetHdr: [0.3, 0.4, 0.5],
      gainMapColor: color,
    })
    expect(result.sourceCardinality).toBe('rgb')
    expect(result.gamma).toEqual([1, 2, 3])
  })

  it.each([
    [{ gamma: 0 }, 'gamma'],
    [{ minimum: 3, maximum: 2 }, 'minimum'],
    [{ capacityMinimum: 2, capacityMaximum: 2 }, 'capacity'],
    [{ offsetSdr: -1 }, 'offset'],
    [{ baseDimensions: { width: 3, height: 2 } }, 'aspect ratio'],
    [{ exactIso: { minimum: [] } }, 'exactIso'],
    [{ ultraHdrLexical: { minimum: ['not-a-number'] } }, 'ultraHdrLexical'],
    [{ ultraHdrLexical: { maximum: ['3'] } }, 'ultraHdrLexical conflict'],
    [{ channelCount: 1, minimum: [0, 0, 0] }, 'one-channel'],
  ])('rejects malformed metadata containing %s', (overrides, _label) => {
    expect(() => metadata(overrides)).toThrow()
  })

  it('rejects exact ISO values that conflict with normalized metadata', () => {
    const valid = metadata({
      exactIso: {
        minimum: Array.from({ length: 3 }, () => ({ numerator: 0, denominator: 1 })),
        maximum: Array.from({ length: 3 }, () => ({ numerator: 2, denominator: 1 })),
        gamma: Array.from({ length: 3 }, () => ({ numerator: 1, denominator: 1 })),
        offsetSdr: Array.from({ length: 3 }, () => ({ numerator: 0, denominator: 1 })),
        offsetHdr: Array.from({ length: 3 }, () => ({ numerator: 0, denominator: 1 })),
        capacityMinimum: { numerator: 0, denominator: 1 },
        capacityMaximum: { numerator: 2, denominator: 1 },
      },
    })
    expect(() =>
      normalizeGainMapMetadata({
        ...valid,
        exactIso: {
          ...valid.exactIso,
          capacityMaximum: { numerator: 3, denominator: 1 },
        },
      }),
    ).toThrow(/conflicts with normalized metadata/u)
  })

  it('declares linear output in the proved primary space and rejects cross-primary rendering', () => {
    const displayP3 = metadata({
      baseColor: { ...color, primaries: 'display-p3', transfer: { kind: 'pq' } },
      alternateColor: { ...color, primaries: 'display-p3' },
    })
    expect(gainMapLinearOutputSemantics(displayP3)).toMatchObject({
      family: 'rgb',
      primaries: 'display-p3',
      transfer: { kind: 'linear' },
      matrix: 'identity',
      range: 'full',
    })
    expect(() =>
      gainMapLinearOutputSemantics(
        metadata({ alternateColor: { ...color, primaries: 'display-p3' } }),
      ),
    ).toThrow(/different base and alternate primaries/u)
  })
})

describe('gain-map math', () => {
  it('calculates clamped partial display weights', () => {
    const value = metadata()
    expect(gainMapDisplayWeight(value, 1)).toBe(0)
    expect(gainMapDisplayWeight(value, 2)).toBe(0.5)
    expect(gainMapDisplayWeight(value, 4)).toBe(1)
    expect(gainMapDisplayWeight(value, 16)).toBe(1)
    expect(() => gainMapDisplayWeight(value, 0.5)).toThrow()
  })

  it('renders neutral, minimum, maximum, gamma, offset, and high values in linear light', () => {
    const base = new Float32Array([0.25, 0.5, 2, 0.25, 0.5, 2])
    const rendered = composeGainMapLinearF32(
      base,
      new Uint8Array([0, 255]),
      metadata({ gamma: 2, offsetSdr: 0.25, offsetHdr: 0.125 }),
      { displayBoost: 4 },
    )
    expect(Array.from(rendered.slice(0, 3))).toEqual([0.375, 0.625, 2.125])
    expect(Array.from(rendered.slice(3, 6))).toEqual([1.875, 2.875, 8.875])
  })

  it('applies three gain channels independently', () => {
    const rendered = composeGainMapLinearF32(
      new Float32Array([1, 1, 1]),
      new Uint8Array([0, 128, 255]),
      metadata({
        channelCount: 3,
        minimum: [0, 0, 0],
        maximum: [1, 2, 3],
        gainMapColor: color,
      }),
      { displayBoost: 4 },
    )
    expect(rendered[0]).toBeCloseTo(1, 7)
    expect(rendered[1]).toBeCloseTo(2 ** (2 * (128 / 255)), 6)
    expect(rendered[2]).toBeCloseTo(8, 6)
  })

  it('attenuates an HDR base and preserves alpha', () => {
    const rendered = composeGainMapLinearF32(
      new Float32Array([4, 2, 1, 0.375]),
      new Uint8Array([0]),
      metadata({ baseRendition: 'hdr', minimum: 2, maximum: 2 }),
      { displayBoost: 1 },
      4,
    )
    expect(Array.from(rendered)).toEqual([1, 0.5, 0.25, 0.375])
  })

  it('decodes declared transfer functions and writes canonical RGBA16', () => {
    const linear = decodeBaseRgb8ToLinearF32(
      new Uint8Array([255, 128, 0, 64]),
      metadata({ baseColor: { ...color, transfer: { kind: 'srgb' }, alpha: 'straight' } }),
      4,
    )
    expect(linear[0]).toBe(1)
    expect(linear[1]).toBeCloseTo(0.21586, 5)
    expect(linear[3]).toBeCloseTo(64 / 255, 7)
    expect(Array.from(gainMapLinearF32ToRgba16(linear, 4, 2))).toEqual([
      0x80, 0x00, 0x1b, 0xa1, 0x00, 0x00, 0x40, 0x40,
    ])
  })
})

describe('ImageSourceRange', () => {
  it('translates reads without copying the complete parent', async () => {
    const source = new MemorySource(Uint8Array.from([0, 1, 2, 3, 4, 5]))
    const range = new ImageSourceRange(source, 2, 3)
    expect(range.size).toBe(3)
    expect(Array.from(await range.read(1, 10))).toEqual([3, 4])
    expect(Array.from(await range.read(3, 1))).toEqual([])
  })

  it('rejects unsafe or out-of-parent ranges', () => {
    const source = new MemorySource(new Uint8Array(4))
    expect(() => new ImageSourceRange(source, 3, 2)).toThrow()
    expect(() => new ImageSourceRange(source, -1, 1)).toThrow()
  })
})
