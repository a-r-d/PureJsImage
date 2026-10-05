# JPEG XL pooled predictor controls, October 3, 2026

Actual predictor training across groups improves one photo and makes the
513-pixel crop 23 bytes smaller than its retained ordinary file. Two photo
inputs still exceed their ordinary sizes. The prototypes remain experimental,
and overall compression parity remains open.

Production remains source
`fac18835564faddab14698f2832612e85aeaaaedc965f413e04725a85061b567`.
The retained comparison is in [PARITY.md](PARITY.md). The preceding integer-code
controls are in [SHARED-HYBRIDS.md](SHARED-HYBRIDS.md).

## Actual shared training

The first experiment trains one channel and spatial-property tree across the
selected raw local-color group planes. Training samples span the groups without
concatenating a complete plane or residual image. Weighted prediction histories
reset at every group boundary. Candidate predictors include the original
group choices plus the existing gradient and weighted predictors.

The second experiment adds stream group ID as a training property, using the
existing decoder convention. This lets the learned tree distinguish groups
that use different local color transforms. Both experiments retain the original
65,536 samples per channel, 256 leaves per channel, depth 16 and 128 entropy
model limit. Color transforms stay fixed, and each model uses the existing
hybrid integer-code choices.

These are actual common channel-root trees. The previous shared serialization
joined separately trained local subtrees under a group-root dispatch. Here,
predictor decisions themselves are trained on pooled samples. The group-aware
trees choose 35, 55, 92 and 1 group-property branches on the four inputs.

## Complete file results

All values are bytes. The experimental floor keeps the smallest complete file
among the previous shared model, uniform pooled tree and group-aware tree.
Actual table of contents bytes and padding are included in each comparison.

| Input | Retained ordinary | Previous shared | Uniform pooled | Group-aware pooled | Experimental floor |
| --- | ---: | ---: | ---: | ---: | ---: |
| im26-1416 | 649,404 | 641,051 | 640,822 | 640,597 | 640,597 |
| im26-2018 | 613,268 | 614,379 | 615,935 | 615,952 | 614,379 |
| im26-2018, one-level red dither | 617,106 | 619,207 | 627,668 | 626,130 | 619,207 |
| im26-1416, 513 × 512 crop | 227,797 | 228,139 | 227,774 | 227,778 | 227,774 |

The crop now beats its ordinary size by 23 bytes. The first photo is 8,807 bytes
smaller than its ordinary file. The other two experimental floors remain
1,111 and 2,101 bytes larger. The complete controls are in
[pooled-predictor-tree-controls.json](results/pooled-predictor-tree-controls.json)
and [group-pooled-predictor-tree-controls.json](results/group-pooled-predictor-tree-controls.json).

## Headers and residuals

Both common learners reach 769 leaves on each photo: 256 for each RGB channel
and one for flat alpha. The crop uses 253 leaves. The uniform tree uses
128, 125, 128 and 63 entropy models; the group-aware tree uses
128, 123, 128 and 63.

The following changes compare each raw candidate with its matched prior
complete-file floor. Outer bytes are unchanged. Fractional bytes represent
bit extents within sections.

| Candidate and input | Header change | Remaining data change | Whole-file change |
| --- | ---: | ---: | ---: |
| Uniform, im26-1416 | +112.125 | −341.125 | −229 |
| Uniform, im26-2018 | +54.625 | +1,501.375 | +1,556 |
| Uniform, red dither | −297.625 | +8,758.625 | +8,461 |
| Uniform, 513-pixel crop | −129 | −236 | −365 |
| Group-aware, im26-1416 | +66.5 | −291.5 | −225 |
| Group-aware, im26-2018 | −14.25 | +1,587.25 | +1,573 |
| Group-aware, red dither | −251.625 | +7,174.625 | +6,923 |
| Group-aware, 513-pixel crop | +3.25 | +0.75 | +4 |

The two photo regressions come mainly from larger remaining data. Smaller
headers and the group feature do not make up for that growth. The tree cap is
active on every photo, which is useful evidence for the next model-design
investigation; it does not prove that increasing the cap would be worthwhile.

The complete profiles verify every bit region, actual global inheritance,
selected transforms, legal properties and exact selected-floor programs:
[uniform profile](results/pooled-predictor-tree-program-profile.json) and
[group-aware profile](results/group-pooled-predictor-tree-program-profile.json).

## Validation and limits

All 24 files reproduce every original color and alpha sample in pinned libjxl,
Rust and the public decoder. The independent checks cover 48 grids and
151,019,520 original samples. Public checks cover 75,509,760 samples with
complete, nonduplicate pixel coverage. Exact baseline and floor hashes, input
identity and encoder allocation closure pass.

Capturing planes and testing multiple trees changes scratch ownership and adds
work. These diagnostic observations do not establish a runtime or RSS gain.
The original paired costs, working-memory limits, package size, broader
compression floors and public compatibility corpus still require qualification
before adoption. Production source, dependencies, version and published
comparison matrices remain unchanged.
