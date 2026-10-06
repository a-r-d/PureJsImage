# JPEG XL transparency comparisons, October 6, 2026

## Quick answer

Current PureJsImage output meets or beats the six selected jSquash and
wasm-vips files on compressed size, SSIMULACRA2 and Butteraugli. The closest
wasm-vips comparison uses 8,409 bytes instead of 8,642, with a higher
SSIMULACRA2 score and lower Butteraugli error. Every original alpha sample
remains exact. These are direct comparisons on one pinned transparency image.

## Actual measured files

The input is the original 1024 × 1024 `alpha_triangles` RGBA8 fixture.
For each peer and original target, select its smallest frozen measured file
with SSIMULACRA2 at or above the target. Compare that actual file against
current public effort-7 encodes. This does not estimate an unmeasured size
at the target or create an interpolation bracket.

| Peer | Selection target | Peer bytes | Current bytes | Current distance | Size reduction |
| --- | ---: | ---: | ---: | ---: | ---: |
| jSquash | 70 | 41,725 | 8,178 | 7 | 80.40% |
| jSquash | 80 | 43,564 | 8,178 | 7 | 81.23% |
| jSquash | 90 | 70,614 | 9,507 | 3.5 | 86.54% |
| wasm-vips | 70 | 8,642 | 8,409 | 6 | 2.70% |
| wasm-vips | 80 | 8,642 | 8,409 | 6 | 2.70% |
| wasm-vips | 90 | 9,307 | 9,155 | 4 | 1.63% |

The same wasm-vips file is selected at targets 70 and 80: its measured
score is 88.10510 and Butteraugli is 2.39888. Current distance 6 reaches
88.34796 and 2.28504. Current distance 4 reaches 90.55154 and 1.31840,
against wasm-vips at 90.39107 and 1.47299. Current distance 3.5 reaches
90.67612 and 1.16619, against jSquash at 90.06541 and 1.24142.

Quality follows the original transparency protocol: use the minimum
SSIMULACRA2 and maximum Butteraugli over black and white composites.
Individual background scores remain in the report. Passing these aggregate
metrics does not require a higher score on each background separately.
All five measured current distances remain visible, including points that
do not dominate the selected peer.

## Independent verification

The [production report](results/alpha-point-production-controls.json) pins
the current source, unchanged original input, five fresh public encodes,
five distinct frozen peer files and 20 complete native/Rust floating grids.
It checks every current public JavaScript decoded sample against the complete
native grid within one 8-bit code, with exact alpha and complete row coverage.
Every peer PNG hash and both background metrics reproduce the frozen report.
Caller input is unchanged and all encoder-owned allocations are released.

The selected jSquash files change 162,891, 68,125 and 84,166 alpha samples,
with maximum errors of 40, 34 and 9 codes. The selected wasm-vips files
preserve alpha exactly. The comparison retains these different public
defaults and does not classify lossy alpha as an invalid file.

The existing alpha palette search achieves these results without another
transparency encoder change. Five public encodes take about
25 seconds each in this diagnostic run. This is not an isolated speed or
process-RSS comparison.

Together with the [photo](PHOTO-PARITY.md) and [graphic](GRAPHIC-POINTS.md)
studies, these measurements cover all 24 original peer/target selections
across four diagnostics. Photos use adequately matched SSIMULACRA2 brackets;
graphic and transparency files use direct size and two-metric comparisons.
The historical 13 adequate and 11 unresolved interpolation counts stay
unchanged. The later [original-size photo study](ORIGINAL-PHOTO.md) passes
the three SSIMULACRA2 targets on one 12 MP photo. Other original-size photos,
HDR, float, CMYK, animation and unseen inputs need separate compression evidence.

## Reproduction

With the pinned fixtures and development oracles available:

```sh
node benchmark/jpegxl/comparison/verify-alpha-compression.ts .tmp/alpha-compression.json
```

Optional distances share the original 0.25–25 domain and are limited to 24
unique settings per run. Raw images, packages, grids and temporary scripts
stay ignored. The benchmark uses independent tools only as development
oracles; the production codec stays first-party pure JavaScript.
