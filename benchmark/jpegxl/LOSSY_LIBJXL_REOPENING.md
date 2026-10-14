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
