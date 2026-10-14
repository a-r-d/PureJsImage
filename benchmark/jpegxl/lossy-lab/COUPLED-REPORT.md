# Coupled quantization and transform investigation

Aaron reopened Step 2 after the first port screen to investigate regressions and
test libjxl's quantization and transform decisions together. The previous stop
and its results remain in [PORT-REPORT.md](PORT-REPORT.md). This investigation
starts from `aa727a4c` on `jxl-libjxl-ports`.

## Confirmed cause: mismatched precision allocation

The initial component tests mixed decisions that spend bytes very differently.
A first-party decoder audit of 80 own, native and DC-port streams establishes:

- At distance 1, libjxl's median luma DC step is 24.14 times our step. At distance
  2 it is 2.70 times our step. The port's physical DC steps are within about 2%
  of native steps across the five tested distances. The earlier DC regression
  was not a large unit-conversion error.
- Native median AC precision is 0.27-0.62 of ours across these distances. Using
  that coarse AC field with our fine DC leaves a much larger share of bytes in
  the DC groups.
- Matching DC in the coherent AC/transform/matrix/CfL/filter replay leaves every
  AC payload byte-identical in all 80 screen pairs. Total size falls 7.46%,
  11.77%, 9.15%, 13.32% and 17.33% at distances 0.5, 1, 2, 4 and 7. Nearly all
  saved bytes are in DC groups. Decoded quality may change with DC precision;
  equal AC payloads are not a claim of equal output pixels.

A direct equal-quality comparison between those two coupled rows, using their
shared overlap rather than subtracting peer aggregates, gives +0.310% SSIM,
-10.529% 3-norm and -11.544% max. Every one of the 16 photos improves at least
5.30% on both Butteraugli measures in that paired comparison. Band coverage is
still partial for most comparisons.

On the screen, adding native DC to this combination reduces the vips 3-norm gap
from 16.07% to 3.40% and the max gap from 18.57% to 3.14%. DC alone previously
regressed SSIM by 30.61%. Both results can hold: the useful DC precision depends
on the AC distortion and the rest of the coding choices. Chroma matrix scales
and CfL alone changed these aggregate results much less.

The complete 64-photo replay confirms the interaction. Its means against vips
are +3.323% SSIM, +1.581% 3-norm and +0.475% max. Against our unchanged control,
it gains 4.505% on 3-norm and 4.113% on max but loses 5.412% on SSIM. This is a
useful diagnostic result and fails the production SSIM gate.

## Source audit and scope

The source transform cost uses the initial floating-point quantization field.
For transforms covering more than two 8x8 blocks it uses a sixteenth norm during
selection. After selection, AdjustQuantField blends maximum and mean precision
with distance; from approximately distance 3.315 it uses the mean. The first
port used the maximum for both stages. The new licensed module reproduces those
two rules in development experiments. It rounds adjusted raw quantizers to the
existing integer wire precision.

The new mode also scores with unscaled normative matrices, matching native
EstimateEntropy. The earlier adaptation scored with final chroma scales.
The writer continues applying the signaled scales in both modes.

With native final AC quantization, DC, CfL and filter settings, this adapted
selector reaches +4.005% SSIM, +3.268% 3-norm and +2.161% max against vips on
the screen. Compared directly with the native-map replay, its deltas are
+0.080%, -0.203% and -0.604%. This comparison also changes the inverse-Gaborish
kernel and aggregate quantization within new transforms; it does not isolate
transform choice alone. It shows that the combined port prototype can get
close to native-map replay when the surrounding decisions are coherent.

The additional reconstructed-luma CfL trial ports another native pipeline step:
quantize and reconstruct Y, then form chroma residuals from that reconstructed Y.
It explicitly bridges our B-minus-original-Y input plane. With fixed native
maps, the direct deltas are +0.054%, +0.050% and +0.093%, so it does not explain
the large original regression. It remains an unpromoted development experiment.

The source selector is still adapted: it uses our transform implementation and
aligned hierarchy, omits native floating merge passes, and the coupled tests
supply final signaled quantizers rather than the unsignaled initial field.
The initial adaptive field and perceptual refinement loop have not been ported.
These limitations prevent calling the experiment a complete libjxl encoder.
The evidence supports implementing initial adaptive quantization and DC
allocation alongside the selector in a future standalone candidate. All current
coupled modes consume peer decisions and cannot be promoted as an independent
encoder. The scalar selector prototype also remains substantially slower than
our control. The present investigation does not invoke the earlier three-miss
stop rule; it records the requested coupled comparison and its remaining work.

All experiments use the frozen development corpus and effort 7. Screens contain
16 photos and five distances; the full lab contains 64 photos and nine distances.
Native decoding, SSIMULACRA2 and both Butteraugli metrics score every point.
Each table triple is SSIM / 3-norm / max mean BD-rate percent; negative is better.
The own-control comparisons use identical input hashes and ladders. Quality-band
overlap remains partial and is preserved per image in the JSON.

Timing comes from four-worker quality sweeps. It is diagnostic, excludes peer
map extraction, and does not qualify production crop or original speed. The
holdout remains closed. No production heuristic or runtime dependency changes.

## Reproduction

Use a fresh output directory for every run. For example:

```sh
node benchmark/jpegxl/lossy-lab/run.ts \
  --manifest .tmp/jpegxl-lossy-lab/corpus-512-v2/manifest.json \
  --out .tmp/jpegxl-lossy-lab/coupled-20261013/strategy-quant-dc-lab \
  --mode lab --variant coupled-strategy-quant-dc --workers 4 \
  --transplant strategy-quant-dc
node benchmark/jpegxl/lossy-lab/summarize-port.ts \
  .tmp/jpegxl-lossy-lab/coupled-20261013/strategy-quant-dc-lab \
  .tmp/jpegxl-lossy-lab/transplant-20261013-v2/control/lab/transplant-control-purejsimage
node benchmark/jpegxl/lossy-lab/audit-port-quantization.ts
node benchmark/jpegxl/lossy-lab/audit-coupled-sections.ts
```

Raw streams, receipts and audits are retained under
`.tmp/jpegxl-lossy-lab/coupled-20261013`. [PROVENANCE.md](../PROVENANCE.md) records
source files, exact revisions and adaptations. The full BSD license remains in
the npm package and docs site. The lab log records results and final validation.

## Complete measured table

Eleven screens and one full lab total **1,456 valid own encodes**, with zero
execution failures. Each triple is SSIM / 3-norm / max BD-rate percent. The
full-lab row has 576 points; each other row has 80. Exact per-image values,
quality-band coverage and direct paired comparisons are preserved in
[COUPLED-REPORT.json](COUPLED-REPORT.json).

| Experiment | Against own control (%) | Against vips (%) | Against jSquash (%) | Own median encode (ms) |
| --- | ---: | ---: | ---: | ---: |
| strategy-quant-screen | +5.43 / +12.97 / +19.49 | +0.12 / +17.29 / +23.32 | -1.46 / +26.01 / +32.41 | 835.6 |
| strategy-quant-matrices-screen | +5.24 / +13.38 / +19.73 | -0.06 / +17.52 / +23.54 | -1.62 / +26.25 / +32.65 | 877.5 |
| strategy-quant-cfl-screen | +6.14 / +13.65 / +19.55 | +0.74 / +17.71 / +23.31 | -0.81 / +26.43 / +32.47 | 836.8 |
| strategy-quant-filters-screen | +9.84 / +8.84 / +14.49 | +4.24 / +16.07 / +18.57 | +2.56 / +24.28 / +27.57 | 1028.9 |
| strategy-quant-dc-screen | +10.03 / -1.76 / +0.44 | +3.98 / +3.40 / +3.14 | +4.44 / +11.52 / +11.13 | 1047.4 |
| strategy-quant-dc-lab | +5.41 / -4.50 / -4.11 | +3.32 / +1.58 / +0.48 | +3.12 / +8.57 / +9.42 | 1146.1 |
| quant-port-screen | +5.44 / +13.33 / +23.74 | -0.46 / +16.05 / +26.52 | -2.18 / +23.44 / +36.08 | 4004.4 |
| quant-port-filters-screen | +9.45 / +8.81 / +13.27 | +3.22 / +14.25 / +17.14 | +1.24 / +20.73 / +25.94 | 4939.6 |
| quant-port-source-screen | +9.03 / +8.56 / +13.64 | +2.91 / +14.14 / +17.56 | +0.95 / +20.72 / +26.37 | 4751.0 |
| quant-port-complete-screen | +10.73 / -1.32 / -0.50 | +4.01 / +3.27 / +2.16 | +4.17 / +11.19 / +10.01 | 4814.3 |
| strategy-quant-roundtrip-screen | +10.08 / -1.68 / +0.53 | +4.03 / +3.45 / +3.25 | +4.49 / +11.58 / +11.23 | 1021.0 |
| own-roundtrip-screen | +0.01 / -0.06 / -0.10 | -5.28 / +5.22 / +4.21 | -7.45 / +8.60 / +11.78 | 1221.7 |

The roundtrip-only test with our own decisions also regresses relative to its
own-rewrite control: +0.241% SSIM, +0.108% 3-norm and +0.059% max. It is rejected
in both contexts. The small difference between own-rewrite and the public
control is retained in the earlier report and is not attributed to this port.

The maximum measured managed crop storage across these rows is 9,821,585 bytes.
No original-image RSS or formal isolated speed qualification is claimed. Source
ports remain development-only. No `src/` file, runtime dependency, production
heuristic, quality threshold, memory ceiling or bundle ceiling is changed by
this investigation. Final repository verification is recorded in LL-631.
