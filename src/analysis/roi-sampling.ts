import { throwIfAborted } from '../abort.ts'
import { invalidInput } from '../errors.ts'
import type {
  NormalizedScientificDatasetDescriptor,
  ScientificAxisDescriptor,
} from '../scientific/dataset.ts'
import type { Roi, RoiGeometry, RoiPoint } from './roi.ts'
import {
  physicalToPixelPoint,
  pixelToPhysicalPoint,
  roiAxisPhysicalToPixel,
  roiAxisPixelToPhysical,
  roiBoundingBox,
} from './roi.ts'

export interface RoiTileRegion {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

export interface RoiPlaneShape {
  readonly width: number
  readonly height: number
}

export interface RoiMask {
  readonly originX: number
  readonly originY: number
  readonly width: number
  readonly height: number
  readonly stride: number
  readonly data: Uint8Array
  readonly fillRule: 'even-odd-boundary-inclusive'
}

export interface RoiMaskOptions {
  readonly plane: RoiPlaneShape
  readonly tile: RoiTileRegion
  readonly maxMaskPixels?: number
  readonly signal?: AbortSignal
}

const positiveSize = (value: number, name: string): number => {
  if (!Number.isSafeInteger(value) || value < 1) throw invalidInput(`${name} must be positive`)
  return value
}

const integer = (value: number, name: string): number => {
  if (!Number.isSafeInteger(value)) throw invalidInput(`${name} must be a safe integer`)
  return value
}

const axis = (
  descriptor: NormalizedScientificDatasetDescriptor,
  id: string,
): ScientificAxisDescriptor => {
  const found = descriptor.axes.find((entry) => entry.id === id)
  if (found === undefined) throw invalidInput(`Unknown scientific axis ${id}`)
  return found
}

const pixelGeometryPoint = (
  roi: Roi,
  descriptor: NormalizedScientificDatasetDescriptor,
  value: RoiPoint,
): RoiPoint =>
  roi.coordinateSpace === 'pixel'
    ? value
    : physicalToPixelPoint(descriptor, roi.axisIds, value, roi.units)

const polygonMask = (
  output: Uint8Array,
  stride: number,
  roi: Roi,
  descriptor: NormalizedScientificDatasetDescriptor,
  points: readonly RoiPoint[],
  startX: number,
  endX: number,
  startY: number,
  endY: number,
  tileX: number,
  tileY: number,
  signal: AbortSignal | undefined,
): void => {
  const xAxis = axis(descriptor, roi.axisIds[0])
  const yAxis = axis(descriptor, roi.axisIds[1])
  const intersections: number[] = []
  const horizontalStarts: number[] = []
  const horizontalEnds: number[] = []
  for (let y = startY; y < endY; y += 1) {
    throwIfAborted(signal)
    intersections.length = 0
    horizontalStarts.length = 0
    horizontalEnds.length = 0
    const pixelCenterY = y + 0.5
    const scanY =
      roi.coordinateSpace === 'pixel' ? pixelCenterY : roiAxisPixelToPhysical(yAxis, pixelCenterY)
    for (let index = 0; index < points.length; index += 1) {
      if ((index & 1023) === 0) throwIfAborted(signal)
      const first = points[index]
      const second = points[(index + 1) % points.length]
      if (first === undefined || second === undefined) continue
      if (first.y === second.y) {
        if (scanY === first.y) {
          const left = Math.min(first.x, second.x)
          const right = Math.max(first.x, second.x)
          horizontalStarts.push(
            roi.coordinateSpace === 'pixel' ? left : roiAxisPhysicalToPixel(xAxis, left),
          )
          horizontalEnds.push(
            roi.coordinateSpace === 'pixel' ? right : roiAxisPhysicalToPixel(xAxis, right),
          )
        }
        continue
      }
      const minimumY = Math.min(first.y, second.y)
      const maximumY = Math.max(first.y, second.y)
      if (scanY < minimumY || scanY >= maximumY) continue
      const x = first.x + ((scanY - first.y) * (second.x - first.x)) / (second.y - first.y)
      intersections.push(roi.coordinateSpace === 'pixel' ? x : roiAxisPhysicalToPixel(xAxis, x))
    }
    intersections.sort((left, right) => left - right)
    for (let pair = 0; pair + 1 < intersections.length; pair += 2) {
      const left = intersections[pair]
      const right = intersections[pair + 1]
      if (left === undefined || right === undefined) continue
      const minimum = Math.min(left, right)
      const maximum = Math.max(left, right)
      const firstX = Math.max(startX, Math.ceil(minimum - 0.5))
      const lastX = Math.min(endX - 1, Math.floor(maximum - 0.5))
      for (let x = firstX; x <= lastX; x += 1) output[(y - tileY) * stride + x - tileX] = 1
    }
    for (let span = 0; span < horizontalStarts.length; span += 1) {
      const first = horizontalStarts[span]
      const second = horizontalEnds[span]
      if (first === undefined || second === undefined) continue
      const minimum = Math.min(first, second)
      const maximum = Math.max(first, second)
      const firstX = Math.max(startX, Math.ceil(minimum - 0.5))
      const lastX = Math.min(endX - 1, Math.floor(maximum - 0.5))
      for (let x = firstX; x <= lastX; x += 1) output[(y - tileY) * stride + x - tileX] = 1
    }
  }
}

export const createRoiMask = (
  roi: Roi,
  descriptor: NormalizedScientificDatasetDescriptor,
  options: Readonly<RoiMaskOptions>,
): RoiMask => {
  const planeWidth = positiveSize(options.plane.width, 'plane.width')
  const planeHeight = positiveSize(options.plane.height, 'plane.height')
  const tileX = integer(options.tile.x, 'tile.x')
  const tileY = integer(options.tile.y, 'tile.y')
  const width = positiveSize(options.tile.width, 'tile.width')
  const height = positiveSize(options.tile.height, 'tile.height')
  if (!Number.isSafeInteger(tileX + width) || !Number.isSafeInteger(tileY + height)) {
    throw invalidInput('Tile extent must be a safe integer')
  }
  const maxMaskPixels = options.maxMaskPixels ?? 16_777_216
  if (!Number.isSafeInteger(maxMaskPixels) || maxMaskPixels < 1) {
    throw invalidInput('maxMaskPixels must be positive')
  }
  const pixels = width * height
  if (!Number.isSafeInteger(pixels) || pixels > maxMaskPixels) {
    throw invalidInput('ROI mask exceeds maxMaskPixels')
  }
  if (
    roi.geometry.kind === 'point' ||
    roi.geometry.kind === 'line-segment' ||
    roi.geometry.kind === 'polyline'
  ) {
    throw invalidInput(`${roi.geometry.kind} is not an area mask without an explicit stroke width`)
  }
  throwIfAborted(options.signal)
  const data = new Uint8Array(pixels)
  const startX = Math.max(0, tileX)
  const startY = Math.max(0, tileY)
  const endX = Math.min(planeWidth, tileX + width)
  const endY = Math.min(planeHeight, tileY + height)
  if (startX < endX && startY < endY) {
    const bounds = roiBoundingBox(roi, descriptor, 'pixel')
    if (bounds !== undefined) {
      const boundedStartX = Math.max(startX, Math.ceil(bounds.xMin - 0.5))
      const boundedStartY = Math.max(startY, Math.ceil(bounds.yMin - 0.5))
      const boundedEndX = Math.min(endX, Math.floor(bounds.xMax - 0.5) + 1)
      const boundedEndY = Math.min(endY, Math.floor(bounds.yMax - 0.5) + 1)
      if (boundedStartX < boundedEndX && boundedStartY < boundedEndY) {
        if (roi.geometry.kind === 'polygon') {
          polygonMask(
            data,
            width,
            roi,
            descriptor,
            roi.geometry.points,
            boundedStartX,
            boundedEndX,
            boundedStartY,
            boundedEndY,
            tileX,
            tileY,
            options.signal,
          )
        } else if (roi.geometry.kind === 'rectangle') {
          const value = roi.geometry
          const xAxis = axis(descriptor, roi.axisIds[0])
          const yAxis = axis(descriptor, roi.axisIds[1])
          const right = value.x + value.width
          const bottom = value.y + value.height
          const xCoordinates = new Float64Array(boundedEndX - boundedStartX)
          for (let x = boundedStartX; x < boundedEndX; x += 1) {
            if (((x - boundedStartX) & 4095) === 0) throwIfAborted(options.signal)
            xCoordinates[x - boundedStartX] =
              roi.coordinateSpace === 'pixel' ? x + 0.5 : roiAxisPixelToPhysical(xAxis, x + 0.5)
          }
          for (let y = boundedStartY; y < boundedEndY; y += 1) {
            throwIfAborted(options.signal)
            const sampleY =
              roi.coordinateSpace === 'pixel' ? y + 0.5 : roiAxisPixelToPhysical(yAxis, y + 0.5)
            if (sampleY < value.y || sampleY >= bottom) continue
            for (let x = boundedStartX; x < boundedEndX; x += 1) {
              if (((x - boundedStartX) & 4095) === 0) throwIfAborted(options.signal)
              const sampleX = xCoordinates[x - boundedStartX] ?? Number.NaN
              if (sampleX >= value.x && sampleX < right) data[(y - tileY) * width + x - tileX] = 1
            }
          }
        } else {
          const value = roi.geometry
          const xAxis = axis(descriptor, roi.axisIds[0])
          const yAxis = axis(descriptor, roi.axisIds[1])
          const xCoordinates = new Float64Array(boundedEndX - boundedStartX)
          for (let x = boundedStartX; x < boundedEndX; x += 1) {
            if (((x - boundedStartX) & 4095) === 0) throwIfAborted(options.signal)
            xCoordinates[x - boundedStartX] =
              roi.coordinateSpace === 'pixel' ? x + 0.5 : roiAxisPixelToPhysical(xAxis, x + 0.5)
          }
          for (let y = boundedStartY; y < boundedEndY; y += 1) {
            throwIfAborted(options.signal)
            const sampleY =
              roi.coordinateSpace === 'pixel' ? y + 0.5 : roiAxisPixelToPhysical(yAxis, y + 0.5)
            const dy = (sampleY - value.center.y) / value.radiusY
            for (let x = boundedStartX; x < boundedEndX; x += 1) {
              if (((x - boundedStartX) & 4095) === 0) throwIfAborted(options.signal)
              const sampleX = xCoordinates[x - boundedStartX] ?? Number.NaN
              const dx = (sampleX - value.center.x) / value.radiusX
              if (dx * dx + dy * dy <= 1) data[(y - tileY) * width + x - tileX] = 1
            }
          }
        }
      }
    }
  }
  throwIfAborted(options.signal)
  return Object.freeze({
    originX: tileX,
    originY: tileY,
    width,
    height,
    stride: width,
    data,
    fillRule: 'even-odd-boundary-inclusive',
  })
}

export type RoiLineInterpolation = 'nearest' | 'bilinear'
export type RoiLineSpacingSpace = 'pixel' | 'physical'

export interface RoiLineSamplingOptions {
  readonly spacing: number
  readonly spacingSpace: RoiLineSpacingSpace
  readonly interpolation: RoiLineInterpolation
  readonly maxSamples?: number
  readonly signal?: AbortSignal
}

export interface NearestLineSampling {
  readonly interpolation: 'nearest'
  readonly indices: Float64Array
}

export interface BilinearLineSampling {
  readonly interpolation: 'bilinear'
  readonly indices: Float64Array
  readonly weights: Float64Array
}

export interface RoiLineSamplingPlan {
  readonly sampleCount: number
  readonly distances: Float64Array
  readonly distanceUnit: string | null
  readonly pixelCoordinates: Float64Array
  readonly physicalCoordinates: Float64Array | null
  readonly physicalUnits: readonly [string | null, string | null]
  readonly sampling: NearestLineSampling | BilinearLineSampling
}

const pathPoints = (geometry: RoiGeometry): readonly RoiPoint[] => {
  if (geometry.kind === 'line-segment') return Object.freeze([geometry.start, geometry.end])
  if (geometry.kind === 'polyline') return geometry.points
  throw invalidInput('Line sampling requires line-segment or polyline geometry')
}

const exactCrossSpaceConversion = (
  descriptor: NormalizedScientificDatasetDescriptor,
  roi: Roi,
): boolean =>
  axis(descriptor, roi.axisIds[0]).coordinates.type === 'linear' &&
  axis(descriptor, roi.axisIds[1]).coordinates.type === 'linear'

const hasNumericCalibration = (axisDescriptor: ScientificAxisDescriptor): boolean =>
  axisDescriptor.coordinates.type === 'linear' ||
  (axisDescriptor.coordinates.type === 'lookup' && axisDescriptor.coordinates.values.length >= 2)

export const createRoiLineSamplingPlan = (
  roi: Roi,
  descriptor: NormalizedScientificDatasetDescriptor,
  options: Readonly<RoiLineSamplingOptions>,
): RoiLineSamplingPlan => {
  if (!Number.isFinite(options.spacing) || options.spacing <= 0) {
    throw invalidInput('Line spacing must be positive and finite')
  }
  const maxSamples = options.maxSamples ?? 1_000_000
  if (!Number.isSafeInteger(maxSamples) || maxSamples < 2) {
    throw invalidInput('maxSamples must be a safe integer of at least two')
  }
  if (options.spacingSpace !== 'pixel' && options.spacingSpace !== 'physical') {
    throw invalidInput('spacingSpace must be pixel or physical')
  }
  if (options.interpolation !== 'nearest' && options.interpolation !== 'bilinear') {
    throw invalidInput('interpolation must be nearest or bilinear')
  }
  if (options.spacingSpace !== roi.coordinateSpace && !exactCrossSpaceConversion(descriptor, roi)) {
    throw invalidInput('Cross-space line spacing requires linear calibration on both axes')
  }
  const sourcePoints = pathPoints(roi.geometry)
  const pixelPoints: RoiPoint[] = []
  for (let index = 0; index < sourcePoints.length; index += 1) {
    if ((index & 1023) === 0) throwIfAborted(options.signal)
    const entry = sourcePoints[index]
    if (entry !== undefined) pixelPoints.push(pixelGeometryPoint(roi, descriptor, entry))
  }
  const xAxis = axis(descriptor, roi.axisIds[0])
  const yAxis = axis(descriptor, roi.axisIds[1])
  const calibrated = hasNumericCalibration(xAxis) && hasNumericCalibration(yAxis)
  let physical: RoiPoint[] | undefined
  if (calibrated) {
    physical = []
    for (let index = 0; index < pixelPoints.length; index += 1) {
      if ((index & 1023) === 0) throwIfAborted(options.signal)
      const entry = pixelPoints[index]
      if (entry !== undefined) {
        physical.push(pixelToPhysicalPoint(descriptor, roi.axisIds, entry).point)
      }
    }
  }
  const physicalUnits: readonly [string | null, string | null] = Object.freeze([
    xAxis.unit ?? null,
    yAxis.unit ?? null,
  ])
  if (options.spacingSpace === 'physical' && !calibrated) {
    throw invalidInput('Physical-distance spacing requires numeric calibration on both axes')
  }
  if (options.spacingSpace === 'physical' && physicalUnits[0] !== physicalUnits[1]) {
    throw invalidInput('Physical-distance spacing requires matching axis units')
  }
  const metric = options.spacingSpace === 'pixel' ? pixelPoints : (physical ?? [])
  const cumulative = new Float64Array(metric.length)
  let total = 0
  for (let index = 1; index < metric.length; index += 1) {
    if ((index & 1023) === 0) throwIfAborted(options.signal)
    const previous = metric[index - 1]
    const current = metric[index]
    if (previous === undefined || current === undefined) continue
    const dx = current.x - previous.x
    const dy = current.y - previous.y
    total += Math.hypot(dx, dy)
    cumulative[index] = total
  }
  if (!(total > 0)) throw invalidInput('Line path must have non-zero length')
  const sampleCount = Math.ceil(total / options.spacing) + 1
  if (sampleCount > maxSamples) throw invalidInput('Line plan exceeds maxSamples')
  const distances = new Float64Array(sampleCount)
  const pixelCoordinates = new Float64Array(sampleCount * 2)
  const physicalCoordinates = calibrated ? new Float64Array(sampleCount * 2) : null
  const nearestIndices =
    options.interpolation === 'nearest' ? new Float64Array(sampleCount * 2) : undefined
  const bilinearIndices =
    options.interpolation === 'bilinear' ? new Float64Array(sampleCount * 4) : undefined
  const bilinearWeights =
    options.interpolation === 'bilinear' ? new Float64Array(sampleCount * 4) : undefined
  let segment = 0
  for (let sample = 0; sample < sampleCount; sample += 1) {
    if ((sample & 1023) === 0) throwIfAborted(options.signal)
    const distance = sample === sampleCount - 1 ? total : Math.min(total, sample * options.spacing)
    distances[sample] = distance
    while (segment + 1 < cumulative.length - 1 && (cumulative[segment + 1] ?? 0) < distance) {
      segment += 1
    }
    const startDistance = cumulative[segment] ?? 0
    const endDistance = cumulative[segment + 1] ?? total
    const ratio =
      endDistance === startDistance ? 0 : (distance - startDistance) / (endDistance - startDistance)
    const metricStart = metric[segment]
    const metricEnd = metric[segment + 1]
    if (metricStart === undefined || metricEnd === undefined)
      throw invalidInput('Line segment is missing')
    const metricX = metricStart.x + (metricEnd.x - metricStart.x) * ratio
    const metricY = metricStart.y + (metricEnd.y - metricStart.y) * ratio
    const pixelX =
      options.spacingSpace === 'pixel' ? metricX : roiAxisPhysicalToPixel(xAxis, metricX)
    const pixelY =
      options.spacingSpace === 'pixel' ? metricY : roiAxisPhysicalToPixel(yAxis, metricY)
    pixelCoordinates[sample * 2] = pixelX
    pixelCoordinates[sample * 2 + 1] = pixelY
    if (physicalCoordinates !== null) {
      physicalCoordinates[sample * 2] =
        options.spacingSpace === 'physical' ? metricX : roiAxisPixelToPhysical(xAxis, metricX)
      physicalCoordinates[sample * 2 + 1] =
        options.spacingSpace === 'physical' ? metricY : roiAxisPixelToPhysical(yAxis, metricY)
    }
    if (nearestIndices !== undefined) {
      const xIndex = Math.floor(pixelX)
      const yIndex = Math.floor(pixelY)
      if (!Number.isSafeInteger(xIndex) || !Number.isSafeInteger(yIndex)) {
        throw invalidInput('Nearest sampling indices exceed the safe integer range')
      }
      nearestIndices[sample * 2] = xIndex
      nearestIndices[sample * 2 + 1] = yIndex
    } else if (bilinearIndices !== undefined && bilinearWeights !== undefined) {
      const xPosition = pixelX - 0.5
      const yPosition = pixelY - 0.5
      const x0 = Math.floor(xPosition)
      const y0 = Math.floor(yPosition)
      if (
        !Number.isSafeInteger(x0) ||
        !Number.isSafeInteger(y0) ||
        !Number.isSafeInteger(x0 + 1) ||
        !Number.isSafeInteger(y0 + 1)
      ) {
        throw invalidInput('Bilinear sampling indices exceed the safe integer range')
      }
      const xWeight = xPosition - x0
      const yWeight = yPosition - y0
      const offset = sample * 4
      bilinearIndices[offset] = x0
      bilinearIndices[offset + 1] = y0
      bilinearIndices[offset + 2] = x0 + 1
      bilinearIndices[offset + 3] = y0 + 1
      bilinearWeights[offset] = (1 - xWeight) * (1 - yWeight)
      bilinearWeights[offset + 1] = xWeight * (1 - yWeight)
      bilinearWeights[offset + 2] = (1 - xWeight) * yWeight
      bilinearWeights[offset + 3] = xWeight * yWeight
    }
  }
  throwIfAborted(options.signal)
  const sampling: NearestLineSampling | BilinearLineSampling =
    nearestIndices === undefined
      ? Object.freeze({
          interpolation: 'bilinear',
          indices: bilinearIndices ?? new Float64Array(),
          weights: bilinearWeights ?? new Float64Array(),
        })
      : Object.freeze({ interpolation: 'nearest', indices: nearestIndices })
  return Object.freeze({
    sampleCount,
    distances,
    distanceUnit: options.spacingSpace === 'pixel' ? null : physicalUnits[0],
    pixelCoordinates,
    physicalCoordinates,
    physicalUnits,
    sampling,
  })
}
