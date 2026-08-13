import { describe, expect, it } from 'vitest'

import {
  analysisCropOperationId,
  analysisGaussianBlurOperationId,
  analysisHistogramOperationId,
  analysisLineProfileOperationId,
  analysisProjectionOperationId,
  analysisResampleOperationId,
  analysisSliceOperationId,
  analysisStatisticsOperationId,
  analysisThresholdOperationId,
  createAnalysisController,
  createBuiltInAnalysisOperationRegistry,
  createBuiltInAnalysisValueTypeRegistry,
  roiValueTypeId,
  scientificDatasetCharacteristics,
  scientificDatasetValueTypeId,
  type AnalysisGraph,
  type Roi,
} from '../src/analysis/index.ts'
import { createOperationProvider, type OperationJsonValue } from '../src/operations/index.ts'
import type { RasterBlock } from '../src/raster.ts'
import {
  normalizeScientificDatasetDescriptor,
  type ScientificDataset,
} from '../src/scientific/index.ts'

const descriptor = normalizeScientificDatasetDescriptor({
  schemaVersion: 1,
  axes: [
    { id: 'x', kind: 'space', length: 4, coordinates: { type: 'index' } },
    { id: 'y', kind: 'space', length: 3, coordinates: { type: 'index' } },
    { id: 'axis-3', kind: 'other', length: 2, coordinates: { type: 'index' } },
  ],
  sampleType: 'float32',
  components: [{ id: 'value', kind: 'scalar' }],
  capabilities: {
    regionReads: true,
    resolutionLevels: false,
    planeReads: { kind: 'ordered-axis-pairs', pairs: [['x', 'y']] },
  },
})

const line: Roi = Object.freeze({
  schemaVersion: 1,
  id: 'line',
  axisIds: ['x', 'axis-3'] as const,
  fixedIndices: Object.freeze([{ axisId: 'y', index: 0 }]),
  coordinateSpace: 'pixel',
  geometry: Object.freeze({
    kind: 'line-segment',
    start: Object.freeze({ x: 0, y: 0 }),
    end: Object.freeze({ x: 1, y: 1 }),
  }),
})

interface InvalidCase {
  readonly id: string
  readonly output: string
  readonly parameters: OperationJsonValue
  readonly roi: boolean
}

const invalidCases: readonly InvalidCase[] = Object.freeze([
  {
    id: analysisSliceOperationId,
    output: 'dataset',
    parameters: { displayAxes: ['x', 'axis-3'], fixedIndices: [{ axisId: 'y', index: 0 }] },
    roi: false,
  },
  {
    id: analysisResampleOperationId,
    output: 'dataset',
    parameters: {
      displayAxes: ['x', 'axis-3'],
      fixedIndices: [{ axisId: 'y', index: 0 }],
      width: 2,
      height: 2,
    },
    roi: false,
  },
  {
    id: analysisProjectionOperationId,
    output: 'dataset',
    parameters: {
      displayAxes: ['x', 'axis-3'],
      fixedIndices: [],
      reductionAxis: 'y',
      mode: 'max',
    },
    roi: false,
  },
  {
    id: analysisGaussianBlurOperationId,
    output: 'dataset',
    parameters: {
      displayAxes: ['x', 'axis-3'],
      fixedIndices: [{ axisId: 'y', index: 0 }],
      sigma: 1,
    },
    roi: false,
  },
  {
    id: analysisStatisticsOperationId,
    output: 'statistics',
    parameters: {
      displayAxes: ['x', 'axis-3'],
      fixedIndices: [{ axisId: 'y', index: 0 }],
      component: 0,
      percentiles: [],
      percentileMaxSamples: 4,
      emptyPolicy: 'error',
    },
    roi: false,
  },
  {
    id: analysisHistogramOperationId,
    output: 'histogram',
    parameters: {
      displayAxes: ['x', 'axis-3'],
      fixedIndices: [{ axisId: 'y', index: 0 }],
      component: 0,
      bins: 4,
    },
    roi: false,
  },
  {
    id: analysisLineProfileOperationId,
    output: 'profile',
    parameters: {
      displayAxes: ['x', 'axis-3'],
      fixedIndices: [{ axisId: 'y', index: 0 }],
      component: 0,
      components: [0],
      interpolation: 'nearest',
      spacing: 1,
      spacingSpace: 'pixel',
      maxSamples: 16,
      outside: 'error',
      invalidPolicy: 'error',
    },
    roi: true,
  },
])

const graphFor = (testCase: InvalidCase): AnalysisGraph => ({
  schemaVersion: 1,
  inputs: [
    { name: 'source', valueType: { id: scientificDatasetValueTypeId, version: 1 } },
    ...(testCase.roi ? [{ name: 'line', valueType: { id: roiValueTypeId, version: 1 } }] : []),
  ],
  nodes: [
    {
      id: 'operation',
      operation: { id: testCase.id, version: 1 },
      inputs: [
        { port: 'dataset', source: { kind: 'input', input: 'source' } },
        ...(testCase.roi
          ? [{ port: 'roi', source: { kind: 'input', input: 'line' } } as const]
          : []),
      ],
      parameters: testCase.parameters,
    },
  ],
  outputs: [
    {
      name: 'result',
      source: { kind: 'node', nodeId: 'operation', output: testCase.output },
    },
  ],
})

describe('analysis plane-read capability planning', () => {
  it('accepts the declared pair without constraining crop or threshold semantics', () => {
    const operations = createBuiltInAnalysisOperationRegistry()
    const characteristics = scientificDatasetCharacteristics({
      descriptor,
      readPlane() {
        throw new Error('Inference must not read pixels')
      },
    })
    const cases = [
      {
        id: analysisSliceOperationId,
        parameters: {
          displayAxes: ['x', 'y'],
          fixedIndices: [{ axisId: 'axis-3', index: 0 }],
        },
      },
      {
        id: analysisCropOperationId,
        parameters: { displayAxes: ['x', 'axis-3'], x: 0, y: 0, width: 2, height: 2 },
      },
      {
        id: analysisThresholdOperationId,
        parameters: { mode: 'greater-than', threshold: 0 },
      },
    ] as const
    for (const testCase of cases) {
      const definition = operations.get(testCase.id, 1)
      const normalized = definition?.normalizeParameters(testCase.parameters)
      if (definition?.inferOutputShapes === undefined || normalized?.value === undefined) {
        throw new Error(`Missing inference for ${testCase.id}`)
      }
      expect(
        definition.inferOutputShapes({ parameters: normalized.value, inputs: [characteristics] }),
      ).toMatchObject({ valid: true })
    }
  })

  it('rejects unsupported built-in plane pairs before provider preparation or source reads', async () => {
    let reads = 0
    let preparations = 0
    const source: ScientificDataset = Object.freeze({
      descriptor,
      readPlane(): AsyncIterable<RasterBlock> {
        reads += 1
        return {
          [Symbol.asyncIterator](): AsyncIterator<RasterBlock> {
            return {
              async next(): Promise<IteratorResult<RasterBlock>> {
                return { done: true, value: undefined }
              },
            }
          },
        }
      },
    })
    const operations = createBuiltInAnalysisOperationRegistry()
    const controller = createAnalysisController({
      operations,
      valueTypes: createBuiltInAnalysisValueTypeRegistry(descriptor),
      providers: [
        createOperationProvider({
          descriptor: {
            id: 'purejsimage.tests.must-not-prepare',
            version: 1,
            kind: 'reference',
            buildFingerprint: 'plane-read-preflight',
          },
          prepare: async () => {
            preparations += 1
            return []
          },
        }),
      ],
      library: { version: '0.9.0', buildFingerprint: 'plane-read-preflight' },
    })
    const bindings = {
      source: {
        value: source,
        identity: {
          kind: 'application-defined' as const,
          namespace: 'purejsimage.tests.plane-read',
          value: 'fits-like',
        },
        characteristics: scientificDatasetCharacteristics(source),
      },
      line: { value: line },
    }

    for (const testCase of invalidCases) {
      const definition = operations.get(testCase.id, 1)
      const normalized = definition?.normalizeParameters(testCase.parameters)
      expect(normalized?.value).toBeDefined()
      if (definition?.inferOutputShapes === undefined || normalized?.value === undefined) {
        throw new Error(`Missing inference for ${testCase.id}`)
      }
      expect(
        definition.inferOutputShapes({
          parameters: normalized.value,
          inputs: [scientificDatasetCharacteristics(source)],
        }),
      ).toMatchObject({
        valid: false,
        issues: [{ message: 'Scientific dataset does not support display axes x/axis-3' }],
      })

      const graph = graphFor(testCase)
      const graphBindings = testCase.roi ? bindings : { source: bindings.source }
      const dryRun = await controller.dryRun(graph, { bindings: graphBindings })
      expect(dryRun).toMatchObject({
        valid: false,
        issues: [{ message: 'Scientific dataset does not support display axes x/axis-3' }],
      })
      await expect(controller.planGraph(graph, { bindings: graphBindings })).rejects.toThrow(
        'Scientific dataset does not support display axes x/axis-3',
      )
    }
    expect(preparations).toBe(0)
    expect(reads).toBe(0)
  })
})
