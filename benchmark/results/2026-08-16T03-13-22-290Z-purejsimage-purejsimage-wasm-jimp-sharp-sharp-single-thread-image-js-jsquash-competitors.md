# Benchmark result

Created: 2026-08-16T03:13:22.290Z

Profile: `competitors`

Environment: Linux 6.17.0-41-generic, x64, Node v24.16.0, Intel(R) Core(TM) i7-10700 CPU @ 2.90GHz, 16 logical CPUs

## Engine versions

| Engine | Version | Implementation |
| --- | --- | --- |
| purejsimage | 0.10.0 (workspace) | pure-javascript |
| purejsimage-wasm | 0.10.0 (workspace WASM) | webassembly |
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
| purejsimage | jpeg-resize-1200 | 843.8 ms | 872.4 ms | 955.9 ms | 164.7 MiB | 14.2 MiB | 35.1 MiB | 15.0 MiB | - MiB | - MiB | 30.02 dB | 0.3 MiB |
| purejsimage | png-resize-1000 | 545.0 ms | 558.2 ms | 791.9 ms | 197.7 MiB | 7.1 MiB | 34.7 MiB | 25.3 MiB | - MiB | - MiB | exact | 0.0 MiB |
| purejsimage | png-alpha-resize | 73.5 ms | 74.0 ms | 111.0 ms | 141.4 MiB | 4.0 MiB | 15.7 MiB | 6.3 MiB | - MiB | - MiB | 48.39 dB | 0.0 MiB |
| purejsimage | jpeg-to-png | 557.4 ms | 567.0 ms | 649.2 ms | 241.1 MiB | 73.0 MiB | 97.4 MiB | 88.2 MiB | - MiB | - MiB | 56.21 dB | 1.6 MiB |
| purejsimage | stress-100mp-downscale | 2399.0 ms | 2530.5 ms | 3230.2 ms | 209.0 MiB | 72.4 MiB | 50.6 MiB | 41.1 MiB | - MiB | - MiB | 57.84 dB | 0.0 MiB |
| purejsimage-wasm | jpeg-resize-1200 | 764.2 ms | 792.1 ms | 844.2 ms | 171.2 MiB | 18.7 MiB | 36.4 MiB | 25.8 MiB | - MiB | - MiB | 30.02 dB | 0.3 MiB |
| purejsimage-wasm | png-resize-1000 | 450.5 ms | 455.8 ms | 629.5 ms | 198.9 MiB | 4.3 MiB | 38.4 MiB | 25.6 MiB | - MiB | - MiB | exact | 0.0 MiB |
| purejsimage-wasm | png-alpha-resize | 63.9 ms | 66.9 ms | 96.8 ms | 142.2 MiB | 1.2 MiB | 18.4 MiB | 6.2 MiB | - MiB | - MiB | 48.39 dB | 0.0 MiB |
| purejsimage-wasm | jpeg-to-png | 250.2 ms | 265.0 ms | 282.6 ms | 213.6 MiB | 52.2 MiB | 100.7 MiB | 88.2 MiB | - MiB | - MiB | 56.21 dB | 1.6 MiB |
| purejsimage-wasm | stress-100mp-downscale | 1363.3 ms | 1395.5 ms | 2241.0 ms | 211.4 MiB | 73.3 MiB | 57.1 MiB | 42.8 MiB | - MiB | - MiB | 57.84 dB | 0.0 MiB |
| jimp | jpeg-resize-1200 | 1428.4 ms | 1433.5 ms | 1646.5 ms | 595.8 MiB | 175.1 MiB | 51.4 MiB | 42.1 MiB | - MiB | - MiB | 32.60 dB | 0.4 MiB |
| jimp | png-resize-1000 | 919.4 ms | 923.5 ms | 1024.5 ms | 304.9 MiB | 143.8 MiB | 37.8 MiB | 28.5 MiB | - MiB | - MiB | 76.83 dB | 0.7 MiB |
| jimp | png-alpha-resize | 70.2 ms | 70.8 ms | 108.5 ms | 136.9 MiB | 7.8 MiB | 26.2 MiB | 16.9 MiB | - MiB | - MiB | 98.86 dB | 0.0 MiB |
| jimp | jpeg-to-png | 677.6 ms | 698.2 ms | 801.3 ms | 329.7 MiB | 129.5 MiB | 125.5 MiB | 116.2 MiB | - MiB | - MiB | exact | 2.0 MiB |
| jimp | stress-100mp-downscale | 3776.0 ms | 3820.9 ms | 3940.7 ms | 1277.1 MiB | 1164.9 MiB | 52.1 MiB | 37.5 MiB | - MiB | - MiB | exact | 0.3 MiB |
| sharp | jpeg-resize-1200 | 69.3 ms | 71.9 ms | 77.3 ms | 171.5 MiB | 28.2 MiB | 30.6 MiB | 14.0 MiB | - MiB | - MiB | 30.15 dB | 0.3 MiB |
| sharp | png-resize-1000 | 269.6 ms | 275.2 ms | 312.2 ms | 172.0 MiB | 42.1 MiB | 42.2 MiB | 27.9 MiB | - MiB | - MiB | 41.11 dB | 2.5 MiB |
| sharp | png-alpha-resize | 11.7 ms | 12.6 ms | 12.7 ms | 118.4 MiB | 9.2 MiB | 13.4 MiB | 4.0 MiB | - MiB | - MiB | 47.43 dB | 0.0 MiB |
| sharp | jpeg-to-png | 64.5 ms | 66.3 ms | 73.6 ms | 197.6 MiB | 82.0 MiB | 88.1 MiB | 74.1 MiB | - MiB | - MiB | 55.05 dB | 2.3 MiB |
| sharp | stress-100mp-downscale | 694.9 ms | 721.6 ms | 733.2 ms | 218.2 MiB | 100.4 MiB | 48.3 MiB | 37.4 MiB | - MiB | - MiB | 54.63 dB | 1.5 MiB |
| sharp-single-thread | jpeg-resize-1200 | 72.2 ms | 72.6 ms | 80.1 ms | 172.0 MiB | 28.0 MiB | 30.6 MiB | 14.0 MiB | - MiB | - MiB | 30.15 dB | 0.3 MiB |
| sharp-single-thread | png-resize-1000 | 270.0 ms | 279.8 ms | 314.8 ms | 172.6 MiB | 41.8 MiB | 42.2 MiB | 27.9 MiB | - MiB | - MiB | 41.11 dB | 2.5 MiB |
| sharp-single-thread | png-alpha-resize | 12.2 ms | 12.3 ms | 13.3 ms | 118.5 MiB | 9.0 MiB | 13.4 MiB | 4.0 MiB | - MiB | - MiB | 47.43 dB | 0.0 MiB |
| sharp-single-thread | jpeg-to-png | 62.4 ms | 65.3 ms | 71.2 ms | 198.4 MiB | 82.8 MiB | 92.7 MiB | 57.6 MiB | - MiB | - MiB | 55.05 dB | 2.3 MiB |
| sharp-single-thread | stress-100mp-downscale | 699.2 ms | 707.2 ms | 736.3 ms | 217.9 MiB | 100.4 MiB | 48.3 MiB | 37.4 MiB | - MiB | - MiB | 54.63 dB | 1.5 MiB |
| image-js | jpeg-resize-1200 | 1029.7 ms | 1059.1 ms | 1211.7 ms | 549.6 MiB | 121.3 MiB | 151.0 MiB | 141.6 MiB | - MiB | - MiB | 20.36 dB | 0.4 MiB |
| image-js | png-resize-1000 | 746.7 ms | 752.5 ms | 889.6 ms | 289.9 MiB | 142.2 MiB | 55.0 MiB | 45.7 MiB | - MiB | - MiB | 23.46 dB | 1.6 MiB |
| image-js | png-alpha-resize | 87.8 ms | 88.8 ms | 151.8 ms | 127.3 MiB | 17.6 MiB | 26.1 MiB | 16.8 MiB | - MiB | - MiB | 31.94 dB | 0.0 MiB |
| image-js | jpeg-to-png | 694.1 ms | 697.1 ms | 797.6 ms | 409.7 MiB | 193.6 MiB | 195.6 MiB | 184.0 MiB | - MiB | - MiB | exact | 2.4 MiB |
| image-js | stress-100mp-downscale | 1837.8 ms | 1864.5 ms | 2140.1 ms | 1273.1 MiB | 1145.7 MiB | 64.2 MiB | 54.8 MiB | - MiB | - MiB | 31.63 dB | 1.2 MiB |
| jsquash | jpeg-resize-1200 | 1102.7 ms | 1117.2 ms | 1115.2 ms | 605.9 MiB | 46.6 MiB | 468.3 MiB | 73.6 MiB | - MiB | - MiB | 28.65 dB | 0.3 MiB |
| jsquash | png-resize-1000 | 825.2 ms | 834.4 ms | 825.5 ms | 525.4 MiB | 54.7 MiB | 395.2 MiB | 38.0 MiB | - MiB | - MiB | 36.67 dB | 1.4 MiB |
| jsquash | png-alpha-resize | 63.6 ms | 64.2 ms | 70.1 ms | 131.3 MiB | 0.9 MiB | 46.2 MiB | 8.9 MiB | - MiB | - MiB | 47.73 dB | 0.2 MiB |
| jsquash | jpeg-to-png | 90.4 ms | 91.9 ms | 91.5 ms | 292.6 MiB | 91.1 MiB | 211.2 MiB | 95.5 MiB | - MiB | - MiB | 55.05 dB | 2.3 MiB |
| jsquash | stress-100mp-downscale | 7026.8 ms | 7287.8 ms | 7154.6 ms | 3010.4 MiB | 2884.0 MiB | 2936.4 MiB | 49.2 MiB | - MiB | - MiB | 40.26 dB | 1.1 MiB |

## Startup and npm package size

| Engine | Import | RSS after import | First JPEG metadata | First JPEG resize | npm package (unpacked) | Production packages |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| purejsimage | 75.7 ms | 103.9 MiB | 1.7 ms (pass) | 854.8 ms (pass) | 4.8 MiB | 1 |
| purejsimage-wasm | 80.0 ms | 110.1 MiB | 1.7 ms (pass) | 796.8 ms (pass) | 4.8 MiB | 1 |
| jimp | 63.3 ms | 94.1 MiB | 2580.1 ms (pass) | 1416.7 ms (pass) | 29.3 MiB | 70 |
| sharp | 26.6 ms | 94.8 MiB | 1.7 ms (pass) | 68.0 ms (pass) | 18.9 MiB | 6 |
| sharp-single-thread | 27.6 ms | 95.0 MiB | 1.8 ms (pass) | 67.2 ms (pass) | 18.9 MiB | 6 |
| image-js | 155.1 ms | 103.9 MiB | 2560.7 ms (pass) | 1054.6 ms (pass) | 17.0 MiB | 46 |
| jsquash | 9.7 ms | 85.7 MiB | - ms (unsupported) | 1436.1 ms (pass) | 1.9 MiB | 5 |

The `npm package (unpacked)` value is the byte size after npm extracts what it publishes, not the compressed `.tgz` download size. It includes every package required by an engine and the production dependencies present for this platform, including jSquash codec/resize packages and Sharp platform packages. Exact package lists are recorded in JSON; run `npm pack --dry-run --json` for tarball size.

A timing only counts when output validation passes. Input file reads, worker startup, warmups, output validation, and quality measurement are outside warm workflow timings. Startup measurements use a separate fresh process for each engine.

Quality is premultiplied-RGBA PSNR against an independently decoded exact-area reference. `exact` means every compared channel matched. Resize timings use the engine-default kernels identified above, so cross-kernel rows are default-experience rather than matched-quality comparisons. Lossy encoder quality scales are not calibrated; the quality column makes that difference visible but does not by itself turn equal API quality settings into a matched-quality size study.
