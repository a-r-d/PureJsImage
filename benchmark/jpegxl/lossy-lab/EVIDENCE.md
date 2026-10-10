# Preserved lossy candidate evidence

Candidate: E1 shared opaque color policy, E2 photo tools without the area floor,
E4 estimated order/family selection, early palette cost rejection, serializer
deduplication and optional sharpness-map allocation recovery. Development base:
`dca2f211`. The preserved `e0241edb` checkpoint is unpromoted and has 30 failing
tests. Subsequent promotion repairs and their qualifications are indexed below.
The latest complete check has 3,855 passing tests, three failures and three skips.
The three mode/frame assertions remain unchanged pending an owner decision;
complete source grids and both independent decoders verify exact colors and
alpha for those fixtures. Fresh full development measures all 64 photos and
confirms every one of the 576 JXL files is byte-identical to the preserved
candidate. The unchanged individual-image regressions still prevent promotion.

The following measured artifacts remain in the ignored local lab directory.
Large encoded files and temporary executables are not checked in. The lab log,
baseline report and tool-cost report contain the durable measured summaries.

| Evidence | Local artifact relative to the repository |
| --- | --- |
| Frozen prepared 64-photo development set | `.tmp/jpegxl-lossy-lab/corpus-512-v2/manifest.json` |
| Unchanged full-lab baseline | `.tmp/jpegxl-lossy-lab/full-baseline-512-v2/summary-full.json` |
| Candidate full lab, 64 photos and 576 points | `.tmp/jpegxl-lossy-lab/e4-palette-precheck-full/summary.json` |
| Candidate versus full development baseline, same nine distances | `.tmp/jpegxl-lossy-lab/e4-palette-precheck-full/versus-baseline.json` |
| Candidate versus E2, including curve timings | `.tmp/jpegxl-lossy-lab/e4-palette-precheck-full/versus-e2.json` |
| Palette precheck's unchanged full-lab output | `.tmp/jpegxl-lossy-lab/e4-palette-precheck-full/versus-e4.json` |
| Cleanup screen versus retained candidate | `.tmp/jpegxl-lossy-lab/checkpoint-bundle-cleanup/versus-retained.json` |
| Cleanup's 80 exact output comparisons | `.tmp/jpegxl-lossy-lab/checkpoint-bundle-cleanup/byte-comparison.json` |
| Full check: 3,824 passed, 30 failed, three skipped | `.tmp/jpegxl-lossy-lab/checkpoint-bundle-cleanup/current-check-d.log` |
| Seven DC/fallback diagnostics | `.tmp/jpegxl-lossy-lab/checkpoint-bundle-cleanup/dc-results-current/rows.jsonl` |
| 27 palette/geometry/contrast diagnostics | `.tmp/jpegxl-lossy-lab/checkpoint-bundle-cleanup/non-dc-results-current/rows.jsonl` |
| Eleven pre-cleanup/current helper controls | `.tmp/jpegxl-lossy-lab/checkpoint-bundle-cleanup/non-dc-control-comparison.json` |
| Full fine-fallback byte control | `.tmp/jpegxl-lossy-lab/checkpoint-bundle-cleanup/fine-fallback-control-b/` |
| Chromium verification, two tests covering 36 cases | `.tmp/jpegxl-lossy-lab/checkpoint-bundle-cleanup/final-browser.log` |
| Isolated baseline speed | `.tmp/jpegxl-lossy-lab/speed-baseline-512-v2/summary.json` |
| Preserved candidate isolated speed, all 64 crops | `.tmp/jpegxl-lossy-lab/promotion-candidate/speed64/summary.json` |
| All ten prepared watch originals | `.tmp/jpegxl-lossy-lab/watch-v2/manifest.json` |
| Two prepared 2080-square scale crops | `.tmp/jpegxl-lossy-lab/scale-v2/manifest.json` |
| Fine-map repair, original 4 MP property | `.tmp/jpegxl-lossy-lab/promotion-candidate/fine-repair-result.json` |
| Fine-map repair, two complete-stream tests | `.tmp/jpegxl-lossy-lab/promotion-candidate/fine-map-tests.log` |
| Fine-map repair, 80-point zero-delta screen | `.tmp/jpegxl-lossy-lab/promotion-fine-map-screen/versus-preserved.json` |
| Fine-map repair, all 80 files byte-identical | `.tmp/jpegxl-lossy-lab/promotion-fine-map-screen/byte-comparison.json` |
| Current cold distance-2 CPU profile | `.tmp/jpegxl-lossy-lab/promotion-candidate/current-im3012-d2-profile/profile-summary.json` |
| Thin repair, original quality and size bounds | `.tmp/jpegxl-lossy-lab/promotion-candidate/thin-footprint-result/results.json` |
| Thin repair, four complete native/Rust decoder grids | `.tmp/jpegxl-lossy-lab/promotion-candidate/thin-independent/result.json` |
| Thin repair, 80-point zero-delta screen | `.tmp/jpegxl-lossy-lab/promotion-thin-screen/versus-preserved.json` |
| Thin repair, all 80 files byte-identical | `.tmp/jpegxl-lossy-lab/promotion-thin-screen/byte-comparison.json` |
| Exact palette repair, unchanged original winner | `.tmp/jpegxl-lossy-lab/promotion-candidate/original-palette-property.log` |
| Exact palette repair, large opaque/translucent and optional storage properties | `.tmp/jpegxl-lossy-lab/promotion-candidate/palette-property.log` |
| Exact palette repair, 80-point zero-delta screen | `.tmp/jpegxl-lossy-lab/promotion-palette-screen/versus-preserved.json` |
| Exact palette repair, all 80 files byte-identical | `.tmp/jpegxl-lossy-lab/promotion-palette-screen/byte-comparison.json` |
| Palette repair, corrected small public fixtures | `.tmp/jpegxl-lossy-lab/promotion-candidate/palette-corrected-small.log` |
| Contrast repair, original unchanged properties | `.tmp/jpegxl-lossy-lab/promotion-candidate/contrast-original-property.log` |
| Contrast repair, six texture and flat-region properties | `.tmp/jpegxl-lossy-lab/promotion-candidate/contrast-flat-property.log` |
| Contrast repair, 80-point zero-delta screen | `.tmp/jpegxl-lossy-lab/promotion-contrast-screen/versus-preserved.json` |
| Contrast repair, all 80 files byte-identical | `.tmp/jpegxl-lossy-lab/promotion-contrast-screen/byte-comparison.json` |
| Portable repairs, eight focused Node properties | `.tmp/jpegxl-lossy-lab/promotion-candidate/portable-node-properties.log` |
| Portable repairs, six real Chromium tests | `.tmp/jpegxl-lossy-lab/promotion-candidate/portable-chromium-properties.log` |
| Required check after first repairs, blocked at bundle ceilings | `.tmp/jpegxl-lossy-lab/promotion-candidate/check-a.log` |
| Rejected family estimator recovery, unchanged size failure | `.tmp/jpegxl-lossy-lab/promotion-candidate/family-limit-property.log` |
| Family allocation diagnosis, no estimator failures | `.tmp/jpegxl-lossy-lab/promotion-candidate/family-limit-allocations.json` |
| Family raw histogram lifetime, original unchanged properties | `.tmp/jpegxl-lossy-lab/promotion-candidate/family-dead-histograms-property.log` |
| Family raw histogram lifetime, fixed-screen zero BD delta | `.tmp/jpegxl-lossy-lab/promotion-family-screen/versus-preserved.json` |
| Family raw histogram lifetime, complete 80-file identity | `.tmp/jpegxl-lossy-lab/promotion-family-screen/byte-proof.json` |
| Observed adjacent allocation boundary | `.tmp/jpegxl-lossy-lab/promotion-candidate/budget-boundary-result.json` |
| Exact work reduction, 13 focused original/new properties | `.tmp/jpegxl-lossy-lab/promotion-candidate/exact-work-properties.log` |
| Exact work reduction, same cold crop profile | `.tmp/jpegxl-lossy-lab/promotion-candidate/exact-work-im3012-d2-profile/profile-run.json` |
| Exact work reduction, measured fixed bundle ceilings | `.tmp/jpegxl-lossy-lab/promotion-candidate/exact-work-sizes.json` |
| Exact work reduction, fixed-screen zero BD delta | `.tmp/jpegxl-lossy-lab/promotion-exact-work-screen/versus-preserved.json` |
| Exact work reduction, complete 80-file identity | `.tmp/jpegxl-lossy-lab/promotion-exact-work-screen/byte-proof.json` |
| Progressive repair, observed unchanged byte ceilings | `.tmp/jpegxl-lossy-lab/promotion-progressive-contrast-snapshots/` |
| Progressive repair, fixed-screen zero BD delta | `.tmp/jpegxl-lossy-lab/promotion-progressive-screen/versus-preserved.json` |
| Progressive repair, complete 80-file identity | `.tmp/jpegxl-lossy-lab/promotion-progressive-screen/byte-proof.json` |
| Refused map, original refusal count and quality | `.tmp/jpegxl-lossy-lab/promotion-refused-map-snapshot/large-d4-filter-limit/result.json` |
| Refused map, fixed-screen zero BD delta | `.tmp/jpegxl-lossy-lab/promotion-map-fallback-screen/versus-preserved.json` |
| Refused map, complete 80-file identity | `.tmp/jpegxl-lossy-lab/promotion-map-fallback-screen/bytes-versus-preserved.json` |
| Final repair bundle measurements and generated tables | `.tmp/jpegxl-lossy-lab/promotion-candidate/size-final-write.log` |
| Final 23 snapshot artifacts, exact inputs and complete maintained grids | `.tmp/jpegxl-lossy-lab/promotion-snapshots-final/` |
| Final 23-case collection log | `.tmp/jpegxl-lossy-lab/promotion-candidate/final-snapshot-collector.log` |
| Final 23 complete native and Rust grid comparisons | `.tmp/jpegxl-lossy-lab/promotion-snapshots-final-oracles/result.json` |
| Validated exact-output-only snapshot edit record | `.tmp/jpegxl-lossy-lab/promotion-snapshot-update-final/summary.json` |
| Final 12 focused properties, including complete fallback streams | `.tmp/jpegxl-lossy-lab/promotion-candidate/final-small-properties.log` |
| Snapshot-to-oracle hash chain and exact source alpha, 27,924,550 pixels | `.tmp/jpegxl-lossy-lab/promotion-snapshots-final-oracles/source-chain.json` |
| Final seven real Chromium regressions | `.tmp/jpegxl-lossy-lab/promotion-candidate/final-chromium.log` |
| Final check attempt, stopped at three lint errors | `.tmp/jpegxl-lossy-lab/promotion-candidate/final-check.log` |
| Lint repair, zero errors | `.tmp/jpegxl-lossy-lab/promotion-candidate/final-lint-errors-b.log` |
| Full check, all pre-test gates passed; stopped after two new property failures | `.tmp/jpegxl-lossy-lab/promotion-candidate/final-check-b.log` |
| Both additional property failures reproduced | `.tmp/jpegxl-lossy-lab/promotion-candidate/new-regressions.log` |
| Progressive EPF-only repair, insufficient texture recovery | `.tmp/jpegxl-lossy-lab/promotion-candidate/progressive-epf-properties.log` |
| Progressive luminance repair, five unchanged properties pass | `.tmp/jpegxl-lossy-lab/promotion-candidate/progressive-luma-properties.log` |
| Progressive luminance repair, four complete affected snapshots | `.tmp/jpegxl-lossy-lab/promotion-progressive-luma-snapshots/` |
| Progressive luminance repair, four complete native/Rust grids | `.tmp/jpegxl-lossy-lab/promotion-progressive-luma-oracles/result.json` |
| Progressive luminance repair, zero BD-rate delta | `.tmp/jpegxl-lossy-lab/promotion-progressive-luma-screen/versus-preserved.json` |
| Progressive luminance repair, all 80 files byte-identical | `.tmp/jpegxl-lossy-lab/promotion-progressive-luma-screen/byte-proof.json` |
| Reverted palette search-order repair, original mode assertion still fails | `.tmp/jpegxl-lossy-lab/promotion-candidate/palette-order-properties.log` |
| Sparse graphic, original fixture and complete zero-error grid | `.tmp/jpegxl-lossy-lab/promotion-sparse-diagnostic/result.json` |
| Sparse graphic, complete native/Rust grid | `.tmp/jpegxl-lossy-lab/promotion-sparse-oracles/result.json` |
| Complete repaired check, all pre-test gates passed, three layout failures | `.tmp/jpegxl-lossy-lab/promotion-candidate/complete-check-c.log` |
| Reverted later competition after exact palette, layout assertions still fail | `.tmp/jpegxl-lossy-lab/promotion-candidate/exact-palette-competition.log` |
| Repeated glyphs and both opaque page layouts, complete exact source grids | `.tmp/jpegxl-lossy-lab/promotion-layout-diagnostic/` |
| Three complete layout fixtures, native and Rust agree exactly | `.tmp/jpegxl-lossy-lab/promotion-layout-oracles/result.json` |
| Public fine-map recovery, twelve focused Node tests | `.tmp/jpegxl-lossy-lab/promotion-candidate/public-fine-map-properties.log` |
| Final seven real Chromium tests including public fine-map recovery | `.tmp/jpegxl-lossy-lab/promotion-candidate/chromium-public-final.log` |
| Final lint after public fine-map coverage, zero errors | `.tmp/jpegxl-lossy-lab/promotion-candidate/final-lint-c.log` |
| Final progressive bundle measurements, 593,928 and 666,734 bytes | `.tmp/jpegxl-lossy-lab/promotion-candidate/progressive-final-size.log` |
| Repaired full-development run, all 64 photos and 576 points | `.tmp/jpegxl-lossy-lab/promotion-repaired-full64/summary.json` |
| Repaired full development, same-ladder delta against unchanged baseline | `.tmp/jpegxl-lossy-lab/promotion-repaired-full64/versus-baseline.json` |
| Repaired full development, zero BD-rate delta against preserved candidate | `.tmp/jpegxl-lossy-lab/promotion-repaired-full64/versus-preserved.json` |
| Repaired full development, complete 576-file byte identity | `.tmp/jpegxl-lossy-lab/promotion-repaired-full64/byte-proof.json` |
| Repaired full-development execution log | `.tmp/jpegxl-lossy-lab/promotion-candidate/repaired-full64.log` |
| Final strict TypeScript, browser, generated documentation and formatting gates | `.tmp/jpegxl-lossy-lab/promotion-candidate/final-portability.log` |
| Direct formatting check of all nine new test files | `.tmp/jpegxl-lossy-lab/promotion-candidate/final-new-format.log` |
| Repaired isolated speed, all 64 crops and 192 fresh jobs | `.tmp/jpegxl-lossy-lab/promotion-candidate/repaired-speed64/summary.json` |
| Repaired isolated speed execution log | `.tmp/jpegxl-lossy-lab/promotion-candidate/repaired-speed64.log` |

The fresh full baseline comparison recomputes BD-rate from both own curves; it does
not subtract peer-relative means. Means are -3.38979% SSIMULACRA2, -3.10962%
Butteraugli 3-norm and +2.56820% Butteraugli max. Individual regressions remain
above the steering's 3% gate. Repaired candidate isolated crop speed is
19.20944x jSquash: median 9,405.507 ms versus 489.629 ms across all 64 crops.
This fails the 3x target. The preserved candidate was 22.47516x, at 11,193.915 ms
versus 498.057 ms. Fresh own median is 15.98% lower while mean is 0.24% higher,
so the slow tail remains. Repaired managed speed peak is 34,223,449 bytes and
isolated worker peak RSS is 296,017,920 bytes. All 192 jobs are measured fresh,
without failures or omissions, using one worker throughout.

Fine fallback, both thin orientations, family allocation fallback and the original exact palette winner
now pass their unchanged property bounds. Each repair's fixed 80-point screen
has identical complete files and zero BD-rate deltas. The palette repair's
optional actual-size probe raises managed screen peak to 32,646,366 bytes and
full-development peak to 34,260,393 bytes;
original memory remains unqualified and repaired crop speed fails its target. The first held
palette run also exposes two test-harness assumptions; its three large/storage
properties pass, while corrected small cases have a separate run log.

Run commands and ladders are documented in [README.md](README.md). Guard records
are under `.tmp/jpegxl-m7/bounded-runs/`. No holdout was measured or inspected
during the preserved experiments.
