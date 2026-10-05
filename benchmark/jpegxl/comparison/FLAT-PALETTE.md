# JPEG XL palette controls preserving flat colors, October 3, 2026

Preserving colors found in flat regions improves the private graphic controls.
It addresses the gray-tone error identified in the
[earlier maps](PALETTE-ERRORS.md). A privately built public encoder now emits the
same verified files and fits the existing package caps. The retained production
encoder is unchanged, and overall compression parity remains open.

The rule selects every original color that occurs in a uniform opaque 2 by 2
square. On the complete pinned 1024 by 1024 text graphic, it selects three colors
and preserves 991,976 of 1,048,576 pixels. The other 56,600 pixels contain
antialias and edge detail. Larger 3 by 3 and 5 by 5 squares select the same colors.
The rule uses original image structure and no measured error coordinates, chosen
color constants or quality feedback.

The controls round the other colors' green component and add the same offset to
red and blue, with endpoint clipping. Alpha stays exact. The first-party
lossless Modular writer then codes the deliberately changed colors.

| Quantization step | Bytes | SSIMULACRA2 | Butteraugli |
| --- | ---: | ---: | ---: |
| 16 | 24,507 | 91.584 | 1.484 |
| 32 | 20,397 | 89.553 | 2.384 |
| 64 | 14,617 | 84.390 | 4.820 |
| 128 | 12,587 | 70.399 | 9.868 |
| 256 | 8,737 | 42.083 | 14.977 |

The first three controls improve file size and both quality metrics compared
with the previous four-frequency-color policy. At step 16, its Butteraugli error
was 6.356. The new error is 1.484. The new map has 213 values above one and none
above three, compared with 4,208 and 1,557 previously. The largest error moves
to antialias detail. Stronger quantization still damages that detail.

All five complete controls pass ten full native and Rust grids containing
41,943,040 samples. Separate audits select uniform squares directly from
original RGBA bytes, sort qualifying colors, independently derive every expected
pixel and rerun both quality tools within 1e-9. Three full distance maps validate
3,145,728 finite nonnegative samples and preserve the metric scalars.

The private integration proposes a step of distance times eight for the existing
optional effort-7 nonprogressive sRGB RGBA8 small-palette branch. It quantizes
only opaque inputs at distance two or higher, preserves original input and
alpha, and uses the existing managed allocation scopes and optional LIMIT
fallback. It precomputes changed colors once per palette instead of repeating
the arithmetic for every pixel. The step-256 control is an experimental endpoint
outside the proposed public distance range, not a supported public request.

| Public request in the private build | Bytes | SSIMULACRA2 | Butteraugli |
| --- | ---: | ---: | ---: |
| Lossy effort 7, distance 1 | 37,687 | 100.000 | 0.000 |
| Lossy effort 7, distance 2 | 24,507 | 91.584 | 1.484 |
| Lossy effort 7, distance 8 | 14,617 | 84.390 | 4.820 |

These requests use the complete original graphic through the actual measured
package's `jpegxlCodec.createEncoder`. Distance one reproduces the qualified
original file hash. Distances two and eight reproduce the independently audited
control hashes. A separate audit checks six full native and Rust grids with
25,165,824 samples, exact original alpha and both metric reruns. Actual owned
allocations close at zero. These are additional encodings of three existing
control contents, not three additional points on the quality curve.

The first integration exceeded the existing package caps. A further variant
shares repeated literal error-message prefixes using a first-party helper.
All 1,356 converted literal comparisons preserve the exact ImageError class,
name, code and message. It includes none of the previously rejected predictor,
token or learner changes. Prefix-only packages reproduce their previous measured
sizes. Prefix plus the palette policy measures 537,540 core and 609,451
specialized bytes, within the unchanged 541,000 and 614,000 caps. Both export
inventories remain identical.

The five quality points are too far apart to meet the existing 0.25-score matching
limit. They establish a useful curve and a valid private integration, but supply
no new adequately matched public comparison. The retained comparison remains
thirteen adequate and eleven unresolved pairs. Browser behavior, natural memory
fallback, representative paired costs, the broader input matrix and source
adoption still need verification. One-off timings and observed allocations do
not establish a speed or general memory claim.

[Final physical evidence](results/flat-palette-final-gates.json) preserves the
separate scopes and private status. Raw files, private source copies, maps and
audits remain in the ignored comparison workspace.
