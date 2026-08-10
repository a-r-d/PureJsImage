# Benchmark result

Created: 2026-08-10T22:26:05.728Z

Profile: `competitors`

Environment: Linux 6.17.0-41-generic, x64, Node v24.16.0, Intel(R) Core(TM) i7-10700 CPU @ 2.90GHz, 16 logical CPUs

## Engine versions

| Engine | Version | Implementation |
| --- | --- | --- |
| purejsimage | 0.8.0 (workspace) | pure-javascript |
| purejsimage-wasm | 0.8.0 (workspace WASM) | webassembly |
| jimp | 1.6.0 | pure-javascript |
| sharp | 0.35.3 | native |
| sharp-single-thread | 0.35.3 | native-single-thread |
| image-js | 1.7.0 | pure-javascript |
| jsquash | jpeg 1.6.0; png 3.1.1; webp 1.5.0; resize 2.1.1 | webassembly |

Resize workflows use each engine’s public default kernel. PureJsImage and Sharp use Lanczos 3; Jimp uses bilinear. Cross-kernel timings are default-experience comparisons, not matched-quality comparisons.

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
| purejsimage | heif-iphone-resize-jpeg | unsupported | The default PureJsImage codecs do not include experimental HEIF/HEIC |
| purejsimage | bmp-large-resize-jpeg | pass | - |
| purejsimage | tiff-large-resize-jpeg | pass | - |
| purejsimage | webp-large-resize-jpeg | pass | - |
| purejsimage | stress-100mp-downscale | pass | - |
| purejsimage-wasm | metadata-jpeg-large | pass | - |
| purejsimage-wasm | jpeg-resize-1200 | pass | - |
| purejsimage-wasm | northstar-photo-pipeline | pass | - |
| purejsimage-wasm | jpeg-crop-resize | pass | - |
| purejsimage-wasm | png-resize-1000 | pass | - |
| purejsimage-wasm | png-alpha-resize | pass | - |
| purejsimage-wasm | jpeg-to-png | pass | - |
| purejsimage-wasm | png-to-jpeg | pass | - |
| purejsimage-wasm | auto-orient-6 | pass | - |
| purejsimage-wasm | heif-iphone-resize-jpeg | unsupported | The default PureJsImage codecs do not include experimental HEIF/HEIC |
| purejsimage-wasm | bmp-large-resize-jpeg | pass | - |
| purejsimage-wasm | tiff-large-resize-jpeg | pass | - |
| purejsimage-wasm | webp-large-resize-jpeg | pass | - |
| purejsimage-wasm | stress-100mp-downscale | pass | - |
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

## Performance on workflows supported by every selected engine

| Engine | Workflow | Median wall | p95 wall | Median CPU | Peak RSS | Peak RSS delta | External | ArrayBuffer | Source read | Max decoded block | Quality | Output |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| purejsimage | jpeg-resize-1200 | 835.6 ms | 894.2 ms | 937.5 ms | 144.6 MiB | 16.3 MiB | 24.3 MiB | 15.0 MiB | - MiB | - MiB | 30.02 dB | 0.3 MiB |
| purejsimage | png-resize-1000 | 529.3 ms | 532.6 ms | 780.5 ms | 158.8 MiB | 13.4 MiB | 34.7 MiB | 25.2 MiB | - MiB | - MiB | exact | 0.0 MiB |
| purejsimage | png-alpha-resize | 72.4 ms | 73.3 ms | 110.0 ms | 119.4 MiB | 2.7 MiB | 15.7 MiB | 6.2 MiB | - MiB | - MiB | 48.39 dB | 0.0 MiB |
| purejsimage | jpeg-to-png | 563.2 ms | 593.8 ms | 659.4 ms | 210.7 MiB | 72.4 MiB | 94.0 MiB | 84.7 MiB | - MiB | - MiB | 56.21 dB | 1.6 MiB |
| purejsimage | stress-100mp-downscale | 2355.0 ms | 2449.2 ms | 3184.3 ms | 187.6 MiB | 70.4 MiB | 50.6 MiB | 41.1 MiB | - MiB | - MiB | 57.84 dB | 0.0 MiB |
| purejsimage-wasm | jpeg-resize-1200 | 764.8 ms | 793.4 ms | 830.6 ms | 145.9 MiB | 14.3 MiB | 25.6 MiB | 15.0 MiB | - MiB | - MiB | 30.02 dB | 0.3 MiB |
| purejsimage-wasm | png-resize-1000 | 468.0 ms | 482.1 ms | 661.4 ms | 182.4 MiB | 34.9 MiB | 38.4 MiB | 25.6 MiB | - MiB | - MiB | exact | 0.0 MiB |
| purejsimage-wasm | png-alpha-resize | 64.6 ms | 66.0 ms | 100.4 ms | 122.2 MiB | 3.3 MiB | 18.4 MiB | 6.2 MiB | - MiB | - MiB | 48.39 dB | 0.0 MiB |
| purejsimage-wasm | jpeg-to-png | 264.7 ms | 275.4 ms | 296.7 ms | 192.7 MiB | 52.8 MiB | 100.7 MiB | 88.2 MiB | - MiB | - MiB | 56.21 dB | 1.6 MiB |
| purejsimage-wasm | stress-100mp-downscale | 1438.5 ms | 1453.6 ms | 2346.9 ms | 189.4 MiB | 72.3 MiB | 57.2 MiB | 42.9 MiB | - MiB | - MiB | 57.84 dB | 0.0 MiB |
| jimp | jpeg-resize-1200 | 1436.0 ms | 1472.6 ms | 1653.6 ms | 597.6 MiB | 175.9 MiB | 51.4 MiB | 42.1 MiB | - MiB | - MiB | 32.60 dB | 0.4 MiB |
| jimp | png-resize-1000 | 897.7 ms | 904.1 ms | 1003.1 ms | 303.4 MiB | 141.6 MiB | 37.8 MiB | 28.5 MiB | - MiB | - MiB | 76.83 dB | 0.7 MiB |
| jimp | png-alpha-resize | 74.4 ms | 84.1 ms | 129.4 ms | 132.9 MiB | 6.8 MiB | 26.2 MiB | 16.9 MiB | - MiB | - MiB | 98.86 dB | 0.0 MiB |
| jimp | jpeg-to-png | 688.8 ms | 689.9 ms | 762.4 ms | 335.0 MiB | 140.8 MiB | 149.5 MiB | 116.2 MiB | - MiB | - MiB | exact | 2.0 MiB |
| jimp | stress-100mp-downscale | 4065.9 ms | 4216.3 ms | 4245.8 ms | 1277.6 MiB | 1164.7 MiB | 52.1 MiB | 42.8 MiB | - MiB | - MiB | exact | 0.3 MiB |
| sharp | jpeg-resize-1200 | 68.6 ms | 78.3 ms | 77.1 ms | 170.6 MiB | 27.7 MiB | 30.6 MiB | 20.6 MiB | - MiB | - MiB | 30.15 dB | 0.3 MiB |
| sharp | png-resize-1000 | 279.2 ms | 286.3 ms | 333.9 ms | 171.9 MiB | 42.0 MiB | 42.2 MiB | 27.9 MiB | - MiB | - MiB | 41.11 dB | 2.5 MiB |
| sharp | png-alpha-resize | 12.2 ms | 18.4 ms | 13.4 ms | 117.4 MiB | 9.3 MiB | 13.4 MiB | 4.0 MiB | - MiB | - MiB | 47.43 dB | 0.0 MiB |
| sharp | jpeg-to-png | 68.3 ms | 78.8 ms | 77.5 ms | 197.0 MiB | 81.5 MiB | 92.7 MiB | 57.6 MiB | - MiB | - MiB | 55.05 dB | 2.3 MiB |
| sharp | stress-100mp-downscale | 732.9 ms | 748.4 ms | 768.1 ms | 217.5 MiB | 100.4 MiB | 48.3 MiB | 37.4 MiB | - MiB | - MiB | 54.63 dB | 1.5 MiB |
| sharp-single-thread | jpeg-resize-1200 | 69.9 ms | 83.0 ms | 77.9 ms | 170.7 MiB | 27.3 MiB | 30.6 MiB | 20.6 MiB | - MiB | - MiB | 30.15 dB | 0.3 MiB |
| sharp-single-thread | png-resize-1000 | 270.0 ms | 279.3 ms | 312.9 ms | 171.4 MiB | 41.8 MiB | 42.2 MiB | 27.9 MiB | - MiB | - MiB | 41.11 dB | 2.5 MiB |
| sharp-single-thread | png-alpha-resize | 11.8 ms | 13.4 ms | 13.1 ms | 117.3 MiB | 9.0 MiB | 13.4 MiB | 4.0 MiB | - MiB | - MiB | 47.43 dB | 0.0 MiB |
| sharp-single-thread | jpeg-to-png | 63.8 ms | 68.0 ms | 73.0 ms | 197.1 MiB | 81.3 MiB | 92.7 MiB | 55.3 MiB | - MiB | - MiB | 55.05 dB | 2.3 MiB |
| sharp-single-thread | stress-100mp-downscale | 704.1 ms | 712.3 ms | 740.1 ms | 215.9 MiB | 102.2 MiB | 48.3 MiB | 37.4 MiB | - MiB | - MiB | 54.63 dB | 1.5 MiB |
| image-js | jpeg-resize-1200 | 1046.4 ms | 1130.3 ms | 1235.2 ms | 572.1 MiB | 114.6 MiB | 151.0 MiB | 141.6 MiB | - MiB | - MiB | 20.36 dB | 0.4 MiB |
| image-js | png-resize-1000 | 745.9 ms | 759.1 ms | 905.4 ms | 291.8 MiB | 143.1 MiB | 55.0 MiB | 45.7 MiB | - MiB | - MiB | 23.46 dB | 1.6 MiB |
| image-js | png-alpha-resize | 84.7 ms | 92.7 ms | 146.6 ms | 129.1 MiB | 16.2 MiB | 26.1 MiB | 16.8 MiB | - MiB | - MiB | 31.94 dB | 0.0 MiB |
| image-js | jpeg-to-png | 685.5 ms | 717.2 ms | 796.5 ms | 410.0 MiB | 193.5 MiB | 195.6 MiB | 78.7 MiB | - MiB | - MiB | exact | 2.4 MiB |
| image-js | stress-100mp-downscale | 1927.0 ms | 1953.2 ms | 2265.6 ms | 1273.7 MiB | 1151.5 MiB | 64.2 MiB | 54.8 MiB | - MiB | - MiB | 31.63 dB | 1.2 MiB |
| jsquash | jpeg-resize-1200 | 1114.1 ms | 1146.0 ms | 1127.3 ms | 605.2 MiB | 46.8 MiB | 468.3 MiB | 73.6 MiB | - MiB | - MiB | 28.65 dB | 0.3 MiB |
| jsquash | png-resize-1000 | 845.9 ms | 866.8 ms | 845.8 ms | 524.5 MiB | 56.4 MiB | 395.2 MiB | 38.0 MiB | - MiB | - MiB | 36.67 dB | 1.4 MiB |
| jsquash | png-alpha-resize | 64.0 ms | 64.9 ms | 70.2 ms | 129.2 MiB | 3.2 MiB | 46.2 MiB | 8.9 MiB | - MiB | - MiB | 47.73 dB | 0.2 MiB |
| jsquash | jpeg-to-png | 91.7 ms | 93.9 ms | 92.5 ms | 290.2 MiB | 91.4 MiB | 211.2 MiB | 95.5 MiB | - MiB | - MiB | 55.05 dB | 2.3 MiB |
| jsquash | stress-100mp-downscale | 7107.8 ms | 7113.2 ms | 7207.3 ms | 3003.9 MiB | 2881.2 MiB | 2545.0 MiB | 53.0 MiB | - MiB | - MiB | 40.26 dB | 1.1 MiB |

## Startup and installed package footprint

| Engine | Import | RSS after import | First JPEG metadata | First JPEG resize | Installed footprint | Production packages |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| purejsimage | 53.5 ms | 94.6 MiB | 1.5 ms (pass) | 849.6 ms (pass) | 2.3 MiB | 1 |
| purejsimage-wasm | 56.2 ms | 94.8 MiB | 1.4 ms (pass) | 786.7 ms (pass) | 2.3 MiB | 1 |
| jimp | 62.2 ms | 93.7 MiB | 2611.2 ms (pass) | 1396.9 ms (pass) | 29.3 MiB | 70 |
| sharp | 26.8 ms | 94.2 MiB | 1.7 ms (pass) | 66.5 ms (pass) | 18.9 MiB | 6 |
| sharp-single-thread | 26.4 ms | 94.1 MiB | 2.2 ms (pass) | 67.0 ms (pass) | 18.9 MiB | 6 |
| image-js | 160.7 ms | 102.2 MiB | 2516.4 ms (pass) | 1080.8 ms (pass) | 17.0 MiB | 46 |
| jsquash | 10.4 ms | 84.2 MiB | - ms (unsupported) | 1473.8 ms (pass) | 1.9 MiB | 5 |

Installed footprint includes every package required by an engine and the production dependencies present for this platform, including jSquash codec/resize packages and Sharp platform packages. Exact package lists are recorded in JSON.

A timing only counts when output validation passes. Input file reads, worker startup, warmups, output validation, and quality measurement are outside warm workflow timings. Startup measurements use a separate fresh process for each engine.

Quality is premultiplied-RGBA PSNR against an independently decoded exact-area reference. `exact` means every compared channel matched. Resize timings use the engine-default kernels identified above, so cross-kernel rows are default-experience rather than matched-quality comparisons. Lossy encoder quality scales are not calibrated; the quality column makes that difference visible but does not by itself turn equal API quality settings into a matched-quality size study.
