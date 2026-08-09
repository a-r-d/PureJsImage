# Benchmark result

Created: 2026-08-09T00:52:55.726Z

Profile: `competitors`

Environment: Linux 6.17.0-41-generic, x64, Node v24.16.0, Intel(R) Core(TM) i7-10700 CPU @ 2.90GHz, 16 logical CPUs

## Engine versions

| Engine | Version | Implementation |
| --- | --- | --- |
| purejsimage | 0.7.0 (workspace) | pure-javascript |
| jimp | 1.6.0 | pure-javascript |
| sharp | 0.35.3 | native |
| sharp-single-thread | 0.35.3 | native-single-thread |
| image-js | 1.7.0 | pure-javascript |
| jsquash | jpeg 1.6.0; png 3.1.1; webp 1.5.0; resize 2.1.1 | webassembly |

PureJsImage, Jimp, and image-js are pure JavaScript. jSquash uses WebAssembly codecs and resizing. Sharp is a native dependency; `sharp-single-thread` is the same native package configured with `sharp.concurrency(1)` before processing.

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
| jsquash | metadata-jpeg-large | unsupported | jSquash has no metadata inspection API; decoding all pixels would not be equivalent |
| jsquash | jpeg-resize-1200 | pass | - |
| jsquash | northstar-photo-pipeline | unsupported | jSquash has no public operation for the workflow's exact crop coordinates |
| jsquash | jpeg-crop-resize | unsupported | jSquash has no public operation for the workflow's exact crop coordinates |
| jsquash | png-resize-1000 | pass | - |
| jsquash | png-alpha-resize | pass | - |
| jsquash | jpeg-to-png | pass | - |
| jsquash | png-to-jpeg | unsupported | jSquash has no public operation for flattening alpha onto an explicit background |
| jsquash | auto-orient-6 | pass | - |
| jsquash | heif-iphone-resize-jpeg | unsupported | jSquash has no HEIC decoder |
| jsquash | bmp-large-resize-jpeg | unsupported | jSquash has no BMP decoder |
| jsquash | tiff-large-resize-jpeg | unsupported | jSquash has no TIFF decoder |
| jsquash | webp-large-resize-jpeg | pass | - |
| jsquash | stress-100mp-downscale | pass | - |

## Performance on workflows supported equivalently by every selected engine

| Engine | Workflow | Median wall | p95 wall | Median CPU | Peak RSS | Peak RSS delta | Output |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| purejsimage | jpeg-resize-1200 | 765.3 ms | 789.7 ms | 847.3 ms | 142.1 MiB | 11.7 MiB | 0.3 MiB |
| purejsimage | png-resize-1000 | 492.2 ms | 496.7 ms | 733.6 ms | 166.7 MiB | 10.5 MiB | 0.1 MiB |
| purejsimage | png-alpha-resize | 48.3 ms | 53.8 ms | 86.5 ms | 117.2 MiB | 4.1 MiB | 0.0 MiB |
| purejsimage | jpeg-to-png | 547.0 ms | 547.8 ms | 631.9 ms | 202.8 MiB | 56.7 MiB | 1.6 MiB |
| purejsimage | stress-100mp-downscale | 1914.3 ms | 1963.2 ms | 2629.3 ms | 187.1 MiB | 74.5 MiB | 0.0 MiB |
| jimp | jpeg-resize-1200 | 1398.4 ms | 1402.9 ms | 1602.1 ms | 595.9 MiB | 175.3 MiB | 0.4 MiB |
| jimp | png-resize-1000 | 912.2 ms | 914.3 ms | 999.3 ms | 304.4 MiB | 144.8 MiB | 0.7 MiB |
| jimp | png-alpha-resize | 77.3 ms | 97.7 ms | 130.8 ms | 136.4 MiB | 8.2 MiB | 0.0 MiB |
| jimp | jpeg-to-png | 710.1 ms | 842.8 ms | 798.4 ms | 327.5 MiB | 127.1 MiB | 2.0 MiB |
| jimp | stress-100mp-downscale | 3831.8 ms | 3892.8 ms | 4002.0 ms | 1262.9 MiB | 1148.1 MiB | 0.3 MiB |
| sharp | jpeg-resize-1200 | 71.1 ms | 76.9 ms | 79.4 ms | 170.8 MiB | 27.5 MiB | 0.3 MiB |
| sharp | png-resize-1000 | 260.7 ms | 263.0 ms | 303.7 ms | 170.5 MiB | 41.7 MiB | 2.5 MiB |
| sharp | png-alpha-resize | 11.5 ms | 11.7 ms | 12.6 ms | 116.9 MiB | 9.1 MiB | 0.0 MiB |
| sharp | jpeg-to-png | 64.6 ms | 67.1 ms | 73.2 ms | 195.6 MiB | 81.4 MiB | 2.3 MiB |
| sharp | stress-100mp-downscale | 650.8 ms | 664.0 ms | 687.4 ms | 215.3 MiB | 102.2 MiB | 1.5 MiB |
| sharp-single-thread | jpeg-resize-1200 | 68.1 ms | 71.6 ms | 76.1 ms | 170.4 MiB | 27.0 MiB | 0.3 MiB |
| sharp-single-thread | png-resize-1000 | 261.3 ms | 272.3 ms | 303.6 ms | 170.3 MiB | 42.0 MiB | 2.5 MiB |
| sharp-single-thread | png-alpha-resize | 11.7 ms | 13.0 ms | 12.8 ms | 116.8 MiB | 8.9 MiB | 0.0 MiB |
| sharp-single-thread | jpeg-to-png | 61.8 ms | 62.0 ms | 70.4 ms | 196.1 MiB | 81.5 MiB | 2.3 MiB |
| sharp-single-thread | stress-100mp-downscale | 665.8 ms | 684.5 ms | 700.9 ms | 215.2 MiB | 102.3 MiB | 1.5 MiB |
| image-js | jpeg-resize-1200 | 1007.6 ms | 1060.0 ms | 1223.2 ms | 569.8 MiB | 112.8 MiB | 0.4 MiB |
| image-js | png-resize-1000 | 725.0 ms | 739.8 ms | 862.4 ms | 291.6 MiB | 143.3 MiB | 1.6 MiB |
| image-js | png-alpha-resize | 77.8 ms | 81.7 ms | 135.2 ms | 127.1 MiB | 16.5 MiB | 0.0 MiB |
| image-js | jpeg-to-png | 685.6 ms | 705.3 ms | 790.0 ms | 409.3 MiB | 193.3 MiB | 2.4 MiB |
| image-js | stress-100mp-downscale | 1891.3 ms | 1904.0 ms | 2186.8 ms | 1270.3 MiB | 1146.5 MiB | 1.2 MiB |
| jsquash | jpeg-resize-1200 | 1144.1 ms | 1179.5 ms | 1158.0 ms | 605.1 MiB | 46.9 MiB | 0.3 MiB |
| jsquash | png-resize-1000 | 819.3 ms | 820.6 ms | 819.5 ms | 525.1 MiB | 51.8 MiB | 1.4 MiB |
| jsquash | png-alpha-resize | 63.2 ms | 63.4 ms | 69.5 ms | 129.3 MiB | 0.8 MiB | 0.2 MiB |
| jsquash | jpeg-to-png | 89.9 ms | 100.1 ms | 91.1 ms | 291.6 MiB | 90.9 MiB | 2.3 MiB |
| jsquash | stress-100mp-downscale | 6862.2 ms | 6901.8 ms | 6978.9 ms | 3011.2 MiB | 2886.5 MiB | 1.1 MiB |

## Startup and installed package footprint

| Engine | Import | RSS after import | First JPEG metadata | First JPEG resize | Installed footprint | Production packages |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| purejsimage | 45.9 ms | 93.0 MiB | 1.4 ms (pass) | 735.4 ms (pass) | 3.1 MiB | 1 |
| jimp | 60.8 ms | 92.8 MiB | 2456.2 ms (pass) | 1328.1 ms (pass) | 29.3 MiB | 70 |
| sharp | 27.5 ms | 93.7 MiB | 1.9 ms (pass) | 67.3 ms (pass) | 18.9 MiB | 6 |
| sharp-single-thread | 27.0 ms | 93.3 MiB | 1.9 ms (pass) | 66.9 ms (pass) | 18.9 MiB | 6 |
| image-js | 179.7 ms | 101.6 MiB | 2510.1 ms (pass) | 1013.2 ms (pass) | 17.0 MiB | 46 |
| jsquash | 10.1 ms | 83.5 MiB | - ms (unsupported) | 1415.6 ms (pass) | 1.9 MiB | 5 |

Installed footprint includes every package required by an engine and the production dependencies present for this platform, including jSquash codec/resize packages and Sharp platform packages. Exact package lists are recorded in JSON.

A timing only counts when output validation passes. Input file reads, worker startup, warmups, and output validation are outside warm workflow timings. Startup measurements use a separate fresh process for each engine.

Timing comparisons include encoding. Lossy encoders do not share a calibrated quality scale, so output quality and compression efficiency cannot be compared solely because each API received `quality: 80`; that requires a separate matched-quality study.
