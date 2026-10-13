# Decision transplant report (2026-10-13)

Step 1 complete; pre-port checkpoint.
Transform, quantization, DC, CfL, filters and patch-reference replay are implemented.
No libjxl decision logic is ported. Holdout remains closed.

Fresh vips preparation: 896 streams from all 64 development photos.
The standard lab ladder has nine distances; the screen has five. All 576 lab streams
equal the cached peer streams, so existing peer scores are reused. Holdout is closed.

The repaired control matches all 576 retained production development files byte
for byte. The forcing option is internal and rejected by the public codec.

Each rate is mean per-image BD-rate, ordered SSIMULACRA2 / Butteraugli 3-norm / max.
Times are isolated distance-2 encode medians on 64 crops including the container.
Fresh peer timings use effort 7, jSquash quality 80 and vips distance 2. Required-band coverage
and every warning are retained in TRANSPLANT-REPORT.json. Partial bands remain a limitation.

## Screen (16 photos)

| Forced component | vs vips | vs jSquash reference | vs control | Isolated encode ms | Scored points | Result |
| --- | --- | --- | --- | ---: | ---: | --- |
| control | -5.281% / +5.305% / +4.307% | -7.457% / +8.677% / +11.889% | +0.000% / +0.000% / +0.000% | 1304.7 | 80/80 | measured |
| quant | +10.537% / +27.972% / +24.234% | +8.812% / +41.324% / +33.598% | +15.947% / +19.862% / +19.883% | 629.1 | 80/80 | measured |
| dc | +22.861% / +9.049% / +1.511% | +23.576% / +14.514% / +9.213% | +31.137% / +1.890% / -3.044% | 1277.0 | 80/80 | measured |
| cfl | -4.409% / +5.753% / +5.087% | -6.585% / +9.087% / +12.748% | +0.912% / +0.376% / +0.827% | 1279.7 | 80/80 | measured |
| filters | +6.433% / +11.222% / +10.093% | +3.760% / +13.876% / +17.464% | +12.822% / +4.932% / +4.641% | 1613.6 | 80/80 | measured |
| available | +11.834% / +14.861% / +5.274% | +12.345% / +26.417% / +13.299% | +17.661% / +6.033% / +1.336% | 914.3 | 80/80 | measured |
| strategy | -3.193% / +8.134% / +22.957% | -5.300% / +12.481% / +31.452% | +2.433% / +2.819% / +18.085% | 1570.1 | 80/80 | measured |
| features | -4.878% / +5.615% / +4.285% | -7.063% / +8.983% / +11.853% | +0.450% / +0.305% / -0.022% | 1306.2 | 80/80 | measured |
| all | +3.587% / +2.857% / +2.664% | +3.811% / +10.822% / +10.611% | +10.037% / -1.863% / +0.158% | 1026.8 | 80/80 | measured |

## Full lab (64 photos)

| Forced component | vs vips | vs jSquash reference | vs control | Isolated encode ms | Scored points | Result |
| --- | --- | --- | --- | ---: | ---: | --- |
| control | -0.647% / +8.257% / +6.229% | -2.998% / +11.595% / +14.495% | +0.000% / +0.000% / +0.000% | 1304.7 | 576/576 | measured |
| quant | +9.130% / +24.749% / +20.964% | +7.450% / +37.994% / +30.858% | +8.281% / +12.576% / +14.349% | 629.1 | 576/576 | measured |
| dc | +25.345% / +10.358% / +1.950% | +25.896% / +16.231% / +10.772% | +23.942% / +1.038% / -4.547% | 1277.0 | 576/576 | measured |
| cfl | -0.303% / +8.454% / +6.122% | -2.631% / +11.742% / +14.394% | +0.321% / +0.124% / -0.064% | 1279.7 | 576/576 | measured |
| filters | +9.671% / +14.379% / +12.826% | +6.984% / +16.903% / +20.487% | +10.906% / +5.049% / +5.399% | 1613.6 | 576/576 | measured |
| available | +13.296% / +14.246% / +5.384% | +13.474% / +25.193% / +14.324% | +13.586% / +3.903% / +0.163% | 914.3 | 576/576 | measured |
| strategy | -2.337% / +6.274% / +17.143% | -4.734% / +9.728% / +26.054% | -0.767% / -0.823% / +11.356% | 1570.1 | 576/576 | measured |
| features | -0.353% / +8.553% / +6.750% | -2.711% / +11.880% / +15.016% | +0.310% / +0.268% / +0.453% | 1306.2 | 576/576 | measured |
| all | +3.387% / +1.636% / -0.200% | +3.150% / +8.622% / +8.718% | +5.490% / -4.557% / -4.665% | 1026.8 | 576/576 | measured |

## Interpretation

The available row combines quant/DC/CfL/filters. It is not the all-maps row.
DC-only transfers physical DC precision while preserving our AC global scale.
Forced quant fields constrain merges to cells with identical quantizers. The
initial v2 quant row failed this condition and is excluded; quant-corrected
contains the repaired row. Successful corrected/combined points verify their
emitted maps before scoring.
Quant forcing also disables our DCT32/rectangle selection stage; DCT16 is
allowed only across equal field values. Its timing gains include avoided
selection work. Quant and available rows therefore also restrict transform
selection and cannot establish a pure quantization-heuristic contribution.
Corrected filter rows mathematically invert our decoder's signaled 3x3 Gaborish
kernel before encoding. The earlier header-only rows remain preserved and excluded.
All 18 peer transform IDs are replayed, including AFV, DCT64 and rectangular
transforms with odd-coordinate leaders. The all row also aligns channel matrix
scales, DC smoothing and exact raw DC quantizer fields. Reference integer samples are decoded and re-encoded
using our Modular entropy writer, and additive patches are subtracted in XYB.
No peer entropy payload is copied. 186 streams have patches; noise and splines
are absent. Default quant matrices are used; peer X scales range from 3 to 5.
The all-maps residual includes unsignaled pixel preconditioning. libjxl uses
a perceptually optimized approximate 5x5 Gaborish inverse, while this transplant
uses a mathematical inverse of the decoder filter. Entropy coding and quantizer
rounding therefore do not explain the residual alone.

The first raw-codestream attempt omitted the public 40-byte container. It is
preserved under transplant-20261013 and excluded. This report uses repaired v2
container output. Every measured point is decoded and scored with native libjxl.

## Near-flat textures

Each comparison is original / our distance-3 control / the nearest-byte vips
point on the frozen ladder. Sizes are approximate, with the actual difference
listed below. These are visual observations, not a transform-only causal test.

| Texture | Own bytes | Vips distance / bytes | Byte difference | Peer strategies | Observation |
| --- | ---: | --- | ---: | --- | --- |
| im26-3304 | 6003 | 1.3 / 5913 | -1.50% | 5, 18, 19 | Vips has smoother dark flat regions; our output has faint block patches. |

![im26-3304: original, own control, vips](../../../.tmp/jpegxl-lossy-lab/transplant-20261013-v2/textures/im26-3304-original-own-vips.png)

| im26-3312 | 13570 | 1.3 / 11868 | -12.54% | 0, 1, 2, 4, 5, 6, 7, 10, 11, 12, 13, 15, 17 | Vips preserves more of the paper grain; our output smooths it and has mild uneven regions. |

![im26-3312: original, own control, vips](../../../.tmp/jpegxl-lossy-lab/transplant-20261013-v2/textures/im26-3312-original-own-vips.png)

| im26-1020 | 5225 | 1 / 5071 | -2.95% | 5, 18, 20 | The original already has blocks. Vips reduces additional blockiness; it does not remove all source structure. |

![im26-1020: original, own control, vips](../../../.tmp/jpegxl-lossy-lab/transplant-20261013-v2/textures/im26-1020-original-own-vips.png)

## Forced-transform texture comparison

The new comparison uses distance 3 for every encoded column. Columns are
original / control / forced strategy / all maps / vips. Sizes differ, so this
isolates the decision switch at a fixed distance rather than matched rate.
The central 256-square review crop maps the original channel means to 128 and
multiplies differences by four. This makes faint seams visible without clipping
the paper texture. Full unchanged-color comparisons are retained alongside it.

| Texture | Control / strategy / all / vips bytes | Visual observation |
| --- | --- | --- |
| im26-3304 | 6003 / 7739 / 789 / 1267 | Transform replay reduces the small checker pattern, but uneven regions remain. All maps and vips are much smoother and much smaller at this distance. |

![im26-3304: original, control, strategy, all maps, vips; contrast enhanced](../../../.tmp/jpegxl-lossy-lab/replay-textures-v3/im26-3304-center-contrast.png)

| im26-3312 | 13570 / 15874 / 3897 / 3528 | Transform choice alone does not remove the visible paper squares. Some are already in the original. The all-maps output still has broad uneven color regions. |

![im26-3312: original, control, strategy, all maps, vips; contrast enhanced](../../../.tmp/jpegxl-lossy-lab/replay-textures-v3/im26-3312-center-contrast.png)

| im26-1020 | 5225 / 5817 / 1349 / 1848 | Large transforms soften the square boundaries into rounded regions. The original contains strong blocks; replay also removes detail, so this is not an unconditional quality gain. |

![im26-1020: original, control, strategy, all maps, vips; contrast enhanced](../../../.tmp/jpegxl-lossy-lab/replay-textures-v3/im26-1020-center-contrast.png)


## Pre-port decision

The all-maps row closes much of the Butteraugli gap, but still misses SSIM.
Among individual components, transform replay gives the strongest improvement
in 3-norm against vips. Its maximum-error regression prevents promotion as-is.
The first source experiment should port the strategy decision cost using our
own quantizer, with the maximum-error guard retained. Native peer decisions
were chosen jointly with different quantizers and preconditioning, so their
map alone does not establish the quality of a source-informed selector.
Strategy and mathematical filter replay exceed the 3x crop speed target.
Use cheaper first-party transform/filter kernels before promotion; these
development prototypes are not eligible for the production path.
Holdout and original speed/memory qualification remain required for any port.

## Reproduction

```sh
node benchmark/jpegxl/lossy-lab/prepare-transplant.ts
node benchmark/jpegxl/lossy-lab/run-transplants.ts <new-output-directory>
node benchmark/jpegxl/lossy-lab/run-transplant-corrections.ts <new-output-directory>
node benchmark/jpegxl/lossy-lab/run-transplant-replay.ts <new-output-directory>
node benchmark/jpegxl/lossy-lab/run-transplant-speed.ts <new-output-directory>
node benchmark/jpegxl/lossy-lab/run-replay-speed.ts .tmp/jpegxl-lossy-lab/replay-v5 strategy filters available features
node benchmark/jpegxl/lossy-lab/run-replay-speed.ts .tmp/jpegxl-lossy-lab/replay-v6 all
node benchmark/jpegxl/lossy-lab/compare-transplant-textures.ts <new-output-directory>
node benchmark/jpegxl/lossy-lab/compare-replay-textures.ts <new-output-directory>
node benchmark/jpegxl/lossy-lab/audit-transplant-control.ts <new-output-directory>
node benchmark/jpegxl/lossy-lab/report-transplants.ts <new-output-directory>
```

The pre-port checkpoint must include every screen/full row and isolated timing.
Step 2 follows measured contributions after that checkpoint is reported.
