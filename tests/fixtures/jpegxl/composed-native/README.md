# Composed native float and CMYK fixtures

Thirteen libjxl-encoded inputs produce twenty-nine displayed frames. They cover
binary16/binary32 gray and RGB, integer CMYK, straight and associated IEEE alpha,
cropped layers with negative origins, reference reuse, all five frame blend modes
and a crop across the 1024-pixel group boundary. Float ICC, PQ and HLG conversions
run after source-domain composition.

The manifest pins each input and displayed-frame reference by SHA-256. Binary
sample files are gzip-compressed, interleaved and big-endian. Float references
come from the coalescing libjxl decoder with source samples retained. Integer
gray samples are normalized to Float32; alpha remains independent. CMYK display
references apply LittleCMS to libjxl's composed C/M/Y and black planes. Float ICC
uses Float32 LittleCMS input. HDR uses exact-gamma FFmpeg/zimg conversion and
source-gamut Reinhard mapping at 203 nit reference white.

The manifest records libjxl 0.12.0, LittleCMS 2.17 and FFmpeg binary hashes.
Each animation exposes three displayed frames. Hidden layer composition stays
inside the selected displayed frame. Color and alpha tolerances are separate;
composition rounds Float64 working values to Float32 rows at the public boundary.

Regenerate on Linux x64 with Bun and the pinned libraries used by
[`float-completion`](../float-completion/README.md):

```sh
bun benchmark/jpegxl/generate-composed-native-fixtures.ts
npx biome format --write tests/fixtures/jpegxl/composed-native/manifest.json
```

`tests/jpegxl-float-completion.test.ts` checks every displayed frame through the
ordinary pipeline and replays crops. The same workflows run in Chromium,
Firefox and WebKit. Native APIs retain full source-domain canvas and reference
planes; a crop does not remove those allocations.
