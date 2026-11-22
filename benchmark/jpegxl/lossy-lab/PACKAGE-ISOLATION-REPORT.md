# JPEG XL decision replay package isolation

The public JPEG XL writer and forward encoder exclude peer replay. The lossy
lab keeps the replay paths and the standalone selector available for development.
This closes a package boundary on `jxl-libjxl-ports`. The historical holdout SSIM
guard failures still block merging. This round uses development fixtures only.

## Public and lab source

The original replay landed in `b2666b83`, which is already on `main`. The public
writer returns to the pre-replay policy from `f9c74a49` and carries forward the
verified centroid reuse and cost-only ANS table work from `a97d219f`. The shared
Modular entropy writer and reconstruction code continue to serve both paths.
Only the lab invokes the generic Modular candidate writer on replay planes.

The lab patch reintroduces the peer hooks and standalone callbacks on two copies
generated under `.tmp/jpegxl-lab-codec`. After normalizing import paths, both
generated files match the replay-enabled `551b5d7f` source exactly. The shared
Modular bit writer and allocator each have one implementation. The generator
checks the public inputs, patch and generated file hashes and gives an error if
the patch needs refreshing. The lab runner, test configs and development
typecheck prepare these files. The public build compiles only the source tree.

The local npm pack lists 805 files, including the two public JPEG XL writer
modules and the third-party notices. Replay modules, decision declarations and
the patch are absent. The packed consumer check scans the actual installed
JPEG XL code and declarations for replay fields. The default browser build checks its module
graph for the lab writers. Version and dependencies stay at 0.17.0 and zero
runtime dependencies respectively. Minified bundle sizes go from 615,136 to
611,871 bytes for the codec and from 687,968 to 684,691 bytes for the specialized
entry.

## Verification

The 182 focused tests and nine Chromium, Firefox and WebKit fixture cases pass.
The browser fixtures cover replay, learned DCT16 orders and the shared cost-only
ANS writer. Strict TypeScript, packed consumer types and the default browser
build pass.

The pinned native libjxl and jxl-rs decoders each check eight mixed-order and
prefix fixtures. All eight complete streams match the immediate `551b5d7f`
comparison. Every independent RGB channel is within one code value of the
PureJsImage decoder, with exact opaque alpha. Four mixed-order streams already
differ from the earlier archived stream hashes on `551b5d7f`. The separate
historical verifier stops on that first stale encoded length. The paired
verification preserves the historical reference and checks both current writer
paths and the independent pixel grids. It does not refresh the archived result.

All 576 standalone development streams, byte counts and managed peaks match
the saved references. Maximum managed storage is 9,233,504 bytes. The public
codec comparison covers the fixed 16-crop screen at five distances, plus eight
progressive and tight-budget cases. All 84 successful encodes match the previous
bytes and managed peaks. The remaining four attempts produce the same memory
limit error. The largest public managed peak is 30,199,743 bytes.

| Public crop at distance 2 | Paired time ratio | MAD | Faster pairs | Before / after median ms |
| --- | ---: | ---: | ---: | ---: |
| im26-3012 | 1.007131 | 0.010720 | 5 of 21 | 1,251.4 / 1,253.1 |
| im26-3312 | 0.997090 | 0.008377 | 12 of 21 | 13,072.2 / 13,040.0 |

Pairs alternate order after three warmup pairs and compare the complete public
encode. All compared bytes and managed peaks match. Both ratios fall inside the
1.05 regression guard, with no demonstrated speed improvement. These timings
compare the public writer before and after isolation and do not measure
standalone promotion speed.

Three fresh processes per variant and state record absolute Linux VmHWM. Both
variants import both writer bundles, and warm runs use three encodes before the
measured encode. All four comparisons pass the unchanged 1.05 guard.

| Crop | Cold RSS ratio | Warm RSS ratio |
| --- | ---: | ---: |
| im26-3012 | 0.986723 | 1.013728 |
| im26-3312 | 0.981912 | 0.990444 |

The first full check finds a package contract that pins the exact
`package:types` command. The command is restored and the replay scan runs
inside the existing consumer check. The targeted contract passes. Full
`VITEST_MAX_WORKERS=4 npm run check` then exits zero after 562.857 seconds.
All 4,249 tests in 346 files pass, with three tests and one file skipped. The
installed-package replay scan passes in that run.

## Quality and remaining gates

This change has no new quality policy. Previous regularized development data
remains the comparison baseline:

| Reference | SSIMULACRA2 | Butteraugli 3-norm | Butteraugli max |
| --- | ---: | ---: | ---: |
| wasm-vips | −8.205% | −5.199% | −5.631% |
| jSquash | −8.726% | −0.012% | +2.408% |

Existing partial-band omissions remain. The holdout stays closed. A quality
repair still needs full development qualification, the peer and original speed
and memory checks, and the normal promotion path. The managed original ceiling
remains 137,514,476 bytes.

The earlier independent SSIM diagnostic lacked harmful actual-mode labels.
An inventory of saved scores compares the regularized mode and its original
control on all nine distances for the 48 development photos outside the SSIM
screen. Of 432 matched settings, 53 improve more than 0.1 SSIM points and 42
worsen more than 0.1. Two photos supply one harm each above 0.25 points. This
gives a fixed cohort for checking the unchanged SSIM predictor on real
encodes. Two larger harms offer limited evidence for a severe-harm guard.
The unchanged six-scale box loss identifies 94 of 95 material directions
correctly (98.95%) and flags both larger harms. Its one missed direction loses
0.119898 SSIM points. The result passes the earlier 80% direction criterion and
the larger-harm rule on this cohort. The 432 observations share photos and
distances. This supports the predictor as a development diagnostic on these
two policies. Candidate acceptance still needs measured rate and a separate
quality and cost experiment. There are no new encoder configurations, native
scores or holdout reads.

## Reproduction

Run `npm run jpegxl:lab:prepare` before invoking individual lab scripts. The
usual lab runner prepares the modules automatically. Run `npm run build` and
`node scripts/check-jpegxl-package-boundary.ts` to verify the emitted modules.
`npm run package:types` also runs that check after the packed consumer fixtures.
See the [correctness and cost receipts](PACKAGE-ISOLATION-REPORT.json) and the
[comparison runner archive](PACKAGE-ISOLATION-EXPERIMENT.patch). The archived
runners use the frozen development manifest and saved references from the
preceding selector checkpoint. Run `parity-run.ts` for both encoder paths,
`public-build.ts compat` and `independent.ts` for the pinned decoder fixtures,
and `cost-run.ts` for isolated timing and memory.
Run `quality-cohort.ts` to reproduce the saved native-score inventory.
Run `quality-run.ts` for the fixed predictor diagnostic on those saved images.
