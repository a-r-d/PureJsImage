# Generic Zarr substrate

PureJsImage has one internal Zarr implementation. OME-Zarr and GeoZarr use the same object stores,
metadata parser, chunk planner, shard reader, codec pipeline, and cache.

This substrate is internal. It does not add a `purejsimage/zarr` package export. Existing
OME-Zarr imports and behavior stay unchanged.

## Dependency direction

```text
ImageSource and object-store adapters
  -> Zarr v2/v3 metadata and hierarchy
    -> arrays, chunks, shards, codecs, and bounded region reads
      -> OME-NGFF interpretation
      -> GeoZarr interpretation
```

Code in `src/zarr` cannot import scientific, geo, analysis, application, extension, or docs-site
modules. OME-NGFF code may import the generic Zarr substrate. The generic substrate cannot import
OME-NGFF code.

## Module audit

| Category | Current modules | Ownership |
| --- | --- | --- |
| Generic Zarr storage | `src/zarr/core.ts`, `src/zarr/http-store.ts`, `src/zarr/node.ts`, `src/zarr/zip-store.ts` | Normalized object keys, HTTP Range objects, local directory objects, ZIP objects, bounded caches, store diagnostics, cancellation, and close propagation. |
| Generic Zarr metadata | `src/zarr/core.ts` | v2 and v3 root discovery, groups, arrays, attributes, shapes, dimension names, chunk grids, chunk key encodings, data types, byte order, and fill values. |
| Generic array and chunk decoding | `src/zarr/core.ts` | Region validation, region-to-chunk planning, missing-chunk fill, bounded chunk reads, canonical output bytes, and logical chunk handling. |
| Generic codec and sharding support | `src/zarr/core.ts`, `src/zarr/blosc.ts`, `src/zarr/crc32c.ts` | Codec ordering and validation, bytes, gzip, zlib, zstd, shuffle, transpose, Blosc, CRC-32C, and `sharding_indexed` indexes and inner chunks. |
| OME-NGFF semantic interpretation | `src/scientific/formats/ome-zarr.ts`, `src/scientific/readers/ome-zarr.ts` | OME multiscales, coordinate transformations, OMERO channels, image labels, plates, wells, display defaults, and scientific dataset mapping. |
| GeoZarr semantic interpretation | `src/geo/conventions/geozarr/`, `src/geo/readers/geozarr/` | Convention registration, CRS, grid geometry, multiscale layout, labeled axes, and Geo raster views. |
| Browser and source adapters | `src/zarr/http-store.ts`, `src/zarr/node.ts`, `src/scientific/browser.ts`, `src/scientific/node.ts`, `src/scientific/ome-zarr-http.ts`, `src/archive/zip.ts` | Runtime-specific source construction and compatibility adapters. The portable Zarr and GeoZarr entries do not import the Node directory adapter. |

The compatibility modules in `src/scientific/formats/zarr.ts`,
`src/scientific/formats/blosc.ts`, `src/scientific/formats/crc32c.ts`, and
`src/scientific/formats/zip.ts` preserve existing internal imports while delegating to the generic
implementations.

## Generic responsibilities

The substrate owns:

- v2 and v3 root discovery, groups, arrays, and attributes;
- v3 named or unnamed `dimension_names` and the named v2 `_ARRAY_DIMENSIONS` convention;
- regular chunk grids and default or v2 chunk key encoding;
- logical chunks inside `sharding_indexed` outer shards;
- codec pipelines, byte order, fill values, and canonical output bytes;
- bounded region reads that resolve only intersecting chunks and shards;
- HTTP Range, local directory, ZIP, and caller-supplied object stores;
- bounded metadata, source, chunk, and shard-index caches;
- store diagnostics, cancellation, identity resources, and close propagation.

The substrate rejects unsupported codecs, malformed hierarchy, unsafe paths, invalid shapes,
oversized metadata, oversized encoded chunks, and oversized decoded regions before unbounded work.
It keeps arbitrary attributes as generic data. It does not assign domain meaning to those
attributes.

## Semantic exclusions

The generic layer does not parse or validate:

- OME multiscales or coordinate transformations;
- OMERO channels or display defaults;
- image labels;
- plates, wells, or fields;
- GeoZarr CRS metadata;
- GeoZarr spatial transforms.

OME-NGFF 0.4 has historical root attributes that do not identify themselves as a Zarr node. That
compatibility recognition remains in the OME-NGFF layer. Generic v2 root discovery requires the
authored `.zgroup` or `.zarray` metadata object.

## Store and read lifetime

`ZarrObjectStore` is the runtime-neutral boundary. It resolves a normalized relative object path to
an `ImageSource`. The generic engine owns metadata and chunk cache policy above that boundary.

`ZarrStore.close()` is idempotent. It clears generic caches and forwards close to the object-store
adapter when that adapter owns resources. Read sessions remain explicit and must be released after
the bounded plane or region read that created them. The OME-Zarr HTTP compatibility API keeps its
existing caller-owned `context.store.close()` behavior.

No store import creates a package-global cache, opens a source, lists a remote bucket, or registers
a reader.

## Fixture policy

`tests/helpers/zarr-metadata-fixtures.ts` creates small v2 and v3 group and array metadata objects.
Substrate tests use it without OME fields. OME-Zarr and GeoZarr tests can add their domain
attributes around the same generic metadata builders. Large conformance fixtures and external
oracles remain separate because they test authored format behavior, not the small metadata builder.

## Compatibility

The released OME-Zarr public entries remain:

- `purejsimage/scientific/readers/ome-zarr`
- `purejsimage/scientific/browser`
- `purejsimage/scientific/node`

The extraction does not add a second array engine, chunk decoder, HTTP object store, ZIP parser, or
Blosc decoder. Existing OME-Zarr v2, v3, ZIP, HTTP Range, sharding, codec, conformance, and browser
tests continue to exercise the same implementation through compatibility adapters.
