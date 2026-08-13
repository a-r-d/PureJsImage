import { invalidInput } from '../errors.ts'
import type {
  OperationDescriptor,
  OperationJsonObject,
  OperationJsonValue,
  OperationValidationLimits,
  OperationValidationResult,
  ParameterSchema,
} from '../operations/descriptor.ts'
import type {
  OperationExecutionRequest,
  OperationCostEstimate,
  OperationImplementation,
  OperationOwnedOutput,
  OperationPlanningRequest,
} from '../operations/provider.ts'
import type { OperationDefinition } from '../operations/registry.ts'
import { createOperationDefinition } from '../operations/registry.ts'
import type {
  NormalizedScientificDatasetDescriptor,
  ScientificAxisIndex,
  ScientificDataset,
} from '../scientific/dataset.ts'
import { normalizeScientificDatasetDescriptor } from '../scientific/dataset.ts'
import type { NumericTile } from '../scientific/numeric-tile.ts'
import { numericTileSampleOffset } from '../scientific/numeric-tile.ts'
import type { AnalysisDatasetOperationContext } from './builtin-dataset-operations.ts'
import {
  scientificDatasetCharacteristics,
  scientificDatasetValueTypeId,
} from './builtin-dataset-operations.ts'
import type {
  HistogramResult,
  ProfileResult,
  ResultCollection,
  ResultCollectionEntry,
  ScalarResult,
} from './result.ts'
import {
  histogramResultValueTypeId,
  profileResultValueTypeId,
  resultCollectionValueTypeId,
  scalarResultValueTypeId,
  validateHistogramResult,
  validateProfileResult,
  validateResultCollection,
  validateScalarResult,
} from './result.ts'
import type { Roi } from './roi.ts'
import { normalizeRoi, normalizeRoiSet, roiSetValueTypeId, roiValueTypeId } from './roi.ts'
import { createRoiLineSamplingPlan, createRoiMask } from './roi-sampling.ts'

export const analysisStatisticsOperationId = 'purejsimage.analysis.statistics'
export const analysisHistogramOperationId = 'purejsimage.analysis.histogram'
export const analysisLineProfileOperationId = 'purejsimage.analysis.line-profile'

type ParameterRecord = Readonly<Record<string, OperationJsonValue>>

const isJsonObject = (value: OperationJsonValue): value is OperationJsonObject =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

const parameterRecord = (value: OperationJsonValue): ParameterRecord => {
  if (!isJsonObject(value)) throw invalidInput('Analysis result parameters must be an object')
  return value
}

const stringParameter = (value: ParameterRecord, name: string): string => {
  const entry = value[name]
  if (typeof entry !== 'string') throw invalidInput(`${name} must be a string`)
  return entry
}

const numberParameter = (value: ParameterRecord, name: string): number => {
  const entry = value[name]
  if (typeof entry !== 'number' || !Number.isFinite(entry))
    throw invalidInput(`${name} must be finite`)
  return entry
}

const optionalNumber = (value: ParameterRecord, name: string): number | undefined => {
  const entry = value[name]
  if (entry === undefined) return undefined
  if (typeof entry !== 'number' || !Number.isFinite(entry))
    throw invalidInput(`${name} must be finite`)
  return entry
}

const displayAxesParameter = (
  value: ParameterRecord,
): readonly [horizontal: string, vertical: string] => {
  const entry = value.displayAxes
  if (!Array.isArray(entry) || entry.length !== 2)
    throw invalidInput('displayAxes requires two ids')
  const horizontal = entry[0]
  const vertical = entry[1]
  if (
    typeof horizontal !== 'string' ||
    typeof vertical !== 'string' ||
    horizontal.trim().length === 0 ||
    vertical.trim().length === 0 ||
    horizontal === vertical
  ) {
    throw invalidInput('displayAxes requires two distinct axis ids')
  }
  return Object.freeze([horizontal, vertical])
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

const integerArrayParameter = (value: ParameterRecord, name: string): readonly number[] => {
  const entry = value[name]
  if (!Array.isArray(entry)) throw invalidInput(`${name} must be an integer array`)
  const result: number[] = []
  const seen = new Set<number>()
  for (const item of entry) {
    if (typeof item !== 'number' || !Number.isSafeInteger(item) || item < 0 || seen.has(item)) {
      throw invalidInput(`${name} contains an invalid or duplicate index`)
    }
    seen.add(item)
    result.push(item)
  }
  return Object.freeze(result)
}

const numberArrayParameter = (value: ParameterRecord, name: string): readonly number[] => {
  const entry = value[name]
  if (!Array.isArray(entry)) throw invalidInput(`${name} must be a numeric array`)
  const result: number[] = []
  for (const item of entry) {
    if (typeof item !== 'number' || !Number.isFinite(item))
      throw invalidInput(`${name} contains a non-finite value`)
    result.push(item)
  }
  return Object.freeze(result)
}

const axisIdSchema = Object.freeze({
  type: 'string',
  minLength: 1,
  maxLength: 4_096,
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
    properties: Object.freeze({
      axisId: axisIdSchema,
      index: Object.freeze({ type: 'integer', minimum: 0 }),
    }),
    required: Object.freeze(['axisId', 'index']),
    closed: true,
  }),
  maxItems: 64,
}) satisfies ParameterSchema
const componentSchema = Object.freeze({
  type: 'integer',
  minimum: 0,
  default: 0,
}) satisfies ParameterSchema

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

const datasetPort = Object.freeze({
  name: 'dataset',
  valueType: Object.freeze({ id: scientificDatasetValueTypeId, version: 1 }),
})
const optionalRoiPort = Object.freeze({
  name: 'roi',
  valueType: Object.freeze({ id: roiValueTypeId, version: 1 }),
  optional: true,
})
const optionalRoiSetPort = Object.freeze({
  name: 'roiSet',
  valueType: Object.freeze({ id: roiSetValueTypeId, version: 1 }),
  optional: true,
})

const invalidResult = (error: unknown): OperationValidationResult<never> =>
  Object.freeze({
    valid: false,
    issues: Object.freeze([
      Object.freeze({
        code: 'invalid-value' as const,
        path: '',
        message: error instanceof Error ? error.message : 'Analysis result operation is invalid',
      }),
    ]),
  })

const resultDefinition = (
  options: Readonly<{
    id: string
    title: string
    outputId: string
    outputName: string
    parameters: ParameterSchema
    roiInputs: 'optional' | 'line'
    reproducibility: OperationDescriptor['reproducibility']
    validate(value: OperationJsonValue): void
    infer(
      value: OperationJsonValue,
      descriptor: NormalizedScientificDatasetDescriptor,
    ): OperationJsonObject
  }>,
): OperationDefinition => {
  const inputs =
    options.roiInputs === 'line'
      ? Object.freeze([{ ...datasetPort }, { ...optionalRoiPort, optional: false }])
      : Object.freeze([datasetPort, optionalRoiPort, optionalRoiSetPort])
  const base = createOperationDefinition({
    descriptor: {
      id: options.id,
      version: 1,
      title: options.title,
      category: 'scientific-analysis',
      tags: ['scientific', 'result', 'roi'],
      inputs,
      outputs: [{ name: options.outputName, valueType: { id: options.outputId, version: 1 } }],
      parameters: options.parameters,
      execution: 'reduction',
      reproducibility: options.reproducibility,
      builtIn: true,
    },
    inferOutputShapes(request) {
      try {
        const descriptor = descriptorFromCharacteristics(request.inputs[0])
        return Object.freeze({
          valid: true,
          issues: Object.freeze([]),
          value: Object.freeze([options.infer(request.parameters, descriptor)]),
        })
      } catch (error) {
        return invalidResult(error)
      }
    },
  })
  return Object.freeze({
    ...base,
    normalizeParameters(
      value: unknown,
      limits: Readonly<OperationValidationLimits> = {},
    ): OperationValidationResult<OperationJsonValue> {
      const result = base.normalizeParameters(value, limits)
      if (result.value === undefined) return result
      try {
        options.validate(result.value)
        return result
      } catch (error) {
        return invalidResult(error)
      }
    },
  })
}

interface PlaneParameters {
  readonly displayAxes: readonly [string, string]
  readonly fixedIndices: readonly ScientificAxisIndex[]
  readonly component: number
}

interface StatisticsParameters extends PlaneParameters {
  readonly percentiles: readonly number[]
  readonly percentileMaxSamples: number
  readonly emptyPolicy: 'nan' | 'error'
}

const planeParameters = (value: ParameterRecord): PlaneParameters => {
  const component = numberParameter(value, 'component')
  if (!Number.isSafeInteger(component) || component < 0)
    throw invalidInput('component must be non-negative')
  return Object.freeze({
    displayAxes: displayAxesParameter(value),
    fixedIndices: fixedIndicesParameter(value),
    component,
  })
}

const statisticsParameters = (input: OperationJsonValue): StatisticsParameters => {
  const value = parameterRecord(input)
  const common = planeParameters(value)
  const percentiles = numberArrayParameter(value, 'percentiles')
  if (percentiles.some((entry) => entry < 0 || entry > 100))
    throw invalidInput('Percentiles must be between 0 and 100')
  const percentileMaxSamples = numberParameter(value, 'percentileMaxSamples')
  if (!Number.isSafeInteger(percentileMaxSamples) || percentileMaxSamples < 2) {
    throw invalidInput('percentileMaxSamples must be at least two')
  }
  const emptyPolicy = stringParameter(value, 'emptyPolicy')
  if (emptyPolicy !== 'nan' && emptyPolicy !== 'error')
    throw invalidInput('Unsupported empty selection policy')
  return Object.freeze({ ...common, percentiles, percentileMaxSamples, emptyPolicy })
}

interface HistogramParameters extends PlaneParameters {
  readonly bins: number
  readonly minimum?: number
  readonly maximum?: number
}

const histogramParameters = (input: OperationJsonValue): HistogramParameters => {
  const value = parameterRecord(input)
  const common = planeParameters(value)
  const bins = numberParameter(value, 'bins')
  if (!Number.isSafeInteger(bins) || bins < 1 || bins > 1_000_000)
    throw invalidInput('Histogram bins are invalid')
  const minimum = optionalNumber(value, 'minimum')
  const maximum = optionalNumber(value, 'maximum')
  if ((minimum === undefined) !== (maximum === undefined))
    throw invalidInput('Histogram range requires both minimum and maximum')
  if (minimum !== undefined && maximum !== undefined && !(minimum < maximum))
    throw invalidInput('Histogram minimum must be less than maximum')
  return Object.freeze({
    ...common,
    bins,
    ...(minimum === undefined || maximum === undefined ? {} : { minimum, maximum }),
  })
}

interface LineProfileParameters extends PlaneParameters {
  readonly components: readonly number[]
  readonly interpolation: 'nearest' | 'bilinear'
  readonly spacing: number
  readonly spacingSpace: 'pixel' | 'physical'
  readonly maxSamples: number
  readonly outside: 'nan' | 'error'
  readonly invalidPolicy: 'nan' | 'error'
}

const lineProfileParameters = (input: OperationJsonValue): LineProfileParameters => {
  const value = parameterRecord(input)
  const common = planeParameters(value)
  const components = integerArrayParameter(value, 'components')
  if (components.length === 0) throw invalidInput('Line profile requires at least one component')
  const interpolation = stringParameter(value, 'interpolation')
  if (interpolation !== 'nearest' && interpolation !== 'bilinear')
    throw invalidInput('Unsupported line interpolation')
  const spacingSpace = stringParameter(value, 'spacingSpace')
  if (spacingSpace !== 'pixel' && spacingSpace !== 'physical')
    throw invalidInput('Unsupported spacing space')
  const outside = stringParameter(value, 'outside')
  if (outside !== 'nan' && outside !== 'error') throw invalidInput('Unsupported outside policy')
  const invalidPolicy = stringParameter(value, 'invalidPolicy')
  if (invalidPolicy !== 'nan' && invalidPolicy !== 'error')
    throw invalidInput('Unsupported line-profile invalid policy')
  const spacing = numberParameter(value, 'spacing')
  const maxSamples = numberParameter(value, 'maxSamples')
  if (!(spacing > 0) || !Number.isSafeInteger(maxSamples) || maxSamples < 2)
    throw invalidInput('Line sampling limits are invalid')
  return Object.freeze({
    ...common,
    components,
    interpolation,
    spacing,
    spacingSpace,
    maxSamples,
    outside,
    invalidPolicy,
  })
}

const descriptorFromCharacteristics = (
  value: OperationJsonValue | undefined,
): NormalizedScientificDatasetDescriptor => {
  if (value === undefined || !isJsonObject(value) || value.kind !== 'scientific-dataset') {
    throw invalidInput('Scientific dataset characteristics are unavailable')
  }
  return normalizeScientificDatasetDescriptor(value.descriptor)
}

const axisLength = (descriptor: NormalizedScientificDatasetDescriptor, id: string): number => {
  const value = descriptor.axes.find((entry) => entry.id === id)
  if (value === undefined) throw invalidInput(`Unknown scientific axis ${id}`)
  return value.length
}

const validatePlane = (
  descriptor: NormalizedScientificDatasetDescriptor,
  parameters: PlaneParameters,
): void => {
  axisLength(descriptor, parameters.displayAxes[0])
  axisLength(descriptor, parameters.displayAxes[1])
  if (parameters.component >= descriptor.components.length)
    throw invalidInput('Selected component is unavailable')
  const selected = new Set(parameters.displayAxes)
  for (const entry of parameters.fixedIndices) {
    if (selected.has(entry.axisId) || entry.index >= axisLength(descriptor, entry.axisId)) {
      throw invalidInput(`Invalid fixed index for ${entry.axisId}`)
    }
    selected.add(entry.axisId)
  }
  if (selected.size !== descriptor.axes.length)
    throw invalidInput('Every non-display axis needs a fixed index')
}

const planeShape = (
  descriptor: NormalizedScientificDatasetDescriptor,
  parameters: PlaneParameters,
): OperationJsonObject => {
  validatePlane(descriptor, parameters)
  return Object.freeze({
    width: axisLength(descriptor, parameters.displayAxes[0]),
    height: axisLength(descriptor, parameters.displayAxes[1]),
    componentCount: descriptor.components.length,
    selectedComponent: parameters.component,
    sampleType: descriptor.sampleType,
  })
}

const planeSchema = {
  displayAxes: displayAxesSchema,
  fixedIndices: fixedIndicesSchema,
  component: componentSchema,
}

export const analysisResultOperationDefinitions: readonly OperationDefinition[] = Object.freeze([
  resultDefinition({
    id: analysisStatisticsOperationId,
    title: 'Scientific ROI statistics',
    outputId: resultCollectionValueTypeId,
    outputName: 'statistics',
    roiInputs: 'optional',
    reproducibility: { class: 'tolerance-based', absolute: 1e-12, relative: 1e-12 },
    parameters: objectSchema(
      {
        ...planeSchema,
        percentiles: Object.freeze({
          type: 'array',
          items: Object.freeze({ type: 'number', minimum: 0, maximum: 100, finiteOnly: true }),
          maxItems: 128,
          default: Object.freeze([]),
        }),
        percentileMaxSamples: Object.freeze({
          type: 'integer',
          minimum: 2,
          maximum: 1_000_000,
          default: 65_536,
        }),
        emptyPolicy: Object.freeze({ type: 'enum', values: ['nan', 'error'], default: 'nan' }),
      },
      ['displayAxes', 'fixedIndices'],
    ),
    validate: (value) => {
      statisticsParameters(value)
    },
    infer(value, descriptor) {
      const parameters = statisticsParameters(value)
      return Object.freeze({
        kind: 'analysis-result',
        valueType: resultCollectionValueTypeId,
        plane: planeShape(descriptor, parameters),
        percentileCount: parameters.percentiles.length,
      })
    },
  }),
  resultDefinition({
    id: analysisHistogramOperationId,
    title: 'Scientific ROI histogram',
    outputId: histogramResultValueTypeId,
    outputName: 'histogram',
    roiInputs: 'optional',
    reproducibility: { class: 'tolerance-based', absolute: 1e-12, relative: 1e-12 },
    parameters: objectSchema(
      {
        ...planeSchema,
        bins: Object.freeze({ type: 'integer', minimum: 1, maximum: 1_000_000 }),
        minimum: Object.freeze({ type: 'number', finiteOnly: true }),
        maximum: Object.freeze({ type: 'number', finiteOnly: true }),
      },
      ['displayAxes', 'fixedIndices', 'bins'],
    ),
    validate: (value) => {
      histogramParameters(value)
    },
    infer(value, descriptor) {
      const parameters = histogramParameters(value)
      return Object.freeze({
        kind: 'analysis-result',
        valueType: histogramResultValueTypeId,
        plane: planeShape(descriptor, parameters),
        bins: parameters.bins,
        passes: parameters.minimum === undefined ? 2 : 1,
      })
    },
  }),
  resultDefinition({
    id: analysisLineProfileOperationId,
    title: 'Calibrated scientific line profile',
    outputId: profileResultValueTypeId,
    outputName: 'profile',
    roiInputs: 'line',
    reproducibility: { class: 'tolerance-based', absolute: 1e-12, relative: 1e-12 },
    parameters: objectSchema(
      {
        ...planeSchema,
        components: Object.freeze({
          type: 'array',
          items: Object.freeze({ type: 'integer', minimum: 0 }),
          minItems: 1,
          maxItems: 64,
          default: Object.freeze([0]),
        }),
        interpolation: Object.freeze({
          type: 'enum',
          values: ['nearest', 'bilinear'],
          default: 'nearest',
        }),
        spacing: Object.freeze({
          type: 'number',
          minimum: 0,
          exclusiveMinimum: true,
          finiteOnly: true,
          default: 1,
        }),
        spacingSpace: Object.freeze({
          type: 'enum',
          values: ['pixel', 'physical'],
          default: 'pixel',
        }),
        maxSamples: Object.freeze({
          type: 'integer',
          minimum: 2,
          maximum: 1_000_000,
          default: 65_536,
        }),
        outside: Object.freeze({ type: 'enum', values: ['nan', 'error'], default: 'nan' }),
        invalidPolicy: Object.freeze({ type: 'enum', values: ['nan', 'error'], default: 'nan' }),
      },
      ['displayAxes', 'fixedIndices'],
    ),
    validate: (value) => {
      lineProfileParameters(value)
    },
    infer(value, descriptor) {
      const parameters = lineProfileParameters(value)
      const shape = planeShape(descriptor, parameters)
      for (const component of parameters.components) {
        if (component >= descriptor.components.length)
          throw invalidInput('Line profile component is unavailable')
      }
      return Object.freeze({
        kind: 'analysis-result',
        valueType: profileResultValueTypeId,
        plane: shape,
        maximumPoints: parameters.maxSamples,
        series: parameters.components.length,
      })
    },
  }),
])

const isScientificDataset = (value: unknown): value is ScientificDataset =>
  value !== null &&
  typeof value === 'object' &&
  'descriptor' in value &&
  'readPlane' in value &&
  typeof value.readPlane === 'function'

const datasetInput = (request: Readonly<OperationExecutionRequest>): ScientificDataset => {
  const value = request.inputs.find(isScientificDataset)
  if (value === undefined)
    throw invalidInput('Analysis result operation requires a ScientificDataset')
  return value
}

const isRoiLike = (
  value: unknown,
): value is Readonly<{ readonly schemaVersion: unknown; readonly geometry: unknown }> =>
  value !== null && typeof value === 'object' && 'schemaVersion' in value && 'geometry' in value

const isRoiSetLike = (
  value: unknown,
): value is Readonly<{ readonly schemaVersion: unknown; readonly rois: unknown }> =>
  value !== null && typeof value === 'object' && 'schemaVersion' in value && 'rois' in value

const roiSelection = (
  request: Readonly<OperationExecutionRequest>,
  descriptor: NormalizedScientificDatasetDescriptor,
): readonly Roi[] => {
  const rois: Roi[] = []
  for (const value of request.inputs) {
    if (isRoiLike(value)) rois.push(normalizeRoi(value, descriptor))
    else if (isRoiSetLike(value)) rois.push(...normalizeRoiSet(value, descriptor).rois)
  }
  return Object.freeze(rois)
}

const sameFixedIndices = (
  left: readonly ScientificAxisIndex[],
  right: readonly ScientificAxisIndex[],
): boolean =>
  left.length === right.length &&
  left.every((entry) =>
    right.some((candidate) => candidate.axisId === entry.axisId && candidate.index === entry.index),
  )

const validateRoiPlane = (rois: readonly Roi[], parameters: PlaneParameters): void => {
  for (const roi of rois) {
    if (
      roi.axisIds[0] !== parameters.displayAxes[0] ||
      roi.axisIds[1] !== parameters.displayAxes[1]
    ) {
      throw invalidInput(`ROI ${roi.id} axis order does not match the selected plane`)
    }
    if (!sameFixedIndices(roi.fixedIndices, parameters.fixedIndices)) {
      throw invalidInput(`ROI ${roi.id} fixed indices do not match the selected plane`)
    }
  }
}

const tileMask = (
  rois: readonly Roi[],
  descriptor: NormalizedScientificDatasetDescriptor,
  tile: NumericTile,
  planeWidth: number,
  planeHeight: number,
  signal: AbortSignal,
): Uint8Array | undefined => {
  if (rois.length === 0) return undefined
  const union = new Uint8Array(tile.width * tile.height)
  for (const roi of rois) {
    const mask = createRoiMask(roi, descriptor, {
      plane: { width: planeWidth, height: planeHeight },
      tile: { x: tile.x, y: tile.y, width: tile.width, height: tile.height },
      maxMaskPixels: tile.width * tile.height,
      signal,
    })
    for (let index = 0; index < union.length; index += 1) {
      union[index] = (union[index] ?? 0) | (mask.data[index] ?? 0)
    }
  }
  return union
}

const numberSample = (tile: NumericTile, x: number, y: number, component: number): number => {
  const value = tile.data[numericTileSampleOffset(tile, x, y, component)]
  if (typeof value === 'bigint') {
    if (value > BigInt(Number.MAX_SAFE_INTEGER))
      throw invalidInput('uint64 sample exceeds exact numerical analysis range')
    return Number(value)
  }
  return value ?? Number.NaN
}

interface ScanState {
  count: number
  finiteCount: number
  invalidCount: number
  minimum: number
  maximum: number
  mean: number
  sumSquaredDifferences: number
  readonly samples?: Float64Array
  sampledValues: number
}

const newScanState = (sampleLimit?: number): ScanState => ({
  count: 0,
  finiteCount: 0,
  invalidCount: 0,
  minimum: Number.POSITIVE_INFINITY,
  maximum: Number.NEGATIVE_INFINITY,
  mean: 0,
  sumSquaredDifferences: 0,
  ...(sampleLimit === undefined ? {} : { samples: new Float64Array(sampleLimit) }),
  sampledValues: 0,
})

const scanPlane = async (
  dataset: ScientificDataset,
  parameters: PlaneParameters,
  rois: readonly Roi[],
  context: AnalysisDatasetOperationContext,
  signal: AbortSignal,
  percentileMaxSamples?: number,
  visit?: (value: number) => void,
): Promise<ScanState> => {
  validatePlane(dataset.descriptor, parameters)
  validateRoiPlane(rois, parameters)
  const width = axisLength(dataset.descriptor, parameters.displayAxes[0])
  const height = axisLength(dataset.descriptor, parameters.displayAxes[1])
  const columnsPerTile = Math.min(width, context.tileWidth)
  const rowsPerTile = Math.max(
    1,
    Math.min(
      height,
      context.tileHeight,
      Math.floor(context.runtime.limits.maxTilePixels / columnsPerTile),
    ),
  )
  const state = newScanState(percentileMaxSamples)
  for (let y = 0; y < height; y += rowsPerTile) {
    for (let x = 0; x < width; x += columnsPerTile) {
      signal.throwIfAborted()
      const tile = await context.readSourceTile(dataset, {
        displayAxes: parameters.displayAxes,
        fixedIndices: parameters.fixedIndices,
        x,
        y,
        width: Math.min(columnsPerTile, width - x),
        height: Math.min(rowsPerTile, height - y),
        signal,
      })
      try {
        const mask = tileMask(rois, dataset.descriptor, tile, width, height, signal)
        for (let localY = 0; localY < tile.height; localY += 1) {
          signal.throwIfAborted()
          for (let localX = 0; localX < tile.width; localX += 1) {
            const maskIndex = localY * tile.width + localX
            if (mask !== undefined && mask[maskIndex] === 0) continue
            state.count += 1
            const value = numberSample(tile, localX, localY, parameters.component)
            const noData = dataset.descriptor.noDataValue
            if (!Number.isFinite(value) || (noData !== undefined && value === noData)) {
              state.invalidCount += 1
              continue
            }
            visit?.(value)
            state.finiteCount += 1
            state.minimum = Math.min(state.minimum, value)
            state.maximum = Math.max(state.maximum, value)
            const delta = value - state.mean
            state.mean += delta / state.finiteCount
            state.sumSquaredDifferences += delta * (value - state.mean)
            if (state.samples !== undefined) {
              if (state.sampledValues < state.samples.length) {
                state.samples[state.sampledValues] = value
                state.sampledValues += 1
              } else {
                const ordinal = state.finiteCount
                const candidate = ((Math.imul(ordinal, 2_654_435_761) >>> 0) % ordinal) >>> 0
                if (candidate < state.samples.length) state.samples[candidate] = value
              }
            }
          }
        }
      } finally {
        tile.release()
      }
    }
  }
  return state
}

const scalar = (value: number, unit?: string): ScalarResult =>
  validateScalarResult({
    kind: 'scalar',
    valueType: scalarResultValueTypeId,
    value,
    nanPolicy: Number.isNaN(value) ? 'allow' : 'forbid',
    ...(unit === undefined ? {} : { unit }),
  })

const statisticsResult = async (
  request: Readonly<OperationExecutionRequest>,
  context: AnalysisDatasetOperationContext,
): Promise<ResultCollection> => {
  const dataset = datasetInput(request)
  const parameters = statisticsParameters(request.parameters)
  const rois = roiSelection(request, dataset.descriptor)
  const state = await scanPlane(
    dataset,
    parameters,
    rois,
    context,
    request.signal,
    parameters.percentiles.length === 0 ? undefined : parameters.percentileMaxSamples,
  )
  if (state.finiteCount === 0 && parameters.emptyPolicy === 'error')
    throw invalidInput('Statistics selection contains no finite samples')
  const unit = dataset.descriptor.components[parameters.component]?.unit
  const empty = state.finiteCount === 0
  const entries: ResultCollectionEntry[] = [
    Object.freeze({ name: 'count', result: scalar(state.count) }),
    Object.freeze({ name: 'finiteCount', result: scalar(state.finiteCount) }),
    Object.freeze({ name: 'invalidCount', result: scalar(state.invalidCount) }),
    Object.freeze({ name: 'minimum', result: scalar(empty ? Number.NaN : state.minimum, unit) }),
    Object.freeze({ name: 'maximum', result: scalar(empty ? Number.NaN : state.maximum, unit) }),
    Object.freeze({ name: 'mean', result: scalar(empty ? Number.NaN : state.mean, unit) }),
    Object.freeze({
      name: 'populationStandardDeviation',
      result: scalar(
        empty ? Number.NaN : Math.sqrt(state.sumSquaredDifferences / state.finiteCount),
        unit,
      ),
    }),
  ]
  if (parameters.percentiles.length > 0) {
    const sorted = state.samples?.subarray(0, state.sampledValues) ?? new Float64Array()
    sorted.sort()
    const axisValues = new Float64Array(parameters.percentiles)
    const values = new Float64Array(parameters.percentiles.length)
    for (let index = 0; index < parameters.percentiles.length; index += 1) {
      const percentile = parameters.percentiles[index] ?? Number.NaN
      const sampleIndex =
        sorted.length === 0
          ? -1
          : Math.max(
              0,
              Math.min(sorted.length - 1, Math.round((percentile / 100) * (sorted.length - 1))),
            )
      values[index] = sampleIndex < 0 ? Number.NaN : (sorted[sampleIndex] ?? Number.NaN)
    }
    entries.push(
      Object.freeze({
        name: 'percentiles',
        result: validateProfileResult({
          kind: 'profile',
          valueType: profileResultValueTypeId,
          axis: { name: 'percentile', values: axisValues, unit: '%', nanPolicy: 'forbid' },
          series: [
            {
              name: 'value',
              values,
              nanPolicy: empty ? 'allow' : 'forbid',
              ...(unit === undefined ? {} : { unit }),
            },
          ],
          metadata: {
            approximation: 'deterministic-row-major-reservoir',
            sampledValues: state.sampledValues,
            maximumSamples: parameters.percentileMaxSamples,
          },
        }),
      }),
    )
  }
  return validateResultCollection({
    kind: 'collection',
    valueType: resultCollectionValueTypeId,
    results: entries,
    metadata: { reductionOrder: 'global-row-major', roiCount: rois.length },
  })
}

const histogramResult = async (
  request: Readonly<OperationExecutionRequest>,
  context: AnalysisDatasetOperationContext,
): Promise<HistogramResult> => {
  const dataset = datasetInput(request)
  const parameters = histogramParameters(request.parameters)
  const rois = roiSelection(request, dataset.descriptor)
  let minimum = parameters.minimum
  let maximum = parameters.maximum
  if (minimum === undefined || maximum === undefined) {
    const range = await scanPlane(dataset, parameters, rois, context, request.signal)
    if (range.finiteCount === 0) throw invalidInput('Automatic histogram range is empty')
    minimum = range.minimum
    maximum = range.maximum
    if (minimum === maximum) {
      minimum -= 0.5
      maximum += 0.5
    }
  }
  const edges = new Float64Array(parameters.bins + 1)
  const counts = new Float64Array(parameters.bins)
  const width = (maximum - minimum) / parameters.bins
  for (let index = 0; index <= parameters.bins; index += 1)
    edges[index] = index === parameters.bins ? maximum : minimum + width * index
  let underflow = 0
  let overflow = 0
  await scanPlane(dataset, parameters, rois, context, request.signal, undefined, (value) => {
    if (value < minimum) underflow += 1
    else if (value > maximum) overflow += 1
    else {
      const bin = value === maximum ? parameters.bins - 1 : Math.floor((value - minimum) / width)
      counts[bin] = (counts[bin] ?? 0) + 1
    }
  })
  return validateHistogramResult({
    kind: 'histogram',
    valueType: histogramResultValueTypeId,
    binEdges: edges,
    counts,
    underflow,
    overflow,
    ...(dataset.descriptor.components[parameters.component]?.unit === undefined
      ? {}
      : { unit: dataset.descriptor.components[parameters.component]?.unit }),
    metadata: {
      rangeMode: parameters.minimum === undefined ? 'automatic-two-pass' : 'explicit-one-pass',
      reductionOrder: 'global-row-major',
    },
  })
}

const lineRoi = (
  request: Readonly<OperationExecutionRequest>,
  descriptor: NormalizedScientificDatasetDescriptor,
): Roi => {
  const values = request.inputs.filter(isRoiLike)
  if (values.length !== 1) throw invalidInput('Line profile requires exactly one ROI')
  const roi = normalizeRoi(values[0], descriptor)
  if (roi.geometry.kind !== 'line-segment' && roi.geometry.kind !== 'polyline') {
    throw invalidInput('Line profile ROI must be a line or polyline')
  }
  return roi
}

const lineProfileResult = async (
  request: Readonly<OperationExecutionRequest>,
  context: AnalysisDatasetOperationContext,
): Promise<ProfileResult> => {
  const dataset = datasetInput(request)
  const parameters = lineProfileParameters(request.parameters)
  validatePlane(dataset.descriptor, parameters)
  const roi = lineRoi(request, dataset.descriptor)
  validateRoiPlane([roi], parameters)
  for (const component of parameters.components) {
    if (component >= dataset.descriptor.components.length)
      throw invalidInput('Line profile component is unavailable')
  }
  const plan = createRoiLineSamplingPlan(roi, dataset.descriptor, {
    spacing: parameters.spacing,
    spacingSpace: parameters.spacingSpace,
    interpolation: parameters.interpolation,
    maxSamples: parameters.maxSamples,
    signal: request.signal,
  })
  const width = axisLength(dataset.descriptor, parameters.displayAxes[0])
  const height = axisLength(dataset.descriptor, parameters.displayAxes[1])
  const seriesValues = parameters.components.map(() => new Float64Array(plan.sampleCount))
  const invalidSamples = parameters.components.map(() => new Uint8Array(plan.sampleCount))
  interface TileGroup {
    readonly x: number
    readonly y: number
    readonly width: number
    readonly height: number
    readonly contributions: number[]
  }
  const groups = new Map<string, TileGroup>()
  const addContribution = (sample: number, x: number, y: number, weight: number): void => {
    const tileX = Math.floor(x / context.tileWidth) * context.tileWidth
    const tileY = Math.floor(y / context.tileHeight) * context.tileHeight
    const key = `${tileX},${tileY}`
    let group = groups.get(key)
    if (group === undefined) {
      group = {
        x: tileX,
        y: tileY,
        width: Math.min(context.tileWidth, width - tileX),
        height: Math.min(context.tileHeight, height - tileY),
        contributions: [],
      }
      groups.set(key, group)
    }
    group.contributions.push(sample, x, y, weight)
  }
  for (let sample = 0; sample < plan.sampleCount; sample += 1) {
    request.signal.throwIfAborted()
    const offset = sample * (plan.sampling.interpolation === 'nearest' ? 2 : 4)
    const x0 = plan.sampling.indices[offset] ?? 0
    const y0 = plan.sampling.indices[offset + 1] ?? 0
    const x1 =
      plan.sampling.interpolation === 'nearest' ? x0 : (plan.sampling.indices[offset + 2] ?? 0)
    const y1 =
      plan.sampling.interpolation === 'nearest' ? y0 : (plan.sampling.indices[offset + 3] ?? 0)
    const outside = x0 < 0 || y0 < 0 || x1 >= width || y1 >= height
    if (outside) {
      if (parameters.outside === 'error')
        throw invalidInput('Line profile sample is outside the plane')
      for (const values of seriesValues) values[sample] = Number.NaN
      continue
    }
    if (plan.sampling.interpolation === 'nearest') {
      addContribution(sample, x0, y0, 1)
    } else {
      addContribution(sample, x0, y0, plan.sampling.weights[offset] ?? 0)
      addContribution(sample, x1, y0, plan.sampling.weights[offset + 1] ?? 0)
      addContribution(sample, x0, y1, plan.sampling.weights[offset + 2] ?? 0)
      addContribution(sample, x1, y1, plan.sampling.weights[offset + 3] ?? 0)
    }
  }
  for (const group of groups.values()) {
    request.signal.throwIfAborted()
    const tile = await context.readSourceTile(
      dataset,
      {
        displayAxes: parameters.displayAxes,
        fixedIndices: parameters.fixedIndices,
        x: group.x,
        y: group.y,
        width: group.width,
        height: group.height,
        signal: request.signal,
      },
      'float64',
    )
    try {
      for (let index = 0; index < group.contributions.length; index += 4) {
        const sample = group.contributions[index] ?? 0
        const x = group.contributions[index + 1] ?? 0
        const y = group.contributions[index + 2] ?? 0
        const weight = group.contributions[index + 3] ?? 0
        for (let series = 0; series < parameters.components.length; series += 1) {
          const component = parameters.components[series] ?? 0
          const value = numberSample(tile, x - group.x, y - group.y, component)
          const values = seriesValues[series]
          const invalid = invalidSamples[series]
          if (values === undefined || invalid === undefined) {
            throw invalidInput('Line profile series is unavailable')
          }
          if (
            !Number.isFinite(value) ||
            (dataset.descriptor.noDataValue !== undefined &&
              value === dataset.descriptor.noDataValue)
          ) {
            invalid[sample] = 1
          } else {
            values[sample] = (values[sample] ?? 0) + value * weight
          }
        }
      }
    } finally {
      tile.release()
    }
  }
  for (let series = 0; series < seriesValues.length; series += 1) {
    const values = seriesValues[series]
    const invalid = invalidSamples[series]
    if (values === undefined || invalid === undefined)
      throw invalidInput('Line profile series is unavailable')
    for (let sample = 0; sample < plan.sampleCount; sample += 1) {
      if (invalid[sample] !== 1) continue
      if (parameters.invalidPolicy === 'error')
        throw invalidInput('Line profile encountered an invalid or no-data sample')
      values[sample] = Number.NaN
    }
  }
  return validateProfileResult({
    kind: 'profile',
    valueType: profileResultValueTypeId,
    axis: {
      name: 'distance',
      values: plan.distances,
      ...(plan.distanceUnit === null ? {} : { unit: plan.distanceUnit }),
      nanPolicy: 'forbid',
    },
    series: parameters.components.map((component, index) => {
      const values = seriesValues[index] ?? new Float64Array()
      return Object.freeze({
        name:
          dataset.descriptor.components[component]?.name ??
          dataset.descriptor.components[component]?.id ??
          `component-${component}`,
        values,
        ...(dataset.descriptor.components[component]?.unit === undefined
          ? {}
          : { unit: dataset.descriptor.components[component]?.unit }),
        nanPolicy: values.some((value) => Number.isNaN(value))
          ? ('allow' as const)
          : ('forbid' as const),
      })
    }),
    metadata: {
      interpolation: parameters.interpolation,
      spacingSpace: parameters.spacingSpace,
      roiId: roi.id,
    },
  })
}

const ownedResult = (
  value: ResultCollection | HistogramResult | ProfileResult,
): readonly OperationOwnedOutput[] => Object.freeze([Object.freeze({ value, release() {} })])

const estimate = (request: Readonly<OperationPlanningRequest>): OperationCostEstimate => {
  let retainedBytes = 0
  let peakWorkingBytes = 0
  let outputBytes = 0
  try {
    if (request.inputCharacteristics.length > 0) {
      if (request.descriptor.id === analysisStatisticsOperationId) {
        const statistics = statisticsParameters(request.parameters)
        outputBytes = (7 + statistics.percentiles.length * 2) * 8
        peakWorkingBytes =
          outputBytes +
          (statistics.percentiles.length > 0 ? statistics.percentileMaxSamples * 8 : 0)
      } else if (request.descriptor.id === analysisHistogramOperationId) {
        const histogram = histogramParameters(request.parameters)
        outputBytes = (histogram.bins * 2 + 1) * 8
        peakWorkingBytes = outputBytes
      } else if (request.descriptor.id === analysisLineProfileOperationId) {
        const profile = lineProfileParameters(request.parameters)
        outputBytes = profile.maxSamples * (profile.components.length + 1) * 8
        const samplingBytesPerSample =
          8 +
          16 +
          16 +
          (profile.interpolation === 'nearest' ? 16 + 32 : 32 + 32 + 128) +
          profile.components.length
        peakWorkingBytes = outputBytes + profile.maxSamples * samplingBytesPerSample
      }
      retainedBytes = outputBytes
    }
  } catch {
    retainedBytes = 0
    peakWorkingBytes = 0
    outputBytes = 0
  }
  return Object.freeze({
    setupMilliseconds: 0,
    transferMilliseconds: 0,
    computeMilliseconds: 0,
    readbackMilliseconds: 0,
    retainedBytes,
    peakWorkingBytes,
    transferBytes: 0,
    outputBytes,
    confidence: retainedBytes === 0 ? 0 : 0.5,
  })
}

export const createAnalysisResultOperationImplementations = (
  context: AnalysisDatasetOperationContext,
): readonly OperationImplementation[] =>
  Object.freeze(
    analysisResultOperationDefinitions.map((definition) =>
      Object.freeze({
        descriptor: Object.freeze({
          operationId: definition.descriptor.id,
          operationVersion: definition.descriptor.version,
          implementationVersion: '1.0.0',
          ...(definition.descriptor.reproducibility.class === 'bit-exact'
            ? { bitExactConformance: true }
            : {}),
        }),
        supportsPlan(request: Readonly<OperationPlanningRequest>): boolean {
          try {
            const descriptor = descriptorFromCharacteristics(request.inputCharacteristics[0])
            if (definition.inferOutputShapes === undefined) return false
            return definition.inferOutputShapes({
              parameters: request.parameters,
              inputs: [scientificDatasetCharacteristics(descriptor)],
            }).valid
          } catch {
            return false
          }
        },
        estimatePlan: estimate,
        validateExecution(request: Readonly<OperationExecutionRequest>): void {
          datasetInput(request)
        },
        async execute(
          request: Readonly<OperationExecutionRequest>,
        ): Promise<readonly OperationOwnedOutput[]> {
          request.signal.throwIfAborted()
          const estimated = estimate({
            descriptor: request.descriptor,
            parameters: request.parameters,
            inputCharacteristics: request.plannedInputCharacteristics,
            signal: request.signal,
          })
          const releaseWorking = context.runtime.reserveOperationWorkingBytes(
            estimated.peakWorkingBytes,
          )
          try {
            if (definition.descriptor.id === analysisStatisticsOperationId)
              return ownedResult(await statisticsResult(request, context))
            if (definition.descriptor.id === analysisHistogramOperationId)
              return ownedResult(await histogramResult(request, context))
            if (definition.descriptor.id === analysisLineProfileOperationId)
              return ownedResult(await lineProfileResult(request, context))
            throw invalidInput(`Unknown analysis result operation ${definition.descriptor.id}`)
          } finally {
            releaseWorking()
          }
        },
      }),
    ),
  )
