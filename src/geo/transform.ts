import { throwIfAborted } from '../abort.ts'
import { invalidInput, unsupportedOperation } from '../errors.ts'
import type { GeoBounds, GeoSpatialReference, GeoWrappedBounds } from './contracts.ts'
import { canonicalGeoSpatialReferenceIdentity, geoSpatialReferencesEqual } from './grid.ts'

export type GeoTransformAccuracy =
  | { readonly kind: 'exact' }
  | { readonly kind: 'estimated'; readonly maximumError: number; readonly unit: string }
  | { readonly kind: 'unknown' }

export interface GeoTransformAreaOfUse {
  readonly bounds: GeoBounds
  readonly geographicBounds?: GeoWrappedBounds
  readonly name?: string
}

export interface GeoCoordinateTransformer {
  readonly sourceCrs: GeoSpatialReference
  readonly destinationCrs: GeoSpatialReference
  readonly transformIdentity: string
  readonly implementationIdentity: string
  readonly accuracy: GeoTransformAccuracy
  readonly areaOfUse?: GeoTransformAreaOfUse
  readonly warnings: readonly string[]
  forward(sourceX: number, sourceY: number): readonly [destinationX: number, destinationY: number]
  inverse?(destinationX: number, destinationY: number): readonly [sourceX: number, sourceY: number]
  dispose?(): void | Promise<void>
}

export interface GeoCoordinateTransformProvider {
  readonly implementationIdentity: string
  createTransformer(
    sourceCrs: Readonly<GeoSpatialReference>,
    destinationCrs: Readonly<GeoSpatialReference>,
    options?: Readonly<{ readonly signal?: AbortSignal }>,
  ): GeoCoordinateTransformer | Promise<GeoCoordinateTransformer>
}

const boundedIdentity = (value: string, name: string): string => {
  const result = value.trim()
  if (result.length < 1 || result.length > 4_096) throw invalidInput(`${name} is invalid`)
  return result
}

const coordinate = (value: readonly number[], name: string): readonly [number, number] => {
  if (value.length !== 2 || !Number.isFinite(value[0]) || !Number.isFinite(value[1])) {
    throw invalidInput(`${name} returned an invalid coordinate`)
  }
  return Object.freeze([value[0] ?? 0, value[1] ?? 0] as const)
}

export const createIdentityGeoCoordinateTransformer = (
  crs: Readonly<GeoSpatialReference>,
): GeoCoordinateTransformer => {
  const identity = canonicalGeoSpatialReferenceIdentity(crs)
  const transformIdentity = `purejsimage.geo.identity.v1:${identity}`
  const point = (x: number, y: number): readonly [number, number] => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      throw invalidInput('Identity coordinate transform requires finite coordinates')
    }
    return Object.freeze([x, y] as const)
  }
  return Object.freeze({
    sourceCrs: crs,
    destinationCrs: crs,
    transformIdentity,
    implementationIdentity: 'purejsimage.geo.identity.v1',
    accuracy: Object.freeze({ kind: 'exact' as const }),
    warnings: Object.freeze([]),
    forward: point,
    inverse: point,
  })
}

export const validateGeoCoordinateTransformer = (
  value: Readonly<GeoCoordinateTransformer>,
  sourceCrs: Readonly<GeoSpatialReference>,
  destinationCrs: Readonly<GeoSpatialReference>,
): GeoCoordinateTransformer => {
  if (!geoSpatialReferencesEqual(value.sourceCrs, sourceCrs)) {
    throw invalidInput('Coordinate transformer source CRS does not match the request')
  }
  if (!geoSpatialReferencesEqual(value.destinationCrs, destinationCrs)) {
    throw invalidInput('Coordinate transformer destination CRS does not match the request')
  }
  boundedIdentity(value.transformIdentity, 'transformIdentity')
  boundedIdentity(value.implementationIdentity, 'implementationIdentity')
  if (value.accuracy.kind === 'estimated') {
    if (!Number.isFinite(value.accuracy.maximumError) || value.accuracy.maximumError < 0) {
      throw invalidInput('Estimated transform accuracy must have a non-negative finite error')
    }
    boundedIdentity(value.accuracy.unit, 'transform accuracy unit')
  } else if (value.accuracy.kind !== 'exact' && value.accuracy.kind !== 'unknown') {
    throw invalidInput('Unsupported coordinate transform accuracy')
  }
  return value
}

export const resolveGeoCoordinateTransformer = async (
  sourceCrs: Readonly<GeoSpatialReference>,
  destinationCrs: Readonly<GeoSpatialReference>,
  options: Readonly<{
    readonly transformer?: GeoCoordinateTransformer
    readonly provider?: GeoCoordinateTransformProvider
    readonly signal?: AbortSignal
  }> = {},
): Promise<{
  readonly transformer: GeoCoordinateTransformer
  readonly owned: boolean
  readonly identity: boolean
}> => {
  throwIfAborted(options.signal)
  if (options.transformer !== undefined && options.provider !== undefined) {
    throw invalidInput('Provide either a coordinate transformer or a transform provider')
  }
  if (options.transformer !== undefined) {
    return Object.freeze({
      transformer: validateGeoCoordinateTransformer(options.transformer, sourceCrs, destinationCrs),
      owned: false,
      identity: false,
    })
  }
  if (geoSpatialReferencesEqual(sourceCrs, destinationCrs)) {
    return Object.freeze({
      transformer: createIdentityGeoCoordinateTransformer(sourceCrs),
      owned: false,
      identity: true,
    })
  }
  if (options.provider === undefined) {
    throw unsupportedOperation('Cross-CRS operation requires a caller-supplied transform provider')
  }
  boundedIdentity(options.provider.implementationIdentity, 'transform provider identity')
  const transformer = await options.provider.createTransformer(sourceCrs, destinationCrs, {
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  })
  try {
    throwIfAborted(options.signal)
    return Object.freeze({
      transformer: validateGeoCoordinateTransformer(transformer, sourceCrs, destinationCrs),
      owned: true,
      identity: false,
    })
  } catch (error: unknown) {
    await transformer.dispose?.()
    throw error
  }
}

export const transformGeoBounds = (
  bounds: Readonly<GeoBounds>,
  transformer: Readonly<GeoCoordinateTransformer>,
  options: Readonly<{
    readonly direction?: 'forward' | 'inverse'
    readonly samplesPerEdge?: number
    readonly signal?: AbortSignal
  }> = {},
): GeoBounds => {
  const direction = options.direction ?? 'forward'
  const transform = direction === 'forward' ? transformer.forward : transformer.inverse
  if (transform === undefined) {
    throw unsupportedOperation('Coordinate transformer does not provide an inverse transform')
  }
  const samplesPerEdge = options.samplesPerEdge ?? 16
  if (!Number.isSafeInteger(samplesPerEdge) || samplesPerEdge < 1 || samplesPerEdge > 4_096) {
    throw invalidInput('samplesPerEdge must be in [1, 4096]')
  }
  if (
    !Number.isFinite(bounds.minX) ||
    !Number.isFinite(bounds.minY) ||
    !Number.isFinite(bounds.maxX) ||
    !Number.isFinite(bounds.maxY) ||
    bounds.minX > bounds.maxX ||
    bounds.minY > bounds.maxY
  ) {
    throw invalidInput('Bounds to transform must be finite and ordered')
  }
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  const add = (x: number, y: number): void => {
    const result = coordinate(transform.call(transformer, x, y), 'Coordinate transform')
    minX = Math.min(minX, result[0])
    minY = Math.min(minY, result[1])
    maxX = Math.max(maxX, result[0])
    maxY = Math.max(maxY, result[1])
  }
  for (let index = 0; index <= samplesPerEdge; index += 1) {
    if ((index & 255) === 0) throwIfAborted(options.signal)
    const fraction = index / samplesPerEdge
    const x = bounds.minX + (bounds.maxX - bounds.minX) * fraction
    const y = bounds.minY + (bounds.maxY - bounds.minY) * fraction
    add(x, bounds.minY)
    add(x, bounds.maxY)
    add(bounds.minX, y)
    add(bounds.maxX, y)
  }
  return Object.freeze({ minX, minY, maxX, maxY })
}

export type Proj4CompatibleFunction = (
  sourceCrs: string,
  destinationCrs: string,
  coordinate: readonly [number, number],
) => unknown

export interface Proj4CompatibleObject {
  forward(coordinate: readonly [number, number]): unknown
  inverse?(coordinate: readonly [number, number]): unknown
}

export type Proj4CompatibleFactory = (
  sourceCrs: string,
  destinationCrs: string,
) => Proj4CompatibleObject

export type Proj4CompatibleAdapter =
  | { readonly transform: Proj4CompatibleFunction }
  | { readonly create: Proj4CompatibleFactory }

const proj4CrsText = (value: Readonly<GeoSpatialReference>): string => {
  if (value.authority !== undefined && value.code !== undefined) {
    return `${value.authority}:${String(value.code)}`
  }
  if (value.wkt2 !== undefined) return value.wkt2
  if (value.name !== undefined) return value.name
  throw unsupportedOperation('A proj4-compatible adapter requires a CRS code, WKT2, or name')
}

const proj4Coordinate = (value: unknown): readonly [number, number] => {
  if (
    !Array.isArray(value) ||
    value.length !== 2 ||
    typeof value[0] !== 'number' ||
    typeof value[1] !== 'number'
  ) {
    throw invalidInput('proj4-compatible transform returned an invalid coordinate')
  }
  return coordinate(value, 'proj4-compatible transform')
}

export const createProj4CompatibleTransformProvider = (
  adapter: Proj4CompatibleAdapter,
  options: Readonly<{
    readonly implementationIdentity: string
    readonly accuracy?: GeoTransformAccuracy
  }>,
): GeoCoordinateTransformProvider => {
  const implementationIdentity = boundedIdentity(
    options.implementationIdentity,
    'proj4 implementation identity',
  )
  return Object.freeze({
    implementationIdentity,
    createTransformer(
      sourceCrs: Readonly<GeoSpatialReference>,
      destinationCrs: Readonly<GeoSpatialReference>,
    ): GeoCoordinateTransformer {
      const source = proj4CrsText(sourceCrs)
      const destination = proj4CrsText(destinationCrs)
      const transformIdentity = `proj4-compatible:${source}->${destination}`
      if ('transform' in adapter) {
        const transform = adapter.transform
        return Object.freeze({
          sourceCrs,
          destinationCrs,
          transformIdentity,
          implementationIdentity,
          accuracy: options.accuracy ?? Object.freeze({ kind: 'unknown' as const }),
          warnings: Object.freeze([]),
          forward: (x: number, y: number) =>
            proj4Coordinate(transform(source, destination, [x, y])),
          inverse: (x: number, y: number) =>
            proj4Coordinate(transform(destination, source, [x, y])),
        })
      }
      const transform = adapter.create(source, destination)
      const inverse = transform.inverse
      return Object.freeze({
        sourceCrs,
        destinationCrs,
        transformIdentity,
        implementationIdentity,
        accuracy: options.accuracy ?? Object.freeze({ kind: 'unknown' as const }),
        warnings: Object.freeze([]),
        forward: (x: number, y: number) => proj4Coordinate(transform.forward([x, y])),
        ...(inverse === undefined
          ? {}
          : {
              inverse: (x: number, y: number) => proj4Coordinate(inverse.call(transform, [x, y])),
            }),
      })
    },
  })
}
