# JPEG XL lossy lab

This folder measures the public JPEG XL lossy encoder against wasm-vips and
jSquash. `run.ts` encodes the frozen development or holdout crops with each
engine through `worker.ts`, scores them with SSIMULACRA2 and Butteraugli, and
writes BD-rates. `summarize-port.ts` compares one run against a saved reference
run, such as main, and reports the SSIM guards. The holdout split runs only with
Aaron's approval and is read as aggregates.

The libjxl research campaign also kept replay, transplant and port experiments
here, with a patch that rebuilt two encoder files under `.tmp`. Those scripts,
their tests, the 86 archived experiment patches and the 64 raw JSON reports were
removed before merging to main. The Markdown reports below and
`../lossy-lab-log.md` keep the results. On the `jxl-libjxl-ports` branch, the
code and patches are in commit `0d25cdd9` and the raw JSON reports in `055dc2c6`.

The [saved development rate and quality report](SAVED-FRONTIER-REPORT.md)
compares three saved standalone modes. Only 32 of 576 actual byte budgets
admit a replacement, and the worst development SSIM guard stays unchanged.
The [matched-byte trial](MATCHED-BUDGET-REPORT.md) completes the 24 frozen
development encodes of the aligned DC mode. Two streams fit their original
budgets and neither improves SSIM while preserving both Butteraugli scores.
The [rate-targeting follow-up](RATE-TARGET-REPORT.md) fits 21 of 24 fresh
development encodes within budget, with zero qualifying replacements.
The [selected-block byte-budget audit](BLOCK-BUDGET-REPORT.md) verifies
1,152 archived candidate streams and finds three qualifying replacements
of 576 budgets, all outside the development SSIM guard cohort.
The [whole-photo curve audit](FULL-CURVE-CHOICE-REPORT.md) finds headroom
when each photo keeps one mode across all nine settings. Hindsight
selection lowers the worst development SSIM guard from +7.579% to +4.844%.
The [source-only chooser test](SOURCE-CHOOSER-REPORT.md) finds no cutoff
that makes two safe writer switches on the 16 calibration photos.
The [second source-only signal](SOURCE-NOISE-CHOOSER-REPORT.md) also
fails calibration with a maximum of one safe switch.
The [writer scope report](WRITER-SCOPE-REPORT.md) records the selected-block
development screens and the rectangular transforms involved in local
peak-error regressions. The bounded display helper now covers those
transforms with exact numerical parity.

The [prepared source report](SELECTOR-SOURCE-REPORT.md) records three exact-output
selector trials. The retained development path skips 30% of selector source
reads and sample copies on two crops. Complete encode time is effectively
unchanged, and all measured fresh process memory comparisons pass. The historical
quality guards remain unresolved.

The [AC model state report](RATE-AC-STATE-REPORT.md) rejects two further exact-output
trials. Smaller histograms change streams at a fixed memory budget; shorter scans
have no convincing timing gain. An optimistic bound cannot prune the losing order
candidates. Fresh timing measures remaining overhead against an updated control;
it does not replace the earlier qualification against the frozen control.
No encoder change or new quality policy is retained, and the holdout stays closed.

The [scratch reduction report](RATE-SCRATCH-REPORT.md) records three trials.
Reusing clustering buffers and skipping unused payload tables cuts ordinary
writer scratch requests by about 30%, with exact output and neutral elapsed
time. The combination without DC caching passes the measured memory guard.
All 576 development streams, nine browser fixtures, 24 budget comparisons and
the full repository check pass. Quality failures still block merging.

The [rate ownership report](RATE-OWNERSHIP-REPORT.md) finishes the checked DC
cache's integration experiment. It owns bounded scratch, releases it correctly,
and reclaims optional state under memory pressure. Repeated rate probes are
faster, but warm process peaks rise about 7% even with the same writer executing
on both sides. The prototype stays archived. This changes no quality decisions
and does not repair the merge guards.

The [rate-state report](RATE-STATE-REPORT.md) records three exact-output
experiments. Reusing checked DC metadata lowers batch rate-estimation time
by 35–37%, but process memory rises in several cases and complete selector
cost remains unqualified. The prototype is archived; no new encoder policy
or production change is retained. Quality guards still block merging.

The [simple selector report](OBVIOUS-SELECTOR-REPORT.md) records two small
first-party speed changes after six focused trials. Twenty-one complete-encode
pairs improve the photo by 4.0% and texture by 2.2%, with unchanged output across
all 576 development points and no added managed storage. Quality is unchanged.
The research branch still needs its quality guards and public forcing cleanup
before merge.

The [source and control report](SOURCE-CONTROL-REPORT.md) records seven failed
quality policies and useful development observation callbacks. Reusing the
writer pass saves 6-8% versus recomputing source transforms. Guarded region
exchanges are too slow; same-transform moment proxies worsen native quality
and actual stream sizes. Retain only callbacks and their focused tests. The
work stays on `jxl-libjxl-ports`. Production code and main are unchanged;
holdout stays closed.
The earlier [bounded protection](BOUNDED-PROTECTION-REPORT.md),
[SSIM diagnostic](SSIM-PROTECTION-REPORT.md),
[filter-loss](FILTER-LOSS-REPORT.md) and
[sampled reconstruction](SAMPLED-AR-REPORT.md) reports preserve prior results.
Step C was approved after the allocation checkpoint below.

The 2026-10-14 allocation checkpoint is recorded in
[LOSSY_LIBJXL_REOPENING.md](../LOSSY_LIBJXL_REOPENING.md). It replaces the separate
component strategy and metric targets: mean BD-rate against vips at most +2%,
with every metric at most +5%. Existing speed, memory and remaining promotion
checks continue. A large coherent port requires a separate approval. The [allocation report](ALLOCATION-REPORT.md) records 4,288 valid encodes.
Its best full-lab mean was +2.704%, missing +2%; Step C awaited approval at that
checkpoint. The older checkpoints below retain their original gates and
measurements.

The [2026-10-13 owner decision](../LOSSY_LIBJXL_REOPENING.md) reopens source-informed
lossy work. Read it before the older decisions below. Decision transplants precede
source ports; the development option is rejected by the public codec. Current
results are in [TRANSPLANT-REPORT.md](TRANSPLANT-REPORT.md). The earlier production
campaign and its preserved reports remain unchanged.

Step 1 is complete. All nine development rows pass emitted-map checks and native
decoding on all 80 screen and 576 lab points. The all-maps row measures +3.39%
SSIMULACRA2, +1.64% Butteraugli 3-norm and -0.20% Butteraugli max against vips.
It takes 1,027ms at distance 2, or 2.10x jSquash. Transform and filter prototypes
exceed the 3x crop target. The complete
table, texture comparisons, timing scope and first-port ranking are in the report.
The remaining gap includes unsignaled preconditioning as well as rounding and
entropy coding. Holdout and original qualification remain closed until a port
clears the normal development gates.

The first Step 2 screen stopped under the owner's three-component rule. Ten source-port
variants and one writer control complete 880 screen encodes with no execution
failures. Transform selection, inverse Gaborish and DC precision yield no
promotable gain. Their quality tradeoffs, diagnostic encode times and source
adaptations are in [PORT-REPORT.md](PORT-REPORT.md). The licensed TypeScript
experiments stay on `jxl-libjxl-ports`; no new heuristic enters the public encoder.

Aaron reopened the investigation after that report. The
[coupled decision report](COUPLED-REPORT.md) tests AC quantization, transforms,
chroma, filters and DC together. Matching DC removes a large rate mismatch:
the 64-photo replay is +3.323% SSIM, +1.581% 3-norm and +0.475% max against vips.
SSIM failed the then-current promotion gate. The earlier single-component results remain
preserved and do not establish that the coupled pipeline is ineffective.

Follow [the promotion-entry decision](../LOSSY_PROMOTION_ENTRY.md),
[the steering plan](../LOSSY_STEERING.md),
[checkpoint feedback](../LOSSY_FEEDBACK.md),
[promotion guidance](../LOSSY_PROMOTION_GUIDANCE.md) and the
[effort-9 amendment](../LOSSY_EFFORT9_AMENDMENT.md).
The promotion-entry decision supersedes conflicting earlier rules.
The unchanged main baseline is `dca2f211`; its development and isolated
speed results are in [BASELINE.md](BASELINE.md). The current candidate is
preserved on `jxl-lossy-candidate`. Main requires all promotion checks.
Current measurements and remaining checks are in
[lossy-lab-log.md](../lossy-lab-log.md) and [EVIDENCE.md](EVIDENCE.md).

Source `dd98eb91` adds inline large-plane quantization and reconstruction
to seven earlier exact speed gains. All 576 development files, score
triples and encode receipts match the preceding candidate. The new
64-crop paired median improves 2.40464%, with 45 of 64 pairs faster and
no per-image managed-memory increase. Fresh isolated speed is 3.04611x
jSquash, within the owner's 3.05x tolerance, and 4.32943x wasm-vips.

| Full development mean BD-rate | jSquash 1.3.0 reference | wasm-vips 0.0.19 target | Same-ladder main delta |
| --- | ---: | ---: | ---: |
| SSIMULACRA2 | -2.99808% | -0.64662% | -3.46048% |
| Butteraugli 3-norm | +11.59510% | +8.25703% | -3.39081% |
| Butteraugli max | +14.49454% | +6.22865% | +2.15426% |

All three development main aggregate gates pass. The per-image guard admits four
full-band SSIM comparisons and zero full-band 3-norm comparisons, with
no admitted failures. Zero 3-norm admissions do not establish full-band
coverage. There are 337 partial-band peer warnings on the current ladder.

The first holdout measurement completes all 63 photos with zero failures.
All 567 own score triples and pre-scoring encode receipts are verified.
Only aggregate results are inspected; no tuning follows.

| Holdout mean BD-rate | jSquash 1.3.0 reference | wasm-vips 0.0.19 target |
| --- | ---: | ---: |
| SSIMULACRA2 | -1.37257% | +0.38983% |
| Butteraugli 3-norm | +10.39642% | +7.46534% |
| Butteraugli max | +13.45813% | +7.55369% |

The holdout ladder has 329 partial-band peer warnings and no full-band
3-norm comparisons. These aggregates do not establish full-band parity.
The complete same-ladder holdout comparison with unchanged main improves
mean BD-rate by 3.37961% on SSIM, 5.43628% on 3-norm and 0.79824% on max.
All 567 baseline points and both sides' streams and encode receipts verify.
The full-band main guard admits eight SSIM pairs and zero 3-norm pairs,
with no admitted failures. Scale qualification passes all 20 own points
on two 2080-square crops and the 13 MP / 21 MP originals. The largest
managed peak is 136,508,774 bytes, below the unchanged original ceiling.
The full ten-original watch run finishes on source dd98eb91. All ten own
curves and 90/90 own scored points complete with zero own execution failures.
All nine settings on the pinned 12 MP im26-2012 image exceed the unchanged
137,514,476-byte managed ceiling, peaking at 174,544,064 bytes. Its measured
RGB projection and context-lifetime repair preserves the original stream and
reduces the actual peak to 131,737,889 bytes. Candidate source d39e42a3 applies
that repair; fresh production corpus, speed, browser and decoder qualification
remain pending. Original watch failures and receipts stay preserved. Fresh
reference recovery remains pending after the continuation's coverage-warning
classification failure. The audit proves zero input omissions and preserves
all 25 partial-band warnings.
Main stays unchanged until those requirements pass.
Peer targets are report-only under the promotion-entry decision.

Fresh 13 MP and 21 MP encodes complete in 59.332s and 80.775s. The 13 MP
ratio is 2.32767x jSquash. Managed peaks are 82,507,265 and 135,364,894
bytes, below the preserved 137,514,476-byte original ceiling. jSquash
aborts on the 21 MP image, so its ratio there is unmeasured. Both missing
21 MP score triples complete from saved files with an 8 GiB process cap;
the initial 6 GiB scoring timeouts and encode receipts remain recorded.
The original memory gate and formal encode times are unchanged.

Both independent decoders pass all 50 cases, including complete grids on
both scale crops and both largest originals. Chromium, Firefox and WebKit
pass all 48 focused cases on dd98eb91. Its fresh `npm run check` passes 3,995 tests, with three
skips and no failures, including `browser:check`. Remaining promotion
checks include watch memory repair, full watch curves, isolated original
speed and a fresh repository check. Bundles measure
610,916 and 683,735 bytes on the repaired candidate; ceilings stay 615,000
and 685,000 bytes. The first two production checks stop on stale generated
package metrics, then documentation, before tests. Both surfaces are refreshed;
strict typecheck, documentation:check and format:check pass. A fresh full check
and promotion qualification remain required on the repaired source.
Effort 9 stays untuned and receives
one screen after promotion. Distances 10 and 14 are for the final report.
After promotion, use `--mode lab --promotion --final-report` on main to
extend both our ladder and the vips ladder with those two distances.
The flag rejects candidate branches, effort 9 and other measurement modes.
Normal campaign settings stay unchanged; the summary records both ladders.
The post-promotion Butteraugli phase is cancelled. Further compression
work requires Aaron to reopen it. Bundle size is reported; ceiling
increases are permitted by the owner amendment.

The scale reference run records the known jSquash 21 MP abort. Four
coarse vips settings on 13 MP recover in fresh public-encoder processes;
those same settings on 21 MP still fail. Initial failures and fresh
attempts are preserved. Both peers therefore lack a complete 21 MP curve,
which is excluded from the complete-curve aggregate. On the three complete
scale pairs, BD-rate is -5.37174% / +1.45141% / +5.10547% against jSquash
and -6.95490% / -2.82089% / -0.27144% against vips, in SSIM, 3-norm and
max order. These sweep timings are not isolated speed measurements.
Historical peer cache receipt gaps are listed explicitly; all own streams
and pre-scoring receipts verify against the actual pinned pixels.

The [stopping checkpoint](PAUSED-CHECKPOINT.md) and earlier
[screen report](BASELINE-SCREEN.md) retain the previous campaign history.

```sh
node benchmark/jpegxl/lossy-lab/corpus-worker.ts --out .tmp/jpegxl-lossy-lab/corpus-512-v2
node benchmark/jpegxl/lossy-lab/run.ts --manifest .tmp/jpegxl-lossy-lab/corpus-512-v2/manifest.json --out .tmp/jpegxl-lossy-lab/screen-baseline-512-v2 --mode screen --workers 4 --budget-seconds 600
node benchmark/jpegxl/lossy-lab/run.ts --manifest .tmp/jpegxl-lossy-lab/corpus-512-v2/manifest.json --out .tmp/jpegxl-lossy-lab/full-baseline-512-v2 --mode lab --workers 4 --budget-seconds 3600
```

The photo split has 64 development and 63 holdout images. Crop positions, the
16-photo screen, and six original watch photos are selected by hash. Every lab
and screen crop is 512 square. Two separate scale crops are 2080 square and use
`--set scale` for preparation and `--mode scale` for measurement. Full scale
checks belong to promotion candidates. Preparation uses the first-party JPEG and
PNG pipeline. Explicit crop/count reductions and every missing job are recorded.

Development curves use the public effort-7 encoder. Effort 9 is reserved for one
promotion screen, with separate cached peer curves and an explicit effort-7
reference root. Initialization and input preparation
are outside encode timing. Native libjxl decoding and both development scorers
run after timing. Every valid point retains SSIMULACRA2, Butteraugli max and
Butteraugli 3-norm. Peer curves are cached by fixture bytes and pinned package
version; extending a ladder computes only missing settings.

The screen uses five own distances: 0.5, 1, 2, 4 and 7. The full ladder uses
0.45, 0.65, 0.9, 1.3, 1.85, 3, 3.8, 5.35 and 7.5. jSquash uses qualities
1, 10, 20, 40, 50, 60, 65, 70, 75, 80, 85, 88, 92, 95, 97, 99 and 100;
vips uses the full distance ladder. Per-image BD-rate integrates
shape-preserving cubic log-byte curves over
SSIMULACRA2 60–90 and Butteraugli max 0.5–3, clipped to measured overlap.
Butteraugli 3-norm uses the common measured interval. Its required coverage
band is 0.5 to 3 for the per-image guard. Required-range coverage and
all failures remain explicit.
Local rate reversals remain in the measured curve. Exact quality ties use mean
log bytes. No Pareto filtering or isotonic fitting discards measurements.
`--resume-own` continues an unchanged baseline in the same output directory.
Use a fresh variant and directory after every encoder change.
The earlier 2080-square screen curves exceeded the budget. The corrected screen
contains all 16 photos at 512 square, and the full lab contains all 64 at that
size. Required-band gaps are published without changing points per image.

Speed ratios need isolated measurements, with one worker. Prepare originals
separately, then include the first two deterministic watch photos:

```sh
node benchmark/jpegxl/lossy-lab/corpus-worker.ts --watch --out .tmp/jpegxl-lossy-lab/watch-v2
node benchmark/jpegxl/lossy-lab/run.ts --manifest .tmp/jpegxl-lossy-lab/corpus-512-v2/manifest.json --watch-manifest .tmp/jpegxl-lossy-lab/watch-v2/manifest.json --watch-count 2 --out .tmp/jpegxl-lossy-lab/speed-baseline-512-v2 --mode speed --workers 1 --budget-seconds 3600
```

Speed settings are distance 2 for PureJsImage and vips, and quality 80 for
jSquash. Record managed allocation peak separately from process RSS. Curve sweep
timings from parallel jobs do not establish the isolated speed target.

The 56 nonphoto development cases have a separate `--set secondary` preparation
mode. Holdout preparation requires `--set holdout --promotion-holdout`, and its
measurement requires `--mode holdout --promotion`. Full original watch curves
require `--mode watch --promotion` and successful preparation of all ten declared
originals. Read holdout aggregate results only; choose
hypotheses from development results.
