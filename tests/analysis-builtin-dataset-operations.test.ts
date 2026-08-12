import { describe, expect, it } from 'vitest'
import {
  analysisCropOperationId,
  analysisGaussianBlurOperationId,
  analysisProjectionOperationId,
  analysisResampleOperationId,
  analysisSliceOperationId,
  analysisThresholdOperationId,
  createAnalysisController,
  createBuiltInAnalysisOperationRegistry,
  createBuiltInAnalysisValueTypeRegistry,
  createReferenceAnalysisProvider,
  createTileRuntime,
  scientificDatasetCharacteristics,
  scientificDatasetValueTypeId,
} from '../src/analysis/index.ts'
import type { AnalysisExecutionResult, AnalysisGraph, TileRuntime } from '../src/analysis/index.ts'
import { createOperationProvider } from '../src/operations/index.ts'
import type {
  DirectNumericTileDataset,
  NumericTile,
  NumericTileReadRequest,
  ScientificAxisIndex,
  ScientificDataset,
} from '../src/scientific/index.ts'
import {
  normalizeScientificDatasetDescriptor,
  normalizeScientificPlaneReadRequest,
  resolveNumericTileSource,
} from '../src/scientific/index.ts'

interface SourceTracking {
  readonly reads: NumericTileReadRequest[]
  releases: number
}

const sourceDataset = (
  tracking: SourceTracking,
  sample: (indices: Readonly<Record<string, number>>) => number,
  options: { readonly sampleType?: 'uint16' | 'float32'; readonly noDataValue?: number } = {},
): DirectNumericTileDataset => {
  const sampleType = options.sampleType ?? 'uint16'
  const descriptor = normalizeScientificDatasetDescriptor({
    schemaVersion: 2,
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
    capabilities: { regionReads: true, resolutionLevels: false },
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
      parameters,
    },
  ],
  outputs: [
    {
      name: 'dataset',
      source: { kind: 'node', nodeId: 'operation', output: 'dataset' },
    },
  ],
})

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
  const plan = await controller.planGraph(graph(operationId, parameters), {
    bindings: {
      source: {
        value: source,
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
  const execution = await controller.executeGraph(plan).result
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
): Promise<number[]> => {
  const horizontal = dataset.descriptor.axes.find((entry) => entry.id === displayAxes[0])
  const vertical = dataset.descriptor.axes.find((entry) => entry.id === displayAxes[1])
  if (horizontal === undefined || vertical === undefined) throw new Error('Missing display axis')
  const values = Array.from({ length: horizontal.length * vertical.length }, () => Number.NaN)
  for await (const tile of resolveNumericTileSource(dataset).readNumericTiles({
    displayAxes,
    fixedIndices,
    signal: new AbortController().signal,
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

describe('built-in dataset analysis operations', () => {
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
    expect(
      await collectValues(nearest.dataset, ['x', 'y'], [{ axisId: 'energy', index: 0 }]),
    ).toEqual([11, 13, 31, 33])
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
    expect(
      await collectValues(bilinear.dataset, ['x', 'y'], [{ axisId: 'energy', index: 0 }]),
    ).toEqual([5.5, 7.5, 25.5, 27.5])
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
    expect(
      (await collectValues(propagate.dataset, ['x', 'y'], [{ axisId: 'energy', index: 0 }]))[0],
    ).toBeNaN()
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
    expect(
      (await collectValues(ignore.dataset, ['x', 'y'], [{ axisId: 'energy', index: 0 }]))[0],
    ).toBeCloseTo(11 / 3, 6)
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
    const firstValues = await collectValues(
      first.dataset,
      ['x', 'y'],
      [{ axisId: 'energy', index: 0 }],
    )
    const secondValues = await collectValues(
      second.dataset,
      ['x', 'y'],
      [{ axisId: 'energy', index: 0 }],
    )
    expect(first.dataset.descriptor).toMatchObject({
      sampleType: 'float32',
      metadata: { gaussianRadiusPixels: 3, gaussianBoundary: 'mirror' },
    })
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
      const values = await collectValues(
        constant.dataset,
        ['x', 'y'],
        [{ axisId: 'energy', index: 0 }],
      )
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
    const constantValues = await collectValues(
      constantBoundary.dataset,
      ['x', 'y'],
      [{ axisId: 'energy', index: 0 }],
    )
    expect(constantValues[0]).toBeLessThan(5)
    await constantBoundary.execution.release()
    constantRuntime.clear()

    const blurDefinition = createBuiltInAnalysisOperationRegistry().get(
      analysisGaussianBlurOperationId,
      1,
    )
    expect(blurDefinition?.normalizeParameters({ displayAxes: ['x', 'y'], sigma: 64 }).valid).toBe(
      true,
    )
    expect(
      blurDefinition?.normalizeParameters({ displayAxes: ['x', 'y'], sigma: 64.01 }).valid,
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
          supports(request) {
            const parameters = request.parameters
            return (
              parameters !== null &&
              typeof parameters === 'object' &&
              !Array.isArray(parameters) &&
              'boundary' in parameters &&
              parameters.boundary === 'clamp'
            )
          },
          estimate: () => ({
            setupMilliseconds: 0,
            transferMilliseconds: 0,
            computeMilliseconds: 0,
            readbackMilliseconds: 0,
            retainedBytes: 1,
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
          source: { value: source, characteristics: scientificDatasetCharacteristics(source) },
        },
      },
    )
    expect(planned.summary.nodes[0]?.provider.id).toBe('purejsimage.analysis.reference')
    runtime.clear()
  })
})
