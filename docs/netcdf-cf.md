# Classic NetCDF and CF grid reader

## Quick Answer

Import `geoNetCdfReader` from `purejsimage/geo/readers/netcdf` to open CDF-1 or CDF-2 files that
describe a regular rectilinear CF grid. The reader works with browser `File` sources, in-memory
sources, local `ImageSource` adapters, and `HttpRangeSource`. It keeps time, vertical, band-like,
ensemble, and custom dimensions selectable. It does not support CDF-5, HDF5-backed NetCDF4,
curvilinear grids, or irregular coordinate lookup.

```ts
import { createScientificFileContext } from "purejsimage/scientific/browser";
import { geoNetCdfReader } from "purejsimage/geo/readers/netcdf";

const document = await geoNetCdfReader.open(createScientificFileContext(file));
const dataset = await document.openDataset(document.datasets[0].id);
```

## Container scope

The parser reads classic NetCDF XDR metadata and selected variable regions. It supports:

- CDF-1 classic containers;
- CDF-2 containers with safe 64-bit offsets;
- dimensions, variables, global attributes, and variable attributes;
- fixed variables and interleaved record variables;
- signed byte, signed 16-bit and 32-bit integer, 32-bit and 64-bit float data;
- character attributes used by CF metadata;
- four-byte header and data alignment;
- cancellation and configurable limits for every admitted count, name, attribute, coordinate, read,
  and output allocation.

Metadata parsing uses exact field reads by default. Reading the header does not scan the variable
payload. CF discovery reads only the bounded one-dimensional coordinate variables needed to decide
whether a candidate grid is regular. An `HttpRangeSource` may fetch its configured cache blocks
around those exact reads, but it does not fetch the complete object unless the object fits in those
bounded blocks.

CDF-5 produces an explicit unsupported-version error. HDF5-backed NetCDF4 has a different container
format and is outside this reader. Streaming files whose record count is still marked indeterminate
are also unsupported.

## CF subset

The reader recognizes coordinate variables and the `coordinates`, `standard_name`, `long_name`,
`units`, `axis`, `positive`, and `grid_mapping` attributes. It preserves `_FillValue`,
`missing_value`, `valid_min`, `valid_max`, `valid_range`, `scale_factor`, and `add_offset` evidence.
NaN fill values are represented as the JSON-safe string `"NaN"` in the Geo descriptor.

Returned tiles contain the native stored sample values and sample type. Scale and offset remain on
the band descriptor so an application can choose when to apply packed-value conversion. The reader
does not silently convert or copy a complete source variable during dataset creation.

Time coordinates preserve their units, including bounded `unit since timestamp` strings. The
recognized calendar names are `standard`, `gregorian`, `proleptic_gregorian`, `julian`, `noleap`,
`365_day`, `all_leap`, `366_day`, and `360_day`. Other calendar names remain in evidence and produce
a typed warning. The reader does not turn time coordinates into JavaScript dates.

## Grid rules

A published dataset needs distinct one-dimensional X and Y coordinate variables. Both coordinate
arrays must be finite and regularly spaced. Decreasing X or Y coordinates are valid. The default
regularity test accepts an absolute error of `1e-12` or a relative error of `1e-9` times the largest
of one, the coordinate step, and the expected coordinate value. Applications can lower these
tolerances with `createGeoNetCdfReader()`.

CF coordinate values locate pixel centers, so normalized grids use `pixel-is-point`. The
pixel-to-world affine is `[xStep, 0, firstX, 0, yStep, firstY]`. No north-up direction is assumed.
Bounds are calculated by the shared Geo contract from transformed pixel coordinates.

Irregular one-dimensional coordinates are detected but not fitted to an affine. The document keeps
their variable names and a `netcdf-irregular-rectilinear-grid` diagnostic. Two-dimensional latitude
and longitude coordinates are detected as curvilinear and produce
`netcdf-curvilinear-grid`. Neither case is exposed as an inaccurate affine dataset. A future Geo
coordinate-lookup contract can add those grids without changing the classic container parser.

## Grid mappings

The public `cfGridMappings` registry recognizes these metadata names:

- `latitude_longitude`;
- `transverse_mercator`;
- `lambert_conformal_conic`;
- `polar_stereographic`;
- `mercator`;
- `albers_conical_equal_area`;
- `rotated_latitude_longitude`.

All bounded grid-mapping attributes remain in format evidence. WKT in `crs_wkt` or `spatial_ref` is
preserved, and a directly stated authority can be identified from that WKT. An unknown mapping
produces `netcdf-unsupported-grid-mapping` rather than an invented CRS.

This registry interprets metadata only. It does not execute a coordinate transformation. Cross-CRS
work still uses the caller-supplied `GeoCoordinateTransformer` contract from `purejsimage/geo`.

## Dataset and read behavior

Each suitable data variable becomes its own `GeoRasterDataset`. Variables are not combined because
their shapes happen to match. Source dimension order is preserved. A view fixes every non-spatial
dimension and chooses a bounded X/Y region. Record variables use the same selection model and read
only their selected records and rows.

The document metadata lists all bounded container variables, attributes, candidate decisions, and
typed diagnostics. Unsupported irregular or curvilinear candidates can therefore be inspected even
when the document publishes no affine dataset.

Region reads are row-oriented and bounded by `maxRegionBytes`, `maxRegionValues`, and
`maxReadOperations`. Cancellation is checked during metadata parsing, coordinate reads, record
iteration, and selected-region reads. The source lifecycle remains owned by the caller-provided
scientific context.
