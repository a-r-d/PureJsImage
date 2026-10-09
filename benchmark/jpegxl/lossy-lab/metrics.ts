export type QualityMetric = 'ssimulacra2' | 'butteraugliMax' | 'butteraugliNorm3'

export interface RatePoint {
  quality: number
  bytes: number
}

export interface QualityInterval {
  minimum: number
  maximum: number
}

export interface BdRateResult {
  percent: number
  meanLogRateDifference: number
  /** Interval actually integrated, after clipping any requested interval. */
  overlap: QualityInterval
  /** Shared measured extent, used to validate required-range coverage. */
  measuredOverlap: QualityInterval
  requiredRange: QualityInterval | null
  coversRequiredRange: boolean
}

export interface BdRateSummary {
  count: number
  mean: number
  median: number
  p90: number
  worst: number
}

const numericLine = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/

function scorerLines(output: unknown): string[] {
  if (typeof output !== 'string') throw new Error('Scorer output must be text')
  return output
    .trim()
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
}

function parseScore(line: string | undefined, name: string): number {
  if (line === undefined || !numericLine.test(line))
    throw new Error(`Invalid ${name} scorer output`)
  const score = Number(line)
  if (!Number.isFinite(score)) throw new Error(`Nonfinite ${name} score`)
  return score
}

export function parseButteraugliOutput(output: unknown): { max: number; norm3: number } {
  const lines = scorerLines(output)
  if (lines.length !== 2) throw new Error('Expected two Butteraugli score lines')
  const max = parseScore(lines[0], 'Butteraugli max')
  const norm3 = parseScore(lines[1]?.replace(/^3-norm:\s*/, ''), 'Butteraugli 3-norm')
  if (max < 0 || norm3 < 0) throw new Error('Butteraugli scores must be nonnegative')
  return { max, norm3 }
}

export function parseSsimulacra2Output(output: unknown): number {
  const lines = scorerLines(output)
  if (lines.length !== 1) throw new Error('Expected one SSIMULACRA2 score line')
  return parseScore(lines[0], 'SSIMULACRA2')
}

interface Curve {
  quality: Float64Array
  logBytes: Float64Array
  slopes: Float64Array
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function finite(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value))
    throw new Error(`${name} must be finite`)
  return value
}

function at(values: ArrayLike<number>, index: number): number {
  const value = values[index]
  if (value === undefined) throw new Error('Incomplete rate curve')
  return value
}

function curve(points: readonly RatePoint[], direction: 1 | -1): Curve {
  if (!Array.isArray(points)) throw new Error('Rate curve must be an array')
  const unique = new Map<number, { logBytes: number; count: number }>()
  for (const value of points) {
    if (!isRecord(value)) throw new Error('Invalid rate point')
    const quality = finite(value.quality, 'Quality')
    const bytes = finite(value.bytes, 'Bytes')
    if (bytes <= 0) throw new Error('Bytes must be positive')
    if (direction === -1 && quality < 0) throw new Error('Butteraugli must be nonnegative')
    const x = direction * quality
    const previous = unique.get(x)
    // A single-valued interpolant needs one ordinate per quality. Average tied
    // measurements in log space so every encoding contributes equally; choosing
    // minimum bytes would silently favor the encoder's cheapest measurement.
    if (previous === undefined) unique.set(x, { logBytes: Math.log(bytes), count: 1 })
    else {
      previous.logBytes += Math.log(bytes)
      previous.count++
    }
  }
  const sorted = [...unique].sort((a, b) => a[0] - b[0])
  if (sorted.length < 2) throw new Error('Rate curve needs two distinct qualities')
  const quality = new Float64Array(sorted.length)
  const logBytes = new Float64Array(sorted.length)
  let i = 0
  for (const point of sorted) {
    quality[i] = point[0]
    logBytes[i] = point[1].logBytes / point[1].count
    i++
  }
  finite(at(quality, quality.length - 1) - at(quality, 0), 'Quality span')
  return { quality, logBytes, slopes: pchipSlopes(quality, logBytes) }
}

function endpointSlope(h0: number, h1: number, d0: number, d1: number): number {
  const ratio = h0 / (h0 + h1)
  const slope = (1 + ratio) * d0 - ratio * d1
  if (Math.sign(slope) !== Math.sign(d0)) return 0
  if (Math.sign(d0) !== Math.sign(d1) && Math.abs(slope) > 3 * Math.abs(d0)) return 3 * d0
  return slope
}

// PCHIP uses harmonic interior derivatives and limited endpoint derivatives,
// preserving each interval's shape, including measured local extrema. A globally
// monotone fit cannot interpolate rate reversals without changing observations.
// Retain all knots rather than taking a Pareto envelope or fitting isotonic rates.
function pchipSlopes(x: Float64Array, y: Float64Array): Float64Array {
  const n = x.length
  const widths = new Float64Array(n - 1)
  const secants = new Float64Array(n - 1)
  const slopes = new Float64Array(n)
  for (let i = 0; i < n - 1; i++) {
    widths[i] = at(x, i + 1) - at(x, i)
    secants[i] = finite((at(y, i + 1) - at(y, i)) / at(widths, i), 'Curve slope')
  }
  if (n === 2) {
    slopes.fill(at(secants, 0))
    return slopes
  }
  slopes[0] = endpointSlope(at(widths, 0), at(widths, 1), at(secants, 0), at(secants, 1))
  slopes[n - 1] = endpointSlope(
    at(widths, n - 2),
    at(widths, n - 3),
    at(secants, n - 2),
    at(secants, n - 3),
  )
  for (let i = 1; i < n - 1; i++) {
    const left = at(secants, i - 1)
    const right = at(secants, i)
    if (left === 0 || right === 0 || Math.sign(left) !== Math.sign(right)) continue
    const sum = at(widths, i - 1) + at(widths, i)
    const w1 = 1 + at(widths, i) / sum
    const w2 = 1 + at(widths, i - 1) / sum
    slopes[i] = 3 / (w1 / left + w2 / right)
  }
  for (const slope of slopes) finite(slope, 'Interpolated slope')
  return slopes
}

function integrate(value: Curve, minimum: number, maximum: number): number {
  const { quality, logBytes, slopes } = value
  // Center log bytes to reduce cancellation in the polynomial coefficients.
  const origin = at(logBytes, 0)
  let total = origin * (maximum - minimum)
  for (let i = 0; i < quality.length - 1; i++) {
    const left = Math.max(minimum, at(quality, i))
    const right = Math.min(maximum, at(quality, i + 1))
    if (right <= left) continue
    const width = at(quality, i + 1) - at(quality, i)
    const a = (left - at(quality, i)) / width
    const b = (right - at(quality, i)) / width
    const y0 = at(logBytes, i) - origin
    const delta = at(logBytes, i + 1) - at(logBytes, i)
    const m0 = width * at(slopes, i)
    const m1 = width * at(slopes, i + 1)
    const c2 = 3 * delta - 2 * m0 - m1
    const c3 = -2 * delta + m0 + m1
    total +=
      width *
      (y0 * (b - a) +
        (m0 * (b ** 2 - a ** 2)) / 2 +
        (c2 * (b ** 3 - a ** 3)) / 3 +
        (c3 * (b ** 4 - a ** 4)) / 4)
  }
  return finite(total, 'Integrated log rate')
}

/** Negative BD-rate means the candidate uses fewer bytes at equal quality. */
export function bdRate(
  candidate: readonly RatePoint[],
  reference: readonly RatePoint[],
  metric: QualityMetric,
  requestedInterval?: QualityInterval,
): BdRateResult {
  if (metric !== 'ssimulacra2' && metric !== 'butteraugliMax' && metric !== 'butteraugliNorm3')
    throw new Error('Unknown quality metric')
  const direction = metric === 'ssimulacra2' ? 1 : -1
  const a = curve(candidate, direction)
  const b = curve(reference, direction)
  let minimum = Math.max(at(a.quality, 0), at(b.quality, 0))
  let maximum = Math.min(at(a.quality, a.quality.length - 1), at(b.quality, b.quality.length - 1))
  if (!(maximum > minimum)) throw new Error('Rate curves have no positive quality overlap')
  const measuredOverlap =
    direction === 1 ? { minimum, maximum } : { minimum: -maximum, maximum: -minimum }
  if (requestedInterval !== undefined) {
    if (!isRecord(requestedInterval)) throw new Error('Invalid requested quality interval')
    const lower = finite(requestedInterval.minimum, 'Requested interval minimum')
    const upper = finite(requestedInterval.maximum, 'Requested interval maximum')
    if (!(upper > lower)) throw new Error('Requested quality interval must have positive width')
    minimum = Math.max(minimum, direction === 1 ? lower : -upper)
    maximum = Math.min(maximum, direction === 1 ? upper : -lower)
    if (!(maximum > minimum))
      throw new Error('Requested quality interval has no positive measured overlap')
  }
  const meanLogRateDifference = finite(
    (integrate(a, minimum, maximum) - integrate(b, minimum, maximum)) / (maximum - minimum),
    'Mean log rate difference',
  )
  const overlap = direction === 1 ? { minimum, maximum } : { minimum: -maximum, maximum: -minimum }
  const requiredRange =
    metric === 'ssimulacra2'
      ? { minimum: 60, maximum: 90 }
      : metric === 'butteraugliMax'
        ? { minimum: 0.5, maximum: 3 }
        : null
  return {
    percent: finite(100 * Math.expm1(meanLogRateDifference), 'BD-rate'),
    meanLogRateDifference,
    overlap,
    measuredOverlap,
    requiredRange,
    coversRequiredRange:
      requiredRange === null ||
      (measuredOverlap.minimum <= requiredRange.minimum &&
        measuredOverlap.maximum >= requiredRange.maximum),
  }
}

function percentile(sorted: readonly number[], fraction: number): number {
  const index = (sorted.length - 1) * fraction
  const lower = Math.floor(index)
  const weight = index - lower
  return (1 - weight) * at(sorted, lower) + weight * at(sorted, Math.ceil(index))
}

/** Each image has equal weight; omissions must be recorded by the caller. */
export function summarizeBdRates(values: readonly number[]): BdRateSummary | null {
  for (const value of values) finite(value, 'Per-image BD-rate')
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  let mean = 0
  for (const value of values) mean += value / values.length
  return {
    count: values.length,
    mean: finite(mean, 'Mean BD-rate'),
    median: percentile(sorted, 0.5),
    p90: percentile(sorted, 0.9),
    worst: at(sorted, sorted.length - 1),
  }
}
