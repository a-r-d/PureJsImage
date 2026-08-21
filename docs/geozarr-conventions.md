# GeoZarr convention metadata

`purejsimage/geo/conventions/geozarr` reads GeoZarr convention metadata without reading array
chunks. It is a metadata layer, not a GeoZarr raster reader. It consumes JSON objects that a Zarr
store has already extracted from a v2 `.zattrs` file or a v3 `zarr.json` file.

The parser understands the current `proj`, `spatial`, and `multiscales` conventions. It matches a
known convention by its permanent UUID. A matching name alone is not enough. The supported
conventions were checked on 2026-08-21 and are pinned as follows:

| Convention | UUID | Tag | Maturity | Pinned tag commit |
| --- | --- | --- | --- | --- |
| `proj` | `f17cb550-5864-4468-aeb7-f3180cfb622f` | `v0.1` | Pilot | `5ca5b2f92e5c7245f957d9128b289ee535f0720d` |
| `spatial` | `689b58e2-cf7b-45e0-9fff-9cfc0883d6b4` | `v0.1` | Pilot | `54d81b7ced0376e63ee10f34db31db7d08dcc28d` |
| `multiscales` | `d35379db-88df-4056-af3a-620245f8e347` | `v0.1` | Pilot | `9b78efa75fef0fed302d9cf880037c569354d860` |

Each registry entry contains the exact schema URL, specification URL, repository URL, tag,
maturity, and tag commit. Runtime code does not fetch those URLs. Local deterministic validators
cover the supported fields and preserve bounded additive JSON.

## Modes

Strict mode rejects errors in known v0.1 metadata, ambiguous inheritance, newer unsupported
versions, conflicting registrations, conflicting CRS identifiers, and unsupported spatial
transforms. It returns a `GeoZarrConventionError` with typed diagnostics.

Compatibility mode reads fields whose meaning is understood and returns diagnostics for the rest.
It preserves unknown registrations, unknown additive fields, older tags, and newer tags. An unknown
spatial transform type stays unknown. Its coefficient array is never treated as an affine.

Both modes reject metadata that exceeds configured depth, value-count, level-count, registration,
attribute, or string limits.

## Normalized result

`parseGeoZarrConventionMetadata()` combines:

- convention registrations and version evidence;
- group and direct-child `proj` and `spatial` metadata;
- child overrides and per-layout spatial overrides;
- ordered multiscale paths, relative scale, translation, and resampling evidence;
- normalized CRS axes, units, identifiers, WKT2, and PROJJSON;
- spatial dimension indices, shape, registration, affine, inverse affine, bounds, and grid geometry;
- unresolved conflicts and typed diagnostics.

The `proj` parser records CRS evidence. It does not resolve authority codes, download a CRS
database, or transform coordinates. The `spatial` parser maps `pixel` to `pixel-is-area` and `node`
to `pixel-is-point`. It uses the convention's `[Y, X]` role order to find the source indices in Zarr
`dimension_names`. It does not infer axis roles from names.

Group-level `proj` and `spatial` values apply only to direct child arrays. A child PROJ definition
replaces the group definition. Spatial values are inherited by field, then per-level layout values
and child values are applied. Conflicting child and layout values are explicit ambiguity
diagnostics. `multiscales` is owned by its declaring group and is not inherited from a parent group.

## v2 and v3 input

For v3, pass the complete `zarr.json` object. For v2, pass the `.zattrs` object and the array shape
from `.zarray`. A v2 caller may pass dimension names directly. `_ARRAY_DIMENSIONS` is also accepted
as an extraction bridge and is removed before convention processing. After extraction, convention
attributes follow the same code path for both Zarr versions.

The parser accepts optional known hierarchy paths to validate multiscale assets without opening
them. It never calls a store, opens an array, reads a chunk, runs a codec, or owns source lifecycle.
The generic Zarr substrate remains responsible for those operations. The public
`purejsimage/geo/readers/geozarr` reader combines that substrate with this metadata result and the
existing `GeoRasterDataset` adapter. The metadata parser remains useful by itself when an
application needs to inspect conventions without opening arrays.

## Pinned sources

- PROJ schema: https://raw.githubusercontent.com/zarr-conventions/proj/refs/tags/v0.1/schema.json
- PROJ specification: https://github.com/zarr-conventions/proj/blob/v0.1/README.md
- Spatial schema: https://raw.githubusercontent.com/zarr-conventions/spatial/refs/tags/v0.1/schema.json
- Spatial specification: https://github.com/zarr-conventions/spatial/blob/v0.1/README.md
- Multiscales schema: https://raw.githubusercontent.com/zarr-conventions/multiscales/refs/tags/v0.1/schema.json
- Multiscales specification: https://github.com/zarr-conventions/multiscales/blob/v0.1/README.md

Pinned official examples and immutable source notes are in
`tests/fixtures/geozarr-conventions`.
