# Cheaper SSIM feature diagnostic

The full-scale rolling-box loss is retained as a development helper. It costs
50-57% less than the cosine-window surrogate on two fixed 512px scoring workloads.
It detects every material direction in the mixed rounding screen and additional
DC-restoration validation. It is not integrated into the encoder or qualified
as a generally safe selector. Actual DC-mode comparisons contain no material
SSIM harms, so their protection gate remains unqualified.

Research base `aca2c2fc`, branch `jxl-libjxl-ports`, 2026-11-15. No new JPEG XL
encode, quality configuration, peer map, holdout access or promotion occurs.
The saved 800 screen, 96 rounding and 1,440 additional-development states supply
2,080 paired changes. Many share images, modes and restorations; these are not
2,080 independent observations. Native original-orientation metrics and every
encoder gate stay unchanged.

## What makes texture predictions wrong

The completed [display audit](DISPLAY-LOSS-REPORT.md) already tested actual
native display bytes, correct linear-RGB-before-XYB downsampling, scale order,
blur support, border handling and moment precision. None made tiny filter
interventions reliably predictable on the flat texture. Identical geometry
changes to both inputs frequently reversed native SSIM signs. The later
[reconstruction audit](LOCAL-MODEL-REPORT.md) separately established that libjxl's
ordered output dither explained nearly all the ordinary-rounding pixel mismatch.
The current diagnostic uses saved, native-scored PNG bytes; approximate encoder
reconstruction is absent from the new loss comparison.

Two wrong-sign predictions remain in the full display surrogate's DC screen.
Replay both with the pinned, unmodified native SSIM executable and five exact
RGBA permutations: identity, horizontal flip, vertical flip, 180-degree rotation
and transpose. Identity scores reproduce the saved labels exactly.

| Saved intervention | Native SSIM change, original | Across five orientations | Surrogate change variation |
| --- | ---: | --- | ---: |
| im26-3312/d0.5, aligned X DC restoration | -0.222761 points | -0.222761 to +0.457719 | less than 2.4e-12 |
| im26-2002/d0.5, aligned Y DC restoration | -0.130449 points | -0.130449 to +0.119658 | less than 1.2e-12 |

This reproduces sign instability even above the old tiny filter-change range.
A stable symmetric surrogate cannot reproduce all these native signs at once.
Source inspection shows float moment subtraction and a recursive Gaussian in
the native metric. Those are plausible numerical causes; this replay does not
isolate either implementation detail. It demonstrates native-label sensitivity,
not a reconstruction, PNG-rewrite or scale-order bug in this comparison.
No transformed-score average replaces the authoritative native score or excuses
an encoder regression. The first valid probe and its typed replay are both saved,
for forty native metric calls in total.

## Fixed loss models

Declare all six formulas before predictions. Reuse normalized X, Y, B-Y,
corrected SSIM, added-edge/lost-detail features and exact native mean/L4 weights.
Downsample linear RGB before color conversion at every physical scale. Use
Float64 moments and zero borders. The reference is the existing nine-tap cosine
surrogate; the alternative uses a uniform 5x5 box, whose variance is two, close
to sigma-1.5 Gaussian variance 2.25. Sliding horizontal and vertical sums remove
repeated weighted convolution. There is no fitted weight or threshold.

Suffix six retains physical scales 0-5; five retains 1-5; three retains 1-3.
The reductions preserve the original weight indices. No native score polynomial
is needed for directional comparisons. The retained helper accepts 8-512px
opaque displayed-image planes and computes all six available scales. It remains
an approximation, not native SSIMULACRA2.

The diagnostic gate requires at least ten native changes above 0.1 SSIM points,
both directions, at least 80% sign accuracy, and zero missed harms above 0.25
points, separately per cohort. These offline thresholds are not encoder quality
gates. Initial actual DC changes all improve materially: even an always-improve
rule gets 67/67. Record that failed two-direction gate; do not treat it as proof
of protection. Add a separately declared fixed cohort containing every saved
low/guarded rounding comparison on the same sixteen photos at distances two and
four. This supplies mixed directions without changing formulas or thresholds.
It is not independent-photo validation or a retroactive pass for actual DC.

| Fixed model | Actual DC screen | DC restorations | Mixed actual rounding |
| --- | --- | --- | --- |
| cosine6 | 67/67, no harmful labels | 450/452; 0/12 misses | 38/38; 0/3 misses |
| cosine5 | 67/67, no harmful labels | 450/452; 0/12 misses | 34/38; 2/3 misses |
| cosine3 | 67/67, no harmful labels | 449/452; 0/12 misses | 34/38; 2/3 misses |
| box6 | 67/67, no harmful labels | 450/452; 0/12 misses | 38/38; 0/3 misses |
| box5 | 67/67, no harmful labels | 450/452; 0/12 misses | 34/38; 2/3 misses |
| box3 | 67/67, no harmful labels | 449/452; 0/12 misses | 34/38; 2/3 misses |

Restoration screen: 432 helpful and twenty harmful material changes, twelve
harms above 0.25 points. Always-improve gets 432/452; full cosine and full box
get 450/452, with zero larger harm misses. Both remaining wrong signs are the
orientation-sensitive cases above. Rounding: 33 helpful, five harmful material
changes, three larger harms. Full cosine and full box get 38/38. Omitting fine
scale zero misses two of the three larger harms, despite 89.5% overall accuracy.
Reject all four scale-reduced models. This is evidence to preserve fine detail,
not a reason for another arbitrary weight sweep.

## Additional development photos

Test the unchanged full box on all 48 development photos outside the screen at
existing distances 0.9/1.85/3.8. All 1,440 saved states complete, with 1,294 distinct
pixel evaluations. No new reconstruction or native score is needed.

| Cohort | Correct/material directions | Helpful/harmful | Missed harms above 0.25 points | Decision |
| --- | --- | --- | --- | --- |
| Actual modes, 144 pairs | 129/129 | 129/0 | 0/0 | Inconclusive harm-protection gate |
| DC restorations, 1,152 pairs | 801/801 | 787/14 | 0/8 | Pass mixed restoration validation |

The restoration set tests fourteen material harms on additional photos and
passes. Source-DC restorations have no measured encoded rate and do not form a
standalone quality policy. The actual-mode set remains one class; it does not establish encoded
proposal safety. These additional photos are separate from screening, and have
been used elsewhere in this development campaign. No holdout label is read.

## Isolated cost and memory

The reference profile attributes 3,443 of 4,597 samples to scaleLoss, followed
by 444 color-conversion samples. Five warmup pairs precede 21 alternating pairs
on saved im26-3012 and im26-3312 d0.5 aligned actual reconstructions. Loss calls
include linear-RGB conversion of both loaded RGBA inputs. PNG loading and decode
are outside both timers. No profiling, tests or other measurement job overlaps.
Each mode's returned scalar stays exact across repetitions.

| Input | Cosine median ms | Box median ms | Paired ratio | Ratio MAD | Faster pairs |
| --- | ---: | ---: | ---: | ---: | ---: |
| Painting | 246.233 | 121.316 | 0.496772 | 0.017437 | 21/21 |
| Texture | 250.478 | 108.352 | 0.426149 | 0.010612 | 21/21 |

Candidate CV is 0.0959/0.2041; retain every sample, including GC outliers.
These are scoring-kernel improvements. Whole-image loss still costs over 100ms,
so this does not establish an affordable per-candidate selector or an encoder
speedup. Local support, score reuse, candidate scheduling and complete encoded
rate remain future work.

Three fresh processes per path/input/cold-or-warm state give 24 memory samples.
Warm cases score three times, force two collections before the measured baseline,
then score once and collect twice again. Peak RSS includes imports, PNG loading
and warmup. External and ArrayBuffer samples remain in the JSON.

| Input/state | Cosine peak RSS bytes | Box peak RSS bytes | Ratio |
| --- | ---: | ---: | ---: |
| Painting cold | 120,483,840 | 122,294,272 | 1.015026 |
| Painting warm | 178,556,928 | 152,604,672 | 0.854656 |
| Texture cold | 120,270,848 | 122,507,264 | 1.018595 |
| Texture warm | 173,944,832 | 152,244,224 | 0.875244 |

All median RSS comparisons pass the 5% regression limit. Released ArrayBuffers
return to 2,634,385 bytes for painting and 2,450,552 for texture on both paths.
This is a bounded 512px diagnostic process, not original-image encoder memory
qualification or a claim that the helper supports arbitrary full-size images.

## Retained code and verification

Retain only `libjxl-ssim-protection-port.ts` with its full-scale box loss and
focused tests. Restore the old display helper exactly; its temporary scale
omission parameter and all six experimental switches live in the reproducible
archive. The rolling box kernel is byte-identical with its measured version.
After API cleanup, one frozen state from each of the 64 photos reproduces its
saved scalar exactly. All original screen module hashes match the archived
experimental source. Initial verification passes 26 focused cases; the narrow
retained source passes twenty, including the direct 2D box oracle, odd borders,
identity, distortion and invalid extents. Strict public and private TypeScript,
retained-module lint and diff checks pass. Full repository check exits zero with no signal:
4,236 tests pass, 3 existing skips; 342 files pass and 1 skips.
Test duration 540.86s, full command 584.876s. Static, package,
documentation, browser-build, type, lint and formatting checks pass. No
benchmark overlaps this check. The 32-file private archive reconstructs exactly.

Private harness corrections are preserved: parsing and inferred-type errors are
fixed before final strict checking; the PNG rewrite uses the typed PNG object.
The first successful orientation probe remains alongside its typed v2 replay.
The formatter ignores .tmp, so private formatting uses benchmark stdin paths.
The final parity rerun first refuses to replace its original receipt; the
corrected runner preserves it and writes a separate final receipt. No formulas,
source photos, labels or diagnostic thresholds are retuned.

## Encoder qualification remains unchanged

| Last full-development BD-rate | wasm-vips | jSquash |
| --- | ---: | ---: |
| SSIMULACRA2 | -10.184% | -12.333% |
| Butteraugli 3-norm | -4.810% | -1.230% |
| Butteraugli max | -4.548% | +3.116% |

Carry forward the previous qualification: crops 2.387946x jSquash; 13MP 39.546s,
1.512916x; 21MP 68.866s, with jSquash aborting. Managed original peaks are
59,210,879/91,262,401 bytes against 137,514,476. Existing root/specialized bundles
are 614,969/687,801 bytes, with zero runtime dependencies. No fresh encoder
quality, speed or memory measurement is inferred from this helper.

The last frozen holdout has two SSIM guard failures, worst +11.202599% versus
+8.05%. Public peer-forcing cleanup, complete qualification and all unchanged
promotion gates remain. No main merge, release or public encoder change.

Next hypotheses: obtain useful bounded SSIM updates with global mean/L4 pooling;
combine SSIM protection with the already validated directional Butteraugli model
only after local cost and singleton/repeated scheduling are measured; then test
joint coefficient/rate decisions under the ordinary development gates.

## Reproduction

Raw root: `.tmp/jpegxl-lossy-lab/ssim-protection-20261115`.
The [JSON report](SSIM-PROTECTION-REPORT.json) preserves plans, predictions,
wrong-sign cases, all timing and memory samples and verification receipts.
The [archive](SSIM-PROTECTION-EXPERIMENT.patch) restores the private runners,
strict config, attributed six-model experiment and original measured scripts.
Use the existing saved development datasets and a fresh output tree. Runners
refuse to overwrite point/start receipts. The archive application itself requires
a clean tree for those private paths. For a rerun in this checkout, copy its
code/config to a fresh sibling and replace the recorded output-root literal.

```sh
git apply benchmark/jpegxl/lossy-lab/SSIM-PROTECTION-EXPERIMENT.patch
node .tmp/jpegxl-lossy-lab/ssim-protection-20261115/run.ts 0
# Repeat shards 1, 2 and 3, then summarize.ts.
node .tmp/jpegxl-lossy-lab/ssim-protection-20261115/rounding.ts 0
# Repeat shard 1, then rounding-summary.ts.
node .tmp/jpegxl-lossy-lab/ssim-protection-20261115/validation.ts 0
# Repeat shards 1, 2 and 3, then validation-summary.ts.
```

The archive also contains speed.ts, memory.ts, sensitivity.ts and final scalar
verification. Timing and memory require an idle measurement interval. Native
scores retain their original binary and PNG identities. Existing BSD-3 notices
remain included in the npm package and docs site.
