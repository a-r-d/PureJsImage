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
