# libjxl-informed lossy encoder (owner decision, 2026-10-13)

This reopens the campaign and replaces the independence rules in
[LOSSY_STEERING.md](LOSSY_STEERING.md) section 2. The lab, speed, memory and
promotion rules continue. This decision overrides earlier campaign stop rules.

## Source and licensing

Read libjxl-tiny first, then libjxl v0.12.0, bundled in wasm-vips 0.0.19.
Port its heuristics, constants, weights, masks, thresholds and tables into
first-party TypeScript. Other open-source codec techniques may fit, including
trellis and rate-distortion quantization; libjxl components come first.
Native internal probes are allowed but discouraged. Prefer source and bitstreams.

Every port goes in a clearly named module. Its header names the source file and
tag or commit, says "Copyright (c) the JPEG XL Project Authors. BSD-3-Clause",
and explains the changes. Include the full libjxl LICENSE in THIRD_PARTY_NOTICES,
shipped in the npm package and docs site. Record every port in PROVENANCE.md:
our file, source file, commit and material taken. No runtime dependencies.

## Step 1: decision transplant before any port

1. Encode the frozen 64 development-photo crops with wasm-vips effort 7 on the
   standard ladder.
2. Use our decoder to extract each stream's AC strategy map, raw quant field,
   global scale, DC quantization, chroma-from-luma maps, EPF sharpness, gaborish,
   and any patches, noise or splines.
3. Add a development-only encoder option forcing one or more decisions while
   leaving the rest to our encoder.
4. Run the screen and full lab for each component alone and all together. Report
   BD-rate against vips, jSquash as reference, and our encode time per row.
5. Inspect im26-3304, im26-3312 and im26-1020 near-flat textures. Report whether
   libjxl transform choices remove the square boundaries.
6. Stop and report the table to Aaron before porting anything.

The all-maps experiment tests the remaining encoder gap. Confirm that other
signal-affecting choices match before attributing the entire gap to entropy
coding and rounding.

## Step 2 after the report

Port the decision component closing the largest measured gap first. Each port
is one ordinary lab experiment. Port decision logic, not SIMD, threading or
memory infrastructure. Follow the speed rule; use a cheaper equivalent or effort
9 for heuristics that are too slow. After each promoted port, rerun the remaining
transplant rows to refresh the ranking.

## Targets and stop

On the holdout against wasm-vips: SSIMULACRA2 at most 0%, Butteraugli 3-norm at
most +5%, Butteraugli max at most +8%. Report jSquash as reference. Speed targets
remain within 3x jSquash on crops and 5x on originals. Keep the memory ceiling.
Stop when targets pass. Also stop when three consecutive ports close less than
1% combined and report the results.

## Follow-up after the first port report

Aaron explicitly reopened the stopped experiments: investigate why the ports
regressed and test libjxl quantization and transform decisions together. This
authorizes the coupled investigation after LL-618. Preserve the earlier results
and apply the same development, licensing, speed, memory and promotion rules.

## Owner decision, 2026-10-14: allocation sweep before a coherent port

The one-component-at-a-time instruction is withdrawn. The objective against
wasm-vips on the holdout is a mean of the three BD-rates at most +2%, with no
single metric above +5%. Speed remains within 3x jSquash on crops and 5x on
originals; the existing memory ceiling and promotion checks remain.

Step A uses our encoder without peer maps. Geometrically blend each physical DC
step with InitialQuantDC at alpha 0, 0.25, 0.5, 0.75 and 1; multiply global AC
precision by 0.8, 1, 1.25 or 1.6. Screen all 20 combinations without DC smoothing
and the 12 combinations at alpha >= 0.5 with normative smoothing. Our existing
photo policy already enables smoothing; separately verify the neutral knobs
with that existing policy against the unchanged control. Report all three
BD-rates against vips and control, and plot the SSIM/3-norm frontier. Compare
native-map replay with the optimized source Gaborish inverse as an extra
preconditioning diagnostic. Take the best two points to the full lab. If a
point meets the development objective and speed rule, complete promotion, then
stop and report.

If Step A does not meet the objective, report the frontier, best point,
Gaborish result and selector speed estimate. Do not begin Step C without Aaron's
approval. Step C, if approved, is a coherent standalone development mode with
InitialQuantField, AdjustQuantField, InitialQuantDC, the adapted selector and
optimized Gaborish inverse. It must reach within 1% of native-map replay on each
metric before normal promotion, including speed checks.

Before any merge to main, remove peer-decision forcing hooks from src or keep
them outside the public bundle path. No such merge is part of an unsuccessful
Step A checkpoint.

## Step C approval, 2026-10-14

Aaron approved the coherent standalone mode after reviewing Step A, and asked
for selector speed work too. Implement InitialQuantField, AdjustQuantField,
InitialQuantDC, the adapted selector and optimized Gaborish inverse together,
with no peer maps. Keep all work on `jxl-libjxl-ports` until the gates above pass.
This supersedes the earlier requirement to wait for Step C approval. It does
not waive quality, speed, memory, holdout or public-bundle cleanup checks.

## Research continuation, 2026-10-15

After the channel-rounding report and plateau stop, Aaron asked to keep working.
Reopen development research on the coherent standalone mode, starting with
per-cell error constraints on large-transform merges. Keep the frozen corpus,
ladders, quality guards, speed rule, memory ceiling and research-branch boundary.
The holdout remains a promotion check and must not guide tuning.

The next continuation tests smaller and distance-dependent AC shifts. Five
screens and three full allocation labs produce no retained quality policy.
The retained research candidate combines exact row-wise mask loss with bulk
copies for contiguous candidate blocks. Development bytes stay unchanged.
The two prior holdout guards remain unresolved; keep this work on the research
branch and complete the normal gates before any public integration or merge.

The guard-focused follow-up freezes the coarse-distance allocation with the
exact selector. It lowers the worst admitted development SSIM regression from
7.677% to 7.192% and passes crop and original entry checks. One aggregate-only
holdout attempt gives vips -5.996/-3.605/-2.909%, mean -4.170%, but two admitted
SSIM guards still fail, worst +11.617% against main. No parameter changes follow
that result. Keep the candidate as an explicit research option; public defaults
and main stay unchanged. Full watch/scale and public integration remain pending.

## Owner decision, 2026-11-20: merge the research to main

Superseded the same day by the next section; the branch is not merged yet.

Aaron asked to merge `jxl-libjxl-ports` into main as research. This replaces
the rule above that kept the work on the branch until the gates pass. The merge
does not promote the standalone mode, and the public encoder does not change.

- The standalone mode stays in `benchmark/jpegxl/lossy-lab/` and the replay
  writer stays in `.tmp/jpegxl-lab-codec/`. Neither is in the npm package or
  the default browser bundle. `npm run package:types` and `npm run browser:check`
  enforce this.
- Before the merge, 41 public encodes produce the same bytes on `origin/main`
  and on the branch. The cases cover lossy effort 3, 7 and 9, lossless effort 1
  and 7, RGB and RGBA input, and sizes that are not a multiple of 8.
- `npm run typecheck` runs `npm run jpegxl:lab:prepare`, which applies
  `lossy-lab/decision-replay.patch` to `jpegxl-jpeg-encode.ts` and
  `jpegxl-vardct-encode.ts`. A change to either file must refresh that patch.
- Promotion still needs the gates above: 3× jSquash crop speed (last measured
  3.125×), 5× on originals, the memory ceiling, the two holdout SSIM guards,
  and a port of the lab modules into `src` with browser coverage.

## Owner decision, 2026-11-20: integrate before merging

Aaron decided not to merge until the useful research is in the production
encoder. His choices:

- Regularized-half replaces the effort-7 lossy path for opaque 8-bit sRGB
  photos. Peak rounding passes the speed rule only as a slow tier.
- Effort 9 becomes regularized-half plus peak rounding. Until peak rounding is
  ported, effort 9 runs the same policy as effort 7.
- JPEG XL bundle ceilings may rise to fit the port.
- The two holdout SSIM guard failures must be fixed before the merge.

Status on 2026-11-21:

- The policy runs in src and matches the lab byte for byte on all 630
  development encodes. Flat artwork keeps the established encoder, and the
  established encoder runs when the policy exceeds `maxWorkingBytes`.
- On a 21 MP original the managed peak is 116.7 to 120.7 MB, below the
  137,514,476-byte ceiling.
- The policy applies Gaborish only above distance 1.85 and scales the masking
  term by 0.75 (LL-1402, LL-1404). This removes every admitted development SSIM
  regression against main.
- Aaron approved one aggregate-only holdout check, and it passes (LL-1405).
  Against wasm-vips: SSIMULACRA2 −7.137%, Butteraugli 3-norm −1.666%,
  Butteraugli max +2.636%, mean −2.056%. Ten SSIM guards against main admit
  the full band and none fails; the worst is +3.600%. No parameters changed
  after the holdout.
- Aaron then approved calibrating distance to libjxl on SSIMULACRA2 for
  efforts 7 and 9 (LL-1406 to LL-1411). A requested distance maps to an
  internal distance, and Gaborish strength fades in from distance 1.5 to 2.5
  instead of switching at 1.85, where files grew 29%. Median SSIMULACRA2 is
  within 0.5 of wasm-vips from distance 0.25 to 11.6, with files 4 to 11%
  smaller. On development the mean BD-rate against wasm-vips improves from
  -4.531% to -5.201% and all 8 admitted SSIM guards still pass.
- Aaron approved one aggregate-only holdout check of the calibrated encoder,
  and it passes (LL-1412). Against wasm-vips: SSIMULACRA2 −6.778%, Butteraugli
  3-norm −2.601%, Butteraugli max +0.681%, mean −2.899%. Nine SSIM guards
  against main admit the full band and none fails; the worst is +4.483%. No
  parameters changed after the holdout.
- Main's RGB8 lossless palette fix is merged into this branch. The 246-color
  family fixture now keeps its exact palette at every lossy distance from 1 to
  6: 2,207 bytes from RGB8 and 2,222 from RGBA8. Before the merge it fell back
  to VarDCT at distances 2, 4, 5 and 6. The palette path only runs on images
  with at most 2,048 visible colors. The 11 development crops in that range give
  identical bytes at all nine lab distances, so the development results above
  still hold.
- Four Chromium tests in `browser-tests/jpegxl-pipeline.pw.ts` pinned
  established-encoder output that the public encoder no longer writes for their
  inputs: the weighted DC model, DC precision above four megapixels, the fine
  opaque texture and the flat palette fallback at 1,500,000 bytes. Like their
  Node tests, they now run `establishedJpegXlCodec` in both runtimes and keep
  the independently checked bytes. The fine texture's managed peak pin moves
  from 27,376,349 to 27,376,341 bytes, which Node and Chrome both measure for
  the test encoder.
- The changelog and `docs/jpeg-xl.md` describe the encoder. The 64 raw JSON
  lab reports are removed before the merge.
- Owner decisions, 2026-11-22: run the browser tests in Firefox and WebKit and
  bring only the measurement part of the lab to main. Aaron first chose to port
  peak rounding before the merge. After its size was clear (about 3,200 lab
  lines, full-image perceptual maps that need a strip-based redesign to fit the
  memory ceiling, about 8x jSquash per crop), he chose to merge first and port
  it later on its own branch. Effort 9 ships with the effort-7 decisions.
- All 123 JPEG XL browser tests (policy, projection and pipeline) pass in
  Chromium, Firefox and WebKit.
- The lab keeps only the tooling that measures the public encoder: the runner,
  worker, metrics, corpus and fixture selection, and `summarize-port.ts`. The
  replay, transplant and port experiments, their 33 tests, the 86 archived
  patches, `decision-replay.patch` and its typecheck, Vitest and Playwright
  hooks are removed; they remain at commit `0d25cdd9`. Lab-only exports in
  `src` are removed too.
- Speed passes (LL-1413): the crop median is 1.91x jSquash, the 13 MP original
  1.31x, and the 21 MP original finishes in 49.0 s with a 111.0 MB managed peak.
  The exact-palette check now skips learned searches that cannot reach its
  budget (LL-1414): output is unchanged, the slowest low-color crop falls from
  25.7 to 3.4 s, and the crop p90 falls from 10.5 to 1.9 s.
- Peak rounding at effort 9 is dropped (LL-1415). Its cheap half, libjxl's
  quadrant dead zones and chroma predicted from reconstructed luma, changes the
  calibrated encoder by -0.158/-0.303/-0.235% on the 64 development photos,
  with medians slightly worse. A perfect peak guard would reach only
  +0.013/-0.121/-0.841%, while the lab guard is about 3,000 lines and about 4x
  the effort-7 crop time. Aaron chose on 2026-11-22 to keep the effort-7
  decisions at effort 9.
