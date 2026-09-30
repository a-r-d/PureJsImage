# JPEG XL transform fixtures

These 513 by 259 RGB fixtures exercise legal VarDCT strategies 8, 9 and 21 through
26. The manifest pins every codestream and its independent RGB reference raster.
The raster files use gzip only for repository storage.

Run `node benchmark/jpegxl/generate-transform-gap-fixtures.ts` after preparing
the pinned libjxl 0.12.0 oracle build at commit `8cb67e2`. The generator makes a
temporary encoder that forces one legal transform strategy, keeping ordinary
DCT8 blocks at partial edges. It compiles and links separate development artifacts
under `.tmp`, leaving the pinned encoder, decoder and libraries unchanged.
Unmodified `djxl` produces every reference. The source, temporary encoder source
and first-party input hashes are recorded in the manifest.

Full images and crops must stay within one RGB8 sample and RMSE 0.55 of the
independent decoder. These fixtures qualify decoding only. They do not expand
the forward writer's transform selection or prove complete JPEG XL compatibility.
