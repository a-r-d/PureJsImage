# OME-Zarr fixture provenance

These files are test-only and are excluded from the published npm package. They remain under their
upstream licenses; inclusion here does not relicense them under PureJsImage's MIT license.
[`corpus.json`](corpus.json) records the source URL, license, SHA-256, and expected oracle.

The pinned slices are:

- the coarsest resolution of IDR image 6001240 (idr0062) in the public OME-NGFF 0.4 and 0.5
  conversions. The two encodings of the same plane must decode to identical uint16 samples.
- the layout-only bioformats2raw 0.5 root of IDR image 14002892 / `BR00109990_C2` (idr0033, CC-BY-4.0)
  plus series `0` metadata and the coarsest `uint16` chunk. Opening the root must discover series `0`
  without `multiscales` on the store root.
- sibling `labels/0` groups on the same IDR 6001240 0.4 and 0.5 stores.
- IDR0010 well `A/1` (0.5 plate well, sharded Blosc/zstd), IDR0001 plate field `C/3/0` (0.4), and
  IDR0101 image 13457537 (0.4 scale+translation).

No third-party parser is used at runtime.
