# HEIF/HEVC compatibility matrix

Generated from corpus version 1 at revision `02b58fa3364fc8209f0348d9e11625fb8799c02c`. Every PureJsImage decode ran in a fresh process with a 512 MiB RSS ceiling. ImageMagick/libheif independently decoded metadata and displayed primary pixels.

## Summary

- Compatible: 18
- Explicitly unsupported: 6
- Invalid: 0
- Incorrect pixels: 1
- Unexpected exception: 0
- Timeout: 0
- Excessive memory: 0

## Coverage

The 25-file corpus spans iPhone 7, 12 Pro, and 13/13 Pro across iOS 11.0.3 and iOS 16.2-16.7; Xiaomi, Samsung, Nokia, libheif, and x265 encoders; direct and grid primaries; Main, Main Still Picture, Main 10, and Range Extensions; irot, imir, and clap; full and limited range; sRGB and Display P3; and auxiliary gain-map, depth, alpha, thumbnail, tone-map, and spatial items.

No redistributable or reproducibly downloadable direct multi-slice still fixture was found. Multi-slice inspection exists, while reconstruction remains explicitly unsupported.

## Focused fix evidence

Deterministic matrix resolution advances all nine previously blocked fixtures. Six now match independently displayed pixels within tolerance; the remaining three fail later checks without an implicit BT.601/BT.709 fallback: libheif-example-main is 0.035339 RMSE, while the two Nokia files fail explicit slice-segmentation checks.

The hvcC array-completeness fix advances both libheif fixtures. libheif-clap now matches at 0.001507 RMSE after applying its SPS conformance window and clap; libheif-aux-alpha now fails explicitly because auxiliary alpha reconstruction remains unsupported instead of emitting opaque incorrect pixels.

The Main 10/PQ display fixture now matches the independent displayed RGB oracle at 0.001007 RMSE. Its explicit 8-bit compatibility policy preserves PQ code values, applies the signaled YCbCr matrix with nearest 4:2:0 chroma, rounds to 8-bit, and hard-clips to the SDR display gamut. HLG remains separately tested but is not independently promoted by this corpus.

## Remaining discrepancies

Investigate libheif-example-main and the two Nokia slice-segmentation failures without widening the 0.035 pixel tolerance.

## Methodology

Each PureJsImage decode runs in a fresh Node process with a 512 MiB RSS ceiling and a wall-clock timeout. ImageMagick/libheif validates displayed metadata and sRGB RGBA pixels. The 200 MP case uses libheif-thumbnailer plus a streaming FFmpeg downscale because the system ImageMagick pixel-cache policy cannot materialize the full frame. RMSE at or below 0.035 is compatible.

## Matrix

| Fixture | Status | Peak RSS | Evidence |
| --- | --- | ---: | --- |
| iphone7-portrait | Compatible | 168.5 MiB | normalized sRGB RMSE 0.028804 (limit 0.035) |
| iphone7-landscape | Compatible | 168.8 MiB | normalized sRGB RMSE 0.006027 (limit 0.035) |
| iphone7-front-camera | Compatible | 156.2 MiB | normalized sRGB RMSE 0.030535 (limit 0.035) |
| iphone7-rotated-180 | Compatible | 301.6 MiB | normalized sRGB RMSE 0.010261 (limit 0.035) |
| iphone12-greyhounds | Compatible | 176.1 MiB | normalized sRGB RMSE 0.011517 (limit 0.035) |
| iphone12-classic-car | Compatible | 177.7 MiB | normalized sRGB RMSE 0.003298 (limit 0.035) |
| iphone12-old-safe | Compatible | 185.8 MiB | normalized sRGB RMSE 0.011145 (limit 0.035) |
| iphone13-ios16-6 | Compatible | 187.3 MiB | normalized sRGB RMSE 0.011119 (limit 0.035) |
| iphone13-ios16-5 | Compatible | 274.9 MiB | normalized sRGB RMSE 0.033673 (limit 0.035) |
| iphone13-pro-depth | Compatible | 169.4 MiB | normalized sRGB RMSE 0.003127 (limit 0.035) |
| xiaomi-mi11i | Compatible | 142.3 MiB | normalized sRGB RMSE 0.003605 (limit 0.035) |
| samsung-s24-200mp | Compatible | 401.8 MiB | normalized sRGB RMSE 0.030091 (limit 0.035) |
| samsung-s25-gain-map | Compatible | 159.2 MiB | normalized sRGB RMSE 0.009013 (limit 0.035) |
| libheif-example-main | Incorrect pixels | 149.8 MiB | normalized sRGB RMSE 0.035339 (limit 0.035) |
| nokia-overlay-alpha | Explicitly unsupported | 97.2 MiB | UNSUPPORTED_OPERATION: Unsupported HEIF primary item type: iovl |
| nokia-winter-direct | Explicitly unsupported | 120.1 MiB | UNSUPPORTED_OPERATION: HEVC slice segmentation does not match the coded picture at CTB 344 |
| nokia-autumn-direct | Explicitly unsupported | 103.1 MiB | UNSUPPORTED_OPERATION: HEVC slice segmentation does not match the coded picture at CTB 23 |
| nokia-timed-sequence | Explicitly unsupported | 98.1 MiB | UNSUPPORTED_OPERATION: Timed HEIF image sequences are unsupported |
| libheif-aux-alpha | Explicitly unsupported | 97.7 MiB | UNSUPPORTED_OPERATION: HEIF auxiliary alpha reconstruction is unsupported |
| apple-vision-pro-spatial | Compatible | 157.1 MiB | normalized sRGB RMSE 0.005599 (limit 0.035) |
| sdweb-grid | Compatible | 129.5 MiB | normalized sRGB RMSE 0.001654 (limit 0.035) |
| pillow-rext-10bit | Explicitly unsupported | 96.2 MiB | UNSUPPORTED_OPERATION: HEIF item 1 uses an unsupported HEVC profile, chroma format, or bit depth |
| libheif-clap | Compatible | 111.8 MiB | normalized sRGB RMSE 0.001507 (limit 0.035) |
| generated-main10-pq | Compatible | 99.4 MiB | normalized sRGB RMSE 0.001007 (limit 0.035) |
| generated-imir | Compatible | 178.3 MiB | normalized sRGB RMSE 0.028805 (limit 0.035) |
