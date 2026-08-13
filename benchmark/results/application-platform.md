# Application platform benchmark

- Fixture: `application-platform-v1`
- Runtime: v24.16.0 on darwin/arm64
- Provider: `purejsimage.analysis.reference@1`, implementation `1.0.0`

All measurements passed correctness gates. Times are local wall-clock samples, and runtime cache
bytes are bounded cache accounting rather than process peak memory.

| Workflow | Cold / first ms | Warm ms | Evidence |
| --- | ---: | ---: | --- |
| GSF detect + first tile | 2.096 | 1.267 | checksum 850944 |
| MRC detect + first tile | 0.792 | 0.466 | checksum 1015296 |
| CBF detect + first tile | 1.447 | 2.033 | checksum 50096 |
| First display tile | 1.132 | n/a | checksum 6048 |
| 4D-STEM diffraction tile | 1.326 | n/a | checksum 147650560 |
| ROI statistics | 276.918 | 41.343 | collection |
| Calibrated line profile | 27.934 | 11.643 | profile |
| Threshold tile | 19.747 | 1.038 | 1 cache hits |
| Gaussian 256 tile | 31.311 | 15.602 | constant-field exactness |

The range-backed Aperio workflow fetched 300556 of 1938955 source bytes across 6 HTTP range requests. See the JSON companion for source/derived cache counters, Gaussian tile-size scaling, setup/planning splits, and exact fixture descriptors.
