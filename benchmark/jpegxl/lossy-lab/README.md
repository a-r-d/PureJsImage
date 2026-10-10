# JPEG XL lossy lab

Follow [the steering plan](../LOSSY_STEERING.md) and
[checkpoint feedback](../LOSSY_FEEDBACK.md). The campaign resumed on 2026-10-09.
The corrected baseline uses the unchanged encoder at `dca2f211`; its full
development and isolated speed results are published in [BASELINE.md](BASELINE.md).
The current table and experiment rows live in
[lossy-lab-log.md](../lossy-lab-log.md). The E1/E2 configuration remains an
unpromoted trial. All 14 E3 screens are measured in [TOOL-COSTS.md](TOOL-COSTS.md);
full development confirmation is still required.

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

Each curve uses the public effort-7 encoder. Initialization and input preparation
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
Butteraugli 3-norm uses the common measured interval. Required-range coverage and
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
