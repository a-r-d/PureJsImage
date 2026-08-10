# Imazen TIFF unsupported dependency matrix

Source report: `imazen-tiff-conformance.json`

Unsupported files inspected: 10
Projected first-expansion pass count: 140 → 140
ThunderScan is excluded from the projection: the sole Compression=32809 fixture is structurally invalid under independent LibTIFF and ImageMagick decoding.

## Implementation dependency graph

| Wave | Capability | Dependencies | Visible files | Projected pass |
| --- | --- | --- | ---: | ---: |
| A | Unsigned 10/12/14-bit grayscale and RGB | color-depth:10,10,10<br>color-depth:12,12,12<br>color-depth:14,14,14<br>grayscale-depth:10<br>grayscale-depth:12<br>grayscale-depth:14 | 0 | 140 |
| B | Unsigned 2/4-bit RGB and 6-bit grayscale | color-depth:2,2,2<br>color-depth:4,4,4<br>grayscale-depth:6 | 0 | 140 |
| C | CMYK plus alpha | cmyk-alpha | 0 | 140 |
| D | WebP-in-TIFF | compression:50001 | 0 | 140 |


## Dependency counts

| Dependency | Files |
| --- | ---: |
| color-depth:32,32,32,32 | 1 |
| compression:32809 | 1 |
| compression:34676 | 3 |
| compression:34677 | 1 |
| compression:50000 | 1 |
| display-range-unspecified | 7 |
| extra-samples:0,0,0,0 | 1 |
| generic-five-band | 1 |
| photometric:32844 | 1 |
| photometric:32845 | 3 |
| sample-format:2 | 2 |
| sample-format:2,2,2 | 3 |
| sample-format:2,2,2,2 | 1 |
| sample-format:2,2,2,2,2 | 1 |
| sample-format:3,3,3,3 | 1 |
| samples-per-pixel:5 | 1 |

## File matrix

| File | Bits | Sample format | SPP | Extra | Photo | Compression | Predictor | Planar | Geometry | Byte order | ICC | JPEGTables | SMin / SMax | Dependencies |
| --- | --- | --- | ---: | --- | ---: | ---: | ---: | ---: | --- | --- | --- | --- | --- | --- |
| `tiff-conformance/edge-cases/geo-5b.tif` | 16,16,16,16,16 | 2,2,2,2,2 | 5 | 0,0,0,0 | 1 | 1 | - | 1 | strips rows=10 (1) | II | - | - | - / - | display-range-unspecified<br>extra-samples:0,0,0,0<br>generic-five-band<br>sample-format:2,2,2,2,2<br>samples-per-pixel:5 |
| `tiff-conformance/valid/cmyk-3c-32b-float.tiff` | 32,32,32,32 | 3,3,3,3 | 4 | - | 5 | 1 | - | 1 | strips rows=20 (1) | II | - | - | 0,0,0,0 / 1,1,1,1 | color-depth:32,32,32,32<br>sample-format:3,3,3,3 |
| `tiff-conformance/valid/flower-palette-16.tif` | 16 | - | 1 | - | 3 | 1 | - | 1 | strips rows=56 (1) | MM | - | - | - / - | - |
| `tiff-conformance/valid/int16_zstd.tif` | 16 | 2 | 1 | - | 1 | 50000 | 1 | 1 | strips rows=64 (1) | II | - | - | - / - | compression:50000<br>display-range-unspecified<br>sample-format:2 |
| `tiff-conformance/valid/logluv-3c-16b.tiff` | 16,16,16 | 2,2,2 | 3 | - | 32845 | 34676 | - | 1 | strips rows=682 (1) | II | - | - | - / - | compression:34676<br>display-range-unspecified<br>photometric:32845<br>sample-format:2,2,2 |
| `tiff-conformance/valid/off_l16.tif` | 16 | 2 | 1 | - | 32844 | 34676 | - | 1 | strips rows=8 (29) | MM | - | - | - / - | compression:34676<br>display-range-unspecified<br>photometric:32844<br>sample-format:2 |
| `tiff-conformance/valid/off_luv24.tif` | 16,16,16 | 2,2,2 | 3 | - | 32845 | 34677 | - | 1 | strips rows=8 (29) | MM | - | - | - / - | compression:34677<br>display-range-unspecified<br>photometric:32845<br>sample-format:2,2,2 |
| `tiff-conformance/valid/off_luv32.tif` | 16,16,16 | 2,2,2 | 3 | - | 32845 | 34676 | - | 1 | strips rows=8 (29) | MM | - | - | - / - | compression:34676<br>display-range-unspecified<br>photometric:32845<br>sample-format:2,2,2 |
| `tiff-conformance/valid/text.tif` | 4 | - | 1 | - | 0 | 32809 | - | 1 | strips rows=64 (6) | MM | - | - | - / - | compression:32809 |
| `tiff-conformance/valid/tiled-cmyk-i8.tif` | 8,8,8,8 | 2,2,2,2 | 4 | - | 5 | 5 | 2 | 1 | tiles 32x32 (192) | II | - | - | - / - | display-range-unspecified<br>sample-format:2,2,2,2 |
