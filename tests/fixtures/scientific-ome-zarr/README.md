# OME-Zarr fixture provenance

These files are test-only and are excluded from the published npm package. They remain under their
upstream licenses; inclusion here does not relicense them under PureJsImage's MIT license.
[`corpus.json`](corpus.json) records the source URL, license, SHA-256, and expected oracle.

The pinned slices are the coarsest resolution of IDR image 6001240 (idr0062) in the public
OME-NGFF 0.4 and 0.5 conversions. The two encodings of the same plane must decode to identical
uint16 samples. No third-party parser is used at runtime.
