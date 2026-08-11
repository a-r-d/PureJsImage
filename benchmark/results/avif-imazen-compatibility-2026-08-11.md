# AVIF Imazen compatibility survey — 2026-08-11

## Scope

This survey adds a checksum-pinned real-image workflow around twelve representative files from
Imazen's `imazen-26` K300 subset. The selected content classes cover photography, interiors,
nature, food, people, textures, museum photography, brochures, manuscript scans, plots, web
screenshots, and synthetic product imagery.

Each source is fetched by its pinned SHA-256, stripped of metadata, converted to sRGB, and fitted
within a white 512x512 canvas. Three 8-bit YUV 4:2:0 AVIF variants are generated per source:

- rav1e 0.7.1 through libavif 1.3.0, quality 60, speed 6, one worker;
- SVT-AV1 2.3.0 through libavif 1.3.0, quality 60, speed 8; and
- ImageMagick 7.1.2-3 / libheif, quality 60.

The corpus generator and runner are:

```sh
npm run bench:avif:imazen:prepare -- --output /tmp/purejsimage-imazen-avif-survey
npm run bench:avif:imazen -- \
  --input /tmp/purejsimage-imazen-avif-survey \
  --output benchmark/results/avif-imazen-compatibility-2026-08-11.json
```

The JSON report records every source URL and source, normalized-source, encoded-file, and decoded
RGBA checksum; portable and oracle metadata; per-channel pixel differences; explicit decoder
errors; wall time; and sampled RSS, external, and ArrayBuffer memory.

## Result

| Encoder | Files | Completed decode | Completion | Maximum RGB error | Maximum mean error | Minimum PSNR |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| ImageMagick/libheif | 12 | 12 | 100% | 2 | 0.3824 | 52.23 dB |
| SVT-AV1 | 12 | 2 | 16.7% | 2 | 0.3820 | 52.23 dB |
| rav1e | 12 | 12 | 100% | 2 | 0.3839 | 52.21 dB |
| **Total** | **36** | **26** | **72.2%** | **2** | **0.3839** | **52.21 dB** |

libavif/dav1d and libavif/libaom produced byte-identical 8-bit RGBA for every completed file. The
portable TypeScript output stayed within two code values of those agreeing independent decoders.
Metadata inspection completed for all 36 files and reported the expected 512x512 opaque, 8-bit,
YUV 4:2:0 images before pixel reconstruction was attempted.

## Explicit failures

All 10 failures were explicit; no file emitted partial or fabricated output.

| Failure | Files | Encoder | Public error |
| --- | ---: | --- | --- |
| Nonzero trailing tile padding | 7 | SVT-AV1 | `INVALID_INPUT` |
| Missing trailing-one bit | 1 | SVT-AV1 | `INVALID_INPUT` |
| Arithmetic symbol decoder over-read | 2 | SVT-AV1 | `INVALID_INPUT` |

All twelve rav1e files now decode after adding spatial segmentation-map reconstruction,
alternate-quantizer application, and reduced transform-set CDF handling. The remaining SVT-AV1
failures need bitstream-level investigation before being classified as unsupported syntax or
decoder defects; the same files are accepted by dav1d and libaom, so the current portable errors
are not evidence that those files are invalid.

## Memory method and result

Each file ran in a fresh Node.js process. The baseline was sampled after input load and five
GC/event-loop turns. RSS, external memory, and ArrayBuffer memory were sampled after metadata,
decoder creation, and every emitted output block. Sampled RSS is used instead of
`process.resourceUsage().maxRSS`, whose inherited pre-exec high-water mark can make short child
measurements meaningless.

Across the twenty-six completed 512x512 decodes:

- sampled RSS delta: 8.875–18.809 MiB;
- maximum ArrayBuffer delta: 2.468 MiB; and
- maximum external-memory delta: 2.525 MiB.

These numbers describe this fixed 512x512 compatibility workload, not large-image scaling or a
Lambda memory tier. The existing isolated scaling benchmarks remain authoritative for those claims.

## Decision

The survey does not justify calling the AVIF decoder feature-complete. It now demonstrates complete
decode of the measured ImageMagick/libheif and rav1e 8-bit YUV 4:2:0 subsets, including rav1e's
spatial segmentation maps. SVT-AV1 trailing-bit and arithmetic-decoder failures are the next
correctness investigation. General inter-frame decode, fragmented media, temporal segmentation,
and the other documented unsupported boundaries remain outside this survey.
