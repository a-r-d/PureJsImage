# Scientific numeric tiles

Scientific readers continue to emit `RasterBlock`: bounded canonical big-endian bytes that are
portable across browsers, Node.js, storage, and future RPC boundaries. Repeated computation should
use `NumericTile` one layer above that boundary. A numeric tile contains native-endian typed data,
component and layout metadata, element strides, and an idempotent `release()` callback.

`rasterBlockToNumericTile()` preserves the source numeric type by default. Canonical `float16`
expands to `Float32Array`; canonical `uint64` remains exact in `BigUint64Array`. A caller may request
a checked target type, but conversion rejects overflow or precision loss rather than silently
rounding. Preserved `uint8` and `int8` blocks are zero-copy when no destination or allocator is
supplied. Wider preserved values can only be zero-copy on a big-endian host with aligned byte and
stride boundaries; common little-endian hosts perform one canonical-to-native conversion.

Reusable storage is explicit. Pass a destination typed array or a caller-owned `NumericTileAllocator`;
there is no package-global pool. For copied tiles, source-block ownership is released as soon as
conversion completes and tile release returns only allocator-owned storage. For a zero-copy tile,
tile release propagates to the source block. Both paths are idempotent and release on conversion or
cancellation errors.

## Dataset bridge and direct sources

`scientificDatasetToNumericTileSource(dataset)` permanently adapts any labeled-axis
`ScientificDataset`. It preserves lazy region reads and converts each emitted block once during a
consumer pass. `resolveNumericTileSource(dataset, options)` uses an explicitly attached
`numericTileSource` only when its declared source type, native type, component count, layout, and
target-type support match exactly; otherwise it selects the portable adapter.

A future WASM or specialized reader opts in by implementing `DirectNumericTileDataset` and attaching
a `NumericTileSource` with exact `directSemantics`. Application code keeps calling the resolver and
does not import or detect the provider. The direct source remains responsible for honoring the same
region, cancellation, metadata, and release contract. The source object is an ordinary local
capability: importing PureJsImage does not register it globally, and it is not a sandbox.

A future tile cache can wrap a `NumericTileSource` and supply its own allocator/lifetime policy. This
PR intentionally adds no shared cache or long-lived retention.
