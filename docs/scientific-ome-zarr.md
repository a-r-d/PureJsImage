# OME-Zarr / NGFF

Milestone G adds an explicit, browser-portable OME-Zarr reader. Importing the base scientific
package still does not register any reader automatically.

```ts
import { createScientificLibrary } from 'purejsimage/scientific'
import { omeZarrReader } from 'purejsimage/scientific/readers/ome-zarr'

const science = createScientificLibrary({ readers: [omeZarrReader] })
const document = await science.open(context)
```

The primary resource is the store-root `zarr.json` for Zarr v3 or `.zgroup` / `.zattrs` for Zarr
v2. Child metadata and chunks resolve through `ScientificCompanionResolver` as normalized relative
names. Node callers can use `createScientificPathContext` on that root file; browser callers can
pass a directory `File` list through `createScientificFileContext`. A directory-picker path such as
`plate.zarr/zarr.json` keeps children under the same store prefix.

A ZIP archive whose root contains `zarr.json` or `.zgroup` is also a store. A single nested
prefix such as `image.zarr/zarr.json` is accepted; two sibling store roots are rejected. macOS
`__MACOSX/` sidecar members are ignored when deciding uniqueness. Stored members stay
range-readable; deflated members are decoded as whole objects and count against the chunk
byte cache at their decoded size. Metadata members must fit `maxMetadataBytes` and chunks
must fit `maxChunkBytes` before decompression. Probe treats `.ozx`, `.ome.zarr`, `.zarr.zip`, and `*.zarr`
ZIP magic as name-plus-magic evidence and does not open the archive. Generic `.zip` is not an
OME-Zarr hint. Deep ZIP validation happens on open. RFC-9 zip-comment and `jsonFirst`
recommendations are not required. The reader does not invent a second store abstraction.

A `bioformats2raw.layout` root without `multiscales` is scanned as consecutive series groups
`0/`, `1/`, … until the next integer path is missing. A leftover root `labels` list does not
replace that series scan. Extra integer series beyond `maxDatasets` fail with `LIMIT_EXCEEDED`.

## Supported boundary

| Surface | Implemented boundary |
| --- | --- |
| Specification | OME-NGFF 0.5 image `multiscales` on Zarr v3, and OME-NGFF 0.4 on Zarr v2. |
| Resource model | Directory-like group plus arrays and chunk objects, or a ZIP archive with root-level or one nested Zarr prefix. |
| Chunks | Regular grids and `sharding_indexed` with index-at-end or index-at-start. A missing chunk is fill only when a defined fill exists; Zarr v2 `fill_value: null` leaves missing contents undefined. |
| Codecs | `bytes`, `gzip`, `zlib`, `zstd`, `crc32c`, one `transpose`, `shuffle`, and Blosc 1 with byte shuffle or 8-element-aligned bitshuffle plus LZ4, LZ4HC, zlib, zstd, or memcpy. Index codecs are `bytes` and `crc32c` and must declare endian. |
| Mapping | Each multiscale image is one scientific dataset. Sibling `labels/` groups and root label indexes become separate datasets with `image-label` colors and source. Plate wells become one dataset per field, with well path and indices in metadata. `bioformats2raw.layout` series become one dataset per integer series path. Arrays become resolution levels. Axes, scale/translation, units, and optional OMERO channel names/colors are preserved. C- and F-order v2 arrays are converted to canonical plane order. |
| Reads | Selected planes fetch only intersecting shards/inner chunks. A plane session layers a bounded cache over the store LRU (`maxOpenSources` entries and `maxCachedChunkBytes`). One oversized shard may be held transiently for adjacent `rowsPerBlock` subdivisions; it is not retained in the persistent LRU and is reread on a later `readPlane`. Emitted blocks are canonical big-endian rasters with caller-owned `release()`. |

## Normalized storage metadata

Each OME-Zarr dataset descriptor exposes a JSON-safe `metadata.omeZarrLevels` array. It is a frozen
summary rather than a parser-internal Zarr object:

```ts
interface OmeZarrLevelStorageMetadata {
  readonly level: number
  readonly path: string
  readonly shape: readonly number[]
  readonly logicalChunkShape: readonly number[]
  readonly storageChunkShape: readonly number[]
  readonly sharded: boolean
  readonly codecs: readonly string[]
  readonly shardIndexLocation?: 'start' | 'end'
}
```

For regular arrays, logical and storage chunk shapes are equal. For `sharding_indexed`, the logical
shape is the inner chunk and the storage shape is the outer shard. Applications can display or plan
viewport reads from this normalized metadata without reparsing `zarr.json`.

## Remote whole-slide viewer

The [OME-Zarr WSI demo](https://purejsimage.com/ome-zarr/) opens a store-root URL (or its root
`zarr.json`, `.zgroup`, or `.zattrs`) and resolves normalized companion names within that root. The
demo adapter is intentionally local to the website; it reuses `omeZarrReader`, `HttpRangeSource`,
and `ScientificDataset.readPlane()` rather than adding a second parser or public store API.

The verified production inputs are the Jackson Laboratory OME 2024 NGFF Challenge conversions
`41028.zarr`, `46125.zarr`, and `42815.zarr`: OME-NGFF 0.5, Zarr v3,
`sharding_indexed`, 1,024 × 1,024 logical chunks, 32,768 × 32,768 outer shards, and Blosc/zstd
bitshuffle data. Their published catalog sizes are used only for the displayed fetched fraction.
For any other URL, the demo reports `Total store size unknown`; it does not infer a store total by
enumerating objects or summing individual object sizes.

Static hosting must permit cross-origin GET access and byte Range requests to shard objects, return
206 for valid ranges, and expose `Content-Range` to browser JavaScript. HEAD access and exposed
`Content-Length` are also required by the demo's bounded object opener. The verified Google Cloud
Jackson deployment currently returns a valid wire-level `Content-Range` but omits that header from
`Access-Control-Expose-Headers`; for this named exception, the demo establishes object size with
HEAD and still validates the 206 status and exact response length. Other CORS, status, range, or
content-encoding failures remain explicit errors.

Chunk resolution during a plane read is session cache, then the persistent store LRU, then the
companion resolver. Cacheable hits write through to both caches so a later `readPlane` can warm-hit
the store LRU. Each plane session retains at most `maxOpenSources` chunk entries,
`maxCachedChunkBytes` of chunk resources, the same two limits for decoded shard indexes, and a
bounded set of negative lookups. A source larger than `maxCachedChunkBytes` never enters either
LRU; the session may keep one such shard (and its decoded index) only while that plane is open so
`rowsPerBlock` subdivisions of a single-shard plane still resolve and decode the index once.
Traversal walks outer shard coordinates, then the intersecting inner range inside the current
shard, so temporary state stays O(rank plus those bounded caches) rather than one object per
selected chunk.

## Explicit exclusions

- BloscLZ, Snappy, and malformed or non-8-element-aligned Blosc bitshuffle blocks
- Zarr v3 `storage_transformers` (any nonempty list)
- Tables
- RFC-9 zip-comment / `jsonFirst` profile requirements
- Writers
- `int64`, complex, boolean, and structured data types

Zarr v2 integer `fill_value` still accepts decimal strings, hex bit patterns, and booleans as a
compatibility extension. Zarr v3 integer fills must be numbers. Zarr v3 float fills accept
numbers, `NaN` / `Infinity` strings, and hex bit patterns. Storage fill is recorded in dataset
metadata as `zarrFill` and is not copied to `noDataValue`.

When an axis omits `type`, the reader infers time, channel, or space from the common NGFF names
`t`/`time`, `c`/`channel`, and `x`/`y`/`z`; any other unnamed type is the single allowed custom
axis. Declared types still control composition: time, then at most one channel or custom axis,
then 2 or 3 spatial axes.

`bioformats2raw.layout` must be numeric `3`. The string `"3"` is accepted only as a documented
compatibility extension. Any other explicit layout is a definitive probe non-match and an open
metadata error; the reader does not fall through to numbered-series scanning. At most one
`transpose` codec is supported.

Unrecognized codecs fail with `UNSUPPORTED_OPERATION` and include the codec name.

## Evidence

Focused tests generate structural fixtures for v3 regular/gzip/zstd/sharded stores and v2
C-order, F-order, gzip, zlib, and Blosc memcpy/LZ4 stores. They pin selected samples, missing-chunk
fill, partial last chunks, F-order clipped and padded edge chunks, omitted v3 chunk-key encoding,
string/hex/null v2 fill values, uint16/int16/float32/uint64, big-endian samples and shard indexes,
shuffle, six-digit and integer OMERO colors, UTF-8 BOM metadata, 4D and F-order 3D planes,
index-at-start shards, present empty chunk objects, empty optional `.zattrs`, trailing dataset slashes,
`numcodecs.*` ids, case-insensitive NaN fills, gzip/Blosc edge chunks, crc32c array codecs,
all-ones shard-index sentinels, overlapping shard payloads, store-prefix and Node
directory resolution, browser `File` companions, stored and deflated ZIP roots, `*.zarr` /
`*.ome.zarr` ZIP probe hints, `__MACOSX/` sidecars beside a unique nested root, a root `labels`
list that must not hide bioformats2raw series, `maxDatasets` overflow on extra series, and hostile
traversal/limit cases. CRC-32C is checked against the Castagnoli vector `123456789`.

A pinned IDR 6001240 slice (CC-BY-4.0) independently encodes the same coarsest plane as NGFF 0.4
Blosc/LZ4 and NGFF 0.5 sharded Blosc/zstd. Both must decode to the same uint16 2x2 window.
A pinned IDR0033 `BR00109990_C2` 0.5 slice (CC-BY-4.0) is a bioformats2raw layout root; opening it
must publish series `0` and decode the coarsest uint16 plane, including when those members are
zipped under a single `*.zarr/` prefix.
The same IDR 6001240 stores also pin sibling `labels/0` groups. Additional CC-BY-4.0 slices cover
an IDR0010 0.5 plate well, an IDR0001 0.4 plate field, and an IDR0101 0.4 scale+translation image.
Zarrita, Viv, Vizarr, Neuroglancer, and ITK-Wasm remain comparison targets, not runtime
dependencies.
