# Ordinary JPEG XL structured SDR references

The 33 cases cover 10-, 12- and 16-bit linear, gamma, Display P3,
Rec. 2020, gray and custom-color samples. DCI and custom white points also
have 8-bit cases. Seven first-party native rasters add BT.709, gray alpha,
mixed alpha depths, association, partial 1024-pixel groups and a constant
2x shifted alpha grid. Existing M4 inputs keep their original attribution.

Pinned libjxl 0.12.0 provides native samples and the original source profile
through its C API. Its normalized integer output is mapped back to the native
color and alpha grids separately. For these integer depths through 16 bits,
normalization to 16-bit storage and inverse rounding recover each source code
exactly. The shifted-alpha fixture uses a constant plane.

LittleCMS 2.17 then converts the profile to sRGB with perceptual intent,
`cmsFLAGS_NOOPTIMIZE`, unsigned 16-bit color input and floating output.
Associated color is straightened in the native numeric domain before one
rounding to the 16-bit input grid. Alpha is normalized independently and must
match exactly. Associated zero-alpha color is zero. The manifest pins input,
profile and reference hashes, plus both oracle libraries.

The bounds are one 8-bit code, eight 16-bit GRAY codes and 180 16-bit RGB codes.
These retain the existing ICC evaluator's profile-specific rounding bounds.
Libjxl's generated profiles serialize curves and colorants with finite precision;
the production structured converter evaluates the declared transfer and
chromaticities directly. These fixtures do not qualify arbitrary ICC profiles.

Tests check source preservation by default, explicit sRGB conversion, replay,
cross-group crops, PNG output, JPEG XL re-encoding, cancellation and table limits.
Custom chromaticities require relative intent in the ordinary converter.

Regenerate with Node, Bun and the pinned development libraries:

```sh
node benchmark/jpegxl/generate-structured-pipeline-fixtures.ts
```

Run isolated cold/warm resource verification:

```sh
node benchmark/jpegxl/run-profile-pipeline.ts .tmp/jpegxl-structured-resource.json --structured
```

The report records absolute process peak RSS, time, throughput, external and
ArrayBuffer memory, and planner estimates. Small fixtures check additional
converter storage; they do not qualify large-image peak memory. Production
conversion remains first-party TypeScript with no runtime dependencies.
