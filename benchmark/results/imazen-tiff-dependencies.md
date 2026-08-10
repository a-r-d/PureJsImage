# Imazen TIFF unsupported dependency matrix

Source report: `imazen-tiff-conformance.json`

Unsupported files inspected: 44
Projected first-expansion pass count: 106 → 106
ThunderScan is excluded from the projection: the sole Compression=32809 fixture is structurally invalid under independent LibTIFF and ImageMagick decoding.

## Implementation dependency graph

| Wave | Capability | Dependencies | Visible files | Projected pass |
| --- | --- | --- | ---: | ---: |
| A | Unsigned 10/12/14-bit grayscale and RGB | color-depth:10,10,10<br>color-depth:12,12,12<br>color-depth:14,14,14<br>grayscale-depth:10<br>grayscale-depth:12<br>grayscale-depth:14 | 0 | 106 |
| B | Unsigned 2/4-bit RGB and 6-bit grayscale | color-depth:2,2,2<br>color-depth:4,4,4<br>grayscale-depth:6 | 0 | 106 |
| C | CMYK plus alpha | cmyk-alpha | 0 | 106 |
| D | WebP-in-TIFF | compression:50001 | 0 | 106 |


## Dependency counts

| Dependency | Files |
| --- | ---: |
| color-depth:24,24,24 | 2 |
| color-depth:32,32,32 | 7 |
| color-depth:32,32,32,32 | 1 |
| color-depth:64,64,64 | 2 |
| compression:32809 | 1 |
| compression:34676 | 3 |
| compression:34677 | 1 |
| compression:50000 | 1 |
| display-range-unspecified | 30 |
| extra-samples:0,0,0,0 | 1 |
| generic-five-band | 1 |
| grayscale-depth:24 | 1 |
| grayscale-depth:32 | 4 |
| grayscale-depth:64 | 4 |
| photometric:32844 | 1 |
| photometric:32845 | 3 |
| predictor-2-depth:64 | 2 |
| predictor:3 | 4 |
| sample-format:2 | 7 |
| sample-format:2,2,2 | 5 |
| sample-format:2,2,2,2 | 1 |
| sample-format:2,2,2,2,2 | 1 |
| sample-format:3 | 12 |
| sample-format:3,3,3 | 5 |
| sample-format:3,3,3,3 | 1 |
| samples-per-pixel:5 | 1 |

## File matrix

| File | Bits | Sample format | SPP | Extra | Photo | Compression | Predictor | Planar | Geometry | Byte order | ICC | JPEGTables | SMin / SMax | Dependencies |
| --- | --- | --- | ---: | --- | ---: | ---: | ---: | ---: | --- | --- | --- | --- | --- | --- |
| `tiff-conformance/edge-cases/geo-5b.tif` | 16,16,16,16,16 | 2,2,2,2,2 | 5 | 0,0,0,0 | 1 | 1 | - | 1 | strips rows=10 (1) | II | - | - | - / - | display-range-unspecified<br>extra-samples:0,0,0,0<br>generic-five-band<br>sample-format:2,2,2,2,2<br>samples-per-pixel:5 |
| `tiff-conformance/valid/caspian.tif` | 64,64,64 | 3,3,3 | 3 | - | 2 | 32946 | - | 2 | strips rows=3 (222) | II | - | - | - / - | color-depth:64,64,64<br>display-range-unspecified<br>sample-format:3,3,3 |
| `tiff-conformance/valid/cmyk-3c-32b-float.tiff` | 32,32,32,32 | 3,3,3,3 | 4 | - | 5 | 1 | - | 1 | strips rows=20 (1) | II | - | - | 0,0,0,0 / 1,1,1,1 | color-depth:32,32,32,32<br>sample-format:3,3,3,3 |
| `tiff-conformance/valid/flower-minisblack-24.tif` | 24 | 1 | 1 | - | 1 | 1 | - | 1 | strips rows=37 (2) | II | - | - | - / - | grayscale-depth:24 |
| `tiff-conformance/valid/flower-minisblack-32.tif` | 32 | - | 1 | - | 1 | 1 | - | 1 | strips rows=28 (2) | MM | - | - | - / - | grayscale-depth:32 |
| `tiff-conformance/valid/flower-palette-16.tif` | 16 | - | 1 | - | 3 | 1 | - | 1 | strips rows=56 (1) | MM | - | - | - / - | - |
| `tiff-conformance/valid/flower-rgb-contig-24.tif` | 24,24,24 | 1,1,1 | 3 | - | 2 | 1 | - | 1 | strips rows=12 (4) | II | - | - | - / - | color-depth:24,24,24 |
| `tiff-conformance/valid/flower-rgb-contig-32.tif` | 32,32,32 | - | 3 | - | 2 | 1 | - | 1 | strips rows=9 (5) | MM | - | - | - / - | color-depth:32,32,32 |
| `tiff-conformance/valid/flower-rgb-planar-24.tif` | 24,24,24 | 1,1,1 | 3 | - | 2 | 1 | - | 2 | strips rows=37 (6) | II | - | - | - / - | color-depth:24,24,24 |
| `tiff-conformance/valid/flower-rgb-planar-32.tif` | 32,32,32 | - | 3 | - | 2 | 1 | - | 2 | strips rows=28 (6) | MM | - | - | - / - | color-depth:32,32,32 |
| `tiff-conformance/valid/gradient-1c-32b-float.tiff` | 32 | 3 | 1 | - | 1 | 1 | - | 1 | strips rows=128 (1) | II | - | - | - / - | display-range-unspecified<br>grayscale-depth:32<br>sample-format:3 |
| `tiff-conformance/valid/gradient-1c-32b.tiff` | 32 | 1 | 1 | - | 1 | 1 | - | 1 | strips rows=128 (1) | II | - | - | - / - | grayscale-depth:32 |
| `tiff-conformance/valid/gradient-1c-64b-float.tiff` | 64 | 3 | 1 | - | 1 | 1 | - | - | strips rows=1 (1) | II | - | - | - / - | display-range-unspecified<br>grayscale-depth:64<br>sample-format:3 |
| `tiff-conformance/valid/gradient-1c-64b.tiff` | 64 | - | 1 | - | 1 | 1 | - | - | strips rows=1 (1) | II | - | - | - / - | grayscale-depth:64 |
| `tiff-conformance/valid/gradient-3c-32b-float.tiff` | 32,32,32 | 3,3,3 | 3 | - | 2 | 1 | - | 1 | strips rows=1 (1) | II | - | - | 0,0,0 / 1,1,1 | color-depth:32,32,32<br>sample-format:3,3,3 |
| `tiff-conformance/valid/gradient-3c-32b.tiff` | 32,32,32 | 1,1,1 | 3 | - | 2 | 1 | - | 1 | strips rows=128 (1) | II | - | - | - / - | color-depth:32,32,32 |
| `tiff-conformance/valid/gradient-3c-64b.tiff` | 64,64,64 | - | 3 | - | 2 | 1 | - | 1 | strips rows=1 (1) | II | - | - | - / - | color-depth:64,64,64 |
| `tiff-conformance/valid/int16_rgb.tif` | 16,16,16 | 2,2,2 | 3 | - | 2 | 1 | - | 1 | strips rows=64 (1) | II | - | - | - / - | display-range-unspecified<br>sample-format:2,2,2 |
| `tiff-conformance/valid/int16_zstd.tif` | 16 | 2 | 1 | - | 1 | 50000 | 1 | 1 | strips rows=64 (1) | II | - | - | - / - | compression:50000<br>display-range-unspecified<br>sample-format:2 |
| `tiff-conformance/valid/int16.tif` | 16 | 2 | 1 | - | 1 | 1 | - | - | strips rows=64 (1) | II | - | - | - / - | display-range-unspecified<br>sample-format:2 |
| `tiff-conformance/valid/int8_rgb.tif` | 8,8,8 | 2,2,2 | 3 | - | 2 | 1 | - | 1 | strips rows=64 (1) | II | - | - | - / - | display-range-unspecified<br>sample-format:2,2,2 |
| `tiff-conformance/valid/int8.tif` | 8 | 2 | 1 | - | 1 | 1 | - | - | strips rows=64 (1) | II | - | - | - / - | display-range-unspecified<br>sample-format:2 |
| `tiff-conformance/valid/logluv-3c-16b.tiff` | 16,16,16 | 2,2,2 | 3 | - | 32845 | 34676 | - | 1 | strips rows=682 (1) | II | - | - | - / - | compression:34676<br>display-range-unspecified<br>photometric:32845<br>sample-format:2,2,2 |
| `tiff-conformance/valid/minisblack-1c-i16b.tiff` | 16 | 2 | 1 | - | 1 | 1 | - | 1 | strips rows=26 (6) | II | - | - | - / - | display-range-unspecified<br>sample-format:2 |
| `tiff-conformance/valid/minisblack-1c-i8b.tiff` | 8 | 2 | 1 | - | 1 | 1 | - | 1 | strips rows=52 (3) | II | - | - | - / - | display-range-unspecified<br>sample-format:2 |
| `tiff-conformance/valid/off_l16.tif` | 16 | 2 | 1 | - | 32844 | 34676 | - | 1 | strips rows=8 (29) | MM | - | - | - / - | compression:34676<br>display-range-unspecified<br>photometric:32844<br>sample-format:2 |
| `tiff-conformance/valid/off_luv24.tif` | 16,16,16 | 2,2,2 | 3 | - | 32845 | 34677 | - | 1 | strips rows=8 (29) | MM | - | - | - / - | compression:34677<br>display-range-unspecified<br>photometric:32845<br>sample-format:2,2,2 |
| `tiff-conformance/valid/off_luv32.tif` | 16,16,16 | 2,2,2 | 3 | - | 32845 | 34676 | - | 1 | strips rows=8 (29) | MM | - | - | - / - | compression:34676<br>display-range-unspecified<br>photometric:32845<br>sample-format:2,2,2 |
| `tiff-conformance/valid/predictor-3-gray-f32.tif` | 32 | 3 | 1 | - | 1 | 5 | 3 | - | strips rows=200 (1) | II | - | - | - / - | display-range-unspecified<br>grayscale-depth:32<br>predictor:3<br>sample-format:3 |
| `tiff-conformance/valid/predictor-3-rgb-f32.tif` | 32,32,32 | 3,3,3 | 3 | - | 2 | 5 | 3 | 1 | strips rows=109 (2) | II | - | - | - / - | color-depth:32,32,32<br>display-range-unspecified<br>predictor:3<br>sample-format:3,3,3 |
| `tiff-conformance/valid/random-fp16-pred2.tiff` | 16 | 3 | 1 | - | 1 | 8 | 2 | 1 | strips rows=16 (1) | II | - | - | - / - | display-range-unspecified<br>sample-format:3 |
| `tiff-conformance/valid/random-fp16-pred3.tiff` | 16 | 3 | 1 | - | 1 | 8 | 3 | 1 | strips rows=16 (1) | II | - | - | - / - | display-range-unspecified<br>predictor:3<br>sample-format:3 |
| `tiff-conformance/valid/random-fp16.tiff` | 16 | 3 | 1 | - | 1 | 8 | - | 1 | strips rows=128 (1) | II | - | - | - / - | display-range-unspecified<br>sample-format:3 |
| `tiff-conformance/valid/rgb32f_bw.tiff` | 32,32,32 | 3,3,3 | 3 | - | 2 | 1 | - | 1 | strips rows=128 (1) | II | - | - | - / - | color-depth:32,32,32<br>display-range-unspecified<br>sample-format:3,3,3 |
| `tiff-conformance/valid/rgb32f_color.tiff` | 32,32,32 | 3,3,3 | 3 | - | 2 | 1 | - | 1 | strips rows=128 (1) | II | - | - | - / - | color-depth:32,32,32<br>display-range-unspecified<br>sample-format:3,3,3 |
| `tiff-conformance/valid/single-black-fp16.tiff` | 16 | 3 | 1 | - | 1 | 8 | - | 1 | strips rows=128 (2) | II | - | - | - / - | display-range-unspecified<br>sample-format:3 |
| `tiff-conformance/valid/test_float64_predictor2_be_lzw.tif` | 64 | 3 | 1 | - | 1 | 5 | 2 | 1 | strips rows=20 (1) | MM | - | - | - / - | display-range-unspecified<br>grayscale-depth:64<br>predictor-2-depth:64<br>sample-format:3 |
| `tiff-conformance/valid/test_float64_predictor2_le_lzw.tif` | 64 | 3 | 1 | - | 1 | 5 | 2 | 1 | strips rows=20 (1) | II | - | - | - / - | display-range-unspecified<br>grayscale-depth:64<br>predictor-2-depth:64<br>sample-format:3 |
| `tiff-conformance/valid/text.tif` | 4 | - | 1 | - | 0 | 32809 | - | 1 | strips rows=64 (6) | MM | - | - | - / - | compression:32809 |
| `tiff-conformance/valid/tiled-cmyk-i8.tif` | 8,8,8,8 | 2,2,2,2 | 4 | - | 5 | 5 | 2 | 1 | tiles 32x32 (192) | II | - | - | - / - | display-range-unspecified<br>sample-format:2,2,2,2 |
| `tiff-conformance/valid/tiled-oversize-gray-i8.tif` | 8 | 2 | 1 | - | 1 | 5 | 2 | 1 | tiles 512x512 (1) | II | - | - | - / - | display-range-unspecified<br>sample-format:2 |
| `tiff-conformance/valid/white-fp16-pred2.tiff` | 16 | 3 | 1 | - | 1 | 8 | 2 | 1 | strips rows=16 (16) | II | - | - | - / - | display-range-unspecified<br>sample-format:3 |
| `tiff-conformance/valid/white-fp16-pred3.tiff` | 16 | 3 | 1 | - | 1 | 8 | 3 | 1 | strips rows=16 (16) | II | - | - | - / - | display-range-unspecified<br>predictor:3<br>sample-format:3 |
| `tiff-conformance/valid/white-fp16.tiff` | 16 | 3 | 1 | - | 1 | 1 | - | 1 | strips rows=128 (2) | II | - | - | - / - | display-range-unspecified<br>sample-format:3 |
