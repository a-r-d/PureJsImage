import type { GeoAffineTransform, GeoBounds } from '../../contracts.ts'
import type {
  GeoZarrConventionMode,
  GeoZarrDiagnostic,
  GeoZarrDiagnosticCode,
} from './diagnostics.ts'
import { geoZarrDiagnostic } from './diagnostics.ts'

export type GeoZarrJsonPrimitive = string | number | boolean | null
export interface GeoZarrJsonArray extends ReadonlyArray<GeoZarrJsonValue> {}
export interface GeoZarrJsonObject {
  readonly [key: string]: GeoZarrJsonValue
}
export type GeoZarrJsonValue = GeoZarrJsonPrimitive | GeoZarrJsonArray | GeoZarrJsonObject

export interface GeoZarrConventionLimits {
  readonly maxRegistrations?: number
  readonly maxLevels?: number
  readonly maxAttributes?: number
  readonly maxJsonDepth?: number
  readonly maxJsonValues?: number
  readonly maxStringLength?: number
}

export interface ResolvedGeoZarrConventionLimits {
  readonly maxRegistrations: number
  readonly maxLevels: number
  readonly maxAttributes: number
  readonly maxJsonDepth: number
  readonly maxJsonValues: number
  readonly maxStringLength: number
}

export const defaultGeoZarrConventionLimits: ResolvedGeoZarrConventionLimits = Object.freeze({
  maxRegistrations: 64,
  maxLevels: 256,
  maxAttributes: 1_024,
  maxJsonDepth: 24,
  maxJsonValues: 65_536,
  maxStringLength: 65_536,
})

const positiveLimit = (value: number | undefined, fallback: number, label: string): number => {
  const resolved = value ?? fallback
  if (!Number.isSafeInteger(resolved) || resolved < 1) {
    throw new RangeError(`${label} must be a positive safe integer`)
  }
  return resolved
}

export const resolveGeoZarrConventionLimits = (
  value: Readonly<GeoZarrConventionLimits> = {},
): ResolvedGeoZarrConventionLimits =>
  Object.freeze({
    maxRegistrations: positiveLimit(
      value.maxRegistrations,
      defaultGeoZarrConventionLimits.maxRegistrations,
      'maxRegistrations',
    ),
    maxLevels: positiveLimit(
      value.maxLevels,
      defaultGeoZarrConventionLimits.maxLevels,
      'maxLevels',
    ),
    maxAttributes: positiveLimit(
      value.maxAttributes,
      defaultGeoZarrConventionLimits.maxAttributes,
      'maxAttributes',
    ),
    maxJsonDepth: positiveLimit(
      value.maxJsonDepth,
      defaultGeoZarrConventionLimits.maxJsonDepth,
      'maxJsonDepth',
    ),
    maxJsonValues: positiveLimit(
      value.maxJsonValues,
      defaultGeoZarrConventionLimits.maxJsonValues,
      'maxJsonValues',
    ),
    maxStringLength: positiveLimit(
      value.maxStringLength,
      defaultGeoZarrConventionLimits.maxStringLength,
      'maxStringLength',
    ),
  })

export const isGeoZarrRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

export const normalizeGeoZarrJsonObject = (
  value: unknown,
  label: string,
  limits: ResolvedGeoZarrConventionLimits,
): GeoZarrJsonObject => {
  if (!isGeoZarrRecord(value)) throw new TypeError(`${label} must be a JSON object`)
  let count = 0
  const visit = (entry: unknown, path: string, depth: number): GeoZarrJsonValue => {
    count += 1
    if (count > limits.maxJsonValues) throw new RangeError(`${label} exceeds maxJsonValues`)
    if (depth > limits.maxJsonDepth) throw new RangeError(`${label} exceeds maxJsonDepth`)
    if (entry === null || typeof entry === 'boolean') return entry
    if (typeof entry === 'number') {
      if (!Number.isFinite(entry)) throw new TypeError(`${path} must be finite JSON data`)
      return entry
    }
    if (typeof entry === 'string') {
      if (entry.length > limits.maxStringLength) throw new RangeError(`${path} is too long`)
      return entry
    }
    if (Array.isArray(entry)) {
      return Object.freeze(
        entry.map((child, index) => visit(child, `${path}[${index}]`, depth + 1)),
      )
    }
    if (!isGeoZarrRecord(entry)) throw new TypeError(`${path} is not JSON-safe`)
    const keys = Object.keys(entry)
    if (keys.length > limits.maxAttributes) throw new RangeError(`${path} has too many fields`)
    const output: Record<string, GeoZarrJsonValue> = {}
    for (const key of keys) {
      if (key.length > limits.maxStringLength) throw new RangeError(`${path} has an oversized key`)
      output[key] = visit(entry[key], `${path}.${key}`, depth + 1)
    }
    return Object.freeze(output)
  }
  return visit(value, label, 0) as GeoZarrJsonObject
}

export const geoZarrUnknownFields = (
  value: Readonly<Record<string, unknown>>,
  known: ReadonlySet<string>,
  label: string,
  limits: ResolvedGeoZarrConventionLimits,
): GeoZarrJsonObject => {
  const output: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(value)) {
    if (!known.has(key)) output[key] = entry
  }
  return normalizeGeoZarrJsonObject(output, label, limits)
}

export const geoZarrString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.length > 0 ? value : undefined

export const geoZarrFiniteArray = (
  value: unknown,
  length?: number,
): readonly number[] | undefined => {
  if (!Array.isArray(value) || (length !== undefined && value.length !== length)) return undefined
  if (
    !value.every((entry): entry is number => typeof entry === 'number' && Number.isFinite(entry))
  ) {
    return undefined
  }
  return Object.freeze([...value])
}

export const geoZarrPositiveIntegerPair = (
  value: unknown,
): readonly [number, number] | undefined => {
  if (!Array.isArray(value) || value.length !== 2) {
    return undefined
  }
  const first = value[0]
  const second = value[1]
  if (
    typeof first !== 'number' ||
    typeof second !== 'number' ||
    !Number.isSafeInteger(first) ||
    !Number.isSafeInteger(second) ||
    first < 1 ||
    second < 1
  ) {
    return undefined
  }
  return Object.freeze([first, second] as const)
}

export const geoZarrStringPair = (value: unknown): readonly [string, string] | undefined => {
  if (!Array.isArray(value) || value.length !== 2) {
    return undefined
  }
  const first = value[0]
  const second = value[1]
  if (
    typeof first !== 'string' ||
    typeof second !== 'string' ||
    first.length === 0 ||
    second.length === 0
  ) {
    return undefined
  }
  return Object.freeze([first, second] as const)
}

export const geoZarrAffine = (value: unknown): GeoAffineTransform | undefined => {
  const numbers = geoZarrFiniteArray(value, 6)
  return numbers === undefined
    ? undefined
    : Object.freeze([
        numbers[0] ?? 0,
        numbers[1] ?? 0,
        numbers[2] ?? 0,
        numbers[3] ?? 0,
        numbers[4] ?? 0,
        numbers[5] ?? 0,
      ] as const)
}

export const geoZarrBounds = (value: unknown): GeoBounds | undefined => {
  const numbers = geoZarrFiniteArray(value, 4)
  if (
    numbers === undefined ||
    (numbers[0] ?? 0) > (numbers[2] ?? 0) ||
    (numbers[1] ?? 0) > (numbers[3] ?? 0)
  ) {
    return undefined
  }
  return Object.freeze({
    minX: numbers[0] ?? 0,
    minY: numbers[1] ?? 0,
    maxX: numbers[2] ?? 0,
    maxY: numbers[3] ?? 0,
  })
}

export const geoZarrModeSeverity = (mode: GeoZarrConventionMode): 'warning' | 'error' =>
  mode === 'strict' ? 'error' : 'warning'

export const pushGeoZarrDiagnostic = (
  diagnostics: GeoZarrDiagnostic[],
  mode: GeoZarrConventionMode,
  code: GeoZarrDiagnosticCode,
  message: string,
  path: string,
  conventionUuid?: string,
): void => {
  diagnostics.push(
    geoZarrDiagnostic(geoZarrModeSeverity(mode), code, message, path, conventionUuid),
  )
}

const closeNumber = (left: number, right: number): boolean =>
  Math.abs(left - right) <= Math.max(1, Math.abs(left), Math.abs(right)) * 1e-9

export const geoZarrBoundsEqual = (left: GeoBounds, right: GeoBounds): boolean =>
  closeNumber(left.minX, right.minX) &&
  closeNumber(left.minY, right.minY) &&
  closeNumber(left.maxX, right.maxX) &&
  closeNumber(left.maxY, right.maxY)

export const isSafeGeoZarrPath = (value: string): boolean =>
  !value.startsWith('/') &&
  !value.endsWith('/') &&
  !value.includes('\\') &&
  !value.split('/').some((part) => part.length === 0 || part === '.' || part === '..')
