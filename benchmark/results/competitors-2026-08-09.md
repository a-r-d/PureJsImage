# Benchmark result

Created: 2026-08-09T19:16:12.206Z

Profile: `competitors`

Environment: Linux 6.17.0-41-generic, x64, Node v24.16.0, Intel(R) Core(TM) i7-10700 CPU @ 2.90GHz, 16 logical CPUs

## Engine versions

| Engine | Version | Implementation |
| --- | --- | --- |
| purejsimage | 0.7.0 (workspace) | pure-javascript |
| purejsimage-wasm | 0.7.0 (workspace WASM) | webassembly |
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
| purejsimage | heif-iphone-resize-jpeg | pass | - |
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
| purejsimage-wasm | heif-iphone-resize-jpeg | pass | - |
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

| Engine | Workflow | Median wall | p95 wall | Median CPU | Peak RSS | Peak RSS delta | Quality | Output |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| purejsimage | jpeg-resize-1200 | 824.4 ms | 828.6 ms | 921.4 ms | 143.1 MiB | 14.1 MiB | 30.02 dB | 0.3 MiB |
| purejsimage | png-resize-1000 | 533.0 ms | 534.4 ms | 769.5 ms | 169.6 MiB | 22.1 MiB | exact | 0.0 MiB |
| purejsimage | png-alpha-resize | 71.3 ms | 72.0 ms | 106.7 ms | 119.6 MiB | 2.9 MiB | 48.39 dB | 0.0 MiB |
| purejsimage | jpeg-to-png | 548.2 ms | 550.0 ms | 632.9 ms | 200.0 MiB | 51.6 MiB | 56.21 dB | 1.6 MiB |
| purejsimage | stress-100mp-downscale | 2374.5 ms | 2458.1 ms | 3189.9 ms | 186.9 MiB | 71.1 MiB | 57.84 dB | 0.0 MiB |
| purejsimage-wasm | jpeg-resize-1200 | 765.9 ms | 770.2 ms | 833.0 ms | 143.8 MiB | 12.6 MiB | 30.02 dB | 0.3 MiB |
| purejsimage-wasm | png-resize-1000 | 445.4 ms | 463.6 ms | 639.7 ms | 163.0 MiB | 5.1 MiB | exact | 0.0 MiB |
| purejsimage-wasm | png-alpha-resize | 63.6 ms | 64.4 ms | 99.6 ms | 123.4 MiB | 3.2 MiB | 48.39 dB | 0.0 MiB |
| purejsimage-wasm | jpeg-to-png | 256.5 ms | 258.9 ms | 286.3 ms | 193.6 MiB | 52.5 MiB | 56.21 dB | 1.6 MiB |
| purejsimage-wasm | stress-100mp-downscale | 1408.9 ms | 1415.2 ms | 2324.9 ms | 191.7 MiB | 75.5 MiB | 57.84 dB | 0.0 MiB |
| jimp | jpeg-resize-1200 | 1422.4 ms | 1504.8 ms | 1646.4 ms | 596.0 MiB | 174.9 MiB | 32.60 dB | 0.4 MiB |
| jimp | png-resize-1000 | 895.6 ms | 907.8 ms | 997.2 ms | 308.6 MiB | 147.2 MiB | 76.83 dB | 0.7 MiB |
| jimp | png-alpha-resize | 81.5 ms | 83.2 ms | 132.0 ms | 136.6 MiB | 9.8 MiB | 98.86 dB | 0.0 MiB |
| jimp | jpeg-to-png | 677.0 ms | 719.9 ms | 793.5 ms | 333.7 MiB | 119.1 MiB | exact | 2.0 MiB |
| jimp | stress-100mp-downscale | 4153.6 ms | 4367.1 ms | 4315.8 ms | 1280.1 MiB | 1164.6 MiB | exact | 0.3 MiB |
| sharp | jpeg-resize-1200 | 70.2 ms | 71.5 ms | 79.7 ms | 170.9 MiB | 27.9 MiB | 30.15 dB | 0.3 MiB |
| sharp | png-resize-1000 | 303.3 ms | 318.3 ms | 346.9 ms | 170.2 MiB | 41.9 MiB | 41.11 dB | 2.5 MiB |
| sharp | png-alpha-resize | 14.5 ms | 15.9 ms | 15.9 ms | 116.7 MiB | 9.2 MiB | 47.43 dB | 0.0 MiB |
| sharp | jpeg-to-png | 77.2 ms | 84.4 ms | 88.0 ms | 196.1 MiB | 81.5 MiB | 55.05 dB | 2.3 MiB |
| sharp | stress-100mp-downscale | 771.8 ms | 783.8 ms | 808.7 ms | 216.1 MiB | 100.2 MiB | 54.63 dB | 1.5 MiB |
| sharp-single-thread | jpeg-resize-1200 | 69.0 ms | 73.8 ms | 77.2 ms | 170.1 MiB | 26.9 MiB | 30.15 dB | 0.3 MiB |
| sharp-single-thread | png-resize-1000 | 269.4 ms | 293.6 ms | 313.7 ms | 170.5 MiB | 42.0 MiB | 41.11 dB | 2.5 MiB |
| sharp-single-thread | png-alpha-resize | 11.8 ms | 12.0 ms | 12.9 ms | 116.0 MiB | 9.2 MiB | 47.43 dB | 0.0 MiB |
| sharp-single-thread | jpeg-to-png | 63.5 ms | 64.6 ms | 72.4 ms | 195.9 MiB | 81.8 MiB | 55.05 dB | 2.3 MiB |
| sharp-single-thread | stress-100mp-downscale | 706.7 ms | 752.7 ms | 745.1 ms | 216.0 MiB | 100.5 MiB | 54.63 dB | 1.5 MiB |
| image-js | jpeg-resize-1200 | 1058.8 ms | 1086.8 ms | 1244.0 ms | 570.2 MiB | 112.5 MiB | 20.36 dB | 0.4 MiB |
| image-js | png-resize-1000 | 771.9 ms | 772.0 ms | 924.5 ms | 290.9 MiB | 143.8 MiB | 23.46 dB | 1.6 MiB |
| image-js | png-alpha-resize | 81.5 ms | 85.1 ms | 136.5 ms | 126.5 MiB | 16.4 MiB | 31.94 dB | 0.0 MiB |
| image-js | jpeg-to-png | 702.3 ms | 708.7 ms | 803.5 ms | 410.3 MiB | 193.6 MiB | exact | 2.4 MiB |
| image-js | stress-100mp-downscale | 1980.9 ms | 2194.4 ms | 2336.6 ms | 1272.8 MiB | 1148.4 MiB | 31.63 dB | 1.2 MiB |
| jsquash | jpeg-resize-1200 | 1129.3 ms | 1134.3 ms | 1149.0 ms | 608.3 MiB | 50.6 MiB | 28.65 dB | 0.3 MiB |
| jsquash | png-resize-1000 | 849.2 ms | 860.8 ms | 849.0 ms | 524.6 MiB | 49.3 MiB | 36.67 dB | 1.4 MiB |
| jsquash | png-alpha-resize | 65.6 ms | 70.1 ms | 72.7 ms | 131.6 MiB | 1.7 MiB | 47.73 dB | 0.2 MiB |
| jsquash | jpeg-to-png | 95.3 ms | 105.9 ms | 96.3 ms | 291.2 MiB | 91.3 MiB | 55.05 dB | 2.3 MiB |
| jsquash | stress-100mp-downscale | 7166.8 ms | 7175.5 ms | 7277.1 ms | 3003.6 MiB | 2877.9 MiB | 40.26 dB | 1.1 MiB |

## Startup and installed package footprint

| Engine | Import | RSS after import | First JPEG metadata | First JPEG resize | Installed footprint | Production packages |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| purejsimage | 55.5 ms | 93.9 MiB | 1.5 ms (pass) | 829.6 ms (pass) | 1.7 MiB | 1 |
| purejsimage-wasm | 57.5 ms | 93.8 MiB | 1.6 ms (pass) | 803.1 ms (pass) | 1.7 MiB | 1 |
| jimp | 63.9 ms | 93.0 MiB | 2672.8 ms (pass) | 1436.6 ms (pass) | 29.3 MiB | 70 |
| sharp | 27.2 ms | 93.3 MiB | 1.8 ms (pass) | 71.9 ms (pass) | 18.9 MiB | 6 |
| sharp-single-thread | 28.1 ms | 93.3 MiB | 1.8 ms (pass) | 70.9 ms (pass) | 18.9 MiB | 6 |
| image-js | 163.2 ms | 102.6 MiB | 2797.5 ms (pass) | 1066.5 ms (pass) | 17.0 MiB | 46 |
| jsquash | 10.4 ms | 83.6 MiB | - ms (unsupported) | 1463.8 ms (pass) | 1.9 MiB | 5 |

Installed footprint includes every package required by an engine and the production dependencies present for this platform, including jSquash codec/resize packages and Sharp platform packages. Exact package lists are recorded in JSON.

A timing only counts when output validation passes. Input file reads, worker startup, warmups, output validation, and quality measurement are outside warm workflow timings. Startup measurements use a separate fresh process for each engine.

Quality is premultiplied-RGBA PSNR against an independently decoded exact-area reference. `exact` means every compared channel matched. Resize timings use the engine-default kernels identified above, so cross-kernel rows are default-experience rather than matched-quality comparisons. Lossy encoder quality scales are not calibrated; the quality column makes that difference visible but does not by itself turn equal API quality settings into a matched-quality size study.
