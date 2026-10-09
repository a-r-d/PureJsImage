# JPEG XL lossy lab

Follow [the steering plan](../LOSSY_STEERING.md). The unchanged encoder baseline is
`516bea57`. Prepare development fixtures and measure the baseline before changing
the encoder. The current table and experiment rows live in
[lossy-lab-log.md](../lossy-lab-log.md).

The campaign is paused at the owner's request. See the
[stopping checkpoint](PAUSED-CHECKPOINT.md) for saved results and unfinished work.
The first
[screen report](BASELINE-SCREEN.md) is incomplete: two large own-encoder curves
timed out, and several metric curves lacked the required overlap or were rejected
for local rate reversals. The measurement fixes now retain those reversals.
Full development and isolated speed baselines remain pending.

```sh
node benchmark/jpegxl/lossy-lab/corpus-worker.ts --out .tmp/jpegxl-lossy-lab/corpus-v1
node benchmark/jpegxl/lossy-lab/run.ts --manifest .tmp/jpegxl-lossy-lab/corpus-v1/manifest.json --out .tmp/jpegxl-lossy-lab/screen-baseline-v1 --mode screen --workers 4 --budget-seconds 600
node benchmark/jpegxl/lossy-lab/run.ts --manifest .tmp/jpegxl-lossy-lab/corpus-v1/manifest.json --out .tmp/jpegxl-lossy-lab/full-baseline-v1 --mode lab --workers 4 --budget-seconds 3600
```

The photo split has 64 development and 63 holdout images. Crop positions, the
16-photo screen, and six original watch photos are selected by hash. Two screen
crops are 2080 square to exercise existing pixel-count gates; the rest default to
512 square. Preparation uses the first-party JPEG and PNG pipeline. Explicit
crop/count reductions and every missing job are recorded.

Each curve uses the public effort-7 encoder. Initialization and input preparation
are outside encode timing. Native libjxl decoding and both development scorers
run after timing. Every valid point retains SSIMULACRA2, Butteraugli max and
Butteraugli 3-norm. Peer curves are cached by fixture bytes and pinned package
version; extending a ladder computes only missing settings.

The screen uses four own distances, 0.25, 1.5, 6 and 25. The full ladder adds
0.35, 0.5, 0.75, 1, 2, 3, 4.5, 9 and 16. jSquash uses qualities 1–100; vips uses distances
0.1–25. Per-image BD-rate integrates shape-preserving cubic log-byte curves over
SSIMULACRA2 60–90 and Butteraugli max 0.5–3, clipped to measured overlap.
Butteraugli 3-norm uses the common measured interval. Required-range coverage and
all failures remain explicit.
Local rate reversals remain in the measured curve. Exact quality ties use mean
log bytes. No Pareto filtering or isotonic fitting discards measurements.
`--resume-own` continues an unchanged baseline in the same output directory.
Use a fresh variant and directory after every encoder change.
The initial 2080-square own curves exceeded the screen budget. Until speed
improves, `--screen-skip-large` uses 14 of the fixed 16 photos and records both
omissions. The full lab retains both large crops and all 64 photos.

Speed ratios need isolated measurements, with one worker. Prepare originals
separately, then include the first two deterministic watch photos:

```sh
node benchmark/jpegxl/lossy-lab/corpus-worker.ts --watch --out .tmp/jpegxl-lossy-lab/watch-v1
node benchmark/jpegxl/lossy-lab/run.ts --manifest .tmp/jpegxl-lossy-lab/corpus-v1/manifest.json --watch-manifest .tmp/jpegxl-lossy-lab/watch-v1/manifest.json --watch-count 2 --out .tmp/jpegxl-lossy-lab/speed-baseline-v1 --mode speed --workers 1 --budget-seconds 3600
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
