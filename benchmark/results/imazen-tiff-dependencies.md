# Imazen TIFF unsupported dependency matrix

Source report: `imazen-tiff-conformance.json`

Unsupported files inspected: 3
Projected first-expansion pass count: 147 → 147
ThunderScan is excluded from the projection: the sole Compression=32809 fixture is structurally invalid under independent LibTIFF and ImageMagick decoding.

## Implementation dependency graph

| Wave | Capability | Dependencies | Visible files | Projected pass |
| --- | --- | --- | ---: | ---: |
| A | Unsigned 10/12/14-bit grayscale and RGB | color-depth:10,10,10<br>color-depth:12,12,12<br>color-depth:14,14,14<br>grayscale-depth:10<br>grayscale-depth:12<br>grayscale-depth:14 | 0 | 147 |
| B | Unsigned 2/4-bit RGB and 6-bit grayscale | color-depth:2,2,2<br>color-depth:4,4,4<br>grayscale-depth:6 | 0 | 147 |
| C | CMYK plus alpha | cmyk-alpha | 0 | 147 |
| D | WebP-in-TIFF | compression:50001 | 0 | 147 |


## Dependency counts

| Dependency | Files |
| --- | ---: |
| compression:32809 | 1 |
| compression:50000 | 1 |
| display-range-unspecified | 2 |
| extra-samples:0,0,0,0 | 1 |
| generic-five-band | 1 |
| sample-format:2 | 1 |
| sample-format:2,2,2,2,2 | 1 |
| samples-per-pixel:5 | 1 |

## File matrix

| File | Bits | Sample format | SPP | Extra | Photo | Compression | Predictor | Planar | Geometry | Byte order | ICC | JPEGTables | SMin / SMax | Dependencies |
| --- | --- | --- | ---: | --- | ---: | ---: | ---: | ---: | --- | --- | --- | --- | --- | --- |
| `tiff-conformance/edge-cases/geo-5b.tif` | 16,16,16,16,16 | 2,2,2,2,2 | 5 | 0,0,0,0 | 1 | 1 | - | 1 | strips rows=10 (1) | II | - | - | - / - | display-range-unspecified<br>extra-samples:0,0,0,0<br>generic-five-band<br>sample-format:2,2,2,2,2<br>samples-per-pixel:5 |
| `tiff-conformance/valid/int16_zstd.tif` | 16 | 2 | 1 | - | 1 | 50000 | 1 | 1 | strips rows=64 (1) | II | - | - | - / - | compression:50000<br>display-range-unspecified<br>sample-format:2 |
| `tiff-conformance/valid/text.tif` | 4 | - | 1 | - | 0 | 32809 | - | 1 | strips rows=64 (6) | MM | - | - | - / - | compression:32809 |
