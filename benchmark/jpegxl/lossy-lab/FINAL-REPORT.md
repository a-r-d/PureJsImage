# JPEG XL lossy campaign final report

Source a49a70f93da34a3ec1c47053dcbfaf9beb8d299d, fingerprint 1224c8a82ba91d08e127b1ca5f225a8cc8bb3d2d104152fa228e5b328139d7be.

The fallback correctness repair preserves all 1,253 normal promotion streams with no managed-memory increase. Nine-distance compression scores retain producer 9c77134ffca7d6cc880b1f33cf856b7044b1e7d9179856bae4cbc54398ba013e; identical encoded bytes bridge their decoded grids and quality. Isolated speed and the final eleven-distance reports are freshly measured on the repaired source. The single effort-9 screen retains its original producer and timings.

Negative BD-rate means fewer bytes at equal measured quality. Promotion compares with unchanged main; peer targets are reported separately. Full-band and partial comparisons remain distinct.

## Final photographic development report

64 frozen photographs, deterministic native-pixel crops, eleven distances including 10 and 14. This final ladder is separate from the nine-distance promotion comparison.

| Peer | Metric | Mean BD-rate | Images | Full band |
| --- | --- | ---: | ---: | ---: |
| jsquash | SSIMULACRA2 | -1.08% | 64 | 47 |
| jsquash | Butteraugli max | +15.63% | 64 | 41 |
| jsquash | Butteraugli 3-norm | +15.60% | 64 | 0 |
| vips | SSIMULACRA2 | +1.18% | 64 | 46 |
| vips | Butteraugli max | +6.63% | 64 | 0 |
| vips | Butteraugli 3-norm | +9.87% | 64 | 0 |

## Promotion against unchanged main

| Metric | Development mean | Holdout mean | Development / holdout full-band images |
| --- | ---: | ---: | ---: |
| SSIMULACRA2 | -3.46% | -3.38% | 4 / 8 |
| Butteraugli 3-norm | -3.39% | -5.44% | 0 / 0 |
| Butteraugli max | +2.15% | -0.80% | 11 / 10 |

All 576 development and 567 holdout own points qualify. Holdout inspection remains aggregate only. Zero admitted 3-norm comparisons do not prove full-band coverage. The aggregate peer holdout table is in FINAL-CAMPAIGN.json.

The three worst development max regressions against main are im26-3304 (+63.11168%), im26-3312 (+46.07737%) and im26-1020 (+34.68075%). Their retained visual inspection shows near-flat dark, cream and blue textures, with larger square color boundaries in the blue candidate. The displayed points were nearest max distance 3, with partial coverage and unequal rates and qualities. All candidate streams and scores remain exact through the speed and allocation repairs. Max is not gated per image under the owner's entry decision.

## Mode and frame snapshot qualification

The three held assertions cover four input forms. The retained source measurements below use complete exact source grids in first-party, native and Rust decoders. Each candidate is no larger than its main baseline. Current Node and browser checks keep the strengthened exact-sample and size bounds.

| Input | Main bytes | Candidate bytes | Exact candidate source samples |
| --- | ---: | ---: | --- |
| sparse | 13,935 | 5,265 | Yes |
| repeated-glyphs | 904 | 577 | Yes |
| opaque-page-rgb | 1,410 | 499 | Yes |
| opaque-page-rgba | 502 | 502 | Yes |

The sparse baseline is 13,935 bytes, verified from the retained stream and measurement record. The older layout write-up's 32,896-byte value is a prose error; its original text stays preserved in the lab history. These layout records retain their original producer identity in FINAL-CAMPAIGN.json.

## End-of-campaign targets on the reserved holdout

| Peer | Metric | Mean BD-rate | Target | Mean target met | Full band / measured | Above +20% on measured overlap | Worst on measured overlap |
| --- | --- | ---: | ---: | --- | ---: | ---: | ---: |
| jsquash | SSIMULACRA2 | -1.37% | 0.00% | Yes | 10 / 63 | 2 | +35.19% |
| jsquash | Butteraugli max | +13.46% | +8.00% reference only | No | 30 / 63 | 11 | +104.37% |
| jsquash | Butteraugli 3-norm | +10.40% | +5.00% reference only | No | 0 / 63 | 4 | +74.29% |
| vips | SSIMULACRA2 | +0.39% | 0.00% | No | 9 / 63 | 3 | +38.48% |
| vips | Butteraugli max | +7.55% | +8.00% | Yes | 0 / 63 | 7 | +82.59% |
| vips | Butteraugli 3-norm | +7.47% | +5.00% | No | 0 / 63 | 4 | +71.53% |

The SSIMULACRA2 target is met against jSquash and missed against wasm-vips. Against the current wasm-vips peer, the 3-norm mean exceeds +5%, while the max mean is within +8%. The per-image +20% aspiration is not met on measured overlaps. Partial bands limit these conclusions; the table exposes coverage and does not identify holdout images. These targets are report-only and do not replace the owner's promotion gates.

## Isolated speed and memory

All formal speed jobs use effort 7 and identical prepared inputs, at own distance 2, jSquash quality 80 and wasm-vips distance 2. Encode time excludes perceptual scoring. These are declared-preset timing comparisons; quality-matched compression is assessed separately through BD-rate.

Crop median: 2.916x jSquash and 4.167x wasm-vips. All 192 timing jobs are fresh.

Original matched-set median: 2.544x jSquash on 9 common inputs. All-ten ratio: 6.440x wasm-vips. The missing 21 MP jSquash timing is excluded from both matched medians.

The formal 13 MP ratio is 2.270x jSquash, within the 5x target and the 10x entry bound. The formal 21 MP own encode is 77.345 seconds; its jSquash ratio is unavailable because the reference aborts. The matched-original median meets the 5x target. These measurements use fresh isolated jobs, not curve-sweep timing.

| Original | Own seconds | Managed bytes | Encoder peak RSS bytes |
| --- | ---: | ---: | ---: |
| im26-2004 | 56.935 | 82507265 | 421502976 |
| im26-2400 | 77.345 | 135364894 | 523182080 |
| im26-1026 | 51.286 | 75963746 | 408264704 |
| im26-1472 | 45.529 | 75963746 | 406065152 |
| im26-2012 | 179.013 | 131570519 | 573845504 |
| im26-1212 | 51.909 | 75963746 | 409931776 |
| prior-12mp-im26-1416 | 45.883 | 75963746 | 381710336 |
| portrait-2400x3000 | 30.485 | 45772246 | 333312000 |
| tundra-4000x3000 | 51.404 | 75963746 | 402284544 |
| earthrise-2400x2400 | 19.933 | 36710110 | 324714496 |

All 90 own watch points and 20 scale points fit the unchanged 137,514,476-byte managed ceiling. Watch maximum is 136508774 bytes. Sweeps are not formal speed measurements.

The original 12 MP memory failure remains in the lab history. The allocation repair preserves the stream and saves 42,806,175 managed bytes on its pinned fine-distance case. Guarded tree memory includes native scoring and does not describe encoder RSS.

Qualified minified bundle sizes are 611,664 core bytes and 684,484 specialized bytes. The unchanged check ceilings are 615,000 and 685,000 bytes. Bundle size is reported without making it a campaign promotion gate.

## Untuned effort 9

One 16-image, five-distance screen runs after promotion, with a fresh one-worker effort-7 reference and fresh jSquash effort-9 curves. All 80 own effort-9 streams pass both independent decoders and focused tests. EFFORT9.md and FINAL-CAMPAIGN.json contain its BD-rate and speed results. Cross-peer sweep timing distributions cover different public quality ladders; the effort-7/9 own comparison uses identical settings.

At the declared timing presets, distance 2 for us and quality 80 for jSquash, effort 9 is 12.463x our effort 7 and 11.624x jSquash effort 9, on the same sixteen inputs. These are preset timing comparisons; equal knobs do not establish equal quality.

## Secondary images

The 56 non-photo development images have a separate eleven-distance report in FINAL-SECONDARY.md. Their rates are not mixed into the photographic mean. Constant-quality curves and missing intervals remain N/A rather than becoming zero-valued BD-rate.

## Remaining gaps and tested ideas

The peer tables and coverage counts above determine the remaining compression gaps. Passing promotion against main does not establish peer parity. The owner cancelled further Butteraugli tuning; this campaign ends after publication and final checks.

## Ideas tested and rejected

These are historical development screens, each with 16 photos and 80 own
points. The bases are E2 or retained E4 plus palette precheck, as stated.
Their original individual-image gate was 3%. They were reverted before
the promotion-entry rules changed. They do not describe the final
candidate's delta against main.

| Idea and lab row | Base | Mean BD-rate change: SSIM / 3-norm / max | Result |
| --- | --- | ---: | --- |
| Finest covered-cell raw-Q floor, LL-030 | E2 | +1.5742% / +0.9790% / +1.6499% | All three means worsen. |
| Per-window reconstruction-error cap of 1.05, LL-031 | E2 | +0.2514% / -0.0440% / -0.6442% | Max improves, but SSIM worsens; worst SSIM +3.2159%. |
| Local activity mask and soft footprint penalty, LL-033 | E2 | +0.2540% / -0.1495% / -0.4370% | Mixed metric trade; worst SSIM +4.3577%. |
| Development-calibrated channel/activity loss, LL-039 | E4 | +2.9947% / +2.5794% / +5.5960% | Better average map prediction fails in the actual codec; worst max +60.5702%. |
| Positive quadratic channel loss, LL-045 | E4 plus palette precheck | +0.1966% / +0.1868% / +1.4595% | Positive loss alone does not protect the final output; worst max +21.3181%. |
| DCT16-only raw-Q floor, LL-046 | E4 plus palette precheck | +0.2909% / +0.2489% / +1.3628% | All three means worsen. |
| Quantization against decoded centroids, LL-047 | E4 plus palette precheck | +0.4607% / +0.9033% / +0.8219% | Scalar reconstruction accuracy does not improve measured compression. |
| Spatial source-brightness sensitivity, LL-048 | E4 plus palette precheck | +0.5755% / +1.0252% / +4.3131% | Quality worsens and concurrent encode sum rises 19.24%. |

The map fit in LL-035 improved held development validation RMSE, but its
worst residuals increased. LL-039 then tested that model in actual encoding
and failed. The zero-anchored positive fit in LL-042 did not improve its
validation error. LL-051's display-RGB fit assigned blue a zero weight,
so it was not adopted as a strictly positive loss. These fits are diagnostic
evidence, with no retained compression gain.

Complete-alternative searches remain available at slow effort 9. They moved
out of effort 7 under the owner's amendment; they were not deleted.
Effort 7 uses estimated selection and retains the required geometry,
palette, fine-quality and continuity protections.

## Remaining ideas if Aaron reopens compression work

The following order is a qualitative estimate of upside, not a measured
gain. The post-promotion Butteraugli tuning phase is cancelled.

1. Diagnose final reconstructed block and channel error on the worst
   development images at matched bytes. Calibrate a first-party model to
   that error rather than accepting improved average map prediction as
   an encoding win.
2. Test one bounded local refinement pass that protects the worst regions
   while preserving SSIMULACRA2 and the isolated speed limit. Current crop
   speed has little margin below the approved 3.05x threshold.
3. Revisit transform selection with final spatial error and a consistently
   priced original-block fallback. The raw-Q floor and simple quadratic
   loss trials above show that those rules alone are insufficient.


Exact DCT16 rounding/reconstruction fusion improves the paired full-corpus median by 4.09664% without changing bytes or managed peak. Direct rectangular source reads were reverted after a neutral isolated confirmation; empty ownership-scope skipping was ruled out before a trial. These are speed investigations, not new compression gains.

## Reproduction and evidence

Use the checked-in lossy-lab runner and pinned corpus selection. Promotion uses nine distances; final reporting uses --mode lab --promotion --final-report on main. Slow effort 9 uses --mode screen --promotion --effort 9 --effort7-reference with one worker. Retain cached peer curves per corpus version and measure formal speed without reusing timings.

FINAL-CAMPAIGN.json contains aggregates, coverage, original receipts, reference gaps and hashes of the locally preserved raw reports. Inputs, streams, failures, profiles and original receipts remain preserved; only verified reproducible decoded rasters are cleaned up. See EVIDENCE.md, the lab log and ../PROVENANCE.md.
