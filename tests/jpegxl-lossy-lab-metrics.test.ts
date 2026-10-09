import { describe, expect, it } from 'vitest'
import {
  bdRate,
  parseButteraugliOutput,
  parseSsimulacra2Output,
  type RatePoint,
  summarizeBdRates,
} from '../benchmark/jpegxl/lossy-lab/metrics.ts'

function scale(points: readonly RatePoint[], factor: number): RatePoint[] {
  return points.map((point) => ({ quality: point.quality, bytes: point.bytes * factor }))
}

const reference = [
  { quality: 60, bytes: 100 },
  { quality: 68, bytes: 180 },
  { quality: 81, bytes: 400 },
  { quality: 90, bytes: 1000 },
]

describe('lossy lab scorer parsing', () => {
  it('reads both Butteraugli numeric lines and the real 3-norm label', () => {
    expect(parseButteraugliOutput('1.1838250160\n3-norm: 0.222178\n')).toEqual({
      max: 1.183825016,
      norm3: 0.222178,
    })
    expect(parseButteraugliOutput(' \r\n +1.2e0 \r\n .25E+1 \r\n')).toEqual({
      max: 1.2,
      norm3: 2.5,
    })
    expect(parseButteraugliOutput('0\n3-norm: 0')).toEqual({ max: 0, norm3: 0 })
  })

  it('reads finite SSIM values, including negative quality', () => {
    expect(parseSsimulacra2Output(' 82.471\r\n')).toBe(82.471)
    expect(parseSsimulacra2Output('-1.4e1\n')).toBe(-14)
  })

  it.each([
    '',
    '1.2',
    '1.2\n0.3\n0.4',
    'max: 1.2\n3-norm: 0.3',
    '1.2px\n0.3',
    'NaN\n0.3',
    'Infinity\n0.3',
    '1e999\n0.3',
    '1.2\n3-norm: nope',
    '1.2\n-0.3',
    '-1.2\n0.3',
    '0x10\n0.3',
  ])('rejects invalid Butteraugli output %j', (output) =>
    expect(() => parseButteraugliOutput(output)).toThrow(),
  )

  it.each(['', '80\n90', 'score: 80', '80 trailing', 'NaN', '-Infinity', '1e999'])(
    'rejects invalid SSIM output %j',
    (output) => expect(() => parseSsimulacra2Output(output)).toThrow(),
  )

  it('rejects non-text external input', () => {
    for (const value of [null, undefined, 1, {}, ['1', '2']]) {
      expect(() => parseButteraugliOutput(value)).toThrow()
      expect(() => parseSsimulacra2Output(value)).toThrow()
    }
  })
})

describe('per-image monotone cubic BD-rate', () => {
  it('gives zero for identical curves without modifying the input', () => {
    const before = structuredClone(reference)
    const result = bdRate(reference, reference, 'ssimulacra2')
    expect(result.percent).toBe(0)
    expect(result.overlap).toEqual({ minimum: 60, maximum: 90 })
    expect(result.requiredRange).toEqual({ minimum: 60, maximum: 90 })
    expect(result.coversRequiredRange).toBe(true)
    expect(reference).toEqual(before)
  })

  it.each([0.5, 0.8, 1, 1.2, 2])('gives the analytic rate for scale %s', (factor) => {
    const result = bdRate(scale(reference, factor), reference, 'ssimulacra2')
    expect(result.percent).toBeCloseTo(100 * (factor - 1), 10)
    expect(result.meanLogRateDifference).toBeCloseTo(Math.log(factor), 13)
  })

  it('integrates linear log-rate curves with different, irregular sample locations', () => {
    const a = [60, 64, 78, 90].map((quality) => ({ quality, bytes: Math.exp(quality / 10) }))
    const b = [55, 68, 86, 95].map((quality) => ({ quality, bytes: Math.exp(quality / 10) * 2 }))
    expect(bdRate(a, b, 'ssimulacra2').percent).toBeCloseTo(-50, 10)
  })

  it('uses a shape-preserving cubic and keeps a flat segment flat', () => {
    const curved = [
      { quality: 60, bytes: 1 },
      { quality: 75, bytes: Math.E },
      { quality: 90, bytes: Math.E },
    ]
    const flat = [
      { quality: 60, bytes: 1 },
      { quality: 90, bytes: 1 },
    ]
    // First unit segment has slopes 1.5 and 0: its integral is 5/8.
    // The next segment is constant 1, giving mean log-rate 13/16.
    expect(bdRate(flat, curved, 'ssimulacra2').percent).toBeCloseTo(100 * Math.expm1(-13 / 16), 11)
    const cropped = [
      { quality: 75, bytes: 1 },
      { quality: 90, bytes: 1 },
    ]
    expect(bdRate(cropped, curved, 'ssimulacra2').percent).toBeCloseTo(100 * Math.expm1(-1), 11)
  })

  it('is invariant to sample order and the direction of the quality metric', () => {
    const candidate = scale(reference, 0.9)
    const expected = bdRate(candidate, reference, 'ssimulacra2')
    const lower = (points: readonly RatePoint[]) =>
      points.map((point) => ({
        quality: 0.5 + (90 - point.quality) / 12,
        bytes: point.bytes,
      }))
    const ba = bdRate(lower(candidate).reverse(), lower(reference), 'butteraugliMax')
    expect(ba.percent).toBeCloseTo(expected.percent, 11)
    expect(ba.overlap).toEqual({ minimum: 0.5, maximum: 3 })
    expect(ba.coversRequiredRange).toBe(true)
    expect(bdRate([...candidate].reverse(), reference, 'ssimulacra2').percent).toBe(
      expected.percent,
    )
  })

  it('uses the cheapest encoding at an exactly duplicated quality', () => {
    const duplicate = [...reference, { quality: 68, bytes: 500 }, { quality: 68, bytes: 180 }]
    expect(bdRate(duplicate, reference, 'ssimulacra2').percent).toBe(0)
    expect(() =>
      bdRate(
        [
          { quality: 70, bytes: 100 },
          { quality: 70, bytes: 90 },
        ],
        reference,
        'ssimulacra2',
      ),
    ).toThrow(/distinct/)
  })

  it('reports partial overlap and never extrapolates', () => {
    const shorter = reference.slice(1, 3)
    const result = bdRate(scale(shorter, 0.8), reference, 'ssimulacra2')
    expect(result.overlap).toEqual({ minimum: 68, maximum: 81 })
    expect(result.coversRequiredRange).toBe(false)
    // Cropped interpolation may differ because the cropped curve has two knots.
    expect(Number.isFinite(result.percent)).toBe(true)
    const ba = [
      { quality: 0.7, bytes: 100 },
      { quality: 0.2, bytes: 1000 },
    ]
    expect(bdRate(ba, ba, 'butteraugliMax').coversRequiredRange).toBe(false)
    const norm = bdRate(ba, ba, 'butteraugliNorm3')
    expect(norm.requiredRange).toBeNull()
    expect(norm.coversRequiredRange).toBe(true)
  })

  it('rejects absent or zero-width overlap', () => {
    for (const qualities of [
      [91, 95],
      [90, 95],
    ]) {
      const points = qualities.map((quality) => ({ quality, bytes: quality }))
      expect(() => bdRate(points, reference, 'ssimulacra2')).toThrow(/overlap/)
    }
  })

  it('rejects nonmonotone rates rather than silently dropping measured points', () => {
    expect(() =>
      bdRate(
        [
          { quality: 60, bytes: 200 },
          { quality: 90, bytes: 100 },
        ],
        reference,
        'ssimulacra2',
      ),
    ).toThrow(/monotone/)
    expect(() =>
      bdRate(
        [
          { quality: 0.5, bytes: 100 },
          { quality: 3, bytes: 200 },
        ],
        reference,
        'butteraugliMax',
      ),
    ).toThrow(/monotone/)
  })

  it('rejects invalid curves', () => {
    const invalidCurves: RatePoint[][] = [
      [
        { quality: 60, bytes: 0 },
        { quality: 90, bytes: 100 },
      ],
      [
        { quality: 60, bytes: -1 },
        { quality: 90, bytes: 100 },
      ],
      [
        { quality: 60, bytes: Number.NaN },
        { quality: 90, bytes: 100 },
      ],
      [
        { quality: Number.POSITIVE_INFINITY, bytes: 100 },
        { quality: 90, bytes: 100 },
      ],
      [{ quality: 60, bytes: 100 }],
      [],
    ]
    for (const points of invalidCurves)
      expect(() => bdRate(points, reference, 'ssimulacra2')).toThrow()
  })

  it('rejects negative Butteraugli and nonrepresentable numerical spans', () => {
    expect(() =>
      bdRate(
        [
          { quality: -1, bytes: 100 },
          { quality: 1, bytes: 10 },
        ],
        reference,
        'butteraugliNorm3',
      ),
    ).toThrow(/nonnegative/)
    expect(() =>
      bdRate(
        [
          { quality: -Number.MAX_VALUE, bytes: 1 },
          { quality: Number.MAX_VALUE, bytes: 2 },
        ],
        reference,
        'ssimulacra2',
      ),
    ).toThrow(/span/)
  })
})

describe('equal-image BD-rate summary', () => {
  it('reports arithmetic mean, median, linear p90, and worst regression', () => {
    const values = [-20, -10, 0, 10, 40]
    const result = summarizeBdRates(values)
    expect(result).toMatchObject({ count: 5, mean: 4, median: 0, worst: 40 })
    expect(result?.p90).toBeCloseTo(28, 12)
    expect(values).toEqual([-20, -10, 0, 10, 40])
    expect(summarizeBdRates([-20, -10])).toEqual({
      count: 2,
      mean: -15,
      median: -15,
      p90: -11,
      worst: -10,
    })
  })

  it('returns no aggregate for empty input and rejects unrecorded invalid entries', () => {
    expect(summarizeBdRates([])).toBeNull()
    expect(summarizeBdRates([5])).toEqual({ count: 1, mean: 5, median: 5, p90: 5, worst: 5 })
    expect(() => summarizeBdRates([0, Number.NaN])).toThrow(/finite/)
    expect(() => summarizeBdRates([Number.POSITIVE_INFINITY])).toThrow(/finite/)
  })
})
