# PR 35 remediation

This records targeted corrections to M0 through M5. M6 remains outside this work.
The review is `PureJsImage_PR35_Remediation_Codex_Prompt.md` supplied by the operator.

## Starting state

- Branch: `codex/jpegxl-m00-program-baseline`
- Reviewed and starting SHA: `5e130e0b8c8be2493f22229a9c0052012584c645`
- Fetched main: `1cd965dfeba27865c920c4e27bd44dbb4ea0404b`
- Starting working tree: clean; no subsequent remote branch commits
- Package: 0.17.0; Node: v24.16.0
- Existing focused baseline: 373 tests passed across seven files
- Local baseline source/report/fixture hashes: `.tmp/pr35-remediation/baseline.json`
- An archived reviewed source tree under `.tmp/pr35-remediation/base` supports
  before/after reproductions without changing the working branch.

## Reproduced behavior

| Finding | Reviewed behavior | Correction and evidence |
| --- | --- | --- |
| HDR storage conversion | Native re-encode keeps 2000 / 0.125 / true / 0.25. Explicit full-range 16-bit storage resets HLG to 1000 / 0 / false / 0 and PQ to 10000 / 0 / false / 0. | Separate storage depth from luminance defaults. Exact header assertions, independent normalized pixels, and linear HDR comparison cover RGB and independent-depth alpha. Real SDR tone mapping replaces HDR fields. Display-window or LUT output cannot inherit JXL source color meaning. |
| Gray plus alpha | Replicated RGBA samples carry gray-family semantics, so native JXL re-encode fails strict encoder validation. | Source inspection stays gray with two source channels. Emitted RGBA uses RGB semantics, independent depths and the original alpha association. No encoder validation was loosened. Gray ICC plus alpha is explicitly unsupported at pixel expansion. |
| Encoder memory | A 512×512 RGB effort-7 encode with maxDecodedBytes 1048577 succeeds; its post-hoc formula reports 25964544 bytes. The formula is not a measurement. | The same budget now rejects before the first full-size transform plane is allocated; measured peak stays at the 786432-byte retained input and all ownership is released. |

Independent input generation and all hashes are documented in
`tests/fixtures/jpegxl/remediation/README.md` and its manifest. There are nine
pinned libjxl fixtures, including the explicit unsupported gray ICC case.

The first two fixes pass 280 tests across the new regression file, M4 and M5.
Their 24 browser pipeline tests pass in Chromium, Firefox and WebKit with retries
disabled. The browser regression compares all eight supported new fixtures with
Node. Type checking passes.

## Checklist

- [x] Record starting state, baseline tests and hashes
- [x] Reproduce and correct HDR storage metadata with independent fixtures
- [x] Reproduce and correct gray-alpha emitted semantics with independent fixtures
- [x] Admit encoder allocations before allocation and measure live ownership
- [x] Validate budget boundaries and sink/cancellation cleanup
- [x] Derive final evidence from validated capability-specific gates
- [x] Add explicit effort-7 CI and extended promotion corpus runs
- [x] Freeze and report a separate licensed holdout
- [x] Qualify corpus selection and performance claims
- [x] Synchronize guide, workbench, discovery and generated capability surfaces
- [x] Run required local correctness, memory, performance, package and browser gates
The remote completion record is maintained in PR 35, with the exact pushed
SHA, check outcomes and inspected artifact links. It is written after those
jobs finish; local results above do not assert remote success.

## Encoder working-memory contract

The remediation preserves `maxDecodedBytes` as the pixel-storage admission
limit and adds a separate validated JPEG XL `maxWorkingBytes` option. Its default
is the supplied image limit's `maxDecodedBytes`, or the existing default
when none is supplied. Increasing a pixel budget is not a substitute for
accounting for encoder work.

Managed memory means live owned backing buffers: retained encoder input,
transform planes and candidates, predictor buffers, residuals, entropy
histograms and lookup tables, bit-writer capacity including both buffers during
growth, retained compressed sections, and metadata/output staging. A shared
backing buffer counts once. Bounded JavaScript control objects and runtime/GC
object headers are outside this numeric backing-buffer counter. Process RSS,
external memory, and caller-owned input blocks or output-sink storage are
separate measurements. The LZ match history now uses bounded typed arrays with the same per-hash history
and tie order as the prior maps.

Allocation helpers must admit byte lengths before construction. Nested scopes
own their allocations and transfer returned buffers to the caller's scope.
Bit writers keep ownership of growing buffers across helper calls. Scope exit
releases non-returned work; finish/abort/failure clears all remaining encoder
ownership in `finally`. Double release and counter underflow are errors.
Sections remain separate for ordered sink writes. A budget failure throws `LIMIT_EXCEEDED`; it does not select a cheaper search.
The existing large-image path still uses the same left predictor at all four
requested efforts. Advanced effort search applies to single-group images.
`maxOutputBytes` bounds encoded output, including container and metadata, at
most 128 MiB. Writers check capacity before growth, with completed section sizes
deducted from later writers. Candidate encodings are also subject to this limit.
No estimate sets a measured peak field.

The holdout selection is now frozen in `pr35-holdout-manifest.json` before these
encoder changes. Its nine cases retain original bytes and dimensions; no
compression or timing result was consulted to select them. All eighteen effort-1/effort-7 pixel outputs are independently exact. The results below retain every compression expansion and unsupported exact-JPEG input.

## Encoder validation

The six focused test files pass 366 tests, including 24 allocation tests. They
cover all four efforts at the measured peak and one byte below it, 24 MP input,
writer growth overlap, scope aliases, sink failure at prefix/header/section/
metadata writes, failed sink abort, explicit abort during a pending write, and
cancellation after the last metadata write. All 27 pipeline browser tests pass
in Chromium, Firefox and WebKit with retries disabled. Type checking passes.

`node benchmark/jpegxl/run-encoder-memory.ts` runs each workload in a separate
Node process. Warm runs collect three times after warmup. Its local before/after
reports are `.tmp/pr35-remediation/encoder-memory-{before,after}.json`; the
reviewed source comes from the archived starting SHA. All sixteen output hashes
are identical between revisions. These are procedural workloads, not photos.

| Workload | Requested effort | Actual managed peak bytes | Live after finish |
| --- | --- | ---: | ---: |
| 512×512 RGB8 | 1 | 18277457 | 0 |
| 512×512 RGB8 | 3 | 18091276 | 0 |
| 512×512 RGB8 | 5 | 15034876 | 0 |
| 512×512 RGB8 | 7 | 27600484 | 0 |
| 6000×4000 RGB8 | 1, 3, 5, 7 | 90123669 | 0 |

Absolute peak RSS is approximately 115–137 MB for the smaller cases and
299–309 MB for the large cases; it includes caller input, hashing sink and the
runtime. This correction is not a speed improvement. In this single cold/warm
comparison, wall-time ratios to the reviewed code range from 1.017 to 1.218.
The larger-image ratios range from 1.023 to 1.085. Both procedural compression gates and the independent encoder matrix pass. Each measured output was also checked by pinned djxl outside the timed/RSS measurement interval.


## Corpus results and limits

The M1 promotion cohort contains 250 eligible COCO 2017 validation JPEGs of at
least 224 KiB, selected by source ID from 357 eligible candidates. All 250
reconstruct exactly and are smaller. Median savings are 12.073%, p10 savings
10.697%, and median/p90 size ratios to libjxl are 0.9624/0.9777. The ten-file
small reverse matrix independently proves byte reconstruction; its size
comparison does not meet the larger cohort's thresholds and is not a promotion
gate.

M2 contains 156 procedural cases across twelve classes. Screenshot, text and
photo-like names describe generated patterns. Effort 1 passes its median
size/libjxl ceiling of 1.4 with 1.0354, and median time/libjxl ceiling of 5 with
3.3025. Effort 7 passes median/p90/worst size/libjxl ceilings of 1.25/1.4/1.75
with 0.8901/1.2921/1.7348. Its median size/PNG is 0.6023 and 89.74% are no
larger than PNG. Each class median is within 1.5; median time/libjxl is 8.0942
against a ceiling of 15. These are cohort-specific results.

M3 uses 100 COCO photographic sources with three generated variants each.
The source dimensions are now recorded separately from the resized or upscaled
test rasters, including the approximately 12 MP and 24 MP variants. 299 of 300
decode within the declared tolerance; one is explicitly unsupported. There are
no incorrect outputs. Maximum error is 1 and maximum RMSE is 0.517776.
The RMSE 0.55 ceiling is a documented 8-bit XYB rounding exception to the
original 0.25 target: pinned jxl-oxide independently reaches 0.517758 against
djxl on the threshold probe. It does not relax native lossless exactness or
define an HDR tolerance. All 299 supported files also pass five M5 workflows,
for 1495 checked outputs.

The pinned official conformance classification contains 13 passes, 25 explicit
unsupported cases and one known `delta_palette: INVALID_INPUT` failure. It
contains no incorrect pixel outputs. The evidence summary exposes that known
failure and labels decode as a validated subset with known failures. Matching
this historical classification is not a claim that all 39 cases are supported.

## Separate frozen holdout

The nine-case manifest was frozen before encoder accounting changes. No case
was removed after observing results. All inputs retain original dimensions.
The two real screenshots capture text and antialiasing; the scientific UI
contains a synthetic raster. The PNGSuite high-depth case is also explicitly
synthetic. The 24 MP USGS and 12 MP USDA photos retain native camera dimensions
and fine landscape/water detail. The manifest pins source URLs, licenses, byte
lengths and SHA-256 values.

Ratios below are encoded bytes divided by the reference bytes. Both encoder
efforts are lossless. Reference PNG uses level 9; libjxl uses the matching
effort, one thread and preserved invisible samples. Every selected pixel output
is independently decoded by pinned djxl and compared as exact integer samples.

| Asset | Size | Effort 1 / PNG | Effort 7 / PNG | Effort 1 / libjxl | Effort 7 / libjxl | Exact JPEG result |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| old-faithful-6000x4000 | 6000×4000 | 2.269 | 2.269 | 2.896 | 3.459 | Unsupported ICC profile |
| tundra-4000x3000 | 4000×3000 | 1.895 | 1.895 | 2.552 | 3.221 | Byte exact; 12.93% smaller |
| portrait-2400x3000 | 2400×3000 | 2.265 | 2.265 | 2.605 | 3.314 | Unsupported ICC profile |
| libultrahdr-minnie-yuv-icc | 320×240 | 0.863 | 0.667 | 1.200 | 1.297 | Unsupported ICC profile |
| webp-lossless-rose-400x301 | 400×301 | 1.190 | 1.000 | 1.345 | 1.439 | Not a JPEG |
| webp-lossless-tux-386x395 | 386×395 | 1.244 | 1.000 | 1.304 | 1.894 | Not a JPEG |
| pngsuite-gray-16 | 32×32 | 7.678 | 0.905 | 0.624 | 0.370 | Not a JPEG |
| scientific-screen | 1280×720 | 2.146 | 2.146 | 2.774 | 3.895 | Not a JPEG |
| workbench-screen | 1280×960 | 2.977 | 2.977 | 1.551 | 4.237 | Not a JPEG |

These results do not support a broad best-compression claim. Large images use
the existing fixed-predictor path at every requested effort, so effort 7 does
not improve their output. Broader encoder tuning remains deferred. Timing in
this holdout is observational: PureJsImage includes staging and sink copies,
while the native CLI includes process startup and file I/O. It is not an
equivalent-engine speed gate.

The originally selected small Minnie JPEG is ineligible for exact transcode
because of its ICC profile. A separately frozen eligibility supplement adds
two already licensed WPT synthetic JPEGs; it does not replace Minnie or any
original case. The 1242-byte RGB JPEG transcodes to 518 bytes; the 1006-byte
YUV420 JPEG transcodes to 1430 bytes. Both independently reconstruct byte for
byte. `onlyIfSmaller` accepts the former and explicitly rejects the latter.
Both also pass pixel encoding at efforts 1 and 7. The supplement's selection
stage and synthetic provenance are recorded in its own manifest.

## Evidence and documentation contract

`build-final-evidence.ts` validates schemas, exact checkout revision, required
hashes, per-case outcomes, named gate booleans and measured thresholds before
returning a successful summary. Missing required reports, stale optional
reports, unsupported schema versions, incomplete efforts, false success
booleans, inflated tolerances, non-exact pixels/JPEGs, missing independent
oracles and nonzero allocation ownership are rejected by focused regressions.

The artifact reports exact JPEG, effort 1, effort 7, common static decode,
color/alpha/HDR and static pipelines separately. It embeds the raw reports,
commands, thresholds, SHA-256 hashes, oracle revisions, corpus selection and
current capability declaration. M6 is explicitly not run. Local reference
execution and hosted CI are labeled separately. Local reports generated before
commit identify the starting checkout SHA and a working-tree diff digest;
they do not claim to have executed a future committed SHA.

Every PR runs effort-1 and effort-7 compression gates. Scheduled and manually
invoked runs additionally fetch and checksum-verify the selected 250 M1 inputs,
run the 300-variant M3 corpus and verify all supported M5 workflows. Shared
source, test, browser and metadata changes trigger the codec workflow. The
entire raw evidence directory uploads even when a gate fails. Absolute hosted
wall times are observational. Missing extended reports remain `not-run` in PR
scope; they cannot become successful extended evidence.

The manifest is the source for the guide summary, website description,
JSON-LD, generated support pages, README and machine-readable discovery.
The layout and interactions are preserved. Seven executable documentation
examples cover native high depth, explicit 8-bit display PNG, HLG storage
conversion, gray-alpha re-encode, alpha straightening, supported source-profile
PNG and exact transcode with `onlyIfSmaller`. Packed consumer type checks
compile these public API patterns.

The specialized JPEG XL bundle is 404048 minified bytes after actual allocation
accounting, compared with the M5 checkpoint's 398202. Its ceiling increases
from 402000 to 406000 to cover this measured implementation cost. The default
memory budget and package version are unchanged. Other entry points remain
within their existing ceilings. This is a package-size allowance, not a
memory-limit increase.

## Reproduction and validation commands

Independent new inputs were generated with:

```sh
bun benchmark/jpegxl/generate-remediation-fixtures.ts
node benchmark/jpegxl/verify-remediation-fixtures.ts --output .tmp/pr35-remediation/evidence/remediation-fixtures.json
npx vitest run tests/jpegxl-remediation.test.ts tests/jpegxl-encoder-memory.test.ts tests/jpegxl-evidence.test.ts tests/jpegxl-documentation.test.ts tests/jpegxl-m4-color.test.ts tests/jpegxl-m5-pipeline.test.ts
node benchmark/jpegxl/run-encoder-memory.ts --output .tmp/pr35-remediation/evidence/encoder-memory.json
node benchmark/jpegxl/build-final-evidence.ts --input-dir .tmp/pr35-remediation/evidence --scope extended
```

The fixture README records the exact generator environment, pinned libjxl
revision `a7a9c787341cf703dede03c2009fa460cae5e5df`, build options, ICC licensing
and all input/reference hashes. Production code uses no native oracle or
third-party implementation.

The codec workflow lists complete pinned build, matrix, memory and browser
commands. Local logs and reports are under `.tmp/pr35-remediation`; remote
artifacts are retained under `jpegxl-release-hardening-<head-sha>`. The PR body
records the final pushed SHA and immutable run/artifact links after CI finishes.
M6, merge, release, version changes and publication remain outside this work.


## Final local validation

The full `npm run check` passes 2807 tests, with three existing skips, across
208 passing files and one skipped file. It also passes generated capability and
documentation checks, the docs build, strict type checks, packed consumer types,
platform examples, browser portability, lint, formatting, bundle budgets and
the dictionary check. A previous concurrent browser/unit run reached the
existing five-second TIFF/LERC oracle timeout; the sequential full rerun passed
without a timeout change. The three-browser suite passes 779 tests with twelve
existing skips and retries disabled.

The lossless matrix reports 33 exact cases and three explicit unsupported
cases, with zero mismatches or errors. The pixel encoder matrix validates 163
cases across all four efforts and six pixel layouts using pinned djxl and
jxl-rs, with the existing jxl-oxide signed-16-bit limitation retained. All nine
new oracle fixtures, five distinct official M4 cases, four M4 memory cases,
eight JPEG render comparisons, 105 M5 workflows and four isolated M5 memory
comparisons pass. The larger M1/M3/M5 corpora and both effort compression gates
are reported above. All 17 required raw reports pass the extended evidence
builder. Its 41 admission tests include malformed, failed, missing and stale
reports and contradictory measured thresholds.

Reference-machine performance gates pass separately: M1's slowest 12 MP
median is 3367 ms, its median ratio to the complete libjxl exact workflow is
7.361, and the speedup over the recorded M0 large-photo baseline is 20.67x.
The deterministic 24 MP M2 workload takes 4050 ms against a 15000 ms ceiling,
with 27 ordered sink writes and 90123669 actual managed peak bytes. M3's
12 MP and 24 MP medians are 2103 ms and 4599 ms; normalized group scaling is
1.094 against a ceiling of 2. These local observations do not define hosted
absolute timing gates. Exact committed-revision measurements are refreshed
before final remote handoff.

The new extended downloader was exercised from an empty cache: all 250 files
match pinned lengths and SHA-256 values. It uses the dataset's S3 HTTPS endpoint
because the custom image hostname fails certificate validation. No certificate
checks or checksum requirements were disabled.

## Display recipe correction after the core review

The follow-up reviewed core revision
`652f3143050fcfee2d158af409ae334a78c512e5` and accepted the codec, allocation,
and evidence fixes above. This correction changes documentation, executable
examples, and their checks. Production codec code and resource ceilings stay
at that accepted revision.

The former generic recipe was exercised through the public API with
`colorOutput: 'srgb'`, `hdrOutput: 'tone-map-srgb'`, `alphaOutput: 'straight'`,
and `convertPixelFormat({ format: 'rgba8' })`. Opening the input and configuring
the pipeline succeeded. Failures occurred when `toUint8Array()` executed it:

| Pinned fixture               | Execution result                                                               |
| ---------------------------- | ------------------------------------------------------------------------------ |
| `m4-color/srgb-8`            | `UNSUPPORTED_OPERATION`: HDR float output requires PQ or HLG transfer metadata |
| `m4-color/srgb-straight-8-8` | Same non-HDR rejection                                                         |
| `remediation/gray-alpha-8-8` | Same non-HDR rejection                                                         |
| `remediation/hlg-12`         | `INVALID_INPUT`: adding alpha requires an explicit normalized value            |
| `remediation/pq-alpha-12-16` | Success, 117-byte PNG                                                          |

The guide now copies four functions from `examples/jpegxl-display.ts`: opaque
SDR to RGB8, SDR with alpha to RGBA8, opaque PQ/HLG to SDR RGB8, and PQ/HLG with
alpha to SDR RGBA8. All apply `autoOrient()`. Alpha recipes request straight
alpha and preserve its samples. The guide explains deliberate `alpha: 1`
addition separately. Storage conversion does not imply a color conversion.
M6 covers progressive/range-aware work; general lossy encoding belongs to M7.
Both remain outside this PR.

The documentation tests execute those exported functions and require their
source to appear verbatim in the guide. Package-consumer checks compile the
same file. Successful cases verify PNG signatures, 8-bit RGB/RGBA encoding,
displayed dimensions, actual sRGB semantics, and decoded samples through Sharp.
SDR8/10/12 and independent-alpha cases use pinned native samples. Associated
SDR alpha is explicitly straightened. PQ and HLG use independently decoded
libjxl float samples and scalar transfer, primary-conversion, and documented
tone-map equations. HLG retains the non-default 2000-nit source interpretation.
Every alpha sample is checked exactly after 8-bit scaling; color uses the
existing one-byte rounding tolerance. Negative tests retain both strict errors.

The orientation test uses `oriented-icc.jxl`, orientation 5, with displayed
size 606 by 500. Six pinned reference pixels come from libjxl 0.12.0 using
`djxl --color_space=RGB_D65_SRG_Rel_SRG` and raw PNG samples, without reapplying
the source ICC. Browser coverage runs the same four functions on ten fixtures
and compares decoded pixels and metadata with Node in Chromium, Firefox, and
WebKit. No new fixture corpus or production conversion was added.

CodeQL alert 36 was inspected at the actual network-to-file sink in
`benchmark/jpegxl/prepare-pinned-m1-inputs.ts`. The checked-in manifest restricts
names to `val2017/<digits>.jpg`; downloads use the fixed HTTPS S3 host, reject
bytes beyond the pinned size, and verify complete length and SHA-256 before
writing. GitHub confirmed the specific alert as dismissed for a false positive
on 2026-09-05. No source validation or unrelated rule was suppressed.

The prior core revision's extended run
[33940245789](https://github.com/a-r-d/PureJsImage/actions/runs/33940245789)
completed successfully with all 17 evidence gates validated. Its artifact
`9962268071` has digest
`sha256:c5cbb6aab056a5a31672918b8916570274bbe4ed642d5ccec7684b43da83ca5f`.
That run belongs to `652f3143050fcfee2d158af409ae334a78c512e5`. It is historical
evidence for this documentation correction, not an extended run on its new
commit. The final PR body records the correction's exact SHA and current PR
artifact separately. Reference-machine performance experiments were not repeated
for these example changes.

Validation commands for this correction:

- `npx vitest run tests/jpegxl-documentation.test.ts tests/jpegxl-remediation.test.ts tests/jpegxl-m4-color.test.ts tests/jpegxl-m5-pipeline.test.ts tests/jpegxl-evidence.test.ts`: 342 tests passed, including 21 executable documentation tests.
- `npm run check`: 2,821 tests passed and three existing skips. Its gates include package-consumer types, browser portability, generated capabilities/discovery, documentation build, strict types, lint, and formatting.
- `npx playwright test browser-tests/jpegxl-pipeline.pw.ts browser-tests/jpegxl-color.pw.ts browser-tests/jpegxl-workbench.pw.ts --retries=0 --workers=4`: 54 passed across Chromium, Firefox, and WebKit.
- `git diff --check`: passed.

The browser test build resolves the public package root to `src/browser.ts`,
matching the published browser condition. This overrides the repository's Node
TypeScript alias for that build only and tests the copied examples against
current source. The first browser attempt exposed that alias mismatch before
any tests ran; the corrected build passed all 54 checks without retries.
