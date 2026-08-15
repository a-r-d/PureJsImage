# Scientific surface fixture provenance

These files are test-only and are excluded from the published npm package. They remain under their
upstream data/project licenses; inclusion here does not relicense them under PureJsImage's MIT
license. [`corpus.json`](corpus.json) is authoritative and records, for every binary, the exact
source URL and revision, upstream path, SPDX license and pinned license link, attribution,
redistribution rationale, SHA-256, and expected oracle.

The tests compare SXM coordinates and samples to independently converted FAIRmat NXS output, IBW
labels and scaling to AFMReader output, Digital Surf dimensions/calibration to RosettaSciIO, and X3P
values to the OpenFMC examples. No third-party parser code is copied or used at runtime.
