import { describe, expect, it } from 'vitest'
import {
  analysisHistogramOperationId,
  analysisLineProfileOperationId,
  analysisStatisticsOperationId,
  createAnalysisController,
  createBuiltInAnalysisOperationRegistry,
  createBuiltInAnalysisValueTypeRegistry,
  createReferenceAnalysisProvider,
  createTileRuntime,
  scientificDatasetCharacteristics,
  scientificDatasetValueTypeId,
  summarizeResult,
  validateAnalysisResult,
} from '../src/analysis/index.ts'
import type { AnalysisGraph, AnalysisResult, ResultCollection, Roi } from '../src/analysis/index.ts'
import type { OperationJsonObject } from '../src/operations/index.ts'
import type {
  DirectNumericTileDataset,
  NumericTile,
  NumericTileReadRequest,
} from '../src/scientific/index.ts'
import {
  normalizeScientificDatasetDescriptor,
  normalizeScientificPlaneReadRequest,
} from '../src/scientific/index.ts'

interface Tracking {
  reads: number
  releases: number
}

const dataset = (tracking: Tracking): DirectNumericTileDataset => {
  const descriptor = normalizeScientificDatasetDescriptor({
    schemaVersion: 2,
    axes: [
      {
        id: 'x',
        kind: 'space',
        length: 5,
        unit: 'mm',
        coordinates: { type: 'linear', origin: 10, step: 2 },
      },
      {
        id: 'y',
        kind: 'space',
        length: 4,
        unit: 'mm',
        coordinates: { type: 'linear', origin: 20, step: 3 },
      },
      { id: 'z', kind: 'space', length: 2, coordinates: { type: 'index' } },
    ],
    sampleType: 'float32',
    components: [
      { id: 'signal', name: 'Signal', kind: 'scalar', unit: 'counts' },
      { id: 'reference', name: 'Reference', kind: 'scalar', unit: 'counts' },
    ],
    noDataValue: 22,
    capabilities: { regionReads: true, resolutionLevels: false },
  })
  const numericTileSource = {
    descriptor,
    directSemantics: {
      sourceSampleType: 'float32' as const,
      nativeSampleType: 'float32' as const,
      componentCount: 2,
      layout: 'interleaved' as const,
      supportedTargetSampleTypes: ['float32', 'float64'] as const,
    },
    async *readNumericTiles(input: Readonly<NumericTileReadRequest>): AsyncGenerator<NumericTile> {
      const { targetSampleType, ...planeRequest } = input
      const request = normalizeScientificPlaneReadRequest(descriptor, planeRequest)
      tracking.reads += 1
      request.signal?.throwIfAborted()
      const data =
        targetSampleType === 'float64'
          ? new Float64Array(request.width * request.height * 2)
          : new Float32Array(request.width * request.height * 2)
      const z = request.fixedIndices.find((entry) => entry.axisId === 'z')?.index ?? 0
      for (let y = 0; y < request.height; y += 1) {
        for (let x = 0; x < request.width; x += 1) {
          const value = (request.y + y) * 10 + request.x + x + z * 1_000
          const offset = (y * request.width + x) * 2
          data[offset] = value
          data[offset + 1] = value + 100
        }
      }
      yield Object.freeze({
        x: request.x,
        y: request.y,
        width: request.width,
        height: request.height,
        sampleType: targetSampleType ?? 'float32',
        componentCount: 2,
        layout: 'interleaved' as const,
        rowStrideElements: request.width * 2,
        data,
        release() {
          tracking.releases += 1
        },
      })
    },
  }
  return Object.freeze({
    descriptor,
    numericTileSource,
    readPlane() {
      throw new Error('Expected direct numeric reads')
    },
  })
}

const uint64Dataset = (value: bigint, tracking: Tracking): DirectNumericTileDataset => {
  const descriptor = normalizeScientificDatasetDescriptor({
    schemaVersion: 2,
    axes: [
      { id: 'x', kind: 'space', length: 1, coordinates: { type: 'index' } },
      { id: 'y', kind: 'space', length: 1, coordinates: { type: 'index' } },
    ],
    sampleType: 'uint64',
    components: [{ id: 'signal', kind: 'scalar' }],
    capabilities: { regionReads: true, resolutionLevels: false },
  })
  return Object.freeze({
    descriptor,
    numericTileSource: Object.freeze({
      descriptor,
      directSemantics: Object.freeze({
        sourceSampleType: 'uint64' as const,
        nativeSampleType: 'uint64' as const,
        componentCount: 1,
        layout: 'interleaved' as const,
        supportedTargetSampleTypes: ['uint64'] as const,
      }),
      async *readNumericTiles(
        input: Readonly<NumericTileReadRequest>,
      ): AsyncGenerator<NumericTile> {
        const { targetSampleType: _targetSampleType, ...planeRequest } = input
        const request = normalizeScientificPlaneReadRequest(descriptor, planeRequest)
        tracking.reads += 1
        yield Object.freeze({
          x: request.x,
          y: request.y,
          width: request.width,
          height: request.height,
          sampleType: 'uint64' as const,
          componentCount: 1,
          layout: 'interleaved' as const,
          rowStrideElements: request.width,
          data: new BigUint64Array([value]),
          release() {
            tracking.releases += 1
          },
        })
      },
    }),
    readPlane() {
      throw new Error('Expected direct numeric reads')
    },
  })
}

const rectangle: Roi = Object.freeze({
  schemaVersion: 1,
  id: 'selection',
  axisIds: ['x', 'y'] as const,
  fixedIndices: Object.freeze([{ axisId: 'z', index: 0 }]),
  coordinateSpace: 'pixel',
  geometry: Object.freeze({ kind: 'rectangle', x: 1, y: 1, width: 3, height: 2 }),
})

const physicalLine: Roi = Object.freeze({
  schemaVersion: 1,
  id: 'line',
  axisIds: ['x', 'y'] as const,
  fixedIndices: Object.freeze([{ axisId: 'z', index: 0 }]),
  coordinateSpace: 'physical',
  units: ['mm', 'mm'] as const,
  geometry: Object.freeze({
    kind: 'line-segment',
    start: Object.freeze({ x: 10, y: 20 }),
    end: Object.freeze({ x: 16, y: 20 }),
  }),
})

const operationGraph = (
  operationId: string,
  output: string,
  parameters: AnalysisGraph['nodes'][number]['parameters'],
  roi?: Roi,
): AnalysisGraph => ({
  schemaVersion: 1,
  inputs: [
    { name: 'source', valueType: { id: scientificDatasetValueTypeId, version: 1 } },
    ...(roi === undefined
      ? []
      : [{ name: 'selection', valueType: { id: 'purejsimage.roi', version: 1 } }]),
  ],
  nodes: [
    {
      id: 'result',
      operation: { id: operationId, version: 1 },
      inputs:
        roi === undefined
          ? [{ port: 'dataset', source: { kind: 'input', input: 'source' } }]
          : [
              { port: 'dataset', source: { kind: 'input', input: 'source' } },
              { port: 'roi', source: { kind: 'input', input: 'selection' } },
            ],
      parameters,
    },
  ],
  outputs: [{ name: 'result', source: { kind: 'node', nodeId: 'result', output } }],
})

const execute = async (
  source: DirectNumericTileDataset,
  graph: AnalysisGraph,
  runtime: ReturnType<typeof createTileRuntime>,
  roi?: Roi,
): Promise<{
  readonly result: AnalysisResult
  readonly release: () => Promise<void>
  readonly provenance: Readonly<{ readonly nodes: readonly OperationJsonObject[] }>
}> => {
  const controller = createAnalysisController({
    operations: createBuiltInAnalysisOperationRegistry(),
    valueTypes: createBuiltInAnalysisValueTypeRegistry(source.descriptor),
    providers: [
      createReferenceAnalysisProvider({
        runtime,
        tileWidth: 2,
        tileHeight: 2,
        sessionId: 'results',
      }),
    ],
    library: { version: '0.9.0', buildFingerprint: 'result-operation-test' },
  })
  const plan = await controller.planGraph(graph, {
    bindings: {
      source: {
        value: source,
        identity: {
          kind: 'application-defined',
          namespace: 'purejsimage.tests.result-dataset',
          value: 'result-fixture',
        },
        characteristics: scientificDatasetCharacteristics(source),
      },
      ...(roi === undefined ? {} : { selection: { value: roi } }),
    },
    policy: {
      mode: 'pinned',
      providerId: 'purejsimage.analysis.reference',
      providerVersion: 1,
    },
  })
  const execution = await controller.executeGraph(plan).result
  const result = execution.outputs.get('result')
  if (result === undefined) {
    await execution.release()
    throw new Error('Expected an analysis result')
  }
  return {
    result: validateAnalysisResult(result),
    release: () => execution.release(),
    provenance: execution.provenance,
  }
}

const scalarFrom = (collection: ResultCollection, name: string): number => {
  const result = collection.results.find((entry) => entry.name === name)?.result
  if (result?.kind !== 'scalar') throw new Error(`Missing scalar ${name}`)
  return result.value
}

describe('built-in ROI-aware result operations', () => {
  it('rejects quantitative uint64 analysis above the exact JavaScript number range', async () => {
    const tracking = { reads: 0, releases: 0 }
    const source = uint64Dataset(BigInt(Number.MAX_SAFE_INTEGER) + 1n, tracking)
    const runtime = createTileRuntime()
    await expect(
      execute(
        source,
        operationGraph(analysisStatisticsOperationId, 'statistics', {
          displayAxes: ['x', 'y'],
          fixedIndices: [],
          component: 0,
          percentiles: [],
          percentileMaxSamples: 4,
          emptyPolicy: 'error',
        }),
        runtime,
      ),
    ).rejects.toMatchObject({
      cause: expect.objectContaining({
        message: 'uint64 sample exceeds exact numerical analysis range',
      }),
    })
    runtime.clear()
    expect(tracking.releases).toBe(tracking.reads)
  })

  it('computes deterministic Welford statistics and bounded percentiles over tile-local ROI masks', async () => {
    const tracking = { reads: 0, releases: 0 }
    const source = dataset(tracking)
    const runtime = createTileRuntime()
    const executed = await execute(
      source,
      operationGraph(
        analysisStatisticsOperationId,
        'statistics',
        {
          displayAxes: ['x', 'y'],
          fixedIndices: [{ axisId: 'z', index: 0 }],
          component: 0,
          percentiles: [0, 100],
          percentileMaxSamples: 64,
          emptyPolicy: 'nan',
        },
        rectangle,
      ),
      runtime,
      rectangle,
    )
    const result = executed.result
    if (result.kind !== 'collection') throw new Error('Expected a result collection')
    expect(scalarFrom(result, 'count')).toBe(6)
    expect(scalarFrom(result, 'finiteCount')).toBe(5)
    expect(scalarFrom(result, 'invalidCount')).toBe(1)
    expect(scalarFrom(result, 'minimum')).toBe(11)
    expect(scalarFrom(result, 'maximum')).toBe(23)
    expect(scalarFrom(result, 'mean')).toBe(16)
    expect(scalarFrom(result, 'populationStandardDeviation')).toBeCloseTo(Math.sqrt(24.8), 12)
    const percentiles = result.results.find((entry) => entry.name === 'percentiles')?.result
    expect(percentiles?.kind).toBe('profile')
    if (percentiles?.kind === 'profile') {
      const series = percentiles.series[0]
      if (series === undefined) throw new Error('Missing percentile series')
      expect([...series.values]).toEqual([11, 23])
    }
    expect(result.metadata).toMatchObject({ reductionOrder: 'global-row-major', roiCount: 1 })
    expect(summarizeResult(result).dimensions).toMatchObject({ results: 8 })
    expect(executed.provenance.nodes[0]).toMatchObject({
      provider: { id: 'purejsimage.analysis.reference' },
    })
    await executed.release()
    runtime.clear()
    expect(tracking.releases).toBe(tracking.reads)
  })

  it('matches a brute-force concave polygon selection across tile partitions', async () => {
    const tracking = { reads: 0, releases: 0 }
    const source = dataset(tracking)
    const runtime = createTileRuntime()
    const concave: Roi = Object.freeze({
      schemaVersion: 1,
      id: 'concave',
      axisIds: ['x', 'y'] as const,
      fixedIndices: Object.freeze([{ axisId: 'z', index: 0 }]),
      coordinateSpace: 'pixel',
      geometry: Object.freeze({
        kind: 'polygon',
        points: Object.freeze([
          Object.freeze({ x: 0, y: 0 }),
          Object.freeze({ x: 5, y: 0 }),
          Object.freeze({ x: 5, y: 1.75 }),
          Object.freeze({ x: 2.75, y: 1.75 }),
          Object.freeze({ x: 2.75, y: 4 }),
          Object.freeze({ x: 0, y: 4 }),
        ]),
      }),
    })
    const executed = await execute(
      source,
      operationGraph(
        analysisStatisticsOperationId,
        'statistics',
        {
          displayAxes: ['x', 'y'],
          fixedIndices: [{ axisId: 'z', index: 0 }],
          component: 0,
          percentiles: [],
          percentileMaxSamples: 64,
          emptyPolicy: 'error',
        },
        concave,
      ),
      runtime,
      concave,
    )
    if (executed.result.kind !== 'collection') throw new Error('Expected statistics')
    expect(scalarFrom(executed.result, 'count')).toBe(16)
    expect(scalarFrom(executed.result, 'finiteCount')).toBe(15)
    expect(scalarFrom(executed.result, 'invalidCount')).toBe(1)
    expect(scalarFrom(executed.result, 'minimum')).toBe(0)
    expect(scalarFrom(executed.result, 'maximum')).toBe(32)
    expect(scalarFrom(executed.result, 'mean')).toBeCloseTo(204 / 15, 12)
    expect(tracking.reads).toBeGreaterThan(1)
    await executed.release()
    runtime.clear()
    expect(tracking.releases).toBe(tracking.reads)
  })

  it('uses an explicit one-pass histogram or a cache-backed automatic second pass', async () => {
    const tracking = { reads: 0, releases: 0 }
    const source = dataset(tracking)
    const runtime = createTileRuntime()
    const executed = await execute(
      source,
      operationGraph(
        analysisHistogramOperationId,
        'histogram',
        {
          displayAxes: ['x', 'y'],
          fixedIndices: [{ axisId: 'z', index: 0 }],
          component: 0,
          bins: 4,
        },
        rectangle,
      ),
      runtime,
      rectangle,
    )
    const result = executed.result
    if (result.kind !== 'histogram') throw new Error('Expected a histogram')
    expect([...result.binEdges]).toEqual([11, 14, 17, 20, 23])
    expect([...result.counts]).toEqual([3, 0, 0, 2])
    expect(result.metadata).toMatchObject({ rangeMode: 'automatic-two-pass' })
    expect(runtime.metrics().cache.hits).toBeGreaterThan(0)
    expect(tracking.reads).toBe(6)
    await executed.release()
    runtime.clear()
    expect(tracking.releases).toBe(tracking.reads)
  })

  it('reports explicit histogram edges, underflow, overflow, and ignored no-data', async () => {
    const tracking = { reads: 0, releases: 0 }
    const source = dataset(tracking)
    const runtime = createTileRuntime()
    const executed = await execute(
      source,
      operationGraph(analysisHistogramOperationId, 'histogram', {
        displayAxes: ['x', 'y'],
        fixedIndices: [{ axisId: 'z', index: 0 }],
        component: 0,
        bins: 2,
        minimum: 10,
        maximum: 20,
      }),
      runtime,
    )
    if (executed.result.kind !== 'histogram') throw new Error('Expected a histogram')
    expect([...executed.result.binEdges]).toEqual([10, 15, 20])
    expect([...executed.result.counts]).toEqual([5, 1])
    expect(executed.result.underflow).toBe(5)
    expect(executed.result.overflow).toBe(8)
    expect(executed.result.metadata).toMatchObject({ rangeMode: 'explicit-one-pass' })
    await executed.release()
    runtime.clear()
    expect(tracking.releases).toBe(tracking.reads)
  })

  it('samples a calibrated multi-component line profile with bounded physical spacing', async () => {
    const tracking = { reads: 0, releases: 0 }
    const source = dataset(tracking)
    const runtime = createTileRuntime()
    const executed = await execute(
      source,
      operationGraph(
        analysisLineProfileOperationId,
        'profile',
        {
          displayAxes: ['x', 'y'],
          fixedIndices: [{ axisId: 'z', index: 0 }],
          component: 0,
          components: [0, 1],
          interpolation: 'nearest',
          spacing: 2,
          spacingSpace: 'physical',
          maxSamples: 16,
          outside: 'error',
        },
        physicalLine,
      ),
      runtime,
      physicalLine,
    )
    const result = executed.result
    if (result.kind !== 'profile') throw new Error('Expected a profile')
    expect([...result.axis.values]).toEqual([0, 2, 4, 6])
    expect(result.axis.unit).toBe('mm')
    const signalSeries = result.series[0]
    const referenceSeries = result.series[1]
    if (signalSeries === undefined || referenceSeries === undefined) {
      throw new Error('Missing profile series')
    }
    expect([...signalSeries.values]).toEqual([0, 1, 2, 3])
    expect([...referenceSeries.values]).toEqual([100, 101, 102, 103])
    expect(result.metadata).toMatchObject({ roiId: 'line', spacingSpace: 'physical' })
    await executed.release()
    runtime.clear()
    expect(tracking.releases).toBe(tracking.reads)
  })

  it('bilinearly samples calibrated subpixel profile positions', async () => {
    const tracking = { reads: 0, releases: 0 }
    const source = dataset(tracking)
    const runtime = createTileRuntime()
    const line: Roi = Object.freeze({
      ...physicalLine,
      id: 'subpixel-line',
      geometry: Object.freeze({
        kind: 'line-segment',
        start: Object.freeze({ x: 11, y: 21.5 }),
        end: Object.freeze({ x: 15, y: 21.5 }),
      }),
    })
    const executed = await execute(
      source,
      operationGraph(
        analysisLineProfileOperationId,
        'profile',
        {
          displayAxes: ['x', 'y'],
          fixedIndices: [{ axisId: 'z', index: 0 }],
          component: 0,
          components: [0, 1],
          interpolation: 'bilinear',
          spacing: 2,
          spacingSpace: 'physical',
          maxSamples: 16,
          outside: 'error',
        },
        line,
      ),
      runtime,
      line,
    )
    if (executed.result.kind !== 'profile') throw new Error('Expected a profile')
    expect([...executed.result.axis.values]).toEqual([0, 2, 4])
    expect([...(executed.result.series[0]?.values ?? [])]).toEqual([5.5, 6.5, 7.5])
    expect([...(executed.result.series[1]?.values ?? [])]).toEqual([105.5, 106.5, 107.5])
    expect(tracking.reads).toBe(2)
    await executed.release()
    runtime.clear()
    expect(tracking.releases).toBe(tracking.reads)
  })

  it('applies the explicit line-profile no-data policy', async () => {
    const tracking = { reads: 0, releases: 0 }
    const source = dataset(tracking)
    const runtime = createTileRuntime()
    const line: Roi = Object.freeze({
      schemaVersion: 1,
      id: 'no-data-line',
      axisIds: ['x', 'y'] as const,
      fixedIndices: Object.freeze([{ axisId: 'z', index: 0 }]),
      coordinateSpace: 'pixel',
      geometry: Object.freeze({
        kind: 'line-segment',
        start: Object.freeze({ x: 2.5, y: 2.5 }),
        end: Object.freeze({ x: 3.5, y: 2.5 }),
      }),
    })
    const executed = await execute(
      source,
      operationGraph(
        analysisLineProfileOperationId,
        'profile',
        {
          displayAxes: ['x', 'y'],
          fixedIndices: [{ axisId: 'z', index: 0 }],
          component: 0,
          components: [0],
          interpolation: 'nearest',
          spacing: 1,
          spacingSpace: 'pixel',
          maxSamples: 4,
          outside: 'error',
          invalidPolicy: 'nan',
        },
        line,
      ),
      runtime,
      line,
    )
    if (executed.result.kind !== 'profile') throw new Error('Expected a profile')
    expect([...(executed.result.series[0]?.values ?? [])]).toEqual([Number.NaN, 23])
    expect(executed.result.series[0]?.nanPolicy).toBe('allow')
    await executed.release()
    runtime.clear()
    expect(tracking.releases).toBe(tracking.reads)
  })

  it('groups dense line-profile samples by normal source tile', async () => {
    const tracking = { reads: 0, releases: 0 }
    const source = dataset(tracking)
    const runtime = createTileRuntime()
    const line: Roi = Object.freeze({
      schemaVersion: 1,
      id: 'dense-line',
      axisIds: ['x', 'y'] as const,
      fixedIndices: Object.freeze([{ axisId: 'z', index: 0 }]),
      coordinateSpace: 'pixel',
      geometry: Object.freeze({
        kind: 'line-segment',
        start: Object.freeze({ x: 0.5, y: 1.5 }),
        end: Object.freeze({ x: 4.5, y: 1.5 }),
      }),
    })
    const executed = await execute(
      source,
      operationGraph(
        analysisLineProfileOperationId,
        'profile',
        {
          displayAxes: ['x', 'y'],
          fixedIndices: [{ axisId: 'z', index: 0 }],
          component: 0,
          components: [0],
          interpolation: 'nearest',
          spacing: 0.25,
          spacingSpace: 'pixel',
          maxSamples: 32,
          outside: 'error',
          invalidPolicy: 'nan',
        },
        line,
      ),
      runtime,
      line,
    )
    if (executed.result.kind !== 'profile') throw new Error('Expected a profile')
    expect(executed.result.axis.values).toHaveLength(17)
    expect(tracking.reads).toBe(3)
    await executed.release()
    runtime.clear()
    expect(tracking.releases).toBe(3)
  })

  it('cancels explicitly before result execution without reading pixels', async () => {
    const tracking = { reads: 0, releases: 0 }
    const source = dataset(tracking)
    const runtime = createTileRuntime()
    const controller = createAnalysisController({
      operations: createBuiltInAnalysisOperationRegistry(),
      valueTypes: createBuiltInAnalysisValueTypeRegistry(source.descriptor),
      providers: [createReferenceAnalysisProvider({ runtime, sessionId: 'cancel-results' })],
      library: { version: '0.9.0', buildFingerprint: 'cancel-test' },
    })
    const plan = await controller.planGraph(
      operationGraph(analysisStatisticsOperationId, 'statistics', {
        displayAxes: ['x', 'y'],
        fixedIndices: [{ axisId: 'z', index: 0 }],
        component: 0,
        percentiles: [],
        percentileMaxSamples: 64,
        emptyPolicy: 'nan',
      }),
      {
        bindings: {
          source: {
            value: source,
            identity: {
              kind: 'application-defined',
              namespace: 'purejsimage.tests.result-dataset',
              value: 'cancel-fixture',
            },
            characteristics: scientificDatasetCharacteristics(source),
          },
        },
      },
    )
    const abort = new AbortController()
    abort.abort(new Error('cancel result'))
    await expect(controller.executeGraph(plan, { signal: abort.signal }).result).rejects.toThrow(
      'cancel result',
    )
    expect(tracking.reads).toBe(0)
  })
})
