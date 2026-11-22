# Reconstructed-luma chroma DC trial, 2026-11-03

The single approved configuration regresses on all three screen BD-rates
against the aligned control. It is rejected after the screen. The branch is
not ready to merge; the earlier two holdout SSIM guard failures remain unresolved.

Research base: `904e753e5e90bc8e90981476b832267b66e62f39`, branch
`jxl-libjxl-ports`. Aaron approved one fixed trial after the
[chroma DC audit](DC-CHROMA-AUDIT.md). No active source or public default changes.

## Fixed change

Port the reconstructed-luma subtraction in libjxl v0.12.0
`lib/jxl/enc_modular.cc`, `AddVarDCTDC`. Process Y first, reconstruct it using
its emitted DC integer and step, then subtract it before rounding chroma DC.
Restore B from our B-Y representation. The adaptation uses Float64 arithmetic
and 512 bytes of reusable scratch. Aligned AC 1.25 allocation, nearest rounding,
smoothing off, selector and AC decisions stay fixed. No peer maps are consumed.

The named module has the source, revision, BSD copyright and adaptation header.
The pinned source and license match the source archive. Full license text
remains included in the npm package and docs site; provenance records this port.

## Development screen

All 80 outputs from the frozen 16-photo, five-distance screen decode with
native libjxl. Negative BD-rate means smaller files at matched quality.

| Comparison | SSIMULACRA2 | Butteraugli 3-norm | Butteraugli max |
| --- | ---: | ---: | ---: |
| Aligned control | +0.821528% | +0.043358% | +0.217084% |
| Frozen AC 1.25 | +0.777625% | -0.043384% | +0.096278% |
| Regularized control | +2.027260% | -1.756793% | +1.543426% |
| wasm-vips | -8.967032% | -6.813260% | -4.926125% |
| jSquash reference | -9.839914% | -2.558504% | +2.494340% |

The incremental three-metric mean against aligned control is +0.360657%.
That comparison has seven full-band SSIM admissions and zero 3-norm admissions.
The screen took 46.966 seconds; parallel encode times overlapped the repository
check and are excluded from speed conclusions. Managed peak is 9,235,969 bytes.
The extra scratch does not raise that observed peak. Original memory and isolated
speed are unmeasured for this rejected mode.

## Why the predicted gain did not carry through

The earlier scalar model predicted 9.85-15.61% lower blue DC squared error on
nine saved development points. That was not a perceptual or bitrate result.
The screen checks confirm the intended isolation: every luma and X DC integer
is unchanged, all eighty HF-global/AC sections match, and fourteen checked
decision fields plus the serialized DC matrices and smoothing policy match.
Blue changes in 25,068 cells, by at most one integer each.

Total bytes rise from 2,848,180 to 2,850,815, or 0.092515%. The entire 2,635-byte
increase is in the LF-global and DC sections; all remaining byte counts are
unchanged. Sixty-four of eighty files grow.

At the same distance, SSIM worsens in 58/80 outputs, improves in 14 and is
unchanged in eight; its mean change is -0.098048 points. Butteraugli 3-norm
improves in 51, worsens in 21 and is unchanged in eight, with mean relative
change -0.116346%. Max improves in 38, worsens in 32 and is unchanged in ten,
with mean relative change -0.010567%. These same-distance changes are not
BD-rates. The measured perceptual tradeoff and extra DC bytes explain why the
scalar prediction was insufficient. They do not establish the display-filter
mechanism behind the SSIM regression.

## Disposition and merge status

One configuration completed, zero retained or promoted. No full lab or new
holdout attempt follows the failed screen. The previous aligned-mode holdout
remains vips -5.779/-4.492/-4.189%, mean -4.820067%, and jSquash
-6.278/+0.044/+1.487%. Two of ten admitted SSIM guards fail, worst +10.579530%
against the +8.05% limit; zero 3-norm comparisons cover the required band.
These are historical aligned-mode results, not chroma-trial qualification.

The same prior mode passed isolated crop speed at 2.318200x jSquash and the
13 MP original at 1.472700x. Own 21 MP encoding completed, but jSquash aborted
and no ratio is available. Original managed memory was below the unchanged
137,514,476-byte ceiling. Full watch/scale, both independent decoders, public
integration, peer-forcing cleanup and final promotion checks remain pending.

## Verification and reproduction

Eighteen thin, odd and DC-group boundary fixtures encode repeatably and decode
natively. Two transparent fixtures preserve exact alpha. Three pinned AC 1.25
control hashes and three promotion-denial checks pass. Strict experimental
TypeScript and all eleven frozen prototype hashes pass. Fresh
`VITEST_MAX_WORKERS=4 npm run check` passes 340 test files and 4,229 tests,
with one file and three tests skipped, including static and browser build
checks. It ended at 2026-11-03T23:55:56.167Z. No active source, test, package or
lab TypeScript changes follow it. Bundles remain 614,969/687,801 bytes, with zero
runtime dependencies. Receipts are in [DC-CHROMA-REPORT.json](DC-CHROMA-REPORT.json).

[DC-CHROMA-EXPERIMENT.patch](DC-CHROMA-EXPERIMENT.patch) reconstructs nine files
at the research base, including the frozen allocation stack, port and fixture
checks. [DC-CHROMA-TRIAL-AUDIT.patch](DC-CHROMA-TRIAL-AUDIT.patch) reconstructs
three first-party stream and alpha checks. Both archives apply exactly.
The separate two-file proposal preserves the incremental change.

Raw results are in `.tmp/jpegxl-lossy-lab/dc-chroma-20261103/`. In a scratch
checkout at the recorded base, apply the experiment and use the standard lab
harness with `--variant standalone-dc-chroma`,
`--strategy-port standalone-dc-chroma`, the corpus-512-v2 manifest and unchanged
screen ladder. No promotion admission is included.

Remaining ideas, ranked for development investigation: predictor-aware DC
rounding with physical allocation fixed; fixed-tree histogram clustering costs;
and tracing blue DC through display filtering with perceptual weighting. None
has a measured gain here. The one-configuration allowance is complete; another
quality configuration needs owner renewal under LOSSY_STEERING section 9.
