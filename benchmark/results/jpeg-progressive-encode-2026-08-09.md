# Progressive JPEG encode benchmark

Generated: 2026-08-09T00:50:04.192Z

Each row ran in an isolated process. Pixels were independently decoded before timing counted. RSS is absolute process peak RSS; progressive retained bytes are compact quantized Int16 coefficients.

| Mode | Profile | Frame/scans | Median | Throughput | Peak RSS | Coefficients | Output | PSNR |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 420 | cold | SOF0/1 | 232.40 ms | 13.54 MP/s | 87.64 MiB | 0.00 MiB | 1492375 B | 18.44 dB |
| progressive | cold | SOF2/6 | 313.03 ms | 10.05 MP/s | 101.32 MiB | 9.00 MiB | 1541467 B | 18.44 dB |
| restart | cold | SOF0/1 | 233.76 ms | 13.46 MP/s | 88.00 MiB | 0.00 MiB | 1496677 B | 18.44 dB |
| progressive-restart | cold | SOF2/6 | 296.07 ms | 10.62 MP/s | 102.54 MiB | 9.00 MiB | 1630737 B | 18.44 dB |
| 420 | warm | SOF0/1 | 244.64 ms | 12.86 MP/s | 100.13 MiB | 0.00 MiB | 1492375 B | 18.44 dB |
| progressive | warm | SOF2/6 | 282.39 ms | 11.14 MP/s | 115.37 MiB | 9.00 MiB | 1541467 B | 18.44 dB |
| restart | warm | SOF0/1 | 238.97 ms | 13.16 MP/s | 102.36 MiB | 0.00 MiB | 1496677 B | 18.44 dB |
| progressive-restart | warm | SOF2/6 | 266.69 ms | 11.80 MP/s | 117.37 MiB | 9.00 MiB | 1630737 B | 18.44 dB |

Baseline and progressive rows use the same deterministic 2048x1536 RGB input, quality 80,
4:2:0 sampling, standard Huffman tables, and independent `jpeg-js` final-pixel validation.
Restart rows add a four-MCU restart interval; progressive restart intervals apply independently
to each scan, as required by JPEG scan semantics.
