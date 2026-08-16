# Application platform benchmark

- Fixture: `application-platform-v1`
- Runtime: v24.16.0 on linux/x64
- Provider: `purejsimage.analysis.reference@1`, implementation `1.0.0`

All measurements passed correctness gates. Times are local wall-clock samples, and runtime cache
bytes are bounded cache accounting rather than process peak memory.

| Workflow | Cold / first ms | Warm ms | Evidence |
| --- | ---: | ---: | --- |
| GSF detect + first tile | 3.662 | 1.934 | checksum 850944 |
| MRC detect + first tile | 1.494 | 0.710 | checksum 1015296 |
| CBF detect + first tile | 1.930 | 2.291 | checksum 50096 |
| First display tile | 1.461 | n/a | checksum 6048 |
| 4D-STEM diffraction tile | 1.775 | n/a | checksum 147650560 |
| ROI statistics | 338.092 | 33.231 | collection |
| Calibrated line profile | 188.616 | 2.974 | profile |
| Threshold tile | 22.047 | 0.732 | 1 cache hits |
| Gaussian 256 tile | 37.807 | 0.220 | constant-field exactness |

The range-backed Aperio workflow fetched 300556 of 1938955 source bytes across 6 HTTP range requests. See the JSON companion for source/derived cache counters, Gaussian tile-size scaling, setup/planning splits, and exact fixture descriptors.


Result JSON: benchmark/results/application-platform-2026-08-16T03-39-29-637Z.json
