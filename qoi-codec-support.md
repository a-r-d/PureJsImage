<!-- Generated from capabilities/manifest.json by npm run capabilities:generate. Do not edit directly. -->
# QOI codec support

This document defines the implemented boundary of the first-party QOI codec.

## Decode

- [x] QOI Specification v1 header and end marker
- [x] Three-channel RGB and four-channel RGBA files
- [x] sRGB with linear alpha and all-channels-linear colorspace fields
- [x] `QOI_OP_INDEX`
- [x] `QOI_OP_DIFF`
- [x] `QOI_OP_LUMA`
- [x] `QOI_OP_RUN`, including the maximum legal run
- [x] `QOI_OP_RGB`
- [x] `QOI_OP_RGBA`
- [x] Sequential bounded-row output

## Encode

- [x] Deterministic RGB and RGBA output
- [x] Every QOI chunk operation
- [x] Explicit channel and colorspace selection

## Validation

- [x] Dimension and decoded-byte allocation limits
- [x] Exact pixel-count and end-marker validation
- [x] Truncated header, chunk, and marker rejection
- [x] Official MIT QOI reference encoder interoperability fixture
- [x] Independently encoded CC0 benchmark images
