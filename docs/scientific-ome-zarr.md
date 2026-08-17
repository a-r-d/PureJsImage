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

A ZIP archive whose root contains `zarr.json` or `.zgroup` is also a store. Stored members stay
range-readable; deflated members are decoded as whole objects. The `.ozx` name is accepted as a
hint. RFC-9 zip-comment and `jsonFirst` recommendations are not required. Nested or multi-part
archives remain rejected. The reader does not invent a second store abstraction.

## Supported boundary

| Surface | Implemented boundary |
| --- | --- |
| Specification | OME-NGFF 0.5 image `multiscales` on Zarr v3, and OME-NGFF 0.4 on Zarr v2. |
| Resource model | Directory-like group plus arrays and chunk objects, or a ZIP archive with root-level Zarr metadata. |
| Chunks | Regular grids and `sharding_indexed` with index-at-end or index-at-start. Missing chunks become the declared fill value. |
| Codecs | `bytes`, `gzip`, `zlib`, `zstd`, `crc32c`, `transpose`, `shuffle`, and Blosc 1 with LZ4, LZ4HC, zlib, zstd, or memcpy. Index codecs are `bytes` and `crc32c`. |
| Mapping | Each multiscale image is one scientific dataset. Sibling `labels/` groups and root label indexes become separate datasets with `image-label` colors and source. Plate wells become one dataset per field, with well path and indices in metadata. Arrays become resolution levels. Axes, scale/translation, units, and optional OMERO channel names/colors are preserved. C- and F-order v2 arrays are converted to canonical plane order. |
| Reads | Selected planes fetch only intersecting shards/inner chunks. Emitted blocks are canonical big-endian rasters with caller-owned `release()`. |

## Explicit exclusions

- BloscLZ, Snappy, and Blosc bitshuffle
- Tables
- RFC-9 zip-comment / `jsonFirst` profile requirements
- Writers
- `int64`, complex, boolean, and structured data types

Unrecognized codecs fail with `UNSUPPORTED_OPERATION` and include the codec name.

## Evidence

Focused tests generate structural fixtures for v3 regular/gzip/zstd/sharded stores and v2
C-order, F-order, gzip, zlib, and Blosc memcpy/LZ4 stores. They pin selected samples, missing-chunk
fill, partial last chunks, F-order clipped and padded edge chunks, omitted v3 chunk-key encoding,
string/hex/null fill values, uint16/int16/float32/uint64, big-endian samples and shard indexes,
shuffle, numeric and `#RRGGBB` OMERO colors, UTF-8 BOM metadata, 4D and F-order 3D planes,
index-at-start shards, empty chunk objects, empty optional `.zattrs`, trailing dataset slashes,
`numcodecs.*` ids, case-insensitive NaN fills, gzip/Blosc edge chunks, crc32c array codecs,
zero-size and overlapping shard payloads, store-prefix and Node
directory resolution, browser `File` companions, stored and deflated ZIP roots, and hostile
traversal/limit cases. CRC-32C is checked against the Castagnoli vector `123456789`.

A pinned IDR 6001240 slice (CC-BY-4.0) independently encodes the same coarsest plane as NGFF 0.4
Blosc/LZ4 and NGFF 0.5 sharded Blosc/zstd. Both must decode to the same uint16 2x2 window.
Zarrita, Viv, Vizarr, Neuroglancer, and ITK-Wasm remain comparison targets, not runtime
dependencies.
