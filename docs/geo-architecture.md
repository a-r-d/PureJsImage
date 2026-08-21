# Geo namespace architecture decision

Status: accepted on 2026-08-20

## Context

PureJsImage already has lazy scientific datasets, bounded numeric tiles, GeoTIFF metadata, TIFF and
OME-Zarr readers, and bounded raster operations. Geospatial raster work needs a public domain
boundary without replacing those implementations or changing existing imports.

## Decision

`purejsimage/geo` is a public subpath of the existing `purejsimage` npm package. It is not a separate
npm artifact. Existing root, TIFF, scientific, and OME-Zarr imports keep their current behavior.

The initial geo scope covers georeferenced rasters and multidimensional grids. It owns public names
for raster grid geometry, coordinate references, dimensions, bands, resolution levels, bounded
views, target grids, coordinate transforms, and an explicit geo reader set. It does not define
general GIS geometry, vector features, routing, map rendering, or spatial databases.

A `GeoRasterDataset` is a domain adapter over one existing `ScientificDataset`. It stores the same
scientific dataset object and delegates bounded reads through its existing `NumericTileSource`.
Creating the adapter reads and copies no source pixels. Full-component reads keep the source tile
and its release callback. A bounded component selection may allocate a smaller output tile. The
adapter preserves native numeric sample types, cancellation, resolution levels, document ownership,
and source release ownership. `GeoTargetGrid` is the shared public grid for geo readers and raster
operations. Its execution adapter uses the existing bounded numeric resampling kernel. The package
does not create another dataset engine, raster buffer, scheduler, or cache for geo work.

Geo code may import documented scientific dataset, reader, and numeric-tile primitives. Scientific
code must not import geo code. Format and storage implementations stay below both domain layers:

```text
applications and catalog workflows
  -> geo raster contracts
    -> scientific dataset and numeric-tile contracts
      -> TIFF, Zarr, codecs, RasterBlock, and ImageSource
```

TIFF, Zarr, codecs, and source abstractions remain format and transport infrastructure. Stable
implementations stay in their current modules. The GeoTIFF reader adapts the existing scientific
TIFF dataset and uses the same parsed TIFF document, native strip and tile decoders, encoded-byte
cache, source session, and HTTP Range source. It does not contain another TIFF parser or decoder.
The `purejsimage/geo/conventions/geozarr` entry reads pinned GeoZarr `proj`, `spatial`, and
`multiscales` attributes without opening chunks. The `purejsimage/geo/readers/geozarr` entry combines
that result with the generic Zarr substrate and the existing scientific dataset adapter. It does
not contain another object store, chunk decoder, shard decoder, or raster engine. The
[GeoZarr convention metadata guide](./geozarr-conventions.md) records the exact supported versions
and source evidence. The [GeoZarr reader guide](./geozarr-reader.md) describes discovery, reads,
stores, and diagnostics.

World-file images, ENVI, Esri ASCII Grid, and SRTM HGT are small format adapters over the same
boundary. World-file images reuse the existing TIFF, JPEG, or PNG reader. ENVI reuses the existing
scientific ENVI decoder for BSQ, BIL, and BIP. ASCII Grid states that text reads are sequential. HGT
uses bounded row reads from its big-endian elevation source. The
[contained geo formats guide](./geo-contained-formats.md) documents their evidence and access limits.

Classic NetCDF is another portable adapter over the scientific dataset engine. The
`purejsimage/geo/readers/netcdf` entry parses CDF-1 and CDF-2 headers, reads only bounded coordinate
and selected data regions, and publishes one dataset per regular rectilinear CF raster variable.
It preserves labeled non-spatial dimensions and native values. CDF-5, HDF5-backed NetCDF4,
irregular coordinate lookup, and curvilinear grids remain explicit unsupported boundaries. The
[classic NetCDF and CF guide](./netcdf-cf.md) records the supported metadata and grid rules.

## GeoTIFF reader

`purejsimage/geo/readers/geotiff` is the first complete geo reader. It accepts GeoTIFF grids with a
usable affine transform and returns `GeoRasterDataset` views over the same lazy scientific TIFF
dataset. A TIFF with no geospatial tags is rejected with guidance to use the scientific TIFF reader.
A GeoTIFF that contains tiepoint or transform evidence which cannot form a supported affine remains
structurally inspectable, but it does not expose an inaccurate raster dataset.

The reader normalizes pixel scale, tiepoints, model transformations, GeoKeys, GDAL metadata, nodata,
pixel registration, bands, CRS citations, units, vertical reference evidence, and every resolution
level. Recognized high-value GeoKeys have named fields. Unknown keys remain bounded evidence,
including their tag location and an explanation when their value location is unsupported.

Pixel scale plus multiple tiepoints defines an affine only when every tiepoint agrees with the first
tiepoint and scale. Inconsistent points produce typed errors. Tiepoints without pixel scale are kept
as ground-control-point evidence and produce a typed warning. PureJsImage does not claim that this
is arbitrary GCP warping.

Explicit overview georeferencing takes priority. When an overview has no explicit transform, the
scientific TIFF reader derives a level transform from base and overview dimensions. The geo adapter
records whether each level transform was explicit or derived and warns when an explicit overview
does not preserve the base origin and proportional grid geometry. Pyramid dimensions do not need to
be powers of two.

`GeoTiffDocument.inspectStructure()` returns a JSON-safe report with container and byte order,
object size, IFD and SubIFD layout, image and overview dimensions, compression and sample layout,
geospatial evidence, likely structural issues, range-read suitability, request and byte counts, and
range and encoded-cache activity. The report identifies itself as a structural diagnostic and sets
`formalCogCertification` to `false`. It is not a formal COG certification service.

Coordinate transformation is dependency-injected. A target-grid plan records a transform identity,
version, and accuracy. Execution receives the matching inverse transform from the caller. The base
package does not discover, download, or bundle a projection engine.

## Target grids and coordinate transforms

`GeoTargetGrid` records the CRS, dimensions, pixel-to-world affine, exact inverse affine, pixel
registration, transformed-corner bounds, numeric sample type, nodata policy, and band layout.
Geographic wrapped bounds are a separate optional field. A wrapped extent does not become an
ordinary ordered longitude range.

Grid comparison is explicit. The geo entry provides exact target-grid equality, same-CRS
classification, overlap, pixel alignment, pyramid-level compatibility, output dimension estimates,
and target-grid proposals. Similar dimensions or bounds do not establish alignment. A proposed
axis-aligned grid requires an explicit corner so row and column direction are known.

Canonical target-grid and reprojection-plan JSON has sorted object keys and normalized values. It is
suitable for recipe and cache identities. CRS evidence, confidence, and diagnostics are excluded
from semantic CRS identity. CRS definition fields, coordinate epoch, units, formal axes, vertical
reference, and application X/Y roles remain part of that identity.

`GeoCoordinateTransformer` provides forward and optional inverse functions with source and target
CRS values, transform identity, implementation identity, accuracy, optional area of use, warnings,
and optional disposal. Same-CRS work uses the built-in identity transform. Cross-CRS work requires a
caller-supplied transformer or provider. A small adapter accepts an externally supplied
proj4-compatible function or object behind an explicit implementation identity. PureJsImage does
not depend on proj4 or PROJ at runtime.

## Bounded reprojected reads

`readReprojectedGeoRegion()` requires a target grid and target pixel region. A full target is read
only when the caller requests the full target region and the configured limits admit it. The
operation scans the bounded target region to find the exact source pixel window needed by the
inverse mapping, reads that window through the existing lazy `GeoRasterView`, and evaluates the
existing numeric resampling kernel. Source and output pixel, sample, byte, and working-memory limits
are checked before allocating their buffers.

Nearest resampling keeps the native sample type, so categorical values remain exact. Bilinear
resampling requires float output. Nodata contributors have zero weight, and the output is nodata
when the remaining weight is below `minimumValidWeight`. Nodata sentinels are never interpolated as
ordinary numbers. Result provenance records the source and target grid identities, transform and
implementation identities, accuracy, warnings, resampling method, and valid-weight rule.

Longitude wrapping remains explicit. Geographic latitude bounds are validated. A source or target
grid that crosses the antimeridian returns an unsupported-operation error that requires the caller
to split the request. The base package does not silently normalize or split that region.

Band math, normalized difference, linear combination, raster subtraction, hillshade, slope, aspect,
region statistics, histogram, and line profile plans are available from `purejsimage/geo`. Their
existing `purejsimage/analysis` imports remain valid. Both entries use the same numeric tile,
nodata, limits, and resampling implementations.

## Raster contracts

`GeoSpatialReference` keeps formal CRS information separate from application X and Y roles. Formal
axis order can differ from raster-world coordinate order. The contract can record an authority and
code, WKT2, bounded PROJJSON, horizontal and vertical units, a vertical CRS, coordinate epoch,
formal axes, source evidence, confidence, and typed diagnostics. An unknown CRS stays unknown. Grid
georeferencing alone does not create an authority or code.

`GeoGridGeometry` records width, height, spatial dimension identities, a six-value pixel-to-world
affine, its inverse when it exists, transformed-corner bounds, pixel registration, nodata, optional
wrapped geographic bounds, and warnings. Bounds use all four transformed corners. Rotation, shear,
positive Y resolution, and negative Y resolution are valid. A singular affine remains describable,
but world-coordinate reads are unavailable.

`GeoRasterLevel` describes each source-defined resolution level. It records the source level and
ordering, dimensions, per-level grid, nominal resolution, known downsample relationship, and a
bounded storage summary. Levels do not need power-of-two dimensions or identical affine terms.

`GeoBandDescriptor` describes stored sample components. `GeoAxisDescriptor` describes non-spatial
dimensions such as band, time, vertical, depth, ensemble, scenario, or another named dimension.
These concepts remain distinct. A band dimension in a cube is not collapsed into component
metadata. Small useful coordinate lists may be embedded. Large lists use bounded lazy coordinate
reads.

`GeoRasterView` chooses X and Y dimensions, one level, source components, and fixed indices or
bounded ranges for every non-spatial dimension. Pixel reads use explicit bounded pixel regions.
World reads apply the selected level's inverse affine and request a conservative bounded pixel
region. A view never duplicates the source dataset.

## Scientific conversion

`adaptScientificDatasetToGeo()` requires explicit scientific geospatial evidence, one X axis, one Y
axis, and a pixel-to-world affine. Physical microscope calibration without a scientific spatial
reference is not treated as a geographic or projected CRS. The adapter keeps all other labeled axes
as first-class Geo axes and translates every declared resolution level.

`geoSpatialReferenceToScientific()` converts back to the smaller scientific spatial contract. It
returns typed diagnostics when the scientific form cannot retain WKT2, PROJJSON, formal CRS axes,
vertical CRS details, coordinate epoch, evidence, or confidence state.

Public normalization validates affine inverses and transformed bounds, unique dimensions, shape and
axis consistency, source component indices, levels, registration, nodata, scale and offset,
metadata limits, and unknown CRS state. Metadata remains immutable, JSON-safe, depth-limited,
count-limited, and string-limited.

The geo core excludes:

- STAC clients, search, and catalog browsing;
- application workflows, projects, persistence, and credentials;
- user interfaces and map viewers;
- agents and automated application actions;
- a built-in coordinate reference system database or projection engine.

These features can consume the public geo contracts from applications or separate integration
layers. They are not dependencies of `purejsimage/geo`.

## Public entries

- `purejsimage/geo` exports the initial geo raster and coordinate contracts.
- `purejsimage/geo` also exports shared target grids, transform providers, bounded reprojection, and
  the existing geo raster analysis operations.
- `purejsimage/geo/readers` exports the geo reader type boundary.
- `purejsimage/geo/readers/all` exports the explicit `geoReaders` set containing GeoTIFF, GeoZarr,
  world-file image, ENVI, Esri ASCII Grid, SRTM HGT, and classic NetCDF readers.
- `purejsimage/geo/readers/geotiff` exports the GeoTIFF adapter and structural report contracts.
- `purejsimage/geo/readers/geozarr` exports the portable GeoZarr reader, caller-supplied object-store
  opening, and HTTP opening.
- `purejsimage/geo/readers/geozarr/node` exports the Node-only local-directory opener.
- `purejsimage/geo/readers/world-file` exports portable explicit-companion and bounded HTTP opening.
- `purejsimage/geo/readers/world-file/node` exports the Node-only local-path opener.
- `purejsimage/geo/readers/envi`, `/esri-ascii-grid`, and `/srtm-hgt` export the remaining portable
  contained-format readers.
- `purejsimage/geo/readers/netcdf` exports the portable CDF-1, CDF-2, and bounded CF rectilinear
  reader plus its metadata-only grid-mapping registry.
- `purejsimage/geo/conventions/geozarr` exports the read-only, version-aware GeoZarr convention
  metadata layer.

`purejsimage/geo/browser` is the narrow browser transport entry. It exports the browser-safe
`HttpRangeSource`, `BlobSource`, and `MemorySource` implementations and their public source types.
The environment-neutral geo contracts remain in `purejsimage/geo`. Browser code still imports
format readers through their explicit public reader subpaths.

## Consequences

Geo can grow as a raster-focused domain without making scientific readers depend on geo concepts.
Applications can keep using existing scientific TIFF and OME-Zarr imports. The base geo entry does
not expose GeoTIFF, TIFF, or Zarr parser internals. Format readers remain explicitly imported and
preserve bounded reads and existing source ownership rules.
