# JPEG XL lossy lab

Paused at the owner's request. Baseline: `68f99fb3`, unchanged effort-7 encoder; full development baseline pending.
| Mean photo BD-rate | jSquash 1.3.0 | wasm-vips 0.0.19 |
| --- | ---: | ---: |
| SSIMULACRA2 | Pending | Pending |
| Butteraugli 3-norm | Pending | Pending |
| Butteraugli max | Pending | Pending |
Screen: 14/16 own curves completed in 600.04 s; two large crops timed out; 33 comparison omissions. [Results](lossy-lab/BASELINE-SCREEN.md).
Isolated speed stopped after 46/64 development crops; both original measurements remain pending.
Saved results and unfinished work: [stopping checkpoint](lossy-lab/PAUSED-CHECKPOINT.md).
Policy: follow [LOSSY_STEERING.md](LOSSY_STEERING.md); holdout is reserved for promotion.

The fixed photo split has 64 development and 63 holdout images. The runner uses deterministic crops, native development-only decoding/scoring, cached public peer curves, and per-image shape-preserving cubic BD-rate. Raw data stays in `.tmp/jpegxl-lossy-lab/`.

| ID and date | Hypothesis | Quick-screen and full-lab BD-rate deltas (SSIM / 3-norm / max) | Effort-7 time delta | Verdict | Commit |
| --- | --- | --- | --- | --- | --- |
| LL-000, 2026-10-09 | A shared public-API runner can measure both Butteraugli scores and corpus BD-rate within lab budgets. | One 512-square pilot completed in 19.17 seconds; initial range coverage was incomplete. Full lab pending. Worker syntax failure fixed and covered by a Node strip-mode regression test. | No encoder change | Kept harness repair | `68f99fb3` |
| LL-001, 2026-10-09 | A wider fixed ladder should cover SSIMULACRA2 60–90 and Butteraugli max 0.5–3. | Screen: 14/16 own curves completed in 600.04 s; two large crops timed out. Common-interval mean BD-rate vs jSquash: +1.00% / +16.36% / +13.44%; vs vips: +1.21% / +10.36% / +5.36%. There are 33 omissions from incomplete coverage and nonmonotone curves; full lab pending. | No encoder change; isolated timing pending | Kept harness; baseline incomplete | `68f99fb3` |
| LL-002, 2026-10-09 | Shape-preserving cubic interpolation should retain valid measured rate reversals. | Signed-secant PCHIP now retains all distinct-quality points and local extrema; tied qualities use mean log bytes. 42 focused metric tests pass. Baseline recomputation pending. | No encoder change | Kept harness repair | This checkpoint |
| LL-003, 2026-10-09 | Global endpoint extensions should reduce coverage misses without choosing points per image. | Full own ladder extends to 0.25–25; jSquash to qualities 1–100; vips to distances 0.1–25. Own baseline resumption reuses completed points. Measurement pending. | No encoder change | Kept ladder; measurement pending | This checkpoint |
| LL-004, 2026-10-09 | Fixture selection must include prior watch references and expose preparation misses. | Selection tests retain all ten references, forbid holdout in development/speed runs, and reject incomplete promoted watch preparation. The quick screen can explicitly omit two large cases to fit its budget; full lab retains all 64. | No encoder change | Kept harness repair | This checkpoint |
| LL-005, 2026-10-09 | Wider endpoint ladders must not add low-quality tail weight to the specified SSIMULACRA2 and Butteraugli max bands. | Integrate SSIMULACRA2 over 60–90 and Butteraugli max over 0.5–3, clipped to measured overlap; 3-norm uses its common measured interval. No extrapolation. 47 metric tests pass. | No encoder change | Kept measurement repair | This checkpoint |

The first original preparation pass made nine watch PNGs. `prior-12mp-im26-1416`
failed because our baseline JPEG reader leaves a terminal RST3 before EOI
unconsumed. This is recorded as a preparation failure, not a missing photo or a
multiscan source. The two hashed originals used by baseline speed preparation
succeeded. The full ten-original watch run cannot qualify until this is fixed.

## Stopping checkpoint

All 64 development crops are prepared. The encoder gains at `7230f091` are
preserved, and this lab checkpoint makes no production encoder changes.
The pilot, screen, cached peer curves and 505 compressed outputs are retained in
`.tmp/jpegxl-lossy-lab/`. No holdout measurements or encoder experiments were run.
The isolated speed run was stopped after 138 of 198 jobs, covering all three
engines on 46 development crops. Its results are explicitly partial.

The latest cleanup removed 138 reproducible decoded PNGs (97.80 MiB), after
archiving 197 metadata files and the preparation and speed logs. Every prepared
input, measured JPEG XL file, score and peer cache remains present.
The previous checkpoint removed another 367 decoded PNGs (425.09 MiB).
Metadata, run logs and deletion records are saved under
`.tmp/jpegxl-stop-cleanup-2026-10-09/paused-lab/`.

The 75 focused lab regression tests and strict TypeScript checks pass.
`npm run check -- -- --maxWorkers=4` passed with 3,827 tests across 294 files,
plus three existing test skips and one skipped file. Build, browser, type,
documentation, package, lint and formatting checks passed. The test suite took
791.96 seconds. The check log is saved with the cleanup records.
