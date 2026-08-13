import { limitExceeded, invalidInput } from '../errors.ts'
import type {
  OperationJsonObject,
  OperationJsonValue,
  OperationValidationLimits,
  OperationValidationResult,
  ParameterSchema,
} from '../operations/descriptor.ts'
import type {
  OperationCostEstimate,
  OperationExecutionRequest,
  OperationImplementation,
  OperationOwnedOutput,
  OperationPlanningRequest,
} from '../operations/provider.ts'
import { createOperationDefinition, type OperationDefinition } from '../operations/registry.ts'
import type {
  NormalizedScientificDatasetDescriptor,
  ScientificAxisDescriptor,
  ScientificAxisIndex,
  ScientificDataset,
} from '../scientific/dataset.ts'
import {
  normalizeScientificDatasetDescriptor,
  normalizeScientificPlaneReadRequest,
} from '../scientific/dataset.ts'
import type { NumericTile } from '../scientific/numeric-tile.ts'
import { numericTileSampleOffset } from '../scientific/numeric-tile.ts'
import {
  accountAnalysisResultMemory,
  tableResultValueTypeId,
  validateTableResult,
  type TableResult,
} from './result.ts'
import {
  type AnalysisDatasetOperationContext,
  scientificDatasetCharacteristics,
  scientificDatasetValueTypeId,
} from './builtin-dataset-operations.ts'
import { roiAxisPixelToPhysical } from './roi.ts'

export const analysisConnectedComponentsOperationId = 'purejsimage.analysis.connected-components'

interface ConnectedComponentsParameters {
  readonly displayAxes: readonly [string, string]
  readonly fixedIndices: readonly ScientificAxisIndex[]
  readonly component: number
  readonly connectivity: 4 | 8
}

type ParameterRecord = Readonly<Record<string, OperationJsonValue>>

const record = (value: OperationJsonValue): ParameterRecord => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw invalidInput('Connected-components parameters must be an object')
  }
  return value as OperationJsonObject
}

const parameters = (value: OperationJsonValue): ConnectedComponentsParameters => {
  const input = record(value)
  const axes = input.displayAxes
  if (
    !Array.isArray(axes) ||
    axes.length !== 2 ||
    typeof axes[0] !== 'string' ||
    typeof axes[1] !== 'string' ||
    axes[0].length === 0 ||
    axes[1].length === 0 ||
    axes[0] === axes[1]
  ) {
    throw invalidInput('displayAxes must contain two distinct axis ids')
  }
  if (!Array.isArray(input.fixedIndices)) throw invalidInput('fixedIndices must be an array')
  const fixedIndices: ScientificAxisIndex[] = []
  const seen = new Set<string>()
  for (const entry of input.fixedIndices) {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      throw invalidInput('fixedIndices entries must be objects')
    }
    const axisId = 'axisId' in entry ? entry.axisId : undefined
    const index = 'index' in entry ? entry.index : undefined
    if (
      typeof axisId !== 'string' ||
      axisId.length === 0 ||
      typeof index !== 'number' ||
      !Number.isSafeInteger(index) ||
      index < 0 ||
      seen.has(axisId)
    ) {
      throw invalidInput('fixedIndices contains an invalid or duplicate entry')
    }
    seen.add(axisId)
    fixedIndices.push(Object.freeze({ axisId, index }))
  }
  fixedIndices.sort((left, right) => left.axisId.localeCompare(right.axisId))
  const component = input.component
  if (typeof component !== 'number' || !Number.isSafeInteger(component) || component < 0) {
    throw invalidInput('component must be a non-negative safe integer')
  }
  const connectivity = input.connectivity
  if (connectivity !== 4 && connectivity !== 8) {
    throw invalidInput('connectivity must be 4 or 8')
  }
  return Object.freeze({
    displayAxes: Object.freeze([axes[0], axes[1]] as const),
    fixedIndices: Object.freeze(fixedIndices),
    component,
    connectivity,
  })
}

const axisSchema = Object.freeze({
  type: 'string',
  minLength: 1,
  maxLength: 4_096,
}) satisfies ParameterSchema
const schema = Object.freeze({
  type: 'object',
  properties: Object.freeze({
    displayAxes: Object.freeze({
      type: 'array',
      items: axisSchema,
      minItems: 2,
      maxItems: 2,
    }),
    fixedIndices: Object.freeze({
      type: 'array',
      items: Object.freeze({
        type: 'object',
        properties: Object.freeze({
          axisId: axisSchema,
          index: Object.freeze({ type: 'integer', minimum: 0 }),
        }),
        required: Object.freeze(['axisId', 'index']),
        closed: true,
      }),
      maxItems: 64,
    }),
    component: Object.freeze({ type: 'integer', minimum: 0, default: 0 }),
    connectivity: Object.freeze({ type: 'enum', values: Object.freeze([4, 8]), default: 8 }),
  }),
  required: Object.freeze(['displayAxes', 'fixedIndices']),
  closed: true,
}) satisfies ParameterSchema

const descriptorFromCharacteristics = (
  value: OperationJsonValue | undefined,
): NormalizedScientificDatasetDescriptor => {
  if (
    value === undefined ||
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    !('kind' in value) ||
    value.kind !== 'scientific-dataset' ||
    !('descriptor' in value)
  ) {
    throw invalidInput('Scientific dataset characteristics are unavailable')
  }
  return normalizeScientificDatasetDescriptor(value.descriptor)
}

const validatedPlane = (
  descriptor: NormalizedScientificDatasetDescriptor,
  selection: ConnectedComponentsParameters,
) => {
  if (descriptor.levels.length !== 1 || descriptor.levels[0]?.level !== 0) {
    throw invalidInput('Connected components requires a selected single-resolution dataset')
  }
  if (selection.component >= descriptor.components.length) {
    throw invalidInput('Connected-components component is unavailable')
  }
  return normalizeScientificPlaneReadRequest(descriptor, {
    displayAxes: selection.displayAxes,
    fixedIndices: selection.fixedIndices,
    resolutionLevel: 0,
  })
}

const labelsDescriptor = (
  source: NormalizedScientificDatasetDescriptor,
  selection: ConnectedComponentsParameters,
): NormalizedScientificDatasetDescriptor => {
  const plane = validatedPlane(source, selection)
  const axes = selection.displayAxes.map((id) => {
    const found = source.axes.find((axis) => axis.id === id)
    if (found === undefined) throw invalidInput(`Unknown scientific axis ${id}`)
    return found
  })
  return normalizeScientificDatasetDescriptor({
    schemaVersion: 1,
    axes,
    sampleType: 'uint32',
    components: [{ id: 'label', name: 'Object label', kind: 'scalar' }],
    noDataValue: 0,
    metadata: {
      semanticKind: 'connected-components',
      operation: analysisConnectedComponentsOperationId,
      connectivity: selection.connectivity,
      foregroundPolicy: 'nonzero-v1',
      sourceAxes: plane.displayAxes,
      sourceFixedIndices: plane.fixedIndices,
    },
    capabilities: {
      regionReads: true,
      resolutionLevels: false,
      planeReads: { kind: 'ordered-axis-pairs', pairs: [selection.displayAxes] },
    },
  })
}

const invalidResult = (error: unknown): OperationValidationResult<never> =>
  Object.freeze({
    valid: false,
    issues: Object.freeze([
      Object.freeze({
        code: 'invalid-value' as const,
        path: '',
        message: error instanceof Error ? error.message : 'Connected components is invalid',
      }),
    ]),
  })

const baseDefinition = createOperationDefinition({
  descriptor: {
    id: analysisConnectedComponentsOperationId,
    version: 1,
    title: 'Connected components and object measurements',
    description:
      'Deterministic row-major tiled nonzero connected components with lazy labels and a bounded object table.',
    category: 'scientific-analysis',
    tags: ['scientific', 'segmentation', 'measurement'],
    inputs: [{ name: 'dataset', valueType: { id: scientificDatasetValueTypeId, version: 1 } }],
    outputs: [
      { name: 'labels', valueType: { id: scientificDatasetValueTypeId, version: 1 } },
      { name: 'objects', valueType: { id: tableResultValueTypeId, version: 1 } },
    ],
    parameters: schema,
    execution: 'global-transform',
    reproducibility: { class: 'tolerance-based', absolute: 1e-12, relative: 1e-12 },
    builtIn: true,
  },
  inferOutputShapes(request) {
    try {
      const source = descriptorFromCharacteristics(request.inputs[0])
      const selection = parameters(request.parameters)
      const labels = labelsDescriptor(source, selection)
      const plane = validatedPlane(source, selection)
      return Object.freeze({
        valid: true,
        issues: Object.freeze([]),
        value: Object.freeze([
          scientificDatasetCharacteristics(labels),
          Object.freeze({
            kind: 'analysis-result',
            valueType: tableResultValueTypeId,
            semanticKind: 'connected-components',
            maximumRows: checkedProduct(
              plane.width,
              plane.height,
              'Connected-components maximum rows',
            ),
          }),
        ]),
      })
    } catch (error) {
      return invalidResult(error)
    }
  },
})

export const analysisConnectedComponentsOperationDefinition: OperationDefinition = Object.freeze({
  ...baseDefinition,
  normalizeParameters(
    value: unknown,
    limits: Readonly<OperationValidationLimits> = {},
  ): OperationValidationResult<OperationJsonValue> {
    const result = baseDefinition.normalizeParameters(value, limits)
    if (result.value === undefined) return result
    try {
      parameters(result.value)
      return result
    } catch (error) {
      return invalidResult(error)
    }
  },
})

const isDataset = (value: unknown): value is ScientificDataset =>
  value !== null &&
  typeof value === 'object' &&
  'descriptor' in value &&
  'readPlane' in value &&
  typeof value.readPlane === 'function'

const datasetInput = (request: Readonly<OperationExecutionRequest>): ScientificDataset => {
  const dataset = request.inputs.find(isDataset)
  if (dataset === undefined) throw invalidInput('Connected components requires a ScientificDataset')
  return dataset
}

interface LocalLabels {
  readonly labels: Uint32Array
  readonly labelCount: number
}

const localFind = (parents: Uint32Array, label: number): number => {
  let root = label
  while ((parents[root] ?? root) !== root) root = parents[root] ?? root
  let current = label
  while (current !== root) {
    const next = parents[current] ?? root
    parents[current] = root
    current = next
  }
  return root
}

const localUnion = (parents: Uint32Array, left: number, right: number): number => {
  const leftRoot = localFind(parents, left)
  const rightRoot = localFind(parents, right)
  if (leftRoot === rightRoot) return leftRoot
  const root = Math.min(leftRoot, rightRoot)
  parents[Math.max(leftRoot, rightRoot)] = root
  return root
}

const foreground = (
  tile: NumericTile,
  x: number,
  y: number,
  component: number,
  noDataValue: number | undefined,
): boolean => {
  const sample = tile.data[numericTileSampleOffset(tile, x, y, component)]
  if (typeof sample === 'bigint') return sample !== 0n
  if (sample === undefined || !Number.isFinite(sample)) return false
  if (noDataValue !== undefined && sample === noDataValue) return false
  return sample !== 0
}

const labelLocalTile = (
  tile: NumericTile,
  component: number,
  connectivity: 4 | 8,
  noDataValue: number | undefined,
  signal: AbortSignal,
): LocalLabels => {
  const pixels = checkedProduct(tile.width, tile.height, 'Connected-components local tile')
  const labels = new Uint32Array(pixels)
  const parents = new Uint32Array(
    checkedSum([pixels, 1], 'Connected-components local parent entries'),
  )
  let labelCount = 0
  for (let y = 0; y < tile.height; y += 1) {
    signal.throwIfAborted()
    for (let x = 0; x < tile.width; x += 1) {
      const index = y * tile.width + x
      if (!foreground(tile, x, y, component, noDataValue)) continue
      let selected = 0
      const left = x > 0 ? (labels[index - 1] ?? 0) : 0
      const top = y > 0 ? (labels[index - tile.width] ?? 0) : 0
      if (left !== 0) selected = left
      if (top !== 0) selected = selected === 0 ? top : localUnion(parents, selected, top)
      if (connectivity === 8 && y > 0) {
        const topLeft = x > 0 ? (labels[index - tile.width - 1] ?? 0) : 0
        const topRight = x + 1 < tile.width ? (labels[index - tile.width + 1] ?? 0) : 0
        if (topLeft !== 0) {
          selected = selected === 0 ? topLeft : localUnion(parents, selected, topLeft)
        }
        if (topRight !== 0) {
          selected = selected === 0 ? topRight : localUnion(parents, selected, topRight)
        }
      }
      if (selected === 0) {
        labelCount += 1
        selected = labelCount
        parents[selected] = selected
      }
      labels[index] = selected
    }
  }
  for (let index = 0; index < labels.length; index += 1) {
    const label = labels[index] ?? 0
    if (label !== 0) labels[index] = localFind(parents, label)
  }
  return Object.freeze({ labels, labelCount })
}

interface ComponentArrays {
  readonly parent: Uint32Array
  readonly firstPixel: Float64Array
  readonly count: Float64Array
  readonly sumX: Float64Array
  readonly sumY: Float64Array
  readonly sumXX: Float64Array
  readonly sumYY: Float64Array
  readonly sumXY: Float64Array
  readonly minX: Uint32Array
  readonly minY: Uint32Array
  readonly maxX: Uint32Array
  readonly maxY: Uint32Array
}

const componentArrays = (capacity: number): ComponentArrays => {
  const length = checkedSum([capacity, 1], 'Connected-components state entries')
  return {
    parent: new Uint32Array(length),
    firstPixel: new Float64Array(length),
    count: new Float64Array(length),
    sumX: new Float64Array(length),
    sumY: new Float64Array(length),
    sumXX: new Float64Array(length),
    sumYY: new Float64Array(length),
    sumXY: new Float64Array(length),
    minX: new Uint32Array(length),
    minY: new Uint32Array(length),
    maxX: new Uint32Array(length),
    maxY: new Uint32Array(length),
  }
}

const componentFind = (state: ComponentArrays, label: number): number => {
  let root = label
  while ((state.parent[root] ?? root) !== root) root = state.parent[root] ?? root
  let current = label
  while (current !== root) {
    const next = state.parent[current] ?? root
    state.parent[current] = root
    current = next
  }
  return root
}

const mergeComponent = (state: ComponentArrays, target: number, source: number): void => {
  state.count[target] = (state.count[target] ?? 0) + (state.count[source] ?? 0)
  state.sumX[target] = (state.sumX[target] ?? 0) + (state.sumX[source] ?? 0)
  state.sumY[target] = (state.sumY[target] ?? 0) + (state.sumY[source] ?? 0)
  state.sumXX[target] = (state.sumXX[target] ?? 0) + (state.sumXX[source] ?? 0)
  state.sumYY[target] = (state.sumYY[target] ?? 0) + (state.sumYY[source] ?? 0)
  state.sumXY[target] = (state.sumXY[target] ?? 0) + (state.sumXY[source] ?? 0)
  state.firstPixel[target] = Math.min(
    state.firstPixel[target] ?? Number.POSITIVE_INFINITY,
    state.firstPixel[source] ?? Number.POSITIVE_INFINITY,
  )
  state.minX[target] = Math.min(state.minX[target] ?? 0, state.minX[source] ?? 0)
  state.minY[target] = Math.min(state.minY[target] ?? 0, state.minY[source] ?? 0)
  state.maxX[target] = Math.max(state.maxX[target] ?? 0, state.maxX[source] ?? 0)
  state.maxY[target] = Math.max(state.maxY[target] ?? 0, state.maxY[source] ?? 0)
}

const unionComponent = (state: ComponentArrays, left: number, right: number): number => {
  if (left === 0) return componentFind(state, right)
  if (right === 0) return componentFind(state, left)
  const leftRoot = componentFind(state, left)
  const rightRoot = componentFind(state, right)
  if (leftRoot === rightRoot) return leftRoot
  const root = Math.min(leftRoot, rightRoot)
  const child = Math.max(leftRoot, rightRoot)
  state.parent[child] = root
  mergeComponent(state, root, child)
  return root
}

const addPixel = (state: ComponentArrays, label: number, x: number, y: number): void => {
  const root = componentFind(state, label)
  state.count[root] = (state.count[root] ?? 0) + 1
  state.sumX[root] = (state.sumX[root] ?? 0) + x
  state.sumY[root] = (state.sumY[root] ?? 0) + y
  state.sumXX[root] = (state.sumXX[root] ?? 0) + x * x
  state.sumYY[root] = (state.sumYY[root] ?? 0) + y * y
  state.sumXY[root] = (state.sumXY[root] ?? 0) + x * y
  state.minX[root] = Math.min(state.minX[root] ?? x, x)
  state.minY[root] = Math.min(state.minY[root] ?? y, y)
  state.maxX[root] = Math.max(state.maxX[root] ?? x, x)
  state.maxY[root] = Math.max(state.maxY[root] ?? y, y)
}

interface Calibration {
  readonly unit: string
  readonly horizontal: ScientificAxisDescriptor
  readonly vertical: ScientificAxisDescriptor
  readonly stepX: number
  readonly stepY: number
}

const calibration = (
  descriptor: NormalizedScientificDatasetDescriptor,
  selection: ConnectedComponentsParameters,
): Calibration | undefined => {
  const horizontal = descriptor.axes.find((axis) => axis.id === selection.displayAxes[0])
  const vertical = descriptor.axes.find((axis) => axis.id === selection.displayAxes[1])
  if (
    horizontal?.coordinates.type !== 'linear' ||
    vertical?.coordinates.type !== 'linear' ||
    horizontal.unit === undefined ||
    horizontal.unit !== vertical.unit
  ) {
    return undefined
  }
  return Object.freeze({
    unit: horizontal.unit,
    horizontal,
    vertical,
    stepX: horizontal.coordinates.step,
    stepY: vertical.coordinates.step,
  })
}

const ellipse = (
  xx: number,
  yy: number,
  xy: number,
): readonly [major: number, minor: number, aspect: number, orientation: number] => {
  const trace = xx + yy
  const difference = xx - yy
  const radius = Math.sqrt(Math.max(0, difference * difference + 4 * xy * xy))
  const major = 4 * Math.sqrt(Math.max(0, (trace + radius) * 0.5))
  const minor = 4 * Math.sqrt(Math.max(0, (trace - radius) * 0.5))
  return Object.freeze([
    major,
    minor,
    minor === 0 ? Number.NaN : major / minor,
    0.5 * Math.atan2(2 * xy, difference),
  ])
}

const numericColumn = (name: string, values: Float64Array | Uint32Array, unit?: string) =>
  Object.freeze({
    kind: 'numeric' as const,
    name,
    values,
    ...(unit === undefined ? {} : { unit }),
    nanPolicy:
      values instanceof Float64Array && values.some(Number.isNaN)
        ? ('allow' as const)
        : ('forbid' as const),
  })

const objectTable = (
  roots: Uint32Array,
  state: ComponentArrays,
  descriptor: NormalizedScientificDatasetDescriptor,
  selection: ConnectedComponentsParameters,
): TableResult => {
  const count = roots.length
  const label = new Uint32Array(count)
  const pixelCount = new Float64Array(count)
  const pixelArea = new Float64Array(count)
  const minX = new Float64Array(count)
  const minY = new Float64Array(count)
  const width = new Float64Array(count)
  const height = new Float64Array(count)
  const centroidX = new Float64Array(count)
  const centroidY = new Float64Array(count)
  const diameter = new Float64Array(count)
  const major = new Float64Array(count)
  const minor = new Float64Array(count)
  const aspect = new Float64Array(count)
  const orientation = new Float64Array(count)
  const physical = calibration(descriptor, selection)
  const physicalArea = physical === undefined ? undefined : new Float64Array(count)
  const physicalCentroidX = physical === undefined ? undefined : new Float64Array(count)
  const physicalCentroidY = physical === undefined ? undefined : new Float64Array(count)
  const physicalDiameter = physical === undefined ? undefined : new Float64Array(count)
  const physicalMajor = physical === undefined ? undefined : new Float64Array(count)
  const physicalMinor = physical === undefined ? undefined : new Float64Array(count)
  const physicalAspect = physical === undefined ? undefined : new Float64Array(count)
  const physicalOrientation = physical === undefined ? undefined : new Float64Array(count)
  for (let row = 0; row < count; row += 1) {
    const root = roots[row] ?? 0
    const samples = state.count[root] ?? 0
    const meanX = (state.sumX[root] ?? 0) / samples
    const meanY = (state.sumY[root] ?? 0) / samples
    const xx = Math.max(0, (state.sumXX[root] ?? 0) / samples - meanX * meanX)
    const yy = Math.max(0, (state.sumYY[root] ?? 0) / samples - meanY * meanY)
    const xy = (state.sumXY[root] ?? 0) / samples - meanX * meanY
    const shape = ellipse(xx, yy, xy)
    label[row] = row + 1
    pixelCount[row] = samples
    pixelArea[row] = samples
    minX[row] = state.minX[root] ?? 0
    minY[row] = state.minY[root] ?? 0
    width[row] = (state.maxX[root] ?? 0) - (state.minX[root] ?? 0) + 1
    height[row] = (state.maxY[root] ?? 0) - (state.minY[root] ?? 0) + 1
    centroidX[row] = meanX + 0.5
    centroidY[row] = meanY + 0.5
    diameter[row] = 2 * Math.sqrt(samples / Math.PI)
    major[row] = shape[0]
    minor[row] = shape[1]
    aspect[row] = shape[2]
    orientation[row] = shape[3]
    if (
      physical !== undefined &&
      physicalArea !== undefined &&
      physicalCentroidX !== undefined &&
      physicalCentroidY !== undefined &&
      physicalDiameter !== undefined &&
      physicalMajor !== undefined &&
      physicalMinor !== undefined &&
      physicalAspect !== undefined &&
      physicalOrientation !== undefined
    ) {
      const area = samples * Math.abs(physical.stepX * physical.stepY)
      const physicalShape = ellipse(
        xx * physical.stepX * physical.stepX,
        yy * physical.stepY * physical.stepY,
        xy * physical.stepX * physical.stepY,
      )
      physicalArea[row] = area
      physicalCentroidX[row] = roiAxisPixelToPhysical(physical.horizontal, meanX + 0.5)
      physicalCentroidY[row] = roiAxisPixelToPhysical(physical.vertical, meanY + 0.5)
      physicalDiameter[row] = 2 * Math.sqrt(area / Math.PI)
      physicalMajor[row] = physicalShape[0]
      physicalMinor[row] = physicalShape[1]
      physicalAspect[row] = physicalShape[2]
      physicalOrientation[row] = physicalShape[3]
    }
  }
  const columns = [
    numericColumn('label', label),
    numericColumn('pixelCount', pixelCount, 'pixel'),
    numericColumn('pixelArea', pixelArea, 'pixel²'),
    numericColumn('boundingBoxX', minX, 'pixel'),
    numericColumn('boundingBoxY', minY, 'pixel'),
    numericColumn('boundingBoxWidth', width, 'pixel'),
    numericColumn('boundingBoxHeight', height, 'pixel'),
    numericColumn('centroidX', centroidX, 'pixel'),
    numericColumn('centroidY', centroidY, 'pixel'),
    numericColumn('equivalentCircularDiameter', diameter, 'pixel'),
    numericColumn('majorAxisLength', major, 'pixel'),
    numericColumn('minorAxisLength', minor, 'pixel'),
    numericColumn('aspectRatio', aspect),
    numericColumn('orientationRadians', orientation, 'rad'),
  ]
  if (
    physical !== undefined &&
    physicalArea !== undefined &&
    physicalCentroidX !== undefined &&
    physicalCentroidY !== undefined &&
    physicalDiameter !== undefined &&
    physicalMajor !== undefined &&
    physicalMinor !== undefined &&
    physicalAspect !== undefined &&
    physicalOrientation !== undefined
  ) {
    columns.push(
      numericColumn('physicalArea', physicalArea, `${physical.unit}²`),
      numericColumn('physicalCentroidX', physicalCentroidX, physical.unit),
      numericColumn('physicalCentroidY', physicalCentroidY, physical.unit),
      numericColumn('physicalEquivalentCircularDiameter', physicalDiameter, physical.unit),
      numericColumn('physicalMajorAxisLength', physicalMajor, physical.unit),
      numericColumn('physicalMinorAxisLength', physicalMinor, physical.unit),
      numericColumn('physicalAspectRatio', physicalAspect),
      numericColumn('physicalOrientationRadians', physicalOrientation, 'rad'),
    )
  }
  return validateTableResult({
    kind: 'table',
    valueType: tableResultValueTypeId,
    rowCount: count,
    columns,
    metadata: {
      semanticKind: 'connected-components',
      objectCount: count,
      connectivity: selection.connectivity,
      foregroundPolicy: 'nonzero-v1',
      displayAxes: selection.displayAxes,
      fixedIndices: selection.fixedIndices,
      measurementSpace:
        physical === undefined
          ? { pixel: true, physical: false, reason: 'missing-or-incompatible-linear-calibration' }
          : { pixel: true, physical: true, unit: physical.unit },
      formulas: {
        sampling: 'pixel-center',
        equivalentCircularDiameter: '2*sqrt(area/pi)',
        momentAxisLength: '4*sqrt(moment-eigenvalue)',
      },
    },
    provenance: { id: analysisConnectedComponentsOperationId, version: 1 },
  })
}

interface PreparedComponents {
  readonly table: TableResult
  readonly tileOffsets: Uint32Array
  readonly finalMapping: Uint32Array
  readonly tilesAcross: number
  readonly labelsDescriptor: NormalizedScientificDatasetDescriptor
}

interface PreparedLabelMapping {
  readonly tileOffsets: Uint32Array
  readonly finalMapping: Uint32Array
  readonly tilesAcross: number
}

const checkedProduct = (left: number, right: number, label: string): number => {
  if (!Number.isSafeInteger(left) || !Number.isSafeInteger(right) || left < 0 || right < 0) {
    throw limitExceeded(`${label} has invalid factors`)
  }
  const value = left * right
  if (!Number.isSafeInteger(value)) throw limitExceeded(`${label} exceeds safe integer limits`)
  return value
}

const checkedSum = (values: readonly number[], label: string): number => {
  let total = 0
  for (const value of values) {
    if (!Number.isSafeInteger(value) || value < 0 || !Number.isSafeInteger(total + value)) {
      throw limitExceeded(`${label} exceeds safe integer limits`)
    }
    total += value
  }
  return total
}

/** Internal inspection seam for exact lazy-label memory regression tests; not a package export. */
export const inspectConnectedComponentsLabelScratchBytes = (
  width: number,
  height: number,
): number =>
  checkedSum(
    [
      checkedProduct(
        checkedProduct(width, height, 'Connected-components lazy-label tile'),
        8,
        'Connected-components lazy-label arrays',
      ),
      4,
    ],
    'Connected-components lazy-label scratch',
  )

export interface ConnectedComponentsMemoryPlan {
  readonly width: number
  readonly height: number
  readonly tileWidth: number
  readonly tileHeight: number
  readonly tilesAcross: number
  readonly tilesDown: number
  readonly tileCount: number
  readonly tilePixels: number
  readonly capacity: number
  readonly scanPeakBytes: number
  readonly finalizationPeakBytes: number
  readonly peakWorkingBytes: number
  readonly maximumRetainedBytes: number
  readonly tableBytesPerObject: number
  readonly tableStructuralBytes: number
}

const phaseCapacity = (budget: number, fixedBytes: number, bytesPerComponent: number): number =>
  budget < checkedSum([fixedBytes, bytesPerComponent], 'Connected-components minimum phase')
    ? 0
    : Math.floor((budget - fixedBytes) / bytesPerComponent)

const connectedComponentsMemoryPlan = (
  width: number,
  height: number,
  descriptor: NormalizedScientificDatasetDescriptor,
  selection: ConnectedComponentsParameters,
  context: Readonly<{ readonly tileWidth: number; readonly tileHeight: number }>,
  budget: number,
): ConnectedComponentsMemoryPlan => {
  if (!Number.isSafeInteger(budget) || budget < 1) {
    throw limitExceeded('Connected-components working-memory budget is invalid')
  }
  const tileWidth = Math.min(width, context.tileWidth)
  const tileHeight = Math.min(height, context.tileHeight)
  if (tileWidth < 1 || tileHeight < 1) {
    throw limitExceeded('Connected-components tile dimensions are invalid')
  }
  const tilesAcross = Math.ceil(width / tileWidth)
  const tilesDown = Math.ceil(height / tileHeight)
  const tileCount = checkedProduct(tilesAcross, tilesDown, 'Connected-components tile count')
  const tilePixels = checkedProduct(tileWidth, tileHeight, 'Connected-components tile storage')
  const pixels = checkedProduct(width, height, 'Connected-components plane')
  const tileEntries = checkedSum([tileCount, 1], 'Connected-components tile entries')
  const stateFixedBytes = 76
  const stateBytesPerComponent = 76
  const provisionalFixedBytes = checkedProduct(tileEntries, 4, 'Provisional tile sentinels')
  const tileOffsetBytes = checkedProduct(tileEntries, 4, 'Connected-components tile offsets')
  const rowBoundaryBytes = checkedProduct(width, 8, 'Connected-components row boundaries')
  const columnBoundaryBytes = checkedProduct(
    tileHeight,
    8,
    'Connected-components column boundaries',
  )
  const localLabelBytes = checkedSum(
    [checkedProduct(tilePixels, 8, 'Connected-components local labels'), 4],
    'Connected-components local label storage',
  )
  const scanFixedBytes = checkedSum(
    [
      stateFixedBytes,
      provisionalFixedBytes,
      tileOffsetBytes,
      rowBoundaryBytes,
      columnBoundaryBytes,
      localLabelBytes,
    ],
    'Connected-components scan fixed storage',
  )
  const scanBytesPerComponent = checkedSum(
    [stateBytesPerComponent, 4],
    'Connected-components scan component storage',
  )
  const emptyTableStructuralBytes = accountAnalysisResultMemory(
    objectTable(new Uint32Array(0), componentArrays(0), descriptor, selection),
  ).structuralBytes
  const tableStructuralBytes = checkedSum(
    [emptyTableStructuralBytes, 9],
    'Connected-components table structure',
  )
  const tableBytesPerObject = calibration(descriptor, selection) === undefined ? 108 : 172
  const finalFixedBytes = checkedSum(
    [
      stateFixedBytes,
      provisionalFixedBytes,
      tileOffsetBytes,
      rowBoundaryBytes,
      checkedProduct(tileHeight, 4, 'Connected-components retained column boundary'),
      4,
      checkedProduct(tileCount, 4, 'Connected-components final mapping sentinels'),
      tableStructuralBytes,
    ],
    'Connected-components finalization fixed storage',
  )
  const finalBytesPerComponent = checkedSum(
    [stateBytesPerComponent, 4, 4, 4, 4, tableBytesPerObject],
    'Connected-components finalization component storage',
  )
  const capacity = Math.min(
    0xffff_fffe,
    pixels,
    phaseCapacity(budget, scanFixedBytes, scanBytesPerComponent),
    phaseCapacity(budget, finalFixedBytes, finalBytesPerComponent),
  )
  if (capacity < 1) throw limitExceeded('Connected-components working-memory capacity is too small')
  const scanPeakBytes = checkedSum(
    [
      scanFixedBytes,
      checkedProduct(capacity, scanBytesPerComponent, 'Connected-components scan peak'),
    ],
    'Connected-components scan peak',
  )
  const finalizationPeakBytes = checkedSum(
    [
      finalFixedBytes,
      checkedProduct(capacity, finalBytesPerComponent, 'Connected-components finalization peak'),
    ],
    'Connected-components finalization peak',
  )
  const maximumRetainedBytes = checkedSum(
    [
      tileOffsetBytes,
      checkedProduct(
        checkedSum([capacity, tileCount], 'Connected-components retained mapping entries'),
        4,
        'Connected-components retained mapping',
      ),
      tableStructuralBytes,
      checkedProduct(capacity, tableBytesPerObject, 'Connected-components retained table'),
    ],
    'Connected-components retained outputs',
  )
  return Object.freeze({
    width,
    height,
    tileWidth,
    tileHeight,
    tilesAcross,
    tilesDown,
    tileCount,
    tilePixels,
    capacity,
    scanPeakBytes,
    finalizationPeakBytes,
    peakWorkingBytes: Math.max(scanPeakBytes, finalizationPeakBytes),
    maximumRetainedBytes,
    tableBytesPerObject,
    tableStructuralBytes,
  })
}

/** Internal inspection seam for exact memory-boundary regression tests; not a package export. */
export const inspectConnectedComponentsMemoryPlan = (
  descriptor: NormalizedScientificDatasetDescriptor,
  operationParameters: OperationJsonValue,
  tileWidth: number,
  tileHeight: number,
  budget: number,
): ConnectedComponentsMemoryPlan => {
  const selection = parameters(operationParameters)
  const plane = validatedPlane(descriptor, selection)
  return connectedComponentsMemoryPlan(
    plane.width,
    plane.height,
    descriptor,
    selection,
    { tileWidth, tileHeight },
    budget,
  )
}

const prepareComponents = async (
  source: ScientificDataset,
  selection: ConnectedComponentsParameters,
  context: AnalysisDatasetOperationContext,
  signal: AbortSignal,
  plan: Readonly<ConnectedComponentsMemoryPlan>,
): Promise<PreparedComponents> => {
  const plane = validatedPlane(source.descriptor, selection)
  const width = plane.width
  const height = plane.height
  if (width !== plan.width || height !== plan.height) {
    throw invalidInput('Connected-components execution dimensions changed after planning')
  }
  const { tileWidth, tileHeight, tilesAcross, tileCount, capacity } = plan
  const state = componentArrays(capacity)
  const provisionalMapping = new Uint32Array(
    checkedSum([capacity, tileCount, 1], 'Connected-components provisional mapping entries'),
  )
  const tileOffsets = new Uint32Array(
    checkedSum([tileCount, 1], 'Connected-components tile offset entries'),
  )
  let provisionalCount = 0
  let mappingUsed = 0
  let previousBottom = new Uint32Array(width)
  let currentBottom = new Uint32Array(width)
  let tileIndex = 0
  for (let tileY = 0; tileY < height; tileY += tileHeight) {
    const actualHeight = Math.min(tileHeight, height - tileY)
    let leftBoundary = new Uint32Array(actualHeight)
    currentBottom.fill(0)
    for (let tileX = 0; tileX < width; tileX += tileWidth) {
      signal.throwIfAborted()
      const actualWidth = Math.min(tileWidth, width - tileX)
      const previousRight = leftBoundary
      const nextRight = new Uint32Array(actualHeight)
      const tile = await context.readSourceTile(source, {
        displayAxes: selection.displayAxes,
        fixedIndices: selection.fixedIndices,
        x: tileX,
        y: tileY,
        width: actualWidth,
        height: actualHeight,
        signal,
      })
      try {
        const local = labelLocalTile(
          tile,
          selection.component,
          selection.connectivity,
          source.descriptor.noDataValue,
          signal,
        )
        const nextMappingUsed = checkedSum(
          [mappingUsed, local.labelCount, 1],
          'Connected-components provisional mapping usage',
        )
        if (nextMappingUsed > provisionalMapping.length) {
          throw limitExceeded('Connected-components provisional-label limit exceeded')
        }
        tileOffsets[tileIndex] = mappingUsed
        const localToGlobal = provisionalMapping.subarray(
          mappingUsed,
          mappingUsed + local.labelCount + 1,
        )
        mappingUsed = nextMappingUsed
        for (let localY = 0; localY < actualHeight; localY += 1) {
          signal.throwIfAborted()
          for (let localX = 0; localX < actualWidth; localX += 1) {
            const localIndex = localY * actualWidth + localX
            const localLabel = local.labels[localIndex] ?? 0
            if (localLabel === 0) continue
            let globalLabel = localToGlobal[localLabel] ?? 0
            if (globalLabel === 0) {
              provisionalCount += 1
              if (provisionalCount > capacity) {
                throw limitExceeded('Connected-components provisional-label limit exceeded')
              }
              globalLabel = provisionalCount
              localToGlobal[localLabel] = globalLabel
              state.parent[globalLabel] = globalLabel
              state.firstPixel[globalLabel] = (tileY + localY) * width + tileX + localX
              state.minX[globalLabel] = tileX + localX
              state.maxX[globalLabel] = tileX + localX
              state.minY[globalLabel] = tileY + localY
              state.maxY[globalLabel] = tileY + localY
            }
            const globalX = tileX + localX
            if (tileY > 0 && localY === 0) {
              globalLabel = unionComponent(state, globalLabel, previousBottom[globalX] ?? 0)
              if (selection.connectivity === 8) {
                if (globalX > 0)
                  globalLabel = unionComponent(state, globalLabel, previousBottom[globalX - 1] ?? 0)
                if (globalX + 1 < width)
                  globalLabel = unionComponent(state, globalLabel, previousBottom[globalX + 1] ?? 0)
              }
            }
            if (tileX > 0 && localX === 0) {
              globalLabel = unionComponent(state, globalLabel, previousRight[localY] ?? 0)
              if (selection.connectivity === 8) {
                if (localY > 0)
                  globalLabel = unionComponent(state, globalLabel, previousRight[localY - 1] ?? 0)
                if (localY + 1 < actualHeight)
                  globalLabel = unionComponent(state, globalLabel, previousRight[localY + 1] ?? 0)
              }
            }
            addPixel(state, globalLabel, globalX, tileY + localY)
            if (localY + 1 === actualHeight) currentBottom[globalX] = globalLabel
            if (localX + 1 === actualWidth) nextRight[localY] = globalLabel
          }
        }
      } finally {
        tile.release()
      }
      leftBoundary = nextRight
      tileIndex += 1
    }
    const swap = previousBottom
    previousBottom = currentBottom
    currentBottom = swap
  }
  tileOffsets[tileCount] = mappingUsed
  const rootsBuffer = new Uint32Array(provisionalCount)
  let objectCount = 0
  for (let label = 1; label <= provisionalCount; label += 1) {
    const root = componentFind(state, label)
    if (root === label && (state.count[root] ?? 0) > 0) {
      rootsBuffer[objectCount] = root
      objectCount += 1
    }
  }
  const roots = rootsBuffer.subarray(0, objectCount)
  roots.sort((left, right) => (state.firstPixel[left] ?? 0) - (state.firstPixel[right] ?? 0))
  const finalRootLabels = new Uint32Array(
    checkedSum([provisionalCount, 1], 'Connected-components final root entries'),
  )
  for (let index = 0; index < roots.length; index += 1) {
    const root = roots[index]
    if (root !== undefined) finalRootLabels[root] = index + 1
  }
  const finalMapping = new Uint32Array(mappingUsed)
  for (let index = 0; index < mappingUsed; index += 1) {
    const provisional = provisionalMapping[index] ?? 0
    finalMapping[index] =
      provisional === 0 ? 0 : (finalRootLabels[componentFind(state, provisional)] ?? 0)
  }
  return Object.freeze({
    table: objectTable(roots, state, source.descriptor, selection),
    tileOffsets,
    finalMapping,
    tilesAcross,
    labelsDescriptor: labelsDescriptor(source.descriptor, selection),
  })
}

/** Internal execution seam for focused lazy-label lifecycle tests; not a package export. */
export const reconstructConnectedComponentsLabelTile = async (
  source: ScientificDataset,
  selection: ConnectedComponentsParameters,
  prepared: PreparedLabelMapping,
  context: AnalysisDatasetOperationContext,
  request: Readonly<{
    readonly x: number
    readonly y: number
    readonly width: number
    readonly height: number
    readonly signal?: AbortSignal
  }>,
): Promise<NumericTile> => {
  const signal = request.signal ?? new AbortController().signal
  const output = new Uint32Array(
    checkedProduct(request.width, request.height, 'Connected-components label tile'),
  )
  const firstTileX = Math.floor(request.x / context.tileWidth)
  const lastTileX = Math.floor((request.x + request.width - 1) / context.tileWidth)
  const firstTileY = Math.floor(request.y / context.tileHeight)
  const lastTileY = Math.floor((request.y + request.height - 1) / context.tileHeight)
  const plane = validatedPlane(source.descriptor, selection)
  for (let tileY = firstTileY; tileY <= lastTileY; tileY += 1) {
    for (let tileX = firstTileX; tileX <= lastTileX; tileX += 1) {
      signal.throwIfAborted()
      const x = tileX * context.tileWidth
      const y = tileY * context.tileHeight
      const width = Math.min(context.tileWidth, plane.width - x)
      const height = Math.min(context.tileHeight, plane.height - y)
      const tile = await context.readSourceTile(source, {
        displayAxes: selection.displayAxes,
        fixedIndices: selection.fixedIndices,
        x,
        y,
        width,
        height,
        signal,
      })
      try {
        await context.runtime.withOperationWorkingBytes(
          inspectConnectedComponentsLabelScratchBytes(width, height),
          {
            label: 'purejsimage.analysis.connected-components.label-tile',
            signal,
          },
          () => {
            const local = labelLocalTile(
              tile,
              selection.component,
              selection.connectivity,
              source.descriptor.noDataValue,
              signal,
            )
            const tileIndex = tileY * prepared.tilesAcross + tileX
            const mappingStart = prepared.tileOffsets[tileIndex]
            const mappingEnd = prepared.tileOffsets[tileIndex + 1]
            if (mappingStart === undefined || mappingEnd === undefined) {
              throw invalidInput('Connected-components tile mapping is unavailable')
            }
            const mapping = prepared.finalMapping.subarray(mappingStart, mappingEnd)
            const left = Math.max(request.x, x)
            const top = Math.max(request.y, y)
            const right = Math.min(request.x + request.width, x + width)
            const bottom = Math.min(request.y + request.height, y + height)
            for (let globalY = top; globalY < bottom; globalY += 1) {
              signal.throwIfAborted()
              for (let globalX = left; globalX < right; globalX += 1) {
                const localLabel = local.labels[(globalY - y) * width + globalX - x] ?? 0
                output[(globalY - request.y) * request.width + globalX - request.x] =
                  mapping[localLabel] ?? 0
              }
            }
          },
        )
      } finally {
        tile.release()
      }
    }
  }
  return Object.freeze({
    x: request.x,
    y: request.y,
    width: request.width,
    height: request.height,
    sampleType: 'uint32' as const,
    componentCount: 1,
    layout: 'interleaved' as const,
    rowStrideElements: request.width,
    data: output,
    release() {},
  })
}

interface ConnectedComponentsPlanning {
  readonly pixels: number
  readonly plan: ConnectedComponentsMemoryPlan
}

const planning = (
  request: Readonly<OperationPlanningRequest>,
  context: AnalysisDatasetOperationContext,
): ConnectedComponentsPlanning => {
  const descriptor = descriptorFromCharacteristics(request.inputCharacteristics[0])
  const selection = parameters(request.parameters)
  const plane = validatedPlane(descriptor, selection)
  const pixels = checkedProduct(plane.width, plane.height, 'Connected-components plane')
  return Object.freeze({
    pixels,
    plan: connectedComponentsMemoryPlan(
      plane.width,
      plane.height,
      descriptor,
      selection,
      context,
      context.runtime.limits.maxOperationWorkingBytes,
    ),
  })
}

const estimate = (
  request: Readonly<OperationPlanningRequest>,
  context: AnalysisDatasetOperationContext,
): OperationCostEstimate => {
  const planned = planning(request, context)
  return Object.freeze({
    setupMilliseconds: 0,
    transferMilliseconds: 0,
    computeMilliseconds: planned.pixels / 2_000_000,
    readbackMilliseconds: 0,
    retainedBytes: planned.plan.maximumRetainedBytes,
    peakWorkingBytes: planned.plan.peakWorkingBytes,
    transferBytes: 0,
    outputBytes: planned.plan.maximumRetainedBytes,
    confidence: 0.5,
  })
}

export const createConnectedComponentsOperationImplementation = (
  context: AnalysisDatasetOperationContext,
): OperationImplementation =>
  Object.freeze({
    descriptor: Object.freeze({
      operationId: analysisConnectedComponentsOperationId,
      operationVersion: 1,
      implementationVersion: '1.0.0',
    }),
    supportsPlan(request: Readonly<OperationPlanningRequest>): boolean {
      try {
        planning(request, context)
        return true
      } catch {
        return false
      }
    },
    estimatePlan: (request: Readonly<OperationPlanningRequest>) => estimate(request, context),
    validateExecution(request: Readonly<OperationExecutionRequest>): void {
      datasetInput(request)
    },
    async execute(
      request: Readonly<OperationExecutionRequest>,
    ): Promise<readonly OperationOwnedOutput[]> {
      const source = datasetInput(request)
      const selection = parameters(request.parameters)
      const plane = validatedPlane(source.descriptor, selection)
      const memoryPlan = connectedComponentsMemoryPlan(
        plane.width,
        plane.height,
        source.descriptor,
        selection,
        context,
        context.runtime.limits.maxOperationWorkingBytes,
      )
      return context.runtime.withOperationWorkingBytes(
        memoryPlan.peakWorkingBytes,
        { label: analysisConnectedComponentsOperationId, signal: request.signal },
        async (scope) => {
          const prepared = await prepareComponents(
            source,
            selection,
            context,
            request.signal,
            memoryPlan,
          )
          const tableMemory = accountAnalysisResultMemory(prepared.table).retainedBytes
          const labelMemory =
            prepared.finalMapping.buffer.byteLength + prepared.tileOffsets.buffer.byteLength
          const retainedBytes = checkedSum(
            [tableMemory, labelMemory],
            'Connected-components retained output accounting',
          )
          if (retainedBytes > memoryPlan.maximumRetainedBytes) {
            throw invalidInput('Connected-components retained output exceeded its memory plan')
          }
          const tableReservation = context.runtime.retainOperationWorkingBytes(scope, tableMemory)
          let labelReservation: ReturnType<typeof context.runtime.retainOperationWorkingBytes>
          try {
            labelReservation = context.runtime.retainOperationWorkingBytes(scope, labelMemory)
          } catch (error) {
            tableReservation.release()
            throw error
          }
          try {
            const identity = await context.derivedIdentity(source, request, 'labels')
            const labelMapping: PreparedLabelMapping = Object.freeze({
              tileOffsets: prepared.tileOffsets,
              finalMapping: prepared.finalMapping,
              tilesAcross: prepared.tilesAcross,
            })
            const labels = context.createDataset(
              prepared.labelsDescriptor,
              (tileRequest) =>
                reconstructConnectedComponentsLabelTile(
                  source,
                  selection,
                  labelMapping,
                  context,
                  tileRequest,
                ),
              identity,
            )
            const labelOwner = Object.freeze({ kind: 'connected-components-label-state' })
            const tableOwner = Object.freeze({ kind: 'connected-components-table-state' })
            return Object.freeze([
              Object.freeze({
                value: labels,
                ownershipIdentity: labelOwner,
                release: labelReservation.release,
              }),
              Object.freeze({
                value: prepared.table,
                ownershipIdentity: tableOwner,
                release: tableReservation.release,
              }),
            ])
          } catch (error) {
            labelReservation.release()
            tableReservation.release()
            throw error
          }
        },
      )
    },
  })
