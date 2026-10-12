# JPEG XL lossy lab

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
The full ten-original watch run continues on the same source. Five own
curves and 45/90 own scored points complete with zero own execution failures.
All nine settings on the pinned 12 MP im26-2012 image exceed the unchanged
137,514,476-byte managed ceiling, peaking at 174,544,064 bytes. The queued
watch qualifier will reject this memory failure. Allocation tracing is
prepared in an isolated first-party source archive and waits for the existing
watch and reference recovery trees to finish. Promotion needs a memory repair
that preserves output, refreshed qualification and the full repository check.
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
pass all 48 focused cases. `npm run check` passes 3,994 tests, with three
skips and no failures, including `browser:check`. Remaining promotion
checks include watch memory repair, full watch curves, isolated original
speed and a fresh repository check. Bundles measure
610,206 and 683,023 bytes; ceilings are 615,000 and 685,000 bytes.
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
