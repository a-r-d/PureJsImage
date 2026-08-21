# Geo browser showcase

## Quick Answer

The `/geo/` documentation page opens COG and GeoZarr sources through the public `purejsimage/geo`
package. It reads bounded viewports in a worker and reports the source access measured by each
reader. PureJsImage Atlas provides the larger catalog and project workflow.

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

The featured COG is the `N082E280_2019_6IN_cog.tif` leaf-off ortho from Kentucky From Above. It is a
10,000 by 10,000 pixel, four-band, seven-level JPEG COG in EPSG:3089. The Kentucky Division of
Geographic Information publishes the source under CC BY 4.0. The preset uses the documented Atlas
display mappings: RGB bands `[0, 1, 2]` and color infrared bands `[3, 0, 1]`. The demo does not infer
an NIR band from component count. The page opens this source automatically at overview level 4.

The viewport uses an indeterminate progress indicator because one bounded GeoTIFF region read does
not expose false byte-level completion percentages. It reports the current metadata, viewport, or
analysis stage, elapsed time, and a visible Cancel action. Existing imagery remains visible while a
new viewport is being read.

The GeoZarr public preset is Pangeo's TCI pyramid on Source Cooperative. That store currently uses
newer v1 convention metadata. The package's v0.1 reader reports the unsupported transform boundary
instead of claiming compatibility from a successful metadata response. Public sources are optional.

## Limits and failure behavior

- A viewport or analysis operation admits at most 196,608 decoded pixels.
- The showcase admits range-backed TIFF objects up to 256 MiB and keeps decoded-region limits
  separate from the remote object size.
- The browser sends remote requests directly. There is no arbitrary server proxy.
- Remote TIFF and Zarr objects must support CORS and valid byte ranges. The TIFF source can use a
  HEAD `Content-Length` when CORS hides `Content-Range`; every data response must still be HTTP 206
  with the requested byte count.
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
