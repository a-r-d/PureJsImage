# Coefficient error through display filtering

Filtering preserves the error reduction from more accurate rounding, but the
extra bits erase its native rate-quality benefit. Removing coefficients saves
bits and increases display error. The full development lab rejects the first
rate-saving candidate despite its promising screen.

Research base `d18b41b4`, 2026-10-28, on `jxl-libjxl-ports`. The holdout stays
closed. All experiments use our own decisions and first-party TypeScript.

## Reconstruction trace

The offline helper decodes each saved stream three times: without filters,
with Gaborish only, and with the signaled Gaborish and EPF. It then records
linear RGB, floating-point sRGB, and clipped, rounded 8-bit display RGB.
Original and preconditioned XYB come from our retained encoder's source context.
The original B plane includes luma, matching the decoder's native XYB layout.
Stage errors include DC, AC and chroma-from-luma reconstruction. Differences
between variants measure complete-stream interventions, not an isolated linear
transfer function for each coefficient.

The first trace covers control, guarded, weak and high rounding from the prior
selected-transform investigation. The second covers control and quarter-, half-
and full-strength filtered rate costs. Each trace contains the fixed 16 screen
photos at distances 2 and 4: 128 decoded streams per trace, 256 total. Source
hashes are checked. Re-encoding the control reproduces its saved stream hash.
Every final display pixel differs from the cached native decoder by at most
one 8-bit code value; none differs by more than one.

Squared error is diagnostic. These totals are not perceptual scores or BD-rate.
The table shows changes in pooled squared error, with each stage compared to
its corresponding control and source reference. Raw Y uses the preconditioned
source; filtered Y uses original source XYB; display RGB uses original sRGB.

| Trial | Distance | Bytes | Raw Y error | After Gaborish | After EPF | Display RGB error |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Guarded rounding | 2 | +2.951% | -5.637% | -4.946% | -5.437% | -3.747% |
| Guarded rounding | 4 | +1.876% | -2.290% | -2.002% | -2.639% | -1.994% |
| Quarter rate cost | 2 | -0.194% | +0.857% | +0.602% | +0.636% | +0.428% |
| Quarter rate cost | 4 | -0.080% | +0.179% | +0.113% | +0.125% | +0.098% |
| Half rate cost | 2 | -3.521% | +13.265% | +10.624% | +11.170% | +7.514% |
| Half rate cost | 4 | -1.364% | +3.329% | +2.645% | +2.940% | +2.248% |
| Full rate cost | 2 | -11.997% | +42.308% | +39.326% | +41.165% | +28.114% |
| Full rate cost | 4 | -7.194% | +13.726% | +14.656% | +15.990% | +12.405% |

Guarded rounding improves raw Y, post-EPF Y and display RGB error on 29 of 32
points; three are unchanged. Native SSIM improves on 28 and Butteraugli 3-norm
on 29. However, its prior screen BD-rates regress by +0.585/+0.568/+0.711%.
The improvement costs too many bits. Weak and high rounding improve display
RGB error on 18 points each but native SSIM on only seven and four. Lower
squared error alone does not protect perceptually important detail.

Filtering the ideal preconditioned source leaves pooled Y bias of 0.517 at
both distances, compared with control post-Gaborish Y errors of 351.010 and
765.145. This measurement gives little reason to retune the inverse filter.
The EPF correction is recorded as its own energy and its cross term with the
incoming error: `E_after = E_before + correction_energy + 2 * cross`.
Display rounding does not reverse the guarded variant's aggregate benefit.

## Rate-aware rounding trials

Only regular DCT strategies receive frequency-dependent rounding. Special
transforms, selected strategies, quantization steps and frame filters are held
fixed. The rate-saving trials can lower an existing nonzero magnitude by one.
They compare the change in normative decoded-centroid error, weighted by the
squared interior Gaborish frequency response, with our existing logarithmic
rate proxy. The scalar rate weight is inferred from the active quantizer's
zero-to-one threshold. Quarter, half and full refer to multipliers of that
weight, not to measured bit rates. The model omits cross-block filtering,
nonlinear EPF, color sensitivity, perceptual masking and exact entropy cost.

After three stronger rate-cost failures, the next trials instead promote
high-frequency luma coefficients only when centroid error falls. Existing
nonzeros are preserved; two requires magnitude at least two; class preserves
magnitude bit length. Bit length is only a proxy, not an exact entropy class.

All rows have 80 valid native-scored screen outputs. Metric order is
SSIMULACRA2 / Butteraugli 3-norm / Butteraugli max BD-rate (%); negative is better.
Concurrent quality timings are excluded from speed claims.

| Mode | Against retained control | Against wasm-vips | Against jSquash |
| --- | --- | --- | --- |
| Control | 0.000 / 0.000 / 0.000 | -10.654 / -5.866 / -5.164 | -11.546 / -0.300 / 2.115 |
| Quarter | -0.053 / -0.020 / -0.209 | -10.701 / -5.888 / -5.412 | -11.591 / -0.324 / 1.849 |
| Half | -0.128 / 0.170 / 2.248 | -10.771 / -5.772 / -3.227 | -11.635 / -0.204 / 4.109 |
| Full | 0.916 / 2.875 / 7.231 | -9.766 / -3.637 / 0.965 | -10.556 / 2.318 / 8.968 |
| Half, all channels | -0.128 / 0.170 / 2.247 | -10.771 / -5.772 / -3.228 | -11.634 / -0.205 / 4.108 |
| Promote existing | 0.038 / 0.062 / 0.012 | -10.617 / -5.808 / -5.198 | -11.507 / -0.237 / 2.102 |
| Promote two | 0.019 / 0.013 / 0.004 | -10.636 / -5.855 / -5.156 | -11.529 / -0.287 / 2.130 |
| Promote class | 0.015 / 0.012 / 0.003 | -10.640 / -5.855 / -5.157 | -11.532 / -0.287 / 2.128 |

The initial model incorrectly assumes Gaborish is active at fine distances
where our frame disables it. A separate corrected mode uses identity response
there and the same frequency response elsewhere. Its screen measures
-0.053/-0.023/-0.243% against control. The original results above are preserved.

## Full ladder and timing

The uncorrected quarter mode has 576 valid native outputs. It measures
-0.019/-0.019/+0.112% against retained control, -8.022/-5.051/-5.472% against
vips, and -8.492/+0.204/+2.668% against jSquash. The worst development per-image
Butteraugli max regression is +3.309%, exceeding the 3% guard. Reject it.
Its managed peak is 9,238,489 bytes versus retained 9,232,573 bytes.

The isolated timing screen used 15 alternating pairs, one untimed warmup pair,
and im26-3012 at distance 2. Control/candidate medians are 883.916/871.288 ms;
paired change -0.030%, MAD 4.755 percentage points, eight of 15 pairs faster.
Control/candidate CV is 7.892/6.652%. This is neutral within noise. Streams are
stable within each mode, at 32,830/32,768 bytes, and both managed peaks are
5,682,267 bytes. A quality-rejected mode does not advance to Git timing or
original-size qualification. No new selector speed improvement is claimed.

The corrected quarter mode also has 576 valid native outputs. It measures
-0.022/-0.021/+0.089% against control, -8.024/-5.051/-5.485% against vips,
and -8.494/0.206/2.671% against jSquash. The worst max regression remains
+3.308%, on im26-2004. Its managed peak is 9,232,573 bytes. Reject it.
The fine-distance screen streams match control exactly on all 16 photos; the
other 64 screen streams match the uncorrected trial. Fixing filter state does
not fix the local perceptual tail.

The worst development photo, im26-2004, is most damaged at distance 1.85:
344 bytes saved, native Butteraugli max +7.565%, 3-norm +0.579%, and SSIM
-0.206 points. These are fixed-distance changes, not BD-rate. Distance 0.45
is exact and max changes at distance 3 and above are negligible. The damaging
point has Gaborish enabled, so the fine-distance correction cannot address it.
This narrows the next local contrast/edge diagnostic without consulting holdout.

All eight new rounding modes are removed from active code and preserved in
`DISPLAY-EXPERIMENT.patch`, applied against `d18b41b4` plus the retained trace
helper. All active encoder files match that base exactly. The three offline
trace tools and their focused tests remain. No new heuristic is promoted.

Retained full-development SSIM/3-norm/max remains -8.003/-5.030/-5.582% against
vips and -8.474/+0.227/+2.571% against jSquash. Historical qualification remains
2.635783x jSquash for crops, 41.894s and 1.698729x for 13 MP; the prior 21 MP
encode finishes while jSquash aborts. These are carried-forward qualification
figures, not fresh measurements. The prior selector-pruning result is unchanged.
Bundles remain 614,941/687,773 bytes, with zero runtime dependencies. The two
frozen holdout SSIM guards remain unresolved; no holdout rerun or main merge.

The full-lab comparisons use overlapping measured ranges. Only 46 of 64
SSIM comparisons cover the entire required 60-90 band; the complete required
Butteraugli max range is not covered. Do not interpret them as full-band
qualification. All raw curves and coverage flags are retained.

## Evidence and reproduction

Raw root: `.tmp/jpegxl-lossy-lab/display-trace-20261028/`.
The stage summaries are `trace-summary.json` and `demotion-summary.json`;
per-stream files contain hashes, native scores and per-channel stage errors.
The screen directories, two full-lab directories, speed JSON and logs preserve
complete outputs and measurements. Lab entries LL-974 onward record decisions.

```sh
node benchmark/jpegxl/lossy-lab/trace-rounding-display.ts \
  .tmp/jpegxl-lossy-lab/display-trace-20261028/new-trace
node benchmark/jpegxl/lossy-lab/trace-rounding-display.ts \
  .tmp/jpegxl-lossy-lab/display-trace-20261028/new-demotion 0 demotion
# Repeat shards 1, 2 and 3 for the demotion family.
node benchmark/jpegxl/lossy-lab/summarize-display-trace.ts \
  .tmp/jpegxl-lossy-lab/display-trace-20261028/trace \
  .tmp/jpegxl-lossy-lab/display-trace-20261028/trace-summary.json
node benchmark/jpegxl/lossy-lab/run.ts \
  --manifest .tmp/jpegxl-lossy-lab/corpus-512-v2/manifest.json \
  --out .tmp/jpegxl-lossy-lab/display-trace-20261028/new-screen \
  --mode screen --variant standalone-rd25 --strategy-port standalone-rd25 --workers 4
```

The trace reads the saved screens from this investigation and
`selected-20261028`; it does not require reactivating those prior rounding
variants. Encoder replay of the new trials requires the experiment archive.
The final four-photo smoke replay reproduces all eight JSON files, containing
32 stream traces, exactly. The cleaned summarizer reproduces its saved output.

Validation: `VITEST_MAX_WORKERS=4 npm run check` passes, exit 0, with
4,184 tests passed and three existing skips; 331 test files pass and one is
skipped. Test phase 517.58s; complete command 560.42s. Chromium, Firefox and
WebKit decision fixtures pass. Archive application, final trace replay,
summary equality and diff whitespace checks pass. The initial check stopped
on a summarizer lint error, which was fixed before the successful rerun. Logs
and both check status records remain under the raw root. No public source
changes, holdout rerun, promotion or merge.

Next hypotheses, in order:

1. Compare local contrast and edge errors after display filtering on the
   development images with the worst measured max regressions.
2. Measure actual entropy cost of coefficient changes, including nonzero
   context changes, before replacing the token-rate proxy.
3. Test a joint local rate-distortion decision only if the first two diagnostics
   explain enough native quality variation to justify its selector cost.
