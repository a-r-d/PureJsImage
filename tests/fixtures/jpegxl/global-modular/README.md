# JPEG XL global Modular fixtures

These first-party 513 by 259 RGB rasters contain sparse palette colors or
deterministic integer patterns at 8 and 16 bits. Unmodified libjxl 0.12.0 at
commit `8cb67e2` encodes the grouped global Palette and responsive Squeeze streams.
Unmodified `djxl` must recover every source byte before a fixture is saved.

Run `node benchmark/jpegxl/generate-global-modular-fixtures.ts` with the existing
pinned oracle build. The manifest records encoder options, source and codestream
hashes, and the decoded raster hash. References use gzip for repository storage.

Node and browser checks require exact native samples for full images, crops
across group boundaries and partial edge groups. Palette decoding retains group
bands. Squeeze decoding uses compact full-frame planes and reports that fallback.
These four fixtures do not qualify every combination of global transforms,
channel layouts and predictors.
