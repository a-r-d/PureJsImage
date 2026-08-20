# Bounded numeric-raster analysis

`purejsimage/analysis` exports portable, stateless primitives for numeric raster tiles. They are
generic library building blocks: they do not know about catalogs, STAC collections, particular
satellites, user interfaces, or credentialed coordinate-transform services.

The primitives consume already acquired `NumericTile` objects and return bounded tiles or bounded
result arrays. Applications remain responsible for requesting the exact source tiles, retaining and
releasing them, scheduling on-demand derived reads through `TileRuntime`, and persisting source and
recipe identities. No function in this surface reads a complete dataset or creates a global cache.

## Plans, limits, and cancellation

Every normalized plan has `schemaVersion: 1` plus a stable algorithm ID and version. Plan data is
JSON-safe; runtime-only objects such as `NumericTile`, `AbortSignal`, and coordinate-transform
functions are passed only to executors.

`RasterOperationLimits` bounds tile pixels, output bytes, working bytes, input count, expression
length/depth/operations, histogram bins, and line samples. Executors admit their output before
allocation and check cancellation at least once per output row or bounded sample batch. A caller
with a tighter application budget should pass it explicitly.

## Band math

`createRasterBandMathPlan()` tokenizes and parses a small expression language into a validated AST.
It never invokes `eval`, `Function`, dynamic import, or a script engine. The language contains:

- named inputs and finite numeric literals;
- parentheses and unary `+`/`-`;
- binary `+`, `-`, `*`, and `/`;
- `abs`, `sqrt`, `log`, `exp`, `min`, `max`, and `pow`.

Unknown names/functions and malformed expressions reject. Depth and operation counts are bounded.
Every input pins a component, `raw` or `scaled` value mode, scale, offset, and nodata rule. Nodata
propagates. Division by zero is explicitly either nodata or zero. Non-finite results are explicitly
either preserved or converted to output nodata. An optional finite clamp is applied only to valid
results, never to a nodata sentinel.

The normalized-difference, linear-combination, and raster-subtraction helpers create ordinary band
math plans and use the same evaluator.

## Terrain derivatives

Terrain plans require X, Y, and vertical units. Built-in conversions are metre, international foot,
and US survey foot (`1200 / 3937` metres); a custom unit requires an explicit positive
`metresPerUnit`. X/Y spacing and the direction in model space as row indices increase are also
required.

Slope uses a Horn 3-by-3 derivative and can return degrees, radians, or percent rise. Aspect is the
downslope azimuth in degrees clockwise from north; a flat cell returns output nodata. Hillshade
azimuth is degrees clockwise from north and altitude is degrees above the horizon; output is a
floating value clamped to `[0, 255]`.

Interior output regions require a one-pixel source halo. Missing interior halo data rejects instead
of creating a tile seam. At dataset edges, plans explicitly choose clamp or nodata. A nodata center
produces output nodata; a nodata neighbor is replaced by the valid center so a sentinel does not
contaminate adjacent derivatives.

## Statistics and profiles

Regional statistics scan a bounded tile region in deterministic row-major order. They report valid
and invalid counts, min, max, mean, and population variance. An optional explicit-range histogram
has bounded bins plus underflow and overflow counts.

Line profiles use an explicit start, end, sample count, component, nearest/bilinear method, nodata
rule, and minimum valid bilinear weight. Distances are in pixel-coordinate units. Applications that
need physical distance should transform their line coordinates before planning and retain the
calibration in application provenance.

## Target grids and reprojection

`NumericRasterGrid` is JSON-safe and includes CRS, width, height, a six-parameter pixel-to-model
affine, `area` or `point` pixel interpretation, extent, sample type, nodata, and resampling. Affines
must be finite and invertible. `numericRasterGridsEqual()` implements the exact fast-path comparison
for CRS, affine, dimensions, and pixel interpretation.

Same-CRS resampling uses an explicitly requested target grid and nearest or bilinear sampling.
Cross-CRS plans require a transform descriptor containing stable identity, version, and exact or
estimated accuracy. Execution separately requires the matching caller-supplied inverse transform
from target model coordinates to source model coordinates. Unsupported or mismatched transforms
refuse execution; estimated accuracy is never represented as exact.

Nearest sampling returns nodata for a nodata selected sample. Bilinear sampling excludes nodata
contributors, renormalizes remaining weights, and returns nodata when their total is below the
explicit `minimumValidWeight` (default `0.5`). A source tile missing any required in-grid contributor
rejects rather than silently treating missing tile coverage as source nodata.

The target-grid executor produces one requested target region. It neither discovers coordinate
transforms nor fetches source pixels; applications should calculate/request a conservative source
window and pass that bounded tile.
