# JPEG XL production program

This document is the authoritative human-readable ledger for the staged JPEG XL production program. The machine-readable companion is `benchmark/jpegxl/production-program/status.json`.

## Current program state

- Current merged main: `1cd965dfeba27865c920c4e27bd44dbb4ea0404b`
- Package version: `0.17.0`
- Current target: A
- Active milestone: M4
- Active branch: `codex/jpegxl-m00-program-baseline`
- Pull request: [#35](https://github.com/a-r-d/PureJsImage/pull/35)
- Starting revision: `eb0d1697132a81a2dcc9eb6822b384e09c781bec`
- M4 implementation revision: `88a49c476e8ecbcf6ef5d5b42286a48f5b3ae302`
- Capability change: common static color and HDR, independent alpha, bounded ICC and metadata, and structured lossless encoding.
- Stable promotion gate: passed locally and remotely for the documented M4 boundary.

The program normally uses one milestone branch and pull request at a time. For this run, the
operator explicitly directed M1, M2, M3, and M4 work to continue on the existing M0 branch and pull request.
This ledger records that exception without treating the earlier milestones as merged.

## Production targets

Target A covers production-ready common static JPEG XL. It requires M0 through M6. Its gate includes common static decode, mathematically lossless encoding, the documented exact JPEG subset, broad color and metadata, ordinary pipeline workflows, and progressive range-aware decode.

Target B covers broad production-ready Level 5 support. It requires M7 through M9 after Target A. Its gate adds a general lossy encoder, animation, common extra channels, broader Level 5 conformance, and release hardening.

Target C is the Level 10 stretch target. M10 must pass before the project can claim near-full standardized JPEG XL coverage. The claim must still exclude future, private, encrypted, malformed, or unbounded inputs.

## Milestones

| ID | Target | Status | Branch | PR | Start SHA | Final SHA | Stable gate |
| --- | --- | --- | --- | --- | --- | --- | --- |
| M0 | A | PR open | `codex/jpegxl-m00-program-baseline` | [#35](https://github.com/a-r-d/PureJsImage/pull/35) | `1cd965dfeba27865c920c4e27bd44dbb4ea0404b` | pending | no promotion permitted |
| M1 | A | PR open | `codex/jpegxl-m00-program-baseline` | [#35](https://github.com/a-r-d/PureJsImage/pull/35) | `16eca4041e572da4f4c69a7fec392da66e5bd9ff` | pending | passed locally |
| M2 | A | PR open | `codex/jpegxl-m00-program-baseline` | [#35](https://github.com/a-r-d/PureJsImage/pull/35) | `548a30321dbd149c7d71e17c37db0a4933d9c5de` | pending | passed locally |
| M3 | A | PR open | `codex/jpegxl-m00-program-baseline` | [#35](https://github.com/a-r-d/PureJsImage/pull/35) | `32d5a438e23486b1a46f8ad7269505b5c93034bc` | `13e1e36c521eae0894df53e38134a0c7b5b5d7bb` | passed |
| M4 | A | PR open | `codex/jpegxl-m00-program-baseline` | [#35](https://github.com/a-r-d/PureJsImage/pull/35) | `eb0d1697132a81a2dcc9eb6822b384e09c781bec` | `d61e238814018b8f234c806e57282d07dda39357` | passed |
| M5 | A | not started | `codex/jpegxl-m05-static-pipeline` | pending | pending | pending | not passed |
| M6 | A | not started | `codex/jpegxl-m06-progressive-range` | pending | pending | pending | not passed |
| M7 | B | not started | `codex/jpegxl-m07-lossy-encoder` | pending | pending | pending | not passed |
| M8 | B | not started | `codex/jpegxl-m08-level5-breadth` | pending | pending | pending | not passed |
| M9 | B | not started | `codex/jpegxl-m09-production-hardening` | pending | pending | pending | not passed |
| M10 | C | not started | `codex/jpegxl-m10-level10-stretch` | pending | pending | pending | not passed |

Milestone goals and required gates are recorded in `status.json`. Only one milestone may be active in a pull request.

## M0 baseline

The deterministic baseline report is `benchmark/jpegxl/production-program/baseline.json`. Its generated summary is `benchmark/jpegxl/production-program/baseline.md`.

The baseline starts from the exact remote main revision above and inventories 19 current JPEG XL modules and the ordinary and specialized public APIs. The capability matrix is descriptive only. It does not broaden `capabilities/manifest.json`.

### Corpus versions

- Official conformance corpus: `libjxl/conformance` revision `4bf053529c7cefd2951be453475bb3dccc7e7be8`, archive SHA-256 `1e7954076edfe8c6f66354db5a7aa0ba76c99095d81564e8dbc76043caed37bd`
- libjxl tools: revision `a7a9c787341cf703dede03c2009fa460cae5e5df`, version 0.12.0
- jxl-rs: revision `07ab48fcccde0a73c384b4011520fec67e5e09cd`
- jxl-oxide: revision `c0cc4c7ea57c1207f38ff2970d94757470613be4`
- simple-lossless-encoder: revision `7b9f14fd0ef1f4cb7e52e58ba5a222570937ddbf`
- imazen/jxl-encoder: revision `d63e9d1a1aa84b2dbdfc90eeddccc33fef5eb48b`

The four corpus manifests live under `benchmark/jpegxl/production-program/corpora`. They separate official conformance, generated feature, real image, and JPEG archive inputs. Each entry has an explicit license and checksum or refers to a checksum-pinned component manifest. The generated-feature PR set contains 14 fixtures. The scheduled workflow runs the complete pinned matrices.

Oracle source acquisition, exact build commands, the checked-in resolved Imazen oracle lockfile and
its checksum, and reference-machine binary checksums are recorded in
`benchmark/jpegxl/production-program/oracle-tools.json`. These tools are development oracles only.

### Measured results

- Official conformance: 39 cases. 2 pass, 36 return the expected unsupported class, 0 produce incorrect output, and 1 has an explained unexpected failure.
- The official `delta_palette` case reaches `INVALID_INPUT`. It is valid input outside the proven subset, so this remains a baseline defect rather than a malformed-input classification.
- Encoder matrix: 7 cases across all six published experimental native formats, checked against pinned independent decoders.
- Exact JPEG matrix: 10 of 10 eligible cases reconstruct byte-for-byte. The median JXL/source size ratio is 1.1917, so this is not yet a useful archival compressor.
- Lossless encoder compression: median JXL/PNG ratio 6.0363 over the five-class baseline. Stable compression thresholds are not met.
- Correctness-gated speed and process-memory benchmark: 4 workloads. The two 12 MP exact transcodes take median 69.6 to 71.5 seconds with 307 to 370 MB peak RSS delta on the recorded reference machine.
- Modular memory: the 4096 by 4096 full decode has 76.4 MB median peak RSS delta. The 64 by 64 crop has 1.8 MB median peak RSS delta.
- VarDCT memory: all 7 accepted workloads stay within their pixel gates. The over-budget workload fails preflight with `LIMIT_EXCEEDED`.
- Package entries remain under their current checked minified ceilings: 240,492 bytes for `codec-jpegxl` and 274,559 bytes for `jpegxl-specialized`.
- Browser workbench: Chromium, Firefox, and WebKit pass with retries disabled.

CPU time, time to first output, source read counts, unique source bytes, temporary-storage bytes, and standalone cancellation latency are not available from the current benchmark harness. Later milestones must add them where their gates require them.

### Commands

The M0 reference measurements used these exact commands:

```sh
node benchmark/jpegxl/production-program/run-conformance.ts --corpus-root /tmp/jpegxl-conformance-4bf0535 --output /tmp/jpegxl-conformance-baseline.json
PUREJSIMAGE_JPEGXL_ORACLE_DIR=.tmp/jpegxl-oracles/libjxl-v0.12.0/source/build-pinned/tools npm run bench:jpegxl -- --output /tmp/jpegxl-m00-benchmark.json
node benchmark/jpegxl/run-memory.ts --output /tmp/jpegxl-m00-memory.json
node benchmark/jpegxl/run-vardct-memory.ts --output /tmp/jpegxl-m00-vardct-memory.json
npm run bench:jpegxl:compression -- --output /tmp/jpegxl-m00-compression.json
npm run fixtures:jpegxl:encoder-matrix -- --output /tmp/jpegxl-m00-encoder.json
node benchmark/jpegxl/run-purejsimage-reverse-matrix.ts .tmp/jpegxl-oracles/libjxl-v0.12.0/source/build-pinned/tools --output /tmp/jpegxl-m00-reverse.json
```

The M0 handoff gate uses:

```sh
npm run jpegxl:program:baseline
npm run jpegxl:program:conformance -- --corpus-root /tmp/jpegxl-conformance-4bf0535 --output /tmp/jpegxl-m00-conformance-check.json
npx vitest run tests/jpegxl-production-program.test.ts tests/jpegxl.test.ts tests/jpegxl-bitstream.test.ts tests/jpegxl-corpus.test.ts tests/jpegxl-jpeg-reconstruction.test.ts tests/jpegxl-workbench-preview.test.ts tests/jpegxl-worker-protocol.test.ts tests/capability-manifest.test.ts
npm run capabilities:check
npm run package:types
npm run browser:check
npx playwright test browser-tests/jpegxl-workbench.pw.ts --project=chromium --project=firefox --project=webkit --retries=0
npm run check
git diff --check
```

The exact remote workflows passed for revision `14596426179e5c3cd62aa79c3a12e3c61c87c102`:

- [CI](https://github.com/a-r-d/PureJsImage/actions/runs/33766236347)
- [CodeQL](https://github.com/a-r-d/PureJsImage/actions/runs/33766236336)
- [Imazen codec corpus](https://github.com/a-r-d/PureJsImage/actions/runs/33766236377)
- [JPEG XL pinned corpus](https://github.com/a-r-d/PureJsImage/actions/runs/33766236426), including the complete pinned matrix and all three browsers with retries disabled

The required JPEG XL workflow is `.github/workflows/jpegxl-corpus.yml`; it runs weekly and on relevant pull requests.

### Accepted limitations and deferred work

- Current wall-time and RSS numbers are reference-machine snapshots. They are not mandatory thresholds on shared pull-request runners.
- The real-image manifest uses the existing redistributable source set. A redistributable UI screenshot, scanned document, wide-gamut image, and high-bit RGB image remain explicit gaps.
- The JPEG archive currently has 10 eligible cases, including 3 real camera or source JPEGs. M1 must grow the legally usable real archive to at least 250 before exact recompression can become Stable.
- M0 records behavior and infrastructure only. It does not fix `delta_palette`, broaden VarDCT, improve compression, or change the public capability.

## M0 gate checklist

- [x] Four checksum-pinned corpus manifests with licenses
- [x] Parsed feature inventory rather than handwritten strategy claims
- [x] Every current public claim mapped to evidence
- [x] Stable five-class conformance taxonomy with no unexplained incorrect output
- [x] Weekly full-corpus workflow and small PR-safe set
- [x] Pinned oracle revisions, acquisition, build commands, and checksums
- [x] Deterministic JSON and Markdown baseline command
- [x] `npm run check`
- [x] Chromium, Firefox, and WebKit locally with retries disabled
- [x] No capability promotion
- [x] Exact remote pull-request workflow run recorded

M0 is ready for review, and review and merge remain external. The operator instruction recorded
above overrides the usual branch boundary for the M1 work below.

## M1 exact JPEG recompression progress

M1 began from `16eca4041e572da4f4c69a7fec392da66e5bd9ff` on the existing branch by explicit
operator instruction. The implementation uses a first-party bounded Brotli encoder and decoder,
spatial gradient DC prediction, observed coefficient orders, clustered component and frequency ANS
contexts, and move-to-front context maps. Small images keep the lower-overhead prefix path.

The pinned COCO validation cohort contains 250 real JPEGs selected before encoding from 357 eligible
files of at least 224 KiB. It records source hashes, dimensions, URLs, and all eight COCO license
classes. Images stay in the ignored local corpus directory. Pinned `djxl` reconstructs all 250
outputs byte-for-byte. Every output is smaller, median savings are 12.065%, and p10 savings are
10.694%. The median output ratio to pinned libjxl effort 1 is 0.9624, p90 is 0.9777, the worst ratio
is 1.0411, and there are no unexplained outliers above 1.35.

The repeated 12 MP performance gate measures the public PureJsImage call against an equivalent
pinned libjxl workflow that includes `cjxl`, `djxl`, and reading the reconstructed JPEG. The slower
PureJsImage case has a 3.323 second median and the maximum recorded call is 3.334 seconds. The
combined median is 7.369 times libjxl. This is 20.94 times faster than the fastest recorded 69.6
second M0 large-photo result. Exact verification compares reconstructed bytes with caller input
without allocating a duplicate JPEG. Sink cancellation aborts the sink and releases managed bytes.

The 10-case reverse matrix remains the syntax regression set. Tiny generated files in that matrix
can grow because fixed container and model overhead dominate. `onlyIfSmaller` returns a structured
error before writing a non-smaller output. The stable exact-transcode contract remains limited to
the documented three-component 8-bit Huffman subset. M2 now extends and independently gates the
pixel-lossless Modular encoder below.

The profiling report is `benchmark/results/jpegxl-m1-profile-2026-09-03.json`. The syntax regression
report is `benchmark/results/jpegxl-m1-recompression-2026-09-03.json`. The promotion corpus and
performance reports are `benchmark/results/jpegxl-m1-real-corpus-2026-09-03.json` and
`benchmark/results/jpegxl-m1-performance-2026-09-03.json`.

### M1 gate checklist

- [x] Bounded first-party compressed Brotli reconstruction payloads
- [x] Deterministic spatial DC, AC, and clustered entropy modeling
- [x] 250 checksum-pinned real JPEGs with recorded licenses
- [x] 250 of 250 byte-exact reconstructions through pinned `djxl`
- [x] Compression and pinned libjxl size percentiles
- [x] Repeated 12 MP absolute time, M0 speedup, and libjxl workflow ratio
- [x] `onlyIfSmaller`, sink memory, and cancellation behavior
- [x] Chromium, Firefox, and WebKit locally with retries disabled
- [x] Full `npm run check`

## M2 competitive lossless Modular encoder progress

M2 began from `548a30321dbd149c7d71e17c37db0a4933d9c5de` on the existing pull request by
explicit operator instruction. The normal pipeline now accepts deterministic effort 1, 3, 5, and
7. Its native input boundary remains gray8, gray16, rgb8, rgb16, rgba8, and rgba16 with explicit
full-range sRGB gray or RGB semantics and no alpha or straight alpha. Callers using 16-bit storage
can declare color precision from 8 through 16 bits and independent straight-alpha precision from 8
through 16 bits. The encoder does not infer precision from sample maxima.

The encoder selects reversible color transforms, fixed and weighted prediction, per-channel MA-tree
leaves and entropy contexts, static and delta palettes, horizontal, vertical, and multi-channel
squeeze transforms, bounded LZ77 matches, and clustered ANS histograms outside pixel emission loops.
Large multi-group images keep the bounded global group model. Sink output is emitted as a container
prefix, codestream header, and individual sections without a duplicate complete sink output.

The deterministic correctness matrix contains 163 cases across the 12 required image classes, all
six storage formats, all effort tiers, explicit 9 through 15-bit precision, independent alpha
precision, raw codestreams, and containers. PureJsImage, pinned `djxl`, pinned jxl-rs, and pinned
jxl-oxide decode exact declared samples where applicable. The pinned jxl-oxide signed 16-bit Modular
rendering limitation remains separately classified.

The extended compression corpus contains 156 deterministic legal cases across the same 12 classes.
At effort 1, the median size ratio is 1.0354 and the median wall-time ratio is 2.2434 versus pinned
libjxl effort 1. At effort 7, the median size ratio is 0.8901, p90 is 1.2921, and the worst case is
1.7349 versus pinned libjxl effort 7. The effort-7 median is 0.6023 of PNG, 89.74% of files are no
larger than PNG, and the worst image-class median is 1.2581. The effort-7 median wall-time ratio is
7.3197 versus pinned libjxl effort 7. These results clear the fixed M2 thresholds without changing
their tolerances.

The representative 24 MP effort-1 encode completed in 3.819 seconds, emitted 27 sink writes, and
reported a 106,050,518-byte managed peak. The core plus JPEG XL entry is 266,448 minified bytes. The
expanded specialized JPEG XL entry is 308,718 minified bytes against its recorded 315,000-byte M2
ceiling.

### M2 gate checklist

- [x] Six native storage formats and explicit 8 through 16-bit color and alpha precision
- [x] Deterministic effort 1, 3, 5, and 7 output
- [x] 163-case four-decoder correctness matrix across all required image classes
- [x] 156-case effort-1 and effort-7 compression thresholds
- [x] Bounded section output, measured managed peak, and abort or failure cleanup coverage
- [x] Representative 24 MP effort-1 final performance rerun
- [x] Chromium, Firefox, and WebKit with retries disabled
- [x] Full `npm run check` with 2,444 tests passed, 3 skipped; 202 files passed, 1 skipped
- [x] Exact remote pull-request workflows recorded

The exact remote workflows passed for revision `a32bab2bcd4bb543fb9d85e61aa3d3fffd46f8f8`:

- [CI](https://github.com/a-r-d/PureJsImage/actions/runs/33808860739)
- [CodeQL](https://github.com/a-r-d/PureJsImage/actions/runs/33808860757)
- [Imazen codec corpus](https://github.com/a-r-d/PureJsImage/actions/runs/33808860562)
- [JPEG XL pinned corpus](https://github.com/a-r-d/PureJsImage/actions/runs/33808860771), including the complete
  pinned matrices and all three workbench browsers with retries disabled

## M3 common static VarDCT

M3 began from `32d5a438e23486b1a46f8ad7269505b5c93034bc` on the existing pull request by
explicit operator instruction. The local gate now passes for common static 8-bit sRGB JPEG XL
photographs.

The decoder supports the checked raw strategies 0 through 7 and 10 through 20. The covered feature
set includes quantization modes emitted by the pinned encoders, progressive passes, internal DC
frames, 2x, 4x, and 8x resampling, straight alpha, patches, splines, Gaborish, EPF, adaptive
smoothing, synthetic noise, reference slots, and common static frame blending. The generated
matrix contains 19 fixtures. Every generated fixture passes its pinned `djxl` oracle.
The official Level 5 and Level 10 4x color-and-alpha upsampling cases also pass deterministically.
Compared with their pinned reference PNG, each channel has maximum error 1; RGB RMSE is at most
0.316 and alpha RMSE is 0.0025.

The real-photo matrix contains 300 files made from 100 COCO validation photographs. It spans 1 to
24 MP, odd dimensions, libjxl and Imazen, distances 0.5, 1, 2, and 4, efforts 1, 3, 5, 7, and 9,
and progressive and non-progressive files. It decoded 299 files correctly and rejected one Imazen
LF-frame file with `UNSUPPORTED_OPERATION` before output. There were no incorrect outputs. The
maximum absolute error was 1 and the maximum RMSE was 0.517775. The 0.55 RMSE limit is justified by
a pinned jxl-oxide comparison that independently reaches 0.517758 against `djxl` on the threshold
probe while agreeing with PureJsImage within one sample. Twelve matrix files were also compared
with pinned jxl-oxide.

The common large-photo path keeps group-row restoration bands with eight-row halos. It uses bounded
coefficient arenas and reusable filter scratch, then releases AC groups and progressive pass state
after final use. It does not retain source-sized Float32 color planes or a second complete output.
Alpha, patches, splines, noise, and reference composition use an explicit conservative full-frame
fallback. The measured 24.003 MP DCT8 case used 193,274,053 managed bytes, below the default
536,870,912-byte decoded-memory limit.

Repeated DCT8 measurements use one warmup and three measured decodes. The 12.008 MP median was
2.194 seconds and the 24.003 MP median was 4.696 seconds. Doubling from 195 to 391 groups changed
normalized time per megapixel by 1.071x. Across the full 300-file matrix, median decode time was
8.963 times pinned single-threaded `djxl`.

The complete M3 implementation measures 305,739 minified bytes for core plus JPEG XL and 348,077
bytes for the specialized entry. The explicit temporary M3 ceilings are 310,000 and 355,000 bytes.
Other package ceilings are unchanged.

### M3 gate checklist

- [x] Multiple AC groups decode and release coefficient state group by group
- [x] Multiple LF groups assemble with image-level oracle agreement
- [x] Final progressive reconstruction supports local transformed DC groups
- [x] Checked Hornuss, rectangular, large-transform, and AFV strategy combinations
- [x] Checked Gaborish, EPF group boundaries, adaptive smoothing, and synthetic noise
- [x] Chroma subsampling and upsampling
- [x] Patches and splines
- [x] Common static alpha and required internal-frame dependencies
- [x] At least 300 common static files, including 100 real photographs and two encoders
- [x] Complete distance, effort, progressive, content-class, and group-boundary matrix
- [x] Full correctness and independent-decoder gate across that corpus
- [x] No routine full-frame float-plane boundary and measured 24 MP memory gate
- [x] Repeated 12 MP, 24 MP, pinned-`djxl`, and group-scaling performance gates
- [x] Browser preview timing and Chromium, Firefox, and WebKit acceptance
- [x] Full `npm run check` for the completed milestone
- [x] Exact remote pull-request workflows

The exact remote workflows passed for revision `13e1e36c521eae0894df53e38134a0c7b5b5d7bb`:

- [CI](https://github.com/a-r-d/PureJsImage/actions/runs/33903652654)
- [CodeQL](https://github.com/a-r-d/PureJsImage/actions/runs/33903652381)
- [Imazen codec corpus](https://github.com/a-r-d/PureJsImage/actions/runs/33903652657)
- [JPEG XL pinned corpus](https://github.com/a-r-d/PureJsImage/actions/runs/33903652411), including the pinned
  conformance, reconstruction, compression, correctness, performance, memory, and three-browser gates

The local capability wording is promoted to common static sRGB JPEG XL photograph decoding. Broad
ICC and HDR color, orientation transforms, animation, multiple visible frames, uncommon extra
channels, Level 10, and general lossy encoding remain outside this milestone.

## M4 color, orientation, alpha, HDR, and metadata

M4 continues on the existing branch and PR 35 at the operator's request. It adds checked
structured color, all eight orientations, straight and premultiplied alpha, bounded ICC,
explicit HDR output, and metadata preservation. The implementation is complete for the common
static boundary. Local and exact-revision remote handoff gates pass.

The checked fixtures contain 56 structured RGB and grayscale cases, 40 independent-alpha cases,
18 high-depth VarDCT color cases, eight VarDCT alpha-upsample cases, and a two-alpha fixture.
Modular samples are exact through pinned djxl in both directions. VarDCT comparisons retain
the independently approved M3 tolerance: maximum normalized error 1/255 and RMSE 0.55/255.
The generator scripts and fixture manifests record reproducible options, hashes, and oracle revision.

HDR XYB reconstruction emits linear sRGB float samples without clipping highlights or negative
gamut values. HDR float reference white is 203 cd/m2. Modular PQ and HLG retain native encoded
samples by default; explicit float and SDR tone-map options also handle grayscale and alpha.
Alpha uses its own precision and display range. The encoder defaults to 10000 nits for PQ and
1000 for HLG, and accepts explicit tone mapping and intrinsic size. Custom white points,
primaries, gamma, and rendering intent are preserved when representable.

The official conformance report now records 13 passes, 25 explicit unsupported cases, no
incorrect output, and the pre-existing delta_palette failure. Nine new passing entries represent
five distinct inputs. Their native source-profile samples or declared sRGB output were compared
independently with djxl before recording hashes. JPEG-derived chroma-from-luma restoration now
matches original JPEG coefficients exactly, and pixels match the JXL rendering tolerance. The
patches_lossless input is rejected as unsupported Modular reference-frame composition before
attempting a canvas-sized decode.

All four extracted ICC profiles match djxl byte-for-byte. Little CMS 2.16 verifies the checked
RGB matrix/TRC conversion. ICC iccDEV v2.3.2.3 reports legacy profile warnings and a bad checksum
ID in the original cafe profile. These are source findings, recorded in m4-icc-validation.json;
no ICC payload enters evidence. Structural validation and supported conversion remain separate
from checksum metadata. Unsupported explicit conversions fail, and native unknown profiles
retain source-profile semantics.

The high-depth and float VarDCT fallback retains full-frame working planes and is preflighted
against maxDecodedBytes. The ordinary M3 sRGB path keeps bounded restoration bands. Isolated
512-square and 1024-square HDR cold and warm runs match independent float references, peak at
132.5 to 185.3 MiB process RSS, and return ArrayBuffer usage to baseline after collection. The
12 MP and 24 MP M3 performance regression gate passes. Reports are in m4-memory.json and
m4-m3-performance.json. The M4 package ceilings are 365000 bytes for core plus JPEG XL and
402000 for the specialized entry; unrelated ceilings are unchanged.

### M4 gate checklist

- [x] Structured RGB, grayscale, custom chromaticity, gamma, and rendering-intent coverage
- [x] All eight orientations, display dimensions, crop planning, and copied Exif normalization
- [x] Straight and premultiplied alpha, independent precision, upsampling, explicit selection
- [x] Bounded ICC reconstruction and independent profile and conversion validation
- [x] Common static high-depth and HDR output with explicit SDR conversion
- [x] Intrinsic size, density, timestamps, Exif, XMP, JUMBF, and common brob preservation
- [x] Independent official conformance reclassification with no incorrect output
- [x] Focused Chromium, Firefox, and WebKit acceptance with retries disabled
- [x] Memory, collection, preflight rejection, and cancellation regression coverage
- [x] Full repository and browser handoff gates
- [x] Exact remote pull-request workflows

Advanced grouped subsampled or multiple VarDCT alpha, Level 10 global Squeeze alpha,
floating-point encoded inputs, unavailable high-depth ICC and custom-chromaticity transforms,
general ICC encoding, animation, and general lossy encoding remain explicit unsupported cases.
Exact original-JPEG reconstruction retains its M1 eligibility boundary. M5 has not begun.

The final local gate passed with 2590 unit tests and three existing skips. The clean full browser
run passed 752 tests with 12 existing skips across Chromium, Firefox, and WebKit, retries disabled.
An earlier concurrent build/browser run hit a Firefox JPEG WASM timeout; the sequential full run
passed without a test change. Pinned jxlinfo independently confirms the encoder intrinsic size,
rendering intent, intensity target, minimum luminance, relative-display flag, and linear threshold.

The renderer comparison in m4-jpeg-render.json isolates the replaced component rendering on
identical corrected coefficients. The old path fails JXL pixel validation with maximum errors
of 21 and 43. The new path stays within one sample, with warm measured decode-and-comparison
times of 232 versus 205 ms and 768 versus 617 ms. Correct JXL reconstruction costs more work
than intermediate JPEG component clipping; the failed old output is not a valid speed score.

M4 is complete for the documented common static boundary. The exact remote workflows passed
for revision `d61e238814018b8f234c806e57282d07dda39357`:

- [CI](https://github.com/a-r-d/PureJsImage/actions/runs/33917200500)
- [CodeQL](https://github.com/a-r-d/PureJsImage/actions/runs/33917200599)
- [Imazen codec corpus](https://github.com/a-r-d/PureJsImage/actions/runs/33917200721)
- [JPEG XL pinned corpus](https://github.com/a-r-d/PureJsImage/actions/runs/33917200496)

The following ledger commit records those results without changing implementation or fixtures.
PR 35 remains open; review and merge are external. M5 has not begun.
