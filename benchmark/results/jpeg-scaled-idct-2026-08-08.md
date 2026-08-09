# JPEG scaled-IDCT benchmark

Pinned input: tundra-4000x3000.jpg, 4000×3000, SHA-256 `af55711534d744a385a805d7c0ff20c7e32c19f9fb886b468b078af24ddb8ab6`.
Source: https://commons.wikimedia.org/wiki/File:Tundra_Landscape_(31354285547).jpg. Pacific Northwest Research Station, Forest Service, USDA; photograph by Janet Prevey; Public domain, United States Department of Agriculture.

Each sample runs in a fresh process after one same-mode warmup. Runtime covers JPEG parsing, entropy
decode, IDCT, color conversion, and bilinear resize. RSS is the absolute process high-water mark;
output error compares raw RGB8 pixels against the forced full-resolution 8×8 IDCT path.

| Output | Path | IDCT scale | Decoded size | Pixels avoided | Median runtime | Median peak RSS | Max peak RSS | Output error |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| 200px | full | 1/1 | 4000×3000 | 0 (0.00%) | 1142.3 ms | 102.7 MiB | 105.2 MiB | oracle |
| 200px | scaled | 1/8 | 500×375 | 11,812,500 (98.44%) | 287.2 ms | 104.2 MiB | 104.8 MiB | MAE 16.27, PSNR 20.26 dB |
| 800px | full | 1/1 | 4000×3000 | 0 (0.00%) | 1154.7 ms | 104.1 MiB | 104.2 MiB | oracle |
| 800px | scaled | 1/4 | 1000×750 | 11,250,000 (93.75%) | 412.5 ms | 104.8 MiB | 105.4 MiB | MAE 14.08, PSNR 21.30 dB |
| 1200px | full | 1/1 | 4000×3000 | 0 (0.00%) | 1183.1 ms | 108.5 MiB | 109.0 MiB | oracle |
| 1200px | scaled | 1/2 | 2000×1500 | 9,000,000 (75.00%) | 679.2 ms | 106.4 MiB | 106.9 MiB | MAE 5.32, PSNR 29.29 dB |

Independent ImageMagick/libjpeg scaled-decode cross-check:

| IDCT scale | Native size | MAE | PSNR | Maximum channel error |
| ---: | ---: | ---: | ---: | ---: |
| 1/8 | 500×375 | 1.037 | 43.96 dB | 23 |
| 1/4 | 1000×750 | 2.607 | 36.45 dB | 35 |
| 1/2 | 2000×1500 | 2.376 | 36.94 dB | 46 |


The planner selected 1/8, 1/4, and 1/2 for 200px, 800px, and 1200px respectively. Median runtime
speedups were 200px 3.98×, 800px 2.80×, 1200px 1.74×. Peak RSS remained close to the full path because the existing
decoder was already bounded to MCU rows and the process/module baseline dominates these runs; the
measured benefit is less IDCT, color-conversion, and resize work rather than a new RSS claim.

Safely aligned crop-resize plans may use the same scaled IDCT. Restart-aware baseline crops also
seek their closest usable restart boundary; unsafe coordinate mappings retain the explicit
full-resolution fallback.
