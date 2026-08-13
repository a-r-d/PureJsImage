import { describe, expect, it } from 'vitest'
import {
  canonicalTileKey,
  createTileRuntime,
  normalizeTileAddress,
} from '../src/analysis/tile-runtime.ts'
import type {
  TileAddress,
  TilePriority,
  TileRequest,
  TileSource,
  TileSourceResult,
} from '../src/analysis/tile-runtime.ts'
import type { NumericTile } from '../src/scientific/index.ts'

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

const address = (
  x: number,
  options: {
    readonly cacheClass?: 'source' | 'derived'
    readonly namespace?: string
    readonly generation?: number
  } = {},
): TileAddress => ({
  cacheClass: options.cacheClass ?? 'source',
  namespace: options.namespace ?? 'dataset',
  dataset: {
    datasetId: 'dataset-1',
    source: {
      kind: 'local-file',
      strength: 'weak',
      stability: 'metadata',
      nameOrPath: 'fixture.bin',
      size: 1_024,
      lastModified: 10,
    },
    sessionId: 'workspace-1',
    generation: options.generation ?? 0,
  },
  displayAxes: ['x', 'y'],
  fixedIndices: [],
  resolutionLevel: 0,
  x,
  y: 0,
  width: 2,
  height: 2,
})

const request = (
  x: number,
  signal: AbortSignal = new AbortController().signal,
  priority: TilePriority = 'visible',
  options: Parameters<typeof address>[1] = {},
): TileRequest => ({ address: address(x, options), priority, signal })

const tile = (x: number, releases: number[], value = x, releaseError = false): NumericTile =>
  Object.freeze({
    x,
    y: 0,
    width: 2,
    height: 2,
    sampleType: 'uint8',
    componentCount: 1,
    layout: 'interleaved',
    rowStrideElements: 2,
    data: Uint8Array.of(value, value, value, value),
    release() {
      releases.push(x)
      if (releaseError) throw new Error('release failed')
    },
  })

const immediateSource = (releases: number[], reads: number[], auxiliaryBytes = 0): TileSource => ({
  tileKey: canonicalTileKey,
  async readTile(tileRequest): Promise<TileSourceResult> {
    reads.push(tileRequest.address.x)
    return {
      tile: tile(tileRequest.address.x, releases),
      accounting: { retainedAuxiliaryBytes: auxiliaryBytes, bytesRequested: 4 },
    }
  },
})

describe('bounded tile runtime cache and scheduler', () => {
  it('normalizes canonical addresses and isolates weak identities by session', () => {
    const withSession = address(0).dataset
    expect(() =>
      Reflect.apply(normalizeTileAddress, undefined, [
        {
          ...address(0),
          dataset: {
            datasetId: withSession.datasetId,
            source: withSession.source,
            generation: withSession.generation,
          },
        },
      ]),
    ).toThrow('sessionId')
    const first = request(0)
    const reordered: TileRequest = {
      ...first,
      address: { ...first.address, fixedIndices: [] },
    }
    expect(canonicalTileKey(first)).toBe(canonicalTileKey(reordered))
    expect(
      canonicalTileKey({
        ...first,
        address: {
          ...first.address,
          dataset: { ...first.address.dataset, sessionId: 'workspace-2' },
        },
      }),
    ).not.toBe(canonicalTileKey(first))
    expect(() => normalizeTileAddress({ ...address(Number.MAX_SAFE_INTEGER), width: 2 })).toThrow(
      'safe integer',
    )
    expect(() => normalizeTileAddress({ ...address(0), width: 0 })).toThrow('positive')
  })

  it('uses true byte-accounted LRU order and releases on eviction, replacement, and clear', async () => {
    const releases: number[] = []
    const reads: number[] = []
    const source = immediateSource(releases, reads)
    const runtime = createTileRuntime({
      limits: { maxCacheBytes: 8, maxCacheEntries: 2, maxConcurrency: 1 },
    })
    const first = await runtime.request(source, request(0))
    first.release()
    const second = await runtime.request(source, request(2))
    second.release()
    const touch = await runtime.request(source, request(0))
    touch.release()
    const third = await runtime.request(source, request(4))
    third.release()
    expect(releases).toEqual([2])
    expect(runtime.has(request(0), source)).toBe(true)
    expect(runtime.has(request(2), source)).toBe(false)
    expect(runtime.metrics().cache).toMatchObject({
      hits: 1,
      misses: 3,
      evictions: 1,
      currentBytes: 8,
      highWaterBytes: 12,
      sourceRetainedBytes: 8,
      derivedRetainedBytes: 0,
    })

    expect(runtime.putCached(source, request(0), tile(0, releases, 9))).toBe(true)
    expect(releases).toEqual([2, 0])
    const replaced = runtime.getCached(source, request(0))
    expect(replaced?.data[0]).toBe(9)
    replaced?.release()
    runtime.clear()
    expect(releases.sort((left, right) => left - right)).toEqual([0, 0, 2, 4])
    expect(runtime.metrics().cache).toMatchObject({ currentBytes: 0, currentEntries: 0 })
    expect(reads).toEqual([0, 2, 4])
  })

  it('accounts declared auxiliary bytes and cleanly rejects oversized ownership transfer', () => {
    const releases: number[] = []
    const source = immediateSource(releases, [])
    const runtime = createTileRuntime({ limits: { maxCacheBytes: 5 } })
    expect(runtime.putCached(source, request(0), tile(0, releases), 2)).toBe(false)
    expect(releases).toEqual([0])
    expect(runtime.metrics().cache.currentBytes).toBe(0)
  })

  it('enforces tile, in-flight, leased, operation, and total managed byte budgets', async () => {
    const releases: number[] = []
    const tooSmall = createTileRuntime({ limits: { maxTileBytes: 3 } })
    expect(() => tooSmall.request(immediateSource(releases, []), request(0))).toThrow(
      'maxTileBytes',
    )

    const gate = new Deferred<TileSourceResult>()
    const inFlightSource: TileSource = {
      tileKey: canonicalTileKey,
      readTile: () => gate.promise,
    }
    const inFlight = createTileRuntime({ limits: { maxInFlightBytes: 32 } })
    const firstPending = inFlight.request(inFlightSource, request(0))
    expect(() => inFlight.request(inFlightSource, request(2))).toThrow('maxInFlightBytes')
    gate.resolve({ tile: tile(0, releases) })
    const firstTile = await firstPending
    firstTile.release()
    inFlight.clear()

    const leased = createTileRuntime({ limits: { maxLeasedBytes: 4 } })
    const source = immediateSource(releases, [])
    expect(leased.putCached(source, request(0), tile(0, releases))).toBe(true)
    expect(leased.putCached(source, request(2), tile(2, releases))).toBe(true)
    const firstLease = leased.getCached(source, request(0))
    expect(firstLease).toBeDefined()
    expect(() => leased.getCached(source, request(2))).toThrow('maxLeasedBytes')
    firstLease?.release()

    const total = createTileRuntime({
      limits: { maxOperationWorkingBytes: 8, maxTotalManagedBytes: 7 },
    })
    expect(total.putCached(source, request(0), tile(0, releases))).toBe(true)
    expect(() => total.reserveOperationWorkingBytes(8)).toThrow('maxTotalManagedBytes')
    const releaseWorking = total.reserveOperationWorkingBytes(3)
    expect(total.metrics().memory).toMatchObject({
      managedBytes: 4,
      operationWorkingBytes: 3,
      totalManagedBytes: 7,
      highWaterTotalManagedBytes: 7,
    })
    releaseWorking()
    expect(() => total.reserveOperationWorkingBytes(9)).toThrow('maxOperationWorkingBytes')
    const releaseEvictingWork = total.reserveOperationWorkingBytes(7)
    expect(total.metrics().cache.currentBytes).toBe(0)
    expect(total.metrics().memory.totalManagedBytes).toBe(7)
    releaseEvictingWork()
    total.clear()
    leased.clear()
  })

  it('deduplicates in-flight reads while giving each consumer an independent lease', async () => {
    const releases: number[] = []
    const deferred = new Deferred<TileSourceResult>()
    let reads = 0
    let underlyingAborts = 0
    const source: TileSource = {
      tileKey: canonicalTileKey,
      async readTile(tileRequest) {
        reads += 1
        tileRequest.signal.addEventListener('abort', () => {
          underlyingAborts += 1
        })
        return deferred.promise
      },
    }
    const runtime = createTileRuntime({ limits: { maxConcurrency: 1 } })
    const firstAbort = new AbortController()
    const first = runtime.request(source, request(0, firstAbort.signal))
    const second = runtime.request(source, request(0))
    firstAbort.abort(new Error('first left'))
    await expect(first).rejects.toThrow('first left')
    deferred.resolve({ tile: tile(0, releases) })
    const retained = await second
    expect(reads).toBe(1)
    expect(underlyingAborts).toBe(0)
    retained.release()
    expect(releases).toEqual([])
    runtime.clear()
    expect(releases).toEqual([0])
  })

  it('aborts underlying work only after every consumer leaves and removes failed in-flight work', async () => {
    let calls = 0
    let aborts = 0
    const source: TileSource = {
      tileKey: canonicalTileKey,
      async readTile(tileRequest) {
        calls += 1
        if (calls === 1) {
          return new Promise<TileSourceResult>((_resolve, reject) => {
            tileRequest.signal.addEventListener(
              'abort',
              () => {
                aborts += 1
                reject(tileRequest.signal.reason)
              },
              { once: true },
            )
          })
        }
        throw new Error('retry failure')
      },
    }
    const runtime = createTileRuntime()
    const left = new AbortController()
    const right = new AbortController()
    const first = runtime.request(source, request(0, left.signal))
    const second = runtime.request(source, request(0, right.signal))
    await new Promise((resolve) => setTimeout(resolve, 0))
    left.abort(new Error('left'))
    expect(aborts).toBe(0)
    right.abort(new Error('right'))
    await expect(first).rejects.toThrow('left')
    await expect(second).rejects.toThrow('right')
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(aborts).toBe(1)
    await expect(runtime.request(source, request(0))).rejects.toThrow('retry failure')
    expect(calls).toBe(2)
  })

  it('releases a dependency lease when cancellation prevents scheduler reacquisition', async () => {
    const releases: number[] = []
    const runtime = createTileRuntime({ limits: { maxConcurrency: 1 } })
    const dependency: TileSource = {
      tileKey: canonicalTileKey,
      async readTile(tileRequest) {
        return { tile: tile(tileRequest.address.x, releases) }
      },
    }
    const dependencyRequest = request(0, undefined, 'visible', { namespace: 'dependency' })
    expect(runtime.putCached(dependency, dependencyRequest, tile(0, releases))).toBe(true)

    const consumer = new AbortController()
    const parent: TileSource = {
      tileKey: (tileRequest) => `parent:${canonicalTileKey(tileRequest)}`,
      async readTile(tileRequest) {
        const pending = runtime.requestDependency(dependency, {
          ...dependencyRequest,
          signal: tileRequest.signal,
        })
        queueMicrotask(() => consumer.abort(new Error('cancel before resume')))
        const retained = await pending
        retained.release()
        throw new Error('dependency unexpectedly resumed')
      },
    }

    await expect(runtime.request(parent, request(2, consumer.signal))).rejects.toThrow(
      'cancel before resume',
    )
    await new Promise((resolve) => setTimeout(resolve, 0))
    runtime.clear()
    expect(releases).toEqual([0])
    expect(runtime.metrics().tasks).toMatchObject({ queued: 0, running: 0 })
  })

  it('runs priorities deterministically and eventually promotes background work', async () => {
    const gate = new Deferred<void>()
    const order: number[] = []
    const releases: number[] = []
    const source: TileSource = {
      tileKey: canonicalTileKey,
      async readTile(tileRequest) {
        const x = tileRequest.address.x
        if (x === 100) await gate.promise
        order.push(x)
        return { tile: tile(x, releases) }
      },
    }
    const runtime = createTileRuntime({
      limits: { maxConcurrency: 1, starvationInterval: 4, maxQueuedTasks: 100 },
    })
    const tasks: Promise<NumericTile>[] = [runtime.request(source, request(100))]
    tasks.push(runtime.request(source, request(1, new AbortController().signal, 'background')))
    tasks.push(runtime.request(source, request(2, new AbortController().signal, 'near-visible')))
    for (let index = 3; index < 15; index += 1) {
      tasks.push(runtime.request(source, request(index, new AbortController().signal, 'visible')))
    }
    gate.resolve()
    const tiles = await Promise.all(tasks)
    for (const result of tiles) result.release()
    expect(order[0]).toBe(100)
    expect(order.indexOf(1)).toBeLessThan(order.length - 1)
    expect(order.indexOf(2)).toBeLessThan(order.indexOf(1))
    runtime.clear()
  })

  it('keeps caches independent and contains throwing release callbacks', async () => {
    const releases: number[] = []
    const source: TileSource = {
      tileKey: canonicalTileKey,
      async readTile(tileRequest) {
        return { tile: tile(tileRequest.address.x, releases, 1, true) }
      },
    }
    const first = createTileRuntime()
    const second = createTileRuntime()
    const firstTile = await first.request(source, request(0))
    const secondTile = await second.request(source, request(0))
    firstTile.release()
    secondTile.release()
    first.clear()
    expect(second.has(request(0), source)).toBe(true)
    second.clear()
    expect(releases).toEqual([0, 0])
    expect(first.metrics().tasks.releaseFailures).toBe(1)
    expect(second.metrics().tasks.releaseFailures).toBe(1)
  })

  it('rejects hostile dimensions, source identity changes, and cache-key bombs', () => {
    const runtime = createTileRuntime({ limits: { maxKeyBytes: 32, maxTilePixels: 16 } })
    let reads = 0
    const bomb: TileSource = {
      tileKey: () => 'x'.repeat(33),
      async readTile(tileRequest) {
        reads += 1
        return { tile: tile(tileRequest.address.x, []) }
      },
    }
    expect(() => runtime.request(bomb, request(0))).toThrow('maxKeyBytes')
    expect(reads).toBe(0)
    expect(() => normalizeTileAddress({ ...address(0), x: -1 })).toThrow('non-negative')
    expect(() => normalizeTileAddress({ ...address(0), height: -1 })).toThrow('positive')
    expect(() => normalizeTileAddress({ ...address(0), width: 5, height: 5 }, 16)).toThrow(
      'maxTilePixels',
    )
    const first = canonicalTileKey(request(0))
    const changed = canonicalTileKey({
      ...request(0),
      address: {
        ...address(0),
        dataset: {
          ...address(0).dataset,
          source: {
            kind: 'local-file',
            strength: 'weak',
            stability: 'metadata',
            nameOrPath: 'fixture.bin',
            size: 1_024,
            lastModified: 11,
          },
        },
      },
    })
    expect(changed).not.toBe(first)
  })

  it('handles thousands of bounded queued tasks without exceeding concurrency', async () => {
    const gate = new Deferred<void>()
    let running = 0
    let highWater = 0
    const releases: number[] = []
    const source: TileSource = {
      tileKey: canonicalTileKey,
      async readTile(tileRequest) {
        running += 1
        highWater = Math.max(highWater, running)
        if (tileRequest.address.x === 0) await gate.promise
        running -= 1
        return { tile: tile(tileRequest.address.x, releases) }
      },
    }
    const runtime = createTileRuntime({
      limits: { maxCacheBytes: 1, maxConcurrency: 3, maxQueuedTasks: 2_000 },
    })
    const tasks: Promise<NumericTile>[] = []
    for (let index = 0; index < 1_500; index += 1) {
      tasks.push(runtime.request(source, request(index * 2)))
    }
    await Promise.resolve()
    expect(runtime.metrics().tasks.queued).toBeGreaterThan(1_000)
    gate.resolve()
    const results = await Promise.all(tasks)
    for (const result of results) result.release()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(highWater).toBeLessThanOrEqual(3)
    expect(runtime.metrics().tasks).toMatchObject({ queued: 0, running: 0, completed: 1_500 })
    expect(releases).toHaveLength(1_500)
  })

  it('contains repeated cancellation races even when running sources ignore abort', async () => {
    const releases: number[] = []
    const source: TileSource = {
      tileKey: canonicalTileKey,
      async readTile(tileRequest) {
        await new Promise((resolve) => setTimeout(resolve, 0))
        return { tile: tile(tileRequest.address.x, releases) }
      },
    }
    const runtime = createTileRuntime({
      limits: { maxCacheBytes: 1, maxConcurrency: 8, maxQueuedTasks: 256 },
    })
    const controllers = Array.from({ length: 128 }, () => new AbortController())
    const pending = controllers.map((controller, index) =>
      runtime.request(source, request(index * 2, controller.signal)),
    )
    await Promise.resolve()
    for (const controller of controllers) controller.abort(new Error('cancelled race'))
    const settled = await Promise.allSettled(pending)
    expect(settled.every((result) => result.status === 'rejected')).toBe(true)
    await new Promise((resolve) => setTimeout(resolve, 5))
    expect(runtime.metrics().tasks.inFlightRequests).toBe(0)
    expect(runtime.metrics().cache.currentBytes).toBe(0)
    expect(releases.length).toBeLessThanOrEqual(8)
  })

  it('cancels graph-node work when its namespace is invalidated while queued', async () => {
    const gate = new Deferred<void>()
    const releases: number[] = []
    const source: TileSource = {
      tileKey: canonicalTileKey,
      async readTile(tileRequest) {
        if (tileRequest.address.namespace === 'blocker') await gate.promise
        return { tile: tile(tileRequest.address.x, releases) }
      },
    }
    const runtime = createTileRuntime({ limits: { maxConcurrency: 1 } })
    const blocker = runtime.request(
      source,
      request(0, undefined, 'visible', { namespace: 'blocker' }),
    )
    const queued = runtime.request(
      source,
      request(2, undefined, 'background', {
        namespace: 'derived:invalidated-node',
        cacheClass: 'derived',
      }),
    )
    await Promise.resolve()
    expect(runtime.invalidate({ namespace: 'derived:invalidated-node' })).toBe(0)
    await expect(queued).rejects.toThrow('invalidated')
    gate.resolve()
    const retained = await blocker
    retained.release()
    runtime.clear()
  })

  it('bounds the queue, validates accounting, and supports disabled/reset metrics', async () => {
    const gate = new Deferred<void>()
    const releases: number[] = []
    const source: TileSource = {
      tileKey: canonicalTileKey,
      async readTile(tileRequest) {
        if (tileRequest.address.x === 0) await gate.promise
        return {
          tile: tile(tileRequest.address.x, releases),
          ...(tileRequest.address.x === 4 ? { accounting: { bytesRequested: Number.NaN } } : {}),
        }
      },
    }
    const runtime = createTileRuntime({
      limits: { maxConcurrency: 1, maxQueuedTasks: 2 },
      metrics: false,
    })
    const first = runtime.request(source, request(0))
    const second = runtime.request(source, request(2))
    await expect(runtime.request(source, request(6))).rejects.toThrow('maxQueuedTasks')
    gate.resolve()
    const results = await Promise.all([first, second])
    for (const result of results) result.release()
    await expect(runtime.request(source, request(4))).rejects.toThrow('byte accounting')
    expect(releases).toContain(4)
    await Promise.resolve()
    const disabled = runtime.metrics()
    expect(disabled.enabled).toBe(false)
    expect(disabled.cache.currentBytes).toBe(8)
    expect(disabled.tasks.completed).toBe(0)
    runtime.resetMetrics()
    expect(runtime.metrics().timeToFirstCompletedTileMilliseconds).toBeNull()
    runtime.clear()

    const failedTransfer: number[] = []
    const bomb: TileSource = { tileKey: () => 'x'.repeat(100), readTile: source.readTile }
    const strict = createTileRuntime({ limits: { maxKeyBytes: 8 } })
    expect(() => strict.putCached(bomb, request(0), tile(0, failedTransfer))).toThrow('maxKeyBytes')
    expect(failedTransfer).toEqual([0])
  })
})
