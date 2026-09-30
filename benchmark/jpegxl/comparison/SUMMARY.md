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
| chromium | purejsimage | decode-lossless | 1346.7 [1312.6, 1355.8] | 1404.3 [1399.8, 1449.8]; 3 | unavailable |
| chromium | purejsimage | decode-lossy | 548.0 [510.1, 658.5] | 579.8 [579.8, 579.8]; 1 | unavailable |
| chromium | purejsimage | lossless encode, effort 1 | 670.3 [636.4, 680.6] | 691.0 [672.4, 692.9]; 3 | unavailable |
| chromium | purejsimage | roundtrip | 1973.5 [1970.9, 1982.1] | 2058.9 [2058.9, 2058.9]; 1 | unavailable |
| chromium | jsquash | decode-lossless | 269.6 [266.5, 269.7] | 360.0 [350.3, 362.1]; 3 | unavailable |
| chromium | jsquash | decode-lossy | incorrect output | incorrect output | unavailable |
| chromium | jsquash | lossless encode, effort 1 | 57.4 [56.1, 58.9] | 137.3 [134.1, 138.4]; 3 | unavailable |
| chromium | jsquash | roundtrip | 326.7 [326.4, 328.9] | 501.8 [501.8, 501.8]; 1 | unavailable |
| chromium | oxide | decode-lossless | 392.7 [389.0, 393.6] | 469.7 [467.0, 485.0]; 3 | unavailable |
| chromium | oxide | decode-lossy | 296.5 [294.8, 300.4] | 409.8 [409.8, 409.8]; 1 | unavailable |
| chromium | oxide | lossless encode, effort 1 | API not exposed | API not exposed | unavailable |
| chromium | oxide | roundtrip | API not exposed | API not exposed | unavailable |
| chromium | vips | decode-lossless | 181.2 [177.9, 194.9] | 377.3 [376.5, 394.9]; 3 | unavailable |
| chromium | vips | decode-lossy | 46.1 [45.8, 47.3] | 287.4 [287.4, 287.4]; 1 | unavailable |
| chromium | vips | lossless encode, effort 1 | 31.1 [29.4, 32.0] | 227.4 [219.8, 233.8]; 3 | unavailable |
| chromium | vips | roundtrip | 208.2 [207.0, 209.8] | 431.9 [431.9, 431.9]; 1 | unavailable |
| node | purejsimage | decode-lossless | 1393.2 [1371.9, 1394.6] | 1502.7 [1491.9, 1506.8]; 3 | 154.9 |
| node | purejsimage | decode-lossy | 408.2 [401.0, 410.2] | 518.4 [518.4, 518.4]; 1 | 236.8 |
| node | purejsimage | lossless encode, effort 1 | 692.0 [690.2, 719.3] | 756.6 [753.6, 771.9]; 3 | 238.7 |
| node | purejsimage | roundtrip | 2077.3 [2068.7, 2093.2] | 2225.3 [2225.3, 2225.3]; 1 | 225.8 |
| node | jsquash | decode-lossless | 262.7 [262.5, 263.1] | 334.9 [331.8, 335.6]; 3 | 177.2 |
| node | jsquash | decode-lossy | incorrect output | incorrect output | unavailable |
| node | jsquash | lossless encode, effort 1 | 52.7 [52.5, 53.6] | 126.1 [125.5, 127.4]; 3 | 185.7 |
| node | jsquash | roundtrip | 322.2 [321.2, 327.1] | 446.1 [446.1, 446.1]; 1 | 253.5 |
| node | oxide | decode-lossless | 384.0 [382.5, 384.5] | 470.3 [469.8, 479.8]; 3 | 117.8 |
| node | oxide | decode-lossy | 292.5 [292.4, 293.9] | 391.1 [391.1, 391.1]; 1 | 150.6 |
| node | oxide | lossless encode, effort 1 | API not exposed | API not exposed | unavailable |
| node | oxide | roundtrip | API not exposed | API not exposed | unavailable |
| node | vips | decode-lossless | 172.2 [168.7, 174.7] | 412.3 [404.0, 415.2]; 3 | 234.3 |
| node | vips | decode-lossy | 42.0 [41.1, 44.5] | 274.8 [274.8, 274.8]; 1 | 240.4 |
| node | vips | lossless encode, effort 1 | 26.8 [25.7, 27.5] | 198.6 [197.4, 199.6]; 3 | 178.5 |
| node | vips | roundtrip | 201.8 [199.9, 203.2] | 456.1 [456.1, 456.1]; 1 | 238.4 |

## Loaded toolkit assets

Includes required JS, WASM, and worker assets once each. Compression sizes are offline estimates.

| Subject | Deployed bytes | gzip | Brotli | Observed cold transfer |
| --- | ---: | ---: | ---: | ---: |
| purejsimage | 419638 | 139714 | 114532 | 419638 |
| jsquash | 2268276 | 855810 | 638870 | 2268276 |
| oxide | 1714326 | 615294 | 432863 | 1714326 |
| vips | 7469166 | 2856344 | 2254867 | 8809406 |

## Specialized public API probes

| Subject | Probe | Status |
| --- | --- | --- |
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
| chromium | jsquash | capped | 1 | 8 | 1.047 | 11.587 |
| chromium | jsquash | capped | 7 | 8 | 1.242 | 5.752 |
| chromium | jsquash | original | 1 | 5 | 0.993 | 2.872 |
| chromium | vips | capped | 1 | 8 | 1.151 | 24.964 |
| chromium | vips | capped | 7 | 8 | 1.131 | 9.614 |
| chromium | vips | original | 1 | 5 | 1.018 | 6.420 |
| chromium | vips | specialized | 1 | 3 | 0.708 | 1.397 |
| node | jsquash | capped | 1 | 8 | 1.047 | 13.125 |
| node | jsquash | capped | 7 | 8 | 1.242 | 6.889 |
| node | jsquash | original | 1 | 5 | 0.993 | 3.140 |
| node | vips | capped | 1 | 8 | 1.151 | 28.892 |
| node | vips | capped | 7 | 8 | 1.131 | 11.422 |
| node | vips | original | 1 | 5 | 1.018 | 7.642 |
| node | vips | specialized | 1 | 3 | 0.708 | 1.256 |

## Matched lossy quality

Only comparisons with independently validated outputs and adequate brackets on both sides receive a ratio. All unresolved targets and endpoints remain in the dataset.

| Fixture | Comparator | SSIMULACRA2 | Pure/comparator bytes |
| --- | --- | ---: | ---: |
| im26-1030-diagnostic | vips | 80 | 1.212 |
