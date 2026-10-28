/** First-party offline feature validation. These scores are not perceptual metrics. */
import { type AuditWindow, windowContrast } from './local-rate-audit.ts'

const linear = Float64Array.from({ length: 256 }, (_, i) => {
  const v = i / 255
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
})

export function predictorLuma(rgba: Uint8Array, space: 'display' | 'linear'): Float64Array {
  if (rgba.length % 4 !== 0) throw new Error('Invalid RGBA extent')
  const out = new Float64Array(rgba.length / 4)
  for (let p = 0; p < out.length; p++) {
    let value = 0
    for (let c = 0; c < 3; c++) {
      const sample = rgba[p * 4 + c] ?? 0,
        weight = c === 0 ? 0.2126 : c === 1 ? 0.7152 : 0.0722
      value += weight * (space === 'display' ? sample / 255 : (linear[sample] ?? 0))
    }
    out[p] = value
  }
  return out
}

export interface PooledError {
  readonly maximum: number
  readonly norm3: number
}

export function localWindowErrors(
  source: Float64Array,
  decoded: Float64Array,
  width: number,
  height: number,
  box: AuditWindow,
): readonly number[] {
  const w = windowContrast(source, decoded, width, height, box),
    floor = 1 / 255 ** 2,
    count = box.width * box.height,
    edges = (box.width - 1) * box.height + (box.height - 1) * box.width,
    mse = w.squaredError / count,
    gradient = edges ? w.gradientError / edges : 0,
    sourceGradient = edges ? w.sourceGradient / edges : 0,
    contrast = (Math.sqrt(w.decodedVariance) - Math.sqrt(w.sourceVariance)) ** 2
  return [
    Math.sqrt(mse),
    Math.sqrt(mse / (w.sourceVariance + floor)),
    Math.sqrt(gradient / (sourceGradient + floor)),
    Math.sqrt(contrast / (w.sourceVariance + floor)),
  ]
}

/** Fixed overlapping windows; neither the trial nor its native metric chooses locations. */
export function localErrorPredictors(
  source: Float64Array,
  decoded: Float64Array,
  width: number,
  height: number,
  size: number,
): Record<string, PooledError> {
  if (!Number.isInteger(size) || size < 2 || size > Math.min(width, height) || size % 2 !== 0)
    throw new Error('Invalid predictor window')
  const sums = new Float64Array(4),
    maxima = new Float64Array(4)
  let count = 0
  for (let y = 0; y <= height - size; y += size / 2)
    for (let x = 0; x <= width - size; x += size / 2) {
      const values = localWindowErrors(source, decoded, width, height, {
        x,
        y,
        width: size,
        height: size,
      })
      for (let i = 0; i < values.length; i++) {
        const v = values[i] ?? 0
        sums[i] = (sums[i] ?? 0) + v ** 3
        maxima[i] = Math.max(maxima[i] ?? 0, v)
      }
      count++
    }
  const names = ['rmse', 'normalizedError', 'normalizedGradient', 'contrast']
  return Object.fromEntries(
    names.map((name, i) => [
      name,
      { maximum: maxima[i] ?? 0, norm3: Math.cbrt((sums[i] ?? 0) / count) },
    ]),
  )
}

/** A zero prediction abstains; an unchanged native metric is excluded from sign accuracy. */
export function predictionAgreement(
  rows: readonly { predicted: number; actual: number }[],
  epsilon: number,
) {
  let material = 0,
    correct = 0,
    abstained = 0,
    missedHarm = 0,
    falseAlarm = 0,
    worsened = 0,
    improved = 0
  for (const row of rows) {
    if (!Number.isFinite(row.actual) || !Number.isFinite(row.predicted))
      throw new Error('Nonfinite predictor comparison')
    if (row.actual > 1 && row.predicted <= 1e-9) missedHarm++
    if (Math.abs(row.actual) <= epsilon) continue
    material++
    if (row.actual > 0) worsened++
    else improved++
    if (Math.abs(row.predicted) <= 1e-9) abstained++
    else if (Math.sign(row.predicted) === Math.sign(row.actual)) correct++
    else if (row.actual < 0) falseAlarm++
  }
  return {
    rows: rows.length,
    material,
    correct,
    abstained,
    missedHarm,
    falseAlarm,
    worsened,
    improved,
    alwaysWorseAccuracy: material ? worsened / material : null,
    accuracy: material ? correct / material : null,
  }
}
