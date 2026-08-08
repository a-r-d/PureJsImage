# JPEG scaled-IDCT benchmark

Pinned input: tundra-4000x3000.jpg, 4000×3000, SHA-256 `af55711534d744a385a805d7c0ff20c7e32c19f9fb886b468b078af24ddb8ab6`.
Source: https://commons.wikimedia.org/wiki/File:Tundra_Landscape_(31354285547).jpg. Pacific Northwest Research Station, Forest Service, USDA; photograph by Janet Prevey; Public domain, United States Department of Agriculture.

Each sample runs in a fresh process after one same-mode warmup. Runtime covers JPEG parsing, entropy
decode, IDCT, color conversion, and bilinear resize. RSS is the absolute process high-water mark;
output error compares raw RGB8 pixels against the forced full-resolution 8×8 IDCT path.

| Output | Path | IDCT scale | Decoded size | Pixels avoided | Median runtime | Median peak RSS | Max peak RSS | Output error |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| 200px | full | 1/1 | 4000×3000 | 0 (0.00%) | 728.8 ms | 97.0 MiB | 99.5 MiB | oracle |
| 200px | scaled | 1/8 | 500×375 | 11,812,500 (98.44%) | 278.2 ms | 97.5 MiB | 98.2 MiB | MAE 16.24, PSNR 20.27 dB |
| 800px | full | 1/1 | 4000×3000 | 0 (0.00%) | 766.9 ms | 101.5 MiB | 103.4 MiB | oracle |
| 800px | scaled | 1/4 | 1000×750 | 11,250,000 (93.75%) | 383.6 ms | 99.4 MiB | 101.0 MiB | MAE 14.09, PSNR 21.29 dB |
| 1200px | full | 1/1 | 4000×3000 | 0 (0.00%) | 819.8 ms | 103.9 MiB | 104.6 MiB | oracle |
| 1200px | scaled | 1/2 | 2000×1500 | 9,000,000 (75.00%) | 592.4 ms | 102.1 MiB | 103.7 MiB | MAE 5.37, PSNR 29.24 dB |

Independent ImageMagick/libjpeg scaled-decode cross-check:

| IDCT scale | Native size | MAE | PSNR | Maximum channel error |
| ---: | ---: | ---: | ---: | ---: |
| 1/8 | 500×375 | 0.483 | 51.29 dB | 1 |
| 1/4 | 1000×750 | 2.601 | 36.44 dB | 35 |
| 1/2 | 2000×1500 | 2.364 | 36.95 dB | 45 |


The planner selected 1/8, 1/4, and 1/2 for 200px, 800px, and 1200px respectively. Median runtime
speedups were 200px 2.62×, 800px 2.00×, 1200px 1.38×. Peak RSS remained close to the full path because the existing
decoder was already bounded to MCU rows and the process/module baseline dominates these runs; the
measured benefit is less IDCT, color-conversion, and resize work rather than a new RSS claim.

Crop-pushed regions and orientation-dependent pipelines intentionally remain on the full-resolution
path until restart-aware region decoding can preserve their coordinate semantics.
