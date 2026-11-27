# Benchmark result

Created: 2026-11-27T05:49:04.257Z

Profile: `competitors`

Environment: Linux 7.0.0-43-generic, x64, Node v24.16.0, Intel(R) Core(TM) i7-10700 CPU @ 2.90GHz, 16 logical CPUs

## Engine versions

| Engine | Version | Implementation |
| --- | --- | --- |
| purejsimage | 0.18.0 (workspace) | pure-javascript |
| purejsimage-wasm | 0.18.0 (workspace WASM) | webassembly |
| jimp | 1.7.0 | pure-javascript |
| sharp | 0.35.5 | native |
| sharp-single-thread | 0.35.5 | native-single-thread |
| image-js | 1.7.0 | pure-javascript |
| imagescript | 4.0.0 | pure-javascript |
| jsquash | avif 2.1.1; jpeg 1.6.0; png 3.1.1; webp 1.5.0; resize 2.1.1 | webassembly |

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
| jimp | heif-iphone-resize-jpeg | unsupported | Jimp 1.7.0 has no HEIC decoder |
| jimp | bmp-large-resize-jpeg | pass | - |
| jimp | tiff-large-resize-jpeg | pass | - |
| jimp | webp-large-resize-jpeg | unsupported | Jimp 1.7.0 has no WebP decoder |
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
| imagescript | metadata-jpeg-large | pass | - |
| imagescript | jpeg-resize-1200 | pass | - |
| imagescript | northstar-photo-pipeline | pass | - |
| imagescript | jpeg-crop-resize | pass | - |
| imagescript | png-resize-1000 | pass | - |
| imagescript | png-alpha-resize | pass | - |
| imagescript | jpeg-to-png | pass | - |
| imagescript | png-to-jpeg | pass | - |
| imagescript | auto-orient-6 | pass | - |
| imagescript | heif-iphone-resize-jpeg | unsupported | ImageScript 4.0.0 has no HEIC decoder |
| imagescript | bmp-large-resize-jpeg | pass | - |
| imagescript | tiff-large-resize-jpeg | pass | - |
| imagescript | webp-large-resize-jpeg | pass | - |
| imagescript | stress-100mp-downscale | pass | - |
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
| purejsimage | jpeg-resize-1200 | 452.8 ms | 454.4 ms | 553.4 ms | 107.8 MiB | 8.1 MiB | 18.2 MiB | 8.8 MiB | - MiB | - MiB | 30.02 dB | 0.3 MiB |
| purejsimage | png-resize-1000 | 251.8 ms | 256.0 ms | 369.9 ms | 139.6 MiB | 4.3 MiB | 44.0 MiB | 34.6 MiB | - MiB | - MiB | exact | 0.0 MiB |
| purejsimage | png-alpha-resize | 40.9 ms | 41.2 ms | 75.5 ms | 101.7 MiB | 6.2 MiB | 12.9 MiB | 3.5 MiB | - MiB | - MiB | 48.39 dB | 0.0 MiB |
| purejsimage | jpeg-to-png | 222.5 ms | 223.7 ms | 299.0 ms | 119.3 MiB | 6.2 MiB | 16.5 MiB | 7.1 MiB | - MiB | - MiB | 56.21 dB | 1.6 MiB |
| purejsimage | stress-100mp-downscale | 896.4 ms | 933.8 ms | 1286.6 ms | 200.5 MiB | 94.3 MiB | 30.1 MiB | 20.7 MiB | - MiB | - MiB | 57.84 dB | 0.0 MiB |
| purejsimage-wasm | jpeg-resize-1200 | 113.9 ms | 114.4 ms | 114.9 ms | 98.3 MiB | 3.7 MiB | 19.5 MiB | 8.6 MiB | - MiB | - MiB | 30.02 dB | 0.3 MiB |
| purejsimage-wasm | png-resize-1000 | 182.7 ms | 183.2 ms | 283.3 ms | 113.9 MiB | 3.6 MiB | 20.9 MiB | 10.5 MiB | - MiB | - MiB | exact | 0.0 MiB |
| purejsimage-wasm | png-alpha-resize | 10.9 ms | 11.1 ms | 17.6 ms | 92.4 MiB | 1.9 MiB | 12.2 MiB | 1.7 MiB | - MiB | - MiB | 48.39 dB | 0.0 MiB |
| purejsimage-wasm | jpeg-to-png | 127.7 ms | 136.6 ms | 165.9 ms | 111.6 MiB | 3.1 MiB | 18.1 MiB | 7.4 MiB | - MiB | - MiB | 56.21 dB | 1.6 MiB |
| purejsimage-wasm | stress-100mp-downscale | 628.7 ms | 645.7 ms | 1042.1 ms | 139.3 MiB | 33.5 MiB | 31.8 MiB | 21.1 MiB | - MiB | - MiB | 57.84 dB | 0.0 MiB |
| jimp | jpeg-resize-1200 | 1363.1 ms | 1372.8 ms | 1673.7 ms | 567.9 MiB | 270.4 MiB | 27.5 MiB | 17.8 MiB | - MiB | - MiB | 32.60 dB | 0.4 MiB |
| jimp | png-resize-1000 | 878.9 ms | 893.0 ms | 1000.2 ms | 300.0 MiB | 152.8 MiB | 124.9 MiB | 115.1 MiB | - MiB | - MiB | 76.83 dB | 0.7 MiB |
| jimp | png-alpha-resize | 72.2 ms | 73.1 ms | 115.0 ms | 117.5 MiB | 10.1 MiB | 21.9 MiB | 12.2 MiB | - MiB | - MiB | 98.86 dB | 0.0 MiB |
| jimp | jpeg-to-png | 659.3 ms | 671.1 ms | 760.4 ms | 258.3 MiB | 77.8 MiB | 109.0 MiB | 99.3 MiB | - MiB | - MiB | exact | 2.0 MiB |
| jimp | stress-100mp-downscale | 3817.3 ms | 3865.0 ms | 4014.3 ms | 1259.8 MiB | 1151.8 MiB | 578.3 MiB | 568.6 MiB | - MiB | - MiB | exact | 0.3 MiB |
| sharp | jpeg-resize-1200 | 69.2 ms | 75.6 ms | 77.2 ms | 130.8 MiB | 16.6 MiB | 14.8 MiB | 4.6 MiB | - MiB | - MiB | 30.15 dB | 0.3 MiB |
| sharp | png-resize-1000 | 259.1 ms | 260.0 ms | 302.2 ms | 166.5 MiB | 36.9 MiB | 23.5 MiB | 9.0 MiB | - MiB | - MiB | 41.11 dB | 2.5 MiB |
| sharp | png-alpha-resize | 11.9 ms | 13.0 ms | 12.8 ms | 110.4 MiB | 8.7 MiB | 9.6 MiB | 0.1 MiB | - MiB | - MiB | 47.43 dB | 0.0 MiB |
| sharp | jpeg-to-png | 62.1 ms | 62.8 ms | 70.5 ms | 115.9 MiB | 9.9 MiB | 14.5 MiB | 0.3 MiB | - MiB | - MiB | 55.05 dB | 2.3 MiB |
| sharp | stress-100mp-downscale | 643.9 ms | 662.4 ms | 679.6 ms | 193.9 MiB | 83.8 MiB | 28.8 MiB | 17.7 MiB | - MiB | - MiB | 54.63 dB | 1.5 MiB |
| sharp-single-thread | jpeg-resize-1200 | 68.1 ms | 92.0 ms | 76.5 ms | 130.7 MiB | 16.4 MiB | 14.8 MiB | 4.6 MiB | - MiB | - MiB | 30.15 dB | 0.3 MiB |
| sharp-single-thread | png-resize-1000 | 260.7 ms | 261.3 ms | 303.3 ms | 166.6 MiB | 36.9 MiB | 23.5 MiB | 9.0 MiB | - MiB | - MiB | 41.11 dB | 2.5 MiB |
| sharp-single-thread | png-alpha-resize | 11.8 ms | 12.8 ms | 12.8 ms | 110.5 MiB | 8.8 MiB | 9.6 MiB | 0.1 MiB | - MiB | - MiB | 47.43 dB | 0.0 MiB |
| sharp-single-thread | jpeg-to-png | 61.0 ms | 62.9 ms | 69.5 ms | 112.9 MiB | 9.8 MiB | 14.5 MiB | 0.3 MiB | - MiB | - MiB | 55.05 dB | 2.3 MiB |
| sharp-single-thread | stress-100mp-downscale | 644.5 ms | 645.3 ms | 679.9 ms | 192.3 MiB | 83.5 MiB | 28.8 MiB | 17.7 MiB | - MiB | - MiB | 54.63 dB | 1.5 MiB |
| image-js | jpeg-resize-1200 | 1070.1 ms | 1078.4 ms | 1363.5 ms | 561.3 MiB | 259.7 MiB | 126.7 MiB | 117.2 MiB | - MiB | - MiB | 20.36 dB | 0.4 MiB |
| image-js | png-resize-1000 | 729.7 ms | 736.4 ms | 867.1 ms | 282.6 MiB | 161.4 MiB | 35.7 MiB | 26.2 MiB | - MiB | - MiB | 23.46 dB | 1.6 MiB |
| image-js | png-alpha-resize | 82.9 ms | 84.4 ms | 140.7 ms | 119.8 MiB | 10.0 MiB | 22.4 MiB | 12.8 MiB | - MiB | - MiB | 31.94 dB | 0.0 MiB |
| image-js | jpeg-to-png | 690.0 ms | 697.4 ms | 842.4 ms | 296.6 MiB | 125.8 MiB | 111.9 MiB | 102.4 MiB | - MiB | - MiB | exact | 2.4 MiB |
| image-js | stress-100mp-downscale | 1987.3 ms | 2007.9 ms | 2245.0 ms | 1268.3 MiB | 1155.6 MiB | 45.3 MiB | 35.8 MiB | - MiB | - MiB | 31.63 dB | 1.2 MiB |
| imagescript | jpeg-resize-1200 | 529.1 ms | 543.2 ms | 621.3 ms | 201.2 MiB | 100.6 MiB | 98.3 MiB | 88.6 MiB | - MiB | - MiB | 30.19 dB | 0.3 MiB |
| imagescript | png-resize-1000 | 490.8 ms | 499.3 ms | 555.6 ms | 284.7 MiB | 140.5 MiB | 117.5 MiB | 107.8 MiB | - MiB | - MiB | 34.54 dB | 0.1 MiB |
| imagescript | png-alpha-resize | 37.9 ms | 39.3 ms | 67.5 ms | 106.4 MiB | 5.3 MiB | 18.5 MiB | 8.8 MiB | - MiB | - MiB | 47.19 dB | 0.0 MiB |
| imagescript | jpeg-to-png | 483.0 ms | 492.5 ms | 556.3 ms | 160.6 MiB | 25.5 MiB | 76.7 MiB | 67.0 MiB | - MiB | - MiB | 55.05 dB | 1.6 MiB |
| imagescript | stress-100mp-downscale | 1226.6 ms | 1262.1 ms | 1380.4 ms | 1262.6 MiB | 1155.6 MiB | 420.0 MiB | 410.3 MiB | - MiB | - MiB | 53.28 dB | 0.0 MiB |
| jsquash | jpeg-resize-1200 | 1101.6 ms | 1112.6 ms | 1111.7 ms | 577.8 MiB | 50.8 MiB | 500.2 MiB | 105.4 MiB | - MiB | - MiB | 28.65 dB | 0.3 MiB |
| jsquash | png-resize-1000 | 818.4 ms | 820.3 ms | 818.8 ms | 511.0 MiB | 47.4 MiB | 426.9 MiB | 69.4 MiB | - MiB | - MiB | 36.67 dB | 1.4 MiB |
| jsquash | png-alpha-resize | 65.5 ms | 65.7 ms | 71.6 ms | 121.6 MiB | 0.8 MiB | 41.0 MiB | 3.6 MiB | - MiB | - MiB | 47.73 dB | 0.2 MiB |
| jsquash | jpeg-to-png | 93.7 ms | 110.1 ms | 94.7 ms | 197.1 MiB | 24.5 MiB | 118.8 MiB | 49.2 MiB | - MiB | - MiB | 55.05 dB | 2.3 MiB |
| jsquash | stress-100mp-downscale | 6840.4 ms | 6863.3 ms | 6983.6 ms | 2997.2 MiB | 2877.4 MiB | 2914.1 MiB | 421.9 MiB | - MiB | - MiB | 40.26 dB | 1.1 MiB |

## Startup and npm package size

| Engine | Import | RSS after import | First JPEG metadata | First JPEG resize | npm package (unpacked) | Production packages |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| purejsimage | 26.4 ms | 93.6 MiB | 1.9 ms (pass) | 466.6 ms (pass) | 9.1 MiB | 1 |
| purejsimage-wasm | 31.2 ms | 93.3 MiB | 1.9 ms (pass) | 139.2 ms (pass) | 9.1 MiB | 1 |
| jimp | 92.0 ms | 98.1 MiB | 2446.1 ms (pass) | 1334.3 ms (pass) | 31.2 MiB | 64 |
| sharp | 25.4 ms | 94.7 MiB | 1.8 ms (pass) | 67.3 ms (pass) | 19.4 MiB | 6 |
| sharp-single-thread | 26.0 ms | 94.4 MiB | 1.7 ms (pass) | 66.8 ms (pass) | 19.4 MiB | 6 |
| image-js | 153.5 ms | 104.9 MiB | 2441.2 ms (pass) | 1010.6 ms (pass) | 17.0 MiB | 46 |
| imagescript | 79.3 ms | 94.6 MiB | 1003.7 ms (pass) | 568.2 ms (pass) | 2.5 MiB | 1 |
| jsquash | 13.1 ms | 86.3 MiB | - ms (unsupported) | 1450.0 ms (pass) | 9.8 MiB | 6 |

The `npm package (unpacked)` value is the byte size after npm extracts what it publishes, not the compressed `.tgz` download size. It includes every package required by an engine and the production dependencies present for this platform, including jSquash codec/resize packages and Sharp platform packages. Exact package lists are recorded in JSON; run `npm pack --dry-run --json` for tarball size.

A timing only counts when output validation passes. Input file reads, worker startup, warmups, output validation, and quality measurement are outside warm workflow timings. Startup measurements use a separate fresh process for each engine.

Quality is premultiplied-RGBA PSNR against an independently decoded exact-area reference. `exact` means every compared channel matched. Resize timings use the engine-default kernels identified above, so cross-kernel rows are default-experience rather than matched-quality comparisons. Lossy encoder quality scales are not calibrated; the quality column makes that difference visible but does not by itself turn equal API quality settings into a matched-quality size study.
