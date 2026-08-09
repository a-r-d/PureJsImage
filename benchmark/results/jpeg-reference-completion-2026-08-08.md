# JPEG reference-completion benchmark

Environment: Intel(R) Core(TM) i7-10700 CPU @ 2.90GHz, Node v24.16.0, Linux x64. Every reported
output passed its correctness gate before timing counted.

## Chroma interpolation

The matched full decode used the pinned public-domain 4000x3000 tundra JPEG and compared raw RGB8
against Sharp/libvips/libjpeg fancy upsampling. The before measurement is current `main` at
`d2980ea`; the after measurement is this branch. Both used one warmup and five samples.

| Path | Median wall | MAE vs libjpeg | Maximum channel error |
| --- | ---: | ---: | ---: |
| Previous nearest expansion | 697.4 ms | 0.772 | 17 |
| Bounded bilinear expansion | 895.3 ms | 0.574 | 5 |

The quality path reduced mean error by 25.6% and the worst channel error from 17 to 5. It cost 28.4%
on this full 4:2:0 decode. Grayscale, RGB, CMYK/YCCK, and 4:4:4 retain direct paths; the added work is
limited to images whose YCbCr components actually require expansion.

The final source-tree confirmation command reported the same MAE and maximum error, a 1088.2 ms
median, and output SHA-256
`f63be628feb9f3a0b6b6be517c8f7b238f082bf46f1fb889de0b56fb7af161fc`.

## Restart-aware crop

The reproducible benchmark creates a 2048x1536 4:2:0 JPEG with `DRI=4`, then extracts the same
512x384 crop near the lower-right corner. `full` entropy-decodes and reconstructs the complete image;
`region` indexes bounded restart markers, seeks to the nearest restart, and reconstructs the crop
plus interpolation halos. Three isolated processes were used for each cold and warm row.

| Execution | Path | Median wall | Median absolute peak RSS | Entropy MCUs | IDCT blocks |
| --- | --- | ---: | ---: | ---: | ---: |
| Cold | full | 336.2 ms | 95.8 MiB | 12,288 | 73,728 |
| Cold | region | 71.1 ms | 92.4 MiB | 3,244 | 5,304 |
| Warm | full | 340.3 ms | 98.2 MiB | 12,288 | 73,728 |
| Warm | region | 67.2 ms | 95.2 MiB | 3,244 | 5,304 |

The restart-aware path was 4.7-5.1x faster for this crop, skipped 73.6% of entropy MCUs and 92.8% of
IDCT blocks, and produced the exact same SHA-256
`e350534b8f43f7d2e0fd892ec2aa4b4175a1156cd4c0f5a2e0ac196f6eb0c2a0`. The entropy reader retains
64 KiB of compressed data. Absolute RSS remains dominated by Node, the loaded codec, and the input;
the benchmark therefore does not claim a cold RSS reduction.

## Encoder modes

The isolated 2048x1536 encoder probe uses two warmups and five samples. jpeg-js independently
decoded every final output before the measurement counted; focused tests additionally decode native
grayscale and restart-marker output through Sharp/libjpeg.

| Mode | Median wall | Throughput | Absolute peak RSS | Output | PSNR |
| --- | ---: | ---: | ---: | ---: | ---: |
| 4:2:0 | 248.3 ms | 12.67 MP/s | 101.5 MiB | 1,492,375 bytes | 18.44 dB |
| 4:4:4 | 436.8 ms | 7.20 MP/s | 109.3 MiB | 2,660,990 bytes | 25.68 dB |
| Native gray | 149.4 ms | 21.05 MP/s | 91.5 MiB | 955,325 bytes | 34.66 dB |
| 4:2:0, `DRI=4` | 255.9 ms | 12.29 MP/s | 105.1 MiB | 1,496,677 bytes | 18.44 dB |

The restart output contained 3,071 ordered restart markers. Native grayscale avoids both RGB
expansion and chroma DCT work while retaining the same bounded row buffer.

Commands:

```sh
npm run bench:jpeg:upsampling
npm run bench:jpeg:region-rss
npm run bench:jpeg:encode -- 420
node --expose-gc benchmark/jpeg/encode-probe.ts 444
node --expose-gc benchmark/jpeg/encode-probe.ts gray
node --expose-gc benchmark/jpeg/encode-probe.ts restart
```
