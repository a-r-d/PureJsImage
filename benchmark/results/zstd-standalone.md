# Standalone Zstandard benchmark

Reference-decoder-generated 68,610-byte fixture; exact 350,726-byte output validation.

| Runs | Warmups | Median | p95 | Throughput | Peak RSS | External | ArrayBuffer | Minified | gzip | Brotli |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 9 | 2 | 27.28 ms | 40.76 ms | 12.9 MB/s | 104.2 MiB | 12.3 MiB | 3.5 MiB | 17.0 KiB | 6.0 KiB | 5.3 KiB |
