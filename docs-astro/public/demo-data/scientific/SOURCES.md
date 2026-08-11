# Scientific Raster Explorer demo data

The committed GSF and ENVI files in this directory are deterministic synthetic fixtures. They do
not contain or derive from third-party measurements.

## `synthetic-afm.gsf`

- Format source: [Gwyddion Simple Field 1.0 specification](https://gwyddion.net/documentation/user-guide-en/gsf.html)
- Geometry: 128 × 96 float32 height samples
- Physical extent: 12.8 µm × 9.6 µm, stored in the specification's required base unit of metres
- Signal: one Gaussian mound plus deterministic terraces and scan drift
- SHA-256: `9795b050c26f4a6876f12cb4ef02e64047c36674291ef7bb38208a223a377ba1`

## `synthetic-hyperspectral.hdr` + `synthetic-hyperspectral.bin`

- Format source: [ENVI Image Files](https://www.nv5geospatialsoftware.com/docs/ENVIImageFiles.html)
  and [ENVI Header Files](https://www.nv5geospatialsoftware.com/docs/enviheaderfiles.html)
- Geometry: 96 × 64 × 16 bands
- Storage: little-endian uint16, band-interleaved-by-line (BIL)
- Spectral axis: 450–900 nm in 30 nm steps with deterministic material-like absorption curves
- Header SHA-256: `2148c87e43f7f12c0e9acf9cac650dea692a40b157782480a811bd9f4aa2ea71`
- Binary SHA-256: `b5d23e4dff7f1f29f333e9ace224defe3cee2512027a1c0842e36c1cb57e4392`

Regenerate both fixtures from the repository root:

```sh
npm run demo:scientific:generate
```

The generator is `scripts/generate-scientific-demo-data.ts`. Reviewers can compare regenerated
bytes directly with the committed files; no network access is used.
