# Benchmark result

Created: 2026-08-12T15:09:18.861Z

Profile: `small-codecs`

Environment: Linux 6.17.0-41-generic, x64, Node v24.16.0, Intel(R) Core(TM) i7-10700 CPU @ 2.90GHz, 16 logical CPUs

## Engine versions

| Engine | Version | Implementation |
| --- | --- | --- |
| purejsimage | 0.9.0 (workspace) | pure-javascript |

Resize workflows use each engine’s public default kernel. PureJsImage and Sharp use Lanczos 3; Jimp uses bilinear. Cross-kernel timings are default-experience comparisons, not matched-quality comparisons.

## Compatibility

| Engine | Workflow | Status | Detail |
| --- | --- | --- | --- |
| purejsimage | qoi-city-decode | pass | - |
| purejsimage | qoi-haze-decode | pass | - |
| purejsimage | qoi-grass-decode | pass | - |
| purejsimage | ppm-city-decode | pass | - |
| purejsimage | ppm-haze-decode | pass | - |
| purejsimage | ppm-grass-decode | pass | - |
| purejsimage | tga-city-decode | pass | - |
| purejsimage | tga-haze-decode | pass | - |
| purejsimage | tga-grass-decode | pass | - |
| purejsimage | hdr-potsdamer-decode | pass | - |
| purejsimage | hdr-greenhouse-decode | pass | - |
| purejsimage | pfm-potsdamer-decode | pass | - |
| purejsimage | pfm-greenhouse-decode | pass | - |
| purejsimage | qoi-city-encode | pass | - |
| purejsimage | ppm-city-encode | pass | - |
| purejsimage | tga-city-encode | pass | - |
| purejsimage | hdr-potsdamer-encode | pass | - |
| purejsimage | pfm-potsdamer-encode | pass | - |

## Performance on workflows supported by every selected engine

| Engine | Workflow | Median wall | p95 wall | Median CPU | Peak RSS | Peak RSS delta | External | ArrayBuffer | Source read | Max decoded block | Quality | Output |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| purejsimage | qoi-city-decode | 67.5 ms | 74.3 ms | 85.4 ms | 142.5 MiB | 3.2 MiB | 10.9 MiB | 1.6 MiB | 0.5 MiB | 0.1 MiB | - | 0.9 MiB |
| purejsimage | qoi-haze-decode | 50.7 ms | 51.1 ms | 68.4 ms | 141.4 MiB | 0.9 MiB | 10.7 MiB | 1.5 MiB | 0.4 MiB | 0.1 MiB | - | 0.9 MiB |
| purejsimage | qoi-grass-decode | 90.8 ms | 93.5 ms | 110.2 ms | 141.1 MiB | 1.2 MiB | 11.1 MiB | 1.9 MiB | 0.8 MiB | 0.1 MiB | - | 0.9 MiB |
| purejsimage | ppm-city-decode | 16.0 ms | 23.4 ms | 29.1 ms | 109.4 MiB | 1.3 MiB | 11.3 MiB | 2.0 MiB | 1.0 MiB | 0.0 MiB | - | 0.9 MiB |
| purejsimage | ppm-haze-decode | 16.2 ms | 20.2 ms | 28.1 ms | 107.3 MiB | 1.6 MiB | 11.3 MiB | 2.0 MiB | 1.0 MiB | 0.0 MiB | - | 0.9 MiB |
| purejsimage | ppm-grass-decode | 15.8 ms | 16.5 ms | 28.0 ms | 107.2 MiB | 1.3 MiB | 11.3 MiB | 2.0 MiB | 1.0 MiB | 0.0 MiB | - | 0.9 MiB |
| purejsimage | tga-city-decode | 126.0 ms | 129.5 ms | 155.8 ms | 140.7 MiB | 1.1 MiB | 10.3 MiB | 1.0 MiB | 35.7 MiB | 0.0 MiB | - | 0.9 MiB |
| purejsimage | tga-haze-decode | 129.3 ms | 130.0 ms | 163.2 ms | 138.8 MiB | 1.0 MiB | 10.3 MiB | 1.0 MiB | 35.4 MiB | 0.0 MiB | - | 0.9 MiB |
| purejsimage | tga-grass-decode | 127.0 ms | 129.6 ms | 155.3 ms | 139.8 MiB | 2.1 MiB | 10.4 MiB | 1.1 MiB | 35.8 MiB | 0.0 MiB | - | 0.9 MiB |
| purejsimage | hdr-potsdamer-decode | 179.7 ms | 201.6 ms | 204.5 ms | 139.7 MiB | 1.3 MiB | 11.0 MiB | 1.7 MiB | 32.8 MiB | 0.0 MiB | - | 6.0 MiB |
| purejsimage | hdr-greenhouse-decode | 190.4 ms | 201.7 ms | 214.5 ms | 140.8 MiB | 1.2 MiB | 11.2 MiB | 1.9 MiB | 33.1 MiB | 0.0 MiB | - | 6.0 MiB |
| purejsimage | pfm-potsdamer-decode | 31.0 ms | 31.7 ms | 39.0 ms | 118.3 MiB | 2.4 MiB | 20.5 MiB | 11.2 MiB | 6.1 MiB | 0.0 MiB | - | 6.0 MiB |
| purejsimage | pfm-greenhouse-decode | 30.9 ms | 34.6 ms | 38.9 ms | 117.3 MiB | 2.3 MiB | 20.5 MiB | 11.2 MiB | 6.1 MiB | 0.0 MiB | - | 6.0 MiB |
| purejsimage | qoi-city-encode | 76.9 ms | 78.7 ms | 104.2 ms | 141.7 MiB | 1.4 MiB | 13.7 MiB | 4.4 MiB | - MiB | - MiB | - | 0.5 MiB |
| purejsimage | ppm-city-encode | 36.2 ms | 36.5 ms | 62.1 ms | 130.0 MiB | 8.1 MiB | 16.7 MiB | 7.4 MiB | - MiB | - MiB | - | 0.9 MiB |
| purejsimage | tga-city-encode | 141.6 ms | 144.4 ms | 181.4 ms | 142.1 MiB | 3.2 MiB | 15.1 MiB | 5.8 MiB | - MiB | - MiB | - | 0.9 MiB |
| purejsimage | hdr-potsdamer-encode | 229.1 ms | 250.8 ms | 261.3 ms | 144.2 MiB | 3.7 MiB | 18.3 MiB | 9.1 MiB | - MiB | - MiB | - | 1.5 MiB |
| purejsimage | pfm-potsdamer-encode | 58.7 ms | 60.8 ms | 78.9 ms | 157.2 MiB | 25.2 MiB | 54.8 MiB | 45.6 MiB | - MiB | - MiB | - | 6.0 MiB |

## Startup and installed package footprint

| Engine | Import | RSS after import | First JPEG metadata | First JPEG resize | Installed footprint | Production packages |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| purejsimage | 60.9 ms | 96.1 MiB | 1.6 ms (pass) | 849.2 ms (pass) | 2.7 MiB | 1 |

Installed footprint includes every package required by an engine and the production dependencies present for this platform, including jSquash codec/resize packages and Sharp platform packages. Exact package lists are recorded in JSON.

A timing only counts when output validation passes. Input file reads, worker startup, warmups, output validation, and quality measurement are outside warm workflow timings. Startup measurements use a separate fresh process for each engine.

Quality is premultiplied-RGBA PSNR against an independently decoded exact-area reference. `exact` means every compared channel matched. Resize timings use the engine-default kernels identified above, so cross-kernel rows are default-experience rather than matched-quality comparisons. Lossy encoder quality scales are not calibrated; the quality column makes that difference visible but does not by itself turn equal API quality settings into a matched-quality size study.
