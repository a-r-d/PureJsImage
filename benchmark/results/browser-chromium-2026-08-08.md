# Chromium browser performance baseline

Browser: `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.7922.34 Safari/537.36`

Each warm value is the median of 5 runs. PureJsImage and native rows are complete decode-resize-encode pipelines. jSquash rows measure codec-only decode or encode and are not complete pipeline comparisons. Browser memory is intentionally not reported.

| Workflow | Scope | Module init | First operation | Warm median | Output bytes | JS bytes loaded | WASM bytes loaded | Correctness |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| PureJsImage JPEG decode-resize-encode | complete-pipeline | 8.50 ms | 51.50 ms | 29.90 ms | 16024 | 85791 | 0 | PureJsImage decoded output 320x240; pixel checksum baebfe86 |
| PureJsImage PNG decode-resize-encode | complete-pipeline | 6.30 ms | 54.60 ms | 32.90 ms | 184756 | 69636 | 0 | PureJsImage decoded output 320x240; pixel checksum fc65a316 |
| Native JPEG createImageBitmap-resize-encode | native-complete-pipeline | 2.20 ms | 3.30 ms | 2.80 ms | 15017 | 1447 | 0 | decoded output 320x240; pixel checksum aa8f49c9 |
| Native PNG createImageBitmap-resize-encode | native-complete-pipeline | 1.90 ms | 9.30 ms | 7.70 ms | 192112 | 1432 | 0 | decoded output 320x240; pixel checksum a84f9230 |
| jSquash JPEG decode | codec-only | 2.80 ms | 14.70 ms | 4.50 ms | 1228800 | 19846 | 166470 | jSquash decoded RGBA 640x480; pixel checksum 283b79a6 |
| jSquash JPEG encode | codec-only | 4.90 ms | 94.60 ms | 78.60 ms | 88536 | 21691 | 251524 | decoded output 640x480; pixel checksum 71cae750 |
| jSquash PNG decode | codec-only | 2.50 ms | 17.90 ms | 8.10 ms | 1228800 | 4643 | 181088 | jSquash decoded RGBA 640x480; pixel checksum 3048fbab |
| jSquash PNG encode | codec-only | 2.50 ms | 15.00 ms | 5.90 ms | 886455 | 5432 | 181088 | decoded output 640x480; pixel checksum 3048fbab |
| jSquash WebP decode | codec-only | 2.90 ms | 14.40 ms | 2.70 ms | 609880 | 20358 | 137960 | jSquash decoded RGBA 386x395; pixel checksum dd77ded2 |
| jSquash WebP encode | codec-only | 3.40 ms | 84.60 ms | 46.50 ms | 96940 | 44843 | 345584 | decoded output 640x480; pixel checksum dcbf7d55 |
