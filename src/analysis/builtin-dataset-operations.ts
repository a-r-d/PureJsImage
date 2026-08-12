import { throwIfAborted } from '../abort.ts'
import { invalidInput } from '../errors.ts'
import type {
  OperationDescriptor,
  OperationJsonObject,
  OperationJsonValue,
  OperationValidationLimits,
  OperationValidationResult,
  ParameterSchema,
} from '../operations/descriptor.ts'
import { normalizeOperationJsonObject } from '../operations/descriptor.ts'
import type {
  OperationCostEstimate,
  OperationImplementation,
  OperationOwnedOutput,
  OperationProviderRequest,
} from '../operations/provider.ts'
import type { OperationDefinition } from '../operations/registry.ts'
import { createOperationDefinition } from '../operations/registry.ts'
import { rasterSampleBytes, type RasterBlock, type RasterSampleType } from '../raster.ts'
import type {
  NormalizedScientificDatasetDescriptor,
  NormalizedScientificPlaneReadRequest,
  ScientificAxisCoordinates,
  ScientificAxisDescriptor,
  ScientificAxisIndex,
  ScientificDataset,
  ScientificPlaneReadRequest,
} from '../scientific/dataset-v2.ts'
import {
  normalizeScientificDatasetDescriptor,
  normalizeScientificPlaneReadRequest,
} from '../scientific/dataset-v2.ts'
import type {
  DirectNumericTileDataset,
  NumericArray,
  NumericSampleType,
  NumericTile,
  NumericTileReadRequest,
  NumericTileSource,
} from '../scientific/numeric-tile.ts'
import {
  numericTileSampleOffset,
  resolveNumericTileSource,
  validateNumericTile,
} from '../scientific/numeric-tile.ts'
import { writeRasterSample } from '../scientific/samples.ts'
import type { TileAddress, TileDatasetIdentity, TileRequest, TileSource } from './tile-runtime.ts'
import type { TileRuntime } from './tile-runtime.ts'
import { numericTileSourceToTileSource } from './tile-source.ts'

export const scientificDatasetValueTypeId = 'purejsimage.scientific.dataset'

export const analysisCropOperationId = 'purejsimage.analysis.crop'
export const analysisResampleOperationId = 'purejsimage.analysis.resample'
export const analysisSliceOperationId = 'purejsimage.analysis.slice'
export const analysisProjectionOperationId = 'purejsimage.analysis.projection'
export const analysisThresholdOperationId = 'purejsimage.analysis.threshold'
export const analysisGaussianBlurOperationId = 'purejsimage.analysis.gaussian-blur'

type ParameterRecord = Readonly<Record<string, OperationJsonValue>>

const isJsonObject = (value: OperationJsonValue): value is OperationJsonObject =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

const parameterRecord = (value: OperationJsonValue): ParameterRecord => {
  if (!isJsonObject(value)) {
    throw invalidInput('Analysis operation parameters must be an object')
  }
  return value
}

const stringParameter = (value: ParameterRecord, name: string): string => {
  const entry = value[name]
  if (typeof entry !== 'string') throw invalidInput(`${name} must be a string`)
  return entry
}

const numberParameter = (value: ParameterRecord, name: string): number => {
  const entry = value[name]
  if (typeof entry !== 'number' || !Number.isFinite(entry)) {
    throw invalidInput(`${name} must be finite`)
  }
  return entry
}

const optionalNumberParameter = (value: ParameterRecord, name: string): number | undefined => {
  const entry = value[name]
  if (entry === undefined) return undefined
  if (typeof entry !== 'number' || !Number.isFinite(entry)) {
    throw invalidInput(`${name} must be finite`)
  }
  return entry
}

const stringArrayParameter = (
  value: ParameterRecord,
  name: string,
  expectedLength?: number,
): readonly string[] => {
  const entry = value[name]
  if (
    !Array.isArray(entry) ||
    (expectedLength !== undefined && entry.length !== expectedLength) ||
    entry.some((item) => typeof item !== 'string')
  ) {
    throw invalidInput(`${name} must be an array of strings`)
  }
  const result: string[] = []
  for (const item of entry) {
    if (typeof item !== 'string' || item.trim().length === 0) {
      throw invalidInput(`${name} contains an invalid axis id`)
    }
    result.push(item)
  }
  return Object.freeze(result)
}

const fixedIndicesParameter = (value: ParameterRecord): readonly ScientificAxisIndex[] => {
  const entry = value.fixedIndices
  if (!Array.isArray(entry)) throw invalidInput('fixedIndices must be an array')
  const result: ScientificAxisIndex[] = []
  const seen = new Set<string>()
  for (const item of entry) {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) {
      throw invalidInput('fixedIndices entries must be objects')
    }
    const axisId = 'axisId' in item ? item.axisId : undefined
    const index = 'index' in item ? item.index : undefined
    if (
      typeof axisId !== 'string' ||
      axisId.trim().length === 0 ||
      typeof index !== 'number' ||
      !Number.isSafeInteger(index) ||
      index < 0 ||
      seen.has(axisId)
    ) {
      throw invalidInput('fixedIndices contains an invalid or duplicate entry')
    }
    seen.add(axisId)
    result.push(Object.freeze({ axisId, index }))
  }
  result.sort((left, right) => left.axisId.localeCompare(right.axisId))
  return Object.freeze(result)
}

const displayAxesParameter = (
  value: ParameterRecord,
): readonly [horizontal: string, vertical: string] => {
  const axes = stringArrayParameter(value, 'displayAxes', 2)
  const horizontal = axes[0]
  const vertical = axes[1]
  if (horizontal === undefined || vertical === undefined || horizontal === vertical) {
    throw invalidInput('displayAxes must contain two distinct axis ids')
  }
  return Object.freeze([horizontal, vertical])
}

const objectSchema = (
  properties: Readonly<Record<string, ParameterSchema>>,
  required: readonly string[],
): ParameterSchema =>
  Object.freeze({
    type: 'object',
    properties: Object.freeze({ ...properties }),
    required: Object.freeze([...required]),
    closed: true,
  })

const axisIdSchema = Object.freeze({
  type: 'string',
  minLength: 1,
  maxLength: 4_096,
}) satisfies ParameterSchema
const positiveIntegerSchema = Object.freeze({
  type: 'integer',
  minimum: 1,
}) satisfies ParameterSchema
const nonNegativeIntegerSchema = Object.freeze({
  type: 'integer',
  minimum: 0,
}) satisfies ParameterSchema
const displayAxesSchema = Object.freeze({
  type: 'array',
  items: axisIdSchema,
  minItems: 2,
  maxItems: 2,
}) satisfies ParameterSchema
const fixedIndicesSchema = Object.freeze({
  type: 'array',
  items: Object.freeze({
    type: 'object',
    properties: Object.freeze({ axisId: axisIdSchema, index: nonNegativeIntegerSchema }),
    required: Object.freeze(['axisId', 'index']),
    closed: true,
  }),
  maxItems: 64,
}) satisfies ParameterSchema

const datasetInputPort = Object.freeze({
  name: 'dataset',
  valueType: Object.freeze({ id: scientificDatasetValueTypeId, version: 1 }),
})
const datasetOutputPort = Object.freeze({
  name: 'dataset',
  valueType: Object.freeze({ id: scientificDatasetValueTypeId, version: 1 }),
})

const semanticDefinition = (
  options: Readonly<{
    id: string
    title: string
    execution: 'dataset-transform' | 'tile-local' | 'neighborhood' | 'reduction'
    reproducibility?: OperationDescriptor['reproducibility']
    parameters: ParameterSchema
    validate(parameters: OperationJsonValue): void
    infer(
      parameters: OperationJsonValue,
      input: NormalizedScientificDatasetDescriptor,
    ): NormalizedScientificDatasetDescriptor
  }>,
): OperationDefinition => {
  const base = createOperationDefinition({
    descriptor: {
      id: options.id,
      version: 1,
      title: options.title,
      category: 'scientific-analysis',
      tags: ['scientific', 'dataset'],
      inputs: [datasetInputPort],
      outputs: [datasetOutputPort],
      parameters: options.parameters,
      execution: options.execution,
      reproducibility: options.reproducibility ?? { class: 'bit-exact' },
      builtIn: true,
    },
    inferOutputShapes(request) {
      try {
        const input = datasetDescriptorFromCharacteristics(request.inputs[0])
        return Object.freeze({
          valid: true,
          issues: Object.freeze([]),
          value: Object.freeze([
            scientificDatasetCharacteristics(options.infer(request.parameters, input)),
          ]),
        })
      } catch (error) {
        return invalidOperationResult(error)
      }
    },
  })
  return Object.freeze({
    ...base,
    normalizeParameters(
      input: unknown,
      limits: Readonly<OperationValidationLimits> = {},
    ): OperationValidationResult<OperationJsonValue> {
      const result = base.normalizeParameters(input, limits)
      if (result.value === undefined) return result
      try {
        options.validate(result.value)
        return result
      } catch (error) {
        return invalidOperationResult(error)
      }
    },
  })
}

const invalidOperationResult = (error: unknown): OperationValidationResult<never> =>
  Object.freeze({
    valid: false,
    issues: Object.freeze([
      Object.freeze({
        code: 'invalid-value' as const,
        path: '',
        message: error instanceof Error ? error.message : 'Analysis operation is invalid',
      }),
    ]),
  })

const isScientificDataset = (value: unknown): value is ScientificDataset =>
  value !== null &&
  typeof value === 'object' &&
  'descriptor' in value &&
  value.descriptor !== null &&
  typeof value.descriptor === 'object' &&
  'readPlane' in value &&
  typeof value.readPlane === 'function'

const datasetInput = (request: Readonly<OperationProviderRequest>): ScientificDataset => {
  const value = request.inputs.find(isScientificDataset)
  if (value === undefined) throw invalidInput('Analysis operation requires a ScientificDataset')
  return value
}

export const scientificDatasetCharacteristics = (
  descriptorOrDataset: NormalizedScientificDatasetDescriptor | ScientificDataset,
): OperationJsonObject => {
  const descriptor = isScientificDataset(descriptorOrDataset)
    ? descriptorOrDataset.descriptor
    : descriptorOrDataset
  return normalizeOperationJsonObject({ kind: 'scientific-dataset', descriptor })
}

const datasetDescriptorFromCharacteristics = (
  value: OperationJsonValue | undefined,
): NormalizedScientificDatasetDescriptor => {
  if (value === undefined || !isJsonObject(value)) {
    throw invalidInput('Dataset characteristics are unavailable')
  }
  const kind = value.kind
  const descriptor = value.descriptor
  if (kind !== 'scientific-dataset' || descriptor === undefined) {
    throw invalidInput('Dataset characteristics must contain a scientific descriptor')
  }
  return normalizeScientificDatasetDescriptor(descriptor)
}

const axis = (
  descriptor: NormalizedScientificDatasetDescriptor,
  id: string,
): ScientificAxisDescriptor => {
  const result = descriptor.axes.find((entry) => entry.id === id)
  if (result === undefined) throw invalidInput(`Unknown scientific axis ${id}`)
  return result
}

const assertLevelZero = (descriptor: NormalizedScientificDatasetDescriptor): void => {
  if (descriptor.levels.length !== 1 || descriptor.levels[0]?.level !== 0) {
    throw invalidInput('Initial built-in analysis transforms require a level-zero dataset')
  }
}

const validateSelection = (
  descriptor: NormalizedScientificDatasetDescriptor,
  displayAxes: readonly [string, string],
  fixedIndices: readonly ScientificAxisIndex[],
  reductionAxis?: string,
): void => {
  axis(descriptor, displayAxes[0])
  axis(descriptor, displayAxes[1])
  const selected = new Set(displayAxes)
  if (reductionAxis !== undefined) {
    axis(descriptor, reductionAxis)
    if (selected.has(reductionAxis))
      throw invalidInput('Reduction axis must differ from display axes')
    selected.add(reductionAxis)
  }
  for (const entry of fixedIndices) {
    const selectedAxis = axis(descriptor, entry.axisId)
    if (selected.has(entry.axisId) || entry.index >= selectedAxis.length) {
      throw invalidInput(`Invalid fixed index for axis ${entry.axisId}`)
    }
    selected.add(entry.axisId)
  }
  if (selected.size !== descriptor.axes.length) {
    throw invalidInput('Every non-display axis must have exactly one fixed index')
  }
}

const coordinateSubset = (
  coordinates: ScientificAxisCoordinates,
  start: number,
  length: number,
): ScientificAxisCoordinates => {
  if (coordinates.type === 'index') return coordinates
  if (coordinates.type === 'linear') {
    return Object.freeze({
      type: 'linear',
      origin: coordinates.origin + start * coordinates.step,
      step: coordinates.step,
    })
  }
  if (coordinates.type === 'labels') {
    return Object.freeze({
      type: 'labels',
      values: Object.freeze(coordinates.values.slice(start, start + length)),
    })
  }
  return Object.freeze({
    type: 'lookup',
    values: Object.freeze(coordinates.values.slice(start, start + length)),
  })
}

const croppedAxis = (
  source: ScientificAxisDescriptor,
  start: number,
  length: number,
): ScientificAxisDescriptor =>
  Object.freeze({
    ...source,
    length,
    coordinates: coordinateSubset(source.coordinates, start, length),
    ...(source.entries === undefined
      ? {}
      : { entries: Object.freeze(source.entries.slice(start, start + length)) }),
  })

interface CropParameters {
  readonly displayAxes: readonly [string, string]
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

const cropParameters = (value: OperationJsonValue): CropParameters => {
  const parameters = parameterRecord(value)
  return Object.freeze({
    displayAxes: displayAxesParameter(parameters),
    x: numberParameter(parameters, 'x'),
    y: numberParameter(parameters, 'y'),
    width: numberParameter(parameters, 'width'),
    height: numberParameter(parameters, 'height'),
  })
}

const inferCropDescriptor = (
  source: NormalizedScientificDatasetDescriptor,
  parameters: CropParameters,
): NormalizedScientificDatasetDescriptor => {
  assertLevelZero(source)
  const horizontal = axis(source, parameters.displayAxes[0])
  const vertical = axis(source, parameters.displayAxes[1])
  if (
    !Number.isSafeInteger(parameters.x) ||
    !Number.isSafeInteger(parameters.y) ||
    !Number.isSafeInteger(parameters.width) ||
    !Number.isSafeInteger(parameters.height) ||
    parameters.x < 0 ||
    parameters.y < 0 ||
    parameters.width < 1 ||
    parameters.height < 1 ||
    parameters.x + parameters.width > horizontal.length ||
    parameters.y + parameters.height > vertical.length
  ) {
    throw invalidInput('Crop region is outside the selected axes')
  }
  return normalizeScientificDatasetDescriptor({
    ...source,
    axes: source.axes.map((entry) => {
      if (entry.id === horizontal.id) return croppedAxis(entry, parameters.x, parameters.width)
      if (entry.id === vertical.id) return croppedAxis(entry, parameters.y, parameters.height)
      return entry
    }),
    levels: [
      {
        level: 0,
        axisLengths: source.axes.map((entry) => ({
          axisId: entry.id,
          length:
            entry.id === horizontal.id
              ? parameters.width
              : entry.id === vertical.id
                ? parameters.height
                : entry.length,
        })),
      },
    ],
    metadata: {
      ...(source.metadata ?? {}),
      analysisOperation: analysisCropOperationId,
      cropAxes: parameters.displayAxes,
      cropRegion: [parameters.x, parameters.y, parameters.width, parameters.height],
    },
  })
}

interface SliceParameters {
  readonly displayAxes: readonly [string, string]
  readonly fixedIndices: readonly ScientificAxisIndex[]
}

const sliceParameters = (value: OperationJsonValue): SliceParameters => {
  const parameters = parameterRecord(value)
  return Object.freeze({
    displayAxes: displayAxesParameter(parameters),
    fixedIndices: fixedIndicesParameter(parameters),
  })
}

const twoDimensionalDescriptor = (
  source: NormalizedScientificDatasetDescriptor,
  displayAxes: readonly [string, string],
  sampleType: RasterSampleType,
  operation: string,
): NormalizedScientificDatasetDescriptor => {
  assertLevelZero(source)
  const axes = displayAxes.map((id) => axis(source, id))
  return normalizeScientificDatasetDescriptor({
    schemaVersion: 2,
    axes,
    sampleType,
    components: source.components,
    levels: [
      { level: 0, axisLengths: axes.map((entry) => ({ axisId: entry.id, length: entry.length })) },
    ],
    ...(source.noDataValue === undefined ? {} : { noDataValue: source.noDataValue }),
    metadata: { ...(source.metadata ?? {}), analysisOperation: operation },
    capabilities: { regionReads: true, resolutionLevels: false },
  })
}

const inferSliceDescriptor = (
  source: NormalizedScientificDatasetDescriptor,
  parameters: SliceParameters,
): NormalizedScientificDatasetDescriptor => {
  validateSelection(source, parameters.displayAxes, parameters.fixedIndices)
  return twoDimensionalDescriptor(
    source,
    parameters.displayAxes,
    source.sampleType,
    analysisSliceOperationId,
  )
}

type ResampleKernel = 'nearest' | 'bilinear'
type ResampleOutputType = 'preserve' | 'float32' | 'float64'

interface ResampleParameters {
  readonly displayAxes: readonly [string, string]
  readonly width: number
  readonly height: number
  readonly kernel: ResampleKernel
  readonly outputSampleType: ResampleOutputType
  readonly invalidPolicy: 'propagate' | 'ignore'
}

const resampleParameters = (
  value: OperationJsonValue,
  source?: NormalizedScientificDatasetDescriptor,
): ResampleParameters => {
  const parameters = parameterRecord(value)
  const displayAxes = displayAxesParameter(parameters)
  const kernel = stringParameter(parameters, 'kernel')
  if (kernel !== 'nearest' && kernel !== 'bilinear')
    throw invalidInput('Unsupported resample kernel')
  const explicitWidth = optionalNumberParameter(parameters, 'width')
  const explicitHeight = optionalNumberParameter(parameters, 'height')
  const scaleX = optionalNumberParameter(parameters, 'scaleX')
  const scaleY = optionalNumberParameter(parameters, 'scaleY')
  if (
    (explicitWidth === undefined) === (scaleX === undefined) ||
    (explicitHeight === undefined) === (scaleY === undefined)
  ) {
    throw invalidInput('Resample requires exactly one width/scaleX and one height/scaleY')
  }
  let width = explicitWidth
  let height = explicitHeight
  if (source !== undefined) {
    if (width === undefined)
      width = Math.max(1, Math.round(axis(source, displayAxes[0]).length * (scaleX ?? 0)))
    if (height === undefined)
      height = Math.max(1, Math.round(axis(source, displayAxes[1]).length * (scaleY ?? 0)))
  }
  if (width === undefined || height === undefined) {
    if (!(scaleX !== undefined && scaleX > 0 && scaleY !== undefined && scaleY > 0)) {
      throw invalidInput('Resample scales must be positive')
    }
    width = 1
    height = 1
  }
  if (!Number.isSafeInteger(width) || width < 1 || !Number.isSafeInteger(height) || height < 1) {
    throw invalidInput('Resample output dimensions must be positive safe integers')
  }
  const requested = parameters.outputSampleType
  const outputSampleType =
    requested === undefined ? (kernel === 'bilinear' ? 'float32' : 'preserve') : requested
  if (
    outputSampleType !== 'preserve' &&
    outputSampleType !== 'float32' &&
    outputSampleType !== 'float64'
  ) {
    throw invalidInput('Unsupported resample output sample type')
  }
  if (kernel === 'bilinear' && outputSampleType === 'preserve') {
    throw invalidInput('Bilinear resampling requires float32 or float64 output')
  }
  const invalidPolicy = stringParameter(parameters, 'invalidPolicy')
  if (invalidPolicy !== 'propagate' && invalidPolicy !== 'ignore')
    throw invalidInput('Unsupported resample invalid policy')
  return Object.freeze({ displayAxes, width, height, kernel, outputSampleType, invalidPolicy })
}

const resampledCoordinates = (
  source: ScientificAxisDescriptor,
  outputLength: number,
  kernel: ResampleKernel,
): ScientificAxisCoordinates => {
  const scale = source.length / outputLength
  if (source.coordinates.type === 'index') {
    return Object.freeze({ type: 'linear', origin: scale * 0.5 - 0.5, step: scale })
  }
  if (source.coordinates.type === 'linear') {
    return Object.freeze({
      type: 'linear',
      origin: source.coordinates.origin + (scale * 0.5 - 0.5) * source.coordinates.step,
      step: source.coordinates.step * scale,
    })
  }
  if (source.coordinates.type === 'labels') {
    if (kernel !== 'nearest')
      throw invalidInput('Bilinear resampling cannot interpolate label coordinates')
    const values: string[] = []
    for (let index = 0; index < outputLength; index += 1) {
      const sourceIndex = Math.min(source.length - 1, Math.floor((index + 0.5) * scale))
      values.push(source.coordinates.values[sourceIndex] ?? '')
    }
    return Object.freeze({ type: 'labels', values: Object.freeze(values) })
  }
  const values: number[] = []
  for (let index = 0; index < outputLength; index += 1) {
    const position = (index + 0.5) * scale - 0.5
    const low = Math.max(0, Math.min(source.length - 1, Math.floor(position)))
    const high = Math.max(0, Math.min(source.length - 1, low + 1))
    const weight = Math.max(0, Math.min(1, position - Math.floor(position)))
    const first = source.coordinates.values[low] ?? Number.NaN
    const second = source.coordinates.values[high] ?? first
    values.push(
      kernel === 'nearest'
        ? (source.coordinates.values[
            Math.min(source.length - 1, Math.floor((index + 0.5) * scale))
          ] ?? Number.NaN)
        : first + (second - first) * weight,
    )
  }
  return Object.freeze({ type: 'lookup', values: Object.freeze(values) })
}

const outputRasterSampleType = (
  source: RasterSampleType,
  output: ResampleOutputType,
): RasterSampleType => (output === 'preserve' ? source : output)

const inferResampleDescriptor = (
  source: NormalizedScientificDatasetDescriptor,
  value: OperationJsonValue,
): NormalizedScientificDatasetDescriptor => {
  assertLevelZero(source)
  const parameters = resampleParameters(value, source)
  const [horizontalId, verticalId] = parameters.displayAxes
  axis(source, horizontalId)
  axis(source, verticalId)
  const axes = source.axes.map((entry) => {
    const length =
      entry.id === horizontalId
        ? parameters.width
        : entry.id === verticalId
          ? parameters.height
          : entry.length
    if (length === entry.length) return entry
    return Object.freeze({
      ...entry,
      length,
      coordinates: resampledCoordinates(entry, length, parameters.kernel),
      ...(entry.entries === undefined
        ? {}
        : {
            entries: Object.freeze(
              Array.from({ length }, (_, index) => {
                const sourceIndex = Math.min(
                  entry.length - 1,
                  Math.floor(((index + 0.5) * entry.length) / length),
                )
                return entry.entries?.[sourceIndex] ?? {}
              }),
            ),
          }),
    })
  })
  const sampleType = outputRasterSampleType(source.sampleType, parameters.outputSampleType)
  return normalizeScientificDatasetDescriptor({
    ...source,
    axes,
    sampleType,
    levels: [
      { level: 0, axisLengths: axes.map((entry) => ({ axisId: entry.id, length: entry.length })) },
    ],
    ...(parameters.outputSampleType === 'preserve' && source.noDataValue !== undefined
      ? { noDataValue: source.noDataValue }
      : {}),
    metadata: {
      ...(source.metadata ?? {}),
      analysisOperation: analysisResampleOperationId,
      resampleKernel: parameters.kernel,
      resampleInvalidPolicy: parameters.invalidPolicy,
      sourceAxisLengths: [axis(source, horizontalId).length, axis(source, verticalId).length],
    },
  })
}

type ProjectionMode = 'max' | 'min' | 'mean'
type ProjectionInvalidPolicy = 'ignore' | 'propagate'

interface ProjectionParameters extends SliceParameters {
  readonly reductionAxis: string
  readonly mode: ProjectionMode
  readonly invalidPolicy: ProjectionInvalidPolicy
  readonly outputSampleType: 'preserve' | 'float32' | 'float64'
}

const projectionParameters = (
  value: OperationJsonValue,
  source?: NormalizedScientificDatasetDescriptor,
): ProjectionParameters => {
  const parameters = parameterRecord(value)
  const mode = stringParameter(parameters, 'mode')
  if (mode !== 'max' && mode !== 'min' && mode !== 'mean')
    throw invalidInput('Unsupported projection mode')
  const invalidPolicy = stringParameter(parameters, 'invalidPolicy')
  if (invalidPolicy !== 'ignore' && invalidPolicy !== 'propagate')
    throw invalidInput('Unsupported projection invalid policy')
  const requested = parameters.outputSampleType
  const outputSampleType =
    requested === undefined ? (mode === 'mean' ? 'float64' : 'preserve') : requested
  if (
    outputSampleType !== 'preserve' &&
    outputSampleType !== 'float32' &&
    outputSampleType !== 'float64'
  ) {
    throw invalidInput('Unsupported projection output sample type')
  }
  if (mode === 'mean' && outputSampleType === 'preserve') {
    throw invalidInput('Mean projection requires float32 or float64 output')
  }
  const result = Object.freeze({
    displayAxes: displayAxesParameter(parameters),
    fixedIndices: fixedIndicesParameter(parameters),
    reductionAxis: stringParameter(parameters, 'reductionAxis'),
    mode,
    invalidPolicy,
    outputSampleType,
  })
  if (source !== undefined)
    validateSelection(source, result.displayAxes, result.fixedIndices, result.reductionAxis)
  return result
}

const inferProjectionDescriptor = (
  source: NormalizedScientificDatasetDescriptor,
  value: OperationJsonValue,
): NormalizedScientificDatasetDescriptor => {
  const parameters = projectionParameters(value, source)
  const sampleType = outputRasterSampleType(source.sampleType, parameters.outputSampleType)
  const descriptor = twoDimensionalDescriptor(
    source,
    parameters.displayAxes,
    sampleType,
    analysisProjectionOperationId,
  )
  if (parameters.outputSampleType === 'preserve') return descriptor
  return normalizeScientificDatasetDescriptor({ ...descriptor, noDataValue: undefined })
}

type ThresholdMode =
  | 'greater-than'
  | 'greater-or-equal'
  | 'less-than'
  | 'less-or-equal'
  | 'inside'
  | 'outside'

interface ThresholdParameters {
  readonly mode: ThresholdMode
  readonly threshold?: number
  readonly minimum?: number
  readonly maximum?: number
  readonly invalidOutput: 0 | 1
}

const thresholdParameters = (
  value: OperationJsonValue,
  source?: NormalizedScientificDatasetDescriptor,
): ThresholdParameters => {
  const parameters = parameterRecord(value)
  const mode = stringParameter(parameters, 'mode')
  if (
    mode !== 'greater-than' &&
    mode !== 'greater-or-equal' &&
    mode !== 'less-than' &&
    mode !== 'less-or-equal' &&
    mode !== 'inside' &&
    mode !== 'outside'
  ) {
    throw invalidInput('Unsupported threshold comparison mode')
  }
  const threshold = optionalNumberParameter(parameters, 'threshold')
  const minimum = optionalNumberParameter(parameters, 'minimum')
  const maximum = optionalNumberParameter(parameters, 'maximum')
  if (mode === 'inside' || mode === 'outside') {
    if (minimum === undefined || maximum === undefined || minimum > maximum) {
      throw invalidInput('Range threshold requires ordered minimum and maximum values')
    }
  } else if (threshold === undefined) {
    throw invalidInput('Threshold comparison requires a threshold value')
  }
  const invalidOutput = numberParameter(parameters, 'invalidOutput')
  if (invalidOutput !== 0 && invalidOutput !== 1)
    throw invalidInput('invalidOutput must be zero or one')
  if (source !== undefined) {
    assertLevelZero(source)
    if (source.components.length !== 1)
      throw invalidInput('Threshold requires a one-component scalar dataset')
    if (source.sampleType === 'uint64') {
      for (const boundary of [threshold, minimum, maximum]) {
        if (boundary !== undefined && (!Number.isSafeInteger(boundary) || boundary < 0)) {
          throw invalidInput('uint64 threshold boundaries must be non-negative safe integers')
        }
      }
    }
  }
  return Object.freeze({
    mode,
    ...(threshold === undefined ? {} : { threshold }),
    ...(minimum === undefined ? {} : { minimum }),
    ...(maximum === undefined ? {} : { maximum }),
    invalidOutput,
  })
}

const inferThresholdDescriptor = (
  source: NormalizedScientificDatasetDescriptor,
  value: OperationJsonValue,
): NormalizedScientificDatasetDescriptor => {
  thresholdParameters(value, source)
  return normalizeScientificDatasetDescriptor({
    ...source,
    sampleType: 'uint8',
    components: [{ id: 'mask', name: 'Threshold mask', kind: 'scalar' }],
    metadata: {
      ...(source.metadata ?? {}),
      analysisOperation: analysisThresholdOperationId,
      maskFalseValue: 0,
      maskTrueValue: 1,
    },
    noDataValue: undefined,
  })
}

type GaussianBoundaryMode = 'clamp' | 'mirror' | 'constant'
type GaussianInvalidPolicy = 'propagate' | 'ignore'

interface GaussianBlurParameters {
  readonly displayAxes: readonly [string, string]
  readonly component: number
  readonly sigma: number
  readonly radius: number
  readonly boundary: GaussianBoundaryMode
  readonly constantValue: number
  readonly invalidPolicy: GaussianInvalidPolicy
}

const gaussianBlurParameters = (
  value: OperationJsonValue,
  source?: NormalizedScientificDatasetDescriptor,
): GaussianBlurParameters => {
  const parameters = parameterRecord(value)
  const component = numberParameter(parameters, 'component')
  if (!Number.isSafeInteger(component) || component < 0)
    throw invalidInput('Gaussian blur component must be a non-negative integer')
  const sigma = numberParameter(parameters, 'sigma')
  if (!(sigma > 0) || sigma > 64) throw invalidInput('Gaussian blur sigma must be in (0, 64]')
  const boundary = stringParameter(parameters, 'boundary')
  if (boundary !== 'clamp' && boundary !== 'mirror' && boundary !== 'constant')
    throw invalidInput('Unsupported Gaussian blur boundary mode')
  const invalidPolicy = stringParameter(parameters, 'invalidPolicy')
  if (invalidPolicy !== 'propagate' && invalidPolicy !== 'ignore')
    throw invalidInput('Unsupported Gaussian blur invalid policy')
  const result = Object.freeze({
    displayAxes: displayAxesParameter(parameters),
    component,
    sigma,
    radius: Math.ceil(3 * sigma),
    boundary,
    constantValue: numberParameter(parameters, 'constantValue'),
    invalidPolicy,
  })
  if (source !== undefined) {
    assertLevelZero(source)
    axis(source, result.displayAxes[0])
    axis(source, result.displayAxes[1])
    if (result.component >= source.components.length)
      throw invalidInput('Gaussian blur component is unavailable')
  }
  return result
}

const inferGaussianBlurDescriptor = (
  source: NormalizedScientificDatasetDescriptor,
  value: OperationJsonValue,
): NormalizedScientificDatasetDescriptor => {
  const parameters = gaussianBlurParameters(value, source)
  const component = source.components[parameters.component]
  if (component === undefined) throw invalidInput('Gaussian blur component is unavailable')
  return normalizeScientificDatasetDescriptor({
    ...source,
    sampleType: 'float32',
    components: [
      {
        id: component.id,
        ...(component.name === undefined ? {} : { name: component.name }),
        kind: component.kind,
        ...(component.unit === undefined ? {} : { unit: component.unit }),
        ...(component.color === undefined ? {} : { color: component.color }),
      },
    ],
    noDataValue: undefined,
    metadata: {
      ...(source.metadata ?? {}),
      analysisOperation: analysisGaussianBlurOperationId,
      gaussianSigmaPixels: parameters.sigma,
      gaussianRadiusPixels: parameters.radius,
      gaussianBoundary: parameters.boundary,
      gaussianInvalidPolicy: parameters.invalidPolicy,
    },
  })
}

export const analysisDatasetOperationDefinitions: readonly OperationDefinition[] = Object.freeze([
  semanticDefinition({
    id: analysisCropOperationId,
    title: 'Crop scientific dataset',
    execution: 'dataset-transform',
    parameters: objectSchema(
      {
        displayAxes: displayAxesSchema,
        x: nonNegativeIntegerSchema,
        y: nonNegativeIntegerSchema,
        width: positiveIntegerSchema,
        height: positiveIntegerSchema,
      },
      ['displayAxes', 'x', 'y', 'width', 'height'],
    ),
    validate: (value) => {
      cropParameters(value)
    },
    infer: (value, input) => inferCropDescriptor(input, cropParameters(value)),
  }),
  semanticDefinition({
    id: analysisResampleOperationId,
    title: 'Resample scientific dataset',
    execution: 'neighborhood',
    reproducibility: { class: 'tolerance-based', absolute: 1e-6, relative: 1e-6 },
    parameters: objectSchema(
      {
        displayAxes: displayAxesSchema,
        width: positiveIntegerSchema,
        height: positiveIntegerSchema,
        scaleX: Object.freeze({
          type: 'number',
          minimum: 0,
          exclusiveMinimum: true,
          finiteOnly: true,
        }),
        scaleY: Object.freeze({
          type: 'number',
          minimum: 0,
          exclusiveMinimum: true,
          finiteOnly: true,
        }),
        kernel: Object.freeze({
          type: 'enum',
          values: ['nearest', 'bilinear'],
          default: 'nearest',
        }),
        outputSampleType: Object.freeze({
          type: 'enum',
          values: ['preserve', 'float32', 'float64'],
        }),
        invalidPolicy: Object.freeze({
          type: 'enum',
          values: ['propagate', 'ignore'],
          default: 'propagate',
        }),
      },
      ['displayAxes'],
    ),
    validate: (value) => {
      resampleParameters(value)
    },
    infer: (value, input) => inferResampleDescriptor(input, value),
  }),
  semanticDefinition({
    id: analysisSliceOperationId,
    title: 'Slice scientific dataset',
    execution: 'dataset-transform',
    parameters: objectSchema({ displayAxes: displayAxesSchema, fixedIndices: fixedIndicesSchema }, [
      'displayAxes',
      'fixedIndices',
    ]),
    validate: (value) => {
      sliceParameters(value)
    },
    infer: (value, input) => inferSliceDescriptor(input, sliceParameters(value)),
  }),
  semanticDefinition({
    id: analysisProjectionOperationId,
    title: 'Project scientific dataset',
    execution: 'reduction',
    reproducibility: { class: 'tolerance-based', absolute: 1e-12, relative: 1e-12 },
    parameters: objectSchema(
      {
        displayAxes: displayAxesSchema,
        fixedIndices: fixedIndicesSchema,
        reductionAxis: axisIdSchema,
        mode: Object.freeze({ type: 'enum', values: ['max', 'min', 'mean'] }),
        invalidPolicy: Object.freeze({
          type: 'enum',
          values: ['ignore', 'propagate'],
          default: 'ignore',
        }),
        outputSampleType: Object.freeze({
          type: 'enum',
          values: ['preserve', 'float32', 'float64'],
        }),
      },
      ['displayAxes', 'fixedIndices', 'reductionAxis', 'mode'],
    ),
    validate: (value) => {
      projectionParameters(value)
    },
    infer: (value, input) => inferProjectionDescriptor(input, value),
  }),
  semanticDefinition({
    id: analysisThresholdOperationId,
    title: 'Threshold scientific dataset',
    execution: 'tile-local',
    parameters: objectSchema(
      {
        mode: Object.freeze({
          type: 'enum',
          values: [
            'greater-than',
            'greater-or-equal',
            'less-than',
            'less-or-equal',
            'inside',
            'outside',
          ],
        }),
        threshold: Object.freeze({ type: 'number', finiteOnly: true }),
        minimum: Object.freeze({ type: 'number', finiteOnly: true }),
        maximum: Object.freeze({ type: 'number', finiteOnly: true }),
        invalidOutput: Object.freeze({ type: 'enum', values: [0, 1], default: 0 }),
      },
      ['mode'],
    ),
    validate: (value) => {
      thresholdParameters(value)
    },
    infer: (value, input) => inferThresholdDescriptor(input, value),
  }),
  semanticDefinition({
    id: analysisGaussianBlurOperationId,
    title: 'Gaussian blur scientific dataset',
    execution: 'neighborhood',
    reproducibility: { class: 'tolerance-based', absolute: 1e-5, relative: 1e-6 },
    parameters: objectSchema(
      {
        displayAxes: displayAxesSchema,
        component: Object.freeze({ type: 'integer', minimum: 0, default: 0 }),
        sigma: Object.freeze({
          type: 'number',
          minimum: 0,
          maximum: 64,
          exclusiveMinimum: true,
          finiteOnly: true,
        }),
        boundary: Object.freeze({
          type: 'enum',
          values: ['clamp', 'mirror', 'constant'],
          default: 'clamp',
        }),
        constantValue: Object.freeze({ type: 'number', finiteOnly: true, default: 0 }),
        invalidPolicy: Object.freeze({
          type: 'enum',
          values: ['propagate', 'ignore'],
          default: 'propagate',
        }),
      },
      ['displayAxes', 'sigma'],
    ),
    validate: (value) => {
      gaussianBlurParameters(value)
    },
    infer: (value, input) => inferGaussianBlurDescriptor(input, value),
  }),
])

const numericSampleType = (sampleType: RasterSampleType): NumericSampleType =>
  sampleType === 'float16' ? 'float32' : sampleType

const allocateNumericArray = (sampleType: NumericSampleType, length: number): NumericArray => {
  if (sampleType === 'uint8') return new Uint8Array(length)
  if (sampleType === 'uint16') return new Uint16Array(length)
  if (sampleType === 'uint32') return new Uint32Array(length)
  if (sampleType === 'uint64') return new BigUint64Array(length)
  if (sampleType === 'int8') return new Int8Array(length)
  if (sampleType === 'int16') return new Int16Array(length)
  if (sampleType === 'int32') return new Int32Array(length)
  if (sampleType === 'float32') return new Float32Array(length)
  return new Float64Array(length)
}

const numericValue = (
  tile: NumericTile,
  x: number,
  y: number,
  component: number,
): number | bigint => {
  const value = tile.data[numericTileSampleOffset(tile, x, y, component)]
  return value ?? (tile.data instanceof BigUint64Array ? 0n : 0)
}

const setNumericValue = (data: NumericArray, index: number, value: number | bigint): void => {
  if (data instanceof BigUint64Array) {
    if (typeof value !== 'bigint') throw invalidInput('Expected an exact uint64 value')
    data[index] = value
    return
  }
  if (typeof value !== 'number') {
    if (value > BigInt(Number.MAX_SAFE_INTEGER))
      throw invalidInput('uint64 value exceeds exact numeric conversion')
    data[index] = Number(value)
    return
  }
  data[index] = value
}

const packedTile = (
  request: NormalizedScientificPlaneReadRequest,
  sampleType: NumericSampleType,
  components: number,
): NumericTile => {
  const elements = request.width * request.height * components
  if (!Number.isSafeInteger(elements)) throw invalidInput('Numeric output tile is too large')
  const data = allocateNumericArray(sampleType, elements)
  return Object.freeze({
    x: request.x,
    y: request.y,
    width: request.width,
    height: request.height,
    sampleType,
    componentCount: components,
    layout: 'interleaved' as const,
    rowStrideElements: request.width * components,
    data,
    release() {},
  })
}

const writeTileSample = (
  view: DataView,
  offset: number,
  sampleType: RasterSampleType,
  value: number | bigint,
): void => {
  if (sampleType === 'uint64') {
    if (typeof value !== 'bigint') {
      if (!Number.isSafeInteger(value) || value < 0)
        throw invalidInput('Invalid uint64 output sample')
      view.setBigUint64(offset, BigInt(value), false)
    } else view.setBigUint64(offset, value, false)
    return
  }
  if (typeof value !== 'number') {
    if (value > BigInt(Number.MAX_SAFE_INTEGER))
      throw invalidInput('uint64 output conversion is inexact')
    writeRasterSample(view, offset, sampleType, Number(value))
    return
  }
  writeRasterSample(view, offset, sampleType, value)
}

const tileToRasterBlock = (tile: NumericTile, sampleType: RasterSampleType): RasterBlock => {
  validateNumericTile(tile)
  const bytes = rasterSampleBytes(sampleType)
  const stride = tile.width * tile.componentCount * bytes
  const data = new Uint8Array(stride * tile.height)
  const view = new DataView(data.buffer)
  for (let y = 0; y < tile.height; y += 1) {
    for (let x = 0; x < tile.width; x += 1) {
      for (let component = 0; component < tile.componentCount; component += 1) {
        const offset = y * stride + (x * tile.componentCount + component) * bytes
        writeTileSample(view, offset, sampleType, numericValue(tile, x, y, component))
      }
    }
  }
  return Object.freeze({
    x: tile.x,
    y: tile.y,
    width: tile.width,
    height: tile.height,
    stride,
    format: Object.freeze({ sampleType, channels: tile.componentCount, planar: false }),
    data,
  })
}

type TileReader = (request: NormalizedScientificPlaneReadRequest) => Promise<NumericTile>

const operationDataset = (
  descriptor: NormalizedScientificDatasetDescriptor,
  readTile: TileReader,
  tileWidth: number,
  tileHeight: number,
): DirectNumericTileDataset => {
  const nativeType = numericSampleType(descriptor.sampleType)
  const source: NumericTileSource = Object.freeze({
    descriptor,
    directSemantics: Object.freeze({
      sourceSampleType: descriptor.sampleType,
      nativeSampleType: nativeType,
      componentCount: descriptor.components.length,
      layout: 'interleaved' as const,
      supportedTargetSampleTypes: Object.freeze([nativeType]),
    }),
    async *readNumericTiles(input: Readonly<NumericTileReadRequest>): AsyncGenerator<NumericTile> {
      const request = normalizeScientificPlaneReadRequest(descriptor, input)
      if (input.targetSampleType !== undefined && input.targetSampleType !== nativeType) {
        throw invalidInput(`Derived dataset supports native ${nativeType} tiles only`)
      }
      for (let y = request.y; y < request.y + request.height; y += tileHeight) {
        const height = Math.min(tileHeight, request.y + request.height - y)
        for (let x = request.x; x < request.x + request.width; x += tileWidth) {
          throwIfAborted(request.signal)
          const width = Math.min(tileWidth, request.x + request.width - x)
          yield await readTile(Object.freeze({ ...request, x, y, width, height }))
        }
      }
    },
  })
  return Object.freeze({
    descriptor,
    numericTileSource: source,
    async *readPlane(input: Readonly<ScientificPlaneReadRequest>): AsyncGenerator<RasterBlock> {
      for await (const tile of source.readNumericTiles(input)) {
        try {
          yield tileToRasterBlock(tile, descriptor.sampleType)
        } finally {
          tile.release()
        }
      }
    },
  })
}

export interface AnalysisDatasetOperationContextOptions {
  readonly runtime: TileRuntime
  readonly tileWidth?: number
  readonly tileHeight?: number
  readonly sessionId?: string
}

export class AnalysisDatasetOperationContext {
  readonly runtime: TileRuntime
  readonly tileWidth: number
  readonly tileHeight: number
  readonly #sessionId: string
  readonly #identities = new WeakMap<ScientificDataset, TileDatasetIdentity>()
  readonly #sources = new WeakMap<ScientificDataset, TileSource>()
  #identityCounter = 0

  constructor(options: Readonly<AnalysisDatasetOperationContextOptions>) {
    this.runtime = options.runtime
    this.tileWidth = options.tileWidth ?? 256
    this.tileHeight = options.tileHeight ?? 256
    if (
      !Number.isSafeInteger(this.tileWidth) ||
      this.tileWidth < 1 ||
      !Number.isSafeInteger(this.tileHeight) ||
      this.tileHeight < 1
    ) {
      throw invalidInput('Analysis tile dimensions must be positive safe integers')
    }
    this.#sessionId = options.sessionId ?? 'reference-analysis'
    if (this.#sessionId.trim().length === 0 || this.#sessionId.length > 4_096) {
      throw invalidInput('Analysis operation sessionId must be bounded and non-empty')
    }
  }

  async readSourceTile(
    dataset: ScientificDataset,
    input: Readonly<ScientificPlaneReadRequest>,
    targetSampleType?: NumericSampleType,
  ): Promise<NumericTile> {
    const request = normalizeScientificPlaneReadRequest(dataset.descriptor, input)
    const source = this.#source(dataset)
    const identity = this.#identity(dataset)
    const address: TileAddress = Object.freeze({
      cacheClass: 'source',
      namespace: `analysis-source:${identity.datasetId}`,
      dataset: identity,
      displayAxes: request.displayAxes,
      fixedIndices: request.fixedIndices,
      resolutionLevel: request.resolutionLevel,
      x: request.x,
      y: request.y,
      width: request.width,
      height: request.height,
    })
    const tileRequest: TileRequest = Object.freeze({
      address,
      priority: 'visible',
      signal: request.signal ?? new AbortController().signal,
      ...(targetSampleType === undefined
        ? {}
        : {
            target: Object.freeze({ sampleType: targetSampleType, layout: 'interleaved' as const }),
          }),
    })
    return this.runtime.request(source, tileRequest)
  }

  #source(dataset: ScientificDataset): TileSource {
    let source = this.#sources.get(dataset)
    if (source === undefined) {
      source = numericTileSourceToTileSource(resolveNumericTileSource(dataset))
      this.#sources.set(dataset, source)
    }
    return source
  }

  #identity(dataset: ScientificDataset): TileDatasetIdentity {
    let identity = this.#identities.get(dataset)
    if (identity === undefined) {
      this.#identityCounter += 1
      const id = `${this.#sessionId}:${this.#identityCounter}`
      identity = Object.freeze({
        datasetId: id,
        source: Object.freeze({
          kind: 'session',
          strength: 'session',
          stability: 'instance',
          id,
          size: 0,
        }),
        sessionId: this.#sessionId,
        generation: 0,
      })
      this.#identities.set(dataset, identity)
    }
    return identity
  }
}

const rebaseTile = (tile: NumericTile, x: number, y: number): NumericTile =>
  Object.freeze({ ...tile, x, y, release: tile.release })

const cropDataset = (
  source: ScientificDataset,
  value: OperationJsonValue,
  context: AnalysisDatasetOperationContext,
): ScientificDataset => {
  const parameters = cropParameters(value)
  const descriptor = inferCropDescriptor(source.descriptor, parameters)
  return operationDataset(
    descriptor,
    async (request) => {
      const fixedIndices = request.fixedIndices.map((entry) => {
        if (entry.axisId === parameters.displayAxes[0])
          return Object.freeze({ ...entry, index: entry.index + parameters.x })
        if (entry.axisId === parameters.displayAxes[1])
          return Object.freeze({ ...entry, index: entry.index + parameters.y })
        return entry
      })
      const xOffset =
        request.displayAxes[0] === parameters.displayAxes[0]
          ? parameters.x
          : request.displayAxes[0] === parameters.displayAxes[1]
            ? parameters.y
            : 0
      const yOffset =
        request.displayAxes[1] === parameters.displayAxes[0]
          ? parameters.x
          : request.displayAxes[1] === parameters.displayAxes[1]
            ? parameters.y
            : 0
      const tile = await context.readSourceTile(source, {
        ...request,
        fixedIndices,
        x: request.x + xOffset,
        y: request.y + yOffset,
      })
      return rebaseTile(tile, request.x, request.y)
    },
    context.tileWidth,
    context.tileHeight,
  )
}

const sliceDataset = (
  source: ScientificDataset,
  value: OperationJsonValue,
  context: AnalysisDatasetOperationContext,
): ScientificDataset => {
  const parameters = sliceParameters(value)
  const descriptor = inferSliceDescriptor(source.descriptor, parameters)
  return operationDataset(
    descriptor,
    async (request) =>
      context.readSourceTile(source, { ...request, fixedIndices: parameters.fixedIndices }),
    context.tileWidth,
    context.tileHeight,
  )
}

const sourcePosition = (outputIndex: number, sourceLength: number, outputLength: number): number =>
  (outputIndex + 0.5) * (sourceLength / outputLength) - 0.5

const resampleDataset = (
  source: ScientificDataset,
  value: OperationJsonValue,
  context: AnalysisDatasetOperationContext,
): ScientificDataset => {
  const parameters = resampleParameters(value, source.descriptor)
  const descriptor = inferResampleDescriptor(source.descriptor, value)
  const sourceWidth = axis(source.descriptor, parameters.displayAxes[0]).length
  const sourceHeight = axis(source.descriptor, parameters.displayAxes[1]).length
  const targetType = numericSampleType(descriptor.sampleType)
  return operationDataset(
    descriptor,
    async (request) => {
      if (
        request.displayAxes[0] !== parameters.displayAxes[0] ||
        request.displayAxes[1] !== parameters.displayAxes[1]
      ) {
        throw invalidInput('Resample reads must use the operation display-axis order')
      }
      const firstX = sourcePosition(request.x, sourceWidth, parameters.width)
      const lastX = sourcePosition(request.x + request.width - 1, sourceWidth, parameters.width)
      const firstY = sourcePosition(request.y, sourceHeight, parameters.height)
      const lastY = sourcePosition(request.y + request.height - 1, sourceHeight, parameters.height)
      const sourceX = Math.max(0, Math.floor(Math.min(firstX, lastX)))
      const sourceY = Math.max(0, Math.floor(Math.min(firstY, lastY)))
      const sourceRight = Math.min(sourceWidth, Math.floor(Math.max(firstX, lastX)) + 2)
      const sourceBottom = Math.min(sourceHeight, Math.floor(Math.max(firstY, lastY)) + 2)
      const input = await context.readSourceTile(
        source,
        {
          ...request,
          x: sourceX,
          y: sourceY,
          width: sourceRight - sourceX,
          height: sourceBottom - sourceY,
        },
        parameters.kernel === 'bilinear' ? 'float64' : undefined,
      )
      try {
        const output = packedTile(request, targetType, input.componentCount)
        for (let y = 0; y < request.height; y += 1) {
          throwIfAborted(request.signal)
          const positionY = sourcePosition(request.y + y, sourceHeight, parameters.height)
          const nearestY = Math.max(0, Math.min(sourceHeight - 1, Math.floor(positionY + 0.5)))
          const y0 = Math.max(0, Math.min(sourceHeight - 1, Math.floor(positionY)))
          const y1 = Math.max(0, Math.min(sourceHeight - 1, y0 + 1))
          const wy = Math.max(0, Math.min(1, positionY - Math.floor(positionY)))
          for (let x = 0; x < request.width; x += 1) {
            const positionX = sourcePosition(request.x + x, sourceWidth, parameters.width)
            const nearestX = Math.max(0, Math.min(sourceWidth - 1, Math.floor(positionX + 0.5)))
            const x0 = Math.max(0, Math.min(sourceWidth - 1, Math.floor(positionX)))
            const x1 = Math.max(0, Math.min(sourceWidth - 1, x0 + 1))
            const wx = Math.max(0, Math.min(1, positionX - Math.floor(positionX)))
            for (let component = 0; component < input.componentCount; component += 1) {
              let outputValue: number | bigint
              if (parameters.kernel === 'nearest') {
                outputValue = numericValue(input, nearestX - sourceX, nearestY - sourceY, component)
                if (
                  parameters.outputSampleType !== 'preserve' &&
                  !usableValue(outputValue, source.descriptor.noDataValue)
                ) {
                  outputValue = Number.NaN
                }
              } else {
                const topLeft = numericValue(input, x0 - sourceX, y0 - sourceY, component)
                const topRight = numericValue(input, x1 - sourceX, y0 - sourceY, component)
                const bottomLeft = numericValue(input, x0 - sourceX, y1 - sourceY, component)
                const bottomRight = numericValue(input, x1 - sourceX, y1 - sourceY, component)
                if (
                  typeof topLeft !== 'number' ||
                  typeof topRight !== 'number' ||
                  typeof bottomLeft !== 'number' ||
                  typeof bottomRight !== 'number'
                ) {
                  throw invalidInput('Bilinear resampling cannot interpolate inexact uint64 values')
                }
                const topLeftWeight = (1 - wx) * (1 - wy)
                const topRightWeight = wx * (1 - wy)
                const bottomLeftWeight = (1 - wx) * wy
                const bottomRightWeight = wx * wy
                let weighted = 0
                let weight = 0
                let invalid = false
                if (usableValue(topLeft, source.descriptor.noDataValue)) {
                  weighted += topLeft * topLeftWeight
                  weight += topLeftWeight
                } else invalid = true
                if (usableValue(topRight, source.descriptor.noDataValue)) {
                  weighted += topRight * topRightWeight
                  weight += topRightWeight
                } else invalid = true
                if (usableValue(bottomLeft, source.descriptor.noDataValue)) {
                  weighted += bottomLeft * bottomLeftWeight
                  weight += bottomLeftWeight
                } else invalid = true
                if (usableValue(bottomRight, source.descriptor.noDataValue)) {
                  weighted += bottomRight * bottomRightWeight
                  weight += bottomRightWeight
                } else invalid = true
                outputValue =
                  (invalid && parameters.invalidPolicy === 'propagate') || weight === 0
                    ? Number.NaN
                    : weighted / weight
              }
              setNumericValue(
                output.data,
                (y * request.width + x) * input.componentCount + component,
                outputValue,
              )
            }
          }
        }
        return output
      } finally {
        input.release()
      }
    },
    context.tileWidth,
    context.tileHeight,
  )
}

const thresholdBoundary = (value: number | bigint, boundary: number): number | bigint =>
  typeof value === 'bigint' ? BigInt(boundary) : boundary

const thresholdMatches = (value: number | bigint, parameters: ThresholdParameters): boolean => {
  if (parameters.mode === 'greater-than')
    return value > thresholdBoundary(value, parameters.threshold ?? 0)
  if (parameters.mode === 'greater-or-equal')
    return value >= thresholdBoundary(value, parameters.threshold ?? 0)
  if (parameters.mode === 'less-than')
    return value < thresholdBoundary(value, parameters.threshold ?? 0)
  if (parameters.mode === 'less-or-equal')
    return value <= thresholdBoundary(value, parameters.threshold ?? 0)
  const inside =
    value >= thresholdBoundary(value, parameters.minimum ?? 0) &&
    value <= thresholdBoundary(value, parameters.maximum ?? 0)
  return parameters.mode === 'inside' ? inside : !inside
}

const thresholdDataset = (
  source: ScientificDataset,
  value: OperationJsonValue,
  context: AnalysisDatasetOperationContext,
): ScientificDataset => {
  const parameters = thresholdParameters(value, source.descriptor)
  const descriptor = inferThresholdDescriptor(source.descriptor, value)
  return operationDataset(
    descriptor,
    async (request) => {
      const input = await context.readSourceTile(source, request)
      try {
        const output = packedTile(request, 'uint8', 1)
        if (!(output.data instanceof Uint8Array))
          throw invalidInput('Threshold output allocation must be uint8')
        for (let y = 0; y < request.height; y += 1) {
          throwIfAborted(request.signal)
          for (let x = 0; x < request.width; x += 1) {
            const index = y * request.width + x
            const sample = numericValue(input, x, y, 0)
            output.data[index] = usableValue(sample, source.descriptor.noDataValue)
              ? thresholdMatches(sample, parameters)
                ? 1
                : 0
              : parameters.invalidOutput
          }
        }
        return output
      } finally {
        input.release()
      }
    },
    context.tileWidth,
    context.tileHeight,
  )
}

const gaussianKernel = (sigma: number, radius: number): Float64Array => {
  const result = new Float64Array(radius * 2 + 1)
  const denominator = 2 * sigma * sigma
  let total = 0
  for (let index = -radius; index <= radius; index += 1) {
    const coefficient = Math.exp(-(index * index) / denominator)
    result[index + radius] = coefficient
    total += coefficient
  }
  for (let index = 0; index < result.length; index += 1)
    result[index] = (result[index] ?? 0) / total
  return result
}

const boundaryIndex = (index: number, length: number, boundary: GaussianBoundaryMode): number => {
  if (index >= 0 && index < length) return index
  if (boundary === 'constant') return -1
  if (boundary === 'clamp') return index < 0 ? 0 : length - 1
  if (length === 1) return 0
  const period = 2 * (length - 1)
  const wrapped = ((index % period) + period) % period
  return wrapped < length ? wrapped : period - wrapped
}

const gaussianBlurDataset = (
  source: ScientificDataset,
  value: OperationJsonValue,
  context: AnalysisDatasetOperationContext,
): ScientificDataset => {
  const parameters = gaussianBlurParameters(value, source.descriptor)
  const descriptor = inferGaussianBlurDescriptor(source.descriptor, value)
  const sourceWidth = axis(source.descriptor, parameters.displayAxes[0]).length
  const sourceHeight = axis(source.descriptor, parameters.displayAxes[1]).length
  const kernel = gaussianKernel(parameters.sigma, parameters.radius)
  return operationDataset(
    descriptor,
    async (request) => {
      if (
        request.displayAxes[0] !== parameters.displayAxes[0] ||
        request.displayAxes[1] !== parameters.displayAxes[1]
      ) {
        throw invalidInput('Gaussian blur reads must use the operation display-axis order')
      }
      const radius = parameters.radius
      const sourceX = Math.max(0, request.x - radius)
      const sourceY = Math.max(0, request.y - radius)
      const sourceRight = Math.min(sourceWidth, request.x + request.width + radius)
      const sourceBottom = Math.min(sourceHeight, request.y + request.height + radius)
      const input = await context.readSourceTile(
        source,
        {
          ...request,
          x: sourceX,
          y: sourceY,
          width: sourceRight - sourceX,
          height: sourceBottom - sourceY,
        },
        'float64',
      )
      try {
        const expandedHeight = request.height + radius * 2
        const horizontalValues = new Float64Array(request.width * expandedHeight)
        const horizontalWeights =
          parameters.invalidPolicy === 'ignore'
            ? new Float64Array(request.width * expandedHeight)
            : undefined
        const horizontalInvalid =
          parameters.invalidPolicy === 'propagate'
            ? new Uint8Array(request.width * expandedHeight)
            : undefined
        const mappedX = new Int32Array(request.width + radius * 2)
        const mappedY = new Int32Array(expandedHeight)
        for (let index = 0; index < mappedX.length; index += 1) {
          mappedX[index] = boundaryIndex(
            request.x + index - radius,
            sourceWidth,
            parameters.boundary,
          )
        }
        for (let index = 0; index < mappedY.length; index += 1) {
          mappedY[index] = boundaryIndex(
            request.y + index - radius,
            sourceHeight,
            parameters.boundary,
          )
        }
        for (let row = 0; row < expandedHeight; row += 1) {
          throwIfAborted(request.signal)
          const mappedRow = mappedY[row] ?? -1
          for (let x = 0; x < request.width; x += 1) {
            let sum = 0
            let weight = 0
            let invalid = false
            for (let kernelIndex = 0; kernelIndex < kernel.length; kernelIndex += 1) {
              const mappedColumn = mappedX[x + kernelIndex] ?? -1
              const coefficient = kernel[kernelIndex] ?? 0
              const sample =
                mappedColumn < 0 || mappedRow < 0
                  ? parameters.constantValue
                  : numericValue(
                      input,
                      mappedColumn - sourceX,
                      mappedRow - sourceY,
                      parameters.component,
                    )
              if (
                typeof sample !== 'number' ||
                !usableValue(sample, source.descriptor.noDataValue)
              ) {
                invalid = true
                continue
              }
              sum += sample * coefficient
              weight += coefficient
            }
            const offset = row * request.width + x
            horizontalValues[offset] = sum
            if (horizontalWeights !== undefined) horizontalWeights[offset] = weight
            if (invalid && horizontalInvalid !== undefined) horizontalInvalid[offset] = 1
          }
        }
        const output = packedTile(request, 'float32', 1)
        if (!(output.data instanceof Float32Array))
          throw invalidInput('Gaussian blur output allocation must be float32')
        for (let y = 0; y < request.height; y += 1) {
          throwIfAborted(request.signal)
          for (let x = 0; x < request.width; x += 1) {
            let sum = 0
            let weight = 0
            let invalid = false
            for (let kernelIndex = 0; kernelIndex < kernel.length; kernelIndex += 1) {
              const offset = (y + kernelIndex) * request.width + x
              const coefficient = kernel[kernelIndex] ?? 0
              if (horizontalInvalid?.[offset] === 1) invalid = true
              sum += (horizontalValues[offset] ?? 0) * coefficient
              if (horizontalWeights !== undefined)
                weight += (horizontalWeights[offset] ?? 0) * coefficient
            }
            output.data[y * request.width + x] =
              (invalid && parameters.invalidPolicy === 'propagate') ||
              (horizontalWeights !== undefined && weight === 0)
                ? Number.NaN
                : horizontalWeights === undefined
                  ? sum
                  : sum / weight
          }
        }
        return output
      } finally {
        input.release()
      }
    },
    context.tileWidth,
    context.tileHeight,
  )
}

const usableValue = (value: number | bigint, noDataValue: number | undefined): boolean => {
  if (typeof value === 'bigint') {
    return (
      noDataValue === undefined ||
      !Number.isSafeInteger(noDataValue) ||
      value !== BigInt(noDataValue)
    )
  }
  return Number.isFinite(value) && (noDataValue === undefined || value !== noDataValue)
}

const integerOutputRange = (
  data: NumericArray,
): readonly [minimum: number, maximum: number] | null => {
  if (data instanceof Uint8Array) return [0, 255]
  if (data instanceof Uint16Array) return [0, 65_535]
  if (data instanceof Uint32Array) return [0, 4_294_967_295]
  if (data instanceof Int8Array) return [-128, 127]
  if (data instanceof Int16Array) return [-32_768, 32_767]
  if (data instanceof Int32Array) return [-2_147_483_648, 2_147_483_647]
  return null
}

const projectionDataset = (
  source: ScientificDataset,
  value: OperationJsonValue,
  context: AnalysisDatasetOperationContext,
): ScientificDataset => {
  const parameters = projectionParameters(value, source.descriptor)
  const descriptor = inferProjectionDescriptor(source.descriptor, value)
  const reductionLength = axis(source.descriptor, parameters.reductionAxis).length
  const targetType = numericSampleType(descriptor.sampleType)
  return operationDataset(
    descriptor,
    async (request) => {
      if (
        request.displayAxes[0] !== parameters.displayAxes[0] ||
        request.displayAxes[1] !== parameters.displayAxes[1]
      ) {
        throw invalidInput('Projection reads must use the operation display-axis order')
      }
      const output = packedTile(request, targetType, descriptor.components.length)
      const sampleCount = request.width * request.height * descriptor.components.length
      const counts = new Uint32Array(sampleCount)
      const invalid =
        parameters.invalidPolicy === 'propagate' ? new Uint8Array(sampleCount) : undefined
      const numericAccumulator =
        output.data instanceof BigUint64Array ? undefined : new Float64Array(sampleCount)
      if (numericAccumulator !== undefined)
        numericAccumulator.fill(
          parameters.mode === 'min'
            ? Number.POSITIVE_INFINITY
            : parameters.mode === 'max'
              ? Number.NEGATIVE_INFINITY
              : 0,
        )
      for (let reductionIndex = 0; reductionIndex < reductionLength; reductionIndex += 1) {
        throwIfAborted(request.signal)
        const tile = await context.readSourceTile(
          source,
          {
            ...request,
            fixedIndices: Object.freeze([
              ...parameters.fixedIndices,
              Object.freeze({ axisId: parameters.reductionAxis, index: reductionIndex }),
            ]),
          },
          parameters.outputSampleType === 'preserve' ? undefined : 'float64',
        )
        try {
          for (let y = 0; y < request.height; y += 1) {
            for (let x = 0; x < request.width; x += 1) {
              for (let component = 0; component < tile.componentCount; component += 1) {
                const index = (y * request.width + x) * tile.componentCount + component
                const sample = numericValue(tile, x, y, component)
                if (!usableValue(sample, source.descriptor.noDataValue)) {
                  if (invalid !== undefined) invalid[index] = 1
                  continue
                }
                if (output.data instanceof BigUint64Array) {
                  if (typeof sample !== 'bigint')
                    throw invalidInput('Projection changed uint64 semantics')
                  if (
                    counts[index] === 0 ||
                    (parameters.mode === 'min'
                      ? sample < (output.data[index] ?? 0n)
                      : sample > (output.data[index] ?? 0n))
                  )
                    output.data[index] = sample
                } else {
                  if (typeof sample !== 'number')
                    throw invalidInput('Projection requires exact numeric samples')
                  const previous = numericAccumulator?.[index] ?? 0
                  if (numericAccumulator === undefined) {
                    throw invalidInput('Projection numeric accumulator is unavailable')
                  }
                  if (parameters.mode === 'mean') numericAccumulator[index] = previous + sample
                  else if (parameters.mode === 'min') {
                    numericAccumulator[index] = Math.min(previous, sample)
                  } else numericAccumulator[index] = Math.max(previous, sample)
                }
                counts[index] = (counts[index] ?? 0) + 1
              }
            }
          }
        } finally {
          tile.release()
        }
      }
      for (let index = 0; index < sampleCount; index += 1) {
        if (invalid?.[index] === 1 || counts[index] === 0) {
          const missing = descriptor.noDataValue
          if (output.data instanceof BigUint64Array) {
            if (missing === undefined || !Number.isSafeInteger(missing) || missing < 0) {
              throw invalidInput(
                'Integer projection needs an exactly representable noDataValue for empty output',
              )
            }
            output.data[index] = BigInt(missing)
          } else {
            const range = integerOutputRange(output.data)
            if (range !== null) {
              if (
                missing === undefined ||
                !Number.isSafeInteger(missing) ||
                missing < range[0] ||
                missing > range[1]
              ) {
                throw invalidInput(
                  'Integer projection needs an exactly representable noDataValue for empty output',
                )
              }
              output.data[index] = missing
            } else output.data[index] = missing ?? Number.NaN
          }
          continue
        }
        if (output.data instanceof BigUint64Array) continue
        const accumulated = numericAccumulator?.[index] ?? Number.NaN
        output.data[index] =
          parameters.mode === 'mean' ? accumulated / (counts[index] ?? 1) : accumulated
      }
      return output
    },
    context.tileWidth,
    context.tileHeight,
  )
}

const ownedDataset = (dataset: ScientificDataset): readonly OperationOwnedOutput[] =>
  Object.freeze([Object.freeze({ value: dataset, release() {} })])

const costEstimate = (
  request: Readonly<OperationProviderRequest>,
  context: AnalysisDatasetOperationContext,
): OperationCostEstimate => {
  let retainedBytes = 0
  let computeMilliseconds = 0
  try {
    if (request.inputCharacteristics !== undefined) {
      const inputs = request.inputCharacteristics.inputs
      if (Array.isArray(inputs)) {
        const descriptor = datasetDescriptorFromCharacteristics(inputs[0])
        if (request.descriptor.id === analysisGaussianBlurOperationId) {
          const parameters = gaussianBlurParameters(request.parameters, descriptor)
          const width = Math.min(
            axis(descriptor, parameters.displayAxes[0]).length,
            context.tileWidth,
          )
          const height = Math.min(
            axis(descriptor, parameters.displayAxes[1]).length,
            context.tileHeight,
          )
          const expandedHeight = height + parameters.radius * 2
          const haloWidth = width + parameters.radius * 2
          retainedBytes =
            haloWidth * expandedHeight * descriptor.components.length * 8 +
            width * expandedHeight * (parameters.invalidPolicy === 'propagate' ? 9 : 16) +
            width * height * 4
          computeMilliseconds =
            (width * expandedHeight * (parameters.radius * 2 + 1) * 2) / 10_000_000
        } else {
          const first = descriptor.axes[0]?.length ?? 1
          const second = descriptor.axes[1]?.length ?? 1
          const pixels = Math.min(first, context.tileWidth) * Math.min(second, context.tileHeight)
          const bytesPerValue =
            request.descriptor.id === analysisProjectionOperationId
              ? 20
              : request.descriptor.id === analysisThresholdOperationId
                ? rasterSampleBytes(descriptor.sampleType) + 1
                : 16
          retainedBytes = Math.min(
            Number.MAX_SAFE_INTEGER,
            pixels * descriptor.components.length * bytesPerValue,
          )
        }
      }
    }
  } catch {
    retainedBytes = 0
  }
  return Object.freeze({
    setupMilliseconds: 0,
    transferMilliseconds: 0,
    computeMilliseconds,
    readbackMilliseconds: 0,
    retainedBytes,
    confidence: retainedBytes === 0 ? 0 : 0.5,
  })
}

export const createAnalysisDatasetOperationImplementations = (
  context: AnalysisDatasetOperationContext,
): readonly OperationImplementation[] =>
  Object.freeze(
    analysisDatasetOperationDefinitions.map((definition) =>
      Object.freeze({
        descriptor: Object.freeze({
          operationId: definition.descriptor.id,
          operationVersion: definition.descriptor.version,
          implementationVersion: '1.0.0',
          ...(definition.descriptor.reproducibility.class === 'bit-exact'
            ? { bitExactConformance: true }
            : {}),
        }),
        supports(request: Readonly<OperationProviderRequest>): boolean {
          try {
            const input = request.inputs.find(isScientificDataset)
            const descriptor =
              input?.descriptor ??
              (request.inputCharacteristics === undefined ||
              !Array.isArray(request.inputCharacteristics.inputs)
                ? undefined
                : datasetDescriptorFromCharacteristics(request.inputCharacteristics.inputs[0]))
            if (descriptor === undefined || definition.inferOutputShapes === undefined) return false
            const inferred = definition.inferOutputShapes({
              parameters: request.parameters,
              inputs: Object.freeze([scientificDatasetCharacteristics(descriptor)]),
            })
            return inferred.valid && inferred.value !== undefined
          } catch {
            return false
          }
        },
        estimate: (request: Readonly<OperationProviderRequest>) => costEstimate(request, context),
        async execute(
          request: Readonly<OperationProviderRequest>,
        ): Promise<readonly OperationOwnedOutput[]> {
          request.signal.throwIfAborted()
          const source = datasetInput(request)
          if (definition.descriptor.id === analysisCropOperationId)
            return ownedDataset(cropDataset(source, request.parameters, context))
          if (definition.descriptor.id === analysisResampleOperationId)
            return ownedDataset(resampleDataset(source, request.parameters, context))
          if (definition.descriptor.id === analysisSliceOperationId)
            return ownedDataset(sliceDataset(source, request.parameters, context))
          if (definition.descriptor.id === analysisProjectionOperationId)
            return ownedDataset(projectionDataset(source, request.parameters, context))
          if (definition.descriptor.id === analysisThresholdOperationId)
            return ownedDataset(thresholdDataset(source, request.parameters, context))
          if (definition.descriptor.id === analysisGaussianBlurOperationId)
            return ownedDataset(gaussianBlurDataset(source, request.parameters, context))
          throw invalidInput(`Unknown analysis dataset operation ${definition.descriptor.id}`)
        },
      }),
    ),
  )
