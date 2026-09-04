import { invalidInput } from '../errors.ts'
import type { JpegXlSpline } from './jpegxl-frame-features.ts'

interface SplinePoint {
  readonly x: number
  readonly y: number
}

export interface JpegXlSplineColorCorrelation {
  readonly colorFactor: number
  readonly baseCorrelationX: number
  readonly baseCorrelationB: number
}

const splineErf = (value: number): number => {
  const sign = value < 0 ? -1 : 1
  const x = Math.abs(value)
  const t = 1 / (1 + 0.3275911 * x)
  const polynomial =
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t
  return sign * (1 - polynomial * Math.exp(-x * x))
}

const continuousSplineIdct = (dct: readonly number[], position: number): number => {
  let sum = 0
  for (let index = 0; index < 32; index += 1) {
    sum += Math.SQRT2 * (dct[index] ?? 0) * Math.cos((Math.PI * index * (position + 0.5)) / 32)
  }
  return sum
}

const interpolateSplinePoints = (controlPoints: readonly SplinePoint[]): SplinePoint[] => {
  if (controlPoints.length <= 1) return [...controlPoints]
  const points = [
    {
      x: 2 * (controlPoints[0]?.x ?? 0) - (controlPoints[1]?.x ?? 0),
      y: 2 * (controlPoints[0]?.y ?? 0) - (controlPoints[1]?.y ?? 0),
    },
    ...controlPoints,
    {
      x: 2 * (controlPoints.at(-1)?.x ?? 0) - (controlPoints.at(-2)?.x ?? 0),
      y: 2 * (controlPoints.at(-1)?.y ?? 0) - (controlPoints.at(-2)?.y ?? 0),
    },
  ]
  const output: SplinePoint[] = []
  for (let start = 0; start < points.length - 3; start += 1) {
    const p0 = points[start]
    const p1 = points[start + 1]
    const p2 = points[start + 2]
    const p3 = points[start + 3]
    if (!p0 || !p1 || !p2 || !p3) throw invalidInput('JPEG XL spline point is missing')
    output.push(p1)
    const distances = [
      Math.sqrt(Math.hypot(p1.x - p0.x, p1.y - p0.y)),
      Math.sqrt(Math.hypot(p2.x - p1.x, p2.y - p1.y)),
      Math.sqrt(Math.hypot(p3.x - p2.x, p3.y - p2.y)),
    ]
    const times = [0, distances[0] ?? 0]
    times.push((times[1] ?? 0) + (distances[1] ?? 0))
    times.push((times[2] ?? 0) + (distances[2] ?? 0))
    for (let step = 1; step < 16; step += 1) {
      const time = (distances[0] ?? 0) + (step / 16) * (distances[1] ?? 0)
      const base = [p0, p1, p2]
      const next = [p1, p2, p3]
      const a = base.map((point, index) => {
        const span = (times[index + 1] ?? 0) - (times[index] ?? 0)
        const ratio = span === 0 ? 0 : (time - (times[index] ?? 0)) / span
        return {
          x: point.x + ratio * ((next[index]?.x ?? point.x) - point.x),
          y: point.y + ratio * ((next[index]?.y ?? point.y) - point.y),
        }
      })
      const b = [0, 1].map((index) => {
        const span = (times[index + 2] ?? 0) - (times[index] ?? 0)
        const ratio = span === 0 ? 0 : (time - (times[index] ?? 0)) / span
        const first = a[index]
        const second = a[index + 1]
        return {
          x: (first?.x ?? 0) + ratio * ((second?.x ?? 0) - (first?.x ?? 0)),
          y: (first?.y ?? 0) + ratio * ((second?.y ?? 0) - (first?.y ?? 0)),
        }
      })
      const span = (times[2] ?? 0) - (times[1] ?? 0)
      const ratio = span === 0 ? 0 : (time - (times[1] ?? 0)) / span
      output.push({
        x: (b[0]?.x ?? 0) + ratio * ((b[1]?.x ?? 0) - (b[0]?.x ?? 0)),
        y: (b[0]?.y ?? 0) + ratio * ((b[1]?.y ?? 0) - (b[0]?.y ?? 0)),
      })
    }
  }
  const last = controlPoints.at(-1)
  if (last) output.push(last)
  return output
}

const equallySpacedSplinePoints = (
  points: readonly SplinePoint[],
): readonly (readonly [SplinePoint, number])[] => {
  if (points.length === 0) return Object.freeze([])
  const output: [SplinePoint, number][] = []
  let current = points[0]
  if (!current) return Object.freeze([])
  output.push([current, 1])
  let nextIndex = 0
  while (nextIndex < points.length) {
    let previous: SplinePoint = current
    let distanceFromPrevious = 0
    for (;;) {
      const next = points[nextIndex]
      if (!next) {
        output.push([previous, distanceFromPrevious])
        return Object.freeze(output)
      }
      const distance = Math.hypot(next.x - previous.x, next.y - previous.y)
      if (distanceFromPrevious + distance >= 1) {
        const ratio = distance === 0 ? 0 : (1 - distanceFromPrevious) / distance
        current = {
          x: previous.x + ratio * (next.x - previous.x),
          y: previous.y + ratio * (next.y - previous.y),
        }
        output.push([current, 1])
        break
      }
      distanceFromPrevious += distance
      previous = next
      nextIndex += 1
    }
  }
  return Object.freeze(output)
}

const correlationRatio = (
  correlation: Readonly<JpegXlSplineColorCorrelation>,
  channel: 0 | 2,
): number => (channel === 0 ? correlation.baseCorrelationX : correlation.baseCorrelationB)

const dequantizeSpline = (
  spline: Readonly<JpegXlSpline>,
  quantizationAdjustment: number,
  yToX: number,
  yToB: number,
): Readonly<{
  controlPoints: readonly SplinePoint[]
  color: readonly number[][]
  sigma: readonly number[]
}> => {
  const controlPoints: SplinePoint[] = [{ x: spline.startingX, y: spline.startingY }]
  let x = spline.startingX
  let y = spline.startingY
  let deltaX = 0
  let deltaY = 0
  for (const delta of spline.controlPointDeltas) {
    deltaX += delta[0]
    deltaY += delta[1]
    x += deltaX
    y += deltaY
    controlPoints.push({ x, y })
  }
  const inverseQuantization =
    quantizationAdjustment >= 0
      ? 1 / (1 + 0.125 * quantizationAdjustment)
      : 1 - 0.125 * quantizationAdjustment
  const channelWeights = [0.0042, 0.075, 0.07]
  const color = spline.colorDct.map((channel, channelIndex) =>
    channel.map(
      (value, index) =>
        value *
        (index === 0 ? Math.SQRT1_2 : 1) *
        (channelWeights[channelIndex] ?? 1) *
        inverseQuantization,
    ),
  )
  for (let index = 0; index < 32; index += 1) {
    if (color[0]) color[0][index] = (color[0][index] ?? 0) + yToX * (color[1]?.[index] ?? 0)
    if (color[2]) color[2][index] = (color[2][index] ?? 0) + yToB * (color[1]?.[index] ?? 0)
  }
  const sigma = spline.sigmaDct.map(
    (value, index) => value * (index === 0 ? Math.SQRT1_2 : 1) * 0.3333 * inverseQuantization,
  )
  return Object.freeze({ controlPoints: Object.freeze(controlPoints), color, sigma })
}

export const applyJpegXlSplines = (
  planes: readonly Float32Array[],
  stride: number,
  width: number,
  height: number,
  splines: readonly JpegXlSpline[],
  quantizationAdjustment: number,
  colorCorrelation: Readonly<JpegXlSplineColorCorrelation>,
): void => {
  const yToX = correlationRatio(colorCorrelation, 0)
  const yToB = correlationRatio(colorCorrelation, 2)
  for (const encoded of splines) {
    const spline = dequantizeSpline(encoded, quantizationAdjustment, yToX, yToB)
    const points = equallySpacedSplinePoints(interpolateSplinePoints(spline.controlPoints))
    if (points.length < 2) continue
    const arcLength = points.length - 2 + (points.at(-1)?.[1] ?? 0)
    if (arcLength <= 0) continue
    for (let pointIndex = 0; pointIndex < points.length; pointIndex += 1) {
      const point = points[pointIndex]
      if (!point) continue
      const progress = Math.min(1, pointIndex / arcLength)
      const dctPosition = 31 * progress
      const color = spline.color.map((channel) => continuousSplineIdct(channel, dctPosition))
      const sigma = continuousSplineIdct(spline.sigma, dctPosition)
      const intensity = point[1]
      if (!Number.isFinite(sigma) || sigma === 0 || !Number.isFinite(intensity)) continue
      let maximumColor = 0.01
      for (const value of color) maximumColor = Math.max(maximumColor, Math.abs(value * intensity))
      const maximumDistance = Math.sqrt(
        -2 * sigma * sigma * (Math.log(0.1) * 3 - Math.log(maximumColor)),
      )
      const y0 = Math.max(0, Math.round(point[0].y - maximumDistance))
      const y1 = Math.min(height, Math.round(point[0].y + maximumDistance) + 1)
      const x0 = Math.max(0, Math.round(point[0].x - maximumDistance))
      const x1 = Math.min(width, Math.round(point[0].x + maximumDistance) + 1)
      for (let localY = y0; localY < y1; localY += 1) {
        const dy = localY - point[0].y
        for (let localX = x0; localX < x1; localX += 1) {
          const distance = Math.hypot(localX - point[0].x, dy)
          const factor =
            splineErf((distance * 0.5 + 0.353553391) / sigma) -
            splineErf((distance * 0.5 - 0.353553391) / sigma)
          const localIntensity = 0.25 * sigma * intensity * factor * factor
          const offset = localY * stride + localX
          for (let channel = 0; channel < 3; channel += 1) {
            const plane = planes[channel]
            if (plane) plane[offset] = (plane[offset] ?? 0) + (color[channel] ?? 0) * localIntensity
          }
        }
      }
    }
  }
}
