import { throwIfAborted } from '../abort.ts'
import { invalidInput, limitExceeded } from '../errors.ts'
import type {
  OperationCostEstimate,
  OperationExecutionRequest,
  OperationImplementation,
  OperationOwnedOutput,
  OperationPlanningRequest,
  OperationProvider,
} from '../operations/provider.ts'
import { createOperationProvider } from '../operations/provider.ts'
import type {
  OperationJsonObject,
  OperationJsonValue,
  OperationValidationResult,
  ParameterSchema,
} from '../operations/descriptor.ts'
import { normalizeOperationJsonObject } from '../operations/descriptor.ts'
import type {
  OperationDefinition,
  OperationRegistry,
  ValueTypeRegistry,
} from '../operations/registry.ts'
import { createOperationDefinition, createOperationRegistry } from '../operations/registry.ts'
import type {
  NormalizedScientificDatasetDescriptor,
  ScientificAxisDescriptor,
  ScientificAxisIndex,
  ScientificDataset,
} from '../scientific/dataset.ts'
import {
  normalizeScientificDatasetDescriptor,
  supportsScientificPlaneRead,
} from '../scientific/dataset.ts'
import type { NumericArray, NumericTile } from '../scientific/numeric-tile.ts'
import { numericTileSampleOffset } from '../scientific/numeric-tile.ts'
import {
  AnalysisDatasetOperationContext,
  scientificDatasetCharacteristics,
  scientificDatasetValueTypeId,
} from './builtin-dataset-operations.ts'
import { createScientificDatasetValueTypeRegistry } from './builtins.ts'
import type { TileRuntime } from './tile-runtime.ts'

export const virtualDetectorMapOperationId = 'purejsimage.analysis.four-d-stem.virtual-detector-map'
export const scanDiffractionReductionOperationId =
  'purejsimage.analysis.four-d-stem.scan-diffraction-reduction'
export const fourDStemReferenceProviderId = 'purejsimage.analysis.four-d-stem.reference'

export interface FourDStemAxisRoles {
  readonly navigationX: string
  readonly navigationY: string
  readonly detectorX: string
  readonly detectorY: string
}

export type FourDStemAxisRoleInference =
  | {
      readonly status: 'recognized'
      readonly roles: FourDStemAxisRoles
      readonly reason: string
    }
  | {
      readonly status: 'ambiguous'
      readonly navigationAxes: readonly string[]
      readonly detectorAxes: readonly string[]
      readonly reason: string
    }
  | {
      readonly status: 'unsupported'
      readonly reason: string
    }

const axisDirection = (axis: ScientificAxisDescriptor): 'x' | 'y' | undefined => {
  const words = `${axis.id} ${axis.name ?? ''}`
    .toLowerCase()
    .split(/[^a-z0-9]+/u)
    .filter((word) => word.length > 0)
  const suffix = axis.id.toLowerCase().at(-1)
  const x =
    words.includes('x') ||
    words.includes('horizontal') ||
    words.includes('column') ||
    suffix === 'x'
  const y =
    words.includes('y') || words.includes('vertical') || words.includes('row') || suffix === 'y'
  return x === y ? undefined : x ? 'x' : 'y'
}

const directedPair = (
  axes: readonly ScientificAxisDescriptor[],
): readonly [ScientificAxisDescriptor, ScientificAxisDescriptor] | undefined => {
  if (axes.length !== 2) return undefined
  const x = axes.filter((axis) => axisDirection(axis) === 'x')
  const y = axes.filter((axis) => axisDirection(axis) === 'y')
  return x.length === 1 && y.length === 1 && x[0] !== undefined && y[0] !== undefined
    ? Object.freeze([x[0], y[0]])
    : undefined
}

/**
 * Recognize 4D-STEM only from two spatial navigation axes and two reciprocal-space detector axes
 * with unambiguous X/Y labels. Other 4D volumes remain ordinary scientific datasets.
 */
export const inferFourDStemAxisRoles = (
  descriptor: NormalizedScientificDatasetDescriptor,
): FourDStemAxisRoleInference => {
  const navigation = descriptor.axes.filter(({ kind }) => kind === 'space')
  const detector = descriptor.axes.filter(({ kind }) => kind === 'reciprocal-space')
  if (navigation.length !== 2 || detector.length !== 2) {
    return Object.freeze({
      status: 'unsupported',
      reason: '4D-STEM recognition requires exactly two space and two reciprocal-space axes',
    })
  }
  const navigationPair = directedPair(navigation)
  const detectorPair = directedPair(detector)
  if (navigationPair === undefined || detectorPair === undefined) {
    return Object.freeze({
      status: 'ambiguous',
      navigationAxes: Object.freeze(navigation.map(({ id }) => id)),
      detectorAxes: Object.freeze(detector.map(({ id }) => id)),
      reason: 'Axis semantics match 4D-STEM, but X/Y directions require an explicit override',
    })
  }
  const roles = Object.freeze({
    navigationX: navigationPair[0].id,
    navigationY: navigationPair[1].id,
    detectorX: detectorPair[0].id,
    detectorY: detectorPair[1].id,
  })
  if (!supportsScientificPlaneRead(descriptor, [roles.detectorX, roles.detectorY])) {
    return Object.freeze({
      status: 'unsupported',
      reason: 'The detector axes cannot be read as an ordered scientific plane',
    })
  }
  return Object.freeze({
    status: 'recognized',
    roles,
    reason: 'Two labeled space axes and two labeled reciprocal-space axes were recognized',
  })
}

/** Validate a user-selected role override without weakening the conservative automatic rules. */
export const validateFourDStemAxisRoles = (
  descriptor: NormalizedScientificDatasetDescriptor,
  roles: Readonly<FourDStemAxisRoles>,
): FourDStemAxisRoles => {
  const normalized = rolesFrom(roles)
  const byId = new Map(descriptor.axes.map((axis) => [axis.id, axis]))
  const navigation = [normalized.navigationX, normalized.navigationY].map((id) => byId.get(id))
  const detector = [normalized.detectorX, normalized.detectorY].map((id) => byId.get(id))
  if (navigation.some((axis) => axis?.kind !== 'space')) {
    throw invalidInput('4D-STEM navigation roles must select space axes')
  }
  if (detector.some((axis) => axis?.kind !== 'reciprocal-space')) {
    throw invalidInput('4D-STEM detector roles must select reciprocal-space axes')
  }
  if (!supportsScientificPlaneRead(descriptor, [normalized.detectorX, normalized.detectorY])) {
    throw invalidInput('4D-STEM detector roles do not form a supported ordered plane')
  }
  return normalized
}

export type FourDStemReduction = 'sum' | 'mean'

export type DetectorRoi =
  | { readonly kind: 'point'; readonly x: number; readonly y: number }
  | {
      readonly kind: 'rectangle'
      readonly x: number
      readonly y: number
      readonly width: number
      readonly height: number
    }
  | {
      readonly kind: 'circle'
      readonly x: number
      readonly y: number
      readonly radius: number
    }
  | {
      readonly kind: 'annulus'
      readonly x: number
      readonly y: number
      readonly innerRadius: number
      readonly outerRadius: number
    }

export type NavigationRoi =
  | { readonly kind: 'point'; readonly x: number; readonly y: number }
  | {
      readonly kind: 'rectangle'
      readonly x: number
      readonly y: number
      readonly width: number
      readonly height: number
    }
  | {
      readonly kind: 'circle'
      readonly x: number
      readonly y: number
      readonly radius: number
    }

export interface FourDStemOperationLimits {
  readonly maxRoiPixels?: number
  readonly maxOutputTilePixels?: number
  readonly maxSourceTileBytes?: number
}

interface ResolvedLimits {
  readonly maxRoiPixels: number
  readonly maxOutputTilePixels: number
  readonly maxSourceTileBytes: number
}

interface ParsedParameters<Roi extends DetectorRoi | NavigationRoi> {
  readonly roles: FourDStemAxisRoles
  readonly fixedIndices: readonly ScientificAxisIndex[]
  readonly roi: Roi
  readonly reduction: FourDStemReduction
  readonly numericPolicy: 'float64-safe-integer'
}

interface PixelBounds {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

const positiveLimit = (value: number | undefined, fallback: number, name: string): number => {
  if (value === undefined) return fallback
  if (!Number.isSafeInteger(value) || value < 1) throw invalidInput(`${name} must be positive`)
  return value
}

const resolveLimits = (limits: Readonly<FourDStemOperationLimits> = {}): ResolvedLimits =>
  Object.freeze({
    maxRoiPixels: positiveLimit(limits.maxRoiPixels, 16_777_216, 'maxRoiPixels'),
    maxOutputTilePixels: positiveLimit(
      limits.maxOutputTilePixels,
      1_048_576,
      'maxOutputTilePixels',
    ),
    maxSourceTileBytes: positiveLimit(limits.maxSourceTileBytes, 268_435_456, 'maxSourceTileBytes'),
  })

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

const requiredString = (value: unknown, name: string): string => {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw invalidInput(`${name} must be a non-empty string`)
  }
  return value
}

const finite = (value: unknown, name: string): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw invalidInput(`${name} must be finite`)
  }
  return value
}

const positive = (value: unknown, name: string): number => {
  const result = finite(value, name)
  if (result <= 0) throw invalidInput(`${name} must be positive`)
  return result
}

const rolesFrom = (value: unknown): FourDStemAxisRoles => {
  if (!isRecord(value)) throw invalidInput('roles must be an object')
  const roles = Object.freeze({
    navigationX: requiredString(value.navigationX, 'roles.navigationX'),
    navigationY: requiredString(value.navigationY, 'roles.navigationY'),
    detectorX: requiredString(value.detectorX, 'roles.detectorX'),
    detectorY: requiredString(value.detectorY, 'roles.detectorY'),
  })
  if (new Set(Object.values(roles)).size !== 4) {
    throw invalidInput('4D-STEM axis roles must use four distinct axes')
  }
  return roles
}

const fixedIndicesFrom = (value: unknown): readonly ScientificAxisIndex[] => {
  if (!Array.isArray(value)) throw invalidInput('fixedIndices must be an array')
  const seen = new Set<string>()
  const indices: ScientificAxisIndex[] = []
  for (const entry of value) {
    if (!isRecord(entry)) throw invalidInput('fixedIndices entries must be objects')
    const axisId = requiredString(entry.axisId, 'fixedIndices.axisId')
    const index = entry.index
    if (
      typeof index !== 'number' ||
      !Number.isSafeInteger(index) ||
      index < 0 ||
      seen.has(axisId)
    ) {
      throw invalidInput('fixedIndices contains an invalid or duplicate entry')
    }
    seen.add(axisId)
    indices.push(Object.freeze({ axisId, index }))
  }
  indices.sort((left, right) => left.axisId.localeCompare(right.axisId))
  return Object.freeze(indices)
}

const detectorRoiFrom = (value: unknown): DetectorRoi => {
  if (!isRecord(value)) throw invalidInput('roi must be an object')
  const x = finite(value.x, 'roi.x')
  const y = finite(value.y, 'roi.y')
  if (value.kind === 'point') {
    if (!Number.isSafeInteger(x) || !Number.isSafeInteger(y)) {
      throw invalidInput('Point ROI coordinates must be safe integers')
    }
    return Object.freeze({ kind: 'point', x, y })
  }
  if (value.kind === 'rectangle') {
    return Object.freeze({
      kind: 'rectangle',
      x,
      y,
      width: positive(value.width, 'roi.width'),
      height: positive(value.height, 'roi.height'),
    })
  }
  if (value.kind === 'circle') {
    return Object.freeze({ kind: 'circle', x, y, radius: positive(value.radius, 'roi.radius') })
  }
  if (value.kind === 'annulus') {
    const innerRadius = finite(value.innerRadius, 'roi.innerRadius')
    const outerRadius = positive(value.outerRadius, 'roi.outerRadius')
    if (innerRadius < 0 || innerRadius >= outerRadius) {
      throw invalidInput('Annulus radii must satisfy 0 <= innerRadius < outerRadius')
    }
    return Object.freeze({ kind: 'annulus', x, y, innerRadius, outerRadius })
  }
  throw invalidInput('Detector ROI kind is unsupported')
}

const navigationRoiFrom = (value: unknown): NavigationRoi => {
  const roi = detectorRoiFrom(value)
  if (roi.kind === 'annulus') throw invalidInput('Navigation ROI does not support annulus')
  return roi
}

const parametersFrom = <Roi extends DetectorRoi | NavigationRoi>(
  value: OperationJsonValue,
  roiFrom: (value: unknown) => Roi,
): ParsedParameters<Roi> => {
  if (!isRecord(value)) throw invalidInput('4D-STEM parameters must be an object')
  if (value.reduction !== 'sum' && value.reduction !== 'mean') {
    throw invalidInput('reduction must be sum or mean')
  }
  if (value.numericPolicy !== 'float64-safe-integer') {
    throw invalidInput('numericPolicy must be float64-safe-integer')
  }
  return Object.freeze({
    roles: rolesFrom(value.roles),
    fixedIndices: fixedIndicesFrom(value.fixedIndices),
    roi: roiFrom(value.roi),
    reduction: value.reduction,
    numericPolicy: value.numericPolicy,
  })
}

const axis = (
  descriptor: NormalizedScientificDatasetDescriptor,
  id: string,
): ScientificAxisDescriptor => {
  const found = descriptor.axes.find((candidate) => candidate.id === id)
  if (found === undefined) throw invalidInput(`Unknown scientific axis ${id}`)
  return found
}

const validateSource = (
  descriptor: NormalizedScientificDatasetDescriptor,
  parameters: ParsedParameters<DetectorRoi | NavigationRoi>,
): void => {
  const { roles } = parameters
  const navigationX = axis(descriptor, roles.navigationX)
  const navigationY = axis(descriptor, roles.navigationY)
  const detectorX = axis(descriptor, roles.detectorX)
  const detectorY = axis(descriptor, roles.detectorY)
  if (navigationX.kind !== 'space' || navigationY.kind !== 'space') {
    throw invalidInput('4D-STEM navigation axes must have kind space')
  }
  if (detectorX.kind !== 'reciprocal-space' || detectorY.kind !== 'reciprocal-space') {
    throw invalidInput('4D-STEM detector axes must have kind reciprocal-space')
  }
  if (!supportsScientificPlaneRead(descriptor, [roles.detectorX, roles.detectorY])) {
    throw invalidInput('Scientific dataset cannot read the selected detector axis pair')
  }
  if (descriptor.components.length !== 1) {
    throw invalidInput('Initial 4D-STEM reductions require one source component')
  }
  const selected = new Set(Object.values(roles))
  const fixed = new Map(parameters.fixedIndices.map((entry) => [entry.axisId, entry.index]))
  for (const entry of parameters.fixedIndices) {
    if (selected.has(entry.axisId)) throw invalidInput(`Axis role ${entry.axisId} cannot be fixed`)
    const selectedAxis = axis(descriptor, entry.axisId)
    if (entry.index >= selectedAxis.length) {
      throw invalidInput(`Fixed index is outside axis ${entry.axisId}`)
    }
  }
  for (const candidate of descriptor.axes) {
    if (!selected.has(candidate.id) && !fixed.has(candidate.id)) {
      throw invalidInput(`4D-STEM operation requires a fixed index for axis ${candidate.id}`)
    }
  }
}

const boundsFor = (
  roi: DetectorRoi | NavigationRoi,
  width: number,
  height: number,
): PixelBounds => {
  const raw =
    roi.kind === 'point'
      ? { x: roi.x, y: roi.y, width: 1, height: 1 }
      : roi.kind === 'rectangle'
        ? {
            x: Math.floor(roi.x),
            y: Math.floor(roi.y),
            width: Math.ceil(roi.x + roi.width) - Math.floor(roi.x),
            height: Math.ceil(roi.y + roi.height) - Math.floor(roi.y),
          }
        : {
            x: Math.floor(roi.x - (roi.kind === 'annulus' ? roi.outerRadius : roi.radius)),
            y: Math.floor(roi.y - (roi.kind === 'annulus' ? roi.outerRadius : roi.radius)),
            width:
              Math.ceil(roi.x + (roi.kind === 'annulus' ? roi.outerRadius : roi.radius)) -
              Math.floor(roi.x - (roi.kind === 'annulus' ? roi.outerRadius : roi.radius)),
            height:
              Math.ceil(roi.y + (roi.kind === 'annulus' ? roi.outerRadius : roi.radius)) -
              Math.floor(roi.y - (roi.kind === 'annulus' ? roi.outerRadius : roi.radius)),
          }
  const x = Math.max(0, raw.x)
  const y = Math.max(0, raw.y)
  const right = Math.min(width, raw.x + raw.width)
  const bottom = Math.min(height, raw.y + raw.height)
  if (x >= right || y >= bottom) throw invalidInput('ROI does not intersect its axis plane')
  return Object.freeze({ x, y, width: right - x, height: bottom - y })
}

const includes = (roi: DetectorRoi | NavigationRoi, x: number, y: number): boolean => {
  if (roi.kind === 'point') return x === roi.x && y === roi.y
  const sampleX = x + 0.5
  const sampleY = y + 0.5
  if (roi.kind === 'rectangle') {
    return (
      sampleX >= roi.x &&
      sampleX < roi.x + roi.width &&
      sampleY >= roi.y &&
      sampleY < roi.y + roi.height
    )
  }
  const dx = sampleX - roi.x
  const dy = sampleY - roi.y
  const squared = dx * dx + dy * dy
  if (roi.kind === 'circle') return squared <= roi.radius * roi.radius
  return (
    squared >= roi.innerRadius * roi.innerRadius && squared <= roi.outerRadius * roi.outerRadius
  )
}

const roiSampleCount = (roi: DetectorRoi | NavigationRoi, bounds: PixelBounds): number => {
  let count = 0
  for (let y = bounds.y; y < bounds.y + bounds.height; y += 1) {
    for (let x = bounds.x; x < bounds.x + bounds.width; x += 1) {
      if (includes(roi, x, y)) count += 1
    }
  }
  if (count === 0) throw invalidInput('ROI contains no sample centers')
  return count
}

const integerMaximumMagnitude = (data: NumericArray): number | undefined => {
  if (data instanceof Uint8Array) return 0xff
  if (data instanceof Uint16Array) return 0xffff
  if (data instanceof Uint32Array) return 0xffffffff
  if (data instanceof Int8Array) return 0x80
  if (data instanceof Int16Array) return 0x8000
  if (data instanceof Int32Array) return 0x80000000
  return undefined
}

const sampleAt = (tile: NumericTile, x: number, y: number): number | bigint => {
  const value = tile.data[numericTileSampleOffset(tile, x, y, 0)]
  return (
    value ?? (tile.data instanceof BigUint64Array || tile.data instanceof BigInt64Array ? 0n : 0)
  )
}

const usable = (value: number | bigint, noDataValue: number | undefined): boolean => {
  if (noDataValue === undefined) return true
  return typeof value === 'bigint'
    ? Number.isSafeInteger(noDataValue) && value !== BigInt(noDataValue)
    : value !== noDataValue
}

const exactFloat64 = (value: bigint, label: string): number => {
  const maximum = BigInt(Number.MAX_SAFE_INTEGER)
  if (value > maximum || value < -maximum) {
    throw limitExceeded(`${label} exceeds exact float64 integer output`)
  }
  return Number(value)
}

const reducedTileValue = (
  tile: NumericTile,
  roi: DetectorRoi | NavigationRoi,
  bounds: PixelBounds,
  reduction: FourDStemReduction,
  noDataValue: number | undefined,
): number => {
  const integerMagnitude = integerMaximumMagnitude(tile.data)
  if (
    integerMagnitude !== undefined &&
    integerMagnitude * bounds.width * bounds.height > Number.MAX_SAFE_INTEGER
  ) {
    throw limitExceeded('Integer ROI worst-case sum exceeds exact float64 accumulation')
  }
  let sum = 0
  let exact = 0n
  let count = 0
  let bigint = false
  for (let y = 0; y < tile.height; y += 1) {
    for (let x = 0; x < tile.width; x += 1) {
      const sourceX = bounds.x + x
      const sourceY = bounds.y + y
      if (!includes(roi, sourceX, sourceY)) continue
      const value = sampleAt(tile, x, y)
      if (!usable(value, noDataValue)) continue
      count += 1
      if (typeof value === 'bigint') {
        bigint = true
        exact += value
      } else {
        if (Number.isNaN(value)) return Number.NaN
        sum += value
      }
    }
  }
  if (count === 0) return Number.NaN
  if (bigint) {
    if (sum !== 0) throw invalidInput('Mixed integer storage is unsupported')
    const exactSum = exactFloat64(exact, 'ROI sum')
    return reduction === 'mean' ? exactSum / count : exactSum
  }
  return reduction === 'mean' ? sum / count : sum
}

const outputTile = (
  x: number,
  y: number,
  width: number,
  height: number,
  data: Float64Array,
): NumericTile =>
  Object.freeze({
    x,
    y,
    width,
    height,
    sampleType: 'float64' as const,
    componentCount: 1,
    layout: 'interleaved' as const,
    rowStrideElements: width,
    data,
    release() {},
  })

const outputDescriptor = (
  source: NormalizedScientificDatasetDescriptor,
  axes: readonly [ScientificAxisDescriptor, ScientificAxisDescriptor],
  operation: string,
  parameters: OperationJsonValue,
): NormalizedScientificDatasetDescriptor =>
  normalizeScientificDatasetDescriptor({
    schemaVersion: 1,
    axes,
    sampleType: 'float64',
    components: [{ id: 'intensity', name: 'Reduced intensity', kind: 'intensity' }],
    metadata: {
      'purejsimage:4d-stem': {
        operation,
        operationVersion: 1,
        parameters,
        sourceSampleType: source.sampleType,
        noDataPolicy: 'exclude-declared-no-data-propagate-nan-empty-is-nan',
        numericPolicy: 'float64-safe-integer',
      },
    },
    capabilities: {
      regionReads: true,
      resolutionLevels: false,
      planeReads: { kind: 'ordered-axis-pairs', pairs: [[axes[0].id, axes[1].id]] },
    },
  })

const descriptorFromCharacteristics = (
  value: OperationJsonValue | undefined,
): NormalizedScientificDatasetDescriptor => {
  if (!isRecord(value) || value.kind !== 'scientific-dataset' || value.descriptor === undefined) {
    throw invalidInput('4D-STEM operation requires scientific dataset characteristics')
  }
  return normalizeScientificDatasetDescriptor(value.descriptor)
}

const validationFailure = (error: unknown): OperationValidationResult<OperationJsonValue> =>
  Object.freeze({
    valid: false,
    issues: Object.freeze([
      Object.freeze({
        code: 'invalid-value' as const,
        path: '',
        message: error instanceof Error ? error.message : '4D-STEM parameters are invalid',
      }),
    ]),
  })

const stringSchema = Object.freeze({
  type: 'string',
  minLength: 1,
  maxLength: 4_096,
}) satisfies ParameterSchema
const numberSchema = Object.freeze({ type: 'number', finiteOnly: true }) satisfies ParameterSchema
const positiveSchema = Object.freeze({
  type: 'number',
  finiteOnly: true,
  minimum: 0,
  exclusiveMinimum: true,
}) satisfies ParameterSchema
const rolesSchema = Object.freeze({
  type: 'object',
  properties: Object.freeze({
    navigationX: stringSchema,
    navigationY: stringSchema,
    detectorX: stringSchema,
    detectorY: stringSchema,
  }),
  required: Object.freeze(['navigationX', 'navigationY', 'detectorX', 'detectorY']),
  closed: true,
}) satisfies ParameterSchema
const fixedIndicesSchema = Object.freeze({
  type: 'array',
  items: Object.freeze({
    type: 'object',
    properties: Object.freeze({
      axisId: stringSchema,
      index: Object.freeze({ type: 'integer', minimum: 0 }),
    }),
    required: Object.freeze(['axisId', 'index']),
    closed: true,
  }),
  maxItems: 64,
}) satisfies ParameterSchema
const roiSchema = (kinds: readonly string[]): ParameterSchema =>
  Object.freeze({
    type: 'object',
    properties: Object.freeze({
      kind: Object.freeze({ type: 'enum', values: Object.freeze(kinds) }),
      x: numberSchema,
      y: numberSchema,
      width: positiveSchema,
      height: positiveSchema,
      radius: positiveSchema,
      innerRadius: Object.freeze({ type: 'number', finiteOnly: true, minimum: 0 }),
      outerRadius: positiveSchema,
    }),
    required: Object.freeze(['kind', 'x', 'y']),
    closed: true,
  })
const parametersSchema = (kinds: readonly string[]): ParameterSchema =>
  Object.freeze({
    type: 'object',
    properties: Object.freeze({
      roles: rolesSchema,
      fixedIndices: fixedIndicesSchema,
      roi: roiSchema(kinds),
      reduction: Object.freeze({ type: 'enum', values: Object.freeze(['sum', 'mean']) }),
      numericPolicy: Object.freeze({
        type: 'enum',
        values: Object.freeze(['float64-safe-integer']),
      }),
    }),
    required: Object.freeze(['roles', 'fixedIndices', 'roi', 'reduction', 'numericPolicy']),
    closed: true,
  })

const createDefinition = <Roi extends DetectorRoi | NavigationRoi>(options: {
  readonly id: string
  readonly title: string
  readonly roiKinds: readonly string[]
  readonly roiFrom: (value: unknown) => Roi
  readonly outputAxes: (
    descriptor: NormalizedScientificDatasetDescriptor,
    roles: FourDStemAxisRoles,
  ) => readonly [ScientificAxisDescriptor, ScientificAxisDescriptor]
}): OperationDefinition => {
  let definition: OperationDefinition
  definition = createOperationDefinition({
    descriptor: {
      id: options.id,
      version: 1,
      title: options.title,
      description: 'Bounded lazy 4D-STEM reduction over explicit navigation and detector axes.',
      category: '4d-stem',
      tags: ['scientific', '4d-stem', 'reduction'],
      inputs: [{ name: 'dataset', valueType: { id: scientificDatasetValueTypeId, version: 1 } }],
      outputs: [{ name: 'dataset', valueType: { id: scientificDatasetValueTypeId, version: 1 } }],
      parameters: parametersSchema(options.roiKinds),
      execution: 'reduction',
      reproducibility: { class: 'tolerance-based', absolute: 1e-12, relative: 1e-12 },
      builtIn: true,
    },
    normalizeParameters(input, validationLimits) {
      const base = createOperationDefinition({
        descriptor: definition.descriptor,
      }).normalizeParameters(input, validationLimits)
      if (base.value === undefined) return base
      try {
        parametersFrom(base.value, options.roiFrom)
        return base
      } catch (error) {
        return validationFailure(error)
      }
    },
    inferOutputShapes(request) {
      try {
        const descriptor = descriptorFromCharacteristics(request.inputs[0])
        const parameters = parametersFrom(request.parameters, options.roiFrom)
        validateSource(descriptor, parameters)
        const output = outputDescriptor(
          descriptor,
          options.outputAxes(descriptor, parameters.roles),
          options.id,
          request.parameters,
        )
        return Object.freeze({
          valid: true,
          issues: Object.freeze([]),
          value: Object.freeze([scientificDatasetCharacteristics(output)]),
        })
      } catch (error) {
        const failure = validationFailure(error)
        return failure as OperationValidationResult<readonly OperationJsonValue[]>
      }
    },
  })
  return definition
}

export const virtualDetectorMapOperationDefinition = createDefinition({
  id: virtualDetectorMapOperationId,
  title: '4D-STEM virtual detector map',
  roiKinds: ['point', 'rectangle', 'circle', 'annulus'],
  roiFrom: detectorRoiFrom,
  outputAxes: (descriptor, roles) =>
    Object.freeze([axis(descriptor, roles.navigationX), axis(descriptor, roles.navigationY)]),
})

export const scanDiffractionReductionOperationDefinition = createDefinition({
  id: scanDiffractionReductionOperationId,
  title: '4D-STEM scan-region diffraction reduction',
  roiKinds: ['point', 'rectangle', 'circle'],
  roiFrom: navigationRoiFrom,
  outputAxes: (descriptor, roles) =>
    Object.freeze([axis(descriptor, roles.detectorX), axis(descriptor, roles.detectorY)]),
})

export const fourDStemOperationDefinitions = Object.freeze([
  virtualDetectorMapOperationDefinition,
  scanDiffractionReductionOperationDefinition,
])

const datasetInput = (request: Readonly<OperationExecutionRequest>): ScientificDataset => {
  const value = request.inputs[0]
  if (
    value === null ||
    typeof value !== 'object' ||
    !('descriptor' in value) ||
    !('readPlane' in value) ||
    typeof value.readPlane !== 'function'
  ) {
    throw invalidInput('4D-STEM operation requires one ScientificDataset input')
  }
  return value as ScientificDataset
}

const estimate = (request: Readonly<OperationPlanningRequest>): OperationCostEstimate => {
  try {
    const descriptor = descriptorFromCharacteristics(request.inputCharacteristics[0])
    const definition = fourDStemOperationDefinitions.find(
      (candidate) => candidate.descriptor.id === request.descriptor.id,
    )
    const inferred = definition?.inferOutputShapes?.({
      parameters: request.parameters,
      inputs: Object.freeze([scientificDatasetCharacteristics(descriptor)]),
    })
    if (inferred?.value?.[0] === undefined) throw invalidInput('Output shape is unavailable')
    return Object.freeze({
      setupMilliseconds: 0,
      transferMilliseconds: 0,
      computeMilliseconds: 1,
      readbackMilliseconds: 0,
      retainedBytes: 0,
      peakWorkingBytes: 65_536,
      transferBytes: 0,
      outputBytes: 0,
      confidence: 0.25,
    })
  } catch {
    return Object.freeze({
      setupMilliseconds: 0,
      transferMilliseconds: 0,
      computeMilliseconds: 0,
      readbackMilliseconds: 0,
      retainedBytes: 0,
      peakWorkingBytes: 0,
      transferBytes: 0,
      outputBytes: 0,
      confidence: 0,
    })
  }
}

const virtualDataset = async (
  source: ScientificDataset,
  request: Readonly<OperationExecutionRequest>,
  context: AnalysisDatasetOperationContext,
  limits: ResolvedLimits,
): Promise<ScientificDataset> => {
  const parameters = parametersFrom(request.parameters, detectorRoiFrom)
  validateSource(source.descriptor, parameters)
  const detectorX = axis(source.descriptor, parameters.roles.detectorX)
  const detectorY = axis(source.descriptor, parameters.roles.detectorY)
  const bounds = boundsFor(parameters.roi, detectorX.length, detectorY.length)
  const selectedSamples = roiSampleCount(parameters.roi, bounds)
  if (selectedSamples > limits.maxRoiPixels)
    throw limitExceeded('Detector ROI exceeds maxRoiPixels')
  const descriptor = outputDescriptor(
    source.descriptor,
    [
      axis(source.descriptor, parameters.roles.navigationX),
      axis(source.descriptor, parameters.roles.navigationY),
    ],
    virtualDetectorMapOperationId,
    request.parameters,
  )
  const identity = await context.derivedIdentity(source, request, 'dataset')
  return context.createDataset(
    descriptor,
    async (plane) => {
      const outputPixels = plane.width * plane.height
      if (!Number.isSafeInteger(outputPixels) || outputPixels > limits.maxOutputTilePixels) {
        throw limitExceeded('Virtual detector output tile exceeds maxOutputTilePixels')
      }
      const data = new Float64Array(outputPixels)
      let outputIndex = 0
      for (let localY = 0; localY < plane.height; localY += 1) {
        for (let localX = 0; localX < plane.width; localX += 1) {
          throwIfAborted(plane.signal)
          const sourceTile = await context.readSourceTile(source, {
            displayAxes: [parameters.roles.detectorX, parameters.roles.detectorY],
            fixedIndices: Object.freeze([
              ...parameters.fixedIndices,
              Object.freeze({ axisId: parameters.roles.navigationX, index: plane.x + localX }),
              Object.freeze({ axisId: parameters.roles.navigationY, index: plane.y + localY }),
            ]),
            x: bounds.x,
            y: bounds.y,
            width: bounds.width,
            height: bounds.height,
            ...(plane.signal === undefined ? {} : { signal: plane.signal }),
          })
          try {
            if (sourceTile.data.byteLength > limits.maxSourceTileBytes) {
              throw limitExceeded('Virtual detector source tile exceeds maxSourceTileBytes')
            }
            data[outputIndex] = reducedTileValue(
              sourceTile,
              parameters.roi,
              bounds,
              parameters.reduction,
              source.descriptor.noDataValue,
            )
          } finally {
            sourceTile.release()
          }
          outputIndex += 1
        }
      }
      return outputTile(plane.x, plane.y, plane.width, plane.height, data)
    },
    identity,
  )
}

const navigationPositions = (
  roi: NavigationRoi,
  bounds: PixelBounds,
  maximum: number,
): Uint32Array => {
  const boundedPixels = bounds.width * bounds.height
  if (!Number.isSafeInteger(boundedPixels) || boundedPixels > maximum) {
    throw limitExceeded('Navigation ROI bounds exceed maxRoiPixels')
  }
  const positions = new Uint32Array(boundedPixels * 2)
  let positionCount = 0
  for (let y = bounds.y; y < bounds.y + bounds.height; y += 1) {
    for (let x = bounds.x; x < bounds.x + bounds.width; x += 1) {
      if (!includes(roi, x, y)) continue
      const offset = positionCount * 2
      positions[offset] = x
      positions[offset + 1] = y
      positionCount += 1
    }
  }
  if (positionCount === 0) throw invalidInput('Navigation ROI contains no scan positions')
  return positions.subarray(0, positionCount * 2)
}

const scanDataset = async (
  source: ScientificDataset,
  request: Readonly<OperationExecutionRequest>,
  context: AnalysisDatasetOperationContext,
  limits: ResolvedLimits,
): Promise<ScientificDataset> => {
  const parameters = parametersFrom(request.parameters, navigationRoiFrom)
  validateSource(source.descriptor, parameters)
  const navigationX = axis(source.descriptor, parameters.roles.navigationX)
  const navigationY = axis(source.descriptor, parameters.roles.navigationY)
  const bounds = boundsFor(parameters.roi, navigationX.length, navigationY.length)
  const positions = navigationPositions(parameters.roi, bounds, limits.maxRoiPixels)
  const descriptor = outputDescriptor(
    source.descriptor,
    [
      axis(source.descriptor, parameters.roles.detectorX),
      axis(source.descriptor, parameters.roles.detectorY),
    ],
    scanDiffractionReductionOperationId,
    request.parameters,
  )
  const identity = await context.derivedIdentity(source, request, 'dataset')
  return context.createDataset(
    descriptor,
    async (plane) => {
      const outputPixels = plane.width * plane.height
      if (!Number.isSafeInteger(outputPixels) || outputPixels > limits.maxOutputTilePixels) {
        throw limitExceeded('Diffraction reduction output tile exceeds maxOutputTilePixels')
      }
      const accumulators = new Float64Array(outputPixels)
      const counts = new Uint32Array(outputPixels)
      const invalid = new Uint8Array(outputPixels)
      let integerMagnitude: number | undefined
      const positionCount = positions.length / 2
      for (let position = 0; position < positions.length; position += 2) {
        throwIfAborted(plane.signal)
        const scanX = positions[position] ?? 0
        const scanY = positions[position + 1] ?? 0
        const sourceTile = await context.readSourceTile(source, {
          displayAxes: [parameters.roles.detectorX, parameters.roles.detectorY],
          fixedIndices: Object.freeze([
            ...parameters.fixedIndices,
            Object.freeze({ axisId: parameters.roles.navigationX, index: scanX }),
            Object.freeze({ axisId: parameters.roles.navigationY, index: scanY }),
          ]),
          x: plane.x,
          y: plane.y,
          width: plane.width,
          height: plane.height,
          ...(plane.signal === undefined ? {} : { signal: plane.signal }),
        })
        try {
          if (sourceTile.data.byteLength > limits.maxSourceTileBytes) {
            throw limitExceeded('Diffraction reduction source tile exceeds maxSourceTileBytes')
          }
          integerMagnitude ??= integerMaximumMagnitude(sourceTile.data)
          if (
            integerMagnitude !== undefined &&
            integerMagnitude * positionCount > Number.MAX_SAFE_INTEGER
          ) {
            throw limitExceeded(
              'Integer scan reduction worst-case sum exceeds exact float64 accumulation',
            )
          }
          for (let y = 0; y < sourceTile.height; y += 1) {
            for (let x = 0; x < sourceTile.width; x += 1) {
              const index = y * sourceTile.width + x
              const value = sampleAt(sourceTile, x, y)
              if (!usable(value, source.descriptor.noDataValue)) continue
              if (typeof value === 'bigint') {
                if (positionCount !== 1) {
                  throw limitExceeded('64-bit integer scan reductions require a point ROI')
                }
                accumulators[index] = exactFloat64(value, '64-bit detector sample')
              } else if (Number.isNaN(value)) {
                invalid[index] = 1
              } else {
                accumulators[index] = (accumulators[index] ?? 0) + value
              }
              counts[index] = (counts[index] ?? 0) + 1
            }
          }
        } finally {
          sourceTile.release()
        }
      }
      for (let index = 0; index < outputPixels; index += 1) {
        if (invalid[index] === 1 || counts[index] === 0) accumulators[index] = Number.NaN
        else if (parameters.reduction === 'mean') {
          accumulators[index] = (accumulators[index] ?? 0) / (counts[index] ?? 1)
        }
      }
      return outputTile(plane.x, plane.y, plane.width, plane.height, accumulators)
    },
    identity,
  )
}

const implementation = (
  definition: OperationDefinition,
  context: AnalysisDatasetOperationContext,
  limits: ResolvedLimits,
): OperationImplementation =>
  Object.freeze({
    descriptor: Object.freeze({
      operationId: definition.descriptor.id,
      operationVersion: definition.descriptor.version,
      implementationVersion: '1.0.0',
    }),
    supportsPlan(request: Readonly<OperationPlanningRequest>) {
      try {
        const inferred = definition.inferOutputShapes?.({
          parameters: request.parameters,
          inputs: request.inputCharacteristics,
        })
        return inferred?.valid === true && inferred.value !== undefined
      } catch {
        return false
      }
    },
    estimatePlan: estimate,
    validateExecution(request: Readonly<OperationExecutionRequest>): void {
      const source = datasetInput(request)
      const roiFrom =
        definition.descriptor.id === virtualDetectorMapOperationId
          ? detectorRoiFrom
          : navigationRoiFrom
      validateSource(source.descriptor, parametersFrom(request.parameters, roiFrom))
    },
    async execute(
      request: Readonly<OperationExecutionRequest>,
    ): Promise<readonly OperationOwnedOutput[]> {
      request.signal.throwIfAborted()
      const source = datasetInput(request)
      const dataset =
        definition.descriptor.id === virtualDetectorMapOperationId
          ? await virtualDataset(source, request, context, limits)
          : await scanDataset(source, request, context, limits)
      return Object.freeze([Object.freeze({ value: dataset, release() {} })])
    },
  })

export interface FourDStemAnalysisBundleOptions {
  readonly runtime: TileRuntime
  readonly tileWidth?: number
  readonly tileHeight?: number
  readonly sessionId?: string
  readonly limits?: Readonly<FourDStemOperationLimits>
}

export interface FourDStemAnalysisBundle {
  readonly operations: OperationRegistry
  readonly valueTypes: ValueTypeRegistry
  readonly providers: readonly OperationProvider[]
}

export const createFourDStemAnalysisBundle = (
  options: Readonly<FourDStemAnalysisBundleOptions>,
): FourDStemAnalysisBundle => {
  const context = new AnalysisDatasetOperationContext({
    runtime: options.runtime,
    ...(options.tileWidth === undefined ? {} : { tileWidth: options.tileWidth }),
    ...(options.tileHeight === undefined ? {} : { tileHeight: options.tileHeight }),
    ...(options.sessionId === undefined ? {} : { sessionId: options.sessionId }),
  })
  const limits = resolveLimits(options.limits)
  const provider = createOperationProvider({
    descriptor: {
      id: fourDStemReferenceProviderId,
      version: 1,
      kind: 'reference',
      buildFingerprint: 'typescript-4d-stem-reference-v1',
      title: 'PureJsImage 4D-STEM TypeScript reference provider',
    },
    prepare: async () =>
      Object.freeze(
        fourDStemOperationDefinitions.map((definition) =>
          implementation(definition, context, limits),
        ),
      ),
  })
  return Object.freeze({
    operations: createOperationRegistry(fourDStemOperationDefinitions),
    valueTypes: createScientificDatasetValueTypeRegistry(),
    providers: Object.freeze([provider]),
  })
}

export const fourDStemOperationParameters = (parameters: {
  readonly roles: FourDStemAxisRoles
  readonly fixedIndices?: readonly ScientificAxisIndex[]
  readonly roi: DetectorRoi | NavigationRoi
  readonly reduction: FourDStemReduction
}): OperationJsonObject =>
  normalizeOperationJsonObject({
    roles: parameters.roles,
    fixedIndices: parameters.fixedIndices ?? [],
    roi: parameters.roi,
    reduction: parameters.reduction,
    numericPolicy: 'float64-safe-integer',
  })
