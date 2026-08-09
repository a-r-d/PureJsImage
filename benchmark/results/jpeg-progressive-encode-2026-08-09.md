# Progressive JPEG encode benchmark

Generated: 2026-08-09T03:37:38.474Z

Each row ran in an isolated process. Pixels were independently decoded before timing counted. RSS is absolute process peak RSS; progressive retained bytes are compact quantized Int16 coefficients.

| Mode | Profile | Frame/scans/DHT | Median | Throughput | Peak RSS | Coefficients | Output | PSNR |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 420 | cold | SOF0/1/1 | 230.55 ms | 13.64 MP/s | 86.89 MiB | 0.00 MiB | 1492375 B | 18.44 dB |
| progressive | cold | SOF2/6/5 | 343.01 ms | 9.17 MP/s | 100.44 MiB | 9.00 MiB | 1384013 B | 18.44 dB |
| restart | cold | SOF0/1/1 | 227.80 ms | 13.81 MP/s | 87.86 MiB | 0.00 MiB | 1496677 B | 18.44 dB |
| progressive-restart | cold | SOF2/6/5 | 335.01 ms | 9.39 MP/s | 101.31 MiB | 9.00 MiB | 1471776 B | 18.44 dB |
| 420 | warm | SOF0/1/1 | 247.39 ms | 12.72 MP/s | 106.38 MiB | 0.00 MiB | 1492375 B | 18.44 dB |
| progressive | warm | SOF2/6/5 | 329.55 ms | 9.55 MP/s | 115.71 MiB | 9.00 MiB | 1384013 B | 18.44 dB |
| restart | warm | SOF0/1/1 | 238.87 ms | 13.17 MP/s | 103.82 MiB | 0.00 MiB | 1496677 B | 18.44 dB |
| progressive-restart | warm | SOF2/6/5 | 328.94 ms | 9.56 MP/s | 117.45 MiB | 9.00 MiB | 1471776 B | 18.44 dB |

Baseline and progressive rows use the same deterministic 2048x1536 RGB input, quality 80,
4:2:0 sampling and independent `jpeg-js` final-pixel validation. Baseline uses the standard
Huffman tables; progressive gathers statistics and writes optimized tables per entropy-coded scan.
Restart rows add a four-MCU restart interval; progressive restart intervals apply independently
to each scan, as required by JPEG scan semantics.
