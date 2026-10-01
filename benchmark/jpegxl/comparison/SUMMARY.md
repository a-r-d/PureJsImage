# Measured comparison summary

Generated from the raw reports. See `REPORT.md` for methods and limits.

## Correctness and coverage

| Runtime | Subject | Operation | Verified | API absent | Unsupported | Incorrect | Failed |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: |
| chromium | purejsimage | decode-lossless | 16 | 0 | 0 | 0 | 0 |
| chromium | purejsimage | decode-lossy | 13 | 0 | 0 | 0 | 0 |
| chromium | purejsimage | encode | 45 | 0 | 0 | 0 | 0 |
| chromium | purejsimage | roundtrip | 1 | 0 | 0 | 0 | 0 |
| chromium | jsquash | decode-lossless | 12 | 3 | 0 | 1 | 0 |
| chromium | jsquash | decode-lossy | 4 | 0 | 0 | 9 | 0 |
| chromium | jsquash | encode | 42 | 3 | 0 | 0 | 0 |
| chromium | jsquash | roundtrip | 1 | 0 | 0 | 0 | 0 |
| chromium | oxide | decode-lossless | 16 | 0 | 0 | 0 | 0 |
| chromium | oxide | decode-lossy | 13 | 0 | 0 | 0 | 0 |
| chromium | oxide | encode | 0 | 45 | 0 | 0 | 0 |
| chromium | oxide | roundtrip | 0 | 1 | 0 | 0 | 0 |
| chromium | vips | decode-lossless | 16 | 0 | 0 | 0 | 0 |
| chromium | vips | decode-lossy | 13 | 0 | 0 | 0 | 0 |
| chromium | vips | encode | 45 | 0 | 0 | 0 | 0 |
| chromium | vips | roundtrip | 1 | 0 | 0 | 0 | 0 |
| node | purejsimage | decode-lossless | 16 | 0 | 0 | 0 | 0 |
| node | purejsimage | decode-lossy | 13 | 0 | 0 | 0 | 0 |
| node | purejsimage | encode | 45 | 0 | 0 | 0 | 0 |
| node | purejsimage | roundtrip | 1 | 0 | 0 | 0 | 0 |
| node | jsquash | decode-lossless | 12 | 3 | 0 | 1 | 0 |
| node | jsquash | decode-lossy | 4 | 0 | 0 | 9 | 0 |
| node | jsquash | encode | 42 | 3 | 0 | 0 | 0 |
| node | jsquash | roundtrip | 1 | 0 | 0 | 0 | 0 |
| node | oxide | decode-lossless | 16 | 0 | 0 | 0 | 0 |
| node | oxide | decode-lossy | 13 | 0 | 0 | 0 | 0 |
| node | oxide | encode | 0 | 45 | 0 | 0 | 0 |
| node | oxide | roundtrip | 0 | 1 | 0 | 0 | 0 |
| node | vips | decode-lossless | 16 | 0 | 0 | 0 | 0 |
| node | vips | decode-lossy | 13 | 0 | 0 | 0 | 0 |
| node | vips | encode | 45 | 0 | 0 | 0 | 0 |
| node | vips | roundtrip | 1 | 0 | 0 | 0 | 0 |

## Representative photo workflows

Fixture im26-1030-diagnostic. Times in milliseconds; warm median [minimum, maximum] from three operations. Cold is initialization plus first operation, with sample count. Node peak RSS includes the entire isolated process. Oxide decode includes PNG export. Failed validation stays visible and has no performance result.

| Runtime | Subject | Workflow | Warm ms [range] | Cold ms [range]; n | Peak RSS MiB |
| --- | --- | --- | --- | --- | ---: |
| chromium | purejsimage | decode-lossless | 1341.9 [1340.7, 1377.4] | 1425.8 [1403.7, 1428.9]; 3 | unavailable |
| chromium | purejsimage | decode-lossy | 525.5 [508.3, 643.1] | 630.1 [630.1, 630.1]; 1 | unavailable |
| chromium | purejsimage | lossless encode, effort 1 | 669.5 [666.1, 682.3] | 705.2 [690.5, 720.7]; 3 | unavailable |
| chromium | purejsimage | roundtrip | 2010.8 [2004.3, 2080.5] | 2098.1 [2098.1, 2098.1]; 1 | unavailable |
| chromium | jsquash | decode-lossless | 291.9 [288.9, 304.4] | 379.9 [373.2, 385.5]; 3 | unavailable |
| chromium | jsquash | decode-lossy | incorrect output | incorrect output | unavailable |
| chromium | jsquash | lossless encode, effort 1 | 58.0 [55.4, 59.2] | 136.5 [136.3, 136.8]; 3 | unavailable |
| chromium | jsquash | roundtrip | 364.7 [342.2, 365.1] | 479.5 [479.5, 479.5]; 1 | unavailable |
| chromium | oxide | decode-lossless | 415.6 [409.1, 433.6] | 469.1 [466.3, 490.8]; 3 | unavailable |
| chromium | oxide | decode-lossy | 305.6 [301.6, 307.6] | 433.1 [433.1, 433.1]; 1 | unavailable |
| chromium | oxide | lossless encode, effort 1 | API not exposed | API not exposed | unavailable |
| chromium | oxide | roundtrip | API not exposed | API not exposed | unavailable |
| chromium | vips | decode-lossless | 182.2 [180.1, 208.0] | 381.4 [372.1, 400.2]; 3 | unavailable |
| chromium | vips | decode-lossy | 46.8 [43.2, 48.0] | 267.5 [267.5, 267.5]; 1 | unavailable |
| chromium | vips | lossless encode, effort 1 | 35.7 [32.0, 37.3] | 233.4 [229.5, 237.8]; 3 | unavailable |
| chromium | vips | roundtrip | 213.2 [212.5, 235.8] | 486.4 [486.4, 486.4]; 1 | unavailable |
| node | purejsimage | decode-lossless | 1384.1 [1380.9, 1385.0] | 1551.8 [1542.9, 1566.1]; 3 | 163.9 |
| node | purejsimage | decode-lossy | 428.5 [400.5, 454.8] | 549.7 [549.7, 549.7]; 1 | 246.4 |
| node | purejsimage | lossless encode, effort 1 | 713.0 [703.8, 716.9] | 773.4 [763.8, 774.9]; 3 | 270.0 |
| node | purejsimage | roundtrip | 2276.7 [2144.9, 2284.2] | 2282.9 [2282.9, 2282.9]; 1 | 235.0 |
| node | jsquash | decode-lossless | 277.0 [268.1, 283.5] | 335.6 [333.4, 343.9]; 3 | 174.1 |
| node | jsquash | decode-lossy | incorrect output | incorrect output | unavailable |
| node | jsquash | lossless encode, effort 1 | 54.5 [53.2, 55.3] | 131.0 [124.0, 143.5]; 3 | 179.6 |
| node | jsquash | roundtrip | 317.3 [315.5, 320.8] | 457.7 [457.7, 457.7]; 1 | 263.5 |
| node | oxide | decode-lossless | 410.9 [399.8, 420.2] | 477.3 [468.3, 484.4]; 3 | 117.5 |
| node | oxide | decode-lossy | 295.2 [294.6, 295.6] | 406.0 [406.0, 406.0]; 1 | 148.4 |
| node | oxide | lossless encode, effort 1 | API not exposed | API not exposed | unavailable |
| node | oxide | roundtrip | API not exposed | API not exposed | unavailable |
| node | vips | decode-lossless | 180.3 [173.1, 182.2] | 406.6 [406.1, 410.0]; 3 | 233.6 |
| node | vips | decode-lossy | 45.8 [45.3, 45.9] | 293.5 [293.5, 293.5]; 1 | 238.0 |
| node | vips | lossless encode, effort 1 | 27.8 [26.6, 28.2] | 200.0 [197.2, 203.7]; 3 | 178.6 |
| node | vips | roundtrip | 205.0 [204.3, 209.6] | 494.1 [494.1, 494.1]; 1 | 243.6 |

## Loaded toolkit assets

Includes required JS, WASM, and worker assets once each. Compression sizes are offline estimates.

| Subject | Deployed bytes | gzip | Brotli | Observed cold transfer |
| --- | ---: | ---: | ---: | ---: |
| purejsimage | 475206 | 156232 | 127302 | 475206 |
| jsquash | 2268276 | 855808 | 638868 | 2268276 |
| oxide | 1714326 | 615292 | 432861 | 1714326 |
| vips | 7469166 | 2856342 | 2254865 | 8809406 |

## Specialized public API probes

| Subject | Probe | Status |
| --- | --- | --- |
| purejsimage | ordinary wide integer preservation | verified |
| purejsimage | ordinary integer color with floating alpha | verified |
| purejsimage | ordinary Float32 lossless encoding | verified |
| purejsimage | ordinary integer ICC preservation | verified |
| purejsimage | floating VarDCT and linear HDR reference blends | verified |
| purejsimage | native float and HDR headroom | verified |
| purejsimage | extra channel samples and meaning | verified |
| purejsimage | ICC preservation | verified |
| purejsimage | animation encode, decode, composition, timing and frame access | verified |
| purejsimage | exact JPEG recompression and reconstruction | verified |
| purejsimage | region, reduced resolution, preview and selective reads | verified |
| oxide | animation decode, frame timing and frame access | incorrect output |
| oxide | animation frame access and composition | verified |
| oxide | incremental input and first useful preview | verified |
| oxide | region reconstruction | verified |
| oxide | ICC access | verified |
| vips | native float HDR | verified |
| vips | animation decode, frame timing and composition | verified |
| vips | animation frame access | verified |
| vips | ICC access | verified |
| vips | animation encode with exact 3/5 ms delays | incorrect output |
| vips | animation encode at ordinary 30/50 ms delays | verified |

## Paired lossless ratios

PureJsImage divided by each comparator. Only pairs that passed exact validation are included. Capped diagnostics, complete originals and precision fixtures stay separate.

| Runtime | Comparator | Scope | Effort | Pairs | Median bytes ratio | Median warm time ratio |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| chromium | jsquash | capped | 1 | 8 | 1.047 | 11.641 |
| chromium | jsquash | capped | 7 | 8 | 1.242 | 5.586 |
| chromium | jsquash | original | 1 | 5 | 0.993 | 2.922 |
| chromium | vips | capped | 1 | 8 | 1.151 | 25.360 |
| chromium | vips | capped | 7 | 8 | 1.131 | 9.574 |
| chromium | vips | original | 1 | 5 | 1.018 | 6.378 |
| chromium | vips | specialized | 1 | 3 | 0.708 | 1.211 |
| node | jsquash | capped | 1 | 8 | 1.047 | 13.360 |
| node | jsquash | capped | 7 | 8 | 1.242 | 6.742 |
| node | jsquash | original | 1 | 5 | 0.993 | 3.141 |
| node | vips | capped | 1 | 8 | 1.151 | 29.190 |
| node | vips | capped | 7 | 8 | 1.131 | 11.503 |
| node | vips | original | 1 | 5 | 1.018 | 8.387 |
| node | vips | specialized | 1 | 3 | 0.708 | 1.130 |

## Matched lossy quality

Only comparisons with independently validated outputs and adequate brackets on both sides receive a ratio. All unresolved targets and endpoints remain in the dataset.

| Fixture | Comparator | SSIMULACRA2 | Pure/comparator bytes |
| --- | --- | ---: | ---: |
| im26-1030-diagnostic | vips | 80 | 1.212 |
