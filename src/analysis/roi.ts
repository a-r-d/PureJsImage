import { invalidInput } from '../errors.ts'
import type { OperationJsonObject, OperationValidationIssue } from '../operations/descriptor.ts'
import { normalizeOperationJsonObject } from '../operations/descriptor.ts'
import { createValueTypeDefinition, createValueTypeRegistry } from '../operations/registry.ts'
import type { ValueTypeDefinition, ValueTypeRegistry } from '../operations/registry.ts'
import type {
  NormalizedScientificDatasetDescriptor,
  ScientificAxisDescriptor,
  ScientificAxisIndex,
} from '../scientific/dataset-v2.ts'
import { canonicalJson } from './canonical-json.ts'

export const roiSchemaVersion = 1
export const roiValueTypeId = 'purejsimage.roi'
export const roiSetValueTypeId = 'purejsimage.roi-set'

export interface RoiPoint {
  readonly x: number
  readonly y: number
}

export type RoiGeometry =
  | { readonly kind: 'point'; readonly point: RoiPoint }
  | { readonly kind: 'line-segment'; readonly start: RoiPoint; readonly end: RoiPoint }
  | { readonly kind: 'polyline'; readonly points: readonly RoiPoint[] }
  | {
      readonly kind: 'rectangle'
      readonly x: number
      readonly y: number
      readonly width: number
      readonly height: number
    }
  | {
      readonly kind: 'ellipse'
      readonly center: RoiPoint
      readonly radiusX: number
      readonly radiusY: number
    }
  | { readonly kind: 'polygon'; readonly points: readonly RoiPoint[] }

export interface RoiPresentation {
  readonly label?: string
  readonly style?: OperationJsonObject
}

interface RoiBase {
  readonly schemaVersion: 1
  readonly id: string
  readonly name?: string
  readonly axisIds: readonly [xAxisId: string, yAxisId: string]
  readonly fixedIndices: readonly ScientificAxisIndex[]
  readonly geometry: RoiGeometry
  readonly presentation?: RoiPresentation
}

export type Roi =
  | (RoiBase & { readonly coordinateSpace: 'pixel'; readonly units?: never })
  | (RoiBase & {
      readonly coordinateSpace: 'physical'
      readonly units: readonly [xUnit: string | null, yUnit: string | null]
    })

export interface RoiSet {
  readonly schemaVersion: 1
  readonly rois: readonly Roi[]
  readonly name?: string
  readonly presentation?: RoiPresentation
}

export interface RoiLimits {
  readonly maxRois?: number
  readonly maxPointsPerGeometry?: number
  readonly maxCoordinateMagnitude?: number
  readonly maxMetadataDepth?: number
  readonly maxMetadataBytes?: number
  readonly maxStringLength?: number
}

export interface ResolvedRoiLimits {
  readonly maxRois: number
  readonly maxPointsPerGeometry: number
  readonly maxCoordinateMagnitude: number
  readonly maxMetadataDepth: number
  readonly maxMetadataBytes: number
  readonly maxStringLength: number
}

export const defaultRoiLimits: ResolvedRoiLimits = Object.freeze({
  maxRois: 10_000,
  maxPointsPerGeometry: 100_000,
  maxCoordinateMagnitude: 1_000_000_000_000,
  maxMetadataDepth: 16,
  maxMetadataBytes: 1_048_576,
  maxStringLength: 4_096,
})

const positiveLimit = (value: number | undefined, fallback: number, name: string): number => {
  if (value === undefined) return fallback
  if (!Number.isSafeInteger(value) || value < 1) throw invalidInput(`${name} must be positive`)
  return value
}

export const resolveRoiLimits = (limits: Readonly<RoiLimits> = {}): ResolvedRoiLimits => {
  const magnitude = limits.maxCoordinateMagnitude ?? defaultRoiLimits.maxCoordinateMagnitude
  if (!Number.isFinite(magnitude) || magnitude <= 0) {
    throw invalidInput('maxCoordinateMagnitude must be positive and finite')
  }
  return Object.freeze({
    maxRois: positiveLimit(limits.maxRois, defaultRoiLimits.maxRois, 'maxRois'),
    maxPointsPerGeometry: positiveLimit(
      limits.maxPointsPerGeometry,
      defaultRoiLimits.maxPointsPerGeometry,
      'maxPointsPerGeometry',
    ),
    maxCoordinateMagnitude: magnitude,
    maxMetadataDepth: positiveLimit(
      limits.maxMetadataDepth,
      defaultRoiLimits.maxMetadataDepth,
      'maxMetadataDepth',
    ),
    maxMetadataBytes: positiveLimit(
      limits.maxMetadataBytes,
      defaultRoiLimits.maxMetadataBytes,
      'maxMetadataBytes',
    ),
    maxStringLength: positiveLimit(
      limits.maxStringLength,
      defaultRoiLimits.maxStringLength,
      'maxStringLength',
    ),
  })
}

type UnknownRecord = Readonly<Record<string, unknown>>
const isRecord = (value: unknown): value is UnknownRecord =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

class RoiValidationFailure extends Error {
  readonly code: OperationValidationIssue['code']
  readonly path: string

  constructor(code: OperationValidationIssue['code'], path: string, message: string) {
    super(message)
    this.code = code
    this.path = path
  }
}

const fail = (code: OperationValidationIssue['code'], path: string, message: string): never => {
  throw new RoiValidationFailure(code, path, message)
}

const record = (value: unknown, path: string): UnknownRecord => {
  if (!isRecord(value)) return fail('invalid-type', path, 'Expected an object')
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) {
    return fail('invalid-type', path, 'Expected a plain object')
  }
  if (Object.getOwnPropertySymbols(value).length !== 0) {
    return fail('invalid-value', path, 'Symbol keys are not JSON-safe')
  }
  for (const key of Object.keys(value)) {
    const property = Object.getOwnPropertyDescriptor(value, key)
    if (property === undefined || !('value' in property)) {
      return fail('invalid-type', `${path}/${key}`, 'Expected a JSON data property')
    }
  }
  return value
}

const exactKeys = (value: UnknownRecord, allowed: readonly string[], path: string): void => {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) fail('unknown-field', `${path}/${key}`, `Unknown field ${key}`)
  }
}

const string = (value: unknown, path: string, limits: ResolvedRoiLimits): string => {
  if (
    typeof value !== 'string' ||
    value.trim().length === 0 ||
    value.length > limits.maxStringLength
  ) {
    return fail('invalid-type', path, 'Expected a bounded non-empty string')
  }
  return value
}

const optionalString = (
  value: unknown,
  path: string,
  limits: ResolvedRoiLimits,
): string | undefined => (value === undefined ? undefined : string(value, path, limits))

const coordinate = (value: unknown, path: string, limits: ResolvedRoiLimits): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fail('non-finite', path, 'Expected a finite coordinate')
  }
  if (Math.abs(value) > limits.maxCoordinateMagnitude) {
    return fail('limit-exceeded', path, 'Coordinate exceeds maxCoordinateMagnitude')
  }
  return Object.is(value, -0) ? 0 : value
}

const point = (value: unknown, path: string, limits: ResolvedRoiLimits): RoiPoint => {
  const input = record(value, path)
  exactKeys(input, ['x', 'y'], path)
  return Object.freeze({
    x: coordinate(input.x, `${path}/x`, limits),
    y: coordinate(input.y, `${path}/y`, limits),
  })
}

const points = (
  value: unknown,
  path: string,
  minimum: number,
  limits: ResolvedRoiLimits,
): readonly RoiPoint[] => {
  if (!Array.isArray(value)) return fail('invalid-type', path, 'Expected a point array')
  if (value.length < minimum) {
    return fail('invalid-value', path, `Expected at least ${minimum} points`)
  }
  if (value.length > limits.maxPointsPerGeometry) {
    return fail('limit-exceeded', path, 'Geometry exceeds maxPointsPerGeometry')
  }
  const output: RoiPoint[] = []
  for (let index = 0; index < value.length; index += 1) {
    if (!(index in value))
      fail('invalid-value', `${path}/${index}`, 'Point arrays cannot have holes')
    output.push(point(value[index], `${path}/${index}`, limits))
  }
  return Object.freeze(output)
}

const geometry = (value: unknown, path: string, limits: ResolvedRoiLimits): RoiGeometry => {
  const input = record(value, path)
  if (input.kind === 'point') {
    exactKeys(input, ['kind', 'point'], path)
    return Object.freeze({ kind: 'point', point: point(input.point, `${path}/point`, limits) })
  }
  if (input.kind === 'line-segment') {
    exactKeys(input, ['kind', 'start', 'end'], path)
    const start = point(input.start, `${path}/start`, limits)
    const end = point(input.end, `${path}/end`, limits)
    if (start.x === end.x && start.y === end.y) {
      return fail('invalid-value', path, 'Line segment must have non-zero length')
    }
    return Object.freeze({ kind: 'line-segment', start, end })
  }
  if (input.kind === 'polyline' || input.kind === 'polygon') {
    exactKeys(input, ['kind', 'points'], path)
    return Object.freeze({
      kind: input.kind,
      points: points(input.points, `${path}/points`, input.kind === 'polygon' ? 3 : 2, limits),
    })
  }
  if (input.kind === 'rectangle') {
    exactKeys(input, ['kind', 'x', 'y', 'width', 'height'], path)
    const x = coordinate(input.x, `${path}/x`, limits)
    const y = coordinate(input.y, `${path}/y`, limits)
    const width = coordinate(input.width, `${path}/width`, limits)
    const height = coordinate(input.height, `${path}/height`, limits)
    if (width <= 0 || height <= 0) {
      return fail('out-of-range', path, 'Rectangle width and height must be positive')
    }
    coordinate(x + width, `${path}/xMax`, limits)
    coordinate(y + height, `${path}/yMax`, limits)
    return Object.freeze({ kind: 'rectangle', x, y, width, height })
  }
  if (input.kind === 'ellipse') {
    exactKeys(input, ['kind', 'center', 'radiusX', 'radiusY'], path)
    const center = point(input.center, `${path}/center`, limits)
    const radiusX = coordinate(input.radiusX, `${path}/radiusX`, limits)
    const radiusY = coordinate(input.radiusY, `${path}/radiusY`, limits)
    if (radiusX <= 0 || radiusY <= 0) {
      return fail('out-of-range', path, 'Ellipse radii must be positive')
    }
    coordinate(center.x - radiusX, `${path}/xMin`, limits)
    coordinate(center.x + radiusX, `${path}/xMax`, limits)
    coordinate(center.y - radiusY, `${path}/yMin`, limits)
    coordinate(center.y + radiusY, `${path}/yMax`, limits)
    return Object.freeze({ kind: 'ellipse', center, radiusX, radiusY })
  }
  return fail('invalid-value', `${path}/kind`, 'Unsupported ROI geometry kind')
}

const presentation = (
  value: unknown,
  path: string,
  limits: ResolvedRoiLimits,
): RoiPresentation | undefined => {
  if (value === undefined) return undefined
  const input = record(value, path)
  exactKeys(input, ['label', 'style'], path)
  const label = optionalString(input.label, `${path}/label`, limits)
  let style: OperationJsonObject | undefined
  if (input.style !== undefined) {
    try {
      style = normalizeOperationJsonObject(input.style, {
        maxDepth: limits.maxMetadataDepth,
        maxInspectedValues: limits.maxPointsPerGeometry,
      })
    } catch (error) {
      return fail(
        'invalid-value',
        `${path}/style`,
        error instanceof Error ? error.message : 'Style metadata is invalid',
      )
    }
  }
  const normalized = Object.freeze({
    ...(label === undefined ? {} : { label }),
    ...(style === undefined ? {} : { style }),
  })
  if (new TextEncoder().encode(JSON.stringify(normalized)).byteLength > limits.maxMetadataBytes) {
    return fail('limit-exceeded', path, 'Presentation metadata exceeds maxMetadataBytes')
  }
  return normalized
}

const axis = (
  descriptor: NormalizedScientificDatasetDescriptor,
  id: string,
  path: string,
): ScientificAxisDescriptor => {
  const found = descriptor.axes.find((entry) => entry.id === id)
  return found ?? fail('invalid-value', path, `Unknown scientific axis ${id}`)
}

const axisUnits = (
  descriptor: NormalizedScientificDatasetDescriptor,
  axisIds: readonly [string, string],
): readonly [string | null, string | null] =>
  Object.freeze([
    axis(descriptor, axisIds[0], '/axisIds/0').unit ?? null,
    axis(descriptor, axisIds[1], '/axisIds/1').unit ?? null,
  ])

const lookupDirection = (axisDescriptor: ScientificAxisDescriptor): 1 | -1 | undefined => {
  if (axisDescriptor.coordinates.type !== 'lookup') return undefined
  const values = axisDescriptor.coordinates.values
  if (values.length < 2) return undefined
  const direction = (values[1] ?? 0) > (values[0] ?? 0) ? 1 : -1
  for (let index = 1; index < values.length; index += 1) {
    const previous = values[index - 1]
    const current = values[index]
    if (previous === undefined || current === undefined || (current - previous) * direction <= 0) {
      return undefined
    }
  }
  return direction
}

const requirePhysicalAxis = (axisDescriptor: ScientificAxisDescriptor, path: string): void => {
  if (axisDescriptor.coordinates.type === 'linear') return
  if (axisDescriptor.coordinates.type === 'lookup' && lookupDirection(axisDescriptor) !== undefined)
    return
  fail(
    'invalid-value',
    path,
    `Axis ${axisDescriptor.id} does not have invertible physical calibration`,
  )
}

const normalizeFixedIndices = (
  value: unknown,
  descriptor: NormalizedScientificDatasetDescriptor,
  axisIds: readonly [string, string],
  path: string,
  limits: ResolvedRoiLimits,
): readonly ScientificAxisIndex[] => {
  if (!Array.isArray(value)) return fail('invalid-type', path, 'Expected fixedIndices array')
  const display = new Set(axisIds)
  const seen = new Set<string>()
  const byId = new Map<string, ScientificAxisIndex>()
  for (let index = 0; index < value.length; index += 1) {
    const entryPath = `${path}/${index}`
    const input = record(value[index], entryPath)
    exactKeys(input, ['axisId', 'index'], entryPath)
    const axisId = string(input.axisId, `${entryPath}/axisId`, limits)
    if (display.has(axisId)) {
      fail('invalid-value', `${entryPath}/axisId`, 'Display axes cannot also be fixed')
    }
    if (seen.has(axisId)) fail('duplicate', `${entryPath}/axisId`, `Duplicate fixed axis ${axisId}`)
    seen.add(axisId)
    const axisDescriptor = axis(descriptor, axisId, `${entryPath}/axisId`)
    const fixedIndex = input.index
    if (typeof fixedIndex !== 'number') {
      return fail('invalid-type', `${entryPath}/index`, 'Fixed index must be a number')
    }
    if (
      !Number.isSafeInteger(fixedIndex) ||
      fixedIndex < 0 ||
      fixedIndex >= axisDescriptor.length
    ) {
      fail('out-of-range', `${entryPath}/index`, `Index is outside axis ${axisId}`)
    }
    byId.set(axisId, Object.freeze({ axisId, index: fixedIndex }))
  }
  for (const axisDescriptor of descriptor.axes) {
    if (
      !display.has(axisDescriptor.id) &&
      axisDescriptor.length > 1 &&
      !seen.has(axisDescriptor.id)
    ) {
      fail('missing-required', path, `Missing fixed index for axis ${axisDescriptor.id}`)
    }
  }
  return Object.freeze(
    descriptor.axes.flatMap((axisDescriptor) => {
      const entry = byId.get(axisDescriptor.id)
      return entry === undefined ? [] : [entry]
    }),
  )
}

const parseRoi = (
  value: unknown,
  descriptor: NormalizedScientificDatasetDescriptor,
  limits: ResolvedRoiLimits,
  path: string,
): Roi => {
  const input = record(value, path)
  exactKeys(
    input,
    [
      'schemaVersion',
      'id',
      'name',
      'axisIds',
      'fixedIndices',
      'coordinateSpace',
      'units',
      'geometry',
      'presentation',
    ],
    path,
  )
  if (input.schemaVersion !== roiSchemaVersion) {
    fail('invalid-value', `${path}/schemaVersion`, `ROI schemaVersion must be ${roiSchemaVersion}`)
  }
  const id = string(input.id, `${path}/id`, limits)
  const name = optionalString(input.name, `${path}/name`, limits)
  if (!Array.isArray(input.axisIds) || input.axisIds.length !== 2) {
    return fail('invalid-type', `${path}/axisIds`, 'Expected exactly two ordered axis ids')
  }
  const xAxisId = string(input.axisIds[0], `${path}/axisIds/0`, limits)
  const yAxisId = string(input.axisIds[1], `${path}/axisIds/1`, limits)
  const axisIds: readonly [string, string] = Object.freeze([xAxisId, yAxisId])
  if (axisIds[0] === axisIds[1]) {
    fail('duplicate', `${path}/axisIds/1`, 'ROI axes must be distinct')
  }
  const xAxis = axis(descriptor, axisIds[0], `${path}/axisIds/0`)
  const yAxis = axis(descriptor, axisIds[1], `${path}/axisIds/1`)
  const fixedIndices = normalizeFixedIndices(
    input.fixedIndices,
    descriptor,
    axisIds,
    `${path}/fixedIndices`,
    limits,
  )
  const normalizedGeometry = geometry(input.geometry, `${path}/geometry`, limits)
  const normalizedPresentation = presentation(input.presentation, `${path}/presentation`, limits)
  const common: RoiBase = {
    schemaVersion: 1,
    id,
    axisIds,
    fixedIndices,
    geometry: normalizedGeometry,
    ...(name === undefined ? {} : { name }),
    ...(normalizedPresentation === undefined ? {} : { presentation: normalizedPresentation }),
  }
  if (input.coordinateSpace === 'pixel') {
    if (input.units !== undefined) {
      fail('unknown-field', `${path}/units`, 'Pixel-space ROI must not declare physical units')
    }
    return Object.freeze({ ...common, coordinateSpace: 'pixel' })
  }
  if (input.coordinateSpace !== 'physical') {
    return fail('invalid-value', `${path}/coordinateSpace`, 'Expected pixel or physical')
  }
  requirePhysicalAxis(xAxis, `${path}/axisIds/0`)
  requirePhysicalAxis(yAxis, `${path}/axisIds/1`)
  if (!Array.isArray(input.units) || input.units.length !== 2) {
    return fail('invalid-type', `${path}/units`, 'Physical ROI must declare two axis units')
  }
  const expectedUnits = axisUnits(descriptor, axisIds)
  for (let index = 0; index < 2; index += 1) {
    const unit = input.units[index]
    if (unit !== null && typeof unit !== 'string') {
      fail('invalid-type', `${path}/units/${index}`, 'Unit must be a string or null')
    }
    if (unit !== expectedUnits[index]) {
      fail('invalid-value', `${path}/units/${index}`, 'ROI unit does not match axis calibration')
    }
  }
  return Object.freeze({ ...common, coordinateSpace: 'physical', units: expectedUnits })
}

export const validateRoi = (
  value: unknown,
  descriptor: NormalizedScientificDatasetDescriptor,
  limits: Readonly<RoiLimits> = {},
): {
  readonly valid: boolean
  readonly issues: readonly OperationValidationIssue[]
  readonly value?: Roi
} => {
  try {
    return Object.freeze({
      valid: true,
      issues: Object.freeze([]),
      value: parseRoi(value, descriptor, resolveRoiLimits(limits), ''),
    })
  } catch (error) {
    if (!(error instanceof RoiValidationFailure)) throw error
    return Object.freeze({
      valid: false,
      issues: Object.freeze([
        Object.freeze({ code: error.code, path: error.path, message: error.message }),
      ]),
    })
  }
}

export const normalizeRoi = (
  value: unknown,
  descriptor: NormalizedScientificDatasetDescriptor,
  limits: Readonly<RoiLimits> = {},
): Roi => {
  const result = validateRoi(value, descriptor, limits)
  if (result.value !== undefined) return result.value
  const issue = result.issues[0]
  throw invalidInput(`${issue?.path ?? ''}: ${issue?.message ?? 'ROI is invalid'}`)
}

const parseRoiSet = (
  value: unknown,
  descriptor: NormalizedScientificDatasetDescriptor,
  limits: ResolvedRoiLimits,
): RoiSet => {
  const input = record(value, '')
  exactKeys(input, ['schemaVersion', 'name', 'rois', 'presentation'], '')
  if (input.schemaVersion !== roiSchemaVersion) {
    fail('invalid-value', '/schemaVersion', `ROI set schemaVersion must be ${roiSchemaVersion}`)
  }
  const name = optionalString(input.name, '/name', limits)
  const normalizedPresentation = presentation(input.presentation, '/presentation', limits)
  if (!Array.isArray(input.rois)) return fail('invalid-type', '/rois', 'Expected an ROI array')
  if (input.rois.length > limits.maxRois) {
    return fail('limit-exceeded', '/rois', 'ROI set exceeds maxRois')
  }
  const ids = new Set<string>()
  const rois: Roi[] = []
  for (let index = 0; index < input.rois.length; index += 1) {
    const normalized = parseRoi(input.rois[index], descriptor, limits, `/rois/${index}`)
    if (ids.has(normalized.id)) {
      fail('duplicate', `/rois/${index}/id`, `Duplicate ROI id ${normalized.id}`)
    }
    ids.add(normalized.id)
    rois.push(normalized)
  }
  return Object.freeze({
    schemaVersion: roiSchemaVersion,
    rois: Object.freeze(rois),
    ...(name === undefined ? {} : { name }),
    ...(normalizedPresentation === undefined ? {} : { presentation: normalizedPresentation }),
  })
}

export const validateRoiSet = (
  value: unknown,
  descriptor: NormalizedScientificDatasetDescriptor,
  limits: Readonly<RoiLimits> = {},
): {
  readonly valid: boolean
  readonly issues: readonly OperationValidationIssue[]
  readonly value?: RoiSet
} => {
  try {
    return Object.freeze({
      valid: true,
      issues: Object.freeze([]),
      value: parseRoiSet(value, descriptor, resolveRoiLimits(limits)),
    })
  } catch (error) {
    if (!(error instanceof RoiValidationFailure)) throw error
    return Object.freeze({
      valid: false,
      issues: Object.freeze([
        Object.freeze({ code: error.code, path: error.path, message: error.message }),
      ]),
    })
  }
}

export const normalizeRoiSet = (
  value: unknown,
  descriptor: NormalizedScientificDatasetDescriptor,
  limits: Readonly<RoiLimits> = {},
): RoiSet => {
  const result = validateRoiSet(value, descriptor, limits)
  if (result.value !== undefined) return result.value
  const issue = result.issues[0]
  throw invalidInput(`${issue?.path ?? ''}: ${issue?.message ?? 'ROI set is invalid'}`)
}

export const createEmptyRoiSet = (): RoiSet =>
  Object.freeze({ schemaVersion: roiSchemaVersion, rois: Object.freeze([]) })

export const roiAxisPixelToPhysical = (
  axisDescriptor: ScientificAxisDescriptor,
  pixel: number,
): number => {
  if (!Number.isFinite(pixel)) throw invalidInput('Pixel coordinate must be finite')
  const coordinates = axisDescriptor.coordinates
  if (coordinates.type === 'linear') {
    const physical = coordinates.origin + (pixel - 0.5) * coordinates.step
    if (!Number.isFinite(physical)) throw invalidInput('Physical coordinate overflowed')
    return physical
  }
  if (coordinates.type !== 'lookup' || coordinates.values.length < 2) {
    throw invalidInput(`Axis ${axisDescriptor.id} does not have numeric physical calibration`)
  }
  const position = pixel - 0.5
  const lower = Math.max(0, Math.min(coordinates.values.length - 2, Math.floor(position)))
  const left = coordinates.values[lower]
  const right = coordinates.values[lower + 1]
  if (left === undefined || right === undefined) {
    throw invalidInput(`Axis ${axisDescriptor.id} lookup calibration is incomplete`)
  }
  const physical = left + (position - lower) * (right - left)
  if (!Number.isFinite(physical)) throw invalidInput('Physical coordinate overflowed')
  return physical
}

export const roiAxisPhysicalToPixel = (
  axisDescriptor: ScientificAxisDescriptor,
  physical: number,
): number => {
  if (!Number.isFinite(physical)) throw invalidInput('Physical coordinate must be finite')
  const coordinates = axisDescriptor.coordinates
  if (coordinates.type === 'linear') {
    const pixel = (physical - coordinates.origin) / coordinates.step + 0.5
    if (!Number.isFinite(pixel)) throw invalidInput('Pixel coordinate overflowed')
    return pixel
  }
  const direction = lookupDirection(axisDescriptor)
  if (coordinates.type !== 'lookup' || direction === undefined) {
    throw invalidInput(`Axis ${axisDescriptor.id} does not have invertible physical calibration`)
  }
  const values = coordinates.values
  let lower = 0
  if ((physical - (values[0] ?? 0)) * direction > 0) {
    lower = values.length - 2
    for (let index = 0; index < values.length - 1; index += 1) {
      const left = values[index]
      const right = values[index + 1]
      if (
        left !== undefined &&
        right !== undefined &&
        (physical - left) * direction >= 0 &&
        (physical - right) * direction <= 0
      ) {
        lower = index
        break
      }
    }
  }
  const left = values[lower]
  const right = values[lower + 1]
  if (left === undefined || right === undefined) {
    throw invalidInput(`Axis ${axisDescriptor.id} lookup calibration is incomplete`)
  }
  const pixel = lower + (physical - left) / (right - left) + 0.5
  if (!Number.isFinite(pixel)) throw invalidInput('Pixel coordinate overflowed')
  return pixel
}

export interface PhysicalRoiPoint {
  readonly point: RoiPoint
  readonly units: readonly [string | null, string | null]
}

export const pixelToPhysicalPoint = (
  descriptor: NormalizedScientificDatasetDescriptor,
  axisIds: readonly [string, string],
  value: RoiPoint,
): PhysicalRoiPoint => {
  const xAxis = axis(descriptor, axisIds[0], '/axisIds/0')
  const yAxis = axis(descriptor, axisIds[1], '/axisIds/1')
  return Object.freeze({
    point: Object.freeze({
      x: roiAxisPixelToPhysical(xAxis, value.x),
      y: roiAxisPixelToPhysical(yAxis, value.y),
    }),
    units: axisUnits(descriptor, axisIds),
  })
}

export const physicalToPixelPoint = (
  descriptor: NormalizedScientificDatasetDescriptor,
  axisIds: readonly [string, string],
  value: RoiPoint,
  units: readonly [string | null, string | null],
): RoiPoint => {
  const expected = axisUnits(descriptor, axisIds)
  if (units[0] !== expected[0] || units[1] !== expected[1]) {
    throw invalidInput('Physical ROI units do not exactly match axis units')
  }
  return Object.freeze({
    x: roiAxisPhysicalToPixel(axis(descriptor, axisIds[0], '/axisIds/0'), value.x),
    y: roiAxisPhysicalToPixel(axis(descriptor, axisIds[1], '/axisIds/1'), value.y),
  })
}

export interface RoiBoundingBox {
  readonly xMin: number
  readonly yMin: number
  readonly xMax: number
  readonly yMax: number
}

const geometryBounds = (value: RoiGeometry): RoiBoundingBox => {
  if (value.kind === 'rectangle') {
    return Object.freeze({
      xMin: value.x,
      yMin: value.y,
      xMax: value.x + value.width,
      yMax: value.y + value.height,
    })
  }
  if (value.kind === 'ellipse') {
    return Object.freeze({
      xMin: value.center.x - value.radiusX,
      yMin: value.center.y - value.radiusY,
      xMax: value.center.x + value.radiusX,
      yMax: value.center.y + value.radiusY,
    })
  }
  const values =
    value.kind === 'point'
      ? [value.point]
      : value.kind === 'line-segment'
        ? [value.start, value.end]
        : value.points
  let xMin = Number.POSITIVE_INFINITY
  let yMin = Number.POSITIVE_INFINITY
  let xMax = Number.NEGATIVE_INFINITY
  let yMax = Number.NEGATIVE_INFINITY
  for (const entry of values) {
    xMin = Math.min(xMin, entry.x)
    yMin = Math.min(yMin, entry.y)
    xMax = Math.max(xMax, entry.x)
    yMax = Math.max(yMax, entry.y)
  }
  return Object.freeze({ xMin, yMin, xMax, yMax })
}

export const roiBoundingBox = (
  roi: Roi,
  descriptor: NormalizedScientificDatasetDescriptor,
  coordinateSpace: Roi['coordinateSpace'] = roi.coordinateSpace,
): RoiBoundingBox | undefined => {
  const bounds = geometryBounds(roi.geometry)
  if (coordinateSpace === roi.coordinateSpace) return bounds
  if (coordinateSpace === 'physical') {
    const xAxis = axis(descriptor, roi.axisIds[0], '/axisIds/0')
    const yAxis = axis(descriptor, roi.axisIds[1], '/axisIds/1')
    if (
      (xAxis.coordinates.type === 'lookup' && lookupDirection(xAxis) === undefined) ||
      (yAxis.coordinates.type === 'lookup' && lookupDirection(yAxis) === undefined) ||
      xAxis.coordinates.type === 'index' ||
      xAxis.coordinates.type === 'labels' ||
      yAxis.coordinates.type === 'index' ||
      yAxis.coordinates.type === 'labels'
    ) {
      return undefined
    }
    const first = pixelToPhysicalPoint(descriptor, roi.axisIds, {
      x: bounds.xMin,
      y: bounds.yMin,
    }).point
    const second = pixelToPhysicalPoint(descriptor, roi.axisIds, {
      x: bounds.xMax,
      y: bounds.yMax,
    }).point
    return Object.freeze({
      xMin: Math.min(first.x, second.x),
      yMin: Math.min(first.y, second.y),
      xMax: Math.max(first.x, second.x),
      yMax: Math.max(first.y, second.y),
    })
  }
  if (roi.coordinateSpace !== 'physical') return bounds
  const first = physicalToPixelPoint(
    descriptor,
    roi.axisIds,
    { x: bounds.xMin, y: bounds.yMin },
    roi.units,
  )
  const second = physicalToPixelPoint(
    descriptor,
    roi.axisIds,
    { x: bounds.xMax, y: bounds.yMax },
    roi.units,
  )
  return Object.freeze({
    xMin: Math.min(first.x, second.x),
    yMin: Math.min(first.y, second.y),
    xMax: Math.max(first.x, second.x),
    yMax: Math.max(first.y, second.y),
  })
}

export const clipRoiBoundingBox = (
  bounds: RoiBoundingBox,
  width: number,
  height: number,
): RoiBoundingBox | undefined => {
  if (!Number.isSafeInteger(width) || width < 1 || !Number.isSafeInteger(height) || height < 1) {
    throw invalidInput('Plane width and height must be positive safe integers')
  }
  if (
    !Number.isFinite(bounds.xMin) ||
    !Number.isFinite(bounds.yMin) ||
    !Number.isFinite(bounds.xMax) ||
    !Number.isFinite(bounds.yMax) ||
    bounds.xMin > bounds.xMax ||
    bounds.yMin > bounds.yMax
  ) {
    throw invalidInput('ROI bounding box must be finite and ordered')
  }
  if (bounds.xMax < 0 || bounds.yMax < 0 || bounds.xMin > width || bounds.yMin > height) {
    return undefined
  }
  return Object.freeze({
    xMin: Math.max(0, Math.min(width, bounds.xMin)),
    yMin: Math.max(0, Math.min(height, bounds.yMin)),
    xMax: Math.max(0, Math.min(width, bounds.xMax)),
    yMax: Math.max(0, Math.min(height, bounds.yMax)),
  })
}

const quantitativeRoi = (roi: Roi): unknown => ({
  schemaVersion: roi.schemaVersion,
  id: roi.id,
  axisIds: roi.axisIds,
  fixedIndices: roi.fixedIndices,
  coordinateSpace: roi.coordinateSpace,
  ...(roi.coordinateSpace === 'physical' ? { units: roi.units } : {}),
  geometry: roi.geometry,
})

/** Canonical quantitative identity for an ROI that has already passed value-type validation. */
export const canonicalNormalizedRoiSemanticsJson = (roi: Roi): string =>
  canonicalJson(quantitativeRoi(roi))

/** Canonical quantitative identity for a validated ROI set; presentation metadata is excluded. */
export const canonicalNormalizedRoiSetSemanticsJson = (roiSet: RoiSet): string =>
  canonicalJson({
    schemaVersion: roiSet.schemaVersion,
    rois: roiSet.rois.map(quantitativeRoi),
  })

export const canonicalRoiJson = (
  value: unknown,
  descriptor: NormalizedScientificDatasetDescriptor,
  limits: Readonly<RoiLimits> = {},
): string => canonicalJson(normalizeRoi(value, descriptor, limits))

export const canonicalRoiSemanticsJson = (
  value: unknown,
  descriptor: NormalizedScientificDatasetDescriptor,
  limits: Readonly<RoiLimits> = {},
): string => canonicalNormalizedRoiSemanticsJson(normalizeRoi(value, descriptor, limits))

export const canonicalRoiSetJson = (
  value: unknown,
  descriptor: NormalizedScientificDatasetDescriptor,
  limits: Readonly<RoiLimits> = {},
): string => canonicalJson(normalizeRoiSet(value, descriptor, limits))

const roiCapabilities = (kind: 'roi' | 'roi-set', limits: ResolvedRoiLimits): OperationJsonObject =>
  Object.freeze({
    schemaVersion: roiSchemaVersion,
    kind,
    schema: Object.freeze({
      requiredRoiFields: Object.freeze([
        'schemaVersion',
        'id',
        'axisIds',
        'fixedIndices',
        'coordinateSpace',
        'geometry',
      ]),
      physicalRoiRequiresUnits: true,
      axisIdCount: 2,
      fixedIndicesRequiredForNonSingletonAxes: true,
      presentationFields: Object.freeze(['name', 'presentation.label', 'presentation.style']),
    }),
    coordinateSpaces: Object.freeze(['pixel', 'physical']),
    geometryKinds: Object.freeze([
      'point',
      'line-segment',
      'polyline',
      'rectangle',
      'ellipse',
      'polygon',
    ]),
    limits: Object.freeze({ ...limits }),
    presentationExcludedFromQuantitativeSemantics: true,
  })

export const roiValueTypeDescriptors = Object.freeze([
  Object.freeze({
    id: roiValueTypeId,
    version: 1,
    title: 'Region of interest',
    capabilities: roiCapabilities('roi', defaultRoiLimits),
    builtIn: true,
  }),
  Object.freeze({
    id: roiSetValueTypeId,
    version: 1,
    title: 'Region-of-interest set',
    capabilities: roiCapabilities('roi-set', defaultRoiLimits),
    builtIn: true,
  }),
])

const roiPointJsonValue = (value: RoiPoint): OperationJsonObject =>
  Object.freeze({ x: value.x, y: value.y })

const roiGeometryJsonValue = (value: RoiGeometry): OperationJsonObject => {
  if (value.kind === 'point') {
    return Object.freeze({ kind: value.kind, point: roiPointJsonValue(value.point) })
  }
  if (value.kind === 'line-segment') {
    return Object.freeze({
      kind: value.kind,
      start: roiPointJsonValue(value.start),
      end: roiPointJsonValue(value.end),
    })
  }
  if (value.kind === 'polyline' || value.kind === 'polygon') {
    return Object.freeze({
      kind: value.kind,
      points: Object.freeze(value.points.map(roiPointJsonValue)),
    })
  }
  if (value.kind === 'rectangle') {
    return Object.freeze({
      kind: value.kind,
      x: value.x,
      y: value.y,
      width: value.width,
      height: value.height,
    })
  }
  return Object.freeze({
    kind: value.kind,
    center: roiPointJsonValue(value.center),
    radiusX: value.radiusX,
    radiusY: value.radiusY,
  })
}

const roiPresentationJsonValue = (value: RoiPresentation): OperationJsonObject =>
  Object.freeze({
    ...(value.label === undefined ? {} : { label: value.label }),
    ...(value.style === undefined ? {} : { style: value.style }),
  })

const roiJsonValue = (value: Roi): OperationJsonObject =>
  Object.freeze({
    schemaVersion: value.schemaVersion,
    id: value.id,
    ...(value.name === undefined ? {} : { name: value.name }),
    axisIds: Object.freeze([...value.axisIds]),
    fixedIndices: Object.freeze(
      value.fixedIndices.map((entry) =>
        Object.freeze({ axisId: entry.axisId, index: entry.index }),
      ),
    ),
    coordinateSpace: value.coordinateSpace,
    ...(value.coordinateSpace === 'physical' ? { units: Object.freeze([...value.units]) } : {}),
    geometry: roiGeometryJsonValue(value.geometry),
    ...(value.presentation === undefined
      ? {}
      : { presentation: roiPresentationJsonValue(value.presentation) }),
  })

const roiSetJsonValue = (value: RoiSet): OperationJsonObject =>
  Object.freeze({
    schemaVersion: value.schemaVersion,
    rois: Object.freeze(value.rois.map(roiJsonValue)),
    ...(value.name === undefined ? {} : { name: value.name }),
    ...(value.presentation === undefined
      ? {}
      : { presentation: roiPresentationJsonValue(value.presentation) }),
  })

const valueTypeValidation = (
  value: unknown,
  descriptor: NormalizedScientificDatasetDescriptor,
  limits: Readonly<RoiLimits>,
  set: boolean,
) => {
  if (set) {
    const result = validateRoiSet(value, descriptor, limits)
    if (result.value === undefined) {
      return Object.freeze({ valid: false, issues: result.issues })
    }
    return Object.freeze({
      valid: true,
      issues: Object.freeze([]),
      value: roiSetJsonValue(result.value),
    })
  }
  const result = validateRoi(value, descriptor, limits)
  if (result.value === undefined) {
    return Object.freeze({ valid: false, issues: result.issues })
  }
  return Object.freeze({
    valid: true,
    issues: Object.freeze([]),
    value: roiJsonValue(result.value),
  })
}

export const createRoiValueTypeDefinitions = (
  descriptor: NormalizedScientificDatasetDescriptor,
  limits: Readonly<RoiLimits> = {},
): readonly ValueTypeDefinition[] =>
  Object.freeze([
    createValueTypeDefinition({
      descriptor: {
        id: roiValueTypeId,
        version: 1,
        title: 'Region of interest',
        capabilities: roiCapabilities('roi', resolveRoiLimits(limits)),
        builtIn: true,
      },
      validate: (value) => valueTypeValidation(value, descriptor, limits, false),
    }),
    createValueTypeDefinition({
      descriptor: {
        id: roiSetValueTypeId,
        version: 1,
        title: 'Region-of-interest set',
        capabilities: roiCapabilities('roi-set', resolveRoiLimits(limits)),
        builtIn: true,
      },
      validate: (value) => valueTypeValidation(value, descriptor, limits, true),
    }),
  ])

export const createRoiValueTypeRegistry = (
  descriptor: NormalizedScientificDatasetDescriptor,
  limits: Readonly<RoiLimits> = {},
): ValueTypeRegistry => createValueTypeRegistry(createRoiValueTypeDefinitions(descriptor, limits))
