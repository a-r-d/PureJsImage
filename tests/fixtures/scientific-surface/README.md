# Scientific surface fixture provenance

These files are test-only and are excluded from the published npm package. They remain under their
upstream data/project licenses; inclusion here does not relicense them under PureJsImage's MIT
license.

| Local file | SHA-256 | Upstream provenance |
| --- | --- | --- |
| `nanonis-afm-generic4.sxm` | `f00657fc956b9ca9bf415f5513e58d225ef3a63f2f12269a2379475a483c20a4` | FAIRmat AFMReader test data, Nanonis Generic 4 AFM acquisition. |
| `nanonis-stm-generic5.sxm` | `fb0d522e71e21a0fe7bf165e8598118a7b5f752f8b7d4d26ce23d8d6e5dbfec6` | FAIRmat AFMReader test data, Nanonis Generic 5 STM acquisition. |
| `asylum-afm-v5.ibw` | `84a7fad6032cc735fef6db2781c1d74d385f25b9ead4c3561f50560943233985` | FAIRmat AFMReader test data, Asylum Research AFM image wave. |
| `igor-win-v5-rank1.ibw` | `981383c28a78e5064711bb2aa534775fe2c4242b3ef9aaca27b540178446ec4f` | W. Trevor King `igor` reference corpus; independently produced rank-1 rejection fixture. |
| `digital-surf-compressed.sur` | `6ed59a9a235c0b6dc7e15f155d0e738c5841cfc0fe78f1861b7e145f9dcaadf4` | RosettaSciIO Digital Surf test corpus (`test_surface.sur`), externally generated according to its upstream test. |
| `iso5436-sample1.x3p` | `aebfd9f689781867b3069b5f6c2f61568c68a4a8a1999bf4c31920c278be9339` | OpenFMC X3P ISO 5436 sample 1 binary archive. |
| `iso5436-sample4.x3p` | `96d3e4cf618b0cf075937a64f3b1fcc7be63dc1fa8b619b245be459ed703b3f2` | OpenFMC X3P ISO 5436 sample 4 binary archive. |

The tests compare SXM coordinates and samples to independently converted AFMReader NXS output,
IBW labels and scaling to AFMReader output, Digital Surf dimensions/calibration to RosettaSciIO,
and X3P values to the OpenFMC examples. No third-party parser code is copied or used at runtime.
