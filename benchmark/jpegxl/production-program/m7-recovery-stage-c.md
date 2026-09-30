# M7 recovery: rate-distortion selector probe and handoff

Stage A is in [the evaluation amendment](m7-recovery-stage-a.md). The reviewed PR #37 public encoder remains at its Stage A behavior. The validated DCT16 backend is preserved at development commit [`7842de8`](https://github.com/a-r-d/PureJsImage/commit/7842de8) on `codex/jpegxl-transform-backend`. Its [backend report](https://github.com/a-r-d/PureJsImage/blob/7842de8/benchmark/jpegxl/production-program/m7-recovery-stage-b.md) records the transform, distance and coefficient limits, bundle growth, checks, and 24 independently decoded streams. The DCT16 selector is still experimental and is not in the public default.

## Selector decision

The existing 8×8 alternative selector only accepts a lower estimated bit count when no coding channel's squared error grows. I tested an opt-in cost of weighted XYB squared error plus `lambda * estimated bits`. It estimates strategy signaling as two bits. Four bounded rate weights were tested. A fifth run at `lambda = localScale² * 1e-6` added estimated nonzero-count cost and coded zeros through the last nonzero coefficient in the emitted scan order. This was a general rate model experiment, not source-ID tuning. The exact final prototype is [archived as a patch](../experimental/m7-recovery-stage-c-rd8-prototype.patch) against development commit `7842de8`; its SHA-256 is `07c61506486427a7ccceb31fd7b6bf33888ad34385818dee215e5ac46edaf892`. The first four variants use the same patch without the coded-zero addition and with their named scalar rate weight.

All five runs kept the same eight prepared development derivatives, distances 1, 2 and 3. Every one of the 120 changed streams was measured and decoded by pinned native libjxl, pinned Rust and the repository decoder. Independent RGB8 maximum difference was one level. The bounded process tree used zero swap in every run. Each raw report records source pixels, encoded artifact hashes, settings, metric tool hashes and scores. These development derivatives do not establish original-size or unseen-source behavior.

| Candidate | Raw report and SHA-256 | Butteraugli-2 candidate/base median on available brackets | Photo `im26-1030` / gradient `im26-1416` | SSIMULACRA2-80 photo / gradient, coarse interpolation |
| --- | --- | ---: | ---: | ---: |
| Rate weight `1e-7` | [Raw](m7-recovery-stage-c-rd8-lambda1e-7.json), `8d44da64fbb49fd7ecfda3686e66700c0faf137c4f1b05d0450f998b567522bd` | 1.106, 5 cases | 1.106 / 1.108 | unresolved |
| Rate weight `1e-6` | [Raw](m7-recovery-stage-c-rd8-lambda1e-6.json), `51795c41d31022d5b3463bd6518aa6982045a878ea4f5dc458ee70ebd7a53b3f` | 0.991, 7 cases | 0.946 / 0.995 | 1.043 / 1.027 |
| Rate weight `2e-6` | [Raw](m7-recovery-stage-c-rd8-lambda2e-6.json), `304402f9f1964cbbe235a8a531c42eb5cd2052415af33a0c3d0c38da769ddda9` | 0.987, 7 cases | 0.951 / 1.036 | 1.032 / 1.028 |
| Rate weight `1e-5` | [Raw](m7-recovery-stage-c-rd8-lambda1e-5.json), `b25b718069c369475d038fa4146a30e8b9e2dfb91ec8eb94fd2050fba8d97b50` | 0.993, 7 cases | 0.993 / 1.052 | 1.036 / 1.037 |
| `1e-6` plus coded-zero span | [Raw](m7-recovery-stage-c-rd8-span.json), `d88dff9fac67c6c7f276b4ce4b7fae30b263c7cf0a02e4d13842244626d8d719` | 0.991, 7 cases | 0.957 / 0.992 | 1.041 / 1.031 |

These ratios interpolate only within the three measured distances. The SSIMULACRA2-80 photo and gradient intervals are wider than Stage A's three-score-point diagnostic width, so their small apparent rate regressions are unresolved, not formal pass/fail results. No missing target was extrapolated or omitted. The Butteraugli and SSIMULACRA2 views disagree: at `1e-6`, the photo improves at Butteraugli 2 while its coarse SSIMULACRA2-80 rate estimate worsens. At `2e-6` and `1e-5`, the gradient worsens at Butteraugli 2 while the coarse SSIMULACRA2 estimate also worsens. The best apparent median is insufficient to select a general encoder policy without tight local comparisons and complete-image guardrails.

The actual byte response exposes a rate-model gap. At distance 3, `1e-5` selected about 1,013 more alternate 8×8 transforms on the photo and raised the file by 2,174 bytes; it selected about 717 more on the gradient and raised the file by 1,493 bytes. The same model selected about 1,128 more on a document derivative and saved 1,634 bytes. Counting coded zeros and nonzero counts did not remove this class split. The proxy does not predict the image-dependent entropy contexts and map cost accurately enough to make a safe global selector. It also does not yet optimize local quantization together with transform choice or model alpha and HDR rendering. The candidate was rejected and its code was restored to the retained DCT16 backend revision.

## Evidence and qualification boundary

The five zero-swap receipts are [weight `1e-7`](m7-recovery-stage-c-rd8-lambda1e-7-receipt.json), [weight `1e-6`](m7-recovery-stage-c-rd8-lambda1e-6-receipt.json), [weight `2e-6`](m7-recovery-stage-c-rd8-lambda2e-6-receipt.json), [weight `1e-5`](m7-recovery-stage-c-rd8-lambda1e-5-receipt.json), and [coded-zero span](m7-recovery-stage-c-rd8-span-receipt.json). Their limits govern the benchmark trees, not the production encoder's limits. Focused tests and typecheck passed for the experimental probe. The retained DCT16 milestone passed the full repository check, including 6,426 duplicated-worktree tests with six existing skips. No new timing claim is made. No approved 2 MP, fixed eight-original, HDR/alpha, or unseen-source qualification was run for this rejected selector.

## Target decision at the unchanged public revision

| Target | Result |
| --- | --- |
| Public stream interoperability, native precision, color signaling, exact default lossy alpha, lossless and exact-JPEG guarantees | Unchanged from the [frozen Prompt 9 qualification](m7-prompt9-report.md); the Stage B/C code is isolated. |
| Lossless size and transparency targets | Pass on the [frozen lossless evidence](m7-prompt4-report.md). |
| Lossy 2 MP size median/p90 and worst at matched quality | Pass only on measured brackets in the [frozen matrices](m7-prompt9-report.md); missing and wide intervals remain classified in [Stage A](m7-recovery-classification.json). |
| Reference-limited and unresolved comparisons | The ten pinned native RGB8 high-band controls remain below 90 under the tested settings. Stage A does not call them first-party failures or comparison passes. Other narrow-bracket and first-party misses remain open. |
| Reference-host effort-1 and original 12 MP effort-3 runtime | Pass on prior [frozen reference-host timings](m7-prompt9-report.md); this stage collected no new timings. |
| Original-size gradient, screenshot, HDR, transparency and visual defects | Open in the [finite defect register](m7-recovery-stage-a.md); no new public correction qualified. |
| Stable lossy scope | Not justified. Lossy remains Experimental. |

A next selector needs measured coefficient/context and strategy-map rate estimates, joint quantizer choice, reconstructed edge and composite error, and tight nearby metric points. If that produces a candidate, freeze it before the approved 2 MP and eight-original runs, HDR/alpha checks, conformance/resource checks and real-browser verification. The observed holdout remains regression evidence; any new generalization claim requires genuinely unobserved sources. No version, release, competitive page or marketing copy changed.
