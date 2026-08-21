import { throwIfAborted } from '../abort.ts'
import { invalidInput, limitExceeded, unsupportedOperation } from '../errors.ts'
import type { NumericArray, NumericSampleType, NumericTile } from '../scientific/numeric-tile.ts'
import { numericTileSampleOffset } from '../scientific/numeric-tile.ts'
import {
  admitRasterAllocation,
  assertTileCoversRegion,
  normalizeNumericRasterGrid,
  normalizeRasterNoData,
  normalizeRasterTileRegion,
  numericRasterPlanSchemaVersion,
  rasterNoDataNumber,
  rasterSampleIsNoData,
  resolveRasterOperationLimits,
  type NumericRasterGrid,
  type RasterNoData,
  type RasterOperationLimits,
  type RasterResampling,
  type RasterTileRegion,
} from './raster-contracts.ts'

export const rasterStatisticsAlgorithm = Object.freeze({
  id: 'purejsimage.raster.region-statistics',
  version: 1,
})
export const rasterLineProfileAlgorithm = Object.freeze({
  id: 'purejsimage.raster.line-profile',
  version: 1,
})
export const rasterResampleAlgorithm = Object.freeze({
  id: 'purejsimage.raster.target-grid-resample',
  version: 1,
})

export interface RasterHistogramPlan {
  readonly bins: number
  readonly minimum: number
  readonly maximum: number
}

export interface RasterRegionStatisticsPlan {
  readonly schemaVersion: 1
  readonly algorithm: typeof rasterStatisticsAlgorithm
  readonly component: number
  readonly noData: RasterNoData
  readonly histogram?: RasterHistogramPlan
}

export interface RasterRegionStatistics {
  readonly count: number
  readonly invalidCount: number
  readonly minimum: number | null
  readonly maximum: number | null
  readonly mean: number | null
  /** Population variance (sum of squared deviations divided by count). */
  readonly variance: number | null
  readonly histogram?: {
    readonly minimum: number
    readonly maximum: number
    readonly counts: Uint32Array
    readonly underflow: number
    readonly overflow: number
  }
}

export const createRasterRegionStatisticsPlan = (
  options: Readonly<{
    readonly component?: number
    readonly noData?: RasterNoData
    readonly histogram?: RasterHistogramPlan
    readonly limits?: RasterOperationLimits
  }> = {},
): RasterRegionStatisticsPlan => {
  const limits = resolveRasterOperationLimits(options.limits)
  const component = options.component ?? 0
  if (!Number.isSafeInteger(component) || component < 0) {
    throw invalidInput('Statistics component must be a non-negative safe integer')
  }
  const histogram = options.histogram
  if (
    histogram !== undefined &&
    (!Number.isSafeInteger(histogram.bins) ||
      histogram.bins < 1 ||
      histogram.bins > limits.maxHistogramBins ||
      !Number.isFinite(histogram.minimum) ||
      !Number.isFinite(histogram.maximum) ||
      histogram.minimum >= histogram.maximum)
  ) {
    throw invalidInput('Histogram requires bounded bins and an ordered finite range')
  }
  return Object.freeze({
    schemaVersion: numericRasterPlanSchemaVersion,
    algorithm: rasterStatisticsAlgorithm,
    component,
    noData: normalizeRasterNoData(options.noData ?? { kind: 'none' }),
    ...(histogram === undefined
      ? {}
      : {
          histogram: Object.freeze({
            bins: histogram.bins,
            minimum: histogram.minimum,
            maximum: histogram.maximum,
          }),
        }),
  })
}

const tileNumberAt = (tile: NumericTile, x: number, y: number, component: number): number => {
  const value = tile.data[numericTileSampleOffset(tile, x, y, component)]
  if (typeof value === 'bigint') {
    if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(Number.MIN_SAFE_INTEGER)) {
      throw invalidInput('Raster uint64/int64 sample exceeds exact numeric conversion')
    }
    return Number(value)
  }
  return value ?? Number.NaN
}

export const computeRasterRegionStatistics = (
  plan: Readonly<RasterRegionStatisticsPlan>,
  tile: NumericTile,
  regionValue?: Readonly<RasterTileRegion>,
  options: Readonly<{
    readonly signal?: AbortSignal
    readonly limits?: RasterOperationLimits
  }> = {},
): RasterRegionStatistics => {
  if (
    plan.schemaVersion !== 1 ||
    plan.algorithm.id !== rasterStatisticsAlgorithm.id ||
    plan.algorithm.version !== 1
  ) {
    throw invalidInput('Unsupported raster statistics plan')
  }
  const region = assertTileCoversRegion(
    tile,
    regionValue ?? { x: tile.x, y: tile.y, width: tile.width, height: tile.height },
  )
  const limits = resolveRasterOperationLimits(options.limits)
  const pixels = region.width * region.height
  if (!Number.isSafeInteger(pixels) || pixels > limits.maxTilePixels) {
    throw limitExceeded('Statistics region exceeds maxTilePixels')
  }
  if (plan.component >= tile.componentCount)
    throw invalidInput('Statistics component is unavailable')
  const histogram = plan.histogram
  const counts = histogram === undefined ? undefined : new Uint32Array(histogram.bins)
  if (counts !== undefined && counts.byteLength > limits.maxWorkingBytes) {
    throw limitExceeded('Histogram exceeds maxWorkingBytes')
  }
  let count = 0
  let invalidCount = 0
  let minimum = Number.POSITIVE_INFINITY
  let maximum = Number.NEGATIVE_INFINITY
  let mean = 0
  let sumSquaredDeviation = 0
  let underflow = 0
  let overflow = 0
  for (let y = 0; y < region.height; y += 1) {
    throwIfAborted(options.signal)
    for (let x = 0; x < region.width; x += 1) {
      const value = tileNumberAt(tile, region.x + x - tile.x, region.y + y - tile.y, plan.component)
      if (!Number.isFinite(value) || rasterSampleIsNoData(value, plan.noData)) {
        invalidCount += 1
        continue
      }
      count += 1
      minimum = Math.min(minimum, value)
      maximum = Math.max(maximum, value)
      const delta = value - mean
      mean += delta / count
      sumSquaredDeviation += delta * (value - mean)
      if (histogram !== undefined && counts !== undefined) {
        if (value < histogram.minimum) underflow += 1
        else if (value > histogram.maximum) overflow += 1
        else {
          const normalized = (value - histogram.minimum) / (histogram.maximum - histogram.minimum)
          const index = Math.min(histogram.bins - 1, Math.floor(normalized * histogram.bins))
          counts[index] = (counts[index] ?? 0) + 1
        }
      }
    }
  }
  return Object.freeze({
    count,
    invalidCount,
    minimum: count === 0 ? null : minimum,
    maximum: count === 0 ? null : maximum,
    mean: count === 0 ? null : mean,
    variance: count === 0 ? null : sumSquaredDeviation / count,
    ...(histogram === undefined || counts === undefined
      ? {}
      : {
          histogram: Object.freeze({
            minimum: histogram.minimum,
            maximum: histogram.maximum,
            counts,
            underflow,
            overflow,
          }),
        }),
  })
}

export interface RasterLinePoint {
  readonly x: number
  readonly y: number
}

export interface RasterLineProfilePlan {
  readonly schemaVersion: 1
  readonly algorithm: typeof rasterLineProfileAlgorithm
  readonly start: RasterLinePoint
  readonly end: RasterLinePoint
  readonly sampleCount: number
  readonly component: number
  readonly resampling: RasterResampling
  readonly noData: RasterNoData
  readonly minimumValidWeight: number
}

export interface RasterLineProfile {
  readonly distances: Float64Array
  readonly values: Float64Array
  readonly valid: Uint8Array
}

export const createRasterLineProfilePlan = (
  options: Readonly<{
    readonly start: RasterLinePoint
    readonly end: RasterLinePoint
    readonly sampleCount: number
    readonly component?: number
    readonly resampling?: RasterResampling
    readonly noData?: RasterNoData
    readonly minimumValidWeight?: number
    readonly limits?: RasterOperationLimits
  }>,
): RasterLineProfilePlan => {
  const limits = resolveRasterOperationLimits(options.limits)
  for (const [name, point] of [['start', options.start] as const, ['end', options.end] as const]) {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
      throw invalidInput(`${name} line point must be finite`)
    }
  }
  if (
    !Number.isSafeInteger(options.sampleCount) ||
    options.sampleCount < 1 ||
    options.sampleCount > limits.maxLineSamples
  ) {
    throw invalidInput('Line profile sample count is outside the configured limit')
  }
  const component = options.component ?? 0
  if (!Number.isSafeInteger(component) || component < 0) {
    throw invalidInput('Line profile component must be a non-negative safe integer')
  }
  const resampling = options.resampling ?? 'nearest'
  if (resampling !== 'nearest' && resampling !== 'bilinear') {
    throw invalidInput('Unsupported line profile resampling')
  }
  const minimumValidWeight = options.minimumValidWeight ?? 0.5
  if (!Number.isFinite(minimumValidWeight) || minimumValidWeight <= 0 || minimumValidWeight > 1) {
    throw invalidInput('minimumValidWeight must be in (0, 1]')
  }
  return Object.freeze({
    schemaVersion: numericRasterPlanSchemaVersion,
    algorithm: rasterLineProfileAlgorithm,
    start: Object.freeze({ x: options.start.x, y: options.start.y }),
    end: Object.freeze({ x: options.end.x, y: options.end.y }),
    sampleCount: options.sampleCount,
    component,
    resampling,
    noData: normalizeRasterNoData(options.noData ?? { kind: 'none' }),
    minimumValidWeight,
  })
}

const sampledValue = (
  tile: NumericTile,
  component: number,
  x: number,
  y: number,
  resampling: RasterResampling,
  noData: Readonly<RasterNoData>,
  minimumValidWeight: number,
): number => {
  if (resampling === 'nearest') {
    const column = Math.round(x)
    const row = Math.round(y)
    if (
      column < tile.x ||
      row < tile.y ||
      column >= tile.x + tile.width ||
      row >= tile.y + tile.height
    ) {
      return Number.NaN
    }
    const value = tileNumberAt(tile, column - tile.x, row - tile.y, component)
    return !Number.isFinite(value) || rasterSampleIsNoData(value, noData) ? Number.NaN : value
  }
  const left = Math.floor(x)
  const top = Math.floor(y)
  const fractionX = x - left
  const fractionY = y - top
  const contributors = [
    [left, top, (1 - fractionX) * (1 - fractionY)],
    [left + 1, top, fractionX * (1 - fractionY)],
    [left, top + 1, (1 - fractionX) * fractionY],
    [left + 1, top + 1, fractionX * fractionY],
  ] as const
  let valueSum = 0
  let weightSum = 0
  for (const [column, row, weight] of contributors) {
    if (weight === 0) continue
    if (
      column < tile.x ||
      row < tile.y ||
      column >= tile.x + tile.width ||
      row >= tile.y + tile.height
    ) {
      continue
    }
    const value = tileNumberAt(tile, column - tile.x, row - tile.y, component)
    if (!Number.isFinite(value) || rasterSampleIsNoData(value, noData)) continue
    valueSum += value * weight
    weightSum += weight
  }
  return weightSum >= minimumValidWeight ? valueSum / weightSum : Number.NaN
}

const assertResampleSourceCoverage = (
  tile: NumericTile,
  sourceGrid: NumericRasterGrid,
  x: number,
  y: number,
  resampling: RasterResampling,
): void => {
  const points =
    resampling === 'nearest'
      ? ([[Math.round(x), Math.round(y), 1]] as const)
      : ([
          [Math.floor(x), Math.floor(y), (1 - (x - Math.floor(x))) * (1 - (y - Math.floor(y)))],
          [Math.floor(x) + 1, Math.floor(y), (x - Math.floor(x)) * (1 - (y - Math.floor(y)))],
          [Math.floor(x), Math.floor(y) + 1, (1 - (x - Math.floor(x))) * (y - Math.floor(y))],
          [Math.floor(x) + 1, Math.floor(y) + 1, (x - Math.floor(x)) * (y - Math.floor(y))],
        ] as const)
  for (const [column, row, weight] of points) {
    if (
      weight === 0 ||
      column < 0 ||
      row < 0 ||
      column >= sourceGrid.width ||
      row >= sourceGrid.height
    ) {
      continue
    }
    if (
      column < tile.x ||
      row < tile.y ||
      column >= tile.x + tile.width ||
      row >= tile.y + tile.height
    ) {
      throw invalidInput('Source tile does not cover a required resampling sample')
    }
  }
}

export const sampleRasterLineProfile = (
  plan: Readonly<RasterLineProfilePlan>,
  tile: NumericTile,
  options: Readonly<{
    readonly signal?: AbortSignal
    readonly limits?: RasterOperationLimits
  }> = {},
): RasterLineProfile => {
  if (
    plan.schemaVersion !== 1 ||
    plan.algorithm.id !== rasterLineProfileAlgorithm.id ||
    plan.algorithm.version !== 1
  ) {
    throw invalidInput('Unsupported raster line-profile plan')
  }
  assertTileCoversRegion(tile, { x: tile.x, y: tile.y, width: tile.width, height: tile.height })
  if (plan.component >= tile.componentCount)
    throw invalidInput('Line-profile component is unavailable')
  const limits = resolveRasterOperationLimits(options.limits)
  const outputBytes = plan.sampleCount * (8 + 8 + 1)
  if (!Number.isSafeInteger(outputBytes) || outputBytes > limits.maxOutputBytes) {
    throw limitExceeded('Line profile exceeds maxOutputBytes')
  }
  const distances = new Float64Array(plan.sampleCount)
  const values = new Float64Array(plan.sampleCount)
  const valid = new Uint8Array(plan.sampleCount)
  const deltaX = plan.end.x - plan.start.x
  const deltaY = plan.end.y - plan.start.y
  const length = Math.hypot(deltaX, deltaY)
  for (let index = 0; index < plan.sampleCount; index += 1) {
    if ((index & 1023) === 0) throwIfAborted(options.signal)
    const fraction = plan.sampleCount === 1 ? 0 : index / (plan.sampleCount - 1)
    distances[index] = length * fraction
    const value = sampledValue(
      tile,
      plan.component,
      plan.start.x + deltaX * fraction,
      plan.start.y + deltaY * fraction,
      plan.resampling,
      plan.noData,
      plan.minimumValidWeight,
    )
    values[index] = value
    valid[index] = Number.isFinite(value) ? 1 : 0
  }
  return Object.freeze({ distances, values, valid })
}

export interface RasterTransformAccuracy {
  readonly kind: 'exact' | 'estimated' | 'unknown'
  readonly maximumError?: number
  readonly unit?: string
}

export interface RasterCoordinateTransformDescriptor {
  readonly id: string
  readonly version: string
  readonly accuracy: RasterTransformAccuracy
}

export interface RasterCoordinateTransform {
  readonly descriptor: RasterCoordinateTransformDescriptor
  /** Inverse mapping from target model coordinates to source model coordinates. */
  inverse(targetX: number, targetY: number): readonly [sourceX: number, sourceY: number]
}

export interface RasterTargetGridPlan {
  readonly schemaVersion: 1
  readonly algorithm: typeof rasterResampleAlgorithm
  readonly sourceGrid: NumericRasterGrid
  readonly targetGrid: NumericRasterGrid
  readonly sourceComponent: number
  readonly resampling: RasterResampling
  readonly sourceNoData: RasterNoData
  readonly outputNoData: RasterNoData
  readonly minimumValidWeight: number
  readonly transform?: RasterCoordinateTransformDescriptor
}

const boundedString = (value: string, name: string): string => {
  const result = value.trim()
  if (result.length < 1 || result.length > 4_096) throw invalidInput(`${name} is invalid`)
  return result
}

const normalizeTransformDescriptor = (
  value: Readonly<RasterCoordinateTransformDescriptor>,
): RasterCoordinateTransformDescriptor => {
  if (
    value.accuracy.kind !== 'exact' &&
    value.accuracy.kind !== 'estimated' &&
    value.accuracy.kind !== 'unknown'
  ) {
    throw invalidInput('Unsupported coordinate-transform accuracy')
  }
  if (
    value.accuracy.kind === 'estimated' &&
    (value.accuracy.maximumError === undefined ||
      !Number.isFinite(value.accuracy.maximumError) ||
      value.accuracy.maximumError < 0 ||
      value.accuracy.unit === undefined)
  ) {
    throw invalidInput('Estimated transform accuracy requires a finite error and unit')
  }
  const accuracy: RasterTransformAccuracy =
    value.accuracy.kind === 'estimated'
      ? Object.freeze({
          kind: 'estimated',
          maximumError: value.accuracy.maximumError ?? 0,
          unit: boundedString(value.accuracy.unit ?? '', 'transform accuracy unit'),
        })
      : Object.freeze({ kind: value.accuracy.kind })
  return Object.freeze({
    id: boundedString(value.id, 'transform id'),
    version: boundedString(value.version, 'transform version'),
    accuracy,
  })
}

export const createRasterTargetGridPlan = (
  options: Readonly<{
    readonly sourceGrid: NumericRasterGrid
    readonly targetGrid: NumericRasterGrid
    readonly sourceComponent?: number
    readonly resampling?: RasterResampling
    readonly sourceNoData?: RasterNoData
    readonly outputNoData?: RasterNoData
    readonly minimumValidWeight?: number
    readonly transform?: RasterCoordinateTransformDescriptor
  }>,
): RasterTargetGridPlan => {
  const sourceGrid = normalizeNumericRasterGrid(options.sourceGrid)
  const targetGrid = normalizeNumericRasterGrid(options.targetGrid)
  const sourceComponent = options.sourceComponent ?? 0
  if (!Number.isSafeInteger(sourceComponent) || sourceComponent < 0) {
    throw invalidInput('Resample source component must be a non-negative safe integer')
  }
  const resampling = options.resampling ?? targetGrid.resampling
  if (resampling !== 'nearest' && resampling !== 'bilinear') {
    throw invalidInput('Unsupported target-grid resampling')
  }
  if (
    resampling === 'bilinear' &&
    targetGrid.sampleType !== 'float32' &&
    targetGrid.sampleType !== 'float64'
  ) {
    throw invalidInput('Bilinear target-grid resampling requires float32 or float64 output')
  }
  const minimumValidWeight = options.minimumValidWeight ?? 0.5
  if (!Number.isFinite(minimumValidWeight) || minimumValidWeight <= 0 || minimumValidWeight > 1) {
    throw invalidInput('minimumValidWeight must be in (0, 1]')
  }
  const transform =
    options.transform === undefined ? undefined : normalizeTransformDescriptor(options.transform)
  if (sourceGrid.crs !== targetGrid.crs && transform === undefined) {
    throw unsupportedOperation('Cross-CRS target grid requires an inverse coordinate transform')
  }
  return Object.freeze({
    schemaVersion: numericRasterPlanSchemaVersion,
    algorithm: rasterResampleAlgorithm,
    sourceGrid,
    targetGrid,
    sourceComponent,
    resampling,
    sourceNoData: normalizeRasterNoData(options.sourceNoData ?? sourceGrid.noData),
    outputNoData: normalizeRasterNoData(options.outputNoData ?? targetGrid.noData),
    minimumValidWeight,
    ...(transform === undefined ? {} : { transform }),
  })
}

const modelPoint = (
  grid: NumericRasterGrid,
  column: number,
  row: number,
): readonly [number, number] => {
  const offset = grid.pixelInterpretation === 'area' ? 0.5 : 0
  const x = column + offset
  const y = row + offset
  return Object.freeze([
    grid.affine[0] * x + grid.affine[1] * y + grid.affine[2],
    grid.affine[3] * x + grid.affine[4] * y + grid.affine[5],
  ])
}

const pixelPoint = (
  grid: NumericRasterGrid,
  modelX: number,
  modelY: number,
): readonly [number, number] => {
  const [a, b, c, d, e, f] = grid.affine
  const determinant = a * e - b * d
  const translatedX = modelX - c
  const translatedY = modelY - f
  const offset = grid.pixelInterpretation === 'area' ? 0.5 : 0
  return Object.freeze([
    (e * translatedX - b * translatedY) / determinant - offset,
    (-d * translatedX + a * translatedY) / determinant - offset,
  ])
}

const allocateNumericArray = (sampleType: NumericSampleType, length: number): NumericArray => {
  if (sampleType === 'uint8') return new Uint8Array(length)
  if (sampleType === 'uint16') return new Uint16Array(length)
  if (sampleType === 'uint32') return new Uint32Array(length)
  if (sampleType === 'uint64') return new BigUint64Array(length)
  if (sampleType === 'int64') return new BigInt64Array(length)
  if (sampleType === 'int8') return new Int8Array(length)
  if (sampleType === 'int16') return new Int16Array(length)
  if (sampleType === 'int32') return new Int32Array(length)
  if (sampleType === 'float32') return new Float32Array(length)
  return new Float64Array(length)
}

const writeOutput = (data: NumericArray, index: number, value: number): void => {
  if (data instanceof BigUint64Array || data instanceof BigInt64Array) {
    if (!Number.isSafeInteger(value) || (data instanceof BigUint64Array && value < 0))
      throw invalidInput('Output is not an exact 64-bit integer')
    data[index] = BigInt(value)
    return
  }
  if (
    !(data instanceof Float32Array) &&
    !(data instanceof Float64Array) &&
    !Number.isSafeInteger(value)
  ) {
    throw invalidInput('Integer target grid cannot represent a fractional value')
  }
  if (
    (data instanceof Uint8Array && (value < 0 || value > 0xff)) ||
    (data instanceof Uint16Array && (value < 0 || value > 0xffff)) ||
    (data instanceof Uint32Array && (value < 0 || value > 0xffff_ffff)) ||
    (data instanceof Int8Array && (value < -0x80 || value > 0x7f)) ||
    (data instanceof Int16Array && (value < -0x8000 || value > 0x7fff)) ||
    (data instanceof Int32Array && (value < -0x8000_0000 || value > 0x7fff_ffff))
  ) {
    throw invalidInput('Target-grid output is outside its integer sample type')
  }
  data[index] = value
}

export const resampleRasterTileToGrid = (
  plan: Readonly<RasterTargetGridPlan>,
  source: NumericTile,
  targetRegionValue: Readonly<RasterTileRegion>,
  options: Readonly<{
    readonly transform?: RasterCoordinateTransform
    readonly signal?: AbortSignal
    readonly limits?: RasterOperationLimits
  }> = {},
): NumericTile => {
  if (
    plan.schemaVersion !== 1 ||
    plan.algorithm.id !== rasterResampleAlgorithm.id ||
    plan.algorithm.version !== 1
  ) {
    throw invalidInput('Unsupported target-grid resampling plan')
  }
  const targetRegion = normalizeRasterTileRegion(targetRegionValue, plan.targetGrid)
  assertTileCoversRegion(source, {
    x: source.x,
    y: source.y,
    width: source.width,
    height: source.height,
  })
  normalizeRasterTileRegion(
    { x: source.x, y: source.y, width: source.width, height: source.height },
    plan.sourceGrid,
  )
  if (plan.sourceComponent >= source.componentCount)
    throw invalidInput('Resample component is unavailable')
  if (plan.resampling === 'nearest' && plan.targetGrid.sampleType !== source.sampleType) {
    throw invalidInput(
      'Nearest integer-preserving resampling requires matching source and target types',
    )
  }
  admitRasterAllocation(targetRegion, plan.targetGrid.sampleType, 1, options.limits)
  const transform = options.transform
  if (plan.transform !== undefined) {
    if (transform === undefined)
      throw unsupportedOperation('Required coordinate transform is unavailable')
    const normalized = normalizeTransformDescriptor(transform.descriptor)
    if (
      normalized.id !== plan.transform.id ||
      normalized.version !== plan.transform.version ||
      normalized.accuracy.kind !== plan.transform.accuracy.kind ||
      (normalized.accuracy.kind === 'estimated' &&
        (normalized.accuracy.maximumError !== plan.transform.accuracy.maximumError ||
          normalized.accuracy.unit !== plan.transform.accuracy.unit))
    ) {
      throw invalidInput('Coordinate transform does not match the normalized plan')
    }
  } else if (transform !== undefined) {
    throw invalidInput('Unplanned coordinate transform cannot be used')
  }
  const data = allocateNumericArray(
    plan.targetGrid.sampleType,
    targetRegion.width * targetRegion.height,
  )
  const outputNoData = rasterNoDataNumber(plan.outputNoData)
  if (
    !Number.isFinite(outputNoData) &&
    !(data instanceof Float32Array) &&
    !(data instanceof Float64Array)
  ) {
    throw invalidInput('Integer target grid requires a finite output nodata value')
  }
  let destination = 0
  for (let y = 0; y < targetRegion.height; y += 1) {
    throwIfAborted(options.signal)
    for (let x = 0; x < targetRegion.width; x += 1) {
      const target = modelPoint(plan.targetGrid, targetRegion.x + x, targetRegion.y + y)
      const sourceModel = transform === undefined ? target : transform.inverse(target[0], target[1])
      if (
        sourceModel.length !== 2 ||
        !Number.isFinite(sourceModel[0]) ||
        !Number.isFinite(sourceModel[1])
      ) {
        writeOutput(data, destination, outputNoData)
        destination += 1
        continue
      }
      const sourcePixel = pixelPoint(plan.sourceGrid, sourceModel[0], sourceModel[1])
      const withinGrid =
        sourcePixel[0] >= -0.5 &&
        sourcePixel[1] >= -0.5 &&
        sourcePixel[0] < plan.sourceGrid.width - 0.5 &&
        sourcePixel[1] < plan.sourceGrid.height - 0.5
      if (!withinGrid) {
        writeOutput(data, destination, outputNoData)
        destination += 1
        continue
      }
      assertResampleSourceCoverage(
        source,
        plan.sourceGrid,
        sourcePixel[0],
        sourcePixel[1],
        plan.resampling,
      )
      const value = sampledValue(
        source,
        plan.sourceComponent,
        sourcePixel[0],
        sourcePixel[1],
        plan.resampling,
        plan.sourceNoData,
        plan.minimumValidWeight,
      )
      if (!Number.isFinite(value)) {
        writeOutput(data, destination, outputNoData)
      } else writeOutput(data, destination, value)
      destination += 1
    }
  }
  return Object.freeze({
    x: targetRegion.x,
    y: targetRegion.y,
    width: targetRegion.width,
    height: targetRegion.height,
    sampleType: plan.targetGrid.sampleType,
    componentCount: 1,
    layout: 'interleaved',
    rowStrideElements: targetRegion.width,
    data,
    release() {},
  })
}

export const estimateRasterTargetGridTile = (
  plan: Readonly<RasterTargetGridPlan>,
  targetRegionValue: Readonly<RasterTileRegion>,
  limits: Readonly<RasterOperationLimits> = {},
): { readonly outputBytes: number; readonly peakWorkingBytes: number } => {
  const targetRegion = normalizeRasterTileRegion(targetRegionValue, plan.targetGrid)
  return admitRasterAllocation(targetRegion, plan.targetGrid.sampleType, 1, limits)
}
