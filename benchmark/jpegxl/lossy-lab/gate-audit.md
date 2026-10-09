# Current lossy encoder gate audit

Task 1 inventory, 2026-10-09. No gate has been changed or tested by this audit.
Trials begin after the lab baseline required by
[LOSSY_STEERING.md](../LOSSY_STEERING.md). Each proposed trial changes one gate
and uses development BD-rate, speed and memory. The size of a previous measured
image is not a reason to retain an admission window.

Scope is the tracked VarDCT forward path and the public lossy controller that can
replace its output. Lossless-only Modular searches and decoder gates are outside
this inventory. Source locations below refer to the current checkout; function
names help locate them after edits. Provenance is recorded in
[PROVENANCE.md](../PROVENANCE.md).

## Shared conditions

Let `P = width * height`, `B = ceil(width/8) * ceil(height/8)`, and `d = distance`.
These are literal conditions from `src/codecs/jpegxl-vardct-encode.ts`:

- `sdrAlpha` (`:663`): effort 7, four channels, depth 8, one-byte storage,
  sRGB primaries and sRGB transfer.
- `rgbDcPolicy` (`:669`): initially true for three channels. For admitted
  `sdrAlpha`, scan every alpha for 255 and require more than 2,048 visible RGBA
  tuples. A palette-allocation limit makes this false (`:678-695`).
- `moderateSdrDc` (`:712`): `d > 1`, effort other than 1, `rgbDcPolicy`, depth 8,
  one-byte storage and sRGB primaries/transfer.
- `originalDarkAc` (`:730`): compression search, `sdrAlpha`, `rgbDcPolicy`,
  nonprogressive, `P > 4,194,304`, `d <= 1`.
- `originalPhotoAc` (`:741`): compression search, `sdrAlpha`, `rgbDcPolicy`,
  nonprogressive, `P > 4,194,304`, `d > 1`.
- `coarse` (`:1195`): compression search, `moderateSdrDc`, effort 7,
  `(d >= 6 || originalPhotoAc)`, four channels, nonprogressive,
  `P <= 16,777,216`.

The effective 16,777,216-pixel ceiling on `originalDarkAc` and `originalPhotoAc`
comes through `rgbDcPolicy`; their own declarations have no upper-area test.

## Pixel-count and distance gates inside VarDCT

All rows in this table are encoder heuristics. Retain color/depth/format safety
checks when changing a numeric area or distance test.

| Source in `src/codecs/jpegxl-vardct-encode.ts` | Exact condition, including shared conditions above | Effect | Candidate trial |
| --- | --- | --- | --- |
| `canSearchConeFrame`, `:293-310` | Effort 7, RGBA8, one-byte storage, nonprogressive, `4,194,304 < P <= 16,777,216`, `1 < d < 4`, sRGB primaries/transfer | Encode a second cone-objective frame and choose fewer bytes. | Remove the area window first; separately widen the distance window. Count complete-file work. |
| `rgbDcPolicy`, `:671-675` | `sdrAlpha`, `(d > 1 || (compressionSearch && P > 4,194,304))`, `(P <= 4,194,304 || (compressionSearch && P <= 16,777,216))`, alpha depth 8 | Allow opaque, non-small-palette RGBA to use RGB DC policy. | Remove only the area window; separately remove the distance split. |
| `alphaPaletteSearch`, `:696-709` | `sdrAlpha`, nonprogressive, `P <= 1,048,576`, alpha depth 8 | Disable alpha palette search for small visible palettes; limit failure also disables it. | Widen area independently; retain exact alpha semantics and bounded allocation. |
| `moderateSdrDc`, `:712-720` | Shared condition `d > 1` | Choose coarser channel-specific DC steps. | Compare one continuous DC policy across distance 1. |
| `finerSdrAc`, `:721-729` | Effort 7, RGB8, one-byte storage, `2 <= d <= 4`, sRGB | Raise ordinary and strong-edge AC Q. | Remove the distance window, preserving RGB and color checks. |
| `originalDarkAc`, `:730-736` | Shared condition `P > 4,194,304 && d <= 1` | Enable fine source scores, content-specific Q and rate-aware rounding. | Remove area cutoff; separately test distance admission. |
| `originalPhotoAc`, `:741-747` | Shared condition `P > 4,194,304 && d > 1` | Enable photo-specific Q, penalties, DC, channel and large-transform paths. | Remove area cutoff; separate downstream policy changes. |
| `dcQuantization`, `:751` | `originalPhotoAc && d < 2` | X DC step `1/8192`; otherwise photo X DC `1/16384`. | Test one X DC step across distance 2. |
| Initial Q, `:1135-1138` | `originalPhotoAc && d < 2` uses dark/edge tests; `originalPhotoAc && d >= 4` uses bright/variance tests | Promote Q7 to Q8 in different content regions. | Remove one distance restriction at a time, keeping the source tests fixed. |
| PQ edges, `:1150` | `brightPqAc && 2 <= d <= 4 && gradient > 0.01 && activity > 3` | Set Q6. `brightPqAc` is effort 7, three channels, PQ. | Widen the distance window on the HDR watch set. |
| `coarse`, `:1195-1202` | Shared `d >= 6 || originalPhotoAc`, `P <= 16,777,216` | Rate-aware AC rounding and DCT16 eligibility. | Remove area ceiling; separately test the distance condition. |
| `sharpnessMap`, `:1221-1229` | Strategy map, `d >= 2`, `(channels != 4 || (effort 7 && moderateSdrDc))`, sRGB transfer/primaries | Allocate adaptive EPF sharpness. | Widen distance admission with a separate filter trial. |
| Local contrast refinement, `:1312-1335` | Effort 7, three channels, `1 < d < 5`; strength `min(1, d-1, 5-d)` | Refine Q up to 8 against a relative-error target of 0.04. | Remove the distance fade/window in one trial. |
| Fine allocation, `:1407-1505` | `sourceScores && strategyMap && variance(log(scores+1e-6)) > (-2 log(0.94))²` | Nine-Q DCT8 allocation with 6% proxy reduction, X0/B1 and half-Y penalties. | Test removal of the variance gate; do not combine with area widening. |
| DCT16, `:1519`, `:1555` | `coarse && strategyMap`; cone error additionally needs `coneSearch && originalPhotoAc && d < 4` | Enable DCT16 menu and select coding or cone objective. | Widen eligibility independently from changing the objective. |
| B1, `:1843` | `originalPhotoAc && d < 2` | Set B scale 1 and AC multiplier 1.25 after DCT16 selection. | Evaluate one channel policy across distance 2. |
| COUNT large stage, `:1857-1866` | `originalPhotoAc`, `2 <= d <= 4`, strategy map, each block dimension >=4, default forward matrix, X2/B2 | Select DCT32 or two independent rectangle halves with COUNT/magnitude costs. | Widen the distance range while retaining representable geometry and channel steps. |
| Advanced Modular search, `:2220-2222` | `coarse || (compressionSearch && sdrAlpha && rgbDcPolicy && P > 4,194,304 && !progressive)` | Enable additional DC/metadata coding searches. | Remove only area restriction; measure search cost. |
| Conditional large stage, `:2259-2267` | `originalPhotoAc`, `d > 4`, strategy map, each block dimension >=4, default matrix, X2/B2 | Train original orders/model, price large choices, solve aggregate original-error budget. | Compare one objective over the existing 2-4 and >4 boundary; channel-step support is required before extending into B1. |

## Geometry and work-count thresholds

These also select paths by input size, even though they do not use pixel area
directly.

| Source | Exact condition and effect | Candidate trial |
| --- | --- | --- |
| `src/codecs/jpegxl-vardct-encode.ts:437-444` | Order search requires effort 7, `loadAc`, more than one AC group and `B >= 1,024`. It compares natural/learned orders and family contexts through complete serialization. | Remove the block-count cutoff separately from reducing complete-file searches. |
| `src/codecs/jpegxl-vardct-encode.ts:760-766` | Effort 1, not RGBA, nonprogressive, `1 < ceil(blocksWide/32)*ceil(blocksHigh/32) <= 256` enables deferred DC. | Widen group ceiling with memory and byte checks. |
| `src/codecs/jpegxl-vardct-encode.ts:1397-1401` | Sharpness survives only if `active*2 >= sharpnessMap.length`. | Remove this coverage threshold while keeping the same sharpness values. |
| `src/codecs/jpegxl-vardct-large-menu.ts:478` | Only complete aligned 4x4-block windows enter the large menu; fringe leaders retain original geometry. | Keep footprint bounds. A fringe-capable menu is a separate geometry change. |
| `src/codecs/jpegxl-jpeg-encode.ts:267` | Repeated alpha coding requires repetition search and at least 64 alpha samples, followed by a nonconstant test. | Remove the sample-count cutoff, retaining exact alpha and smaller-bit selection. |
| `src/codecs/jpegxl-jpeg-encode.ts:951-961` | Shared alpha coding requires alpha palette search, `loadAc`, effort 7, default matrices, 2-64 AC groups and `B >= 1,024`. A varying alpha group is also required. | Widen group/block bounds independently; measure retained group storage. |
| `src/codecs/jpegxl-jpeg-encode.ts:2645-2654` | Luma-context alternate requires AC iteration search, default matrices, XYB, nonprogressive, nondeferred DC, no prior threshold, `B > 65,536` and complete scalar DC planes. | Remove the block-count cutoff while keeping plane and format checks. |

The async cone-frame caller additionally skips its alternate when compression or
cone search is explicitly false, or for reference/patch frames
(`src/codecs/jpegxl-vardct-encode.ts:597-602`). These frame and caller controls
remain intact in an area-window trial.

## Color-count and public replacement gates

The public controller in `src/codecs/jpegxl-modular-encode.ts` can return an
alternate instead of the initial VarDCT file. Its gates affect lossy benchmarks
even when an alternate uses Modular coding.

| Source | Exact condition and effect | Candidate trial |
| --- | --- | --- |
| `hasSmallVisiblePalette`, `:4760-4785` | Ignore fully transparent pixels; count exact RGBA tuples of visible pixels. Return true at <=2,048 colors, false on the 2,049th. This affects DC policy and artwork search. | Widen the count cutoff with appropriately sized bounded storage; separate the two callers. |
| Alpha palettes, `:3454`, `:3499-3505` | Repeated/shared alpha palette alternatives admit at most 16 distinct values per plane, each in 0-65,535. | Widen color count separately, preserving the value range and complete-bit comparison. |
| Public artwork, `:5480-5495` | RGBA8, effort 7, nonprogressive, `P <= 1,048,576`, color/alpha depth 8, sRGB, <=2,048 visible colors | Try an exact Modular file; accept only at least 5% smaller than primary (`:5521`). | Widen area separately from color count; retain visible-alpha equivalence. |
| Quantized artwork, `:5527`, `:4687-4715` | Previous small-palette detection and `d >= 2`; width >=2, at least two rows, every alpha255 and <=2,048 RGB colors | Quantize non-flat palette colors with step `8*d`; accept >=5% byte saving. | Remove distance cutoff or widen color count separately; quality is part of acceptance. |
| RGB alternate strategy, `:5551-5561` | RGB8, effort 7, nonprogressive, `1 <= d <= 4`, `262,144 <= P <= 12,000,000`, depth 8, sRGB | Encode rate-distortion strategy alternative; accept >=1% byte saving (`:5587`). | Remove area bounds first; separately widen distance. |
| Screenshot replacement, `:5594-5604` | RGB8, effort 7, nonprogressive, `2 <= d <= 4`, `262,144 <= P <= 4,194,304`, depth 8, sRGB | Try a patch/reference frame; accept >=0.5% smaller (`:5617`). | Remove area window first; separate distance widening. |
| Screenshot background, `src/codecs/jpegxl-flat-patches.ts:42-57` | Sample 4x4 patches every17 pixels, RGB difference <=1; require samples>0 and >=35% flat | Skip expensive patch discovery on other content. | Remove the prevalence cutoff and measure search time. Keep sample bounds. |
| Screenshot patch count, `src/codecs/jpegxl-modular-encode.ts:5336-5342` | 1-1,024 patch groups, >=40 placements, covered area >=0.5% of P, atlas area <=262,144; atlas height <=1,024 (`:5366`) | Admit screenshot reference construction. | Widen coverage/count limits separately. Atlas memory bounds remain explicit. |
| Large document, `useLargeDocumentModularCandidate`, `:4806-4833` | RGB8, `P >= 8,000,000`, effort 7, `d >= 2`, nonprogressive, depth 8, sRGB; sample each 64th pixel, RGB each >=248, require >=80% white | Try four-code quantization plus Modular and document patches. Accept >=20% byte saving for Modular, >=5% for patches (`:5639`, `:5650`). | Remove area cutoff first; separately remove white coverage and distance cutoffs. |
| Document patch count, `:5187-5192` | 1-1,024 groups, lossy placements>=500, coverage>=5% of P, atlas area<=1,000,000 | Admit document patch output. | Widen placement/coverage limits one at a time, retaining bounds. |

Patch discovery has further component-size gates. Document discovery stops above
20,000 components (`src/codecs/jpegxl-modular-encode.ts:4870`), rejects patches
wider/taller than 64, bounding area below 20 or fewer than 8 dark pixels (`:4907`).
Screenshot discovery also stops above20,000 components
(`src/codecs/jpegxl-flat-patches.ts:138`), rejects width/height above 64, bounding
area below 8 or fewer than 2 component pixels (`:171-175`), and requires at least 2
byte-identical placements (`:222`). These are bounded discovery heuristics.
Trial each minimum-area/count gate separately from its memory ceiling.

## Validation boundaries

`src/codecs/jpegxl-vardct-encode.ts:648-658` requires positive safe dimensions,
sample depth 8-16, exact source byte extent, a header for high-depth/grayscale,
and finite `0.25 <= d <= 25`. Public option validation repeats the distance range
in `src/codecs/jpegxl-modular-encode.ts:5908-5915`. Dimension and allocation
limits are enforced through `validateImageDimensions` and managed memory. These
are API and safety checks, not gate-removal candidates.

Opacity, associated alpha, color conversion and transform-footprint bounds must
remain correct in every trial. Numeric image-size, distance, color-count and
coverage restrictions above remain unqualified until a new lab trial compares
them. Historical examples and comments such as “outside the measured SDR
experiments” supply no development-corpus BD-rate justification.
