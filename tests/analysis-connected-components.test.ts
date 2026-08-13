import { describe, expect, it } from 'vitest'
import {
  analysisConnectedComponentsOperationId,
  createBuiltInAnalysisOperationRegistry,
  createReferenceAnalysisProvider,
  scientificDatasetCharacteristics,
} from '../src/analysis/index.ts'
import { inspectConnectedComponentsMemoryPlan } from '../src/analysis/connected-components.ts'
import { summarizeResult, type TableResult } from '../src/analysis/results.ts'
import { createTileRuntime } from '../src/analysis/runtime.ts'
import type {
  DirectNumericTileDataset,
  NumericTile,
  NumericTileReadRequest,
  ScientificDataset,
} from '../src/scientific/index.ts'
import {
  normalizeScientificDatasetDescriptor,
  normalizeScientificPlaneReadRequest,
} from '../src/scientific/index.ts'

const descriptor = normalizeScientificDatasetDescriptor({
  schemaVersion: 1,
  axes: [
    {
      id: 'x',
      kind: 'space',
      length: 6,
      unit: 'µm',
      coordinates: { type: 'linear', origin: 10, step: 2 },
    },
    {
      id: 'y',
      kind: 'space',
      length: 5,
      unit: 'µm',
      coordinates: { type: 'linear', origin: 20, step: 3 },
    },
  ],
  sampleType: 'uint8',
  components: [{ id: 'mask', kind: 'scalar' }],
  capabilities: {
    regionReads: true,
    resolutionLevels: false,
    planeReads: { kind: 'ordered-axis-pairs', pairs: [['x', 'y']] },
  },
})

interface DatasetHooks {
  readonly onRead?: () => void
  readonly onRelease?: () => void
}

const dataset = (
  values: Uint8Array,
  sourceDescriptor = descriptor,
  hooks: Readonly<DatasetHooks> = {},
): DirectNumericTileDataset =>
  Object.freeze({
    descriptor: sourceDescriptor,
    numericTileSource: Object.freeze({
      descriptor: sourceDescriptor,
      directSemantics: Object.freeze({
        sourceSampleType: 'uint8' as const,
        nativeSampleType: 'uint8' as const,
        componentCount: 1,
        layout: 'interleaved' as const,
        supportedTargetSampleTypes: ['uint8'] as const,
      }),
      async *readNumericTiles(
        input: Readonly<NumericTileReadRequest>,
      ): AsyncGenerator<NumericTile> {
        hooks.onRead?.()
        const { targetSampleType: _targetSampleType, ...planeRequest } = input
        const request = normalizeScientificPlaneReadRequest(sourceDescriptor, planeRequest)
        request.signal?.throwIfAborted()
        const data = new Uint8Array(request.width * request.height)
        const sourceWidth = sourceDescriptor.axes.find(({ id }) => id === 'x')?.length
        if (sourceWidth === undefined) throw new Error('Fixture is missing its x axis')
        for (let y = 0; y < request.height; y += 1) {
          for (let x = 0; x < request.width; x += 1) {
            data[y * request.width + x] = values[(request.y + y) * sourceWidth + request.x + x] ?? 0
          }
        }
        yield Object.freeze({
          x: request.x,
          y: request.y,
          width: request.width,
          height: request.height,
          sampleType: 'uint8' as const,
          componentCount: 1,
          layout: 'interleaved' as const,
          rowStrideElements: request.width,
          data,
          release() {
            hooks.onRelease?.()
          },
        })
      },
    }),
    readPlane() {
      throw new Error('Connected-components fixture expects native tile reads')
    },
  })

const labels = async (source: ScientificDataset): Promise<readonly number[]> => {
  const values: number[] = []
  const sourceWidth = source.descriptor.axes.find(({ id }) => id === 'x')?.length
  if (sourceWidth === undefined) throw new Error('Label dataset is missing its x axis')
  for await (const block of source.readPlane({ displayAxes: ['x', 'y'], fixedIndices: [] })) {
    const view = new DataView(block.data.buffer, block.data.byteOffset, block.data.byteLength)
    for (let y = 0; y < block.height; y += 1) {
      for (let x = 0; x < block.width; x += 1) {
        values[(block.y + y) * sourceWidth + block.x + x] = view.getUint32(
          y * block.stride + x * 4,
          false,
        )
      }
    }
    block.release?.()
  }
  return values
}

const execute = async (
  values: Uint8Array,
  connectivity: 4 | 8,
  tileSize: number,
  options: Readonly<{
    descriptor?: typeof descriptor
    concurrency?: number
    disposeAfterReads?: number
    signal?: AbortSignal
    hooks?: DatasetHooks
    maxOperationWorkingBytes?: number
    maxTotalManagedBytes?: number
  }> = {},
) => {
  const runtime = createTileRuntime({
    limits: {
      maxOperationWorkingBytes: options.maxOperationWorkingBytes ?? 4 * 1_024 * 1_024,
      ...(options.maxTotalManagedBytes === undefined
        ? {}
        : { maxTotalManagedBytes: options.maxTotalManagedBytes }),
      ...(options.concurrency === undefined ? {} : { maxConcurrency: options.concurrency }),
    },
  })
  const provider = createReferenceAnalysisProvider({
    runtime,
    tileWidth: tileSize,
    tileHeight: tileSize,
    sessionId: `cc-${connectivity}-${tileSize}`,
  })
  const prepared = await provider.prepare()
  if (prepared === undefined) throw new Error('Reference provider was unavailable')
  const implementation = prepared.implementations.find(
    (entry) => entry.descriptor.operationId === analysisConnectedComponentsOperationId,
  )
  const definition = createBuiltInAnalysisOperationRegistry().get(
    analysisConnectedComponentsOperationId,
    1,
  )
  if (implementation === undefined || definition === undefined) {
    throw new Error('Connected-components implementation was unavailable')
  }
  const normalized = definition.normalizeParameters({
    displayAxes: ['x', 'y'],
    fixedIndices: [],
    component: 0,
    connectivity,
  })
  if (normalized.value === undefined) throw new Error('Connected-components parameters failed')
  let sourceReads = 0
  let disposal: Promise<void> | undefined
  const source = dataset(values, options.descriptor ?? descriptor, {
    onRead() {
      sourceReads += 1
      options.hooks?.onRead?.()
      if (sourceReads === options.disposeAfterReads) disposal = runtime.dispose()
    },
    ...(options.hooks?.onRelease === undefined ? {} : { onRelease: options.hooks.onRelease }),
  })
  const outputs = await implementation
    .execute({
      descriptor: definition.descriptor,
      parameters: normalized.value,
      inputs: [source],
      plannedInputCharacteristics: [scientificDatasetCharacteristics(source)],
      provider: prepared.descriptor,
      implementation: implementation.descriptor,
      signal: options.signal ?? new AbortController().signal,
    })
    .catch(async (error: unknown) => {
      runtime.clear()
      await runtime.dispose()
      await disposal
      throw error
    })
  return {
    runtime,
    outputs,
    labels: outputs[0]?.value as ScientificDataset,
    objects: outputs[1]?.value as TableResult,
  }
}

const fixtureDescriptor = (width: number, height: number, calibrated = true): typeof descriptor =>
  normalizeScientificDatasetDescriptor({
    schemaVersion: 1,
    axes: [
      {
        id: 'x',
        kind: 'space',
        length: width,
        ...(calibrated ? { unit: 'µm' } : {}),
        coordinates: calibrated ? { type: 'linear', origin: 10, step: 2 } : { type: 'index' },
      },
      {
        id: 'y',
        kind: 'space',
        length: height,
        ...(calibrated ? { unit: 'µm' } : {}),
        coordinates: calibrated ? { type: 'linear', origin: 20, step: 3 } : { type: 'index' },
      },
    ],
    sampleType: 'uint8',
    components: [{ id: 'mask', kind: 'scalar' }],
    capabilities: {
      regionReads: true,
      resolutionLevels: false,
      planeReads: { kind: 'ordered-axis-pairs', pairs: [['x', 'y']] },
    },
  })

const numericValue = (table: TableResult, name: string, index = 0): number => {
  const column = table.columns.find((candidate) => candidate.name === name)
  if (column?.kind !== 'numeric') throw new Error(`Missing numeric column ${name}`)
  const value = column.values[index]
  if (typeof value !== 'number') throw new Error(`Column ${name} is not number-backed`)
  return value
}

const releaseExecution = async (result: Awaited<ReturnType<typeof execute>>): Promise<void> => {
  for (const output of result.outputs) await output.release()
  result.runtime.clear()
  await result.runtime.dispose()
}

describe('global tiled connected components', () => {
  it('declares tolerance-based complete-operation reproducibility', async () => {
    const definition = createBuiltInAnalysisOperationRegistry().get(
      analysisConnectedComponentsOperationId,
      1,
    )
    expect(definition?.descriptor.reproducibility).toEqual({
      class: 'tolerance-based',
      absolute: 1e-12,
      relative: 1e-12,
    })
    const runtime = createTileRuntime()
    const prepared = await createReferenceAnalysisProvider({ runtime }).prepare()
    const implementation = prepared?.implementations.find(
      (entry) => entry.descriptor.operationId === analysisConnectedComponentsOperationId,
    )
    expect(implementation?.descriptor).not.toHaveProperty('bitExactConformance')
    await runtime.dispose()
  })

  it('reconciles tile boundaries deterministically and distinguishes 4/8 connectivity', async () => {
    const mask = new Uint8Array(30)
    for (const [x, y] of [
      [0, 0],
      [1, 0],
      [2, 0],
      [2, 1],
      [3, 2],
      [4, 2],
      [5, 2],
      [5, 3],
      [5, 4],
    ] as const) {
      mask[y * 6 + x] = 1
    }
    const fourSmall = await execute(mask, 4, 2)
    const fourLarge = await execute(mask, 4, 4)
    const eight = await execute(mask, 8, 2)
    expect(await labels(fourSmall.labels)).toEqual(await labels(fourLarge.labels))
    expect(fourSmall.objects.rowCount).toBe(2)
    expect(eight.objects.rowCount).toBe(1)
    expect(fourSmall.objects.metadata).toMatchObject({
      semanticKind: 'connected-components',
      objectCount: 2,
      connectivity: 4,
      measurementSpace: { physical: true, unit: 'µm' },
    })
    const summary = summarizeResult(fourSmall.objects, { maxPreviewValues: 1 })
    expect(summary).toMatchObject({
      dimensions: { rows: 2 },
      metadata: { objectCount: 2 },
    })
    expect(summary.units).toContain('µm²')
    expect((summary.preview as Readonly<Record<string, readonly unknown[]>>).label).toHaveLength(1)
    const retainedBeforeTableRelease = fourSmall.runtime.metrics().memory.managedBytes
    await fourSmall.outputs[1]?.release()
    expect(fourSmall.runtime.metrics().memory.managedBytes).toBeLessThan(retainedBeforeTableRelease)
    expect(await labels(fourSmall.labels)).toEqual(await labels(fourLarge.labels))
    await fourSmall.outputs[0]?.release()
    fourSmall.runtime.clear()
    expect(fourSmall.runtime.metrics().memory.managedBytes).toBe(0)
    await fourSmall.runtime.dispose()
    for (const result of [fourLarge, eight]) {
      await releaseExecution(result)
      expect(result.runtime.metrics().memory.managedBytes).toBe(0)
    }
  })

  it('keeps labels deterministic across many boundaries and scheduler concurrency', async () => {
    const width = 17
    const height = 17
    const sourceDescriptor = fixtureDescriptor(width, height)
    const mask = new Uint8Array(width * height)
    for (let index = 0; index < width; index += 1) {
      mask[8 * width + index] = 1
      mask[index * width + 8] = 1
    }
    const small = await execute(mask, 4, 3, {
      descriptor: sourceDescriptor,
      concurrency: 1,
    })
    const large = await execute(mask, 4, 8, {
      descriptor: sourceDescriptor,
      concurrency: 4,
    })
    expect(small.objects.rowCount).toBe(1)
    expect(await labels(small.labels)).toEqual(await labels(large.labels))
    await releaseExecution(small)
    await releaseExecution(large)
  })

  it('reports known rectangle, circular, and rotated measurements', async () => {
    const sourceDescriptor = fixtureDescriptor(7, 7)
    const fixtures = [
      {
        name: 'rectangle',
        pixels: [
          [1, 1],
          [2, 1],
          [1, 2],
          [2, 2],
          [1, 3],
          [2, 3],
        ] as const,
      },
      {
        name: 'circle',
        pixels: [
          [2, 1],
          [3, 1],
          [4, 1],
          [1, 2],
          [2, 2],
          [3, 2],
          [4, 2],
          [5, 2],
          [1, 3],
          [2, 3],
          [3, 3],
          [4, 3],
          [5, 3],
          [1, 4],
          [2, 4],
          [3, 4],
          [4, 4],
          [5, 4],
          [2, 5],
          [3, 5],
          [4, 5],
        ] as const,
      },
      {
        name: 'rotated',
        pixels: [
          [1, 1],
          [2, 2],
          [3, 3],
          [4, 4],
          [5, 5],
        ] as const,
      },
    ] as const
    for (const fixture of fixtures) {
      const mask = new Uint8Array(49)
      for (const [x, y] of fixture.pixels) mask[y * 7 + x] = 1
      const result = await execute(mask, 8, 2, { descriptor: sourceDescriptor })
      expect(result.objects.rowCount).toBe(1)
      expect(numericValue(result.objects, 'pixelCount')).toBe(fixture.pixels.length)
      if (fixture.name === 'rectangle') {
        expect(numericValue(result.objects, 'boundingBoxWidth')).toBe(2)
        expect(numericValue(result.objects, 'boundingBoxHeight')).toBe(3)
        const columnNames = result.objects.columns.map(({ name }) => name)
        expect(new Set(columnNames).size).toBe(columnNames.length)
        expect(numericValue(result.objects, 'centroidX')).toBe(2)
        expect(numericValue(result.objects, 'centroidY')).toBe(2.5)
        expect(numericValue(result.objects, 'physicalArea')).toBe(36)
        expect(numericValue(result.objects, 'physicalCentroidX')).toBe(13)
        expect(numericValue(result.objects, 'physicalCentroidY')).toBe(26)
      } else if (fixture.name === 'circle') {
        expect(numericValue(result.objects, 'centroidX')).toBe(3.5)
        expect(numericValue(result.objects, 'centroidY')).toBe(3.5)
        expect(numericValue(result.objects, 'equivalentCircularDiameter')).toBeCloseTo(
          2 * Math.sqrt(21 / Math.PI),
        )
      } else {
        expect(numericValue(result.objects, 'orientationRadians')).toBeCloseTo(Math.PI / 4)
      }
      await releaseExecution(result)
    }
  })

  it('uses the ROI pixel-center convention with anisotropic negative calibration', async () => {
    const sourceDescriptor = normalizeScientificDatasetDescriptor({
      schemaVersion: 1,
      axes: [
        {
          id: 'x',
          kind: 'space',
          length: 4,
          unit: 'µm',
          coordinates: { type: 'linear', origin: 100, step: -2 },
        },
        {
          id: 'y',
          kind: 'space',
          length: 4,
          unit: 'µm',
          coordinates: { type: 'linear', origin: 200, step: 4 },
        },
      ],
      sampleType: 'uint8',
      components: [{ id: 'mask', kind: 'scalar' }],
      capabilities: {
        regionReads: true,
        resolutionLevels: false,
        planeReads: { kind: 'ordered-axis-pairs', pairs: [['x', 'y']] },
      },
    })
    const mask = new Uint8Array(16)
    mask[2 * 4 + 1] = 1
    const result = await execute(mask, 4, 2, { descriptor: sourceDescriptor })
    expect(numericValue(result.objects, 'centroidX')).toBe(1.5)
    expect(numericValue(result.objects, 'centroidY')).toBe(2.5)
    expect(numericValue(result.objects, 'physicalCentroidX')).toBe(98)
    expect(numericValue(result.objects, 'physicalCentroidY')).toBe(208)
    expect(numericValue(result.objects, 'physicalArea')).toBe(8)
    await releaseExecution(result)
  })

  it('enforces exact phase-planned memory boundaries across tile sizes', async () => {
    const width = 16
    const height = 16
    const sourceDescriptor = fixtureDescriptor(width, height)
    const checkerboard = new Uint8Array(width * height)
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) checkerboard[y * width + x] = (x + y) % 2
    }
    const componentCount = checkerboard.reduce((total, value) => total + value, 0)
    const operationParameters = {
      displayAxes: ['x', 'y'],
      fixedIndices: [],
      component: 0,
      connectivity: 4,
    }
    for (const tileSize of [2, 5]) {
      let low = 1
      let high = 1_000_000
      while (low < high) {
        const middle = Math.floor((low + high) / 2)
        let capacity = 0
        try {
          capacity = inspectConnectedComponentsMemoryPlan(
            sourceDescriptor,
            operationParameters,
            tileSize,
            tileSize,
            middle,
          ).capacity
        } catch {
          capacity = 0
        }
        if (capacity >= componentCount) high = middle
        else low = middle + 1
      }
      const exactPlan = inspectConnectedComponentsMemoryPlan(
        sourceDescriptor,
        operationParameters,
        tileSize,
        tileSize,
        low,
      )
      expect(exactPlan.capacity).toBe(componentCount)
      expect(exactPlan.peakWorkingBytes).toBeLessThanOrEqual(low)
      const result = await execute(checkerboard, 4, tileSize, {
        descriptor: sourceDescriptor,
        maxOperationWorkingBytes: low,
        maxTotalManagedBytes: low + 1_024 * 1_024,
      })
      expect(result.objects.rowCount).toBe(componentCount)
      expect(result.runtime.metrics().memory.highWaterTotalManagedBytes).toBeLessThanOrEqual(
        result.runtime.limits.maxTotalManagedBytes,
      )
      expect(result.runtime.metrics().memory.managedBytes).toBeGreaterThan(0)
      await releaseExecution(result)
      expect(result.runtime.metrics().memory.managedBytes).toBe(0)

      await expect(
        execute(checkerboard, 4, tileSize, {
          descriptor: sourceDescriptor,
          maxOperationWorkingBytes: low - 1,
          maxTotalManagedBytes: low + 1_024 * 1_024,
        }),
      ).rejects.toMatchObject({ code: 'LIMIT_EXCEEDED' })
    }
  })

  it('keeps physical measurements absent when calibration is unavailable', async () => {
    const sourceDescriptor = fixtureDescriptor(3, 3, false)
    const result = await execute(Uint8Array.of(1, 1, 0, 1, 1, 0, 0, 0, 0), 4, 2, {
      descriptor: sourceDescriptor,
    })
    expect(result.objects.metadata).toMatchObject({
      measurementSpace: { pixel: true, physical: false },
    })
    expect(result.objects.columns.some(({ name }) => name === 'physicalArea')).toBe(false)
    await releaseExecution(result)
  })

  it('cancels and releases acquired source tiles during the global pass', async () => {
    const controller = new AbortController()
    let reads = 0
    let releases = 0
    await expect(
      execute(new Uint8Array(30).fill(1), 4, 2, {
        signal: controller.signal,
        hooks: {
          onRead() {
            reads += 1
            if (reads === 2) controller.abort(new Error('cancel global components'))
          },
          onRelease() {
            releases += 1
          },
        },
      }),
    ).rejects.toThrow('cancel global components')
    expect(reads).toBe(2)
    expect(releases).toBeGreaterThanOrEqual(1)
  })

  it('stops safely when the runtime is disposed during the global pass', async () => {
    await expect(
      execute(new Uint8Array(30).fill(1), 4, 2, { disposeAfterReads: 2 }),
    ).rejects.toThrow()
  })

  it('fails with a structured limit error when provisional state exceeds policy', async () => {
    const checkerboard = new Uint8Array(30)
    for (let y = 0; y < 5; y += 1) {
      for (let x = 0; x < 6; x += 1) checkerboard[y * 6 + x] = (x + y) % 2
    }
    const runtime = createTileRuntime({ limits: { maxOperationWorkingBytes: 1 } })
    const provider = createReferenceAnalysisProvider({ runtime, tileWidth: 2, tileHeight: 2 })
    const prepared = await provider.prepare()
    const implementation = prepared?.implementations.find(
      (entry) => entry.descriptor.operationId === analysisConnectedComponentsOperationId,
    )
    const definition = createBuiltInAnalysisOperationRegistry().get(
      analysisConnectedComponentsOperationId,
      1,
    )
    if (prepared === undefined || implementation === undefined || definition === undefined) {
      throw new Error('Connected-components implementation was unavailable')
    }
    const normalized = definition.normalizeParameters({
      displayAxes: ['x', 'y'],
      fixedIndices: [],
      connectivity: 4,
    })
    if (normalized.value === undefined) throw new Error('Connected-components parameters failed')
    await expect(
      implementation.execute({
        descriptor: definition.descriptor,
        parameters: normalized.value,
        inputs: [dataset(checkerboard)],
        plannedInputCharacteristics: [scientificDatasetCharacteristics(descriptor)],
        provider: prepared.descriptor,
        implementation: implementation.descriptor,
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({ code: 'LIMIT_EXCEEDED' })
    await runtime.dispose()
  })
})
