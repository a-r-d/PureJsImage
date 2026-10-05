# JPEG XL lossless reversible-color search, October 5, 2026

The effort-1 encoder now tries a bounded sampled reversible-color transform on
eligible repeated-color images. It retains the preceding serialized file as a
size floor. An early repeat candidate limits subsequent literal serialization;
an exact lower bound on required ANS bits stops only files that cannot fit.
The search remains a first-party TypeScript implementation.

The codec source SHA-256 is
`239bf2414446881c31cb4a5936c1fa56b55e8e11ed38dfbb3e4b3e5edb7689df`.
The [production controls](results/lossless-rct-production-controls.json) record
the original inputs, independent decoders, actual public bundles, frozen peers
and measured costs. The [preceding spatial checkpoint](LOSSLESS-SPATIAL.md)
retains its original source and results.

## Lossless size

Four of the sixteen original effort-1 files shrink. Twelve remain byte-identical.
None grows. Both independent decoders reproduce every original native 8-bit
and 16-bit sample, including alpha and RGB beneath transparent pixels.
The complete replay checks 384,733,048 samples across 64 fresh decoder grids.

| Capped graphic | Preceding bytes | Current bytes | jSquash bytes | wasm-vips bytes |
| --- | ---: | ---: | ---: | ---: |
| im26-5032 | 289,879 | 268,214 | 301,588 | 268,611 |
| im26-5034 | 135,150 | 107,746 | 202,254 | 158,783 |
| im26-5052 | 119,792 | 92,849 | 217,711 | 179,817 |
| im26-5334 | 47,383 | 47,383 | 135,588 | 105,926 |

The map is now 397 bytes smaller than wasm-vips, closing its previous 7.92%
gap. All four capped graphics above are smaller than both frozen peers.
The transparency fixture also shrinks from 57,786 to 39,547 bytes.
The original 12 MP photo remains 7,452,825 bytes at effort 1, below both peers.

The same pinned jSquash 1.3.0 and wasm-vips 0.0.19 files and settings are used.
Their files and hashes are checked again without rerunning their encoders.
Equal effort numbers select different policies and do not imply equal work.

## Time and memory

The user has explicitly prioritized compression parity first, then speed while
preserving compression, then memory while allowing only minor speed hits.
The previous cost guards remain recorded with their original failed verdicts.
This candidate is accepted for its independently exact compression improvement.

The map study uses 21 fresh alternating pairs in isolated processes.
An independent audit verifies every participant, exact stream, original input,
closed ownership and settled garbage collection. It recomputes paired medians
and seeded 95% intervals without pooling older observations.

| Measurement | Paired median change | 95% upper bound |
| --- | ---: | ---: |
| Cold encode time | +37.20% | +39.88% |
| Warm encode time | +38.07% | +43.75% |
| Cold absolute peak RSS | +16.94% | +17.67% |
| Cumulative absolute peak RSS | +11.40% | +14.19% |

Cold median encode time is 664.5 ms before this change and 909.7 ms after it.
Warm medians are 708.9 ms and 993.3 ms. Cold peak-RSS medians are about
174.1 MiB and 204.6 MiB. Cumulative peak RSS includes both cold and warm
encoding in the same process. These costs are relative to the preceding
PureJsImage checkpoint and do not measure speed against WASM competitors.

Original public working-memory budgets still recover the same exact fallback
files. The 2,305,794-byte and 2,476,162-byte budgets retain 19,594-byte and
36,492-byte files. At default limits, those repeated 8-bit and 16-bit controls
shrink from 644 and 776 to 474 and 559 bytes. Independent decoders verify
all samples in both default and constrained files.

The original small effort-1 minimum remains 103,131 bytes, with the exact
1,888-byte fallback also available at its former 104,966-byte budget.
The effort-7 control retains its 221,988-byte minimum and exact 586-byte file.
One byte below each minimum fails closed and releases all owned allocations.

## Remaining gaps

The original Node report contains 48 lossless comparison cells. Of these,
45 have independently exact matching peer output and three have no exposed
matching competitor API. The current files are at or below the frozen peer
size in 40 of the 45 verified comparisons. The five remaining gaps are:

| Input | Effort | Competitor | Extra bytes | Size gap |
| --- | ---: | --- | ---: | ---: |
| im26-2018 | 1 | wasm-vips | 18,598 | 2.049% |
| im26-5032 | 7 | jSquash | 5,820 | 4.563% |
| im26-1416 | 7 | jSquash | 5,307 | 0.824% |
| im26-1416 | 7 | wasm-vips | 17 | 0.0026% |
| im26-2018 | 7 | jSquash | 23 | 0.0038% |

Additional original-size higher-effort controls retain their separate scope.
The screenshot remains 2.707% larger than jSquash. These finite counts do not
establish parity for every supported JPEG XL workflow.

The im26-2018 effort-1 file remains about 2.05% larger than wasm-vips.
Higher-effort lossless gaps include the map and screenshot against jSquash,
plus smaller photo gaps. The current effort-7 replay retains all sixteen
preceding files byte-for-byte with exact samples in both independent decoders.
All 56 native color cases also retain their encoded hashes and exact samples.
Both complete public packages retain their exports and fit the original
541,000-byte and 614,000-byte ceilings.

The [photo checkpoint](FILTER-AC.md) retains its separate source and results:
13 adequately matched comparisons and 11 unresolved comparisons. Its first
photo at SSIMULACRA2 70 remains 3.00% larger than wasm-vips. Float, CMYK,
animation and broader lossy compression require separate comparable evidence.
Overall compression parity remains open.
