# Geo compatibility and benchmark evidence

## Quick Answer

PureJsImage geo compatibility claims come from `capabilities/geo-manifest.json`. The same source
generates the README summary, the complete Markdown table, the public JSON, and the compact website
manifest. Required CI also runs six geo workloads against deterministic in-process range and object
store servers.

## Generated outputs

- `docs/generated/geo-compatibility.md` is the complete human-readable matrix.
- `docs-astro/public/geo-capabilities.json` is the full machine-readable claim and evidence model.
- `docs-astro/src/data/geo-capabilities.json` is the compact website input.
- `tests/generated/geo-capability-expectations.json` is the generated test contract.
- `benchmark/generated/geo-benchmark.json` contains the latest complete benchmark measurements.
- `docs/generated/geo-benchmark.md` is the benchmark summary.

The capability generator refuses positive claims without evidence and refuses evidence paths that
do not exist. The compact manifest uses distinct codes for tested, fixture-limited, metadata-only,
recognized unsupported, unavailable, and intentionally out-of-scope states. It has no combined
supported boolean.

## Deterministic CI workloads

`npm run bench:geo:check` runs these scenarios on every full repository check:

1. a viewport from a 64 MiB logical remote COG object;
2. a viewport from a remote sharded Zarr v3 array;
3. a selected time and band from a multidimensional GeoZarr array;
4. a local ENVI subset through the scientific ENVI decoder;
5. a remote classic NetCDF variable subset from a 32 MiB logical object; and
6. an identity target-grid reprojection compared with the same native source window.

The harness records metadata-open time, first-tile time, requests to first tile, transferred bytes,
unique bytes, decoded pixels, cache hits, sampled managed memory, reprojection overhead, overview
selection, logical Zarr chunks, outer shard accesses, unique shard objects, shard index reads, and
shard payload ranges. These Zarr values come from the generic runtime substrate. The benchmark does
not fill them from fixture assumptions. Timing is snapshot evidence. Correctness and selective
access gates decide whether CI passes.

## Security and boundedness

Focused tests reject oversized HTTP range bodies, oversized Zarr metadata, unsafe NetCDF offsets and
dimensions, excessive shard indexes, excessive pyramid levels, deeply nested convention metadata,
unsupported codecs, and target-grid allocation limits. They also exercise cancellation and source
closure. These checks live in `tests/geo-security-boundedness.test.ts` and the focused reader and
source test files named by the capability manifest.

## Public live checks

Public live compatibility checks are opt-in. They do not replace deterministic CI evidence. A saved
record must include the exact asset identity, ISO test date, transport protocol and range behavior,
content encoding, ETag, Last-Modified or version identity when present, source mutation outcome, and
a failure category for every non-passing result. `validateGeoLiveCompatibilityRecord()` rejects
incomplete records. No public asset is contacted by required CI.

## Review order

Review the geo change in this order:

1. Check `docs/geo-architecture.md`, `package.json`, and `tests/geo-architecture.test.ts` for the
   package boundary and dependency direction.
2. Check `src/geo/contracts.ts`, `src/geo/scientific-adapter.ts`, and
   `tests/geo-contracts.test.ts` for the shared dataset, grid, axis, band, and view contracts.
3. Check `src/zarr`, the TIFF bridge, and the GeoTIFF and GeoZarr readers for reuse of the existing
   source, parser, chunk, codec, and scientific dataset implementations.
4. Check the contained-format and NetCDF readers for explicit access limits and unsupported grid or
   container cases.
5. Check `capabilities/geo-manifest.json`, the generated compatibility files, and
   `benchmark/geo/run.ts` for executable evidence behind public claims.
6. Check `docs-astro/src/pages/geo.astro` and its worker for public-only imports, bounded viewport
   work, cancellation, untrusted text handling, and source closure.
7. Check that `npm run browser:check` bundles the Geo worker from source while its code continues to
   use public package imports. This catches package-self imports that would otherwise require a
   pre-existing `dist` directory.

## Review checks

Run the required repository gate:

```sh
npm run check
```

The gate includes the clean-source Geo worker bundle, deterministic geo benchmark comparison,
public package type checks, generated documentation checks, and focused reprojection regressions.

Run the deterministic browser showcase in every configured browser:

```sh
npx playwright test browser-tests/geo-showcase.pw.ts browser-tests/geo-showcase-live.pw.ts
```

The public-source cases skip by default. To record a current public transport smoke test in Chromium,
run:

```sh
PUREJSIMAGE_GEO_PUBLIC_SMOKE=1 npx playwright test browser-tests/geo-showcase-live.pw.ts --project=chromium
```

Public smoke results are time-specific and do not replace deterministic fixture evidence. Reviewers
should not regenerate capability files unless the source manifest or fixture evidence changed. When
regeneration is required, run `npm run capabilities:generate` and review every generated diff.
