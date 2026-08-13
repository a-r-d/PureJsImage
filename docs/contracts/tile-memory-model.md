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
| operation-working | explicitly reserved kernel scratch, merge coverage, halo, and intermediate bytes | operation scope |
| retained auxiliary | non-tile bytes a source retains with the result | cache/result lifetime |

`TileSource.estimate()` runs before allocation and reports `outputBytes`, peak working bytes
including output, retained auxiliary bytes, and confidence. Exact estimates are validated against
the returned tile and accounting. An estimate with incomplete confidence is reserved
pessimistically up to `maxTileBytes`; a trusted source that understates exact allocation violates
the contract and its result is rejected, though JavaScript cannot retroactively prevent memory it
already allocated.

## Limits

`maxTileBytes`, `maxCacheBytes`, `maxInFlightBytes`, `maxLeasedBytes`,
`maxOperationWorkingBytes`, `maxTotalManagedBytes`, cache-entry, queue, concurrency, key, and pixel
limits are hard admission limits over reported managed classes. Work is rejected before allocation
when its estimate cannot fit. Actual sample type, component count, layout, dimensions, stride,
backing storage, and retained auxiliary bytes are checked again after production.

The guarantee depends on trusted source/provider estimates. It excludes JavaScript object/header
overhead, allocator fragmentation, engine-retained pages, unreported native/WASM or GPU allocation,
browser-decoder internals, and process RSS. Peak RSS must be measured separately in an isolated
process. Browser memory APIs are incomplete and must not be presented as hard process limits.

## Ownership transitions

A completed tile is initially owned by the producer. The runtime either transfers it directly to a
single consumer, installs it in cache and issues a lease, or releases it on failure. An exact
single-source tile may transfer ownership without a merge copy. Multi-tile assembly reserves packed
output plus coverage/merge scratch and holds source chunks only for the bounded assembly scope.

In-flight deduplication shares one producer among consumers but gives each consumer an independent
lease. Cancelling one consumer does not invalidate another. When the last consumer cancels, the
shared abort signal stops source/merge work and every acquired tile/scratch allocation is released.
Cache eviction never invalidates an outstanding lease; leased bytes move out of cache accounting
and remain charged until release.

Halo operations charge the fetched source tiles as normal source/in-flight bytes and charge kernel
halo/intermediate buffers to operation-working memory. Providers report output in
`peakWorkingBytes`; callers must not double reserve the same output. `decodedInputBytes` measures
decoded input-tile bytes, not network transfer.

`clear()` aborts queued/in-flight work and drops releasable cache entries but leaves the runtime
reusable. `dispose()` permanently closes admission, cancels active work, waits for idle cleanup, and
is idempotent. Requests after closing fail synchronously.

## Future GPU memory

The current contract covers CPU `ArrayBuffer`/typed-array storage. A WebGPU provider must separately
report upload, device-resident working/retained bytes, readback, and CPU staging. Driver-private
memory remains outside the portable total. GPU-resident graph values require a versioned ownership
contract before they can be included in a hard managed-memory claim.
