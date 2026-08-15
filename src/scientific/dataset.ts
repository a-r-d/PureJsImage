import type { AbortOptions } from '../abort.ts'
import { invalidInput } from '../errors.ts'
import { rasterSampleBytes } from '../raster.ts'
import type { RasterBlock, RasterFormat, RasterSampleType } from '../raster.ts'

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

export type ScientificCalibrationEvidenceKind =
  | 'embedded'
  | 'sidecar'
  | 'derived'
  | 'format-default'

/** Machine-readable provenance for one axis's normalized coordinates and unit. */
export interface ScientificCalibrationEvidence {
  readonly kind: ScientificCalibrationEvidenceKind
  readonly resourceId: string
  readonly locator: string
  readonly formula?: string
  readonly note?: string
}

/** One or more contributors to an axis's normalized calibration interpretation. */
export type ScientificCalibrationEvidenceSet =
  | ScientificCalibrationEvidence
  | readonly ScientificCalibrationEvidence[]

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
  readonly calibration?: ScientificCalibrationEvidenceSet
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

/** Optional calibrated coordinates that replace one base axis at a resolution level. */
export interface ScientificResolutionAxisCoordinates {
  readonly axisId: string
  readonly coordinates: ScientificAxisCoordinates
}

/** Explicit axis lengths and optional calibrated coordinates at one resolution level. */
export interface ScientificResolutionLevel {
  readonly level: number
  readonly axisLengths: readonly ScientificResolutionAxisLength[]
  readonly axisCoordinates?: readonly ScientificResolutionAxisCoordinates[]
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
  | { readonly kind: 'none' }
  | { readonly kind: 'any-axis-pair' }
  | {
      readonly kind: 'ordered-axis-pairs'
      readonly pairs: readonly (readonly [horizontal: string, vertical: string])[]
    }

export type ScientificSeriesReadCapability =
  | { readonly kind: 'any-axis' }
  | { readonly kind: 'axes'; readonly axes: readonly string[] }

export interface ScientificDatasetCapabilities {
  readonly regionReads: boolean
  readonly resolutionLevels: boolean
  readonly planeReads: ScientificPlaneReadCapability
  readonly seriesReads?: ScientificSeriesReadCapability
}

/** Portable, JSON-safe description of labeled-axis scientific data. */
export interface ScientificDatasetDescriptor {
  readonly schemaVersion: 1
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

export interface ScientificSeriesReadRequest extends AbortOptions {
  /** The one varying axis returned in increasing index order. */
  readonly axisId: string
  readonly fixedIndices: readonly ScientificAxisIndex[]
  readonly resolutionLevel?: number
  readonly start?: number
  readonly length?: number
}

export interface NormalizedScientificSeriesReadRequest extends ScientificSeriesReadRequest {
  readonly fixedIndices: readonly ScientificAxisIndex[]
  readonly resolutionLevel: number
  readonly start: number
  readonly length: number
}

/** One tightly packed, canonical big-endian segment from a one-dimensional scientific series. */
export interface ScientificSeriesBlock {
  readonly start: number
  readonly length: number
  readonly format: RasterFormat
  readonly data: Uint8Array
  readonly release?: () => void
}

/** A lazy labeled-axis dataset whose bounded reads remain at portable canonical-byte boundaries. */
export interface ScientificDataset {
  readonly descriptor: NormalizedScientificDatasetDescriptor
  readPlane(request: Readonly<ScientificPlaneReadRequest>): AsyncIterable<RasterBlock>
  /** Optional one-axis reads, advertised exactly by descriptor.capabilities.seriesReads. */
  readSeries?(request: Readonly<ScientificSeriesReadRequest>): AsyncIterable<ScientificSeriesBlock>
}

type UnknownRecord = { readonly [key: string]: unknown }
type ParseMode = 'validate' | 'normalize'

const maximumMetadataDepth = 64
const maximumMetadataValues = 1_000_000
const maximumCalibrationEvidenceContributors = 16

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

const calibrationEvidenceKinds: readonly ScientificCalibrationEvidenceKind[] = [
  'embedded',
  'sidecar',
  'derived',
  'format-default',
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

const normalizeCalibrationEvidence = (
  value: unknown,
  label: string,
): ScientificCalibrationEvidence => {
  const input = recordValue(value, label)
  onlyKeys(input, ['kind', 'resourceId', 'locator', 'formula', 'note'], label)
  const kind = enumValue(input.kind, calibrationEvidenceKinds, `${label}.kind`)
  const resourceId = requiredString(input.resourceId, `${label}.resourceId`)
  const locator = requiredString(input.locator, `${label}.locator`)
  const formula = optionalString(input.formula, `${label}.formula`)
  const note = optionalString(input.note, `${label}.note`)
  return Object.freeze({
    kind,
    resourceId,
    locator,
    ...(formula === undefined ? {} : { formula }),
    ...(note === undefined ? {} : { note }),
  })
}

const normalizeCalibrationEvidenceSet = (
  value: unknown,
  label: string,
): ScientificCalibrationEvidenceSet => {
  if (!isUnknownArray(value)) return normalizeCalibrationEvidence(value, label)
  if (value.length < 1 || value.length > maximumCalibrationEvidenceContributors) {
    throw invalidInput(
      `${label} must contain 1 through ${maximumCalibrationEvidenceContributors} contributors`,
    )
  }
  const contributors: ScientificCalibrationEvidence[] = []
  for (let index = 0; index < value.length; index += 1) {
    if (!(index in value)) throw invalidInput(`${label} must not contain holes`)
    contributors.push(normalizeCalibrationEvidence(value[index], `${label}[${index}]`))
  }
  return Object.freeze(contributors)
}

const normalizeAxis = (
  value: unknown,
  index: number,
  mode: ParseMode,
): ScientificAxisDescriptor => {
  const label = `Scientific dataset axis ${index}`
  const input = recordValue(value, label)
  onlyKeys(
    input,
    ['id', 'name', 'kind', 'length', 'unit', 'coordinates', 'calibration', 'entries'],
    label,
  )
  const id = requiredString(input.id, `${label}.id`)
  const name = optionalString(input.name, `${label}.name`)
  const kind = enumValue(input.kind, axisKinds, `${label}.kind`)
  const length = positiveInteger(input.length, `${label}.length`)
  const unit = optionalString(input.unit, `${label}.unit`)
  const coordinates = normalizeCoordinates(input.coordinates, length, mode, `${label}.coordinates`)
  const calibration =
    input.calibration === undefined
      ? undefined
      : normalizeCalibrationEvidenceSet(input.calibration, `${label}.calibration`)
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
    ...(calibration === undefined ? {} : { calibration }),
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
  mode: ParseMode,
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
    onlyKeys(levelInput, ['level', 'axisLengths', 'axisCoordinates'], label)
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
    let axisCoordinates: readonly ScientificResolutionAxisCoordinates[] | undefined
    if (levelInput.axisCoordinates !== undefined) {
      const coordinateInputs = arrayValue(levelInput.axisCoordinates, `${label}.axisCoordinates`)
      const coordinatesByAxis = new Map<string, ScientificAxisCoordinates>()
      for (
        let coordinateIndex = 0;
        coordinateIndex < coordinateInputs.length;
        coordinateIndex += 1
      ) {
        const coordinateLabel = `${label}.axisCoordinates[${coordinateIndex}]`
        const coordinateInput = recordValue(coordinateInputs[coordinateIndex], coordinateLabel)
        onlyKeys(coordinateInput, ['axisId', 'coordinates'], coordinateLabel)
        const axisId = requiredString(coordinateInput.axisId, `${coordinateLabel}.axisId`)
        if (!axisById.has(axisId))
          throw invalidInput(`${coordinateLabel} names unknown axis ${axisId}`)
        if (coordinatesByAxis.has(axisId))
          throw invalidInput(`${label} repeats coordinates for axis ${axisId}`)
        const length = lengths.get(axisId)
        if (length === undefined) throw invalidInput(`${label} is missing axis ${axisId}`)
        coordinatesByAxis.set(
          axisId,
          normalizeCoordinates(
            coordinateInput.coordinates,
            length,
            mode,
            `${coordinateLabel}.coordinates`,
          ),
        )
      }
      axisCoordinates = Object.freeze(
        axes.flatMap((axis) => {
          const coordinates = coordinatesByAxis.get(axis.id)
          return coordinates === undefined ? [] : [Object.freeze({ axisId: axis.id, coordinates })]
        }),
      )
    }
    for (const axis of axes) {
      const length = lengths.get(axis.id)
      if (length === undefined) throw invalidInput(`${label} is missing axis ${axis.id}`)
      const override = axisCoordinates?.find((entry) => entry.axisId === axis.id)
      if (
        override === undefined &&
        axis.coordinates.type !== 'index' &&
        axis.coordinates.type !== 'linear' &&
        axis.length !== length
      ) {
        throw invalidInput(`${label} must override coordinates for resized axis ${axis.id}`)
      }
    }
    levels.push(
      Object.freeze({
        level,
        axisLengths,
        ...(axisCoordinates === undefined ? {} : { axisCoordinates }),
      }),
    )
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
  if (input.schemaVersion !== 1) throw invalidInput('Scientific dataset schemaVersion must be 1')

  const axisInputs = arrayValue(input.axes, 'Scientific dataset axes')
  if (axisInputs.length < 1) throw invalidInput('Scientific dataset must contain at least one axis')
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

  const levels = normalizeLevels(input.levels, axes, mode)
  const capabilitiesInput = recordValue(input.capabilities, 'Scientific dataset capabilities')
  onlyKeys(
    capabilitiesInput,
    ['regionReads', 'resolutionLevels', 'planeReads', 'seriesReads'],
    'Scientific dataset capabilities',
  )
  const planeReadsInput = recordValue(
    capabilitiesInput.planeReads,
    'Scientific dataset capabilities.planeReads',
  )
  const planeReadKind = enumValue(
    planeReadsInput.kind,
    ['none', 'any-axis-pair', 'ordered-axis-pairs'] as const,
    'Scientific dataset capabilities.planeReads.kind',
  )
  let planeReads: ScientificPlaneReadCapability
  if (planeReadKind === 'none' || planeReadKind === 'any-axis-pair') {
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
  let seriesReads: ScientificSeriesReadCapability | undefined
  if (capabilitiesInput.seriesReads !== undefined) {
    const seriesReadsInput = recordValue(
      capabilitiesInput.seriesReads,
      'Scientific dataset capabilities.seriesReads',
    )
    const seriesReadKind = enumValue(
      seriesReadsInput.kind,
      ['any-axis', 'axes'] as const,
      'Scientific dataset capabilities.seriesReads.kind',
    )
    if (seriesReadKind === 'any-axis') {
      onlyKeys(seriesReadsInput, ['kind'], 'Scientific dataset capabilities.seriesReads')
      seriesReads = Object.freeze({ kind: seriesReadKind })
    } else {
      onlyKeys(seriesReadsInput, ['kind', 'axes'], 'Scientific dataset capabilities.seriesReads')
      const seriesAxisInputs = arrayValue(
        seriesReadsInput.axes,
        'Scientific dataset capabilities.seriesReads.axes',
      )
      if (seriesAxisInputs.length === 0) {
        throw invalidInput('Scientific dataset seriesReads.axes must not be empty')
      }
      const seenSeriesAxes = new Set<string>()
      const seriesAxes: string[] = []
      for (let index = 0; index < seriesAxisInputs.length; index += 1) {
        const axisId = requiredString(
          seriesAxisInputs[index],
          `Scientific dataset capabilities.seriesReads.axes[${index}]`,
        )
        if (!axisIds.has(axisId)) {
          throw invalidInput(`Scientific dataset seriesReads names unknown axis ${axisId}`)
        }
        if (seenSeriesAxes.has(axisId)) {
          throw invalidInput(`Scientific dataset seriesReads repeats axis ${axisId}`)
        }
        seenSeriesAxes.add(axisId)
        seriesAxes.push(axisId)
      }
      seriesReads = Object.freeze({ kind: seriesReadKind, axes: Object.freeze(seriesAxes) })
    }
  }
  if (planeReads.kind === 'any-axis-pair' && axes.length < 2) {
    throw invalidInput('Scientific dataset any-axis-pair capability requires at least two axes')
  }
  if (planeReads.kind === 'none' && seriesReads === undefined) {
    throw invalidInput('Scientific dataset must support plane reads or series reads')
  }
  if (axes.length === 1) {
    const onlyAxis = axes[0]
    if (planeReads.kind !== 'none') {
      throw invalidInput('One-dimensional scientific datasets cannot advertise plane reads')
    }
    if (
      onlyAxis === undefined ||
      seriesReads === undefined ||
      (seriesReads.kind === 'axes' && !seriesReads.axes.includes(onlyAxis.id))
    ) {
      throw invalidInput('One-dimensional scientific datasets must support their sole series axis')
    }
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
    ...(seriesReads === undefined ? {} : { seriesReads }),
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
    schemaVersion: 1,
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

/** Report whether the descriptor can read the requested ordered display-axis pair. */
export const supportsScientificPlaneRead = (
  descriptor: NormalizedScientificDatasetDescriptor,
  displayAxes: readonly [string, string],
): boolean => {
  const horizontal = displayAxes[0]
  const vertical = displayAxes[1]
  if (horizontal === vertical) return false
  let horizontalKnown = false
  let verticalKnown = false
  for (const axis of descriptor.axes) {
    if (axis.id === horizontal) horizontalKnown = true
    if (axis.id === vertical) verticalKnown = true
  }
  if (!horizontalKnown || !verticalKnown) return false
  const planeReads = descriptor.capabilities.planeReads
  if (planeReads.kind === 'any-axis-pair') return true
  if (planeReads.kind === 'none') return false
  for (const pair of planeReads.pairs) {
    if (pair[0] === horizontal && pair[1] === vertical) return true
  }
  return false
}

/** Report whether the descriptor can read a bounded series along one selected axis. */
export const supportsScientificSeriesRead = (
  descriptor: NormalizedScientificDatasetDescriptor,
  axisId: string,
): boolean => {
  if (!descriptor.axes.some((axis) => axis.id === axisId)) return false
  const seriesReads = descriptor.capabilities.seriesReads
  if (seriesReads === undefined) return false
  if (seriesReads.kind === 'any-axis') return true
  return seriesReads.axes.includes(axisId)
}

const getResolutionLevel = (
  descriptor: NormalizedScientificDatasetDescriptor,
  level: number,
): ScientificResolutionLevel => {
  const selected = descriptor.levels.find((candidate) => candidate.level === level)
  if (!selected) throw invalidInput(`Scientific dataset resolution level ${level} is unavailable`)
  return selected
}

/** Resolve one complete axis, including its length and coordinates, at a declared level. */
export const resolveScientificAxisAtResolutionLevel = (
  descriptor: NormalizedScientificDatasetDescriptor,
  axisId: string,
  level: number,
): ScientificAxisDescriptor => {
  const base = descriptor.axes.find((axis) => axis.id === axisId)
  if (base === undefined) throw invalidInput(`Unknown scientific axis ${axisId}`)
  const selected = getResolutionLevel(descriptor, level)
  const length = selected.axisLengths.find((axis) => axis.axisId === axisId)?.length
  if (length === undefined)
    throw invalidInput(`Scientific resolution level ${level} omits axis ${axisId}`)
  const coordinates =
    selected.axisCoordinates?.find((axis) => axis.axisId === axisId)?.coordinates ??
    base.coordinates
  if (
    coordinates.type !== 'index' &&
    coordinates.type !== 'linear' &&
    coordinates.values.length !== length
  ) {
    throw invalidInput(
      `Scientific resolution level ${level} coordinates do not match axis ${axisId}`,
    )
  }
  const { entries, ...baseWithoutEntries } = base
  return Object.freeze({
    ...baseWithoutEntries,
    length,
    coordinates,
    ...(entries === undefined || entries.length !== length ? {} : { entries }),
  })
}

/** Resolve a selected pyramid level into an ordinary single-level descriptor. */
export const resolveScientificDescriptorAtResolutionLevel = (
  descriptor: NormalizedScientificDatasetDescriptor,
  level: number,
): NormalizedScientificDatasetDescriptor => {
  getResolutionLevel(descriptor, level)
  const axes = descriptor.axes.map((axis) =>
    resolveScientificAxisAtResolutionLevel(descriptor, axis.id, level),
  )
  return normalizeScientificDatasetDescriptor({
    ...descriptor,
    axes,
    levels: [
      {
        level: 0,
        axisLengths: axes.map((axis) => ({ axisId: axis.id, length: axis.length })),
      },
    ],
    capabilities: { ...descriptor.capabilities, resolutionLevels: false },
  })
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
  const displayAxes: readonly [horizontal: string, vertical: string] = Object.freeze([
    horizontal,
    vertical,
  ])
  const axisById = new Map(descriptor.axes.map((axis) => [axis.id, axis]))
  if (!axisById.has(horizontal)) throw invalidInput(`Unknown scientific display axis ${horizontal}`)
  if (!axisById.has(vertical)) throw invalidInput(`Unknown scientific display axis ${vertical}`)
  if (!supportsScientificPlaneRead(descriptor, displayAxes)) {
    throw invalidInput(`Scientific dataset does not support display axes ${horizontal}/${vertical}`)
  }

  const resolutionLevel = nonNegativeInteger(
    input.resolutionLevel ?? 0,
    'Scientific resolutionLevel',
  )
  const levelDescriptor = getResolutionLevel(descriptor, resolutionLevel)
  const lengths = new Map(levelDescriptor.axisLengths.map((axis) => [axis.axisId, axis.length]))
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

/** Resolve fixed selections, level dimensions, and one bounded series range before I/O. */
const normalizeSeriesReadRequest = (
  descriptor: NormalizedScientificDatasetDescriptor,
  request: unknown,
  requireCapability: boolean,
): NormalizedScientificSeriesReadRequest => {
  const input = recordValue(request, 'Scientific series request')
  onlyKeys(
    input,
    ['axisId', 'fixedIndices', 'resolutionLevel', 'start', 'length', 'signal'],
    'Scientific series request',
  )
  const axisId = requiredString(input.axisId, 'Scientific series request.axisId')
  const axisById = new Map(descriptor.axes.map((axis) => [axis.id, axis]))
  if (!axisById.has(axisId)) throw invalidInput(`Unknown scientific series axis ${axisId}`)
  if (requireCapability && !supportsScientificSeriesRead(descriptor, axisId)) {
    throw invalidInput(`Scientific dataset does not support series axis ${axisId}`)
  }

  const resolutionLevel = nonNegativeInteger(
    input.resolutionLevel ?? 0,
    'Scientific series resolutionLevel',
  )
  const levelDescriptor = getResolutionLevel(descriptor, resolutionLevel)
  const lengths = new Map(levelDescriptor.axisLengths.map((axis) => [axis.axisId, axis.length]))
  const selections = new Map<string, number>()
  const fixedInputs = arrayValue(input.fixedIndices, 'Scientific series request.fixedIndices')
  for (let index = 0; index < fixedInputs.length; index += 1) {
    const label = `Scientific series request.fixedIndices[${index}]`
    const selection = recordValue(fixedInputs[index], label)
    onlyKeys(selection, ['axisId', 'index'], label)
    const fixedAxisId = requiredString(selection.axisId, `${label}.axisId`)
    if (!axisById.has(fixedAxisId)) {
      throw invalidInput(`Scientific fixed index names unknown axis ${fixedAxisId}`)
    }
    if (fixedAxisId === axisId) {
      throw invalidInput(`Scientific series axis ${fixedAxisId} must not also be fixed`)
    }
    if (selections.has(fixedAxisId)) {
      throw invalidInput(`Scientific fixed index repeats axis ${fixedAxisId}`)
    }
    const fixedAxisLength = lengths.get(fixedAxisId)
    if (fixedAxisLength === undefined) {
      throw invalidInput(`Resolution level is missing axis ${fixedAxisId}`)
    }
    const selectedIndex = nonNegativeInteger(
      selection.index,
      `Scientific fixed index for ${fixedAxisId}`,
    )
    if (selectedIndex >= fixedAxisLength) {
      throw invalidInput(`Scientific fixed index for ${fixedAxisId} is outside the selected level`)
    }
    selections.set(fixedAxisId, selectedIndex)
  }

  const fixedIndices: ScientificAxisIndex[] = []
  for (const axis of descriptor.axes) {
    if (axis.id === axisId) continue
    const fixedAxisLength = lengths.get(axis.id)
    if (fixedAxisLength === undefined) {
      throw invalidInput(`Resolution level is missing axis ${axis.id}`)
    }
    const index = selections.get(axis.id)
    if (index === undefined && fixedAxisLength !== 1) {
      throw invalidInput(`Scientific series request must fix non-singleton axis ${axis.id}`)
    }
    fixedIndices.push(Object.freeze({ axisId: axis.id, index: index ?? 0 }))
  }

  const axisLength = lengths.get(axisId)
  if (axisLength === undefined) throw invalidInput(`Resolution level is missing axis ${axisId}`)
  const start = nonNegativeInteger(input.start ?? 0, 'Scientific series start')
  const length = positiveInteger(input.length ?? axisLength - start, 'Scientific series length')
  if (start > axisLength || length > axisLength - start) {
    throw invalidInput('Scientific series range is outside the selected resolution level')
  }
  if (!descriptor.capabilities.regionReads && (start !== 0 || length !== axisLength)) {
    throw invalidInput('Scientific dataset does not support region reads')
  }
  if (input.signal !== undefined && !(input.signal instanceof AbortSignal)) {
    throw invalidInput('Scientific series request.signal must be an AbortSignal')
  }

  return Object.freeze({
    axisId,
    fixedIndices: Object.freeze(fixedIndices),
    resolutionLevel,
    start,
    length,
    ...(input.signal === undefined ? {} : { signal: input.signal }),
  })
}

export const normalizeScientificSeriesReadRequest = (
  descriptor: NormalizedScientificDatasetDescriptor,
  request: unknown,
): NormalizedScientificSeriesReadRequest => normalizeSeriesReadRequest(descriptor, request, true)

const compactPlaneBlockToSeries = (
  block: RasterBlock,
  horizontal: boolean,
): ScientificSeriesBlock => {
  if (
    !Number.isSafeInteger(block.x) ||
    block.x < 0 ||
    !Number.isSafeInteger(block.y) ||
    block.y < 0 ||
    !Number.isSafeInteger(block.width) ||
    !Number.isSafeInteger(block.height)
  ) {
    throw invalidInput('Scientific plane-series adapter received invalid block dimensions')
  }
  const length = horizontal ? block.width : block.height
  const crossLength = horizontal ? block.height : block.width
  if (length < 1 || crossLength !== 1) {
    throw invalidInput('Scientific plane-series adapter requires one-pixel-wide source blocks')
  }
  const bytesPerSample = rasterSampleBytes(block.format.sampleType)
  const channels = block.format.channels
  if (!Number.isSafeInteger(channels) || channels < 1) {
    throw invalidInput('Scientific plane-series adapter received an invalid channel count')
  }
  const rowBytes = block.width * bytesPerSample * (block.format.planar ? 1 : channels)
  if (
    !Number.isSafeInteger(rowBytes) ||
    !Number.isSafeInteger(block.stride) ||
    block.stride < rowBytes
  ) {
    throw invalidInput('Scientific plane-series adapter received an invalid row stride')
  }
  const occupiedPlaneBytes = block.stride * (block.height - 1) + rowBytes
  const planeStride = block.format.planar ? block.planeStride : occupiedPlaneBytes
  if (
    !Number.isSafeInteger(occupiedPlaneBytes) ||
    planeStride === undefined ||
    !Number.isSafeInteger(planeStride) ||
    planeStride < occupiedPlaneBytes
  ) {
    throw invalidInput('Scientific plane-series adapter received an invalid plane stride')
  }
  const requiredBytes = block.format.planar
    ? planeStride * (channels - 1) + occupiedPlaneBytes
    : occupiedPlaneBytes
  if (!Number.isSafeInteger(requiredBytes) || block.data.byteLength < requiredBytes) {
    throw invalidInput('Scientific plane-series adapter received truncated sample data')
  }
  const outputBytes = length * channels * bytesPerSample
  if (!Number.isSafeInteger(outputBytes)) {
    throw invalidInput('Scientific plane-series adapter output is too large')
  }
  const data = new Uint8Array(outputBytes)
  for (let point = 0; point < length; point += 1) {
    const x = horizontal ? point : 0
    const y = horizontal ? 0 : point
    for (let channel = 0; channel < channels; channel += 1) {
      const sourceOffset = block.format.planar
        ? channel * planeStride + y * block.stride + x * bytesPerSample
        : y * block.stride + (x * channels + channel) * bytesPerSample
      const outputOffset = block.format.planar
        ? channel * length * bytesPerSample + point * bytesPerSample
        : (point * channels + channel) * bytesPerSample
      data.set(block.data.subarray(sourceOffset, sourceOffset + bytesPerSample), outputOffset)
    }
  }
  return Object.freeze({
    start: horizontal ? block.x : block.y,
    length,
    format: Object.freeze({ ...block.format }),
    data,
  })
}

/**
 * Bounded fallback that extracts one row or column from an existing native plane reader.
 * The adapter compacts each emitted source block independently and never materializes the series.
 */
export const readScientificSeriesFromPlane = async function* (
  dataset: ScientificDataset,
  displayAxes: readonly [horizontal: string, vertical: string],
  request: Readonly<ScientificSeriesReadRequest>,
): AsyncGenerator<ScientificSeriesBlock> {
  const normalized = normalizeSeriesReadRequest(dataset.descriptor, request, false)
  if (!supportsScientificPlaneRead(dataset.descriptor, displayAxes)) {
    throw invalidInput(
      `Scientific dataset does not support plane axes ${displayAxes[0]}/${displayAxes[1]}`,
    )
  }
  const horizontal = displayAxes[0] === normalized.axisId
  const vertical = displayAxes[1] === normalized.axisId
  if (horizontal === vertical) {
    throw invalidInput(
      `Scientific plane-series adapter display axes must contain series axis ${normalized.axisId} exactly once`,
    )
  }
  const crossAxisId = horizontal ? displayAxes[1] : displayAxes[0]
  const crossIndex = normalized.fixedIndices.find((entry) => entry.axisId === crossAxisId)
  if (crossIndex === undefined) {
    throw invalidInput(`Scientific series request must fix plane cross-axis ${crossAxisId}`)
  }
  const fixedIndices = normalized.fixedIndices.filter((entry) => entry.axisId !== crossAxisId)
  const planeRequest: ScientificPlaneReadRequest = {
    displayAxes,
    fixedIndices,
    resolutionLevel: normalized.resolutionLevel,
    x: horizontal ? normalized.start : crossIndex.index,
    y: horizontal ? crossIndex.index : normalized.start,
    width: horizontal ? normalized.length : 1,
    height: horizontal ? 1 : normalized.length,
    ...(normalized.signal === undefined ? {} : { signal: normalized.signal }),
  }
  let nextStart = normalized.start
  for await (const block of dataset.readPlane(planeRequest)) {
    try {
      normalized.signal?.throwIfAborted()
      const blockStart = horizontal ? block.x : block.y
      const blockLength = horizontal ? block.width : block.height
      const blockCrossIndex = horizontal ? block.y : block.x
      if (
        blockStart !== nextStart ||
        blockCrossIndex !== crossIndex.index ||
        blockLength > normalized.start + normalized.length - nextStart ||
        block.format.sampleType !== dataset.descriptor.sampleType ||
        block.format.channels !== dataset.descriptor.components.length
      ) {
        throw invalidInput('Scientific plane-series adapter received incompatible source blocks')
      }
      yield compactPlaneBlockToSeries(block, horizontal)
      nextStart += blockLength
    } finally {
      block.release?.()
    }
  }
  if (nextStart !== normalized.start + normalized.length) {
    throw invalidInput('Scientific plane-series adapter received incomplete source blocks')
  }
}
