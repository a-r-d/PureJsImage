# Committed AVIF fixtures

The five common-photo files are committed because the AVIF unit tests require
them:

- `fox.profile0.8bpc.yuv420.avif`
- `fox.profile0.8bpc.yuv420.monochrome.avif`
- `fox.profile1.8bpc.yuv444.avif`
- `fox.profile2.8bpc.yuv422.avif`
- `kodim03_yuv420_8bpc.avif`

They come from the libavif repository at revision
`25a6d23f872f37c91a3df15b75e1a97f590d7c46` under its BSD-2-Clause license.
Their source paths and SHA-256 checksums are pinned in `benchmark/avif/corpus.ts`.

`ms-mexico-nonstill-sequence.avif` comes from the Imazen AVIF Conformance corpus
at revision `28205bbc5cf40364d012c462240ba28143373d67`, where it is sourced from
`AOMediaCodec/av1-avif`'s Microsoft fixtures. The corpus documents the repository
under BSD-2-Clause and the contained Blender material under CC-BY 3.0. It is
committed to cover an AV1 sequence header with `still_picture=0` whose AVIF item
still contains one shown key frame. Run `npm run fixtures:avif:nonstill-sequence`
to require byte-identical native YUV from PureJsImage, dav1d, and libaom.
The three `diagnostic-*.avif` files come from CC0 GB82 PNG inputs in the Imazen
codec corpus at revision `28205bbc5cf40364d012c462240ba28143373d67`. They pin
the common-photo survey's two terminal entropy-divergence classes without
weakening strict tile termination:

- `diagnostic-baby-ffmpeg-crf30-yuv420.avif` was encoded with FFmpeg/libaom,
  CRF 30, YUV 4:2:0, still-picture mode, and one thread;
- `diagnostic-baby-ffmpeg-crf45-yuv444.avif` used the same encoder with CRF 45
  and YUV 4:4:4; and
- `diagnostic-mc3-sharp-q50-yuv420.avif` was encoded with Sharp 0.35.3,
  libvips 8.18.3, libaom 3.14.1, quality 50, effort 4, and YUV 4:2:0.

Their encoded and agreeing dav1d/libaom native-YUV checksums are pinned in
`benchmark/avif/common-photo-syntax-fixtures.ts`. Run
`npm run fixtures:avif:common-photo-syntax` to require byte-identical visible
YUV from PureJsImage and both independent decoders.

The four `ms-*-picture*.avif`, `ms-Tomsk-with-thumbnails.avif`, and
`ms-bbb-4k.avif` fixtures are byte-identical Microsoft cases from the same
pinned Imazen AVIF Conformance corpus revision. They cover 1280x720 reduced and
full still-picture headers plus a 3840x2160 full-header frame. Before this
increment, their valid AV1 streams surfaced as a symbol overread, missing
trailing-one bit, or nonzero trailing padding because intra-block-copy
transform contexts and reference motion diverged before tile termination.
Encoded and agreeing dav1d/libaom native-YUV checksums are pinned in
`benchmark/avif/still-picture-entropy-fixtures.ts`. Run
`npm run fixtures:avif:still-picture-entropy` to require byte-identical visible
YUV from PureJsImage and both independent decoders.

`draw_points_idat.avif` comes from the same pinned libavif revision. It is
committed for exact luma/chroma palette-mode and non-symmetric color-index
regression coverage; its SHA-256 checksum is pinned in
`benchmark/avif/corpus.ts`.

`colors-animated-8bpc-alpha-exif-xmp.avif` is the byte-identical libavif
animation case from that revision. `colors-animated-12bpc-keyframes-0-2-3.avif`
is the byte-identical valid fixture from the pinned Imazen AVIF Conformance
corpus revision. The files cover explicit selection of independently decodable
color/alpha sync samples while dependent AV1 frames remain unsupported. The
`colors-animated-*-frame*-dav1d.png` oracles were decoded with FFmpeg 7.1.1 and
dav1d 1.5.1; encoded and decoded checksums are pinned in
`benchmark/avif/animation-fixture.ts`.

`blue-and-magenta-crop.avif` also comes from that pinned revision. Its color
item exercises skipped intra-block copy with adaptive motion-vector coding,
and its `clap` property crops the 320x280 coded image to a 180x100 display image.
Its checksum and coded dimensions are pinned in `benchmark/avif/corpus.ts`.

`linku-kimono-crop.avif` is the byte-identical `valid/linku_kimono_crop.avif`
fixture from the pinned Imazen AVIF Conformance corpus revision, sourced from
link-u's CC-BY-SA-4.0 sample set. Its clean aperture has half-integer sample
coordinates and resolves to a 385x330 display region at source sample
coordinate (272, 39). Encoded, PureJsImage, and Sharp/libvips checksums are
pinned in `benchmark/avif/clean-aperture-fixture.ts`.

`ms-monochrome-residual-intrabc.avif` is the byte-identical `valid/ms_Monochrome.avif`
fixture from the same pinned Imazen AVIF Conformance corpus revision and Microsoft
fixture source described above. It is covered by the same BSD-2-Clause and CC-BY
3.0 provenance. Its 1280x720 AV1 frame exercises non-skipped intra-block copy with
transform partitions, transform-type signaling, coefficients, and residual
reconstruction.

`ibc-deltaq-512x128.avif` is a deterministic opaque 8-bit YUV 4:4:4 fixture
encoded with libaom 3.12.1 from a repeated mixed-complexity screen-content
source. It combines skipped intra-block copy with block delta-Q changes across
superblocks. Run `npm run fixtures:avif:intrabc` to require byte-identical
native YUV from PureJsImage, dav1d, and libaom for all three committed
intra-block-copy fixtures.

The five `post-filter-*.avif` files are deterministic, opaque 8-bit YUV 4:2:0
fixtures encoded with libavif 1.3.0 and libaom 3.12.1. They isolate disabled
filters, deblocking, luma/chroma CDEF, Wiener plus self-guided restoration, odd
frame dimensions, frame edges, and multiple restoration units. Their encoded
and decoded YUV checksums are pinned in
`benchmark/avif/post-filter-fixtures.ts`.

Run `npm run fixtures:avif:post-filters` to decode every targeted fixture with
PureJsImage, dav1d, and libaom through FFmpeg. The required numeric tolerance is
zero: all three visible Y, U, and V planes must match byte for byte. The script
also verifies that the two independent decoders agree before accepting the
PureJsImage result.

The five `sharp-qmatrix-*.avif` files are deterministic opaque 8-bit YUV 4:2:0
textured graphics generated by the pinned Sharp 0.35.3/libaom development
oracle at its default AVIF q30, q50, q65, q80, and q90 settings. Every fixture
signals quantization matrices and block delta-Q. Run
`npm run fixtures:avif:qmatrix` to require exact dav1d/libaom agreement, then
compare PureJsImage's visible YUV planes with a maximum sample error of 3 and
PSNR of at least 55 dB. `npm run fixtures:avif:qmatrix:prepare` regenerates the
encoded fixtures and rejects byte-level drift from the pinned checksums.

`rav1e-segmentation-q60-512x512.avif` is the 512x512 normalized synthetic-product
source `9701` from the Imazen `imazen-26` K300 subset, encoded by libavif 1.3.0
with rav1e 0.7.1 at q60, speed 6, one worker, 8-bit YUV 4:2:0. It exercises four
spatial segment IDs carrying alternate-quantizer deltas and the reduced
transform set. The source URL plus raw, normalized, encoded, native-YUV, and
RGBA checksums are pinned in `benchmark/avif/segmentation-fixture.ts`. Run
`npm run fixtures:avif:segmentation` to require byte-identical visible YUV from
PureJsImage, dav1d, and libaom.

`svt-skipped-intra-tx-size-512x512.avif` uses the same normalized Imazen source
`9701`, encoded by libavif 1.3.0 with SVT-AV1 2.3.0 at q60, speed 8, one worker,
and 8-bit YUV 4:2:0. Its first skipped 64x64 intra block exercises the required
transform-depth symbol when transform-size selection is enabled. It is included
in `npm run fixtures:avif:still-picture-entropy`, which requires byte-identical visible
YUV from PureJsImage, dav1d, and libaom.

The `alpha-*.avif` files are deterministic 64x48 YUV 4:4:4 color plus
full-range monochrome alpha fixtures encoded with libavif 1.3.0 and libaom
3.12.1. They cover straight-alpha and premultiplied-alpha item relationships.
Run `npm run fixtures:avif:alpha:prepare` to regenerate them from the
deterministic RGBA source with one encoder worker and reject byte-level drift.
The encoded and decoded RGBA checksums are pinned in
`benchmark/avif/alpha-fixtures.ts`.
The `lossy-q0-64x48.avif` and `lossless-q0-64x48.avif` fixtures are deterministic
full-range YUV 4:4:4 images encoded with libavif 1.3.0 and libaom 3.12.1. They
cover base-quantizer context 0, lossless 4x4 Walsh-Hadamard transforms,
partition-edge chroma prediction, and container-signaled matrix conversion,
including the identity transform. Run `npm run fixtures:avif:q0:prepare` to
regenerate them from the deterministic RGB source and reject byte-level drift.
The encoded and decoded RGBA checksums are pinned in
`benchmark/avif/q0-fixtures.ts`; lossless decoded RGB must match the source
exactly.

`bounded-row-lossless-64x192.avif` is a deterministic full-range YUV 4:4:4
fixture spanning three 64-row superblock bands. It pins byte-exact output from
the filter-free two-superblock reconstruction and context rings. Run
`npm run fixtures:avif:rows:prepare` to regenerate it with libavif 1.3.0 and
libaom 3.12.1 from the checksum-pinned RGB source; encoded, source PNG, and
decoded RGBA checksums are recorded in `benchmark/avif/row-fixture.ts`.

`bounded-row-alpha-lossless-64x192.avif` is the aligned-alpha counterpart. Its
filter-free color and monochrome alpha items span the same three superblock
bands so the decoder can synchronize two bounded row rings without retaining
either full plane set. Run `npm run fixtures:avif:rows:alpha:prepare` to
regenerate it; encoded, source PNG, and Sharp/PureJsImage RGBA checksums are
pinned in `benchmark/avif/row-alpha-fixture.ts`.

The `lossless-identity-16x12-10bpc.avif` and
`lossless-identity-16x12-12bpc.avif` fixtures are deterministic full-range YUV
4:4:4 images encoded with libavif 1.3.0 and libaom 3.12.1. They cover native
high-bit-depth prediction and coded-lossless coefficient reconstruction before
conversion to the library's 8-bit RGBA output contract. Run
`npm run fixtures:avif:high-bit:prepare` to regenerate them from checksum-pinned
Y4M sources with one encoder worker. Encoded, source, Sharp RGB, and decoded
RGBA checksums are pinned in `benchmark/avif/high-bit-lossless-fixtures.ts`.

The `high-bit-expanded-fixtures.ts` set covers coded-lossless 10-bit and 12-bit
YUV 4:2:0; filter-free lossy 10-bit and 12-bit YUV 4:2:0, 4:2:2, and 4:4:4;
lossy 10-bit YUV 4:2:0 and 4:2:2 with deblocking, CDEF, and Wiener restoration;
limited-range lossy 10-bit YUV 4:2:0 with self-guided restoration; lossy 10-bit
YUV 4:4:4 with deblocking, CDEF, and Wiener restoration; lossy 10-bit YUV 4:4:4
with deblocking and self-guided restoration; lossy 12-bit YUV 4:2:0 with
deblocking, CDEF, and Wiener or self-guided restoration; and lossy 12-bit YUV
4:2:0, 4:2:2, and 4:4:4 with deblocking and CDEF. These fixtures exercise
normative depth-specific dequantization and post-filter arithmetic while
retaining native high-depth samples through reconstruction and filtering.
`npm run fixtures:avif:high-bit:prepare` regenerates them with libavif 1.3.0,
libaom 3.12.1, and FFmpeg 7.1.1 from checksum-pinned Y4M sources.
`npm run fixtures:avif:high-bit` requires PureJsImage, dav1d, and libaom to
produce byte-identical native YUV, then pins Sharp and portable RGBA output for
the expanded filtered cases. Encoded, source, native-YUV, and RGBA checksums are
pinned in `benchmark/avif/high-bit-expanded-fixtures.ts`; detailed oracle
results are recorded in
`benchmark/results/avif-high-bit-post-filters-2026-08-09.md`.

`unsupported-hdr-pq-10bpc-yuv420-32x24.avif` and
`unsupported-hdr-hlg-10bpc-yuv420-32x24.avif` retain their historical fixture
names. They use the same checksum-pinned 10-bit YUV 4:2:0 source with BT.2020
primaries and matrix coefficients plus SMPTE ST 2084 or HLG transfer signaling.
They now exercise direct HDR-to-SDR decode, but are not numeric tone-map
oracles because decoder and zimg chroma reconstruction differ at their
artificial saturated boundaries.

`libavif-colors-hdr-p3.avif` and
`libavif-cosmos1650-yuv444-10bpc-p3pq.avif` are byte-identical valid files from
the pinned Imazen AVIF Conformance corpus revision. They cover Display-P3 PQ
with conventional and chroma-derived non-constant-luminance matrices.
`identity-pq-10bpc-yuv444-16x12.avif` is a deterministic full-range 10-bit YUV
4:4:4 fixture encoded with libavif 1.3.0 for Rec.2020 PQ identity color. Its
input is first converted losslessly with libavif; the three
`oracle-*-ffmpeg-reinhard.png` PQ oracles use FFmpeg 7.1.1/zimg conversion to
linear RGB at 203-nit reference white, Reinhard tone mapping with desaturation
disabled, and full-range sRGB output.

`ms-chimera-hdr-matrix10-1920x1008.avif` is the byte-identical
`ms_Chimera_10bit_cropped_to_1920x1008_with_HDR_metadata.avif` file from the
pinned Imazen AVIF Conformance corpus revision (SHA-256
`b52996d7dc8bde2145770fc1977ccd45e7faf78c561599f325b48669d5ff6aee`).
It covers full-range 10-bit YUV 4:2:0 with Rec.2020 primaries, PQ transfer,
constant-luminance matrix coefficients 10, and a clean-aperture crop from
1920x1080 to 1920x1008. The color verifier extracts native YUV with
libavif 1.3.0/dav1d 1.5.1 and independently applies the Rec.2020
constant-luminance equations documented by Colour's `YcCbcCrc_to_RGB`
implementation. Twelve spatially distributed RGB samples agree within one
8-bit code value, and the full displayed RGBA output is checksum-pinned.


`hdr-hlg-10bpc-yuv444-32x24.avif` is a deterministic full-range 10-bit YUV
4:4:4 Rec.2020 HLG fixture encoded with libavif 1.3.0. FFmpeg/zimg's HLG
transfer path applies a componentwise display exponent rather than BT.2100's
shared scene-luminance OOTF, so it is not used as a numeric oracle. The test
suite checks independent analytic neutral and saturated BT.2100 vectors and
pins the fixture's end-to-end RGBA hash in Node.js, Chromium, and Firefox.
Checksums and the exact evidence boundaries are recorded in
`benchmark/avif/color-fixtures.ts` and `tests/avif.test.ts`.

`xiph-tiger-3layer-lsel0-1216x832.avif` is a restricted-layer derivative of
Xiph's `tiger_3layer_1res.avif` from the AOMedia AVIF conformance suite
(original SHA-256
`46cb55301f5d4a36a72c8c00f1d7e10c6c9ae0297811dc0f38a26a0285daa316`).
The fixture changes `lsel` from `0xFFFF` to spatial layer 0 and records the
first two `a1lx` entries as the individual 8,299-byte and 13,754-byte layer
sizes required by AVIF 1.2. It retains all three AV1 frame OBUs. The Xiph
source is CC-BY-SA 3.0 / CC-BY 3.0, as documented by the suite; this derivative
remains under the applicable source license rather than the repository's MIT
license. `npm run fixtures:avif:layered` requires PureJsImage, dav1d, and
libaom to agree byte for byte on the selected layer's native YUV.

`tiled-lossless-10bpc-yuv444-2x2-256x256.avif` is a deterministic full-range
10-bit YUV 4:4:4 image split into four AV1 tiles. It covers independent entropy
and context initialization plus prediction boundaries at both tile columns and
rows. Run `npm run fixtures:avif:tiles:prepare` to regenerate it from the
checksum-pinned Y4M source. Run `npm run fixtures:avif:tiles` to require
PureJsImage, dav1d, and libaom to reconstruct identical native YUV samples.
Checksums are pinned in `benchmark/avif/tiled-lossless-fixture.ts`.

`libaom-lossy-multitile-yuv420-256x256.avif` is a deterministic limited-range
8-bit YUV 4:2:0 image split into a 2x2 AV1 tile layout. It exercises independent
tile entropy and prediction state followed by one full-frame deblocking, CDEF,
and loop-restoration pipeline. `npm run fixtures:avif:tiles:prepare` regenerates
it with libaom 3.12.1 and FFmpeg 7.1.1 from its checksum-pinned Y4M source.
`npm run fixtures:avif:tiles` requires PureJsImage, dav1d, and libaom to produce
byte-identical native YUV. Checksums are pinned in
`benchmark/avif/lossy-multitile-fixture.ts`.

`libaom-full-header-tile-groups-yuv420-256x256.avif` uses the same pinned source
with a non-reduced shown key-frame header and four separate tile-group OBUs.
Deblocking remains enabled while CDEF and restoration are disabled so the
fixture isolates frame-header and tile-group assembly. The same
`fixtures:avif:tiles:prepare` and `fixtures:avif:tiles` commands regenerate it
and require byte-identical PureJsImage, dav1d, and libaom native YUV. Checksums
are pinned in `benchmark/avif/lossy-multitile-fixture.ts`.

`libavif-bounded-filtered-yuv420-3840x2160.avif` is a deterministic
limited-range 8-bit YUV 4:2:0 image split into an 8x2 AV1 tile layout with
deblocking and CDEF enabled. It pins the large filtered fallback while ensuring
each sequential tile decoder retains only its tile-local entropy and context
state. `npm run fixtures:avif:tiles:prepare` regenerates it with libavif 1.3.0
and libaom 3.12.1 from a checksum-pinned gradient Y4M source.
`npm run fixtures:avif:tiles` requires PureJsImage, dav1d, and libaom to produce
byte-identical native YUV, and its ordered RGBA output is pinned in Node.js and
Chromium. `benchmark/results/avif-memory-bounded-filtered-2026-08-10.json`
records three isolated cold-process memory runs.

`libaom-superres-denom12-96x64.avif`,
`libaom-superres-denom12-yuv420-96x64.avif`, and
`libaom-superres-denom12-yuv420-320x192.avif` are deterministic full-range
8-bit YUV 4:4:4 and YUV 4:2:0 frames whose AV1 payloads reconstruct at a
denominator-12 coded width before normative super-resolution expands luma and
chroma to their displayed widths. The 320x192 fixture crosses a 128-row
reconstruction-band boundary and pins the retained 4:2:0 chroma halo. Their AV1
headers explicitly disable deblocking deltas; CDEF and restoration are also
disabled so the fixtures isolate the eight-tap horizontal upscaler.
`libaom-filtered-superres-denom12-yuv420-320x192.avif` reconstructs at 213x192,
then exercises CDEF, denominator-12 super-resolution, and Wiener restoration in
their normative order. Run `npm run fixtures:avif:superres:prepare` to regenerate
all four fixtures with libaom 3.12.1, then `npm run fixtures:avif:superres` to
require PureJsImage, dav1d, and libaom to produce byte-identical native YUV.
Checksums are pinned in `benchmark/avif/superres-fixture.ts`.

`film-grain-test1-yuv420-64x48.avif` is a deterministic full-range 8-bit YUV
4:2:0 key frame encoded with libaom's film-grain test vector 1. Run
`npm run fixtures:avif:film-grain:prepare` to regenerate it from the
checksum-pinned gradient PNG. `npm run fixtures:avif:film-grain` requires
PureJsImage, dav1d, and libaom to synthesize byte-identical native YUV; portable
RGBA remains within 2 channel values of both native decoders.

`tiger-3layer-3res.avif` is Chromium's checksum-pinned 1216x832 static
progressive AVIF fixture. Its three spatial layers are a shown key frame
followed by two dependent shown inter frames. PureJsImage validates its
`a1lx` layer boundaries and classifies the dependency before explicitly
rejecting the still-unsupported inter-frame reconstruction path. The source
URL and revision are pinned in `benchmark/avif/dependent-layer-fixture.ts`.

`tiger-3layer-3res-lsel0.avif` derives from that pinned source by adding an
essential `lsel=0` property and matching 304x208 `ispe` dimensions. Its shown
key frame overrides the 1216x832 sequence maximum and carries 1216x832 AV1
render dimensions, which AVIF does not expose. Run
`npm run fixtures:avif:layered:prepare` to regenerate the container and
`npm run fixtures:avif:layered` to require byte-identical native YUV from
PureJsImage, dav1d, and libaom.

`clean-aperture-lossless-16x12.avif` is a deterministic full-range,
identity-color YUV 4:4:4 fixture encoded with libavif 1.3.0 and libaom 3.12.1.
Its integer `clap` property crops the 16x12 coded image to the 8x6 rectangle at
`x=3, y=2`. Run `npm run fixtures:avif:clean-aperture:prepare` to regenerate it
from the checksum-pinned PNG source with one encoder worker and require Sharp
to produce the pinned cropped RGBA output. Encoded, source, Sharp, and decoded
checksums are pinned in `benchmark/avif/clean-aperture-fixture.ts`.

`libavif-imir-axis0-160x160.avif`, `libavif-imir-axis1-160x160.avif`, and
`libavif-imir-clap-irot-grid-alpha-160x160.avif` are deterministic full-range,
identity-color YUV 4:4:4 fixtures encoded with libavif 1.3.0 and libaom 3.12.1.
The first two isolate top-to-bottom and left-to-right `imir` axes. The third
combines a 2x2 color grid, alpha auxiliary grid, integer `clap`, `irot=1`, and
`imir=1`. Run `npm run fixtures:avif:imir:prepare` to regenerate them from
checksum-pinned PNG sources and `npm run fixtures:avif:imir` to compare
PureJsImage with dav1d, libaom, and Sharp. The focused Chromium workflow pins
both portable and native-browser results. Checksums and observed oracle behavior
are recorded in `benchmark/avif/mirror-fixtures.ts` and
`benchmark/results/avif-imir-2026-08-09.md`.

`sofa_grid1x5_420.avif` comes from the pinned libavif corpus revision documented
in `benchmark/avif/corpus.ts`. It covers a 1x5 image grid whose final tile and
display height exercise cropped edge-tile composition.

`npm run bench:avif:memory` generates deterministic 1024x768 no-filter,
deblock, alpha, and 2x2-grid cases in a temporary directory and combines them
with the permanent Kodak, Fox, 3840x2160 8x2-tile, and resampled gain-map-grid fixtures for CDEF,
restoration, bounded filtered multi-tile decode, gain-map composition, and downscale measurements. It
runs each case in three isolated cold Node.js processes and rejects any
encoded-input or decoded-output checksum drift. The command requires `avifenc`
1.3.0 with libaom 3.12.1 to reproduce the recorded memory evidence.

The five `libavif-*-color*`, `libavif-paris-*`, and `libavif-seine-*` color
fixtures are byte-identical files from the Imazen AVIF Conformance corpus at
revision `28205bbc5cf40364d012c462240ba28143373d67`, sourced from libavif's
BSD-2-Clause test corpus. They cover linear BT.2020 NCLX conversion, compatible
RGB matrix/TRC ICC conversion, ISO 21496-1 HDR gain-map application to an sRGB
SDR alternate, and the `altr` preference rule that makes a swapped-order `tmap`
inactive. Run `npm run fixtures:avif:color` to check encoded and decoded
checksums, exact ICC agreement with Sharp/libvips, BT.2020 agreement with
FFmpeg/zimg (maximum channel error 13, mean error at most 0.5), SDR gain-map
agreement with libavif 1.3.0 (maximum channel error 4, mean error at most 1),
and rejection of the non-preferred gain map.

The four `libavif_*gainmap*.avif` fixtures are byte-identical files from the same
Imazen/libavif corpus revision. They independently vary color grids, alpha grids,
gain-map grids, and gain-map dimensions. `npm run fixtures:avif:alpha` pins the
portable RGBA output and compares SDR tone mapping with libavif 1.3.0. The
single-image paths stay within 5 channel values of libavif; grid seams can have
larger isolated errors, so those cases additionally require mean channel error
at most 1.35 and RGB PSNR of at least 39 dB.

The remaining benchmark corpus is intentionally ignored and can be prepared with
`npm run fixtures:avif`.
