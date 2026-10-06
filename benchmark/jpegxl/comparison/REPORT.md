# Public JavaScript JPEG XL comparison

The [broader original-photo baseline](ORIGINAL-MATRIX.md) confirms that
overall lossy parity remains open. On the unresized portrait, PureJsImage
uses 10.50–28.66% more bytes than jSquash at the three adequately matched
Butteraugli targets, despite competitive SSIMULACRA2 results. This is
separate from the earlier passing photo and frozen comparison counts.

The earlier [original-size photo checkpoint](ORIGINAL-PHOTO.md) closes the
measured SSIMULACRA2 compression gap on the original 4000 × 3000 photo.
Current files are 9–13% smaller than jSquash and 8–16% smaller than wasm-vips
at targets 70, 80 and 90. All six pairs pass the original quarter-score
bracket rule. Complete independent endpoint pixels, both metrics, fresh
public package streams and allocation recovery are qualified. Separately
matched Butteraugli targets use fewer bytes at all four jSquash targets and
both resolved wasm-vips targets. Two wasm-vips targets remain unresolved
under its exhausted 24-attempt budget. Other original-size photos, HDR,
float, CMYK and animation need separate compression evidence.

The fresh [transparency comparisons](ALPHA-POINTS.md) dominate all six selected
actual peer files on size and both aggregate black/white quality metrics.
Exact production alpha, all public decoded samples and 20 complete
native/Rust grids are checked. Together with the capped photo and graphic
studies, this covers all 24 original diagnostic peer/target selections.
The historical 13 adequate and 11 unresolved interpolation counts remain
unchanged; direct file comparisons do not manufacture missing brackets.

The preceding [capped photo compression checkpoint](PHOTO-PARITY.md) meets both frozen
WASM peer sizes at matched SSIMULACRA2 70, 80 and 90 on both pinned photos.
The remaining first-photo score-70 gap closes: 45,675 interpolated bytes is
0.53% below wasm-vips. Six photo bands retain the original 0.25-score rule and
no extrapolation. All 34 original-domain files reproduce their measured bytes
and both metrics, with 68 complete native/Rust grids and every JavaScript
pixel checked. The tighter second-photo search remains separately inconclusive.
This does not change the frozen 13 adequate and 11 unresolved pair counts or
establish universal lossy, HDR, CMYK, animation, speed or memory parity.

The separate [opaque graphic recheck](GRAPHIC-POINTS.md) verifies three current
production files and six exact frozen peer files in 18 complete native/Rust
grids. Current points dominate all six sampled peer coordinates selected at
targets 70, 80 and 90 on size, SSIMULACRA2 and Butteraugli. These direct point
comparisons retain the original missing interpolation brackets and totals.

The [preceding photo production gates](results/photo-parity-production-final-gates.json)
record the passing full check, all 69 relevant real-browser cases, unchanged
package exports and 420 rehashed physical evidence pins. The earlier manifest
test-evidence failure is preserved separately from the successful rerun.

The latest [alpha palette search](ALPHA-PALETTES.md) reduces the pinned
transparency coordinates from 48,819/47,112/46,530 to 9,038/7,331/6,749 bytes.
Every decoded color and alpha sample remains unchanged in both independent
decoders. A separate higher-quality 9,155-byte point dominates the frozen
9,307-byte exact-alpha wasm-vips point on size, SSIMULACRA2 and Butteraugli.
This is a measured point comparison. It does not change the frozen 13 adequate
and 11 unresolved pair counts. That checkpoint left the photo score-70 gap
open. Alpha package sizes and their small budget increase are
recorded in the linked evidence, separately from the earlier checkpoints.

The current [lossless group search](GROUP-SEARCH.md) meets or beats the pinned
peer size in all 45 independently exact comparable integer-lossless corpus
cells and all four separate original-size controls. Three cells without a
matching exposed competitor API remain excluded. The original screenshot is
386,813 bytes at effort 7, below jSquash's 391,394 bytes. The 12 MP photo is
7,452,825 / 6,183,475 bytes at efforts 1/7, below both tested peers. All original
native 8-bit and 16-bit samples, alpha and hidden RGB match in libjxl and Rust.
That lossless checkpoint's codec source SHA-256 is
`792b04814811f17458fca81c3c21ff661412f3731e0f68405e0312ba1934041f`.

The preceding qualified [lossy photo checkpoint](FILTER-AC.md) retains 13 adequately
matched pairs and 11 unresolved pairs. Both tested photos are smaller than both
pinned peers at SSIMULACRA2 80 and 90. The first photo at score 70 remains 3.00%
larger than wasm-vips and 2.28% larger than jSquash. Float, CMYK and animation
compression still need comparable evidence. Overall compression parity remains
open. These compression results are separate from the frozen speed tables.

## Earlier compression checkpoints

The earlier [learned-tree metadata qualification](PARITY.md#learned-tree-metadata-production) compares prefix and ANS coding for the same learned trees. All thirteen changed effort-7 files are strictly smaller; the other three retain their complete bytes. Every effort-1 file stays unchanged. All sixteen inputs at both efforts preserve every original native uint8/uint16 sample, alpha and hidden RGB in libjxl and Rust. The 12 MP photo is 7,452,825 / 6,220,181 bytes at efforts 1/7, below both pinned WASM files. The screenshot at that checkpoint is 416,143 bytes at effort 7, 6.32% above jSquash.

At that checkpoint, all 91 lossy settings were encoded through the same public build. 24 complete files shrink and the other 67 keep identical encoded hashes; all full independent grids and quality scores remain unchanged. Eleven matched pairs remain adequate and thirteen unresolved. The first photo exceeds wasm-vips by 4.51% at score 80. Checkpoint source
`31996a26477cada593b663b62075fe983975bffba76e74c9bd3f67792d0fd222`
is separate from the earlier performance measurements below. Overall compression parity remains open. The metadata search adds encoding work and does not establish a speed gain.

The earlier [artwork qualification](PARITY.md#artwork-production-qualification)
extends the exact effort-7 candidate to one megapixel with a complete-size
floor and scoped storage cleanup. Three distance-3 graphics shrink 55–82%
and preserve every original sample. In the full 91-setting public replay,
eighteen files become smaller and exact; the other 73 preserve their encoded
hashes, independent grids and quality scores. Eleven matched pairs and
thirteen unresolved pairs remain. The extra exact search adds substantial
encoding work.

The later [patch metadata controls](PARITY.md#patch-metadata-controls) isolate
another small compression cost. Three or four field models save 88–469 bytes
on four exact graphics and 283 bytes on the original screenshot, preserving
every sample in both independent decoders. Several jSquash gaps remain.
The separate skyline packing control is rejected after saving only 16–61 bytes.

The qualified [learned palette controls](PARITY.md#learned-palette-controls)
address an exclusion in the existing prediction search. Three actual public
lossless graphics shrink another 2.4–10.7%, preserving every sample in native
and Rust decoding. One closes its pinned jSquash size gap; another remains
3.3% larger. Original working limits, hidden samples and browser behavior pass
focused checks. The complete 91-setting replay verifies 23 smaller files,
including five improved exact graphic selections; 68 hashes stay unchanged.
Eleven matched-quality pairs remain adequate and thirteen unresolved. Both
independent decoders, the full repository gate, the original minimum memory
boundary and rebuilt public-module identity pass. Overall parity remains open.

## Scope

This is a manual comparison of PureJsImage, `@jsquash/jxl` 1.3.0,
`jxl-oxide-wasm` 0.12.6 and `wasm-vips` 0.0.19 on one Linux host.
The comparison measured a local public-API build based on
`590bbf08968f0f12c32bb4aa5c84627ba5dbeab4`. The floating-point, ICC/HDR,
animation and native crop changes were uncommitted during measurement.
The codec source SHA-256 is
`088ba519315f3498cd388eaf0c7bef92c0a15c6702107e04219ed486760332ca`.
The reports retain both identities and the dirty-build flag. These measurements
cover the local repository build rather than the published 0.17.0 tarball.

[Generated summary](SUMMARY.md), [website dataset](website-data.json),
[subject/assets manifest](subjects.json), [fixture manifest](fixtures.json), and
[dated official-source survey](survey.json) are the handoff artifacts.
Raw reports live in [results](results). The [artifact index](results/artifact-index.json)
pins the measured binaries and harness files. The [quality validation](results/quality-correctness.json)
checks all 87 scored artifacts; five retain nonzero alpha error from comparator defaults. The website dataset is generated from
those reports. No overall winner score is calculated.

The separate [compression investigation](COMPRESSION.md) explains the large-image
effort-1 lossless policy, opaque-alpha overhead and remaining encoder tool gaps.
It adds exact same-input effort-3/7 controls and native filter controls at measured
lossy quality. These diagnostics retain the frozen public comparison and its
unresolved quality targets.

[Compression parity progress](PARITY.md) records the subsequent effort-1 channel
models, effort-7 learned prediction trees, reversible color search and exact
lossless patches on pale and colored flat backgrounds, independently exact outputs and
increased encoding cost. Those results are separate from the frozen performance
and quality tables. The current integer-lossless result is documented in
[lossless group search](GROUP-SEARCH.md); the lossy comparison still has gaps.

The earlier [tighter quality curves](PARITY.md#tighter-lossy-quality-comparisons)
resolve eleven of 24 public comparator/target pairs at SSIMULACRA2 70, 80 and
90, using brackets no wider than 0.25. On the first photo PureJsImage is
4.51% larger than wasm-vips at score 80 after the DC, coefficient-order and metadata corrections;
on the second it is 26.45% smaller
at score 90. After the alpha entropy and coefficient-order corrections, the transparency
score-90 estimate is 25.66% smaller than jSquash,
with identical independently decoded pixels.
Thirteen pairs remain unresolved. These newer measurements preserve the
frozen tables below and do not establish an overall quality winner.

Later [coefficient controls](PARITY.md#coefficient-rounding-allocation-and-order-controls)
reject the tested rounding and AC allocation policies. Adaptive scan-order
prototypes preserve every independently decoded pixel. The subsequent
[qualified order search](PARITY.md#adaptive-forward-coefficient-orders) adds a
complete file-size guard, allocation fallback and native-depth/progressive/
browser checks. All 91 public quality points retain their decoded hashes and
scores; 85 files shrink and six remain unchanged. These newer measurements
keep the frozen public tables intact and leave compression parity open.

The subsequent [AC entropy investigation](PARITY.md#ac-entropy-and-block-context-investigation)
verifies 96 isolated streams without changing the qualified encoder.
Frequency rounding costs only a few photo bytes. Tested histogram and block-context
changes mostly fail to reduce complete photo sizes. Family contexts save 1.78%
on the checked graphic, but that control still needs broader qualification.
Transform, quantization and restoration decisions remain open compression work.

The [Gaborish preconditioning controls](PARITY.md#gaborish-preconditioning-controls)
test restoration with bounded first-order and fuller inverse approximations.
All 152 measured streams pass independent decoding and exact alpha. Tighter
curves make every adequately matched estimate larger than the qualified encoder,
so none of these policies is retained. These diagnostics keep the public
comparison unchanged and do not establish compression parity.

The [qualified family-context search](PARITY.md#optional-transform-family-entropy-models)
now retains the graphic opportunity behind a complete file-size guard.
It preserves all independently decoded pixels and exact alpha, including native
depths, progressive output, cancellation, Chromium and allocation fallback.
All 91 prior public quality points keep their scores and grids; 29 files shrink
and 62 are unchanged. This adds entropy-encoding work and scratch. The first
photo's score-80 gap at that checkpoint was 6.41%, with thirteen public pairs still unresolved.

The [larger-transform cost controls](PARITY.md#larger-transform-coding-cost-controls)
test two isolated DCT16 selectors on 98 independently decoded streams. AC-only
selection saves AC bytes but adds more DC-group bytes. Including DC residual
cost removes most of that growth, but both policies regress at protected
matched-quality points and are rejected. Those selectors were not retained.

The [strategy/quantizer metadata correction](PARITY.md#strategy-and-quantizer-metadata-prediction)
uses left prediction only when the complete local metadata requires fewer bits.
All 91 replayed public settings preserve both complete independent grids and
quality scores; 67 files shrink and 24 are unchanged. The original 12 MP photo
saves 2.92% at the same distance and quality. Native-depth/progressive, Chromium,
cancellation and working-storage checks pass. The first capped photo's score-80
gap falls to 5.23% versus wasm-vips. Thirteen pairs remain unresolved, the frozen
performance tables below stay unchanged, and general compression parity is open.

The [separate strategy and quantizer models](PARITY.md#separate-strategy-and-quantizer-models)
remove another shared-model cost while retaining only smaller complete metadata.
All 91 fixed quality settings preserve both independent grids, both metrics and
exact alpha; 67 files shrink and 24 are unchanged. The original 12 MP photo saves
another 1.93% at the same distance and quality. The first capped photo's score-80
gap falls to 4.51% versus wasm-vips. The same thirteen pairs remain unresolved.
These results preserve the frozen performance tables and leave general parity open.

## Supported conclusions

The grouped-Modular correction decodes all 16 original lossless inputs with
zero sample error, including the seven rejected by the original comparison.
The previously rejected photo roundtrip also matches every sample. The full
comparison was rerun with the same pinned inputs and comparator versions.
The separate [pinned follow-up results](results/grouped-lossless-followup.json)
provide a shorter exact-sample verification. Reproduce that check after
restoring the pinned comparison inputs:

```sh
npm run build
node benchmark/jpegxl/verify-grouped-lossless.ts
```

Small first-party RGB8 and RGB16 fixtures pin libjxl 0.12.0 palette-before-RCT
output. Node and browser regressions check exact samples, odd partial groups and
cross-group crops. Checked multi-group global Palette/Squeeze streams now decode. Implicit
Palette prefixes combined with unsupported group-local transforms remain
explicitly guarded.

- The tested PureJsImage toolkit has the smallest loaded asset footprint among
  these four adapters. This includes the benchmark worker and both encode and
  decode entry points; it is not a survey of every possible JPEG XL bundle.
- PureJsImage decodes all 16 shared native-libjxl lossless streams exactly.
  This closes the observed grouped Modular failures. Checked global Palette
  and Squeeze layouts have additional fixture evidence. Transformed implicit
  Palette prefix layouts remain outside the supported scope.
- The three encoders expose different speed/compression tradeoffs. See the
  generated paired lossless table; the WASM encoders are substantially faster
  on several measured workloads. Exact validation is required before a row
  enters a ratio.
- Matched lossy size ratios are reported only for targets with adequate
  measured brackets on both sides. The generated table retains the actual
  ratios and unresolved targets. The finite photo and alpha subset does not
  establish a corpus-wide lossy ranking.
- Oxide preserves the tested 16-bit integer images through its native-depth PNG
  path. It does not expose raw sample planes or encoding. Its PNG export cost
  remains part of the measured operation.
- Specialized APIs have separate results: PureJsImage's native float, extra
  channel, ICC and exact JPEG reconstruction probes pass. New ordinary public
  API probes check 31-bit integer preservation, mixed floating alpha, bit-exact
  Float32 output, integer ICC preservation and twelve independently encoded
  floating VarDCT inputs, including linear HDR reference blends. Static alpha
  is exact; blended alpha allows 0.00000012 error, and linear color allows
  1/255 error. These additional probes do not infer untested comparator
  capabilities. wasm-vips' native
  float and ICC probes pass. Animation timing has additional limits described
  below. Exposed APIs that were not tested are not treated as unsupported.

### Animation timing observations

The 3/5 ms fixture is retained as an exact-timing edge case. wasm-vips writes
100/100 ms in that case. Its upstream
[jxlsave implementation](https://github.com/libvips/libvips/blob/master/libvips/foreign/jxlsave.c)
explicitly normalizes delays of 10 ms or less to 100 ms. The ordinary 30/50 ms
control is reported separately.

Oxide's published duration numerator/denominator pairs yield 3000/5000 for
that fixture, while its frame access and composition are checked separately.
The inspected
[WASM binding source](https://github.com/tirr-c/jxl-oxide/blob/main/crates/jxl-oxide-wasm/src/lib.rs)
multiplies frame ticks by the tick-rate numerator. This report does not treat
those values as a verified seconds-based timeline. No workaround changes the
wrapper's returned timing. These observations concern the tested binding and
settings, not the full capabilities of the underlying native engines.

## Inputs and semantics

The 16 stills include eight existing M7 development diagnostics, a complete
12 MP sunset, a complete 1920x1080 screenshot, two alpha references, gray8,
gray16, RGB16 and RGBA16. Four diagnostics are native-resolution crops; four
are reduced photographs. `scope: capped` identifies this diagnostic group;
it does not mean all eight are reduced full images. The large originals remain
separate. These inspected sources provide regression evidence, not an unseen
holdout. This comparison does not rerun or replace M7 qualification.

The manifests pin input and output hashes. The imazen sources retain their
licenses and original source identities in the existing
[M7 source selection](../production-program/m7-corpus-selection.json).
Conformance sources come from revision
`4bf053529c7cefd2951be453475bb3dccc7e7be8` of
[libjxl/conformance](https://github.com/libjxl/conformance). The selected alpha
and gray cases are CC0. Small native float, extra-channel, ICC and animation
probes use repository fixtures and deterministic public-API synthesis.

Common encode inputs are prepared once as sRGB RGBA8, straight alpha, stored
orientation 1. Gray/RGB expansion adds opaque alpha without changing color
samples. High-depth inputs remain uint16 and are reported separately. The
specialized float probe retains IEEE binary32 values above 1. No wrapper is
credited with native precision by converting its input to 8-bit.

Every decoder receives the same pinned bytes per row. Native libjxl 0.12.0
creates the shared ordinary decode inputs. A rejected native stream remains an
unsupported-input result; it is not replaced with a stream selected for that
decoder. Lossless validation checks every requested sample, including color
under zero alpha. Rendered lossy comparisons use the existing maximum RGB8
error of 2 against pinned native libjxl output. This tolerance applies to that
rendering contract, not to pixel losslessness. A failure under this contract
does not by itself establish that a wrapper is generally broken.

The [validation amendment](results/validation-amendment.json) corrects an initial
benchmark assumption that every lossy default promised exact alpha. It preserves
all original classifications, measurements and alpha errors. Lossless equality,
the RGB8 decode tolerance, and PureJsImage's exact-alpha guarantee are unchanged.

Independent native decoding validates encoded streams outside the timed region.
Lossy timing rows establish dimensions and record alpha error. Exact alpha is
required for PureJsImage, which promises it by default. Other public lossy
defaults may alter alpha; their errors are retained as a quality tradeoff. Their color quality
is evaluated separately; successful decoding does not establish matched quality.

## Public API adapters

- PureJsImage uses `purejsimage/browser`, `purejsimage/codecs/jpegxl` and the
  specialized `purejsimage/jpegxl` exports. Encoder calls include the public
  selection logic. Typed pixel blocks use the API's big-endian byte layout.
- jSquash uses its published `decode`, `encode` and `init` functions, plus the
  documented ImageData shim in Node. Its ImageData API does not expose native
  16-bit or float samples. The non-isolated browser origin selects its normal
  single-thread encoder. Both encode and decode modules are initialized for
  this adapter toolkit; startup and footprint figures include both.
- jxl-oxide uses the published npm WASM binding. A decode operation includes
  `render().encodeToPng()`. This is a PNG-producing workflow, not raw decode.
  The published glue consumes the render result during PNG export; the image
  handle is explicitly freed. No native executable replaces this binding.
- wasm-vips loads its supported JXL dynamic plugin, sets `concurrency(1)` and
  disables the operation-result cache. `writeToMemory()` materializes pixels;
  every Image handle is deleted. The runtime is shut down after each timing
  job. Its browser pthread runtime requires cross-origin isolation and starts
  a worker pool even when image-processing concurrency is one. These startup
  and transfer costs remain included.

No adapter adds a missing sequence, exact-reconstruction, or raw-sample API to
another wrapper. The capability dataset distinguishes absent APIs from features
that are exposed but not tested. Specialized Node results are labeled Node;
browser support is not inferred from a Node success. Animation's Experimental
status in PureJsImage is separate from the measured sequence result.

## Timing and memory

Main measurements use Chromium and Node on the environment recorded in each
report. Firefox and WebKit run the small compatibility subset. Jobs run serially
under the existing bounded systemd runner with zero swap and an 8 GiB process-tree
ceiling. No new CI benchmark is installed.

Each main job uses a fresh process or browser worker/context, measures library
initialization plus its first operation, then three warm operations. Source
preparation, fetching the prepared input, independent validation, PNG reading for
validation and external metrics are outside the operation timer. Adapter input wrapping/copies, codec-required
conversions, copying the returned typed data and oxide's mandatory PNG export are
inside. Cold time excludes process/worker harness startup. The representative
cold report provides three independent startup observations per selected cell.

The library data is fully materialized before stopping the timer. Warm runs reuse
initialized code and allocated heaps, but wasm-vips cannot serve an operation
from its result cache. Main cold cells have one observation and cannot support a
precise cold median by themselves. Raw times and warm median/minimum/maximum are
retained. This is an interactive workstation, not a dedicated reference host;
small differences should not be described as durable wins.

Node peak RSS comes from each isolated subject process. It includes the JS
runtime, prepared source, output, temporary buffers, WASM and worker infrastructure.
The before/after process memory counters are diagnostic snapshots, not production
encoder-managed memory or proof of reclaimed warmup allocations. WASM linear memory was not separately instrumented. Browser memory is unavailable
because these browser/isolation combinations lack a consistent measurement API. No canvas allocation is measured.

The bundle inventory hashes complete loaded JS, WASM and worker assets. The
summary counts deployment files once, including the shared benchmark worker.
It also retains actual cold requests, including repeated worker-script fetches.
Gzip level 9 and Brotli quality 11 are offline transfer estimates. The server
uses uncompressed responses and `Cache-Control: no-store`; a warm operation
uses the initialized toolkit without new library fetches. These are toolkit
sizes, not claims about each library's smallest possible application bundle.

## Matched quality

The finite quality subset contains a photo, a sunset, fine text and transparency.
It measures public effort-7 encoding and a separately labeled native-libjxl
reference. It reuses the M7 nondominated frontier, log-byte interpolation,
monotonicity checks and adaptive next-setting helper.

SSIMULACRA2 80 is the primary requested target. Each subject/source gets at most
six lossy points, including two initial points; only missing or wide target-80
intervals are refined. A score width of at most 2 is adequate here. Bands 70/90
and Butteraugli coordinates 0.5/1/2/3 remain visible even when unresolved.
Butteraugli width at most 0.25 is marked adequate. No extrapolation or lossless
point is inserted. Equal effort, quality and distance options do not imply equal
quality or equal work. No lossy size ranking comes from the fixed-option timing
rows. Some comparator settings compress alpha lossily; the raw alpha errors and
both composite scores remain visible. This differs from PureJsImage's exact-alpha
default and must accompany a transparency size comparison. Native-libjxl results never enter JavaScript runtime comparisons.

Transparency is composited onto both black and white backgrounds before scoring.
The primary score is the lower SSIMULACRA2 value and the secondary distortion is
the higher Butteraugli value. Each background's raw scores remain available.
The HDR probe checks native float samples and explicit linear range mappings at
headroom 1/2/4. It is not a perceptual HDR encoder compression comparison.

## Preview and API limits

The separate Chromium preview command measures first nonempty output over
loopback HTTP. PureJsImage uses a read-at source and requests a 32x32 region at
scale 2. Oxide receives sequential 4096-byte chunks and exports a full-frame PNG.
These are different workflows and their latency is not ranked. Requested and
transferred source bytes remain separate from toolkit asset transfer. The Node companion checks final region pixels against native libjxl, including
center sampling at scale 2. The first DC/partial preview is checked for nonempty
output; its visual fidelity and real network latency are not qualified. A crop API alone is never classified as selective decoding.

Exif/XMP, arbitrary animation blend combinations, orientation rendering,
lossy native-16-bit curves and multithread speedup remain explicitly not tested in this bounded comparison.
They must not become unsupported or verified claims on the website. The report
is not a new codec capability promotion or a claim about every legal JXL stream.

## Reproduction

Use Node 24 and the exact root lockfile. Dependencies are development-only.
The package still has no runtime dependency tree.

```sh
npm ci
npm run build
node benchmark/jpegxl/comparison/restore-inputs.ts
node benchmark/jpegxl/comparison/prepare.ts
node benchmark/jpegxl/comparison/build.ts
```

Preparation reuses the existing pinned M7 normalized diagnostics and originals,
and generated lossless fixtures. Their paths and hashes are in `fixtures.json`.
On a fresh checkout, use `restore-inputs.ts` for only the selected imazen sources. It checks original
hashes and refuses normalization that differs from the committed prepared-input
hashes. Use the existing `generate-lossless-corpus.ts`,
`generate-vardct-corpus.ts` and pinned conformance archive for missing small
codec fixtures. No full-corpus timing run is required. Do not substitute a newer image or resizer output under an existing
fixture ID. The pinned native oracle and metric binaries live under
`.tmp/jpegxl-oracles/libjxl-v0.12.0/source/` and have hashes in the reports.

Run one bounded command at a time. The runner deliberately uses a single unit.
Repeat the following form for the listed commands:

```sh
PUREJSIMAGE_M7_CPU_PERCENT=800 PUREJSIMAGE_M7_MEMORY_GIB=8 \
  node benchmark/jpegxl/run-m7-bounded.ts comparison-main-chromium \
  env node benchmark/jpegxl/comparison/run.ts main chromium
```

Commands after `env node`:

```text
benchmark/jpegxl/comparison/run.ts main node
benchmark/jpegxl/comparison/run.ts repair chromium
benchmark/jpegxl/comparison/run.ts compat firefox
benchmark/jpegxl/comparison/run.ts compat webkit
benchmark/jpegxl/comparison/run.ts cold chromium
benchmark/jpegxl/comparison/run.ts cold node
benchmark/jpegxl/comparison/specialized.ts
benchmark/jpegxl/comparison/preview.ts
benchmark/jpegxl/comparison/quality.ts
```

Choose a unique bounded-run ID for each command. `run.ts smoke node` and
`run.ts smoke chromium` provide quick initialization checks. `JXL_COMPARE_SUBJECTS`
can select a comma-separated subject list for diagnostics. Reports are written
after each row; rerunning a command makes new timings rather than treating an
old timing as a fresh sample. Preserve an old report before replacing it.
The native-precision repair phase uses `JXL_COMPARE_SUBJECTS=oxide,vips` and
supersedes its matching main Chromium cells. Rerun it with the main measurements
so an old repair report cannot enter a new comparison. Generation rejects
measurement reports whose revision, codec source hash or dirty-build flag differs
from the current subject manifest.

```sh
node benchmark/jpegxl/comparison/validate-quality.ts
node benchmark/jpegxl/comparison/amend-validation.ts
node benchmark/jpegxl/comparison/generate.ts
node benchmark/jpegxl/comparison/index-evidence.ts
npx vitest run tests/jpegxl-comparison.test.ts
npm run check
```

For the committed run, prior raw classifications are preserved in the validation
amendment and `results/preflight`. If formatting raw JSON, regenerate its dependent
validation and dataset hashes afterward. `archive-pins.ts` preserves exact subject
and fixture manifest bytes before formatting.

The generated dataset retains raw-report links and hashes, classified failures,
actual settings, artifact identities, and missing quality intervals. Large
binary artifacts remain in `.tmp/jpegxl-comparison-v1`; raw JSON and the artifact
index are versioned. Keep that cache for inspecting exact measured bytes.

## Handoff checks

All 214 focused tests passed, including the 12 comparison tests. The full
repository handoff gate passed with `VITEST_MAX_WORKERS=4 npm run check`:
3,490 tests passed and three existing tests were skipped. All non-test gates
passed, including the browser build. The official conformance corpus passed
all 39 cases. Independent checks passed 24 sample layouts, 17 color/animation
cases and 66 bit-exact Float32 encodings. Repository tests do not refresh
benchmark timings.

The refreshed Chromium/Node main runs each verify all 75 PureJsImage workflows:
16 lossless decodes, 13 lossy decodes, 45 encodes and one roundtrip. Repeated cold
subsets, Firefox/WebKit compatibility checks, preview probes, specialized probes
and 87 independently decoded quality
artifacts are recorded above. All 61 pinned source, raw and encoded input hashes
were checked before measurement. The ten selected imazen inputs retain their
original normalized bytes. No benchmark timing was refreshed by a repository
test run.

All 426 codec browser tests passed across Chromium, Firefox and WebKit. The
browser tests used a 512-task limit and an 8 GiB memory cap; comparison
measurements used the benchmark runner's 256-task limit. All three comparison
page tests also passed, including downloaded data identities and mobile width.
Those page tests ran separately from measurements.

## Publication scope

Use this report and the generated data for the comparison page. Publish
only claims supported by the measured scope, include competitor advantages,
and keep original-size results separate from diagnostics. Do not turn missing
brackets, wrapper limitations or untested features into wins. This rerun measures
the current source with the same shared inputs and comparator versions. The
[additional gap evidence](../gap-completion/README.md) records wider sample,
ICC/HDR, animation and cropped-group qualification separately. It adds no
version bump or release.
