# JPEG XL photo compression, October 5, 2026

## Quick answer

Both pinned photographs now use fewer bytes than jSquash and wasm-vips at
matched SSIMULACRA2 70, 80 and 90. The remaining first-photo score-70 gap
changes from 3.00% larger to 0.53% smaller than wasm-vips. This establishes
compression parity for these six photo targets. It does not establish a
universal lossy, HDR, CMYK or animation ranking.

## Matched quality

The original input samples, comparator versions and comparator brackets stay
fixed. Matching uses the original nondominated frontier, log-byte interpolation,
a maximum 0.25-score bracket width and no extrapolation. Distances share the
original limit of 24 measured points per photo across all three targets.
Every inversion remains in the raw results.

| Photo | SSIMULACRA2 | Current bytes | Versus jSquash | Versus wasm-vips |
| --- | ---: | ---: | ---: | ---: |
| im26-1030 | 70 | 45,675 | 1.23% smaller | 0.53% smaller |
| im26-1030 | 80 | 70,917 | 1.14% smaller | 0.55% smaller |
| im26-1030 | 90 | 144,647 | 8.94% smaller | 10.84% smaller |
| im26-1416 | 70 | 28,293 | 6.01% smaller | 16.12% smaller |
| im26-1416 | 80 | 44,494 | 5.21% smaller | 15.04% smaller |
| im26-1416 | 90 | 102,605 | 23.95% smaller | 27.61% smaller |

These byte counts are interpolated estimates, rounded for display. The first
score-70 bracket is 0.03214 points wide: 45,670 bytes at 69.99187 and 45,690
bytes at 70.02401. The tighter optional 0.05-score search on the second photo
exhausts its 24-point budget. That failed result remains null in its raw report.
Its separately recomputed 0.11437-score bracket passes the original 0.25 rule:
28,283 bytes at 69.93181 and 28,299 bytes at 70.04617. The other four targets
retain their preceding endpoint bytes and both quality metrics exactly.

The [production measurements](results/photo-parity-production-controls.json)
record complete public packages, all 34 original-domain photo files, 68 full
native/Rust grids, all public JavaScript pixels and both SSIMULACRA2 and
Butteraugli. Original alpha remains exact. This is a measured SSIMULACRA2
compression comparison; it does not imply a quality lead on every metric.
The wider frozen comparison keeps 13 adequately matched and 11 unresolved
pairs. Graphic and alpha sampling limitations remain visible.

The separately rechecked [opaque graphic](GRAPHIC-POINTS.md) now has direct
size and two-metric dominance over six sampled peer points. That evidence does
not change the original missing interpolation brackets.

## What changed

The first-party encoder can choose aligned DCT16 blocks for coarse opaque
RGBA8 photographs. It estimates actual hybrid-symbol rates and reconstruction
error before selecting a larger transform. It also uses rate-aware AC rounding
and compares additional exact prediction trees, repeat coding and hybrid
entropy models for DC and local transform metadata. Complete bit counts include
tree and histogram headers. No third-party codec implementation is copied.

The new photo search requires effort 7, non-progressive output, standard sRGB,
8-bit opaque RGBA, more than 2,048 visible colors, distance at least 6 and at
most 4,194,304 pixels. Existing small-palette artwork, partial alpha, RGB3,
native 16-bit, HDR, progressive and fine-quality paths retain their policies.
Larger DCT families, AFV and forward Gaborish remain unsupported.

All additional backing buffers count against `maxWorkingBytes`. A working-limit
failure unwinds the optional search and retries the preceding complete transform
path. At the original 797,262-byte minimum, the 129 × 65 regression field keeps
the exact preceding 681-byte file. One byte below still fails with closed
ownership. Cancellation propagates without publishing partial output or
changing caller storage.

Eleven paired boundary definitions independently check partial groups, both
orientations across two DC groups, protected formats and the original minimum.
The six permanent synthetic cases have a reproducible native/Rust verifier.
The earlier full integer-lossless corpus and alpha measurements retain their
own source identities; they are not described as newly rerun photo evidence.
Every preceding Modular encoder body remains unchanged, with the additional
forward-only entropy helper appended separately.

Internal package ceilings increase explicitly from 545,000/617,000 to
554,000/627,000 bytes. The two complete public packages grow by about 9.6 KB.
Earlier private ceiling failures remain recorded. Package version, exports and
zero runtime dependencies stay unchanged. This prioritizes compression and
does not establish speed or process-RSS parity.

## Reproduction

With the pinned inputs and development oracles prepared:

```sh
node benchmark/jpegxl/comparison/verify-photo-compression.ts .tmp/photo-compression.json
node benchmark/jpegxl/comparison/verify-photo-transforms.ts .tmp/photo-transforms.json
npx vitest run tests/jpegxl-large-blocks.test.ts
npx playwright test browser-tests/jpegxl-large-blocks.pw.ts --workers=1
```

Raw packages, pixel grids, profiling files and temporary TypeScript copies stay
ignored. Repository, generated documentation and real-browser handoff gates are
recorded separately in the final production gate report.
