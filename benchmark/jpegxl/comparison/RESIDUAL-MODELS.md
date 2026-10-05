# JPEG XL predictor costs, October 3, 2026

The shared predictor experiments regress mainly because costs within prediction
leaves grow. Histogram pooling improves on the two problem inputs. Serialized
frequency rounding contributes much less to the difference. Compression parity
remains open, and these prototypes have not changed production.

The retained comparison is in [PARITY.md](PARITY.md). The common predictor
controls are in [POOLED-TREES.md](POOLED-TREES.md).

## Measured residual costs

A copied first-party decoder observes each residual read and reconstructs every
original sample. It checks exact group initialization, ANS normalization reads,
hybrid extra bits, ending state, padding and complete pixel coverage. All 24
files reconstruct 75,509,760 samples in 84 groups with zero error. The native
and Rust grids from the earlier controls remain pinned; those independent
checks were performed before this profiling pass.

Empirical token entropy is an estimate from complete observed token counts.
The profile separates entropy within individual leaves, additional entropy from
pooling leaves into a model, and the cost of serialized frequencies relative to
empirical model entropy. Hybrid extra bits are added to the within-leaf term.
These estimates use the observed integer coding configurations. They do not
represent independently achievable byte savings.

The following changes compare each raw common tree with its matched previous
complete-file floor. Values are bits, rounded to three decimal places.

| Tree and input | Within-leaf tokens plus extra bits | Histogram pooling | Frequency rounding | Actual residual reads |
| --- | ---: | ---: | ---: | ---: |
| Uniform, im26-1416 | +538.144 | −3,181.443 | −44.283 | −2,708 |
| Uniform, im26-2018 | +22,005.842 | −10,019.214 | +31.255 | +12,009 |
| Uniform, red dither | +82,979.795 | −12,739.825 | −145.271 | +70,076 |
| Uniform, 513-pixel crop | −2,823.871 | +837.903 | +103.791 | −1,886 |
| Group-aware, im26-1416 | −1,971.335 | −385.517 | +24.308 | −2,343 |
| Group-aware, im26-2018 | +22,408.510 | −9,592.779 | −112.627 | +12,705 |
| Group-aware, red dither | +70,508.043 | −12,994.431 | −86.911 | +57,398 |
| Group-aware, 513-pixel crop | −18.193 | +13.534 | −0.491 | +10 |

The estimated terms sum to estimated token and extra-bit cost. Actual reads
also reflect finite ANS state and word boundaries. Headers and padding are
accounted for separately in the complete-file profiles. Per-channel ANS read
positions follow decoder order and are not independent channel code lengths.

The first coded channel accounts for most of the within-leaf cost growth on
im26-2018. All three coded color channels grow on the dithered input. Coded
channels can have different meanings in groups with different local reversible
color transforms.

## Existing leaf allocation

Exact tree dispatch establishes the following static allocations. Shared
leaves count once globally. Channel indices refer to the transformed planes.

| Input | Previous joined allocation, channels 0 / 1 / 2 / alpha | Common allocation |
| --- | --- | --- |
| im26-1416 | 261 / 247 / 263 / 4 | 256 / 256 / 256 / 1 |
| im26-2018 | 408 / 219 / 240 / 4 | 256 / 256 / 256 / 1 |
| Red dither | 414 / 299 / 248 / 4 | 256 / 256 / 256 / 1 |
| 513-pixel crop | 82 / 82 / 91 / 2 | 82 / 79 / 91 / 1 |

The common photo trees reach their fixed 256-leaf limit in every coded color
channel. Flat alpha uses one leaf. This supports testing allocation by split
benefit within the existing combined channel budget. It does not establish
that another allocation will reduce complete files.

The complete data and read-only audit are in the
[residual profile](results/pooled-residual-cost-profile.json),
[leaf profile](results/pooled-residual-leaf-cost-profile.json) and
[model audit](results/pooled-residual-model-audit.json).

## Allocating the combined budget

The next control lets the same training evaluator choose the next split across
channels, within the existing combined limit of 1,024 leaves for RGBA. The
65,536 samples per channel, depth 16, predictor and property candidates, local
color transforms, integer coding choices and 128-model limit stay fixed. Each
trainer exposes its retained typed arrays to the encoder's scoped ownership
tracking, and training scratch is released before residual reconstruction.

| Input | Previous complete-file floor | Raw allocation candidate | Channel leaves, 0 / 1 / 2 / alpha | Header change | Remaining data change |
| --- | ---: | ---: | --- | ---: | ---: |
| im26-1416 | 640,597 | 640,578 | 404 / 235 / 384 / 1 | +587.375 | −606.375 |
| im26-2018 | 614,379 | 617,582 | 792 / 108 / 123 / 1 | +704.75 | +2,498.25 |
| Red dither | 619,207 | 628,122 | 740 / 136 / 147 / 1 | +465.375 | +8,449.625 |
| 513-pixel crop | 227,774 | 227,778 | 82 / 79 / 91 / 1 | +3.25 | +0.75 |

File sizes and changes are bytes. Outer bytes are unchanged. The complete-file
floor saves 19 bytes on the first photo and preserves the three other previous
files. The two photo regressions worsen in the raw candidate. The evaluator
allocates most capacity to coded channel 0 on those inputs and reduces capacity
in the other color channels. This supports testing a reservation for each
channel before distributing spare flat-channel capacity.

All 12 files pass 24 native and Rust grids covering 75,509,760 original samples.
The public decoder checks another 37,754,880 samples with complete coverage.
Baseline and selected-floor hashes, input identity and allocation closure pass.
The [allocation controls](results/budget-pooled-predictor-tree-controls.json)
and [complete program profile](results/budget-pooled-predictor-tree-program-profile.json)
record the result. Runtime, RSS, working-memory fallback, package size and
broader public qualification remain open for these prototypes.

## Reserving the original channel budgets

A second allocation control first lets each channel use its original allowance
of up to 256 beneficial leaves. It then assigns spare capacity by split benefit
within the same 1,024-leaf total. Flat alpha still needs only one leaf.

| Input | Previous complete-file floor | Raw reservation candidate | Channel leaves, 0 / 1 / 2 / alpha | Header change | Remaining data change |
| --- | ---: | ---: | --- | ---: | ---: |
| im26-1416 | 640,578 | 640,549 | 391 / 256 / 376 / 1 | −37.875 | +8.875 |
| im26-2018 | 614,379 | 615,917 | 511 / 256 / 256 / 1 | +747.625 | +790.375 |
| Red dither | 619,207 | 626,279 | 511 / 256 / 256 / 1 | +396.375 | +6,675.625 |
| 513-pixel crop | 227,774 | 227,778 | 82 / 79 / 91 / 1 | +3.25 | +0.75 |

Values are bytes, and outer bytes stay unchanged. Reservation reduces both
problem photos relative to the unrestricted greedy allocation, but neither
beats its earlier complete-file floor. The first photo saves another 29 bytes.
Together, the allocation controls save 48 bytes there. Their selected floors
preserve the other three previous files.

The first photo's final experimental file is 640,549 bytes, compared with its
649,404-byte retained ordinary file. The other two photo floors still exceed
their ordinary files by 1,111 and 2,101 bytes. The crop remains 23 bytes smaller
than its ordinary file. These gains remain isolated experiments.

All 12 reservation files pass native, Rust and public original-sample checks,
with the same counts and coverage gates as the preceding allocation control.
See the [reservation controls](results/reserved-pooled-predictor-tree-controls.json)
and [program profile](results/reserved-pooled-predictor-tree-program-profile.json).

Allocation alone has not solved the residual-cost regressions. The next useful
measurement is how sampled split costs compare with complete observed leaf
costs under the final integer configurations. That remains a hypothesis.
Production source, qualified matrices, dependencies, version and original cost,
memory and package protections stay unchanged. Overall compression parity
remains open.
