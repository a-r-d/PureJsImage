# Benchmark result

Created: 2026-08-09T01:34:09.393Z

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
| purejsimage | jpeg-resize-1200 | 770.1 ms | 777.3 ms | 862.0 ms | 151.8 MiB | 19.6 MiB | 0.3 MiB |
| purejsimage | png-resize-1000 | 500.9 ms | 517.1 ms | 744.9 ms | 167.1 MiB | 11.0 MiB | 0.1 MiB |
| purejsimage | png-alpha-resize | 48.3 ms | 48.6 ms | 87.4 ms | 118.1 MiB | 4.8 MiB | 0.0 MiB |
| purejsimage | jpeg-to-png | 544.3 ms | 547.1 ms | 635.1 ms | 201.7 MiB | 55.3 MiB | 1.6 MiB |
| purejsimage | stress-100mp-downscale | 1963.3 ms | 2017.2 ms | 2712.4 ms | 185.8 MiB | 74.6 MiB | 0.0 MiB |
| jimp | jpeg-resize-1200 | 1414.1 ms | 1460.6 ms | 1633.2 ms | 596.7 MiB | 174.8 MiB | 0.4 MiB |
| jimp | png-resize-1000 | 893.2 ms | 954.9 ms | 981.7 ms | 303.8 MiB | 144.0 MiB | 0.7 MiB |
| jimp | png-alpha-resize | 76.6 ms | 83.6 ms | 124.2 ms | 131.5 MiB | 3.4 MiB | 0.0 MiB |
| jimp | jpeg-to-png | 660.4 ms | 664.5 ms | 777.1 ms | 328.0 MiB | 128.0 MiB | 2.0 MiB |
| jimp | stress-100mp-downscale | 3815.7 ms | 3830.4 ms | 3965.1 ms | 1277.0 MiB | 1162.8 MiB | 0.3 MiB |
| sharp | jpeg-resize-1200 | 68.7 ms | 69.7 ms | 76.9 ms | 170.7 MiB | 27.4 MiB | 0.3 MiB |
| sharp | png-resize-1000 | 266.1 ms | 274.8 ms | 313.1 ms | 167.7 MiB | 39.3 MiB | 2.5 MiB |
| sharp | png-alpha-resize | 11.9 ms | 12.2 ms | 13.0 ms | 116.4 MiB | 9.0 MiB | 0.0 MiB |
| sharp | jpeg-to-png | 62.0 ms | 64.4 ms | 70.7 ms | 196.1 MiB | 81.3 MiB | 2.3 MiB |
| sharp | stress-100mp-downscale | 687.2 ms | 715.9 ms | 718.8 ms | 215.8 MiB | 100.2 MiB | 1.5 MiB |
| sharp-single-thread | jpeg-resize-1200 | 75.5 ms | 84.8 ms | 84.0 ms | 169.7 MiB | 26.2 MiB | 0.3 MiB |
| sharp-single-thread | png-resize-1000 | 279.2 ms | 284.6 ms | 322.3 ms | 169.6 MiB | 41.9 MiB | 2.5 MiB |
| sharp-single-thread | png-alpha-resize | 11.9 ms | 11.9 ms | 12.9 ms | 116.4 MiB | 9.1 MiB | 0.0 MiB |
| sharp-single-thread | jpeg-to-png | 65.6 ms | 66.0 ms | 74.5 ms | 195.7 MiB | 81.5 MiB | 2.3 MiB |
| sharp-single-thread | stress-100mp-downscale | 686.2 ms | 700.1 ms | 720.7 ms | 216.1 MiB | 100.8 MiB | 1.5 MiB |
| image-js | jpeg-resize-1200 | 1033.8 ms | 1105.6 ms | 1200.4 ms | 571.0 MiB | 112.7 MiB | 0.4 MiB |
| image-js | png-resize-1000 | 726.0 ms | 731.7 ms | 861.1 ms | 292.4 MiB | 144.6 MiB | 1.6 MiB |
| image-js | png-alpha-resize | 80.7 ms | 85.2 ms | 134.0 ms | 126.2 MiB | 17.0 MiB | 0.0 MiB |
| image-js | jpeg-to-png | 692.2 ms | 697.3 ms | 797.2 ms | 407.2 MiB | 193.0 MiB | 2.4 MiB |
| image-js | stress-100mp-downscale | 1913.7 ms | 2015.3 ms | 2188.1 ms | 1271.2 MiB | 1147.8 MiB | 1.2 MiB |
| jsquash | jpeg-resize-1200 | 1127.7 ms | 1157.1 ms | 1136.7 ms | 606.2 MiB | 46.7 MiB | 0.3 MiB |
| jsquash | png-resize-1000 | 841.5 ms | 842.5 ms | 842.0 ms | 524.6 MiB | 56.4 MiB | 1.4 MiB |
| jsquash | png-alpha-resize | 63.9 ms | 64.3 ms | 70.0 ms | 129.4 MiB | 1.0 MiB | 0.2 MiB |
| jsquash | jpeg-to-png | 90.7 ms | 90.7 ms | 91.4 ms | 290.2 MiB | 91.0 MiB | 2.3 MiB |
| jsquash | stress-100mp-downscale | 7079.7 ms | 7082.4 ms | 7205.2 ms | 3008.7 MiB | 2887.5 MiB | 1.1 MiB |

## Startup and installed package footprint

| Engine | Import | RSS after import | First JPEG metadata | First JPEG resize | Installed footprint | Production packages |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| purejsimage | 49.3 ms | 92.4 MiB | 1.5 ms (pass) | 776.3 ms (pass) | 3.1 MiB | 1 |
| jimp | 63.6 ms | 93.3 MiB | 2574.4 ms (pass) | 1394.8 ms (pass) | 29.3 MiB | 70 |
| sharp | 28.8 ms | 93.8 MiB | 1.9 ms (pass) | 67.4 ms (pass) | 18.9 MiB | 6 |
| sharp-single-thread | 27.7 ms | 94.1 MiB | 1.9 ms (pass) | 67.3 ms (pass) | 18.9 MiB | 6 |
| image-js | 162.2 ms | 102.0 MiB | 2571.3 ms (pass) | 995.3 ms (pass) | 17.0 MiB | 46 |
| jsquash | 10.7 ms | 84.7 MiB | - ms (unsupported) | 1439.3 ms (pass) | 1.9 MiB | 5 |

Installed footprint includes every package required by an engine and the production dependencies present for this platform, including jSquash codec/resize packages and Sharp platform packages. Exact package lists are recorded in JSON.

A timing only counts when output validation passes. Input file reads, worker startup, warmups, and output validation are outside warm workflow timings. Startup measurements use a separate fresh process for each engine.

Timing comparisons include encoding. Lossy encoders do not share a calibrated quality scale, so output quality and compression efficiency cannot be compared solely because each API received `quality: 80`; that requires a separate matched-quality study.
