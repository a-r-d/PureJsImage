# Lifecycle and ownership contract

Status: normative alpha contract. Cleanup methods are explicit; garbage collection is not a
substitute for releasing leased buffers, providers, or documents.

| Value | Owner | Valid until | Cleanup |
| --- | --- | --- | --- |
| `ScientificDocument` | caller | `close()` begins | `await close()` when provided |
| reader-backed `ScientificDataset` | document | document closes | inherited from document |
| result-backed lazy `ScientificDataset` | execution result | result release begins | `await result.release()` |
| `NumericTile` | caller holding the tile lease | first `release()` | `release()` |
| prepared analysis plan | caller | `dispose()` begins for new work; existing leases continue | `await plan.dispose()` |
| execution result | caller | first `release()` | `await result.release()` |
| tile-runtime result lease | requesting consumer | lease release or cancellation | `release()` |
| `TileRuntime` | application | `dispose()` begins | `await runtime.dispose()` |
| prepared operation runtime/provider | owning plan/runtime | owner disposal after executions drain | `await dispose()` |
| prepared extension host | application | `dispose()` begins | `await preparedHost.dispose()` |

## Required behavior

- `release()`, `close()`, and `dispose()` are idempotent. Repeating cleanup performs no second
  release and returns or awaits the original cleanup outcome.
- Closing a plan or runtime synchronously prevents new execution or tile requests. Asynchronous
  disposal waits for leases or active execution according to the table.
- `plan.dispose()` waits for execution-result leases, including lazy datasets that have not yet
  served their first tile. `result.release()` releases owned outputs before releasing the plan
  lease.
- `runtime.clear()` is a cache/in-flight reset, not permanent disposal. `runtime.dispose()` is
  permanent; `isDisposed` becomes true when closing begins, and `whenIdle()` resolves after active
  work drains or is cancelled.
- A cancelled consumer releases only its own lease. Shared in-flight source work continues while at
  least one consumer remains. If all consumers cancel, the runtime aborts the shared request and
  releases every produced allocation.
- A tile is invalid after release. A result output, including a lazy dataset, is invalid after
  result release. Callers must not retain typed-array views beyond their owner.

Cleanup may reject if a provider, source, or user-supplied release callback throws. Implementations
must still attempt every remaining cleanup and preserve the first error. Graph execution failures
remain primary when cleanup also fails during error unwinding.

Provider disposal occurs in reverse preparation order after executions are idle. Result outputs are
released in deterministic ownership order; callers must not depend on side effects between
independent releases.

## Correct usage

```ts
const document = await scientific.open(resources, { signal })
const runtime = createTileRuntime(limits)
let plan
let result
try {
  const dataset = await document.openDataset(document.datasets[0].id)
  plan = await controller.planGraph(graph, { bindings: bind(dataset), signal })
  result = await controller.executeGraph(plan, { signal }).result
  const output = result.outputs.get('dataset')
  await consumeLazyDataset(output, signal)
} finally {
  await result?.release()
  await plan?.dispose()
  await runtime.dispose()
  await document.close?.()
}
```

For individual tiles:

```ts
const tile = await iterator.next()
if (!tile.done) {
  try {
    consume(tile.value)
  } finally {
    tile.value.release()
  }
}
await iterator.return?.()
```
