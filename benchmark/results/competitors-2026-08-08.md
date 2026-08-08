# Benchmark result

Created: 2026-08-08T20:55:00.691Z

Profile: `competitors`

Environment: Linux 6.17.0-41-generic, x64, Node v24.16.0, Intel(R) Core(TM) i7-10700 CPU @ 2.90GHz, 16 logical CPUs

## Engine versions

| Engine | Version | Implementation |
| --- | --- | --- |
| purejsimage | 0.6.0 (workspace) | pure-javascript |
| jimp | 1.6.0 | pure-javascript |
| sharp | 0.35.3 | native |
| sharp-single-thread | 0.35.3 | native-single-thread |
| image-js | 1.7.0 | pure-javascript |

PureJsImage, Jimp, and image-js are pure JavaScript. Sharp is a native dependency; `sharp-single-thread` is the same native package configured with `sharp.concurrency(1)` before processing.

## Compatibility

| Engine | Workflow | Status | Detail |
| --- | --- | --- | --- |
| purejsimage | metadata-jpeg-large | pass | - |
| purejsimage | jpeg-resize-1200 | pass | - |
| purejsimage | northstar-photo-pipeline | pass | - |
| purejsimage | jpeg-crop-resize | pass | - |
| purejsimage | png-resize-1000 | pass | - |
| purejsimage | png-alpha-resize | pass | - |
| purejsimage | jpeg-to-png | pass | - |
| purejsimage | png-to-jpeg | pass | - |
| purejsimage | auto-orient-6 | pass | - |
| purejsimage | heif-iphone-resize-jpeg | pass | - |
| purejsimage | bmp-large-resize-jpeg | pass | - |
| purejsimage | tiff-large-resize-jpeg | pass | - |
| purejsimage | webp-large-resize-jpeg | pass | - |
| purejsimage | stress-100mp-downscale | pass | - |
| jimp | metadata-jpeg-large | pass | - |
| jimp | jpeg-resize-1200 | pass | - |
| jimp | northstar-photo-pipeline | pass | - |
| jimp | jpeg-crop-resize | pass | - |
| jimp | png-resize-1000 | pass | - |
| jimp | png-alpha-resize | pass | - |
| jimp | jpeg-to-png | pass | - |
| jimp | png-to-jpeg | pass | - |
| jimp | auto-orient-6 | pass | - |
| jimp | heif-iphone-resize-jpeg | unsupported | Jimp 1.6.0 has no HEIC decoder |
| jimp | bmp-large-resize-jpeg | pass | - |
| jimp | tiff-large-resize-jpeg | pass | - |
| jimp | webp-large-resize-jpeg | unsupported | Jimp 1.6.0 has no WebP decoder |
| jimp | stress-100mp-downscale | pass | - |
| sharp | metadata-jpeg-large | pass | - |
| sharp | jpeg-resize-1200 | pass | - |
| sharp | northstar-photo-pipeline | pass | - |
| sharp | jpeg-crop-resize | pass | - |
| sharp | png-resize-1000 | pass | - |
| sharp | png-alpha-resize | pass | - |
| sharp | jpeg-to-png | pass | - |
| sharp | png-to-jpeg | pass | - |
| sharp | auto-orient-6 | pass | - |
| sharp | heif-iphone-resize-jpeg | unsupported | The installed Sharp/libvips build cannot decode the pinned iPhone HEIC fixture |
| sharp | bmp-large-resize-jpeg | unsupported | The installed Sharp/libvips build has no BMP input support |
| sharp | tiff-large-resize-jpeg | pass | - |
| sharp | webp-large-resize-jpeg | pass | - |
| sharp | stress-100mp-downscale | pass | - |
| sharp-single-thread | metadata-jpeg-large | pass | - |
| sharp-single-thread | jpeg-resize-1200 | pass | - |
| sharp-single-thread | northstar-photo-pipeline | pass | - |
| sharp-single-thread | jpeg-crop-resize | pass | - |
| sharp-single-thread | png-resize-1000 | pass | - |
| sharp-single-thread | png-alpha-resize | pass | - |
| sharp-single-thread | jpeg-to-png | pass | - |
| sharp-single-thread | png-to-jpeg | pass | - |
| sharp-single-thread | auto-orient-6 | pass | - |
| sharp-single-thread | heif-iphone-resize-jpeg | unsupported | The installed Sharp/libvips build cannot decode the pinned iPhone HEIC fixture |
| sharp-single-thread | bmp-large-resize-jpeg | unsupported | The installed Sharp/libvips build has no BMP input support |
| sharp-single-thread | tiff-large-resize-jpeg | pass | - |
| sharp-single-thread | webp-large-resize-jpeg | pass | - |
| sharp-single-thread | stress-100mp-downscale | pass | - |
| image-js | metadata-jpeg-large | pass | - |
| image-js | jpeg-resize-1200 | pass | - |
| image-js | northstar-photo-pipeline | pass | - |
| image-js | jpeg-crop-resize | pass | - |
| image-js | png-resize-1000 | pass | - |
| image-js | png-alpha-resize | pass | - |
| image-js | jpeg-to-png | pass | - |
| image-js | png-to-jpeg | unsupported | image-js cannot flatten transparent pixels onto an explicit background through its image API |
| image-js | auto-orient-6 | unsupported | image-js does not expose EXIF auto-orientation through its image API |
| image-js | heif-iphone-resize-jpeg | unsupported | image-js has no HEIC decoder |
| image-js | bmp-large-resize-jpeg | pass | - |
| image-js | tiff-large-resize-jpeg | pass | - |
| image-js | webp-large-resize-jpeg | unsupported | image-js has no WebP decoder |
| image-js | stress-100mp-downscale | pass | - |

## Performance on workflows supported equivalently by every selected engine

| Engine | Workflow | Median wall | p95 wall | Median CPU | Peak RSS | Peak RSS delta | Output |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| purejsimage | metadata-jpeg-large | 0.2 ms | 0.2 ms | 0.2 ms | 107.9 MiB | 0.8 MiB | 0.0 MiB |
| purejsimage | jpeg-resize-1200 | 911.9 ms | 922.8 ms | 995.3 ms | 134.0 MiB | 7.9 MiB | 0.4 MiB |
| purejsimage | northstar-photo-pipeline | 3251.6 ms | 3311.3 ms | 3336.3 ms | 147.5 MiB | 15.1 MiB | 0.2 MiB |
| purejsimage | jpeg-crop-resize | 2597.3 ms | 2641.1 ms | 2690.1 ms | 134.3 MiB | 13.6 MiB | 0.1 MiB |
| purejsimage | png-resize-1000 | 497.9 ms | 511.6 ms | 761.6 ms | 159.3 MiB | 24.0 MiB | 0.1 MiB |
| purejsimage | png-alpha-resize | 49.2 ms | 50.7 ms | 88.2 ms | 114.8 MiB | 5.0 MiB | 0.0 MiB |
| purejsimage | jpeg-to-png | 377.7 ms | 386.6 ms | 441.2 ms | 196.7 MiB | 56.7 MiB | 1.6 MiB |
| purejsimage | tiff-large-resize-jpeg | 122.7 ms | 122.8 ms | 160.6 ms | 168.4 MiB | 16.2 MiB | 0.1 MiB |
| purejsimage | stress-100mp-downscale | 1931.8 ms | 1944.3 ms | 2562.5 ms | 180.9 MiB | 71.2 MiB | 0.0 MiB |
| jimp | metadata-jpeg-large | 2418.2 ms | 2493.4 ms | 2980.7 ms | 1184.4 MiB | 301.2 MiB | 0.0 MiB |
| jimp | jpeg-resize-1200 | 1411.6 ms | 1443.3 ms | 1655.1 ms | 595.2 MiB | 174.6 MiB | 0.4 MiB |
| jimp | northstar-photo-pipeline | 3962.8 ms | 4109.8 ms | 4718.6 ms | 1189.1 MiB | 178.0 MiB | 0.2 MiB |
| jimp | jpeg-crop-resize | 2982.0 ms | 3029.1 ms | 3763.3 ms | 1197.4 MiB | 188.3 MiB | 0.1 MiB |
| jimp | png-resize-1000 | 886.5 ms | 903.4 ms | 996.4 ms | 306.8 MiB | 147.2 MiB | 0.7 MiB |
| jimp | png-alpha-resize | 70.5 ms | 71.6 ms | 109.8 ms | 128.6 MiB | 3.6 MiB | 0.0 MiB |
| jimp | jpeg-to-png | 673.4 ms | 673.5 ms | 795.1 ms | 327.9 MiB | 127.6 MiB | 2.0 MiB |
| jimp | tiff-large-resize-jpeg | 669.9 ms | 763.8 ms | 789.9 ms | 348.3 MiB | 161.3 MiB | 0.1 MiB |
| jimp | stress-100mp-downscale | 4004.1 ms | 4108.0 ms | 4152.6 ms | 1276.3 MiB | 1164.2 MiB | 0.3 MiB |
| sharp | metadata-jpeg-large | 0.8 ms | 0.9 ms | 0.8 ms | 111.8 MiB | 0.9 MiB | 0.0 MiB |
| sharp | jpeg-resize-1200 | 73.7 ms | 76.5 ms | 82.0 ms | 170.5 MiB | 27.0 MiB | 0.3 MiB |
| sharp | northstar-photo-pipeline | 452.0 ms | 464.5 ms | 457.7 ms | 228.8 MiB | 55.7 MiB | 0.2 MiB |
| sharp | jpeg-crop-resize | 243.6 ms | 243.6 ms | 245.7 ms | 177.3 MiB | 30.2 MiB | 0.1 MiB |
| sharp | png-resize-1000 | 271.1 ms | 274.1 ms | 314.7 ms | 166.7 MiB | 38.9 MiB | 2.5 MiB |
| sharp | png-alpha-resize | 11.8 ms | 11.8 ms | 13.0 ms | 115.2 MiB | 9.1 MiB | 0.0 MiB |
| sharp | jpeg-to-png | 64.1 ms | 64.8 ms | 73.9 ms | 195.4 MiB | 81.4 MiB | 2.3 MiB |
| sharp | tiff-large-resize-jpeg | 41.9 ms | 58.3 ms | 46.1 ms | 193.5 MiB | 28.6 MiB | 0.1 MiB |
| sharp | stress-100mp-downscale | 866.0 ms | 903.9 ms | 905.8 ms | 214.4 MiB | 100.6 MiB | 1.5 MiB |
| sharp-single-thread | metadata-jpeg-large | 0.9 ms | 1.1 ms | 1.0 ms | 112.4 MiB | 1.2 MiB | 0.0 MiB |
| sharp-single-thread | jpeg-resize-1200 | 71.2 ms | 71.4 ms | 79.8 ms | 170.0 MiB | 27.2 MiB | 0.3 MiB |
| sharp-single-thread | northstar-photo-pipeline | 445.3 ms | 448.4 ms | 452.2 ms | 229.1 MiB | 56.0 MiB | 0.2 MiB |
| sharp-single-thread | jpeg-crop-resize | 244.8 ms | 245.4 ms | 247.3 ms | 176.8 MiB | 30.4 MiB | 0.1 MiB |
| sharp-single-thread | png-resize-1000 | 278.4 ms | 279.0 ms | 326.7 ms | 166.7 MiB | 39.2 MiB | 2.5 MiB |
| sharp-single-thread | png-alpha-resize | 11.9 ms | 15.8 ms | 13.0 ms | 116.2 MiB | 9.2 MiB | 0.0 MiB |
| sharp-single-thread | jpeg-to-png | 63.0 ms | 67.5 ms | 71.7 ms | 195.3 MiB | 81.4 MiB | 2.3 MiB |
| sharp-single-thread | tiff-large-resize-jpeg | 47.7 ms | 48.8 ms | 51.7 ms | 192.9 MiB | 28.3 MiB | 0.1 MiB |
| sharp-single-thread | stress-100mp-downscale | 695.3 ms | 731.9 ms | 730.8 ms | 215.2 MiB | 102.4 MiB | 1.5 MiB |
| image-js | metadata-jpeg-large | 2529.5 ms | 2614.6 ms | 3187.0 ms | 1190.8 MiB | 301.8 MiB | 0.0 MiB |
| image-js | jpeg-resize-1200 | 1031.3 ms | 1032.8 ms | 1208.4 ms | 571.4 MiB | 113.7 MiB | 0.4 MiB |
| image-js | northstar-photo-pipeline | 3371.9 ms | 3399.4 ms | 4212.5 ms | 1275.5 MiB | 259.5 MiB | 0.3 MiB |
| image-js | jpeg-crop-resize | 2751.0 ms | 3045.2 ms | 3546.6 ms | 1203.0 MiB | 187.8 MiB | 0.1 MiB |
| image-js | png-resize-1000 | 755.0 ms | 766.3 ms | 918.2 ms | 292.5 MiB | 143.5 MiB | 1.6 MiB |
| image-js | png-alpha-resize | 81.9 ms | 85.3 ms | 142.7 ms | 127.3 MiB | 17.9 MiB | 0.0 MiB |
| image-js | jpeg-to-png | 705.8 ms | 772.4 ms | 810.7 ms | 408.7 MiB | 193.9 MiB | 2.4 MiB |
| image-js | tiff-large-resize-jpeg | 168.1 ms | 194.4 ms | 222.3 ms | 253.8 MiB | 52.0 MiB | 0.1 MiB |
| image-js | stress-100mp-downscale | 1949.3 ms | 2029.6 ms | 2263.4 ms | 1271.6 MiB | 1150.8 MiB | 1.2 MiB |

## Startup and installed package footprint

| Engine | Import | RSS after import | First JPEG metadata | First JPEG resize | Installed footprint | Production packages |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| purejsimage | 44.1 ms | 87.8 MiB | 1.5 ms (pass) | 949.5 ms (pass) | 2.5 MiB | 1 |
| jimp | 63.6 ms | 93.6 MiB | 2767.9 ms (pass) | 1436.9 ms (pass) | 29.3 MiB | 70 |
| sharp | 29.2 ms | 93.3 MiB | 2.1 ms (pass) | 72.9 ms (pass) | 18.9 MiB | 6 |
| sharp-single-thread | 28.3 ms | 93.2 MiB | 1.9 ms (pass) | 69.1 ms (pass) | 18.9 MiB | 6 |
| image-js | 169.8 ms | 100.9 MiB | 2751.4 ms (pass) | 1067.7 ms (pass) | 17.0 MiB | 46 |

Installed footprint includes each engine package and the production dependencies present for this platform, including Sharp platform packages. Exact package lists are recorded in JSON.

A timing only counts when output validation passes. Input file reads, worker startup, warmups, and output validation are outside warm workflow timings. Startup measurements use a separate fresh process for each engine.

Timing comparisons include encoding. Lossy encoders do not share a calibrated quality scale, so output quality and compression efficiency cannot be compared solely because each API received `quality: 80`; that requires a separate matched-quality study.
