# JPEG XL lossy lab

Follow [the steering plan](../LOSSY_STEERING.md). The unchanged encoder baseline is
`516bea57`. Prepare development fixtures and measure the baseline before changing
the encoder. The current table and experiment rows live in
[lossy-lab-log.md](../lossy-lab-log.md).

The campaign is paused at Aaron's request. The first
[screen report](BASELINE-SCREEN.md) is incomplete: two large own-encoder curves
timed out, and several metric curves lack the required overlap or are
nonmonotone. Full development and isolated speed baselines remain pending.

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

The screen uses four own distances, 0.35, 1.5, 4.5 and 9. The full ladder adds
0.5, 0.75, 1, 2, 3 and 6. jSquash uses qualities 20–99; vips uses distances
0.25–9. Per-image BD-rate integrates monotone cubic log-byte curves over their
common interval. Required-range coverage and all failures remain explicit.

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
require `--mode watch --promotion`. Read holdout aggregate results only; choose
hypotheses from development results.
