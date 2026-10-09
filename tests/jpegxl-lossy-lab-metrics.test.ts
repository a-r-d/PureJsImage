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

describe('per-image shape-preserving cubic BD-rate', () => {
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

  it('gives every tied-quality observation equal weight in log space', () => {
    const duplicates = [
      { quality: 60, bytes: 100 },
      { quality: 60, bytes: 400 },
      { quality: 90, bytes: 400 },
      { quality: 90, bytes: 1600 },
    ]
    const geometricMeans = [
      { quality: 60, bytes: 200 },
      { quality: 90, bytes: 800 },
    ]
    expect(bdRate(duplicates, geometricMeans, 'ssimulacra2').percent).toBeCloseTo(0, 11)
    expect(bdRate([...duplicates].reverse(), geometricMeans, 'ssimulacra2').percent).toBeCloseTo(
      0,
      11,
    )
    expect(bdRate([...reference, ...reference], reference, 'ssimulacra2').percent).toBe(0)
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

  it('clips the integral to the requested interval while preserving default behavior', () => {
    const candidate = [40, 100].map((quality) => ({ quality, bytes: Math.exp(quality / 100) }))
    const flat = [
      { quality: 40, bytes: 1 },
      { quality: 100, bytes: 1 },
    ]
    const defaultResult = bdRate(candidate, flat, 'ssimulacra2')
    expect(defaultResult.meanLogRateDifference).toBeCloseTo(0.7, 13)
    expect(defaultResult.overlap).toEqual({ minimum: 40, maximum: 100 })
    const interval = { minimum: 60, maximum: 90 }
    const clipped = bdRate(candidate, flat, 'ssimulacra2', interval)
    expect(clipped.meanLogRateDifference).toBeCloseTo(0.75, 13)
    expect(clipped.percent).toBeCloseTo(100 * Math.expm1(0.75), 11)
    expect(clipped.overlap).toEqual(interval)
    expect(clipped.measuredOverlap).toEqual({ minimum: 40, maximum: 100 })
    expect(clipped.coversRequiredRange).toBe(true)
    expect(interval).toEqual({ minimum: 60, maximum: 90 })
    const wider = [20, 120].map((quality) => ({ quality, bytes: Math.exp(quality / 100) }))
    const widerFlat = [
      { quality: 20, bytes: 1 },
      { quality: 120, bytes: 1 },
    ]
    expect(bdRate(wider, widerFlat, 'ssimulacra2', interval).percent).toBeCloseTo(
      clipped.percent,
      11,
    )
  })

  it('intersects the requested interval with measured support without extrapolation', () => {
    const candidate = [65, 85].map((quality) => ({ quality, bytes: Math.exp(quality / 100) }))
    const flat = [
      { quality: 65, bytes: 1 },
      { quality: 85, bytes: 1 },
    ]
    const result = bdRate(candidate, flat, 'ssimulacra2', { minimum: 60, maximum: 90 })
    expect(result.overlap).toEqual({ minimum: 65, maximum: 85 })
    expect(result.measuredOverlap).toEqual(result.overlap)
    expect(result.meanLogRateDifference).toBeCloseTo(0.75, 13)
    expect(result.coversRequiredRange).toBe(false)
    const partial = bdRate(candidate, flat, 'ssimulacra2', { minimum: 80, maximum: 95 })
    expect(partial.overlap).toEqual({ minimum: 80, maximum: 85 })
    expect(partial.meanLogRateDifference).toBeCloseTo(0.825, 13)
    expect(partial.coversRequiredRange).toBe(false)
  })

  it('validates required coverage from the actual curves rather than the clipping interval', () => {
    const result = bdRate(reference, reference, 'ssimulacra2', { minimum: 70, maximum: 80 })
    expect(result.overlap).toEqual({ minimum: 70, maximum: 80 })
    expect(result.measuredOverlap).toEqual({ minimum: 60, maximum: 90 })
    expect(result.coversRequiredRange).toBe(true)
  })

  it('clips lower-is-better metrics in their original quality units', () => {
    const candidate = [0.1, 5].map((quality) => ({ quality, bytes: Math.exp(-quality) }))
    const flat = [
      { quality: 0.1, bytes: 1 },
      { quality: 5, bytes: 1 },
    ]
    const result = bdRate(candidate, flat, 'butteraugliMax', { minimum: 0.5, maximum: 3 })
    expect(result.overlap).toEqual({ minimum: 0.5, maximum: 3 })
    expect(result.measuredOverlap).toEqual({ minimum: 0.1, maximum: 5 })
    expect(result.meanLogRateDifference).toBeCloseTo(-1.75, 13)
    expect(result.coversRequiredRange).toBe(true)
    expect(
      bdRate(candidate, flat, 'butteraugliNorm3', { minimum: 1, maximum: 2 }).meanLogRateDifference,
    ).toBeCloseTo(-1.5, 13)
  })

  it('rejects invalid requested intervals and empty or touching intersections', () => {
    for (const interval of [
      { minimum: 80, maximum: 70 },
      { minimum: 70, maximum: 70 },
      { minimum: Number.NaN, maximum: 90 },
      { minimum: 60, maximum: Number.POSITIVE_INFINITY },
      { minimum: 91, maximum: 95 },
      { minimum: 90, maximum: 95 },
    ])
      expect(() => bdRate(reference, reference, 'ssimulacra2', interval)).toThrow()
    const lower = reference.map((point) => ({
      quality: 0.5 + (90 - point.quality) / 12,
      bytes: point.bytes,
    }))
    expect(() => bdRate(lower, lower, 'butteraugliMax', { minimum: 3, maximum: 4 })).toThrow(
      /overlap/,
    )
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

  it('integrates decreasing log rates instead of rejecting legal measurements', () => {
    const decreasing = [
      { quality: 60, bytes: Math.E },
      { quality: 90, bytes: 1 },
    ]
    const flat = [
      { quality: 60, bytes: 1 },
      { quality: 90, bytes: 1 },
    ]
    expect(bdRate(decreasing, flat, 'ssimulacra2').meanLogRateDifference).toBeCloseTo(0.5, 13)
    const lower = (points: readonly RatePoint[]) =>
      points.map((point) => ({
        quality: 0.5 + (90 - point.quality) / 12,
        bytes: point.bytes,
      }))
    expect(
      bdRate(lower(decreasing), lower(flat), 'butteraugliMax').meanLogRateDifference,
    ).toBeCloseTo(0.5, 13)
  })

  it('retains peaks and valleys with the analytic PCHIP area', () => {
    const peak = [
      { quality: 60, bytes: 1 },
      { quality: 75, bytes: Math.E },
      { quality: 90, bytes: 1 },
    ]
    const flat = [
      { quality: 60, bytes: 1 },
      { quality: 90, bytes: 1 },
    ]
    // Slopes 2,0,-2 in unit coordinates give area 2/3 in each segment.
    expect(bdRate(peak, flat, 'ssimulacra2').meanLogRateDifference).toBeCloseTo(2 / 3, 13)
    const valley = peak.map((point) => ({ quality: point.quality, bytes: 1 / point.bytes }))
    expect(bdRate(valley, flat, 'ssimulacra2').meanLogRateDifference).toBeCloseTo(-2 / 3, 13)
    expect(bdRate(scale(peak, 0.8), peak, 'ssimulacra2').percent).toBeCloseTo(-20, 11)
    expect(bdRate(peak.slice().reverse(), peak, 'ssimulacra2').percent).toBe(0)
  })

  it('uses signed harmonic slopes on declining runs and limits endpoint turns', () => {
    const declining = [0, 2, 1, 0].map((logBytes, i) => ({
      quality: 60 + 10 * i,
      bytes: Math.exp(logBytes),
    }))
    const flat = [
      { quality: 60, bytes: 1 },
      { quality: 90, bytes: 1 },
    ]
    // Segment areas 31/24,19/12,1/2 give a mean of 9/8.
    expect(bdRate(declining, flat, 'ssimulacra2').meanLogRateDifference).toBeCloseTo(9 / 8, 13)
    const turn = [
      { quality: 60, bytes: 1 },
      { quality: 75, bytes: Math.E },
      { quality: 90, bytes: Math.exp(-9) },
    ]
    const firstSegment = [
      { quality: 60, bytes: 1 },
      { quality: 75, bytes: 1 },
    ]
    // The first derivative must be limited from 6.5 to 3; its area is 3/4.
    expect(bdRate(turn, firstSegment, 'ssimulacra2').meanLogRateDifference).toBeCloseTo(3 / 4, 13)
  })

  it('adds no overshoot across uneven reversing and flat intervals', () => {
    const qualities = [60, 61, 70, 78, 85, 90]
    const logs = [0, 1, 1, -0.5, 2, 0.25]
    const points = qualities.map((quality, i) => {
      const log = logs[i]
      if (log === undefined) throw new Error('Missing synthetic rate')
      return { quality, bytes: Math.exp(log) }
    })
    for (let i = 0; i < points.length - 1; i++) {
      const left = points[i]
      const right = points[i + 1]
      if (!left || !right) throw new Error('Missing synthetic interval')
      const minimum = Math.min(Math.log(left.bytes), Math.log(right.bytes))
      const maximum = Math.max(Math.log(left.bytes), Math.log(right.bytes))
      for (let j = 1; j < 20; j++) {
        const center = left.quality + ((right.quality - left.quality) * j) / 20
        const radius = (right.quality - left.quality) / 1000
        const local = [
          { quality: center - radius, bytes: 1 },
          { quality: center + radius, bytes: 1 },
        ]
        const mean = bdRate(points, local, 'ssimulacra2').meanLogRateDifference
        expect(mean).toBeGreaterThanOrEqual(minimum - 1e-10)
        expect(mean).toBeLessThanOrEqual(maximum + 1e-10)
      }
    }
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
