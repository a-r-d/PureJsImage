# Imazen TIFF conformance baseline

This baseline validates complete decode, in-memory PNG encode, PNG reopen, dimensions, and process robustness. It does not claim exact pixel parity or full standards compliance.

## Summary

| Outcome | Count |
| --- | ---: |
| pass | 87 |
| unsupported | 63 |
| decode-failure | 0 |
| invalid-output | 0 |
| rejected-safely | 4 |
| accepted | 0 |
| raw-exception | 0 |
| timeout | 0 |
| process-crash | 0 |
| out-of-memory | 0 |

## Results by upstream category or feature

| Category | Total | Outcomes |
| --- | ---: | --- |
| edge-cases/compression-webp | 1 | unsupported: 1 |
| edge-cases/general | 4 | pass: 3, unsupported: 1 |
| robustness/compression-lzw | 1 | rejected-safely: 1 |
| robustness/general | 3 | rejected-safely: 3 |
| valid/bigtiff | 3 | pass: 3 |
| valid/compression-ccitt-group3 | 4 | pass: 4 |
| valid/compression-ccitt-group4 | 3 | pass: 3 |
| valid/compression-deflate | 1 | pass: 1 |
| valid/compression-jpeg | 5 | pass: 5 |
| valid/compression-lzw | 9 | pass: 7, unsupported: 2 |
| valid/compression-old-jpeg | 3 | pass: 3 |
| valid/compression-packbits | 2 | pass: 2 |
| valid/compression-webp | 1 | unsupported: 1 |
| valid/compression-zstd | 1 | unsupported: 1 |
| valid/floating-point | 9 | unsupported: 9 |
| valid/general | 63 | pass: 33, unsupported: 30 |
| valid/photometric-cmyk | 8 | pass: 6, unsupported: 2 |
| valid/photometric-logluv | 3 | unsupported: 3 |
| valid/photometric-palette | 7 | pass: 7 |
| valid/photometric-ycbcr | 1 | pass: 1 |
| valid/planar | 10 | pass: 3, unsupported: 7 |
| valid/predictor | 6 | pass: 1, unsupported: 5 |
| valid/tiled | 6 | pass: 5, unsupported: 1 |

## Crashes, timeouts, raw exceptions, invalid output, and memory failures

None.

## Unsupported features by error code

| Error code | Count | Files |
| --- | ---: | --- |
| UNSUPPORTED_OPERATION | 63 | `tiff-conformance/edge-cases/geo-5b.tif`<br>`tiff-conformance/edge-cases/usda_naip_256_webp_z3.tif`<br>`tiff-conformance/valid/12bit.cropped.rgb.tiff`<br>`tiff-conformance/valid/12bit.cropped.tiff`<br>`tiff-conformance/valid/caspian.tif`<br>`tiff-conformance/valid/cmyk-3c-32b-float.tiff`<br>`tiff-conformance/valid/cmyk-4c-8b.tiff`<br>`tiff-conformance/valid/flower-minisblack-06.tif`<br>`tiff-conformance/valid/flower-minisblack-10.tif`<br>`tiff-conformance/valid/flower-minisblack-12.tif`<br>`tiff-conformance/valid/flower-minisblack-14.tif`<br>`tiff-conformance/valid/flower-minisblack-24.tif`<br>`tiff-conformance/valid/flower-minisblack-32.tif`<br>`tiff-conformance/valid/flower-rgb-contig-02.tif`<br>`tiff-conformance/valid/flower-rgb-contig-04.tif`<br>`tiff-conformance/valid/flower-rgb-contig-10.tif`<br>`tiff-conformance/valid/flower-rgb-contig-12.tif`<br>`tiff-conformance/valid/flower-rgb-contig-14.tif`<br>`tiff-conformance/valid/flower-rgb-contig-24.tif`<br>`tiff-conformance/valid/flower-rgb-contig-32.tif`<br>`tiff-conformance/valid/flower-rgb-planar-02.tif`<br>`tiff-conformance/valid/flower-rgb-planar-04.tif`<br>`tiff-conformance/valid/flower-rgb-planar-10.tif`<br>`tiff-conformance/valid/flower-rgb-planar-12.tif`<br>`tiff-conformance/valid/flower-rgb-planar-14.tif`<br>`tiff-conformance/valid/flower-rgb-planar-24.tif`<br>`tiff-conformance/valid/flower-rgb-planar-32.tif`<br>`tiff-conformance/valid/gradient-1c-32b-float.tiff`<br>`tiff-conformance/valid/gradient-1c-32b.tiff`<br>`tiff-conformance/valid/gradient-1c-64b-float.tiff`<br>`tiff-conformance/valid/gradient-1c-64b.tiff`<br>`tiff-conformance/valid/gradient-3c-32b-float.tiff`<br>`tiff-conformance/valid/gradient-3c-32b.tiff`<br>`tiff-conformance/valid/gradient-3c-64b.tiff`<br>`tiff-conformance/valid/hpredict_cmyk.tiff`<br>`tiff-conformance/valid/int16_rgb.tif`<br>`tiff-conformance/valid/int16_zstd.tif`<br>`tiff-conformance/valid/int16.tif`<br>`tiff-conformance/valid/int8_rgb.tif`<br>`tiff-conformance/valid/int8.tif`<br>`tiff-conformance/valid/logluv-3c-16b.tiff`<br>`tiff-conformance/valid/minisblack-1c-i16b.tiff`<br>`tiff-conformance/valid/minisblack-1c-i8b.tiff`<br>`tiff-conformance/valid/off_l16.tif`<br>`tiff-conformance/valid/off_luv24.tif`<br>`tiff-conformance/valid/off_luv32.tif`<br>`tiff-conformance/valid/predictor-3-gray-f32.tif`<br>`tiff-conformance/valid/predictor-3-rgb-f32.tif`<br>`tiff-conformance/valid/random-fp16-pred2.tiff`<br>`tiff-conformance/valid/random-fp16-pred3.tiff`<br>`tiff-conformance/valid/random-fp16.tiff`<br>`tiff-conformance/valid/rgb32f_bw.tiff`<br>`tiff-conformance/valid/rgb32f_color.tiff`<br>`tiff-conformance/valid/single-black-fp16.tiff`<br>`tiff-conformance/valid/test_float64_predictor2_be_lzw.tif`<br>`tiff-conformance/valid/test_float64_predictor2_le_lzw.tif`<br>`tiff-conformance/valid/text.tif`<br>`tiff-conformance/valid/tiled-cmyk-i8.tif`<br>`tiff-conformance/valid/tiled-oversize-gray-i8.tif`<br>`tiff-conformance/valid/webp_lossless_rgba_alpha_fully_opaque.tif`<br>`tiff-conformance/valid/white-fp16-pred2.tiff`<br>`tiff-conformance/valid/white-fp16-pred3.tiff`<br>`tiff-conformance/valid/white-fp16.tiff` |

## Decode failures by likely root cause

None.

## Reproduction

- PureJsImage commit: `e12e46471cbeac610a779ff926edd9b35ff14c1a`
- codec-corpus commit: `28205bbc5cf40364d012c462240ba28143373d67`
- Node/platform: `v24.16.0` on `linux-x64`
- Command: `npm run corpus:imazen -- --corpus ../codec-corpus --format tiff --output benchmark/results --timeout-ms 30000 --memory-mb 512 --concurrency 2`

## Prioritized punch list

1. Confirm the public unsupported boundary for 63 valid input(s) before considering feature work.
