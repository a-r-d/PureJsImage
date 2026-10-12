# Promotion entry and campaign end (owner decision, 2026-10-12)

This file supersedes the promotion-entry rules in LOSSY_PROMOTION_GUIDANCE.md
and LOSSY_FEEDBACK.md wherever they conflict.

## Compare against main, not E4
- Promotion compares the candidate with the unchanged baseline (main).
- The 0.3% repair allowance against E4 is retired.
- The vips targets in LOSSY_STEERING.md section 1 are end-of-campaign targets,
  reported in the final report. They are not promotion gates.

## Entry gates
1. Isolated crop speed: median within 3x jSquash. Currently 3.47x.
2. Originals: the 13 MP and 21 MP watch originals finish with formal isolated
   timing.
   - 13 MP must be within 10x jSquash. 5x remains the target; report the
     ratio.
   - Record encode time even if Butteraugli scoring times out.
3. Compression against baseline, mean BD-rate:
   - SSIMULACRA2: at most 0%.
   - Butteraugli 3-norm: at most 0%.
   - Butteraugli max: at most +3%. The current +2.75% is accepted given the
     large speedup on full-size photos.
4. Per-image guard:
   - No image worse than +8% on SSIMULACRA2 or 3-norm. Count only comparisons
     with full band coverage.
   - Required bands: SSIMULACRA2 60 to 90 and Butteraugli 3-norm distance
     0.5 to 3. Aaron confirmed the 3-norm band on 2026-10-12.
   - Butteraugli max is not gated per image. List the three worst max
     regressions and inspect them visually.
5. Thresholds are decision aids, not cliffs: a result within 0.05 points of a
   threshold passes.
6. The three held mode/frame assertions:
   - If each new output is no larger than the old one and decodes exactly,
     reclassify the assertion as a snapshot.
   - Report old and new bytes for each.
   - If any output is more than 1% larger, fix it as a regression on graphics.

## Work order to the end
1. Finish the current step. Do not start new cost-model or estimation repairs
   unless they are needed for gate 1.
2. Profile the median crop and the slow tail (worst crop 15.1 s). Close 3.47x
   to 3x.
3. Formally qualify both originals.
4. Promote:
   - holdout aggregate;
   - watch originals;
   - both independent decoders;
   - npm run check;
   - browser:check;
   - merge to main.
5. Run the effort-9 screen once, as LOSSY_EFFORT9_AMENDMENT.md describes.
6. Add distances 10 and 14 to the full lab for the final report only, to fix
   SSIMULACRA2 band coverage (currently 209 partial-range warnings).
7. Write the final report and stop. The report covers:
   - BD-rate against both peers;
   - speed on crops and on originals;
   - memory;
   - the remaining Butteraugli gap and the ideas that failed.

The post-promotion Butteraugli phase is cancelled. Further compression work
needs Aaron to reopen it.
