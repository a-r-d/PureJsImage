# Geo browser showcase

## Quick Answer

The `/geo/` documentation page is a browser demonstration of the public `purejsimage/geo` package.
It is not a replacement for PureJsImage Atlas. The page opens COG and GeoZarr sources directly from
the browser, reads bounded viewports in a worker, and reports the source access measured by each
reader.

## Public package boundary

The showcase client and worker import only these documented package entry points:

- `purejsimage/geo`
- `purejsimage/geo/browser`
- `purejsimage/geo/readers/geotiff`
- `purejsimage/geo/readers/geozarr`

The browser entry exports portable memory, Blob, and HTTP Range source adapters. Format readers stay
in explicit reader subpaths. The page does not import `src/geo`, TIFF parser files, Zarr substrate
files, or scientific reader internals.

## Deterministic examples

The docs build generates a small time/band/Y/X GeoZarr v3 pyramid from
`scripts/geo-showcase-fixtures.ts`. It also copies the deterministic rotated, tiled GeoTIFF with a
SubIFD overview from `tests/fixtures/cog/showcase-subifd-deflate-rotated.tif`. The browser test server
serves both fixtures with exact byte-range responses.

The COG public preset is an attributed OpenAerialMap object hosted by HOT OSM. The GeoZarr public
preset is Pangeo's TCI pyramid on Source Cooperative. That store currently uses newer v1 convention
metadata. The package's v0.1 reader reports the unsupported transform boundary instead of claiming
compatibility from a successful metadata response. Public sources are optional.

## Limits and failure behavior

- A viewport or analysis operation admits at most 196,608 decoded pixels.
- The browser sends remote requests directly. There is no arbitrary server proxy.
- Remote TIFF and Zarr objects must support CORS and valid byte ranges.
- Cancellation reaches source reads, format decoding, and package-native analysis.
- Source URLs, metadata, and diagnostics are assigned as text. They are not injected as HTML.
- Coordinate transformation remains caller supplied. The showcase does not load a projection engine.
- The capability table reads the compact generated geo manifest. It does not maintain a second set of
  support claims.

## Analysis scope

Band mapping, normalized difference, hillshade, point samples, regional statistics, and line profiles
operate on the current viewport. A whole-source analysis is not implicit. Target-grid and reprojection
APIs use the same public geo grid contract and require explicit output limits and, for cross-CRS work,
an explicit coordinate transform provider.
