# Benchmark result

Created: 2026-08-09T00:03:52.515Z

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
| purejsimage | metadata-jpeg-large | 0.1 ms | 0.1 ms | 0.2 ms | 112.0 MiB | 0.8 MiB | 0.0 MiB |
| purejsimage | jpeg-resize-1200 | 785.1 ms | 851.1 ms | 893.7 ms | 141.6 MiB | 10.1 MiB | 0.3 MiB |
| purejsimage | northstar-photo-pipeline | 3125.6 ms | 3233.1 ms | 3250.1 ms | 153.4 MiB | 14.0 MiB | 0.2 MiB |
| purejsimage | jpeg-crop-resize | 832.5 ms | 853.9 ms | 917.0 ms | 138.2 MiB | 6.7 MiB | 0.1 MiB |
| purejsimage | png-resize-1000 | 499.4 ms | 516.5 ms | 762.8 ms | 159.2 MiB | 3.7 MiB | 0.1 MiB |
| purejsimage | png-alpha-resize | 48.7 ms | 49.2 ms | 87.9 ms | 117.2 MiB | 3.0 MiB | 0.0 MiB |
| purejsimage | jpeg-to-png | 618.2 ms | 659.2 ms | 713.3 ms | 203.2 MiB | 55.0 MiB | 1.6 MiB |
| purejsimage | tiff-large-resize-jpeg | 127.9 ms | 131.5 ms | 164.5 ms | 181.3 MiB | 3.9 MiB | 0.1 MiB |
| purejsimage | stress-100mp-downscale | 2039.1 ms | 2145.5 ms | 2748.7 ms | 186.7 MiB | 70.9 MiB | 0.0 MiB |
| jimp | metadata-jpeg-large | 2568.4 ms | 2579.6 ms | 3180.0 ms | 1184.4 MiB | 300.9 MiB | 0.0 MiB |
| jimp | jpeg-resize-1200 | 1470.7 ms | 1620.1 ms | 1688.5 ms | 595.5 MiB | 175.0 MiB | 0.4 MiB |
| jimp | northstar-photo-pipeline | 4214.2 ms | 4933.8 ms | 5030.8 ms | 1186.9 MiB | 178.3 MiB | 0.2 MiB |
| jimp | jpeg-crop-resize | 2983.6 ms | 3023.9 ms | 3730.8 ms | 1197.9 MiB | 187.6 MiB | 0.1 MiB |
| jimp | png-resize-1000 | 899.5 ms | 944.9 ms | 1002.9 ms | 305.3 MiB | 144.6 MiB | 0.7 MiB |
| jimp | png-alpha-resize | 68.0 ms | 74.5 ms | 114.2 ms | 134.2 MiB | 7.2 MiB | 0.0 MiB |
| jimp | jpeg-to-png | 661.4 ms | 665.8 ms | 785.6 ms | 328.7 MiB | 127.7 MiB | 2.0 MiB |
| jimp | tiff-large-resize-jpeg | 662.2 ms | 682.6 ms | 756.8 ms | 353.2 MiB | 161.2 MiB | 0.1 MiB |
| jimp | stress-100mp-downscale | 3911.4 ms | 3927.4 ms | 4054.2 ms | 1280.1 MiB | 1164.7 MiB | 0.3 MiB |
| sharp | metadata-jpeg-large | 0.8 ms | 0.8 ms | 0.8 ms | 113.0 MiB | 1.1 MiB | 0.0 MiB |
| sharp | jpeg-resize-1200 | 69.0 ms | 69.1 ms | 77.5 ms | 170.3 MiB | 26.7 MiB | 0.3 MiB |
| sharp | northstar-photo-pipeline | 443.5 ms | 454.8 ms | 450.7 ms | 229.3 MiB | 56.2 MiB | 0.2 MiB |
| sharp | jpeg-crop-resize | 253.5 ms | 260.4 ms | 256.6 ms | 176.7 MiB | 29.6 MiB | 0.1 MiB |
| sharp | png-resize-1000 | 270.5 ms | 272.0 ms | 317.1 ms | 170.1 MiB | 41.9 MiB | 2.5 MiB |
| sharp | png-alpha-resize | 14.1 ms | 14.7 ms | 15.1 ms | 116.4 MiB | 9.1 MiB | 0.0 MiB |
| sharp | jpeg-to-png | 63.6 ms | 64.3 ms | 72.2 ms | 195.6 MiB | 81.3 MiB | 2.3 MiB |
| sharp | tiff-large-resize-jpeg | 43.2 ms | 43.8 ms | 47.2 ms | 193.6 MiB | 28.6 MiB | 0.1 MiB |
| sharp | stress-100mp-downscale | 698.5 ms | 741.5 ms | 733.5 ms | 215.4 MiB | 102.6 MiB | 1.5 MiB |
| sharp-single-thread | metadata-jpeg-large | 0.8 ms | 0.8 ms | 0.8 ms | 116.3 MiB | 1.0 MiB | 0.0 MiB |
| sharp-single-thread | jpeg-resize-1200 | 70.5 ms | 76.9 ms | 78.6 ms | 170.2 MiB | 26.9 MiB | 0.3 MiB |
| sharp-single-thread | northstar-photo-pipeline | 439.4 ms | 440.5 ms | 445.3 ms | 229.7 MiB | 56.5 MiB | 0.2 MiB |
| sharp-single-thread | jpeg-crop-resize | 240.3 ms | 263.5 ms | 243.3 ms | 177.5 MiB | 30.1 MiB | 0.1 MiB |
| sharp-single-thread | png-resize-1000 | 267.3 ms | 285.5 ms | 311.9 ms | 170.3 MiB | 42.0 MiB | 2.5 MiB |
| sharp-single-thread | png-alpha-resize | 11.5 ms | 11.9 ms | 12.7 ms | 116.2 MiB | 9.2 MiB | 0.0 MiB |
| sharp-single-thread | jpeg-to-png | 63.8 ms | 64.1 ms | 72.6 ms | 195.8 MiB | 81.6 MiB | 2.3 MiB |
| sharp-single-thread | tiff-large-resize-jpeg | 41.7 ms | 43.8 ms | 45.7 ms | 193.6 MiB | 28.5 MiB | 0.1 MiB |
| sharp-single-thread | stress-100mp-downscale | 693.4 ms | 704.0 ms | 729.0 ms | 215.1 MiB | 100.3 MiB | 1.5 MiB |
| image-js | metadata-jpeg-large | 2450.0 ms | 2617.1 ms | 3159.5 ms | 1191.2 MiB | 300.7 MiB | 0.0 MiB |
| image-js | jpeg-resize-1200 | 1034.8 ms | 1086.6 ms | 1225.0 ms | 570.8 MiB | 113.6 MiB | 0.4 MiB |
| image-js | northstar-photo-pipeline | 3366.3 ms | 3638.5 ms | 4231.2 ms | 1275.8 MiB | 259.6 MiB | 0.3 MiB |
| image-js | jpeg-crop-resize | 4031.4 ms | 4443.7 ms | 4733.6 ms | 1204.1 MiB | 187.9 MiB | 0.1 MiB |
| image-js | png-resize-1000 | 732.7 ms | 736.0 ms | 880.3 ms | 290.9 MiB | 143.5 MiB | 1.6 MiB |
| image-js | png-alpha-resize | 72.1 ms | 91.6 ms | 144.7 ms | 128.2 MiB | 17.5 MiB | 0.0 MiB |
| image-js | jpeg-to-png | 714.4 ms | 741.7 ms | 819.0 ms | 410.3 MiB | 193.3 MiB | 2.4 MiB |
| image-js | tiff-large-resize-jpeg | 159.8 ms | 198.0 ms | 211.1 ms | 260.5 MiB | 57.5 MiB | 0.1 MiB |
| image-js | stress-100mp-downscale | 1945.6 ms | 1949.9 ms | 2260.5 ms | 1271.8 MiB | 1148.7 MiB | 1.2 MiB |

## Startup and installed package footprint

| Engine | Import | RSS after import | First JPEG metadata | First JPEG resize | Installed footprint | Production packages |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| purejsimage | 46.0 ms | 93.3 MiB | 1.5 ms (pass) | 752.5 ms (pass) | 3.0 MiB | 1 |
| jimp | 69.1 ms | 93.2 MiB | 2710.9 ms (pass) | 1388.3 ms (pass) | 29.3 MiB | 70 |
| sharp | 28.5 ms | 94.0 MiB | 1.7 ms (pass) | 67.0 ms (pass) | 18.9 MiB | 6 |
| sharp-single-thread | 31.0 ms | 93.5 MiB | 1.7 ms (pass) | 69.6 ms (pass) | 18.9 MiB | 6 |
| image-js | 167.9 ms | 101.6 MiB | 2700.6 ms (pass) | 1104.2 ms (pass) | 17.0 MiB | 46 |

Installed footprint includes each engine package and the production dependencies present for this platform, including Sharp platform packages. Exact package lists are recorded in JSON.

A timing only counts when output validation passes. Input file reads, worker startup, warmups, and output validation are outside warm workflow timings. Startup measurements use a separate fresh process for each engine.

Timing comparisons include encoding. Lossy encoders do not share a calibrated quality scale, so output quality and compression efficiency cannot be compared solely because each API received `quality: 80`; that requires a separate matched-quality study.
