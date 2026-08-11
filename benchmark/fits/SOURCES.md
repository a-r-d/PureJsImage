# FITS compatibility corpus

`prepare-official-sample.ts` downloads `swp05569slg.fits` from the official NASA/GSFC FITS sample
collection, verifies SHA-256
`89d4634939080e2a10358132d211272f438014b57fa38408ba21e3045e3dcecd`, opens both image HDUs,
and checks the primary image metadata.

Source: <https://fits.gsfc.nasa.gov/nrao_data/samples/image/swp05569slg.fits>

The downloaded third-party file is written to `benchmark/corpus/fits/official/` for manual
compatibility testing. It is not committed and normal tests do not use the network.

Run from the repository root:

```sh
node benchmark/fits/prepare-official-sample.ts
```
