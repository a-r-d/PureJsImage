# HEIF/HEVC compatibility matrix

Generated from corpus version 1 at revision `d4b17508923b190308b63d166032b3bb5b553c54`. Every PureJsImage decode ran in a fresh process with a 512 MiB RSS ceiling. ImageMagick/libheif independently decoded metadata and displayed primary pixels.

## Summary

- Compatible: 10
- Explicitly unsupported: 12
- Invalid: 0
- Incorrect pixels: 1
- Unexpected exception: 2
- Timeout: 0
- Excessive memory: 0

## Coverage

The 25-file corpus spans iPhone 7, 12 Pro, and 13/13 Pro across iOS 11.0.3 and
iOS 16.2-16.7; Xiaomi, Samsung, Nokia, libheif, and x265 encoders; direct and
grid primaries; Main, Main Still Picture, Main 10, and Range Extensions;
`irot`, `imir`, and `clap`; full and limited range; sRGB and Display P3; and
auxiliary gain-map, depth, alpha, thumbnail, tone-map, and spatial items.

No redistributable or reproducibly downloadable direct multi-slice still
fixture was found. Multi-slice inspection exists, while reconstruction remains
explicitly unsupported.

## Next implementation project

The largest realistic failure cluster is absent or unspecified color-matrix
resolution: 8 downloaded real-world files plus the generated `imir` case, 9 of
the 12 explicit unsupported results. Define safe defaults from ICC, `nclx`,
VUI, brand, and profile evidence, while continuing to reject ambiguous inputs.
This is evidence for a separate project; this matrix adds no HEVC syntax.

Two valid libheif files separately expose an `hvcC` array-completeness parser
error. The Main 10/PQ fixture reconstructs but differs from the independent
displayed SDR output by 0.112799 normalized RMSE.

## Methodology

Each PureJsImage decode runs in a fresh Node process with a 512 MiB RSS ceiling
and a wall-clock timeout. ImageMagick/libheif validates displayed metadata and
sRGB RGBA pixels. The 200 MP case uses libheif-thumbnailer plus a streaming
FFmpeg downscale because the system ImageMagick pixel-cache policy cannot
materialize the full frame. RMSE at or below 0.035 is compatible.

## Matrix

| Fixture | Status | Peak RSS | Evidence |
| --- | --- | ---: | --- |
| iphone7-portrait | Explicitly unsupported | 141.6 MiB | UNSUPPORTED_OPERATION: Unsupported or unspecified HEIF color matrix: 2 |
| iphone7-landscape | Explicitly unsupported | 102.0 MiB | UNSUPPORTED_OPERATION: Unsupported or unspecified HEIF color matrix: 2 |
| iphone7-front-camera | Explicitly unsupported | 125.7 MiB | UNSUPPORTED_OPERATION: Unsupported or unspecified HEIF color matrix: 2 |
| iphone7-rotated-180 | Explicitly unsupported | 129.0 MiB | UNSUPPORTED_OPERATION: Unsupported or unspecified HEIF color matrix: 2 |
| iphone12-greyhounds | Compatible | 172.7 MiB | normalized sRGB RMSE 0.011517 (limit 0.035) |
| iphone12-classic-car | Compatible | 177.7 MiB | normalized sRGB RMSE 0.003298 (limit 0.035) |
| iphone12-old-safe | Compatible | 187.6 MiB | normalized sRGB RMSE 0.011145 (limit 0.035) |
| iphone13-ios16-6 | Compatible | 216.2 MiB | normalized sRGB RMSE 0.011119 (limit 0.035) |
| iphone13-ios16-5 | Compatible | 274.7 MiB | normalized sRGB RMSE 0.033673 (limit 0.035) |
| iphone13-pro-depth | Compatible | 168.6 MiB | normalized sRGB RMSE 0.003127 (limit 0.035) |
| xiaomi-mi11i | Compatible | 141.2 MiB | normalized sRGB RMSE 0.003605 (limit 0.035) |
| samsung-s24-200mp | Compatible | 338.4 MiB | normalized sRGB RMSE 0.030091 (limit 0.035) |
| samsung-s25-gain-map | Compatible | 172.3 MiB | normalized sRGB RMSE 0.009013 (limit 0.035) |
| libheif-example-main | Explicitly unsupported | 108.3 MiB | UNSUPPORTED_OPERATION: Unsupported or unspecified HEIF color matrix: none |
| nokia-overlay-alpha | Explicitly unsupported | 95.4 MiB | UNSUPPORTED_OPERATION: Unsupported HEIF primary item type: iovl |
| nokia-winter-direct | Explicitly unsupported | 107.5 MiB | UNSUPPORTED_OPERATION: Unsupported or unspecified HEIF color matrix: none |
| nokia-autumn-direct | Explicitly unsupported | 96.7 MiB | UNSUPPORTED_OPERATION: Unsupported or unspecified HEIF color matrix: none |
| nokia-timed-sequence | Explicitly unsupported | 93.6 MiB | UNSUPPORTED_OPERATION: Timed HEIF image sequences are unsupported |
| libheif-aux-alpha | Unexpected exception | 96.1 MiB | INVALID_INPUT: HEIF hvcC array reserved bit is set |
| apple-vision-pro-spatial | Compatible | 156.6 MiB | normalized sRGB RMSE 0.005599 (limit 0.035) |
| sdweb-grid | Explicitly unsupported | 107.6 MiB | UNSUPPORTED_OPERATION: Unsupported or unspecified HEIF color matrix: none |
| pillow-rext-10bit | Explicitly unsupported | 95.4 MiB | UNSUPPORTED_OPERATION: HEIF item 1 uses an unsupported HEVC profile, chroma format, or bit depth |
| libheif-clap | Unexpected exception | 93.6 MiB | INVALID_INPUT: HEIF hvcC array reserved bit is set |
| generated-main10-pq | Incorrect pixels | 98.2 MiB | normalized sRGB RMSE 0.112799 (limit 0.035) |
| generated-imir | Explicitly unsupported | 140.3 MiB | UNSUPPORTED_OPERATION: Unsupported or unspecified HEIF color matrix: 2 |
