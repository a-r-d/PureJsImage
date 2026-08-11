# Scientific Raster Explorer demo data

The committed GSF, ENVI, and FITS files in this directory are deterministic synthetic fixtures. They do
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
- Spectral axis: 16 nonuniform channel centers from 450 to 910 nm with deterministic material-like absorption curves
- Header SHA-256: `7df267bb54ee07e4b85e86af876bab5b391651c911e21432ae79d2cd1304c6f2`
- Binary SHA-256: `7247ddce5508856f417ca46333ab5f13ed4eaee5ccda52de83490db46c2e5881`

## `synthetic-cube.fits`

- Format source: [NASA/GSFC FITS Standard](https://fits.gsfc.nasa.gov/fits_standard.html)
- Geometry: 128 × 96 × 3 signed int16 stored samples
- Physical scaling: `BSCALE = 0.25`, `BZERO = 100`
- Storage: primary image array with big-endian samples and 2880-byte header/data alignment
- SHA-256: `796a0ae06ee02463bee6fecab8ea0a51be32df5001f0d3ddc077c497b2a03993`

Regenerate all fixtures from the repository root:

```sh
npm run demo:scientific:generate
```

The generator is `scripts/generate-scientific-demo-data.ts`. Reviewers can compare regenerated
bytes directly with the committed files; no network access is used.
