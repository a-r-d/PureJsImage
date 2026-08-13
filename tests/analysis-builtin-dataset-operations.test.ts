import { describe, expect, it } from 'vitest'
import {
  analysisCropOperationId,
  analysisGaussianBlurOperationId,
  analysisProjectionOperationId,
  analysisResampleOperationId,
  analysisSliceOperationId,
  analysisThresholdOperationId,
  createAnalysisController,
  createBuiltInAnalysisBundle,
  createBuiltInAnalysisOperationRegistry,
  createBuiltInAnalysisValueTypeRegistry,
  createReferenceAnalysisProvider,
  scientificDatasetCharacteristics,
  scientificDatasetValueTypeId,
} from '../src/analysis/index.ts'
import type { AnalysisExecutionResult, AnalysisGraph } from '../src/analysis/index.ts'
import { createTileRuntime, numericTileSourceToTileSource } from '../src/analysis/runtime.ts'
import type { TileRuntime } from '../src/analysis/runtime.ts'
import { createOperationProvider } from '../src/operations/index.ts'
import type {
  OperationImplementation,
  OperationJsonObject,
  OperationJsonValue,
  OperationTileKernelRequest,
} from '../src/operations/index.ts'
import type {
  DirectNumericTileDataset,
  NumericTile,
  NumericTileReadRequest,
  ScientificAxisIndex,
  ScientificDataset,
} from '../src/scientific/index.ts'
import { identifyScientificDataset } from '../src/scientific/reader.ts'
import {
  normalizeScientificDatasetDescriptor,
  normalizeScientificPlaneReadRequest,
  resolveNumericTileSource,
} from '../src/scientific/index.ts'

interface SourceTracking {
  readonly reads: NumericTileReadRequest[]
  releases: number
}

class Deferred<Value> {
  readonly promise: Promise<Value>
  resolve: (value: Value) => void = () => undefined
  reject: (reason: unknown) => void = () => undefined

  constructor() {
    this.promise = new Promise<Value>((resolve, reject) => {
      this.resolve = resolve
      this.reject = reject
    })
  }
}

const sourceDataset = (
  tracking: SourceTracking,
  sample: (indices: Readonly<Record<string, number>>) => number,
  options: {
    readonly sampleType?: 'uint16' | 'float32'
    readonly noDataValue?: number
    readonly beforeSamples?: (request: Readonly<NumericTileReadRequest>) => Promise<void>
  } = {},
): DirectNumericTileDataset => {
  const sampleType = options.sampleType ?? 'uint16'
  const descriptor = normalizeScientificDatasetDescriptor({
    schemaVersion: 1,
    axes: [
      {
        id: 'x',
        kind: 'space',
        length: 4,
        unit: 'mm',
        coordinates: { type: 'linear', origin: 10, step: 2 },
      },
      {
        id: 'y',
        kind: 'space',
        length: 4,
        unit: 'mm',
        coordinates: { type: 'lookup', values: [1, 2, 4, 8] },
      },
      {
        id: 'energy',
        kind: 'spectral',
        length: 3,
        unit: 'eV',
        coordinates: { type: 'linear', origin: 100, step: 5 },
      },
    ],
    sampleType,
    components: [{ id: 'intensity', kind: 'intensity', unit: 'counts' }],
    ...(options.noDataValue === undefined ? {} : { noDataValue: options.noDataValue }),
    capabilities: {
      regionReads: true,
      resolutionLevels: false,
      planeReads: { kind: 'any-axis-pair' },
    },
  })
  const numericTileSource = {
    descriptor,
    directSemantics: {
      sourceSampleType: sampleType,
      nativeSampleType: sampleType,
      componentCount: 1,
      layout: 'interleaved' as const,
      supportedTargetSampleTypes: [sampleType, 'float64'] as const,
    },
    async *readNumericTiles(input: Readonly<NumericTileReadRequest>): AsyncGenerator<NumericTile> {
      const { targetSampleType, ...planeRequest } = input
      const request = normalizeScientificPlaneReadRequest(descriptor, planeRequest)
      tracking.reads.push(request)
      request.signal?.throwIfAborted()
      await options.beforeSamples?.(request)
      request.signal?.throwIfAborted()
      const data =
        targetSampleType === 'float64'
          ? new Float64Array(request.width * request.height)
          : options.sampleType === 'float32'
            ? new Float32Array(request.width * request.height)
            : new Uint16Array(request.width * request.height)
      const fixed = new Map(request.fixedIndices.map((entry) => [entry.axisId, entry.index]))
      for (let y = 0; y < request.height; y += 1) {
        for (let x = 0; x < request.width; x += 1) {
          const indices: Record<string, number> = {}
          for (const axis of descriptor.axes) indices[axis.id] = fixed.get(axis.id) ?? 0
          indices[request.displayAxes[0]] = request.x + x
          indices[request.displayAxes[1]] = request.y + y
          data[y * request.width + x] = sample(indices)
        }
      }
      yield Object.freeze({
        x: request.x,
        y: request.y,
        width: request.width,
        height: request.height,
        sampleType: targetSampleType ?? sampleType,
        componentCount: 1,
        layout: 'interleaved' as const,
        rowStrideElements: request.width,
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
      throw new Error('The direct native source should be selected')
    },
  })
}

const isJsonObject = (value: OperationJsonValue): value is OperationJsonObject =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

const graph = (
  operationId: string,
  parameters: AnalysisGraph['nodes'][number]['parameters'],
): AnalysisGraph => ({
  schemaVersion: 1,
  inputs: [
    {
      name: 'source',
      valueType: { id: scientificDatasetValueTypeId, version: 1 },
    },
  ],
  nodes: [
    {
      id: 'operation',
      operation: { id: operationId, version: 1 },
      inputs: [{ port: 'dataset', source: { kind: 'input', input: 'source' } }],
      parameters:
        (operationId === analysisResampleOperationId ||
          operationId === analysisGaussianBlurOperationId) &&
        isJsonObject(parameters)
          ? {
              ...parameters,
              fixedIndices: parameters.fixedIndices ?? [{ axisId: 'energy', index: 0 }],
            }
          : parameters,
    },
  ],
  outputs: [
    {
      name: 'dataset',
      source: { kind: 'node', nodeId: 'operation', output: 'dataset' },
    },
  ],
})

const executeAnalysisGraph = async (
  analysisGraph: AnalysisGraph,
  source: ScientificDataset,
  runtime: TileRuntime,
  tileSize = 2,
): Promise<AnalysisExecutionResult> => {
  const controller = createAnalysisController({
    operations: createBuiltInAnalysisOperationRegistry(),
    valueTypes: createBuiltInAnalysisValueTypeRegistry(source.descriptor),
    providers: [
      createReferenceAnalysisProvider({
        runtime,
        tileWidth: tileSize,
        tileHeight: tileSize,
        sessionId: `test-${tileSize}`,
      }),
    ],
    library: { version: '0.9.0', buildFingerprint: 'analysis-builtins-test' },
  })
  const plan = await controller.planGraph(analysisGraph, {
    bindings: {
      source: {
        value: source,
        identity: {
          kind: 'application-defined',
          namespace: 'purejsimage.tests.scientific-dataset',
          value: `fixture-${tileSize}`,
        },
        valueType: { id: scientificDatasetValueTypeId, version: 1 },
        characteristics: scientificDatasetCharacteristics(source),
      },
    },
    policy: {
      mode: 'pinned',
      providerId: 'purejsimage.analysis.reference',
      providerVersion: 1,
    },
  })
  return controller.executeGraph(plan).result
}

const executeDataset = async (
  operationId: string,
  parameters: AnalysisGraph['nodes'][number]['parameters'],
  source: ScientificDataset,
  runtime: TileRuntime,
  tileSize = 2,
): Promise<{
  readonly dataset: ScientificDataset
  readonly execution: AnalysisExecutionResult
}> => {
  const execution = await executeAnalysisGraph(
    graph(operationId, parameters),
    source,
    runtime,
    tileSize,
  )
  const output = execution.outputs.get('dataset')
  if (!isDatasetOutput(output)) {
    await execution.release()
    throw new Error('Expected a scientific dataset output')
  }
  return { dataset: output, execution }
}

const isDatasetOutput = (value: unknown): value is ScientificDataset =>
  value !== null &&
  typeof value === 'object' &&
  'descriptor' in value &&
  value.descriptor !== null &&
  typeof value.descriptor === 'object' &&
  'readPlane' in value &&
  typeof value.readPlane === 'function'

const collectValues = async (
  dataset: ScientificDataset,
  displayAxes: readonly [string, string],
  fixedIndices: readonly ScientificAxisIndex[] = [],
  signal: AbortSignal = new AbortController().signal,
): Promise<number[]> => {
  const horizontal = dataset.descriptor.axes.find((entry) => entry.id === displayAxes[0])
  const vertical = dataset.descriptor.axes.find((entry) => entry.id === displayAxes[1])
  if (horizontal === undefined || vertical === undefined) throw new Error('Missing display axis')
  const values = Array.from({ length: horizontal.length * vertical.length }, () => Number.NaN)
  for await (const tile of resolveNumericTileSource(dataset).readNumericTiles({
    displayAxes,
    fixedIndices,
    signal,
  })) {
    try {
      for (let y = 0; y < tile.height; y += 1) {
        for (let x = 0; x < tile.width; x += 1) {
          const value = tile.data[y * tile.rowStrideElements + x * tile.componentCount]
          values[(tile.y + y) * horizontal.length + tile.x + x] =
            typeof value === 'bigint' ? Number(value) : (value ?? Number.NaN)
        }
      }
    } finally {
      tile.release()
    }
  }
  return values
}

const collectRegionValues = async (
  dataset: ScientificDataset,
  x: number,
  y: number,
  width: number,
  height: number,
  signal: AbortSignal = new AbortController().signal,
): Promise<number[]> => {
  const values: number[] = []
  for await (const tile of resolveNumericTileSource(dataset).readNumericTiles({
    displayAxes: ['x', 'y'],
    fixedIndices: [{ axisId: 'energy', index: 0 }],
    x,
    y,
    width,
    height,
    signal,
  })) {
    try {
      for (let tileY = 0; tileY < tile.height; tileY += 1) {
        for (let tileX = 0; tileX < tile.width; tileX += 1) {
          const value = tile.data[tileY * tile.rowStrideElements + tileX * tile.componentCount]
          values.push(typeof value === 'bigint' ? Number(value) : (value ?? Number.NaN))
        }
      }
    } finally {
      tile.release()
    }
  }
  return values
}

const requestDatasetRegionValues = async (
  runtime: TileRuntime,
  dataset: ScientificDataset,
  x: number,
  y: number,
  width: number,
  height: number,
  signal: AbortSignal,
  scope: string,
): Promise<number[]> => {
  const source = numericTileSourceToTileSource(resolveNumericTileSource(dataset))
  const tile = await runtime.request(source, {
    address: {
      cacheClass: 'derived',
      namespace: `test-derived:${scope}`,
      dataset: {
        semantic: { kind: 'session-dataset', id: scope },
        sessionId: scope,
        generation: 0,
      },
      displayAxes: ['x', 'y'],
      fixedIndices: dataset.descriptor.axes.some((entry) => entry.id === 'energy')
        ? [{ axisId: 'energy', index: 0 }]
        : [],
      resolutionLevel: 0,
      x,
      y,
      width,
      height,
    },
    priority: 'visible',
    signal,
  })
  try {
    const values: number[] = []
    for (let tileY = 0; tileY < tile.height; tileY += 1) {
      for (let tileX = 0; tileX < tile.width; tileX += 1) {
        const value = tile.data[tileY * tile.rowStrideElements + tileX * tile.componentCount]
        values.push(typeof value === 'bigint' ? Number(value) : (value ?? Number.NaN))
      }
    }
    return values
  } finally {
    tile.release()
  }
}

const twoOperationGraph = (): AnalysisGraph => ({
  schemaVersion: 1,
  inputs: [{ name: 'source', valueType: { id: scientificDatasetValueTypeId, version: 1 } }],
  nodes: [
    {
      id: 'crop',
      operation: { id: analysisCropOperationId, version: 1 },
      inputs: [{ port: 'dataset', source: { kind: 'input', input: 'source' } }],
      parameters: { displayAxes: ['x', 'y'], x: 0, y: 0, width: 4, height: 4 },
    },
    {
      id: 'blur',
      operation: { id: analysisGaussianBlurOperationId, version: 1 },
      inputs: [{ port: 'dataset', source: { kind: 'node', nodeId: 'crop', output: 'dataset' } }],
      parameters: {
        displayAxes: ['x', 'y'],
        fixedIndices: [{ axisId: 'energy', index: 0 }],
        sigma: 0.5,
      },
    },
  ],
  outputs: [{ name: 'dataset', source: { kind: 'node', nodeId: 'blur', output: 'dataset' } }],
})

const twoCropGraph = (): AnalysisGraph => ({
  schemaVersion: 1,
  inputs: [{ name: 'source', valueType: { id: scientificDatasetValueTypeId, version: 1 } }],
  nodes: ['first', 'second'].map((id) => ({
    id,
    operation: { id: analysisCropOperationId, version: 1 },
    inputs: [{ port: 'dataset', source: { kind: 'input' as const, input: 'source' } }],
    parameters: { displayAxes: ['x', 'y'], x: 0, y: 0, width: 4, height: 4 },
  })),
  outputs: ['first', 'second'].map((name) => ({
    name,
    source: { kind: 'node' as const, nodeId: name, output: 'dataset' },
  })),
})

describe('built-in dataset analysis operations', () => {
  it('yields scheduler permits for one derived tile at maxConcurrency one', async () => {
    const tracking: SourceTracking = { reads: [], releases: 0 }
    const runtime = createTileRuntime({ limits: { maxConcurrency: 1 } })
    const source = sourceDataset(tracking, (indices) => (indices.y ?? 0) * 10 + (indices.x ?? 0))
    const derived = await executeDataset(
      analysisCropOperationId,
      { displayAxes: ['x', 'y'], x: 0, y: 0, width: 4, height: 4 },
      source,
      runtime,
    )

    await expect(
      requestDatasetRegionValues(
        runtime,
        derived.dataset,
        0,
        0,
        2,
        2,
        AbortSignal.timeout(1_000),
        'single-derived',
      ),
    ).resolves.toEqual([0, 1, 10, 11])

    await derived.execution.release()
    runtime.clear()
  })

  it('completes four concurrent derived tiles at maxConcurrency four', async () => {
    const tracking: SourceTracking = { reads: [], releases: 0 }
    const runtime = createTileRuntime({ limits: { maxConcurrency: 4 } })
    const source = sourceDataset(tracking, (indices) => (indices.y ?? 0) * 10 + (indices.x ?? 0))
    const derived = await executeDataset(
      analysisCropOperationId,
      { displayAxes: ['x', 'y'], x: 0, y: 0, width: 4, height: 4 },
      source,
      runtime,
    )
    const coordinates = [
      [0, 0],
      [2, 0],
      [0, 2],
      [2, 2],
    ] as const

    const values = await Promise.all(
      coordinates.map(([x, y], index) =>
        requestDatasetRegionValues(
          runtime,
          derived.dataset,
          x,
          y,
          2,
          2,
          AbortSignal.timeout(1_000),
          `concurrent-derived:${index}`,
        ),
      ),
    )
    expect(values).toEqual([
      [0, 1, 10, 11],
      [2, 3, 12, 13],
      [20, 21, 30, 31],
      [22, 23, 32, 33],
    ])

    await derived.execution.release()
    runtime.clear()
  })

  it('executes a crop followed by Gaussian blur at maxConcurrency one', async () => {
    const tracking: SourceTracking = { reads: [], releases: 0 }
    const runtime = createTileRuntime({ limits: { maxConcurrency: 1 } })
    const source = sourceDataset(
      tracking,
      (indices) => ((indices.x ?? 0) === 1 && (indices.y ?? 0) === 1 ? 1 : 0),
      { sampleType: 'float32' },
    )
    const execution = await executeAnalysisGraph(twoOperationGraph(), source, runtime)
    const output = execution.outputs.get('dataset')
    if (!isDatasetOutput(output)) throw new Error('Expected a chained dataset output')

    const values = await requestDatasetRegionValues(
      runtime,
      output,
      0,
      0,
      2,
      2,
      AbortSignal.timeout(1_000),
      'two-operation-chain',
    )
    expect(values).toHaveLength(4)
    expect(values.every(Number.isFinite)).toBe(true)

    await execution.release()
    runtime.clear()
  })

  it('propagates cancellation while a derived tile is blocked upstream', async () => {
    const tracking: SourceTracking = { reads: [], releases: 0 }
    const started = new Deferred<void>()
    let upstreamAborts = 0
    const source = sourceDataset(tracking, () => 1, {
      beforeSamples: async (request) => {
        started.resolve()
        const signal = request.signal
        await new Promise<void>((_resolve, reject) => {
          if (signal === undefined) {
            reject(new Error('Expected the runtime to provide an upstream AbortSignal'))
            return
          }
          const onAbort = (): void => {
            upstreamAborts += 1
            reject(signal.reason)
          }
          if (signal.aborted) onAbort()
          else signal.addEventListener('abort', onAbort, { once: true })
        })
      },
    })
    const runtime = createTileRuntime({ limits: { maxConcurrency: 1 } })
    const derived = await executeDataset(
      analysisCropOperationId,
      { displayAxes: ['x', 'y'], x: 0, y: 0, width: 4, height: 4 },
      source,
      runtime,
    )
    const abort = new AbortController()
    const pending = requestDatasetRegionValues(
      runtime,
      derived.dataset,
      0,
      0,
      2,
      2,
      abort.signal,
      'cancelled-derived',
    )
    await started.promise
    abort.abort(new Error('cancel blocked derived tile'))

    await expect(pending).rejects.toThrow('cancel blocked derived tile')
    expect(upstreamAborts).toBe(1)
    await derived.execution.release()
    runtime.clear()
  })

  it('keeps a shared upstream read alive when one derived consumer cancels', async () => {
    const tracking: SourceTracking = { reads: [], releases: 0 }
    const started = new Deferred<void>()
    const gate = new Deferred<void>()
    let upstreamAborts = 0
    const source = sourceDataset(tracking, () => 7, {
      beforeSamples: async (request) => {
        started.resolve()
        const signal = request.signal
        if (signal === undefined) return gate.promise
        await new Promise<void>((resolve, reject) => {
          const onAbort = (): void => {
            upstreamAborts += 1
            reject(signal.reason)
          }
          signal.addEventListener('abort', onAbort, { once: true })
          void gate.promise
            .then(resolve, reject)
            .finally(() => signal.removeEventListener('abort', onAbort))
        })
      },
    })
    const runtime = createTileRuntime({ limits: { maxConcurrency: 2 } })
    const execution = await executeAnalysisGraph(twoCropGraph(), source, runtime)
    const firstDataset = execution.outputs.get('first')
    const secondDataset = execution.outputs.get('second')
    if (!isDatasetOutput(firstDataset) || !isDatasetOutput(secondDataset)) {
      throw new Error('Expected two derived dataset outputs')
    }
    const firstAbort = new AbortController()
    const secondAbort = new AbortController()
    const first = requestDatasetRegionValues(
      runtime,
      firstDataset,
      0,
      0,
      2,
      2,
      firstAbort.signal,
      'shared-first',
    )
    const second = requestDatasetRegionValues(
      runtime,
      secondDataset,
      0,
      0,
      2,
      2,
      secondAbort.signal,
      'shared-second',
    )
    await started.promise
    firstAbort.abort(new Error('first derived consumer left'))

    await expect(first).rejects.toThrow('first derived consumer left')
    expect(upstreamAborts).toBe(0)
    gate.resolve()
    await expect(second).resolves.toEqual([7, 7, 7, 7])
    expect(tracking.reads).toHaveLength(1)

    await execution.release()
    runtime.clear()
  })

  it('isolates default built-in bundle cache identities within one runtime', async () => {
    const runtime = createTileRuntime()
    const executeWithDefaultBundle = async (
      input: ScientificDataset,
    ): Promise<{
      readonly dataset: ScientificDataset
      readonly execution: AnalysisExecutionResult
    }> => {
      const bundle = createBuiltInAnalysisBundle({ descriptor: input.descriptor, runtime })
      const controller = createAnalysisController({
        ...bundle,
        library: { version: '0.9.0', buildFingerprint: 'default-identity-test' },
      })
      const plan = await controller.planGraph(
        graph(analysisCropOperationId, {
          displayAxes: ['x', 'y'],
          x: 0,
          y: 0,
          width: 4,
          height: 4,
        }),
        {
          bindings: {
            source: {
              value: input,
              identity: {
                kind: 'application-defined',
                namespace: 'purejsimage.tests.scientific-dataset',
                value: 'default-bundle-fixture',
              },
              valueType: { id: scientificDatasetValueTypeId, version: 1 },
              characteristics: scientificDatasetCharacteristics(input),
            },
          },
        },
      )
      const execution = await controller.executeGraph(plan).result
      const output = execution.outputs.get('dataset')
      if (!isDatasetOutput(output)) throw new Error('Expected a default-bundle dataset output')
      return { dataset: output, execution }
    }
    const firstTracking: SourceTracking = { reads: [], releases: 0 }
    const secondTracking: SourceTracking = { reads: [], releases: 0 }
    const first = await executeWithDefaultBundle(sourceDataset(firstTracking, () => 3))
    const second = await executeWithDefaultBundle(sourceDataset(secondTracking, () => 9))

    expect(await collectRegionValues(first.dataset, 0, 0, 2, 2)).toEqual([3, 3, 3, 3])
    expect(await collectRegionValues(second.dataset, 0, 0, 2, 2)).toEqual([9, 9, 9, 9])
    expect(firstTracking.reads).toHaveLength(1)
    expect(secondTracking.reads).toHaveLength(1)

    await first.execution.release()
    await second.execution.release()
    runtime.clear()
  })

  it('reuses source and threshold tiles across reopened strongly identified datasets', async () => {
    const runtime = createTileRuntime()
    const identity = {
      kind: 'scientific-dataset' as const,
      reader: { id: 'test.reader', version: '1.0.0' },
      datasetId: 'primary',
      resources: [
        {
          id: 'primary',
          identity: {
            kind: 'content' as const,
            strength: 'strong' as const,
            stability: 'content-addressed' as const,
            algorithm: 'sha256' as const,
            digest: 'a'.repeat(64),
            size: 64,
          },
        },
      ],
    }
    const firstTracking: SourceTracking = { reads: [], releases: 0 }
    const secondTracking: SourceTracking = { reads: [], releases: 0 }
    const firstSource = identifyScientificDataset(
      sourceDataset(firstTracking, (indices) => (indices.x ?? 0) + (indices.y ?? 0)),
      identity,
    )
    const secondSource = identifyScientificDataset(
      sourceDataset(secondTracking, (indices) => (indices.x ?? 0) + (indices.y ?? 0)),
      identity,
    )
    const parameters = { mode: 'greater-than', threshold: 1 }
    const first = await executeDataset(
      analysisThresholdOperationId,
      parameters,
      firstSource,
      runtime,
    )
    await collectValues(first.dataset, ['x', 'y'], [{ axisId: 'energy', index: 0 }])
    await first.execution.release()
    const hitsBefore = runtime.metrics().cache.hits
    const second = await executeDataset(
      analysisThresholdOperationId,
      parameters,
      secondSource,
      runtime,
    )
    await collectValues(second.dataset, ['x', 'y'], [{ axisId: 'energy', index: 0 }])
    expect(secondTracking.reads).toHaveLength(0)
    expect(runtime.metrics().cache.hits).toBeGreaterThan(hitsBefore)
    await second.execution.release()
    runtime.clear()
  })

  it('infers and lazily executes calibrated arbitrary-axis crop with region pushdown', async () => {
    const tracking: SourceTracking = { reads: [], releases: 0 }
    const source = sourceDataset(
      tracking,
      (indices) => (indices.energy ?? 0) * 100 + (indices.y ?? 0) * 10 + (indices.x ?? 0),
    )
    const runtime = createTileRuntime()
    const controller = createAnalysisController({
      operations: createBuiltInAnalysisOperationRegistry(),
      valueTypes: createBuiltInAnalysisValueTypeRegistry(source.descriptor),
      providers: [createReferenceAnalysisProvider({ runtime, sessionId: 'inference' })],
      library: { version: '0.9.0', buildFingerprint: 'inference-test' },
    })
    const planned = await controller.planGraph(
      graph(analysisCropOperationId, { displayAxes: ['x', 'y'], x: 1, y: 1, width: 2, height: 2 }),
      {
        bindings: {
          source: {
            value: source,
            identity: {
              kind: 'application-defined',
              namespace: 'purejsimage.tests.scientific-dataset',
              value: 'crop-fixture',
            },
            characteristics: scientificDatasetCharacteristics(source),
          },
        },
      },
    )
    expect(tracking.reads).toHaveLength(0)
    const inferred = planned.summary.nodes[0]?.outputShapes?.[0]
    expect(inferred).toMatchObject({
      kind: 'scientific-dataset',
      descriptor: {
        axes: [
          { id: 'x', length: 2, coordinates: { type: 'linear', origin: 12, step: 2 } },
          { id: 'y', length: 2, coordinates: { type: 'lookup', values: [2, 4] } },
          { id: 'energy', length: 3 },
        ],
      },
    })
    const execution = await controller.executeGraph(planned).result
    expect(tracking.reads).toHaveLength(0)
    const output = execution.outputs.get('dataset')
    if (!isDatasetOutput(output)) throw new Error('Missing output')
    expect(await collectValues(output, ['x', 'y'], [{ axisId: 'energy', index: 2 }])).toEqual([
      211, 212, 221, 222,
    ])
    expect(tracking.reads).toHaveLength(1)
    expect(tracking.reads[0]).toMatchObject({ x: 1, y: 1, width: 2, height: 2 })
    await execution.release()
    runtime.clear()
    expect(tracking.releases).toBe(1)
  })

  it('slices any pair of labeled axes without materializing the remaining dimensions', async () => {
    const tracking: SourceTracking = { reads: [], releases: 0 }
    const source = sourceDataset(
      tracking,
      (indices) => (indices.energy ?? 0) * 100 + (indices.y ?? 0) * 10 + (indices.x ?? 0),
    )
    const runtime = createTileRuntime()
    const { dataset, execution } = await executeDataset(
      analysisSliceOperationId,
      { displayAxes: ['energy', 'x'], fixedIndices: [{ axisId: 'y', index: 2 }] },
      source,
      runtime,
    )
    expect(dataset.descriptor.axes.map((entry) => entry.id)).toEqual(['energy', 'x'])
    expect(await collectValues(dataset, ['energy', 'x'])).toEqual([
      20, 120, 220, 21, 121, 221, 22, 122, 222, 23, 123, 223,
    ])
    expect(
      tracking.reads.every((entry) => (entry.width ?? 0) <= 2 && (entry.height ?? 0) <= 2),
    ).toBe(true)
    await execution.release()
    runtime.clear()
    expect(tracking.releases).toBe(tracking.reads.length)
  })

  it('keeps nearest integer samples exact and makes bilinear floating output explicit', async () => {
    const tracking: SourceTracking = { reads: [], releases: 0 }
    const source = sourceDataset(tracking, (indices) => (indices.y ?? 0) * 10 + (indices.x ?? 0))
    const nearestRuntime = createTileRuntime()
    const nearest = await executeDataset(
      analysisResampleOperationId,
      { displayAxes: ['x', 'y'], width: 2, height: 2, kernel: 'nearest' },
      source,
      nearestRuntime,
    )
    expect(nearest.dataset.descriptor.sampleType).toBe('uint16')
    expect(nearest.dataset.descriptor.axes.map((entry) => entry.id)).toEqual(['x', 'y'])
    expect(await collectValues(nearest.dataset, ['x', 'y'])).toEqual([11, 13, 31, 33])
    expect(nearest.dataset.descriptor.axes[0]).toMatchObject({
      coordinates: { type: 'linear', origin: 11, step: 4 },
    })
    await nearest.execution.release()
    nearestRuntime.clear()

    const bilinearRuntime = createTileRuntime()
    const bilinear = await executeDataset(
      analysisResampleOperationId,
      { displayAxes: ['x', 'y'], width: 2, height: 2, kernel: 'bilinear' },
      source,
      bilinearRuntime,
    )
    expect(bilinear.dataset.descriptor.sampleType).toBe('float32')
    expect(await collectValues(bilinear.dataset, ['x', 'y'])).toEqual([5.5, 7.5, 25.5, 27.5])
    await bilinear.execution.release()
    bilinearRuntime.clear()

    const invalidTracking: SourceTracking = { reads: [], releases: 0 }
    const invalidSource = sourceDataset(
      invalidTracking,
      (indices) =>
        (indices.x ?? 0) === 1 && (indices.y ?? 0) === 1
          ? 65_535
          : (indices.y ?? 0) * 10 + (indices.x ?? 0),
      { noDataValue: 65_535 },
    )
    const propagateRuntime = createTileRuntime()
    const propagate = await executeDataset(
      analysisResampleOperationId,
      {
        displayAxes: ['x', 'y'],
        width: 2,
        height: 2,
        kernel: 'bilinear',
        invalidPolicy: 'propagate',
      },
      invalidSource,
      propagateRuntime,
    )
    expect((await collectValues(propagate.dataset, ['x', 'y']))[0]).toBeNaN()
    await propagate.execution.release()
    propagateRuntime.clear()
    const ignoreRuntime = createTileRuntime()
    const ignore = await executeDataset(
      analysisResampleOperationId,
      {
        displayAxes: ['x', 'y'],
        width: 2,
        height: 2,
        kernel: 'bilinear',
        invalidPolicy: 'ignore',
      },
      invalidSource,
      ignoreRuntime,
    )
    expect((await collectValues(ignore.dataset, ['x', 'y']))[0]).toBeCloseTo(11 / 3, 6)
    await ignore.execution.release()
    ignoreRuntime.clear()
  })

  it('projects in deterministic reduction order with exact integer extrema and explicit invalid policy', async () => {
    const tracking: SourceTracking = { reads: [], releases: 0 }
    const source = sourceDataset(
      tracking,
      (indices) =>
        (indices.energy ?? 0) === 1 && (indices.x ?? 0) === 0
          ? 65_535
          : (indices.energy ?? 0) * 100 + (indices.y ?? 0) * 10 + (indices.x ?? 0),
      { noDataValue: 65_535 },
    )
    const runtime = createTileRuntime()
    const maximum = await executeDataset(
      analysisProjectionOperationId,
      {
        displayAxes: ['x', 'y'],
        fixedIndices: [],
        reductionAxis: 'energy',
        mode: 'max',
        invalidPolicy: 'ignore',
      },
      source,
      runtime,
    )
    expect(maximum.dataset.descriptor.sampleType).toBe('uint16')
    expect((await collectValues(maximum.dataset, ['x', 'y'])).slice(0, 4)).toEqual([
      200, 201, 202, 203,
    ])
    expect(tracking.reads.map((entry) => entry.fixedIndices[0]?.index).slice(0, 3)).toEqual([
      0, 1, 2,
    ])
    expect(maximum.execution.provenance.nodes[0]).toMatchObject({
      provider: { id: 'purejsimage.analysis.reference' },
      implementation: { implementationVersion: '1.0.0' },
    })
    await maximum.execution.release()
    runtime.clear()

    const minimumRuntime = createTileRuntime()
    const minimum = await executeDataset(
      analysisProjectionOperationId,
      {
        displayAxes: ['x', 'y'],
        fixedIndices: [],
        reductionAxis: 'energy',
        mode: 'min',
        invalidPolicy: 'ignore',
      },
      source,
      minimumRuntime,
    )
    expect((await collectValues(minimum.dataset, ['x', 'y'])).slice(0, 4)).toEqual([0, 1, 2, 3])
    await minimum.execution.release()
    minimumRuntime.clear()

    const meanRuntime = createTileRuntime()
    const mean = await executeDataset(
      analysisProjectionOperationId,
      {
        displayAxes: ['x', 'y'],
        fixedIndices: [],
        reductionAxis: 'energy',
        mode: 'mean',
        invalidPolicy: 'ignore',
      },
      source,
      meanRuntime,
    )
    expect(mean.dataset.descriptor.sampleType).toBe('float64')
    expect((await collectValues(mean.dataset, ['x', 'y'])).slice(0, 4)).toEqual([
      100, 101, 102, 103,
    ])
    await mean.execution.release()
    meanRuntime.clear()
  })

  it('propagates cancellation before a lazy source read and releases graph outputs explicitly', async () => {
    const tracking: SourceTracking = { reads: [], releases: 0 }
    const source = sourceDataset(tracking, (indices) => indices.x ?? 0)
    const runtime = createTileRuntime()
    const { dataset, execution } = await executeDataset(
      analysisSliceOperationId,
      { displayAxes: ['x', 'y'], fixedIndices: [{ axisId: 'energy', index: 0 }] },
      source,
      runtime,
    )
    const abort = new AbortController()
    abort.abort(new Error('cancelled before read'))
    const iterator = resolveNumericTileSource(dataset)
      .readNumericTiles({
        displayAxes: ['x', 'y'],
        fixedIndices: [],
        signal: abort.signal,
      })
      [Symbol.asyncIterator]()
    await expect(iterator.next()).rejects.toThrow('cancelled before read')
    expect(tracking.reads).toHaveLength(0)
    await execution.release()
    runtime.clear()
  })

  it('keeps a lazy provider plan leased through the first tile read while disposal waits', async () => {
    const tracking: SourceTracking = { reads: [], releases: 0 }
    const source = sourceDataset(tracking, (indices) => (indices.x ?? 0) + (indices.y ?? 0), {
      sampleType: 'float32',
    })
    const runtime = createTileRuntime()
    const controller = createAnalysisController({
      operations: createBuiltInAnalysisOperationRegistry(),
      valueTypes: createBuiltInAnalysisValueTypeRegistry(source.descriptor),
      providers: [createReferenceAnalysisProvider({ runtime, sessionId: 'lazy-lease' })],
      library: { version: '0.9.0', buildFingerprint: 'lazy-lease-test' },
    })
    const plan = await controller.planGraph(
      graph(analysisGaussianBlurOperationId, {
        displayAxes: ['x', 'y'],
        fixedIndices: [{ axisId: 'energy', index: 0 }],
        sigma: 0.5,
      }),
      {
        bindings: {
          source: {
            value: source,
            identity: {
              kind: 'application-defined',
              namespace: 'purejsimage.tests.scientific-dataset',
              value: 'lazy-lease-fixture',
            },
            characteristics: scientificDatasetCharacteristics(source),
          },
        },
      },
    )
    const execution = await controller.executeGraph(plan).result
    const output = execution.outputs.get('dataset')
    if (!isDatasetOutput(output)) throw new Error('Expected lazy dataset output')
    let disposed = false
    const disposal = plan.dispose().then(() => {
      disposed = true
    })
    await Promise.resolve()
    expect(disposed).toBe(false)
    expect(await collectValues(output, ['x', 'y'])).toHaveLength(16)
    await execution.release()
    await disposal
    expect(disposed).toBe(true)
    runtime.clear()
  })

  it('thresholds scalar samples to an exact 0/1 uint8 mask across tile sizes', async () => {
    const firstTracking: SourceTracking = { reads: [], releases: 0 }
    const secondTracking: SourceTracking = { reads: [], releases: 0 }
    const sample = (indices: Readonly<Record<string, number>>): number =>
      (indices.y ?? 0) * 10 + (indices.x ?? 0)
    const parameters = {
      mode: 'greater-or-equal',
      threshold: 12,
      invalidOutput: 1,
    }
    const firstRuntime = createTileRuntime()
    const secondRuntime = createTileRuntime()
    const first = await executeDataset(
      analysisThresholdOperationId,
      parameters,
      sourceDataset(firstTracking, sample, { sampleType: 'float32', noDataValue: 22 }),
      firstRuntime,
      1,
    )
    const second = await executeDataset(
      analysisThresholdOperationId,
      parameters,
      sourceDataset(secondTracking, sample, { sampleType: 'float32', noDataValue: 22 }),
      secondRuntime,
      3,
    )
    const expected = [0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1]
    expect(first.dataset.descriptor).toMatchObject({
      sampleType: 'uint8',
      components: [{ id: 'mask' }],
      metadata: { maskFalseValue: 0, maskTrueValue: 1 },
    })
    expect(
      await collectValues(first.dataset, ['x', 'y'], [{ axisId: 'energy', index: 0 }]),
    ).toEqual(expected)
    expect(
      await collectValues(second.dataset, ['x', 'y'], [{ axisId: 'energy', index: 0 }]),
    ).toEqual(expected)
    await first.execution.release()
    await second.execution.release()
    firstRuntime.clear()
    secondRuntime.clear()
    expect(firstTracking.releases).toBe(firstTracking.reads.length)
    expect(secondTracking.releases).toBe(secondTracking.reads.length)
  })

  it('produces seam-free Gaussian blur across tile sizes and explicit boundaries', async () => {
    const sample = (indices: Readonly<Record<string, number>>): number =>
      (indices.x ?? 0) === 1 && (indices.y ?? 0) === 1 ? 1 : 0
    const parameters = {
      displayAxes: ['x', 'y'],
      component: 0,
      sigma: 1,
      boundary: 'mirror',
      constantValue: 0,
      invalidPolicy: 'propagate',
    }
    const firstTracking: SourceTracking = { reads: [], releases: 0 }
    const secondTracking: SourceTracking = { reads: [], releases: 0 }
    const firstRuntime = createTileRuntime()
    const secondRuntime = createTileRuntime()
    const first = await executeDataset(
      analysisGaussianBlurOperationId,
      parameters,
      sourceDataset(firstTracking, sample, { sampleType: 'float32' }),
      firstRuntime,
      1,
    )
    const second = await executeDataset(
      analysisGaussianBlurOperationId,
      parameters,
      sourceDataset(secondTracking, sample, { sampleType: 'float32' }),
      secondRuntime,
      3,
    )
    const firstValues = await collectValues(first.dataset, ['x', 'y'], [])
    const secondValues = await collectValues(second.dataset, ['x', 'y'], [])
    expect(first.dataset.descriptor).toMatchObject({
      sampleType: 'float32',
      metadata: { gaussianRadiusPixels: 3, gaussianBoundary: 'mirror' },
    })
    expect(first.dataset.descriptor.axes.map((entry) => entry.id)).toEqual(['x', 'y'])
    await expect(
      collectValues(first.dataset, ['x', 'y'], [{ axisId: 'energy', index: 0 }]),
    ).rejects.toThrow('unknown axis energy')
    expect(firstValues).toEqual(secondValues)
    expect(firstValues[5]).toBeGreaterThan(firstValues[15] ?? 0)
    const beforeCancelledRead = firstTracking.reads.length
    const cancelled = new AbortController()
    cancelled.abort(new Error('cancelled blur tile'))
    const cancelledIterator = resolveNumericTileSource(first.dataset)
      .readNumericTiles({
        displayAxes: ['x', 'y'],
        fixedIndices: [{ axisId: 'energy', index: 0 }],
        signal: cancelled.signal,
      })
      [Symbol.asyncIterator]()
    await expect(cancelledIterator.next()).rejects.toThrow('cancelled blur tile')
    expect(firstTracking.reads).toHaveLength(beforeCancelledRead)
    await first.execution.release()
    await second.execution.release()
    firstRuntime.clear()
    secondRuntime.clear()
    expect(firstTracking.releases).toBe(firstTracking.reads.length)
    expect(secondTracking.releases).toBe(secondTracking.reads.length)

    for (const boundary of ['clamp', 'mirror'] as const) {
      const tracking: SourceTracking = { reads: [], releases: 0 }
      const runtime = createTileRuntime()
      const constant = await executeDataset(
        analysisGaussianBlurOperationId,
        { ...parameters, boundary },
        sourceDataset(tracking, () => 5, { sampleType: 'float32' }),
        runtime,
      )
      const values = await collectValues(constant.dataset, ['x', 'y'])
      expect(values.every((value) => Math.abs(value - 5) <= 1e-5)).toBe(true)
      await constant.execution.release()
      runtime.clear()
    }
    const constantTracking: SourceTracking = { reads: [], releases: 0 }
    const constantRuntime = createTileRuntime()
    const constantBoundary = await executeDataset(
      analysisGaussianBlurOperationId,
      { ...parameters, boundary: 'constant' },
      sourceDataset(constantTracking, () => 5, { sampleType: 'float32' }),
      constantRuntime,
    )
    const constantValues = await collectValues(constantBoundary.dataset, ['x', 'y'])
    expect(constantValues[0]).toBeLessThan(5)
    await constantBoundary.execution.release()
    constantRuntime.clear()

    const blurDefinition = createBuiltInAnalysisOperationRegistry().get(
      analysisGaussianBlurOperationId,
      1,
    )
    expect(
      blurDefinition?.normalizeParameters({ displayAxes: ['x', 'y'], fixedIndices: [], sigma: 64 })
        .valid,
    ).toBe(true)
    expect(
      blurDefinition?.normalizeParameters({
        displayAxes: ['x', 'y'],
        fixedIndices: [],
        sigma: 64.01,
      }).valid,
    ).toBe(false)
  })

  it('lets an accelerated provider decline unsupported Gaussian boundary semantics', async () => {
    const tracking: SourceTracking = { reads: [], releases: 0 }
    const source = sourceDataset(tracking, () => 1, { sampleType: 'float32' })
    const runtime = createTileRuntime()
    const accelerated = createOperationProvider({
      descriptor: {
        id: 'example.gaussian.accelerator',
        version: 1,
        kind: 'wasm',
        buildFingerprint: 'test-only-decline',
      },
      prepare: async () => [
        {
          descriptor: {
            operationId: analysisGaussianBlurOperationId,
            operationVersion: 1,
            implementationVersion: 'test-only',
          },
          supportsPlan(request) {
            const parameters = request.parameters
            return (
              parameters !== null &&
              typeof parameters === 'object' &&
              !Array.isArray(parameters) &&
              'boundary' in parameters &&
              parameters.boundary === 'clamp'
            )
          },
          estimatePlan: () => ({
            setupMilliseconds: 0,
            transferMilliseconds: 0,
            computeMilliseconds: 0,
            readbackMilliseconds: 0,
            retainedBytes: 1,
            peakWorkingBytes: 1,
            transferBytes: 0,
            outputBytes: 1,
            confidence: 1,
          }),
          execute() {
            throw new Error('Declined provider must not execute')
          },
        },
      ],
    })
    const controller = createAnalysisController({
      operations: createBuiltInAnalysisOperationRegistry(),
      valueTypes: createBuiltInAnalysisValueTypeRegistry(source.descriptor),
      providers: [accelerated, createReferenceAnalysisProvider({ runtime, sessionId: 'fallback' })],
      library: { version: '0.9.0', buildFingerprint: 'provider-fallback-test' },
    })
    const planned = await controller.planGraph(
      graph(analysisGaussianBlurOperationId, {
        displayAxes: ['x', 'y'],
        sigma: 1,
        boundary: 'mirror',
      }),
      {
        bindings: {
          source: {
            value: source,
            identity: {
              kind: 'application-defined',
              namespace: 'purejsimage.tests.scientific-dataset',
              value: 'accelerated-fixture',
            },
            characteristics: scientificDatasetCharacteristics(source),
          },
        },
      },
    )
    expect(planned.summary.nodes[0]?.provider.id).toBe('purejsimage.analysis.reference')
    runtime.clear()
  })

  it('rejects provider tile kernels that alias threshold or Gaussian source storage', async () => {
    for (const [operationId, parameters] of [
      [analysisThresholdOperationId, { mode: 'greater-than', threshold: 0 }],
      [
        analysisGaussianBlurOperationId,
        { displayAxes: ['x', 'y'], fixedIndices: [{ axisId: 'energy', index: 0 }], sigma: 1 },
      ],
    ] as const) {
      const runtime = createTileRuntime()
      const source = sourceDataset({ reads: [], releases: 0 }, () => 1, { sampleType: 'float32' })
      const reference = createReferenceAnalysisProvider({
        runtime,
        sessionId: `alias-${operationId}`,
      })
      const prepared = await reference.prepare()
      const base = prepared?.implementations.find(
        (candidate) => candidate.descriptor.operationId === operationId,
      )
      if (base?.tileKernel === undefined) throw new Error('Expected a reference tile kernel')
      const aliasing: OperationImplementation = Object.freeze({
        ...base,
        descriptor: Object.freeze({
          ...base.descriptor,
          implementationVersion: 'aliasing-test',
        }),
        tileKernel: Object.freeze({
          ...base.tileKernel,
          async execute(request: Readonly<OperationTileKernelRequest>) {
            return Object.freeze({
              value: request.sourceTile,
              ownershipIdentity: request.sourceTile.data.buffer,
              release() {},
            })
          },
        }),
      })
      const alternate = createOperationProvider({
        descriptor: {
          id: `aaa.alias.${operationId.split('.').at(-1)?.replaceAll('-', '.')}`,
          version: 1,
          kind: 'wasm',
          buildFingerprint: 'aliasing-test',
        },
        prepare: async () => [aliasing],
      })
      const controller = createAnalysisController({
        operations: createBuiltInAnalysisOperationRegistry(),
        valueTypes: createBuiltInAnalysisValueTypeRegistry(source.descriptor),
        providers: [alternate, reference],
        library: { version: '0.9.0', buildFingerprint: 'aliasing-test' },
      })
      const plan = await controller.planGraph(graph(operationId, parameters), {
        bindings: {
          source: {
            value: source,
            identity: {
              kind: 'application-defined',
              namespace: 'purejsimage.tests.aliasing',
              value: operationId,
            },
            characteristics: scientificDatasetCharacteristics(source),
          },
        },
      })
      expect(plan.summary.nodes[0]?.provider.id).toContain('aaa.alias')
      const execution = await controller.executeGraph(plan).result
      const output = execution.outputs.get('dataset')
      if (!isDatasetOutput(output)) throw new Error('Expected a lazy dataset output')
      await expect(
        collectValues(
          output,
          ['x', 'y'],
          output.descriptor.axes.some((entry) => entry.id === 'energy')
            ? [{ axisId: 'energy', index: 0 }]
            : [],
        ),
      ).rejects.toThrow('input storage')
      await execution.release()
      runtime.clear()
    }
  })
})
