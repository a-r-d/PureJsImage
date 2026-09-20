# Scalar palette boundary fixtures

These first-party RGB16 images cover a partial horizontal group and a one-pixel-wide vertical image. Each has three sparse channel palettes. Pinned libjxl and jxl-rs reproduce every generated sample exactly. The provenance file records source and output hashes.

The regression test compares current encoder bytes with these independently decoded fixtures and verifies their samples. Regenerate with `benchmark/jpegxl/verify-m7-scalar-boundaries.ts` under the M7 memory guard after building the pinned development oracles. These procedural cases do not count toward real-image compression results.
