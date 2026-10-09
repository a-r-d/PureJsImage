# JPEG XL lossy baseline

Variant: baseline. Mode: screen. Selected images: 16. Elapsed: 600.0 s.

Status: **incomplete**. Computed comparisons: 80/96; required-range coverage: 51/96; failures: 2; omissions: 33.

Negative BD-rate means fewer bytes at equal quality. Every computable common interval remains in the aggregates, including partial coverage. Target conclusions remain pending until coverage is complete.

| Metric | Peer | Mean | Median | p90 | Worst | Computed images | Required coverage |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| SSIMULACRA2 | jSquash | +1.00% | +0.40% | +13.64% | +28.71% | 13/16 | 2/16 |
| Butteraugli max | jSquash | +13.44% | +17.66% | +25.56% | +30.01% | 13/16 | 9/16 |
| Butteraugli 3-norm | jSquash | +16.36% | +18.80% | +24.57% | +36.02% | 13/16 | 13/16 |
| SSIMULACRA2 | wasm-vips | +1.21% | +0.12% | +14.83% | +29.63% | 14/16 | 3/16 |
| Butteraugli max | wasm-vips | +5.36% | +7.16% | +15.19% | +22.66% | 13/16 | 10/16 |
| Butteraugli 3-norm | wasm-vips | +10.36% | +13.92% | +19.31% | +35.55% | 14/16 | 14/16 |

Required overlap: SSIMULACRA2 60–90; Butteraugli max 0.5–3. Butteraugli 3-norm requires positive common width.

## Failures and overlap omissions

- Failure: im26-1626 / PureJsImage: Worker exited null; inspect .tmp/jpegxl-lossy-lab/screen-baseline-v1/baseline-purejsimage/im26-1626-lab/result.json
- Failure: im26-3306 / PureJsImage: Worker exited null; inspect .tmp/jpegxl-lossy-lab/screen-baseline-v1/baseline-purejsimage/im26-3306-lab/result.json
- Omission: im26-1052:lab / jSquash: ssimulacra2: incomplete required-range overlap
- Omission: im26-1052:lab / wasm-vips: ssimulacra2: incomplete required-range overlap
- Omission: im26-1610:lab / jSquash: ssimulacra2: incomplete required-range overlap
- Omission: im26-1610:lab / jSquash: butteraugliMax: incomplete required-range overlap
- Omission: im26-1610:lab / wasm-vips: ssimulacra2: incomplete required-range overlap
- Omission: im26-3312:lab / jSquash: ssimulacra2: incomplete required-range overlap
- Omission: im26-3312:lab / wasm-vips: ssimulacra2: incomplete required-range overlap
- Omission: im26-1002:lab / jSquash: ssimulacra2: incomplete required-range overlap
- Omission: im26-1002:lab / jSquash: butteraugliMax: incomplete required-range overlap
- Omission: im26-1002:lab / wasm-vips: ssimulacra2: incomplete required-range overlap
- Omission: im26-1002:lab / wasm-vips: butteraugliMax: incomplete required-range overlap
- Omission: im26-3014:lab / jSquash: ssimulacra2: Rate curve must be monotone: bytes cannot fall as quality improves
- Omission: im26-3014:lab / jSquash: butteraugliMax: Rate curve must be monotone: bytes cannot fall as quality improves
- Omission: im26-3014:lab / jSquash: butteraugliNorm3: Rate curve must be monotone: bytes cannot fall as quality improves
- Omission: im26-3014:lab / wasm-vips: ssimulacra2: incomplete required-range overlap
- Omission: im26-3014:lab / wasm-vips: butteraugliMax: Rate curve must be monotone: bytes cannot fall as quality improves
- Omission: im26-1026:lab / jSquash: ssimulacra2: incomplete required-range overlap
- Omission: im26-1026:lab / jSquash: butteraugliMax: incomplete required-range overlap
- Omission: im26-1026:lab / wasm-vips: ssimulacra2: incomplete required-range overlap
- Omission: im26-1026:lab / wasm-vips: butteraugliMax: incomplete required-range overlap
- Omission: im26-2002:lab / jSquash: ssimulacra2: incomplete required-range overlap
- Omission: im26-2002:lab / wasm-vips: ssimulacra2: incomplete required-range overlap
- Omission: im26-1622:lab / jSquash: ssimulacra2: incomplete required-range overlap
- Omission: im26-1622:lab / wasm-vips: ssimulacra2: incomplete required-range overlap
- Omission: im26-1210:lab / jSquash: ssimulacra2: incomplete required-range overlap
- Omission: im26-1210:lab / wasm-vips: ssimulacra2: incomplete required-range overlap
- Omission: im26-1634:lab / jSquash: ssimulacra2: incomplete required-range overlap
- Omission: im26-1634:lab / jSquash: butteraugliMax: incomplete required-range overlap
- Omission: im26-1634:lab / wasm-vips: ssimulacra2: incomplete required-range overlap
- Omission: im26-1634:lab / wasm-vips: butteraugliMax: incomplete required-range overlap
- Omission: im26-3000:lab / jSquash: ssimulacra2: incomplete required-range overlap
- Omission: im26-3000:lab / wasm-vips: ssimulacra2: incomplete required-range overlap
- Omission: im26-2012:lab / jSquash: ssimulacra2: incomplete required-range overlap
- Partial overlap: im26-1052:lab / jSquash / SSIMULACRA2.
- Partial overlap: im26-1052:lab / wasm-vips / SSIMULACRA2.
- Partial overlap: im26-1610:lab / jSquash / SSIMULACRA2.
- Partial overlap: im26-1610:lab / jSquash / Butteraugli max.
- Partial overlap: im26-1610:lab / wasm-vips / SSIMULACRA2.
- Partial overlap: im26-3312:lab / jSquash / SSIMULACRA2.
- Partial overlap: im26-3312:lab / wasm-vips / SSIMULACRA2.
- Partial overlap: im26-1002:lab / jSquash / SSIMULACRA2.
- Partial overlap: im26-1002:lab / jSquash / Butteraugli max.
- Partial overlap: im26-1002:lab / wasm-vips / SSIMULACRA2.
- Partial overlap: im26-1002:lab / wasm-vips / Butteraugli max.
- Partial overlap: im26-3014:lab / wasm-vips / SSIMULACRA2.
- Partial overlap: im26-1026:lab / jSquash / SSIMULACRA2.
- Partial overlap: im26-1026:lab / jSquash / Butteraugli max.
- Partial overlap: im26-1026:lab / wasm-vips / SSIMULACRA2.
- Partial overlap: im26-1026:lab / wasm-vips / Butteraugli max.
- Partial overlap: im26-2002:lab / jSquash / SSIMULACRA2.
- Partial overlap: im26-2002:lab / wasm-vips / SSIMULACRA2.
- Partial overlap: im26-1622:lab / jSquash / SSIMULACRA2.
- Partial overlap: im26-1622:lab / wasm-vips / SSIMULACRA2.
- Partial overlap: im26-1210:lab / jSquash / SSIMULACRA2.
- Partial overlap: im26-1210:lab / wasm-vips / SSIMULACRA2.
- Partial overlap: im26-1634:lab / jSquash / SSIMULACRA2.
- Partial overlap: im26-1634:lab / jSquash / Butteraugli max.
- Partial overlap: im26-1634:lab / wasm-vips / SSIMULACRA2.
- Partial overlap: im26-1634:lab / wasm-vips / Butteraugli max.
- Partial overlap: im26-3000:lab / jSquash / SSIMULACRA2.
- Partial overlap: im26-3000:lab / wasm-vips / SSIMULACRA2.
- Partial overlap: im26-2012:lab / jSquash / SSIMULACRA2.
- jSquash / SSIMULACRA2: 3 missing image comparisons.
- jSquash / Butteraugli max: 3 missing image comparisons.
- jSquash / Butteraugli 3-norm: 3 missing image comparisons.
- wasm-vips / SSIMULACRA2: 2 missing image comparisons.
- wasm-vips / Butteraugli max: 3 missing image comparisons.
- wasm-vips / Butteraugli 3-norm: 2 missing image comparisons.

## Memory

Curve run managed peak: 37.76 MiB; process peak RSS: Not reported.

Isolated speed summary not supplied; curve-sweep timings are excluded from speed ratios.
