# Tile runtime memory model

Status: normative alpha contract for the CPU tile runtime. Managed-byte limits are not process RSS
limits.

## Byte classes

| Class | Definition | Lifetime |
| --- | --- | --- |
| source | bytes decoded/read by a source to produce a tile | source read or transferred tile ownership |
| derived | output bytes produced by an operation tile kernel | operation/read result lifetime |
| cached | retained tile and declared auxiliary bytes owned by the LRU | until lease transfer, invalidation, clear, or eviction |
| leased | cached/result bytes currently held by consumers | until each independent lease releases |
| in-flight | pre-reserved source `peakWorkingBytes` while a tile request runs | request completion/failure/cancellation |
| operation-working | explicitly scoped reducer scratch and intermediate bytes | lexical callback scope |
| retained auxiliary | non-tile bytes a source retains with the result | cache/result lifetime |

`TileSource.estimate()` runs before allocation and reports hard conservative
`outputRetainedBytes`, peak working bytes including output, and retained auxiliary bytes. The
runtime validates those maxima against the returned tile and accounting. Timing uncertainty is a
separate `TileTimingEstimate`; it never inflates or weakens a memory bound. A trusted source that
understates allocation violates the contract and its result is rejected, though JavaScript cannot
retroactively prevent memory it already allocated.

## Numeric source read plans

`NumericTileSource.planRead()` describes one request before its iterator starts. Its
`maximumEmittedTileRetainedBytes` is a hard upper bound for the complete `ArrayBuffer` backing any
one emitted source tile. It is not the size of the final adapter output. The bound may therefore be
smaller than the requested packed output when a source streams small chunks. An omitted plan means
`streamed` delivery with the packed requested output size as the conservative per-chunk bound.
Planning is pure for the request's shape, axes, and target semantics: repeated planning for the same
read must return the same delivery and bound and must not vary with `AbortSignal` identity or timing.

Delivery is explicit:

- `single-exact` guarantees one tile with the exact requested region and semantics. The adapter
  reads that tile once, closes the iterator, and may transfer its ownership without a copy. It does
  not request a second tile to discover whether the first was the last.
- `streamed` permits one or more partial tiles. The adapter validates, copies, and releases each
  source chunk before requesting the next one, and always returns its own compact packed output.

For `streamed`, let `P` be the packed output bytes, `C` the one-byte-per-pixel coverage allocation,
and `S` the maximum emitted source-tile backing allocation. The adapter reports:

```text
outputRetainedBytes = P
peakWorkingBytes = P + C + S
```

For `single-exact`, where `S` covers the transferred exact tile backing allocation:

```text
outputRetainedBytes = S
peakWorkingBytes = S
```

Every product and sum is checked as a non-negative safe integer. The adapter rejects an observed
tile whose full backing allocation exceeds `S`. Timing confidence is never part of either formula.

## Limits

`maxTileBytes`, `maxCacheBytes`, `maxInFlightBytes`, `maxLeasedBytes`,
`maxOperationWorkingBytes`, `maxTotalManagedBytes`, cache-entry, queue, concurrency, key, and pixel
limits are hard admission limits over reported managed classes. Work is rejected before allocation
when its estimate cannot fit. Actual sample type, component count, layout, dimensions, stride,
backing storage, and retained auxiliary bytes are checked again after production. Tile retention is
the complete `tile.data.buffer.byteLength`, not merely the visible typed-array view.

The guarantee depends on trusted source/provider estimates. It excludes JavaScript object/header
overhead, allocator fragmentation, engine-retained pages, unreported native/WASM or GPU allocation,
browser-decoder internals, and process RSS. Peak RSS must be measured separately in an isolated
process. Browser memory APIs are incomplete and must not be presented as hard process limits.

## Ownership transitions

A completed tile is initially owned by the producer. The runtime either transfers it directly to a
single consumer, installs it in cache and issues a lease, or releases it on failure. An exact source
tile may transfer ownership without a merge copy only when a pre-read `single-exact` plan covers its
complete backing allocation. Streamed pooled or padded views are copied into compact owned storage.
The adapter's in-flight peak includes the packed merge output, coverage storage, and the one source
chunk currently owned; these are not separately reserved as operation-working memory.

In-flight deduplication shares one producer among consumers but gives each consumer an independent
lease. Cancelling one consumer does not invalidate another. When the last consumer cancels, the
shared abort signal stops source/merge work and every acquired tile/scratch allocation is released.
Cache eviction never invalidates an outstanding lease; leased bytes move out of cache accounting
and remain charged until release.

Halo operations charge fetched source tiles as normal source/in-flight bytes. Provider-owned kernel
output and intermediate buffers are admitted through request-specific `peakWorkingBytes`; callers
must not double reserve the same output. Graph-level reducers use lexical operation-working scopes.
`decodedInputBytes` measures decoded input-tile bytes, not network transfer.

`clear()` aborts queued/in-flight work and drops releasable cache entries but leaves the runtime
reusable. `dispose()` permanently closes every acquisition and mutation path, cancels active work,
waits for requests and active `withOperationWorkingBytes()` callbacks, and returns one stable
idempotent cleanup promise. Provider tile-kernel estimates reserve output and scratch through tile
admission; no public caller-owned reservation closure exists. Read-only metrics, `whenIdle()`,
`isDisposed`, and repeated clear/dispose remain
available after closing.

## Future GPU memory

The current contract covers CPU `ArrayBuffer`/typed-array storage. A WebGPU provider must separately
report upload, device-resident working/retained bytes, readback, and CPU staging. Driver-private
memory remains outside the portable total. GPU-resident graph values require a versioned ownership
contract before they can be included in a hard managed-memory claim.
