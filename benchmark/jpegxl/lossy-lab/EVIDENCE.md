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
speed and independent-decoder evidence is indexed at the end of this document.
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
