import { invalidInput, limitExceeded } from '../errors.ts'
import type { RasterSampleType } from '../raster.ts'
import type {
  ScientificDataset,
  ScientificMetadataObject,
  ScientificMetadataValue,
  ScientificPlaneReadRequest,
} from '../scientific/dataset.ts'
import { normalizeScientificMetadataObject } from '../scientific/dataset.ts'
import type { NumericSampleType, NumericTile } from '../scientific/numeric-tile.ts'

export const geoRasterSchemaVersion = 1 as const

export type GeoMetadataValue = ScientificMetadataValue
export type GeoMetadataObject = ScientificMetadataObject

export type GeoAffineTransform = readonly [
  a: number,
  b: number,
  c: number,
  d: number,
  e: number,
  f: number,
]

export interface GeoBounds {
  readonly minX: number
  readonly minY: number
  readonly maxX: number
  readonly maxY: number
}

export interface GeoWrappedBounds {
  readonly west: number
  readonly south: number
  readonly east: number
  readonly north: number
  readonly crossesAntimeridian: boolean
}

export type GeoDiagnosticSeverity = 'info' | 'warning' | 'error'

export type GeoDiagnosticCode =
  | 'unknown-crs'
  | 'incomplete-crs'
  | 'unknown-pixel-registration'
  | 'non-invertible-affine'
  | 'source-bounds-differ'
  | 'scientific-contract-loss'
  | 'scientific-dataset-id-missing'
  | 'scientific-geo-evidence-missing'
  | 'scientific-spatial-plane-unavailable'
  | 'scientific-spatial-axes-ambiguous'
  | 'scientific-spatial-reference-incomplete'
  | 'geotiff-inconsistent-tiepoint'
  | 'geotiff-unsupported-gcp-warp'
  | 'geotiff-unsupported-projective-transform'
  | 'geotiff-inconsistent-overview'
  | 'geozarr-convention'
  | 'geozarr-inconsistent-level'
  | 'ascii-grid-sequential-read'
  | 'netcdf-irregular-rectilinear-grid'
  | 'netcdf-curvilinear-grid'
  | 'netcdf-unsupported-grid-mapping'
  | 'netcdf-unsupported-calendar'

export interface GeoDiagnostic {
  readonly severity: GeoDiagnosticSeverity
  readonly code: GeoDiagnosticCode
  readonly message: string
  readonly path?: string
  readonly metadata?: GeoMetadataObject
}

export type GeoCoordinateSystemType =
  | 'projected'
  | 'geographic'
  | 'geocentric'
  | 'vertical'
  | 'compound'
  | 'engineering'
  | 'parametric'
  | 'temporal'
  | 'unknown'

export interface GeoUnitDescriptor {
  readonly name: string
  readonly symbol?: string
  readonly conversionToSI?: number
}

export interface GeoCrsAxisDescriptor {
  readonly name: string
  readonly abbreviation?: string
  readonly direction: string
  readonly unit?: GeoUnitDescriptor
  /** Zero-based order in the formal CRS definition. */
  readonly order: number
}

export interface GeoApplicationAxisDescriptor {
  readonly name: string
  /** Zero-based link to formalAxes when the mapping is known. */
  readonly formalAxisIndex?: number
}

export interface GeoVerticalReference {
  readonly authority?: string
  readonly code?: number | string
  readonly name?: string
  readonly wkt2?: string
  readonly unit?: GeoUnitDescriptor
}

export type GeoCrsEvidenceKind = 'embedded' | 'sidecar' | 'derived' | 'user-supplied' | 'citation'

export interface GeoCrsEvidence {
  readonly kind: GeoCrsEvidenceKind
  readonly sourceId: string
  readonly locator: string
  readonly citation?: string
  readonly metadata?: GeoMetadataObject
}

export type GeoCrsState = 'complete' | 'incomplete' | 'unknown'

export interface GeoSpatialReference {
  readonly schemaVersion: 1
  readonly coordinateSystemType: GeoCoordinateSystemType
  readonly authority?: string
  readonly code?: number | string
  readonly name?: string
  readonly wkt2?: string
  readonly projJson?: GeoMetadataObject
  readonly horizontalUnit?: GeoUnitDescriptor
  readonly vertical?: GeoVerticalReference
  readonly coordinateEpoch?: number
  readonly formalAxes: readonly GeoCrsAxisDescriptor[]
  /** Application world coordinates always use these explicit X and Y roles. */
  readonly applicationAxes: {
    readonly x: GeoApplicationAxisDescriptor
    readonly y: GeoApplicationAxisDescriptor
  }
  readonly evidence: readonly GeoCrsEvidence[]
  readonly state: GeoCrsState
  readonly confidence?: number
  readonly diagnostics: readonly GeoDiagnostic[]
}

export type GeoPixelRegistration = 'pixel-is-area' | 'pixel-is-point' | 'unknown'

export type GeoNoDataValue = number | string

export type GeoNoData =
  | { readonly kind: 'none' }
  | { readonly kind: 'scalar'; readonly value: GeoNoDataValue }
  | { readonly kind: 'components'; readonly values: readonly GeoNoDataValue[] }

export interface GeoSpatialDimension {
  readonly id: string
  readonly name: string
  readonly dimensionIndex: number
}

export interface GeoGridGeometry {
  readonly schemaVersion: 1
  readonly width: number
  readonly height: number
  readonly spatialDimensions: {
    readonly x: GeoSpatialDimension
    readonly y: GeoSpatialDimension
  }
  readonly pixelToWorld: GeoAffineTransform
  readonly worldToPixel?: GeoAffineTransform
  readonly worldBounds: GeoBounds
  readonly pixelRegistration: GeoPixelRegistration
  readonly noData: GeoNoData
  readonly wrappedBounds?: GeoWrappedBounds
  readonly warnings: readonly GeoDiagnostic[]
}

export interface CreateGeoGridGeometryOptions {
  readonly width: number
  readonly height: number
  readonly spatialDimensions: GeoGridGeometry['spatialDimensions']
  readonly pixelToWorld: GeoAffineTransform
  readonly pixelRegistration: GeoPixelRegistration
  readonly noData?: GeoNoData
  readonly wrappedBounds?: GeoWrappedBounds
  readonly warnings?: readonly GeoDiagnostic[]
}

export interface GeoNominalResolution {
  readonly x: number
  readonly y: number
  readonly unit?: string
}

export interface GeoDownsampleRelationship {
  readonly x: number
  readonly y: number
}

export type GeoStorageOrganization = 'contiguous' | 'stripped' | 'tiled' | 'chunked' | 'unknown'

export interface GeoStorageSummary {
  readonly organization: GeoStorageOrganization
  readonly chunkShape?: readonly number[]
  readonly compression?: string
  readonly byteOrder?: 'little-endian' | 'big-endian' | 'not-applicable' | 'unknown'
  readonly metadata?: GeoMetadataObject
}

export interface GeoRasterLevel {
  readonly id: string
  readonly arrayPath?: string
  readonly sourcePath?: string
  readonly sourceResolutionLevel: number
  readonly sourceOrder: number
  readonly width: number
  readonly height: number
  readonly geometry: GeoGridGeometry
  readonly nominalResolution?: GeoNominalResolution
  readonly downsample?: GeoDownsampleRelationship
  readonly storage: GeoStorageSummary
}

export type GeoColorInterpretation =
  | 'undefined'
  | 'gray'
  | 'red'
  | 'green'
  | 'blue'
  | 'alpha'
  | 'palette'
  | 'nir'
  | 'swir'
  | 'thermal'
  | 'elevation'
  | 'mask'
  | 'other'

export interface GeoWavelength {
  readonly center?: number
  readonly min?: number
  readonly max?: number
  readonly unit: string
}

export interface GeoCategory {
  readonly value: number | string
  readonly label: string
  readonly color?: string
  readonly metadata?: GeoMetadataObject
}

export interface GeoBandDescriptor {
  readonly sourceComponentIndex: number
  readonly name: string
  readonly commonName?: string
  readonly description?: string
  readonly colorInterpretation: GeoColorInterpretation
  readonly wavelength?: GeoWavelength
  readonly unit?: string
  readonly scale?: number
  readonly offset?: number
  readonly noData?: GeoNoDataValue
  readonly validRange?: readonly [minimum: GeoNoDataValue, maximum: GeoNoDataValue]
  readonly dataType: RasterSampleType
  readonly categorical: boolean
  readonly categories?: readonly GeoCategory[]
}

export type GeoAxisKind = 'band' | 'time' | 'vertical' | 'depth' | 'ensemble' | 'scenario' | 'other'

export type GeoAxisCoordinates =
  | { readonly kind: 'index' }
  | { readonly kind: 'linear'; readonly origin: number; readonly step: number }
  | { readonly kind: 'values'; readonly values: readonly (number | string)[] }
  | { readonly kind: 'lazy'; readonly valueType: 'number' | 'string' }

export interface GeoAxisDescriptor {
  readonly id: string
  readonly name?: string
  readonly kind: GeoAxisKind
  readonly dimensionIndex: number
  readonly length: number
  readonly unit?: string
  readonly coordinates: GeoAxisCoordinates
  readonly metadata?: GeoMetadataObject
}

export type GeoDimensionKind = 'spatial-x' | 'spatial-y' | 'non-spatial'

export interface GeoDimensionDescriptor {
  readonly id: string
  readonly name?: string
  readonly index: number
  readonly length: number
  readonly kind: GeoDimensionKind
}

export interface GeoRasterCapabilities {
  readonly pixelRegionReads: boolean
  readonly worldRegionReads: boolean
  readonly resolutionLevels: boolean
  readonly axisCoordinateReads: boolean
  readonly bandSelection: boolean
}

export interface GeoSourceFormat {
  readonly id: string
  readonly name?: string
  readonly version?: string
}

export interface GeoRasterDescriptor {
  readonly schemaVersion: 1
  readonly id: string
  readonly title?: string
  readonly shape: readonly number[]
  readonly dimensions: readonly GeoDimensionDescriptor[]
  readonly spatialDimensions: {
    readonly x: GeoSpatialDimension
    readonly y: GeoSpatialDimension
  }
  readonly axes: readonly GeoAxisDescriptor[]
  readonly sampleType: RasterSampleType
  readonly bands: readonly GeoBandDescriptor[]
  readonly levels: readonly GeoRasterLevel[]
  readonly primaryLevelId: string
  readonly spatialReference: GeoSpatialReference
  readonly grid: GeoGridGeometry
  readonly capabilities: GeoRasterCapabilities
  readonly sourceFormat: GeoSourceFormat
  readonly formatEvidence?: GeoMetadataObject
  readonly diagnostics: readonly GeoDiagnostic[]
}

export interface GeoAxisIndex {
  readonly axisId: string
  readonly index: number
}

export type GeoDimensionSelection =
  | { readonly kind: 'index'; readonly axisId: string; readonly index: number }
  | {
      readonly kind: 'range'
      readonly axisId: string
      readonly start: number
      readonly length: number
    }

export interface GeoRasterViewSelection {
  readonly spatialDimensions: readonly [x: string, y: string]
  readonly nonSpatial: readonly GeoDimensionSelection[]
  readonly sourceBands: readonly number[]
  readonly levelId: string
}

export interface GeoPixelRegion {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

export interface GeoPixelRegionReadRequest {
  readonly region: GeoPixelRegion
  readonly targetSampleType?: NumericSampleType
  readonly signal?: AbortSignal
}

export interface GeoWorldRegionReadRequest {
  readonly bounds: GeoBounds
  readonly clamp?: boolean
  readonly targetSampleType?: NumericSampleType
  readonly signal?: AbortSignal
}

/** NumericTile plus the source selection that produced it. */
export interface GeoNumericTile extends NumericTile {
  readonly fixedIndices: readonly GeoAxisIndex[]
  readonly sourceBands: readonly number[]
  readonly levelId: string
}

export interface GeoRasterView {
  readonly dataset: GeoRasterDataset
  readonly selection: GeoRasterViewSelection
  readonly level: GeoRasterLevel
  readPixelRegion(request: Readonly<GeoPixelRegionReadRequest>): AsyncIterable<GeoNumericTile>
  readWorldRegion(request: Readonly<GeoWorldRegionReadRequest>): AsyncIterable<GeoNumericTile>
}

export interface GeoAxisCoordinateReadRequest {
  readonly axisId: string
  readonly start: number
  readonly length: number
  readonly signal?: AbortSignal
}

export interface GeoAxisCoordinateBlock {
  readonly axisId: string
  readonly start: number
  readonly values: readonly (number | string)[]
}

/** Geo semantics over one existing lazy scientific dataset. */
export interface GeoRasterDataset {
  readonly descriptor: GeoRasterDescriptor
  readonly scientificDataset: ScientificDataset
  createView(selection: Readonly<GeoRasterViewSelection>): GeoRasterView
  readAxisCoordinates(
    request: Readonly<GeoAxisCoordinateReadRequest>,
  ): Promise<GeoAxisCoordinateBlock>
}

export interface GeoValidationLimits {
  readonly maxDimensions?: number
  readonly maxBands?: number
  readonly maxLevels?: number
  readonly maxFormalCrsAxes?: number
  readonly maxEvidenceEntries?: number
  readonly maxDiagnostics?: number
  readonly maxCategoriesPerBand?: number
  readonly maxEmbeddedCoordinateValues?: number
  readonly maxAxisCoordinateReadLength?: number
  readonly maxViewPlanes?: number
  readonly maxStringLength?: number
  readonly maxWktLength?: number
  readonly maxMetadataDepth?: number
  readonly maxMetadataValues?: number
}

export interface ResolvedGeoValidationLimits {
  readonly maxDimensions: number
  readonly maxBands: number
  readonly maxLevels: number
  readonly maxFormalCrsAxes: number
  readonly maxEvidenceEntries: number
  readonly maxDiagnostics: number
  readonly maxCategoriesPerBand: number
  readonly maxEmbeddedCoordinateValues: number
  readonly maxAxisCoordinateReadLength: number
  readonly maxViewPlanes: number
  readonly maxStringLength: number
  readonly maxWktLength: number
  readonly maxMetadataDepth: number
  readonly maxMetadataValues: number
}

export const defaultGeoValidationLimits: ResolvedGeoValidationLimits = Object.freeze({
  maxDimensions: 64,
  maxBands: 1_024,
  maxLevels: 64,
  maxFormalCrsAxes: 16,
  maxEvidenceEntries: 128,
  maxDiagnostics: 256,
  maxCategoriesPerBand: 4_096,
  maxEmbeddedCoordinateValues: 4_096,
  maxAxisCoordinateReadLength: 65_536,
  maxViewPlanes: 4_096,
  maxStringLength: 4_096,
  maxWktLength: 65_536,
  maxMetadataDepth: 32,
  maxMetadataValues: 65_536,
})

const positiveLimit = (value: number | undefined, fallback: number, label: string): number => {
  const resolved = value ?? fallback
  if (!Number.isSafeInteger(resolved) || resolved < 1) {
    throw invalidInput(`${label} must be a positive safe integer`)
  }
  return resolved
}

export const resolveGeoValidationLimits = (
  value: Readonly<GeoValidationLimits> = {},
): ResolvedGeoValidationLimits =>
  Object.freeze({
    maxDimensions: positiveLimit(
      value.maxDimensions,
      defaultGeoValidationLimits.maxDimensions,
      'maxDimensions',
    ),
    maxBands: positiveLimit(value.maxBands, defaultGeoValidationLimits.maxBands, 'maxBands'),
    maxLevels: positiveLimit(value.maxLevels, defaultGeoValidationLimits.maxLevels, 'maxLevels'),
    maxFormalCrsAxes: positiveLimit(
      value.maxFormalCrsAxes,
      defaultGeoValidationLimits.maxFormalCrsAxes,
      'maxFormalCrsAxes',
    ),
    maxEvidenceEntries: positiveLimit(
      value.maxEvidenceEntries,
      defaultGeoValidationLimits.maxEvidenceEntries,
      'maxEvidenceEntries',
    ),
    maxDiagnostics: positiveLimit(
      value.maxDiagnostics,
      defaultGeoValidationLimits.maxDiagnostics,
      'maxDiagnostics',
    ),
    maxCategoriesPerBand: positiveLimit(
      value.maxCategoriesPerBand,
      defaultGeoValidationLimits.maxCategoriesPerBand,
      'maxCategoriesPerBand',
    ),
    maxEmbeddedCoordinateValues: positiveLimit(
      value.maxEmbeddedCoordinateValues,
      defaultGeoValidationLimits.maxEmbeddedCoordinateValues,
      'maxEmbeddedCoordinateValues',
    ),
    maxAxisCoordinateReadLength: positiveLimit(
      value.maxAxisCoordinateReadLength,
      defaultGeoValidationLimits.maxAxisCoordinateReadLength,
      'maxAxisCoordinateReadLength',
    ),
    maxViewPlanes: positiveLimit(
      value.maxViewPlanes,
      defaultGeoValidationLimits.maxViewPlanes,
      'maxViewPlanes',
    ),
    maxStringLength: positiveLimit(
      value.maxStringLength,
      defaultGeoValidationLimits.maxStringLength,
      'maxStringLength',
    ),
    maxWktLength: positiveLimit(
      value.maxWktLength,
      defaultGeoValidationLimits.maxWktLength,
      'maxWktLength',
    ),
    maxMetadataDepth: positiveLimit(
      value.maxMetadataDepth,
      defaultGeoValidationLimits.maxMetadataDepth,
      'maxMetadataDepth',
    ),
    maxMetadataValues: positiveLimit(
      value.maxMetadataValues,
      defaultGeoValidationLimits.maxMetadataValues,
      'maxMetadataValues',
    ),
  })

const boundedString = (value: string, label: string, maximum: number): string => {
  const normalized = value.trim()
  if (normalized.length < 1 || normalized.length > maximum) {
    throw invalidInput(`${label} must be a bounded non-empty string`)
  }
  return normalized
}

const optionalBoundedString = (
  value: string | undefined,
  label: string,
  maximum: number,
): string | undefined => (value === undefined ? undefined : boundedString(value, label, maximum))

const finite = (value: number, label: string): number => {
  if (!Number.isFinite(value)) throw invalidInput(`${label} must be finite`)
  return value
}

const positiveInteger = (value: number, label: string): number => {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw invalidInput(`${label} must be a positive safe integer`)
  }
  return value
}

const nonNegativeInteger = (value: number, label: string): number => {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw invalidInput(`${label} must be a non-negative safe integer`)
  }
  return value
}

const metadata = (
  value: GeoMetadataObject | undefined,
  limits: ResolvedGeoValidationLimits,
  label: string,
): GeoMetadataObject | undefined => {
  if (value === undefined) return undefined
  const normalized = normalizeScientificMetadataObject(value)
  let count = 0
  const visit = (entry: GeoMetadataValue, depth: number): void => {
    count += 1
    if (count > limits.maxMetadataValues) {
      throw limitExceeded(`${label} exceeds maxMetadataValues`)
    }
    if (depth > limits.maxMetadataDepth) {
      throw limitExceeded(`${label} exceeds maxMetadataDepth`)
    }
    if (typeof entry === 'string') {
      if (entry.length > limits.maxStringLength) {
        throw limitExceeded(`${label} contains a string longer than maxStringLength`)
      }
      return
    }
    if (Array.isArray(entry)) {
      for (const child of entry) visit(child, depth + 1)
      return
    }
    if (isGeoMetadataObject(entry)) {
      for (const key of Object.keys(entry)) {
        if (key.length > limits.maxStringLength) {
          throw limitExceeded(`${label} contains a key longer than maxStringLength`)
        }
        const child = entry[key]
        if (child !== undefined) visit(child, depth + 1)
      }
    }
  }
  visit(normalized, 0)
  return normalized
}

const isGeoMetadataObject = (value: GeoMetadataValue): value is GeoMetadataObject =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

const unit = (
  value: GeoUnitDescriptor | undefined,
  label: string,
  limits: ResolvedGeoValidationLimits,
): GeoUnitDescriptor | undefined => {
  if (value === undefined) return undefined
  const symbol = optionalBoundedString(value.symbol, `${label}.symbol`, limits.maxStringLength)
  const conversionToSI =
    value.conversionToSI === undefined
      ? undefined
      : finite(value.conversionToSI, `${label}.conversionToSI`)
  if (conversionToSI !== undefined && conversionToSI <= 0) {
    throw invalidInput(`${label}.conversionToSI must be positive`)
  }
  return Object.freeze({
    name: boundedString(value.name, `${label}.name`, limits.maxStringLength),
    ...(symbol === undefined ? {} : { symbol }),
    ...(conversionToSI === undefined ? {} : { conversionToSI }),
  })
}

const normalizeDiagnostic = (
  value: Readonly<GeoDiagnostic>,
  limits: ResolvedGeoValidationLimits,
): GeoDiagnostic => {
  const metadataValue = metadata(value.metadata, limits, 'Geo diagnostic metadata')
  return Object.freeze({
    severity: value.severity,
    code: value.code,
    message: boundedString(value.message, 'Geo diagnostic message', 16_384),
    ...(value.path === undefined
      ? {}
      : { path: boundedString(value.path, 'Geo diagnostic path', 4_096) }),
    ...(metadataValue === undefined ? {} : { metadata: metadataValue }),
  })
}

export const createGeoDiagnostic = (value: Readonly<GeoDiagnostic>): GeoDiagnostic =>
  normalizeDiagnostic(value, defaultGeoValidationLimits)

const diagnostics = (
  values: readonly GeoDiagnostic[],
  limits: ResolvedGeoValidationLimits,
  label: string,
): readonly GeoDiagnostic[] => {
  if (values.length > limits.maxDiagnostics) throw limitExceeded(`${label} exceeds maxDiagnostics`)
  return Object.freeze(values.map((value) => normalizeDiagnostic(value, limits)))
}

const affine = (value: GeoAffineTransform, label: string): GeoAffineTransform => {
  if (value.length !== 6) throw invalidInput(`${label} must contain six values`)
  const a = finite(value[0], `${label}[0]`)
  const b = finite(value[1], `${label}[1]`)
  const c = finite(value[2], `${label}[2]`)
  const d = finite(value[3], `${label}[3]`)
  const e = finite(value[4], `${label}[4]`)
  const f = finite(value[5], `${label}[5]`)
  return Object.freeze([a, b, c, d, e, f] as const)
}

export const invertGeoAffine = (value: GeoAffineTransform): GeoAffineTransform | undefined => {
  const [a, b, c, d, e, f] = affine(value, 'Geo affine')
  const determinant = a * e - b * d
  if (!Number.isFinite(determinant) || determinant === 0) return undefined
  const inverse: GeoAffineTransform = [
    e / determinant,
    -b / determinant,
    (b * f - e * c) / determinant,
    -d / determinant,
    a / determinant,
    (d * c - a * f) / determinant,
  ]
  return inverse.every(Number.isFinite) ? Object.freeze(inverse) : undefined
}

const transformPoint = (
  value: GeoAffineTransform,
  x: number,
  y: number,
): readonly [number, number] =>
  Object.freeze([
    value[0] * x + value[1] * y + value[2],
    value[3] * x + value[4] * y + value[5],
  ] as const)

export const calculateGeoWorldBounds = (
  value: GeoAffineTransform,
  widthValue: number,
  heightValue: number,
  registration: GeoPixelRegistration,
): GeoBounds => {
  const transform = affine(value, 'Geo pixelToWorld')
  const width = positiveInteger(widthValue, 'Geo grid width')
  const height = positiveInteger(heightValue, 'Geo grid height')
  const maximumX = registration === 'pixel-is-point' ? width - 1 : width
  const maximumY = registration === 'pixel-is-point' ? height - 1 : height
  const corners = [
    transformPoint(transform, 0, 0),
    transformPoint(transform, maximumX, 0),
    transformPoint(transform, 0, maximumY),
    transformPoint(transform, maximumX, maximumY),
  ]
  const xs = corners.map((corner) => corner[0])
  const ys = corners.map((corner) => corner[1])
  return Object.freeze({
    minX: Math.min(...xs),
    minY: Math.min(...ys),
    maxX: Math.max(...xs),
    maxY: Math.max(...ys),
  })
}

const closeNumber = (left: number, right: number): boolean => {
  const scale = Math.max(1, Math.abs(left), Math.abs(right))
  return Math.abs(left - right) <= scale * 1e-12
}

const sameAffine = (left: GeoAffineTransform, right: GeoAffineTransform): boolean =>
  left.every((entry, index) => closeNumber(entry, right[index] ?? Number.NaN))

const sameBounds = (left: GeoBounds, right: GeoBounds): boolean =>
  closeNumber(left.minX, right.minX) &&
  closeNumber(left.minY, right.minY) &&
  closeNumber(left.maxX, right.maxX) &&
  closeNumber(left.maxY, right.maxY)

const normalizeBounds = (value: GeoBounds, label: string): GeoBounds => {
  const result = Object.freeze({
    minX: finite(value.minX, `${label}.minX`),
    minY: finite(value.minY, `${label}.minY`),
    maxX: finite(value.maxX, `${label}.maxX`),
    maxY: finite(value.maxY, `${label}.maxY`),
  })
  if (result.minX > result.maxX || result.minY > result.maxY) {
    throw invalidInput(`${label} must be ordered`)
  }
  return result
}

const normalizeSpatialDimension = (
  value: GeoSpatialDimension,
  label: string,
  limits: ResolvedGeoValidationLimits,
): GeoSpatialDimension =>
  Object.freeze({
    id: boundedString(value.id, `${label}.id`, limits.maxStringLength),
    name: boundedString(value.name, `${label}.name`, limits.maxStringLength),
    dimensionIndex: nonNegativeInteger(value.dimensionIndex, `${label}.dimensionIndex`),
  })

const normalizeNoData = (value: GeoNoData): GeoNoData => {
  if (value.kind === 'none') return Object.freeze({ kind: 'none' })
  if (value.kind === 'scalar') return Object.freeze({ kind: 'scalar', value: value.value })
  if (value.kind !== 'components') throw invalidInput('Geo nodata kind is invalid')
  if (value.values.length < 1) throw invalidInput('Geo component nodata must not be empty')
  return Object.freeze({ kind: 'components', values: Object.freeze([...value.values]) })
}

const sameNoData = (left: GeoNoData, right: GeoNoData): boolean => {
  if (left.kind !== right.kind) return false
  if (left.kind === 'none') return true
  if (left.kind === 'scalar') return right.kind === 'scalar' && Object.is(left.value, right.value)
  return (
    right.kind === 'components' &&
    left.values.length === right.values.length &&
    left.values.every((value, index) => Object.is(value, right.values[index]))
  )
}

const normalizeWrappedBounds = (value: GeoWrappedBounds): GeoWrappedBounds => {
  const result = Object.freeze({
    west: finite(value.west, 'Geo wrapped bounds west'),
    south: finite(value.south, 'Geo wrapped bounds south'),
    east: finite(value.east, 'Geo wrapped bounds east'),
    north: finite(value.north, 'Geo wrapped bounds north'),
    crossesAntimeridian: value.crossesAntimeridian,
  })
  if (result.south > result.north) throw invalidInput('Geo wrapped latitude bounds must be ordered')
  if (!result.crossesAntimeridian && result.west > result.east) {
    throw invalidInput('Geo wrapped longitude bounds require crossesAntimeridian')
  }
  return result
}

export const createGeoGridGeometry = (
  options: Readonly<CreateGeoGridGeometryOptions>,
  limitsValue: Readonly<GeoValidationLimits> = {},
): GeoGridGeometry => {
  const limits = resolveGeoValidationLimits(limitsValue)
  const width = positiveInteger(options.width, 'Geo grid width')
  const height = positiveInteger(options.height, 'Geo grid height')
  const x = normalizeSpatialDimension(options.spatialDimensions.x, 'Geo spatial X', limits)
  const y = normalizeSpatialDimension(options.spatialDimensions.y, 'Geo spatial Y', limits)
  if (x.id === y.id || x.dimensionIndex === y.dimensionIndex) {
    throw invalidInput('Geo spatial dimensions must be unique')
  }
  if (
    options.pixelRegistration !== 'pixel-is-area' &&
    options.pixelRegistration !== 'pixel-is-point' &&
    options.pixelRegistration !== 'unknown'
  ) {
    throw invalidInput('Geo pixel registration is invalid')
  }
  const pixelToWorld = affine(options.pixelToWorld, 'Geo pixelToWorld')
  const worldToPixel = invertGeoAffine(pixelToWorld)
  const generatedWarnings = [...(options.warnings ?? [])]
  if (worldToPixel === undefined) {
    generatedWarnings.push({
      severity: 'warning',
      code: 'non-invertible-affine',
      message: 'The pixel-to-world affine is non-invertible; world-region reads are unavailable.',
      path: 'pixelToWorld',
    })
  }
  if (options.pixelRegistration === 'unknown') {
    generatedWarnings.push({
      severity: 'warning',
      code: 'unknown-pixel-registration',
      message: 'Pixel registration is unknown; bounds use pixel-edge corner coordinates.',
      path: 'pixelRegistration',
    })
  }
  return Object.freeze({
    schemaVersion: geoRasterSchemaVersion,
    width,
    height,
    spatialDimensions: Object.freeze({ x, y }),
    pixelToWorld,
    ...(worldToPixel === undefined ? {} : { worldToPixel }),
    worldBounds: calculateGeoWorldBounds(pixelToWorld, width, height, options.pixelRegistration),
    pixelRegistration: options.pixelRegistration,
    noData: normalizeNoData(options.noData ?? { kind: 'none' }),
    ...(options.wrappedBounds === undefined
      ? {}
      : { wrappedBounds: normalizeWrappedBounds(options.wrappedBounds) }),
    warnings: diagnostics(generatedWarnings, limits, 'Geo grid warnings'),
  })
}

export const normalizeGeoGridGeometry = (
  value: Readonly<GeoGridGeometry>,
  limitsValue: Readonly<GeoValidationLimits> = {},
): GeoGridGeometry => {
  if (value.schemaVersion !== geoRasterSchemaVersion) {
    throw invalidInput('Geo grid schema version is unsupported')
  }
  const normalized = createGeoGridGeometry(
    {
      width: value.width,
      height: value.height,
      spatialDimensions: value.spatialDimensions,
      pixelToWorld: value.pixelToWorld,
      pixelRegistration: value.pixelRegistration,
      noData: value.noData,
      ...(value.wrappedBounds === undefined ? {} : { wrappedBounds: value.wrappedBounds }),
      warnings: value.warnings.filter(
        ({ code }) => code !== 'non-invertible-affine' && code !== 'unknown-pixel-registration',
      ),
    },
    limitsValue,
  )
  if (!sameBounds(normalized.worldBounds, normalizeBounds(value.worldBounds, 'Geo worldBounds'))) {
    throw invalidInput('Geo worldBounds do not match transformed raster corners')
  }
  if (normalized.worldToPixel === undefined) {
    if (value.worldToPixel !== undefined) {
      throw invalidInput('Geo singular affine must not declare worldToPixel')
    }
  } else if (
    value.worldToPixel === undefined ||
    !sameAffine(normalized.worldToPixel, affine(value.worldToPixel, 'Geo worldToPixel'))
  ) {
    throw invalidInput('Geo worldToPixel does not invert pixelToWorld')
  }
  return normalized
}

export const normalizeGeoSpatialReference = (
  value: Readonly<GeoSpatialReference>,
  limitsValue: Readonly<GeoValidationLimits> = {},
): GeoSpatialReference => {
  const limits = resolveGeoValidationLimits(limitsValue)
  if (value.schemaVersion !== geoRasterSchemaVersion) {
    throw invalidInput('Geo spatial reference schema version is unsupported')
  }
  const coordinateTypes: readonly GeoCoordinateSystemType[] = [
    'projected',
    'geographic',
    'geocentric',
    'vertical',
    'compound',
    'engineering',
    'parametric',
    'temporal',
    'unknown',
  ]
  if (!coordinateTypes.includes(value.coordinateSystemType)) {
    throw invalidInput('Geo coordinate-system type is invalid')
  }
  if (value.formalAxes.length > limits.maxFormalCrsAxes) {
    throw limitExceeded('Geo formal CRS axes exceed maxFormalCrsAxes')
  }
  const formalAxes = Object.freeze(
    value.formalAxes.map((axis, index) => {
      if (axis.order !== index) throw invalidInput('Geo formal CRS axis order must be contiguous')
      const axisUnit = unit(axis.unit, `Geo formal axis ${index} unit`, limits)
      return Object.freeze({
        name: boundedString(axis.name, `Geo formal axis ${index} name`, limits.maxStringLength),
        ...(axis.abbreviation === undefined
          ? {}
          : {
              abbreviation: boundedString(
                axis.abbreviation,
                `Geo formal axis ${index} abbreviation`,
                limits.maxStringLength,
              ),
            }),
        direction: boundedString(
          axis.direction,
          `Geo formal axis ${index} direction`,
          limits.maxStringLength,
        ),
        ...(axisUnit === undefined ? {} : { unit: axisUnit }),
        order: index,
      })
    }),
  )
  const applicationAxis = (
    axis: GeoApplicationAxisDescriptor,
    label: string,
  ): GeoApplicationAxisDescriptor => {
    const formalAxisIndex =
      axis.formalAxisIndex === undefined
        ? undefined
        : nonNegativeInteger(axis.formalAxisIndex, `${label}.formalAxisIndex`)
    if (formalAxisIndex !== undefined && formalAxisIndex >= formalAxes.length) {
      throw invalidInput(`${label}.formalAxisIndex is outside formalAxes`)
    }
    return Object.freeze({
      name: boundedString(axis.name, `${label}.name`, limits.maxStringLength),
      ...(formalAxisIndex === undefined ? {} : { formalAxisIndex }),
    })
  }
  const applicationX = applicationAxis(value.applicationAxes.x, 'Geo application X')
  const applicationY = applicationAxis(value.applicationAxes.y, 'Geo application Y')
  if (
    applicationX.formalAxisIndex !== undefined &&
    applicationX.formalAxisIndex === applicationY.formalAxisIndex
  ) {
    throw invalidInput('Geo application X and Y cannot map to the same formal CRS axis')
  }
  if (value.evidence.length > limits.maxEvidenceEntries) {
    throw limitExceeded('Geo CRS evidence exceeds maxEvidenceEntries')
  }
  const evidence = Object.freeze(
    value.evidence.map((entry, index) => {
      const entryMetadata = metadata(entry.metadata, limits, `Geo CRS evidence ${index} metadata`)
      return Object.freeze({
        kind: entry.kind,
        sourceId: boundedString(
          entry.sourceId,
          `Geo CRS evidence ${index} sourceId`,
          limits.maxStringLength,
        ),
        locator: boundedString(
          entry.locator,
          `Geo CRS evidence ${index} locator`,
          limits.maxStringLength,
        ),
        ...(entry.citation === undefined
          ? {}
          : {
              citation: boundedString(
                entry.citation,
                `Geo CRS evidence ${index} citation`,
                limits.maxWktLength,
              ),
            }),
        ...(entryMetadata === undefined ? {} : { metadata: entryMetadata }),
      })
    }),
  )
  if (value.state !== 'complete' && value.state !== 'incomplete' && value.state !== 'unknown') {
    throw invalidInput('Geo CRS state is invalid')
  }
  if (value.coordinateSystemType === 'unknown' && value.state !== 'unknown') {
    throw invalidInput('An unknown Geo CRS must use unknown diagnostic state')
  }
  const confidence =
    value.confidence === undefined ? undefined : finite(value.confidence, 'Geo CRS confidence')
  if (confidence !== undefined && (confidence < 0 || confidence > 1)) {
    throw invalidInput('Geo CRS confidence must be in [0, 1]')
  }
  const horizontalUnit = unit(value.horizontalUnit, 'Geo horizontal unit', limits)
  const verticalUnit = unit(value.vertical?.unit, 'Geo vertical unit', limits)
  const vertical =
    value.vertical === undefined
      ? undefined
      : Object.freeze({
          ...(value.vertical.authority === undefined
            ? {}
            : {
                authority: boundedString(
                  value.vertical.authority,
                  'Geo vertical authority',
                  limits.maxStringLength,
                ),
              }),
          ...(value.vertical.code === undefined ? {} : { code: value.vertical.code }),
          ...(value.vertical.name === undefined
            ? {}
            : {
                name: boundedString(
                  value.vertical.name,
                  'Geo vertical name',
                  limits.maxStringLength,
                ),
              }),
          ...(value.vertical.wkt2 === undefined
            ? {}
            : {
                wkt2: boundedString(value.vertical.wkt2, 'Geo vertical WKT2', limits.maxWktLength),
              }),
          ...(verticalUnit === undefined ? {} : { unit: verticalUnit }),
        })
  const projJson = metadata(value.projJson, limits, 'Geo PROJJSON')
  return Object.freeze({
    schemaVersion: geoRasterSchemaVersion,
    coordinateSystemType: value.coordinateSystemType,
    ...(value.authority === undefined
      ? {}
      : { authority: boundedString(value.authority, 'Geo CRS authority', limits.maxStringLength) }),
    ...(value.code === undefined ? {} : { code: value.code }),
    ...(value.name === undefined
      ? {}
      : { name: boundedString(value.name, 'Geo CRS name', limits.maxStringLength) }),
    ...(value.wkt2 === undefined
      ? {}
      : { wkt2: boundedString(value.wkt2, 'Geo CRS WKT2', limits.maxWktLength) }),
    ...(projJson === undefined ? {} : { projJson }),
    ...(horizontalUnit === undefined ? {} : { horizontalUnit }),
    ...(vertical === undefined ? {} : { vertical }),
    ...(value.coordinateEpoch === undefined
      ? {}
      : { coordinateEpoch: finite(value.coordinateEpoch, 'Geo coordinate epoch') }),
    formalAxes,
    applicationAxes: Object.freeze({ x: applicationX, y: applicationY }),
    evidence,
    state: value.state,
    ...(confidence === undefined ? {} : { confidence }),
    diagnostics: diagnostics(value.diagnostics, limits, 'Geo CRS diagnostics'),
  })
}

const sampleTypeIntegerRange = (
  sampleType: RasterSampleType,
): readonly [minimum: bigint, maximum: bigint] | undefined => {
  if (sampleType === 'uint8') return [0n, 255n]
  if (sampleType === 'uint16') return [0n, 65_535n]
  if (sampleType === 'uint32') return [0n, 4_294_967_295n]
  if (sampleType === 'uint64') return [0n, (1n << 64n) - 1n]
  if (sampleType === 'int8') return [-128n, 127n]
  if (sampleType === 'int16') return [-32_768n, 32_767n]
  if (sampleType === 'int32') return [-2_147_483_648n, 2_147_483_647n]
  if (sampleType === 'int64') return [-(1n << 63n), (1n << 63n) - 1n]
  return undefined
}

const validateNoDataValue = (
  value: GeoNoDataValue,
  sampleType: RasterSampleType,
  label: string,
): void => {
  const integerRange = sampleTypeIntegerRange(sampleType)
  if (integerRange === undefined) {
    if (typeof value === 'number') return
    if (value === 'NaN' || value === 'Infinity' || value === '-Infinity') return
    const parsed = Number(value)
    if (!Number.isFinite(parsed)) throw invalidInput(`${label} is incompatible with ${sampleType}`)
    return
  }
  let integer: bigint
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) throw invalidInput(`${label} must be an exact integer`)
    integer = BigInt(value)
  } else {
    if (!/^-?(?:0|[1-9][0-9]*)$/.test(value)) {
      throw invalidInput(`${label} must be a canonical integer string`)
    }
    integer = BigInt(value)
  }
  if (integer < integerRange[0] || integer > integerRange[1]) {
    throw invalidInput(`${label} is outside ${sampleType}`)
  }
}

const comparableRangeValue = (
  value: GeoNoDataValue,
  sampleType: RasterSampleType,
  label: string,
): number | bigint => {
  validateNoDataValue(value, sampleType, label)
  if (sampleTypeIntegerRange(sampleType) !== undefined) {
    return typeof value === 'number' ? BigInt(value) : BigInt(value)
  }
  const result = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(result)) throw invalidInput(`${label} must be finite`)
  return result
}

const normalizeBand = (
  value: GeoBandDescriptor,
  componentCount: number,
  limits: ResolvedGeoValidationLimits,
  index: number,
): GeoBandDescriptor => {
  const sourceComponentIndex = nonNegativeInteger(
    value.sourceComponentIndex,
    `Geo band ${index} sourceComponentIndex`,
  )
  if (sourceComponentIndex >= componentCount) {
    throw invalidInput(`Geo band ${index} sourceComponentIndex is unavailable`)
  }
  if (value.dataType === undefined) throw invalidInput(`Geo band ${index} dataType is missing`)
  if (value.scale !== undefined && (!Number.isFinite(value.scale) || value.scale === 0)) {
    throw invalidInput(`Geo band ${index} scale must be finite and non-zero`)
  }
  if (value.offset !== undefined && !Number.isFinite(value.offset)) {
    throw invalidInput(`Geo band ${index} offset must be finite`)
  }
  if (value.noData !== undefined) {
    validateNoDataValue(value.noData, value.dataType, `Geo band ${index} nodata`)
  }
  const validRange =
    value.validRange === undefined
      ? undefined
      : Object.freeze([value.validRange[0], value.validRange[1]] as const)
  if (validRange !== undefined) {
    const minimum = comparableRangeValue(
      validRange[0],
      value.dataType,
      `Geo band ${index} validRange minimum`,
    )
    const maximum = comparableRangeValue(
      validRange[1],
      value.dataType,
      `Geo band ${index} validRange maximum`,
    )
    if (minimum > maximum) throw invalidInput(`Geo band ${index} validRange must be ordered`)
  }
  const wavelength =
    value.wavelength === undefined
      ? undefined
      : Object.freeze({
          ...(value.wavelength.center === undefined
            ? {}
            : { center: finite(value.wavelength.center, `Geo band ${index} wavelength center`) }),
          ...(value.wavelength.min === undefined
            ? {}
            : { min: finite(value.wavelength.min, `Geo band ${index} wavelength minimum`) }),
          ...(value.wavelength.max === undefined
            ? {}
            : { max: finite(value.wavelength.max, `Geo band ${index} wavelength maximum`) }),
          unit: boundedString(
            value.wavelength.unit,
            `Geo band ${index} wavelength unit`,
            limits.maxStringLength,
          ),
        })
  if (
    wavelength !== undefined &&
    wavelength.min !== undefined &&
    wavelength.max !== undefined &&
    wavelength.min > wavelength.max
  ) {
    throw invalidInput(`Geo band ${index} wavelength range must be ordered`)
  }
  if ((value.categories?.length ?? 0) > limits.maxCategoriesPerBand) {
    throw limitExceeded(`Geo band ${index} categories exceed maxCategoriesPerBand`)
  }
  const seenCategories = new Set<string>()
  const categories =
    value.categories === undefined
      ? undefined
      : Object.freeze(
          value.categories.map((category, categoryIndex) => {
            validateNoDataValue(
              category.value,
              value.dataType,
              `Geo band ${index} category ${categoryIndex} value`,
            )
            const categoryKey = `${typeof category.value}:${String(category.value)}`
            if (seenCategories.has(categoryKey)) {
              throw invalidInput(`Geo band ${index} repeats category value ${category.value}`)
            }
            seenCategories.add(categoryKey)
            const categoryMetadata = metadata(
              category.metadata,
              limits,
              `Geo band ${index} category ${categoryIndex} metadata`,
            )
            return Object.freeze({
              value: category.value,
              label: boundedString(
                category.label,
                `Geo band ${index} category ${categoryIndex} label`,
                limits.maxStringLength,
              ),
              ...(category.color === undefined
                ? {}
                : {
                    color: boundedString(
                      category.color,
                      `Geo band ${index} category ${categoryIndex} color`,
                      limits.maxStringLength,
                    ),
                  }),
              ...(categoryMetadata === undefined ? {} : { metadata: categoryMetadata }),
            })
          }),
        )
  if (!value.categorical && categories !== undefined) {
    throw invalidInput(`Geo band ${index} categories require categorical true`)
  }
  return Object.freeze({
    sourceComponentIndex,
    name: boundedString(value.name, `Geo band ${index} name`, limits.maxStringLength),
    ...(value.commonName === undefined
      ? {}
      : {
          commonName: boundedString(
            value.commonName,
            `Geo band ${index} commonName`,
            limits.maxStringLength,
          ),
        }),
    ...(value.description === undefined
      ? {}
      : {
          description: boundedString(
            value.description,
            `Geo band ${index} description`,
            limits.maxWktLength,
          ),
        }),
    colorInterpretation: value.colorInterpretation,
    ...(wavelength === undefined ? {} : { wavelength }),
    ...(value.unit === undefined
      ? {}
      : { unit: boundedString(value.unit, `Geo band ${index} unit`, limits.maxStringLength) }),
    ...(value.scale === undefined ? {} : { scale: value.scale }),
    ...(value.offset === undefined ? {} : { offset: value.offset }),
    ...(value.noData === undefined ? {} : { noData: value.noData }),
    ...(validRange === undefined ? {} : { validRange }),
    dataType: value.dataType,
    categorical: value.categorical,
    ...(categories === undefined ? {} : { categories }),
  })
}

const normalizeAxis = (
  value: GeoAxisDescriptor,
  limits: ResolvedGeoValidationLimits,
  index: number,
): GeoAxisDescriptor => {
  const coordinates = value.coordinates
  let normalizedCoordinates: GeoAxisCoordinates
  if (coordinates.kind === 'index' || coordinates.kind === 'lazy') {
    normalizedCoordinates = Object.freeze({ ...coordinates })
  } else if (coordinates.kind === 'linear') {
    normalizedCoordinates = Object.freeze({
      kind: 'linear',
      origin: finite(coordinates.origin, `Geo axis ${index} coordinate origin`),
      step: finite(coordinates.step, `Geo axis ${index} coordinate step`),
    })
  } else if (coordinates.kind === 'values') {
    if (coordinates.values.length !== value.length) {
      throw invalidInput(`Geo axis ${index} coordinate count must match its length`)
    }
    if (coordinates.values.length > limits.maxEmbeddedCoordinateValues) {
      throw limitExceeded(`Geo axis ${index} coordinates exceed maxEmbeddedCoordinateValues`)
    }
    normalizedCoordinates = Object.freeze({
      kind: 'values',
      values: Object.freeze([...coordinates.values]),
    })
  } else throw invalidInput(`Geo axis ${index} coordinate kind is invalid`)
  const axisMetadata = metadata(value.metadata, limits, `Geo axis ${index} metadata`)
  return Object.freeze({
    id: boundedString(value.id, `Geo axis ${index} id`, limits.maxStringLength),
    ...(value.name === undefined
      ? {}
      : { name: boundedString(value.name, `Geo axis ${index} name`, limits.maxStringLength) }),
    kind: value.kind,
    dimensionIndex: nonNegativeInteger(value.dimensionIndex, `Geo axis ${index} dimensionIndex`),
    length: positiveInteger(value.length, `Geo axis ${index} length`),
    ...(value.unit === undefined
      ? {}
      : { unit: boundedString(value.unit, `Geo axis ${index} unit`, limits.maxStringLength) }),
    coordinates: normalizedCoordinates,
    ...(axisMetadata === undefined ? {} : { metadata: axisMetadata }),
  })
}

const normalizeStorage = (
  value: GeoStorageSummary,
  rank: number,
  limits: ResolvedGeoValidationLimits,
  label: string,
): GeoStorageSummary => {
  const chunkShape =
    value.chunkShape === undefined
      ? undefined
      : Object.freeze(
          value.chunkShape.map((length, index) =>
            positiveInteger(length, `${label}.chunkShape[${index}]`),
          ),
        )
  if (chunkShape !== undefined && chunkShape.length !== rank) {
    throw invalidInput(`${label}.chunkShape must match the dataset rank`)
  }
  const storageMetadata = metadata(value.metadata, limits, `${label}.metadata`)
  return Object.freeze({
    organization: value.organization,
    ...(chunkShape === undefined ? {} : { chunkShape }),
    ...(value.compression === undefined
      ? {}
      : {
          compression: boundedString(
            value.compression,
            `${label}.compression`,
            limits.maxStringLength,
          ),
        }),
    ...(value.byteOrder === undefined ? {} : { byteOrder: value.byteOrder }),
    ...(storageMetadata === undefined ? {} : { metadata: storageMetadata }),
  })
}

const normalizeLevel = (
  value: GeoRasterLevel,
  rank: number,
  limits: ResolvedGeoValidationLimits,
  index: number,
): GeoRasterLevel => {
  const geometry = normalizeGeoGridGeometry(value.geometry, limits)
  if (value.width !== geometry.width || value.height !== geometry.height) {
    throw invalidInput(`Geo level ${index} dimensions must match its grid geometry`)
  }
  const nominalResolution =
    value.nominalResolution === undefined
      ? undefined
      : Object.freeze({
          x: finite(value.nominalResolution.x, `Geo level ${index} nominal X resolution`),
          y: finite(value.nominalResolution.y, `Geo level ${index} nominal Y resolution`),
          ...(value.nominalResolution.unit === undefined
            ? {}
            : {
                unit: boundedString(
                  value.nominalResolution.unit,
                  `Geo level ${index} nominal resolution unit`,
                  limits.maxStringLength,
                ),
              }),
        })
  if (nominalResolution !== undefined && (nominalResolution.x <= 0 || nominalResolution.y <= 0)) {
    throw invalidInput(`Geo level ${index} nominal resolution must be positive`)
  }
  const downsample =
    value.downsample === undefined
      ? undefined
      : Object.freeze({
          x: finite(value.downsample.x, `Geo level ${index} X downsample`),
          y: finite(value.downsample.y, `Geo level ${index} Y downsample`),
        })
  if (downsample !== undefined && (downsample.x <= 0 || downsample.y <= 0)) {
    throw invalidInput(`Geo level ${index} downsample must be positive`)
  }
  return Object.freeze({
    id: boundedString(value.id, `Geo level ${index} id`, limits.maxStringLength),
    ...(value.arrayPath === undefined
      ? {}
      : {
          arrayPath: boundedString(
            value.arrayPath,
            `Geo level ${index} arrayPath`,
            limits.maxWktLength,
          ),
        }),
    ...(value.sourcePath === undefined
      ? {}
      : {
          sourcePath: boundedString(
            value.sourcePath,
            `Geo level ${index} sourcePath`,
            limits.maxWktLength,
          ),
        }),
    sourceResolutionLevel: nonNegativeInteger(
      value.sourceResolutionLevel,
      `Geo level ${index} sourceResolutionLevel`,
    ),
    sourceOrder: nonNegativeInteger(value.sourceOrder, `Geo level ${index} sourceOrder`),
    width: positiveInteger(value.width, `Geo level ${index} width`),
    height: positiveInteger(value.height, `Geo level ${index} height`),
    geometry,
    ...(nominalResolution === undefined ? {} : { nominalResolution }),
    ...(downsample === undefined ? {} : { downsample }),
    storage: normalizeStorage(value.storage, rank, limits, `Geo level ${index} storage`),
  })
}

const validateDescriptorNoData = (
  descriptor: GeoRasterDescriptor,
  componentCount: number,
): void => {
  const noData = descriptor.grid.noData
  if (noData.kind === 'scalar') {
    validateNoDataValue(noData.value, descriptor.sampleType, 'Geo grid nodata')
  } else if (noData.kind === 'components') {
    if (noData.values.length !== componentCount) {
      throw invalidInput('Geo component nodata count must match source components')
    }
    noData.values.forEach((value, index) => {
      validateNoDataValue(value, descriptor.sampleType, `Geo grid component nodata ${index}`)
    })
  }
}

export const normalizeGeoRasterDescriptor = (
  value: Readonly<GeoRasterDescriptor>,
  componentCount: number,
  limitsValue: Readonly<GeoValidationLimits> = {},
): GeoRasterDescriptor => {
  const limits = resolveGeoValidationLimits(limitsValue)
  positiveInteger(componentCount, 'Geo source component count')
  if (value.schemaVersion !== geoRasterSchemaVersion) {
    throw invalidInput('Geo raster descriptor schema version is unsupported')
  }
  if (value.dimensions.length < 2 || value.dimensions.length > limits.maxDimensions) {
    throw limitExceeded('Geo raster dimensions are outside configured limits')
  }
  if (value.shape.length !== value.dimensions.length) {
    throw invalidInput('Geo raster shape must match its dimensions')
  }
  const dimensionIds = new Set<string>()
  const dimensions = Object.freeze(
    value.dimensions.map((dimension, index) => {
      if (dimension.index !== index) throw invalidInput('Geo dimension indices must be contiguous')
      const id = boundedString(dimension.id, `Geo dimension ${index} id`, limits.maxStringLength)
      if (dimensionIds.has(id)) throw invalidInput(`Geo raster repeats dimension ${id}`)
      dimensionIds.add(id)
      const length = positiveInteger(dimension.length, `Geo dimension ${index} length`)
      if (value.shape[index] !== length) {
        throw invalidInput(`Geo shape ${index} must match dimension length`)
      }
      return Object.freeze({
        id,
        ...(dimension.name === undefined
          ? {}
          : {
              name: boundedString(
                dimension.name,
                `Geo dimension ${index} name`,
                limits.maxStringLength,
              ),
            }),
        index,
        length,
        kind: dimension.kind,
      })
    }),
  )
  const spatialX = normalizeSpatialDimension(value.spatialDimensions.x, 'Geo spatial X', limits)
  const spatialY = normalizeSpatialDimension(value.spatialDimensions.y, 'Geo spatial Y', limits)
  if (spatialX.id === spatialY.id || spatialX.dimensionIndex === spatialY.dimensionIndex) {
    throw invalidInput('Geo spatial dimensions must be unique')
  }
  const xDimension = dimensions[spatialX.dimensionIndex]
  const yDimension = dimensions[spatialY.dimensionIndex]
  if (xDimension?.id !== spatialX.id || xDimension.kind !== 'spatial-x') {
    throw invalidInput('Geo spatial X does not match the dimension table')
  }
  if (yDimension?.id !== spatialY.id || yDimension.kind !== 'spatial-y') {
    throw invalidInput('Geo spatial Y does not match the dimension table')
  }
  const axes = Object.freeze(value.axes.map((axis, index) => normalizeAxis(axis, limits, index)))
  const axisIds = new Set<string>()
  const axisDimensions = new Set<number>()
  for (const axis of axes) {
    if (axisIds.has(axis.id)) throw invalidInput(`Geo raster repeats axis ${axis.id}`)
    axisIds.add(axis.id)
    if (axisDimensions.has(axis.dimensionIndex)) {
      throw invalidInput(`Geo raster repeats non-spatial dimension ${axis.dimensionIndex}`)
    }
    axisDimensions.add(axis.dimensionIndex)
    const dimension = dimensions[axis.dimensionIndex]
    if (dimension?.id !== axis.id || dimension.kind !== 'non-spatial') {
      throw invalidInput(`Geo axis ${axis.id} does not match the dimension table`)
    }
    if (axis.length !== dimension.length) {
      throw invalidInput(`Geo axis ${axis.id} length does not match its dimension`)
    }
  }
  for (const dimension of dimensions) {
    if (dimension.kind === 'non-spatial' && !axisDimensions.has(dimension.index)) {
      throw invalidInput(`Geo non-spatial dimension ${dimension.id} has no axis descriptor`)
    }
  }
  if (value.bands.length < 1 || value.bands.length > limits.maxBands) {
    throw limitExceeded('Geo raster bands are outside configured limits')
  }
  const bands = Object.freeze(
    value.bands.map((band, index) => normalizeBand(band, componentCount, limits, index)),
  )
  const bandComponents = new Set<number>()
  for (const band of bands) {
    if (bandComponents.has(band.sourceComponentIndex)) {
      throw invalidInput(`Geo raster repeats source component ${band.sourceComponentIndex}`)
    }
    bandComponents.add(band.sourceComponentIndex)
    if (band.dataType !== value.sampleType) {
      throw invalidInput('Geo band data type must match the source sample type')
    }
  }
  if (value.levels.length < 1 || value.levels.length > limits.maxLevels) {
    throw limitExceeded('Geo raster levels are outside configured limits')
  }
  const levels = Object.freeze(
    value.levels.map((level, index) => normalizeLevel(level, dimensions.length, limits, index)),
  )
  const levelIds = new Set<string>()
  const sourceOrders = new Set<number>()
  const sourceLevels = new Set<number>()
  for (const level of levels) {
    if (levelIds.has(level.id)) throw invalidInput(`Geo raster repeats level ${level.id}`)
    if (sourceOrders.has(level.sourceOrder))
      throw invalidInput('Geo raster repeats level sourceOrder')
    if (sourceLevels.has(level.sourceResolutionLevel)) {
      throw invalidInput('Geo raster repeats source resolution level')
    }
    levelIds.add(level.id)
    sourceOrders.add(level.sourceOrder)
    sourceLevels.add(level.sourceResolutionLevel)
    if (
      level.geometry.spatialDimensions.x.id !== spatialX.id ||
      level.geometry.spatialDimensions.y.id !== spatialY.id ||
      level.geometry.spatialDimensions.x.dimensionIndex !== spatialX.dimensionIndex ||
      level.geometry.spatialDimensions.y.dimensionIndex !== spatialY.dimensionIndex
    ) {
      throw invalidInput(`Geo level ${level.id} spatial dimensions differ from the dataset`)
    }
    if (
      level.downsample !== undefined &&
      (!closeNumber(level.downsample.x, xDimension.length / level.width) ||
        !closeNumber(level.downsample.y, yDimension.length / level.height))
    ) {
      throw invalidInput(`Geo level ${level.id} downsample does not match its dimensions`)
    }
  }
  const primary = levels.find(({ id }) => id === value.primaryLevelId)
  if (primary === undefined) throw invalidInput('Geo primaryLevelId is unavailable')
  const grid = normalizeGeoGridGeometry(value.grid, limits)
  if (
    primary.geometry.width !== grid.width ||
    primary.geometry.height !== grid.height ||
    !sameAffine(primary.geometry.pixelToWorld, grid.pixelToWorld) ||
    primary.geometry.pixelRegistration !== grid.pixelRegistration ||
    !sameBounds(primary.geometry.worldBounds, grid.worldBounds) ||
    !sameNoData(primary.geometry.noData, grid.noData) ||
    grid.spatialDimensions.x.id !== spatialX.id ||
    grid.spatialDimensions.y.id !== spatialY.id ||
    grid.spatialDimensions.x.dimensionIndex !== spatialX.dimensionIndex ||
    grid.spatialDimensions.y.dimensionIndex !== spatialY.dimensionIndex
  ) {
    throw invalidInput('Geo primary grid must match the primary level geometry')
  }
  const spatialReference = normalizeGeoSpatialReference(value.spatialReference, limits)
  const sourceFormat = Object.freeze({
    id: boundedString(value.sourceFormat.id, 'Geo source format id', limits.maxStringLength),
    ...(value.sourceFormat.name === undefined
      ? {}
      : {
          name: boundedString(
            value.sourceFormat.name,
            'Geo source format name',
            limits.maxStringLength,
          ),
        }),
    ...(value.sourceFormat.version === undefined
      ? {}
      : {
          version: boundedString(
            value.sourceFormat.version,
            'Geo source format version',
            limits.maxStringLength,
          ),
        }),
  })
  const formatEvidence = metadata(value.formatEvidence, limits, 'Geo format evidence')
  const descriptor: GeoRasterDescriptor = Object.freeze({
    schemaVersion: geoRasterSchemaVersion,
    id: boundedString(value.id, 'Geo raster id', limits.maxStringLength),
    ...(value.title === undefined
      ? {}
      : { title: boundedString(value.title, 'Geo raster title', limits.maxStringLength) }),
    shape: Object.freeze(dimensions.map(({ length }) => length)),
    dimensions,
    spatialDimensions: Object.freeze({ x: spatialX, y: spatialY }),
    axes,
    sampleType: value.sampleType,
    bands,
    levels,
    primaryLevelId: primary.id,
    spatialReference,
    grid,
    capabilities: Object.freeze({ ...value.capabilities }),
    sourceFormat,
    ...(formatEvidence === undefined ? {} : { formatEvidence }),
    diagnostics: diagnostics(value.diagnostics, limits, 'Geo raster diagnostics'),
  })
  validateDescriptorNoData(descriptor, componentCount)
  for (const level of descriptor.levels) {
    const x = descriptor.dimensions[descriptor.spatialDimensions.x.dimensionIndex]
    const y = descriptor.dimensions[descriptor.spatialDimensions.y.dimensionIndex]
    if (
      level.sourceResolutionLevel === 0 &&
      (level.width !== x?.length || level.height !== y?.length)
    ) {
      throw invalidInput('Geo source resolution level zero must match base spatial dimensions')
    }
    const levelNoData = level.geometry.noData
    if (levelNoData.kind === 'scalar') {
      validateNoDataValue(levelNoData.value, descriptor.sampleType, `Geo level ${level.id} nodata`)
    } else if (levelNoData.kind === 'components') {
      if (levelNoData.values.length !== componentCount) {
        throw invalidInput(`Geo level ${level.id} component nodata count is invalid`)
      }
      levelNoData.values.forEach((entry, index) => {
        validateNoDataValue(
          entry,
          descriptor.sampleType,
          `Geo level ${level.id} component nodata ${index}`,
        )
      })
    }
  }
  return descriptor
}

export const validateGeoRasterDescriptor = (
  value: Readonly<GeoRasterDescriptor>,
  componentCount: number,
  limits: Readonly<GeoValidationLimits> = {},
): void => {
  normalizeGeoRasterDescriptor(value, componentCount, limits)
}

export const normalizeGeoPixelRegion = (
  value: Readonly<GeoPixelRegion>,
  geometry: Readonly<Pick<GeoGridGeometry, 'width' | 'height'>>,
): GeoPixelRegion => {
  const x = nonNegativeInteger(value.x, 'Geo pixel region x')
  const y = nonNegativeInteger(value.y, 'Geo pixel region y')
  const width = positiveInteger(value.width, 'Geo pixel region width')
  const height = positiveInteger(value.height, 'Geo pixel region height')
  if (
    !Number.isSafeInteger(x + width) ||
    !Number.isSafeInteger(y + height) ||
    x + width > geometry.width ||
    y + height > geometry.height
  ) {
    throw invalidInput('Geo pixel region is outside the selected level')
  }
  return Object.freeze({ x, y, width, height })
}

export const geoWorldBoundsToPixelRegion = (
  boundsValue: Readonly<GeoBounds>,
  geometry: Readonly<GeoGridGeometry>,
  clamp = false,
): GeoPixelRegion => {
  const bounds = normalizeBounds(boundsValue, 'Geo world read bounds')
  const inverse = geometry.worldToPixel
  if (inverse === undefined)
    throw invalidInput('Geo world-region read requires an invertible affine')
  const corners = [
    transformPoint(inverse, bounds.minX, bounds.minY),
    transformPoint(inverse, bounds.maxX, bounds.minY),
    transformPoint(inverse, bounds.minX, bounds.maxY),
    transformPoint(inverse, bounds.maxX, bounds.maxY),
  ]
  const xs = corners.map((point) => point[0])
  const ys = corners.map((point) => point[1])
  let x = Math.floor(Math.min(...xs))
  let y = Math.floor(Math.min(...ys))
  let maximumX =
    geometry.pixelRegistration === 'pixel-is-point'
      ? Math.floor(Math.max(...xs)) + 1
      : Math.ceil(Math.max(...xs))
  let maximumY =
    geometry.pixelRegistration === 'pixel-is-point'
      ? Math.floor(Math.max(...ys)) + 1
      : Math.ceil(Math.max(...ys))
  if (clamp) {
    x = Math.max(0, x)
    y = Math.max(0, y)
    maximumX = Math.min(geometry.width, maximumX)
    maximumY = Math.min(geometry.height, maximumY)
  }
  if (maximumX <= x || maximumY <= y) throw invalidInput('Geo world region selects no pixels')
  return normalizeGeoPixelRegion({ x, y, width: maximumX - x, height: maximumY - y }, geometry)
}

export const geoViewPlaneCount = (
  selection: Readonly<GeoRasterViewSelection>,
  descriptor: Readonly<GeoRasterDescriptor>,
  limitsValue: Readonly<GeoValidationLimits> = {},
): number => {
  const limits = resolveGeoValidationLimits(limitsValue)
  let result = 1
  for (const entry of selection.nonSpatial) {
    const axis = descriptor.axes.find(({ id }) => id === entry.axisId)
    if (axis === undefined) throw invalidInput(`Geo view axis ${entry.axisId} is unavailable`)
    const count = entry.kind === 'index' ? 1 : entry.length
    result *= count
    if (!Number.isSafeInteger(result) || result > limits.maxViewPlanes) {
      throw limitExceeded('Geo view selection exceeds maxViewPlanes')
    }
  }
  return result
}

export const geoSelectionToScientificRequest = (
  selection: Readonly<GeoRasterViewSelection>,
  level: Readonly<GeoRasterLevel>,
  fixedIndices: readonly GeoAxisIndex[],
  region: Readonly<GeoPixelRegion>,
  signal?: AbortSignal,
): ScientificPlaneReadRequest =>
  Object.freeze({
    displayAxes: selection.spatialDimensions,
    fixedIndices: Object.freeze(fixedIndices.map(({ axisId, index }) => ({ axisId, index }))),
    resolutionLevel: level.sourceResolutionLevel,
    x: region.x,
    y: region.y,
    width: region.width,
    height: region.height,
    ...(signal === undefined ? {} : { signal }),
  })
