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
The three mode/frame assertions remain unchanged pending an owner decision.
Compression and speed still fail promotion entry; holdout remains unopened.

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
