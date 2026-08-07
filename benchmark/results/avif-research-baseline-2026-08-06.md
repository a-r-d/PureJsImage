# AVIF research baseline — 2026-08-06

This development-only baseline compares the first-party PureJsImage container metadata path with
`@stacksjs/ts-avif@0.1.3` across 25 checksum-pinned fixtures from libavif revision
`25a6d23f872f37c91a3df15b75e1a97f590d7c46`. The corpus is BSD-2-Clause licensed and covers 8/10/12-bit data,
monochrome/4:2:0/4:2:2/4:4:4 signaling, profiles 0-2, alpha, HDR, grids, progressive items,
extended `pixi`, tiny images, and animated files.

The published ts-avif package does not import on Node 24.16.0 without a development-only
`Uint8Array.fromBase64` shim. The benchmark supplies that shim before importing the package. PureJsImage
does not need it.

| Action | Metadata/decode compatibility | Median wall | Median peak RSS | Maximum peak RSS | Median measured RSS delta |
| --- | ---: | ---: | ---: | ---: | ---: |
| PureJsImage metadata | 25/25 | 1.63 ms | 90.7 MiB | 94.9 MiB | 0.4 MiB |
| ts-avif metadata | 19/25 | 0.79 ms | 75.8 MiB | 79.1 MiB | 0.3 MiB |
| ts-avif full decode | 23/25 | 180.11 ms | 118.5 MiB | 154.0 MiB | 40.3 MiB |

Peak RSS is the child process resource maximum. The delta subtracts RSS after fixture loading, package
import, and forced garbage collection; it is directional because `ru_maxrss` can include an earlier
startup/import peak. Each action and fixture runs in a fresh process.

## Compatibility failures

- reference-metadata / android_jni-avifandroidjni-src-androidTest-assets-avif-blue-and-magenta-crop: hasAlpha: expected true, got false
- reference-decode / android_jni-avifandroidjni-src-androidTest-assets-avif-fox.profile2.12bpc.yuv420.monochrome: No frame data found
- reference-metadata / tests-data-abc_color_irot_alpha_irot: hasAlpha: expected true, got false
- reference-metadata / tests-data-colors-animated-12bpc-keyframes-0-2-3: hasAlpha: expected true, got false
- reference-metadata / tests-data-colors-animated-8bpc-alpha-exif-xmp: hasAlpha: expected true, got false
- reference-metadata / tests-data-draw_points_idat: hasAlpha: expected true, got false
- reference-metadata / tests-data-draw_points_idat_progressive: hasAlpha: expected true, got false
- reference-decode / tests-data-sofa_grid1x5_420: No sequence header found
