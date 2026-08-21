import { invalidInput, limitExceeded } from '../errors.ts'
import type { NumericSampleType, NumericTile } from '../scientific/numeric-tile.ts'
import { validateNumericTile } from '../scientific/numeric-tile.ts'

export const numericRasterPlanSchemaVersion = 1 as const

export type RasterPixelInterpretation = 'area' | 'point'
export type RasterResampling = 'nearest' | 'bilinear'

export type RasterNoData =
  | { readonly kind: 'none' }
  | { readonly kind: 'nan' }
  | { readonly kind: 'value'; readonly value: number }

export interface NumericRasterGrid {
  readonly schemaVersion: 1
  readonly crs: string
  readonly width: number
  readonly height: number
  /** Pixel to model: X = a*x + b*y + c, Y = d*x + e*y + f. */
  readonly affine: readonly [a: number, b: number, c: number, d: number, e: number, f: number]
  readonly pixelInterpretation: RasterPixelInterpretation
  readonly extent: readonly [minimumX: number, minimumY: number, maximumX: number, maximumY: number]
  readonly sampleType: NumericSampleType
  readonly noData: RasterNoData
  readonly resampling: RasterResampling
}

export interface RasterTileRegion {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

export interface RasterOperationLimits {
  readonly maxTilePixels?: number
  readonly maxOutputBytes?: number
  readonly maxWorkingBytes?: number
  readonly maxInputs?: number
  readonly maxExpressionLength?: number
  readonly maxExpressionDepth?: number
  readonly maxExpressionOperations?: number
  readonly maxHistogramBins?: number
  readonly maxLineSamples?: number
}

export interface ResolvedRasterOperationLimits {
  readonly maxTilePixels: number
  readonly maxOutputBytes: number
  readonly maxWorkingBytes: number
  readonly maxInputs: number
  readonly maxExpressionLength: number
  readonly maxExpressionDepth: number
  readonly maxExpressionOperations: number
  readonly maxHistogramBins: number
  readonly maxLineSamples: number
}

export const defaultRasterOperationLimits: ResolvedRasterOperationLimits = Object.freeze({
  maxTilePixels: 16_777_216,
  maxOutputBytes: 64 * 1_024 * 1_024,
  maxWorkingBytes: 128 * 1_024 * 1_024,
  maxInputs: 64,
  maxExpressionLength: 4_096,
  maxExpressionDepth: 32,
  maxExpressionOperations: 1_024,
  maxHistogramBins: 65_536,
  maxLineSamples: 1_000_000,
})

const positiveSafeInteger = (value: number | undefined, fallback: number, name: string): number => {
  if (value === undefined) return fallback
  if (!Number.isSafeInteger(value) || value < 1) {
    throw invalidInput(`${name} must be a positive safe integer`)
  }
  return value
}

export const resolveRasterOperationLimits = (
  limits: Readonly<RasterOperationLimits> = {},
): ResolvedRasterOperationLimits =>
  Object.freeze({
    maxTilePixels: positiveSafeInteger(
      limits.maxTilePixels,
      defaultRasterOperationLimits.maxTilePixels,
      'maxTilePixels',
    ),
    maxOutputBytes: positiveSafeInteger(
      limits.maxOutputBytes,
      defaultRasterOperationLimits.maxOutputBytes,
      'maxOutputBytes',
    ),
    maxWorkingBytes: positiveSafeInteger(
      limits.maxWorkingBytes,
      defaultRasterOperationLimits.maxWorkingBytes,
      'maxWorkingBytes',
    ),
    maxInputs: positiveSafeInteger(
      limits.maxInputs,
      defaultRasterOperationLimits.maxInputs,
      'maxInputs',
    ),
    maxExpressionLength: positiveSafeInteger(
      limits.maxExpressionLength,
      defaultRasterOperationLimits.maxExpressionLength,
      'maxExpressionLength',
    ),
    maxExpressionDepth: positiveSafeInteger(
      limits.maxExpressionDepth,
      defaultRasterOperationLimits.maxExpressionDepth,
      'maxExpressionDepth',
    ),
    maxExpressionOperations: positiveSafeInteger(
      limits.maxExpressionOperations,
      defaultRasterOperationLimits.maxExpressionOperations,
      'maxExpressionOperations',
    ),
    maxHistogramBins: positiveSafeInteger(
      limits.maxHistogramBins,
      defaultRasterOperationLimits.maxHistogramBins,
      'maxHistogramBins',
    ),
    maxLineSamples: positiveSafeInteger(
      limits.maxLineSamples,
      defaultRasterOperationLimits.maxLineSamples,
      'maxLineSamples',
    ),
  })

const finite = (value: number, name: string): number => {
  if (!Number.isFinite(value)) throw invalidInput(`${name} must be finite`)
  return value
}

const boundedString = (value: string, name: string): string => {
  const result = value.trim()
  if (result.length < 1 || result.length > 4_096) {
    throw invalidInput(`${name} must be a bounded non-empty string`)
  }
  return result
}

export const normalizeRasterNoData = (value: Readonly<RasterNoData>): RasterNoData => {
  if (value.kind === 'none' || value.kind === 'nan') return Object.freeze({ kind: value.kind })
  if (value.kind !== 'value') throw invalidInput('Unsupported raster nodata policy')
  return Object.freeze({ kind: 'value', value: finite(value.value, 'nodata value') })
}

const isNumericSampleType = (value: string): value is NumericSampleType =>
  value === 'uint8' ||
  value === 'uint16' ||
  value === 'uint32' ||
  value === 'uint64' ||
  value === 'int8' ||
  value === 'int16' ||
  value === 'int32' ||
  value === 'int64' ||
  value === 'float32' ||
  value === 'float64'

export const normalizeNumericRasterGrid = (
  value: Readonly<NumericRasterGrid>,
): NumericRasterGrid => {
  if (value.schemaVersion !== numericRasterPlanSchemaVersion) {
    throw invalidInput('Unsupported numeric raster grid schema version')
  }
  if (!Number.isSafeInteger(value.width) || value.width < 1) {
    throw invalidInput('Raster grid width must be a positive safe integer')
  }
  if (!Number.isSafeInteger(value.height) || value.height < 1) {
    throw invalidInput('Raster grid height must be a positive safe integer')
  }
  const affine = value.affine.map((entry, index) => finite(entry, `affine[${index}]`))
  if (affine.length !== 6) throw invalidInput('Raster grid affine must contain six values')
  const determinant = (affine[0] ?? 0) * (affine[4] ?? 0) - (affine[1] ?? 0) * (affine[3] ?? 0)
  if (determinant === 0 || !Number.isFinite(determinant)) {
    throw invalidInput('Raster grid affine must be invertible')
  }
  const extent = value.extent.map((entry, index) => finite(entry, `extent[${index}]`))
  if (
    extent.length !== 4 ||
    (extent[0] ?? 0) > (extent[2] ?? 0) ||
    (extent[1] ?? 0) > (extent[3] ?? 0)
  ) {
    throw invalidInput('Raster grid extent must be ordered')
  }
  if (value.pixelInterpretation !== 'area' && value.pixelInterpretation !== 'point') {
    throw invalidInput('Unsupported raster pixel interpretation')
  }
  if (value.resampling !== 'nearest' && value.resampling !== 'bilinear') {
    throw invalidInput('Unsupported raster resampling method')
  }
  if (!isNumericSampleType(value.sampleType)) throw invalidInput('Unsupported raster sample type')
  return Object.freeze({
    schemaVersion: numericRasterPlanSchemaVersion,
    crs: boundedString(value.crs, 'CRS'),
    width: value.width,
    height: value.height,
    affine: Object.freeze([
      affine[0] ?? 0,
      affine[1] ?? 0,
      affine[2] ?? 0,
      affine[3] ?? 0,
      affine[4] ?? 0,
      affine[5] ?? 0,
    ] as const),
    pixelInterpretation: value.pixelInterpretation,
    extent: Object.freeze([
      extent[0] ?? 0,
      extent[1] ?? 0,
      extent[2] ?? 0,
      extent[3] ?? 0,
    ] as const),
    sampleType: value.sampleType,
    noData: normalizeRasterNoData(value.noData),
    resampling: value.resampling,
  })
}

const sameNumber = (left: number, right: number): boolean =>
  left === right || (Number.isNaN(left) && Number.isNaN(right))

export const numericRasterGridsEqual = (
  leftValue: Readonly<NumericRasterGrid>,
  rightValue: Readonly<NumericRasterGrid>,
): boolean => {
  const left = normalizeNumericRasterGrid(leftValue)
  const right = normalizeNumericRasterGrid(rightValue)
  return (
    left.crs === right.crs &&
    left.width === right.width &&
    left.height === right.height &&
    left.pixelInterpretation === right.pixelInterpretation &&
    left.affine.every((entry, index) => sameNumber(entry, right.affine[index] ?? Number.NaN))
  )
}

export const normalizeRasterTileRegion = (
  value: Readonly<RasterTileRegion>,
  grid?: Readonly<Pick<NumericRasterGrid, 'width' | 'height'>>,
): RasterTileRegion => {
  if (
    !Number.isSafeInteger(value.x) ||
    !Number.isSafeInteger(value.y) ||
    !Number.isSafeInteger(value.width) ||
    !Number.isSafeInteger(value.height) ||
    value.x < 0 ||
    value.y < 0 ||
    value.width < 1 ||
    value.height < 1 ||
    !Number.isSafeInteger(value.x + value.width) ||
    !Number.isSafeInteger(value.y + value.height)
  ) {
    throw invalidInput('Raster tile region is invalid')
  }
  if (
    grid !== undefined &&
    (value.x + value.width > grid.width || value.y + value.height > grid.height)
  ) {
    throw invalidInput('Raster tile region is outside the grid')
  }
  return Object.freeze({ x: value.x, y: value.y, width: value.width, height: value.height })
}

export const numericSampleBytes = (sampleType: NumericSampleType): number =>
  sampleType === 'uint8' || sampleType === 'int8'
    ? 1
    : sampleType === 'uint16' || sampleType === 'int16'
      ? 2
      : sampleType === 'float64' || sampleType === 'uint64' || sampleType === 'int64'
        ? 8
        : 4

export const admitRasterAllocation = (
  region: Readonly<RasterTileRegion>,
  sampleType: NumericSampleType,
  componentCount: number,
  limitsValue: Readonly<RasterOperationLimits> = {},
  additionalWorkingBytes = 0,
): { readonly outputBytes: number; readonly peakWorkingBytes: number } => {
  const limits = resolveRasterOperationLimits(limitsValue)
  if (!Number.isSafeInteger(componentCount) || componentCount < 1) {
    throw invalidInput('Raster output component count must be positive')
  }
  const pixels = region.width * region.height
  if (!Number.isSafeInteger(pixels) || pixels > limits.maxTilePixels) {
    throw limitExceeded('Raster tile exceeds maxTilePixels')
  }
  const outputBytes = pixels * componentCount * numericSampleBytes(sampleType)
  if (!Number.isSafeInteger(outputBytes) || outputBytes > limits.maxOutputBytes) {
    throw limitExceeded('Raster tile exceeds maxOutputBytes')
  }
  const peakWorkingBytes = outputBytes + additionalWorkingBytes
  if (!Number.isSafeInteger(peakWorkingBytes) || peakWorkingBytes > limits.maxWorkingBytes) {
    throw limitExceeded('Raster operation exceeds maxWorkingBytes')
  }
  return Object.freeze({ outputBytes, peakWorkingBytes })
}

export const assertTileCoversRegion = (
  tile: Readonly<NumericTile>,
  regionValue: Readonly<RasterTileRegion>,
): RasterTileRegion => {
  validateNumericTile(tile)
  const region = normalizeRasterTileRegion(regionValue)
  if (
    region.x < tile.x ||
    region.y < tile.y ||
    region.x + region.width > tile.x + tile.width ||
    region.y + region.height > tile.y + tile.height
  ) {
    throw invalidInput('Numeric tile does not cover the requested raster region')
  }
  return region
}

export const rasterSampleIsNoData = (value: number, noData: Readonly<RasterNoData>): boolean => {
  if (!Number.isFinite(value)) return noData.kind === 'nan' || Number.isNaN(value)
  return noData.kind === 'value' && value === noData.value
}

export const rasterNoDataNumber = (noData: Readonly<RasterNoData>): number =>
  noData.kind === 'value' ? noData.value : Number.NaN
