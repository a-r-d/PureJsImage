# Benchmark result

Created: 2026-08-16T03:36:31.149Z

Profile: `small-codecs`

Environment: Linux 6.17.0-41-generic, x64, Node v24.16.0, Intel(R) Core(TM) i7-10700 CPU @ 2.90GHz, 16 logical CPUs

## Engine versions

| Engine | Version | Implementation |
| --- | --- | --- |
| purejsimage | 0.10.0 (workspace) | pure-javascript |

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
| purejsimage | qoi-city-decode | 70.7 ms | 71.7 ms | 89.7 ms | 135.4 MiB | 1.5 MiB | 10.7 MiB | 1.4 MiB | 0.5 MiB | 0.1 MiB | - | 0.9 MiB |
| purejsimage | qoi-haze-decode | 50.8 ms | 51.9 ms | 69.7 ms | 140.1 MiB | 1.7 MiB | 10.1 MiB | 0.7 MiB | 0.4 MiB | 0.1 MiB | - | 0.9 MiB |
| purejsimage | qoi-grass-decode | 93.8 ms | 96.2 ms | 115.0 ms | 141.0 MiB | 1.6 MiB | 11.1 MiB | 1.8 MiB | 0.8 MiB | 0.1 MiB | - | 0.9 MiB |
| purejsimage | ppm-city-decode | 15.8 ms | 21.8 ms | 28.1 ms | 120.5 MiB | 0.8 MiB | 11.3 MiB | 2.0 MiB | 1.0 MiB | 0.0 MiB | - | 0.9 MiB |
| purejsimage | ppm-haze-decode | 16.0 ms | 21.6 ms | 29.1 ms | 120.3 MiB | 1.6 MiB | 11.3 MiB | 2.0 MiB | 1.0 MiB | 0.0 MiB | - | 0.9 MiB |
| purejsimage | ppm-grass-decode | 15.8 ms | 17.1 ms | 29.5 ms | 120.6 MiB | 1.2 MiB | 11.3 MiB | 2.0 MiB | 1.0 MiB | 0.0 MiB | - | 0.9 MiB |
| purejsimage | tga-city-decode | 130.9 ms | 143.7 ms | 162.4 ms | 137.4 MiB | 1.0 MiB | 10.3 MiB | 1.1 MiB | 35.7 MiB | 0.0 MiB | - | 0.9 MiB |
| purejsimage | tga-haze-decode | 137.6 ms | 139.3 ms | 170.2 ms | 138.6 MiB | 2.4 MiB | 10.3 MiB | 1.0 MiB | 35.4 MiB | 0.0 MiB | - | 0.9 MiB |
| purejsimage | tga-grass-decode | 128.1 ms | 129.2 ms | 154.7 ms | 135.2 MiB | 1.6 MiB | 10.4 MiB | 1.1 MiB | 35.8 MiB | 0.0 MiB | - | 0.9 MiB |
| purejsimage | hdr-potsdamer-decode | 186.4 ms | 195.2 ms | 211.7 ms | 138.6 MiB | 1.8 MiB | 11.1 MiB | 1.8 MiB | 32.8 MiB | 0.0 MiB | - | 6.0 MiB |
| purejsimage | hdr-greenhouse-decode | 193.9 ms | 220.0 ms | 221.2 ms | 138.7 MiB | 2.0 MiB | 11.3 MiB | 2.0 MiB | 33.1 MiB | 0.0 MiB | - | 6.0 MiB |
| purejsimage | pfm-potsdamer-decode | 31.3 ms | 32.5 ms | 39.7 ms | 138.7 MiB | 6.1 MiB | 21.4 MiB | 12.1 MiB | 6.1 MiB | 0.0 MiB | - | 6.0 MiB |
| purejsimage | pfm-greenhouse-decode | 33.0 ms | 37.4 ms | 40.9 ms | 137.8 MiB | 5.9 MiB | 21.4 MiB | 12.1 MiB | 6.1 MiB | 0.0 MiB | - | 6.0 MiB |
| purejsimage | qoi-city-encode | 79.5 ms | 80.3 ms | 111.1 ms | 148.9 MiB | 1.6 MiB | 13.5 MiB | 4.3 MiB | - MiB | - MiB | - | 0.5 MiB |
| purejsimage | ppm-city-encode | 35.9 ms | 38.1 ms | 63.8 ms | 137.4 MiB | 4.7 MiB | 17.0 MiB | 7.7 MiB | - MiB | - MiB | - | 0.9 MiB |
| purejsimage | tga-city-encode | 135.0 ms | 138.6 ms | 173.5 ms | 139.1 MiB | 3.1 MiB | 15.1 MiB | 5.8 MiB | - MiB | - MiB | - | 0.9 MiB |
| purejsimage | hdr-potsdamer-encode | 223.7 ms | 228.9 ms | 259.2 ms | 142.6 MiB | 2.8 MiB | 18.5 MiB | 9.3 MiB | - MiB | - MiB | - | 1.5 MiB |
| purejsimage | pfm-potsdamer-encode | 58.6 ms | 60.6 ms | 80.5 ms | 179.1 MiB | 26.3 MiB | 54.8 MiB | 45.6 MiB | - MiB | - MiB | - | 6.0 MiB |

## Startup and npm package size

| Engine | Import | RSS after import | First JPEG metadata | First JPEG resize | npm package (unpacked) | Production packages |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| purejsimage | 76.6 ms | 104.2 MiB | 1.6 ms (pass) | 846.0 ms (pass) | 4.8 MiB | 1 |

The `npm package (unpacked)` value is the byte size after npm extracts what it publishes, not the compressed `.tgz` download size. It includes every package required by an engine and the production dependencies present for this platform, including jSquash codec/resize packages and Sharp platform packages. Exact package lists are recorded in JSON; run `npm pack --dry-run --json` for tarball size.

A timing only counts when output validation passes. Input file reads, worker startup, warmups, output validation, and quality measurement are outside warm workflow timings. Startup measurements use a separate fresh process for each engine.

Quality is premultiplied-RGBA PSNR against an independently decoded exact-area reference. `exact` means every compared channel matched. Resize timings use the engine-default kernels identified above, so cross-kernel rows are default-experience rather than matched-quality comparisons. Lossy encoder quality scales are not calibrated; the quality column makes that difference visible but does not by itself turn equal API quality settings into a matched-quality size study.
