# JPEG XL photo model investigation, October 3, 2026

## Current answer

Overall compression parity remains open. The original 12 MP lossless photo gap
is closed: the qualified encoder produces 7,452,825 bytes at effort 1 and
6,220,181 bytes at effort 7, below both pinned WASM results. Some other lossless
inputs and matched lossy comparisons still have larger files.

This investigation examines two remaining lossless photo examples. Every size
uses the original RGBA8 input, including alpha, at effort 7. All production and
experimental files reproduce every sample in pinned libjxl, Rust and the public
PureJsImage decoder. Inputs and source hashes remain fixed. Effort numbers do
not imply equal computation across encoders.

The qualified production source is
`fac18835564faddab14698f2832612e85aeaaaedc965f413e04725a85061b567`.
The experiments below use temporary copies and have not been adopted.

| Input | Current PureJsImage | jSquash 1.3.0 | wasm-vips 0.0.19 |
| --- | ---: | ---: | ---: |
| im26-1416, 1024 × 768 | 649,404 | 644,097 | 649,387 |
| im26-2018, 1024 × 1024 | 613,268 | 613,245 | 621,262 |

The first photo's jSquash gap is 5,307 bytes (0.824%). The second differs by
23 bytes. These examples do not establish a broader ranking. The latest full
lossless and quality matrices remain in [PARITY.md](PARITY.md).

## More tree leaves save little on these photos

The current learner allows 256 leaves per channel. Increasing only that limit
preserves the original training samples, predictors, depth, histogram limit,
grouping and entropy code.

| Per-channel leaf limit | im26-1416 bytes | im26-2018 bytes |
| --- | ---: | ---: |
| 256, unchanged control | 649,404 | 613,268 |
| 320 | 649,173 | 612,882 |
| 384 | 648,941 | 612,748 |

The largest saving is 520 bytes. Single encode observations also show more
work at the larger limits. They do not qualify the original paired runtime and
RSS protections. Neither limit was retained. The complete controls and their
sample proofs are in [photo-leaf-cap-controls.json](results/photo-leaf-cap-controls.json).

## Matching native group dimensions is insufficient

Current production encodes each photo as one 1024-pixel group. The pinned native
files use 12 or 16 groups of 256 pixels. We tested the existing PureJsImage
adaptive group path at 512 and 256 pixels, then reduced its per-group training
budget from 65,536 to 4,096 samples. This changes the group path together with
its existing color and model decisions.

| Group policy | im26-1416 bytes | im26-2018 bytes |
| --- | ---: | ---: |
| Current single group | 649,404 | 613,268 |
| 512 pixels, 65,536 training samples | 668,448 | 638,872 |
| 256 pixels, 65,536 training samples | 675,916 | 647,790 |
| 256 pixels, 4,096 training samples | 684,643 | 656,690 |

All requested group layouts were selected and all files remain lossless. The
alternatives use less tracked scratch storage, but grow by 2.93–7.08%. They were
rejected for compression. Details are in
[photo-group-layout-controls.json](results/photo-group-layout-controls.json).

## Where the bytes differ

The [complete program profile](results/photo-group-program-profile.json) reads
every global and local group header. No transform header is skipped, and every
section bit is accounted for.

| im26-1416 | Header bits divided by 8 | Remaining section bits divided by 8 |
| --- | ---: | ---: |
| Current PureJsImage | 4,322.75 | 645,026.25 |
| jSquash | 4,517.00 | 639,528.00 |
| PureJsImage, 256-pixel groups | 7,346.875 | 668,476.125 |

Fractional byte values describe bit extents inside sections. The remaining bits
include residuals, final entropy states, palette prefix samples and padding.
Container and section-table bytes are separate from this table.

Our current first-photo header is already smaller than jSquash's. Most of its
remaining gap is in the data following those headers. For im26-2018, the header
difference is only 22.5 bytes and the remaining section difference is 9.5 bytes;
container and section-table differences reduce the complete-file gap to 23.

jSquash shares one learned tree and 128 or 124 entropy models across all photo
groups. Both native APIs also select local reversible color transforms, using
types 10, 12, 26 and 40 on these inputs. The first photo has scalar palettes in
some native groups. Our tested adaptive path uses one fixed global transform,
type 6, and separate local models. Its headers and remaining data both grow.

These observations support investigating local color decisions and shared
models. They do not assign the complete size gap to one feature. All inspected
global tree offsets are zero and multipliers are one, so those fields provide
no additional lead for these photos.

## Local color decisions help, but need a selection policy

The next control applies the existing first-party color-transform selector to
each group. It samples at most 4,096 positions, considers 42 legal transforms,
and reads strided groups directly from the original pixels. Matching local
transform headers replace the fixed global transform. Predictor, tree, training,
entropy, cache and working limits stay unchanged.

| Group policy | im26-1416 bytes | im26-2018 bytes |
| --- | ---: | ---: |
| Current production | 649,404 | 613,268 |
| 256 pixels, fixed global transform | 675,916 | 647,790 |
| 256 pixels, sampled local transforms | 651,257 | 622,029 |
| 512 pixels, sampled local transforms | 641,956 | 615,721 |

Local transforms recover 24,659 and 25,761 bytes on the otherwise identical
256-pixel group path. The 512-pixel candidate beats both pinned rivals on the
first photo, saving 7,448 bytes against production. It grows by 2,453 bytes on
the second. All eight files preserve every original sample, but the broad policy
was rejected for that regression.

The [local color controls](results/photo-local-rct-controls.json) retain both
baselines, every result and the independent sample proofs. They establish a
specific compression opportunity rather than production parity. Choosing when
to use this path, preserving existing file sizes, and qualifying representative
runtime and RSS remain necessary before adoption. Shared-tree coding remains a
separate untested implementation change.
