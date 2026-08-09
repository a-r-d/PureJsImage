# Benchmark result

Created: 2026-08-09T03:14:36.787Z

Profile: `webp`

Environment: Linux 6.17.0-41-generic, x64, Node v24.16.0, Intel(R) Core(TM) i7-10700 CPU @ 2.90GHz, 16 logical CPUs

## Engine versions

| Engine | Version | Implementation |
| --- | --- | --- |
| purejsimage | 0.7.0 (workspace) | pure-javascript |

PureJsImage, Jimp, and image-js are pure JavaScript. jSquash uses WebAssembly codecs and resizing. Sharp is a native dependency; `sharp-single-thread` is the same native package configured with `sharp.concurrency(1)` before processing.

## Compatibility

| Engine | Workflow | Status | Detail |
| --- | --- | --- | --- |
| purejsimage | png-to-webp-lossless | pass | - |

## Performance on workflows supported equivalently by every selected engine

| Engine | Workflow | Median wall | p95 wall | Median CPU | Peak RSS | Peak RSS delta | Output |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| purejsimage | png-to-webp-lossless | 51.2 ms | 56.2 ms | 82.6 ms | 113.8 MiB | 1.2 MiB | 0.0 MiB |

## Startup and installed package footprint

| Engine | Import | RSS after import | First JPEG metadata | First JPEG resize | Installed footprint | Production packages |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| purejsimage | 47.9 ms | 93.4 MiB | 1.4 ms (pass) | 756.7 ms (pass) | 3.1 MiB | 1 |

Installed footprint includes every package required by an engine and the production dependencies present for this platform, including jSquash codec/resize packages and Sharp platform packages. Exact package lists are recorded in JSON.

A timing only counts when output validation passes. Input file reads, worker startup, warmups, and output validation are outside warm workflow timings. Startup measurements use a separate fresh process for each engine.

Timing comparisons include encoding. Lossy encoders do not share a calibrated quality scale, so output quality and compression efficiency cannot be compared solely because each API received `quality: 80`; that requires a separate matched-quality study.

## Lossless size and allocation notes

The checksum-pinned `transparent-logo-1200x480` corpus workflow retains its
3,152-byte output. Its three-run median moved from 32.0 ms to 51.2 ms while the
median peak-RSS delta moved from 3.8 MiB to 1.2 MiB. The complex path uses one
fixed 4 MiB match table for images of at least 16,384 pixels; the flat-graphic
path uses a 256 KiB table and keeps the previous single-left-predictor output.

The browser-demo regression input supplied during development has SHA-256
`7a700670128b8ec344ee805a95b89999e12b262ac7a0277be959780f290254f8` and is not
redistributed in the corpus. After resizing it from 1200x757 to 1000 pixels wide,
the same workspace produced:

| Encoder | Bytes |
| --- | ---: |
| PureJsImage WebP lossless on `main` | 439,906 |
| PureJsImage WebP lossless after this change | 338,666 |
| PureJsImage PNG | 380,324 |
| libwebp 1.5.0 lossless WebP | 226,924 |

Both PureJsImage and libwebp outputs decoded through the independent `dwebp`
1.5.0 oracle to identical pixels. This is a 23.0% reduction from `main`, makes
the reproduced WebP 10.9% smaller than PureJsImage PNG, and narrows the libwebp
gap from 1.94x to 1.49x. This does not claim that lossless WebP is universally
smaller than PNG; the permanent gates cover the demonstrated graphic paths.
