# Reusing final-rate state, 2026-11-17

The branch is not ready to merge. Reusing unchanged DC metadata makes a batch
of final-model rate estimates about 35–37% faster, but the prototype raises
process memory in several cases and still costs too much for the small gains
from previous guarded proposals. Keep it archived. No new encoder policy or
production source change is retained. All prior research work is preserved on
`jxl-libjxl-ports`, starting at `aca2c2fc` plus the recorded dirty snapshot.

The previous singleton dispatch and local display-state reuse had already been
tested. This round instead profiles the final-rate estimator on selected
development geometry. It finds repeated AC token walks, coefficient-order
sorting and DC serialization. The estimator rebuilds orders, contexts,
histograms and hybrid configurations. It does not freeze the control model.

## Three trials

Ratios below are candidate/control. Rate batches contain the control and eight
deterministic AC perturbations. Geometry capture and proposal construction are
outside both rate timings; cache construction, comparisons, invalidation and
cleanup are inside. Rate timing is not complete encoder timing.

| Trial | Scope | Photo ratio | Texture ratio | Result |
| --- | --- | ---: | ---: | --- |
| Exact AC token cache | One complete estimate, 11 pairs | 0.977004 | 1.056632 | No reliable gain; reject |
| Checked DC metadata reuse | Nine estimates, 7 pairs | 0.654962 | 0.634403 | Faster, memory and integration remain open |
| Stable coefficient sorting | Complete encode, 21 pairs | 0.985322 | 1.020842 | No reliable gain; reject |

The checked DC batch improves from 1494.318 to 987.227ms on im26-3012 and from
1125.833 to 717.374ms on im26-3312. Every pair is faster. Paired MAD is
0.016577 and 0.036644 respectively. The unchecked first version, seven-pair
sorting screen and all raw pairs are preserved separately in the JSON.

The initial DC prototype assumes immutable inputs and retains only a scalar.
The checked version compares every generated DC plane value and retains its
original values as well as the bit count. It invalidates on an in-place DC
change and rejects incompatible geometry. All other metadata and AC models
are rebuilt. Sixteen fixed development photos at distance 2 pass all 80
cached-estimate checks, including mutation and restoration. The two timing
photos also preserve all eighteen control/proposal estimates exactly.
Retained DC buffers occupy 98,816 bytes on each screen photo.

These are exact matches to the existing rebuilt-model estimator, which uses
normalized ANS entropy. They are not exact final stream sizes. The earlier
[rate audit](PREDICTOR-REPORT.md) still governs rounding and serialization
error; tiny predicted savings do not establish actual savings.

## Memory and adoption decision

Three fresh processes per variant and cold/warm state import both variants
equally. Absolute Linux VmHWM includes imports, fixture ownership, proposal
copies and warmups. External and ArrayBuffer snapshots are retained. No warm
baseline is subtracted and inherited rusage is not used.

| Crop | State | Control peak bytes | Prototype peak bytes | Ratio |
| --- | --- | ---: | ---: | ---: |
| im26-3012 | cold | 199,700,480 | 210,624,512 | 1.054702 |
| im26-3012 | warm | 208,793,600 | 209,309,696 | 1.002472 |
| im26-3312 | cold | 203,816,960 | 209,821,696 | 1.029461 |
| im26-3312 | warm | 204,464,128 | 214,601,728 | 1.049581 |

The process peak increase is much larger than the retained DC buffers. These
measurements do not identify its allocation or collection cause. The private
fixture uses owned coefficient copies outside the encoder memory ledger, so
this does not qualify integrated managed memory or full-resolution originals.
No memory gate is relaxed and no cache enters the active encoder.

The batch still takes 0.72–0.99 seconds before perceptual selection. Prior
protected proposals bought too little quality or size improvement to fund
that work. The result supports eliminating repeated DC serialization; it
does not justify adding a nine-proposal RD selector.

## Unchanged quality and remaining gates

The existing native-scored regularized-half full-development table remains:

| Reference | SSIMULACRA2 | Butteraugli 3-norm | Butteraugli max |
| --- | ---: | ---: | ---: |
| wasm-vips | -8.205% | -5.199% | -5.631% |
| jSquash | -8.726% | -0.012% | +2.408% |

These are prior results, with the same partial-band omissions. This round
does not encode a new quality configuration or access the holdout. The
historical two SSIM guard failures remain unresolved; the last separate
predictor-DC attempt reached +11.202599% against its +8.05% guard. That
number belongs to the earlier attempt, not a fresh regularized-mode result.

The previous exact selector changes remain retained: 0.959927/0.977781x
complete-encode ratios on two crops and byte/managed parity on 576 points.
No new absolute jSquash crop/original speed qualification is claimed.
Public peer-decision hooks still need separation before merging. Main,
quality thresholds, memory ceilings, package version and releases are unchanged.

Fresh `VITEST_MAX_WORKERS=4 npm run check` exits zero with no signal: 4,245 tests
and 345 files pass, with three tests and one file skipped. All build, type,
browser-build, lint, format, comparison and documentation gates pass. The check
takes 585.577 seconds; Vitest takes 542.08 seconds. Private strict TypeScript,
sixteen-photo rate validation, cache invalidation/cleanup checks and all fifteen
archive restorations also pass. No timing, profiling or scoring overlaps checking.
Public bundles remain 614,969/687,801 minified bytes, with zero runtime dependencies.

Three earlier check attempts ended without a complete result, including two
foreground exits with code 143. They are not passes. The detached host run
finishes on 2026-11-18 UTC and records its explicit exit code and signal.
The verified checkpoint includes the earlier retained research helpers,
observation callbacks and selector reductions. It does not promote a quality mode.

Next steps are to integrate bounded ownership for final-rate state, reuse
unchanged AC statistics while rebuilding the final model, and test a useful
coupled proposal with displayed-error protection. Native quality and the
complete encoder cost must pass before promotion can reopen the holdout.

## Reproduction

[Structured evidence](RATE-STATE-REPORT.json) includes raw paired samples and
memory receipts. [The archive](RATE-STATE-EXPERIMENT.patch) restores fifteen
private files under `.tmp/jpegxl-lossy-lab/rate-state-20261117`. It contains
first-party mirror generators, not an active package implementation. The
source writer must match the recorded baseline, and the preceding retained
research helpers and frozen development corpus must be present.

Use fresh output paths. Generation reads the first-party source files in the
working tree. Run timings, memory, native scoring and repository checks serially.

```sh
git apply benchmark/jpegxl/lossy-lab/RATE-STATE-EXPERIMENT.patch
node .tmp/jpegxl-lossy-lab/rate-state-20261117/make-dc-prototype.ts
node .tmp/jpegxl-lossy-lab/rate-state-20261117/dc-paired.ts checked-new 7
node .tmp/jpegxl-lossy-lab/rate-state-20261117/dc-validate.ts
node .tmp/jpegxl-lossy-lab/rate-state-20261117/dc-memory-run.ts
```

The other generators and paired runners reproduce the rejected token-cache
and stable-sort trials. The unchecked DC source delta is retained only to
reproduce the initial immutable-fixture result. Raw profiles and the original
workspace snapshot remain in the private receipt directory.
