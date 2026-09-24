# JPEG XL M6 through M10 completion

## Scope and starting point

The supplied `PureJsImage_JPEGXL_M6_M10_Single_PR_Codex_Prompt.md` is the
project brief. M6 and the approved bounded M7 qualification are complete.
The user's September 19 request completes M10 on the existing branch. The brief's
embedded authorization statements are not independent user messages. No merge,
release, version change, tag or publication is part of this work.

The original M6 starting checkout and fetched `origin/main` were both
`d157a8dc5a704410563026e53e438b79db6161db`, the merge of PR 35. Package version
is 0.17.0; Node is v24.16.0. GitHub returned no PR for this assignment's branch.
M0 through M5 are merged. Their original reports and measured revisions remain
historical evidence. In particular, the extended remediation reports belong
to `652f3143050fcfee2d158af409ae334a78c512e5`, not the final documentation
commit `57cd29b8c6ac717ce20d90b492b33274040d2f1e` or this new work.

The starting source archive is `.tmp/jpegxl-m6-m10/baseline/source.tar`, SHA-256
`d98f895c8418c9c946354cbedaf30e6f35a46962ec244fd7223f6f9d6a3540d1`.
Baseline logs and new reports live under `.tmp/jpegxl-m6-m10/baseline/`.
No historical measurement will be assigned a new execution SHA.

## Dependencies and implementation order

1. M6: header indexing and lazy opening, shared dependency planning, genuine
   progressive stages, reduced reconstruction, selective groups, then range,
   cache, cancellation, memory and browser evidence.
2. M7: bounded multi-group lossless search and independently valid forward
   lossy VarDCT coding, followed by frozen compression and quality gates.
3. M8: sequence ownership and timing, animation decoding and encoding,
   native extra channels, and remaining Level 5 combinations.
4. M9: integration, hostile inputs, CPU and allocation limits, package/runtime
   checks, and report validators tied to actual individual results.
5. M10: verified normative level mapping, higher precision and floating input,
   CMYK and remaining standard combinations, followed by all M9 gates again.

M7 progressive writing depends on M6 stage semantics. M8 lossy sequence writing
depends on M7. M10 final validation depends on the M9 infrastructure. An unmet
compression promotion gate stays visible while independent work continues.

## API and ownership decisions

- Reuse the existing logical `JpegXlCodestreamSource`, header parser, section
  table, entropy readers, renderer and memory ledgers. Header indexing must not
  concatenate preceding compressed frame data to reach a later header.
- Keep `ImageDecoder.decode()` final-image semantics. Opening or explaining
  must accurately report whether it performed pixel/coefficient decoding.
- Preserve `.jpegxl()` as lossless and the specialized exact-JPEG API as a
  separate contract. No new modes become automatic fallbacks.
- Preserve native precision, source versus output color semantics, independent
  alpha, all eight orientations, and the four executable display recipes.
- Source buffers can be reused on the next read. Retained source bytes must
  therefore be copied or consumed before another read. Output block ownership
  follows the existing explicit release contract.
- The session borrows its source, exposes idempotent close, rejects concurrent
  requests, isolates source identity, bounds retained caches, declares coordinate
  space and stage availability, and lists complete static dependency fallbacks.
- Existing full-frame VarDCT output and dependency fallbacks remain declared
  until a measured replacement exists. Buffer accounting is not process RSS.

## Known gaps and normative mapping

The merged official corpus has 39 individual dispositions: 13 pass, 25 explicitly
unsupported and one valid `delta_palette` file returning `INVALID_INPUT`.
That defect remains a defect. Expected unsupported cases do not count as
successful conformance. The 300-case M3 cohort has one unsupported internal-tree
case. Original cases and source dimensions must remain visible.

The merged baseline materialized ordinary VarDCT output while opening. Pass metadata alone is
not progressive output. General lossy writing, animation, extra-channel native
extraction, floating encoded input, higher integer precision, arbitrary ICC
conversion/encoding and broad Level 10 coverage are incomplete.

The normative feature-to-level table is verified in
`benchmark/jpegxl/production-program/m10-level-profile-map.json`. It keeps
CMYK/black in Level 10, distinguishes native samples from rendered pixels and
records the writer's narrower one-group boundary. The final official corpus has
39 successful valid cases, including exact native CMYK/black/alpha layers and
the exact binary32 sample fixture.

## Frozen acceptance cohorts

Existing manifests, oracle pins, tolerances and unfavorable cases stay intact:

- 10-case exact JPEG reverse matrix and 250 eligible COCO JPEGs of at least
  224 KiB, with the original eligibility and selection rules.
- 163-case encoder matrix; separate 156-case procedural effort-1 and effort-7
  compression reports.
- All nine PR 35 holdout assets and the two small eligible JPEG supplements.
- 300 M3 encodings from 100 sources, M4 native/color/alpha/HDR oracles, M5
  workflows, encoder budgets/cleanup, and public display-recipe checks.

The M6 cohort is frozen in `m6-functional-cases.json` and `m6-native-sources.json`. Other milestone cohorts are not frozen:

| Milestone | Required cohort and gate |
| --- | --- |
| M6 | At least 40 cases, ten native large photographs; exact stage/region references; zero groups decoded during metadata inspection; no unnecessary HF payload for DC; at least 50% less managed memory at 1/8; eligible preview median bytes at most 25% and viewport at most 35% |
| M7 lossless | At least 120 real assets, 40 beyond the advanced-search cutoff; effort-7 libjxl median/p90 at most 1.25/1.40, no unexplained worst above 1.75; at least 25% median reduction on the old large regression cohort |
| M7 lossy | At least 200 distinct sources with source-level splits; independent decoding; matched-quality median/p90 at most 1.35/1.60 of libjxl, no unexplained worst above 2; preserve every quality outlier |
| M8 | Independent frame samples, rational timing, references, blending, native channels, all applicable Level 5 cases and bounded sequence ownership |
| M9 | Cross-feature, fuzz/resource, computation cancellation, three browsers, public packed imports and validated per-capability evidence |
| M10 | Successful bounded Level 10 pixels and native sample families; full original conformance plus targeted combinations; repeat M9 after the last production edit |

## Feature-to-fixture map

| Work | Existing evidence to preserve | New evidence required |
| --- | --- | --- |
| Seek to internal-frame headers | Generated progressive/DC and patch-reference corpus | Exact frame descriptions, bounded source ranges, malformed later headers, header budget boundaries |
| Lazy VarDCT opening | M3 and M4 decoded pixels; M5 planner | Zero decoded groups at open/plan, deferred errors, release and repeat/concurrent request behavior |
| Stage and viewport execution | Final static independent oracles | Pinned native flush stages, section-dependency closure and physical-range/cache evidence |
| Multi-group effort | PR 35 holdout and procedural matrices | Frozen new source-level split and independent exactness/size reports |
| Lossy, animation, native channels | Existing negative boundaries and conformance | Independent writer/reader, timing, raw sample and level requirements |

## Live progress

| Milestone | Implementation | Validation | Promotion |
| --- | --- | --- | --- |
| M6 | Complete for the documented session and selective-decoding subset | Local cohort, resource, browser and handoff gates passed; remote PR checks are separate | Local subset gate passed |
| M7 | Complete locally for the documented encoder subset | Approved 2 MP matrices, eight original-size cases, independent decoding, visual review and local handoff checks passed | Lossy remains Experimental; promotion targets remain open |
| M8 | Complete locally for the documented sequence and native-channel contracts | Native, timing, M3, applicable Level 5, full repository and all three browser gates passed | Lossy remains Experimental; release promotion remains separate |
| M9 | Complete locally for the declared hardening infrastructure | Twelve integration, twelve mutation, twelve resource, Node 22/24 packed import, three browser and evidence-admission gates passed | No capability or release promotion |
| M10 | Complete locally for the documented bounded Level 10 native subset | Normative map, all 39 official cases, targeted thresholds, djxl acceptance, browser portability and repeated M9 gates passed | Native subset promoted locally; release remains separate |

Executed starting commands:

```sh
git fetch origin main
gh pr list --state all --head codex/jpegxl-m06-m10-completion --json number,state,headRefName,url
git switch -c codex/jpegxl-m06-m10-completion
npm run build
npx vitest run tests/jpegxl tests/jpeg-marker-walk.test.ts
```

The initial focused baseline passed 515 tests in 14 files. That baseline did
not establish milestone completion. Subsequent implementation and validation
are recorded below and in the production-program ledger.

### Initial M6 checkpoint (historical)

`readFrameSequenceFromSource()` now reads at the previous frame's checked end
offset and accounts for each parsed header. It retains the existing parser,
TOC permutation and section bounds. On the pinned multi-group progressive
fixture, the two headers occupy 25 and 58 bytes. An 83-byte aggregate header
budget now succeeds, with 141 total requested bytes including bounded read
ahead; 82 bytes fails with `LIMIT_EXCEEDED`. The former prefix reader rejected
83 bytes because it included the 10,804-byte first-frame payload. The generated
progressive and patch-reference fixtures retain identical complete frame
descriptions. Truncated later headers and cancellation have focused coverage.

Ordinary VarDCT creation retains header validation and conservative working
memory preflight but defers materialization until the first iterator request.
The execution description and `explainImage()` report this same behavior.
There is no managed pixel allocation before iteration. Malformed entropy can
now fail during iteration rather than decoder creation. A decoder still permits
one consumption; concurrent or repeated consumption is rejected. Invalid and
already-aborted requests do not consume it. Request cancellation reaches the
deferred section reads, and failed decoding and early return release ownership.
The wrapper's managed-peak getter now reads the live decoder value rather than
copying its value at creation.

JPEG-derived coefficient decoding remains eager. Final ordinary VarDCT decoding
still materializes the documented output frame. At that checkpoint there was no new progressive
event/session API, preview, group selection, reduced VarDCT transform or cache.
At that checkpoint cancellation during synchronous computation was unfinished.

### Current validation and provenance

- Baseline: 515 focused tests, 163 independent encoder cases, ten exact reverse
  cases, both 156-case procedural compression gates, and the nine-asset holdout
  pass their existing correctness gates. The holdout retains its expansions.
- New focused tests: five header-range and six lazy-opening tests pass. The
  existing 12-test VarDCT corpus retains its independent pixel tolerances.
- Chromium, Firefox and WebKit: 33 pipeline tests pass, retries disabled,
  including actual lazy opening, final output and plan agreement in each engine.
  The separate color/workbench run passes another 24 tests, for 57 total. The
  final local ten-case exact JPEG reverse matrix passes without eligibility changes.
- Both baseline and current official conformance reports retain all 39 cases:
  13 pass, 25 expected unsupported, one known unexpected failure and zero
  incorrect outputs. The `delta_palette` defect is unchanged.
- Eight isolated VarDCT memory workloads, three executions each, have identical
  baseline/current output hashes and managed peaks. The progressive workload
  retains 10,132,000 managed peak bytes. Its observed absolute peak RSS medians
  are 220,680,192 bytes before and 227,835,904 after; total wall medians are
  316.995 ms before and 301.471 after. These small procedural measurements are
  regression checks, not a speed or RSS improvement claim.
- Five distinct M4 conformance cases independently validate. The M5 verifier
  passes all 105 workflows and its four isolated cold/warm oracle comparisons.
- The specialized entry changes from 404,048 to 404,518 minified bytes; core plus
  JPEG XL changes from 355,828 to 356,310. Existing ceilings are unchanged.
- Pinned binary SHA-256 values match `oracle-tools.json` for djxl, jxl-oxide and
  jxl-rs. All three configured Playwright browser executables are available.
- `npm run check` passes: 2,832 tests, three existing skips, 210 passing files
  and one skipped file. It also passes package types, browser portability,
  generated capabilities and documentation, documentation build, bundle ceilings,
  strict type checks, lint and formatting. `git diff --check` passes.

The baseline memory runner is executed from the extracted immutable source
archive at `.tmp/jpegxl-m6-m10/base`. Current runners execute the uncommitted
working tree. Existing raw reports record `HEAD` but do not all record dirty
state: current reports must not be presented as clean executions of the merge
SHA. The local baseline holdout ran while the header edit was being made, so it
is checkpoint correctness evidence, not an immutable clean-tree timing sample.

After the memory comparison, the extracted archive was moved to
`/tmp/purejsimage-jpegxl-m6-baseline-d157a8dc-01a07f48`: Vitest otherwise discovers
the archived tests under `.tmp` and runs them against current generated files.
An initial full check exposed those duplicate old tests. The archive tar remains
in ignored working storage. Re-extract outside the repository for future runs.

Additional executed commands, with logs next to their reports:

```sh
npm run jpegxl:m1:reverse -- --output .tmp/jpegxl-m6-m10/baseline/reverse.json
npm run fixtures:jpegxl:encoder-matrix -- --output .tmp/jpegxl-m6-m10/baseline/encoder.json
npm run bench:jpegxl:compression -- --effort 1 --output .tmp/jpegxl-m6-m10/baseline/compression-1.json
npm run bench:jpegxl:compression -- --effort 7 --output .tmp/jpegxl-m6-m10/baseline/compression-7.json
node benchmark/jpegxl/run-pr35-holdout.ts --output .tmp/jpegxl-m6-m10/baseline/holdout.json
npx vitest run tests/jpegxl-header-ranges.test.ts tests/jpegxl-lazy-open.test.ts
npx playwright test browser-tests/jpegxl-pipeline.pw.ts --retries=0 --workers=3
npm run jpegxl:program:conformance -- --corpus-root .tmp/jpegxl-conformance --output .tmp/jpegxl-m6-m10/conformance.json
node .tmp/jpegxl-m6-m10/base/benchmark/jpegxl/run-vardct-memory.ts --output .tmp/jpegxl-m6-m10/baseline/vardct-memory.json
node benchmark/jpegxl/run-vardct-memory.ts --output .tmp/jpegxl-m6-m10/vardct-memory.json
node benchmark/jpegxl/production-program/verify-m4-conformance.ts --output .tmp/jpegxl-m6-m10/m4-conformance.json
node benchmark/jpegxl/production-program/verify-m5-pipelines.ts --output .tmp/jpegxl-m6-m10/m5-pipelines.json
npm run capabilities:generate
npm run size
npm run documentation:write
npm run jpegxl:program:baseline
npm run check
npx playwright test browser-tests/jpegxl-color.pw.ts browser-tests/jpegxl-workbench.pw.ts --retries=0 --workers=3
npm run jpegxl:m1:reverse -- --output .tmp/jpegxl-m6-m10/reverse.json
git diff --check
```

Not run in this checkpoint: the extended 250-source M1 and 300-variant M3/M5
reruns, complete new M6 stage/viewport cohort, new M7 compression and quality
cohorts, M8 sequence/channel gates, M9 security/fuzz gate, M10 profile gates,
remote workflows, code-scanning audit and PR readiness. None is a passed gate.

Next work is to separate LF/global, LF-group and pass state in the existing
renderer, define bounded session ownership and stage availability, and freeze
independent native progressive-stage fixtures before exposing stage output.
That initial checkpoint did not complete M6. The subsequent implementation and final evidence are recorded below; M7 through M10 remain outside the latest direct request.


## Subsequent M6 implementation

The explicit session API now indexes headers without pixels, separates embedded
previews from DC/pass/final stages, and uses one dependency planner for explanation
and execution. Output snapshots are immutable. Requests have backpressure,
independent cancellation, one-active-iterator ownership and bounded retained
caches. All eight display orientations are checked against native stage samples.

DC preview does not read main-frame HF sections. Native pass requests omit later
passes. Selected viewports include restoration halos and declare complete static
dependency fallbacks or full-frame storage. Strict selection rejects both kinds
of fallback. The primary pipeline preserves final-image resize semantics and
JPEG-derived reduced IDCT remains separate.

The ten-photo cohort is frozen at original dimensions from 5.76 to 42 megapixels.
Three photos exposed grouped progressive Modular DC dependencies; the first-party
decoder now reconstructs their transformed channel groups. All 50 DC/pass/viewport/
final comparisons passed the existing max-1/RMSE-0.55 native tolerance. The
independent synthetic grouped-DC and two embedded-preview fixtures are checked in.

Transport measurement exposed generic 256 KiB read-ahead around explicit source
requests. Session opening now disables that automatic adapter while retaining a
caller's own source policy. The failed exploratory measurements remain in
`.tmp/jpegxl-m6-m10/m6-native-measurements-before-range-fix.json`.

DC interpolation now gathers each 5x5 source neighborhood and its clamping bounds
once for all 64 output phases. The exact 25-term summation order is unchanged.
On the 24 MP Old Faithful fixture, isolated before/after checks produced identical
hashes: cold time fell from 19.0 to 5.1 seconds and warm time from 23.1 to 5.3 seconds.
The new scratch allocation is 300 bytes. These checks do not establish an RSS
improvement; absolute RSS and post-GC baselines are retained in their JSON logs.
The pre-optimization source snapshot is `/tmp/purejsimage-m6-dc-before-01a07f48`.

Final local checks pass 2,896 tests with three existing skips, and 66 JPEG XL
browser workflows pass across Chromium, Firefox and WebKit without retries.
Official conformance still has 13 passes, 25 expected unsupported cases, the
known delta_palette failure and zero incorrect outputs. Five independent M4
conformance cases also pass. The final source-pinned results are recorded below. No release is authorized.

## M6 acceptance checklist

- [x] M6.1: lazy indexing, shared explanation/execution plans, source ownership,
  bounded caches, close, one active request, coordinates, sample semantics and
  explicit fallback policy.
- [x] M6.2: independent embedded previews, complete DC/pass/final stages,
  immutable output blocks, backpressure, early return, cancellation during
  reconstruction and browser generation ownership.
- [x] M6.3: native 2/4/8 stage selection, omitted later pass reads, compact DC
  reconstruction, pinned C API progressive flush references and preserved final
  pipeline resize behavior.
- [x] M6.4: selected groups and restoration halos, explicit distant/full-frame
  dependencies, strict rejection, all eight orientations, source-validator
  identity and retained LF state across DC-to-final requests.
- [x] M6.5 correctness: thirty pinned functional fixtures and fifty native
  comparisons across ten original-resolution photos pass. Later malformed
  sections cannot produce a verified final event. Independent embedded preview
  and grouped Modular DC fixtures run in normal CI.
- [x] M6.5 demonstration: local-file and HTTP Range explorer, native/pass controls,
  source map, logical/physical bytes, first-pixel timing, managed memory, pan/zoom,
  cached requests and cancellation in Chromium, Firefox and WebKit.
- [x] M6.5 measured gates and local handoff: source-pinned sixty-process report,
  recomputed acceptance validator and full repository check (2,896 passed, three
  existing skips). Draft [PR 36](https://github.com/a-r-d/PureJsImage/pull/36) is open.
  Remote checks and review remain separate from these completed local gates.


## Final M6 measurements

Implementation and correctness harness revision:
`98b3ba58e881109f962887e9a8a17de50bc43947`.
The checked-in `benchmark/jpegxl/production-program/m6-report.json` contains the
individual source-pinned comparisons, all sixty isolated measurements and the
same-revision static regression reports. Later commits add report validation,
documentation and stronger LF reuse tests; they do not change codec behavior.

The recomputed median DC-preview payload is **14.46%** of compressed input and
the median 6.25%-area viewport payload is **29.57%**. All ten photographs reduce
1/8-preview managed memory by at least **79.93%** versus full static decode in
both cold and warm runs. These satisfy the 25%, 35% and 50% M6 gates.

| Retained individual miss | Preview bytes | Viewport bytes |
| --- | ---: | ---: |
| Earthrise | 26.59% | 37.08% |
| Horas | 15.28% | 35.24% |
| Chillon | 22.00% | 35.83% |
| Butterfly | 23.32% | 45.91% |

Byte ratios include structural source reads and exclude HTTP headers. Using
compressed input size as the viewport denominator is slightly stricter than using
the measured full cold decoder reads. The browser independently verifies actual
local HTTP Range responses and cache reuse with 4 KiB transport blocks.

The source-pinned regression run passes 105 static pipeline workflows, four
cold/warm pipeline oracle measurements and eight VarDCT memory workloads with
three accepted runs per workload. Five independent M4 cases pass. The official
conformance classification remains 13 pass, 25 expected unsupported, one known
failure and zero incorrect outputs. Earlier M1/M3 extended reports retain their
historical revisions; this M6 run does not re-date them.

Report tests recompute gates and reject omitted photos, failed stage agreement,
failed median byte budgets and revision mismatches. No new runtime dependency,
release, version change, tag, merge or publication is included.

## M7 work, authorized after M6 completion

The user's next direct request is to do M7. The starting revision is
`2d931aa3b1617561aed770e73d53dcfabeb8b236`, with M6 complete and all 24 PR checks
green. Work continues on the same branch and PR 36. M8 through M10 remain future
work; the earlier brief's instructions to continue automatically do not broaden
this direct request.

The M7 source selection and pre-tuning evaluation protocol are recorded in
`benchmark/jpegxl/production-program/m7-corpus-selection.json` and
`m7-evaluation-protocol.json`. There are 240 source families, 120 development and
120 holdout, across fifteen real-asset classes. Upstream family relationships
keep variants together; only one representative per source family is selected.
230 selected originals exceed the old 1024-pixel group cutoff. All 240 downloads
match their pinned sizes and hashes. All sixteen alpha-bearing files proved fully
opaque, and all original sources were 8-bit SDR. A recorded expansion adds twelve
CC0 Poly Haven HDR panoramas and twelve Apache-2.0 Noto artworks, split equally
between development and holdout. All 24 added downloads have pinned checksums.
Sample inspection confirms highlights above SDR white in every HDR source and
both transparent and opaque pixels in every artwork. The 2k HDR downloads are
provider renditions, not the providers' highest-resolution originals. Derived
high-depth/display variants must remain labeled with their preprocessing and
must not count as additional source families. The combined selection has 264
families, split 132 development and 132 holdout.

The starting archive and CPU profile are under `.tmp/jpegxl-m7/baseline/`.
The 24 MP Old Faithful regression emitted the same 81,000,337-byte file at efforts
1 and 7. Effort 7 was 3.4593 times pinned libjxl and took 7.10 seconds for the
PureJsImage open/write/finish path. Most JavaScript encoder time was in bit writing
and residual serialization. Native subprocess time in the profile is separate.

Experiments JXLMOD-013 through 022 carry fixed and weighted predictor search and
ANS models across the cutoff, with a sampled frame RCT decision, bounded LZ77
history, shared residuals, actual selection evidence and cooperative candidate
checkpoints. Group-local ordinary and delta palettes are compared by actual
encoded size. All 48 libjxl and all 48 independent jxl-rs checks pass across cutoff/panorama dimensions and
8/10/12/16-bit samples, including transparent color. Sixteen own-decoder cases
cover the same depth/cutoff boundaries. Timer cancellation during single-group
and multi-group search releases all managed buffers before returning. The pinned
jxl-oxide build has retained palette interoperability failures. Its wide-buffer
option fixes four signed 16-bit alpha mismatches, but does not fix its palette
failures. These are not recorded as successful oracle results.

The 24 MP effort-7 output before group Squeeze is 25,041,584 bytes. Its native
decoded samples are exact. Experiment 020 took 34.35 seconds and admitted
156,578,878 peak backing bytes. Effort 1 remains a fixed-left fast path; bounded
Huffman lengths and a faster bit writer reduced its output from 81,000,337 to
43,968,755 bytes. Experiment 022 took 3.85 seconds with identical output to 021.
These single samples do not establish paired
performance or extended compression gates. Raw attempts and tradeoffs are
recorded in `benchmark/optimization-log.md`; no failed or slower attempt is hidden.

The explicit public lossy mode now transforms native 8/10/12/16-bit gray/RGB/RGBA
samples directly to XYB and writes independently valid VarDCT. Efforts 5/7
compare DCT8, Hornuss and both rectangular half-block orientations using
estimated token cost and per-channel quantized reconstruction error.
The shared coefficient writer does not create a JPEG intermediate. Compact DC
and control planes remain separate from reusable AC group storage. Local CFL,
adaptive quantization, exact straight alpha, and two-pass progressive output are
implemented. The default pipeline stays lossless. Distance zero and conflicting
options are errors. The forward path supports known-primary sRGB, linear, gamma,
and PQ samples with default intensity targets. HLG, custom chromaticities,
premultiplied alpha, larger DCT/AFV transforms, and matched restoration remain open.

Thirty integer depth/alpha cases pass libjxl and jxl-rs in each single and
progressive mode at effort 7, including mixed color/alpha storage depths.
The harness now asserts the encoded pass count; earlier duplicate single-pass
checks labeled progressive are superseded. Twenty-four effort-7
linear/P3/Rec.2020/PQ cases pass at distance 0.25. The color harness explicitly matches oracle output spaces;
its initial mismatched-domain failure remains recorded. Public tests preserve
PQ white luminance, exact alpha, and final single/progressive pixels. M6 reads
the generated first SDR pass without consuming the final pass. Eight effort-7
first-pass comparisons at full and half resolution pass against native djxl.

JXLENC-006 produced 3,340,932 bytes on the exploratory 4000x3000 Old Faithful
rendition in 6.71 seconds open/encode/output, with 16,121,508 managed peak bytes.
SSIMULACRA2 was 85.7727 and Butteraugli 1.4260. Removing the coarse high-activity
quantization branch repaired the preceding quality regression. This Sharp
Lanczos3 fit-fill rendition remains outside the frozen promotion cohort, and
single timings do not establish paired, cold/warm, or corpus performance.

The workbench exposes lossless/lossy mode, effort, distance, progressive output,
source/output previews, zoom, cancellation, download and reopen. Its lossy numeric
comparison currently requires sRGB PNG/TIFF samples and checks alpha separately.
At the earlier functional checkpoint, all 24 workbench tests passed across
Chromium, Firefox and WebKit. The browser portability check passed.
The initial full check caught increased bundle sizes;
the two JPEG XL budgets now explicitly include M7's added first-party encoder,
with historical baselines unchanged. That full check passed: 2,971 tests, three
existing skips, and 221 passing files. Three additional browser pipeline tests
cover native-depth, mixed alpha depth, color and progressive re-encoding.
A subsequent run passes all 69 workbench and pipeline browser tests across
Chromium, Firefox and WebKit. The serial full check passes 2,988 tests with three
skips across 222 passing files and one skipped file. These checks include the
strategy, cache and workbench budget changes, and precede the newer palette
experiment. Its final rerun remains required.

The repaired 120-family frozen SDR development run is exact in libjxl and
jxl-rs for all 120 images, with zero failures. Median/p90/worst size ratios are
1.207027/1.640840/2.066721. A later gradient-context run also verifies all 120
images exactly and improves those ratios to 1.158737/1.403420/1.959187. Tail
targets still fail in that intermediate run. The combined JXLMOD-031 run is
exact on all 120 development images and passes the SDR development size targets
at 1.158737/1.392048/1.728176. The frozen SDR holdout is also exact on all 120
images, with ratios 1.170788/1.451149/1.675691. Its p90 misses the 1.40 target.
The original five large-photo/screenshot cases achieve 65.797% median byte
reduction from merged revision d157a8dc, with all nine original cases exact.
A bounded single-group LZ cache
preserves identical bytes on the two single-group development images while
reducing their managed peaks from 216.5 to 54.0 MB and 115.6 to 37.0 MB.
All 50 focused lossless and memory checks pass.

The complete baseline failures and repaired results are retained separately.
All 24 HDR/alpha expansion sources are prepared under a frozen metric-domain
protocol, with original source hashes, native-light references, PQ16 conversion
errors, headroom-1/2/4 views and black/white alpha composites. All 24 lossless
outputs are independently exact, but compression fails the targets: derived
PQ16 median/worst ratios are 1.925726/2.299523 and RGBA8 artwork ratios are
2.323349/3.131331. Observed holdout cases remain regressions for subsequent
tuning, with their original splits and failed results preserved. Preparation
and exactness do not establish lossy quality. Representative restoration quality, complete development/holdout quality
curves, isolated performance, re-encode corpus validation and final promotion
gates remain incomplete. No new
lossy capability has been promoted to Stable.

The later palette and symmetric-DCT checkpoint passes 2,996 tests with three
existing skips and all 69 browser workflows. The bounded 1,024-color palette
uses a typed dictionary with capped collision probes and keeps the former
single-group encoding as a size fallback. All 24 expansion cases remain exact.
RGBA8 median/p90/worst ratios improve to 1.389099/1.610034/1.968677; derived PQ16
compression is unchanged. The original SDR corpus is being replayed because
68 families contain newly eligible palette groups. Its previously observed
holdout remains a regression cohort for this tuning.

The complete HDR development grid covers six families at six distances, with
both native and first-party output, exact metadata checks, two independent
decoders, native-light errors, and three display headrooms. At SSIMULACRA2 90,
median native size ratios are 1.0050, 1.0060 and 1.0283 at headrooms 1, 2 and 4.
Other bands and unbracketed cases remain visible. Headroom-1 Butteraugli-2 p90
is 1.6182, above 1.60. The six transparent development curves also complete all
24 engine/setting points each, but their matched-quality ratios still miss
the target. These results are recorded in
`benchmark/jpegxl/production-program/m7-expansion-quality-baseline.json`.

Subsequent local alpha, DC and per-channel entropy models preserve decoded
pixels while reducing the 12 MP photo from 1,624,986 to 1,539,064 bytes and the
text brochure from 545,859 to 532,212 bytes. Effort-3 and correctly invoked
effort-7 native-depth progressive checks each pass 30 cases. Their full
handoff rerun remains separate from the earlier 2,996-test checkpoint. New lossy
encoding remains Experimental; M7 is not complete or promoted to Stable.

The transparent-color policy now replaces only fully transparent lossy color
samples and preserves alpha exactly. All six development curves complete.
Black/white SSIMULACRA2-90 median native ratios are 1.1271/1.1063; Butteraugli-1
ratios are 1.2059/1.1907. Unbracketed bands remain missing. Residual-scaled
restoration is implemented for opaque standard-sRGB gray/RGB at effort 5/7
and distance 2 or above, with a majority-of-blocks guard. Eight independent
progressive-stage and 30 depth comparisons pass. Six photo diagnostics improve
SSIMULACRA2, with two small Butteraugli regressions retained in the report.
These development results do not establish complete held-out quality.

The full typed-palette SDR replay is exact on all 240 images. Development
median/p90/worst ratios are 1.153636/1.367369/1.673511. Holdout ratios are
1.167859/1.409225/1.675691; p90 still misses 1.40. All original cases and the
failed gate remain in the tracked reports.

The integrated entropy, transparent-color and restoration checkpoint passes
`npm run check`: 3,003 tests with three existing skips. All 69 browser
workflows pass without retries. The existing 24 MP memory test passes with
its original timeout. These functional results do not resolve the recorded
compression, matched-quality or isolated runtime gates.

After the 2026-09-08 host OOM, all heavy M7 work uses the development-only
`benchmark/jpegxl/run-m7-bounded.ts` launcher. It checks for at least 8 GiB
available host memory and admits one systemd user service. The complete process
tree defaults to a 3 GiB hard limit, a 2,880 MiB pressure threshold, no swap, 256 tasks
and a two-core CPU quota. The fixed service name rejects concurrent launches.
Cgroup rejection or termination is a failed evaluation, never a quality pass.
This harness limit is separate from the portable codec's public memory budget.
Pinned whole-image perceptual metrics can use the explicit
`PUREJSIMAGE_M7_MEMORY_GIB=8` profile: an 8 GiB hard cap, 7.5 GiB pressure
threshold and at least 18 GiB available host memory before admission. The same
single-service exclusion and zero-swap policy apply. No image is resized to
make its quality evaluation fit.

Example: `node benchmark/jpegxl/run-m7-bounded.ts unique-check node node_modules/typescript/bin/tsc --noEmit`.
Use `/usr/bin/env NAME=value node ...` inside the command arguments when a
benchmark needs environment settings. The launcher records admission, exit
status and systemd resource diagnostics under `.tmp/jpegxl-m7/bounded-runs/`.
The quality evaluator now requires one worker. It can reuse first-party and
comparator points from separate runs only after checking normalized samples,
source identity, geometry, implementation identity for first-party output,
measurement/tool versions, raw scores and encoded artifact hashes. Failed
points are retained as failures. Interrupted and incomplete curves are not
complete qualification evidence.

Effort-1 experiment 036 retains group-local HF entropy presets for opaque,
non-progressive frames with 2 through 256 AC groups. A bounded quantized-group
cache and reusable ANS scratch avoid a second pixel transform. Exact prefix
section and TOC size accounting preserves the smaller representation. Seven capped paired runs on the 12 MP photo
reduce median paired core time by 16.06%, with seven wins. Output falls from
2,026,935 to 1,911,970 bytes and median RSS from 162,095,104 to 160,808,960 bytes.
Managed scratch and metadata peak increases from 9,988,793 to 15,221,245 bytes
and remains subject to the public allocation budget. This relative result does
not establish the native-reference runtime gate.

All 30 independent effort-1 native-depth cases and 53 integrated focused tests
pass. The focused process tree peaks at 632.9 MiB with no swap. The added
entropy implementation costs 2,494 minified bytes in the specialized JPEG XL
entry, now 454,627 bytes. Its explicit feature ceiling is 455,000 bytes;
historical bundle baselines are unchanged. Full checks are required for this
new checkpoint.

The initial 64-task envelope blocked build/oracle threads during full checks.
The task ceiling is now 256 while the 3 GiB memory and zero-swap limits remain
unchanged. Full builds use GOMAXPROCS=2 and RAYON_NUM_THREADS=2; tests still
use one Vitest worker. Earlier failures remain recorded in their run logs.

Experiment 038 then combines DC averages and AC transforms in the same group
conversion. LF/DC sections are serialized after all AC groups have populated
the compact DC planes. Seven capped paired runs preserve identical encoded
bytes and reduce median paired core time by a further 22.39%, with seven wins.
Median RSS is 161,918,976 bytes before and 160,456,704 after; managed peak stays
15,221,245 bytes on the 12 MP photo. Independent native/Rust checks pass on
the photo, brochure, flat image and all 30 native-depth cases. Flat-image
managed peak rises from 1,088,397 to 3,502,122 bytes for shared entropy scratch,
with nearly unchanged RSS and lower runtime. Full integrated checks remain
required. Raw reports are under `.tmp/jpegxl-m7/fused-e1-038-*`.

After removing the superseded flat-image dispatch, the retained 038 stack
measures 454,783 minified bytes for the specialized JPEG XL entry and 399,756
bytes for Core + JPEG XL. Both fit the existing 455,000/400,000 feature
ceilings. The experimental cube-root approximation and magnitude-context
prototype remain outside production.

The retained 038 implementation passes the full `npm run check`: 3,012 tests
with three existing skips. All 72 JPEG XL browser workflows pass across
Chromium, Firefox and WebKit, including grouped effort-1 encoding with a
16 MiB public working budget. Full-check and browser cgroups peak at 1.9 GiB
and 2.4 GiB respectively, with zero swap. These checks do not resolve the
recorded compression, quality or absolute runtime goals.

A 12 MP Butteraugli diagnostic reached the 3 GiB envelope and stalled in
reclaim. It was deliberately stopped, its incomplete artifacts preserved,
and retried under the separately admitted 8 GiB metric profile. The original
launcher reported a successful systemd shutdown for SIGTERM; the interruption
record corrects that interpretation. The launcher now marks killed services
as terminated and returns failure, even when systemd reports a normal stop.

Two additional public effort-1 regressions exercise the 256-group optimized
limit and the 257-group fallback, using 65,536-by-9 and 65,537-by-9 RGB8
rasters under a 16 MiB budget. Both preserve the prior encoded bytes and
independent decoded pixels. All five focused effort-1 cases pass; the
3,012-test full checkpoint above predates these two additions.

The four-family balanced-DC diagnostic completes all 24 independently decoded
quality points at a 3.4 GiB process-tree peak with zero swap. It improves most
matched bands but regresses one high-quality point, so it remains outside
production. A fixed policy retaining existing DC precision through distance 1
is under separate evaluation. No quality gate is marked complete from these
four development families.

The checked 046 checkpoint passes 3,014 tests with three existing skips and
all 72 real-browser workflows. Its cumulative effort-1 comparison against
restoration030 improves median paired core time by 47.507%, with all seven
pairs faster, smaller output, and unchanged independently decoded pixels.
Median RSS increases by about 1.2%. Its native-reference ratio passes cold
at 7.184 but misses warm at 8.500; neither result qualifies the full milestone.
Public effort-3 cold/warm diagnostics complete in 4.425/4.402 seconds.

The retained follow-up stack skips unused single-histogram context work and
precomputes exact AC tokens in a tracked 32 KiB table. The table is released
before LF/DC serialization. It improves median paired time by 8.694% over
the preceding candidate, with all seven pairs faster and unchanged output.
The tracked whole-encode peak remains unchanged; a flat neighbor's lower
peak rises by about 31 KiB. Independent native-depth and real-image checks
pass, and the specialized entry remains below 455,000 minified bytes. Final
integrated full, browser and native-reference checks remain required.

The final integrated050 stack passes all 3,014 tests and 72 real-browser
workflows, with three existing test skips. A separate 21-pair warm
confirmation meets the representative effort-1 target at 7.789 times native;
18 pairs are below eight times. The cold ratio is 6.592. Public effort-3
cold/warm diagnostics complete in 4.797/4.502 seconds. Native and Rust output
verification passes. These local runtime gates are complete; the full frozen
quality matrix and remaining compression targets are still open.

Full-corpus native quality tools can use an explicit
`PUREJSIMAGE_M7_MEMORY_GIB=10` profile for the approximately 30 MP inputs. It
requires at least 22 GiB available host memory before starting, caps the
whole process tree at 10 GiB, uses a 9.375 GiB pressure threshold, and permits
no swap or concurrent benchmark job. Builds and tests retain the 3 GiB
default. This does not change any public encoder admission limit.


The complete development quality run uses the frozen integrated-050 source
snapshot and the 10 GiB metric profile. Its raw points are written incrementally
to `.tmp/jpegxl-m7/lossy-development-integrated050-full`. Process completion does
not establish qualification: every curve, failed coordinate, and unbracketed band
must be inspected. The report now separates all source categories and the photo
cohort selected from the corpus taxonomy, including museum artwork photographs.
The photo denominators are 64 development and 63 held-out families.

The retained 030 and 050 source snapshots are also archived under
`.tmp/jpegxl-m7/source-archives`, with SHA-256 hashes in `manifest.json`, so a
restart does not depend on the `/tmp` copies. These archives contain first-party
source and benchmark evidence, without oracle binaries or dependencies.

The real progressive check passes all eight development families against native
first-pass output and independently decoded final images. Its process-tree peak
is 1.5 GiB, with zero swap. The tracked report is
`m7-real-progressive-recovery.json`. Repository decoding also passes all six
quality coordinates on the 12 MP im26-1030 smoke case, with maximum RGB8 difference
one against the exact native rasters used for scoring. The complete matrix
check in `verify-m7-quality-decoding.ts` remains required.

The official conformance rerun preserves all 39 M6 dispositions: 13 passes,
25 expected unsupported cases, one known delta-palette failure, and zero incorrect
outputs. Raw evidence is `.tmp/jpegxl-m7/integrated050-conformance.json`.

The launcher now requests `OOMScoreAdjust=1000` for subsequent jobs, preferring
the reproducible benchmark process tree if the host runs out of memory. The
active quality run started before that change. At 05:27 UTC on September 9,
its verified cgroup processes were adjusted from 200 to 1000 without restarting
the run. A subsequent child inherited 1000. The amendment and inheritance
receipts are `.tmp/jpegxl-m7/integrated050-quality-full-oom-adjustment.json`
and `integrated050-quality-full-oom-inheritance.json`. Memory and CPU caps are
unchanged. The subsequent qualification job independently verified the launcher setting
at startup. Type checks, all 18 focused report tests, and generated documentation
and capability checks passed under the 3 GiB cap.

During the long quality run, the cgroup reached 10,066,591,744 bytes, including
cached file pages, and triggered soft-limit reclaim. Its hard-limit and OOM
counters remained zero. Advisory cache release for generated files in completed
cases reduced current cgroup use from 4,198,416,384 to 1,809,879,040 bytes. The
files and raw measurements remain on disk. This quality run supplies no runtime
promotion evidence, and its cgroup peak must not be described as encoder RSS.
The resource observations and cache-advice receipt are stored beside the run log.

The first full development metric job was deliberately checkpointed after 74
complete curves and 25 additional points, with no failed coordinates. Its
termination is recorded as interrupted, not completed. The new
`integrated050-quality-resume1` job resumes from both own and comparator caches
after validating their source, tool, raster and output hashes. It retains the
original reports and uses a new output directory. No heavy checks overlap it.

The next checkpoint retains 80 complete development curves and two additional
points, with no failed coordinates. The updated full repository gate passes
3,020 tests with three existing skips. Atomic report recovery, worker-failure
propagation and held-out expansion selection are covered. The HDR dispatcher
now runs one child at a time. Repository decoding also passes all six quality
coordinates on im26-6610 and im26-5026, both near 30 MP, under unchanged public
limits. Maximum RGB8 difference is one. The combined check job peaks at 1.9 GiB
with zero swap. Scoped evidence is in `m7-quality-decoder-recovery.json`.

`integrated050-quality-resume2` continues the development matrix from the
verified checkpoint with the tested report writer. The encoder source fingerprint
is unchanged. Held-out quality, the complete repository-decoder matrix, visual
outlier review and the remaining lossless compression targets are still open.

The development metric checkpoint now retains 92 complete curves. The run was
interrupted deliberately, with no measured failures; its 9.375 GiB pressure
threshold reclaimed cached pages without hard-limit, OOM or swap events. The
original reports remain intact. Full development and held-out qualification
remain open.

Integrated054 adds bounded sparse RGB16 scalar palettes and a separate
palette/index gradient candidate. All 24 lossless expansion images are exact in
the repository, libjxl and Rust decoders. Derived HDR median/p90 native size
ratios improve to 1.17/1.33; alpha ratios are 1.29/1.48 and still miss the targets.
The expansion job peaks at 940.8 MiB with zero swap. Nine new scalar fixture and
allocation tests are included in the 76 passing focused tests. The added browser
cases cover native RGB16 samples and exact independently verified fixture bytes.
All 78 real-browser cases pass in Chromium, Firefox and WebKit. The full check
passes 3031 tests with three existing skips. The combined job peaks at 2.8 GiB
under its 3 GiB cap, with zero swap.

The added search and bounded decoder-chain handling cost about 2.3 KB per JPEG XL
entry. Checked before/after measurements justify ceilings of 460000 bytes for
the specialized entry and 405000 for core plus codec. Historical baselines remain
unchanged. M7 remains in progress and lossy encoding remains experimental.

The initial visual review contains 36 inspected crops covering face and foliage,
sunset edges and sky, manuscript detail, texture, brochure text and screenshot
text. All reviewed first-party streams are byte-identical when regenerated by
integrated054. Their reports retain the original raster hashes and link the new
encoding reports. This is a limited development review, not a full quality pass.

`benchmark/jpegxl/prepare-m7-visual-review.ts` makes crop generation reproducible
from a quality directory and a selection JSON. The initial coordinates are in
`production-program/m7-visual-development-initial.json`. It checks source identity,
encoder fingerprint, the pinned decoder, encoded hashes and decoded sample hashes.
It processes one bitmap at a time and bounds the number of crops per source.
Newly generated panels start unreviewed. The tracked generator still requires its
serial fixture verification; the inspected artifacts were made by its earlier
local version. Remaining full-matrix, held-out and HDR outliers stay open.

The recorded HDR/alpha quality baseline is from forward-034. Its VarDCT encoder,
JPEG entropy encoder and Modular encoder hashes differ from integrated054.
Both expansion splits therefore require fresh quality measurements. The HDR
harness already checks repository native-light decoding. The alpha harness now
also requires complete ordered RGBA8 output, native RGB agreement within two
levels and exact original alpha for every first-party point. This new check
passed the final strict type check but still requires its bounded grid execution.

At the user's wrap-up request, the integrated054 quality run stopped with 106 of
120 development curves complete, no failed points and no partial curves. Its
process group peaked at 6.5 GiB under the 10 GiB hard cap, with zero swap and no
observed OOM events. The checkpoint is
`benchmark/jpegxl/production-program/m7-integrated054-quality-checkpoint.json`.
Fourteen development curves, all 120 held-out SDR curves, fresh HDR/alpha quality
grids, full repository-decoder verification and final visual review remain open.
The ten SDR cases affected by the final single-group palette change also need
their prepared regression recheck. No further quality job is running. M7 remains
in progress, and lossy encoding remains Experimental.

The final `npm run check` passes 3031 tests with three existing skips, including
strict types, browser portability and generated-file checks. Its process group
peaks at 1.9 GiB under the 3 GiB cap, with zero swap. The checkpoint report retains
the final check receipt. The earlier 78 real-browser workflows cover the unchanged
production encoder and decoder.

### Experimental handoff

The final targeted checks are complete on integrated054. All ten affected
single-group SDR lossless images are exact in libjxl and Rust. Nine
streams are unchanged; im26-3313 shrinks from 177909 to 177020 bytes. The six
scalar boundary fixtures are independently exact, and all 39 official
conformance dispositions match the prior baseline with zero incorrect outputs.
The known delta_palette failure and 25 unsupported cases remain documented.

The tracked visual-review tool now reproduces all 36 previously inspected panels
byte-for-byte. Its run peaks at 815.3 MiB with zero swap. These results close the
targeted implementation regressions; they do not complete the frozen quality
matrix. The Experimental handoff receipt is
`benchmark/jpegxl/production-program/m7-experimental-handoff.json`.

The speed-prioritized handoff keeps lossy encoding Experimental. Full M7
qualification, including the remaining SDR curves, both HDR/alpha quality splits,
complete scored-stream decoding and final visual outliers, remains open for
Stable promotion. Existing timing measurements retain their original source
provenance. No M8 work or release is included.

The ten-image replay did not invoke the repository decoder. Earlier handoff prose
overstated that coverage. The older SDR batches also used the two independent
decoders only. A full stored-stream repository replay is now prepared in
`benchmark/jpegxl/verify-m7-lossless-decoding.ts`; it will compare ordered RGB8
row hashes with the independently verified normalized samples for all 240 sources.
The separate 24-source lossless expansion already records repository exactness.


### Full M7 qualification resumed

The latest direct request requires complete M7 qualification. The earlier
Experimental handoff is a historical checkpoint. No M8 work or release is included.

The complete development matrix now contains 120 original-resolution sources and
3600 measured points, with zero missing curves and zero measurement failures.
`benchmark/jpegxl/production-program/m7-lossy-development-integrated054.json`
retains the raw size and score pairs, independent-decoder differences, source and
tool hashes, cache provenance, complete summary, and guarded-run receipt.

At SSIMULACRA2 80, all 64 development photos are bracketed against libjxl: median
size ratio 1.092956 and p90 1.229889. At SSIMULACRA2 70, 46 photos are bracketed
against JPEG and the median ratio is 1.009736, missing the smaller-than-JPEG goal.
Unbracketed targets remain visible. Text brochures im26-5052 and im26-5034 reach
Butteraugli-2 ratios of 6.373469 and 3.763581. The NOAA table im26-5334 reaches
2.064329 at SSIMULACRA2 80. These outliers remain in the results and visual review.
Development measurements do not replace the held-out quality gates.

The quality run finished in 1 hour 31 minutes with a 9.3 GiB process-group peak
under the 10 GiB cap and zero swap. Initial cached-file pressure triggered the
soft threshold; no hard-limit or OOM events were observed. Subsequent waves used
at most two sources of at most 12 MP each, with larger sources running alone.
Codec thread settings stayed unchanged. These concurrent quality runs do not
qualify runtime performance.

The complete development lossy decoder replay passes all 720 scored streams,
with encoded and decoded hashes matching the retained quality matrix. Both
HDR/alpha splits also complete: each contains 144 alpha points and 72 HDR points,
with no measurement failures. All generated first-party expansion points include
repository and independent decoder checks. The final held-out SDR matrix was
stopped at the user's direction after five complete curves and 179 measured
points, with no measurement failures. The checkpoint retains partial results in
`m7-integrated054-heldout-checkpoint.json`. M7 remains in progress.

Development now uses eight images capped at 1024 pixels per side. Text and maps
use native-scale crops; photographic inputs use smaller derivatives. Native
controls are measured once, and candidate iterations measure first-party output
at three distances with independent decoding and both quality metrics. The
complete process tree has a 3 GiB memory limit and no swap. These diagnostics
guide fixes before further full-size qualification. They do not replace the
frozen qualification corpus or establish Stable support.

The native brochure and table outliers use hidden Modular reference images and
the patch flag on their regular VarDCT frames. The current first-party writer
does not emit a patch dictionary. Pinned libjxl source is used to understand
patch selection and DC quantization while implementation remains TypeScript in
this repository. The bounded experiments revisit the unfinished JXLENC-041 DC
precision change against additional text, map, gradient and texture inputs.
The aggressive policy is rejected because reviewed gradients show extra blocks.
JXLENC-052 retains milder channel-specific DC steps for opaque RGB8 sRGB output
above distance 1 at efforts 3/5/7. Its 24 small outputs pass independent decoding;
34 bracketed matched-quality comparisons improve by a median 2.5656%. Additional
DC smoothing has no clear benefit and is not retained. The baseline takes about
62 seconds and each candidate takes about 38-39 seconds, with process-group peaks
below 1 GiB. Full results are in `m7-small-diagnostics.json`. Earlier integrated054
quality results describe the earlier writer; they do not qualify this new policy.
The retained writer passes `npm run check`: 3,058 tests pass with three existing
skips. Three real-browser tests cover 24 color, depth and progressive workflows
per engine in Chromium, Firefox and WebKit, at distances 1 and 3. The final check
peaks at 1.8 GiB with zero swap. `m7-dc052-validation.json` retains source hashes,
test counts and the guard receipt. M7 remains in progress while final quality
qualification remains open. Patch encoding is optional in the project brief;
its absence explains a compression gap but is not an implementation prerequisite.

## User-approved bounded M7 qualification

The user approved a 2 MP quality matrix plus selected original-size checks on
2026-09-09. `m7-bounded-quality-protocol.json` records this amendment before its
measurements. All 240 sources, source-level splits, codec settings, six curve
coordinates and both perceptual metrics remain unchanged. The new matrix caps
each raster at 2 MP with no enlargement, reducing total evaluated pixels by
about 82%. Its results describe the capped workload, not full-corpus quality at
original resolution. Eight fixed original-size cases supplement that matrix,
alongside the existing original lossless, HDR/alpha and 24 MP memory checks.

A serial profile of a 0.51 MP source takes 47.5 seconds, including 30.4 seconds
of AVIF encoding. The runner now records stage timings and admits up to eight
capped workers inside one 8 GiB, zero-swap process tree, with unchanged codec
thread settings. It replenishes finished slots without waiting for an entire
batch. A failed worker stops new admissions and preserves completed diagnostics.
Unchanged small originals may reuse earlier scores only after normalized-pixel,
source, tool and settings checks; first-party reuse also requires fresh identical
encoded bytes. Reused points without inline repository-decoder evidence receive
a separate fresh decoder check. The raw profiling receipt is
`m7-quality-stage-profile.json`.

With the pinned corpus and oracles prepared, reproduce the eight original-size
cases in a fresh output directory using the tracked preparation command:

```sh
PUREJSIMAGE_M7_MEMORY_GIB=8 node benchmark/jpegxl/run-m7-bounded.ts original-size-replay /bin/sh -c 'node benchmark/jpegxl/prepare-m7-original-checks.ts && node .tmp/jpegxl-m7/original052-snapshot/benchmark/jpegxl/run-m7-diagnostic.ts baseline original-checks'
```

The preparation command preserves original dimensions and records source,
normalized-pixel, preparation-harness and codec hashes. It checks the diagnostic
harness before adapting its fixed cases and distances, and refuses to overwrite
an existing snapshot.


The first complete repository replay selected the older single-cache reference
for multi-group SDR streams. All 240 decoded exactly, but 42 stream hashes differ
from the later typed-palette reference (22 development and 20 holdout). The
verifier now selects the typed-palette reference. A focused regression checks
that an obsolete baseline cannot replace the current artifact. The 198 identical
stream receipts remain usable; the 42 current streams now pass a separate replay.
All 240 current lossless artifacts have exact repository decoding evidence. The
corrected reports retain the source reuse audit and distinguish fresh decoding
from reused byte-identical receipts. The incorrect assembled size reports were
removed from tracked evidence and retained under ignored correction storage.
Production codec code is unchanged.


The corrected lossless development size ratios against libjxl are median
1.153636, p90 1.367369 and worst 1.673511. Held-out ratios are 1.167859,
1.409225 and 1.675691. The held-out p90 misses the 1.40 target. The separate
transparent lossless expansion also misses its median and p90 targets; the
compression-performance claim remains limited. Raw cases and decoder evidence
are retained in `m7-lossless-development-integrated054.json` and
`m7-lossless-holdout-integrated054.json` under the production-program directory.

The final runtime measurements retain seven alternating cold and warm pairs.
Effort-1 median paired core ratios are 6.497027 cold and 8.085203 warm against
single-thread native libjxl. The warm result misses the 8-times target. Public
effort-3 encoding of the original 12 MP image takes 4.554232 seconds cold and
4.542515 seconds warm, including open, staging and sink output, within the
20-second target. These measurements are observational on the recorded host;
equal distance does not establish equal perceptual quality.

Expanded development SDR review covers 38 additional panels, including both
brochure size outliers, the NOAA table, maps, gradients and texture. Text remains
legible, with visible edge ringing and texture smoothing at distance 3. Expansion
review covers 25 development and 55 held-out previews across all declared HDR
headrooms and both alpha backgrounds for the selected worst size outliers. It
records cable and colored-edge roughness and texture loss. No severe corruption
was observed in those previews. HDR review uses the scored mapped SDR rasters;
it is not physical HDR display testing. The visual receipts retain exact PNG and
scored-raster hashes and the findings for each reviewed source.

The final runtime replay found and fixed a decoder admission bug in a valid
12 MP effort-1 stream. Its 285,120 entropy contexts exceeded the generic
65,536-entry limit. HF coefficient maps now have an explicit 2,027,520-entry
ceiling, checked before allocation; other entropy paths keep the smaller limit.
The encoder and scored pixels are unchanged. Both runtime streams agree with
native, Rust and repository decoding within one RGB8 level across all samples.
A licensed real-image regression, boundary tests and three real browsers cover
the fix. The official conformance dispositions remain unchanged, including the
known delta-palette failure. `m7-hf-context-fix.json` retains this distinction and
both the failed and corrected runtime replay receipts.


## M7 local completion under the approved qualification profile

Both frozen 120-source SDR matrices are complete at at most 2 MP: 7,200 points across five codecs and six settings, with no measurement failures. Eight fixed original-size sources add 32 points. All first-party outputs have independent decoding evidence, and 32 new comparison panels were inspected. The final local check passes. See `benchmark/jpegxl/production-program/m7-capped052-completion.json` for hashes, raw evidence links, quality strata and test totals.

Lossy support remains Experimental. Missing quality brackets, original-resolution coverage limits, lossless compression misses and the warm effort-1 timing miss remain explicit. Optional patch encoding is a future compression improvement. M8 through M10 and remote PR checks are separate work.

## M7 encoder target qualification after local completion, September 23

Prompt 2 keeps the M7 local completion above intact. The encoder candidate at
2643604888dc8ad58322a3756d5aade68af066b4 reduces isolated warm effort-1
core time by about 2% in a seven-run development diagnostic. It reproduces all
1,440 approved capped first-party streams and all 32 fixed original-size points
byte for byte. The clean-checkout conformance and resource gates pass.

Two new 21-pair measurements on that exact commit give warm effort-1 median
ratios of 8.067 and 8.142 against pinned native libjxl. Both miss the 8-times
target. Cold ratios are 6.661 and 6.613, and the original 12 MP public
effort-3 workflow takes 4.504 seconds cold and 4.523 seconds warm. The observed
lossless holdout p90 remains 1.409, and transparent RGBA8 lossless median/p90
remain 1.291/1.483. Missing lossy quality brackets and original-size text
outliers remain in the evidence. Lossy stays Experimental.

The before/after table, target-by-target decisions, source and artifact hashes,
raw report links, and independent decoder receipts are in
benchmark/jpegxl/production-program/m7-prompt2-report.md and
benchmark/jpegxl/production-program/m7-prompt2-evidence-index.json. The observed
holdout is regression evidence after prior inspection; no new unseen
generalization claim or Stable promotion is made.

## M7 encoder target requalification, September 23

The implementation at `8925ce52fa06b2112310f60ccbe7f639eba0fdd1` improves the effort-7 multi-group Modular entropy choice and the aligned effort-1 RGB8 XYB path. Fresh exact native and Rust decoding passed for all 240 lossless SDR sources and all 24 HDR/alpha expansion cases. The observed holdout lossless p90 improves from 1.409225 to 1.399516 and now passes the 1.40 size bound. This holdout was inspected during tuning and is regression evidence. The separate transparent RGBA8 artwork median/p90 remain 1.291/1.483 and fail their size bounds. The old large-image reduction is preserved.

The exact-commit original 12 MP effort-1 paired median is 5.646 times native cold and 7.067 times native warm, both within the eight-times target. The public effort-3 run is 4.504 seconds cold and 4.572 seconds warm, within 20 seconds. The unchanged effort-7 lossy path reproduces all 16 first-party streams in the fixed eight-source original-size check, with independent decoding and the same quality scores. Native patch coding still has large text and screenshot size advantages, missing SSIMULACRA2 brackets remain, and HDR/alpha quality gaps remain. Lossy therefore stays Experimental.

The [before/after report](../../benchmark/jpegxl/production-program/m7-prompt3-report.md), [evidence index](../../benchmark/jpegxl/production-program/m7-prompt3-evidence-index.json), raw case reports, and clean-checkout conformance/resource results give the target-by-target decision. The final local check has 3,192 passed tests and three skipped; real Chromium JPEG XL tests pass 29/29. No new unseen-generalization claim, Stable promotion, version change or release follows from this result.

## M7 transparent lossless artwork repair, September 23

The implementation at `49f3c25611210c4f04dd3f8907e5be8e28781317` measures three additional palette orders for small single-group RGBA8 lossless effort-7 images and keeps the smallest encoded stream. The same 12 native artwork families improve from 1.290606/1.482599 to 1.233412/1.317121 median/p90 against the 1.25/1.40 bounds. The worst ratio is 1.548490, below 1.75. Every color and alpha sample, including RGB under zero alpha, matches through pinned native, pinned Rust, and the repository decoder. The six development and six observed holdout sources retain their original split. The observed holdout was inspected during tuning and remains regression evidence.

The 12 derived PQ16 streams are byte-identical and decode exactly. The 240-case SDR, large-image, lossy, effort-1 and public effort-3 paths are unchanged; their previous qualification evidence remains linked in the [target report](../../benchmark/jpegxl/production-program/m7-prompt4-report.md). Effort-7 artwork encoding takes longer in the two measured diagnostics. The [raw expansion](../../benchmark/jpegxl/production-program/m7-prompt4-lossless-expansion.json) and [evidence index](../../benchmark/jpegxl/production-program/m7-prompt4-evidence-index.json) record source, stream and decoder hashes. The clean implementation commit passed 39/39 conformance and 24/24 resource cases. The full repository check passed 3,193 tests with three skipped, and the focused Chromium check passed. Lossy stays Experimental because its remaining quality and original-size gaps are unchanged.

## M7 repeated-document lossy follow-up, September 23

The first-party encoder now uses a bounded two-frame patch dictionary for
large pale sRGB RGB8 documents at effort 7. It stores exact repeated glyphs
in a Modular reference atlas and patches them over a quantized display frame.
On the two original development brochures at distance 3, byte counts fall
from 481,225 to 235,497 and from 409,211 to 79,273, while SSIMULACRA2 and
Butteraugli both improve. Native libjxl, pinned Rust and the repository decode
all 16 fixed original-size streams; the other 14 are byte-identical to the
prior revision. The observed table and screenshot remain in the replay as
regression evidence. The approved 2 MP matrices are unchanged because their
inputs are below the 8 MP selector. The complete original-size replay used
the approved 8 GiB profile, peaked at 3.9 GiB and used zero swap.

The [before/after report](../../benchmark/jpegxl/production-program/m7-prompt8-report.md),
[full original-size result](../../benchmark/jpegxl/production-program/m7-prompt8-original-size.json)
and [evidence index](../../benchmark/jpegxl/production-program/m7-prompt8-evidence-index.json)
record the target decision, hashes and independent decoding. Lossless keeps
its qualified status. Lossy stays Experimental because complete SSIMULACRA2
brackets and the original-size HDR, transparency and visual quality gates
remain unmet. The [per-case bracket audit](../../benchmark/jpegxl/production-program/m7-prompt8-bracket-audit.json) shows that pinned native libjxl itself lacks 70/80/90 brackets on some sources within the approved six distances. Those reference gaps need supplementary endpoints before a complete matched-quality claim can be measured. The original matrix and missing cases stay intact. No version change, release or Stable promotion follows.

## M8 initial static decoding checkpoint, September 11

This section records the initial checkpoint, superseded by the completion run
below. Its conformance report is preserved as `m8-initial-conformance.json`.

Work starts from clean branch `codex/jpegxl-m06-m10-completion` at
`1c6e1433a938bcb3f22a41c3f388c9a22156cbd2`. Package version stays 0.17.0.
M7 keeps its original qualification evidence and Experimental lossy status.

The first implementation addresses the official `delta_palette` failure.
Zero stored entries are legal because palette indices can select implicit
colors and deltas. Empty ANS streams still require their final-state word.
Global delta prediction crosses group boundaries. The new RGB8 path retains
one band of indices and three reconstructed rows per channel. Cropping replays
earlier rows and all columns; it does not claim selective group reads.
Stored palettes, weighted global palette prediction and other global transform
combinations remain explicitly unsupported.

The unchanged CC0 input is tracked in
`tests/fixtures/jpegxl/m8-implicit-palette/`. All 1,250,415 RGB sample bytes
match both the official reference PNG and a fresh pinned libjxl decode.
Fixture attribution, input/output hashes and the oracle binary hash are in
that directory's README. Focused tests cover two group boundaries, a final
one-pixel crop, buffer admission, cancellation after output, early return,
reuse, corrupt global padding and truncation. The buffer bound is conservative;
it is not an RSS measurement. Source/sink ownership and JavaScript object
overhead remain separate.

The corpus manifest retains the historical `unexpected-failure` disposition
and adds the independently verified output hash. The runner now distinguishes
historical baseline agreement from current expectations. Only an exact pinned
output can advance a former unsupported or failing case to pass. All 39 cases
remain in the report.

M8 is in progress. Animation sequence contracts, decoder and writer, typed
extra channels, remaining transforms, profile conversion and the complete
Level 5 acceptance gate remain open. No animation API or broad Level 5
promotion is claimed by this checkpoint.

Checkpoint evidence is in
`benchmark/jpegxl/production-program/m8-static-conformance.json`. It identifies
the base revision, dirty working tree, decoder source hash, harness hash and
manifest hash. All 39 cases retain individual results: 14 pass, 25 expected
unsupported, zero incorrect output and zero unexpected failures. The new
fixture passes nine focused regression tests. The three browser engines also
match the reference sample hash through the actual workbench canvas.

The specialized entry grows from 457,476 to 459,885 minified bytes; core plus
JPEG XL grows from 402,436 to 404,844 bytes. The existing 460,000 and 405,000
ceilings remain unchanged. The added code handles empty palette streams,
group-spanning prediction rows and their admission checks. No encoder or
runtime dependency was added.

Commands used for this checkpoint:

```sh
npx vitest run tests/jpegxl-m8-palette.test.ts
npx vitest run tests/jpegxl-m8-palette.test.ts tests/jpegxl-scalar-palette.test.ts tests/jpegxl-m7-lossless.test.ts
node benchmark/jpegxl/production-program/run-conformance.ts --corpus-root .tmp/jpegxl-conformance --output benchmark/jpegxl/production-program/m8-static-conformance.json
node node_modules/@playwright/test/cli.js test browser-tests/jpegxl-m8-palette.pw.ts --workers=1 --retries=0
npm run size
npm run documentation:write
```

The first full-check attempts stopped at stale generated size/documentation
files. Those outputs were regenerated. Their failed receipts remain under
`.tmp/jpegxl-m7/bounded-runs/m8-initial-check-20260911.json` and
`m8-final-check-20260911.json`; they are not successful checks.

Final local checkpoint: `npm run check` passes 3,076 tests with three existing
skips, across 235 passed test files and one skipped file. The final Chromium,
Firefox and WebKit rerun passes all three pixel-hash tests with retries disabled.
The combined check/browser job takes 6 minutes 40 seconds and peaks at 2.1 GiB
under its 3 GiB cap, with zero swap. This measures the test process tree, not
codec RSS. Its receipt is
`.tmp/jpegxl-m7/bounded-runs/m8-complete-check-20260911.json` and the log is
`.tmp/jpegxl-m8/check-complete.log`. Documentation freshness and `git diff --check`
also pass. Changes are local and uncommitted; no remote validation is claimed.

## M8 completion run

The user's latest direct request is to finish M8 completely. The preceding
static checkpoint is the starting point, not M8 completion. Work now covers
sequence ownership and rational timing; animation decode, composition, seek
and streamed lossless/lossy writing; remaining Level 5 static combinations;
typed native extra channels and source-profile preservation; independent
frame/channel oracles; bounded-resource and browser acceptance. M9 and M10
remain outside this request.

Sequence inspection reuses JXL frame structures. The ordinary still API
requires its existing `frame` option for animated input. The specialized
entry exposes displayed-frame iteration and raw native layers separately.
Seek reports replay from the beginning, with only four reference slots
and one active output frame. Cumulative times use exact integer ticks and
serialize large values as decimal strings. Full sequence frame counts require
a header scan; pixel output remains incremental and bounded independently
of the number of frames.

### Implemented M8 contract and independent evidence

The specialized `purejsimage/jpegxl` entry now exposes `openJpegXlSequence`,
`encodeJpegXlAnimation` and `encodeJpegXlNative`. The ordinary still API requires
an explicit displayed-frame index for animation. Discovery, raw coding layers,
progressive dependencies and timed composited output have separate contracts.
See [sequence and native channel APIs](../jpegxl-sequences.md).

| Gate | Implementation and evidence |
| --- | --- |
| M8.1 sequence contract | Rational tick numerator/denominator, decimal accumulated timestamps, loops/timecodes, separate coding/display indices, replay seeking, caller ownership and one active iterator |
| M8.2 animation decode | Partial/negative rectangles, four references, save before/after color transformation, all frame blend modes, exact alpha semantics and internal dependencies; 18 native comparisons cover 161 displayed frames |
| M8.3 streamed encoding | One-frame lookahead with backpressure, early-return cleanup, cumulative work/output limits; ten native scenarios cover 50 lossless/lossy frames, moving text, transparent sprites, photographs, repetition, orientation and nonuniform rational timing |
| M8.4 static reconstruction | Delta palette, previous-channel MA properties, grouped shifted channels, inverse transforms, custom opsin/upsampling/Gaborish/EPF, all eight Modular/XYB patch modes, YCbCr 4:4:4/4:2:2/4:2:0, noise/splines and raw patch/progressive dependencies |
| M8.5 native channels | Names, dimensions/shifts, sample/exponent bits and association preserved; typed integer and binary16 planes; bounded GRAY/RGB ICC writer verified through native extraction and independent CMM conversion |
| M8.6 level mapping | Checked Level 5/10 table and all 39 original dispositions retained; expected unsupported output never counts as a pass |

Tracked reports are `m8-sequence-native.json`, `m8-static-native.json`,
`m8-native-raw.json`, `m8-native-channels.json`, `m8-timing-native.json`,
`m8-animation-encode-native.json`, `m8-m3-revalidation.json` and
`m8-static-conformance.json` under `benchmark/jpegxl/production-program`.
They retain input/output hashes, source hashes, pinned native identity, comparison
domains and numeric errors. Tests freeze the independently qualified outputs.
The first checkpoint's 14-pass result above remains historical evidence.

Native extraction is the selected preservation contract for layouts that the
interleaved display API cannot represent. It does not promise automatic spot
rendering, calibrated depth, binary16 display conversion or gray-ICC-to-RGBA
conversion. The native writer accepts one group up to 1024 by 1024, one or three
color planes and up to four extras. Animation uses full-canvas working buffers
with four references and cumulative replay limits; it does not cache all frames.
Lossy encoding remains Experimental. M9 promotion/security/release gates and
M10 CMYK/wider floating profiles are separate from this implementation milestone.

The native parser confirmed that combined extra-channel upsampling and dimension
shift above eight is invalid. Both decoders reject the independently constructed
factor-16 fixture. Unsupported display combinations stay explicit errors, and
the public contract does not promote an unrestricted Level 5 display claim.

Final measured minified sizes are 439,092 bytes for the core plus JPEG XL codec
and 510,270 bytes for the specialized JPEG XL entry. Their ceilings are 440,000
and 515,000 bytes. The original recorded baselines remain intact. This growth
includes the sequence compositor, native channel support and reconstruction
paths; the root API still does not silently load an optional accelerator.

A final review caught a sequence metadata edge case for wide-gamut XYB sources.
The emitted sRGB samples now carry an sRGB transfer label, while the original
Display P3 descriptor remains in the header. A first-party generated Display P3
fixture passes independent native float comparison and has a frozen sample hash.
The earlier full-check attempt was stopped before completion to apply this fix;
its partial results are not a successful handoff gate. Final validation uses the
updated source and includes this case in all three browsers.

### Final local acceptance, September 12 UTC

- [x] M8.1: sequence discovery, exact timing, selection, ownership and replay contract.
- [x] M8.2: independent visible-frame, reference, blend and raw-layer comparisons.
- [x] M8.3: streamed lossless and Experimental lossy encoding, exact alpha,
  temporal quality, rational/nonuniform timing, orientation and cancellation.
- [x] M8.4: delta palette, the M3 tree regression, grouped/shifted channels,
  reconstruction families and cross-feature fixtures; all 300 M3 inputs pass.
- [x] M8.5: typed native extraction and source-profile preservation, independently
  verified sample values, ICC bytes and CMM conversion.
- [x] M8.6: all 39 dispositions retained, all applicable Level 5 cases pass,
  and Level 10 exclusions do not count as passes.
- [x] `npm run check`: 3,123 tests pass, with three existing skips. There are
  239 passing test files and one skipped file. Browser portability, lint,
  formatting, generated documentation, package types and size gates pass.
- [x] Real Chromium, Firefox and WebKit: twelve M8 tests pass with retries off.

`benchmark/jpegxl/production-program/m8-final-gates.json` records the final
source hash, native-report hashes, full-check/browser log hashes and bounded
handoff receipt. The full handoff process peaks at 2.6 GiB with no swap under a
3 GiB cap. This is test infrastructure memory, not codec-only RSS.
M8 is locally complete and committed on the existing branch.
No merge, publication or Stable lossy promotion is claimed.

## M9 production hardening

M9 adds one admission boundary for the capability subsets completed in M6 through
M8. The gate manifest fixes twelve cross-feature workflows, twelve mutation
families, twelve resource and cancellation cases, and eight package/runtime cases.
Each report carries its source revision, clean-checkout state, manifest hash, raw
case identities and input or output hashes. The final evidence builder rejects
missing cases, stale revisions, dirty evidence, false summaries, raw exceptions,
managed ownership leaks and package size overages.

The integration matrix combines progressive region selection with orientation,
HDR with alpha fallback, high-depth native channels, partial animation timing,
reference replay and cancellation, storage-only HDR conversion, Display P3 to
sRGB lossy encoding, float resize to integer encoding, exact JPEG marker
reconstruction, reconstruction invalidation after display metadata changes,
fragmented reads under a tiny cache, and strict versus allowed fallback policy.
This matrix found and corrected an encoder admission bug: pixels converted by the
decoder to a known structured color space can retain a source-only ICC descriptor
and may omit a rendering intent that defaults to relative intent in the writer.

The hostile-input gate mutates container, entropy, Modular, VarDCT, progressive,
animation, ICC, exact JPEG, writer, display conversion and worker/API surfaces.
Separate resource cases cover stalled reads; segment, internal-frame, pixel and
metadata limits; fetch and computation cancellation; sink and pending-write
failure; early iterator return; reuse; and malformed input after partial preview.
Every case terminates through a normalized result and reports zero live managed
ownership after cleanup.

The security review records the libjxl 0.13.0 security release notes, the libjxl
security policy and the jxl-oxide GHSA-5pmv-rx8r-wmv5 advisory. Local regressions
exercise the accepted syntax independently. No upstream implementation or fix is
copied into the codec.

Package acceptance runs the packed public imports under Node 22 and Node 24,
checks both JPEG XL browser-safe exports, and exercises the public API in Chromium,
Firefox and WebKit with retries disabled. The measured core plus JPEG XL entry is
439,130 minified bytes under its 440,000-byte ceiling. The specialized entry is
510,308 bytes under its 515,000-byte ceiling. The local cold import took 67.21 ms
and the first small decode took 14.76 ms. These timings are observations from one
machine, not portable performance thresholds.

Pull-request CI now uses one bounded JPEG XL smoke job. It verifies the generated
baseline, all 39 checksum-pinned official conformance cases, the twelve M9
integration workflows, and the mutation/resource gate. The repository-wide CI
continues to cover Node 22, Node 24, package types, and Chromium, Firefox, and
WebKit. Oracle builds, packed-import matrices, extended fuzzing, codec benchmarks,
isolated memory measurements, holdouts, independent-decoder matrices, M10 `djxl`
acceptance, and final evidence assembly run locally. This avoids duplicating the
repository-wide checks and keeps pull-request validation bounded to twelve minutes.

### M9 acceptance checklist

- [x] Twelve cross-feature cases pass with unique raw output hashes.
- [x] Twelve mutation targets and twelve resource cases terminate with normalized
  outcomes, no raw exceptions and zero live managed ownership.
- [x] Computation cancellation, source-fetch cancellation, pending sink writes,
  early return, session reuse and late malformed input release their ownership.
- [x] Packed public imports pass under Node 22 and 24. Chromium, Firefox and WebKit
  pass the focused public progressive/session workflow with retries disabled.
- [x] Evidence validation rejects omitted rows, stale or dirty reports, false
  summaries, leaks, raw exceptions and size-limit violations.
- [x] Generated capability and package-size artifacts match the authoritative
  manifests and measured bundles.
- [x] Final `npm run check`: 3,130 tests pass, with three existing skips. The
  bounded process peaks at 1.8 GiB with zero swap. Clean-revision evidence is
  generated and admitted after the implementation commit, before the branch push.

M9 does not change capability labels. Common static decode stays Supported for its
documented subset. Lossless writing and exact JPEG reconstruction keep their
existing stable boundaries. Lossy writing remains Experimental.

## M10 Level 10 native precision and profiles

M10 adds an executable level/profile map and a bounded native Level 10 path. The
map separates syntax, metadata, rendered pixels, raw channels, display conversion,
encoding, reconstruction and resource limits. The writer selects Level 5 for its
12-bit-and-below subset. Integer depths above 12, floating samples, more than four
extra channels and black channels select Level 10. Level 10 output is always a
container with `jxll=10`; explicit Level 5 or raw-output conflicts fail.

The Modular residual reader now keeps 32-bit hybrid integers as exact JavaScript
numbers. Signed unpacking uses arithmetic instead of bitwise truncation. Weighted
prediction retains its specified 64-bit scaled working values and applies the
codec's intentional 32-bit sample wrap only at the sample boundary. The official
500 by 500 binary32 fixture matches all 750,000 reference bit patterns, including
negative values and highlights above one.

`encodeJpegXlNative` accepts unsigned 1-through-31-bit planes in `Uint32Array` storage plus IEEE binary16
and binary32 bit patterns. Exact native helpers expose unsigned bits and binary32
numbers. Integer display conversion requires an explicit finite black/white range
and rejects NaN and infinity. CMYK remains four native planes: three color planes
plus a black extra channel. Its embedded CMYK ICC profile can be applied explicitly
to RGBA8 while raw CMYK, black and alpha planes remain available.

The official conformance gate now records 39 passes and zero expected-unsupported
cases. Pinned libjxl `djxl` accepts binary32, 31-bit integer, CMYK and general
forward VarDCT output from the writer. The public Level 10 paths run in Node and
a real browser. General forward VarDCT accepts an explicit Level 10 request for
the existing integer gray, RGB and RGBA subset. It also selects Level 10
automatically when exact Modular alpha uses more than 12 bits. Level 10 always
uses a container with `jxll=10`; an explicit Level 5 or raw-output conflict fails.
Streamed animation uses an unbounded `jxlc` box so Level 10 signaling remains at
the front of the stream without buffering the completed animation.
Unshifted native planes encode across multiple 1024-pixel Modular groups, and
shifted black and alpha planes use the signaled kernel during CMYK profile
conversion. Other floating layouts and shifted multi-group native writing remain
named unsupported cases.

### M10 acceptance checklist

- [x] Machine-readable normative Level 5/10 map with named implementation boundaries.
- [x] Exact official binary32 decode and explicit finite-range display conversion.
- [x] Exact 1-through-31-bit integer, binary16 and binary32 bounded lossless writer round trips.
- [x] CMYK/black native extraction, embedded-profile conversion and Level 10 writing.
- [x] Minimum-level selection below, at and above the writer threshold; `jxll=10`
  checked in the emitted container and conflicting options rejected.
- [x] All 39 official valid cases pass with frozen output hashes.
- [x] Pinned `djxl` accepts eight representative Level 10 writer outputs, including
  exact multi-group binary32, CMYK and general VarDCT output.
- [x] General forward VarDCT writes explicit Level 10 progressive multi-group output,
  automatically selects Level 10 for high-depth Modular alpha, streams Level 10
  animation, and passes pinned `djxl` plus three-browser checks.
- [x] M9 integration, hostile-input/resource and package gates rerun after the final
  production edit.
- [x] Chromium, Firefox and WebKit preserve the multi-group binary32 output; shifted
  CMYK profile conversion matches the equivalent full-size constant plane.
