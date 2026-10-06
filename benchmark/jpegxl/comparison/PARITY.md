# JPEG XL compression parity work, October 3, 2026

## Current result

The October 5 [alpha palette search](ALPHA-PALETTES.md) reduces the original
transparency coordinates by 81–85% with identical complete native/Rust pixels.
One 9,155-byte higher-quality point dominates the frozen 9,307-byte exact-alpha
wasm-vips point on file size and both metrics. This leaves the frozen 13 adequate
and 11 unresolved pair counts unchanged. The original photo score-70 gap is
still open. Internal package ceilings increase by 3,000 bytes for this gain;
the previous failures and package limits remain recorded at their checkpoints.

The October 5 [lossless group search](GROUP-SEARCH.md) closes all three
remaining measured integer-lossless gaps. Current files meet or beat frozen
peer size in all 45 independently exact comparable main cells and all four
separate original-size photo/screenshot controls. The remaining photo files
are 819,166 bytes at effort 1 and 641,956 at effort 7. The original screenshot
is 386,813 bytes. Six effort-1 files and four effort-7 files shrink; none grows.
Every original native sample, hidden RGB and alpha remains exact in two
independent decoders. Original working-budget streams and minimum boundaries
remain exact. Both packages preserve exports and their original ceilings.
Thirty changed-path cases pass in Chromium, Firefox and WebKit. This is
integer-lossless parity on the pinned corpus. Eleven lossy comparisons and
broader float, CMYK and animation compression remain unresolved; overall parity
remains open. Earlier checkpoints below retain their source identities.

The October 5 [reversible-color search](LOSSLESS-RCT.md) closes the effort-1
map gap: 268,214 bytes, versus 268,611 for wasm-vips and 301,588 for jSquash.
Four original files shrink and twelve remain byte-identical. Every native
sample stays exact in two independent decoders. Both complete public packages
match the independently qualified candidate bytes. The user now prioritizes
compression parity before speed and memory. The map costs about 37-38% more
encoding time and 17% more cold peak RSS than the preceding checkpoint;
original working budgets still recover their exact streams. Higher-effort
lossless gaps and 11 unresolved quality comparisons remain open.

The October 5 [lossless spatial coding](LOSSLESS-SPATIAL.md) reduces four more
of the 16 original effort-1 files; twelve keep the preceding checkpoint's exact
bytes. Every native sample stays exact in two independent decoders.
The remaining im26-5032 map gap drops from 22.28% to 7.92% above wasm-vips.
The other three capped graphics are below both frozen peers. Four fresh
21-pair cost studies pass the 5% timing guard and human-authorized 15% RSS
allowance. Original working budgets recover their former exact streams.
Other lossless gaps and 11 unresolved quality comparisons remain open.

The October 4 [photo filter and AC symbol reuse](FILTER-AC.md) is
integrated with the [learned DC model](DC-MODELS.md). Both tested photos are
smaller than the frozen WASM peers at SSIMULACRA2 80. The first photo still
exceeds wasm-vips by 3.00% at score 70. The original full cohort keeps all
32 lossless outputs unchanged at that checkpoint; 27 lossy files change under the photo policy.
Those fixed-request files grow slightly, with no SSIMULACRA2 regressions and
ten Butteraugli regressions. Separate photo and graphic cost studies pass the
unchanged 5% timing guard and authorized 10% absolute RSS allowance.
Overall parity remains open.

The October 4 [palette confirmation](FLAT-PALETTE-CONFIRMATION.md) records the
later integrated graphic improvement, corrected production checks and qualified
numeric predictor reuse. The cache preserves the corrected original 123-file
matrix and passes separate fresh graphic and lossless cost studies with the
authorized 10% RSS allowance.
Combined quality sampling now has 13 adequate comparisons and 11 unresolved
comparisons. [Photo controls](OPAQUE-PHOTO-CONTROLS.md) record promising
unadopted filter results and their remaining quality tradeoffs. The historical
checkpoints and frozen tables below retain their original source identities.

The effort-1 changes close the two large-input lossless size gaps from the
public comparison. The new effort-7 learned models also bring the large and
capped photo examples below both frozen WASM results. Later reversible color
search closes another capped photo's wasm-vips gap. Exact flat-background patches
also bring the screenshot and another graphic below wasm-vips. Every original
sample remains exact in pinned libjxl 0.12.0 and jxl-rs. Several inputs still
exceed jSquash, and lossy quality still has compression gaps. The full parity
goal remains open.

All sizes below are bytes. Competitor values come from the frozen same-input
public comparison, with jSquash 1.3.0 and wasm-vips 0.0.19. Effort numbers select
each encoder's own policy and do not imply equal computation.

| Input, effort 1 | Prior PureJsImage | Current PureJsImage | jSquash | wasm-vips |
| --- | ---: | ---: | ---: | ---: |
| 4000 × 3000 photo | 15,389,193 | 7,452,825 | 9,306,869 | 8,176,908 |
| 1920 × 1080 screenshot | 1,892,396 | 619,382 | 818,510 | 652,930 |
| 924 × 1386 transparent sunset logo | 1,162,739 | 850,887 | 1,171,329 | 1,142,468 |

The photo shrinks 51.6% and the screenshot 67.3% against the prior encoder.
The photo is 8.9% smaller than wasm-vips at effort 1; the screenshot is 5.1%
smaller. These two examples do not establish a broader compression ranking.

The first effort-1 candidate codec source SHA-256 is
`ea30935f43c9dde7bbedcb7c6c7ce38d6145f33a99034bae44af5724e985a428`.
The original investigation retains its earlier source identity and unchanged
tables in [COMPRESSION.md](COMPRESSION.md).

## Earlier full lossless matrix

The earlier [effort-1](results/parity-funded-sampling-effort1-public.json) and
[effort-7](results/parity-funded-sampling-effort7-public.json) public replays use source
`fac18835564faddab14698f2832612e85aeaaaedc965f413e04725a85061b567`.
Both runs reproduce every original sample for all sixteen inputs in pinned libjxl and Rust, including native 16-bit samples, alpha and hidden RGB. All effort-1 encoded hashes remain unchanged. The effort-7 screenshot shrinks another 5,351 bytes against qualified source 72fb3bbc; the other fifteen files keep identical bytes. Earlier metadata and grouping corrections retain their own source identities and measurements.

The [quality replay at this checkpoint](results/quality-funded-sampling-public.json) encodes all 91 fixed lossy settings through the same frozen public modules. Every complete file, full independent pixel grid, original alpha sample and quality coordinate remains unchanged.

| 4000 × 3000 photo | This checkpoint | Pinned jSquash | Pinned wasm-vips |
| --- | ---: | ---: | ---: |
| Effort 1 | 7,452,825 | 9,306,869 | 8,176,908 |
| Effort 7 | 6,220,181 | 6,899,188 | 6,648,964 |

The effort-7 screenshot at this checkpoint is 401,990 bytes, versus 391,394 for jSquash and 422,389 for wasm-vips. Its jSquash gap is 2.707%. Several lossless inputs still exceed one or both rivals. At this checkpoint, the first photo is 4.51% larger than wasm-vips at lossy score 80, and thirteen quality comparisons remain unresolved. The later photo result described above closes that score-80 gap and leaves eleven quality comparisons unresolved. No overall compression parity or speed improvement is claimed. The runner rejects source or built-module changes during a measurement.

## What changed

Large effort-1 images previously used one shared prefix histogram, left
prediction and no color transform. The new candidate uses bounded 1024-pixel
groups, separate channel models, sampled left/top/gradient prediction, and
an actual encoded-size choice between raw channels and reversible YCoCg.
Constant channels use a tree offset, so their first sample also has a zero
residual. This removes the opaque-alpha bit-per-pixel penalty.

Each group compares prefix codes, ANS literals and ANS with one bounded match
history. The previous complete frame representation remains a candidate.
Selection includes the section table, so a new candidate cannot enlarge the
chosen frame merely by moving bytes between groups.

The prefix-only probe reduced the photo to 8,559,876 bytes and screenshot to
1,168,741 bytes. Adding ANS and repeat coding produced the final values above.
Constant-alpha and unrelated-channel regressions prompted these additional
literal and repeat alternatives before retaining the change.

## Effort-7 learned models

This later checkpoint uses codec source SHA-256
`5a09ad8e5bd6d11280a4d991225d6721096c2f3b565c632681db085994a39e73`.
The effort-1 table above retains its separately validated checkpoint identity.

| Input, effort 7 | Prior PureJsImage | Current PureJsImage | jSquash | wasm-vips |
| --- | ---: | ---: | ---: | ---: |
| 4000 × 3000 photo | 7,036,157 | 6,275,239 | 6,899,188 | 6,648,964 |
| 1024 × 768 photo | 611,525 | 487,110 | 535,279 | 515,866 |
| 1920 × 1080 screenshot | 575,690 | 452,233 | 391,394 | 422,389 |

The large photo is 5.6% smaller than wasm-vips and 9.0% smaller than jSquash
on this input. The screenshot still exceeds wasm-vips by 7.1% and jSquash by
15.5%. These are compression comparisons at each encoder's effort-7 policy,
not equal-compute comparisons.

The prior higher-effort writer mainly split channels and the sign of one
gradient. Pinned native streams use richer conditional models. The native
capped photo has 1,508 leaves and 128 histograms. The screenshot's first
nonpreview frame is a reference atlas with 152 leaves and 40 histograms.
Most branches test gradients in several directions. These counts describe the
inspected frames; they do not measure the final displayed pixels' models or
which properties caused a particular size saving.

The first-party learner samples at most 65,536 positions per channel, tests
five directional gradient properties and the weighted predictor's local error,
and expands the leaf with the highest estimated saving. Each leaf selects
the existing channel predictor, clamped gradient or weighted prediction using
token entropy and hybrid extra-bit cost. Each channel permits at most 256
leaves and depth 16. Full-input residual histograms merge into at most 128 ANS
distributions. Existing candidates remain in the actual encoded-size search.

This applies to unsqueezed, unpaletted integer groups at effort 7, in both
single-group and multi-group frames. It preserves one group's planar,
residual, sample and histogram scratch alongside staged input. It does not
add another source-sized pixel bitmap. Native float and CMYK writers have
separate implementations and still need separate compression evidence.

The full check exposed a timeout on a highly repeating 24 MP image. Its raw
learned models lost to an existing palette representation. Training now skips
near-zero raw streams and raw streams already beaten by a palette costing less
than half a bit per residual. The repeating diagnostic keeps identical bytes
and exact independent samples. The 24 MP effort-7 memory test passes in 63.13
seconds with the original 120-second timeout and 256 MiB working limit.

At this learned-model checkpoint, the source was rebuilt and checked through public package entry points on all
16 pinned inputs. Both independent decoders reproduce every uint8/uint16
sample, including invisible RGB and alpha. The large photo and screenshot
match their direct-worker encoded hashes. Among the eight capped diagnostic
inputs with frozen effort-7 rows, five shrink and three remain byte-identical.
Five of those eight files are smaller than wasm-vips; three are smaller than
jSquash. A general parity claim would exceed this evidence.

The direct photo observation takes 82.21 seconds of core encoding, with
462,049,280 bytes peak RSS and 172,298,618 bytes peak owned storage. The
screenshot takes 13.16 seconds, with 313,802,752 bytes peak RSS and 128,513,649
bytes peak owned storage. Owned storage unwinds to zero. Public-adapter
observations have separate timing boundaries and appear in the public report.
This added search prioritizes compression and does not establish a speed gain.

The capability adds 8,276 minified bytes to Core + JPEG XL and 8,261 bytes to
the specialized APIs. Their measured sizes are 524,011 and 596,602 bytes. The
two package-size ceilings explicitly allow this first-party algorithm; their
original recorded baselines remain unchanged. No runtime dependency was added.

Evidence:

- [Photo](results/parity-effort7-photo.json) and [screenshot](results/parity-effort7-screenshot.json): isolated encoding observations and complete independent sample checks.
- [All 16 pinned public inputs](results/parity-effort7-public.json): native sample grids, input and output identities, previous capped-case sizes and public-adapter observations.
- [Procedural cases](results/parity-effort7-fixtures.json): exact 8/16-bit output in both independent decoders, with signed gradients, mixed texture, hidden RGB, nonconstant alpha and both group modes. The later page checkpoint adds two patch cases and requalifies all six.
- [Native tree profile](results/modular-tree-investigation.json) and [emitted candidate trees](results/learned-tree-investigation.json): structural models and histogram counts.
- At the learned-model checkpoint, five focused Node cases and four real Chromium cases pass. Chromium checks require identical encoded checksums and exact output sample grids. Browser build checks pass. Its complete `npm run check` passes 263 files and 3,500 tests, with one file and three tests skipped. It includes the 96 MiB single-group and 256 MiB 24 MP memory gates. All 16 public outputs retain the earlier learned checkpoint's hashes and pass both independent decoders.

Attempts JXLMOD-063 through JXLMOD-078 record the controls, retained changes and
reverted regressions in the optimization log. Ignored artifacts and bounded-run
receipts preserve each observation without adding binary fixtures to Git.

## Exact lossless page patches

The later page checkpoint uses codec source SHA-256
`31be4c3ba24fecb6a6ebd4f24ea8d0e37b7743368102d23020ea9c29d79d32e3`.
The photo and screenshot bytes above remain unchanged. Three capped graphics
shrink, with every sample exact in both independent decoders through rebuilt
public package imports.

| Capped input, effort 7 | Learned checkpoint | Current PureJsImage | jSquash | wasm-vips |
| --- | ---: | ---: | ---: | ---: |
| im26-5034 | 62,171 | 48,630 | 44,936 | 83,555 |
| im26-5052 | 46,936 | 21,977 | 18,517 | 91,638 |
| im26-5334 | 27,624 | 25,724 | 44,579 | 75,359 |

The first two graphics decrease 21.8% and 53.2% against the learned checkpoint.
They still exceed jSquash by 8.2% and 18.7%. All eight capped inputs now shrink
against the original public comparison. Five remain below wasm-vips and three
below jSquash. These results do not establish general compression parity.

The pinned jSquash graphics use a reference atlas followed by a displayed frame
with patches. Our existing document writer now offers an exact lossless RGB8
or RGBA8 candidate. It stores repeated, byte-identical rectangles in an atlas
and replaces every color and alpha sample at each placement. Unpatched samples
retain their original values. The small reference uses the requested effort,
and the complete ordinary file remains the size floor. The existing palette
order search also covers single-group images through 1,048,576 pixels.

The patch search applies at effort 7 to pale pages with 262,144 through
4,194,304 pixels and 8-bit sRGB samples. It requires at least 40 repeated
placements and sufficient covered rectangle area. The existing lossy document
heuristic keeps its separate threshold and sample rounding. The lossless path
reserves another staged display copy and an atlas of at most 1,024 by 1,024
pixels. Allocation-limit failures during this extra search retain the ordinary
candidate. Baseline encoding still reports a structured limit error when its
own storage cannot fit.

The inspected im26-5052 patch file uses 676 exact Replace placements, while
jSquash uses 690 additive placements. On im26-5034 our reference rectangles
cover 34,088 unique pixels, against jSquash's 29,458. Their display section
totals differ by 384 bytes, while our reference sections cost 3,302 more bytes.
These structural differences guide the next experiments; they do not prove a
causal size penalty for a particular blend mode.

One direct observation for im26-5052 records 35.89 seconds of core encoding,
242,032,640 bytes peak RSS and 37,034,113 bytes peak owned storage. The other
graphic records 60.86 seconds, 336,662,528 bytes peak RSS and 131,328,723 bytes
peak owned storage. Owned storage returns to zero. The first observation
preceded the lossless threshold change; the rebuilt public result confirms
identical encoded bytes at the current source. These are isolated timing
observations, not speed improvements.

Core + JPEG XL measures 524,870 minified bytes and the specialized APIs measure
597,465 bytes, within the existing 528,000 and 600,000 byte ceilings. No new
runtime dependency or size-budget increase accompanies the page change.

Evidence:

- [All 16 public inputs](results/parity-effort7-public.json) pass complete native sample checks in pinned libjxl and Rust. Thirteen files retain the learned checkpoint's hashes; the three graphics above shrink.
- [Six procedural cases](results/parity-effort7-fixtures.json) cover exact 8/16-bit learned models and RGB/RGBA patches, including invisible RGB, nonconstant alpha, a distinct-alpha glyph and nonpatched near-white values.
- [All-frame graphic inspection](results/palette-frame-investigation.json) identifies reference and displayed trees separately and records patch structure and byte totals.
- Fifteen focused Node cases and two additional real Chromium patch cases pass. Node/browser checks require identical encoded checksums and every decoded sample. Browser build checks pass. The complete current `npm run check` passes 263 files and 3,506 tests, with one file and three tests skipped. The original single-group and 24 MP memory gates pass.

Attempts JXLMOD-079 through JXLMOD-092 preserve rejected candidates and exact
current output checks in the optimization log. No version change, commit or
push accompanies this checkpoint.

## Reversible color search

This later checkpoint uses codec source SHA-256
`8b273c658a024216d1f2ebc6fb1dd478d20e86e2adfd6011368182e7a76302da`.
It compares one extra reversible color transform for unsqueezed, unpaletted
single-group RGB/RGBA at effort 7. Four public outputs shrink; the other twelve
retain the page checkpoint's hashes. All sixteen inputs remain exact in both
independent decoders.

| Capped input, effort 7 | Page checkpoint | Color search | jSquash | wasm-vips |
| --- | ---: | ---: | ---: | ---: |
| im26-1416 | 669,966 | 653,022 | 644,097 | 649,387 |
| im26-2018 | 644,073 | 619,774 | 613,245 | 621,262 |
| im26-5032 | 164,891 | 154,878 | 127,545 | 150,876 |
| im26-5034 | 48,630 | 46,794 | 44,936 | 83,555 |

The reductions are 2.5%, 3.8%, 6.1% and 3.8%. im26-2018 is now smaller than
wasm-vips, but remains 1.1% above jSquash. im26-1416 still exceeds jSquash by
1.4% and wasm-vips by 0.6%. Among all eight capped inputs, six files are now
smaller than wasm-vips and three smaller than jSquash. This does not establish
general compression parity.

The first-party forward kernels cover the 42 legal reversible channel
transform types already handled by our decoder. Sampling uses at most 4,096
positions and their left, top and top-left neighbors. It estimates clamped
gradient token entropy and hybrid extra-bit cost. Only the best extra transform
whose estimate improves by at least 1% is encoded. Actual section bytes choose
among it and the existing candidates. Alpha is untouched. The reference atlas
of an eligible lossless patch file also uses the single-group color search.

The sampler reserves at most 394,240 owned backing bytes. Full candidate
encoding uses one additional bounded group of planar samples and entropy
scratch. Optional sampling or encoding that exceeds working storage retains
the previous stream. A correlated RGBA8 regression produces an exact
80,488-byte stream with a 14,000,000-byte working limit, versus 74,422 bytes
without that constraint. Owned storage returns to zero. This verifies a useful
fallback; it does not promise identical compressed bytes across memory limits.

Testing up to three promising transforms preserved two files' hashes and saved
only another 446 bytes on im26-2018. That trial was rejected. Minimum-area
reference-atlas packing also saved less than 0.5% on two graphics and was
rejected. Encoded rate, rather than transform count or atlas area, decides
whether to retain an experiment.

The retained direct observations from the first color trial record 23.83,
28.70 and 24.61 seconds of core encoding for im26-1416, im26-2018 and im26-5032.
Their peak RSS values are 296,513,536, 334,786,560 and 343,531,520 bytes; peak
owned storage is 132,874,223, 173,755,088 and 167,176,823 bytes. Those direct
observations preceded a local allocation-fallback repair and a shorter spelling
of Infinity. The rebuilt current public outputs retain all three encoded hashes.
Public timing observations remain separate. No speed improvement is claimed.

Core + JPEG XL measures 527,391 minified bytes and specialized APIs measure
599,981 bytes. Both fit the existing ceilings. No runtime dependency was added.

Evidence:

- [All sixteen current public inputs](results/parity-effort7-color-public.json): complete independent native sample checks and unchanged input identities.
- [Twelve current procedural cases](results/parity-effort7-color-fixtures.json): the four learned and two patch cases, plus correlated color in each primary channel at 8/16 bits, preserving invisible RGB and partial alpha.
- Twenty-two focused Node cases pass, including the working-limit fallback. Two new real Chromium color cases match Node encoded checksums and exact samples. Browser build checks and strict types pass. The complete `npm run check` passes 263 files and 3,513 tests, with one file and three tests skipped, including the existing memory gates.

Attempts JXLMOD-093 through JXLMOD-102 record controls, retained changes and
rejections. The frozen comparison and earlier checkpoint reports remain intact.

## Sampled split-cost correction

The next checkpoint uses codec source SHA-256
`167ce7af0ad253ee3ec967f77da129e4e5579099fc1083f2808ea8e62d2cf713`.
A one-line rate correction reduces nine of the sixteen public files; the other
seven retain their hashes. All inputs remain exact in both independent decoders.

The learner previously compared sampled entropy savings with an unscaled
32-bit branch penalty. It scaled only the estimated histogram cost. At 65,536
samples from a 1,048,576-pixel plane, this overcharged branch cost by sixteen
times if interpreted as full-input metadata rate. Branch and histogram costs
now use the same sample fraction. The six properties, sampling limit, 256-leaf
per-channel cap, depth limit and 128-histogram bound remain unchanged.

| Input, effort 7 | Color checkpoint | Corrected cost | jSquash | wasm-vips |
| --- | ---: | ---: | ---: | ---: |
| im26-1030 capped photo | 487,110 | 485,489 | 535,279 | 515,866 |
| im26-1416 capped photo | 653,022 | 650,554 | 644,097 | 649,387 |
| im26-2018 capped photo | 619,774 | 615,021 | 613,245 | 621,262 |
| im26-2400 capped photo | 589,904 | 587,885 | 660,695 | 638,913 |
| im26-5032 graphic | 154,878 | 151,551 | 127,545 | 150,876 |
| im26-5034 graphic | 46,794 | 46,464 | 44,936 | 83,555 |
| 4000 × 3000 photo | 6,275,239 | 6,233,796 | 6,899,188 | 6,648,964 |
| 1920 × 1080 screenshot | 452,233 | 445,488 | 391,394 | 422,389 |

The other changed file is the transparent sunset logo, from 558,794 to 551,961
bytes. The first capped photo gap to wasm-vips is now 0.18%; the second photo
exceeds jSquash by 0.29%. The screenshot remains 5.5% above wasm-vips and 13.8%
above jSquash. The im26-5032 graphic remains 18.8% above jSquash. These remaining
gaps prevent a general parity claim.

Local coordinate features and a larger primary-color tree were tested and
rejected for small savings. The retained change increases useful splitting
within the existing storage bounds. A fixed mixed-texture RGBA8 fixture drops
from 435,390 to 432,957 bytes; its regression checks a smaller output and every
original sample. Six current Chromium cases pass with matching Node output.
Twenty-two focused Node cases, browser build checks and package size checks pass.
Current Core + JPEG XL / specialized sizes are 527,388 / 599,978 minified bytes,
within the existing ceilings. All twelve procedural cases reproduce every
sample in both independent decoders. The complete `npm run check` passes 263
files and 3,513 tests, with one file and three tests skipped. The existing
single-group and 24 MP memory gates pass.

The [current public report](results/parity-effort7-split-public.json) preserves
all sixteen source/input/output identities and independent sample checks.
The [current procedural report](results/parity-effort7-split-fixtures.json)
requalifies learned, patch and correlated-color cases at this source.
Attempts JXLMOD-103 through JXLMOD-106 record the additional controls and
qualification. Earlier checkpoint reports and the frozen comparison remain
unchanged.

## Exact patches on colored flat backgrounds

This checkpoint uses codec source SHA-256
`0d0880aabd703e6319a066a1d66ba6f00872810b7d9e3c3dc16e74e4e08a37d4`.
The earlier checkpoint reports remain unchanged.

| Input, effort 7 | Split-cost checkpoint | Flat-patch candidate | jSquash | wasm-vips |
| --- | ---: | ---: | ---: | ---: |
| 1920 × 1080 screenshot | 445,488 | 421,903 | 391,394 | 422,389 |
| 1024 × 1024 diagnostic graphic, im26-5032 | 151,551 | 136,768 | 127,545 | 150,876 |

These files shrink by 5.3% and 9.8%. Both independently reproduce every RGBA8
sample, including hidden RGB and alpha. They fall below frozen wasm-vips on
these inputs, but remain 7.8% and 7.2% above jSquash. These are actual complete
files at each encoder's effort-7 policy, without a speed or general parity claim.

The first-party flat-background component finder now accepts RGB or RGBA and
includes alpha in rectangle hashes and exact comparisons. A separate lossless
candidate fills each reused rectangle with a local background sample, then
restores the original rectangle from an exact reference atlas using Replace
patches. The pale-page candidate and ordinary stream remain in the complete-file
comparison. This applies only to sRGB RGB8/RGBA8 at effort 7, with 262,144 through
4,194,304 pixels, at least 40 placements, at least 0.5% covered area, and at most
262,144 unique atlas pixels. Other formats and depths keep their existing paths.

The finder reserves 14 bytes of scratch per source pixel, then releases it. The
extra display copy, atlas, entropy scratch and serialized candidates count
toward `maxWorkingBytes`. Optional allocation-limit failures retain the previous
stream. Screenshot and graphic observations report owned peaks of 137,288,565
and 171,374,986 bytes, and process RSS peaks of 383,447,040 and 389,341,184 bytes.
Owned storage returns to zero. Their isolated core observations are 29.94 and
53.64 seconds; these are not paired speed measurements.

The residual gap mainly sits in the displayed frame's sections. On the
screenshot, our reference atlas is 9,428 bytes versus jSquash's 11,684, but
our displayed sections are 412,399 versus 379,607. jSquash uses 1,279 additive
patches versus our 368 replacement patches. Of its placements, 739 cover
rectangles smaller than eight pixels, which our finder excludes. Those tiny
rectangles cover only 871 pixels, so their count alone does not explain the
remaining 30,509 bytes. On im26-5032, our displayed sections are 132,293 versus
124,590, while our atlas also costs 1,515 more bytes. Structural counts identify
remaining modeling and patch-policy differences; they do not attribute the gap
to any one tool.

A subsequent exact tiny-component control reduces the screenshot by only
2,482 bytes (0.59%) and enlarges im26-5032 by 423 bytes. Both independently
preserve every sample. That control is reverted; retaining it would require
another full candidate to preserve the qualified flat-patch output. Tiny
components alone do not close the remaining compression gap. Attempts
JXLMOD-110 and JXLMOD-111 record the rejected control.

All fourteen current learned, patch and correlated-color fixtures reproduce
every sample in both independent decoders. Twenty-five focused Node tests and
four real Chromium patch cases pass, including pale and colored backgrounds,
nonconstant alpha, invisible RGB, distinct-alpha glyphs, exact nonpatched values
and bounded-search cleanup. Browser build and strict types pass. The expanded
candidate adds 285 minified bytes to the specialized bundle, for 600,263 total.
Its ceiling changes from 600,000 to 601,000; the original recorded baseline
and other ceilings remain unchanged. Core + JPEG XL measures 527,675 bytes.
All sixteen rebuilt public inputs are independently exact. Four shrink from
the split-cost checkpoint and twelve retain their encoded hashes; none grows.
Besides the two files above, im26-5052 decreases from 21,977 to 21,887 bytes
and im26-5334 from 25,724 to 22,506. The public screenshot and im26-5032 hashes
match their direct source measurements. The complete `npm run check` passes
263 files and 3,516 tests, with one file and three tests skipped. The existing
single-group and 24 MP memory gates pass.

The [current procedural report](results/parity-effort7-flat-fixtures.json)
records source, input, encoded and independent-decoder identities. The
[public report](results/parity-effort7-flat-public.json) records all sixteen
inputs through the rebuilt package. The frame inspector reproduces the
structural counts; its temporary observations
remain under ignored `.tmp/jpegxl-comparison-v1/compression-investigation/`.
Attempts JXLMOD-107 through JXLMOD-109 record the expansion and qualification.

## Per-histogram residual layouts

This checkpoint uses codec source SHA-256
`6d27f577e22c8b3f58ce2ee431072b28a28870173901e114fdca379e32ce79d2`.
All sixteen rebuilt public inputs are exact in pinned libjxl and Rust. Ten
shrink from the flat-background checkpoint and six retain identical hashes.
None grows. This is compression progress; several jSquash gaps remain.

| Input, effort 7 | Flat-background checkpoint | Per-histogram layouts | jSquash | wasm-vips |
| --- | ---: | ---: | ---: | ---: |
| 1920 × 1080 screenshot | 421,903 | 418,068 | 391,394 | 422,389 |
| im26-5032 capped graphic | 136,768 | 134,669 | 127,545 | 150,876 |
| im26-5034 capped graphic | 46,464 | 46,036 | 44,936 | 83,555 |
| im26-1416 capped photo | 650,554 | 650,269 | 644,097 | 649,387 |
| im26-2018 capped photo | 615,021 | 614,089 | 613,245 | 621,262 |
| 4000 × 3000 photo | 6,233,796 | 6,230,253 | 6,899,188 | 6,648,964 |

Native streams use different integer bit layouts for different residual
histograms. The previous writer chose one layout for each whole group. The
new candidate selects among six legal layouts independently for each histogram.
It scores all residuals with the actual normalized and serialized ANS
frequencies, histogram headers and extra bits, then compares complete section
bytes. It reuses the existing learned tree and context map.

This additional search applies only at effort 7 when a learned literal stream
has already won. It preserves earlier candidates, prefix and repeat coding,
and lower-effort behavior. Optional working or output limit failures retain
the prior stream. There is another bounded group of packed residuals and small
histogram scratch, with no additional source-sized bitmap. Owned storage
returns to zero in every isolated measurement.

The screenshot shrinks 0.91% and im26-5032 shrinks 1.53%. They remain 6.82%
and 5.59% above jSquash. The photographic gains are small. The screenshot's
isolated core observation is 33.73 seconds with 366,891,008 bytes peak RSS and
137,284,660 bytes peak owned storage. The graphic records 56.58 seconds,
398,987,264 bytes peak RSS and 171,369,927 owned bytes. These observations
are not paired speed comparisons.

The implementation adds 2,207 minified bytes to Core + JPEG XL and 2,209 bytes
to the specialized APIs, for totals of 529,882 and 602,472 bytes. Explicit
ceilings are 530,000 and 603,000 bytes; the original recorded baselines remain
unchanged. No runtime dependency is added.

Evidence:

- [All sixteen public inputs](results/parity-effort7-hybrid-public.json) record input, source, encoded and independent-decoder identities, exact sample counts and isolated public measurements.
- Twenty-six focused bitstream and learned-model tests pass, including mixed layouts, remapped contexts, large residual values and an invalid configuration-list extent.
- Eight real Chromium cases pass with exact 8/16-bit samples and identical Node/browser encoded checksums. Browser build checking passes.
- [Fourteen procedural cases](results/parity-effort7-hybrid-fixtures.json) are exact in both independent decoders, covering native 8/16-bit learned models, correlated color, alpha and RGB/RGBA patches.
- The complete `VITEST_MAX_WORKERS=4 npm run check` passes 264 files and 3,522 tests, with one file and three tests skipped. The original single-group and 24 MP memory gates pass.

Attempts JXLMOD-112 through JXLMOD-119 record rejected signed-reference,
approximate-dictionary, spatial and group-wide-layout controls. Attempts
JXLMOD-120 through JXLMOD-123 record the retained mixed-layout candidate and
its qualification. Ignored binaries and profiles remain under `.tmp/`.

## Tighter lossy quality comparisons

The separate all-band run keeps the frozen six-point report unchanged. It
measures up to 24 points per encoder and input, rotates work across
SSIMULACRA2 70, 80 and 90, and requires a bracket no wider than 0.25 on both
sides of a size comparison. The previous runner could spend its budget on
early targets before reaching the later ones. Five refinement regressions
and four existing recovery tests pass.

The four pinned inputs produce 339 measured points with no execution
failures. Eleven of the 24 public comparator/target pairs now have adequate
brackets; thirteen remain unresolved. This baseline uses the per-histogram
checkpoint above. The later opaque-photo correction below updates the two
photo curves. Improving this baseline's sampling did not change the codec.

| Input | SSIMULACRA2 | PureJsImage bytes | Compared with jSquash | Compared with wasm-vips |
| --- | ---: | ---: | ---: | ---: |
| im26-1030 capped photo | 70 | 63,353 | 37.00% larger | 37.97% larger |
| im26-1030 capped photo | 80 | 87,481 | 21.94% larger | 22.67% larger |
| im26-1030 capped photo | 90 | 162,525 | 2.32% larger | 0.18% larger |
| im26-1416 capped photo | 70 | 37,451 | 24.41% larger | unresolved |
| im26-1416 capped photo | 80 | 55,052 | 17.28% larger | unresolved |
| im26-1416 capped photo | 90 | 114,979 | 14.78% smaller | 18.88% smaller |
| alpha_triangles | 90 | 158,777 | 125.05% larger | unresolved |

These byte values use the existing nondominated log-byte interpolation, not
an artifact encoded at exactly the target score. The first photo's score-80
PureJsImage value reproduces the frozen result. Tighter wasm-vips sampling
changes its interpolated frontier, so the earlier 21.2% estimate remains
historical evidence. The current estimate is 22.67% on that same photo.

The graphic has no adequately matched public pairs within this budget.
Its curves and the transparency curves contain score inversions and broad
frontier gaps. Raw points, tool and input hashes, setting bounds, failures,
bracket widths and unresolved targets remain in each report. Transparency
uses the worse score across explicit black and white backgrounds. Native
libjxl is a separate oracle and does not enter the JavaScript ranking.

Evidence:

- [First photo](results/quality-refined-photo.json): all public pairs meet the 0.25 width limit.
- [Second photo](results/quality-refined-photo1416.json): four of six public pairs meet the limit.
- [Graphic](results/quality-refined-graphic5034.json): all public pairs remain unresolved.
- [Transparency](results/quality-refined-alpha.json): only the jSquash score-90 pair meets the limit.

Attempts JXLENC-090 through JXLENC-094 record the initial sampling control,
the target-rotation correction and these separate fixture runs. Each report
uses its own ignored artifact directory to preserve earlier binaries.

## Opaque photo color precision

This later checkpoint uses codec source SHA-256
`59e21206a661db05875743beab75c5d64c535f00054aa2dc3f6c82f170c7a58d`.
The previous RGBA policy used coarse color DC steps even when every alpha
sample was fully opaque. Keeping those steps spends AC bits without retaining
enough low-frequency color precision on the checked photographs. The new
policy uses the existing RGB DC steps on fully opaque, high-color sRGB RGBA8
at effort 7, distance above 1 and through 4,194,304 pixels.

The alpha descriptor, source storage, exact alpha, AC quantizers and filtering
remain intact. Small palettes, partial alpha, larger images, other depths,
HDR and lower efforts retain their prior policies. The existing visible-color
classifier permits at most 2,048 colors for a small palette. It reserves
20 KiB of temporary scratch; allocation-limit failure retains the prior DC
policy. There is no additional source-sized bitmap.

| Input | SSIMULACRA2 | Prior bytes | Current bytes | Compared with jSquash | Compared with wasm-vips |
| --- | ---: | ---: | ---: | ---: | ---: |
| im26-1030 capped photo | 70 | 63,353 | 50,873 | 10.01% larger | 10.79% larger |
| im26-1030 capped photo | 80 | 87,481 | 76,057 | 6.02% larger | 6.65% larger |
| im26-1030 capped photo | 90 | 162,525 | 146,937 | 7.50% smaller | 9.42% smaller |
| im26-1416 capped photo | 70 | 37,451 | 32,351 | 7.47% larger | unresolved |
| im26-1416 capped photo | 80 | 55,052 | 48,809 | 3.98% larger | unresolved |
| im26-1416 capped photo | 90 | 114,979 | 106,564 | 21.02% smaller | 24.82% smaller |

Every photo bracket meets the unchanged 0.25-score limit. The first photo
shrinks 19.70%, 13.06% and 9.59% at the three targets; the second shrinks
13.62%, 11.34% and 7.32%. The first photo's score-80 gap to wasm-vips falls
from 22.67% to 6.65%. These are the existing log-byte interpolations of
independently decoded artifacts, not files encoded at exactly each target.
The two unresolved wasm-vips photo bands remain unresolved. The graphic and
transparency curves retain every previous artifact hash and score. Eleven
public comparator/target pairs remain adequate and thirteen unresolved.

An initial full RGB-policy expansion was rejected: it introduced sharp
quality jumps and increased the second photo's matched score-90 size by 1.84%.
The isolated DC correction improved photos but regressed some small-palette
graphic points. Reusing the existing palette classifier preserves those
graphic bytes while retaining the photographic gains.

The [public quality report](results/quality-opaque-dc-public.json) records
91 current points and their source, input, decoder, metric and harness hashes.
The [RGB/RGBA control report](results/opaque-dc-investigation.json) retains
both source identities and the 36-stream comparison. Every current control
preserves exact alpha and both independent decoders agree within one RGB
level. Photo hashes match the isolated DC control; graphic and RGB hashes
match the prior baseline.

Forty-one focused VarDCT tests, strict types, browser build checks and four
real Chromium cases pass. The gradient regression improves mean color error
from 0.9163 to 0.8056 levels, including progressive output. An image with only
its last alpha sample set to 254 retains the baseline encoded and decoded
checksums. Chromium agrees with Node on both complete checksums and samples.
The full repository gate passes: 264 test files and 3,527 tests, with one
file and three tests skipped. The initial manifest helper entry was corrected
to retain only executable test files as evidence.

Core + JPEG XL adds 307 minified bytes, for 530,189 total. Its explicit
ceiling is 531,000 bytes. Specialized APIs add 304 bytes, for 602,776 total,
within the existing 603,000-byte ceiling. Original recorded baselines remain
unchanged. No runtime dependency is added, and no speed gain is claimed.

The transparency controls identify another gap. Constant RGB with the
original binary alpha still costs 150,676 bytes; zeroing invisible RGB leaves
the original 167,431-byte artifact unchanged. This points to the separate
VarDCT alpha entropy writer. A rounded-color Modular control helps the graphic
but harms transparency, so no general transparent quantization policy is
retained. These controls do not establish compression parity.

Attempts JXLENC-095 through JXLENC-103 preserve the controls, rejected
policies, final source qualification and ignored binary artifacts.

## VarDCT alpha compression

The next retained source is
`dcdd5d5187bb5e391ed8dd63b516a6ddf663d67bb8143e088fc96e0b4d0226e1`.
At effort 7, nonconstant alpha groups can use the existing first-party repeat
coder with either a channel histogram or gradient contexts. Each candidate
must beat the previous complete bit count. The writer preserves the current
section's bit alignment. Optional allocation failure keeps the previous alpha
stream before any output is changed. Constant groups, lower efforts and JPEG
coefficient transcodes keep their previous paths.

The [alpha investigation](results/alpha-entropy-investigation.json) retains
the independent before/after source identities and complete pixel hashes.
At distance 1, alpha_triangles shrinks from 167,431 to 66,304 bytes. All eight
public transparency controls preserve every alpha sample and the complete
decoded pixel hash in both libjxl and Rust. The four sunset-logo artifacts
keep their original encoded hashes. These are same-distance controls with
identical decoded pixels, not a comparator quality ranking.

The [refreshed public curves](results/quality-alpha-public.json) preserve every
quality score and independent decoded pixel hash across all 91 points. All
67 photo and graphic artifacts keep their previous encoded hashes. The 24
transparency artifacts shrink. At the adequately bracketed SSIMULACRA2 90
target, the interpolated transparency size falls from 158,777 to 56,933 bytes,
a 64.14% reduction. It is now 19.30% smaller than the pinned jSquash estimate
of 70,552 bytes. The two lower transparency bands and all three wasm-vips
transparency bands remain unresolved. Eleven of 24 public comparator/target
pairs are still adequate; thirteen remain unresolved.

Eight procedural fixtures cover exact native 8/16-bit alpha at zero, one,
half scale, maximum minus one and maximum, across regular/progressive output
and partial edge groups. Both independent normalized Float32 grids retain
their complete baseline hashes. Six VarDCT cases shrink to 694–1,028 bytes;
the two small 8-bit palette cases keep their original 334/415-byte outputs.
The retained VarDCT source fails every new 1,500-byte regression bound.

The search retains group-local residual and repeat scratch, with no additional
source-sized bitmap. Under a 3 MiB working limit, the main group's repeat
scratch falls back while the partial edge group can still improve. The 8/16-bit
fallback tests preserve exact alpha and decoded colors. Sixty-six focused
bitstream/VarDCT tests, strict types, browser build checks and ten real Chromium
cases pass. The tracked native verifier reproduces the exact-alpha and complete
baseline-grid checks. The full repository gate passes 264 files and 3,539
tests, with one file and three tests skipped.

The implementation adds 1,230 minified bytes to both measured JPEG XL bundles.
Core + JPEG XL is 531,419 bytes with an explicit 532,000-byte ceiling;
specialized APIs are 604,006 bytes with a 605,000-byte ceiling. The original
baselines remain unchanged. No dependency, version or speed claim is added.
Attempts JXLENC-104 through JXLENC-110 preserve controls and qualification.

## Additional alpha prediction

The next source is
`bd139e9c897f5c7277288c54bc7b83388d73886a9c71fa405e436869d2867568`.
It adds left prediction to the qualified alpha repeat search, retaining every
previous complete-bit candidate. Each predictor has its own bounded scratch
scope. If the extra predictor exceeds the working budget, the selected gradient
candidate remains available. Other errors still propagate.

The [paired alpha investigation](results/alpha-left-investigation.json) pins
the previous and current source identities. All eight public controls retain
every alpha sample and both complete independent decoded grid hashes; no file
grows. The distance-1 triangles stream shrinks from 66,304 to 61,133 bytes,
and progressive output shrinks from 66,427 to 61,973 bytes. All four sunset-logo
encoded hashes stay unchanged.

The [current public curves](results/quality-alpha-left-public.json) retain
all 91 independent decoded hashes, quality scores and Butteraugli results.
Every one of 67 photo/graphic encoded hashes is unchanged; all 24 transparency
files shrink. At the adequately bracketed SSIMULACRA2 90 target, transparency
interpolation falls from 56,933 to 52,479 bytes, another 7.82% reduction.
That is 25.62% smaller than the pinned jSquash estimate of 70,552 bytes.
The two lower transparency bands and every wasm-vips transparency band remain
unresolved. Eleven of 24 public comparator/target pairs are adequate;
thirteen remain unresolved. These are log-byte interpolations, not files
encoded at exactly the target score.

Sixteen native fixtures cover the five alpha levels and changing binary
bands, regular/progressive output, 8/16-bit samples and partial edge groups.
Both independent decoders preserve exact alpha and the entire prior normalized
Float32 grid. The new progressive binary regressions shrink from 1,377/1,405
to 1,031/1,060 bytes in single groups, and from 1,866/1,906 to 1,441/1,481
bytes with edge groups. Every baseline fails its new 1,200/1,600-byte bound.

The browser binary fixture exposed a pre-existing rounding difference:
Node and Chromium emit identical bytes but differ by one RGB level at 105
fully transparent pixels. This occurs with both the prior and current encoder.
Every visible RGB sample and alpha sample agrees exactly. The focused browser
test compares every sample, requires exact visible color and alpha, and permits
at most that one level only under zero alpha. The diagnostic retains both
before/after checksums and all difference counts. Production decoding is
unchanged.

The extra predictor adds 155 minified bytes to each JPEG XL bundle.
Core + JPEG XL is 531,574 bytes and specialized APIs are 604,161 bytes,
within the existing 532,000/605,000-byte ceilings. Original recorded baselines
are unchanged. Attempts JXLENC-111 through JXLENC-115 retain the controls and
qualification. No speed or general parity claim is made.

Seventy focused bitstream/VarDCT tests, strict types, browser build checks and
all twelve real Chromium cases pass. The tracked native verifier reproduces
all sixteen independent complete-grid and exact-alpha checks. Full `npm run check`
passes 264 files and 3,543 tests, with one file and three tests skipped.

## Subsequent controls

The qualified source remains unchanged while these controls use isolated
copies of the first-party encoder. They do not change the public comparison.

The [DC precision controls](results/photo-dc-precision-controls.json) test
half and quarter steps, plus equal precision in all color channels, on both
photos. All 48 streams decode independently with exact alpha. Baseline files
and scores reproduce the current public report; graphic/transparency files
stay identical. Finer steps add bytes without enough quality improvement.
Their broad diagnostic interpolations grow at every 70/80/90 target, so the
controls are rejected. They do not meet the narrow public ranking criterion.

The [integer-layout controls](results/forward-hybrid-controls.json) preserve
both complete independent decoded grids for all 40 streams. One shared layout
saves 0.16–0.31% on photo points and 1.02% on the graphic; another saves 1.52%
on alpha. Other choices grow. There is no single winner for every class.
The [per-histogram AC control](results/ac-histogram-hybrid-controls.json)
keeps the original context map and chooses layouts using serialized ANS
probabilities, extra bits and header cost. It preserves complete decoded grids
but saves only 0.060–0.125% on photos, 0.656% on the graphic and one alpha byte.
Both controls are rejected. They do not explain the main photographic gap
or exhaust other context-model and transform policies.

Attempts JXLENC-116 through JXLENC-118 record strict diagnostic checks,
independent outputs, resource receipts and rejection decisions. No production
codec change follows these controls.

## Current lossy section costs

The [section profile](results/current-lossy-section-profile.json) reads all
18 pinned photo endpoints in the adequately matched 70/80/90 bands. Input and
artifact hashes match the quality reports. It reuses their independently
validated scores; it does not rescore images or infer causation from strategy
IDs alone. Auxiliary reference frames are included where present.

These are the lower endpoints near SSIMULACRA2 80, not files encoded at exactly 80:

| Section | PureJsImage, 79.9526 | jSquash, 79.9939 | wasm-vips, 79.9700 |
| --- | ---: | ---: | ---: |
| DC group | 17,559 | 14,327 | 17,701 |
| AC groups combined | 57,458 | 55,912 | 52,400 |
| Complete file | 75,870 | 71,720 | 71,305 |

The retained DC correction brings our DC payload close to wasm-vips; the
remaining difference is almost entirely AC data. Against jSquash, both DC
and AC contribute. Container overhead is 40 bytes for PureJsImage, zero for
jSquash and 176 for wasm-vips at these endpoints. It cannot explain this gap.
Both competitors use transform strategies beyond the four current forward
writer choices. That identifies a remaining tool difference, but previous
larger-transform prototypes failed protected quality checks and are not retained.

Reproduce the structural profile with
`node benchmark/jpegxl/comparison/profile-lossy-sections.ts NEW_REPORT.json`.

## Coefficient rounding, allocation and order controls

The next isolated controls keep the qualified production source unchanged at
`bd139e9c897f5c7277288c54bc7b83388d73886a9c71fa405e436869d2867568`.
Their copied first-party modules and preparation scripts have separate hashes.
All 172 measured streams pass both independent decoders within one color level,
with exact original alpha. These results do not update the public rankings.

The [rounding controls](results/ac-rounding-controls.json) account for the
format's biased reconstruction of small coefficients. Nearest reconstruction
uses more bytes and worsens several Butteraugli coordinates. Small estimated
bit penalties trade quality for size. The [tighter penalty-0.06 curves](results/quality-ac-rounding-controls.json)
resolve all six photo targets within the existing 0.25-score limit. They save
0.28–1.08% at 70 and 80, but grow the two score-90 estimates 1.61% and 0.51%.
The policy is rejected. Lower equal-distance sizes did not establish a gain
at every protected quality target.

The [AC allocation controls](results/ac-map-controls.json) separately test the
existing RGB activity map, constant map 6 and activity map 6/8 on qualified
opaque RGBA photos. DC precision, rounding and filtering remain intact, and
the earlier distance-dependent contrast refinement is excluded. All three
policies are rejected. The activity map worsens broad matched-score estimates;
constant 6 is mostly neutral at 80 and worsens other bands. The 6/8 policy adds
bytes without changing decoded scores on the first photo. These broad screening
curves are not adequately matched public comparisons.

The [DCT8 scan-order profile](results/ac-order-controls.json) measures nonzero
positions in bounded existing groups. Sorting positions changes entropy
traversal and signaling while preserving every quantized coefficient. Both
independent complete decoded grid hashes and both quality scores remain
identical to baseline. Photo files shrink 0.06–0.83%, but the graphic grows
120 bytes.

The [two-family order control](results/ac-order-family-controls.json) also
learns the order shared by Hornuss and split transforms. Photo files shrink
0.10–1.11% and the graphic shrinks 1.25%, from 107,885 to 106,534 bytes at
distance 3, with identical pixels. The checked transparency file grows 24
header bytes. Most scan symbols are luma; fewer tail symbols explain part of
the opportunity, but do not predict complete encoded size. This prototype
still needs a complete size guard and broader native-depth, progressive,
allocation and browser qualification before retention. It does not close the
remaining photographic gap.

The qualified implementation of that order search is recorded below.

Attempts JXLENC-120 through JXLENC-124 record these controls. No additional
production codec change, speed claim or general compression parity claim
accompanies them.

## Adaptive forward coefficient orders

The current effort-7 writer learns separate orders for three color channels
and two transform families. It counts nonzero positions in existing reusable
groups across both progressive passes, keeps natural-order ties, and signals
only families whose order changes. It compares the complete alternative file,
including headers and the table of contents, against the prior stream and
keeps it only when smaller. Quantization, transforms, filtering and alpha
samples remain unchanged.

This search requires at least 1,024 blocks and two AC groups. Six 64-position
count arrays and orders are bounded, and the second compressed candidate
stays within `maxWorkingBytes`. It adds no source-sized bitmap. An optional
allocation-limit failure returns the prior stream. A 7,350,000-byte public
limit returns the exact prior 12,945-byte texture file, including its encoded
checksum and complete decoded grid. Late cancellation propagates its original
error and releases all owned scratch. Lower efforts, smaller frames and JPEG
coefficient transcodes keep their previous paths.

The [public controls](results/ac-order-public-controls.json) preserve both
complete native and Rust decoded grids on two photos, a graphic and a
transparency fixture. Photo files shrink 0.10–1.11%, the graphic shrinks 1.25%,
and the transparency control shrinks 31 bytes. Eight asymmetric 8/16-bit
[fixtures](results/coefficient-order-fixtures.json) preserve every native
Float32 sample and exact original alpha, with 1.78–6.07% smaller files.
Sixty additional [integer-depth controls](results/coefficient-order-depth-controls.json)
cover gray/RGB/RGBA, 8/10/12/16-bit source depth, mixed 16-bit alpha, partial
groups and regular/progressive output. Every complete independently decoded
grid matches its baseline and no complete file grows.

The refreshed [public quality curves](results/quality-coefficient-orders-public.json)
retain all 91 prior decoded hashes, SSIMULACRA2 scores and Butteraugli scores.
Eighty-five files shrink and six retain the prior size. The six photo estimates
below meet the existing 0.25-score bracket limit. Comparators retain their
frozen input, tool and measurement identities.

| Input | SSIMULACRA2 | PureJsImage bytes | Compared with jSquash | Compared with wasm-vips |
| --- | ---: | ---: | ---: | ---: |
| im26-1030 capped photo | 70 | 50,702 | 9.64% larger | 10.42% larger |
| im26-1030 capped photo | 80 | 75,880 | 5.77% larger | 6.41% larger |
| im26-1030 capped photo | 90 | 146,532 | 7.75% smaller | 9.67% smaller |
| im26-1416 capped photo | 70 | 32,114 | 6.68% larger | unresolved |
| im26-1416 capped photo | 80 | 48,243 | 2.78% larger | unresolved |
| im26-1416 capped photo | 90 | 105,842 | 21.55% smaller | 25.32% smaller |

The transparency score-90 estimate is 52,448 bytes, 25.66% smaller than
jSquash. Eleven of 24 comparator/target pairs remain adequately matched and
thirteen remain unresolved. These modest entropy savings do not close the
remaining photo gaps or establish general compression parity.

The fresh [section profile](results/coefficient-order-lossy-section-profile.json)
locates the remaining wasm-vips score-80 gap in AC data. At the lower matched
endpoints PureJsImage uses 75,700 bytes, with 17,559 DC and 57,262 AC bytes;
wasm-vips uses 71,305 bytes, with 17,701 DC and 52,400 AC bytes. Our AC data
alone is 4,862 bytes larger. Container, frame-header and table-of-contents
overhead totals 81 bytes, including the 40-byte container. The corresponding
wasm-vips overhead is 211 bytes, including its 176-byte container.
This identifies the next area to investigate without
assuming that a particular transform or quantizer will close the gap.
Reproduce it with
`node benchmark/jpegxl/comparison/profile-lossy-sections.ts NEW_REPORT.json benchmark/jpegxl/comparison/results/quality-coefficient-orders-public.json`.

The implementation adds 1,936 minified bytes: Core + JPEG XL is 533,510 bytes
and specialized APIs are 606,097 bytes. Explicit ceilings become 534,000 and
607,000 bytes; the original recorded baselines remain unchanged. The checked
texture's internal owned peak grows 45,088 bytes, from 7,081,011 to 7,126,099
bytes. Another serialization and coefficient traversal add encoding work.
These observations make no speed claim and add no runtime dependency.

Current source is
`d093319eb94d36b23a39014035c077bee864f6f9b91d856b72fba8f0ce653398`.
Nine real Chromium order and budget-fallback cases pass; six existing alpha
cases also pass. Strict types, browser build checking and 122 focused
bitstream, VarDCT and JPEG reconstruction cases pass. The complete
`VITEST_MAX_WORKERS=4 npm run check` passes 264 test files and 3,553 tests,
with one file and three tests skipped, including the existing memory and
reconstruction gates. Attempt JXLENC-125 records the raw gates. Temporary
images, binaries, copied controls and raw logs stay in ignored `.tmp/`.

## AC entropy and block-context investigation

The next controls keep production source at the qualified
`d093319eb94d36b23a39014035c077bee864f6f9b91d856b72fba8f0ce653398`
checkpoint. All 96 streams reproduce the current baseline artifacts and scores,
retain both complete independent decoded grids and preserve every original alpha
sample. Copied first-party modules, preparation scripts and native tools have
separate hashes. These controls do not update the public rankings.

The [histogram clustering controls](results/ac-cluster-controls.json) test
32, 64 and 192 models, two alternate probability priors and initialization
weighted by token counts. Actual complete-file gains are at most 0.27%, with
other photo regressions. None is retained. The existing 96-model initialization
produces 17–29 populated photo models. At distance 4, merging the original
contexts adds about 1,131 and 893 ideal entropy bytes on the two photos.
That estimate excludes model headers and magnitude bits, so it is not an
achievable compression gain.

The [bit-cost profile](results/ac-bit-cost-profile.json) separates token
entropy, magnitude bits, model headers and ANS frequency normalization.
The selected learned-order photo controls lose only 3.4–25.1 bytes to
frequency normalization. The first photo's magnitude bits alone cost
26,419, 6,527 and 2,852 bytes at distances 1, 4 and 8. The existing ANS
writer already uses full histogram precision. Changing its precision or
frequency rounding cannot explain the remaining multi-kilobyte photo gap.

The [block-context controls](results/block-context-controls.json) condition
coefficient models on transform family, try the format's default context map,
and add a median-luminance DC split. They preserve all coefficients and pixels.
Additional conditioning reduces ideal token entropy, but model headers and
clustering usually offset that reduction on photos. For the second photo at
distance 4, the family/DC split saves about 635 token-coding bytes, adds 910
model-header bytes, and grows the complete file by 313 bytes. The family-only
control saves 44 bytes there but grows the other five photo controls.

There is a graphic-specific opportunity: family contexts reduce the graphic
from 106,534 to 104,637 bytes, a 1.78% saving with identical decoded pixels.
The default-map and family/DC controls save 1.00% and 1.59% on that graphic.
The checked transparency sizes stay within 37 bytes of baseline.
None of these policies is retained as a global default. The graphic result
still needs a complete file-size guard and broader qualification before any
production use.

The controls rule out several small entropy costs as the main photographic
cause. Transform selection, coefficient quantization and restoration remain
the larger open areas. They do not establish that all context-model policies
have been exhausted. Attempts JXLENC-126 through JXLENC-128 retain the raw
results and decisions; temporary copied encoders remain in ignored `.tmp/`.

## Gaborish preconditioning controls

The next investigation tests encoder preconditioning before Gaborish restoration.
The earlier restoration-only trial did not compensate input samples before
transforms. These controls adjust XYB samples before both DC statistics and AC
coding. Production remains at the qualified `d093319` source above.

The [first-order controls](results/gaborish-inverse-controls.json) compare
restoration alone with three inverse strengths. The [finite-inverse controls](results/gaborish-neumann-controls.json)
add second, third and fourth terms of the inverse approximation. They use
small reusable halo tiles, at most two 16 × 16 × 3 Float32 buffers, rather
than a full-frame float image. They apply only to the existing opaque SDR RGBA
photo eligibility above distance 1. All checked distance-1, graphic and
transparency files retain their previous bytes and scores.

All 72 screening streams pass complete native and Rust decoding within one
RGB level, with exact alpha. Stronger inverse approximations recover detail
but add coefficient bytes. Broad screening interpolations suggest some
score-90 savings; those brackets are too wide to support retention.

The [refined quality controls](results/quality-gaborish-controls.json) test
the closest first-order strength and degree-2 approximation on both photos.
They add 80 independently decoded streams and retain twelve prior seed points.
Ten of twelve policy/target estimates meet the unchanged 0.25-score bracket
requirement. Every adequate estimate is larger than the current encoder:

| Input | SSIMULACRA2 | First-order strength 1.5 | Degree-2 inverse |
| --- | ---: | ---: | ---: |
| im26-1030 capped photo | 70 | 4.55% larger | 4.69% larger |
| im26-1030 capped photo | 80 | 4.19% larger | 3.79% larger |
| im26-1030 capped photo | 90 | unresolved | unresolved |
| im26-1416 capped photo | 70 | 0.51% larger | 0.71% larger |
| im26-1416 capped photo | 80 | 0.82% larger | 0.91% larger |
| im26-1416 capped photo | 90 | 14.30% larger | 12.80% larger |

Both first-photo score-90 brackets remain too wide at the existing 24-point
budget. Their ratios stay unset. Every measured inversion and Butteraugli
coordinate remains in the report. The tighter evidence does not confirm
the broad screening gains.

None of these policies is retained. This excludes the tested inverse designs
as a solution to the current photo gap; other restoration and quantization
designs remain open. A final audit checks all 152 measured streams, complete
independent grid hashes, exact alpha, source/tool pins and quality calculations.
Attempts JXLENC-129 through JXLENC-131 record the controls and rejection.
The existing public comparison and production encoder remain unchanged.

## Encoding cost and memory

These are separate isolated observations, not paired speed measurements. The
photo candidate took 24.10 seconds of encoder core time and 24.12 seconds
including output, with 477,847,552 bytes peak process RSS and 153,885,002 bytes
peak owned encoder storage. The screenshot took 3.485 seconds of core time and
3.489 seconds including output, with 254,054,400 bytes peak RSS and 96,474,716
bytes peak owned storage. Owned allocations return to zero after each encode.

The older public-adapter observations were about 2.53 seconds for the photo and
0.51 seconds for the screenshot. Their timing boundaries include adapter
initialization and differ from the direct encoder observations. The new search
adds substantial work. This checkpoint prioritizes compression; it makes no
speed improvement claim. In these examples effort 3 still encodes faster than
the new effort 1 and remains a useful higher-effort compression target.

The rebuilt public package was also measured with the original adapter and
timing boundary. Its single cold encode observations were 23.06 seconds for
the photo, 3.49 seconds for the screenshot and 2.44 seconds for the transparent
sunset logo. [The public package report](results/parity-effort1-public.json)
records those measurements and peak RSS separately from the direct worker.

The candidate retains one group's planar and entropy scratch alongside staged
input and compressed sections. It does not add another source-sized pixel
bitmap. Absolute RSS includes the Node runtime, input preparation and allocator
behavior; owned backing storage is a separate measurement.

## Validation and evidence

- [Photo](results/parity-effort1-photo.json): 48,000,000 exact RGBA8 samples in each independent decoder.
- [Screenshot](results/parity-effort1-screenshot.json): 8,294,400 exact RGBA8 samples in each independent decoder.
- [Ten procedural cases](results/parity-effort1-fixtures.json): exact 8/16-bit samples with transparent, half and opaque constant alpha, nonzero grayscale, vertical groups and unrelated channel noise across the DC group boundary.
- [All 16 pinned public inputs](results/parity-effort1-public.json): exact native uint8/uint16 samples through rebuilt public imports and both independent decoders. All 13 single-group outputs keep their prior encoded hashes. The two large opaque inputs and real transparent sunset logo shrink; the public opaque outputs match the direct worker bytes.
- Focused tests cover native sample precision, invisible RGB, constant-channel overhead, allocation limits, cancellation and higher-effort search. The higher-effort regression requires effort 7 to remain at most the new effort-1 size; the old 25% reduction expectation assumed the weak effort-1 baseline.
- Real Chromium checks require identical encoded bytes and exact decoded samples for the 8/16-bit constant-alpha cases in Node and browser.
- Final `npm run check` passes: 262 test files and 3,495 tests, with one file and three tests skipped. The gate includes generated capabilities and documentation, bundle/package checks, strict types, browser build checks, lint and formatting. No runtime dependency was added.

Reports pin normalized input hashes, encoded hashes, source identity, independent
decoder executable hashes and complete sample counts. Binaries and bounded-run
receipts remain under ignored `.tmp/`. The frozen public performance and quality
report is unchanged.

## Optional transform-family entropy models

Eligible multi-group effort-7 VarDCT frames now compare separate AC contexts
for DCT8 and the other supported transform families. The writer tests those
contexts with natural and learned coefficient orders, then keeps the smallest
complete file. That comparison includes the block-context map, entropy headers
and section lengths. Coefficients, quantization, filters, color and alpha stay
identical.

The [public controls](results/family-context-public-controls.json) reproduce the
previous baseline artifacts and both quality scores before checking each new
stream. Both independent decoders produce identical complete grids:

| Input | Distance | Previous bytes | Current bytes |
| --- | ---: | ---: | ---: |
| im26-1030 capped photo | 1 | 168,113 | 168,113 |
| im26-1030 capped photo | 4 | 82,675 | 82,675 |
| im26-1030 capped photo | 8 | 53,550 | 53,550 |
| im26-1416 capped photo | 1 | 137,169 | 137,169 |
| im26-1416 capped photo | 4 | 52,532 | 52,488 |
| im26-1416 capped photo | 8 | 32,311 | 32,311 |
| im26-5034 graphic | 3 | 106,534 | 104,637 |
| alpha_triangles | 3 | 53,324 | 53,324 |

The graphic saves 1.78%. Five of eight new
[mixed-transform fixtures](results/family-context-fixtures.json) shrink, with
the progressive opaque RGBA8 case falling from 9,674 to 9,071 bytes (6.23%).
The other three files are identical. All eight complete native/Rust Float32
grids and original 8/16-bit alpha samples match the frozen baseline.
Sixty [native-depth controls](results/family-context-depth-controls.json) and
the eight [earlier coefficient fixtures](results/family-context-order-fixtures.json)
also retain their full independently decoded grids without file growth.

This search adds up to two entropy serializations. On the fixed 513 by 257
RGBA8 fixture, owned peak storage rises from 7,600,035 to 10,681,648 bytes.
These figures exclude caller storage and process overhead. At a 10,000,000-byte
limit, optional search returns the previous complete 18,662-byte stream.
Cancellation releases all owned storage. Nine Chromium tests cover both native
depths, regular/progressive output, exact alpha and the working-limit fallback.
The implementation adds no source-sized bitmap or runtime dependency.

The [fixed-setting public quality replay](results/quality-family-contexts-public.json)
checks all 91 prior PureJsImage points with rebuilt public imports. Twenty-nine
complete files shrink and 62 stay unchanged. Both independently decoded full
grids, every SSIMULACRA2 and Butteraugli score, and all original alpha samples
remain identical. The report separately pins the four existing comparator
reports and keeps inadequate size ratios unset.

There are still eleven adequately matched comparator/target pairs and thirteen
unresolved pairs. The first photo's score-80 estimate stays at 75,880 bytes,
6.41% larger than wasm-vips. The second photo's score-90 estimate falls by about
two bytes to 105,840. These results leave the photographic compression gap open.

The measured minified JPEG XL codec bundle grows by 407 bytes to 533,917, and
the specialized entry grows by 405 bytes to 606,502. Both remain within their
existing ceilings. Original recorded baselines and package version are unchanged.

Lower efforts, smaller frames and JPEG coefficient transcodes retain their
existing paths. The added work is not a speed improvement. The measured
graphic savings do not establish photographic or general compression parity.
JXLENC-132 records the separate source, input, tool and allocation evidence.

The complete `npm run check` passes 264 test files and 3,563 tests, with one file
and three tests skipped. Generated support and package/docs surfaces, strict
types, browser build, original memory checks and JPEG reconstruction checks pass.
The qualified source SHA-256 is
`4e9b84f0e04f83764f1688ef0497aa212231387ab7f5859e620b5ae892a88f23`.

## Larger-transform coding-cost controls

Two isolated first-party DCT16 selectors produce valid files but fail the
matched-quality retention gate. The qualified production encoder remains at
source `4e9b84f0e04f83764f1688ef0497aa212231387ab7f5859e620b5ae892a88f23`.
The public comparison and its remaining 6.41% first-photo score-80 gap are
unchanged.

The first selector compares observed quantized AC token costs while bounding
reconstruction error in each color channel. It includes low-frequency error
and chroma-from-luma coupling, uses bounded tiles, and selects a quantizer for
each eligible 16 by 16 region. All sixteen
[screening files](results/dct16-rate-controls.json) pass complete native/Rust
grid checks within one RGB level and exact original alpha. Distance-1 photos,
graphics and transparency remain byte-identical to the qualified encoder.

The [section profile](results/dct16-section-profile.json) identifies a missing
cost in that selector. All four changed photo points save AC bytes but add more
DC-group bytes than they save. On the first photo at distance 4, AC falls from
63,524 to 62,476 bytes while the DC group rises from 18,251 to 19,953 bytes.
The complete file grows from 82,675 to 83,341 bytes. Framing stays at 81 bytes.
The DC group contains low-frequency coefficients and strategy/quantizer
metadata, so these totals do not isolate the contribution of each part.
These fixed-distance files have different quality and serve as cost controls.

The second selector adds empirical DC gradient-residual costs, including the
neighboring residuals affected by four changed DC values. It respects predictor
resets at DC-group boundaries and reserves sixteen bits for strategy and
quantizer signaling. Its sixteen
[screening files](results/dct16-dc-rate-controls.json) pass the same independent
checks. It removes most of the earlier size growth, but needs matched-quality
verification to establish a saving.

Both selectors use the existing two-photo sampling policy: at most 24 points
per curve and brackets no wider than 0.25 at SSIMULACRA2 70, 80 and 90.
Every primary band meets that limit. The table shows complete-file changes
against the qualified encoder, with negative values meaning smaller files.

| Selector | Photo | Score 70 | Score 80 | Score 90 |
| --- | --- | ---: | ---: | ---: |
| AC cost | im26-1030 | +0.10% | -1.39% | +0.50% |
| AC cost | im26-1416 | +0.73% | -0.51% | -0.44% |
| AC and DC cost | im26-1030 | -0.13% | -0.25% | +0.52% |
| AC and DC cost | im26-1416 | -0.31% | -0.32% | -0.43% |

The [first refined report](results/quality-dct16-rate-controls.json) also grows
1.17% at the first photo's adequately matched Butteraugli-1 point. The
[DC-aware report](results/quality-dct16-dc-rate-controls.json) grows 0.24% at that
point and 0.53% at the second photo's Butteraugli-2 point. Other inadequately
matched secondary ratios remain unset. The channel error bound does not
guarantee perceptual quality or final encoded size.

Neither policy is retained. The small primary savings do not justify the
protected regressions. No original-size retention run follows a failed capped
quality gate. These controls add 66 independently checked streams to the 32
screening streams, with exact alpha throughout. Temporary copied encoders,
images and raw reports remain ignored. The reports preserve separate source,
input, tool, harness and output identities, including the original measurement
bytes before repository formatting. JXLENC-133 through JXLENC-136 record the
receipts and decisions. There is no production change or speed claim from
these transform controls.

## Remaining work

The compression goal remains open. The effort-7 screenshot is now smaller than
wasm-vips but still 6.8% larger than jSquash. Several diagnostic graphics
and two other capped photos still exceed jSquash; one also exceeds wasm-vips. Better
conditional rate estimates, larger learning samples, transform and palette
models, reversible color search across larger frames and lower-effort policies remain
lossless targets. These must be judged by actual encoded sizes and exact samples.

The current lossy curves resolve eleven public comparator/target pairs, with
thirteen still unresolved. Opaque-photo color precision improves all six
photo targets, but both photos remain larger than jSquash at 70 and 80.
Both are smaller than the adequately matched competitors at 90. The checked
transparency case is now smaller than jSquash at 90 after exact alpha repeat
coding, while its wasm-vips bands remain unresolved. The diagnostic filter controls show that
restoration flags alone explain little of the photographic gap. Lossy work
needs better rate decisions, alpha entropy models and complete same-quality curves.
Native-depth HDR, broader transparency, float and CMYK cases also require
separate compression evidence before a general parity claim.

## Reproduction

Prepare the pinned comparison fixtures and independent tools using the existing
comparison instructions. Run each measurement and verifier in a separate bounded
invocation with a fresh run identifier. The inner commands are:

```sh
node --expose-gc benchmark/jpegxl/measure-m7-lossless.ts INPUT.ppm OUTPUT.jxl 1 rgba
node benchmark/jpegxl/comparison/verify-lossless-parity.ts FIXTURE_ID OUTPUT.jxl MEASUREMENT.log REPORT.json
node benchmark/jpegxl/comparison/verify-fast-lossless-fixtures.ts REPORT.json
node benchmark/jpegxl/comparison/run-lossless-parity.ts REPORT.json
node benchmark/jpegxl/comparison/run-lossless-parity.ts REPORT.json 7
node benchmark/jpegxl/comparison/verify-learned-lossless-fixtures.ts REPORT.json
node benchmark/jpegxl/comparison/quality.ts NEW_REPORT.json all-bands
node benchmark/jpegxl/comparison/verify-alpha-entropy.ts NEW_REPORT.json benchmark/jpegxl/comparison/results/alpha-left-investigation.json
```

The verifier requires the encoded output and measurement source hashes to match
the current source. The measurement log contains one JSON observation. The
optional `rgba` input appends fully opaque alpha without changing any RGB sample.

## Strategy and quantizer metadata prediction

Effort-7 forward VarDCT now compares gradient and left prediction on the packed
strategy/quantizer plane. Its two rows describe different values; gradient
prediction across that boundary adds residuals. The comparison includes every
local tree and histogram header and retains the original unless the alternative
uses fewer bits. It changes entropy coding, with identical checked pixels,
quantization, filters and alpha.

The [representative controls](results/metadata-prediction-public-controls.json)
reproduce the previous baseline before checking each new complete file:

| Input | Distance | Previous bytes | New bytes |
| --- | ---: | ---: | ---: |
| im26-1030 capped photo | 1 | 168,113 | 167,443 |
| im26-1030 capped photo | 4 | 82,675 | 81,849 |
| im26-1030 capped photo | 8 | 53,550 | 52,798 |
| im26-1416 capped photo | 1 | 137,169 | 136,168 |
| im26-1416 capped photo | 4 | 52,488 | 51,593 |
| im26-1416 capped photo | 8 | 32,311 | 31,689 |
| im26-5034 graphic | 3 | 104,637 | 102,205 |
| alpha_triangles | 3 | 53,324 | 53,324 |

The [original-size controls](results/metadata-prediction-original-controls.json)
use the same 4000 by 3000 photograph and 1920 by 1080 UI capture. At distance 3,
the photo falls from 677,447 to 657,639 bytes (2.92%), and the UI capture from
201,765 to 197,984 bytes (1.87%). Both independent full pixel grids, original
alpha and both quality scores are identical. These fixed-setting controls add
no original-size matched-quality ranking.

Eight [mixed-transform native-alpha fixtures](results/metadata-prediction-fixtures.json),
eight [earlier coefficient fixtures](results/metadata-prediction-order-fixtures.json)
and sixty [native-depth regular/progressive cases](results/metadata-prediction-depth-controls.json)
retain both complete independent grids with no file growth. The existing family
and order working-limit [controls](results/metadata-prediction-budget-controls.json)
also preserve the complete native Float32 grids and exact alpha. Their newly
compressed bytes are separately pinned. Tests check that failed entropy admission
leaves the original section writable, and cancellation releases all owned storage.
Eighteen Chromium cases agree with Node.

The [public quality replay](results/quality-metadata-prediction-public.json)
checks all 91 previous settings. Sixty-seven files shrink and 24 remain unchanged.
Every complete independently decoded grid, SSIMULACRA2 score, Butteraugli score
and alpha sample matches the previous qualified build. The same eleven
comparator/target pairs meet the 0.25-score bracket limit, and thirteen remain
unresolved. The first capped photo's score-80 estimate falls from 75,880 to
75,038 bytes. It remains 5.23% larger than wasm-vips and 4.60% larger than jSquash.
The frozen public performance tables stay unchanged.

The search adds up to two metadata serializations and a temporary compressed
candidate within the working-storage budget. Ties or optional allocation failures
retain the original metadata. A failed output admission occurs before any bits
are appended. On the same 513 by 257 RGBA8 fixture, owned peak storage falls from
10,681,648 to 10,680,898 bytes because retained compressed output is smaller.
Every tested baseline-admitted budget, through a 2048-square texture, still
completes. These storage checks do not claim to have reached every optional
metadata allocation failure. No source-sized bitmap or runtime dependency is
added. Lower efforts and JPEG coefficient transcodes keep their previous paths.
This change adds encoding work and makes no speed claim.

The minified codec and specialized entry each grow by 895 bytes, to 534,812 and
607,397 bytes. Their ceilings become 535,000 and 608,000. Recorded original
baselines and the package version are unchanged. The evidence audit checks
191 stream observations, 184 distinct encoded hashes, 32 report/module/tool pins
and 52 quality-band calculations. JXLENC-137 through JXLENC-139 record the cost
attribution, isolated control and qualification.

The qualified codec source SHA-256 for these measurements is
`7f2b8a050f2e410e794f23374df269045f5ee739f0b6635e0da166520bb5c7b1`.
The previous family-context and larger-transform sections describe the earlier
`4e9b84f` checkpoint. DCT16 remains unretained, and photographic and overall
compression parity remain open.

The complete repository gate passes 264 test files and 3,564 tests, with one
file and three tests skipped. Generated support, package/docs, strict and consumer
types, browser build, original memory and JPEG reconstruction checks pass. The
fresh public build matches the quality replay's pinned modules. No version,
commit or push is included.

## Separate strategy and quantizer models

The earlier left-prediction change still shares one entropy histogram between
strategy and quantizer rows. The [isolated row-model controls](results/metadata-row-controls.json)
compare separate histograms with left or zero strategy prediction. Zero
prediction saves more bytes at every checked point, but both raw alternatives
grow the transparency file by four bytes. Those unguarded alternatives are
diagnostics only.

The retained effort-7 search adds the stronger zero-strategy candidate behind
the complete metadata-bit comparison. Its fixed local tree assigns separate
strategy and quantizer leaves. Quantizers use left prediction; correlation and
sharpness retain gradient prediction. Tree and histogram headers count in the
selection. The candidate must use fewer bits than the best original or shared
left-prediction stream. Coefficients, transforms, quantizers, filters and alpha
remain identical.

The [representative controls](results/metadata-row-public-controls.json)
reproduce the qualified `7f2b8a` parent and independently verify these files:

| Input | Distance | Previous bytes | New bytes |
| --- | ---: | ---: | ---: |
| im26-1030 capped photo | 1 | 167,443 | 167,027 |
| im26-1030 capped photo | 4 | 81,849 | 81,337 |
| im26-1030 capped photo | 8 | 52,798 | 52,344 |
| im26-1416 capped photo | 1 | 136,168 | 135,558 |
| im26-1416 capped photo | 4 | 51,593 | 51,069 |
| im26-1416 capped photo | 8 | 31,689 | 31,352 |
| im26-5034 graphic | 3 | 102,205 | 101,733 |
| alpha_triangles | 3 | 53,324 | 53,324 |

Both independent full grids and both quality scores match the parent. The
transparency stream stays byte-identical because the growing candidate loses.
The [original-size controls](results/metadata-row-original-controls.json) save
another 1.93% on the 4000 by 3000 photo, from 657,639 to 644,929 bytes at distance
3. The 1920 by 1080 UI capture falls from 197,984 to 196,700 bytes (0.65%). Those
fixed-setting controls preserve every checked decoded pixel and score; they do
not establish an original-size matched-quality ranking.

The [91-setting quality replay](results/quality-metadata-row-public.json)
preserves both independent complete grids, SSIMULACRA2, Butteraugli and exact
alpha. Sixty-seven files shrink and 24 stay unchanged. Eleven pairs meet the
unchanged 0.25-score bracket limit, and thirteen remain unresolved. The first
capped photo's score-80 estimate falls from 75,038 to 74,530 bytes, leaving a
4.51% gap versus wasm-vips and 3.89% versus jSquash. The second photo's score-90
estimate is 26.45% smaller than wasm-vips. These finite results do not establish
general compression parity, a quality winner or a speed improvement.

Eight [native-alpha mixed-transform fixtures](results/metadata-row-fixtures.json),
eight [coefficient-order fixtures](results/metadata-row-order-fixtures.json) and
sixty [native-depth regular/progressive cases](results/metadata-row-depth-controls.json)
preserve both complete independent grids. The four existing working-limit
[outputs](results/metadata-row-budget-controls.json) also preserve all decoded
values and alpha. Eighteen real Chromium cases and 91 focused tests pass.

The new candidate adds one metadata serialization, five histogram arrays,
residual/context scratch and compressed bytes within `maxWorkingBytes`. It
adds no source-sized bitmap. Ties keep the earlier candidate. Optional new
search failure preserves an already-completed left result, and replacing a
candidate releases its compressed storage. Failed output admission occurs
before appending any bits. On the 513 by 257 family fixture, owned peak storage
falls from 10,680,898 to 10,679,512 bytes as retained output shrinks. At the
existing 10,000,000-byte limit, the public file falls from 18,412 to 17,950 bytes
and all owned storage closes. These checks do not claim to exercise every
metadata-specific allocation failure. Lower efforts and JPEG coefficient
transcodes keep their existing paths.

A separate storage probe covers 64-square through 2048-square textures. Every
tested budget admitted by the previous encoder also completes with this model,
and all owned storage closes. The largest current file saves 5,793 bytes while
owned peak storage falls by 23,172 bytes. These owned-buffer measurements do
not measure process RSS or establish a speed improvement.

The codec and specialized minified entries grow by 1,702 bytes, to 536,514 and
609,099 bytes. Their ceilings become 537,000 and 610,000, with original baselines
and package version unchanged. The complete evidence audit passes 191 stream
observations, 184 distinct encoded hashes, 33 report/module/tool pins and 52
quality-band calculations. JXLENC-140 and JXLENC-141 record the isolated control
and qualification.

The measured codec source SHA-256 is
`8fd29be9fb078c315b0938518726a6ca9ebf492c3d7d0d474b2b86a3d502fc87`.
The metadata-prediction section above records its earlier `7f2b8a` checkpoint.
DCT16 remains unretained, and photographic and general compression parity
remain open.

The complete repository gate passes 264 test files and 3,564 tests, with one
file and three tests skipped. Generated support, package/docs, strict and
consumer types, browser builds, original memory and JPEG reconstruction checks
pass. The fresh public build matches all quality-replay module pins. No version,
commit or push is included.

## Remaining section costs

The [current section profile](results/metadata-row-lossy-section-profile.json)
checks all eighteen first-photo endpoints at adequately bracketed scores
70, 80 and 90. At the lower score-80 endpoint, our file is 74,342 bytes versus
wasm-vips' 71,305. Our DC group is 16,202 bytes versus 17,701, and complete
framing is 80 versus 211. AC data costs 57,262 versus 52,400 bytes. The 4,862
extra AC bytes exceed the 3,037-byte complete-file gap because other sections
save bytes. Against jSquash, both DC and AC still cost more.

This local accounting identifies the remaining photographic cost after both
metadata corrections. It does not prove which transform or quantizer will
improve matched quality, and it does not reverse the rejected larger-transform
controls. JXLENC-142 records the source, artifact and input checks.

## Exact artwork candidate extent control

The regular effort-7 RGBA8 sRGB artwork path can compare an exact Modular
candidate when there are at most 2,048 visible colors. Qualified source
8fd29b limited that search to 262,144 pixels. Three 1024-square graphics
passed the color test but exceeded that extent cap.

The [isolated cap control](results/artwork-cap-controls.json) changes only that
extent to 1,048,576 pixels in copied first-party modules. It keeps the existing
five-percent complete-stream saving threshold and every other eligibility
condition. These results are at distance 3:

| Input | Qualified encoder bytes | Isolated candidate bytes | Reduction |
| --- | ---: | ---: | ---: |
| im26-5034 graphic | 101,733 | 46,036 | 54.75% |
| im26-5052 graphic | 118,444 | 21,887 | 81.52% |
| im26-5334 graphic | 94,484 | 22,384 | 76.31% |

Both independent decoders reproduce every original color and alpha sample in
all three smaller files. Each scores SSIMULACRA2 100 and Butteraugli zero. All
twenty control observations pass complete independent grids and exact alpha;
the photo and transparency outputs keep their qualified hashes and scores.
The extra exact candidate takes about 60–120 seconds on these single serial
observations. Those measurements do not establish a speed ratio.

This isolated prototype confirmed a separate candidate-selection gap for
artwork. It required working-budget fallback, cancellation, meaningful boundary
regressions and browser qualification before production retention. The
production qualification below records those gates. A score-100 file cannot
be substituted into a tightly matched score-80 ratio. JXLENC-143 keeps the
control and its original source identity.

## Artwork production qualification

The production candidate expands the existing regular effort-7 sRGB RGBA8
search to 1,048,576 pixels. It keeps the 2,048-visible-color limit and requires
at least five percent smaller complete output. Progressive output, other
formats, depths, transfer functions and larger images keep their existing
paths. The candidate preserves visible colors and exact alpha; the existing
lossy policy may replace fully transparent colors with zero.

[Production controls](results/artwork-public-controls.json) reproduce all
three exact graphic savings above. The
[independent boundary controls](results/artwork-boundary-controls.json) cover
the new 513-square fixture, the old inclusive and new excluded extents,
working-storage fallback, native-16, progressive and losing alpha candidates.
The 513-square file falls from 3,159 to 523 bytes and preserves every original
sample in both independent decoders. All seven protected current paths keep
their frozen baseline encoded hashes and both full sample grids.

The classifier, optional normalization copy and exact candidate share one
storage scope. Only a winning output survives. Losing candidates release all
optional storage; a working-storage limit returns the prior complete stream,
and cancellation propagates with cleanup. The 8 MiB case preserves the prior
stream byte for byte; the 16 MiB case admits the exact output. These limits
measure owned buffers, separately from caller memory, sink storage and RSS.

Sixty [native-depth controls](results/artwork-depth-controls.json) preserve
8/10/12/16-bit gray/RGB/RGBA grids and exact alpha for regular and progressive
output. Ten artwork regressions, including late cancellation and sink failure,
two new Chromium boundary/storage cases and eighteen existing Chromium
depth/progressive/storage cases pass.
The [complete public quality replay](results/quality-artwork-public.json)
checks all 91 prior fixed settings. Eighteen artwork files are smaller and
pixel-exact; the remaining 73 keep their encoded hashes, both full independent
grids and both scores. All raw settings and inversions remain recorded.
Eleven comparator/target pairs remain adequately bracketed and thirteen stay
unresolved under the unchanged 0.25-score rule. The artwork frontier now has
a 34.156-point bracket, so its target ratios remain unresolved. The first
photo's score-80 estimate remains 4.51% above wasm-vips.

The merged report pins four disjoint development-only replay processes and
recomputes every band on the complete cohort. Parallel replay is not a speed
measurement. A post-run audit checks 167 depth, boundary and quality
observations, 39 pins and all 52 band calculations; the twenty production
controls have their separate audit. The full repository gate passes 265 files
and 3,574 tests, including the original memory and JPEG reconstruction checks.
Generated support, package metrics, documentation, strict/package types and
browser compatibility pass. The rebuilt public modules retain all measured
hashes. The scoped artwork change is retained. Production source is
`cb91695b112d750b28036ecacc026273b0f2721f1b83a3cab36d8cc1c0aad4e8`.

This search can add substantial encoding time at effort 7. The measured exact
artwork savings do not establish a speed gain, photographic compression parity
or an adequately matched target-score ratio. JXLENC-144 and JXLENC-145 retain
the separate proof and completed gates.

## Patch metadata controls

The subsequent lossless profile separates reference-atlas sections, displayed
sections and patch metadata. On im26-5034, our displayed sections are already
smaller than jSquash's; reference sections account for the remaining file gap.
A denser skyline atlas saves only 16–61 bytes on four graphics, so that packing
policy is rejected. A smaller raw atlas does not imply a similar compressed
file saving.

The current patch writer combines constant reference IDs, replacement modes,
coordinates, sizes and repeat counts into one prefix histogram. Three or four
field models reduce that metadata cost. The production search compares every
feature bit, including model headers, and keeps the original representation
on ties or optional storage failure. Patch fields and pixel-section bits stay
unchanged. It adds no pixel bitmap.

| Input, lossless effort 7 | Prior qualified file | New public file | Pinned jSquash |
| --- | ---: | ---: | ---: |
| im26-5052 | 21,887 | 21,418 | 18,517 |
| im26-5034 | 46,036 | 45,751 | 44,936 |
| im26-5334 | 22,384 | 22,136 | 44,579 |
| im26-5032 | 134,669 | 134,581 | 127,545 |
| Original 1920 × 1080 screenshot | 418,068 | 417,785 | 391,394 |

All five actual public files preserve every original sample in pinned native
and Rust decoding. The first two graphics still exceed jSquash by 15.67% and
1.81%; the screenshot still exceeds it by 6.74%. These are exact file-size
controls, not speed comparisons. The prior sixteen-input lossless reports keep
their separately verified source identity.

Final production source is
`57b37955c307b12be851c96e3f4c8efa2d5ed6d97a45d0ecb386eae1fe6e2780`.
Thirty focused patch/artwork cases and ten real Chromium cases pass. New
regressions verify every decoded patch field, adjoining unaligned bits, small
stream retention, empty dictionaries, output-limit cleanup and exact fallback
at the prior minimum RGB/RGBA storage boundaries. Optional token contexts,
bounded histograms and serialized candidates remain within maxWorkingBytes.

Evidence: [lossless section profile](results/lossless-artwork-section-profile.json),
[rejected skyline control](results/atlas-packing-controls.json),
[role-model controls](results/patch-context-model-controls.json),
[final production feature serialization](results/patch-metadata-guard-controls.json)
and [five actual public files](results/patch-metadata-guard-public-controls.json).
The [full public quality replay](results/quality-patch-metadata-public.json)
checks all 91 prior fixed settings. Eighteen already exact graphic files each
shrink by 285 bytes; the other 73 retain their encoded hashes. Every setting
preserves both complete independent grids and both metric scores. Eleven
comparator/target pairs are adequately matched and thirteen remain unresolved.
The first photo's score-80 estimate stays 4.51% above wasm-vips. A post-run
audit verifies 104 observations, 102 pins and all 52 band/comparison
calculations. The full `npm run check` passes 266 files and 3,582 tests,
including the original memory and JPEG reconstruction gates. Generated
support, documentation, strict/package types, package metrics and browser
compatibility pass. All seven rebuilt public modules retain their measured
hashes. The metadata change is retained.

The capability adds 1,297 minified bytes. Current Core + JPEG XL and specialized
bundles are 537,851 and 610,438 bytes, within explicit 538,000 and 611,000
ceilings. The original recorded baselines remain unchanged. No runtime
dependency, speed gain or general compression parity is claimed.

The [complete local-header profile](results/modular-local-artwork-profile.json)
finds another specific policy gap. Both encoders use the same 251-color palette
for the two reference atlases. Our palette path uses six prediction leaves;
jSquash uses 65–79. Our existing learned-model search excludes palette
transforms. Leaf counts alone do not establish a compression saving, so
enabling bounded palette learning requires an isolated control next.

## Learned palette controls

The local-header profile identified a specific exclusion: our effort-7 learner
handled raw integer planes but skipped palette planes. A copied atlas-only
control trains actual trees and saves 382, 316 and 224 complete bytes on three
graphics. Full image controls then show larger savings in displayed palette
frames. Every original sample remains exact in native libjxl and Rust.

Qualified production source
`28e122b8442808f14b9c8d13a6a0b2b7af188bd21053d7ff3bb46757f061695e`
keeps the complete previous group search as a floor. It evaluates learned
palette coding in an optional ownership scope and promotes only smaller output.
Single-group callers release losing output immediately and replace the previous
smallest candidate when the new output wins. This preserves later searches at
the original working limits. Near-zero palette streams skip training; existing
sampling, tree and histogram limits remain. The search adds encoding work.

These are actual compiled public lossless effort-7 files. Prior PureJsImage
values come from the qualified `57b37955` metadata checkpoint; jSquash values
remain the frozen same-input public comparison.

| Input | Prior PureJsImage | Current PureJsImage | Pinned jSquash |
| --- | ---: | ---: | ---: |
| im26-5052, diagnostic | 21,418 | 19,124 | 18,517 |
| im26-5034, diagnostic | 45,751 | 41,926 | 44,936 |
| im26-5334, diagnostic | 22,136 | 21,608 | 44,579 |
| im26-5032, diagnostic | 134,581 | 134,581 | 127,545 |
| 1920 × 1080 screenshot | 417,785 | 417,785 | 391,394 |

The first three files shrink 10.71%, 8.36% and 2.39%. The 5034 file closes its
jSquash gap and is now 6.70% smaller. The 5052 file is still 3.28% larger than
jSquash; the screenshot remains 6.74% larger. These examples do not establish
overall parity.

Evidence: [atlas-only control](results/learned-palette-atlas-active-controls.json),
[complete copied encoder control](results/learned-palette-full-controls.json),
[48 depth and storage controls](results/learned-palette-qualified-floor-controls.json)
and [five actual public files](results/learned-palette-public-controls.json).
All 48 controls preserve original 8/16-bit RGB/RGBA samples, including hidden
RGB, across single and multiple groups. All eight prior managed-peak limits
remain successful with identical bounded bytes; lower effort stays unchanged.
Losing candidates close their storage, and cancellation preserves its original
reason without sink output. Thirty-three focused cases, eight real Chromium
cases, browser compatibility and strict types pass.

The [affected artwork audit](results/learned-palette-artwork-controls.json)
also verifies two transparency fixtures that now choose smaller exact visible
color and alpha: 15,778 to 14,913 bytes, with prior maximum visible error of
eleven in first-party and twelve in native decoding reduced to zero.
Fully transparent color follows the existing lossy normalization policy.
Another exact 512-square fixture shrinks 503 to 477 bytes and preserves its
full decoded grid. Progressive, native-16, larger-extent and tight-budget
protected expectations remain unchanged.

The capability costs 814 minified bytes. Core + JPEG XL and specialized bundles
are 538,665 and 611,252 bytes, within explicit 539,000 and 612,000 ceilings.
The original recorded baselines remain 233,093 and 255,489.

The [complete quality replay](results/quality-learned-palette-public.json)
passes all 91 fixed settings. Twenty-three files shrink: eighteen preserve
their already exact pixels, and five graphic settings improve to the smaller
41,926-byte original-sample-exact file. The other 68 encoded hashes stay
unchanged. The replay recovers 59 checksum-pinned encodings from the first
attempt and newly encodes 32, using the same frozen public build. Both
independent decoders and both metrics revalidate every complete file.
Eleven comparator/target pairs remain adequate and thirteen unresolved under
the original 0.25-score rule. The graphic's exact-candidate selection leaves
a 36.717-point frontier gap; exact output does not stand in for an adequately
matched target. The first photo remains 4.512% larger than wasm-vips at score 80.

The [post-run audit](results/learned-palette-retention-audit.json) verifies
150 observations, 135 pins and 52 band calculations. A separate
[memory control](results/learned-palette-minimum-budget-controls.json) preserves
the original small-fixture 221,988-byte minimum, every prior encoded byte and
rejection at 221,987 bytes. The unrestricted run now includes optional search;
falling below its higher peak can succeed with exact output. Tests retain the
original mandatory boundary and check optional recovery separately.

The full repository check passes 267 files and 3,593 tests, with the existing
skips. [Final verification](results/learned-palette-final-gates.json) confirms
all seven rebuilt public modules still match the measured quality cohort and
both independent decoders preserve the budget-control samples. The original
large-input memory and reconstruction gates pass unchanged. This source is
retained. No speed or general compression-parity claim is made.

## Palette order learning

The next profile finds a narrower exclusion. The default palette path now
learns prediction trees, but the existing luma, Morton and hue palette orders
still try only the four older entropy variants. A copied ordered-base control
saves only 33 bytes on one atlas. Applying the bounded learner within each
existing reordered palette saves 600–2,296 complete atlas bytes with displayed
streams fixed. Complete image controls then prove the savings below.

Production source
`82534d5e1babbea16a6c11359b358969d02cabb0ab1fa3eee90630798de32254`
keeps all previous ordered variants as a complete size floor. Each extra
group search uses a separate optional storage scope and promotes only smaller
output. Optional working-limit failure keeps the complete previous stream;
other errors propagate. Existing eligibility remains effort 7, RGBA8, no delta
colors and at most 1,048,576 pixels. Sampling, tree and histogram bounds stay
unchanged. Lower effort and other native formats keep their existing paths.

| Input, lossless effort 7 | Prior palette checkpoint | Current public file | Pinned jSquash |
| --- | ---: | ---: | ---: |
| im26-5052, diagnostic | 19,124 | 17,475 | 18,517 |
| im26-5034, diagnostic | 41,926 | 37,940 | 44,936 |
| im26-5334, diagnostic | 21,608 | 19,312 | 44,579 |
| im26-5032, diagnostic | 134,581 | 133,981 | 127,545 |
| 1920 × 1080 screenshot | 417,785 | 417,739 | 391,394 |

All five actual public files match their copied prototype byte for byte and
preserve every original sample in native libjxl and Rust, including hidden RGB
and alpha. The 5052 file closes its remaining jSquash gap and is 5.63% smaller.
The 5032 file and screenshot remain 5.05% and 6.73% larger than jSquash.
The current full sixteen-input replay at both efforts also preserves every
original uint8/uint16 sample. Cumulative transparency, gray8 and rgb16 savings
against the older full matrix include the prior palette change; they are not
attributed solely to this narrower hook.

Evidence: [fresh local-header profile](results/learned-palette-local-artwork-profile.json),
[atlas controls](results/palette-order-learning-atlas-controls.json),
[complete copied image controls](results/palette-order-learning-full-controls.json),
[64 depth and storage controls](results/palette-order-learning-boundary-controls.json)
and [five actual public files](results/palette-order-learning-public-controls.json).
Every original managed-peak boundary and lower-effort byte remains successful
and exact. A separate [small memory control](results/palette-order-learning-minimum-budget-controls.json)
preserves the original 221,988-byte minimum and empty rejection at 221,987
bytes; optional recovery remains separately checked. Thirty-three focused
tests, ten real Chromium cases and browser compatibility pass. The affected
[artwork controls](results/palette-order-learning-artwork-controls.json) shrink
both varying/hidden-alpha files from 14,913 to 13,980 bytes with identical
decoded grids; the 477-byte square fixture stays byte-identical.

The [fresh full quality replay](results/quality-palette-order-public.json)
newly encodes all 91 fixed settings. Twenty-four graphic files shrink to the
37,940-byte exact original-sample stream. Twenty-three preserve already exact
pixels; the remaining setting improves from SSIMULACRA2 63.28290722 to 100
and Butteraugli zero. All other 67 complete encoded hashes, both full grids
and both metrics remain unchanged. Eleven comparison pairs remain adequate
and thirteen unresolved under the original 0.25-score rule. The graphic now
has only exact frontier points, so its 70/80/90 targets remain insufficiently
sampled. Exact output is not substituted for a matched target. The first
photo remains 4.512% above wasm-vips at score 80.

The [post-run audit](results/palette-order-learning-retention-audit.json)
checks 166 observations, 132 pins and 52 band/comparison calculations, with
separate current public and prior-source prototype identities. The fresh
full lossless reports contain all 32 complete files and both independent
sample grids for each. Failed diagnostic timeout attempts remain recorded;
the corrected launcher completes both full matrices.

This search adds encoding work and optional group-local training and entropy
scratch. The copied first graphic's peak owned storage rises from 45,453,519
to 52,896,847 bytes; the other four measured peaks do not rise. Original
working limits retain the previous complete output. These compression
controls do not establish a speed gain or overall compression parity.

The extra hook adds 240 minified bytes. Current Core + JPEG XL and specialized
bundles measure 538,905 and 611,492 bytes, within the existing 539,000 and
612,000 ceilings. Original baselines remain 233,093 and 255,489 bytes, and
the package still has no runtime dependency tree.

The full `npm run check` passes 267 files and 3,593 tests, with one file and
three existing tests skipped. Original large-input memory, reconstruction and
required/optional storage gates pass unchanged. The
[final verification](results/palette-order-learning-final-gates.json) confirms
all seven rebuilt public modules match the measured cohort and re-reads all
32 complete lossless files with 64 independent grids, comparing 384,733,048
original samples. Six successful small-budget streams remain independently
exact, and both one-byte-below rejections stay empty. This source is retained;
the previous raw-module checkpoints remain available separately. Overall
compression parity is still open.

## Learned tree metadata investigation

The fresh [remaining lossless profile](results/remaining-lossless-local-profile.json)
reads twelve pinned current/jSquash/wasm-vips files. The inspected gradient
properties and weighted-predictor parameters agree. Group sizes, palette
choices and prediction trees still differ. Counts describe global or local
headers; multi-group global counts omit additional local programs.

The previous learned-tree writer merged split thresholds, property IDs, predictor IDs
and constant leaf fields into one prefix histogram. The
[isolated tree control](results/learned-tree-entropy-controls.json) holds six
qualified trees fixed and verifies all eighteen serializations against their
original nodes. Four field models with ANS save 770–806 tree bytes on three
photos. Shared ANS alone saves much less. The tiny screenshot atlas remains
smaller with the original prefix code, so a complete bit-size floor is needed.

The [copied complete-image controls](results/learned-tree-entropy-full-controls.json)
retain every original prefix bit as a floor and preserve every original sample
in native and Rust decoding. All five baselines reproduce their qualified
public hashes. The prototype files become 484,410 / 649,463 / 613,319 /
133,414 / 416,281 bytes on im26-1030 / 1416 / 2018 / 5032 / original screenshot,
saving 802 / 806 / 770 / 567 / 1,458 complete bytes. Owned storage closes and
all module, input, artifact, tool and harness pins pass. This is a measured
metadata-coding cost. This earlier control preceded production adoption of the broader field policy below.

An additional [field-hybrid control](results/learned-tree-hybrid-controls.json)
verifies 54 serializations of the same six trees. Direct property, predictor
and constant coding with a narrower split configuration saves further bits.
Every original node and exact consumed bit count remains correct. That
isolated control does not by itself qualify complete images.

The later [field-specific complete-image control](results/learned-tree-entropy-field-full-controls.json)
uses one additional field configuration and keeps all earlier bit-size floors.
It saves 865 / 865 / 821 / 616 / 1,596 bytes on the same five inputs.
Every original sample remains exact in both independent decoders. The two
close photo comparisons still trail wasm-vips and jSquash by 17 and 23 bytes,
respectively. The larger screenshot gap to jSquash remains.

Boundary testing caught two errors in the copied experiment before production
adoption. Some full-width thresholds overflowed the ANS helper's packed
32-bit payload, and a fractional threshold reached integer packing without
validation. The revised policy checks branch integers and declines any ANS
trial whose packed payload exceeds uint32. It retains the original prefix
stream for those valid wide thresholds. Staged buffers stay within their
owner scope through the complete append so a memory-limit fallback releases
them before writing the original stream.

The [bit boundary control](results/learned-tree-entropy-bit-boundaries.json)
passes 206 valid-tree and limit cases, plus fractional-input rejection.
It verifies every original node, full 32-bit thresholds, all starting bit
alignments, adjacent bits, output limits and temporary ownership. The
[depth and effort control](results/learned-tree-entropy-depth-boundaries.json)
passes 96 complete files at the original and current working budgets across
RGB/RGBA, 8/16-bit samples, one/multiple groups and efforts 1/3/5/7. The
[learned-texture control](results/learned-tree-entropy-learning-boundaries.json)
passes 40 complete files and 80 original-sample NPY grids, with four mixed
textures saving 268–495 bytes at both unrestricted and prior working peaks.
The [original minimum-budget control](results/learned-tree-entropy-minimum-budget-controls.json)
still produces the exact 586-byte legacy file at 221,988 owned bytes and
rejects 221,987 bytes with empty output.

These controls qualify the copied experiment separately from the later production replay below. Earlier source identities, failed experiments and the original noisy runtime cohort remain recorded.

## Learned tree metadata production

Production source `31996a26477cada593b663b62075fe983975bffba76e74c9bd3f67792d0fd222` applies the independently tested field policy. It changes entropy coding of the same learned trees. It preserves the complete prefix representation as a bit floor, tiny-tree behavior, wide signed thresholds, original required budgets, and owner cleanup before optional fallback.

The [fresh full lossless replay](results/parity-tree-entropy-effort7-public.json) reproduces all five independently exact prototype outputs: 484,347 / 649,404 / 613,268 / 133,365 / 416,143 bytes on im26-1030 / 1416 / 2018 / 5032 / original screenshot. Across all sixteen inputs, thirteen complete files shrink and three retain identical bytes. The original 12 MP photo saves another 10,072 bytes. All sixteen effort-1 files remain identical. Both independent decoders preserve every original uint8/uint16, hidden RGB and alpha sample.

The [production artwork controls](results/learned-tree-entropy-artwork-controls.json) preserve both full independent grids and every qualified baseline byte. Varying/hidden 513-square artwork saves 173 bytes, becoming 13,807 bytes; the 512-square 477-byte file stays unchanged. Only encoded size/checksum expectations change after this proof. The [original production minimum](results/learned-tree-entropy-production-minimum-controls.json) still accepts the exact 586-byte stream at 221,988 owned bytes and rejects 221,987 with empty output. Optional-search peak recovery remains separate.

The [fresh complete quality replay](results/quality-tree-entropy-public.json) newly encodes all 91 previous settings. 24 files are smaller; the other 67 encoded hashes remain identical. Every full native/Rust grid, original alpha sample, black/white score, SSIMULACRA2 and Butteraugli coordinate remains unchanged. All bands, inversions and adequately matched ratios are recomputed with the original 0.25-score limit. Eleven pairs remain adequate and thirteen unresolved. The first photo at score 80 remains 4.512% above wasm-vips.

Twenty-one focused tree regressions cover all starting bit alignments, signed thresholds, full int32 payload fallback, malformed input, legacy working-limit fallback and zero leaked storage. Real Chromium also checks tree fields/fallback, mixed learned 8/16-bit groups, palette limits and artwork alongside Node. The [production evidence audit](results/learned-tree-entropy-production-audit-final.json) re-reads all current quality and artwork artifacts, full grids, pins and band calculations; final lossless/minimum/module checks remain separate.

The completed `npm run check` gate passes 269 test files and 3,635 tests, with one file and three existing tests skipped. Eighteen real Chromium cases pass; the four affected helper cases pass again after lint and type corrections. The [final verification](results/learned-tree-entropy-final-gates-final.json) re-reads all 32 current lossless artifacts and 64 independent grids, checking 384,733,048 original sample comparisons. It also verifies the original minimum-memory boundaries and all rebuilt public modules against the measured quality cohort. The metadata policy is retained. Earlier failed gates and exact document copies remain separately recorded.

The first seven-pair runtime control is retained as inconclusive. Its [15-pair retry](results/learned-tree-entropy-performance-retry-controls.json) uses documented event-loop-settled collection outside the unchanged timed complete encode, with all baselines at 3,189,991 ArrayBuffer bytes. Paired cold/warm medians are -0.539% / +0.563%, with 95% intervals [-2.387%, +1.809%] / [-0.561%, +4.444%]. Both remain below the unchanged 5% protection threshold, as do peak-RSS medians and upper intervals. This protects representative overhead and establishes no speed gain.

The [package-cost control](results/learned-tree-entropy-package-controls.json) measures 1,522 additional minified bytes on each public JPEG XL target, before changing any ceiling. Original 233,093 / 255,489 reference sizes remain unchanged. Temporary binaries, logs and copied first-party experiments stay ignored. This metadata correction leaves the screenshot, remaining capped photos and lossy/unsampled comparisons open; overall compression parity is unproven.

## Screenshot scalar palette control

The inspected native screenshot uses separate color palettes, while the retained 8-bit multi-group path does not search them. A copied first-party control adds ordinary scalar RGB palettes and preserves alpha unchanged. The first attempt fails before writing a candidate because the existing gradient helper supports six transformed planes and this input needs seven. The retry extends that helper only in the copied experiment; production remains unchanged.

Both complete retry files preserve every original sample in libjxl and Rust. The baseline reproduces 416,143 bytes; the candidate is 416,146. Every group rejects the scalar-palette stream. The two largest scalar sections cost 307,710 / 235,118 bytes versus 244,121 / 177,644 for their raw alternatives. Owned peak storage rises from 137,282,142 to 178,765,412 bytes. This ordinary local palette policy is rejected. It does not test native global palettes, delta entries or learned scalar-index models, and it establishes no speed or broader parity claim. The baseline-only failed attempt and complete retry retain separate reports and receipts.

A subsequent sample profile explains why the native palette counts differ from ordinary RGB8. Its palettes contain 271/272 distinct actual values from 0 through 505, with 15/16 entries above 255. Those values occur in the decoded planes before patch composition: each color has 37/38 samples above 255. The native file uses 1,279 additive color patches; 34,054–34,091 pre-patch samples per color differ from the final screenshot. Alpha remains exactly 255. Both complete files first reproduce all 8,294,400 original samples through the public first-party decoder. The native palettes describe a different patch residual representation, so simply adding ordinary raw RGB palettes does not reproduce its compression policy. This identifies a separate patch/model investigation and does not measure a compression gain.

## Screenshot groups and local models

The [fixed-representation group control](results/current-patch-residual-group-controls.json) keeps the current first-party reference atlas, replacement patches and original pixels. Changing display groups from 1024 to 256 pixels reduces the complete diagnostic file from 416,146 to 402,110 bytes. Twenty-one of forty smaller groups select the existing tuple palette; none of the four large groups selects it. The feature/global section remains 1,328 bytes, while group-header bytes rise from 20 to 88. This locates part of the remaining gap in how the encoder divides regions for palette and prediction models.

The [complete encoder policy](results/patch-group-public-policy-controls.json) retains the current full file as a size floor and tries smaller groups as an optional alternative. It produces 402,055 bytes instead of 416,143, saving 3.39%. Both independent decoders preserve every original sample, and owned storage closes. The file still exceeds the frozen jSquash result of 391,394 bytes by 2.72%.

This repeated search is rejected for runtime cost. Its [three-pair isolated pilot](results/patch-group-performance-pilot.json) records twelve complete cold/warm encodes with the independently exact expected hashes. Paired median encode time rises 81.42% cold and 75.72% warm. Their 95% bootstrap intervals are [78.93%, 83.15%] and [74.23%, 76.15%]. Both exceed the original 5% protection limit. This pilot can reject a large regression; it cannot establish production acceptance. Peak RSS has separate observations and does not establish a memory improvement.

Reusing the existing larger-group trees also fails to close the gap. The [ordinary selection control](results/patch-model-reuse-controls.json) keeps the exact 416,143-byte baseline. The [forced discarded alternative](results/patch-model-reuse-forced-controls.json) confirms that the actual forty-group file is valid but larger at 418,331 bytes. Local residuals and histograms are rebuilt, and unreachable tree branches are removed. Weaker local models erase the palette saving. This policy is also rejected.

A [fresh CPU profile](results/patch-baseline-cpu-profile-counts.json) identifies learned-tree construction and weighted prediction as major sampled costs. Two timestamp deltas reverse by one microsecond, so the reader preserves those values and ranks stack sample counts. The profile guides the next control and establishes no speed claim.

The [position-aware tree control](results/spatial-tree-controls.json) adds local row and column splits to the existing groups. It produces 413,957 bytes, saving 2,186 bytes (0.53%), with exact original pixels in both independent decoders. It preserves existing group sizes and avoids a second small-group encode. Its [three-pair cost pilot](results/spatial-tree-performance-pilot.json) records a cold paired median increase of 6.00%, with interval [4.44%, 6.84%], and a warm increase of 3.37%, with interval [3.00%, 7.41%]. These intervals cross the 5% protection limit. The policy is conservatively rejected for its small saving and unqualified cost. Peak RSS remains inconclusive; this experiment has not changed production.

The [completed control audit](results/patch-policy-controls-audit.json) re-reads all eight experimental files and sixteen independent grids, then checks every original sample through the ordinary public decoder. It also verifies all twenty-four measured cold/warm hashes, settled memory baselines and paired calculations. The retained encoder and published comparison outputs remain at source `31996a26477cada593b663b62075fe983975bffba76e74c9bd3f67792d0fd222`. These controls narrow the screenshot investigation. They do not close its jSquash gap, the remaining lossy size gaps, or the unresolved quality comparisons.

## Smaller screenshot groups

The [group and cache controls](results/small-group-cache-controls.json) use
256-pixel display groups for selected lossless effort-7 flat-background
patch images. The reference atlas keeps its previous policy. Training uses
8,192 samples per plane and a 32,768-entry LZ match cache. The ordinary
frame's measured size guards the choice: cheap frames below half a bit per
pixel keep the previous groups. At most 64 smaller groups are considered.

The [eleven-input control](results/small-group-cache-neighbor-controls.json)
preserves every original sample in native, Rust and public decoding. The
screenshot becomes 407,341 bytes, saving 8,802 bytes (2.115%) against the
previous retained file. Full portrait, wide RGB/RGBA and hidden-alpha wide
images also shrink. All six cheap or fallback controls keep identical files.
Both wide cases exercise a second DC group. The smaller file still exceeds
jSquash's pinned 391,394 bytes by 4.074%; it is 3.563% below wasm-vips.

The first small-group policy increases backing-allocation traffic and leaves
warmed-process RSS inconclusive. Its cohort remains unretained. The reduced
match cache lowers that traffic. Its separate
[fifteen-pair qualification](results/cache-small-group-performance-controls.json)
preserves all sixty independently exact complete encode hashes. Cold/warm
time medians change +0.140% / -1.166%, with 95% intervals
[-0.684%, +0.737%] / [-1.830%, +1.823%]. These establish no speed gain.
Cold peak RSS falls 23.298%, with interval [-25.178%, -17.338%]. Cumulative
warmed-process peak RSS falls 5.363%, with interval [-6.062%, -1.954%].
Every original 5% protection upper bound passes. Earlier cohorts are kept
separate in the [paired audit](results/cache-small-group-paired-audit.json).

The [saved-file audit](results/cache-small-group-controls-audit.json)
rechecks all 22 files, 44 independent grids, 207,443,224 independent sample
comparisons and 103,721,612 public sample comparisons. New generated RGB/RGBA
regressions cover partial groups, two DC groups, every sample, caller input
and storage cleanup. Cheap public-file tests retain their exact original
codestream sizes and checksums. Their 40-byte container prefix is kept
separate from raw codestream size.

## Stronger screenshot training

Two exact learner shortcuts reduce work before increasing the selected
256-pixel display groups' training cap from 8,192 to 16,384 samples. Each
channel creates weighted-prediction state only when its own learned tree
uses that predictor or property. A plane whose deterministic training
positions all have zero original residuals keeps its original predictor:
its sampled cost is already zero and a one-symbol leaf cannot split.
Unsampled values and original residuals remain intact. Ordinary/reference
training stays at 65,536 samples, and the smaller display groups keep the
32,768-entry match cache.

The [complete sampling controls](results/funded-sampling-controls.json)
preserve every original sample in both independent decoders. Training at
12,288 / 16,384 / 32,768 samples emits 404,861 / 401,990 / 401,637 bytes.
The 32,768-sample policy saves only 353 more bytes while adding 3.396 seconds
in its single diagnostic observation. It is not retained.

The [eleven-input controls](results/funded-sampling-neighbor-controls.json)
show no file growth. The screenshot saves 5,351 bytes (1.314%) against the
qualified 407,341-byte file. Wide RGB/RGBA, full portrait and hidden-alpha
wide cases also shrink; six cheap or fallback files keep identical bytes.
All 22 complete files and 44 independent grids preserve every original
sample, including the wide cases crossing a second DC group. The screenshot
still exceeds frozen jSquash by 2.707%; overall parity remains open.

The [fifteen-pair cost qualification](results/funded-sampling-performance-controls.json)
keeps all sixty complete cold/warm encodes and the original five-percent
protection. Cold/warm time medians change -0.341% / -1.177%, with 95%
intervals [-1.131%, +0.702%] / [-3.375%, +0.999%]. Cold/cumulative-warm
RSS medians change +0.173% / -1.432%, with intervals
[-0.945%, +4.640%] / [-2.756%, +1.920%]. All upper bounds pass; every
interval crosses zero, so this establishes no speed or RSS improvement.
Individual outliers remain in the raw data. The
[paired audit](results/funded-sampling-paired-audit.json) recomputes the
original medians, intervals, win rates, hash checks and settled memory observations.

The [compact fixture checks](results/funded-sampling-fixture-controls.json)
retain exact RGB/RGBA files of 3,659 / 4,236 bytes under the original
134,217,728-byte working cap, with nine groups and two DC groups. Two new
shared regressions preserve an unsampled nonzero residual and a constant
channel beside a learned channel at both training caps in Node and Chromium.
Original memory limits and exact-file expectations remain unchanged.

The [package-cost control](results/funded-sampling-package-controls.json)
adds 283 / 294 minified bytes. Core + JPEG XL and the specialized APIs
measure 540,978 / 613,578 bytes, within unchanged 541,000 / 614,000 ceilings.
Original 233,093 / 255,489 references and the zero runtime dependency policy
remain unchanged. Earlier rejected sorting, patch-threshold and scalar-palette
experiments remain recorded. The fresh public lossless and quality reports
above preserve their distinct source identity; earlier speed tables retain
the original measured build.
