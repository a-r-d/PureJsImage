# Independent progressive stages

These outputs come from the pinned libjxl 0.12.0 public C decoder through
`benchmark/jpegxl/flush-progressive-oracle.ts`. They correspond to the existing
CC0 `rgb8-distance2-progressive.jxl` generated corpus input. Each flush is a
complete DC or pass stage, not a resized final image. The manifest records
source, library, input and output hashes and intended downsampling boundaries.
