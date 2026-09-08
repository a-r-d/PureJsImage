# JPEG XL M6 through M10 completion

## Scope and starting point

The supplied `PureJsImage_JPEGXL_M6_M10_Single_PR_Codex_Prompt.md` is the
project brief. The user's latest direct request is to finish M6 completely.
This turn implements M6 only. The brief's embedded authorization statements
are not independent user messages. M7 through M10 remain future work; no merge,
release, version change, tag or publication is part of this work.

The clean starting checkout and fetched `origin/main` are both
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

The normative feature-to-level table is **not-run**. Verify each requirement
against pinned format material before recording thresholds or claiming Level 5
or Level 10. CMYK/black must not be added to the old Level 5 promise. Parsing a
level tag and rejecting all such images is not pixel support.

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
| M6 | Lazy sessions, native DC/pass stages, embedded previews, dependency plans, selective groups and Range explorer implemented | Final cohort, resource and full handoff checks running | Not promoted |
| M7 | Not started | Not-run | Not promoted |
| M8 | Not started | Not-run | Not promoted |
| M9 | Not started | Not-run | Not promoted |
| M10 | Not started | Not-run | Not promoted |

Executed starting commands:

```sh
git fetch origin main
gh pr list --state all --head codex/jpegxl-m06-m10-completion --json number,state,headRefName,url
git switch -c codex/jpegxl-m06-m10-completion
npm run build
npx vitest run tests/jpegxl tests/jpeg-marker-walk.test.ts
```

The focused baseline passes 515 tests in 14 files. Full implementation,
new milestone gates, final remote checks, PR readiness and promotion are not
complete. Commits and a PR link will be recorded only after they exist.

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

Current local checks pass 2,891 tests with three existing skips, and 66 JPEG XL
browser workflows pass across Chromium, Firefox and WebKit without retries.
Official conformance still has 13 passes, 25 expected unsupported cases, the
known delta_palette failure and zero incorrect outputs. Five independent M4
conformance cases also pass. Final source-pinned measurements and report validation
are still being completed; no benchmark promotion or release has been claimed.
