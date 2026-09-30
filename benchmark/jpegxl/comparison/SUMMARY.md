# Measured comparison summary

Generated from the raw reports. See `REPORT.md` for methods and limits.

## Correctness and coverage

| Runtime | Subject | Operation | Verified | API absent | Unsupported | Incorrect | Failed |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: |
| chromium | purejsimage | decode-lossless | 9 | 0 | 7 | 0 | 0 |
| chromium | purejsimage | decode-lossy | 13 | 0 | 0 | 0 | 0 |
| chromium | purejsimage | encode | 45 | 0 | 0 | 0 | 0 |
| chromium | purejsimage | roundtrip | 0 | 0 | 1 | 0 | 0 |
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
| node | purejsimage | decode-lossless | 9 | 0 | 7 | 0 | 0 |
| node | purejsimage | decode-lossy | 13 | 0 | 0 | 0 | 0 |
| node | purejsimage | encode | 45 | 0 | 0 | 0 | 0 |
| node | purejsimage | roundtrip | 0 | 0 | 1 | 0 | 0 |
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
| chromium | purejsimage | decode-lossless | unsupported input | unsupported input | unavailable |
| chromium | purejsimage | decode-lossy | 486.0 [482.0, 632.2] | 607.2 [607.2, 607.2]; 1 | unavailable |
| chromium | purejsimage | lossless encode, effort 1 | 655.0 [622.9, 665.6] | 680.9 [669.0, 691.5]; 3 | unavailable |
| chromium | purejsimage | roundtrip | unsupported input | unsupported input | unavailable |
| chromium | jsquash | decode-lossless | 268.5 [266.8, 269.1] | 347.5 [344.5, 348.5]; 3 | unavailable |
| chromium | jsquash | decode-lossy | incorrect output | incorrect output | unavailable |
| chromium | jsquash | lossless encode, effort 1 | 55.8 [54.8, 58.2] | 132.9 [132.4, 136.0]; 3 | unavailable |
| chromium | jsquash | roundtrip | 322.3 [320.7, 323.8] | 476.4 [476.4, 476.4]; 1 | unavailable |
| chromium | oxide | decode-lossless | 387.6 [387.5, 388.4] | 461.2 [461.1, 465.0]; 3 | unavailable |
| chromium | oxide | decode-lossy | 294.2 [293.8, 297.7] | 390.7 [390.7, 390.7]; 1 | unavailable |
| chromium | oxide | lossless encode, effort 1 | API not exposed | API not exposed | unavailable |
| chromium | oxide | roundtrip | API not exposed | API not exposed | unavailable |
| chromium | vips | decode-lossless | 176.8 [173.6, 178.9] | 373.2 [363.8, 381.6]; 3 | unavailable |
| chromium | vips | decode-lossy | 43.8 [41.4, 44.6] | 224.8 [224.8, 224.8]; 1 | unavailable |
| chromium | vips | lossless encode, effort 1 | 30.3 [27.3, 30.5] | 211.4 [210.2, 218.8]; 3 | unavailable |
| chromium | vips | roundtrip | 203.3 [201.0, 203.9] | 419.2 [419.2, 419.2]; 1 | unavailable |
| node | purejsimage | decode-lossless | unsupported input | unsupported input | unavailable |
| node | purejsimage | decode-lossy | 405.4 [400.7, 409.8] | 521.6 [521.6, 521.6]; 1 | 231.1 |
| node | purejsimage | lossless encode, effort 1 | 704.6 [688.3, 705.1] | 752.6 [749.8, 752.9]; 3 | 222.8 |
| node | purejsimage | roundtrip | unsupported input | unsupported input | unavailable |
| node | jsquash | decode-lossless | 261.8 [260.9, 262.6] | 327.5 [327.4, 330.5]; 3 | 171.3 |
| node | jsquash | decode-lossy | incorrect output | incorrect output | unavailable |
| node | jsquash | lossless encode, effort 1 | 52.3 [51.4, 54.0] | 123.3 [122.5, 124.3]; 3 | 179.5 |
| node | jsquash | roundtrip | 313.6 [313.0, 317.5] | 434.2 [434.2, 434.2]; 1 | 255.5 |
| node | oxide | decode-lossless | 388.1 [386.8, 391.7] | 457.3 [456.2, 465.6]; 3 | 124.6 |
| node | oxide | decode-lossy | 290.7 [289.3, 290.8] | 393.4 [393.4, 393.4]; 1 | 147.9 |
| node | oxide | lossless encode, effort 1 | API not exposed | API not exposed | unavailable |
| node | oxide | roundtrip | API not exposed | API not exposed | unavailable |
| node | vips | decode-lossless | 170.4 [167.6, 175.8] | 401.4 [394.2, 427.3]; 3 | 236.7 |
| node | vips | decode-lossy | 42.6 [40.9, 44.7] | 265.0 [265.0, 265.0]; 1 | 237.7 |
| node | vips | lossless encode, effort 1 | 26.7 [26.3, 27.5] | 194.5 [193.3, 195.3]; 3 | 176.2 |
| node | vips | roundtrip | 200.0 [197.6, 200.3] | 446.6 [446.6, 446.6]; 1 | 240.4 |

## Loaded toolkit assets

Includes required JS, WASM, and worker assets once each. Compression sizes are offline estimates.

| Subject | Deployed bytes | gzip | Brotli | Observed cold transfer |
| --- | ---: | ---: | ---: | ---: |
| purejsimage | 419805 | 139790 | 114723 | 419805 |
| jsquash | 2268276 | 855809 | 638868 | 2268276 |
| oxide | 1714326 | 615293 | 432861 | 1714326 |
| vips | 7469166 | 2856343 | 2254865 | 8809406 |

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
| chromium | jsquash | capped | 1 | 8 | 1.047 | 11.696 |
| chromium | jsquash | capped | 7 | 8 | 1.242 | 5.789 |
| chromium | jsquash | original | 1 | 5 | 0.993 | 2.891 |
| chromium | vips | capped | 1 | 8 | 1.151 | 24.471 |
| chromium | vips | capped | 7 | 8 | 1.131 | 9.793 |
| chromium | vips | original | 1 | 5 | 1.018 | 6.687 |
| chromium | vips | specialized | 1 | 3 | 0.708 | 1.088 |
| node | jsquash | capped | 1 | 8 | 1.047 | 13.227 |
| node | jsquash | capped | 7 | 8 | 1.242 | 7.097 |
| node | jsquash | original | 1 | 5 | 0.993 | 3.183 |
| node | vips | capped | 1 | 8 | 1.151 | 27.649 |
| node | vips | capped | 7 | 8 | 1.131 | 11.468 |
| node | vips | original | 1 | 5 | 1.018 | 7.771 |
| node | vips | specialized | 1 | 3 | 0.708 | 1.361 |

## Matched lossy quality

Only comparisons with independently validated outputs and adequate brackets on both sides receive a ratio. All unresolved targets and endpoints remain in the dataset.

| Fixture | Comparator | SSIMULACRA2 | Pure/comparator bytes |
| --- | --- | ---: | ---: |
| im26-1030-diagnostic | vips | 80 | 1.212 |
