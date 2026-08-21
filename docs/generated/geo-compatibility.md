<!-- Generated from capabilities/geo-manifest.json. Do not edit directly. -->
# Geo compatibility evidence

## Quick Answer

This table is generated from checked capability records. A feature is marked Tested only when
the manifest names deterministic executable evidence. Fixture-limited and metadata-only states
are not treated as complete support.

| Format | Local open | Remote open | Range access | Region read | Multiscale | Rotated affine | Pixel is area | Pixel is point | Unknown CRS | Bands | Time | Vertical | Nodata | Scale and offset | Target grid | Reprojection | Writer |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| GeoTIFF | Tested [evidence](#test-geotiff) | Tested [evidence](#test-geotiff) | Tested [evidence](#test-geotiff) | Tested [evidence](#test-geotiff) | Tested [evidence](#test-geotiff) | Tested [evidence](#test-geotiff) | Tested [evidence](#test-geotiff) | Tested [evidence](#test-geotiff) | Tested [evidence](#test-geotiff) | Tested [evidence](#test-geotiff) | Unavailable | Metadata only [evidence](#test-geotiff) | Tested [evidence](#test-geotiff) | Metadata only [evidence](#test-geotiff) | Tested [evidence](#test-grid) | Tested [evidence](#test-grid) | Out of scope [evidence](#policy-geo) |
| COG behavior | Tested [evidence](#test-geotiff) | Tested [evidence](#test-geotiff) | Tested [evidence](#test-geotiff) | Tested [evidence](#test-geotiff) | Tested [evidence](#test-geotiff) | Tested [evidence](#test-geotiff) | Tested [evidence](#test-geotiff) | Fixture-limited [evidence](#test-geotiff) | Fixture-limited [evidence](#test-geotiff) | Tested [evidence](#test-geotiff) | Unavailable | Metadata only [evidence](#test-geotiff) | Tested [evidence](#test-geotiff) | Metadata only [evidence](#test-geotiff) | Tested [evidence](#test-grid) | Tested [evidence](#test-grid) | Out of scope [evidence](#policy-geo) |
| GeoZarr | Tested [evidence](#test-geozarr) | Tested [evidence](#test-geozarr) | Tested [evidence](#test-geozarr) | Tested [evidence](#test-geozarr) | Tested [evidence](#test-geozarr) | Tested [evidence](#test-geozarr) | Tested [evidence](#test-geozarr) | Tested [evidence](#test-geozarr) | Tested [evidence](#test-geozarr) | Tested [evidence](#test-geozarr) | Tested [evidence](#test-geozarr) | Tested [evidence](#test-geozarr) | Tested [evidence](#test-geozarr) | Fixture-limited [evidence](#test-geozarr) | Tested [evidence](#test-grid) | Tested [evidence](#test-grid) | Out of scope [evidence](#policy-geo) |
| Image plus world file | Tested [evidence](#test-contained) | Tested [evidence](#test-contained) | Fixture-limited [evidence](#test-contained) | Fixture-limited [evidence](#test-contained) | Unavailable | Tested [evidence](#test-contained) | Tested [evidence](#test-contained) | Unavailable | Tested [evidence](#test-contained) | Fixture-limited [evidence](#test-contained) | Unavailable | Unavailable | Unavailable | Unavailable | Tested [evidence](#test-grid) | Tested [evidence](#test-grid) | Out of scope [evidence](#policy-geo) |
| ENVI | Tested [evidence](#test-contained) | Fixture-limited [evidence](#test-contained) | Tested [evidence](#test-contained) | Tested [evidence](#test-contained) | Unavailable | Unsupported [evidence](#test-contained) | Tested [evidence](#test-contained) | Unavailable | Tested [evidence](#test-contained) | Tested [evidence](#test-contained) | Unavailable | Unavailable | Tested [evidence](#test-contained) | Tested [evidence](#test-contained) | Tested [evidence](#test-grid) | Tested [evidence](#test-grid) | Out of scope [evidence](#policy-geo) |
| Esri ASCII Grid | Tested [evidence](#test-contained) | Fixture-limited [evidence](#test-contained) | Unsupported [evidence](#test-contained) | Fixture-limited [evidence](#test-contained) | Unavailable | Unavailable | Tested [evidence](#test-contained) | Tested [evidence](#test-contained) | Tested [evidence](#test-contained) | Unavailable | Unavailable | Metadata only [evidence](#test-contained) | Tested [evidence](#test-contained) | Unavailable | Tested [evidence](#test-grid) | Fixture-limited [evidence](#test-grid) | Out of scope [evidence](#policy-geo) |
| SRTM HGT | Tested [evidence](#test-contained) | Fixture-limited [evidence](#test-contained) | Tested [evidence](#test-contained) | Tested [evidence](#test-contained) | Unavailable | Unavailable | Unavailable | Tested [evidence](#test-contained) | Unavailable | Unavailable | Unavailable | Metadata only [evidence](#test-contained) | Tested [evidence](#test-contained) | Unavailable | Tested [evidence](#test-grid) | Tested [evidence](#test-grid) | Out of scope [evidence](#policy-geo) |
| Classic NetCDF / CF | Tested [evidence](#test-netcdf) | Tested [evidence](#test-netcdf) | Tested [evidence](#test-netcdf) | Tested [evidence](#test-netcdf) | Unavailable | Unsupported [evidence](#test-netcdf) | Unavailable | Tested [evidence](#test-netcdf) | Tested [evidence](#test-netcdf) | Fixture-limited [evidence](#test-netcdf) | Tested [evidence](#test-netcdf) | Tested [evidence](#test-netcdf) | Tested [evidence](#test-netcdf) | Tested [evidence](#test-netcdf) | Tested [evidence](#test-grid) | Fixture-limited [evidence](#test-grid) | Out of scope [evidence](#policy-geo) |

## State definitions

- **Tested:** Implemented and covered by deterministic tests.
- **Fixture-limited:** Implemented, but current executable evidence covers a limited fixture set.
- **Metadata only:** Metadata is recognized and preserved, but the related data operation is not implemented.
- **Unsupported:** The condition is detected and rejected with an explicit diagnostic.
- **Unavailable:** The format reader does not provide this capability.
- **Out of scope:** The capability is deliberately outside the read-only geo reader boundary.

## Evidence index

<a id="test-geotiff"></a>
- **test-geotiff:** [tests/geo-geotiff-reader.test.ts](../../tests/geo-geotiff-reader.test.ts) (test). GeoTIFF normalization, overviews, bounded range reads, cancellation, and diagnostics.
<a id="test-geozarr"></a>
- **test-geozarr:** [tests/geo-geozarr-reader.test.ts](../../tests/geo-geozarr-reader.test.ts) (test). Zarr v2, v3, sharding, multidimensional selection, stores, and bounded reads.
<a id="test-contained"></a>
- **test-contained:** [tests/geo-contained-readers.test.ts](../../tests/geo-contained-readers.test.ts) (test). World files, ENVI, Esri ASCII Grid, and SRTM HGT behavior.
<a id="test-netcdf"></a>
- **test-netcdf:** [tests/geo-netcdf-reader.test.ts](../../tests/geo-netcdf-reader.test.ts) (test). Classic NetCDF containers, CF grids, range reads, axes, scale, and missing data.
<a id="test-grid"></a>
- **test-grid:** [tests/geo-grid-reprojection.test.ts](../../tests/geo-grid-reprojection.test.ts) (test). Target grid identity, alignment, resampling, reprojection, limits, and cancellation.
<a id="fixture-cog"></a>
- **fixture-cog:** [tests/fixtures/cog/manifest.json](../../tests/fixtures/cog/manifest.json) (fixture). Deterministic Classic TIFF, BigTIFF, tiled, striped, compressed, rotated, and SubIFD corpus.
<a id="fixture-geozarr"></a>
- **fixture-geozarr:** [tests/helpers/zarr-metadata-fixtures.ts](../../tests/helpers/zarr-metadata-fixtures.ts) (fixture). Deterministic Zarr v2 and v3 hierarchy and chunk metadata builders.
<a id="fixture-geozarr-official"></a>
- **fixture-geozarr-official:** [tests/fixtures/geozarr-conventions/SOURCES.md](../../tests/fixtures/geozarr-conventions/SOURCES.md) (oracle). Pinned official GeoZarr convention fixture provenance.
<a id="fixture-netcdf"></a>
- **fixture-netcdf:** [tests/helpers/netcdf-classic-fixture.ts](../../tests/helpers/netcdf-classic-fixture.ts) (fixture). Deterministic CDF-1 and CDF-2 fixture builder.
<a id="fixture-geo-corpus"></a>
- **fixture-geo-corpus:** [tests/fixtures/geo/manifest.json](../../tests/fixtures/geo/manifest.json) (fixture). Cross-format deterministic geometry, registration, sample, layout, and malformed-input catalog.
<a id="benchmark-geo"></a>
- **benchmark-geo:** [benchmark/generated/geo-benchmark.json](../../benchmark/generated/geo-benchmark.json) (benchmark). Six required deterministic selective-access and reprojection workloads with correctness gates.
<a id="policy-geo"></a>
- **policy-geo:** [docs/geo-architecture.md](../../docs/geo-architecture.md) (policy). Read-only raster domain ownership and exclusions.
