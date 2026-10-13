# Preserved lossy candidate evidence

Candidate: E1 shared opaque color policy, E2 photo tools without the area floor,
E4 estimated order/family selection, early palette cost rejection, serializer
deduplication and optional sharpness-map allocation recovery. Development base:
`dca2f211`. The preserved `e0241edb` checkpoint is unpromoted and has 30 failing
tests. Subsequent promotion repairs and their qualifications are indexed below.
The preceding repair checkpoint `468a5bec` has 3,855 passing tests, three
failures and three skips; all 576 development files are byte-identical to the
preserved candidate there. The owner's effort-9 amendment and the final AC model
repair now change effort-7 files. Their current full-development, fresh isolated
speed and independent-decoder evidence is indexed below, followed by the
large-DCT, tree-sorting and prefix speed repairs. Those repairs preserve the amended
effort-7 files exactly.
The 2026-10-12 owner decision in LOSSY_PROMOTION_ENTRY.md supersedes older
entry rules below. The three mode/frame assertions now qualify as snapshots
after fresh main/candidate measurements and complete exact independent grids.
Aggregate baseline compression gates pass; per-image 3-norm, speed and original
qualification remain open. Holdout remains unopened. Older entries retain the
rules and results that applied when measured.

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


## Effort-9 amendment

The owner's [2026-10-10 amendment](../LOSSY_EFFORT9_AMENDMENT.md) approves slow
public effort 9 and removes bundle size from promotion gates. Production keeps
all five named complete searches at effort 9. Lossless effort 9 retains effort
7 output. No effort-9 compression tuning or promotion screen has been run.

| Evidence | Local artifact |
| --- | --- |
| Effort-9 public fixtures, native libjxl and jxl-rs complete grids | `.tmp/jpegxl-lossy-lab/effort9-amendment/oracles/result.json` |
| Oracle reproduction script | `.tmp/jpegxl-lossy-lab/effort9-amendment/verify.ts` |
| First focused effort-9 run, 12 passing tests | `.tmp/jpegxl-m7/bounded-runs/effort9-focused-20261010.json` |
| Final focused codec and benchmark run, 74 passing tests | `.tmp/jpegxl-m7/bounded-runs/effort9-static-focused-20261010.json` |
| Effort-7 migration screen, 16 photos and 80 points | `.tmp/jpegxl-lossy-lab/effort9-amendment/screen/summary.json` |
| Migration screen against preserved E4, same five-point ladder | `.tmp/jpegxl-lossy-lab/effort9-amendment/screen-versus-preserved.json` |

All ten effort-9 oracle fixtures agree within one native-depth color code value
with both decoders, and every alpha sample is exact. They cover small RGB,
opaque and transparent RGBA, grayscale, 16-bit, progressive, thin and multi-group
inputs. The late-cancellation test releases every owned allocation. The lossless
fixture is byte-identical at efforts 7 and 9.

The new screen has mean deltas against preserved E4 of +1.42911% SSIMULACRA2,
+1.11629% Butteraugli 3-norm and +1.21177% Butteraugli max. It completes in
123.69 seconds. These are compression regressions beyond the speed-only guard.
Parallel screen timings are not an isolated speed qualification. Main and the
reserved holdout remain unchanged; full development and fresh isolated timing
follow before the candidate checkpoint.


| Full effort-7 migration, 64 photos and 576 points | `.tmp/jpegxl-lossy-lab/effort9-amendment/full/summary.json` |
| Full migration versus preserved candidate, same ladder | `.tmp/jpegxl-lossy-lab/effort9-amendment/full-versus-preserved.json` |
| Full migration versus unchanged baseline, same ladder | `.tmp/jpegxl-lossy-lab/effort9-amendment/full-versus-baseline.json` |

Full migration means versus preserved E4 are +1.35794% SSIMULACRA2, +0.97396%
Butteraugli 3-norm and +0.93778% Butteraugli max. Direct means versus the original
baseline are -2.21955%, -2.28899% and +3.40057%. Current vips SSIM is +0.82351%,
above the protected 0% target. The individual-image entry also fails. All 576
points and 384 comparisons compute; 209 comparisons have partial required-range
coverage. No holdout or effort-9 comparison screen has been opened.


| Fresh isolated migration speed, all 64 crops and 192 jobs | `.tmp/jpegxl-lossy-lab/effort9-amendment/speed/summary.json` |
| Isolated speed execution receipt | `.tmp/jpegxl-m7/bounded-runs/effort9-migration-speed-20261010.json` |

Fresh medians are own 3,199.831 ms, jSquash 491.548 ms and vips 352.849 ms.
Ratios are 6.50971x and 9.06855x. The own median drops 65.98% and mean 52.63%
against the preceding repair, while the 3x crop gate still fails. Managed peak
is 34,223,449 bytes; worker peak RSS is 284,704,768 bytes. The isolated tree
finishes in 7m47.50s with 416.2 MiB cgroup peak and zero swap.


| Refreshed package and generated documentation measurements | `.tmp/jpegxl-lossy-lab/effort9-amendment/size.log` |
| Eight passing real Chromium tests, including effort 9 | `.tmp/jpegxl-lossy-lab/effort9-amendment/chromium.log` |
| Full amendment check | `.tmp/jpegxl-lossy-lab/effort9-amendment/check.log` |

Core plus JPEG XL measures 593,510 minified bytes and the specialized entry
666,299 bytes. Check ceilings are now 610,000 and 685,000 bytes under the owner's
approval. Bundle size is reported without acting as a campaign promotion gate.
All eight real Chromium tests pass; the complete repository check is recorded
separately when it finishes.


## Final effort migration repairs

| Evidence | Raw artifact |
| --- | --- |
| Eight strict coefficient properties after single-stream AC model repair | `.tmp/jpegxl-lossy-lab/effort9-amendment/ac-model-progressive-repair.log` |
| Final quick screen and same-ladder E4 comparison | `.tmp/jpegxl-lossy-lab/effort9-amendment/ac-model-screen/summary.json`, `ac-model-screen-versus-preserved.json` |
| Migrated tool recovery and eleven public fixtures | `.tmp/jpegxl-lossy-lab/effort9-amendment/qualification.log` |
| Nine unchanged snapshot property contracts | `.tmp/jpegxl-lossy-lab/effort9-amendment/snapshot-properties.json` |
| Both independent decoders, eleven effort-9 full grids | `.tmp/jpegxl-lossy-lab/effort9-amendment/final-oracles/result.json` |
| Both independent decoders, nine saved snapshot full grids | `.tmp/jpegxl-lossy-lab/effort9-amendment/snapshot-oracles/result.json` |
| Boundary probe repair and benchmark/type regressions | `.tmp/jpegxl-lossy-lab/effort9-amendment/final-focused.log` |

The two added boundary probes initially counted ordinary alpha scratch as luma
medians. The legacy effort-7 control retains its original probe; the new
effort-9 case uses 65,535 blocks, below the former 65,536-block gate, so the
probe measures only median allocations. Original recovery counts and all
quality, alpha, memory, coverage and exact preceding-stream contracts stay
unchanged. Seven snapshots change only encoded size and digest.

## Final-source development checkpoint

Production source identity for the following runs is
`bb77a83ccd3db199046ece6f28424634eb1f088eac6e5b271ba0dceb0880986f`.
Only test instrumentation, justified encoded snapshots and reporting change
after that source is frozen.

| Evidence | Raw artifact |
| --- | --- |
| Full development, 64 photos and 576 effort-7 points | `.tmp/jpegxl-lossy-lab/effort9-amendment/ac-model-full/summary.json` |
| Same nine-point ladder, direct delta vs preserved candidate | `.tmp/jpegxl-lossy-lab/effort9-amendment/final-full-versus-preserved.json` |
| Same nine-point ladder, direct delta vs unchanged baseline | `.tmp/jpegxl-lossy-lab/effort9-amendment/final-full-versus-baseline.json` |
| Full-development bounded execution receipt | `.tmp/jpegxl-m7/bounded-runs/effort9-final-ac-model-full-20261010.json` |
| Isolated final-source speed, 64 crops and 192 fresh jobs | `.tmp/jpegxl-lossy-lab/effort9-amendment/ac-model-speed/summary.json` |
| Speed ledger, zero reused timings or failures | `.tmp/jpegxl-lossy-lab/effort9-amendment/ac-model-speed/progress.json` |
| Isolated-speed bounded execution receipt | `.tmp/jpegxl-m7/bounded-runs/effort9-final-ac-model-speed-20261010.json` |
| All twenty complete native and Rust decoder grids | `.tmp/jpegxl-lossy-lab/effort9-amendment/final-oracles/result.json`, `snapshot-oracles/result.json` |
| Independent-decoder bounded execution receipt | `.tmp/jpegxl-m7/bounded-runs/effort9-final-snapshot-oracles-20261010.json` |
| Refreshed final bundles and generated documentation | `.tmp/jpegxl-lossy-lab/effort9-amendment/final-size.log` |
| Eight final-source real Chromium tests | `.tmp/jpegxl-lossy-lab/effort9-amendment/final-chromium.log` |
| Final Chromium bounded execution receipt | `.tmp/jpegxl-m7/bounded-runs/effort9-final-chromium-20261010.json` |
| Final complete repository check | `.tmp/jpegxl-lossy-lab/effort9-amendment/final-check.log` |
| Full check completion journal after the waiting shell ends early | `.tmp/jpegxl-lossy-lab/effort9-amendment/final-check-unit-completion.json` |
| Five additional original-property snapshot qualifications | `.tmp/jpegxl-lossy-lab/effort9-amendment/extra-snapshots.log`, `extra-snapshots/` |
| Both decoders, five additional 8/16-bit full grids | `.tmp/jpegxl-lossy-lab/effort9-amendment/extra-oracles/result.json` |
| Five-grid bounded execution receipt | `.tmp/jpegxl-m7/bounded-runs/effort9-extra-snapshot-qualification-20261010.json` |
| Final targeted snapshot retest | `.tmp/jpegxl-lossy-lab/effort9-amendment/final-snapshot-tests.log` |
| Final type, browser and documentation checks | `.tmp/jpegxl-lossy-lab/effort9-amendment/final-snapshot-checks.log` |
| Final focused-check bounded execution receipt | `.tmp/jpegxl-m7/bounded-runs/effort9-final-snapshot-checks-20261010.json` |

All 384 peer comparisons compute, with 209 partial required-range warnings.
Means against jSquash are -1.73288% SSIMULACRA2, +12.75170% Butteraugli 3-norm
and +15.74935% Butteraugli max. Against current wasm-vips they are +0.66928%,
+9.42715% and +7.43563%. Direct same-ladder means against the development
baseline are -2.37865%, -2.51067% and +3.17892%; against the preceding candidate
they are +1.21680%, +0.77924% and +0.78555%. These are per-image curve comparisons,
not differences between peer aggregate means. Compression entry still fails.

Final fresh medians are own 3,494.635 ms, jSquash 491.799 ms and current vips
351.536 ms. The ratios are 7.10582x and 9.94103x, beyond the 3x crop target.
Own median falls 62.84% and mean 50.14% against `468a5bec`. All 192 jobs are
fresh. Managed speed peak is 34,223,399 bytes; worker peak RSS is 298,500,096
bytes. The bounded tree completes in 8m0.81s, peak 423.4 MiB, zero swap.
The full lab uses 34,260,047 managed bytes; original memory remains unqualified.

Final bundles measure 593,588 and 666,412 minified bytes. Approved check ceilings
are 610,000 and 685,000 bytes; size is reported without a promotion gate.
All eight real Chromium tests pass, including the new multi-group progressive
fixture. No effort-9 tuning or comparison screen has run.

The final full check completes with 3,867 passing tests, eight failures and three
skips across 302 files. All ten slow luma cases pass. The waiting shell ends with
status 143 before the unit finishes; the separate completion receipt contains
the full-suite summary, log hash and journal result. The unit's actual exit is
1, with 19m32.51s elapsed and 2.4 GiB peak, under the same 6 GiB and zero-swap
policy. This interruption is not used to skip any tests.

Five failures pin encoded bytes in synchronous/cooperative DC recovery, bounded
artwork fallback, progressive artwork and 16-bit artwork. All five retain their
original decoded digests and property assertions. Both independent decoders
verify their complete grids before encoded snapshots are refreshed. This brings
the final-source independent coverage to twenty-five fixture grids. All five
amended cases pass through the original tests in the targeted rerun. Thirteen
unrelated cases are filtered there and were exercised in the preceding full
suite. Strict TypeScript, browser:check, documentation:check and direct formatting
and lint checks pass again. No production source changes after the full check;
the full suite is not repeated after snapshot-only updates. The three earlier
mode/frame assertions remain unchanged and held.

## Promotion speed repairs after the effort-9 checkpoint

The reference for these repairs is `f384315a`. The effort-7 crop profile identifies
large-menu preparation, repeated coefficient reconstruction and rate-aware
rounding as the main remaining costs. Precomputing every integer centroid and
penalty does not establish a timing gain in seven cold pairs, so that change is
reverted. It has no effect on the retained production source.

The retained trial pairs reflected samples to evaluate even and odd large-DCT
frequencies together. Eighteen transform and menu tests pass with unchanged
scalar, energy, inversion and allocation bounds, including three new LF-only
footprint cases. All eighty screen files match the reference exactly. All seven
cold im26-3012 pairs also match exactly; six favor the trial, with a paired median
time delta of -6.08724%. The initial profiled run is slower, so that profile alone
does not support the speed claim. Full development now completes all sixty-four
photos and 576 points without failure; every file matches `f384315a` exactly.
Managed peak remains 34,260,047 bytes. Peer BD-rates and both baseline comparisons
are unchanged, including their existing promotion failures and 209 partial-range
warnings. The three held layout assertions are unchanged.

Fresh isolated speed covers all 192 engine jobs with no failures, omissions or
reused timing. The sixty-four own distance-2 files also match the preceding speed
run exactly. Own median falls 9.29201%, from 3,494.635 to 3,169.913ms, and mean
falls 6.46332% to 4,417.496ms. Fresh peer medians are jSquash 489.049ms and vips
342.095ms, giving ratios 6.48179x and 9.26618x. The 3x crop target still fails.
Managed speed peak remains 34,223,399 bytes; worker RSS is 291,352,576 bytes.

Both independent decoders verify eleven fresh effort-9 fixtures and three full
photo grids against our public decoder. Every native/Rust color sample is within
one code value and alpha is exact. Regenerated bundles measure 593,922 bytes for
the codec and 666,746 bytes for the specialized APIs. Existing approved check
ceilings remain 610,000 and 685,000 bytes. Bundle size remains report-only.

All eleven real Chromium cases pass with the final source, including LF-only
footprints, mixed large orders, source selection and the effort-9 progressive
fixture. The first repository check stops at stale generated documentation after
the bundle update. Regeneration and two import-order repairs precede the full
check restart; production source remains unchanged.

The restarted full check finishes with 3,875 passing tests, three failures and
three skips across 302 files. Every preceding generated, documentation, type,
package, browser graph, lint and format gate passes. The three failures remain
the unchanged layout assertions: the sparse graphic is Modular rather than
VarDCT, glyph reference/display frames are Modular rather than VarDCT, and the
screenshot has one frame rather than two. All fifteen public effort-9 tests and
all ten slow luma cases pass. The guard records exit 1 after 12m35.73s, peak
2.6 GiB, zero swap. The test suite takes 713.85s. A separate final browser:check
passes. The summary confirms the production source hash is unchanged since
measurement. These results preserve a candidate checkpoint and do not qualify
main promotion.

Scoped cleanup removes 848 reproducible decoded PNGs, reclaiming 365,984,619
bytes (349.03 MiB). Their 848 encoded streams and 272 complete result files are
preserved. The plan records all PNG, encoded-stream and metadata hashes before
deletion. Prepared inputs, peer caches, source snapshots and every score and log
remain. The active tests do not read these benchmark directories.

| Evidence | Raw artifact |
| --- | --- |
| Fresh effort-7 crop profile | `.tmp/jpegxl-lossy-lab/promotion-effort7-profile/profile-summary.json` |
| Reverted rounding lookup profile | `.tmp/jpegxl-lossy-lab/promotion-rate-lut-profile/profile-summary.json` |
| Seven rounding lookup cold pairs | `.tmp/jpegxl-lossy-lab/promotion-rate-lut-pairs/summary.json` |
| Reflected-DCT profile | `.tmp/jpegxl-lossy-lab/promotion-reflected-dct-profile/profile-summary.json` |
| Seven reflected-DCT cold pairs | `.tmp/jpegxl-lossy-lab/promotion-reflected-dct-pairs/summary.json` |
| Sixteen-photo, eighty-point screen | `.tmp/jpegxl-lossy-lab/promotion-reflected-dct-screen/summary.json` |
| Screen BD-rate against the reference | `.tmp/jpegxl-lossy-lab/promotion-reflected-dct-screen/versus-f384.json` |
| All eighty complete file comparisons | `.tmp/jpegxl-lossy-lab/promotion-reflected-dct-screen/byte-comparison.json` |
| Screen bounded execution receipt | `.tmp/jpegxl-m7/bounded-runs/promotion-reflected-dct-screen-20261010.json` |
| Full development and direct comparisons | `.tmp/jpegxl-lossy-lab/promotion-reflected-dct-full/summary.json`, `versus-f384.json`, `versus-preserved.json`, `versus-baseline.json` |
| All 576 full-lab file comparisons | `.tmp/jpegxl-lossy-lab/promotion-reflected-dct-full/byte-comparison.json` |
| Full-lab bounded execution receipt | `.tmp/jpegxl-m7/bounded-runs/promotion-reflected-dct-full-20261010.json` |
| Fresh isolated speed and comparison | `.tmp/jpegxl-lossy-lab/promotion-reflected-dct-speed/summary.json`, `versus-f384.json` |
| All sixty-four speed file comparisons and fresh-job ledger | `.tmp/jpegxl-lossy-lab/promotion-reflected-dct-speed/byte-comparison.json`, `progress.json` |
| Speed bounded execution receipt | `.tmp/jpegxl-m7/bounded-runs/promotion-reflected-dct-speed-20261010.json` |
| Fresh effort-9 independent grids | `.tmp/jpegxl-lossy-lab/promotion-reflected-dct-validation/effort9-oracles/result.json` |
| Three native/Rust/public-decoder photo grids | `.tmp/jpegxl-lossy-lab/promotion-reflected-dct-validation/photo-oracles/result.json` |
| Regenerated bundle and website measurements | `.tmp/jpegxl-lossy-lab/promotion-reflected-dct-validation/size.log` |
| Eleven real Chromium cases and bounded receipt | `.tmp/jpegxl-lossy-lab/promotion-reflected-dct-validation/chromium.log`, `.tmp/jpegxl-m7/bounded-runs/promotion-reflected-dct-chromium-20261010.json` |
| Documentation regeneration | `.tmp/jpegxl-lossy-lab/promotion-reflected-dct-validation/documentation-write.log` |
| Final full-check log, source identity and summary | `.tmp/jpegxl-lossy-lab/promotion-reflected-dct-validation/check-final.log`, `check-final-launch.json`, `final-summary.json` |
| Complete full-check bounded receipt | `.tmp/jpegxl-m7/bounded-runs/promotion-reflected-dct-check-final-20261010.json` |
| Final browser graph and type check | `.tmp/jpegxl-lossy-lab/promotion-reflected-dct-validation/browser.log` |
| Scoped decoded-PNG cleanup plan and completion | `.tmp/jpegxl-lossy-lab/promotion-reflected-dct-validation/decoded-cleanup-plan.json`, `decoded-cleanup-complete.json` |

## Reverted speed trials and the original profile

All three follow-up speed trials are reverted against `8e66f7b9`. Their fixed
sixteen-photo screens each produce eighty byte-identical files, with zero mean
and individual BD-rate changes. LF reuse has a paired median change of -0.70164%
in twenty-one confirmation pairs, with fourteen wins. The zero/unit shortcut
wins four of seven pairs. Float64 reflected transforms win only one of seven
pairs, with a paired median change of +1.07261%. These results do not establish
a retained speed gain. Original source and trial-only test snapshots are saved.
Full development and isolated aggregate speed remain the preceding measurements.

The fresh full-resolution diagnostic uses only the pinned development original
im26-2004, 2945x4417, at effort 7 and distance 2. Cold profiled encoding takes
117.526 seconds and produces 3,936,324 bytes. Large-menu evaluation is the largest
stage at 53.428 seconds inclusive. Rate-aware rounding takes 10.848 seconds
inclusive, source XYB filling takes 8.898 seconds self, and coefficient sections
take 19.807 seconds inclusive. These times overlap. The profile covers startup,
PNG preparation and hashing as well as encoding; it is not isolated speed or RSS
qualification. V8 records five microseconds of negative sample intervals, which
the reducer reports and clamps only for weighting.

Managed peak is 82,494,849 bytes (78.673 MiB), with zero live encoder allocations
at completion. The encoder unit peaks at 383.3 MiB, with zero swap. The source
hash remains `04f6766dfcf515f45f5d0a0184542a40f6f67a8bed8b3a998b964b81f51f5ed2`.
All 52,032,260 RGBA samples agree within one color code value through pinned
native libjxl, jxl-rs and our public decoder. Alpha is exact and the independent
peers also agree within one code value. This one original does not qualify the
ten-original watch set or the 5x peer speed target. The first profile harness
launch fails before encoding because the manifest parser omits dimensions; its
receipt remains preserved. The corrected harness pins dimensions, verifies the
fixture hash and passes strict TypeScript before running.

Scoped cleanup removes 324 reproducible decoded PNGs and reclaims 144,004,146
bytes (137.33 MiB). Their encoded streams and 132 complete result files remain,
with hashes recorded before deletion. Independent original decoder grids,
prepared inputs, all profiles, timing pairs and rejected source snapshots remain.
Bundles are unchanged at 593,922 and 666,746 bytes, with unchanged check ceilings
of 610,000 and 685,000 bytes. No new compression trial or effort-9 tuning occurs.

The fresh full check finishes with 3,875 passing tests, three unchanged layout
failures and three skips across 302 files. All static gates pass, including
browser:check. All fifteen public effort-9 tests, ten luma-context tests and the
large cone case pass. The suite takes 711.56 seconds; the guard records exit 1
after 12m33.07s, peak 2.4 GiB, zero swap. The final summary verifies the production
source is clean and unchanged from `8e66f7b9`. No test expectation changes.

One V8 diagnostic then checks the large-menu generator on im26-3012 at distance
2. The complete file matches the saved stream exactly. The trace shows completed
TurboFan optimization and inlined rate-aware rounding, along with cold
type-feedback and precision deoptimizations. It does not demonstrate rejection
due to function size or a steady-state JIT bottleneck. Timing from this diagnostic
is not an isolated speed comparison. The next repairs should target the measured
work: repeated XYB conversion, invariant dequantization calculations and bounded
reconstruction during coefficient-section passes.

| Evidence | Raw artifact |
| --- | --- |
| LF trial tests and initial pairs | `.tmp/jpegxl-lossy-lab/promotion-lf-validation/focused.log`, `promotion-lf-pairs/summary.json` |
| Twenty-one LF confirmation pairs | `.tmp/jpegxl-lossy-lab/promotion-lf-confirmation/summary.json` |
| LF screen and complete file comparisons | `.tmp/jpegxl-lossy-lab/promotion-lf-screen/versus-8e66.json`, `byte-comparison.json` |
| LF rejected source and test | `.tmp/jpegxl-lossy-lab/promotion-lf-validation/rejected-large-menu.ts`, `rejected-large-menu-test.ts` |
| Zero/unit trial tests and pairs | `.tmp/jpegxl-lossy-lab/promotion-zero-fast-validation/focused.log`, `promotion-zero-fast-pairs/summary.json` |
| Zero/unit screen and rejected source | `.tmp/jpegxl-lossy-lab/promotion-zero-fast-screen/versus-8e66.json`, `byte-comparison.json`, `.tmp/jpegxl-lossy-lab/promotion-zero-fast-validation/rejected-source.ts` |
| Float64 trial tests and pairs | `.tmp/jpegxl-lossy-lab/promotion-physical-dct-validation/focused.log`, `promotion-physical-dct-pairs/summary.json` |
| Float64 screen and rejected source | `.tmp/jpegxl-lossy-lab/promotion-physical-dct-screen/versus-8e66.json`, `byte-comparison.json`, `.tmp/jpegxl-lossy-lab/promotion-physical-dct-validation/rejected-source.ts` |
| Original profile receipt and reduction | `.tmp/jpegxl-lossy-lab/promotion-original-profile-r1/profile-run.json`, `profile-summary.json`, `reduction.log` |
| Original CPU samples | `.tmp/jpegxl-lossy-lab/promotion-original-profile-r1/im26-2004-d2.cpuprofile` |
| Original complete decoder comparisons | `.tmp/jpegxl-lossy-lab/promotion-original-profile-r1/decoder-result.json`, `decoders.log` |
| Failed original harness receipt | `.tmp/jpegxl-m7/bounded-runs/promotion-original-profile-20261010.json` |
| Successful original profile guard | `.tmp/jpegxl-m7/bounded-runs/promotion-original-profile-r1-20261010.json` |
| Original decoder guard | `.tmp/jpegxl-m7/bounded-runs/promotion-original-profile-decoders-20261010.json` |
| Follow-up cleanup plan and completion | `.tmp/jpegxl-lossy-lab/promotion-speed-followup-validation/decoded-cleanup-plan.json`, `decoded-cleanup-complete.json` |
| Fresh full-check log and final source summary | `.tmp/jpegxl-lossy-lab/promotion-speed-followup-validation/check-final.log`, `final-summary.json` |
| Complete follow-up check receipt | `.tmp/jpegxl-m7/bounded-runs/promotion-speed-followup-check-final-20261010.json` |
| First-party V8 trace and exact output | `.tmp/jpegxl-lossy-lab/promotion-large-menu-jit/trace.log`, `point/result.json` |
| V8 diagnostic guard receipt | `.tmp/jpegxl-m7/bounded-runs/promotion-large-menu-jit-20261010.json` |

## Tree-sorting checkpoint, 2026-10-10

The retained radix sort replaces repeated comparison sorting of exact integer
training keys. It preserves numerical key order and all split choices. Required
node storage is allocated first; an optional scratch LIMIT keeps numeric sorting.
Scratch is scoped and at most 524,288 bytes per evaluator. Eight ordering tests
and twenty-seven original lossless/palette properties pass, including the exact
streams at the original working limits. No property bound or expected value changes.

All seven cold pairs on the slowest crop, im26-1468, favor the sort, with a paired
median improvement of 18.49103%. All eighty screen and 576 full-lab files match
`a3b2c290` exactly. Every mean and individual BD-rate delta is zero. The full lab
retains 384 comparisons and 209 partial-range warnings, so its strict completeness
flag remains false. Peer, preserved-candidate and same-ladder baseline means stay
unchanged. Compression entry still fails, and holdout remains unopened.

All 192 isolated jobs are measured fresh with one worker. Own mean time falls
7.41821% to 4,089.797ms and worst time falls from 21,823.296ms to 17,698.043ms.
Median changes only -0.35406%, to 3,158.689ms. Ratios are 6.47819x jSquash and
9.18201x vips; the 3x target still fails. Managed full-lab peak rises 215,961 bytes
to 34,476,008 bytes. Isolated worker RSS rises 4.70681% to 305,065,984 bytes.
Originals remain unqualified against 5x and 131.14 MiB.

The preceding XYB reuse trial is reverted after twenty-one pairs fail to confirm
a speed gain. Reusing the tree evaluator has a small initial gain, six of seven
wins at -1.21630%, but lacks longer confirmation. Its source is saved and reverted
while the larger sorting hotspot is addressed. These are speed repairs; the
post-promotion Butteraugli phase has not started.

## Exact menu work after the bounded AC cache

The two retained changes replace repeated integer-token logarithms with the
original Float64 formula in a fixed 32,768-byte table, and avoid redundant
rate/count work for zero AC tokens. Fractional tokens and DC residuals outside
the table retain the original formula. Zero reconstruction keeps its original
multiplication. No existing expected value or quality bound changes. Eight new
signed, fractional and large-DC rate properties join the eleven menu/model
properties; all nineteen pass.

Five speed ideas were tested. Token lookup and zero-token work are retained.
Physical-dot unrolling, fixed cosine-factor lookup and LF reconstruction reuse
are reverted as neutral. One cosine confirmation overlapped a type check and
is explicitly inconclusive; its clean repeat did not establish a gain. All raw
pairs remain in each report. A fresh retained-stack profile still identifies
large-menu work as the leading own hotspot.

All eighty screen and 576 full-development files match the committed source at
`07e02607` exactly. Every mean and individual own BD-rate delta is zero. All 64
development photos and 384 comparisons contribute; the preceding 209
partial-range warnings remain. Full means versus jSquash are -1.73288% SSIM,
+12.75170% 3-norm and +15.74935% max. Current vips means are +0.66928%,
+9.42715% and +7.43563%. Same-ladder baseline deltas remain -2.37865%,
-2.51067% and +3.17892%. Earlier effort-migration and individual-image entry
failures remain; holdout stays unopened. The full guard takes 8m35.95s at
1.4 GiB with zero swap, and managed peak stays 34,260,047 bytes.

Fresh isolated speed measures all 192 engine jobs without reuse or failures.
Own median is 2,491.268ms against jSquash 485.562ms and vips 338.595ms:
5.13069x and 7.35766x. Median falls 6.96705% and mean falls 3.71302% to
3,341.039ms versus the preceding candidate. Worst rises 1.83659% to
15,396.812ms. All 64 own files match exactly. Managed peak stays 34,223,399
bytes; worker RSS rises 2.80923% to 306,847,744 bytes. The guard takes 6m27.41s
at 410.9 MiB with zero swap. This is a retained speed gain; the 3x target and
original qualification still fail.

Seventeen fresh native/Rust grids agree within one native color code with exact
alpha, including eleven effort-9 cases. Effort 9 remains untuned; its
comparison screen waits for promotion. All 29 earlier Chromium cases pass.
An added thirtieth case fails its Node VarDCT assertion before reaching the
browser. A source control at the preceding committed hash reproduces its
5,265-byte Modular result against 32,896 conservative bytes. This is the same
held palette/mode contract, not a new compression change. Its assertion is
unchanged. The current source is restored and verified after that separate
control. Oracle guard: 1m1.11s, 430.2 MiB. Browser guard: 4m38.01s, 2.1 GiB.
Control guard: 4.08s, 243.8 MiB. Every run has zero swap.

Bundles are 597,042 and 669,863 bytes, each up 189 bytes. Approved check ceilings
stay 610,000 and 685,000. Bundle size remains a report, not a promotion gate.
Scoped cleanup removes 1,056 reproducible decoded PNGs, reclaiming 470,963,259
bytes (449.15 MiB), with their 1,056 JXL files and 480 complete results retained.
Deletion receipts contain PNG, encoded and metadata hashes. Source snapshots,
profiles, inputs, scores and independent grids remain. The full repository
check has 3,902 passes, the same three held layout failures and three skips
across 304 files. Every static gate passes, including browser:check and
unchanged ceilings. The suite takes 500.34s; the complete guard takes 9m46.20s
at 2.6 GiB with zero swap. Final qualification verifies that the source matches
the measured source after the separate committed-source control. No temporary
file is staged, and main promotion remains open.

| Evidence | Raw artifact |
| --- | --- |
| Post-cache and retained-token CPU profiles | `.tmp/jpegxl-lossy-lab/promotion-post-cache-profile/profile-summary.json`, `.tmp/jpegxl-lossy-lab/promotion-menu-rate-profile/profile-summary.json` |
| Neutral physical-loop repeat | `.tmp/jpegxl-lossy-lab/promotion-physical-unroll-r1-pairs/summary.json`, `statistics.json`, `.tmp/jpegxl-lossy-lab/promotion-physical-unroll-r1-validation/source.ts` |
| Token lookup and confirmation | `.tmp/jpegxl-lossy-lab/promotion-menu-rate-pairs/summary.json`, `.tmp/jpegxl-lossy-lab/promotion-menu-rate-confirmation/summary.json`, `statistics.json` |
| Cosine trial and clean confirmation | `.tmp/jpegxl-lossy-lab/promotion-lf-factors-pairs/summary.json`, `.tmp/jpegxl-lossy-lab/promotion-lf-factors-confirmation/summary.json`, `.tmp/jpegxl-lossy-lab/promotion-lf-factors-clean/summary.json`, `statistics.json` |
| Neutral LF reuse | `.tmp/jpegxl-lossy-lab/promotion-lf-reuse-pairs/summary.json`, `statistics.json`, `.tmp/jpegxl-lossy-lab/promotion-lf-reuse-validation/source.ts` |
| Zero-token work and confirmation | `.tmp/jpegxl-lossy-lab/promotion-menu-zero-pairs/summary.json`, `.tmp/jpegxl-lossy-lab/promotion-menu-zero-confirmation/summary.json`, `statistics.json` |
| Frozen current source and tests | `.tmp/jpegxl-lossy-lab/promotion-menu-work-validation/frozen-source.json`, `source.ts`, `test.ts`, `restored-source.json` |
| Fixed screen and full development | `.tmp/jpegxl-lossy-lab/promotion-menu-work-screen/versus-07e.json`, `byte-comparison.json`, `.tmp/jpegxl-lossy-lab/promotion-menu-work-full/summary.json`, `byte-comparison.json`, `versus-07e.json`, `versus-preserved.json`, `versus-baseline.json` |
| Fresh isolated speed | `.tmp/jpegxl-lossy-lab/promotion-menu-work-speed/summary.json`, `versus-07e.json`, `byte-comparison.json`, `progress.json` |
| Full native/Rust grids | `.tmp/jpegxl-lossy-lab/promotion-menu-work-validation/lossless-oracles/result.json`, `effort9-oracles/result.json`, `photo-oracles/result.json` |
| Chromium and committed-source mode control | `.tmp/jpegxl-lossy-lab/promotion-menu-work-validation/browser.log`, `baseline-mode-control.json`, `baseline-mode-control.log` |
| Bundle, generated documentation and repository check | `.tmp/jpegxl-lossy-lab/promotion-menu-work-validation/size.log`, `documentation-write.log`, `check.log`, `final-summary.json` |
| Scoped cleanup | `.tmp/jpegxl-lossy-lab/promotion-menu-work-validation/decoded-cleanup-plan.json`, `decoded-cleanup-complete.json` |

Bounded receipt IDs begin with `promotion-menu-`, `promotion-lf-` and
`promotion-physical-unroll-r1-` under `.tmp/jpegxl-m7/bounded-runs/`.
The next hypotheses are a provably-zero shortcut before rate-aware rounding,
estimated effort-7 AC model choice before complete serialization, and reuse of
original quantized coefficients in baseline menus. No source is copied from
another codec implementation. Main remains unchanged.

Seventeen fresh complete grids pass both native libjxl and jxl-rs within one code
value with exact alpha. They cover three affected lossless cases, eleven effort-9
cases and three photos. All eleven learned-palette/lossless Chromium cases pass.
The full check has 3,883 passing tests, three unchanged layout failures and three
skips across 303 files. All static gates, including browser:check, pass. The suite
takes 551.60s; the guard takes 9m53.50s at 2.5 GiB with zero swap. Current source
hash is `aa533430a31d3657642e61ce6c5875c690c70272a7382d1d1c4c32567ed6db71`.

Bundles are 594,832 and 667,649 bytes, with unchanged ceilings of 610,000 and
685,000 bytes. Effort 9 remains untuned; its comparison screen waits for promotion.
Cleanup removes 1,012 reproducible PNGs and reclaims 439,879,813 bytes (419.50 MiB),
preserving all 1,012 corresponding JXL files and 372 result files. Deletion
records include PNG, JXL and metadata hashes. Inputs, scores, peer curves, source
snapshots, profiles and independent decoder grids remain. No temporary file is
checked in.

| Evidence | Raw artifact |
| --- | --- |
| XYB focused tests and rejected source | `.tmp/jpegxl-lossy-lab/promotion-xyb-reuse-validation/focused.log`, `transforms.log`, `rejected-source.ts` |
| XYB twenty-one-pair confirmation | `.tmp/jpegxl-lossy-lab/promotion-xyb-reuse-confirmation/summary.json` |
| XYB identical screen | `.tmp/jpegxl-lossy-lab/promotion-xyb-reuse-screen/versus-a3b2.json`, `byte-comparison.json` |
| Slowest-crop CPU profile and reduction | `.tmp/jpegxl-lossy-lab/promotion-slow-crop-profile/profile-run.json`, `profile-summary.json`, `im26-1468-d2.cpuprofile` |
| Shelved evaluator tests, source and pairs | `.tmp/jpegxl-lossy-lab/promotion-tree-kernel-validation/focused.log`, `source.ts`, `.tmp/jpegxl-lossy-lab/promotion-tree-kernel-pairs/summary.json` |
| Sort ordering and original properties | `.tmp/jpegxl-lossy-lab/promotion-tree-radix-validation/sort.log`, `focused.log`, `types.log` |
| Seven counterbalanced sort pairs | `.tmp/jpegxl-lossy-lab/promotion-tree-radix-pairs/summary.json` |
| Sort screen and exact files | `.tmp/jpegxl-lossy-lab/promotion-tree-radix-screen/summary.json`, `versus-a3b2.json`, `byte-comparison.json` |
| Full development and exact files | `.tmp/jpegxl-lossy-lab/promotion-tree-radix-full/summary.json`, `byte-comparison.json` |
| Full same-ladder comparisons | `.tmp/jpegxl-lossy-lab/promotion-tree-radix-full/versus-a3b2.json`, `versus-preserved.json`, `versus-baseline.json` |
| Fresh isolated timing and exact files | `.tmp/jpegxl-lossy-lab/promotion-tree-radix-speed/summary.json`, `versus-a3b2.json`, `byte-comparison.json`, `progress.json` |
| Complete native/Rust grids | `.tmp/jpegxl-lossy-lab/promotion-tree-radix-validation/lossless-oracles/result.json`, `effort9-oracles/result.json`, `photo-oracles/result.json` |
| Real Chromium and full check | `.tmp/jpegxl-lossy-lab/promotion-tree-radix-validation/browser.log`, `check.log`, `final-summary.json` |
| Bundle and generated documentation | `.tmp/jpegxl-lossy-lab/promotion-tree-radix-validation/size.log`, `documentation-write.log` |
| Scoped cleanup plan and completion | `.tmp/jpegxl-lossy-lab/promotion-tree-radix-validation/decoded-cleanup-plan.json`, `decoded-cleanup-complete.json` |

All bounded-run receipts for this checkpoint have IDs beginning
`promotion-tree-radix-` under `.tmp/jpegxl-m7/bounded-runs/`. The next speed
hypotheses are constant-feature prefix scans, invariant menu dequantization and
bounded reconstruction reuse. Main remains unchanged; no promotion is claimed.

## Prefix checkpoint, 2026-10-10

The post-sort profile attributes 5.491s self time to the tree evaluator and
2.003s to radix sorting on im26-1468 at distance 2. Local histogram accumulators
retain Float64 operation order and Uint32 extra-bit sums, while removing three
small per-node arrays. Reusing the next boundary value avoids decoding that
feature value again. The constant-feature shortcut is reverted after seven
pairs show only a -0.22280% median change with mixed results.

All twenty-seven original lossless/palette tests pass for each prefix trial,
including both pinned streams at the original working limits. Accumulators win
all seven counterbalanced cold pairs at -7.50174%. Boundary reuse wins six of
seven initial pairs at -1.17283%, then all fifteen confirmation pairs at
-2.40882% against the frozen accumulator source. Median/MAD and dispersion
statistics are preserved separately. These are crop trials; the fresh aggregate
measurement below determines the promotion speed result.

Both eighty-point screens match their preceding sources exactly. All 576
full-development files match `5f841916` exactly; mean and individual BD-rate
deltas are zero. All 384 comparisons compute, with the same 209 partial-range
warnings, so strict required-range completeness stays false. Peer means and
same-ladder baseline deltas are unchanged. The full run takes 10m0.87s with
1.3 GiB cgroup peak and zero swap. Managed peak falls sixty bytes to 34,475,948.
Compression entry still fails, and holdout remains unopened. Source hash is
`235f1995388049659a3999d8f5cfb5c7ac20a09e7fad8df47f27c06e1b7cc66f`.

All 192 isolated jobs are measured fresh with one worker. Own mean time falls
1.13815% to 4,043.249ms and worst time falls 4.77606% to 16,852.773ms against
`5f841916`. Median rises 0.58628% to 3,177.208ms; no meaningful median gain is
claimed. Fresh jSquash and vips medians are 492.950ms and 350.410ms, giving
6.44530x and 9.06712x ratios. All sixty-four own files match the preceding
checkpoint. The 3x target still fails. Isolated worker RSS falls 2.65712% to
296,960,000 bytes, while managed peak falls sixty bytes to 34,439,300 bytes.
Originals remain unqualified against 5x and 131.14 MiB.

Seventeen fresh complete grids pass both native libjxl and jxl-rs within one
native color code, with exact alpha. They cover three affected lossless cases,
eleven effort-9 fixtures and three development photos. All eleven learned
palette and lossless Chromium cases pass. All static gates, including
browser:check and unchanged bundle ceilings, pass. The complete repository
check has 3,883 passing tests, the same three held layout failures and three
skips across 303 files. The suite takes 876.27s; the guard takes 15m41.17s at
2.6 GiB with zero swap. No property threshold or expected value changes.

Bundles are 594,996 and 667,818 bytes; ceilings remain 610,000 and 685,000
bytes. Effort 9 remains untuned; its comparison screen waits for promotion.
Cleanup removes 1,000 reproducible PNGs and reclaims 430,099,589 bytes
(410.17 MiB), preserving all 1,000 corresponding JXL files and 360 result
files. The deletion records retain PNG, JXL and metadata hashes. Inputs,
scores, peer curves, source snapshots, profiles and independent decoder grids
remain. No temporary file is checked in.

| Evidence | Raw artifact |
| --- | --- |
| Post-sort profile and source | `.tmp/jpegxl-lossy-lab/promotion-post-sort-profile/profile-run.json`, `profile-summary.json`, `im26-1468-d2.cpuprofile` |
| Reverted constant-feature trial | `.tmp/jpegxl-lossy-lab/promotion-constant-feature-validation/focused.log`, `rejected-source.ts`, `.tmp/jpegxl-lossy-lab/promotion-constant-feature-pairs/summary.json`, `statistics.json` |
| Accumulator tests, source and pairs | `.tmp/jpegxl-lossy-lab/promotion-local-prefix-validation/focused.log`, `source.ts`, `.tmp/jpegxl-lossy-lab/promotion-local-prefix-pairs/summary.json`, `statistics.json` |
| Cursor tests, source and initial pairs | `.tmp/jpegxl-lossy-lab/promotion-feature-cursor-validation/focused.log`, `source.ts`, `.tmp/jpegxl-lossy-lab/promotion-feature-cursor-pairs/summary.json`, `statistics.json` |
| Fifteen cursor confirmation pairs | `.tmp/jpegxl-lossy-lab/promotion-feature-cursor-confirmation/summary.json`, `statistics.json` |
| Accumulator screen and complete byte comparison | `.tmp/jpegxl-lossy-lab/promotion-local-prefix-screen/versus-5f84.json`, `byte-comparison.json` |
| Cursor screen and complete byte comparison | `.tmp/jpegxl-lossy-lab/promotion-feature-cursor-screen/versus-LL113.json`, `byte-comparison.json` |
| Full development and byte comparison | `.tmp/jpegxl-lossy-lab/promotion-local-prefix-full/summary.json`, `reduction.json`, `byte-comparison.json` |
| Full same-ladder comparisons | `.tmp/jpegxl-lossy-lab/promotion-local-prefix-full/versus-5f84.json`, `versus-preserved.json`, `versus-baseline.json` |
| Frozen production source | `.tmp/jpegxl-lossy-lab/promotion-local-prefix-validation/frozen-source.json` |
| Fresh isolated timing and exact files | `.tmp/jpegxl-lossy-lab/promotion-local-prefix-speed/summary.json`, `versus-5f84.json`, `byte-comparison.json`, `progress.json` |
| Complete native/Rust grids | `.tmp/jpegxl-lossy-lab/promotion-local-prefix-validation/lossless-oracles/result.json`, `effort9-oracles/result.json`, `photo-oracles/result.json` |
| Real Chromium and full check | `.tmp/jpegxl-lossy-lab/promotion-local-prefix-validation/browser.log`, `check.log`, `final-summary.json` |
| Bundles and generated documentation | `.tmp/jpegxl-lossy-lab/promotion-local-prefix-validation/size.log`, `documentation-write.log` |
| Scoped cleanup plan and completion | `.tmp/jpegxl-lossy-lab/promotion-local-prefix-validation/decoded-cleanup-plan.json`, `decoded-cleanup-complete.json` |

Bounded-run receipts use the IDs `promotion-post-sort-profile-20261010`,
`promotion-constant-feature-*`, `promotion-local-prefix-*` and
`promotion-feature-cursor-*` under `.tmp/jpegxl-m7/bounded-runs/`.
The next speed hypotheses are exact integer bit lengths in weighted prediction,
invariant menu dequantization and bounded reconstruction reuse. Main remains
unchanged; no promotion is claimed.

## Weighted-predictor and tree-storage checkpoint, 2026-10-11

Weighted prediction now uses exact Uint32 bit lengths instead of logarithms,
including the error-plus-one boundary at 2^32. Five new integer-boundary cases
pass with the original twenty-seven learned lossless/palette properties and
seven global Modular palette/squeeze cases. A temporary comparison against
the frozen first-party reference matches 80,685 seeded and boundary predictions.
No property threshold or existing expected value changes.

The initial timing attempt overlaps an external eight-worker test suite and
stops after two complete pairs. The excluded rows and terminal receipt remain.
After that suite exits, all seven clean counterbalanced cold pairs on im26-1468
favor the repair: paired median -4.19198%, MAD 0.34925 percentage points.
Base median/MAD is 16,668.238/141.753ms; candidate is 16,027.722/153.608ms.
This result applies to one slow crop, not the aggregate speed target.

The physical-DCT unroll remains shelved. Seven initial pairs favor it in four
cases, with paired median -2.38727% and MAD 2.21533 percentage points. The
fifteen-pair confirmation overlaps a second external test/typecheck batch.
All fifteen files remain identical, but dispersion rises: median -2.39795%,
MAD 4.61240 percentage points, ten wins. That run finishes before the requested
stop. No subset is used; the original transform source is restored, and the
trial source and all measurements remain available for a clean comparison.

The retained tree repair derives extra-bit counts from already stored tokens.
It removes up to 196,608 bytes per learner and every corresponding sample
write, adding one 256-byte module table. All 39 focused cases pass unchanged,
including constrained-memory pinned streams and fallback behavior. Seven
im26-1468 pairs give six wins, paired median -0.97108%, MAD 0.88539 percentage
points. Seven neighboring im26-3012 pairs give five wins, median -1.00570%,
MAD 0.81881 percentage points. Those small speed gains remain unconfirmed;
retention rests on the deterministic allocation and work reduction with no
observed representative regression.

Both eighty-point screens are byte-identical to their respective preceding
sources. All 576 full-development files match `2a8ad950` exactly; every mean
and individual BD-rate delta is zero. Peer means and the full-lab same-ladder
baseline deltas remain unchanged. All 384 comparisons compute, with the same
209 partial-range warnings. Strict required-range completeness stays false.
The full run takes 9m54.10s with 1.3 GiB cgroup peak and zero swap. Managed
peak falls 215,901 bytes to 34,260,047. Compression entry still fails and
holdout remains unopened. Frozen production source hash is
`873de65f124897c2d0fc9cd8e9d5345110a8a9e95022ee2f13b8a435b0d6b212`.

All 192 isolated speed jobs finish with fresh timings, no failures and no
omissions. All 64 own files match the previous checkpoint. Own mean falls
3.51623% to 3,901.078ms and worst falls 7.80833% to 15,536.853ms. Median
falls 1.01913% to 3,144.828ms; no meaningful median gain is claimed. Fresh
jSquash and vips medians are 492.293ms and 343.961ms, giving 6.38812x and
9.14298x ratios. The 3x target still fails. Managed peak falls 215,901 bytes
to 34,223,399, while worker RSS is 297,627,648 bytes, up 0.22483%. The
single-worker run takes 7m5.54s at 427.8 MiB cgroup peak with zero swap.
The background build processes observed at startup become idle; subsequent
host checks show no competing test batch.

Seventeen fresh complete fixture/photo grids agree in both native libjxl and
jxl-rs within one native color code, with exact alpha. They cover three
affected lossless cases, eleven effort-9 cases and three development photos.
All eleven learned-palette/lossless Chromium cases pass, including constrained
memory, both depths and group boundaries. Decoder guard: 1m2.70s, 413.1 MiB;
browser guard: 2m57.78s, 2 GiB; zero swap. Bundles measure 594,993 and
667,807 bytes; ceilings remain 610,000 and 685,000. Effort 9 remains untuned,
and its comparison screen waits for promotion.

Scoped cleanup removes 1,014 reproducible PNGs and reclaims 440,889,223 bytes
(420.46 MiB), preserving 1,014 corresponding JXL files and 374 result files.
The deletion records retain PNG, JXL and metadata hashes. Inputs, scores,
peer curves, source snapshots, profiles and independent decoder grids remain,
along with the excluded partial timing artifacts. No temporary file is staged.

All static gates, including browser:check and unchanged ceilings, pass. The
complete repository check has 3,888 passes, the same three held frame/layout
failures and three skips across 304 files. The suite takes 505.63s; the guard
takes 9m7.95s at 2.5 GiB with zero swap. The final summary verifies that the
source stays frozen through measurement and qualification. No property bound
or existing expected value changes. Main remains unchanged, holdout stays
closed, and no promotion is claimed.

| Evidence | Raw artifact |
| --- | --- |
| Weighted arithmetic comparison and new boundary cases | `.tmp/jpegxl-lossy-lab/promotion-weighted-validation/kernel.json`, `focused.log`, `types.log`, `source.ts` |
| Excluded partial weighted timing | `.tmp/jpegxl-lossy-lab/promotion-weighted-pairs/rows.json`, `.tmp/jpegxl-m7/bounded-runs/promotion-weighted-pairs-20261011.json` |
| Clean seven-pair weighted result | `.tmp/jpegxl-lossy-lab/promotion-weighted-pairs-r1/summary.json`, `statistics.json` |
| Weighted screen and complete byte comparison | `.tmp/jpegxl-lossy-lab/promotion-weighted-screen/versus-2a8a.json`, `byte-comparison.json` |
| Shelved unroll source and focused tests | `.tmp/jpegxl-lossy-lab/promotion-physical-unroll-validation/source.ts`, `focused.log`, `coefficients.log`, `coefficients-r1.log` |
| Initial and contaminated confirmation pairs | `.tmp/jpegxl-lossy-lab/promotion-physical-unroll-pairs/summary.json`, `statistics.json`, `.tmp/jpegxl-lossy-lab/promotion-physical-unroll-confirmation/summary.json`, `statistics.json` |
| Storage tests and frozen identity | `.tmp/jpegxl-lossy-lab/promotion-extra-bit-validation/focused.log`, `frozen-source.json`, `types.log`, `biome.log` |
| Storage slow-crop and neighbor pairs | `.tmp/jpegxl-lossy-lab/promotion-extra-bit-pairs/summary.json`, `statistics.json`, `.tmp/jpegxl-lossy-lab/promotion-extra-bit-neighbor/summary.json`, `statistics.json` |
| Storage screen and complete byte comparison | `.tmp/jpegxl-lossy-lab/promotion-extra-bit-screen/versus-LL121.json`, `byte-comparison.json` |
| Full development and complete byte comparison | `.tmp/jpegxl-lossy-lab/promotion-extra-bit-full/summary.json`, `reduction.json`, `byte-comparison.json` |
| Full same-ladder comparisons | `.tmp/jpegxl-lossy-lab/promotion-extra-bit-full/versus-2a8a.json`, `versus-preserved.json`, `versus-baseline.json` |
| Fresh isolated timing and exact files | `.tmp/jpegxl-lossy-lab/promotion-extra-bit-speed/summary.json`, `versus-2a8a.json`, `byte-comparison.json`, `progress.json` |
| Complete native/Rust grids | `.tmp/jpegxl-lossy-lab/promotion-extra-bit-validation/lossless-oracles/result.json`, `effort9-oracles/result.json`, `photo-oracles/result.json` |
| Real Chromium and full check | `.tmp/jpegxl-lossy-lab/promotion-extra-bit-validation/browser.log`, `check.log`, `final-summary.json` |
| Bundles and generated documentation | `.tmp/jpegxl-lossy-lab/promotion-extra-bit-validation/size.log`, `documentation-write.log` |
| Scoped cleanup plan and completion | `.tmp/jpegxl-lossy-lab/promotion-extra-bit-validation/decoded-cleanup-plan.json`, `decoded-cleanup-complete.json` |

Bounded-run receipt IDs start with `promotion-weighted-`,
`promotion-physical-unroll-` and `promotion-extra-bit-` under
`.tmp/jpegxl-m7/bounded-runs/`. The next speed hypotheses are bounded
reconstruction reuse, a clean physical-dot unroll confirmation and invariant
dequantization steps. The bounded post-promotion Butteraugli phase has not
started.

## Bounded AC reconstruction cache, 2026-10-11

The candidate retains up to four compact AC groups after strategy and
quantization selection. Consumers use the existing primary coefficient storage.
Inactive cached copies are released before an allocation would exceed the
original working-memory limit. At most 1,589,248 additional bytes are retained,
independent of source dimensions. No compression tool or effort-9 search changes.
The measured production source hash is
`cd91503f0e0cb99caf56e6efe39d076fe106538fd8e6aa8dc433dd2bbce95b38`.

All 27 public encoder comparisons match `91d320eb` byte for byte across depth,
progressive mode, alpha and working budgets. A six-group fixture exercises cache
eviction. All eighteen focused tests pass, including six new lifecycle cases
and twelve original quality, size, storage and cancellation properties. The
prototype and safe implementation each win all seven ordinary-crop cold pairs.
The safe implementation's paired median is -13.46462%, with 1.05826 percentage
points MAD. The slower neighbor has six wins in seven pairs, paired median
-1.38866%, with no separate small-gain claim.

All eighty screen files, 576 full-development files and 64 isolated-speed files
match the preceding checkpoint exactly. All mean and individual BD-rate deltas
are zero. Full development finishes in 8m45.83s at 1.3 GiB with zero swap.
All 384 comparisons compute; 209 partial-range warnings remain and strict
required-range completeness stays false. The same-ladder baseline deltas and
both peer columns remain in the lab log. Compression entry still fails and
holdout remains unopened.

All 192 isolated engine jobs are fresh, with one worker and no failures or
omissions. Own median falls 14.84960% to 2,677.834ms, mean falls 11.05342% to
3,469.876ms and worst falls 2.68856% to 15,119.135ms against `91d320eb`.
Fresh jSquash median 487.368ms and vips 339.625ms give ratios 5.49448x and
7.88468x. The 3x target still fails. Managed peaks remain 34,260,047 bytes
in full development and 34,223,399 bytes in isolated speed. Worker RSS rises
0.28075% to 298,463,232 bytes. The timing guard takes 6m35.90s, peaks at
408.5 MiB and uses no swap.

Seventeen fresh native/Rust grids pass within one native color code with exact
alpha, including eleven effort-9 fixtures. All 29 Chromium cases pass, covering
multigroup coefficient orders, family contexts, constrained-memory fallbacks,
learned palettes and lossless encoding. Decoder guard: 1m0.89s, 451.3 MiB;
browser guard: 4m33.22s, 1.8 GiB; zero swap. Effort 9 remains untuned and its
comparison screen waits for promotion. Bundles are 596,853 / 669,674 bytes;
ceilings remain 610,000 / 685,000 and size is report-only.

Cleanup removes 890 regenerated PNGs and reclaims 385,997,395 bytes
(368.12 MiB). Their 890 JXL files and 314 complete result files remain. The
deletion records retain PNG, JXL and metadata hashes. Inputs, encoded streams,
scores, peer curves, source snapshots, profiles and independent grids remain.
All static gates, including browser:check and unchanged ceilings, pass. The
complete repository check has 3,894 passes, the same three held frame/layout
failures and three skips across 304 files. The suite takes 615.93s; the guard
takes 11m41.85s at 2.7 GiB with zero swap. The final summary verifies unchanged
production source through measurement and qualification. No property bound or
existing expected value changes. No temporary file is staged and no main
promotion is claimed.

| Evidence | Raw artifact |
| --- | --- |
| Prototype source and initial timing | `.tmp/jpegxl-lossy-lab/promotion-ac-cache-validation/prototype.ts`, `.tmp/jpegxl-lossy-lab/promotion-ac-cache-pairs/summary.json`, `statistics.json` |
| Safe source, memory comparisons and focused tests | `.tmp/jpegxl-lossy-lab/promotion-ac-cache-validation/frozen-source.json`, `source.ts`, `memory.ts`, `budgets.json`, `focused.log`, `reclaimers-r2.log`, `biome-r1.log` |
| Safe ordinary-crop and neighbor timing | `.tmp/jpegxl-lossy-lab/promotion-ac-cache-pairs-r1/summary.json`, `statistics.json`, `.tmp/jpegxl-lossy-lab/promotion-ac-cache-neighbor/summary.json`, `statistics.json` |
| Fixed screen and exact output | `.tmp/jpegxl-lossy-lab/promotion-ac-cache-screen/summary.json`, `versus-91d.json`, `byte-comparison.json` |
| Full development and exact output | `.tmp/jpegxl-lossy-lab/promotion-ac-cache-full/summary.json`, `reduction.json`, `byte-comparison.json` |
| Full same-ladder comparisons | `.tmp/jpegxl-lossy-lab/promotion-ac-cache-full/versus-91d.json`, `versus-preserved.json`, `versus-baseline.json` |
| Fresh isolated timing and exact files | `.tmp/jpegxl-lossy-lab/promotion-ac-cache-speed/summary.json`, `versus-91d.json`, `byte-comparison.json`, `progress.json` |
| Complete native/Rust grids | `.tmp/jpegxl-lossy-lab/promotion-ac-cache-validation/lossless-oracles/result.json`, `effort9-oracles/result.json`, `photo-oracles/result.json` |
| Chromium, bundle and documentation checks | `.tmp/jpegxl-lossy-lab/promotion-ac-cache-validation/browser.log`, `size.log`, `documentation-write.log` |
| Full check | `.tmp/jpegxl-lossy-lab/promotion-ac-cache-validation/check.log`, `final-summary.json` |
| Scoped cleanup | `.tmp/jpegxl-lossy-lab/promotion-ac-cache-validation/decoded-cleanup-plan.json`, `decoded-cleanup-complete.json` |

Bounded-run receipt IDs start with `promotion-ac-cache-` under
`.tmp/jpegxl-m7/bounded-runs/`. The next speed hypotheses are profiling the
remaining transform-selection work, a clean physical-dot unroll confirmation
and invariant dequantization steps. Main is unchanged. The bounded
post-promotion Butteraugli phase has not started.

## Effort-7 single-stream selection, 2026-10-11

Two speed repairs are retained against `1ce9c615`. Rate-aware rounding returns
zero immediately below half the existing unit centroid, where the original
squared-error and nonnegative rate costs already choose zero. Fifteen cold
pairs preserve complete files, twelve wins, with a paired median improvement
of 1.92017%. Its eighty-point screen is identical. Effort 7 then selects
order/family geometry before writing sections; effort 9 retains the complete
comparison. Twenty original order/family properties pass. The original
7,350,000-byte order-budget test now also checks synchronous ownership and
cleanup without changing its size, pixel or alpha expectations.

Full development finishes all 64 photos and 576 points with zero encode
failures. Thirty-seven files change. Incremental means are +0.10886% SSIM,
+0.10225% 3-norm and +0.09137% max; every individual change stays below 1.22%.
These pass the incremental speed-only and repair guards. Full means versus
jSquash are -1.63003%, +12.86651% and +15.85564%; current vips means are
+0.77349%, +9.54668% and +7.53200%. Same-ladder baseline deltas are
-2.26705%, -2.40864% and +3.28058%. All 384 comparisons contribute; the 209
earlier partial-range warnings remain. Existing development entry failures
remain, and holdout stays closed. The guard takes 8m8.65s at 1.2 GiB with zero
swap; managed peak stays 34,260,047 bytes.

Fresh isolated speed finishes all 192 jobs without reuse or failures. Own
median is 2,281.628ms versus jSquash 484.886ms and vips 338.857ms: 4.70549x
and 6.73330x. Median improves 8.41497%, mean improves 4.68898% to 3,184.378ms,
and worst improves 0.51546% to 15,317.447ms. Two of 64 files change. Managed
peak stays 34,223,399 bytes; worker RSS falls 3.57877% to 295,866,368 bytes.
The guard takes 6m17.34s at 445.9 MiB with zero swap. The 3x target still fails;
originals remain unqualified. Twenty-one fresh native/Rust grids pass, including
eleven effort-9 fixtures and four changed development streams. Color agreement
stays within one native code, with exact alpha. Oracle guard: 1m2.60s at
448.9 MiB, zero swap. Effort 9 remains untuned and its one comparison screen
waits for promotion.

The current profile identifies large-menu selection at 0.54796s self and
1.02026s inclusive, with rate-aware rounding at 0.21603s self. Profile time is
diagnostic, not a paired speed claim. Next hypotheses are combining menu
quantization and physical-error passes, reusing original quantized coefficients
in baseline menus and reusing the selected histogram model during serialization.
No compression trial or main promotion occurs in this checkpoint.

| Evidence | Raw artifact |
| --- | --- |
| Zero shortcut and timing confirmation | `.tmp/jpegxl-lossy-lab/promotion-quantizer-zero-validation/`, `.tmp/jpegxl-lossy-lab/promotion-quantizer-zero-confirmation/summary.json`, `statistics.json` |
| Zero shortcut's unchanged screen | `.tmp/jpegxl-lossy-lab/promotion-quantizer-zero-screen/versus-1ce9.json`, `byte-comparison.json` |
| Selected source, original properties and added ownership checks | `.tmp/jpegxl-lossy-lab/promotion-order-single-validation/frozen-source.json`, `final-source.ts`, `focused.log`, `order-ownership.log`, `types.log`, `lint.log` |
| Single-stream repair screen | `.tmp/jpegxl-lossy-lab/promotion-order-single-screen/versus-retained.json`, `byte-comparison.json` |
| Full development and same-ladder comparisons | `.tmp/jpegxl-lossy-lab/promotion-order-single-full/summary.json`, `reduction.json`, `byte-comparison.json`, `versus-1ce9.json`, `versus-preserved.json`, `versus-baseline.json` |
| Fresh isolated speed | `.tmp/jpegxl-lossy-lab/promotion-order-single-speed/summary.json`, `versus-1ce9.json`, `byte-comparison.json`, `progress.json` |
| Complete native/Rust grids | `.tmp/jpegxl-lossy-lab/promotion-order-single-validation/lossless-oracles/result.json`, `effort9-oracles/result.json`, `photo-oracles/result.json` |
| Current CPU profile | `.tmp/jpegxl-lossy-lab/promotion-order-single-profile/profile-run.json`, `profile-summary.json`, `im26-3012-d2.cpuprofile` |

The final repository check has 3,902 passes, the same three held mode/frame
failures and three skips across 304 files. Every static gate passes, including
browser:check and unchanged ceilings. The suite takes 503.68s; the complete
guard takes 9m49.61s at 2.9 GiB with zero swap. Final qualification verifies
that production source matches the measured source. All 29 final-source
Chromium cases pass in a 4m15.15s guard at 2.2 GiB, zero swap. The earlier
held Node mode control remains retained under the preceding checkpoint.

Bundles are 597,243 and 670,064 bytes, each up 201 bytes. Approved ceilings
remain 610,000 and 685,000; bundle size remains report-only. Cleanup removes
973 regenerated PNGs and reclaims 422,565,986 bytes (402.99 MiB), retaining
their 973 JXL files and 333 complete results. Inputs, scores, source snapshots,
CPU profiles and independent decoder grids remain. No existing expected value,
bound, runtime dependency or release version changes. Two speed repairs are
retained, none reverted or promoted. Main remains unchanged.

| Final qualification | Raw artifact |
| --- | --- |
| Chromium and full repository check | `.tmp/jpegxl-lossy-lab/promotion-order-single-validation/browser.log`, `check.log`, `final-summary.json` |
| Bundle and generated documentation | `.tmp/jpegxl-lossy-lab/promotion-order-single-validation/size.log`, `documentation-write.log` |
| Scoped cleanup | `.tmp/jpegxl-lossy-lab/promotion-order-single-validation/decoded-cleanup-plan.json`, `decoded-cleanup-complete.json` |

Bounded-run receipt IDs start with `promotion-order-single-` under
`.tmp/jpegxl-m7/bounded-runs/`. Zero-shortcut receipt IDs start with
`promotion-quantizer-zero-`. The post-promotion Butteraugli phase has not started.

## Fused large-menu correlation and error, 2026-10-11

The candidate remains unpromoted. The retained repair restores AC color
correlations while measuring physical error, avoiding a separate scratch-buffer
pass. Physical LF and Float64 addition order stay the same. Four speed ideas
were tried: this repair is retained, while combined quantization/error loops,
source reuse and redundant coefficient-clear removal were reverted after timing.
No compression trial or effort-9 tuning took place.

All eighty screen files, 576 full-development files and sixty-four timed files
match `80f1c42c` exactly. All mean and individual BD-rate deltas are zero.
The full lab has no encode failures; all 384 comparisons contribute, retaining
the 209 prior partial-range warnings.

| Full development mean BD-rate | jSquash 1.3.0 reference | wasm-vips 0.0.19 target | Same-ladder baseline delta |
| --- | ---: | ---: | ---: |
| SSIMULACRA2 | -1.63003% | +0.77349% | -2.26705% |
| Butteraugli 3-norm | +12.86651% | +9.54668% | -2.40864% |
| Butteraugli max | +15.85564% | +7.53200% | +3.28058% |

Fresh one-worker timing completes all 192 jobs without failures, omissions or
reused timings. Own median is 2,230.120ms, down 2.25751%; mean is 3,126.933ms,
down 1.80395%, and worst is 15,116.300ms, down 1.31319%. Fresh peer medians
are 483.883ms for jSquash and 339.093ms for vips, giving ratios 4.60880x and
6.57672x. The 3x crop target still fails. Managed full-lab and speed peaks remain
34,260,047 and 34,223,399 bytes. Worker RSS is 301,445,120 bytes, up 1.88556%.
Holdout, scale and original promotion runs remain fenced by the existing entry
gates; the original memory ceiling remains 131.14 MiB.

Twenty-one fresh native/Rust grids pass, including eleven effort-9 fixtures;
color error stays within one native code and alpha is exact. All 29 real
Chromium cases pass. The current profile identifies large-menu work at 0.49871s
self and 0.97765s inclusive, and rate-aware rounding at 0.19287s self. Profile
timing is diagnostic only. The measured source hash is
`73073bee7970e65ce1f45500c9b86af14f6ed617c14d5c4da00c021808bc16a5`.

Cleanup removes only 965 reproducible decoded PNGs and reclaims 425,035,104
bytes (405.35 MiB). All 965 JXL files and 389 complete results remain, along with
inputs, scores, source snapshots, profiles and independent decoder grids.

| Evidence | Raw artifact |
| --- | --- |
| Retained fusion, focused properties and isolated confirmation | `.tmp/jpegxl-lossy-lab/promotion-menu-fusion-validation/`, `.tmp/jpegxl-lossy-lab/promotion-menu-fusion-confirmation/summary.json`, `statistics.json` |
| Reverted speed trials | `.tmp/jpegxl-lossy-lab/promotion-menu-quantize-validation/`, `promotion-menu-source-validation/`, `promotion-menu-clear-validation/`, their paired results and `promotion-menu-clear-confirmation/` |
| Fixed repair screen | `.tmp/jpegxl-lossy-lab/promotion-menu-fusion-screen/byte-comparison.json`, `versus-80f1.json` |
| Full development and baseline comparisons | `.tmp/jpegxl-lossy-lab/promotion-menu-fused-full/summary.json`, `reduction.json`, `byte-comparison.json`, `versus-80f1.json`, `versus-baseline.json`, `versus-preserved.json` |
| Fresh isolated speed | `.tmp/jpegxl-lossy-lab/promotion-menu-fused-speed/summary.json`, `reduction.json`, `versus-80f1.json`, `byte-comparison.json`, `progress.json` |
| Native/Rust pixels | `.tmp/jpegxl-lossy-lab/promotion-menu-fused-validation/lossless-oracles/result.json`, `effort9-oracles/result.json`, `photo-oracles/result.json` |
| Current profile | `.tmp/jpegxl-lossy-lab/promotion-menu-fused-profile/profile-run.json`, `profile-summary.json`, `im26-3012-d2.cpuprofile` |
| Chromium, source identity and scoped cleanup | `.tmp/jpegxl-lossy-lab/promotion-menu-fused-validation/browser.log`, `frozen-source.json`, `decoded-cleanup-plan.json`, `decoded-cleanup-complete.json` |

Bounded-run receipt IDs start with `promotion-menu-fused-` under
`.tmp/jpegxl-m7/bounded-runs/`. Trial receipt IDs use `promotion-menu-fusion-`,
`promotion-menu-quantize-`, `promotion-menu-source-` and `promotion-menu-clear-`.

Final qualification confirms unchanged measured production source. The complete
repository check has 3,902 passes, three held mode/frame failures and three skips
across 304 files. Every static gate passes, including browser:check, packaging
and unchanged ceilings. No expectation or property bound was changed. The suite
takes 485.53s; the complete guard takes 9m32.02s at 2.4 GiB, zero swap. The
Chromium guard takes 4m16.63s at 1.7 GiB, zero swap. The earlier held Node mode
control remains retained under the preceding checkpoint.

Bundles are 597,105 and 669,923 bytes, down 138 and 141 bytes. Approved ceilings
remain 610,000 and 685,000, and bundle size remains report-only. The candidate
still fails the existing development and 3x crop entry gates. Main is unchanged;
the post-promotion Butteraugli phase has not started.

| Final qualification | Raw artifact |
| --- | --- |
| Complete repository check and measured source | `.tmp/jpegxl-lossy-lab/promotion-menu-fused-validation/check.log`, `final-summary.json`, `frozen-source.json` |
| Bundle reports and generated documentation | `.tmp/jpegxl-lossy-lab/promotion-menu-fused-validation/size.log`, `documentation-write.log` |

## Exact histogram convergence, 2026-10-11

Only the exact convergence repair is retained. AC clustering records its previous
assignments in optional managed storage. If every active assignment is unchanged,
later iterations rebuild identical centroids, costs and ties. Refused scratch
preserves the original iteration path. Storage is released before remapping.
All six original budget, cancellation and complete/partial-group coefficient
properties pass. Fifteen isolated pairs preserve identical files; thirteen favor
the repair, with a paired median of -1.99099%.

The eighty-point screen, 576-point full development ladder and sixty-four timed
files match `099add81` exactly. Every incremental mean and individual BD-rate
delta is zero. All 64 development images contribute to 384 comparisons, with
209 unchanged partial-range warnings. Current peer means and same-ladder
baseline deltas remain in the lab log. Existing development entry fails, and
holdout remains closed.

All 192 isolated engine jobs are fresh. Own median is 2,208.502ms versus jSquash
489.489ms and vips 334.841ms: 4.51185x and 6.59568x. Against `099add81`, own
median improves 0.969%, mean improves 0.993% to 3,095.896ms, and worst improves
1.242% to 14,928.485ms. Managed peaks stay 34,260,047 bytes for full development
and 34,223,399 bytes for isolated speed. Worker RSS is 301,174,784 bytes, down
0.090%. The full guard takes 7m52.94s at 1.3 GiB; speed takes 6m10.32s at
410.5 MiB. Both have zero swap.

Five speed changes were measured: one retained and four reverted. Cached rounding
thresholds, occupied-symbol assignment and contiguous physical-DCT scratch did
not establish repeatable gains. Histogram-model reuse was ruled out before a
trial because the estimator and serializer use different models. No compression
trial or effort-9 tuning occurred.

Twenty-one fresh native/Rust grids, including eleven effort-9 fixtures, pass
within one native color code with exact alpha. All 29 real Chromium cases pass.
The complete repository check has 3,902 passes, three held mode/frame failures
and three skips across 304 files. Every static gate passes, including
`browser:check` and unchanged ceilings. Expectations are unchanged, and final
qualification confirms the measured source was tested. The source hash is
`b74bef76aa46eeae579bc30f101728e4e0ff5d988b2a02eb6ec22f84592e7290`.

The suite takes 484.54s; its full guard takes 9m31.05s at 2.5 GiB. Chromium takes
4m13.83s at 1.8 GiB; decoder qualification takes 1m1.83s at 420.5 MiB. All have
zero swap. Cleanup removes 979 reproducible PNGs and reclaims 432,100,974 bytes,
preserving their 979 encoded files and 403 complete results. Bundles are 597,249
and 670,069 bytes, up 144 and 146. Approved ceilings remain 610,000 and 685,000;
bundle size is report-only. Main is unchanged, and promotion remains open.

| Qualification | Raw artifact |
| --- | --- |
| Retained convergence and focused properties | `.tmp/jpegxl-lossy-lab/promotion-cluster-convergence-validation/`, `promotion-cluster-convergence-confirmation/summary.json`, `statistics.json` |
| Reverted trials and baseline profile | `.tmp/jpegxl-lossy-lab/promotion-threshold-validation/`, `promotion-threshold-inline-validation/`, `promotion-sparse-hist-validation/`, `promotion-physical-layout-validation/`, their paired results and `promotion-post-lookup-profile/profile-summary.json` |
| Fixed repair screen | `.tmp/jpegxl-lossy-lab/promotion-cluster-convergence-screen/byte-comparison.json`, `versus-099add81.json` |
| Full development and baseline comparisons | `.tmp/jpegxl-lossy-lab/promotion-converged-full/summary.json`, `reduction.json`, `byte-comparison.json`, `versus-099add81.json`, `versus-baseline.json`, `versus-preserved.json` |
| Fresh isolated speed | `.tmp/jpegxl-lossy-lab/promotion-converged-speed/summary.json`, `reduction.json`, `versus-099add81.json`, `byte-comparison.json`, `progress.json` |
| Native/Rust pixels | `.tmp/jpegxl-lossy-lab/promotion-converged-validation/lossless-oracles/result.json`, `effort9-oracles/result.json`, `photo-oracles/result.json` |
| Repository, Chromium and measured source | `.tmp/jpegxl-lossy-lab/promotion-converged-validation/check.log`, `browser.log`, `final-summary.json`, `frozen-source.json` |
| Bundle reports, generated documentation and cleanup | `.tmp/jpegxl-lossy-lab/promotion-converged-validation/size.log`, `documentation-write.log`, `decoded-cleanup-plan.json`, `decoded-cleanup-complete.json` |

Bounded-run receipts use `promotion-converged-` under
`.tmp/jpegxl-m7/bounded-runs/`. Trial receipt IDs use `promotion-threshold-`,
`promotion-sparse-hist-`, `promotion-cluster-convergence-` and
`promotion-physical-layout-`.

## Cached reflected transform pairs, 2026-10-11

Only reflected-pair caching is retained in this session. The physical Float64
transforms prepare sums and differences once per row, then reuse them across
frequencies in existing 32-element scratch. LL-098 recomputed each reflected
pair per frequency; the new variant removes that repeated work. Fifteen isolated
cold pairs all favor the repair, with median -3.11924%. No managed allocation is
added. Original-coefficient reuse is deferred after source inspection: its
buffers are overwritten and released before menu selection, which may change Q.

Twenty focused menu/model properties pass, including an independent spatial
energy check for signed even and odd frequencies in both rectangles and the
square. All eighty screen files, 576 development files and sixty-four timed
files match `a1d1a8bf`. All incremental mean and individual BD-rate deltas are
zero. All 64 development images contribute to 384 comparisons, with 209 unchanged
partial-range warnings. Peer means and same-ladder baseline deltas remain in
the lab log. Existing development entry fails, and holdout remains unopened.

Fresh isolated timing measures all 192 engine jobs with one worker and no reused
times. Own median is 2,134.364ms versus jSquash 487.266ms and vips 336.318ms:
4.38028x and 6.34627x. Against `a1d1a8bf`, own median falls 3.35695%, mean falls
1.80569% to 3,039.994ms and worst rises 0.12403% to 14,947.001ms. Full managed
peak stays 34,260,047 bytes; isolated managed peak stays 34,223,399 bytes.
Worker RSS is 298,164,224 bytes, down 0.99961%. The 3x crop gate still fails.
Originals remain unqualified against the fixed 131.14 MiB and 5x limits.

All 21 fresh native/Rust grids pass, including eleven untuned effort-9 fixtures.
Native color error stays within one code and alpha is exact. All 29 fresh
Chromium cases pass. The complete repository check has 3,903 passes, the same
three held mode/frame failures and three skips across 304 files. Every static
gate passes, including browser:check, packaging and unchanged ceilings. No
original expectation, property bound, dependency or release version changes.
Final qualification confirms measured and tested production source agree:
`8556a2bba4a09f0e2e82c2130b05dbb1596a84f57815b683b68812ab38356f7d`.

Bundles are 597,618 and 670,438 bytes, up 369 bytes each. Approved ceilings stay
610,000 and 685,000; bundle size remains report-only. Scoped cleanup removes
894 reproducible PNGs and reclaims 389,201,049 bytes while retaining all 894
encoded files and 318 complete results. Inputs, scores, profiles, sources,
oracle grids and logs remain preserved. One speed trial is retained. Reusing
original coefficients is deferred after source inspection. None is promoted; main is
unchanged. No compression trial, effort-9 tuning or post-promotion Butteraugli
phase has started.

The fresh profile attributes physical transforms 0.05376s self, menu work
0.52346s self / 0.89172s inclusive and rate-aware rounding 0.19232s self.
Profile time is diagnostic only. Next hypotheses are final-channel quantization
and error fusion, unchanged-centroid cost reuse, and proven bounds that avoid
dominated transform work.

| Verification | Raw artifact |
| --- | --- |
| Initial source inspection and profile | `.tmp/jpegxl-lossy-lab/promotion-original-ac-profile/profile-run.json`, `profile-summary.json` |
| Counterbalanced seven- and fifteen-pair timing | `.tmp/jpegxl-lossy-lab/promotion-physical-pair-cache-pairs/summary.json`, `statistics.json` and `.tmp/jpegxl-lossy-lab/promotion-physical-pair-cache-confirmation/summary.json`, `statistics.json` |
| Fixed screen | `.tmp/jpegxl-lossy-lab/promotion-physical-pair-cache-screen/byte-comparison.json`, `versus-a1d1a8bf.json` |
| Full development and baseline comparisons | `.tmp/jpegxl-lossy-lab/promotion-physical-pair-cache-full/summary.json`, `reduction.json`, `byte-comparison.json`, `versus-a1d1a8bf.json`, `versus-baseline.json`, `versus-preserved.json` |
| Fresh isolated speed | `.tmp/jpegxl-lossy-lab/promotion-physical-pair-cache-speed/summary.json`, `reduction.json`, `versus-a1d1a8bf.json`, `byte-comparison.json`, `progress.json` |
| Retained-source profile | `.tmp/jpegxl-lossy-lab/promotion-physical-pair-cache-profile/profile-run.json`, `profile-summary.json` |
| Native/Rust pixels | `.tmp/jpegxl-lossy-lab/promotion-physical-pair-cache-validation/lossless-oracles/result.json`, `effort9-oracles/result.json`, `photo-oracles/result.json` |
| Focused cases, repository, Chromium and measured source | `.tmp/jpegxl-lossy-lab/promotion-physical-pair-cache-validation/focused-final-r1.log`, `check.log`, `browser.log`, `final-summary.json`, `frozen-source.json` |
| Bundles, generated documentation and cleanup | `.tmp/jpegxl-lossy-lab/promotion-physical-pair-cache-validation/size.log`, `documentation-write.log`, `decoded-cleanup-plan.json`, `decoded-cleanup-complete.json` |

Bounded-run receipts use `promotion-physical-pair-cache-` under
`.tmp/jpegxl-m7/bounded-runs/`. The initial profile receipt uses
`promotion-original-ac-profile`.

## 2026-10-11: plane quantization and zero reuse

Three speed repairs are retained: one call per large AC plane, a bounded zero/unit
crossing computed once per plane, and reuse of proven zero values at coarser Q.
Optional 8,192-byte token and 3,072-byte zero-mask scratch preserves the existing
path when allocation is refused. Five added properties cover nonconstant menus,
both refusals, nonfinite tokens and callback cleanup. Original expectations and
quality bounds are unchanged.

All eighty screen files, 576 full-development files and 64 timed files match
`6fadd286` exactly. Every incremental mean and individual BD-rate delta is zero.
All 64 photos and 384 peer comparisons contribute; the same 209 partial-range
warnings remain. Full means vs jSquash are -1.63003% SSIMULACRA2, +12.86651%
Butteraugli 3-norm and +15.85564% max. Current vips means are +0.77349%, +9.54668%
and +7.53200%. Same-ladder full-baseline deltas are -2.26705%, -2.40864% and
+3.28058%. Original development entry still fails, and holdout remains unopened.

All 192 isolated timing jobs are fresh, with one worker and both peers measured
again. Median own encode time falls 11.64711% to 1,885.772ms; mean falls 6.62346%
to 2,838.641ms; worst rises 0.94469% to 15,088.203ms. The absolute ratios are
3.92274x jSquash and 5.55843x current vips. The 3x target still fails. Managed
full-lab peak stays 34,260,047 bytes and isolated peak stays 34,223,399 bytes.
Worker RSS falls 0.84897% to 295,632,896 bytes. Originals remain unqualified.

All 21 fresh native/Rust grids pass, including eleven untuned effort-9 fixtures,
with color agreement within one code and exact alpha. All 29 fresh Chromium
cases pass. The repository check has 3,908 passes, the same three held mode/frame
failures and three skips across 304 files. All static gates pass, including
browser:check, packaging, documentation and unchanged ceilings. Final
qualification confirms measured and tested production source agree:
`a769d44214725027d9ed9d98464a4de6a8880bd7f497ef8fe17eda33df5499ff`.

Bundles are 598,836 and 671,650 bytes, up 1,218 and 1,212. Ceilings stay 610,000
and 685,000; size remains report-only. Scoped cleanup removes 1,267 reproducible
PNGs and reclaims 564,442,498 bytes while retaining all 1,267 encoded files and
563 complete results. Inputs, scores, profiles, sources, oracle grids and logs
remain preserved. Eight speed hypotheses were measured, three retained and five
reverted. None is promoted; main is unchanged. No compression trial or effort-9
tuning occurred, and the post-promotion Butteraugli phase has not started.

The fresh profile attributes plane rounding 0.18679s self, menu work 0.24709s
self / 0.72096s inclusive and color filling 0.07282s self. Next hypotheses are
active AC-index visits during coarser quantization, one-block XYB source reuse,
and channel-specific scalar rounding. Profile time is diagnostic only.

| Verification | Raw artifact |
| --- | --- |
| Plane rounding, seven and fifteen pairs | `.tmp/jpegxl-lossy-lab/promotion-plane-rounding-pairs/summary.json`, `statistics.json` and `.tmp/jpegxl-lossy-lab/promotion-plane-rounding-confirmation/summary.json`, `statistics.json` |
| Plane crossing, seven and twenty-one pairs | `.tmp/jpegxl-lossy-lab/promotion-plane-unit-pairs/summary.json`, `statistics.json` and `.tmp/jpegxl-lossy-lab/promotion-plane-unit-confirmation/summary.json`, `statistics.json` |
| Zero reuse, seven and fifteen pairs | `.tmp/jpegxl-lossy-lab/promotion-plane-zero-pairs/summary.json`, `statistics.json` and `.tmp/jpegxl-lossy-lab/promotion-plane-zero-confirmation/summary.json`, `statistics.json` |
| Individual fixed screens | `.tmp/jpegxl-lossy-lab/promotion-plane-rounding-screen/`, `promotion-plane-unit-screen/`, `promotion-plane-stack-screen/` |
| Full development and baseline comparisons | `.tmp/jpegxl-lossy-lab/promotion-plane-stack-full/summary.json`, `reduction.json`, `byte-comparison.json`, `versus-6fadd286.json`, `versus-baseline.json`, `versus-preserved.json` |
| Fresh isolated speed | `.tmp/jpegxl-lossy-lab/promotion-plane-stack-speed/summary.json`, `reduction.json`, `versus-6fadd286.json`, `byte-comparison.json`, `progress.json` |
| Retained-source profile | `.tmp/jpegxl-lossy-lab/promotion-plane-stack-profile/profile-run.json`, `profile-summary.json` |
| Native/Rust pixels | `.tmp/jpegxl-lossy-lab/promotion-plane-stack-validation/lossless-oracles/result.json`, `effort9-oracles/result.json`, `photo-oracles/result.json` |
| Focused cases, repository, Chromium and measured source | `.tmp/jpegxl-lossy-lab/promotion-plane-stack-validation/focused-final.log`, `check.log`, `browser.log`, `final-summary.json`, `frozen-source.json` |
| Bundles, generated documentation and cleanup | `.tmp/jpegxl-lossy-lab/promotion-plane-stack-validation/size.log`, `documentation-write.log`, `decoded-cleanup-plan.json`, `decoded-cleanup-complete.json` |

Bounded-run receipts use `promotion-plane-rounding-`, `promotion-plane-unit-`,
`promotion-plane-zero-` and `promotion-plane-stack-` under
`.tmp/jpegxl-m7/bounded-runs/`. The five reverted trials and refreshed baseline
profile are logged in LL-194 through LL-200.

## 2026-10-11 active AC visits and bounded source reuse

Eight speed hypotheses were measured against `a74763e7`. Five are retained:
active AC-index visits, nonzero reconstruction, a sixteen-block source cache,
LF reconstruction once per geometry and DCT16 plane rounding in existing error
storage. Aligned RGBA clipping, one-block source caching and zero-channel error
caching were reverted. Confirmations use fifteen or 21 counterbalanced pairs.
Two added effort-7 cases cover aligned and partial-edge RGB/RGBA color equality.
No original property bound or expected value changes.

All eighty final screen files, 576 development files and sixty-four isolated
speed files match `a74763e7` exactly. Incremental mean and individual BD-rate
deltas are zero. Full-lab means on the unchanged ladder are:

| Metric | jSquash 1.3.0 reference | wasm-vips 0.0.19 target | Full-baseline delta |
| --- | ---: | ---: | ---: |
| SSIMULACRA2 | -1.63003% | +0.77349% | -2.26705% |
| Butteraugli 3-norm | +12.86651% | +9.54668% | -2.40864% |
| Butteraugli max | +15.85564% | +7.53200% | +3.28058% |

All 64 photos and 576 points complete without encode failures. The same 209
partial-range warnings remain. Full-baseline worst regressions and the
owner-directed effort migration deltas remain unchanged. Development entry
fails; holdout stays unopened. The bounded Butteraugli phase has not started.

Fresh one-worker speed measures all 192 jobs without reuse: own median
1,668.513ms, jSquash 489.152ms and vips 337.400ms. Ratios are 3.41103x and
4.94521x. Own median falls 11.52096%, mean falls 6.80987% to 2,645.333ms and
worst rises 0.49252% to 15,162.516ms against `a74763e7`. Worker RSS rises
3.01070% to 304,533,504 bytes. Full-lab managed peak stays 34,260,047 bytes;
isolated managed peak stays 34,223,399 bytes. The formal 3x crop target still
fails, and originals remain unqualified against 5x and 131.14 MiB.

Twenty-one fresh native/Rust grids pass, including eleven effort-9 fixtures,
with color within one code value and exact alpha. Effort 9 remains untuned;
its comparison screen waits for promotion. All 29 real Chromium cases pass.
Cleanup removes 1,522 reproducible PNGs and reclaims 680,128,757 bytes, keeping
their encoded files and 690 complete results. Bundles are 599,885 / 672,701 bytes,
up 1,049 / 1,051 against `a74763e7`; approved ceilings stay 610,000 / 685,000.
Full repository check: 3,910 passed, the same three held mode/frame failures
and three skips across 304 files. Every static gate passes, including
browser:check and unchanged ceilings. Final qualification confirms the tested
source matches the measured source, with no original expectation changes.
Frozen production source:
`630c620eafa27046bc8a35b5b45aaf41e79b592f124a9a689e8dd6d5c6fc59cd`.

| Evidence | Location |
| --- | --- |
| Trial and confirmation statistics | `.tmp/jpegxl-lossy-lab/promotion-active-indices-pairs/`, `promotion-active-reconstruct-pairs/`, `promotion-aligned-rgba-pairs/`, `promotion-block-cache-pairs/`, `promotion-tile-source-cache-pairs/`, `promotion-zero-error-cache-pairs/`, `promotion-lf-once-pairs/`, `promotion-plane16-pairs/` and their confirmation directories |
| Individual screens | `.tmp/jpegxl-lossy-lab/promotion-active-indices-screen/`, `promotion-active-reconstruct-screen/`, `promotion-tile-source-cache-screen/`, `promotion-lf-once-screen/`, `promotion-active-stack-screen/` |
| Full development and baseline comparisons | `.tmp/jpegxl-lossy-lab/promotion-active-stack-full/summary.json`, `reduction.json`, `byte-comparison.json`, `versus-a74763e7.json`, `versus-baseline.json`, `versus-preserved.json` |
| Fresh isolated speed | `.tmp/jpegxl-lossy-lab/promotion-active-stack-speed/summary.json`, `reduction.json`, `versus-a74763e7.json`, `byte-comparison.json`, `progress.json` |
| Source profiles | `.tmp/jpegxl-lossy-lab/promotion-active-cache-profile/profile-summary.json`, `promotion-active-stack-profile/profile-summary.json` |
| Native/Rust and real Chromium | `.tmp/jpegxl-lossy-lab/promotion-active-stack-validation/lossless-oracles/result.json`, `effort9-oracles/result.json`, `photo-oracles/result.json`, `browser.log` |
| Frozen source and cleanup | `.tmp/jpegxl-lossy-lab/promotion-active-stack-validation/frozen-source.json`, `decoded-cleanup-plan.json`, `decoded-cleanup-complete.json` |
| Bundles, documentation and repository checks | `.tmp/jpegxl-lossy-lab/promotion-active-stack-validation/size.log`, `documentation-write.log`, `check.log` |
| Final qualification and source identity | `.tmp/jpegxl-lossy-lab/promotion-active-stack-validation/final-summary.json`, `post-doc-source.json`, `committed-source.json` |

Bounded receipts use the matching `promotion-active-`, `promotion-aligned-rgba-`,
`promotion-block-cache-`, `promotion-tile-source-cache-`, `promotion-zero-error-cache-`,
`promotion-lf-once-` and `promotion-plane16-` prefixes under
`.tmp/jpegxl-m7/bounded-runs/`. LL-212 through LL-234 record the trials and checks.

## Physical-error rows and token clearing (2026-10-11)

Eight speed hypotheses produced two retained local gains and six reverted trials.
Physical-error accumulation now splits each row's LF prefix from AC, preserving
the sum order. Plane quantization omits a clear because every consumed AC slot
is overwritten. The zero-skipping test excludes LF from its counter without
changing its expectation. Both local gains have 21-pair confirmation. A
distance-three neighbor check preserves files and shows no regression.

All eighty screen files, 576 full-development files and sixty-four timed files
match `b84b2d47` exactly. BD-rate against both peers and the full development
baseline is unchanged. Fresh median speed is 1,666.151ms, a neutral 0.142%
improvement over that checkpoint and 3.41785x jSquash. Managed peaks are unchanged;
worker RSS is 2.499% lower. The formal speed gate still fails.

The final repository check has 3,910 passes, the same three held mode/frame
failures and three skips. Every static gate passes, including browser:check.
All 21 fresh native/Rust grids and 29 real Chromium cases pass. Bundles are
600,019 / 672,835 bytes, up 134 each; ceilings stay 610,000 / 685,000 and remain
outside the promotion gates. Cleanup removes 1,266 PNGs / 543.87 MiB, retaining
1,266 encoded files and 626 complete results. Tested source matches measured
source. Development entry and the three held assertions remain open; holdout
and the post-promotion Butteraugli phase remain reserved.

| Evidence | Local artifact relative to the repository |
| --- | --- |
| Trials and confirmations | `.tmp/jpegxl-lossy-lab/promotion-split-quantizer-pairs/`, `promotion-error-rows-pairs/`, `promotion-channel-quantizer-pairs/`, `promotion-dct16-unroll-pairs/`, `promotion-channel-order-pairs/`, `promotion-context-shifts-pairs/`, `promotion-plane-no-clear-pairs/`, `promotion-small-tokens-pairs/` and their confirmation directories |
| Repair screens | `.tmp/jpegxl-lossy-lab/promotion-error-rows-screen/`, `promotion-plane-no-clear-screen/` |
| Full development and comparisons | `.tmp/jpegxl-lossy-lab/promotion-row-stack-full/summary.json`, `reduction.json`, `byte-comparison.json`, `versus-b84.json`, `versus-baseline.json`, `versus-preserved.json` |
| Fresh isolated speed | `.tmp/jpegxl-lossy-lab/promotion-row-stack-speed/summary.json`, `reduction.json`, `versus-b84.json`, `byte-comparison.json`, `progress.json` |
| Neighbor and profiles | `.tmp/jpegxl-lossy-lab/promotion-row-stack-distance3-pairs/summary.json`, `statistics.json`, `promotion-error-rows-profile/profile-summary.json`, `promotion-row-stack-profile/profile-summary.json` |
| Native/Rust and Chromium | `.tmp/jpegxl-lossy-lab/promotion-row-stack-validation/lossless-oracles/result.json`, `effort9-oracles/result.json`, `photo-oracles/result.json`, `browser.log` |
| Frozen source and cleanup | `.tmp/jpegxl-lossy-lab/promotion-row-stack-validation/frozen-source.json`, `decoded-cleanup-plan.json`, `decoded-cleanup-complete.json` |
| Bundles, docs and repository checks | `.tmp/jpegxl-lossy-lab/promotion-row-stack-validation/size.log`, `documentation-write.log`, `check.log` |
| Final qualification and identity | `.tmp/jpegxl-lossy-lab/promotion-row-stack-validation/final-summary.json`, `post-doc-source.json`, `committed-source.json` |

Bounded receipts use the matching `split-quantizer-`, `error-rows-`,
`channel-quantizer-`, `dct16-unroll-`, `channel-order-`, `context-shifts-`,
`plane-no-clear-`, `small-tokens-` and `promotion-row-stack-` prefixes under
`.tmp/jpegxl-m7/bounded-runs/`. LL-235 onward records this session's evidence.

## Eight reverted speed trials, 2026-10-11

LL-257 through LL-270 record eight measured speed hypotheses and two refreshed
profiles. All eight are reverted. The provisional bounded hybrid lookup gives
a tentative 0.531% paired median gain in 21 pairs, with thirteen wins. Fresh
timing across all 64 crops and both peers gives only 0.069% median improvement,
0.349% mean improvement and a 3.44714x jSquash ratio. All 192 jobs are fresh,
without failures or reused timings. The test crop is 1.17% slower than the prior
checkpoint. The lookup and its 16 KiB storage are removed.

Restored production source is exactly `3bdeda66`, with source hash
`eb1d370c511c95fdf8afcfd6a820b7f1932b5fc51a1c7192db1345e652ef6fa7`.
Prior full-development curves, native/Rust grids, real Chromium coverage,
bundle sizes and retained gains therefore still apply. No rejected candidate
is sent through holdout or the effort-9 comparison screen.

A new regression covers packed signed values around 255/256 and the complete
AC range through +/-4095, with an intervening histogram model and cooperative
encoding. It preserves the complete-file floor, decoded colors, exact alpha,
caller data and ownership bounds on restored source. Ten focused entropy cases
pass. Cleanup removes 470 reproducible PNGs / 215,905,332 bytes and retains
470 encoded files and 406 complete results.

The fresh repository check has 3,911 passes, the same three held mode/frame
failures and three skips across 304 files. Every static gate passes, including
browser:check. The added boundary case passes in the complete suite. Bundles
stay 600,019 / 672,835 bytes, with unchanged 610,000 / 685,000 ceilings.
Final qualification confirms restored production source is unchanged, so the
prior 576-point full-development, 21 native/Rust and 29 real Chromium results
remain valid. Development entry and the held assertions still prevent main
promotion; holdout and the effort-9 comparison screen remain reserved.

| Evidence | Local artifact relative to the repository |
| --- | --- |
| Initial trials | `.tmp/jpegxl-lossy-lab/promotion-normalized-coeff-pairs/`, `promotion-sparse-clear-pairs/`, `promotion-menu-packed-pairs/`, `promotion-hybrid-cache-pairs/`, `promotion-nonzero-context-pairs/`, `promotion-strategy-plane-pairs/`, `promotion-ac-tail-pairs/`, `promotion-zero-store-pairs/` |
| Confirmations | `.tmp/jpegxl-lossy-lab/promotion-hybrid-cache-confirmation/`, `promotion-nonzero-context-confirmation/` |
| Refreshed profiles | `.tmp/jpegxl-lossy-lab/promotion-post-menu-profile/profile-summary.json`, `promotion-hybrid-stack-profile/profile-summary.json` |
| Fixed screen | `.tmp/jpegxl-lossy-lab/promotion-hybrid-cache-screen/byte-comparison.json`, `versus-3bdeda66.json` |
| Fresh isolated trial speed | `.tmp/jpegxl-lossy-lab/promotion-hybrid-stack-speed/summary.json`, `reduction.json`, `versus-3bdeda66.json`, `byte-comparison.json`, `progress.json` |
| Rejected and restored source | `.tmp/jpegxl-lossy-lab/promotion-hybrid-stack-validation/frozen-source.json`, `trial-source.ts`, `restored-source.json` |
| Restored regression coverage | `.tmp/jpegxl-lossy-lab/promotion-hybrid-stack-validation/restored-boundaries.log` |
| Scoped cleanup | `.tmp/jpegxl-lossy-lab/promotion-hybrid-stack-validation/decoded-cleanup-plan.json`, `decoded-cleanup-complete.json`, `cleanup.log` |
| Full repository qualification | `.tmp/jpegxl-lossy-lab/promotion-hybrid-stack-validation/check.log`, `final-summary.json`, `post-doc-source.json`, `committed-source.json` |

## DCT speed trials and full-lab numerical regression, 2026-10-11

Eight speed hypotheses are rejected. DCT16's scalar-leaf transform initially
passes the fixed screen and local timing, but the full 64-photo ladder exposes
a +4.12439% Butteraugli-max regression on im26-3002. Recomputing compact DC alone
does not repair it. Restoring the original DCT16 reproduces the failing point
exactly; no property limit or original expectation changes.

The remaining DCT32 stack reproduces every one of 576 development files and
64 isolated own files. All BD-rate deltas vs the saved candidate are zero.
Fresh isolated own median rises 0.25066%, mean rises 1.45525% and worst rises
2.89151%. Its absolute trial ratio is 3.39629x jSquash, still outside 3x. The
aggregate result is neutral, so DCT32 and its scalar base are also reverted.
Production returns exactly to `97eb5fb9` and `3bdeda66`, preserving prior gains.
Five new transform regression cases remain on the original kernels.

The first profile accidentally selects the preserved worker; its receipt exposes
that source, and it is excluded. The second profile explicitly selects current
source. No peer-source analysis, compression trial, effort-9 tuning, holdout or
main promotion occurs.

| Evidence | Local artifact relative to the repository |
| --- | --- |
| Initial trials | `.tmp/jpegxl-lossy-lab/promotion-dct8-refine-cache-pairs/`, `promotion-factored-dct16-pairs/`, `promotion-factored-dct16-leaf-pairs/`, `promotion-factored-dct32-pairs/`, `promotion-factored-rectangle-pairs/`, `promotion-ac-threshold-pairs/`, `promotion-factored-physical-pairs/`, `promotion-factored-eight-pairs/` |
| Confirmations | `.tmp/jpegxl-lossy-lab/promotion-factored-dct16-leaf-confirmation/`, `promotion-factored-dct32-confirmation/`, `promotion-factored-rectangle-confirmation/`, `promotion-ac-threshold-confirmation/`, `promotion-factored-eight-confirmation/` |
| Source-aware profiles | `.tmp/jpegxl-lossy-lab/promotion-factored-stack-profile/`, `promotion-factored-stack-current-profile/profile-summary.json` |
| Rejected full stack | `.tmp/jpegxl-lossy-lab/promotion-factored-stack-full/reduction.json`, `versus-97eb.json`, `versus-baseline.json`, `byte-comparison.json`; `promotion-factored-stack-validation/rejected-source/` |
| Numerical controls | `.tmp/jpegxl-lossy-lab/promotion-factored-dct32-only-guard/`, `promotion-factored-dct16-lf-guard/`; `promotion-factored-stack-validation/dct16-lf-trial-source.ts` |
| Corrected full stack | `.tmp/jpegxl-lossy-lab/promotion-dct32-stack-full/reduction.json`, `versus-97eb.json`, `versus-baseline.json`, `byte-comparison.json`; `promotion-dct32-stack-validation/frozen-source.json`, `rejected-source/` |
| Fresh isolated trial speed | `.tmp/jpegxl-lossy-lab/promotion-dct32-stack-speed/summary.json`, `reduction.json`, `versus-97eb.json`, `byte-comparison.json` |
| Restored production | `.tmp/jpegxl-lossy-lab/promotion-dct-restored-validation/frozen-source.json` |

The final restored-source check has 3,916 passes, the same three held layout
failures and three skips across 305 files. Every static gate passes, including
browser:check. Five new transform cases pass. Cleanup removes 1,990 PNGs /
882,081,160 bytes, retaining 1,990 encoded files and 710 complete results. Prior 21 native/Rust grids and 29 real Chromium cases apply
to the identical production hash; those checks are reused, not rerun.


| Final checkpoint evidence | Local artifact relative to the repository |
| --- | --- |
| Full repository check and restoration | `.tmp/jpegxl-lossy-lab/promotion-dct-restored-validation/check.log`, `final-summary.json`, `frozen-source.json`, `post-doc-source.json`, `committed-source.json` |
| Scoped cleanup | `.tmp/jpegxl-lossy-lab/promotion-dct-restored-validation/decoded-cleanup-plan.json`, `decoded-cleanup-complete.json`, `cleanup.log` |

Bundles remain 600,019 / 672,835 bytes and ceilings remain 610,000 / 685,000.
The current candidate's qualified isolated ratio remains 3.41785x jSquash.
The 3.39629x ratio belongs to the rejected trial source. Development entry and
three held contracts still block promotion; holdout and the effort-9 comparison
screen remain reserved, and the bounded Butteraugli phase has not started.

## AC summary and residual speed trials, 2026-10-11

All three hypotheses are reverted. AC summaries pass seventeen focused cases
and reproduce every screen and isolated own file. Their small paired local
gain does not survive aggregate timing: median +3.77144%, mean +3.59264% and
fresh jSquash ratio 3.43331x. Both peers also slow, so the run does not prove
a causal regression. Specialized residual loops win only eight of fifteen
confirmation pairs; empty-menu error reuse is neutral. Production returns
exactly to `6ee9191a`, preserving prior qualified source and comparisons.

LL-303 accidentally reused the LL-136 output directory. The old raw summary,
progress ledger and 192 worker records were overwritten and cannot be recovered.
The old aggregate reduction, comparison and byte report survive unchanged.
The new records now live in `promotion-ac-count-cache-speed`; their relocation
receipt preserves original paths and hashes. The historical directory contains
`RAW-DATA-LOSS.json`. Do not use its missing raw records as current evidence.
The fresh-speed runner now reserves a new directory atomically before starting
workers. Seven regression cases and a three-job public smoke run pass.

| Evidence | Local artifact relative to the repository |
| --- | --- |
| AC local trial and confirmation | `.tmp/jpegxl-lossy-lab/promotion-ac-count-cache-pairs/statistics.json`, `promotion-ac-count-cache-confirmation/statistics.json` |
| AC focused recovery and rejected source | `.tmp/jpegxl-lossy-lab/promotion-ac-count-cache-validation/recovery.log`, `trial-source.ts`, `trial-test-helper.ts`, `trial-test.ts` |
| AC screen | `.tmp/jpegxl-lossy-lab/promotion-ac-count-cache-screen/byte-comparison.json`, `versus-6ee.json` |
| Rejected fresh speed | `.tmp/jpegxl-lossy-lab/promotion-ac-count-cache-speed/summary.json`, `versus-6ee.json`, `bytes-versus-6ee.json`, `relocation.json` |
| Historical evidence loss | `.tmp/jpegxl-lossy-lab/promotion-ac-cache-speed/RAW-DATA-LOSS.json`; surviving `reduction.json`, `versus-91d.json`, `byte-comparison.json` |
| Residual trial and confirmation | `.tmp/jpegxl-lossy-lab/promotion-residual-kernels-pairs/statistics.json`, `promotion-residual-kernels-confirmation/statistics.json`; `promotion-residual-kernels-validation/trial-source.ts` |
| Empty-menu trial | `.tmp/jpegxl-lossy-lab/promotion-empty-menu-pairs/statistics.json`; `promotion-empty-menu-validation/trial-source.ts` |
| Restored-source profile | `.tmp/jpegxl-lossy-lab/promotion-ac-restored-current-profile/profile-run.json`, `profile-summary.json` |
| Directory safety verification | `.tmp/jpegxl-lossy-lab/promotion-ac-count-cache-validation/output-guard-focused-final.log`, `output-guard-smoke.log`; `promotion-output-directory-smoke/summary.json` |

Full check: 3,923 passes, three unchanged held layout failures and three skips
across 306 files, 510.21s. All static gates pass, including browser:check.
Prior 576-point, 21-grid native/Rust and 29-case Chromium qualification is reused
on identical production. Cleanup removes 390 PNGs / 171,756,311 bytes while
preserving 390 encoded files and 326 complete results. Final receipts:
`.tmp/jpegxl-lossy-lab/promotion-ac-count-cache-validation/final-summary.json`, `check.log`, `decoded-cleanup-plan.json`,
`decoded-cleanup-complete.json` and `cleanup.log`. Bundles stay
600,019 / 672,835 bytes; ceilings stay 610,000 / 685,000. Holdout and the effort-9
screen remain reserved; no main promotion or new compression trial occurred.

## Eight restored-candidate speed trials, 2026-10-11

All eight hypotheses are reverted. Geometry hoisting and paired order estimates
preserve every screen and isolated file, but the combined aggregate median is
neutral (-0.08103%) and mean rises 2.71384%; its fresh jSquash ratio is 3.32753x.
Bulk cache copies also preserve every file but have no aggregate gain: median
+2.09747%, mean +6.58171%, ratio 3.42028x. Both peers slow in each run, so these
measurements establish no gain rather than a causal regression. Production
returns exactly to `e36ee9e6`, source hash
`eb1d370c511c95fdf8afcfd6a820b7f1932b5fc51a1c7192db1345e652ef6fa7`.

| Evidence | Local artifact relative to the repository |
| --- | --- |
| Partial histogram costs | `.tmp/jpegxl-lossy-lab/promotion-hist-cost-prune-validation/`; `promotion-hist-cost-prune-pairs/statistics.json` |
| Large coefficient-step cache | `.tmp/jpegxl-lossy-lab/promotion-large-step-cache-validation/`; `promotion-large-step-cache-pairs/statistics.json` |
| Geometry setup and confirmation | `.tmp/jpegxl-lossy-lab/promotion-ac-geometry-hoist-confirmation/statistics.json`; `promotion-ac-geometry-hoist-screen/byte-comparison.json` |
| Paired estimates and ten rejected tests | `.tmp/jpegxl-lossy-lab/promotion-paired-order-validation/rejected-jpegxl-jpeg-encode.ts`, `rejected-jpegxl-vardct-encode.ts`, `rejected-test.ts`; `promotion-paired-order-confirmation/statistics.json` |
| Rejected combined aggregate | `.tmp/jpegxl-lossy-lab/promotion-paired-order-speed/summary.json`, `versus-e36.json`, `byte-comparison.json` |
| Exact rectangular pair reuse | `.tmp/jpegxl-lossy-lab/promotion-rectangle-pairs-validation/direct-comparison.json`; `promotion-rectangle-pairs-confirmation/statistics.json` |
| Bulk cache copy trial | `.tmp/jpegxl-lossy-lab/promotion-tile-copy-confirmation/statistics.json`; `promotion-tile-copy-screen/byte-comparison.json`; `promotion-tile-copy-validation/rejected-source.ts` |
| Rejected bulk-copy aggregate | `.tmp/jpegxl-lossy-lab/promotion-tile-copy-speed/summary.json`, `versus-e36.json`, `byte-comparison.json` |
| Zero correlation and centroid writes | `.tmp/jpegxl-lossy-lab/promotion-zero-correlation-pairs/statistics.json`; `promotion-zero-centroid-confirmation/statistics.json` |
| Restored profile and next median inputs | `.tmp/jpegxl-lossy-lab/promotion-pair-restored-profile/profile-run.json`, `profile-summary.json`; `promotion-speed-repairs-checkpoint-validation/median-inputs.json` |
| Scoped cleanup | `.tmp/jpegxl-lossy-lab/promotion-speed-repairs-checkpoint-validation/decoded-cleanup-plan.json`, `decoded-cleanup-complete.json`, `cleanup.log` |

Cleanup removes 947 decoded PNGs / 428,836,841 bytes and preserves 947 encoded
files and 755 complete results. Inputs, curves, metrics, rejected source and raw
timing evidence remain. Fresh full check: 3,923 passes, three unchanged held
layout failures and three skips across 306 files, 519.92s. Every static gate
passes, including browser:check. Guard runtime is 9m27.768s, peak 2.8 GiB,
zero swap. Final receipts: `promotion-speed-repairs-checkpoint-validation/frozen-source.json`,
`final-summary.json` and `check.log`, under `.tmp/jpegxl-lossy-lab/`.
Prior full-development, twenty-one native/Rust grids and 29 real Chromium cases
are reused on identical production. Bundles remain 600,019 / 672,835 bytes;
ceilings stay 610,000 / 685,000. Qualified crop speed remains 3.41785x jSquash.
No holdout opening, effort-9 comparison screen or compression trial occurred.

## Histogram and AC crossing speed repairs, 2026-10-11

Eight hypotheses retain two small production changes and reject six. Initial
two/three-predictor histogram loops retain the same arrays and integer wrapping;
their slow-crop confirmation wins 15/15 pairs, paired median -1.51922%.
The table-free unit/two AC crossing wins 15/21 median-crop pairs, paired median
-0.89021%. The original squared-error comparison handles Float64 tie neighbors.
480,046 numerical decisions match, with zero mismatches. Neither change adds
backing storage or changes encoder decisions in the measured corpus.

Wide and adaptive radix widths, generic prefix extraction, menu magnitude reuse,
LF row traversal and specialized prefix kernels are rejected. LF traversal loses
its clear majority in confirmation. Specialized prefix scoring shows an
unconfirmed 0.95089% slow-crop gain but adds roughly 150 lines and temporary
objects; its complexity does not justify retention. Rejected variants remain
available with their measurements.

| Evidence | Local artifact relative to the repository |
| --- | --- |
| Fresh median and slow-input profiles | `.tmp/jpegxl-lossy-lab/promotion-median-profiles/`, with `profile-run.json`, `profile-summary.json` and `encode.cpuprofile` per input |
| Wide and adaptive radix trials | `.tmp/jpegxl-lossy-lab/promotion-wide-radix-pairs/statistics.json`, `promotion-adaptive-radix-pairs/statistics.json`; respective validation roots retain rejected source |
| Retained initial histograms | `.tmp/jpegxl-lossy-lab/promotion-tree-histogram-confirmation/statistics.json`; `promotion-tree-histogram-screen/byte-comparison.json`, `versus-5a89.json` |
| Generic prefix and magnitude reuse | `.tmp/jpegxl-lossy-lab/promotion-tree-prefix-kernel-pairs/statistics.json`, `promotion-menu-magnitude-pairs/statistics.json`; rejected sources in `promotion-tree-prefix-kernel-validation/` and `promotion-menu-magnitude-validation-r1/` |
| Retained AC crossing | `.tmp/jpegxl-lossy-lab/promotion-plane-pair-crossing-validation/crossing-check.json`; `promotion-plane-pair-crossing-confirmation/statistics.json`; `promotion-plane-pair-crossing-screen/byte-comparison.json`, `versus-histogram.json` |
| LF traversal confirmation | `.tmp/jpegxl-lossy-lab/promotion-menu-baseline-rows-confirmation/statistics.json`; `promotion-menu-baseline-rows-validation/rejected-source.ts` |
| Specialized prefix trial | `.tmp/jpegxl-lossy-lab/promotion-specialized-prefix-pairs/statistics.json`; `promotion-specialized-prefix-validation/rejected-source.ts` |
| Fresh full development | `.tmp/jpegxl-lossy-lab/promotion-histogram-crossing-stack-full/summary.json`, `reduction.json`, `byte-comparison.json`, `versus-5a89.json`, `versus-baseline.json`, `versus-preserved.json` |
| Fresh isolated speed | `.tmp/jpegxl-lossy-lab/promotion-histogram-crossing-stack-speed/summary.json`, `reduction.json`, `versus-5a89.json`, `byte-comparison.json`, `progress.json` |
| Both independent decoders | `.tmp/jpegxl-lossy-lab/promotion-histogram-crossing-stack-validation/lossless-oracles/result.json`, `effort9-oracles/result.json`, `photo-oracles/result.json`, `oracles.log` |
| Real browser and full repository check | `.tmp/jpegxl-lossy-lab/promotion-histogram-crossing-stack-validation/browser.log`, `check.log`, `final-summary.json` |
| Frozen source and scoped cleanup | `.tmp/jpegxl-lossy-lab/promotion-histogram-crossing-stack-validation/frozen-source.json`, `committed-source.json`, `decoded-cleanup-plan.json`, `decoded-cleanup-complete.json`, `cleanup.log` |

All 576 development files match `5a89a125` exactly. All incremental mean and
individual BD-rate deltas are zero. The 384 peer comparisons compute with the
same 209 partial-range warnings. Same-ladder full-baseline deltas remain
-2.26705% SSIMULACRA2, -2.40864% Butteraugli 3-norm and +3.28058% Butteraugli max.
Migration/repair deltas against preserved E4 remain +1.32777% / +0.88250% /
+0.87829%. Development entry still fails; the holdout remains unopened.

Fresh isolated speed completes all 192 jobs, one worker, with no failures,
omissions or reused timings. All 64 own files match the preceding source.
Own median is 1,653.793ms (-0.74168%), mean 2,646.489ms (-0.17793%) and worst
15,104.740ms (-0.10283%). The ratio is 3.41767x jSquash and 4.79307x vips.
The jSquash ratio is effectively unchanged and still fails 3x. These two narrow
changes have confirmed local gains and non-regressing aggregate measurements;
no material aggregate speed improvement is claimed. Managed peaks remain
34,260,047 bytes full-lab and 34,223,399 bytes isolated. Worker RSS is
299,687,936 bytes (+0.93115%).

Twenty-three fresh native/Rust grids pass: three lossless, eleven effort-9 and
nine development streams, including the profiled slow and median inputs. Color
differs by at most one native sample code and alpha is exact. All 29 real
Chromium cases pass. Fresh full check: 3,923 passes, three unchanged held layout
failures and three skips across 306 files, 489.38s. Every static gate passes,
including browser:check. The check guard runs 8m52.524s, peak 2.4 GiB, zero swap.
Original expectations and property bounds are unchanged; assertions after the
three held layout failures remain unexecuted in those cases.

Cleanup removes 1,157 reproducible decoded PNGs / 513,574,567 bytes and preserves
1,157 JXL files and 517 complete results. Inputs, scores, curves, raw timings,
profiles, independent-decoder grids and rejected variants remain. Production
source hash is `8e49806ef27e37328246284a2236c255ff4594fbd9240647befd417af81ea6c0`.
Bundles are 600,497 / 673,295 bytes; ceilings remain 610,000 / 685,000. No main
promotion, holdout opening, effort-9 comparison screen or compression trial
occurred. Next work is the invariant crossing margin, exact menu work on the
actual median input and estimated selection behind the migration regressions.

## Estimated-selection diagnosis checkpoint, 2026-10-11

Six hypotheses retain no source changes after `285ff996`. Five are reverted;
the tiny hybrid-only variant is preserved but unqualified. The source returns
to `8e49806ef27e37328246284a2236c255ff4594fbd9240647befd417af81ea6c0`.
The earlier complete development, isolated speed, decoder and Chromium results
therefore still describe the retained encoder. No rejected screen is presented
as full-development qualification. Holdout remains unopened.

| Work | Preserved raw evidence |
| --- | --- |
| Invariant tie margin, three of seven timing wins | `.tmp/jpegxl-lossy-lab/promotion-tie-margin-validation/`, `promotion-tie-margin-pairs/statistics.json` |
| Actual median crop profile | `.tmp/jpegxl-lossy-lab/promotion-285-median-profile/profile-run.json`, `profile-summary.json`, `encode.cpuprofile` |
| Estimator count, hybrid and combined repairs | `.tmp/jpegxl-lossy-lab/promotion-order-estimator-count-screen/versus-285.json`, `promotion-order-estimator-hybrid-screen/versus-285.json`, `promotion-order-estimator-model-screen/versus-285.json` |
| Rejected and shelved estimator source variants | `.tmp/jpegxl-lossy-lab/promotion-order-estimator-count-validation/rejected-source.ts`, `promotion-order-estimator-hybrid-validation/trial-source.ts`, `promotion-order-estimator-model-validation/rejected-source.ts` |
| Our own candidate rank and actual section sizes | `.tmp/jpegxl-lossy-lab/promotion-order-rank-diagnostic/`, `promotion-ac-refinement-rank-diagnostic/` |
| Estimated AC model choice, screen and isolated pairs | `.tmp/jpegxl-lossy-lab/promotion-ac-estimated-choice-screen/versus-285.json`, `promotion-ac-estimated-choice-pairs/statistics.json`, `promotion-ac-estimated-choice-validation/` |
| Matching model reuse, screen and correctness | `.tmp/jpegxl-lossy-lab/promotion-ac-model-reuse-screen/versus-285.json`, `promotion-ac-model-reuse-validation/` |
| Model reuse, seven pairs and 21-pair confirmation | `.tmp/jpegxl-lossy-lab/promotion-ac-model-reuse-pairs/statistics.json`, `promotion-ac-model-reuse-confirmation/statistics.json`, `summary.json` |

The existing ordinary order estimator correctly ranks our refined candidates
on im26-3000 at distances 2, 4 and 7. Increasing its histogram count selects
worse files. The second diagnosis finds a different issue: at distance 7 the
selected refined AC sections use 4,908 bytes, while the ordinary model uses
4,839. Refined wins at distances 2 and 4. These extra first-party serializations
are removed instrumentation. No peer internal state or encoder source is used.

Choosing baseline or refined model by estimated cost gives screen deltas of
-0.08274% SSIM, -0.06755% Butteraugli 3-norm and -0.03963% max, with no individual
regressions. Its first version slows the pinned crop 1.74327% in seven pairs.
Reusing the matching estimator model removes duplicate clustering but still
slows it 0.79124% in 21 pairs, with nine wins and paired MAD 1.28864 points.
The benefit does not justify either slowdown. Both sources and focused tests
remain preserved outside the package. Full lab is skipped for these rejected
variants. Managed screen peak stays 32,646,275 bytes; all guards use zero swap.

Bundle sizes remain 600,497 / 673,295 bytes on the restored source, with unchanged
610,000 / 685,000 ceilings. All five complete searches remain enabled only at
effort 9. The tier is untuned and its comparison screen still waits for promotion.
Next work needs a fresh profile or a different selection mechanism; LL-041's
neutral advanced DC estimate is not a new untested idea.

Fresh restored-source full check: 3,923 passes, three held layout failures and
three skips across 306 files, 487.87s. All static gates pass, including
browser:check. Guard runtime is 8m51.274s, peak 2.3 GiB, zero swap. The three
existing assertions and every original property bound remain unchanged.
Prior full development, isolated speed, 23 native/Rust grids and 29 Chromium
cases are reused on exactly the same production source.

Cleanup removes 485 reproducible PNGs / 216,757,555 bytes and preserves 485
encoded files and 165 complete results. The two diagnostic stream sets, inputs,
scores, source variants, logs and profiles stay intact. Each removed raster and
its encoded file and result metadata are revalidated against the saved plan.
Final receipts are in
`.tmp/jpegxl-lossy-lab/promotion-selection-diagnosis-checkpoint/`: `final-summary.json`,
`frozen-source.json`, `check.log`, `decoded-cleanup-plan.json`,
`decoded-cleanup-complete.json` and `cleanup.log`. No main promotion occurs.

## Reopened matching AC model repair, 2026-10-11

The worst migration regressions include two development photos absent from the
quick screen. Our own section serialization identifies a missing ordinary-model
choice: im26-1466 at distance 3 saves 540 bytes, while im26-1050 saves 159 bytes.
This reopens the exact LL-352 prototype for full development. It does not erase
the earlier screen-only rejection or open another compression campaign.

All 64 photos and 576 points complete without encode failures. Direct deltas
against `285ff996` are -0.21582% SSIMULACRA2, -0.17157% Butteraugli 3-norm and
-0.20088% Butteraugli max. Worst incremental changes are +0.03203%, +0.34728%
and +0.12490%, below the 3% guard. Forty-seven files shrink, none grow, and all
576 measured score triples match. Native floating-point decode grids for every
changed stream exactly match the preserved streams. Both native libjxl and
jxl-rs independently validate 37 fixtures within one color sample, exact alpha.

| Work | Preserved raw evidence |
| --- | --- |
| Development ranking and corrected score-only comparison | `.tmp/jpegxl-lossy-lab/promotion-development-selection-diagnosis/rank-and-curves.json`, `point-score-deltas.json` |
| Own section-cost diagnosis on the omitted images | `.tmp/jpegxl-lossy-lab/promotion-worst-ac-rank-diagnostic/run.log`, `diagnostic-source.ts`, per-image `result.json` |
| Reopened ownership tests and source identity | `.tmp/jpegxl-lossy-lab/promotion-ac-model-reuse-reopened-validation/focused.log`, `types.log`, `frozen-source.json` |
| Full development and direct comparisons | `.tmp/jpegxl-lossy-lab/promotion-ac-model-reuse-reopened-full/summary.json`, `reduction.json`, `versus-285.json`, `versus-baseline.json`, `versus-preserved.json`, `point-changes.json` |
| Fresh isolated speed and earlier-run comparison | `.tmp/jpegxl-lossy-lab/promotion-ac-model-reuse-reopened-speed/summary.json`, `versus-285.json` |
| Independent lossless, effort-7, effort-9 and photo grids | `.tmp/jpegxl-lossy-lab/promotion-ac-model-reuse-reopened-validation/lossless-oracles/result.json`, `effort7-oracles/result.json`, `effort9-oracles/result.json`, `photo-oracles/result.json` |
| Exact native grids for all 47 changed streams | `.tmp/jpegxl-lossy-lab/promotion-ac-model-reuse-reopened-validation/pixel-parity/result.json` |
| Counterbalanced cold timing, all 64 development crops | `.tmp/jpegxl-lossy-lab/promotion-ac-model-reuse-reopened-balanced-speed/summary.json`, `rows.json` |
| Expanded TypeScript, Node and real Chromium checks | `.tmp/jpegxl-lossy-lab/promotion-ac-model-reuse-reopened-validation/types-expanded-stdout.log`, `focused-expanded-stdout.log`, `browser-expanded-stdout.log`, `expanded-run.log` |
| Refreshed bundle measurements | `.tmp/jpegxl-lossy-lab/promotion-ac-model-reuse-reopened-validation/size.log` |
| Baseline clone source and all 64 encoded streams | `.tmp/jpegxl-lossy-lab/promotion-ac-model-reuse-reopened-balanced-speed/baseline-source.json` |
| Three affected DC snapshots, native/Rust grids and properties | `.tmp/jpegxl-lossy-lab/promotion-ac-model-reuse-reopened-validation/snapshot-oracles/result.json`, `snapshot-oracles.log`, `dc-browser.log` |

Source hash is `131aff36fd865b13171237fb65edac904d7ae0e4def3df658ae7d137ad84000a`.
Managed peaks remain 34,260,047 bytes full-lab and 34,223,399 isolated. Fresh
isolated speed measures 3.45128x jSquash, failing 3x. Its unpaired own median
rises 2.84602% and mean 0.88474% against the earlier preserved run; the prior
21-pair local slowdown was 0.79124%. The all-64 counterbalanced run resolves
that disagreement: median time rises 1.49377%, mean 0.38813%. Its paired median
is +0.36607%, MAD 1.13866 points, with 26 of 64 pairs faster. This is a measured
compression trade, with no speed gain claimed. The 0.17157% 3-norm benefit
exceeds the 0.14938% required by contemporaneous median cost. Every paired
decoded PNG matches; managed peak is unchanged. Guard runtime is 6m56.263s,
peak 382.1 MiB, zero swap.

All 23 focused Node tests and 31 real Chromium tests pass, including the new
four-way family/progressive fixture and effort-9 coverage. Strict TypeScript
passes. The expanded-check guard finishes in 4m45.816s, peak 2.2 GiB, zero swap.
The first expanded launch reused an existing receipt ID and was refused before
starting a job. Its original receipt remains intact; `expanded-run.log` records
the successful fresh ID. No raw result or timing directory is overwritten.

Bundle measurements are 601,403 bytes for core plus JPEG XL and 674,193 for the
specialized entry. The 610,000 / 685,000 ceilings remain unchanged. Generated
package metrics and the README's package-size table are refreshed. Size guard:
43.191s, peak 1.1 GiB, zero swap. Final repository-check and raster-cleanup
receipts are described below. No holdout, effort-9 comparison screen or main
promotion occurs. Complete effort-9 searches stay untuned and preserved.

The executed baseline clone has the preserved `8e49806e` source hash across 51
files. All 64 baseline timing streams match the earlier `285ff996` streams.
Use `baseline-source.json` for its code identity: worker repository identity is
resolved from the process working directory and does not identify a copied
baseline module tree. The runner's worker paths and this receipt identify it.

The first complete full check has 3,929 passes, six failures and three skips,
487.25s. Three failures are the changed DC byte snapshots; the other three
are the existing held layout assertions. Every static gate passes. The gradient
and both recovery streams each save 168 bytes; their original input and decoded
digests remain unchanged, alpha is exact, and ownership unwinds to zero.
Three additional native/Rust fixtures pass within one color code, exact alpha.
Their three Chromium cases also pass after aligning older pre-E4 browser
snapshots with the already-qualified Node baseline. No quality or memory bound
changes. The lab log gives one justification for each Node and browser case.
Current totals are 40 independent fixtures and 34 real Chromium cases.
The final full recheck completes with 3,932 passes, three unchanged held layout
failures and three skips across 307 files, 509.66s. Every static gate passes,
including browser:check. The final guard runs 9m12.193s, peak 2.5 GiB, zero swap.
All eight DC-model tests and nine new model-reuse tests pass. The failed earlier
logs remain preserved.

Cleanup removes 896 reproducible PNGs / 388,756,753 bytes. It preserves all 896
encoded files and 384 complete results, plus inputs, scores, timings, profiles,
independent decoder grids and source snapshots. Each removed raster's encoded
file and metadata are checked against the saved plan before removal. Receipts
are in the validation root: `final-summary.json`, `check-snapshots.log`,
`decoded-cleanup-plan.json`, `decoded-cleanup-complete.json` and `cleanup.log`.
The final summary verifies the same production source and unchanged property
bounds. Its read-only child Git check needs execution outside the sandbox and
then succeeds without changing Git state. No temporary artifact enters Git.
One reopened repair is retained, with zero new compression trials or promotions.
Holdout, watch qualification, effort-9 comparison and the post-promotion phase
remain pending. Main stays unchanged.

## Estimated metadata repair, 2026-10-11

Frozen source: `8f08ce609f351a4776aec0b81ed0d7e7958c1203d30f1a4f128a7d1f5ee4793a`,
measured against preserved candidate `2573ad2f4c126d4e57f0a8752e14df84ae6e1cdc`.
Validation root: `.tmp/jpegxl-lossy-lab/promotion-dc-metadata-model-validation/`.
The two source copies and `frozen-source.json` precede measurement. The baseline
Git archive contains 51 verified source files with hash `131aff36`; all 64
executed baseline streams match the preserved speed streams.

The first-party diagnostic at `promotion-dc-gap-diagnostic/` preserves all four
measured streams and exposes missing metadata savings. Every winning alternative
uses a learned histogram without LZ. A 4,096-sample tree captures most of the
metadata benefit. The repair estimates ANS payload cost after serializing the
small tree and histogram headers, then writes one optional payload only when
useful. Actual size keeps the existing candidate if the estimate misses.
Allocation refusal preserves completed ordinary metadata. Eligibility uses the
existing effort search policy, with no added area, channel or distance window.
Effort 9 retains its exhaustive searches and remains untuned.

The fixed screen completes 80 points: incremental SSIM/3-norm/max deltas
-0.49868% / -0.35669% / -0.36271%, with no image regression. Full development at
`promotion-dc-metadata-model-full/` completes 576 points and 384 comparisons,
zero encode failures and 209 existing partial-range warnings. Incremental deltas
are -0.48459% / -0.34865% / -0.35273%; worst changes are +1.66854% / +1.05224% /
+0.73989%. Current means against jSquash are -2.32489% / +12.25324% / +15.18275%,
and against vips +0.05477% / +8.92381% / +6.88680%. Direct baseline deltas on the
same full ladder are -2.85440% / -2.85931% / +2.74615%; cumulative E4 deltas remain
+0.60979% / +0.35222% / +0.31206%. Development entry still fails. See the full
`reduction.json`, three `versus-*.json` files and `encoded-changes.json`.

Hash comparison covers every full-lab stream: 387 shrink, 189 are byte-identical,
none grow and no same-size stream changes. Total saving is 30,096 bytes. Every
score triple matches the preserved candidate. Native float grids match exactly
for all 387 changed streams, recorded in `pixel-parity/result.json` with the
pinned decoder hash. Independent native/Rust qualification covers 48 fixtures:
three lossless, eleven effort 7, eleven effort 9, thirteen photos, eight DC
snapshots and two additional fine-photo cases. Both decoders stay within one
color sample and preserve exact alpha. The two fine cases also retain their
complete before/after native and Rust grids, exact first-party pixels and the
original allocation-refusal behavior. See each oracle directory's `result.json`
and `fine-snapshot-oracles/result.json`.

Counterbalanced cold timing at `promotion-dc-metadata-model-balanced-speed/`
executes all 128 workers. Base/candidate medians are 1,667.037/1,693.838ms:
+1.60766%. Means rise 1.01457%; paired median +1.28534%, MAD 1.26531 points and
17 wins. All paired decoded PNGs match. The 0.34865% 3-norm gain exceeds the
0.16077% required for this measured slowdown. No speed win is claimed.
Fresh peer timing at `promotion-dc-metadata-model-speed/` has 192 new jobs,
zero failures and no reuse. Own median is 1,696.106ms against 488.859ms jSquash
and 337.929ms vips: 3.46952x / 5.01912x. The 3x crop target still fails.
Managed peaks stay 34,260,047 bytes full-lab and 34,223,399 isolated; fresh
worker peak RSS is 297,070,592 bytes. Raw timing, source and stream receipts
are in `balanced-speed.log`, `speed.log`, `baseline-source.json` and
`balanced-baseline-parity.json`.

Twenty-one real Chromium tests pass: thirteen model/order/effort/thin/group
cases, seven DC precision and recovery cases, and the fine-photo fixture.
Qualified exact byte/digest records cover six Node cases and five older
Chromium records. Pixel, quality, quantizer, row, alpha, rejection and ownership
bounds are preserved. The lab log provides one justification for every case.
Bundles measure 602,162 / 674,954 bytes; report-only ceilings remain
610,000 / 685,000. Package metrics and documentation metrics are regenerated.
The initial full check has 3,934 passes, five failures and three skips: two
qualified byte snapshots are subsequently fixed, and the three held layout
assertions remain untouched. The final check and cleanup receipts are recorded
below after completion. Holdout, watch qualification, effort-9 comparison and
main promotion remain pending.

The terminal final check records 3,936 passes, three held layout failures and
three skips across 308 files in 514.47 seconds. Every static gate passes,
including browser:check. The bounded run exits 1 solely for those three
unchanged held assertions, with 2.4 GiB peak and zero swap. Later assertions
in those cases remain unexecuted.

Cleanup checks result completion, regular-file extents and all PNG/JXL/result
hashes before deleting 980 reproducible decoded PNGs, reclaiming 423,785,415
bytes. All 980 encoded streams and 403 result records remain. The plan and
completion receipts live in validation `decoded-cleanup-plan.json` and
`decoded-cleanup-complete.json`; the guard completes in 2.915 seconds with
509.8 MiB peak and zero swap. The finalizer verifies the source, terminal
check, timing trade, independent fixtures and cleanup into `final-summary.json`.
The candidate is retained for preservation only; main and holdout stay unchanged.

## Estimated expanded color DC checkpoint (2026-10-11)

This promotion repair uses an existing first-party learned color tree with
estimated tree and histogram costs before one optional payload is written.
It retains the completed color stream when scratch or output allocation is
refused, and replaces it only after the actual encoded size is smaller.
The original and gradient-learned choices remain available. The effort-9
complete search remains unchanged and untuned.

Preserved reference is `15f5d8166bfbf08d964abb2753bcff3304bdaca4`.
Frozen production source SHA-256 is
`c347cc5c0aae1c87af598c98b685cdb42c857b9953eff63a4f253db030ef6908`.
Fresh artifacts use `.tmp/jpegxl-lossy-lab/promotion-dc-color-model-`
roots `screen`, `full`, `pairs`, `balanced-speed`, `speed` and
`validation`. The reference checkout is `promotion-15f5-base`; both changed
modules match the saved reference and Git revision. Validation records source
identity, oracle pins, qualified pixels and terminal bounded-run receipts.

The 16-image quick screen completes 80 points with no failures and 56 existing
range warnings. Mean incremental SSIM / 3-norm / max BD-rate is
-0.70745% / -0.57381% / -0.59772%; all images improve. Sixty-eight files shrink
and twelve are unchanged, saving 9,351 bytes with exact score triples.
The guard takes 1m15.169s, peaks at 1,017.4 MiB and uses zero swap.

Full development completes all 64 photos and 576 points, with 384 comparisons,
zero encode failures and 209 existing partial-range warnings. Mean BD-rate:

| Metric | jSquash 1.3.0 reference | wasm-vips 0.0.19 target | Same-ladder original baseline delta |
| --- | ---: | ---: | ---: |
| SSIMULACRA2 | -2.99808% | -0.64662% | -3.46048% |
| Butteraugli 3-norm | +11.59510% | +8.25703% | -3.39081% |
| Butteraugli max | +14.49454% | +6.22865% | +2.15426% |

Incremental means vs `15f5d816` improve by
0.70640% / 0.56867% / 0.57108%, with every image improved and unchanged scores.
Five hundred fifty streams shrink, twenty-six stay byte-identical and none grow,
saving 67,414 bytes. All 550 changed native float grids equal the reference.
Cumulative migration/repair means vs E4 are
-0.10232% / -0.21864% / -0.26041%, now clearing the 0.3% allowance; worst
E4 changes are +2.69791% / +0.77385% / +1.86405%, within the 3% guard.
Original-baseline worst changes remain +7.85604% / +27.57440% / +63.11168%.
Development entry remains held, including current vips 3-norm and crop speed.
Full guard takes 7m50.072s, peaks at 1.3 GiB and uses zero swap. Full managed
peak is 34,259,887 bytes. Reduction remains explicitly incomplete for required
range coverage; those warnings are not removed or treated as new failures.

Seven cold pairs first show median cost +5.36091%, paired median +3.94707%,
with all decoded PNGs exact. The complete counterbalanced all-64 run measures
median 1,716.746ms reference vs 1,788.717ms candidate: +4.19228%.
Mean increases 2.24751%, paired median 3.00430%, with eight wins and exact
decoded PNGs for every pair. The 0.56867% 3-norm gain exceeds the required
0.41923% for this time cost. Retain the compression repair; no speed win is
claimed. Managed peaks are 34,223,399 vs 34,223,172 bytes. Guard runtime is
7m6.652s, peak 378.8 MiB, zero swap.

Fresh isolated peer speed uses 192 cold jobs, with no reuse or failure.
Own median is 1,793.639ms vs 483.607ms jSquash and 342.977ms vips:
3.70888x / 5.22961x. The crop target still fails. Own mean is 2,758.034ms,
worst 15,007.378ms, managed peak 34,223,172 bytes and worker RSS 296,828,928
bytes. Guard runtime is 5m50.659s, peak 409 MiB, zero swap. The contemporaneous
counterbalanced measurement governs the trade rather than this unpaired
comparison with earlier session speed.

Forty-eight independent fixtures pass within one color sample, exact alpha:
three lossless, eleven effort 7, eleven effort 9, thirteen development streams,
eight DC cases and two fine-photo cases. Native and Rust before/after grids
are exact for every DC and fine-photo case, with complete first-party pixel
parity. Seven Node byte/digest snapshots and six browser records are qualified
and updated, with one justification each in the lab log. Fine photo saves
36,724 bytes; forced menu fallback saves 36,305 bytes. Input/pixel digests,
Q selection, row release, alpha, rejection counts and hard quality/ownership
bounds are unchanged. Fine gradient/recovery measured ownership peaks increase
249,998 bytes to 27,376,349 / 10,525,141, below the same 64 MiB caps.
Exact browser telemetry reflects that scratch cost. Originals remain
unqualified against their 131.14 MiB ceiling and 5x speed target.

Fifty distinct real-browser cases pass: 22 Chromium, fourteen Firefox and
fourteen WebKit. The first browser run passes Chromium/WebKit but Firefox
cannot start esbuild threads at TasksMax=256. Its fourteen failed attempts
and traces remain. A Firefox-only retry at TasksMax=512 passes all fourteen,
with unchanged 6 GiB memory, zero swap and CPU caps. The retry takes 37.995s
and peaks at 2.1 GiB. Eight updated DC/fine Chromium cases then pass in
2m40.044s, peak 1.9 GiB, zero swap. Bundle measurement takes 43.188s, peak
1.2 GiB, zero swap: core plus JPEG XL 602,574 bytes and specialized APIs
675,366 bytes. Report-only ceilings remain 610,000 / 685,000. Package metrics,
documentation metrics and README size records are regenerated.

Final repaired-source check: 3,943 passes, zero failures, three skips across 309 files, 628.65s. All static gates pass, including browser:check. Guard 11min 13.976s (journal), peak 2.5G (journal), zero swap. The former held cases pass including later assertions under the owner snapshot rule; hard bounds remain and exactness/main-size checks are strengthened. The observing tool session exits 143 while the service continues. Its original guard remains at starting. We recover the continuing run's complete totals and journal service-end/resource record. Final process exit code was not captured; a fresh fully observed check remains required before promotion. We save this evidence into `check-final-recovered.json`; tests are never restarted. Both observer and terminal evidence are preserved.

Cleanup verifies completion, extents and PNG/JXL/result hashes before removing 1,838 reproducible PNGs / 796,419,612 bytes. All 1,838 encoded streams and 686 completed results remain, as do inputs, source copies, raw pixels, independent grids and logs. Receipts: validation `decoded-cleanup-plan.json`, `decoded-cleanup-complete.json`, `final-summary.json`. The finalizer checks source, terminal gates, comparisons, timing trade, independent decoders, browsers, bundles and cleanup. Main stays at `dca2f211`. Entry speed, individual 3-norm and original qualification remain unresolved.
Three reopened promotion repairs are retained, with zero new compression
trials or promotions. The three held mode/frame assertions stay unchanged.
Holdout, watch qualification, effort-9 comparison and main promotion remain
pending. The post-promotion Butteraugli phase has not begun.

The first full color-DC check exposes an exact translucent-palette selection regression.
At 13,594 bytes a lossy stream becomes smaller than the 13,807-byte exact
palette, changing visible colors by eleven samples. The original color
expectations are preserved. The encoder now accepts an available exact
translucent palette by visible color count and stops later lossy competition;
allocation refusal retains the completed fallback. The original varying and
hidden-alpha artwork streams, digests and exact visible colors are restored.

Final frozen source is `ea6337308ca6a4175360bb38753f196a3b3918914f8821e149e878cd74038093`.
The earlier `c347cc5c` source, initial check and failed artwork capture remain
indexed. `palette-frozen-source.json` records the repaired source. New roots
`promotion-dc-color-model-palette-screen` and `-palette-full` keep all eighty
screen sizes/scores and all 576 full-development encoded streams identical
to the preceding color candidate. All BD-rate deltas are zero, and managed
full peak remains 34,259,887 bytes. The full guard takes 8m0.611s, peak
1.3 GiB, zero swap. Fresh native/Rust evidence for all five artwork cases is
validation `artwork-final-oracles/result.json`: complete first-party and both
independent grids match the preserved encoder. The bounded fallback saves
2,331 bytes, progressive artwork 2,182 and 16-bit artwork 2,331. Only these
three Node byte/digest records and one older browser fallback record update.
The two original exact-palette records and all hard properties stay unchanged.

Final repaired-source isolated speed uses another 192 fresh jobs. Own median
is 1,768.580ms vs 488.498ms jSquash and 341.719ms vips: 3.62044x / 5.17553x.
The 3x crop target still fails. Own mean is 2,751.811ms, worst 14,859.134ms.
Managed peak stays 34,223,172 bytes; worker RSS is 299,859,968 bytes.
Guard runtime is 5m50.662s, peak 422.8 MiB, zero swap. Raw final-source speed
is `promotion-dc-color-model-palette-speed/summary.json`, `reduction.json`
and validation `palette-speed.log`, `final-speed-metrics.json`. The color-DC
counterbalanced trade belongs to the earlier frozen color source; the palette
correction is a correctness repair with all photo outputs identical. No speed
win is inferred from the small difference between isolated sessions.

Final-source independent qualification covers 53 fixtures. The fresh 46-case
base set and all 550 changed native development grids finish in the bounded
qualification batch; fresh fine-photo and forced fallback captures and both
decoders then pass. The final private parity reducer has a wrong relative
import after relocation, so the parent exits 1. That failure and its log stay.
Only the reducer import is repaired and its same completed inputs are reduced
once; none of the completed encodes or decoders are rerun. All eight DC, two
fine-photo and five artwork before/after own pixels and native/Rust grids
are exact. The five artwork cases come from the separately completed final
source qualification. Fresh receipts are in validation `palette-final/`,
`palette-qualification.log`, individual `palette-*.log` files and
`artwork-final-oracles/result.json`. The batch guard takes 3m44.495s, peak
2.4 GiB, zero swap; `palette-snapshot-parity-fixed.log` records the recovered
reducer. The failed import is a private harness path error, not a codec failure.

Final-source real-browser coverage passes 55 distinct cases: 27 Chromium,
fourteen Firefox and fourteen WebKit. Fresh cross-engine run is 42/42 in
1m56.739s, peak 2.7 GiB. DC/fine/artwork Chromium is 13/13 in 4m26.381s,
peak 2.4 GiB. Both use the private 512-task cap with GOMAXPROCS=2 passed
explicitly to the child, unchanged 6 GiB memory and CPU limits and zero swap.
Earlier admission failures and retries remain as historical evidence. Raw:
validation `browser-final.log`, `browser-dc-artwork-final.log` and bounded
receipts. Four promotion repairs are retained, with zero new compression
trials and zero promotions. Final bundle measurement and repository check
follow without further production-source edits.

## Promotion-entry owner decision and layout qualification (2026-10-12)

The owner file is `benchmark/jpegxl/LOSSY_PROMOTION_ENTRY.md`. It retires the
E4 allowance, compares with unchanged main, makes peer compression targets
report-only, changes the 13 MP hard speed gate to 10x while retaining the 5x
target, and cancels the post-promotion Butteraugli phase. No new cost-model
repairs are planned unless needed for the crop speed gate.

Fresh public encodes use a first-party main source archive at `dca2f211` and
the repaired candidate source `ea633730`. Sparse output falls from 32,896 to
5,265 bytes; repeated glyphs from 904 to 577; opaque RGB from 1,410 to 499;
opaque RGBA stays 502. All complete candidate grids equal source pixels in
our decoder, native libjxl and jxl-rs, including exact alpha. All three held
mode/frame assertions are reclassified as snapshots under the owner's rule.
Each changed test has one line of justification, a main-size bound and stronger
exactness checks; original size/quality thresholds remain. Artifacts:
`.tmp/jpegxl-lossy-lab/promotion-entry-layout/result.json`, raw encoded files,
independent float grids and `verify.log`. Guard: 40.918s, 423.9 MiB, zero swap.

Same-ladder aggregate main-baseline changes are -3.46048% SSIM, -3.39081%
3-norm and +2.15426% max, passing all three mean limits. The coverage-filtered
per-image guard has no full-band SSIM failures. Eight measured-overlap
3-norm changes exceed +8.05%; their admission to the new full-band guard is
pending the owner's coverage rule, because 3-norm has no required band.
The three worst max changes are im26-3304 +63.11168%, im26-3312 +46.07737%, im26-1020 +34.68075%; visual inspection is complete. These are near-flat dark, cream and blue textures. The blue candidate has visibly larger square color boundaries. Images are selected nearest max distance 3 in each curve, with unequal bytes and qualities; two candidate curves do not reach that distance. No matched-quality claim is made. Observation hashes, chosen settings and artifact paths are recorded in `promotion-entry-layout/visual-inspection.json`.

Final report-only bundles are jpegxl-specialized 675,358 bytes, codec-jpegxl 602,566 bytes.
Ceilings stay 610,000 and 685,000. Final generated documentation check passes.

## Crop-speed entry work (2026-10-12)

Checkpoint `1a78297a` is pushed to `jxl-lossy-candidate`; a fresh remote read
confirms main stays at `dca2f211`. Source SHA-256 is `ea633730`, the worktree
is clean at push, and all 21 committed paths exclude temporary artifacts.
Receipt: color-model validation `pushed-checkpoint.json` and `pushed-refs.txt`.

Fresh median im26-1410 and slow-tail im26-1468 CPU profiles produce the same
files as that checkpoint. Median preparation is 1.03576s inclusive, including
large menus at 0.50162s and plane quantization at 0.16802s self. Strategy
measurement is 0.12903s inclusive. The tail spends 9.20217s in Modular tree
learning, with split scan 4.16543s self and radix sorting 2.18548s self.
Profiles include startup, preparation and scorer waits; their encode times
1,893.751 and 16,650.999ms are diagnostic, not isolated aggregate speed.
Artifacts: `promotion-entry-median-profile/`, `promotion-entry-tail-profile/`,
both logs and terminal bounded receipts. All use zero swap.

The first speed-only trial reuses the existing exact token-rate table in
rounding and small-strategy estimates. It allocates no new table, changes no
threshold, and preserves the original fallback for values outside the table.
All 48 original focused properties and strict TypeScript pass. Seven fresh
counterbalanced median-crop pairs are pending. The saved first-party baseline
is `promotion-entry-speed-base`, archived from the pushed checkpoint.
The initial seven pairs finish with exact files, 7/7 wins and -4.64144%
paired median time. Fifteen confirmation pairs preserve every byte, with
12/15 wins, -4.79613% paired median and 1.91103-point MAD. The fixed screen
has 80 exact streams and unchanged scores, so all screen BD-rate changes
are zero. Receipts: `promotion-entry-token-rate-pairs-1410/`,
`promotion-entry-token-rate-confirmation-1410/` and
`promotion-entry-token-rate-screen/versus-checkpoint-streams.json`.

All 64 cold counterbalanced crop pairs are complete. Corpus median falls
1,844.559 to 1,800.905ms (-2.36665%); mean falls 2.23508%. Paired median
improves 1.90885%, with 48/64 wins and 2.63669-point MAD. Every encoded
stream and decoded PNG grid is exact; managed peak stays 34,223,172 bytes.
Guard: 7min 31.235s, 358.6 MiB, zero swap. Retain the change, without
claiming a fresh peer-relative speed ratio. Raw: token-rate balanced-speed
`rows.json`, `summary.json` and terminal log, source `e02cad01`.

Coverage clarification: the historical 3-norm comparisons integrate measured
overlap and have no fixed required band. Their `coversRequiredRange` flag is
therefore always true. The eight measured-overlap regressions above +8.05%
are real measured changes, but admission to the new full-band per-image
guard needs the owner's coverage rule. Clarification is pending; holdout
stays unopened and no metric contract has changed.

The following speed-only trial rejects an ordinary small transform when a
completed channel's stored Float32 error or nonnegative partial rate already
cannot satisfy the original selector. Baseline and alternate selection stay
complete. All 48 focused properties and strict TypeScript pass. Seven initial
pairs have exact bytes, 6/7 wins and -1.89788% paired median time. Twenty-one
confirmation pairs remain exact, with 14/21 wins, -3.25491% paired median and
4.64208-point MAD; timing is noisy. The complete fixed screen preserves all
80 encoded streams and scores, so every screen BD-rate delta is zero.
All-64 paired timing is pending. Raw: `promotion-entry-strategy-prune-validation/`,
`promotion-entry-strategy-prune-pairs/`, `promotion-entry-strategy-prune-confirmation/`
and `promotion-entry-strategy-prune-screen/versus-checkpoint-streams.json`.

The all-64 transform-rejection pairs now complete with exact streams and
decoded PNG grids. Corpus median improves 2.39858% (1,818.199 to 1,774.588ms),
mean 1.73563%, paired median 1.31087%, with 43/64 wins and 2.94521-point MAD.
Managed peak stays 34,223,172 bytes. Guard: 7min 29.785s, 376.5 MiB, zero
swap. Retain the improvement. Source `5fb093eb`; raw balanced-speed
`rows.json`, `summary.json` and validation `balanced-speed.log`. The two
sequential percentage improvements are not a new jSquash-relative ratio.

Sparse DCT16 DC computes only the four consumed coefficients with the original
summation order and Float32 row boundary. Fifty-two focused cases pass, with
new exact direct-cosine, footprint and invalid-extent coverage. Seven pairs
are noisy (4/7 wins, -1.94338% paired median). Twenty-one confirmation pairs
are exact, with 14/21 wins, -2.46217% paired median and 3.51836-point MAD.
The fixed screen preserves all 80 files and scores. Raw:
`promotion-entry-dct16-lf-validation/`, `promotion-entry-dct16-lf-pairs/`,
`promotion-entry-dct16-lf-confirmation/` and
`promotion-entry-dct16-lf-screen/versus-checkpoint-streams.json`.

The following trial rejects a DCT16 candidate if its fixed DC error, or its
independent luminance error, already exceeds the original final bounds.
Fifty-three focused cases pass, including the large effort-9 cone stream's
original bytes, pixels and ownership bounds. The thin-geometry filename in
the command is absent; only five actual test files are counted. Seven cold
pairs remain exact, with 6/7 wins and -2.93378% paired median. Twenty-one
confirmation pairs remain exact, with 15/21 wins, -3.49199% paired median
and 5.64145-point MAD. The fixed screen again preserves all 80 files and
scores. Raw: `promotion-entry-dct16-bound-validation/`, corresponding
pair/confirmation roots, and bound-screen `versus-checkpoint-streams.json`.
Both DCT16 changes are provisional pending combined corpus timing.

The worker now saves `${setting}.encode.json` before oracle decoding and
scoring. A timeout retains formal encode time, output hash/bytes, input pixel
hash, managed peak and encoder-phase RSS. Scored points retain the original
whole-worker RSS scope and all three required quality scores. Five focused
worker cases pass. Fourteen actual cold receipts match the pinned input,
encoded files and scored point timing/ownership, with encode RSS no greater
than final worker RSS. Raw: bound validation `receipt-focused.log`,
`types-with-receipt.log`; initial pair `encode-receipt-verification.json`.
Timer boundaries and scorer limits stay unchanged; an encoding-only receipt
does not qualify a quality curve. Both paired sources use the revised worker.

Four fixed screens have exact output. The frozen combined stack at source
`16712cbb` completes 192 fresh one-worker crop jobs, with no failures, reuse or
omissions. Own median is 1,756.410ms, mean 2,837.025ms, worst 16,138.099ms.
jSquash median 506.859ms gives 3.46529x; vips median 378.658ms gives 4.63851x.
All 64 own streams, scores and managed peaks match the pushed checkpoint;
all encoding receipts are verified. The guard takes 6min 11.163s, peaks at
423.8 MiB and uses no swap. This unpaired run does not prove a cumulative causal
gain and still fails the 3x entry gate. Root: `promotion-entry-speed-stack-speed/`,
variant `entry-speed-stack`, terminal log `promotion-entry-speed-stack-speed.log`.
Originals remain unqualified, holdout is unopened and main is unchanged.

Both crops defining the new median, im26-2026 and im26-2014, have fresh CPU
profiles with exact public output. Large-transform menus take 466.762ms and
496.563ms inclusive; model estimation and cached histogram assignment also
remain substantial. Roots: `promotion-entry-speed-stack-profile-2026/` and
`promotion-entry-speed-stack-profile-2014/`, including complete
`profile-summary.json` files. LL-395 selects one raw-frequency backing buffer
as the next allocation experiment, preserving all four model candidates.

The raw-frequency allocation experiment passes strict TypeScript and 23 focused
cases. Its seven exact cold pairs give five wins and median -0.78427%, but the
21-pair confirmation gives only eleven wins and median -0.53518%, with MAD
3.27789 points. LL-397 reverts it as neutral. Roots:
`promotion-entry-frequency-pool-validation/`, `promotion-entry-frequency-pool-pairs/`
and `promotion-entry-frequency-pool-confirmation/`, plus terminal logs.

LL-398 adapts the earlier shared ordinary/family collection to the current
retained-model path. All four candidates and their original tie priority stay;
both model buffers are owned independently. Strict TypeScript and 51 focused
cases pass, including eight exact model comparisons; nineteen further cases
pass after restricting the fold to its eight-bit token domain. All seven initial
cold pairs improve, median -5.38795%. Nineteen of 21 confirmation pairs improve,
median -4.31485%, MAD 2.65646 points. Every file is exact. The fifth fixed screen
also preserves all 80 streams and scores. The first counterbalanced run stops
after three complete pairs on im26-1026's 2 KiB managed increase; no aggregate
timing is claimed. Roots:
`promotion-entry-paired-model-validation/`, `promotion-entry-paired-model-pairs/`,
`promotion-entry-paired-model-confirmation/`, `promotion-entry-paired-model-screen/`
and `promotion-entry-paired-model-balanced-speed/`, plus terminal logs.

LL-402/403 remove raw histogram padding. Capacity derives from every legal
packed codeword, giving 28 reachable symbols; compacted centroid buffers stay
512 slots. The original standalone estimator, LIMIT tests and counterbalanced
memory assertion remain unchanged. Strict TypeScript and 32 focused cases pass,
including maximum positive/negative coefficient tokens and paired models within
2,000,000 bytes. All seven fresh median-crop pairs improve, median -5.55279%,
MAD 1.88505 points, with exact files. The repaired sixth fixed screen also keeps
all 80 streams and scores exact. All 64 counterbalanced pairs finish against source `16712cbb`.
Source `03b58ca7` preserves every file and decoded grid with no managed-memory
increase. Fifty-four pairs improve, paired median -3.54238%, MAD 2.90163 points;
corpus median improves 5.22940% and mean 2.22828%. The managed maximum stays
34,223,172 bytes. Guard 7min 3.942s, 383.6 MiB, zero swap. LL-405 retains it.
Roots: `promotion-entry-paired-model-validation/packed-*`,
`promotion-entry-paired-model-packed-pairs/`, `promotion-entry-paired-model-packed-screen/`
and `promotion-entry-paired-model-packed-balanced-speed/`, plus terminal logs.

LL-406 profiles the slow crop im26-1468 at source `03b58ca7`. Its public file
stays exact, encoder time 15,744.119ms and managed peak 34,223,172 bytes.
Modular training scoring and key sorting dominate the profile. Guard 16.644s,
298.6 MiB, zero swap. Root: `promotion-entry-paired-model-profile-1468/`.

LL-407 completes 192 fresh isolated jobs at the same source, with no reuse,
failures or omissions. All 64 own files and quality scores match the pushed
checkpoint; all 64 encode receipts verify. Own median/mean/worst are
1,593.495/2,647.187/15,548.246ms. jSquash median 500.977ms gives 3.18078x;
vips 355.931ms gives 4.47698x. The crop entry gate still fails, with its 0.05
tolerance. Managed maximum stays 34,223,172 bytes. Guard 5min 50.312s,
410 MiB, zero swap. Root: `promotion-entry-paired-model-packed-speed/`.

LL-408/409 test sharing borrowed groups between order learning and natural-order
collection. Strict TypeScript and 44 focused cases pass, including eight exact
model/order comparisons and four direct allocation-failure cleanup cases.
Seven cold pairs show five wins and median -2.13498%; the 21-pair confirmation
shows twelve wins, median -1.29657% and MAD 2.56759 points. Every file stays
exact. The confirmation is inconclusive and the source and trial-only tests
are reverted. Both rejected sources are preserved. Roots:
`promotion-entry-order-fusion-validation/`, `promotion-entry-order-fusion-pairs/`
and `promotion-entry-order-fusion-confirmation/`, plus terminal logs.

LL-410/411 test nonnegative partial error/rate bounds at coefficient-row
boundaries. Strict TypeScript and 105 focused cases pass. All 21 confirmation
files stay exact, but only nine pairs improve, median +1.25188%, MAD 3.69145
points. Reverted as neutral. Roots: `promotion-entry-partial-bound-validation/`,
`promotion-entry-partial-bound-pairs/` and `promotion-entry-partial-bound-confirmation/`.

LL-412/413 refresh the retained median-crop profile and inspect duplicate rows
in a private source copy. Menu work is 530.036ms inclusive, plane quantization
116.462ms self, cached assignment 97.226ms and physical forward 92.274ms.
Few raw rows and no occupied centroids are duplicated, so no duplicate cache
is implemented. The diagnostic public file remains exact. Roots:
`promotion-entry-packed-median-profile-2026/` and `promotion-entry-histogram-diagnostic/`.

LL-414/415 enlarge the optional source-block cache to cover the 6x6 DC halo.
Strict TypeScript and 71 focused cases pass. All 21 confirmation files stay
exact, but only eight pairs improve, median +0.48715%, MAD 2.11844 points.
Reverted as neutral, including all 37,248 bytes of additional storage.
Roots: `promotion-entry-halo-cache-validation/`, `promotion-entry-halo-cache-pairs/`
and `promotion-entry-halo-cache-confirmation/`, plus terminal logs.

LL-416 qualifies retained source `03b58ca7` on the complete development ladder.
All 576 encodes and score triples are exactly identical to the pushed candidate,
with all encoding receipts verified. Managed peak stays 34,259,887 bytes.
Guard 8min 8.726s, 1.3 GiB, zero swap. Same-ladder main deltas are unchanged:
-3.46048% SSIMULACRA2, -3.39081% 3-norm and +2.15426% max.
Roots: `promotion-entry-exact-speed-full-r1/` and terminal log. The initial
invalid `full` mode launch fails before producing curve data; its separate
guard receipt/log remain. The successful run uses `lab`, as the harness requires.

LL-417 completes 46 fresh native/Rust fixture checks at retained source
`03b58ca7`: 3 lossless, 11 effort 7, 11 effort 9, 13 full-ladder photos
and 8 DC snapshots. Every complete first-party grid is checked. All 42 real
browser cases pass, 14 each in Chromium, Firefox and WebKit. Effort 9 remains
focused correctness; the comparison screen is still reserved until promotion.
Oracle/browser guards are 2min 28.419s / 1min 58.312s, peaks 1.2 / 3 GiB,
zero swap. Bundle/documentation reports refresh to 604,300 / 677,092 bytes,
ceilings unchanged at 610,000 / 685,000. Root:
`promotion-entry-exact-speed-validation/`; guard receipts use the corresponding
`promotion-entry-exact-speed-{oracles,browser,size}` IDs.

LL-418 completes the full repository check: 3,960 passes, zero failures and
three skips across 310 files (309 passed, one skipped), 539.16s. All static
gates pass. Guard 9min 43.783s, 2.5 GiB, zero swap. Detached launch and final
guard receipt both survive, with captured code 0. Cleanup removes 2359
reproducible decoded PNGs / 1024226508 bytes, preserving 2359
encoded files and 1463 result records. Cleanup guard 6.890s,
818.2 MiB, zero swap. Root: `promotion-entry-exact-speed-validation/`.
Candidate source remains `03b58ca7`. Bundles are 604,300 / 677,092 bytes,
ceilings unchanged at 610,000 / 685,000. Crop speed remains 3.18078x jSquash,
so originals and holdout are still reserved. The 3-norm full-band clarification
also remains pending. Commit `ac74f6b0` pushes that qualified checkpoint.

LL-419/420 test reusable centroid buffers. All 21 files remain exact, but
only ten pairs improve, median +0.13152%, MAD 1.84611 points. Reverted as
neutral. Roots: `promotion-entry-centroid-reuse-validation/`,
`promotion-entry-centroid-reuse-pairs/` and `promotion-entry-centroid-reuse-confirmation/`.

LL-421 tests separate dense and sparse quantization loops. Strict TypeScript
and 61 focused cases pass. Seven files remain exact; three pairs improve,
median +0.39179%, MAD 1.90861 points. Reverted as neutral. Roots:
`promotion-entry-quantization-dispatch-validation/` and
`promotion-entry-quantization-dispatch-pairs/`.

LL-422 shares physical rows between square and horizontal transforms.
Strict TypeScript and 46 focused cases pass. Seven files remain exact;
two pairs improve, median +0.26138%, MAD 0.79720 points. Reverted as neutral.
Roots: `promotion-entry-physical-row-reuse-validation/` and
`promotion-entry-physical-row-reuse-pairs/`.

LL-423 shares the Float32 coding rows and reuses existing input storage.
Both full and LF-only rectangle results exactly match separate transforms
on 32 patterns, and all 47 focused cases pass. Twenty-one exact cold pairs
give sixteen wins, median -2.08740%, MAD 1.80161 points. Its all-64
counterbalanced check completes in LL-424; no formal peer ratio is claimed.
Roots: `promotion-entry-coding-row-reuse-validation/`,
`promotion-entry-coding-row-reuse-pairs/`, `promotion-entry-coding-row-reuse-confirmation/`
and `promotion-entry-coding-row-reuse-balanced-speed/`, plus terminal logs.

LL-424 confirms exact bytes, grids and managed memory on all 64 images.
Corpus median improves 2.90473%, but only 25 pairs improve, paired median
regresses 0.95542% and mean time regresses 1.08596%. Reverted after mixed
broader evidence. Rejected source and Node/browser fixtures remain in the
validation root. Production source returns to `03b58ca7`.

LL-425 diagnoses ascending occupied symbols in a private retained-source
copy. Across five im26-2026 models, 24.62713% to 32.79083% of slots are
occupied. Individual cache estimates are 17,106 to 32,524 bytes. The stream
and scores remain exact. Root: `promotion-entry-sparse-assignment-diagnostic/`.

LL-426 tests the optional sparse cache, preserving the original dense
fallback and releasing storage before remapping. All seven initial pairs
improve, median -4.64945%; 21 confirmation pairs give twelve wins, median
-2.07466%, MAD 4.32699 points. Strict types and 31 focused cases pass,
including exact model fallback, partial cleanup and propagation of unexpected
errors. Another 23 opaque-tool cases pass. Initial test selectors incorrectly
refuse mandatory prefix/ANS storage; corrected selectors refuse the first
sparse request only. The failed logs remain. Roots:
`promotion-entry-sparse-ac-assignment-validation/`,
`promotion-entry-sparse-ac-assignment-pairs/` and
`promotion-entry-sparse-ac-assignment-confirmation/`.

LL-427 adds exact partial-cost rejection using nonnegative remaining terms
and the original earlier-cluster tie rule. All 31 focused cases and seven
byte comparisons pass. Short timing is mixed: four wins, median -1.43788%,
MAD 1.81594 points. Cache-only source remains preserved; the combination's
fresh 192-job isolated gate is running. Roots:
`promotion-entry-sparse-ac-bound-validation/`,
`promotion-entry-sparse-ac-bound-pairs/` and
`promotion-entry-sparse-ac-bound-speed/`, plus terminal logs.

LL-428 completes the 192-job isolated gate with no reuse, failures or
omissions. All 64 own streams and scores stay exact, but the ratio is
3.25058x jSquash and 4.45635x vips. The strict verifier
rejects 30 individual memory increases, worst 32524 bytes.
A separate rejected-run audit preserves all byte/score assertions and records
these failures. Overall managed peak stays 34,223,172 bytes. Guard
5min 50.522s, 443.9 MiB, zero swap. Reverted both cache and bound plus their
fault tests. Full source restores exactly to `03b58ca7`; the qualified five
changes remain. Root: `promotion-entry-sparse-ac-bound-speed/`.

LL-429 profiles the other median neighbor at restored source `03b58ca7`.
Its public im26-3004 stream and scores stay exact. Preparation is 157.936ms
self, large menus 132.907ms, plane quantization 107.690ms, coefficient
visiting 65.375ms and XYB conversion 59.629ms. Cached assignment is only
41.566ms here. This profile guides the next experiment; its 1,676.132ms
encode is not an aggregate speed claim. Guard 2.575s, 276.5 MiB, zero swap.
Root: `promotion-entry-other-median-profile-3004/` and terminal log.

LL-430 completes the full repository check at restored source `03b58ca7`:
3,960 passed, zero failures and three skips; 531.90s. All static gates pass,
including browser:check. Guard 9min 36.580s, 2.5 GiB, zero swap. Scoped
cleanup removes 532 decoded PNGs / 228507341 bytes, preserving all 532
encoded files and 532 results after input/hash verification. Cleanup guard
2.208s, 311.1 MiB, zero swap. Its initial script fails syntax before deletion;
the failed log is retained and the corrected run completes. Bundles stay
604,300 / 677,092 bytes and ceilings 610,000 / 685,000. Only lab log and
evidence change; all production files and tests remain identical to `ac74f6b0`.
Root: `promotion-entry-neutral-speed-checkpoint/`.

LL-431 rejects cube-root approximation after exhaustive RGB comparison.
One/two Newton refinements change 51,847 / 16,799 Float32 channels. No
production conversion changes. Root: `promotion-entry-cube-root-diagnostic/`.

LL-432 to LL-434 retain Float64 reflected-pair reuse at source `db5bea99`.
The corrected generator passes strict types, 31 focused cases and 768 direct
comparisons. Eighteen of 21 confirmation pairs improve; all 64 corpus files
and grids remain exact, 48 wins, median time -1.47117%, mean -1.60886%,
paired median -2.01029%. Managed peak is unchanged. Roots:
`promotion-entry-scalar-transform-validation-r1/`, `*-pairs/`,
`*-confirmation/` and `*-balanced-speed/`. Initial declaration failure
is preserved in `promotion-entry-scalar-transform-validation/`.

LL-435 to LL-437 revert rectangle short-axis reuse after its all-crop
median rises 0.50344%, despite 40 paired wins / -0.65816% paired median.
All files/grids and managed peaks stay exact. Source before and after the
trial is preserved. Roots: `promotion-entry-scalar-rectangle-*`.

LL-438 to LL-439 revert full physical dot-product unrolling. All 65
focused cases and every paired file pass, but only ten of 21 final pairs
improve; paired median +0.10846%, MAD 2.74177 points. No storage growth.
Roots: `promotion-entry-physical-dot16-*`; rejected source remains.

LL-440 formal timing is 192 fresh jobs: own 1,548.344ms median versus
jSquash 498.078ms / vips 354.609ms, ratios 3.10864x / 4.36634x.
All 64 own JXLs, score triples and encoding receipts verify. Crop gate
fails; originals, holdout and main remain reserved. Root:
`promotion-entry-scalar-transform-speed/`.

LL-441 verifies all 576 full-ladder files, score triples and receipts
against the previous qualified candidate. BD-rate is unchanged, including
the same-ladder main means (-3.46048 / -3.39081 / +2.15426%). Managed
peak stays 34,259,887 bytes. Guard 7min 55.606s, 1.3 GiB, zero swap.
Root: `promotion-entry-scalar-transform-full/`; the prior comparison
against main remains in `promotion-entry-exact-speed-full-r1/versus-baseline.json`.

LL-442 / LL-443 pass all 46 native/Rust fixture cases and 42 real-browser
cases. The LF witness now checks 32 signed patterns per shape with zero
error, input changes or changed margins. Bundle sizes are 608,530 /
681,347 bytes; ceilings stay 610,000 / 685,000. Proposed increases are
reverted because both entries already fit. The first repository check is
intentionally terminated, not accepted; its guard says TERM despite a
success label. Fresh check-r1 logs/receipt are the qualification source.
Roots: `promotion-entry-scalar-transform-validation-final/` and
`promotion-entry-scalar-transform-checkpoint/`.

LL-444 profiles the current median neighbors at qualified source `db5bea99`.
Both complete streams/scores remain exact; plane quantization is 115.079 /
130.068ms self. Guard 4.904s, 277.5 MiB, zero swap. The first profile keeps
its negative three-microsecond delta. Roots:
`promotion-entry-scalar-transform-median-profile-2026/` and `*-1400/`.

LL-445 completes the clean repository check with the original ceilings:
3,961 passed, zero failures, three skips; 533.94s. All static gates pass,
including browser:check. Guard 9min 38.623s, 2.9 GiB, zero swap. Cleanup
removes 1,066 reproducible own decoded PNGs / 463664573 bytes, preserving
all 1,066 JXLs, 554 results, pinned inputs, raw oracle evidence, profiles,
source snapshots and logs. Cleanup guard 3.846s, 589.9 MiB, zero swap.
Diff review catches an overbroad current-state rewrite before commit; all
431 historical experiment rows and the prior checkpoint summary are restored
verbatim and checked in `history-preservation.json`. Current source has one
new retained gain out of four hypotheses; formal crop ratio 3.10864x still
fails entry. Main, originals and holdout remain reserved. Bundles are
608,530 / 681,347 bytes; ceilings stay 610,000 / 685,000.
Root: `promotion-entry-scalar-transform-checkpoint/`.

## Ordered histogram bounds (2026-10-12, LL-446 onward)

All roots below are under `.tmp/jpegxl-lossy-lab/`. Production arithmetic
stays first-party TypeScript. The fixed public encode boundaries, fixture
bytes, distance, effort and memory accounting stay unchanged.

LL-446 to LL-449 reject compact plane upper crossings, scalar crossings
and cached scalar crossings. Actual kernels preserve 489,888 / 721,032
sample decisions, including boundary values and signed zero. Compact
crossings lose their initial gain in 21 pairs; scalar variants are slower.
Initial generator and module-cycle failures are retained. Roots:
`promotion-entry-upper-crossings-*`, `promotion-entry-scalar-crossings-*`
and `promotion-entry-cached-crossings-*`.

LL-450 refreshes the restored median profile after three misses. LL-451
rejects an exact division-free zero bound as slower. LL-452 / LL-453
reject known-empty clear and pricing shortcuts. The initial zero-bound
signed-zero mismatch is repaired without changing the check. LL-454
profiles restored source again and confirms coherent pricing is inactive
at formal distance 2; no further trial extends that idea. Roots:
`promotion-entry-crossings-restored-profile-1400/`,
`promotion-entry-zero-bound-*`, `promotion-entry-empty-clears-*`,
`promotion-entry-empty-pricing-*` and
`promotion-entry-menu-restored-profile-2026/`.

LL-455 rejects the decoded-centroid table as slower. Its initialization
is explicitly outside the encode timer; no cold-start gain is claimed.
LL-456 to LL-458 reject a dense incumbent bound after its locally positive
21-pair result fails across all 64 crops: corpus median -0.13468%, mean
+0.09134%, only 31 paired wins. Every file, grid and managed peak matches.
The separate kernel proof has 128 seeded sets / 131,072 cluster decisions.
Roots: `promotion-entry-decoded-centroids-*` and
`promotion-entry-dense-assignment-bound-*`. Rejected source remains saved.

LL-459 to LL-461 retain four-term ascending cost batches at source
`01c5ac98`. All 128 seeded sets / 131,072 cluster decisions match costs,
assignments and tails. Sixteen of 21 confirmation pairs improve; paired
median -1.93040%, MAD 2.67084 points. All 64 corpus files and grids stay
exact, forty paired wins, corpus median -1.47355%, mean -1.04325%, paired
median -1.10346%, MAD 1.93433 points. Managed peaks stay equal at
34,223,172 bytes, with no new storage or outside-timer work. The one-symbol
tie fixture's missing nonempty-cluster premise is corrected; its expected
tie remains unchanged. Roots: `promotion-entry-batched-assignment-bound-*`.

LL-462 completes 192 fresh isolated peer jobs, with zero reuse, failures
or omissions. Every own JXL, score triple and encode receipt verifies
against source `db5bea99`. Own median 1,547.101ms versus jSquash 501.940ms
and vips 357.708ms gives 3.08224x / 4.32504x. The 3.05x crop gate still
fails. Managed peak stays 34,223,172 bytes. Originals and holdout remain
reserved. This refresh qualifies absolute speed; the counterbalanced run
supports the causal gain. Root:
`promotion-entry-batched-assignment-bound-speed/qualified-speed.json`.

LL-463 qualifies the full ladder: all 64 images / 576 JXL files, score
triples and encode receipts match source `db5bea99`. Managed peak stays
34,259,887 bytes, with no per-image increase. Peer BD-rate, main means
and the 209 coverage warnings stay unchanged. Guard 8min 6.677s, 1.3 GiB,
zero swap. Four-worker ladder timings do not replace isolated speed.
Root: `promotion-entry-batched-assignment-bound-full/exactness.json`.

LL-464 passes all 46 native/Rust cases and 45 real-browser cases, fifteen
per browser. The shared assignment fixtures cover batches, tails and ties
at 2/4/7/8/17 symbols and uint32-max counts. Guards: 2min 25.028s / 1.1 GiB
for decoders, 1min 54.802s / 2.4 GiB for browsers, zero swap. Root:
`promotion-entry-batched-assignment-bound-validation-final/`.

LL-465 profiles the actual isolated median neighbors im26-3004/im26-1408
and the slowest im26-1468. Median plane quantization is 118.279/168.973ms
self; cached assignment is 35.606/24.023ms. Slow-tail evaluator and radix
sorting remain dominant. All streams/scores match; twelve batch/tail cases
pass. Guard 22.679s, 355.8 MiB, zero swap. Profile timing is diagnostic.
Roots: `promotion-entry-batched-assignment-profile-3004/`, `*-1408/`,
`*-1468/` and validation-final current profile logs.

LL-466 records the stale-metrics check failure separately from qualification.
The render-only command kept old measurements. A fresh measurement of the
completed build and both renderers corrects them: 608,720/681,537 bytes,
+190 per entry. Original ceilings 610,000/685,000 remain unchanged.
Failed check: 24.247s / 1.1 GiB; corrected metrics: 22.289s / 1.1 GiB,
zero swap. Roots: `promotion-entry-batched-assignment-bound-checkpoint/`
check-r1 and validation-final metrics-r2. Fresh check-r2 is authoritative.

LL-467 applies Aaron's clarification: 3-norm must cover distance 0.5 to 3
for per-image admission. The integral and all 192 main / 384 peer rate
values stay exact. Required-range metadata changes. Main full-band counts
are 4 SSIM, zero 3-norm and 11 max comparisons out of 64 each; no admitted
SSIM/3-norm failure exceeds +8.05%. All eight earlier 3-norm regressions
are partial-band. This does not establish full-band 3-norm quality coverage.
Peer coverage warnings are now 337; the historical 209 remains in the
original summary. Initial analysis of cached supersets is corrected by
filtering the same pinned ladder as the runner, keeping every rate-value
assertion. Roots: full `full-band-main-guard.json`,
`updated-peer-coverage.json` and validation-final `coverage-focused.log`.

LL-468 passes check-r2 before the later coverage correction: 3,973 tests,
zero failures, three skips, 530.42s; all static gates pass. Guard 9min
35.827s, 2.6 GiB, zero swap. Cleanup removes 1,153 decoded PNGs / 500596244
bytes while preserving 1,153 JXLs and 641 complete results, pinned inputs,
profiles, logs, source variants and oracle evidence. Cleanup guard 3.965s,
578.4 MiB, zero swap. The later coverage correction requires check-r3 for
the final changed tree. Root:
`promotion-entry-batched-assignment-bound-checkpoint/`.

LL-469 passes the final changed-tree check-r3 after the owner's coverage
correction: 3,974 tests, zero failures, three skips; 535.71s. Every
static gate passes, including browser:check. Guard 9min 40.429s, zero swap.
All 576 files/scores, 46 decoder cases and 45 browser cases remain qualified.
All 446 prior experiment rows and the previous checkpoint state
stay verbatim in the history audit. One of nine speed hypotheses is retained;
eight are reverted. The fresh crop ratio 3.08224x still fails entry. Main,
originals and holdout remain reserved. Bundles 608,720/681,537 bytes; ceilings
610,000/685,000 are unchanged. Root:
`promotion-entry-batched-assignment-bound-checkpoint/`.

## Rejected speed follow-up (2026-10-12)

LL-470 to LL-482 test eight speed hypotheses against candidate commit
`81590f66`: eight-term histogram batches, uint32 bit-field bounds, bulk
entropy copying, partial DCT16 luminance rejection, conditional zero
histogram terms, interior weighting-tile loading, plane polarity factors
and a bit-field limit table. All eight are reverted. Twenty-one-pair
confirmations reject the two initially inconclusive changes. Every
measured stream is exact; no compression trial or aggregate speed gain
is claimed. Raw pairs, complete worker receipts, rejected source and
focused validation stay in the matching `promotion-entry-*` roots.

Two refreshed profiling rounds retain exact streams on the current median
neighbors im26-3004/im26-1408 and slowest crop im26-1468. Plane quantization
and menu preparation remain the median hotspots; tree scoring and sorting
dominate the slow tail. Roots: `promotion-entry-restored-profile-3004/`,
`*-1468/` and `promotion-entry-second-restored-profile-1408/`.

The two retained bitstream properties cover invalid field values/counts
without output mutation and exact entropy-section bits through capacity
growth at every alignment. The encoder hash restores to `01c5ac98`.
The last qualified absolute crop ratio stays 3.08224x jSquash, above the
3.05x gate. Original and holdout qualification remain reserved.

The promotion-entry document now states Aaron's 0.5 to 3 3-norm coverage
band. The runner comment distinguishes coverage from its unchanged
measured-overlap integral. Existing BD-rates, zero admitted 3-norm
full-band pairs and all prior historical rows stay intact.

Checkpoint preparation preserves the previous current-state block and
every prior experiment row. The final full check and scoped decoded-output
cleanup are pending. Root: `promotion-entry-rejected-speed-checkpoint/`.

LL-483 passes the full handoff check: 3,976 tests, zero failures and three
skips; 607.25s. Every static gate passes, including browser:check.
Guard 10min 51.254s, zero swap. Production source is exactly the pushed
checkpoint. No new encoder or compression gain is claimed. Cleanup removes
199 verified decoded PNGs / 90324759 bytes, retaining 199
JXL files and 199 complete result records. Inputs, profiles, logs, rejected
source, receipts and all 470 previous committed experiment rows remain.
Bundles stay 608,720/681,537 bytes; ceilings 610,000/685,000 are unchanged.
The qualified crop ratio stays 3.08224x jSquash; main, originals and holdout
remain reserved. Root: `promotion-entry-rejected-speed-checkpoint/`.

## Inline large-plane reconstruction (2026-10-12)

LL-484 rejects a shared rounding helper after only one of seven cold pairs
improves. LL-485 isolates inline reconstruction with the original DCT16
kernel intact. The 21-pair LL-486 confirmation has 17 wins and a -3.30661%
paired median. LL-487 checks all 64 development crops: the corpus median
falls 2.40464%, mean 1.94713%, with 45 wins. Every encoded file and decoded
grid matches the pushed c154f365 baseline, and no per-image managed peak
increases. Source is dd98eb91. No compression policy changes.

Raw evidence under `.tmp/jpegxl-lossy-lab/`:
- `promotion-entry-fused-plane-validation/` and `*-pairs/`: rejected
  shared-helper source, strict types, focused tests and seven paired workers.
- `promotion-entry-inline-fused-plane-validation/`: retained source and
  1,022,112 direct decisions/reconstructions, including all three geometries,
  tie neighbors, signed zero, compaction, coherent rates and range failures.
- `promotion-entry-inline-fused-plane-pairs/` and `*-confirmation/`:
  all initial and 21-pair cold samples, including timing excursions.
- `promotion-entry-inline-fused-plane-balanced-speed/`: 128 fresh cold
  workers, exact output/decoded grids and per-image memory comparisons.
- `promotion-entry-inline-fused-plane-checkpoint/`: fresh types and 37
  focused cases. Isolated peer speed and the remaining qualification are
  pending; the last qualified crop ratio is still 3.08224x jSquash.

All previously committed rows and checkpoint states remain. Main and
holdout remain reserved. No effort-9 screen or final-distance tuning.

LL-488 closes the crop entry gate at 3.04611201x jSquash, inside the
owner's 3.05x tolerance. All 192 fresh isolated jobs complete with zero
reuse, failure or omission. Own files/scores and 64 pre-scoring receipts
match the preceding candidate; per-image managed peaks do not increase.
Medians: own 1495.803ms, jSquash 491.053ms, vips 345.497ms.
Raw: `promotion-entry-inline-fused-plane-speed/qualified-speed.json`.
The two originals, full ladder and promotion qualification remain pending.

LL-489 completes fresh original encode entry. Own 13 MP / 21 MP encode
times are 59.332s / 80.775s; managed peaks 82,507,265 / 135,364,894 bytes
fit the preserved 137,514,476-byte original ceiling. The 13 MP ratio is
2.32767x jSquash. Five formal encode receipts survive; all three 13 MP
score triples finish. The 21 MP jSquash abort and own/vips 120-second
Butteraugli timeouts remain explicit. No 21 MP quality curve is claimed.
Root: `promotion-entry-inline-fused-plane-originals/qualified-originals.json`.

LL-490 completes the full fixed ladder: all 576 files/scores/receipts
match the pushed candidate. Maximum managed peak stays 34,259,887 bytes,
with no per-image increase. All 192 main and 384 peer BD values match.
Main means: -3.46048% SSIM, -3.39081% 3-norm, +2.15426% max. The full-band
guard admits four SSIM and zero 3-norm pairs, with no admitted failures;
zero 3-norm admissions are not proof of coverage. Peer warnings stay 337.
Root: `promotion-entry-inline-fused-plane-full/`. Crop and original encode
entry pass; remaining promotion qualification still gates main.

LL-491 recovers the two missing 21 MP score triples from saved files under
a bounded 8 GiB process cap. Butteraugli takes 18.673s / 18.322s, below
the normal 120s deadline; the longer private diagnostic deadline did not
affect those completed runs. Guard peak 5.9 GiB, zero swap. Inputs and
scorer hashes are pinned. Encoder memory limits and formal encode timings
are unchanged. Initial 6 GiB failures remain; jSquash still has no 21 MP
encode. Raw: `promotion-entry-original-21-score-8g/summary.json`.

LL-492 passes all 46 native/Rust cases and 48 real-browser cases, sixteen
each in Chromium, Firefox and WebKit. The new public large-window fixture
matches c154f365 bytes and pixels at distances 2 and 7; its frozen Node
expectations and browser comparisons retain geometry, alpha and cleanup
properties. Root: `promotion-entry-inline-fused-plane-validation-final/`;
browser log: `promotion-entry-inline-fused-plane-browser-guard.log`.
Repository check, holdout aggregate and scale/watch qualification remain.

LL-493 refreshes actual bundles from the completed build: 610,206 /
683023 bytes. The owner-approved JPEG XL ceiling rises from 610,000
to 615,000; the specialized ceiling stays 685,000. Initial failed
measurement and the passing correction remain separate. Generated
package/website metrics and documentation are refreshed before check.
Root: `promotion-entry-inline-fused-plane-checkpoint/`.

LL-494 completes repository qualification: 3,981 tests pass, three skip, no
failures; all static gates, browser:check and bundle checks pass. Guard runtime
9min 13.585s, peak 2.6 GiB, zero swap. Scoped cleanup removes 966 verified
decoded PNGs / 424,429,663 bytes, preserving 966 streams and 454 metadata
records, pinned inputs, receipts, rejected source and all original/scoring
evidence. Current source dd98eb91 is retained and will be preserved on the
candidate branch before holdout aggregate, scale and all ten watch originals.
Main stays unchanged. Root: promotion-entry-inline-fused-plane-checkpoint/.

LL-495 preserves checked source dd98eb91 as pushed candidate d3143e42. Main
remains dca2f211. All 63 frozen holdout crops prepare without failures.
LL-496 qualifies all 567 own holdout streams and pre-scoring receipts; all
189 engine jobs finish with zero failures. Against jSquash/vips the mean
SSIM deltas are -1.37257% / +0.38983%, 3-norm +10.39642% / +7.46534%,
max +13.45813% / +7.55369%. There are 329 partial-band peer warnings.
Zero full-band 3-norm comparisons are reported as missing coverage.
Guard runtime 16min 3.075s, peak 5.7 GiB, zero swap. Managed peak
32,096,860 bytes. Only aggregates are inspected; no tuning follows.
Root: promotion-entry-holdout-candidate/qualified-candidate-aggregate.json.

The first frozen-main runner stops before encoding because the private copy
omits m6-native-sources.json and m7-corpus-selection.json. Both pinned inputs
are restored; exact selection equality verifies all development crops, all
63 holdout crops and all ten watch fixtures, with main source unchanged.
Initial failure and corrected r2 guard remain distinct.
Root: promotion-main-dca2f211-reference/corpus-repair-verification.json.

LL-498 adds guarded final-report controls with 13 ladder cases and 75
focused benchmark tests passing. Normal settings and the encoder stay
unchanged. Distances 10 and 14 extend both own and vips curves only for
lab mode with promotion, effort 7 and main. No extended measurements have
run. Summaries now record actual own/peer settings, including isolated
speed distance 2 and jSquash quality 80. Full repository qualification
remains before promotion. The frozen reference uses its original copy.

LL-499 completes unchanged-main holdout qualification: all 63 images,
567 scored points, streams and pre-scoring receipts verify against the
same pinned input pixels, geometry, channels and effort. Source hashes
remain dd98eb91 (candidate) and 170c6e66 (main dca2f211). Aggregate main
deltas: SSIM -3.37961%, 3-norm -5.43628%, max -0.79824%. Full-band
admission is 8 / 0 / 10, with zero admitted SSIM/3-norm guard failures.
No 3-norm full-band coverage is claimed. Only aggregates are inspected.
Main guard 49min 56.408s, peak 2.8 GiB, zero swap.
Root: promotion-entry-holdout-candidate/qualified-aggregate.json.

LL-500 finishes all 20 own scale/original points, with zero own failures.
Managed peaks: 30,344,693 / 30,025,241 / 83,520,281 / 136,508,774
bytes; the original ceiling remains 137,514,476. Initial peer failures:
known jSquash 21 MP abort, plus four coarse vips WebAssembly exceptions
on each original after five successful points. Initial failed results
remain preserved; fresh individual public-worker retries are next.
Scale guard: 40min 52.211s, peak 7.5 GiB, zero swap. Strict TypeScript
passes for the added qualification and recovery harnesses. No encoder,
input, distance, effort, memory ceiling or scoring deadline changes.
Root: promotion-entry-scale-originals/progress.json.

LL-501 qualifies all 20 own scale streams and receipts against actual
pinned pixels. Fresh public-worker retries recover the four 13 MP vips
points; the four 21 MP coarse points still fail. jSquash also aborts at
21 MP. Neither incomplete reference curve enters complete-curve BD-rate.
Three-pair means, SSIM / 3-norm / max: JS -5.37174% / +1.45141% /
+5.10547%; vips -6.95490% / -2.82089% / -0.27144%. Initial failures
and fresh attempts remain pinned. Eighteen historical peer receipts are
absent and listed explicitly; every own pre-scoring receipt is required.
Verifier r1/r2 fail on old-cache assumptions; corrected ladder filtering
and explicit receipt scope pass strict TypeScript and qualification.
Recovery guard: 2min 8.306s, 5.4 GiB, zero swap. Source stays dd98eb91.
Roots: promotion-entry-scale-originals/qualified-large-curves.json;
promotion-large-vips-recovery/complete.json.

LL-502 adds four complete large-image native/Rust decoder cases, bringing
the total to 50. All RGB grids agree within one 8-bit code value and
alpha is exact. Source, encoded hashes and both binary pins verify.
Eight reproducible NPYs are validated, hashed and removed after receipts
are saved, reclaiming 1,377,948,392 bytes. Encoded evidence remains.
Corrected combined guard: 46.453s, peak 1.9 GiB, zero swap.
Root: promotion-large-image-oracles/complete.json.

LL-503 passes the complete repository check: 3,994 tests, three skips,
zero failures; 312 passing files and one skipped file. All static,
generated, packaging, type, lint, format, bundle, docs and browser:check
gates pass. Source stays dd98eb91. Bundle values remain 610,206 / 683,023
bytes; ceilings remain 615,000 / 685,000. Test duration 547.49s; guard
9min 54.024s, peak 2.8 GiB, zero swap. All ten watch originals remain
before promotion; no new compression trial or speed hypothesis occurs.
Roots: promotion-final-ladder-check/check.log;
bounded-runs/promotion-final-ladder-check-r1-20261012.json.

## Watch continuation and report corrections (2026-10-12)

LL-504 fixes the report's stale 3-norm coverage wording. Required coverage is
distance 0.5 to 3, as confirmed by Aaron; its BD-rate integral still uses the
common measured interval. Partial-band measurements remain in aggregates and
mark coverage incomplete. All 73 focused report, metric and ladder tests pass.
Source dd98eb91 and measured BD-rate values remain unchanged.
Root: promotion-band-report-focused.log.

LL-505 corrects the main sparse-layout byte count in LL-377 and the earlier
promotion-entry paragraph. The saved public-encode result is **13,935 to
5,265 bytes**. The 32,896-byte value belongs to the separate conservative-path
control indexed earlier. The other saved main/candidate pairs remain
904 to 577, 1,410 to 499 and 502 to 502 bytes. Complete first-party, native
and Rust candidate grids equal source pixels exactly. All approved layout
snapshots remain no larger than main. Historical text and both receipts are
preserved; this paragraph is the correction.
Root: promotion-entry-layout/result.json.

LL-506 continues the same ten-original watch run, started at 18:10 UTC,
without restarting any own measurement. At 19:24 UTC four own curves
complete and the fifth has two scored points: 38/90 own points, zero own
failures. The maximum completed-curve managed peak is 136,508,774 bytes,
below the unchanged 137,514,476-byte ceiling. Initial reference failures
are preserved: jSquash at 21 MP and vips at 21 MP, im26-1026 and im26-1472.
Fresh retry preparation derives all missing settings from the declared
ladder, including settings absent after a fatal peer abort. It never invents
original failure records or imputes scores.

The sequential continuation waits for the exact original guard receipt.
It then runs fresh public vips retries, own stream/receipt qualification,
fresh isolated watch speed, its qualifier and the complete repository check.
Strict TypeScript passes. Every heavy tree has its own bounded guard and
runs sequentially; normal scoring deadlines remain unchanged. This queued
path stops on a failed requirement and does not promote main. No completed
watch or refreshed original-speed claim is made at this checkpoint.
Roots: promotion-watch-continuation/progress.json;
promotion-watch-continuation.log; watch-postpromotion-qualification-types-r6.log.

## Watch memory gate and capability copy (2026-10-12)

The existing frozen-source watch run reaches five complete own curves and 45 scored points with zero own execution failures. im26-2012 is a pinned 4000x3000, 12 MP input. Its nine successful encodes all exceed the unchanged 137,514,476-byte managed ceiling; the maximum is 174,544,064 bytes. Peak minus emitted output is exactly 173,528,641 bytes at every setting. Promotion remains unqualified. No threshold, fixture, ladder or expected value changes. The sequential continuation will stop when the memory qualifier rejects these peaks.

The diagnostic preserves actual stream hashes, original pre-scoring receipts and pinned input bytes/dimensions in promotion-watch-memory-profile/memory-gate.json. The first-party archive instrumentation, pinned source identity and strict type check are in prepared.json, source/profile.ts and typecheck.log. Allocation tracing has not run and its eventual timing will be diagnostic only. The original watch and queued recovery trees finish first.

Published capability copy now follows the frozen implementation: shared opaque RGB8/RGBA8 policy, visible color count, 4x4 block context, measured fine-distance fallback and continuous contrast; no obsolete current photo area window. Large optional transform selection starts at distance 2 and continues above 4. All changed public surfaces are generated from capabilities/manifest.json. Eight capability-manifest tests, capabilities:check and browser:check pass. Existing 50 independent-decoder and 48 real-browser cases retain their frozen-source identity; a fresh full check remains pending. No new parity claim is added.

## Prepared RGB projection and watch receipt audit (2026-10-12)

The same watch reaches 9 complete own curves and 81/90 scored points with zero own execution failures. preparation-checkpoint.json verifies every completed stream hash, pinned PNG hash/dimension and original pre-scoring receipt. Actual-pixel receipt digests agree across settings; this checkpoint does not independently re-decode the input. im26-2012 remains a real managed-memory failure. Incomplete own and peer jobs continue on their existing handles.

The strict-typed first-party projection archive separates source stride from RGB output channels across plane preparation, RCT, grouped/local-color searches and document/flat alternatives. It keeps complete canonical-stream comparisons and removes one full RGB staging bitmap. candidate-01-prepared.json and candidate-01-rgb-projection.patch pin the two changed source modules; production files still match the baseline hashes. Eleven exact canonical-stream pairs and the actual pinned original are queued sequentially after the baseline allocation trace. No prepared case is reported as passed, and no diagnostic timing is reported as formal speed. The predicted 36,000,000-byte reduction alone remains 1,029,588 bytes above the unchanged ceiling.

Source remains dd98eb91. Required 3-norm coverage remains distance 0.5 to 3; partial curves remain in measured-overlap aggregates and stay outside the per-image guard. Existing coverage property tests include both missing endpoints. This checkpoint adds no compression trial, production codec change, threshold change or main promotion. Roots: promotion-watch-memory-profile/preparation-checkpoint.json; candidate-01-prepared.json; candidate-typecheck-r3.log; driver-typecheck-r3.log; candidate-01-progress.json.

A fresh full repository check is queued independently after all four existing watch/recovery/trace/projection parent PIDs end. Its strict-typed driver requires the heavy service to be inactive and production source to remain unchanged, then runs npm run check under a separate 6 GiB guard. It includes browser:check and preserves diagnostic failures. No fresh full-check pass is claimed until its actual exit and guard receipt succeed. Roots: promotion-memory-preparation-check/progress.json; promotion-watch-memory-profile/check-preparation-typecheck.log; check-preparation-driver.log.

## Complete own watch execution (2026-10-12)

At 21:23:27 UTC all ten own watch curves have 90/90 scored points and zero own execution failures. watch-completion-checkpoint.json verifies every actual stream hash, pinned input PNG bytes/dimensions and original pre-scoring receipt. Actual-pixel receipt digests agree across each ladder; this audit does not independently re-decode the PNGs. Nine inputs fit the unchanged managed ceiling. im26-2012 remains the one memory-gate failure, with all nine peaks too high. Reference workers and recovery remain live, and this is not complete promotion qualification.

The public projection verifier is strict-typed and prepares five cases: fine, middle and coarse grayscale, thin palette artwork and tiny effort-9 correctness. It requires exact baseline/candidate bytes, complete decoded RGB/RGBA color equality, exact opaque alpha and untouched caller buffers. Each candidate is also encoded at its actually measured managed peak, with exact output required. Runtime cases remain unexecuted. This adds no compression trial, threshold relaxation or production source change. Roots: watch-completion-checkpoint.json; watch-completion-checkpoint-typecheck.log; verify-rgb-projection-public.ts; public-projection-typecheck.log.

## Public projection verification and terminal watch (2026-10-12)

All five prepared public-API cases pass. Baseline and projection archives emit exact bytes, complete RGB/RGBA grids agree, opaque alpha stays exact and caller buffers remain unchanged. Every candidate also encodes at its measured managed peak with identical output. The three 96x80 grayscale RGBA cases save exactly 23,040 bytes each, three bytes per source pixel. The two palette cases keep their peaks. This does not establish the full-original saving or satisfy its memory gate. The small correctness tree uses a separate 512 MiB cap, one CPU and zero swap; it completes in 10.380s with a 111.7 MiB cgroup peak and diagnostic process RSS of 167,813,120 bytes. The watch remains the only heavy image tree, and no formal speed claim is made. Roots: public-projection.json; public-projection-guard.log; public-projection-typecheck-r2.log.

The original watch guard is terminal with code 1 and no signal, after 3h16min15.046s and a 7.5 GiB guarded peak, zero swap. All 90 own points succeed. Eight initial reference failures remain: jSquash at 21 MP and vips at 21 MP, im26-1026, im26-1472, im26-2012, im26-1212, prior-12mp-im26-1416 and tundra. The continuation terminates before recovery because its empty-omissions assertion includes required-range warnings. The strict audit matches every one of those 25 entries to a retained partial comparison and proves zero input omissions. Original summary, guard and failing continuation log are preserved. Required coverage, full-band per-image admission and the 137,514,476-byte managed ceiling remain unchanged; peer coverage stays report-only. The queued baseline allocation trace is now live. Roots: coverage-diagnostic-audit.json; coverage-diagnostic-typecheck.log; promotion-watch-continuation.log; trace-progress.json.

## Actual RGB staging reduction (2026-10-12)

The baseline trace reproduces the saved 1,015,423-byte original stream and its 174,544,064-byte managed peak. All eleven canonical packed-RGB/projected-RGBA pairs pass with exact bytes, each saving three bytes per source pixel. The actual 4000x3000 projection preserves the original SHA, caller pixels and zero final ownership, removes exactly one 36,000,000-byte allocation and reaches 138,544,064 managed bytes. Both snapshots sum exactly to their measured peaks. This remains 1,029,588 bytes above the unchanged 137,514,476-byte ceiling, so promotion remains unqualified. The old 6,291,456-byte gradient context still appears at the peak during learned encoding; the next repair addresses lifetime rather than routing or quality.

The traces run after the original watch and its continuation terminate. Fresh reference recovery has not run: the continuation stopped on the separately preserved coverage-classification assertion. Its absence does not change this exact-output allocation comparison. The older trace-progress policy sentence assumed successful recovery and does not prove recovery occurred. Diagnostic guard runtimes are 3min32.420s / 3min34.840s, with zero swap; allocation-observed timings remain outside formal speed reports. Production source remains dd98eb91 and no threshold or source input changes. Roots: candidate-01-qualified.json; candidate-01-matrix.json; trace.json; candidate-01-trace.json; original bounded guard receipts.

## Fresh checkpoint check and context lifetime properties (2026-10-12)

LL-514 records the fresh full repository check on frozen production source dd98eb91: 3,995 passed tests, three skips, zero failures and all static gates including browser:check. Its guard finishes with code 0 and no signal in 10min33.753s, with a 2.6 GiB peak and zero swap. This check does not verify the archival context-lifetime source.

The archive's 61 unchanged encoder-memory and opaque-color property tests also pass, including the exact managed budget, one-byte-below rejection, exact byte checks and four actual 24 MP encodes. Both test files match production hashes. Its separate one-CPU, 1 GiB guard finishes with code 0 in 5min26.108s, peak 631.6 MiB and zero swap. The batch was mistakenly classified as small and overlaps the repository check. No focused timings count as speed evidence. The earlier full-check receipt's no-overlap policy describes intent and does not prove execution. Both trees are terminal before the next original trace. Original logs and receipts are preserved.

The next verification pins the two archival source changes, excludes the allocation observer and private test export from its production patch, and runs canonical pairs, public-API comparisons and the actual original sequentially. No production source change, new compression trial, threshold relaxation or main promotion occurs at this checkpoint. Roots: promotion-memory-preparation-check/complete.json and check.log; promotion-watch-memory-profile/candidate-02-focused.log, candidate-02-prepared.json, candidate-02-lifetime.patch and candidate-02-progress.json.

## Actual context-lifetime repair (2026-10-12)

LL-515 records the completed sequential archival verification: eleven exact canonical-stream pairs, five exact public-API comparisons and the actual pinned 4000x3000 original. RGB/RGBA color grids, opaque alpha and caller pixels remain unchanged. The original emits the same 1,015,423-byte stream with SHA 6bdee45ec6e4c76c2915875e9768de909e503482b54e226feb0cce0f8d6cebe1. Managed peak is 131,737,889 bytes, saving 42,806,175 against the reproduced baseline and fitting the unchanged 137,514,476-byte ceiling by 5,776,587. Final live bytes and allocations are zero.

The first-party patch removes the full RGB staging bitmap and closes losing contexts/output inside their scopes. A winning replacement drops references to its discarded plan before releasing its contexts and bytes. No quality, routing, search, geometry or threshold change is introduced. The original trace guard finishes with code 0 in 4min9.985s, peak 560.6 MiB and zero swap; its observed timing remains diagnostic only. Patch SHA 55747f1cc1095e8bed4c563e5ca944c6f76a6f55bac713aacdd5cd5df6ae2944 excludes allocation instrumentation and the private test export. This successful archive comparison authorizes applying the repair to the candidate for fresh production qualification; it does not qualify main promotion. Roots: candidate-02-complete.json, candidate-02-matrix.json, candidate-02-public.json, candidate-02-trace.json and original bounded guard receipts.

## Applied production memory repair (2026-10-12)

LL-516 applies the repair as production source d39e42a3792b0180404c3985c580a588d3db14ab99e76bdf8dd33a1fe58cfdc7. Allocation instrumentation and private exports are absent. The new public bounded-color regression and existing palette public test pass. Fine, middle and coarse grayscale cases preserve emitted bytes, complete RGB/RGBA color grids, opaque alpha and caller buffers at a 950,000-byte budget below their former staging peaks. The same portable fixture is added to browser coverage.

The existing fallback/cancellation fault hook now targets the first actual canonical RGB color plane because the RGB staging bitmap has been removed. Its fallback color bound and cancellation/ownership requirements stay unchanged. The focused guard finishes with code 0 in 5.399s, peak 568.1 MiB and zero swap; it provides correctness evidence only. Fresh full repository check is the sole running heavy tree. Preceding dd98eb91 corpus, decoder/browser and speed evidence remains explicitly historical until refreshed. Main stays unchanged. Roots: production-focused.log; bounded-runs/promotion-projection-production-focused-20261012.json; promotion-rgb-lifetime-check/progress.json.

LL-517 preserves the first applied-source full-check failure: size:check finds stale generated package metrics before tests run. The guard exits 1 without a signal in 28.026s, peak 1.1 GiB and zero swap. npm run size then regenerates both package-metrics JSON files and README's generated size row. Current JPEG XL bundles are 610,916 / 683,735 bytes, within unchanged 615,000 / 685,000 ceilings. The full check retry uses a fresh root and retains the original failure. This changes measurement data only. Roots: promotion-rgb-lifetime-check/complete.json and check.log; production-size.log; promotion-rgb-lifetime-check-r2/progress.json.

LL-518 preserves the second static failure at documentation:check, before tests. documentation:write regenerates documentation-data.json and README's generated metrics section after the package-size refresh. documentation:check, strict typecheck and format:check then pass. Production source stays d39e42a3, both full-check attempts remain preserved and a fresh full check is still required. Candidate preservation is allowed before promotion; main remains dca2f211. Roots: promotion-rgb-lifetime-check-r2/complete.json and check.log; production-documentation-refresh.log. All earlier historical attempts and raw receipts remain unchanged.

LL-519 completes the fresh production check: all static gates pass, then 3,994 tests pass, two fail and three skip. The only failing file is jpegxl-learned-lossless.test.ts. The tight-budget byte snapshot is now smaller, 17,116 to 17,033 bytes, with exact original samples and zero ownership. The optional-color fallback test's 14,000,000-byte budget now admits the same 60,679-byte stream as unrestricted, so its intended allocation failure is absent. Neither budget nor fallback/sample/ownership expectation may be relaxed. The queued continuation stops before browsers or corpus work. Roots: promotion-rgb-lifetime-check-r3/complete.json and check.log; production-qualification-driver.log.

LL-520 preserves the first causal diagnostic failure. It verifies the smaller dense snapshot, then rejects an overly broad Int32 4096-element hook because the first matching allocation belongs to required palette preparation. The guard exits 1 in 9.559s, peak 167.7 MiB and zero swap, after the full check ends. The failed script remains diagnose-budget-tests-r1.ts and the raw log remains budget-test-diagnostic.log. A corrected diagnostic will leave required allocations untouched and force LIMIT only inside the actual optional RCT sample call. No production change or property relaxation follows the failed diagnostic.

LL-521 verifies the corrected optional RCT fault point. Dense snapshot: 17,033 bytes, checksum 1,356,082,369, 395,523 exact samples, peak 15,201,075 at the unchanged 15,989,965 budget. Natural color stream: 60,679 bytes, peak 13,737,917 below the unchanged 14,000,000 budget. Refusing the actual optional RCT sample allocation yields 74,926 bytes, peak 12,810,041, exact decoded samples, intact caller pixels and zero live bytes. The guard finishes with code 0 in 12.106s, peak 204.4 MiB and zero swap. Roots: budget-test-diagnostic.json and budget-test-diagnostic-r2.log; bounded-runs/promotion-projection-budget-diagnostic-r2-20261012.json.

Snapshot justification: released losing contexts admit the same best learned model at the original dense budget, so exact bytes/checksum change from 17,116/1,452,409,174 to 17,033/1,356,082,369. All exact-sample and memory assertions remain. The fallback test preserves its budget and strict larger-than-unrestricted, sample and cleanup assertions; fault injection restores its intended actual allocation-failure precondition. A separate natural-budget regression requires byte equality with unrestricted output, preventing an artificial fallback restriction. No production code or promotion threshold changes.

LL-522 verifies all 18 focused learned-lossless tests on production source d39e42a3. The original dense, fallback, exact-sample, palette and ownership assertions pass; the new natural-budget case also passes. The guard exits 0 without a signal in 2min15.352s, peak 760.9 MiB and zero swap. Its tree is terminal before the full-check retry. No focused timing counts as speed evidence. The test repairs are candidate preservation work; main remains unchanged and the fresh full check is still required. Roots: promotion-watch-memory-profile/learned-budget-focused.log and bounded-runs/promotion-projection-learned-budget-focused-20261012.json.

## Fresh full check and browser task-limit diagnosis (2026-10-12)

LL-523 qualifies npm run check on applied source d39e42a3 and pushed candidate ad7c275a: all static gates, 3,997 passed tests, three skips and zero failures. There are 313 passing files and one skipped file. The guard exits 0 without a signal in 10min56.613s, peak 2.5 GiB and zero swap. This is the only heavy tree until it ends. Roots: promotion-rgb-lifetime-check-r4/complete.json and check.log; bounded-runs/promotion-rgb-lifetime-check-r4-20261012.json.

LL-524 corrects qualification order so formal original speed precedes the reserved holdout refresh. The browser stage starts as the full check completes; an explicit waiting-phase assertion prevents an unsafe stop. Its supervisor alone is paused while its child guard finishes, then resumed to consume the actual failure receipt and stop naturally. The unused large-stage waiting supervisor is replaced without running an image job. Both histories remain preserved. Corrected supervisors run one sequential heavy tree on the same candidate revision. They do not reuse own measurements or advance main.

LL-525 preserves the real-browser failure: 36 passed cases, comprising every Chromium and WebKit case, and 18 failed Firefox cases. The guard's unchanged 256-task limit records 156 exhaustion events; browser startup closes pages and esbuild reports EAGAIN / OS-thread errno 11. Read-only diagnosis finds 20 rolldown workers, eight Tokio workers and 26 esbuild threads in development tooling. All failure traces are copied to browser-failure-artifacts before the retry clears Playwright's output. The guard exits 1 without a signal in 3min12.337s, peak 2.7 GiB and zero swap. Source and property expectations stay unchanged; the retry bounds development pools to two threads with GOMAXPROCS, RAYON_NUM_THREADS, TOKIO_WORKER_THREADS and UV_THREADPOOL_SIZE, preserving one Playwright worker, 6 GiB memory, zero swap and 256 tasks. Browser timings are never compression-speed evidence. Roots: promotion-rgb-lifetime-qualification-r2/browser.log, task-limit-diagnostic.json, browser-failure-artifacts and the bounded browser receipt. New root: promotion-rgb-lifetime-qualification-r3.

LL-526 completes the retry: all 54 real-browser cases pass, eighteen per browser, with the new bounded RGB projection and existing palette recovery/cancellation assertions intact. The guard exits 0 without a signal in 2min35.646s, peak 2.4 GiB and zero swap. The same 6 GiB and 256-task limits remain. Actual thread counts clarify LL-525's requested pool settings: esbuild has 6/8 OS threads, Tokio two, libuv two and rolldown fourteen. Those settings bound requested parallelism rather than every OS thread count. The captured cgroup event count is zero. No source, budget or test threshold changes. The next isolated crop-speed tree starts after the browser guard ends, with one worker, no timing reuse and no browser pool settings in its command. Roots: promotion-rgb-lifetime-qualification-r3/browser.log and task-limit-diagnostic.json; bounded-runs/promotion-rgb-lifetime-browser-r2-20261012.json.

LL-527 completes the fresh 192-job crop run but rejects entry: own/jSquash/vips medians 1,567.2247465/500.1707140/364.4045745ms, ratios 3.13337967x/4.30078231x. All own streams, scores and receipts remain exact, with lower or equal per-image managed peaks; maximum falls from 34,223,172 to 31,709,202 bytes. The guard exits 0 in 6min8.964s, peak 431.2 MiB and zero swap, but the subsequent entry assertion fails. The unused large-stage supervisor is stopped while waiting. Full development, formal original speed and holdout have not run on this source. Main and the 3.05x gate stay unchanged. Roots: promotion-rgb-lifetime-speed/qualified-speed.json and summary.json; qualification-driver-r3.log; promotion-rgb-lifetime-large-qualification-r2/stopped-entry-failure.json.

LL-528 starts one cold counterbalanced comparison over the same 64 crops at distance 2. The exact predecessor comes from first-party git archive 47a99dd7 and verifies dd98eb91; it contains no allocation instrumentation or private export. Base/candidate order alternates, streams and native decoded PNGs must match, and managed peaks may not rise. An initial copied-driver row inference error is fixed with explicit types only; strict TypeScript passes and runtime computation is unchanged. Source d39e42a3 stays frozen. No aggregate diagnosis or formal peer-relative speed is claimed before all pairs finish. Roots: promotion-rgb-lifetime-speed-diagnosis/dd98-source/source-identity.json, balanced.log and balanced/rows.json.

LL-529 completes all 64 pairs: corpus median -0.64674%, paired median -0.78938%, MAD 2.39339 points, mean -1.23127%, 36/64 wins. All encoded streams and native PNGs are identical; managed maximum drops 2,513,970 bytes. The seven-minute sequential guard uses 392.1 MiB and zero swap. This provides no measured source slowdown and does not overturn the formal 3.13337967x failure.

LL-530 records fresh profiles of both actual median neighbors and the slow tail, with exact public outputs. The median physical transforms cost 71.060/77.494ms self and menu preparation 81.448/77.090ms self; RGB projection is not a median hotspot. The tail remains dominated by tree evaluation and sorting. Test a speed-only rectangular source view to eliminate repeated half-tile copying and 24,576 bytes of actual staging storage. Preserve arithmetic order, all candidates and original ceilings. Previous dot-product unrolling and larger caches remain rejected. Roots: promotion-rgb-lifetime-speed-diagnosis/profiles and promotion-physical-source-base. The initial archive's nonexistent metrics path is corrected before using the baseline.

LL-531 verifies 480 actual transform cases and exact public menus/selection against the preserved source; managed storage falls by exactly 24,576 bytes. The original helper's incorrect hash argument, initial strict errors and invalid companion-test names are preserved and corrected. The new asymmetric test initially violates its own zero-DC precondition, while all original properties pass. Its corrected modulation keeps every original assertion. Raw source, failure log, strict logs and kernel.json are retained in promotion-physical-source-validation and the ignored first-party archive. No formal speed or retained-gain claim yet.

LL-532 passes 46 focused cases and all seven exact cold pairs. Initial paired median -4.45342%, MAD 5.75481 points and four wins are noisy, so longer qualification is required. LL-533 preserves all 21 exact confirmation files but excludes the entire timing run because a production typecheck overlaps its first pair. The typecheck passes; its log and the original confirmation remain preserved. A fresh 21-pair root repeats the complete comparison in isolation, with no selected subset and no retained speed claim. Roots: promotion-physical-source-pairs, promotion-physical-source-confirmation, promotion-physical-source-confirmation-r2 and promotion-physical-source-validation.

LL-534's isolated 21-pair confirmation is neutral: paired median +0.54967%, MAD 1.84656 points, nine wins and mean +0.31166%. All bytes and pixels remain exact. Revert the production source view to d39e42a3, retaining the additional asymmetric half-energy property and the rejected source/evidence. The 1min30.036s guard peaks at 281.5 MiB with zero swap. No corpus gain or formal gate pass is claimed. A private ownership-visit diagnostic is prepared to investigate the remaining measured memory-scope cost; it does not change production.

LL-535 rules out empty-scope skipping: only 139/24,037 and 130/17,030 visitor calls belong to empty scopes on the actual median neighbors. Instrumented files and native PNGs remain exact. The private 4.577s diagnostic uses 232.3 MiB and zero swap. Its initial nested tar sandbox failure and archive path-alias strict errors are preserved and corrected; production stays unchanged.

LL-536 prepares isolated inline DCT16 rounding/error fusion, source 9c77134f. It removes token staging in the same error plane and keeps rounding, ranges, reconstruction, luma rejection, candidates and backing allocations exact. The accepted larger-plane kernel is untouched; the prior shared-helper trial is not repeated. Production/private strict checks pass before actual-kernel, focused and cold-pair verification. Roots: promotion-dct16-fusion-validation and promotion-dct16-fusion-pairs. No retained gain or entry-pass claim yet.

LL-537 passes 1,697,472 exact actual-kernel decisions/errors, 704 unchanged range refusals and 47 focused properties. All seven cold pairs preserve complete files/native PNGs and managed peaks. Paired median -3.34060%, MAD 0.68507 points, mean -4.12362% and five wins justify longer confirmation. The sequential guard finishes in 33.348s at 477 MiB with zero swap. The 21-pair confirmation is still required before corpus or peer-relative qualification.

LL-538's 21 isolated pairs retain every stream, native pixel grid and managed bound; nineteen improve. Paired median -6.04915%, MAD 4.14203 points, mean -8.46894%, with base/candidate medians 1,548.325519/1,425.445380ms. Preserve all excursions. Qualify the entire 64-crop corpus next, preceded by public fine/middle/coarse effort-7/9 comparison against the preserved source. No new peer ratio or promotion claim. Roots: promotion-dct16-fusion-confirmation and promotion-dct16-fusion-balanced-speed.

LL-539 verifies all six public reference streams and decoded grids, distances 0.65/2/7 at both efforts, with complete geometry, exact opaque alpha, caller immutability and zero scratch. Public byte/pixel checksums are pinned in promotion-dct16-fusion-validation/public-reference.json; new focused tests retain those pre-fusion results without changing the existing middle/coarse expectations. This correctness qualification precedes the sole all-64 cold paired tree. The preceding confirmation guard used 278.6 MiB, zero swap and 1min31.704s. Effort 9 is untuned; its screen remains post-promotion.

LL-540 completes all 64 cold paired development crops: corpus median -4.09664%, paired median -4.13805%, MAD 4.18498 points, mean -2.63977% and 48 wins. Every stream/native grid matches and every managed peak is no higher; both maxima are 31,709,202 bytes. The seven-minute guard uses 391.5 MiB and zero swap. Retain DCT16 fusion conditionally for renewed promotion checks and fresh isolated peer timing. Previous failed timing entry remains preserved; main and holdout remain reserved. Roots: promotion-dct16-fusion-balanced-speed and the current qualification scripts.

LL-541 refreshes bundles to 611,655/684,475 bytes within unchanged 615,000/685,000 ceilings, regenerates documentation, and passes all 49 focused cases including the added fine/effort-9 public snapshots. The existing real-browser fixture now covers effort-9 fine/middle/coarse outputs as well; its test count remains 54 across the selected suite. Size and docs/focused guards finish sequentially at 46.451s/1.1 GiB and 4.404s/461.8 MiB, zero swap. Strict qualification scripts pass. The fresh full npm check then runs alone on fixed source 9c77134f; real browsers and peer-speed entry remain pending. Roots: promotion-dct16-fusion-validation and promotion-dct16-fusion-check.

LL-542 completes the fresh full repository check: 4,000 passes, three skips, zero failures, all static gates including browser:check, existing bundle ceilings and generated data. The fixed-source guard finishes in 10min43.818s at 2.7 GiB with zero swap; Vitest takes 596.53s. Preserve this qualified candidate before real-browser and formal peer-speed entry. Main remains unchanged. Roots: promotion-dct16-fusion-check/complete.json and check.log.

LL-543 removes only 240 complete, reproducible decoded PNGs from five explicitly listed pairing roots, reclaiming 102,890,496 bytes. The plan verifies pinned inputs and every stream/metadata hash before deletion; all 240 streams and metadata files remain. Failed trials, the contaminated timing run, failed formal entry, profiles, original inputs and receipts are preserved. The 1.159s guard uses 185.7 MiB, zero swap and exits 0. Root: promotion-dct16-fusion-validation/decoded-cleanup-plan.json and decoded-cleanup-complete.json. Preserve the checked candidate before fresh browser and peer timing; main remains reserved.

LL-544 preserves checked source 9c77134f as pushed candidate 97218126; local and remote main remain dca2f211. The 523 prior lab rows and evidence prefix stay unchanged. Fresh browser qualification passes all 54 cases across Chromium, Firefox and WebKit in 2min47.016s, peak 2.3 GiB and zero swap. Compiler pools stay at the preceding qualified setting only within the browser command. Root: promotion-dct16-fusion-qualification-r3/browser.log and history-audit-final.json.

LL-545 passes formal crop entry on 192 fresh isolated jobs with no reuse, omission or failure. Own/jSquash/vips medians 1,549.2548885/522.3673315/380.196159ms give 2.96583418x/4.07488306x; unchanged entry limit 3.05x. All 64 own streams, scores and pre-scoring receipts match historical qualified outputs; managed maximum 31,709,202 bytes, no increase. The 16.680s own tail remains included. The 6min9.719s one-worker guard peaks at 443.2 MiB, zero swap; receipt qualification also exits 0. Full development, fresh original speed, aggregate-only holdout and large-image curves still precede main. Root: promotion-dct16-fusion-speed/qualified-speed.json.

LL-546 qualifies all 576 fresh development points with identical streams/scores and verified pre-scoring receipts. Managed maximum 31,745,917 bytes, no increase. Means against main remain SSIM -3.4604771%, 3-norm -3.3908126%, max +2.1542644%, passing aggregate gates. Full-band admission stays four SSIM and zero 3-norm comparisons, no admitted failures; zero admissions do not establish coverage. Both peer tables retain all 337 partial-range warnings and their unchanged report-only means. The 7min52.151s four-worker quality sweep peaks at 1.3 GiB, zero swap; its times are excluded from speed claims. Root: promotion-dct16-fusion-full/exactness.json, full-band-main-guard.json and updated-peer-coverage.json.

LL-547 passes all 13 photo and eight snapshot/property cases in first-party, native and Rust decoders on clean fixed source 9c77134f. Complete grids and exact alpha verify. Guards finish sequentially at 3.995s/369.6 MiB and 1min14.542s/1 GiB with zero swap. Fresh one-worker timing on all ten watch originals follows, before reserved holdout. Root: promotion-dct16-fusion-oracle-validation/photo-oracles/result.json and snapshot-oracles/result.json.

LL-548 qualifies all ten own originals and 29 fresh, fully scored jobs; jSquash's sole 21 MP abort remains unmeasured and excluded from both matched medians. Matched nine-image ratio 2.53521789x jSquash meets the 5x target; all-ten ratio 6.39306375x vips. Formal 13/21 MP times 56,986.464064/77,987.377608ms retain exact streams against dd98eb91 and managed peaks 82,507,265/135,364,894 bytes. The repaired 12 MP point takes 176,742.236593ms at 131,570,519 bytes. Every original fits unchanged 137,514,476-byte ceiling. The one-worker guard finishes in 21min19.448s at 7.3 GiB, zero swap; code 1 preserves the reference abort. Receipt and complete pixel qualification exits 0 in 24.609s at 638.3 MiB. Fresh aggregate-only holdout starts only after these original gates pass. Root: promotion-dct16-fusion-watch-speed/qualified-watch-speed.json.

LL-549 passes aggregate-only holdout qualification on all 63 images and 567 fresh own points, with matching streams/scores against dd98eb91, actual pre-scoring receipts, pinned pixels and no managed increase. Main means SSIM -3.3796052%, 3-norm -5.4362763%, max -0.7982410% pass. Full-band main admission eight SSIM and zero 3-norm comparisons, no admitted failures; zero admissions do not establish coverage. Peer means remain jSquash -1.3725670/+10.3964198/+13.4581273%, vips +0.3898265/+7.4653439/+7.5536935%, with all 329 partial warnings. Managed maximum 30,819,889 bytes. Individual holdout quality values stay uninspected. The 7min10.805s quality guard uses 3.6 GiB; aggregate/receipt qualification 3.881s/205.2 MiB; zero swap and no timing claim from sweeps. The stage completes before fresh scale and full watch qualification begin. Root: promotion-dct16-fusion-holdout/qualified-aggregate.json and promotion-dct16-fusion-qualification-r3/complete.json.

LL-550 completes all four scale inputs and 20 own points without own failure, managed maximum 136,508,774 bytes below unchanged 137,514,476 ceiling. Public jSquash and vips 21 MP reference failures remain preserved. The input/diagnostic inspector verifies zero input omissions. The 16min16.604s one-worker guard peaks at 6.9 GiB, zero swap; code 1 records the reference failures and sweep times are excluded from speed claims. Full nine-setting watch starts next; actual scale stream/pixel/receipt continuity and reference-gap accounting remain queued after fresh reference recovery. Root: promotion-dct16-fusion-scale/summary.json and coverage-diagnostic-audit.json.

LL-551 audits the first complete watch curve: all nine 13 MP streams match dd98eb91 and every managed peak is no higher, maximum 84,413,277 bytes. No extra encode or tuning follows. Both references remain complete; full watch continues on the fixed local revision. The evidence checkpoint may advance the remote candidate only, preserving the local revision used by the running qualification. Root: promotion-dct16-fusion-validation/first-watch-curve-audit.json.

LL-552 prepares four private final-phase TypeScript helpers while the watch tree runs alone. They are not yet typechecked or executed. The report separates nine-distance promotion and aggregate-only holdout from eleven-distance final development and secondary curves, reports missed peer targets and partial coverage, and includes fresh declared-preset effort-9 timings. Publication preserves dated historical website studies. Cleanup is restricted to ten explicit completed own-output roots and verifies input, stream, receipt and metadata hashes before removing decoded PNGs. All three inspected worst-max streams still match their saved visual receipts. Four own watch curves are complete at the preparation checkpoint; reference failures and zero input omissions remain explicit. Source stays 9c77134f, local revision 97218126, main dca2f211. Preparation hashes and policies: promotion-dct16-fusion-validation/final-helpers-prepared.json; helper paths are indexed there. Qualification, strict helper checks, promotion, effort-9 comparison and publication remain pending.

LL-553 preserves both prepared helper versions in final-helpers-preparation-v1 and final-helpers-preparation-v2, with original hash receipts. Revised report types retain unknown fields after record spreads; the website updater verifies its insertion anchor. Formal speed presets and exclusion of scoring are explicit, with no equal-quality timing claim. Five successful repaired 12 MP encode receipts show a managed maximum of 131,737,889 bytes against the unchanged 137,514,476-byte ceiling. The full scored curve remains pending, as do strict helper checks and execution. The live watch tree runs alone on frozen local 97218126; source, main, compression decisions and timing evidence remain unchanged. Raw: promotion-dct16-fusion-validation/final-helpers-prepared-r2.json.

LL-554 completes the read-only repaired 12 MP watch audit: all nine complete stream hashes, score triples and input-pixel receipt hashes match the preceding candidate. Every managed peak is no higher and fits the unchanged 137,514,476-byte ceiling; maximum 131,737,889 bytes. No own failures, extra encode, scorer process, timing claim or compression trial. Seven own watch curves finish at the checkpoint; three originals remain. Source stays 9c77134f at frozen local 97218126. Full watch, reference recovery, actual-pixel qualifications and twelve full-image independent-decoder cases still gate main. Raw: promotion-dct16-fusion-validation/repaired-watch-curve-audit.json; live progress remains in the large-qualification-r2 log.

LL-555 replaces the prepared cleanup's im26-only input-name assumption with exact input path/hash admission from five prepared manifests. The declared prior-photo, portrait, tundra and earthrise challenges remain eligible without broadening the ten own-output roots or weakening stream, receipt and metadata checks. All three helper preparation versions are preserved with hashes. Strict checks and execution remain pending, and no decoded raster is deleted. Raw: promotion-dct16-fusion-validation/final-helpers-prepared-r3.json and final-helpers-preparation-v3/receipt.json. The same heavy watch tree remains alone; source and local revision are unchanged.

LL-556 completes all ten own original curves and 90 scored points, zero own failures. Eight initial reference failures are retained. The one-worker watch guard records 1h49min33.967s, 7 GiB and zero swap, code 1 for references. These times remain outside formal isolated-speed comparisons. Root: promotion-dct16-fusion-watch/summary.json and coverage-diagnostic-audit.json.

LL-557 retries twenty-six missing vips points in fresh public workers at their exact declared inputs and settings. Six recover; twenty settings on five inputs remain failed. Initial outputs and all attempts are preserved; the normal 120-second scorer limit stays fixed. Guard 3min55.216s, 5 GiB, zero swap, code 0. Root: promotion-dct16-fusion-watch-vips-recovery/complete.json.

LL-558 qualifies all 20 scale and 90 watch own points against actual pinned pixels, complete encoded hashes, prior scores and pre-scoring receipts. No managed peak rises; both maxima are 136,508,774 bytes against unchanged 137,514,476 ceiling. Scale has three complete comparison pairs per peer, eighteen legacy peer receipt absences and fifteen coverage warnings. Watch has nine jSquash/five vips curves, six explicit reference gaps, zero legacy receipt absences and thirty warnings. Qualifiers exit 0 at 2.774s/594.4 MiB and 8.589s/747.6 MiB, zero swap. Roots: promotion-dct16-fusion-scale/qualified-large-curves.json and promotion-dct16-fusion-watch/qualified-large-curves.json.

LL-559 completes all twelve full-image first-party/native/Rust cases, at most one color-code difference and exact alpha over 512,083,460 RGBA samples per complete comparison set. Verified native/rust NPYs are hashed before removal, reclaiming 4,096,669,816 bytes while streams and per-fixture receipts remain. Guard 2min10.072s, 1.8 GiB, zero swap, code 0. Captured source 9c77134f at revision 97218126 remains fixed through completion. Root: promotion-dct16-fusion-large-oracles/complete.json; the full large qualification ends at 02:57:23 UTC.

LL-560 passes strict TypeScript and noUncheckedIndexedAccess checks for all four final helpers. Effective config explicitly includes each requested file. The independently prepared promotion audit also passes strict checks. Guards exit 0 at 202.2/199.7 MiB and zero swap. Roots: promotion-dct16-fusion-validation/final-helpers-typecheck.log and final-helpers-effective-tsconfig.json; promotion-entry-audit-tsconfig.json.

LL-561 verifies every owner main-entry gate against current artifacts: source identity, unchanged main, 192 fresh isolated crop jobs, all 576 development and 567 aggregate-only holdout points, actual 13/21 MP formal encodes, all 110 large-curve receipts, twelve decoder cases, 4,000 Node passes/three skips, 54 browser passes and successful guard receipts. Coverage and peer target misses remain explicit. The audit exits 0 at 145ms/36 MiB. Local candidate synchronization to pushed f9670e2c happens only after the qualification handle is terminal. Root: promotion-dct16-fusion-validation/promotion-entry-final-audit.json. Main promotion and the final untuned screen/reports remain.

LL-562 independently compares every large-curve result record: all 110 byte counts and complete SSIM/max/3-norm score triples are exactly equal to their preceding records. Current and previous metadata hashes remain in the read-only audit. This closes the score-continuity claim alongside the qualified streams and actual-pixel receipts without another encoder or scorer process. Root: promotion-dct16-fusion-validation/large-score-continuity.json.

LL-563 pushes qualified candidate and main as 6c252932 through a fast-forward from dca2f211. Source fingerprint remains 9c77134f; package version and dependency boundaries stay unchanged. Repository format check passes 2,280 files with nine existing size warnings. A preliminary unavailable formatter invocation changes no files. The final driver captures promoted main and starts the fresh one-worker effort-7 reference before the one untuned effort-9 screen, both independent decoders and eleven-distance final photo/secondary reports. Source and HEAD remain fixed through these measurements and publication checks. Roots: final-promoted-measurements/progress.json, promotion-dct16-fusion-validation/final-measurements.log and promotion-record-format guard receipt. Final artifacts, website publication, verified raster cleanup and final handoff checks remain.

LL-564 completes the fresh effort-7 reference screen: sixteen photos and 80 own points, zero failures, one worker and managed maximum 30,199,743 bytes. Five-distance screen means SSIM/3-norm/max are jSquash -7.45703/+8.67710/+11.88925% and vips -5.28150/+5.30514/+4.30668%, separate from the nine-distance promotion and holdout. Guard 3min26.451s, 435.4 MiB, zero swap, code 0. The one untuned effort-9 screen then starts on fixed main 6c252932. Root: promotion-effort-seven-screen/summary.json and final-measurements.log.

LL-565 preserves the single completed effort-9 measurement: all 48 jobs, 80 own points and 272 fresh jSquash-9 points finish without encode/score failure. Assembly then fails on the driver's enclosing effort-7 folder path. Guard 35min42.144s/602.7 MiB, zero swap, code 1. All point files, actual receipts and the failed driver remain. Roots: promotion-effort-nine-screen/progress.json and final-measurements.log.

LL-566 rebuilds only report aggregation. The first attempt rejects historical cached setting order; corrected set validation preserves order and verifies all actual inputs, streams, own/JS-9 timing receipts and effort-7 references. All 144 comparisons and 133 partial warnings are retained. Mean deltas vs effort 7 are -0.34972/-0.27760/-0.50588%; sweep median 13.70348x. Guard 504ms/73.8 MiB, zero swap, code 0. No encoder/scorer rerun, timing replacement or cache substitution. Root: promotion-effort-nine-screen/aggregation-only-recovery.json; original failed aggregation receipt is preserved.

LL-567 finds stale promoted-main browser expectations while Node 22/24 CI passes. Five photo snapshots, dense bounded output, palette snapshots, mode/frame layouts and cone metadata are aligned with already qualified Node/native outputs, retaining all bounds. Failed CI logs are saved as promotion-dct16-fusion-validation/main-promotion-ci-failed.log, run 38341298478.

LL-568 exercises all repaired browser cases: 36 pass, while three engines expose the previously hidden bounded-fallback property error 2.609262572 above unchanged 2.5. Guard 18min58.863s/2.3 GiB, zero swap, code 1; traces remain preserved. The encoder must be repaired without loosening quality or working limits.

LL-569 restores the existing standalone Q7/DC precision for coarse compressionSearch=false recovery, where both standalone and photo policies were disabled. Current source 1224c8a8 yields error 2.274696879, exact alpha, 690-byte output, checksum 2602123369 and unchanged peak 797,198 under original 797,262 budget. Fine recovery and normal photo policy are excluded by the condition. Original source is saved in ci-bounded-fallback-repair/jpegxl-vardct-encode-before.ts; the first diagnostic and new encoder source are retained.

LL-570 passes 34 focused Node cases, all three real-browser bounded cases and complete native/Rust grids within one code and exact alpha. Original budgets and thresholds stay unchanged. Guards: 2min4.668s/978.1 MiB, 11.243s/2 GiB and 685ms/269.9 MiB, zero swap. Verified NPY cleanup reclaims 268,479 bytes while preserving the stream and receipts. Roots: ci-bounded-fallback-repair/browser.log and oracles/complete.json. The repair remains unpromoted until default-stream continuity and full handoff checks pass.

LL-571 qualifies current source 1224c8a8 at 54c07fba through npm run check: 4,000 passes, three skips, zero failures; browser:check and all static gates pass. The fine fallback remains unchanged. Guard 8min58.780s/2.6 GiB, zero swap. Refreshed bundles are 611,664 / 684,484 bytes, with unchanged 615,000 / 685,000 ceilings. Roots: ci-fallback-qualification/check.log and ci-fallback-full-check guard receipt.

LL-572 preserves the two-worker browser task-quota failure: TasksCurrent/TasksMax 256, pids.events max 36. The entire tree is terminated and its failure status/traces retained. A one-worker continuation keeps all assertions, timeouts and ceilings unchanged, reuses only the already passed full check on identical source/HEAD, and proceeds through the same presentation cases. Strict verifier types pass again in 445ms/208.4 MiB. Roots: ci-bounded-fallback-repair/browser-task-limit.txt, browser-pids-events.txt, browser-task-limit-traces and qualification-driver-r2.log. Full browser, speed and default-byte qualification remain pending; no new compression trial.

LL-573 preserves the one-worker Firefox task failure after the completed Chromium cohort: 256 tasks, final pids.events max 724. Logs and traces stay intact and the combined guard is terminated. Only browser verification opts into 512 tasks; formal encoders/scorers remain at 256, with all memory, swap, reserve, CPU, assertions and timeouts unchanged. Admission passes in 7ms/1.7 MiB; 128/513/NaN are rejected before run creation. Roots: browser-r2-task-limit.txt, browser-r2-pids-events.txt, browser-r2-task-limit-traces, guard-task-policy-change.json and browser-task-policy-fixtures.json under ci-bounded-fallback-repair. Full matrix recovery is pending.

LL-574 corrects a bounded-oracle template label through a sidecar: actual helper distance 9, original recorded setting 2. Original metadata, stream and native/Rust measurements are untouched and hash-bound. All current verification, guard, promotion, final publication/cleanup helpers and prepared browser report coverage pass strict types, 449ms/237.3 MiB, zero swap. Roots: ci-bounded-fallback-repair/oracles/metadata-correction.json and ci-fallback-verifier-types-r4 guard. Main remains unchanged pending complete browser, speed and 1,253-stream qualification.

LL-575 passes the entire repaired-source browser compatibility gate: 1,775 passes, 15 skips, zero failures across Chromium/Firefox/WebKit; all 1,790 declared cases accounted for. Guard code 0, null signal, 1h20min37.039s/3.6 GiB, zero swap. Browser task allowance 512 only; original assertions/timeouts/memory policies stay unchanged and both failed quota attempts remain preserved. Root: ci-fallback-qualification/browser-compatibility-r3.log and ci-fallback-browser-compatibility-r3 guard. Six isolated photo checks, fresh speed and default-byte proofs remain before promotion.

LL-576 finds and additively corrects the older sparse-layout prose: actual stream and result.json main size is 13,935, not 32,896; candidate 5,265. Glyphs 904/577, opaque RGB 1,410/499 and opaque RGBA 502/502 remain exact in both independent decoders and first-party output. Final report code verifies original hashes and sizes and retains producer identity. The prepared promotion audit also requires all ten fresh formal distance-2 streams to match the actual prior native/Rust-verified inputs, with binaries hash-verified. Both helpers pass strict checks; compiler failures are preserved. Original history/prose is untouched. Roots: promotion-entry-layout/result.json, layout-report-types.log and original-bridge-audit-types-r3.log under ci-bounded-fallback-repair. Publication/audit await remaining qualification.

LL-577 passes all six isolated original/fine-photo cases across the three real browsers at unchanged correctness/storage assertions. Guard 17min5.301s/2 GiB, zero swap, code 0. Root: ci-fallback-qualification/browser-photo.log and its guard. Both browser gates now pass on source 1224c8a8.

LL-578 passes fresh isolated speed: 192 crop jobs, zero reuse/failure/omission, all 64 own streams/scores exact. Ratios 2.91564998x jSquash/4.16664717x vips. Crop guard 5min29.816s/433.9 MiB, zero swap. All-ten originals produce 29 available fully scored jobs; sole jSquash 21 MP abort is preserved. Matched ratio 2.54397503x jSquash; all-ten ratio 6.43972449x vips. 13 MP 56.935s/2.27029879x, 21 MP 77.345s; largest managed 135,364,894 under fixed 137,514,476; encoder RSS maximum 573,845,504. Original guard 21min19.269s/7.4 GiB (code 1 reference abort), qualifier 24.651s/627.4 MiB, code 0; zero swap. Formal task cap 256 unchanged. Roots: ci-fallback-crop-speed/qualified-speed.json and ci-fallback-watch-speed/qualified-watch-speed.json. Fresh default-byte qualification begins; no new compression trial or elapsed-time causal claim.
