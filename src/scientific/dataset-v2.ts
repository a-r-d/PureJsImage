import type { AbortOptions } from '../abort.ts'
import { invalidInput } from '../errors.ts'
import type { RasterBlock, RasterSampleType } from '../raster.ts'

export type ScientificAxisKind =
  | 'space'
  | 'time'
  | 'channel'
  | 'spectral'
  | 'reciprocal-space'
  | 'angle'
  | 'index'
  | 'other'

export type ScientificAxisCoordinates =
  | { readonly type: 'index' }
  | { readonly type: 'linear'; readonly origin: number; readonly step: number }
  | { readonly type: 'lookup'; readonly values: readonly number[] }
  | { readonly type: 'labels'; readonly values: readonly string[] }

/** Optional metadata for one independently selectable coordinate on an axis. */
export interface ScientificAxisEntryDescriptor {
  readonly id?: string
  readonly name?: string
  readonly unit?: string
  readonly color?: number
  readonly spectral?: {
    readonly center: number
    readonly unit?: string
    readonly fwhm?: number
  }
}

export interface ScientificAxisDescriptor {
  readonly id: string
  readonly name?: string
  readonly kind: ScientificAxisKind
  readonly length: number
  readonly unit?: string
  readonly coordinates: ScientificAxisCoordinates
  readonly entries?: readonly ScientificAxisEntryDescriptor[]
}

export type ScientificComponentKind =
  | 'scalar'
  | 'intensity'
  | 'red'
  | 'green'
  | 'blue'
  | 'alpha'
  | 'vector'
  | 'other'

/** One sample component stored at every selected dataset coordinate. */
export interface ScientificComponentDescriptor {
  readonly id: string
  readonly name?: string
  readonly kind: ScientificComponentKind
  readonly unit?: string
  readonly color?: number
}

export interface ScientificResolutionAxisLength {
  readonly axisId: string
  readonly length: number
}

/** Explicit axis lengths at one resolution level. */
export interface ScientificResolutionLevel {
  readonly level: number
  readonly axisLengths: readonly ScientificResolutionAxisLength[]
}

export type ScientificMetadataValue =
  | null
  | boolean
  | number
  | string
  | readonly ScientificMetadataValue[]
  | ScientificMetadataObject

export interface ScientificMetadataObject {
  readonly [key: string]: ScientificMetadataValue
}

export type ScientificPlaneReadCapability =
  | { readonly kind: 'any-axis-pair' }
  | {
      readonly kind: 'ordered-axis-pairs'
      readonly pairs: readonly (readonly [horizontal: string, vertical: string])[]
    }

export interface ScientificDatasetCapabilities {
  readonly regionReads: boolean
  readonly resolutionLevels: boolean
  readonly planeReads: ScientificPlaneReadCapability
}

/** Portable, JSON-safe description of a labeled-axis scientific raster. */
export interface ScientificDatasetDescriptor {
  readonly schemaVersion: 2
  readonly axes: readonly ScientificAxisDescriptor[]
  readonly sampleType: RasterSampleType
  readonly components: readonly ScientificComponentDescriptor[]
  readonly levels?: readonly ScientificResolutionLevel[]
  readonly noDataValue?: number
  readonly metadata?: ScientificMetadataObject
  readonly capabilities: ScientificDatasetCapabilities
}

/** A validated descriptor with an explicit level zero. */
export interface NormalizedScientificDatasetDescriptor
  extends Omit<ScientificDatasetDescriptor, 'levels'> {
  readonly levels: readonly ScientificResolutionLevel[]
}

export interface ScientificAxisIndex {
  readonly axisId: string
  readonly index: number
}

export interface ScientificPlaneReadRequest extends AbortOptions {
  /** Horizontal then vertical display axis. */
  readonly displayAxes: readonly [horizontal: string, vertical: string]
  readonly fixedIndices: readonly ScientificAxisIndex[]
  readonly resolutionLevel?: number
  readonly x?: number
  readonly y?: number
  readonly width?: number
  readonly height?: number
}

export interface NormalizedScientificPlaneReadRequest extends ScientificPlaneReadRequest {
  readonly fixedIndices: readonly ScientificAxisIndex[]
  readonly resolutionLevel: number
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

/** A lazy labeled-axis raster whose plane reads remain at the portable RasterBlock boundary. */
export interface ScientificDataset {
  readonly descriptor: NormalizedScientificDatasetDescriptor
  readPlane(request: Readonly<ScientificPlaneReadRequest>): AsyncIterable<RasterBlock>
}

type UnknownRecord = { readonly [key: string]: unknown }
type ParseMode = 'validate' | 'normalize'

const maximumMetadataDepth = 64
const maximumMetadataValues = 1_000_000

const axisKinds: readonly ScientificAxisKind[] = [
  'space',
  'time',
  'channel',
  'spectral',
  'reciprocal-space',
  'angle',
  'index',
  'other',
]

const componentKinds: readonly ScientificComponentKind[] = [
  'scalar',
  'intensity',
  'red',
  'green',
  'blue',
  'alpha',
  'vector',
  'other',
]

const sampleTypes: readonly RasterSampleType[] = [
  'uint8',
  'uint16',
  'uint32',
  'uint64',
  'int8',
  'int16',
  'int32',
  'float16',
  'float32',
  'float64',
]

const isUnknownArray = (value: unknown): value is readonly unknown[] => Array.isArray(value)

const isUnknownRecord = (value: unknown): value is UnknownRecord =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

const recordValue = (value: unknown, label: string): UnknownRecord => {
  if (!isUnknownRecord(value)) throw invalidInput(`${label} must be an object`)
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) {
    throw invalidInput(`${label} must be a plain object`)
  }
  if (Object.getOwnPropertySymbols(value).length !== 0) {
    throw invalidInput(`${label} must not contain symbol keys`)
  }
  return value
}

const arrayValue = (value: unknown, label: string): readonly unknown[] => {
  if (!isUnknownArray(value)) throw invalidInput(`${label} must be an array`)
  return value
}

const onlyKeys = (value: UnknownRecord, allowed: readonly string[], label: string): void => {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) throw invalidInput(`${label} contains unknown property ${key}`)
  }
}

const requiredString = (value: unknown, label: string): string => {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw invalidInput(`${label} must be a non-empty string`)
  }
  return value
}

const optionalString = (value: unknown, label: string): string | undefined => {
  if (value === undefined) return undefined
  return requiredString(value, label)
}

const positiveInteger = (value: unknown, label: string): number => {
  if (!Number.isSafeInteger(value) || typeof value !== 'number' || value < 1) {
    throw invalidInput(`${label} must be a positive safe integer`)
  }
  return value
}

const nonNegativeInteger = (value: unknown, label: string): number => {
  if (!Number.isSafeInteger(value) || typeof value !== 'number' || value < 0) {
    throw invalidInput(`${label} must be a non-negative safe integer`)
  }
  return value
}

const finiteNumber = (value: unknown, label: string): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw invalidInput(`${label} must be finite`)
  }
  return value
}

const booleanValue = (value: unknown, label: string): boolean => {
  if (typeof value !== 'boolean') throw invalidInput(`${label} must be boolean`)
  return value
}

const enumValue = <Value extends string>(
  value: unknown,
  values: readonly Value[],
  label: string,
): Value => {
  const normalized = values.find((candidate) => candidate === value)
  if (normalized === undefined) throw invalidInput(`${label} is invalid`)
  return normalized
}

const normalizeNumericCoordinateValues = (
  value: unknown,
  length: number,
  mode: ParseMode,
  label: string,
): readonly number[] => {
  const input = arrayValue(value, `${label}.values`)
  if (input.length !== length) {
    throw invalidInput(`${label}.values must contain exactly ${length} entries`)
  }
  const numbers: number[] = []
  for (let index = 0; index < input.length; index += 1) {
    if (!(index in input)) throw invalidInput(`${label}.values must not contain holes`)
    const normalized = finiteNumber(input[index], `${label}.values[${index}]`)
    if (mode === 'normalize') numbers.push(normalized)
  }
  return Object.freeze(numbers)
}

const normalizeLabelCoordinateValues = (
  value: unknown,
  length: number,
  mode: ParseMode,
  label: string,
): readonly string[] => {
  const input = arrayValue(value, `${label}.values`)
  if (input.length !== length) {
    throw invalidInput(`${label}.values must contain exactly ${length} entries`)
  }
  const strings: string[] = []
  for (let index = 0; index < input.length; index += 1) {
    if (!(index in input)) throw invalidInput(`${label}.values must not contain holes`)
    const entry = input[index]
    if (typeof entry !== 'string') {
      throw invalidInput(`${label}.values[${index}] must be a string`)
    }
    if (mode === 'normalize') strings.push(entry)
  }
  return Object.freeze(strings)
}

const normalizeCoordinates = (
  value: unknown,
  length: number,
  mode: ParseMode,
  label: string,
): ScientificAxisCoordinates => {
  const input = recordValue(value, label)
  const type = requiredString(input.type, `${label}.type`)
  if (type === 'index') {
    onlyKeys(input, ['type'], label)
    return Object.freeze({ type: 'index' })
  }
  if (type === 'linear') {
    onlyKeys(input, ['type', 'origin', 'step'], label)
    const origin = finiteNumber(input.origin, `${label}.origin`)
    const step = finiteNumber(input.step, `${label}.step`)
    if (step === 0) throw invalidInput(`${label}.step must not be zero`)
    return Object.freeze({ type: 'linear', origin, step })
  }
  if (type === 'lookup') {
    onlyKeys(input, ['type', 'values'], label)
    const values = normalizeNumericCoordinateValues(input.values, length, mode, label)
    return Object.freeze({ type: 'lookup', values })
  }
  if (type === 'labels') {
    onlyKeys(input, ['type', 'values'], label)
    const values = normalizeLabelCoordinateValues(input.values, length, mode, label)
    return Object.freeze({ type: 'labels', values })
  }
  throw invalidInput(`${label}.type is invalid`)
}

const emptyAxisEntry: ScientificAxisEntryDescriptor = Object.freeze({})

const normalizeAxisEntry = (
  value: unknown,
  index: number,
  mode: ParseMode,
  label: string,
): ScientificAxisEntryDescriptor => {
  const entryLabel = `${label}[${index}]`
  const input = recordValue(value, entryLabel)
  onlyKeys(input, ['id', 'name', 'unit', 'color', 'spectral'], entryLabel)
  const id = optionalString(input.id, `${entryLabel}.id`)
  const name = optionalString(input.name, `${entryLabel}.name`)
  const unit = optionalString(input.unit, `${entryLabel}.unit`)
  const color =
    input.color === undefined ? undefined : finiteNumber(input.color, `${entryLabel}.color`)
  if (
    color !== undefined &&
    (!Number.isSafeInteger(color) || color < -2_147_483_648 || color > 4_294_967_295)
  ) {
    throw invalidInput(`${entryLabel}.color must be a signed or unsigned 32-bit integer`)
  }
  let spectral:
    | {
        readonly center: number
        readonly unit?: string
        readonly fwhm?: number
      }
    | undefined
  if (input.spectral !== undefined) {
    const spectralInput = recordValue(input.spectral, `${entryLabel}.spectral`)
    onlyKeys(spectralInput, ['center', 'unit', 'fwhm'], `${entryLabel}.spectral`)
    const center = finiteNumber(spectralInput.center, `${entryLabel}.spectral.center`)
    const spectralUnit = optionalString(spectralInput.unit, `${entryLabel}.spectral.unit`)
    const fwhm =
      spectralInput.fwhm === undefined
        ? undefined
        : finiteNumber(spectralInput.fwhm, `${entryLabel}.spectral.fwhm`)
    if (mode === 'normalize') {
      spectral = Object.freeze({
        center,
        ...(spectralUnit === undefined ? {} : { unit: spectralUnit }),
        ...(fwhm === undefined ? {} : { fwhm }),
      })
    }
  }
  if (mode === 'validate') return emptyAxisEntry
  return Object.freeze({
    ...(id === undefined ? {} : { id }),
    ...(name === undefined ? {} : { name }),
    ...(unit === undefined ? {} : { unit }),
    ...(color === undefined ? {} : { color }),
    ...(spectral === undefined ? {} : { spectral }),
  })
}

const normalizeAxisEntries = (
  value: unknown,
  length: number,
  mode: ParseMode,
  label: string,
): readonly ScientificAxisEntryDescriptor[] => {
  const input = arrayValue(value, label)
  if (input.length !== length) {
    throw invalidInput(`${label} must contain exactly ${length} entries`)
  }
  const output: ScientificAxisEntryDescriptor[] = []
  for (let index = 0; index < input.length; index += 1) {
    if (!(index in input)) throw invalidInput(`${label} must not contain holes`)
    const entry = normalizeAxisEntry(input[index], index, mode, label)
    if (mode === 'normalize') output.push(entry)
  }
  return Object.freeze(output)
}

const normalizeAxis = (
  value: unknown,
  index: number,
  mode: ParseMode,
): ScientificAxisDescriptor => {
  const label = `Scientific dataset axis ${index}`
  const input = recordValue(value, label)
  onlyKeys(input, ['id', 'name', 'kind', 'length', 'unit', 'coordinates', 'entries'], label)
  const id = requiredString(input.id, `${label}.id`)
  const name = optionalString(input.name, `${label}.name`)
  const kind = enumValue(input.kind, axisKinds, `${label}.kind`)
  const length = positiveInteger(input.length, `${label}.length`)
  const unit = optionalString(input.unit, `${label}.unit`)
  const coordinates = normalizeCoordinates(input.coordinates, length, mode, `${label}.coordinates`)
  const entries =
    input.entries === undefined
      ? undefined
      : normalizeAxisEntries(input.entries, length, mode, `${label}.entries`)
  return Object.freeze({
    id,
    kind,
    length,
    coordinates,
    ...(name === undefined ? {} : { name }),
    ...(unit === undefined ? {} : { unit }),
    ...(entries === undefined ? {} : { entries }),
  })
}

const normalizeComponent = (value: unknown, index: number): ScientificComponentDescriptor => {
  const label = `Scientific dataset component ${index}`
  const input = recordValue(value, label)
  onlyKeys(input, ['id', 'name', 'kind', 'unit', 'color'], label)
  const id = requiredString(input.id, `${label}.id`)
  const name = optionalString(input.name, `${label}.name`)
  const kind = enumValue(input.kind, componentKinds, `${label}.kind`)
  const unit = optionalString(input.unit, `${label}.unit`)
  const color =
    input.color === undefined ? undefined : nonNegativeInteger(input.color, `${label}.color`)
  if (color !== undefined && color > 0xffffff) {
    throw invalidInput(`${label}.color must be an RGB integer from 0x000000 through 0xffffff`)
  }
  return Object.freeze({
    id,
    kind,
    ...(name === undefined ? {} : { name }),
    ...(unit === undefined ? {} : { unit }),
    ...(color === undefined ? {} : { color }),
  })
}

interface MetadataState {
  count: number
  readonly ancestors: Set<object>
  readonly mode: ParseMode
}

const normalizeMetadataValue = (
  value: unknown,
  state: MetadataState,
  path: string,
  depth: number,
): ScientificMetadataValue => {
  state.count += 1
  if (state.count > maximumMetadataValues) {
    throw invalidInput(`Scientific dataset metadata exceeds ${maximumMetadataValues} values`)
  }
  if (depth > maximumMetadataDepth) {
    throw invalidInput(`Scientific dataset metadata exceeds depth ${maximumMetadataDepth}`)
  }
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value
  if (typeof value === 'number') return finiteNumber(value, path)
  if (isUnknownArray(value)) {
    if (state.ancestors.has(value)) throw invalidInput(`${path} contains a cycle`)
    state.ancestors.add(value)
    try {
      const output: ScientificMetadataValue[] = []
      for (let index = 0; index < value.length; index += 1) {
        if (!(index in value)) throw invalidInput(`${path} must not contain holes`)
        const normalized = normalizeMetadataValue(
          value[index],
          state,
          `${path}[${index}]`,
          depth + 1,
        )
        if (state.mode === 'normalize') output.push(normalized)
      }
      return Object.freeze(output)
    } finally {
      state.ancestors.delete(value)
    }
  }
  if (value !== null && typeof value === 'object') {
    const input = recordValue(value, path)
    if (state.ancestors.has(value)) throw invalidInput(`${path} contains a cycle`)
    state.ancestors.add(value)
    try {
      const output: { [key: string]: ScientificMetadataValue } = {}
      for (const key of Object.keys(input)) {
        const property = Object.getOwnPropertyDescriptor(input, key)
        if (!property || !('value' in property)) {
          throw invalidInput(`${path}.${key} must be a data property`)
        }
        const normalized = normalizeMetadataValue(
          property.value,
          state,
          `${path}.${key}`,
          depth + 1,
        )
        if (state.mode === 'normalize') {
          Object.defineProperty(output, key, {
            configurable: false,
            enumerable: true,
            value: normalized,
            writable: false,
          })
        }
      }
      return Object.freeze(output)
    } finally {
      state.ancestors.delete(value)
    }
  }
  throw invalidInput(`${path} is not JSON-safe`)
}

const normalizeMetadata = (value: unknown, mode: ParseMode): ScientificMetadataObject => {
  const normalized = normalizeMetadataValue(
    value,
    { count: 0, ancestors: new Set<object>(), mode },
    'Scientific dataset metadata',
    0,
  )
  if (normalized === null || isUnknownArray(normalized) || typeof normalized !== 'object') {
    throw invalidInput('Scientific dataset metadata must be an object')
  }
  return normalized
}

/** Validate and copy a JSON-safe scientific metadata object into immutable plain data. */
export const normalizeScientificMetadataObject = (value: unknown): ScientificMetadataObject =>
  normalizeMetadata(value, 'normalize')

const implicitLevelZero = (axes: readonly ScientificAxisDescriptor[]): ScientificResolutionLevel =>
  Object.freeze({
    level: 0,
    axisLengths: Object.freeze(
      axes.map((axis) => Object.freeze({ axisId: axis.id, length: axis.length })),
    ),
  })

const normalizeLevels = (
  value: unknown,
  axes: readonly ScientificAxisDescriptor[],
): readonly ScientificResolutionLevel[] => {
  if (value === undefined) return Object.freeze([implicitLevelZero(axes)])
  const input = arrayValue(value, 'Scientific dataset levels')
  if (input.length === 0) throw invalidInput('Scientific dataset levels must not be empty')
  const axisById = new Map(axes.map((axis) => [axis.id, axis]))
  const seenLevels = new Set<number>()
  const levels: ScientificResolutionLevel[] = []
  for (let index = 0; index < input.length; index += 1) {
    const label = `Scientific dataset level ${index}`
    const levelInput = recordValue(input[index], label)
    onlyKeys(levelInput, ['level', 'axisLengths'], label)
    const level = nonNegativeInteger(levelInput.level, `${label}.level`)
    if (seenLevels.has(level)) throw invalidInput(`Scientific dataset level ${level} is duplicated`)
    seenLevels.add(level)
    const lengthInputs = arrayValue(levelInput.axisLengths, `${label}.axisLengths`)
    if (lengthInputs.length !== axes.length) {
      throw invalidInput(`${label}.axisLengths must describe every dataset axis exactly once`)
    }
    const lengths = new Map<string, number>()
    for (let lengthIndex = 0; lengthIndex < lengthInputs.length; lengthIndex += 1) {
      const lengthLabel = `${label}.axisLengths[${lengthIndex}]`
      const lengthInput = recordValue(lengthInputs[lengthIndex], lengthLabel)
      onlyKeys(lengthInput, ['axisId', 'length'], lengthLabel)
      const axisId = requiredString(lengthInput.axisId, `${lengthLabel}.axisId`)
      if (!axisById.has(axisId)) throw invalidInput(`${lengthLabel} names unknown axis ${axisId}`)
      if (lengths.has(axisId)) throw invalidInput(`${label} repeats axis ${axisId}`)
      lengths.set(axisId, positiveInteger(lengthInput.length, `${lengthLabel}.length`))
    }
    const axisLengths = Object.freeze(
      axes.map((axis) => {
        const length = lengths.get(axis.id)
        if (length === undefined) throw invalidInput(`${label} is missing axis ${axis.id}`)
        if (level === 0 && length !== axis.length) {
          throw invalidInput(`${label} axis ${axis.id} must match its descriptor length`)
        }
        return Object.freeze({ axisId: axis.id, length })
      }),
    )
    levels.push(Object.freeze({ level, axisLengths }))
  }
  if (!seenLevels.has(0)) throw invalidInput('Scientific dataset levels must include level 0')
  levels.sort((left, right) => left.level - right.level)
  return Object.freeze(levels)
}

const parseDescriptor = (
  value: unknown,
  mode: ParseMode,
): NormalizedScientificDatasetDescriptor => {
  const input = recordValue(value, 'Scientific dataset descriptor')
  onlyKeys(
    input,
    [
      'schemaVersion',
      'axes',
      'sampleType',
      'components',
      'levels',
      'noDataValue',
      'metadata',
      'capabilities',
    ],
    'Scientific dataset descriptor',
  )
  if (input.schemaVersion !== 2) throw invalidInput('Scientific dataset schemaVersion must be 2')

  const axisInputs = arrayValue(input.axes, 'Scientific dataset axes')
  if (axisInputs.length < 2) throw invalidInput('Scientific dataset must contain at least two axes')
  const axes = Object.freeze(axisInputs.map((axis, index) => normalizeAxis(axis, index, mode)))
  const axisIds = new Set<string>()
  for (const axis of axes) {
    if (axisIds.has(axis.id)) throw invalidInput(`Scientific dataset axis ${axis.id} is duplicated`)
    axisIds.add(axis.id)
  }

  const sampleType = enumValue(input.sampleType, sampleTypes, 'Scientific dataset sampleType')
  const componentInputs = arrayValue(input.components, 'Scientific dataset components')
  if (componentInputs.length === 0) {
    throw invalidInput('Scientific dataset must contain at least one component')
  }
  const components = Object.freeze(
    componentInputs.map((component, index) => normalizeComponent(component, index)),
  )
  const componentIds = new Set<string>()
  for (const component of components) {
    if (componentIds.has(component.id)) {
      throw invalidInput(`Scientific dataset component ${component.id} is duplicated`)
    }
    componentIds.add(component.id)
  }

  const levels = normalizeLevels(input.levels, axes)
  const capabilitiesInput = recordValue(input.capabilities, 'Scientific dataset capabilities')
  onlyKeys(
    capabilitiesInput,
    ['regionReads', 'resolutionLevels', 'planeReads'],
    'Scientific dataset capabilities',
  )
  const planeReadsInput = recordValue(
    capabilitiesInput.planeReads,
    'Scientific dataset capabilities.planeReads',
  )
  const planeReadKind = enumValue(
    planeReadsInput.kind,
    ['any-axis-pair', 'ordered-axis-pairs'] as const,
    'Scientific dataset capabilities.planeReads.kind',
  )
  let planeReads: ScientificPlaneReadCapability
  if (planeReadKind === 'any-axis-pair') {
    onlyKeys(planeReadsInput, ['kind'], 'Scientific dataset capabilities.planeReads')
    planeReads = Object.freeze({ kind: planeReadKind })
  } else {
    onlyKeys(planeReadsInput, ['kind', 'pairs'], 'Scientific dataset capabilities.planeReads')
    const pairInputs = arrayValue(
      planeReadsInput.pairs,
      'Scientific dataset capabilities.planeReads.pairs',
    )
    if (pairInputs.length === 0) {
      throw invalidInput('Scientific dataset must support at least one ordered display-axis pair')
    }
    const seenPairs = new Set<string>()
    const pairs = pairInputs.map((value, index) => {
      const pair = arrayValue(value, `Scientific dataset capabilities.planeReads.pairs[${index}]`)
      if (pair.length !== 2) {
        throw invalidInput('Scientific display-axis capability pairs must contain two axis ids')
      }
      const horizontal = requiredString(pair[0], 'Scientific display-axis capability horizontal id')
      const vertical = requiredString(pair[1], 'Scientific display-axis capability vertical id')
      if (horizontal === vertical) {
        throw invalidInput('Scientific display-axis capability pairs must name distinct axes')
      }
      if (!axisIds.has(horizontal) || !axisIds.has(vertical)) {
        throw invalidInput('Scientific display-axis capability pair names an unknown axis')
      }
      const key = `${horizontal}\u0000${vertical}`
      if (seenPairs.has(key)) {
        throw invalidInput('Scientific display-axis capability pairs must not be duplicated')
      }
      seenPairs.add(key)
      return Object.freeze([horizontal, vertical] as const)
    })
    planeReads = Object.freeze({ kind: planeReadKind, pairs: Object.freeze(pairs) })
  }
  const capabilities = Object.freeze({
    regionReads: booleanValue(
      capabilitiesInput.regionReads,
      'Scientific dataset capabilities.regionReads',
    ),
    resolutionLevels: booleanValue(
      capabilitiesInput.resolutionLevels,
      'Scientific dataset capabilities.resolutionLevels',
    ),
    planeReads,
  })
  if (capabilities.resolutionLevels !== levels.length > 1) {
    throw invalidInput(
      'Scientific dataset resolutionLevels capability must match its declared levels',
    )
  }

  let noDataValue: number | undefined
  if (input.noDataValue !== undefined) {
    if (
      typeof input.noDataValue !== 'number' ||
      (!Number.isFinite(input.noDataValue) && !Number.isNaN(input.noDataValue))
    ) {
      throw invalidInput('Scientific dataset noDataValue must be finite or NaN')
    }
    noDataValue = input.noDataValue
  }
  const metadata =
    input.metadata === undefined ? undefined : normalizeMetadata(input.metadata, mode)

  return Object.freeze({
    schemaVersion: 2,
    axes,
    sampleType,
    components,
    levels,
    capabilities,
    ...(noDataValue === undefined ? {} : { noDataValue }),
    ...(metadata === undefined ? {} : { metadata }),
  })
}

/** Validate without copying large coordinate arrays. */
export const validateScientificDatasetDescriptor = (value: unknown): void => {
  parseDescriptor(value, 'validate')
}

/** Validate and copy the descriptor once into frozen, normalized plain data. */
export const normalizeScientificDatasetDescriptor = (
  value: unknown,
): NormalizedScientificDatasetDescriptor => parseDescriptor(value, 'normalize')

const levelAxisLengths = (
  descriptor: NormalizedScientificDatasetDescriptor,
  level: number,
): Map<string, number> => {
  const selected = descriptor.levels.find((candidate) => candidate.level === level)
  if (!selected) throw invalidInput(`Scientific dataset resolution level ${level} is unavailable`)
  return new Map(selected.axisLengths.map((axis) => [axis.axisId, axis.length]))
}

/** Resolve singleton selections, level dimensions, and the complete plane region once before I/O. */
export const normalizeScientificPlaneReadRequest = (
  descriptor: NormalizedScientificDatasetDescriptor,
  request: unknown,
): NormalizedScientificPlaneReadRequest => {
  const input = recordValue(request, 'Scientific plane request')
  onlyKeys(
    input,
    ['displayAxes', 'fixedIndices', 'resolutionLevel', 'x', 'y', 'width', 'height', 'signal'],
    'Scientific plane request',
  )
  const displayAxesInput = arrayValue(input.displayAxes, 'Scientific plane request.displayAxes')
  if (displayAxesInput.length !== 2) {
    throw invalidInput('Scientific plane request.displayAxes must contain exactly two axis ids')
  }
  const horizontal = requiredString(displayAxesInput[0], 'Scientific plane request.displayAxes[0]')
  const vertical = requiredString(displayAxesInput[1], 'Scientific plane request.displayAxes[1]')
  if (horizontal === vertical) throw invalidInput('Scientific display axes must be distinct')
  const axisById = new Map(descriptor.axes.map((axis) => [axis.id, axis]))
  if (!axisById.has(horizontal)) throw invalidInput(`Unknown scientific display axis ${horizontal}`)
  if (!axisById.has(vertical)) throw invalidInput(`Unknown scientific display axis ${vertical}`)
  const planeReads = descriptor.capabilities.planeReads
  if (
    planeReads.kind === 'ordered-axis-pairs' &&
    !planeReads.pairs.some((pair) => pair[0] === horizontal && pair[1] === vertical)
  ) {
    throw invalidInput(`Scientific dataset does not support display axes ${horizontal}/${vertical}`)
  }

  const resolutionLevel = nonNegativeInteger(
    input.resolutionLevel ?? 0,
    'Scientific resolutionLevel',
  )
  const lengths = levelAxisLengths(descriptor, resolutionLevel)
  const selections = new Map<string, number>()
  const fixedInputs = arrayValue(input.fixedIndices, 'Scientific plane request.fixedIndices')
  for (let index = 0; index < fixedInputs.length; index += 1) {
    const label = `Scientific plane request.fixedIndices[${index}]`
    const selection = recordValue(fixedInputs[index], label)
    onlyKeys(selection, ['axisId', 'index'], label)
    const axisId = requiredString(selection.axisId, `${label}.axisId`)
    const axis = axisById.get(axisId)
    if (!axis) throw invalidInput(`Scientific fixed index names unknown axis ${axisId}`)
    if (axisId === horizontal || axisId === vertical) {
      throw invalidInput(`Scientific display axis ${axisId} must not also be fixed`)
    }
    if (selections.has(axisId)) {
      throw invalidInput(`Scientific fixed index repeats axis ${axisId}`)
    }
    const axisLength = lengths.get(axisId)
    if (axisLength === undefined) throw invalidInput(`Resolution level is missing axis ${axisId}`)
    const selectedIndex = nonNegativeInteger(
      selection.index,
      `Scientific fixed index for ${axisId}`,
    )
    if (selectedIndex >= axisLength) {
      throw invalidInput(`Scientific fixed index for ${axisId} is outside the selected level`)
    }
    selections.set(axisId, selectedIndex)
  }

  const fixedIndices: ScientificAxisIndex[] = []
  for (const axis of descriptor.axes) {
    if (axis.id === horizontal || axis.id === vertical) continue
    const axisLength = lengths.get(axis.id)
    if (axisLength === undefined) throw invalidInput(`Resolution level is missing axis ${axis.id}`)
    const index = selections.get(axis.id)
    if (index === undefined && axisLength !== 1) {
      throw invalidInput(`Scientific plane request must fix non-singleton axis ${axis.id}`)
    }
    fixedIndices.push(Object.freeze({ axisId: axis.id, index: index ?? 0 }))
  }

  const horizontalLength = lengths.get(horizontal)
  const verticalLength = lengths.get(vertical)
  if (horizontalLength === undefined || verticalLength === undefined) {
    throw invalidInput('Resolution level is missing a scientific display axis')
  }
  const x = nonNegativeInteger(input.x ?? 0, 'Scientific plane x')
  const y = nonNegativeInteger(input.y ?? 0, 'Scientific plane y')
  const width = positiveInteger(input.width ?? horizontalLength - x, 'Scientific plane width')
  const height = positiveInteger(input.height ?? verticalLength - y, 'Scientific plane height')
  if (
    x > horizontalLength ||
    width > horizontalLength - x ||
    y > verticalLength ||
    height > verticalLength - y
  ) {
    throw invalidInput('Scientific plane region is outside the selected resolution level')
  }
  if (
    !descriptor.capabilities.regionReads &&
    (x !== 0 || y !== 0 || width !== horizontalLength || height !== verticalLength)
  ) {
    throw invalidInput('Scientific dataset does not support region reads')
  }

  const displayAxes: readonly [horizontal: string, vertical: string] = Object.freeze([
    horizontal,
    vertical,
  ])
  if (input.signal !== undefined && !(input.signal instanceof AbortSignal)) {
    throw invalidInput('Scientific plane request.signal must be an AbortSignal')
  }

  return Object.freeze({
    displayAxes,
    fixedIndices: Object.freeze(fixedIndices),
    resolutionLevel,
    x,
    y,
    width,
    height,
    ...(input.signal === undefined ? {} : { signal: input.signal }),
  })
}
