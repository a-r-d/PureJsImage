import { invalidInput, limitExceeded, unsupportedOperation } from '../errors.ts'
import type { NumericSampleType, NumericTileLayout } from '../scientific/numeric-tile.ts'
import { canonicalJson } from '../analysis/canonical-json.ts'
import type {
  NumericRasterGrid,
  RasterNoData,
  RasterResampling,
} from '../analysis/raster-contracts.ts'
import { normalizeRasterNoData, numericSampleBytes } from '../analysis/raster-contracts.ts'
import type {
  GeoAffineTransform,
  GeoBounds,
  GeoGridGeometry,
  GeoPixelRegistration,
  GeoSpatialReference,
  GeoWrappedBounds,
} from './contracts.ts'
import {
  calculateGeoWorldBounds,
  invertGeoAffine,
  normalizeGeoSpatialReference,
} from './contracts.ts'

export const geoTargetGridSchemaVersion = 1 as const

export interface GeoTargetBandLayout {
  readonly componentCount: number
  readonly layout: NumericTileLayout
  /** Source component indices when the target retains a source-band identity. */
  readonly sourceBands?: readonly number[]
}

/** One normalized grid contract shared by geo readers and raster operations. */
export interface GeoTargetGrid {
  readonly schemaVersion: 1
  readonly crs: GeoSpatialReference
  readonly width: number
  readonly height: number
  readonly pixelToWorld: GeoAffineTransform
  readonly worldToPixel: GeoAffineTransform
  readonly pixelRegistration: GeoPixelRegistration
  readonly bounds: GeoBounds
  /** Explicit longitude wrapping. It is never inferred from bounds. */
  readonly geographicBounds?: GeoWrappedBounds
  readonly sampleType: NumericSampleType
  readonly noData: RasterNoData
  readonly bandLayout: GeoTargetBandLayout
}

export interface GeoGridLimits {
  readonly maxWidth?: number
  readonly maxHeight?: number
  readonly maxOutputPixels?: number
  readonly maxOutputSamples?: number
  readonly maxOutputBytes?: number
  readonly maxWorkingBytes?: number
}

export interface ResolvedGeoGridLimits {
  readonly maxWidth: number
  readonly maxHeight: number
  readonly maxOutputPixels: number
  readonly maxOutputSamples: number
  readonly maxOutputBytes: number
  readonly maxWorkingBytes: number
}

export const defaultGeoGridLimits: ResolvedGeoGridLimits = Object.freeze({
  maxWidth: 1_000_000,
  maxHeight: 1_000_000,
  maxOutputPixels: 16_777_216,
  maxOutputSamples: 67_108_864,
  maxOutputBytes: 64 * 1_024 * 1_024,
  maxWorkingBytes: 128 * 1_024 * 1_024,
})

const positiveInteger = (value: number | undefined, fallback: number, name: string): number => {
  const result = value ?? fallback
  if (!Number.isSafeInteger(result) || result < 1) {
    throw invalidInput(`${name} must be a positive safe integer`)
  }
  return result
}

export const resolveGeoGridLimits = (value: Readonly<GeoGridLimits> = {}): ResolvedGeoGridLimits =>
  Object.freeze({
    maxWidth: positiveInteger(value.maxWidth, defaultGeoGridLimits.maxWidth, 'maxWidth'),
    maxHeight: positiveInteger(value.maxHeight, defaultGeoGridLimits.maxHeight, 'maxHeight'),
    maxOutputPixels: positiveInteger(
      value.maxOutputPixels,
      defaultGeoGridLimits.maxOutputPixels,
      'maxOutputPixels',
    ),
    maxOutputSamples: positiveInteger(
      value.maxOutputSamples,
      defaultGeoGridLimits.maxOutputSamples,
      'maxOutputSamples',
    ),
    maxOutputBytes: positiveInteger(
      value.maxOutputBytes,
      defaultGeoGridLimits.maxOutputBytes,
      'maxOutputBytes',
    ),
    maxWorkingBytes: positiveInteger(
      value.maxWorkingBytes,
      defaultGeoGridLimits.maxWorkingBytes,
      'maxWorkingBytes',
    ),
  })

const finite = (value: number, name: string): number => {
  if (!Number.isFinite(value)) throw invalidInput(`${name} must be finite`)
  return value
}

const dimension = (value: number, name: string): number => {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw invalidInput(`${name} must be a positive safe integer`)
  }
  return value
}

const normalizedBounds = (value: Readonly<GeoBounds>, name: string): GeoBounds => {
  const result = Object.freeze({
    minX: finite(value.minX, `${name}.minX`),
    minY: finite(value.minY, `${name}.minY`),
    maxX: finite(value.maxX, `${name}.maxX`),
    maxY: finite(value.maxY, `${name}.maxY`),
  })
  if (result.minX > result.maxX || result.minY > result.maxY) {
    throw invalidInput(`${name} must be ordered`)
  }
  return result
}

const sameNumber = (left: number, right: number): boolean =>
  Object.is(left, right) || left === right

const sameBounds = (left: Readonly<GeoBounds>, right: Readonly<GeoBounds>): boolean =>
  sameNumber(left.minX, right.minX) &&
  sameNumber(left.minY, right.minY) &&
  sameNumber(left.maxX, right.maxX) &&
  sameNumber(left.maxY, right.maxY)

const normalizedWrappedBounds = (
  value: Readonly<GeoWrappedBounds> | undefined,
  crs: GeoSpatialReference,
): GeoWrappedBounds | undefined => {
  if (value === undefined) return undefined
  if (crs.coordinateSystemType !== 'geographic') {
    throw invalidInput('Geographic bounds require a geographic CRS')
  }
  const west = finite(value.west, 'geographicBounds.west')
  const east = finite(value.east, 'geographicBounds.east')
  const south = finite(value.south, 'geographicBounds.south')
  const north = finite(value.north, 'geographicBounds.north')
  if (south < -90 || north > 90 || south > north) {
    throw invalidInput('Geographic latitude bounds must be ordered within [-90, 90]')
  }
  if (west < -180 || west > 180 || east < -180 || east > 180) {
    throw invalidInput('Geographic longitude bounds must be within [-180, 180]')
  }
  if (value.crossesAntimeridian ? west <= east : west > east) {
    throw invalidInput('Geographic bounds do not match crossesAntimeridian')
  }
  return Object.freeze({ west, south, east, north, crossesAntimeridian: value.crossesAntimeridian })
}

const normalizeBandLayout = (value: Readonly<GeoTargetBandLayout>): GeoTargetBandLayout => {
  const componentCount = dimension(value.componentCount, 'Geo target componentCount')
  if (value.layout !== 'interleaved' && value.layout !== 'planar') {
    throw invalidInput('Geo target band layout must be interleaved or planar')
  }
  if (value.sourceBands === undefined) {
    return Object.freeze({ componentCount, layout: value.layout })
  }
  if (value.sourceBands.length !== componentCount) {
    throw invalidInput('Geo target sourceBands must match componentCount')
  }
  const seen = new Set<number>()
  const sourceBands = Object.freeze(
    value.sourceBands.map((entry) => {
      if (!Number.isSafeInteger(entry) || entry < 0) {
        throw invalidInput('Geo target sourceBands must contain non-negative safe integers')
      }
      if (seen.has(entry)) throw invalidInput(`Geo target source band ${entry} is repeated`)
      seen.add(entry)
      return entry
    }),
  )
  return Object.freeze({ componentCount, layout: value.layout, sourceBands })
}

const isNumericSampleType = (value: unknown): value is NumericSampleType =>
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

export const normalizeGeoTargetGrid = (value: Readonly<GeoTargetGrid>): GeoTargetGrid => {
  if (value.schemaVersion !== geoTargetGridSchemaVersion) {
    throw invalidInput('Unsupported Geo target-grid schema version')
  }
  const crs = normalizeGeoSpatialReference(value.crs)
  const width = dimension(value.width, 'Geo target width')
  const height = dimension(value.height, 'Geo target height')
  if (value.pixelRegistration === 'unknown') {
    throw invalidInput('Geo target grids require explicit pixel registration')
  }
  if (value.pixelRegistration !== 'pixel-is-area' && value.pixelRegistration !== 'pixel-is-point') {
    throw invalidInput('Unsupported Geo target pixel registration')
  }
  const inverse = invertGeoAffine(value.pixelToWorld)
  if (inverse === undefined) throw invalidInput('Geo target pixelToWorld affine must be invertible')
  if (
    value.worldToPixel.length !== 6 ||
    !value.worldToPixel.every((entry, index) => sameNumber(entry, inverse[index] ?? Number.NaN))
  ) {
    throw invalidInput('Geo target worldToPixel must be the exact inverse of pixelToWorld')
  }
  const bounds = normalizedBounds(value.bounds, 'Geo target bounds')
  const calculated = calculateGeoWorldBounds(
    value.pixelToWorld,
    width,
    height,
    value.pixelRegistration,
  )
  if (!sameBounds(bounds, calculated)) {
    throw invalidInput('Geo target bounds must match the transformed grid corners')
  }
  if (crs.coordinateSystemType === 'geographic' && (bounds.minY < -90 || bounds.maxY > 90)) {
    throw invalidInput('Geographic Geo target bounds exceed latitude limits')
  }
  const geographicBounds = normalizedWrappedBounds(value.geographicBounds, crs)
  if (!isNumericSampleType(value.sampleType)) {
    throw invalidInput('Unsupported Geo target sample type')
  }
  return Object.freeze({
    schemaVersion: geoTargetGridSchemaVersion,
    crs,
    width,
    height,
    pixelToWorld: Object.freeze([
      value.pixelToWorld[0],
      value.pixelToWorld[1],
      value.pixelToWorld[2],
      value.pixelToWorld[3],
      value.pixelToWorld[4],
      value.pixelToWorld[5],
    ] as const),
    worldToPixel: inverse,
    pixelRegistration: value.pixelRegistration,
    bounds,
    ...(geographicBounds === undefined ? {} : { geographicBounds }),
    sampleType: value.sampleType,
    noData: normalizeRasterNoData(value.noData),
    bandLayout: normalizeBandLayout(value.bandLayout),
  })
}

const semanticCrs = (value: Readonly<GeoSpatialReference>): object => {
  const crs = normalizeGeoSpatialReference(value)
  return {
    schemaVersion: crs.schemaVersion,
    coordinateSystemType: crs.coordinateSystemType,
    authority: crs.authority ?? null,
    code: crs.code ?? null,
    name: crs.name ?? null,
    wkt2: crs.wkt2 ?? null,
    projJson: crs.projJson ?? null,
    horizontalUnit: crs.horizontalUnit ?? null,
    vertical: crs.vertical ?? null,
    coordinateEpoch: crs.coordinateEpoch ?? null,
    formalAxes: crs.formalAxes,
    applicationAxes: crs.applicationAxes,
    state: crs.state,
  }
}

export const canonicalGeoSpatialReferenceIdentity = (
  value: Readonly<GeoSpatialReference>,
): string =>
  canonicalJson(semanticCrs(value), { maxDepth: 48, maxValues: 65_536, maxBytes: 1_048_576 })

export const geoSpatialReferencesEqual = (
  left: Readonly<GeoSpatialReference>,
  right: Readonly<GeoSpatialReference>,
): boolean =>
  canonicalGeoSpatialReferenceIdentity(left) === canonicalGeoSpatialReferenceIdentity(right)

export const canonicalizeGeoTargetGrid = (value: Readonly<GeoTargetGrid>): string => {
  const grid = normalizeGeoTargetGrid(value)
  return canonicalJson(
    {
      schemaVersion: grid.schemaVersion,
      crs: semanticCrs(grid.crs),
      width: grid.width,
      height: grid.height,
      pixelToWorld: grid.pixelToWorld,
      worldToPixel: grid.worldToPixel,
      pixelRegistration: grid.pixelRegistration,
      bounds: grid.bounds,
      geographicBounds: grid.geographicBounds ?? null,
      sampleType: grid.sampleType,
      noData: grid.noData,
      bandLayout: grid.bandLayout,
    },
    { maxDepth: 64, maxValues: 100_000, maxBytes: 2_097_152 },
  )
}

export const geoTargetGridsEqual = (
  left: Readonly<GeoTargetGrid>,
  right: Readonly<GeoTargetGrid>,
): boolean => canonicalizeGeoTargetGrid(left) === canonicalizeGeoTargetGrid(right)

export type GeoGridRelationship = 'exact-grid' | 'same-crs-different-grid' | 'different-crs'

export const classifyGeoGridRelationship = (
  left: Readonly<GeoTargetGrid>,
  right: Readonly<GeoTargetGrid>,
): GeoGridRelationship => {
  if (geoTargetGridsEqual(left, right)) return 'exact-grid'
  return geoSpatialReferencesEqual(left.crs, right.crs)
    ? 'same-crs-different-grid'
    : 'different-crs'
}

export const overlappingGeoGridExtent = (
  leftValue: Readonly<GeoTargetGrid>,
  rightValue: Readonly<GeoTargetGrid>,
): GeoBounds | undefined => {
  const left = normalizeGeoTargetGrid(leftValue)
  const right = normalizeGeoTargetGrid(rightValue)
  if (!geoSpatialReferencesEqual(left.crs, right.crs)) {
    throw unsupportedOperation(
      'Grid overlap requires the same CRS or an explicit transformed bound',
    )
  }
  if (left.geographicBounds?.crossesAntimeridian || right.geographicBounds?.crossesAntimeridian) {
    throw unsupportedOperation(
      'Antimeridian-crossing grid overlap requires an explicit split request',
    )
  }
  const result = Object.freeze({
    minX: Math.max(left.bounds.minX, right.bounds.minX),
    minY: Math.max(left.bounds.minY, right.bounds.minY),
    maxX: Math.min(left.bounds.maxX, right.bounds.maxX),
    maxY: Math.min(left.bounds.maxY, right.bounds.maxY),
  })
  return result.minX <= result.maxX && result.minY <= result.maxY ? result : undefined
}

const integerRatio = (value: number, tolerance: number): boolean => {
  if (!Number.isFinite(value) || value <= 0) return false
  const ratio = value >= 1 ? value : 1 / value
  return Math.abs(ratio - Math.round(ratio)) <= tolerance
}

export const areGeoGridsPixelAligned = (
  leftValue: Readonly<GeoTargetGrid>,
  rightValue: Readonly<GeoTargetGrid>,
  tolerance = 0,
): boolean => {
  if (!Number.isFinite(tolerance) || tolerance < 0)
    throw invalidInput('Alignment tolerance is invalid')
  const left = normalizeGeoTargetGrid(leftValue)
  const right = normalizeGeoTargetGrid(rightValue)
  if (
    !geoSpatialReferencesEqual(left.crs, right.crs) ||
    left.pixelRegistration !== right.pixelRegistration
  ) {
    return false
  }
  const [la, lb, , ld, le] = left.pixelToWorld
  const [ra, rb, , rd, re] = right.pixelToWorld
  const xRatio = Math.abs(la) >= Math.abs(ld) ? ra / la : rd / ld
  const yRatio = Math.abs(lb) >= Math.abs(le) ? rb / lb : re / le
  const basisMatches =
    Math.abs(ra - la * xRatio) <= tolerance &&
    Math.abs(rd - ld * xRatio) <= tolerance &&
    Math.abs(rb - lb * yRatio) <= tolerance &&
    Math.abs(re - le * yRatio) <= tolerance
  if (!basisMatches || !integerRatio(xRatio, tolerance) || !integerRatio(yRatio, tolerance))
    return false
  const originX =
    left.worldToPixel[0] * right.pixelToWorld[2] +
    left.worldToPixel[1] * right.pixelToWorld[5] +
    left.worldToPixel[2]
  const originY =
    left.worldToPixel[3] * right.pixelToWorld[2] +
    left.worldToPixel[4] * right.pixelToWorld[5] +
    left.worldToPixel[5]
  return (
    Math.abs(originX - Math.round(originX)) <= tolerance &&
    Math.abs(originY - Math.round(originY)) <= tolerance
  )
}

export const areGeoPyramidLevelsCompatible = (
  base: Readonly<GeoTargetGrid>,
  candidate: Readonly<GeoTargetGrid>,
  tolerance = 0,
): boolean => {
  if (!areGeoGridsPixelAligned(base, candidate, tolerance)) return false
  const normalizedBase = normalizeGeoTargetGrid(base)
  const normalizedCandidate = normalizeGeoTargetGrid(candidate)
  return (
    normalizedCandidate.width <= normalizedBase.width &&
    normalizedCandidate.height <= normalizedBase.height &&
    overlappingGeoGridExtent(normalizedBase, normalizedCandidate) !== undefined
  )
}

export interface GeoOutputDimensions {
  readonly width: number
  readonly height: number
  readonly pixelCount: number
}

export const estimateGeoOutputDimensions = (
  boundsValue: Readonly<GeoBounds>,
  resolution: Readonly<{ readonly x: number; readonly y: number }>,
  registration: GeoPixelRegistration,
  limitsValue: Readonly<GeoGridLimits> = {},
): GeoOutputDimensions => {
  const bounds = normalizedBounds(boundsValue, 'Geo output bounds')
  if (registration !== 'pixel-is-area' && registration !== 'pixel-is-point') {
    throw invalidInput('Output dimension estimation requires explicit pixel registration')
  }
  const resolutionX = finite(resolution.x, 'Geo output X resolution')
  const resolutionY = finite(resolution.y, 'Geo output Y resolution')
  if (resolutionX <= 0 || resolutionY <= 0)
    throw invalidInput('Geo output resolution must be positive')
  const addPoint = registration === 'pixel-is-point' ? 1 : 0
  const width = Math.max(1, Math.ceil((bounds.maxX - bounds.minX) / resolutionX) + addPoint)
  const height = Math.max(1, Math.ceil((bounds.maxY - bounds.minY) / resolutionY) + addPoint)
  const limits = resolveGeoGridLimits(limitsValue)
  if (width > limits.maxWidth || height > limits.maxHeight) {
    throw limitExceeded('Estimated Geo target dimensions exceed width or height limits')
  }
  const pixelCount = width * height
  if (!Number.isSafeInteger(pixelCount) || pixelCount > limits.maxOutputPixels) {
    throw limitExceeded('Estimated Geo target dimensions exceed maxOutputPixels')
  }
  return Object.freeze({ width, height, pixelCount })
}

export interface ProposeGeoTargetGridOptions {
  readonly crs: GeoSpatialReference
  readonly bounds: GeoBounds
  readonly width?: number
  readonly height?: number
  readonly resolution?: { readonly x: number; readonly y: number }
  readonly origin: 'upper-left' | 'upper-right' | 'lower-left' | 'lower-right'
  readonly pixelRegistration: Exclude<GeoPixelRegistration, 'unknown'>
  readonly sampleType: NumericSampleType
  readonly noData: RasterNoData
  readonly bandLayout: GeoTargetBandLayout
  readonly geographicBounds?: GeoWrappedBounds
  readonly limits?: GeoGridLimits
}

export const proposeGeoTargetGrid = (
  options: Readonly<ProposeGeoTargetGridOptions>,
): GeoTargetGrid => {
  const bounds = normalizedBounds(options.bounds, 'Geo target proposal bounds')
  const limits = resolveGeoGridLimits(options.limits)
  let width: number
  let height: number
  if (options.width !== undefined || options.height !== undefined) {
    if (options.width === undefined || options.height === undefined) {
      throw invalidInput('Geo target proposal requires both width and height')
    }
    width = dimension(options.width, 'Geo target proposal width')
    height = dimension(options.height, 'Geo target proposal height')
  } else if (options.resolution !== undefined) {
    const estimated = estimateGeoOutputDimensions(
      bounds,
      options.resolution,
      options.pixelRegistration,
      limits,
    )
    width = estimated.width
    height = estimated.height
  } else {
    throw invalidInput('Geo target proposal requires dimensions or resolution')
  }
  if (width > limits.maxWidth || height > limits.maxHeight) {
    throw limitExceeded('Geo target proposal exceeds width or height limits')
  }
  const pointAdjustment = options.pixelRegistration === 'pixel-is-point' ? 1 : 0
  const xDivisor = width - pointAdjustment
  const yDivisor = height - pointAdjustment
  if (xDivisor < 1 || yDivisor < 1) {
    throw invalidInput(
      'Pixel-is-point target proposals need at least two samples per changing axis',
    )
  }
  const xResolution = (bounds.maxX - bounds.minX) / xDivisor
  const yResolution = (bounds.maxY - bounds.minY) / yDivisor
  if (xResolution <= 0 || yResolution <= 0) {
    throw invalidInput('Geo target proposal bounds must have positive area')
  }
  const fromRight = options.origin === 'upper-right' || options.origin === 'lower-right'
  const fromTop = options.origin === 'upper-left' || options.origin === 'upper-right'
  const pixelToWorld: GeoAffineTransform = Object.freeze([
    fromRight ? -xResolution : xResolution,
    0,
    fromRight ? bounds.maxX : bounds.minX,
    0,
    fromTop ? -yResolution : yResolution,
    fromTop ? bounds.maxY : bounds.minY,
  ])
  const worldToPixel = invertGeoAffine(pixelToWorld)
  if (worldToPixel === undefined)
    throw invalidInput('Geo target proposal produced a singular affine')
  const pixels = width * height
  const samples = pixels * options.bandLayout.componentCount
  const bytes = samples * numericSampleBytes(options.sampleType)
  if (!Number.isSafeInteger(pixels) || pixels > limits.maxOutputPixels) {
    throw limitExceeded('Geo target proposal exceeds maxOutputPixels')
  }
  if (!Number.isSafeInteger(samples) || samples > limits.maxOutputSamples) {
    throw limitExceeded('Geo target proposal exceeds maxOutputSamples')
  }
  if (!Number.isSafeInteger(bytes) || bytes > limits.maxOutputBytes) {
    throw limitExceeded('Geo target proposal exceeds maxOutputBytes')
  }
  return normalizeGeoTargetGrid({
    schemaVersion: geoTargetGridSchemaVersion,
    crs: options.crs,
    width,
    height,
    pixelToWorld,
    worldToPixel,
    pixelRegistration: options.pixelRegistration,
    bounds,
    ...(options.geographicBounds === undefined
      ? {}
      : { geographicBounds: options.geographicBounds }),
    sampleType: options.sampleType,
    noData: options.noData,
    bandLayout: options.bandLayout,
  })
}

export const geoTargetGridFromGeometry = (
  geometry: Readonly<GeoGridGeometry>,
  crs: Readonly<GeoSpatialReference>,
  options: Readonly<{
    readonly sampleType: NumericSampleType
    readonly noData: RasterNoData
    readonly bandLayout: GeoTargetBandLayout
  }>,
): GeoTargetGrid => {
  if (geometry.worldToPixel === undefined) {
    throw unsupportedOperation('Geo target grids require invertible source geometry')
  }
  if (geometry.pixelRegistration === 'unknown') {
    throw unsupportedOperation('Geo target grids require explicit source pixel registration')
  }
  return normalizeGeoTargetGrid({
    schemaVersion: geoTargetGridSchemaVersion,
    crs,
    width: geometry.width,
    height: geometry.height,
    pixelToWorld: geometry.pixelToWorld,
    worldToPixel: geometry.worldToPixel,
    pixelRegistration: geometry.pixelRegistration,
    bounds: geometry.worldBounds,
    ...(geometry.wrappedBounds === undefined ? {} : { geographicBounds: geometry.wrappedBounds }),
    sampleType: options.sampleType,
    noData: options.noData,
    bandLayout: options.bandLayout,
  })
}

export const geoTargetGridToNumericRasterGrid = (
  value: Readonly<GeoTargetGrid>,
  resampling: RasterResampling,
): NumericRasterGrid => {
  const grid = normalizeGeoTargetGrid(value)
  return Object.freeze({
    schemaVersion: 1,
    crs: canonicalGeoSpatialReferenceIdentity(grid.crs),
    width: grid.width,
    height: grid.height,
    affine: grid.pixelToWorld,
    pixelInterpretation: grid.pixelRegistration === 'pixel-is-area' ? 'area' : 'point',
    extent: Object.freeze([
      grid.bounds.minX,
      grid.bounds.minY,
      grid.bounds.maxX,
      grid.bounds.maxY,
    ] as const),
    sampleType: grid.sampleType,
    noData: grid.noData,
    resampling,
  })
}
