import type {
  GeoAffineTransform,
  GeoBounds,
  GeoGridGeometry,
  GeoPixelRegistration,
} from '../../contracts.ts'
import { createGeoGridGeometry, invertGeoAffine } from '../../contracts.ts'
import type { GeoZarrConventionMode, GeoZarrDiagnostic } from './diagnostics.ts'
import { geoZarrDiagnostic } from './diagnostics.ts'
import { geoZarrSpatialConvention } from './registry.ts'
import type { GeoZarrJsonObject, ResolvedGeoZarrConventionLimits } from './validation.ts'
import {
  geoZarrAffine,
  geoZarrBounds,
  geoZarrBoundsEqual,
  geoZarrModeSeverity,
  geoZarrPositiveIntegerPair,
  geoZarrString,
  geoZarrStringPair,
  geoZarrUnknownFields,
} from './validation.ts'

export interface GeoZarrSpatialContext {
  readonly path: string
  readonly nodeType: 'group' | 'array'
  readonly shape?: readonly number[]
  readonly dimensionNames?: readonly (string | null)[]
}

export interface GeoZarrSpatialMetadata {
  /** Convention order is [logical Y, logical X]. */
  readonly dimensions?: readonly [y: string, x: string]
  readonly sourceDimensionIndices?: readonly [y: number, x: number]
  readonly shape?: readonly [height: number, width: number]
  readonly transformType: string
  readonly affine?: GeoAffineTransform
  readonly inverseAffine?: GeoAffineTransform
  readonly bounds?: GeoBounds
  readonly registration: 'pixel' | 'node'
  readonly pixelRegistration: GeoPixelRegistration
  readonly geometry?: GeoGridGeometry
  readonly additional: GeoZarrJsonObject
}

export interface GeoZarrSpatialParseResult {
  readonly value?: GeoZarrSpatialMetadata
  readonly diagnostics: readonly GeoZarrDiagnostic[]
}

const spatialKeys = new Set([
  'spatial:dimensions',
  'spatial:bbox',
  'spatial:transform_type',
  'spatial:transform',
  'spatial:shape',
  'spatial:registration',
])

const spatialAdditional = (
  attributes: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> =>
  Object.fromEntries(
    Object.entries(attributes).filter(
      ([key]) => key.startsWith('spatial:') && !spatialKeys.has(key),
    ),
  )

const sourceIndices = (
  dimensions: readonly [string, string] | undefined,
  names: readonly (string | null)[] | undefined,
  diagnostics: GeoZarrDiagnostic[],
  context: GeoZarrSpatialContext,
): readonly [number, number] | undefined => {
  if (dimensions === undefined || names === undefined) return undefined
  if (dimensions[0] === dimensions[1]) {
    diagnostics.push(
      geoZarrDiagnostic(
        'error',
        'spatial-dimension-duplicate',
        'spatial:dimensions must name two distinct dimensions',
        `${context.path}.spatial:dimensions`,
        geoZarrSpatialConvention.uuid,
      ),
    )
    return undefined
  }
  const y = names.indexOf(dimensions[0])
  const x = names.indexOf(dimensions[1])
  if (y < 0 || x < 0) {
    diagnostics.push(
      geoZarrDiagnostic(
        'error',
        'spatial-dimension-missing',
        'spatial:dimensions entries must exist in Zarr dimension_names',
        `${context.path}.spatial:dimensions`,
        geoZarrSpatialConvention.uuid,
      ),
    )
    return undefined
  }
  return Object.freeze([y, x] as const)
}

const inferredShape = (
  declared: readonly [number, number] | undefined,
  indices: readonly [number, number] | undefined,
  sourceShape: readonly number[] | undefined,
): readonly [number, number] | undefined => {
  if (declared !== undefined) return declared
  if (indices === undefined || sourceShape === undefined) return undefined
  const height = sourceShape[indices[0]]
  const width = sourceShape[indices[1]]
  return height === undefined || width === undefined || height < 1 || width < 1
    ? undefined
    : Object.freeze([height, width] as const)
}

export const parseGeoZarrSpatialMetadata = (
  attributes: Readonly<Record<string, unknown>>,
  context: GeoZarrSpatialContext,
  mode: GeoZarrConventionMode,
  limits: ResolvedGeoZarrConventionLimits,
): GeoZarrSpatialParseResult => {
  const diagnostics: GeoZarrDiagnostic[] = []
  const hasSpatialField = [...spatialKeys].some((key) => attributes[key] !== undefined)
  if (!hasSpatialField) return Object.freeze({ diagnostics: Object.freeze([]) })
  const dimensions = geoZarrStringPair(attributes['spatial:dimensions'])
  if (context.nodeType === 'array' && dimensions === undefined) {
    diagnostics.push(
      geoZarrDiagnostic(
        'error',
        'invalid-spatial-metadata',
        'Arrays using the spatial convention require two spatial:dimensions',
        `${context.path}.spatial:dimensions`,
        geoZarrSpatialConvention.uuid,
      ),
    )
  } else if (attributes['spatial:dimensions'] !== undefined && dimensions === undefined) {
    diagnostics.push(
      geoZarrDiagnostic(
        'error',
        'invalid-spatial-metadata',
        'spatial:dimensions must contain two strings',
        `${context.path}.spatial:dimensions`,
        geoZarrSpatialConvention.uuid,
      ),
    )
  }
  const indices = sourceIndices(dimensions, context.dimensionNames, diagnostics, context)
  if (
    context.nodeType === 'array' &&
    dimensions !== undefined &&
    context.dimensionNames === undefined
  ) {
    diagnostics.push(
      geoZarrDiagnostic(
        'error',
        'spatial-dimension-missing',
        'Spatial arrays require Zarr dimension_names or an extracted v2 dimension-name equivalent',
        context.path,
        geoZarrSpatialConvention.uuid,
      ),
    )
  }
  const declaredShape = geoZarrPositiveIntegerPair(attributes['spatial:shape'])
  if (attributes['spatial:shape'] !== undefined && declaredShape === undefined) {
    diagnostics.push(
      geoZarrDiagnostic(
        'error',
        'invalid-spatial-metadata',
        'spatial:shape must contain two positive integers',
        `${context.path}.spatial:shape`,
        geoZarrSpatialConvention.uuid,
      ),
    )
  }
  if (declaredShape !== undefined && indices !== undefined && context.shape !== undefined) {
    const sourceHeight = context.shape[indices[0]]
    const sourceWidth = context.shape[indices[1]]
    if (sourceHeight !== declaredShape[0] || sourceWidth !== declaredShape[1]) {
      diagnostics.push(
        geoZarrDiagnostic(
          'error',
          'spatial-shape-mismatch',
          'spatial:shape disagrees with the selected Zarr dimensions',
          `${context.path}.spatial:shape`,
          geoZarrSpatialConvention.uuid,
        ),
      )
    }
  }
  const shape = inferredShape(declaredShape, indices, context.shape)
  const transformType = geoZarrString(attributes['spatial:transform_type']) ?? 'affine'
  if (
    attributes['spatial:transform_type'] !== undefined &&
    geoZarrString(attributes['spatial:transform_type']) === undefined
  ) {
    diagnostics.push(
      geoZarrDiagnostic(
        'error',
        'invalid-spatial-metadata',
        'spatial:transform_type must be a non-empty string',
        `${context.path}.spatial:transform_type`,
        geoZarrSpatialConvention.uuid,
      ),
    )
  }
  let affine: GeoAffineTransform | undefined
  if (transformType === 'affine') {
    affine = geoZarrAffine(attributes['spatial:transform'])
    if (
      affine === undefined &&
      (context.nodeType === 'array' || attributes['spatial:transform_type'] !== undefined)
    ) {
      diagnostics.push(
        geoZarrDiagnostic(
          'error',
          'invalid-spatial-metadata',
          'Affine spatial metadata requires six finite spatial:transform coefficients',
          `${context.path}.spatial:transform`,
          geoZarrSpatialConvention.uuid,
        ),
      )
    }
  } else {
    diagnostics.push(
      geoZarrDiagnostic(
        geoZarrModeSeverity(mode),
        'unsupported-spatial-transform',
        `Spatial transform type ${transformType} is not interpreted as affine`,
        `${context.path}.spatial:transform_type`,
        geoZarrSpatialConvention.uuid,
      ),
    )
  }
  const inverseAffine = affine === undefined ? undefined : invertGeoAffine(affine)
  if (affine !== undefined && inverseAffine === undefined) {
    diagnostics.push(
      geoZarrDiagnostic(
        'error',
        'non-invertible-spatial-transform',
        'spatial:transform is not invertible',
        `${context.path}.spatial:transform`,
        geoZarrSpatialConvention.uuid,
      ),
    )
  }
  const bounds = geoZarrBounds(attributes['spatial:bbox'])
  if (attributes['spatial:bbox'] !== undefined && bounds === undefined) {
    diagnostics.push(
      geoZarrDiagnostic(
        'error',
        'invalid-spatial-metadata',
        'spatial:bbox must be four finite ordered values',
        `${context.path}.spatial:bbox`,
        geoZarrSpatialConvention.uuid,
      ),
    )
  }
  const registrationValue = geoZarrString(attributes['spatial:registration']) ?? 'pixel'
  const registration = registrationValue === 'node' ? 'node' : 'pixel'
  if (registrationValue !== 'node' && registrationValue !== 'pixel') {
    diagnostics.push(
      geoZarrDiagnostic(
        'error',
        'invalid-spatial-metadata',
        'spatial:registration must be pixel or node',
        `${context.path}.spatial:registration`,
        geoZarrSpatialConvention.uuid,
      ),
    )
  }
  const pixelRegistration: GeoPixelRegistration =
    registration === 'node' ? 'pixel-is-point' : 'pixel-is-area'
  let geometry: GeoGridGeometry | undefined
  if (
    affine !== undefined &&
    shape !== undefined &&
    dimensions !== undefined &&
    indices !== undefined
  ) {
    geometry = createGeoGridGeometry({
      width: shape[1],
      height: shape[0],
      spatialDimensions: {
        x: { id: dimensions[1], name: dimensions[1], dimensionIndex: indices[1] },
        y: { id: dimensions[0], name: dimensions[0], dimensionIndex: indices[0] },
      },
      pixelToWorld: affine,
      pixelRegistration,
    })
    if (bounds !== undefined && !geoZarrBoundsEqual(bounds, geometry.worldBounds)) {
      diagnostics.push(
        geoZarrDiagnostic(
          geoZarrModeSeverity(mode),
          'spatial-bounds-mismatch',
          'spatial:bbox disagrees with transformed grid corners',
          `${context.path}.spatial:bbox`,
          geoZarrSpatialConvention.uuid,
        ),
      )
    }
  }
  let additional: GeoZarrJsonObject
  try {
    additional = geoZarrUnknownFields(
      spatialAdditional(attributes),
      new Set(),
      `${context.path}.spatialAdditional`,
      limits,
    )
  } catch (error) {
    additional = Object.freeze({})
    diagnostics.push(
      geoZarrDiagnostic(
        'error',
        'metadata-limit-exceeded',
        error instanceof Error ? error.message : 'Spatial additive metadata exceeds limits',
        context.path,
        geoZarrSpatialConvention.uuid,
      ),
    )
  }
  return Object.freeze({
    value: Object.freeze({
      ...(dimensions === undefined ? {} : { dimensions }),
      ...(indices === undefined ? {} : { sourceDimensionIndices: indices }),
      ...(shape === undefined ? {} : { shape }),
      transformType,
      ...(affine === undefined ? {} : { affine }),
      ...(inverseAffine === undefined ? {} : { inverseAffine }),
      ...(bounds === undefined ? {} : { bounds }),
      registration,
      pixelRegistration,
      ...(geometry === undefined ? {} : { geometry }),
      additional,
    }),
    diagnostics: Object.freeze(diagnostics),
  })
}
