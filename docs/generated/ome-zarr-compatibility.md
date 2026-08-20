# OME-Zarr public compatibility evidence

- Generated: 2026-08-20T20:36:20.258Z
- Runtime: v24.16.0 on linux/x64
- Corpus: `benchmark/ome-zarr/official-corpus.json`
- Results: 8 supported stores passed; expected non-PASS boundary entries: 1; unexpected classifications: 0

This is a bounded external interoperability snapshot, not a claim of complete Zarr v3, hierarchy,
or pixel-data conformance. Each run reads only small selections from the pinned public roots.

| Sample | Actual | Expected | Root identity evidence | Observed surfaces | Metadata warnings |
| --- | --- | --- | --- | --- | --- |
| idr0062-v0.4-image | PASS | PASS | .zgroup; 24 bytes; etag | ome-ngff-0.4-zarr-v2, regular-chunks, multidimensional-z, multiple-channels-omero, image-labels | none |
| idr0062-v0.5-image-labels | PASS | PASS | zarr.json; 1243 bytes; etag | ome-ngff-0.5-zarr-v3, regular-chunks, sharding-indexed, multidimensional-z, multiple-channels-omero, image-labels | none |
| idr0044-v0.4-time-series | PASS | PASS | .zgroup; 23 bytes; etag | ome-ngff-0.4-zarr-v2, regular-chunks, multidimensional-z, multidimensional-t, multiple-channels-omero | none |
| idr0010-v0.5-hcs-well-field | PASS | PASS | zarr.json; 120 bytes; etag | ome-ngff-0.5-zarr-v3, sharding-indexed, multiple-channels-omero, hcs-plate-well-field | none |
| ome2024-6001240 | PASS | PASS | zarr.json; 2787 bytes; etag | ome-ngff-0.5-zarr-v3, sharding-indexed, multidimensional-z, multiple-channels-omero | none |
| ome2024-jax-41028 | PASS | PASS | zarr.json; 215 bytes; etag | ome-ngff-0.5-zarr-v3, sharding-indexed, multiple-channels-omero, bioformats2raw-series | none |
| bia-s-bsst410-im1 | PASS | PASS | .zgroup; 23 bytes; etag | ome-ngff-0.4-zarr-v2, regular-chunks, multidimensional-z, multiple-channels-omero | none |
| sanger-fetal-spleen-visium-1 | UNSUPPORTED_METADATA | UNSUPPORTED_METADATA | .zgroup; 23 bytes; etag | not available | none |
| ssbd-fib-sem-synapse | PASS | PASS | .zgroup; 23 bytes; etag | ome-ngff-0.4-zarr-v2, regular-chunks | none |
