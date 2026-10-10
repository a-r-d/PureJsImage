# JPEG XL tool costs and E4 proposals

The 14 E3 screens identify complete candidate searches as the largest speed costs. Estimated order/family selection and palette early-cost rejection pass their full-64 component guards and are retained. Together they reduce summed crop encode time 61.11% versus E2, with all mean BD-rate costs below 0.04%. Palette precheck preserves all 576 selected files versus retained E4. These are concurrent curve timings; formal isolated speed confirmation remains separate. RGB alternate removal saves 22.51% summed time, but its SSIM BD-rate rises **0.2022761603%**, strictly above the 0.2% speed-only rule, so that removal is not retained.

These are one-tool-off comparisons against E2 on 16 development photos at 512 square and distances 0.5, 1, 2, 4 and 7, except row 11 now shows its full 64-photo, nine-setting confirmation. No combined removal, holdout result or promotion is implied. Existing effort 7 remains the target; no new public tier is proposed.

## Measured contributions

BD columns are **OFF versus E2**. Positive means disabling the tool makes files larger at matched measured quality. BA3 means Butteraugli 3-norm. Time columns are **savings from disabling**: positive is faster, negative is slower. Crop time is summed over 80 encodes with four concurrent workers, except row 11's full-lab sum covers 576 encodes. Its 2080 timings remain the separate screen-stage isolated measurements. The 2080 times use one isolated worker on `im26-1626`, with separate distance-2 and distance-7 results. Row 04 D7 and row 05's additional D1 use separate matched cold pairs; the other D7 timings are warm after D2.

`I` marks an inactive control. Its numerical timing difference cannot be assigned to that tool. Cone and luma have inactive crop quality measurements. Missing timings are distinct from partial quality-band coverage.

| Tool disabled | Mean BD %: SSIM / BA3 / max | Worst image BD %: SSIM / BA3 / max | Crop time saved % (4 workers) | 2080 D2 saved % | 2080 D7 saved % | Current decision |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| 01 Cone frame | I: 0 / 0 / 0 | I: 0 / 0 / 0 | I: 10.34 | 50.95 | I: 1.30 | Removal nominee pending large quality |
| 02 DCT16 menu | +0.315 / +0.216 / +1.834 | +2.277 / +2.657 / +20.994 | 13.88 | 5.60 | 8.23 | Protect affected images; keep pending broader evidence |
| 03 COUNT large | +1.991 / +2.708 / -0.959 | +11.275 / +14.240 / +8.440 | 14.28 | 27.48 | I: 1.61 | Mixed metrics; blanket removal unsafe |
| 04 Conditional large | +1.165 / +0.827 / +0.514 | +7.030 / +6.280 / +5.181 | 10.79 | I: -5.07, completed before timeout | 22.24 (cold pair) | Protect affected images; test cheaper selection |
| 05 Fine allocation | +0.041 / +0.143 / +0.106 | +0.331 / +1.071 / +1.866 | 8.18 | I: -1.85 | I: -1.04 | Active D1 saves 4.58% (cold); quality confirmation needed |
| 06 Local contrast | +1.210 / +1.054 / +3.567 | +17.299 / +7.169 / +25.326 | 5.22 | -3.64 | I: -3.07 | Retain precision protection; mixed per-image effects |
| 07 Finer SDR AC | +0.163 / +0.688 / +1.727 | +2.567 / +11.031 / +27.558 | -4.86 | -4.37 | I: -0.87 | Retain; removal hurts quality and measured speed |
| 08 Advanced Modular DC | +0.784 / +0.588 / +0.602 | +1.957 / +1.470 / +1.501 | 16.66 | 22.32 | 32.14 | Replace exhaustive search with cheaper choice |
| 09 Order/family search | +0.529 / +0.655 / +0.648 | +2.118 / +1.978 / +2.001 | 37.87 | 56.75 | 52.91 | OFF screen preserved; cheaper selection retained below |
| 10 Luma alternate | I: 0 / 0 / 0 | I: 0 / 0 / 0 | I: 8.44 | 41.22 | 38.40 | Removal nominee pending large quality |
| 11 RGB strategy alternate (full 64) | +0.2022761603 / +0.038963 / +0.044683 | +2.311 / +0.745 / +1.887 | 22.51 (576 encodes) | 49.88 | I: 0.84 | Strict 0.2% SSIM rule missed; improve or combine separately |
| 12 Sharpness map | +0.271 / +0.534 / -0.467 | +1.840 / +2.786 / +0.996 | 7.96 | -3.49 | -32.49 | Mixed metrics and timings; no blanket removal |
| 13 AC iteration search | +0.763 / +0.675 / +1.870 | +2.908 / +3.216 / +21.767 | 31.43 | 58.26 | 54.09 | Cheaper search needed; protects a difficult image |
| 14 Ordinary DC search | +0.845 / +1.089 / +1.090 | +4.993 / +6.636 / +6.553 | 15.40 | 3.34 | 5.25 | Retain protected slow-color photos; test cheaper DC |

The screen rows have 16 computable image comparisons on all three metrics. Required-band coverage is partial: SSIMULACRA2 60–90 covers 2/16 images, Butteraugli max 0.5–3 covers 3–5/16 depending on the tool, and 3-norm uses all 16 measured common intervals. Row 11 has 64 computable comparisons per metric, with full-band counts 8/64 SSIM, 32/64 max and 64/64 3-norm. The calculations retain every computable comparison. These bands limit certification, while the common intervals remain useful for E4 exploration.

Cone only runs above 4 MP and at distances strictly between 1 and 4. Luma alternates require more than 65,536 blocks. Both are inactive on the 512 crops, so their crop timing differences are controls, not demonstrated tool savings. Fine allocation only runs at distance at most 1; its original D2/D7 scale points miss it, while the additional cold D1 pair exercises it. COUNT, local contrast, finer SDR AC and RGB alternate are inactive at D7. Conditional large is inactive at D2. The aggregate contains the full distance audit.

## Paying for retained tools

The cost of keeping a tool uses `100 * (E2 time / OFF time - 1)`. It is not the negative of the table's savings. A 50% OFF saving means keeping costs 100% more time. For the rate benefit, invert each image's ratio before averaging: `keeping BD = -100 * OFF BD / (100 + OFF BD)`.

Keeping advanced DC adds 20.00% crop time for mean rate benefits of 0.773% SSIM, 0.582% BA3 and 0.596% max. Keeping order/family adds 60.94% crop time for 0.522%, 0.648% and 0.641%. Keeping AC iteration adds 45.84% for 0.749%, 0.664% and 1.620%. Each misses the rule of at least 1% mean BD-rate benefit per 10% added time on every protected metric. Finer SDR AC has all three benefits with no observed added crop or active D2 time. Local contrast buys its 5.51% added crop time on all three means, but some images favor removal, including a 10.36% worst max-rate penalty for keeping it relative to OFF. Individual image regressions and confirmation gates remain separate from this cost calculation.

## Retained cheaper order/family selection

The replacement keeps the original candidate menu, ranks candidates by estimated header and token costs, and serializes one estimated alternative. Its existing strict actual-size floor rejects an alternative that is larger than the completed original candidate. This is a different experiment from turning the tool off in row 09.

| Full-64 estimated selection versus E2 | SSIM | BA3 | Max |
| --- | ---: | ---: | ---: |
| Mean BD-rate % | +0.037805 | +0.027535 | +0.019226 |
| Worst image BD-rate % | +0.560050 | +0.393561 | +0.382275 |
| Computed / full required-band images | 64 / 8 | 64 / 64 | 64 / 32 |

All 576 own points complete without failures. Four-worker summed encode time falls 23.619293% and median encode time falls 40.573483%; managed peak stays 43,172,160 bytes. The full run took about 29 minutes. These encode sums and medians come from concurrent curve workers, not a formal isolated speed test. The source replacement and sync/cooperative/public correctness tests are retained. The complete E1/E2 policy still fails baseline image guards; required quality-band coverage is partial and holdout/promotion remain open.

## Confirmation order

1. Keep the confirmed palette precheck and measure isolated speed and full-resolution behavior separately. Improve RGB candidate selection or measure a separate combination afterward. RGB removal's full-64 SSIM mean is +0.2022761603%, so it misses the 0.2% rule even though all worst-image deltas are below 3%. Do not round this into passing or assume combined gains add. Fine allocation remains a small-crop speed-only candidate. Its active cold D1 pair saves 4.58% time when disabled, but the single-point quality tradeoff still needs curve confirmation.
2. Keep the cheaper order/family selection component and confirm its isolated speed and large-image behavior. The estimated advanced DC screen (LL041) preserved all 80 sizes and scores, but summed time fell only 0.58% and median time 2.05%; it was reverted as neutral. The separate held `dc-advanced-baseline-reuse.patch` removes redundant baseline serialization without changing the ample-budget floor. Its effect remains unmeasured; do not assume savings add to the retained selection change.
3. Measure cone and luma quality on active large development images before deciding removal. Conditional-large removal saves 22.24% in the matched cold D7 pair, but its screen has protected-image regressions, so test cheaper selection before blanket removal. Ordinary DC saves only 3.34% at scale D2 and 5.25% at D7 when disabled, while removal has image regressions above 3% in each metric. This favors retaining its slow-color protection while cheaper DC selection is tested.
4. Keep precision and transform protection until an alternative preserves affected images. DCT16 removal raises max BD-rate 20.994% on `im26-3000`; local contrast removal raises it 25.326% there and SSIM rate 17.299% on `im26-3014`; finer SDR AC removal raises max rate 27.558% on `im26-2012`. COUNT and conditional large also have image regressions above the 3% promotion gate. AC iteration removal raises max rate 21.767% on `im26-3000`, so a cheaper replacement is preferable to assuming its mean cost settles the decision. Local contrast has per-image tradeoffs in both directions and still needs broader confirmation.

AC iteration off also disables luma alternatives on large images. The measured savings overlap. Tool effects cannot be added, and removing multiple searches can change which remaining candidate wins. A direct combined AC-off plus RGB-off trial is queued. The observed `im26-3000` quality regression is confined to D4, while RGB-off D4 is byte-identical to E2. That supports investigating an outer candidate switch; it does not prove which candidate caused the change or imply same-geometry entropy coding changes pixels.

## Retained palette early-cost rejection

The opaque-palette trial moves the existing color-cost estimate before lossless candidate encoding. It skips that encoding only when the existing threshold would reject the candidate. Accepted candidates, the threshold and true-alpha behavior stay unchanged.

Against retained E4, all 80 screen JXL files are byte-identical and all three BD-rate deltas are exactly zero. Four-worker summed encode time falls 50.463468% and median encode time falls 44.823210%. Managed peak falls from 39,564,056 to 10,225,348 bytes. All points complete without failures; required-band coverage remains 2/16 SSIM, 5/16 max and 16/16 3-norm.

Full-64 confirmation also passes: all 576 actual JXL files are byte-identical to E4, and all three BD-rate deltas are exactly zero. Four-worker summed encode time falls 49.079958% and median encode time falls 21.440083%; managed peak falls from 43,172,160 to 10,264,865 bytes. The guarded run took 14m40.184s, with 1.2GiB cgroup peak and no swap. It has no failures and 64 computable comparisons per metric; full-band coverage remains 8/64 SSIM, 32/64 max and 64/64 3-norm. The patch is permanently reapplied and formatted.

The cumulative retained changes versus E2 reduce summed encode time 61.106912% and median time 53.314578%. Mean BD-rate costs remain +0.037805% SSIM, +0.027535% 3-norm and +0.019226% max, the same as the retained order/family estimate. Screen and full-lab timings use four concurrent workers; they do not establish a formal isolated speed median. The palette admission remains at most 1,048,576 pixels, so no full-resolution speed gain is inferred. Overall E1/E2 baseline image guards and promotion remain open.

The matched cold `im26-2012` distance-1 point falls from 17,563.533ms to 1,553.913ms. Both runs produce the same 25,817-byte JXL file and identical scores: SSIM 90.36761362, max 1.018045187 and 3-norm 0.476653. Managed peak falls from 20,325,339 to 8,151,604 bytes, and process RSS from 256,933,888 to 186,216,448 bytes. This single-image observation does not establish the lab's isolated speed median.

CPU samples support the avoided-work explanation. Learned Modular tree time falls from 9.628s inclusive to 98.8ms, and its split-evaluation self time from 7.332s to 43.6ms. The full-frame Modular group-search path is absent from the after-profile; remaining tree samples come from DC coding. Order-cost estimation remains about 439–446ms. Profiles span the worker, including startup and development-tool waits, and inclusive times overlap; encoder wall time comes from the point receipts.

Evidence is `.tmp/jpegxl-lossy-lab/e4-palette-precheck-screen/{versus-e4,summary}.json`, `.tmp/jpegxl-lossy-lab/e4-palette-precheck-full/{summary,versus-e4,versus-e2}.json`, and the before/after point receipts and CPU summaries in `e4-slow-crop-profile/` and `e4-palette-precheck-profile/`. The guard receipt is `.tmp/jpegxl-m7/bounded-runs/e4-palette-precheck-full-20261009.json`. The aggregate retains the screen, full confirmation and cold point separately from the original tool-off rows.

## Evidence and unfinished measurements

Inputs are `.tmp/jpegxl-lossy-lab/e3-ablation-014/report.json` (01–04), `.tmp/jpegxl-lossy-lab/e3-ablation-015/report.json` (05–14), and each variant's `versus-e2.json`. All 14 screens and all completed scale pairs are included. The calculation is retained in `.tmp/jpegxl-lossy-lab/feedback-ablation-plan/tool-costs-aggregate.json` using the existing E4 helper. It includes mean, median, p90, worst, image IDs, coverage flags and time ratios.

Retained estimated order/family selection uses `.tmp/jpegxl-lossy-lab/e4-order-estimate-full/{versus-e2,summary}.json`. The aggregate preserves that full-64 result separately from the original tool-off screen, including all per-image comparisons, timing rows and component checks. It does not substitute the new timing for row 09's isolated OFF timings.

RGB-off full confirmation is `.tmp/jpegxl-lossy-lab/e3-rgb-off-full/versus-e2.json`, with its `summary.json`: 64 photos, nine global settings, 576 own encodes and zero failures. OFF means are +0.2022761603% SSIM, +0.0389627573% 3-norm and +0.0446832000% max. Worst-image values are +2.311011%, +0.744840% and +1.887044%. Four-worker summed encode time falls 22.50647% and median time falls 34.13915%; these are concurrent curve timings, not isolated timings. Managed peak is 43,172,160 bytes. The aggregate retains the original 16-image screen separately from this full confirmation, including exact unrounded values and the failed 0.2% mean-rule check. Required-band coverage remains partial.

The first 04 scale run stopped at the 900-second total limit. Its completed D2 took 768.448 seconds. D7 encoding and native PNG decoding completed, but the guard stopped during scoring, so no final scored/timed D7 result was retained. That failed report is preserved. Crop timing was recovered from its completed comparison rather than treated as missing. The driver repair now stores crop timing before scale measurement and gives the scale pair 1800 seconds.

The completed conditional D7 retry is retained under `.tmp/jpegxl-lossy-lab/e3-active-timings/{conditional-e2-d7,conditional-off-d7}/result.json`. Both isolated processes were cold. E2 took 150.034 seconds and OFF took 116.662 seconds, a 22.24% saving. Both produced 141,784 bytes with equal scores on all three metrics and no failures. This cold D7 pair is not averaged with the earlier inactive D2 timing, and its process state differs from the other rows' warm D7 measurements.

Fine allocation's matched cold D1 pair is retained under `.tmp/jpegxl-lossy-lab/e3-active-timings/{fine-e2-d1,fine-off-d1}/result.json`, with no failures. E2 took 268.924 seconds and OFF took 256.600 seconds, a 4.58% saving. OFF bytes rise from 873,077 to 885,520 (+1.425%). SSIM rises from 89.767775 to 89.943521 and max falls from 0.962010 to 0.929996, while 3-norm worsens from 0.398993 to 0.406070. This is a same-setting observation with mixed quality effects, not matched-quality BD-rate. The aggregate keeps both raw results and memory measurements, preserves the inactive D2/D7 controls, and computes no mixed D1/D2/D7 mean. No new measurements were run to prepare this document.

Promotion remains conditional on the full development lab, no image regression above 3% on any metric, holdout, watch originals, independent decoders, repository and browser checks, and bundle/memory ceilings. No tool removal is adopted here.
