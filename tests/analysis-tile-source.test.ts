import { describe, expect, it } from 'vitest'
import {
  createDerivedTileSource,
  numericTileSourceToTileSource,
} from '../src/analysis/tile-source.ts'
import { canonicalTileKey, createTileRuntime } from '../src/analysis/tile-runtime.ts'
import type { DerivedTileExecutionContext, TileHalo } from '../src/analysis/tile-source.ts'
import type { TileAddress, TileRequest, TileSource } from '../src/analysis/tile-runtime.ts'
import type {
  OperationCostEstimate,
  OperationImplementation,
  OperationJsonObject,
  OperationOwnedOutput,
  OperationProviderSelection,
  PreparedOperationProvider,
} from '../src/operations/index.ts'
import { createOperationDefinition } from '../src/operations/index.ts'
import type {
  NormalizedScientificDatasetDescriptor,
  NumericTile,
  NumericTileSource,
} from '../src/scientific/index.ts'
import {
  normalizeScientificDatasetDescriptor,
  numericTileSampleOffset,
} from '../src/scientific/index.ts'

const descriptor: NormalizedScientificDatasetDescriptor = normalizeScientificDatasetDescriptor({
  schemaVersion: 2,
  axes: [
    { id: 'x', kind: 'space', length: 8, coordinates: { type: 'index' } },
    { id: 'y', kind: 'space', length: 6, coordinates: { type: 'index' } },
  ],
  sampleType: 'float32',
  components: [{ id: 'value', kind: 'scalar' }],
  capabilities: { regionReads: true, resolutionLevels: false },
})

const dataset = {
  datasetId: 'scientific-1',
  source: {
    kind: 'content' as const,
    strength: 'strong' as const,
    stability: 'content-addressed' as const,
    algorithm: 'sha256' as const,
    digest: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    size: 48,
  },
  generation: 0,
}

const address = (
  x: number,
  y: number,
  width: number,
  height: number,
  options: { readonly namespace?: string; readonly generation?: number } = {},
): TileAddress => ({
  cacheClass: 'derived',
  namespace: options.namespace ?? 'derived:node-1',
  dataset: { ...dataset, generation: options.generation ?? 0 },
  displayAxes: ['x', 'y'],
  fixedIndices: [],
  resolutionLevel: 0,
  x,
  y,
  width,
  height,
})

const request = (
  x: number,
  y: number,
  width: number,
  height: number,
  signal: AbortSignal = new AbortController().signal,
  options: Parameters<typeof address>[4] = {},
): TileRequest => ({
  address: address(x, y, width, height, options),
  priority: 'visible',
  signal,
  target: { sampleType: 'float32', layout: 'interleaved' },
})

const numericTile = (
  region: Pick<TileAddress, 'x' | 'y' | 'width' | 'height'>,
  release: () => void,
): NumericTile => {
  const data = new Float32Array(region.width * region.height)
  for (let y = 0; y < region.height; y += 1) {
    for (let x = 0; x < region.width; x += 1) {
      data[y * region.width + x] = region.x + x + (region.y + y) * 10
    }
  }
  return Object.freeze({
    ...region,
    sampleType: 'float32',
    componentCount: 1,
    layout: 'interleaved',
    rowStrideElements: region.width,
    data,
    release,
  })
}

const sourceFor = (reads: TileAddress[], releases: TileAddress[]): TileSource => ({
  descriptor,
  tileKey: canonicalTileKey,
  estimate: (tileRequest) => ({
    outputRetainedBytes: tileRequest.address.width * tileRequest.address.height * 4,
    peakWorkingBytes: tileRequest.address.width * tileRequest.address.height * 4,
    retainedAuxiliaryBytes: 0,
  }),
  async readTile(tileRequest) {
    reads.push(tileRequest.address)
    return {
      tile: numericTile(tileRequest.address, () => releases.push(tileRequest.address)),
      accounting: { decodedInputBytes: tileRequest.address.width * tileRequest.address.height * 4 },
    }
  },
})

const operation = createOperationDefinition({
  descriptor: {
    id: 'example.tile.neighborhood',
    version: 1,
    title: 'Synthetic neighborhood',
    category: 'test',
    tags: [],
    inputs: [{ name: 'source', valueType: { id: 'example.numeric-tile', version: 1 } }],
    outputs: [{ name: 'result', valueType: { id: 'example.numeric-tile', version: 1 } }],
    parameters: {
      type: 'object',
      properties: { radius: { type: 'integer', minimum: 0, maximum: 4, default: 1 } },
      closed: true,
    },
    execution: 'neighborhood',
    reproducibility: { class: 'backend-stable' },
  },
})

const isJsonValue = (value: unknown): boolean => {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
  ) {
    return true
  }
  if (Array.isArray(value)) return value.every(isJsonValue)
  if (typeof value !== 'object') return false
  return Object.values(value).every(isJsonValue)
}

const isJsonObject = (value: unknown): value is OperationJsonObject =>
  value !== null && typeof value === 'object' && !Array.isArray(value) && isJsonValue(value)

const object = (value: unknown, label: string): OperationJsonObject => {
  if (!isJsonObject(value)) {
    throw new TypeError(`${label} must be an object`)
  }
  return value
}

const numberField = (value: OperationJsonObject, field: string): number => {
  const result = value[field]
  if (typeof result !== 'number') throw new TypeError(`${field} must be a number`)
  return result
}

const contextFor = (value: OperationJsonObject | undefined): DerivedTileExecutionContext => {
  const context = object(value, 'inputCharacteristics')
  return {
    ...context,
    requested: object(context.requested, 'requested'),
    source: object(context.source, 'source'),
    halo: object(context.halo, 'halo'),
    boundaryMode: 'clip',
  }
}

const isNumericTile = (value: unknown): value is NumericTile =>
  value !== null &&
  typeof value === 'object' &&
  'x' in value &&
  typeof value.x === 'number' &&
  'y' in value &&
  typeof value.y === 'number' &&
  'width' in value &&
  typeof value.width === 'number' &&
  'height' in value &&
  typeof value.height === 'number' &&
  'sampleType' in value &&
  value.sampleType === 'float32' &&
  'componentCount' in value &&
  typeof value.componentCount === 'number' &&
  'layout' in value &&
  (value.layout === 'interleaved' || value.layout === 'planar') &&
  'rowStrideElements' in value &&
  typeof value.rowStrideElements === 'number' &&
  'data' in value &&
  value.data instanceof Float32Array &&
  'release' in value &&
  typeof value.release === 'function'

const inputTile = (value: unknown): NumericTile => {
  if (!isNumericTile(value)) {
    throw new TypeError('input must be a NumericTile')
  }
  return value
}

const outputRegion = (context: DerivedTileExecutionContext): TileAddress => {
  const requested = object(context.requested.address, 'requested address')
  return address(
    numberField(requested, 'x'),
    numberField(requested, 'y'),
    numberField(requested, 'width'),
    numberField(requested, 'height'),
  )
}

const estimate: OperationCostEstimate = Object.freeze({
  setupMilliseconds: 0.1,
  transferMilliseconds: 0.2,
  computeMilliseconds: 0.3,
  readbackMilliseconds: 0.4,
  retainedBytes: 64,
  peakWorkingBytes: 96,
  transferBytes: 32,
  outputBytes: 64,
  confidence: 1,
})

const selection = (options: {
  readonly id: string
  readonly implementationVersion?: string
  readonly supportsPlan?: OperationImplementation['supportsPlan']
  readonly execute: OperationImplementation['execute']
}): OperationProviderSelection => {
  const implementation: OperationImplementation = Object.freeze({
    descriptor: Object.freeze({
      operationId: operation.descriptor.id,
      operationVersion: operation.descriptor.version,
      implementationVersion: options.implementationVersion ?? '1.0.0',
    }),
    supportsPlan: options.supportsPlan ?? (() => true),
    estimatePlan: () => estimate,
    execute: options.execute,
  })
  const provider: PreparedOperationProvider = Object.freeze({
    descriptor: Object.freeze({
      id: options.id,
      version: 1,
      kind: 'reference',
      buildFingerprint: `${options.id}-build`,
    }),
    implementations: Object.freeze([implementation]),
  })
  return Object.freeze({ provider, implementation, estimate })
}

const averageOutput =
  (providerReleases: number[]): OperationImplementation['execute'] =>
  async (providerRequest) => {
    providerRequest.signal.throwIfAborted()
    const source = inputTile(providerRequest.inputs[0])
    const context = contextFor(
      object(providerRequest.plannedInputCharacteristics[0], 'planned input characteristics'),
    )
    const output = outputRegion(context)
    const radius = numberField(object(providerRequest.parameters, 'parameters'), 'radius')
    const data = new Float32Array(output.width * output.height)
    for (let y = 0; y < output.height; y += 1) {
      for (let x = 0; x < output.width; x += 1) {
        const globalX = output.x + x
        const globalY = output.y + y
        let sum = 0
        let count = 0
        for (
          let sampleY = Math.max(source.y, globalY - radius);
          sampleY <= Math.min(source.y + source.height - 1, globalY + radius);
          sampleY += 1
        ) {
          for (
            let sampleX = Math.max(source.x, globalX - radius);
            sampleX <= Math.min(source.x + source.width - 1, globalX + radius);
            sampleX += 1
          ) {
            sum += Number(
              source.data[
                numericTileSampleOffset(source, sampleX - source.x, sampleY - source.y, 0)
              ],
            )
            count += 1
          }
        }
        data[y * output.width + x] = sum / count
      }
    }
    const owned: OperationOwnedOutput = Object.freeze({
      value: Object.freeze({
        x: output.x,
        y: output.y,
        width: output.width,
        height: output.height,
        sampleType: 'float32',
        componentCount: 1,
        layout: 'interleaved',
        rowStrideElements: output.width,
        data,
        release: () => undefined,
      } satisfies NumericTile),
      release(): void {
        providerReleases.push(output.x)
      },
    })
    return Object.freeze([owned])
  }

const derivedFor = (options: {
  readonly runtime: ReturnType<typeof createTileRuntime>
  readonly source: TileSource
  readonly selection: OperationProviderSelection
  readonly radius?: number
  readonly fingerprint?: string
  readonly nodeSemanticHash?: string
  readonly halo?: TileHalo
}) =>
  createDerivedTileSource({
    runtime: options.runtime,
    source: options.source,
    descriptor,
    operation,
    selection: options.selection,
    parameters: { radius: options.radius ?? 1 },
    nodeSemanticHash: options.nodeSemanticHash ?? 'node-semantic-hash-1',
    executionFingerprint: options.fingerprint ?? 'execution-1',
    sourceNamespace: 'source:dataset-1',
    halo: () => options.halo ?? { left: 1, right: 1, top: 1, bottom: 1 },
  })

describe('numeric and derived tile sources', () => {
  it('adapts streamed NumericTiles into one bounded packed tile and releases source chunks', async () => {
    const releases: number[] = []
    const numericSource: NumericTileSource = {
      descriptor,
      async *readNumericTiles(read) {
        yield numericTile(
          { x: read.x ?? 0, y: read.y ?? 0, width: 2, height: read.height ?? 1 },
          () => releases.push(1),
        )
        yield numericTile(
          {
            x: (read.x ?? 0) + 2,
            y: read.y ?? 0,
            width: (read.width ?? 4) - 2,
            height: read.height ?? 1,
          },
          () => releases.push(2),
        )
      },
    }
    const runtime = createTileRuntime()
    const source = numericTileSourceToTileSource(numericSource)
    const tile = await runtime.request(source, {
      ...request(1, 2, 4, 2),
      address: { ...request(1, 2, 4, 2).address, cacheClass: 'source' },
    })
    expect([...tile.data]).toEqual([21, 22, 23, 24, 31, 32, 33, 34])
    expect(releases).toEqual([1, 2])
    tile.release()
    runtime.clear()
  })

  it('transfers one exact source tile without allocating a merge buffer', async () => {
    let releases = 0
    const data = new Float32Array([0, 1, 10, 11])
    const numericSource: NumericTileSource = {
      descriptor,
      async *readNumericTiles() {
        yield Object.freeze({
          x: 0,
          y: 0,
          width: 2,
          height: 2,
          sampleType: 'float32' as const,
          componentCount: 1,
          layout: 'interleaved' as const,
          rowStrideElements: 2,
          data,
          release() {
            releases += 1
          },
        })
      },
    }
    const runtime = createTileRuntime()
    const source = numericTileSourceToTileSource(numericSource)
    const result = await runtime.request(source, {
      ...request(0, 0, 2, 2),
      address: { ...request(0, 0, 2, 2).address, cacheClass: 'source' },
    })
    expect(result.data.buffer).toBe(data.buffer)
    expect(releases).toBe(0)
    result.release()
    runtime.clear()
    expect(releases).toBe(1)
  })

  it('compacts an exact tile whose small view retains an undeclared larger allocation', async () => {
    let releases = 0
    const backing = new ArrayBuffer(256)
    const data = new Float32Array(backing, 0, 4)
    data.set([0, 1, 10, 11])
    const numericSource: NumericTileSource = {
      descriptor,
      async *readNumericTiles() {
        yield Object.freeze({
          x: 0,
          y: 0,
          width: 2,
          height: 2,
          sampleType: 'float32' as const,
          componentCount: 1,
          layout: 'interleaved' as const,
          rowStrideElements: 2,
          data,
          release() {
            releases += 1
          },
        })
      },
    }
    const runtime = createTileRuntime({ limits: { maxCacheBytes: 32, maxTileBytes: 32 } })
    const result = await runtime.request(numericTileSourceToTileSource(numericSource), {
      ...request(0, 0, 2, 2),
      address: { ...request(0, 0, 2, 2).address, cacheClass: 'source' },
    })
    expect(result.data.buffer).not.toBe(backing)
    expect(result.data.buffer.byteLength).toBe(16)
    expect(runtime.metrics().cache.currentBytes).toBe(16)
    expect(releases).toBe(1)
    result.release()
    runtime.clear()
  })

  it('permits zero-copy pooled storage only when the direct source declares the allocation', async () => {
    const backing = new ArrayBuffer(256)
    const data = new Float32Array(backing, 0, 4)
    const numericSource: NumericTileSource = {
      descriptor,
      estimateRetainedBytes: () => backing.byteLength,
      async *readNumericTiles() {
        yield Object.freeze({
          x: 0,
          y: 0,
          width: 2,
          height: 2,
          sampleType: 'float32' as const,
          componentCount: 1,
          layout: 'interleaved' as const,
          rowStrideElements: 2,
          data,
          release() {},
        })
      },
    }
    const runtime = createTileRuntime({ limits: { maxCacheBytes: 512, maxTileBytes: 512 } })
    const result = await runtime.request(numericTileSourceToTileSource(numericSource), {
      ...request(0, 0, 2, 2),
      address: { ...request(0, 0, 2, 2).address, cacheClass: 'source' },
    })
    expect(result.data.buffer).toBe(backing)
    expect(runtime.metrics().cache.currentBytes).toBe(256)
    result.release()
    runtime.clear()
  })

  it('keys provider identity, normalized semantics, fingerprints, and generations', () => {
    const runtime = createTileRuntime()
    const source = sourceFor([], [])
    const reference = selection({ id: 'provider.reference', execute: averageOutput([]) })
    const alternate = selection({ id: 'provider.alternate', execute: averageOutput([]) })
    const base = request(2, 2, 2, 2)
    const first = derivedFor({ runtime, source, selection: reference })
    const same = derivedFor({ runtime, source, selection: reference, radius: 1 })
    const providerChanged = derivedFor({ runtime, source, selection: alternate })
    const executionChanged = derivedFor({
      runtime,
      source,
      selection: reference,
      fingerprint: 'execution-2',
    })
    const nodeChanged = derivedFor({
      runtime,
      source,
      selection: reference,
      nodeSemanticHash: 'node-semantic-hash-2',
    })
    const parameterChanged = derivedFor({ runtime, source, selection: reference, radius: 2 })
    expect(first.tileKey(base)).toBe(same.tileKey(base))
    expect(providerChanged.tileKey(base)).not.toBe(first.tileKey(base))
    expect(executionChanged.tileKey(base)).not.toBe(first.tileKey(base))
    expect(nodeChanged.tileKey(base)).not.toBe(first.tileKey(base))
    expect(parameterChanged.tileKey(base)).not.toBe(first.tileKey(base))
    expect(first.tileKey(request(2, 2, 2, 2, undefined, { generation: 1 }))).not.toBe(
      first.tileKey(base),
    )
  })

  it('clips halos, returns only output pixels, and remains invariant across tile partitions', async () => {
    const reads: TileAddress[] = []
    const sourceReleases: TileAddress[] = []
    const providerReleases: number[] = []
    const runtime = createTileRuntime({ limits: { maxCacheBytes: 1_024 } })
    const source = sourceFor(reads, sourceReleases)
    const provider = selection({
      id: 'provider.reference',
      execute: averageOutput(providerReleases),
    })
    const derived = derivedFor({ runtime, source, selection: provider })

    const whole = await runtime.request(derived, request(0, 0, 4, 2))
    const wholeValues = [...whole.data]
    whole.release()
    const left = await runtime.request(derived, request(0, 0, 2, 2))
    const right = await runtime.request(derived, request(2, 0, 2, 2))
    const stitched = [
      left.data[0],
      left.data[1],
      right.data[0],
      right.data[1],
      left.data[2],
      left.data[3],
      right.data[2],
      right.data[3],
    ]
    expect(stitched).toEqual(wholeValues)
    expect(reads[0]).toMatchObject({ x: 0, y: 0, width: 5, height: 3, cacheClass: 'source' })
    expect(whole).toMatchObject({ x: 0, y: 0, width: 4, height: 2 })
    left.release()
    right.release()
    runtime.clear()
    expect(sourceReleases.length).toBe(reads.length)
    expect(providerReleases).toEqual([0, 0, 2])
    const timing = runtime.metrics().providerTiming
    expect(timing.setupMillisecondsEstimate).toBeCloseTo(0.3)
    expect(timing.transferMillisecondsEstimate).toBeCloseTo(0.6)
    expect(timing.computeMillisecondsEstimate).toBeCloseTo(0.9)
    expect(timing.readbackMillisecondsEstimate).toBeCloseTo(1.2)
    expect(timing.computeMillisecondsMeasured).toBeGreaterThanOrEqual(0)
  })

  it('uses one exact planned provider for every tile shape', async () => {
    const calls: string[] = []
    const runtime = createTileRuntime()
    const source = sourceFor([], [])
    const primary = selection({
      id: 'provider.primary',
      async execute(providerRequest): Promise<readonly OperationOwnedOutput[]> {
        calls.push('primary')
        return averageOutput([])(providerRequest)
      },
    })
    const fallback = selection({
      id: 'provider.fallback',
      execute: async (providerRequest) => {
        calls.push('fallback')
        return averageOutput([])(providerRequest)
      },
    })
    const derived = derivedFor({ runtime, source, selection: primary })
    const result = await runtime.request(derived, request(1, 1, 2, 2))
    result.release()
    expect(calls).toEqual(['primary'])
    expect(fallback.provider.descriptor.id).toBe('provider.fallback')
    runtime.clear()
  })

  it('does not inflate hard tile memory bounds because provider timing confidence is partial', async () => {
    const runtime = createTileRuntime({ limits: { maxTotalManagedBytes: 1_024 } })
    const source = sourceFor([], [])
    const base = selection({ id: 'provider.partial-timing', execute: averageOutput([]) })
    const partial: OperationProviderSelection = Object.freeze({
      ...base,
      estimate: Object.freeze({ ...base.estimate, confidence: 0.5 }),
    })
    const derived = derivedFor({
      runtime,
      source,
      selection: partial,
      halo: { left: 0, right: 0, top: 0, bottom: 0 },
    })
    const first = await runtime.request(derived, request(0, 0, 2, 2))
    const second = await runtime.request(derived, request(2, 0, 2, 2))
    expect(runtime.metrics().memory.highWaterTotalManagedBytes).toBeLessThan(1_024)
    first.release()
    second.release()
    runtime.clear()
  })

  it('rejects derived outputs that claim ownership of source storage', async () => {
    const runtime = createTileRuntime()
    const source = sourceFor([], [])
    const aliased = selection({
      id: 'provider.aliasing',
      async execute(providerRequest) {
        const sourceTile = inputTile(providerRequest.inputs[0])
        const outputs = await averageOutput([])(providerRequest)
        const output = outputs[0]
        if (output === undefined) return outputs
        return Object.freeze([
          Object.freeze({
            ...output,
            ownershipIdentity: sourceTile.data.buffer,
          }),
        ])
      },
    })
    await expect(
      runtime.request(derivedFor({ runtime, source, selection: aliased }), request(1, 1, 2, 2)),
    ).rejects.toThrow('claims ownership of input storage')
    runtime.clear()
  })

  it('propagates cancellation, releases provider output on post-execution abort, and invalidates generations', async () => {
    const runtime = createTileRuntime({ limits: { maxConcurrency: 1 } })
    const source = sourceFor([], [])
    const released: number[] = []
    let executeStarted: (() => void) | undefined
    const started = new Promise<void>((resolve) => {
      executeStarted = resolve
    })
    let allowReturn: (() => void) | undefined
    const gate = new Promise<void>((resolve) => {
      allowReturn = resolve
    })
    const slow = selection({
      id: 'provider.slow',
      async execute(providerRequest) {
        const outputs = await averageOutput(released)(providerRequest)
        executeStarted?.()
        await gate
        return outputs
      },
    })
    const derived = derivedFor({ runtime, source, selection: slow })
    const abort = new AbortController()
    const pending = runtime.request(derived, request(1, 1, 2, 2, abort.signal))
    await started
    abort.abort(new Error('consumer left'))
    allowReturn?.()
    await expect(pending).rejects.toThrow('consumer left')
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(released).toEqual([1])

    const throwReleases: number[] = []
    const throwing = derivedFor({
      runtime,
      source,
      selection: selection({
        id: 'provider.throwing',
        async execute(providerRequest) {
          const outputs = await averageOutput(throwReleases)(providerRequest)
          for (const output of outputs) await output.release()
          throw new Error('provider failed after allocation')
        },
      }),
    })
    await expect(runtime.request(throwing, request(2, 2, 2, 2))).rejects.toThrow(
      'failed after allocation',
    )
    expect(throwReleases).toEqual([2])

    const fast = derivedFor({
      runtime,
      source,
      selection: selection({ id: 'provider.fast', execute: averageOutput(released) }),
    })
    const old = await runtime.request(fast, request(0, 0, 1, 1))
    old.release()
    expect(runtime.invalidate({ namespace: 'derived:node-1', generation: 0 })).toBe(1)
    expect(runtime.has(request(0, 0, 1, 1), fast)).toBe(false)
    const nextGeneration = request(0, 0, 1, 1, undefined, { generation: 1 })
    const next = await runtime.request(fast, nextGeneration)
    next.release()
    expect(runtime.has(nextGeneration, fast)).toBe(true)
    runtime.clear()
  })
})
