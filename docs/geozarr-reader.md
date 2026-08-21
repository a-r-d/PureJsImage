# GeoZarr reader

`purejsimage/geo/readers/geozarr` opens read-only GeoZarr rasters through the existing generic Zarr
store and chunk engine. It supports Zarr v2, Zarr v3, regular chunks, supported v3 shards, HTTP
object stores, ZIP stores, and caller-supplied object stores. The Node-only
`purejsimage/geo/readers/geozarr/node` entry opens local directory stores.

The reader requires usable GeoZarr `spatial` metadata. A CRS may be unknown, but the horizontal
dimensions and affine grid must be explicit. Strict convention validation is the default.

## Opening stores

Open a remote store root without listing it:

```ts
import { openGeoZarrHttp } from 'purejsimage/geo/readers/geozarr'

const document = await openGeoZarrHttp('https://example.org/elevation.zarr')
const dataset = await document.openDataset(document.datasets[0]!.id)
```

Open a local directory in Node.js:

```ts
import { openGeoZarrDirectory } from 'purejsimage/geo/readers/geozarr/node'

const document = await openGeoZarrDirectory('/data/elevation.zarr')
```

`openGeoZarrObjectStore()` accepts the same runtime-neutral `ZarrObjectStore` contract used by the
generic substrate. `geoZarrReader.open()` accepts the scientific resource context used by other
format readers. A ZIP source can be the primary resource in that context.

Always close the document when the store is no longer needed. Closing clears the shared Zarr caches
and forwards closure to the owned object-store adapter.

## Bounded discovery

The reader opens the root metadata first. A `multiscales.layout` value names the exact level assets
that may be opened. A root array is one dataset. A group without a multiscale layout requires the
caller to provide bounded `candidateArrayPaths` when creating or opening the reader. The reader does
not list a remote bucket and does not combine sibling arrays because their shapes happen to match.

Each level prefers an explicit `spatial:transform`. If a derived level omits one, the reader uses a
declared multiscale scale and translation only when they are sufficient to compose an affine from
the named source level. An explicit transform that disagrees with the relative transform produces a
typed warning. Level dimensions do not need power-of-two relationships and origins may differ.

## Axes and reads

Zarr `dimension_names` remain in source order. The two `spatial:dimensions` become X and Y. Other
dimensions become band, time, vertical, depth, ensemble, scenario, or neutral custom axes. A view
must select every non-spatial axis by index or bounded range. A band dimension remains an axis. It
is not flattened into component metadata.

Pixel-region reads call the generic Zarr region planner. Only intersecting chunks or shard indexes
and inner chunks are read. Output remains bounded into rows and uses the existing scientific
`RasterBlock` and `NumericTile` conversion. Fill values are applied by the generic Zarr engine.
Nodata, scale, and offset remain explicit band metadata. The native stored sample type is preserved.

Declared one-dimensional coordinate arrays are opened as metadata during discovery and read only
when `readAxisCoordinates()` is called. Coordinate value reads have a separate value limit. Large
coordinate arrays are not embedded in the descriptor.

## Diagnostics

`GeoZarrDocument.inspectStructure()` returns JSON-safe evidence for:

- the Zarr version, root node, and selected metadata object;
- matched convention UUIDs and version evidence;
- datasets, arrays, dimensions, CRS, grids, levels, and resampling methods;
- logical chunk shapes and outer shard shapes;
- codecs and fill values;
- metadata and chunk requests and bytes;
- unique transferred bytes where the HTTP source can measure them;
- generic and HTTP cache hits, coalesced HTTP consumers, cancellation, and cache bytes; and
- convention compatibility warnings.

The report is diagnostic evidence. It does not certify a store layout or validate an external
catalog.

## Scope

The reader does not transform coordinates, write Zarr data, fetch convention schemas at runtime,
enumerate catalogs, interpret STAC, guess spectral band names, or load unrelated sibling arrays.
OME-Zarr keeps its current public APIs and uses the same lower Zarr implementation.
