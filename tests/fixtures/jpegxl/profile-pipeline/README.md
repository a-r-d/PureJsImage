# Ordinary JPEG XL profile conversion references

The twelve inputs use first-party analytical native rasters and the lossless
native writer. They cover GRAY and RGB profiles, 8- through 16-bit color,
independent alpha depth, associated alpha, a constant 2x shifted alpha plane,
adjacent 16-bit values and partial 1024-pixel Modular groups.

References use the LittleCMS 2.17 C API with perceptual intent and
`cmsFLAGS_NOOPTIMIZE`. Color is normalized and associated samples are
straightened before one rounding to the 16-bit input grid. The oracle emits
floating sRGB, followed by final 8- or 16-bit rounding. Alpha is normalized
independently and never enters the color transform.

The manifest pins encoded bytes, raw reference bytes, profiles and the oracle
library. The two existing profiles keep their original fixture attribution.
The small mAB profile comes from the first-party test profile builder.

Gray probes stay within one output code. Full-range sampled gray curves use
eight 16-bit codes: LittleCMS rounds the sampled curve's linear result even
in its floating evaluator. Half a linear code, the maximum sRGB slope of
12.92 and final rounding account for this bound. The matrix RGB bound is 180
codes. The two-point mAB probe keeps the native API's existing 1300-code bound
for trilinear interpolation versus LittleCMS tetrahedral interpolation. Integer
alpha must match exactly. These tolerances do not describe arbitrary profiles.

Tests verify direct decoding, replay, cross-group crops, PNG output and native
re-encoding. Source ICC cannot be attached to converted sRGB output. Preserving
a GRAY profile on the expanded RGBA layout remains an explicit error.

Regenerate on Linux x64 with Node, Bun and the pinned LittleCMS library:

```sh
node benchmark/jpegxl/generate-profile-pipeline-fixtures.ts
```

Run isolated cold and warm resource checks, including cross-group crops:

```sh
node benchmark/jpegxl/run-profile-pipeline.ts .tmp/jpegxl-profile-resource.json
```

Each measured row checks every color sample against its pinned reference and
requires exact alpha. The report records absolute process peak RSS, time,
throughput, planner estimates, external memory and ArrayBuffer storage. Warm
measurements follow two completed decodes and explicit garbage collection.
These small fixtures check the converter's additional working storage; they
do not qualify peak memory for large photographic inputs.

The C API adapter is a development oracle. Production decoding remains
first-party TypeScript with no runtime dependency.
