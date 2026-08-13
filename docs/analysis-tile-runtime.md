# Lazy analysis tile runtime

`purejsimage/analysis` provides an explicit, browser-portable `TileRuntime` for applications that
need repeated quantitative work on bounded native `NumericTile`s. It does not replace the ordinary
image pipeline, start a worker, or install a package-global cache. Each application creates and
owns its runtimes.

## Addresses and identity

A `TileAddress` identifies a dataset runtime identity, horizontal and vertical axes, sorted fixed
indices, resolution level, bounded region, cache class, namespace, and generation. A
`TileRequest` adds visible, near-visible, or background priority, a required `AbortSignal`, and
optional native sample-type/layout requirements.

Canonical keys exclude priority and abort state because neither changes pixels. Keys do include the
source identity, session discriminator for weak identities, generation, plane, level, region, and
target numeric semantics. `DerivedTileSource` additionally includes the operation ID/version,
normalized parameters, graph-node semantic hash, execution fingerprint, and exact provider/build/
implementation fingerprints. Labels and timestamps never enter semantic keys.

Use a new generation when future mutable data changes. Existing datasets and graph nodes remain
immutable. `runtime.invalidate()` removes matching cache entries by namespace, generation, cache
class, or predicate and cancels matching in-flight work by default. There is no observer or global
event bus.

## Basic source use

Adapt an existing `NumericTileSource`, then request one bounded tile:

```ts
import {
  createTileRuntime,
  numericTileSourceToTileSource,
} from 'purejsimage/analysis'

const runtime = createTileRuntime({
  limits: { maxCacheBytes: 64 * 1024 * 1024, maxConcurrency: 4 },
})
const source = numericTileSourceToTileSource(datasetNumericTiles)
const controller = new AbortController()

const tile = await runtime.request(source, {
  address: {
    cacheClass: 'source',
    namespace: 'source:experiment-42',
    dataset: {
      datasetId: 'experiment-42',
      source: sourceIdentity,
      sessionId: workspaceSessionId,
      generation: 0,
    },
    displayAxes: ['x', 'y'],
    fixedIndices: [{ axisId: 'channel', index: 3 }],
    resolutionLevel: 0,
    x: 0,
    y: 0,
    width: 256,
    height: 256,
  },
  priority: 'visible',
  signal: controller.signal,
  target: { sampleType: 'float32', layout: 'interleaved' },
})

try {
  consume(tile)
} finally {
  tile.release()
}
```

Weak and session-only source identities require an application session ID. A strong content or
versioned remote identity does not, although a caller may still supply one to isolate workspaces.
This prevents two unrelated weak local or in-memory sources from colliding without requiring a
multi-gigabyte content hash before first display.

## Ownership and scheduling

The ownership rules are strict:

- Before scheduling, every `TileSource` reports output, peak working, retained auxiliary bytes, and
  confidence through `estimate()`. Incomplete confidence reserves pessimistically up to the tile
  limit; a source that exceeds declared output or auxiliary retention is rejected.
- A `TileSource` transfers one owned tile to the runtime when `readTile()` resolves.
- The runtime validates the tile before admitting it. Failed admission releases the transferred
  tile.
- Every consumer receives an independent lease and must call `release()` exactly once. Release is
  idempotent.
- Cache eviction, replacement, deletion, invalidation, and clear release the cache reference. The
  underlying source/provider release runs once after the final consumer lease also leaves.
- One consumer abort does not affect other consumers of the same in-flight key. The source signal
  aborts when every consumer leaves.
- A derived provider owns its returned output until it transfers that output. Failure or abort after
  provider execution releases every returned output; source leases are released in all paths.

```text
source TileSource -> source cache reference -> derived provider input lease
                                             -> release input lease
derived provider -> requested tile only -> derived cache reference -> consumer leases
```

Identical keys share one computation. Scheduling has bounded concurrency and queue length,
deterministic visible/near-visible/background priority, FIFO ties, and deterministic aging so
background work is eventually promoted. A derived source temporarily yields its scheduler permit
while requesting a dependency and reacquires a permit before provider computation. This avoids
deadlock even with `maxConcurrency: 1` while keeping executable work bounded. Custom composite
`TileSource` implementations use `runtime.requestDependency()` only from their scheduled
`readTile()` call for the same reason.

The defaults are a 32 MiB cache, 1,024 entries, four concurrent tasks, 4,096 queued tasks, 16 KiB
keys, 16,777,216 pixels per tile, and priority aging every 16 dispatches. The cache limit is modest
enough for application defaults while still holding useful scientific tiles; four tasks bounds
allocation pressure without assuming workers or GPU execution. Applications should lower or raise
these explicit limits for their data and memory envelope.

## Derived tiles and halos

`createDerivedTileSource()` combines a source, normalized operation definition, one exact already
planned provider selection, graph-node semantic hash, and execution fingerprint. Planning remains
separate: the tile source does not discover providers or mutate a graph.

The optional halo function returns non-negative left/right/top/bottom samples from normalized
parameters. The runtime requests only the expanded source region, clips it to the selected level,
and requires the provider to return exactly the requested output region in distinct owned storage.
Only that output region enters the derived cache. The current explicit boundary mode is `clip`;
other padding semantics should be added only with operation-level semantic tests.

The selected provider must support the plan's complete valid tile-shape domain. Tile reads do not
repeat support or cost selection, and one derived node never becomes a heterogeneous mixture of
provider outputs. Provider identity is conservatively included in every derived key because
numeric equivalence classes are not yet fine-grained enough to prove safe cross-provider reuse.

## Metrics and limits

`runtime.metrics()` returns JSON-safe, per-runtime counters for cache behavior, source/derived
retained bytes, task states, cancellation/failure, known input/output bytes, provider estimates,
measured provider compute time, and time to first completed tile. Metrics are local only; no data is
transmitted. Set `metrics: false` to suppress counters, or call `resetMetrics()` while idle.

Retained memory means `NumericTile.data.byteLength` plus explicitly declared auxiliary retained
bytes. Peak source estimates also cover merge buffers and coverage maps before they are allocated;
an exact single source tile transfers directly without that merge copy. Managed memory excludes
JavaScript object overhead, allocator fragmentation, undeclared provider allocations, unreported
GPU-driver memory, and process RSS. Provider setup, transfer,
compute, and readback fields remain labeled estimates; only provider execution wall time is labeled
measured. The correctness-gated fixture is available as:

```sh
npm run bench:analysis:tiles
```

It validates and reports uncached first-tile, cached-repeat, neighboring-tile, and halo-derived-tile
work without claiming process peak memory.

`clear()` remains a recoverable cache/in-flight reset. `dispose()` is permanent: it rejects new
requests, aborts active work, waits for `whenIdle()`, and clears retained cache state. Repeated
disposal is safe, and `isDisposed` exposes the closing state.
