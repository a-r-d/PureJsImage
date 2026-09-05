# PR 35 remediation fixtures

These tiny fixtures come from the libjxl 0.12.0 C encoder API at revision
`a7a9c787341cf703dede03c2009fa460cae5e5df`. PureJsImage does not generate their
codestreams or their reference pixels. The generator feeds analytical normalized
samples to libjxl, requests exact integer lossless output with independent color
and alpha depths, and verifies normalized float samples through pinned `djxl`.
The `.bin` files contain big-endian float32 source-channel samples. Gray-alpha
references have two channels, while RGB-alpha references have four.

The HLG and PQ files carry exactly 2000 nits, 0.125 minimum nits,
`relativeToMaxDisplay: true`, and `linearBelow: 0.25`. Values are representable
without half-float metadata rounding. `manifest.json` pins every fixture and
reference checksum. Integer comparisons recover native code values by rounding
the independent float reference to the declared integer range.

Run the TypeScript generator with Bun on Linux x64. It uses Bun's development FFI
only to call the pinned libjxl library. This is not a production dependency and
is not reachable from package entry points. First prepare the existing pinned
libjxl source and conformance corpus using the commands in
`.github/workflows/jpegxl-corpus.yml`. Build a separate shared library:

```sh
cmake -S .tmp/jpegxl-oracles/libjxl-v0.12.0/source \
  -B .tmp/jpegxl-remediation-oracle -G Ninja \
  -DCMAKE_BUILD_TYPE=Release -DJPEGXL_STATIC=OFF -DBUILD_TESTING=OFF \
  -DJPEGXL_ENABLE_TOOLS=OFF -DJPEGXL_ENABLE_TESTS=OFF \
  -DJPEGXL_ENABLE_BENCHMARK=OFF -DJPEGXL_ENABLE_EXAMPLES=OFF \
  -DJPEGXL_ENABLE_JPEGLI=OFF -DJPEGXL_ENABLE_MANPAGES=OFF \
  -DJPEGXL_ENABLE_PLUGINS=OFF
cmake --build .tmp/jpegxl-remediation-oracle --target jxl --parallel 8
bun benchmark/jpegxl/generate-remediation-fixtures.ts
```

The generator checks libjxl's version and source revision or archive checksum.
It encodes effort 1 with `uses_original_profile`, lossless mode, structured color
or the explicit source ICC, and native color/alpha bit depths. It runs `djxl`
with `--num_threads=1` to produce each `.npy` reference, then stores the samples
in canonical big-endian order. The ABI field offsets are specific to the pinned
public libjxl headers and Linux x64. The generator checks every returned C API
status and every reference sample.

The analytical samples and generator are MIT licensed with PureJsImage. The
`gray-icc-alpha-8-8` fixture additionally embeds the unchanged gray ICC profile
from the JPEG XL conformance corpus at revision
`4bf053529c7cefd2951be453475bb3dccc7e7be8`, testcase `grayscale`. Its input hash is
`78fbbba852e99946d187dcf0bcbd7fb0e7c22be2f0852523aaae6ed91e7e3c39`; its profile hash
is `3f62598dfd40d6642ca5fd962559bb6615af15448a57a3972a4089c109e62fbd`.
The embedded Adobe copyright is retained. The conformance corpus redistribution
notice is reproduced in `CONFORMANCE-LICENSE.txt`.

Gray ICC with alpha remains outside the supported RGB expansion boundary.
Inspection preserves its source description; pixel decoding fails explicitly.
