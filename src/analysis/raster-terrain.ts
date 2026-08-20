import { throwIfAborted } from '../abort.ts'
import { invalidInput } from '../errors.ts'
import type { NumericTile } from '../scientific/numeric-tile.ts'
import { numericTileSampleOffset } from '../scientific/numeric-tile.ts'
import {
  admitRasterAllocation,
  assertTileCoversRegion,
  normalizeRasterNoData,
  normalizeRasterTileRegion,
  numericRasterPlanSchemaVersion,
  rasterNoDataNumber,
  rasterSampleIsNoData,
  type RasterNoData,
  type RasterOperationLimits,
  type RasterTileRegion,
} from './raster-contracts.ts'

export const rasterTerrainAlgorithm = Object.freeze({
  id: 'purejsimage.raster.terrain',
  version: 1,
})

export type RasterLengthUnit =
  | { readonly kind: 'metre' }
  | { readonly kind: 'international-foot' }
  | { readonly kind: 'us-survey-foot' }
  | { readonly kind: 'custom'; readonly name: string; readonly metresPerUnit: number }

export type RasterTerrainOperation = 'hillshade' | 'slope' | 'aspect'
export type RasterSlopeUnit = 'degrees' | 'radians' | 'percent'

export interface RasterTerrainPlan {
  readonly schemaVersion: 1
  readonly algorithm: typeof rasterTerrainAlgorithm
  readonly operation: RasterTerrainOperation
  readonly component: number
  readonly sourceWidth: number
  readonly sourceHeight: number
  readonly xSpacing: number
  readonly ySpacing: number
  readonly xUnit: RasterLengthUnit
  readonly yUnit: RasterLengthUnit
  readonly verticalUnit: RasterLengthUnit
  /** Direction in model space as raster row indices increase. */
  readonly rowDirection: 'north' | 'south'
  readonly edge: 'clamp' | 'nodata'
  readonly inputNoData: RasterNoData
  readonly outputNoData: RasterNoData
  readonly slopeUnit: RasterSlopeUnit
  /** Degrees clockwise from north. */
  readonly azimuthDegrees: number
  /** Degrees above the horizon. */
  readonly altitudeDegrees: number
}

export interface CreateRasterTerrainPlanOptions {
  readonly operation: RasterTerrainOperation
  readonly component?: number
  readonly sourceWidth: number
  readonly sourceHeight: number
  readonly xSpacing: number
  readonly ySpacing: number
  readonly xUnit: RasterLengthUnit
  readonly yUnit: RasterLengthUnit
  readonly verticalUnit: RasterLengthUnit
  readonly rowDirection: 'north' | 'south'
  readonly edge?: 'clamp' | 'nodata'
  readonly inputNoData?: RasterNoData
  readonly outputNoData?: RasterNoData
  readonly slopeUnit?: RasterSlopeUnit
  readonly azimuthDegrees?: number
  readonly altitudeDegrees?: number
}

const normalizeLengthUnit = (unit: Readonly<RasterLengthUnit>, name: string): RasterLengthUnit => {
  if (
    unit.kind === 'metre' ||
    unit.kind === 'international-foot' ||
    unit.kind === 'us-survey-foot'
  ) {
    return Object.freeze({ kind: unit.kind })
  }
  if (unit.kind !== 'custom') throw invalidInput(`Unsupported ${name} unit`)
  const unitName = unit.name.trim()
  if (unitName.length < 1 || unitName.length > 256)
    throw invalidInput(`${name} unit name is invalid`)
  if (!Number.isFinite(unit.metresPerUnit) || unit.metresPerUnit <= 0) {
    throw invalidInput(`${name} metresPerUnit must be positive and finite`)
  }
  return Object.freeze({ kind: 'custom', name: unitName, metresPerUnit: unit.metresPerUnit })
}

export const rasterLengthUnitMetres = (unit: Readonly<RasterLengthUnit>): number => {
  if (unit.kind === 'metre') return 1
  if (unit.kind === 'international-foot') return 0.3048
  if (unit.kind === 'us-survey-foot') return 1200 / 3937
  const normalized = normalizeLengthUnit(unit, 'length')
  if (normalized.kind !== 'custom') throw invalidInput('Custom length unit normalization failed')
  return normalized.metresPerUnit
}

const positiveFinite = (value: number, name: string): number => {
  if (!Number.isFinite(value) || value <= 0)
    throw invalidInput(`${name} must be positive and finite`)
  return value
}

const dimension = (value: number, name: string): number => {
  if (!Number.isSafeInteger(value) || value < 1) throw invalidInput(`${name} must be positive`)
  return value
}

export const createRasterTerrainPlan = (
  options: Readonly<CreateRasterTerrainPlanOptions>,
): RasterTerrainPlan => {
  if (
    options.operation !== 'hillshade' &&
    options.operation !== 'slope' &&
    options.operation !== 'aspect'
  ) {
    throw invalidInput('Unsupported terrain operation')
  }
  const component = options.component ?? 0
  if (!Number.isSafeInteger(component) || component < 0) {
    throw invalidInput('Terrain component must be a non-negative safe integer')
  }
  const slopeUnit = options.slopeUnit ?? 'degrees'
  if (slopeUnit !== 'degrees' && slopeUnit !== 'radians' && slopeUnit !== 'percent') {
    throw invalidInput('Unsupported slope output unit')
  }
  const azimuthDegrees = options.azimuthDegrees ?? 315
  const altitudeDegrees = options.altitudeDegrees ?? 45
  if (!Number.isFinite(azimuthDegrees) || azimuthDegrees < 0 || azimuthDegrees >= 360) {
    throw invalidInput('Hillshade azimuth must be in [0, 360) degrees clockwise from north')
  }
  if (!Number.isFinite(altitudeDegrees) || altitudeDegrees < 0 || altitudeDegrees > 90) {
    throw invalidInput('Hillshade altitude must be in [0, 90] degrees above the horizon')
  }
  if (options.rowDirection !== 'north' && options.rowDirection !== 'south') {
    throw invalidInput('Terrain row direction must be north or south')
  }
  const edge = options.edge ?? 'clamp'
  if (edge !== 'clamp' && edge !== 'nodata') throw invalidInput('Unsupported terrain edge policy')
  return Object.freeze({
    schemaVersion: numericRasterPlanSchemaVersion,
    algorithm: rasterTerrainAlgorithm,
    operation: options.operation,
    component,
    sourceWidth: dimension(options.sourceWidth, 'sourceWidth'),
    sourceHeight: dimension(options.sourceHeight, 'sourceHeight'),
    xSpacing: positiveFinite(options.xSpacing, 'xSpacing'),
    ySpacing: positiveFinite(options.ySpacing, 'ySpacing'),
    xUnit: normalizeLengthUnit(options.xUnit, 'horizontal X'),
    yUnit: normalizeLengthUnit(options.yUnit, 'horizontal Y'),
    verticalUnit: normalizeLengthUnit(options.verticalUnit, 'vertical'),
    rowDirection: options.rowDirection,
    edge,
    inputNoData: normalizeRasterNoData(options.inputNoData ?? { kind: 'none' }),
    outputNoData: normalizeRasterNoData(options.outputNoData ?? { kind: 'nan' }),
    slopeUnit,
    azimuthDegrees,
    altitudeDegrees,
  })
}

const tileNumber = (tile: NumericTile, x: number, y: number, component: number): number => {
  const value = tile.data[numericTileSampleOffset(tile, x, y, component)]
  if (typeof value === 'bigint') {
    if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw invalidInput('Terrain uint64 sample exceeds exact numeric conversion')
    }
    return Number(value)
  }
  return value ?? Number.NaN
}

const normalizedAzimuth = (east: number, north: number): number => {
  const degrees = (Math.atan2(east, north) * 180) / Math.PI
  return (degrees + 360) % 360
}

export const evaluateRasterTerrainTile = (
  plan: Readonly<RasterTerrainPlan>,
  source: NumericTile,
  outputRegionValue: Readonly<RasterTileRegion>,
  options: Readonly<{
    readonly signal?: AbortSignal
    readonly limits?: RasterOperationLimits
  }> = {},
): NumericTile => {
  if (
    plan.schemaVersion !== 1 ||
    plan.algorithm.id !== rasterTerrainAlgorithm.id ||
    plan.algorithm.version !== 1
  ) {
    throw invalidInput('Unsupported raster terrain plan')
  }
  const outputRegion = normalizeRasterTileRegion(outputRegionValue, {
    width: plan.sourceWidth,
    height: plan.sourceHeight,
  })
  assertTileCoversRegion(source, outputRegion)
  if (plan.component >= source.componentCount)
    throw invalidInput('Terrain component is unavailable')
  admitRasterAllocation(outputRegion, 'float32', 1, options.limits)

  const needsLeft = outputRegion.x > 0
  const needsTop = outputRegion.y > 0
  const needsRight = outputRegion.x + outputRegion.width < plan.sourceWidth
  const needsBottom = outputRegion.y + outputRegion.height < plan.sourceHeight
  if (
    (needsLeft && source.x > outputRegion.x - 1) ||
    (needsTop && source.y > outputRegion.y - 1) ||
    (needsRight && source.x + source.width < outputRegion.x + outputRegion.width + 1) ||
    (needsBottom && source.y + source.height < outputRegion.y + outputRegion.height + 1)
  ) {
    throw invalidInput('Terrain source tile is missing the required one-pixel halo')
  }

  const output = new Float32Array(outputRegion.width * outputRegion.height)
  const outputNoData = rasterNoDataNumber(plan.outputNoData)
  const xSpacingMetres = plan.xSpacing * rasterLengthUnitMetres(plan.xUnit)
  const ySpacingMetres = plan.ySpacing * rasterLengthUnitMetres(plan.yUnit)
  const verticalMetres = rasterLengthUnitMetres(plan.verticalUnit)
  const rowNorthSign = plan.rowDirection === 'north' ? 1 : -1
  const azimuth = (plan.azimuthDegrees * Math.PI) / 180
  const altitude = (plan.altitudeDegrees * Math.PI) / 180
  const sunEast = Math.cos(altitude) * Math.sin(azimuth)
  const sunNorth = Math.cos(altitude) * Math.cos(azimuth)
  const sunUp = Math.sin(altitude)

  const sample = (globalX: number, globalY: number, center: number): number => {
    if (globalX < 0 || globalY < 0 || globalX >= plan.sourceWidth || globalY >= plan.sourceHeight) {
      return plan.edge === 'clamp' ? center : Number.NaN
    }
    const value = tileNumber(source, globalX - source.x, globalY - source.y, plan.component)
    // A missing neighbor is replaced by the center. This prevents a nodata sentinel from
    // contaminating adjacent derivatives while retaining a deterministic local kernel.
    return rasterSampleIsNoData(value, plan.inputNoData) || !Number.isFinite(value) ? center : value
  }

  let destination = 0
  for (let localY = 0; localY < outputRegion.height; localY += 1) {
    throwIfAborted(options.signal)
    const globalY = outputRegion.y + localY
    for (let localX = 0; localX < outputRegion.width; localX += 1) {
      const globalX = outputRegion.x + localX
      const center = tileNumber(source, globalX - source.x, globalY - source.y, plan.component)
      if (rasterSampleIsNoData(center, plan.inputNoData) || !Number.isFinite(center)) {
        output[destination] = outputNoData
        destination += 1
        continue
      }
      const northwest = sample(globalX - 1, globalY - 1, center)
      const north = sample(globalX, globalY - 1, center)
      const northeast = sample(globalX + 1, globalY - 1, center)
      const west = sample(globalX - 1, globalY, center)
      const east = sample(globalX + 1, globalY, center)
      const southwest = sample(globalX - 1, globalY + 1, center)
      const south = sample(globalX, globalY + 1, center)
      const southeast = sample(globalX + 1, globalY + 1, center)
      if (
        !Number.isFinite(northwest) ||
        !Number.isFinite(north) ||
        !Number.isFinite(northeast) ||
        !Number.isFinite(west) ||
        !Number.isFinite(east) ||
        !Number.isFinite(southwest) ||
        !Number.isFinite(south) ||
        !Number.isFinite(southeast)
      ) {
        output[destination] = outputNoData
        destination += 1
        continue
      }
      const dzEast =
        (((northeast + 2 * east + southeast - northwest - 2 * west - southwest) / 8) *
          verticalMetres) /
        xSpacingMetres
      const dzRows =
        (((southwest + 2 * south + southeast - northwest - 2 * north - northeast) / 8) *
          verticalMetres) /
        ySpacingMetres
      const dzNorth = dzRows * rowNorthSign
      if (plan.operation === 'slope') {
        const radians = Math.atan(Math.hypot(dzEast, dzNorth))
        output[destination] =
          plan.slopeUnit === 'radians'
            ? radians
            : plan.slopeUnit === 'percent'
              ? Math.tan(radians) * 100
              : (radians * 180) / Math.PI
      } else if (plan.operation === 'aspect') {
        output[destination] =
          dzEast === 0 && dzNorth === 0 ? outputNoData : normalizedAzimuth(-dzEast, -dzNorth)
      } else {
        const length = Math.hypot(dzEast, dzNorth, 1)
        const normalEast = -dzEast / length
        const normalNorth = -dzNorth / length
        const normalUp = 1 / length
        const illumination = normalEast * sunEast + normalNorth * sunNorth + normalUp * sunUp
        output[destination] = Math.max(0, Math.min(255, 255 * illumination))
      }
      destination += 1
    }
  }
  return Object.freeze({
    x: outputRegion.x,
    y: outputRegion.y,
    width: outputRegion.width,
    height: outputRegion.height,
    sampleType: 'float32',
    componentCount: 1,
    layout: 'interleaved',
    rowStrideElements: outputRegion.width,
    data: output,
    release() {},
  })
}
