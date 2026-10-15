# Coarse allocation and the development guard

The frozen candidate is `standalone-guard-coarse`, based on the verified selector
checkpoint `f515bead`. It combines exact mask traversal and source-block copying
with the coarse allocation envelope from the completed development lab. Main
stays unchanged. Decisions use pixels and distance without peer maps.

The envelope keeps AC precision unchanged through distance 1.5, then increases
it linearly to 1.1 at distance 3. Physical DC steps, global scale, filters, CfL,
high-frequency modulation and coefficient writing retain the control policy.
Fine-distance encoded streams are exact. Four focused test files pass 96 cases,
including DC/global-scale inheritance and fine-distance parity across tile edges.

The earlier average-based selection rejected this envelope as neutral. Its
full-lab delta against retained is +0.223/-0.345/+0.135%, mean +0.004%, in
SSIMULACRA2/Butteraugli 3-norm/max order. Against vips it is
-8.003/-5.030/-5.582%; jSquash -8.474/+0.227/+2.571%.

The admitted per-image guards show another tradeoff:

| Allocation | Worst admitted development SSIM | Grain | Texture |
| --- | --- | --- | --- |
| Retained | +7.677% | +6.756% | +7.677% |
| Constant 1.025 | +7.325% | +7.280% | +7.325% |
| Constant 1.05 | +7.741% | +7.741% | +7.187% |
| Coarse envelope | +7.192% | +7.032% | +7.192% |

Each row admits eight SSIM comparisons and zero full-band 3-norm comparisons.
The coarse envelope gives the best worst-guard value among the three full
allocation trials. This is a development-only reason to reconsider it as one
frozen promotion candidate after the selector speed improvement. It does not
establish that the two prior holdout failures are repaired.

The next checks measure incremental cost, verify every development stream
against the completed coarse trial, and apply the speed and original entry
gates. Only then will the frozen holdout be read through aggregate metrics and
guard counts. No per-image holdout inspection or tuning is allowed.

Raw artifacts: `.tmp/jpegxl-lossy-lab/standalone-guard-allocation-20261015/`.

## Entry results

The composed mode reproduces all 576 earlier coarse-envelope streams exactly.
Native validation and all scores pass, and independent jxl-rs qualification
transfers from those streams. Chromium, Firefox and WebKit pass the composed
mode. The full development means and eight admitted guard results stay as above.

Twenty-one isolated alternating pairs against the exact selector give a paired
median change of -2.956%, MAD 4.422 points, 15/21 faster. Absolute medians are
1096.931/1064.129ms. The changed stream increases the managed peak by 2,048 bytes
on this crop, to 5,682,267 bytes.

Fresh isolated crop timing completes all 192 jobs with no failures, omissions
or reused timing. Own median is 1398.798ms, jSquash 503.606ms and vips 362.845ms,
for 2.777562x jSquash. Managed peak is 8,760,382 bytes; worker RSS 201,134,080 bytes.

| Original | Own | jSquash | vips | Own managed peak |
| --- | --- | --- | --- | --- |
| 13 MP | 46.094s | 25.739s | 9.561s | 59,139,199 bytes |
| 21 MP | 83.743s | Aborted | 14.233s | 91,010,461 bytes |

The 13 MP ratio is 1.790821x jSquash. The 21 MP peer abort supplies no ratio; our
encode finishes, validates natively and completes all scores. Both originals
decode independently in jxl-rs within one code value. Encoder RSS is 507,293,696
bytes on 21 MP; full-worker RSS including validation/scoring is 755,236,864 bytes.
All measured managed peaks stay below the unchanged 137,514,476-byte ceiling.

The entry evaluator passes before starting one 63-photo frozen holdout run.
Only its aggregate metrics and guard counts will be used. The source and tests
are preserved in [GUARD-ALLOCATION-EXPERIMENT.patch](GUARD-ALLOCATION-EXPERIMENT.patch)
for `f515bead`, and the patch is checked to apply to that base.

## Frozen holdout result

All 63 photos and 567 outputs finish, with zero execution failures or omitted
encode jobs. The 281 coverage warnings describe incomplete required-range
intersections. They do not describe missing encodes. All 567 outputs decode in
jxl-rs within one code value of native libjxl. Holdout inspection is restricted
to aggregates; no image identifiers or individual results are inspected.

Mean BD-rate percentages, in SSIMULACRA2 / Butteraugli 3-norm / max order:

| Reference | SSIMULACRA2 | 3-norm | Max |
| --- | --- | --- | --- |
| wasm-vips | -5.996 | -3.605 | -2.909 |
| jSquash | -6.492 | +1.640 | +2.704 |
| Main control | -5.417 | -8.199 | -8.046 |

The mean of the three vips BD-rates is -4.170%, meeting the +2% objective, and
all three means meet the +5% cap. The previous frozen result averages -3.915%,
so this attempt improves that aggregate by 0.255 percentage points. Main-control
mean gates pass too.

Nine comparisons admit the full SSIM 60-90 band. Two still exceed the +8.05%
guard limit, with the worst at +11.617%. No 3-norm comparison admits its full
0.5-3 band. The two SSIM failures block promotion. No parameter is changed after
this result; full-watch and scale qualification are not started.

## Execution bookkeeping correction

The first aggregate checker treated every summary omission as an unfinished job.
The runner adds partial-range BD-rate warnings to that summary after saving its
final execution ledger. The checker now uses `execution-status.ts` to assess
actual completed jobs, failures and omissions from the progress ledger, while
retaining coverage warnings separately. Ten regression tests cover partial
coverage, unfinished jobs, failures, budget omissions and malformed counters.
The metric values and failed-guard verdict stay unchanged.

The first comparison command also ran before summary creation and stopped
without producing a comparison. Its error log is preserved; comparison succeeds
after the holdout process exits. The source parameters remain frozen throughout.

The candidate remains an explicit research mode. The exact selector checkpoint
is retained, production defaults stay unchanged, and both candidate source and
its qualification evidence remain reviewable on the research branch. The next
useful development question is selector error including DC and filtering;
further global AC sweeps have shown little mean improvement.

## Final verification and status

`VITEST_MAX_WORKERS=4 npm run check` passes 4,147 tests with three existing skips,
327 passed files and one skipped file. Test duration is 578.70s. All static,
package, docs, type, browser-build, lint and format gates pass. Real Chromium,
Firefox and WebKit coverage passes. Bundles stay 614,941/687,773 bytes under
unchanged ceilings, with zero runtime dependencies.

The full pinned libjxl LICENSE is present in THIRD_PARTY_NOTICES, the npm file
list includes it, and the docs page renders the same full notice. Provenance
records the first-party allocation and the separately attributed source ports.

The candidate remains on the research branch. No src file, production default,
main branch or release version changes in this continuation. Inherited peer
forcing hooks still require removal or isolation before any future main merge.
The primary mean objective passes; the two hard SSIM guards remain the blocker.

Remaining development ideas, in order of likely usefulness:

1. Include DC reconstruction and decoder filtering in selector loss. This has the
   largest plausible quality upside, but its cost must be measured.
2. Cache writer activity for an accurate luma-rounding estimate. Earlier actual
   rounding repaired development guards but cost too much time.
3. Profile transient scratch views and remove avoidable allocations for more
   exact speed headroom.

None of these hypotheses is tested in this frozen attempt. The holdout result
will not be used to select parameters or inspect failing images.
