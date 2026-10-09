# JPEG XL lossy lab

Paused at Aaron's request. Baseline: `516bea57`, unchanged effort-7 encoder; full development baseline pending.
| Mean photo BD-rate | jSquash 1.3.0 | wasm-vips 0.0.19 |
| --- | ---: | ---: |
| SSIMULACRA2 | Pending | Pending |
| Butteraugli 3-norm | Pending | Pending |
| Butteraugli max | Pending | Pending |
Screen: 14/16 own curves completed in 600.04 s; two large crops timed out; 33 comparison omissions. [Results](lossy-lab/BASELINE-SCREEN.md).
Speed ratio and full-original managed memory baseline: pending isolated measurements.
Next: test pixel and distance gates; replace complete candidate searches with cost estimates; test the footprint precision floor.
Policy: follow [LOSSY_STEERING.md](LOSSY_STEERING.md); holdout is reserved for promotion.

The fixed photo split has 64 development and 63 holdout images. The runner uses deterministic crops, native development-only decoding/scoring, cached public peer curves, and per-image monotone cubic BD-rate. Raw data stays in `.tmp/jpegxl-lossy-lab/`.

| ID and date | Hypothesis | Quick-screen and full-lab BD-rate deltas (SSIM / 3-norm / max) | Effort-7 time delta | Verdict | Commit |
| --- | --- | --- | --- | --- | --- |
| LL-000, 2026-10-09 | A shared public-API runner can measure both Butteraugli scores and corpus BD-rate within lab budgets. | One 512-square pilot completed in 19.17 seconds; initial range coverage was incomplete. Full lab pending. Worker syntax failure fixed and covered by a Node strip-mode regression test. | No encoder change | Kept harness repair | Uncommitted |
| LL-001, 2026-10-09 | A wider fixed ladder should cover SSIMULACRA2 60–90 and Butteraugli max 0.5–3. | Screen: 14/16 own curves completed in 600.04 s; two large crops timed out. Common-interval mean BD-rate vs jSquash: +1.00% / +16.36% / +13.44%; vs vips: +1.21% / +10.36% / +5.36%. There are 33 omissions from incomplete coverage and nonmonotone curves; full lab pending. | No encoder change; isolated timing pending | Kept harness; baseline incomplete | This checkpoint |

## Stopping checkpoint

All 64 development crops are prepared. The encoder is unchanged from `516bea57`.
The pilot, screen, cached peer curves and compressed outputs are retained in
`.tmp/jpegxl-lossy-lab/`. No holdout measurements or encoder experiments were run.
The full development baseline, isolated speed table and full-original memory
baseline remain unfinished. Resume those before changing encoder gates.

Checkpoint validation: `npm run check -- -- --maxWorkers=4` passed with 3,811 tests
across 293 files and three existing test skips. The default-concurrency run was
stopped after timing failures; the four-worker run passed without source changes.
Cleanup removed 367 reproducible decoded PNGs (425.09 MiB). All 64 development
crops, 367 measured JPEG XL files, scores and peer caches remain present.
Metadata and run logs are saved under `.tmp/jpegxl-stop-cleanup-2026-10-09/`.
