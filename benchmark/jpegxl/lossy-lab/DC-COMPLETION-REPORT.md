# Coupled DC completion trial

The approved single configuration is rejected. It fails the development main
SSIM mean and five of eight eligible per-image SSIM guards. No holdout run was
admitted. The research branch is not ready to merge; the public encoder is
unchanged by this round.

Aaron approved this trial on 2026-11-03, against research checkpoint `46be6bb6`.
It combines normative DC smoothing and libjxl's fixed weighted-predictor DC tree
with the archived nonlinear DC mode. AC precision 1.25, selected-block
quantization, transform selection, DC rounding and display filters stay fixed.
There is one configuration, no sweep, no peer maps and no holdout tuning.

The new named port takes `MakeFixedTree` and the `kWPFixedDC` cutoffs from libjxl
v0.12.0 `a7a9c787341cf703dede03c2009fa460cae5e5df`. It preserves size pruning and
bit-depth scaling. The VarDCT caller uses the total DC sample count and bitdepth
8, as in `enc_modular.cc`. Existing first-party weighted prediction and ANS
share the tree over DC groups; metadata and alpha retain local trees.

This adapter writes a separate histogram for every leaf. It does **not** port
native entropy clustering. The distinction matters to the measured regression.
The licensed module and private writer changes are preserved in
[the experiment patch](DC-COMPLETION-EXPERIMENT.patch), outside active source.

Full development results, 64 photos and 576 native-valid outputs:

| Reference | SSIMULACRA2 BD-rate | Butteraugli 3-norm | Butteraugli max |
| --- | ---: | ---: | ---: |
| wasm-vips 0.0.19, effort 7 | +5.077% | +1.686% | -0.599% |
| jSquash, effort 7 | +4.019% | +6.409% | +8.169% |
| Main | +6.487% | -4.948% | -4.972% |
| Regularized research control | +15.666% | +7.188% | +5.854% |
| Frozen selected-block AC 1.25 | +14.461% | +8.849% | +7.869% |
| Archived nonlinear DC | +11.468% | +7.812% | +6.170% |

Mean against vips is +2.054857%. Main's SSIM mean fails, and five of eight
full-band SSIM comparisons fail the +8.05% guard. The worst eligible result is
+13.634556%. There are zero full-band 3-norm comparisons; this is missing band
coverage, not evidence of per-image 3-norm success. All thresholds are unchanged.

The 80-output screen also regressed against AC 1.25:
+16.640/+8.751/+7.977%. The full run used the same frozen code to resolve guard
coverage and characterize the failure. It was not promotion admission.

The read-only bitstream audit separates the causes:

- All 80 HF-global/AC sections, fourteen other decision fields, nominal DC
  quantization values and raw DC integer planes match the nonlinear mode.
  The smoothing flag is the only reconstruction change.
- Total screen size rises from 2,849,166 to 2,910,351 bytes, or +2.147470%.
  Complete LF-global plus local DC header cost adds 246,959 bits. DC residual
  coding adds 243,187 bits. Metadata/alignment changes by -26 bits. The remaining
  whole-file difference is container/section overhead. Global model cost is
  included in this own-before/after comparison.
- At the same distance, smoothing lowers SSIM in 73/80 cases, worsens 3-norm in
  78/80 and worsens max in 49/80. Mean changes are -0.827679 SSIM points,
  +1.125621% 3-norm and +0.890561% max. These are paired quality changes, not
  BD-rates. Smaller entropy overhead cannot repair these pixel-quality losses.
- In nine saved native development streams, the same 34 reachable DC leaves
  map to 5-11 DC histograms. This adapter uses 34. Native global histogram counts
  also include metadata, so its entire LF section cannot be charged to DC alone.
  Native and the candidate both signal smoothing and shared weighted DC trees.

Isolated effort-7 timing uses fifteen alternating pairs after two warmups per
image, with no competing benchmark process. Candidate output hashes match the
native-valid screen:

| Profiling crop | Paired time/control | Ratio MAD | Faster pairs | Candidate median | Managed peak |
| --- | ---: | ---: | ---: | ---: | ---: |
| im26-3012 | 0.986429x | 0.039028 | 10/15 | 851.352 ms | 5,825,661 B |
| im26-3312 | 0.932667x | 0.033274 | 14/15 | 823.708 ms | 5,823,613 B |

The texture timing gain is clearer than the photo result, but neither admits a
speed-only change with this quality loss. Managed peaks increase by 143,394 and
145,442 bytes. Full-lab managed peak is 9,565,721 bytes. No absolute crop/original
qualification, cold/warm RSS qualification or full promotion checks follow a
failed quality entry. Parallel lab timing is excluded.

The three worst development max regressions against main were inspected as
native-decoded nearby-byte pairs: im26-3000 +26.860%, im26-3004 +12.797% and
im26-1634 +9.870%. Candidate/main distances were 1.3/1.85, 0.65/0.9 and 3/3;
byte ratios were 1.0034, 0.9710 and 0.9701. The dark texture and vessel show
subtle grain and tonal differences. The blurred sign/wood shows block-like
tonal texture. These views do not locate or excuse the metric peaks.

Validation includes eighteen repeatable native-valid thin, odd and DC-group
boundary fixtures; two transparent fixtures with exact native-decoded alpha;
three independently pinned unchanged-control hashes; rounding, chroma and
predictor-reset cases; six tree-size cases; eight invalid tree inputs; four
bit-depth cases; and exact emitted-tree, smoothing and DC-integer checks.
Strict experimental TypeScript passes. Six source/license files match the
pinned archive. Thirteen prototype hashes stay frozen through quality runs.
The experiment patch reconstructs twelve files exactly; the
[audit patch](DC-COMPLETION-AUDIT.patch) reconstructs seven scripts exactly.
Fresh `VITEST_MAX_WORKERS=4 npm run check` passes 340 test files and 4,229 tests,
with one file and three tests skipped, including the browser build checks.
The final integrity audit also confirms all twelve previous prototype module
hashes are unchanged. No frozen control or failed-trial artifact was overwritten.

There is one completed configuration, zero retained changes and zero promotions.
No active source, test, package metadata or lab TypeScript changes were made.
Bundles remain 614,969/687,801 bytes with no runtime dependencies. The last
AC 1.25 holdout still has two failing SSIM guards, worst +10.568972%; this trial
does not retest or resolve them. Peer-decision forcing hooks still require
removal from the public bundle path before any merge.

The next hypotheses, ranked by relevance to the unresolved quality guard:

1. Audit selected-transform low-frequency reconstruction against native
   equations. Smoothing alone now has measured negative evidence; its precise
   interaction with our DC source and transform scaling remains unmeasured.
2. Cluster fixed DC contexts with our existing entropy machinery. Native's
   5-11 histograms support a rate-cost investigation, but its gain is unmeasured
   and cannot undo the observed smoothing pixel losses.
3. Compare native DC source formation and preconditioning with our nonlinear
   inputs. Predictor structure agrees; source-plane equality is not established.

The one-configuration approval is exhausted. A new quality configuration needs
an owner decision under the unchanged plateau rule. The detailed results and
receipts are in [the JSON report](DC-COMPLETION-REPORT.json); raw artifacts are
under `.tmp/jpegxl-lossy-lab/dc-completion-20261103/`.
