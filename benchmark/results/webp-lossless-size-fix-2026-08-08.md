# Benchmark result

Created: 2026-08-08T22:58:30.772Z

Profile: `webp`

Environment: Linux 6.17.0-41-generic, x64, Node v24.16.0, Intel(R) Core(TM) i7-10700 CPU @ 2.90GHz, 16 logical CPUs

## Engine versions

| Engine | Version | Implementation |
| --- | --- | --- |
| purejsimage | 0.6.0 (workspace) | pure-javascript |

PureJsImage, Jimp, and image-js are pure JavaScript. Sharp is a native dependency; `sharp-single-thread` is the same native package configured with `sharp.concurrency(1)` before processing.

## Compatibility

| Engine | Workflow | Status | Detail |
| --- | --- | --- | --- |
| purejsimage | png-to-webp-lossless | pass | - |

## Performance on workflows supported equivalently by every selected engine

| Engine | Workflow | Median wall | p95 wall | Median CPU | Peak RSS | Peak RSS delta | Output |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| purejsimage | png-to-webp-lossless | 32.0 ms | 36.3 ms | 52.6 ms | 108.2 MiB | 3.8 MiB | 0.0 MiB |

## Startup and installed package footprint

| Engine | Import | RSS after import | First JPEG metadata | First JPEG resize | Installed footprint | Production packages |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| purejsimage | 46.5 ms | 93.2 MiB | 1.4 ms (pass) | 905.9 ms (pass) | 2.9 MiB | 1 |

Installed footprint includes each engine package and the production dependencies present for this platform, including Sharp platform packages. Exact package lists are recorded in JSON.

A timing only counts when output validation passes. Input file reads, worker startup, warmups, and output validation are outside warm workflow timings. Startup measurements use a separate fresh process for each engine.

Timing comparisons include encoding. Lossy encoders do not share a calibrated quality scale, so output quality and compression efficiency cannot be compared solely because each API received `quality: 80`; that requires a separate matched-quality study.

## Compression and allocation notes

The checksum-pinned `transparent-logo-1200x480` fixture produced these exact
sizes in the same workspace:

| Encoder | Bytes |
| --- | ---: |
| PureJsImage WebP lossless before this change | 2,304,138 |
| PureJsImage WebP lossless after this change | 3,152 |
| PureJsImage PNG | 6,850 |
| Sharp 0.35.3/libwebp lossless WebP | 1,584 |

Sharp/libwebp independently decoded the new output to the exact source RGBA
pixels. The encoder now retains one explicit 32-bit transformed frame (2.20 MiB
for this 1200x480 input), two 4.7 KiB row buffers, fixed-size match tables, and
the encoded VP8L payload needed before the RIFF length can be written. The
isolated three-run measurement above recorded a 3.8 MiB median peak-RSS delta,
compared with 3.6 MiB in the pre-change
`webp-oracle-validated-2026-08-08` report.
