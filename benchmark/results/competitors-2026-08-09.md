# Benchmark result

Created: 2026-08-09T05:15:37.531Z

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

| Engine | Workflow | Median wall | p95 wall | Median CPU | Peak RSS | Peak RSS delta | Output |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| purejsimage | jpeg-resize-1200 | 826.5 ms | 830.4 ms | 927.5 ms | 143.4 MiB | 15.1 MiB | 0.3 MiB |
| purejsimage | png-resize-1000 | 529.8 ms | 531.4 ms | 779.3 ms | 173.1 MiB | 22.4 MiB | 0.0 MiB |
| purejsimage | png-alpha-resize | 76.5 ms | 107.6 ms | 117.8 ms | 120.1 MiB | 3.3 MiB | 0.0 MiB |
| purejsimage | jpeg-to-png | 550.6 ms | 571.0 ms | 644.4 ms | 211.4 MiB | 58.0 MiB | 1.6 MiB |
| purejsimage | stress-100mp-downscale | 2408.5 ms | 2441.1 ms | 3225.5 ms | 185.6 MiB | 73.2 MiB | 0.0 MiB |
| jimp | jpeg-resize-1200 | 1410.4 ms | 1414.5 ms | 1647.4 ms | 596.3 MiB | 175.0 MiB | 0.4 MiB |
| jimp | png-resize-1000 | 869.2 ms | 904.6 ms | 969.8 ms | 297.2 MiB | 135.5 MiB | 0.7 MiB |
| jimp | png-alpha-resize | 74.7 ms | 75.0 ms | 117.9 ms | 133.7 MiB | 5.7 MiB | 0.0 MiB |
| jimp | jpeg-to-png | 656.3 ms | 676.6 ms | 789.1 ms | 327.9 MiB | 126.9 MiB | 2.0 MiB |
| jimp | stress-100mp-downscale | 3810.3 ms | 3810.7 ms | 3939.8 ms | 1276.8 MiB | 1164.7 MiB | 0.3 MiB |
| sharp | jpeg-resize-1200 | 68.3 ms | 74.4 ms | 76.5 ms | 170.1 MiB | 27.4 MiB | 0.3 MiB |
| sharp | png-resize-1000 | 265.8 ms | 267.2 ms | 306.6 ms | 169.9 MiB | 41.8 MiB | 2.5 MiB |
| sharp | png-alpha-resize | 11.8 ms | 11.8 ms | 12.9 ms | 116.6 MiB | 9.1 MiB | 0.0 MiB |
| sharp | jpeg-to-png | 62.1 ms | 63.5 ms | 70.8 ms | 195.4 MiB | 81.3 MiB | 2.3 MiB |
| sharp | stress-100mp-downscale | 696.5 ms | 699.7 ms | 729.2 ms | 214.9 MiB | 102.3 MiB | 1.5 MiB |
| sharp-single-thread | jpeg-resize-1200 | 70.6 ms | 70.7 ms | 79.2 ms | 170.2 MiB | 27.2 MiB | 0.3 MiB |
| sharp-single-thread | png-resize-1000 | 266.5 ms | 266.6 ms | 309.5 ms | 169.8 MiB | 42.0 MiB | 2.5 MiB |
| sharp-single-thread | png-alpha-resize | 11.6 ms | 12.0 ms | 12.7 ms | 115.8 MiB | 9.0 MiB | 0.0 MiB |
| sharp-single-thread | jpeg-to-png | 63.3 ms | 65.8 ms | 71.9 ms | 196.0 MiB | 81.3 MiB | 2.3 MiB |
| sharp-single-thread | stress-100mp-downscale | 691.8 ms | 697.6 ms | 733.8 ms | 215.8 MiB | 100.6 MiB | 1.5 MiB |
| image-js | jpeg-resize-1200 | 1051.5 ms | 1061.1 ms | 1235.5 ms | 569.0 MiB | 111.3 MiB | 0.4 MiB |
| image-js | png-resize-1000 | 727.8 ms | 737.2 ms | 873.0 ms | 292.4 MiB | 144.7 MiB | 1.6 MiB |
| image-js | png-alpha-resize | 85.1 ms | 89.4 ms | 150.8 ms | 132.5 MiB | 5.2 MiB | 0.0 MiB |
| image-js | jpeg-to-png | 692.4 ms | 693.9 ms | 784.7 ms | 410.3 MiB | 193.0 MiB | 2.4 MiB |
| image-js | stress-100mp-downscale | 1878.5 ms | 1943.4 ms | 2186.5 ms | 1273.9 MiB | 1149.5 MiB | 1.2 MiB |
| jsquash | jpeg-resize-1200 | 1103.9 ms | 1104.2 ms | 1116.4 ms | 606.4 MiB | 46.5 MiB | 0.3 MiB |
| jsquash | png-resize-1000 | 826.0 ms | 876.6 ms | 826.5 ms | 524.8 MiB | 56.2 MiB | 1.4 MiB |
| jsquash | png-alpha-resize | 63.9 ms | 63.9 ms | 70.1 ms | 128.4 MiB | 1.6 MiB | 0.2 MiB |
| jsquash | jpeg-to-png | 91.2 ms | 93.5 ms | 92.6 ms | 290.9 MiB | 91.0 MiB | 2.3 MiB |
| jsquash | stress-100mp-downscale | 6901.4 ms | 6917.9 ms | 7023.8 ms | 3012.7 MiB | 2891.7 MiB | 1.1 MiB |

## Startup and installed package footprint

| Engine | Import | RSS after import | First JPEG metadata | First JPEG resize | Installed footprint | Production packages |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| purejsimage | 50.3 ms | 93.4 MiB | 1.4 ms (pass) | 829.5 ms (pass) | 1.6 MiB | 1 |
| jimp | 63.1 ms | 93.3 MiB | 2554.4 ms (pass) | 1431.1 ms (pass) | 29.3 MiB | 70 |
| sharp | 27.1 ms | 92.9 MiB | 1.8 ms (pass) | 67.8 ms (pass) | 18.9 MiB | 6 |
| sharp-single-thread | 27.0 ms | 93.0 MiB | 1.7 ms (pass) | 70.0 ms (pass) | 18.9 MiB | 6 |
| image-js | 155.8 ms | 101.6 MiB | 2719.9 ms (pass) | 1032.3 ms (pass) | 17.0 MiB | 46 |
| jsquash | 9.8 ms | 84.1 MiB | - ms (unsupported) | 1437.6 ms (pass) | 1.9 MiB | 5 |

Installed footprint includes every package required by an engine and the production dependencies present for this platform, including jSquash codec/resize packages and Sharp platform packages. Exact package lists are recorded in JSON.

A timing only counts when output validation passes. Input file reads, worker startup, warmups, and output validation are outside warm workflow timings. Startup measurements use a separate fresh process for each engine.

Timing comparisons include encoding. Resize timings use the engine-default kernels identified above and are not matched-quality comparisons across different kernels. Lossy encoders do not share a calibrated quality scale, so output quality and compression efficiency cannot be compared solely because each API received `quality: 80`; that requires a separate matched-quality study.
