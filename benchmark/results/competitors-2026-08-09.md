# Benchmark result

Created: 2026-08-09T05:42:11.108Z

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
| purejsimage | jpeg-resize-1200 | 836.6 ms | 839.8 ms | 937.0 ms | 144.0 MiB | 13.6 MiB | 30.02 dB | 0.3 MiB |
| purejsimage | png-resize-1000 | 523.4 ms | 540.9 ms | 790.9 ms | 154.3 MiB | 4.7 MiB | exact | 0.0 MiB |
| purejsimage | png-alpha-resize | 72.1 ms | 72.3 ms | 109.6 ms | 120.1 MiB | 2.8 MiB | 48.39 dB | 0.0 MiB |
| purejsimage | jpeg-to-png | 567.7 ms | 590.8 ms | 658.6 ms | 219.2 MiB | 54.9 MiB | 56.21 dB | 1.6 MiB |
| purejsimage | stress-100mp-downscale | 2353.0 ms | 2462.6 ms | 3115.8 ms | 186.6 MiB | 73.4 MiB | 57.84 dB | 0.0 MiB |
| jimp | jpeg-resize-1200 | 1445.2 ms | 1454.1 ms | 1672.1 ms | 597.1 MiB | 173.6 MiB | 32.60 dB | 0.4 MiB |
| jimp | png-resize-1000 | 896.2 ms | 910.7 ms | 1001.0 ms | 308.0 MiB | 147.1 MiB | 76.83 dB | 0.7 MiB |
| jimp | png-alpha-resize | 68.8 ms | 80.6 ms | 118.2 ms | 133.0 MiB | 7.1 MiB | 98.86 dB | 0.0 MiB |
| jimp | jpeg-to-png | 688.4 ms | 744.8 ms | 761.7 ms | 356.1 MiB | 141.1 MiB | exact | 2.0 MiB |
| jimp | stress-100mp-downscale | 3820.7 ms | 3882.2 ms | 3957.8 ms | 1277.3 MiB | 1164.7 MiB | exact | 0.3 MiB |
| sharp | jpeg-resize-1200 | 69.8 ms | 74.7 ms | 78.1 ms | 170.1 MiB | 27.5 MiB | 30.15 dB | 0.3 MiB |
| sharp | png-resize-1000 | 264.3 ms | 265.5 ms | 307.6 ms | 170.3 MiB | 42.1 MiB | 41.11 dB | 2.5 MiB |
| sharp | png-alpha-resize | 11.5 ms | 11.8 ms | 12.6 ms | 116.3 MiB | 9.2 MiB | 47.43 dB | 0.0 MiB |
| sharp | jpeg-to-png | 62.0 ms | 67.1 ms | 70.6 ms | 195.3 MiB | 69.7 MiB | 55.05 dB | 2.3 MiB |
| sharp | stress-100mp-downscale | 691.4 ms | 711.8 ms | 725.6 ms | 214.6 MiB | 100.4 MiB | 54.63 dB | 1.5 MiB |
| sharp-single-thread | jpeg-resize-1200 | 71.0 ms | 72.7 ms | 78.9 ms | 170.4 MiB | 27.4 MiB | 30.15 dB | 0.3 MiB |
| sharp-single-thread | png-resize-1000 | 265.5 ms | 267.3 ms | 309.4 ms | 170.5 MiB | 42.0 MiB | 41.11 dB | 2.5 MiB |
| sharp-single-thread | png-alpha-resize | 11.8 ms | 11.9 ms | 12.9 ms | 116.2 MiB | 8.9 MiB | 47.43 dB | 0.0 MiB |
| sharp-single-thread | jpeg-to-png | 62.8 ms | 63.0 ms | 71.4 ms | 195.6 MiB | 81.2 MiB | 55.05 dB | 2.3 MiB |
| sharp-single-thread | stress-100mp-downscale | 672.8 ms | 694.5 ms | 708.5 ms | 215.3 MiB | 102.1 MiB | 54.63 dB | 1.5 MiB |
| image-js | jpeg-resize-1200 | 1034.9 ms | 1044.3 ms | 1218.0 ms | 571.7 MiB | 113.5 MiB | 20.36 dB | 0.4 MiB |
| image-js | png-resize-1000 | 829.8 ms | 838.7 ms | 987.4 ms | 292.9 MiB | 144.3 MiB | 23.46 dB | 1.6 MiB |
| image-js | png-alpha-resize | 83.1 ms | 100.3 ms | 143.3 ms | 128.6 MiB | 18.0 MiB | 31.94 dB | 0.0 MiB |
| image-js | jpeg-to-png | 699.9 ms | 707.1 ms | 802.2 ms | 409.4 MiB | 193.3 MiB | exact | 2.4 MiB |
| image-js | stress-100mp-downscale | 1902.3 ms | 1964.8 ms | 2207.1 ms | 1270.7 MiB | 1147.2 MiB | 31.63 dB | 1.2 MiB |
| jsquash | jpeg-resize-1200 | 1142.4 ms | 1176.1 ms | 1157.1 ms | 608.7 MiB | 50.7 MiB | 28.65 dB | 0.3 MiB |
| jsquash | png-resize-1000 | 854.9 ms | 864.4 ms | 855.2 ms | 524.8 MiB | 56.5 MiB | 36.67 dB | 1.4 MiB |
| jsquash | png-alpha-resize | 65.7 ms | 75.7 ms | 72.2 ms | 129.1 MiB | 1.1 MiB | 47.73 dB | 0.2 MiB |
| jsquash | jpeg-to-png | 95.8 ms | 106.6 ms | 97.3 ms | 291.2 MiB | 91.1 MiB | 55.05 dB | 2.3 MiB |
| jsquash | stress-100mp-downscale | 6935.3 ms | 7012.5 ms | 7050.1 ms | 3009.3 MiB | 2884.1 MiB | 40.26 dB | 1.1 MiB |

## Startup and installed package footprint

| Engine | Import | RSS after import | First JPEG metadata | First JPEG resize | Installed footprint | Production packages |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| purejsimage | 48.0 ms | 94.0 MiB | 1.6 ms (pass) | 829.2 ms (pass) | 1.6 MiB | 1 |
| jimp | 61.9 ms | 93.1 MiB | 2556.7 ms (pass) | 1367.0 ms (pass) | 29.3 MiB | 70 |
| sharp | 35.9 ms | 93.5 MiB | 1.8 ms (pass) | 67.3 ms (pass) | 18.9 MiB | 6 |
| sharp-single-thread | 26.8 ms | 93.4 MiB | 1.7 ms (pass) | 67.2 ms (pass) | 18.9 MiB | 6 |
| image-js | 159.2 ms | 101.6 MiB | 2686.6 ms (pass) | 1045.0 ms (pass) | 17.0 MiB | 46 |
| jsquash | 13.5 ms | 83.9 MiB | - ms (unsupported) | 1434.8 ms (pass) | 1.9 MiB | 5 |

Installed footprint includes every package required by an engine and the production dependencies present for this platform, including jSquash codec/resize packages and Sharp platform packages. Exact package lists are recorded in JSON.

A timing only counts when output validation passes. Input file reads, worker startup, warmups, output validation, and quality measurement are outside warm workflow timings. Startup measurements use a separate fresh process for each engine.

Quality is premultiplied-RGBA PSNR against an independently decoded exact-area reference. `exact` means every compared channel matched. Resize timings use the engine-default kernels identified above, so cross-kernel rows are default-experience rather than matched-quality comparisons. Lossy encoder quality scales are not calibrated; the quality column makes that difference visible but does not by itself turn equal API quality settings into a matched-quality size study.
