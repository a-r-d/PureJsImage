# JPEG XL lossless spatial coding, October 5, 2026

The effort-1 encoder now tries three bounded spatial predictors and a fixed
262,144-entry repeated-residual history on eligible repeated-color images.
It keeps the former serialized stream as a size floor. The common ANS writer
also uses exact default literal packing and reuses unchanged residual contexts.

The codec source SHA-256 is
`0225a70baa805d18a0784edc0f46ef183ff1fb32587a573618f96fc3d4c66f64`.
The [production controls](results/lossless-spatial-production-controls.json)
record the original inputs, independent decoders, actual public packages,
frozen peers, working limits and four cost studies. The
[preceding checkpoint](LOSSLESS-REPEATS.md) keeps its original evidence.

## Lossless size

Four of the 16 original effort-1 files shrink relative to the preceding
checkpoint. Twelve remain byte-identical. None grows. All native 8-bit and
16-bit samples, transparent RGB, alpha and caller buffers stay exact.
Two independent decoders check 384,733,048 samples across 64 complete grids.
Both actual public bundles exactly match the qualified candidate bytes.

| Capped graphic | Preceding bytes | Current bytes | jSquash bytes | wasm-vips bytes |
| --- | ---: | ---: | ---: | ---: |
| im26-5032 | 328,459 | 289,879 | 301,588 | 268,611 |
| im26-5034 | 168,184 | 135,150 | 202,254 | 158,783 |
| im26-5052 | 170,236 | 119,792 | 217,711 | 179,817 |
| im26-5334 | 58,178 | 47,383 | 135,588 | 105,926 |

The im26-5032 gap drops from 22.28% to 7.92% above wasm-vips. It is now
smaller than jSquash. The other three graphics are smaller than both frozen
peers. The same original inputs and effort settings are retained; peer files
and hashes are checked again without rerunning their encoders.

The original 12 MP photo remains 7,452,825 bytes at effort 1, below both
frozen peers. The im26-2018 effort-1 file still exceeds wasm-vips by about
2.05%. Earlier effort-7 gaps remain open. A fresh replay of all 16 original
effort-7 inputs reproduces every preceding file byte-for-byte, with all samples
exact across 64 complete independent grids. The earlier effort-7 and lossy
tables retain their own source identities. Overall compression parity remains
open.

The [photo checkpoint](FILTER-AC.md) records 13 adequately matched quality
pairs and 11 unresolved pairs. Its first photo at SSIMULACRA2 70 still exceeds
wasm-vips by 3.00%. This lossless result does not establish a broader quality
lead or resolve those comparisons.

## Time and working memory

Each study uses 21 fresh alternating pairs in isolated processes. Cold and
warm encodes preserve the qualified streams, input samples and managed peaks.
Garbage collection settles before measurements. Independent audits verify all
raw participants and recompute paired medians and seeded 95% intervals.
All medians and upper bounds pass the unchanged 5% timing guard and the
human-authorized 15% absolute peak-RSS allowance. Earlier failures remain
separate and are not pooled.

| Input | Cold median change | Warm median change | Cumulative peak-RSS median change |
| --- | ---: | ---: | ---: |
| Graphic im26-5334 | -9.06% | -8.18% | -1.39% |
| Photo im26-1030 | -42.68% | -45.29% | -4.76% |
| Photo im26-1416 | -42.12% | -45.02% | -4.94% |
| Logo | -11.40% | -14.96% | -4.12% |

The optional spatial candidate can use more managed working memory.
The original 2,305,794-byte and 2,476,162-byte regression budgets still recover
their exact 19,594-byte and 36,492-byte files. At default limits, those repeated
native 8-bit and 16-bit cases shrink to 644 and 776 bytes.

The small RGB control still succeeds at its original 104,966-byte budget and
reproduces the exact 1,888-byte fallback. Its new minimum is 103,131 bytes;
one byte below fails before output and releases every owned allocation.
The effort-7 control retains its original 221,988-byte boundary and stream.

Both public packages retain their exports and fit the original 541,000-byte
and 614,000-byte ceilings. Re-encoding all 56 original native color cases
preserves every sample across 112 independent decoder grids. All preceding
encoded hashes remain unchanged.
