# Source-port screen, 2026-10-13

Aaron subsequently reopened this investigation. See the
[coupled decision report](COUPLED-REPORT.md) for the new measurements and causal
DC/AC allocation audit. The stopped checkpoint below remains historical evidence.

Step 2 stops after three component directions produce no promotable gain:
transform selection, inverse Gaborish, and DC precision. Ten port variants and
one writer control complete 880 valid screen encodes. No source heuristic is
promoted. The production encoder remains at the Step 1 checkpoint `b2666b83`.
The candidate branch is `jxl-libjxl-ports`.

The [Step 1 transplant report](TRANSPLANT-REPORT.md) preceded these ports and was
reported to Aaron. His subsequent instruction authorized the checkpoint commit
and Step 2. Transform selection came first because it removed the largest
individual 3-norm gap. The filter direction then tested the missing input
preconditioning, followed by DC precision.

## Results

Each row uses the fixed 16-photo screen at distances 0.5, 1, 2, 4 and 7, effort 7,
and four workers. All rows have 80 native-decoded and scored outputs and zero
execution failures. Peer streams are the frozen wasm-vips 0.0.19 and jSquash
1.3.0 references. The control comparison uses identical input hashes and ladders.

Each metric triple is **SSIMULACRA2 / Butteraugli 3-norm / Butteraugli max** mean
BD-rate percent. Negative means fewer bytes at equal measured quality. Partial
quality-band overlap limits these aggregates; the JSON preserves per-image
intervals, coverage flags and peer coverage warnings. No screen result establishes
full-band parity.

| Experiment | Against own control (%) | Against vips (%) | Against jSquash (%) | Own median encode (ms) |
| --- | ---: | ---: | ---: | ---: |
| tiny | +5.02 / +5.11 / +9.80 | -0.61 / +10.61 / +15.30 | -2.91 / +13.98 / +22.85 | 1585.0 |
| spatial | +3.06 / +2.57 / +16.63 | -2.19 / +8.23 / +21.99 | -3.88 / +12.60 / +29.85 | 4757.6 |
| masked | +2.20 / +1.27 / +13.26 | -3.56 / +5.55 / +17.81 | -5.54 / +8.99 / +25.52 | 5030.4 |
| guarded | +3.04 / +1.79 / +13.33 | -2.80 / +6.26 / +18.53 | -4.90 / +9.61 / +26.13 | 4957.6 |
| own-rewrite | -0.23 / -0.17 / -0.15 | -5.50 / +5.11 / +4.13 | -7.67 / +8.49 / +11.71 | 1421.0 |
| actual | +2.48 / +1.35 / +12.60 | -3.31 / +5.67 / +17.03 | -5.32 / +9.09 / +24.72 | 5276.8 |
| actual-guarded | +2.78 / +1.40 / +9.56 | -3.05 / +5.91 / +14.30 | -5.16 / +9.18 / +21.86 | 5153.6 |
| gaborish | +7.56 / +0.51 / +0.43 | +1.52 / +6.09 / +5.36 | -1.06 / +8.92 / +12.00 | 1529.8 |
| gaborish-strategy | +6.22 / -0.53 / +7.53 | -0.06 / +3.93 / +11.86 | -2.30 / +7.15 / +19.14 | 6204.3 |
| dc | +30.61 / +1.58 / -3.34 | +22.57 / +8.52 / +0.84 | +23.37 / +13.91 / +8.58 | 1292.9 |
| dc-smooth | +31.15 / +1.54 / -3.25 | +21.76 / +8.10 / +0.89 | +21.83 / +13.12 / +8.23 | 1248.9 |

Encode times are diagnostics from the four-worker quality sweeps. They do not
qualify the 3x crop or 5x original speed targets. The largest observed managed
storage is 9,749,857 bytes. This is crop ledger evidence, not original-image RSS
qualification. No Step 2 full lab, holdout, isolated speed or original-image run
was warranted because every port failed the screen.

## What was tested

- `tiny` ports the simpler coefficient entropy/loss estimate and rectangular
  split costs. Its masking stays at one.
- `spatial` uses v0.12 spatial eighth-norm error and hierarchical transform
  choices. `masked` adds its pixel masking field. `guarded` requires the modeled
  local error to improve before replacing transforms.
- `actual` evaluates our rate-aware coefficient rounding and reconstructed
  values instead of the source model's nearest-integer estimate.
  `actual-guarded` also applies the local error guard.
- `own-rewrite` retains our decisions and checks the development coefficient
  writer. Its small improvement cannot explain the much larger regressions
  from source transform choices. It is a diagnostic control, not a source port.
- `gaborish` ports the optimized inverse filter with a bounded block halo.
  `gaborish-strategy` combines it with `actual`, calculating the source mask
  before preconditioning and transform costs after it.
- `dc` ports InitialQuantDC and its channel matrix, preserving our AC precision.
  `dc-smooth` additionally enables the existing normative DC smoothing path.

The joint filter/strategy row gains 0.53% on 3-norm but regresses SSIM by 6.22%
and maximum error by 7.53%. DC improves maximum error by 3.34% but regresses
SSIM by 30.61%. Neither is an acceptable retained gain. With no promoted port,
the combined retained gain is zero, below the owner's 1% stopping threshold.
There is no remaining-component transplant rerun because no port was promoted.

These are measured adaptations, not exact reproductions of libjxl. The selector
uses our quantization and CfL, maximum-footprint Q instead of the source's
sixteenth norm, and omits floating merge passes. The mask uses padded extents
and clamped borders. Its full-plane development scratch would need a bounded
replacement before production use. The results reject these adaptations; they
do not establish that the complete libjxl decision pipeline cannot help.

## Reproduction and provenance

Sources were read in the requested order, libjxl-tiny then libjxl v0.12.0. Every
ported module has its source, exact revision, BSD-3-Clause copyright and changes
in its header. [PROVENANCE.md](../PROVENANCE.md) records the material taken.
The complete license is in the npm package and docs-site third-party notices.
All ports live under the development lab and add no runtime dependency.

Example, using a new output directory for each variant:

```sh
node benchmark/jpegxl/lossy-lab/run.ts \
  --manifest .tmp/jpegxl-lossy-lab/corpus-512-v2/manifest.json \
  --out .tmp/jpegxl-lossy-lab/ports-20261013/dc-screen \
  --mode screen --variant port-dc --workers 4 --strategy-port dc
node benchmark/jpegxl/lossy-lab/summarize-port.ts \
  .tmp/jpegxl-lossy-lab/ports-20261013/dc-screen \
  .tmp/jpegxl-lossy-lab/transplant-20261013-v2/control/screen/transplant-control-purejsimage
```

Raw streams, receipts and logs remain under
`.tmp/jpegxl-lossy-lab/ports-20261013/`. The tracked
[PORT-REPORT.json](PORT-REPORT.json) preserves all comparisons. Experiments
LL-607 through LL-617 are recorded in [the lab log](../lossy-lab-log.md).
Final verification is recorded there separately.
