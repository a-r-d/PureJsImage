# PureJsImage benchmark suite

This suite is the performance and workflow-success contract for PureJsImage.
Jimp 1.6.0 remains the original Lambda baseline. The broader competitor profile
also pins Sharp 0.35.3, image-js 1.7.0, and jSquash's JPEG 1.6.0, PNG 3.1.1,
WebP 1.5.0, and resize 2.1.1 packages.
The profile treats the default pure-JavaScript implementation and the explicitly registered
first-party JPEG/PNG WASM accelerators as separate PureJsImage engines. HEIF/HEIC measurements use
another explicit `purejsimage-experimental-heic` engine; the default engine never registers it.

## Authoritative inventories and generated metrics

The repository keeps current support, package entry, and measurement claims in separate sources:

* `capabilities/manifest.json` is the authoritative codec capability contract. Stable ordinary
  codec tables, experimental HEIF/HEIC documentation, public capability JSON, and generated
  compatibility expectations come from `npm run capabilities:generate`.
* The manifest's `scientificReaders` inventory, matching `package.json` exports, and
  `src/scientific/readers/all.ts` define the complete scientific reader package surface. A reader
  is not counted by documentation until those surfaces agree and its generated bundle target is
  measured.
* `scripts/bundle-size-budgets.ts` stores the recorded baselines and minified-JavaScript ceilings.
  `scripts/bundle-size-config.ts` builds the target list from the manifest and package surface;
  it is not a second reader or codec inventory.
* `benchmark/generated/package-metrics.json` is the deterministic current measurement artifact.
  `docs-astro/src/data/package-metrics.json` is its checked-in site copy. Both include minified,
  gzip, Brotli, raw WASM where applicable, npm package (unpacked) bytes after extraction,
  production package count, package and dependency versions, and implementation class. The npm
  package (unpacked) value is not the compressed `.tgz` download size; run `npm pack --dry-run
  --json` to see both values. They intentionally contain no timestamps or absolute paths.
* Dated files under `benchmark/results/` remain historical benchmark snapshots. They are not
  rewritten by package-metrics generation; rerun the relevant benchmark before changing a dated
  timing, quality, or memory claim.

Run `npm run size` to rebuild the package, refresh the current metrics, and regenerate the README
size and reader blocks. `npm run size:check` measures the current targets without writing, while
`npm run package-metrics:check` checks the committed JSON and README surfaces without running the
performance benchmark suite.

## Principles

* Benchmark complete decode-transform-encode workloads, not isolated pixel
  loops.
* Require a valid output before treating a timing as successful.
* Keep input bytes identical across engines.
* Record wall time, CPU time, output size, absolute peak RSS, peak RSS delta,
  and premultiplied-RGBA PSNR where the workflow defines a quality reference.
* Run each measured sample in an isolated process after an optional untimed
  warmup. A measured process loads exactly one engine.
* Keep real photographs, standards fixtures, transparent graphics, pathological
  dimensions, and high-entropy images in the corpus.
* Classify every engine/workflow pair as pass, unsupported, invalid output, or
  error. Unsupported and invalid output never contribute timing results.
* Keep startup/import measurements separate from warm workflow timings.
* Build and decode the exact-area quality reference after measurement, outside
  both wall timing and peak-RSS sampling.

## Corpus

`corpus/manifest.json` records every downloaded image's source, license,
expected dimensions, and SHA-256 hash. Downloaded and generated binaries live
under `corpus/files/` and are normally ignored by Git. Small permanent codec
regressions such as the ICO corpus are committed explicitly.

Prepare and verify them with:

```sh
npm run fixtures:prepare
npm run fixtures:verify
```

The preparation script generates synthetic fixtures deterministically. It only
downloads files that are missing or fail verification.

The WebP corpus adds six independently encoded files from the official Google
WebP galleries and Wikimedia Commons. It covers two ordinary lossy photographs,
a larger 1600x2000 photograph, two lossless alpha graphics with odd dimensions,
and a lossy image with a compressed alpha plane. Reference pixel samples are
pinned for decoder workflows in addition to dimensions and container hashes.

The BMP corpus pins 14 public-domain files from BMP Suite 2.8. They cover OS/2,
Windows v3 and v5 headers, 1/4/8-bit palettes, RLE4/RLE8, top-down storage,
odd-width row padding, RGB555/RGB565, 24-bit pixels, reordered 32-bit
bitfields, and explicit alpha. A deterministic 4000x3000 24-bit BMP provides
the large Lambda memory workload. Reference-image pixels are pinned for codec
correctness.

The TIFF corpus pins seven fixtures from LibTIFF 4.7.1 and adds deterministic
4000x3000 8-bit RGB, planar 8-bit CMYK, stripped 8-bit CIELab, stripped
`FillOrder=2` packed 6-bit grayscale, stripped 16-bit RGB BigTIFF, and stripped
plus padded-edge tiled packed 12-bit RGB images. It covers both byte orders,
chunky and planar layouts, RGB, grayscale, bi-level, palette, alpha, CIELab,
CMYK, 6-/8-/12-/16-bit samples, both fill orders, BigTIFF, uncompressed,
PackBits, Deflate, and LZW data.
Isolated metadata, full raw decode, region raw decode, resize, PNG encode,
and TIFF encode workflows record median and p95 wall time, absolute and delta
RSS, external and ArrayBuffer memory, source bytes read, and maximum decoded
block size. The large RGB, packed 12-bit, 16-bit BigTIFF, planar CMYK,
CIELab, packed `FillOrder=2`, and 7795x3122 single-strip LZW cases establish
the decode and Lambda-memory baselines.

`npm run fixtures:tiff:encode` generates RGB and RGBA output through the
canonical TIFF encoder, then uses ImageMagick/LibTIFF to reopen both files and
compare exact raw pixels. The report also checks Classic TIFF byte order,
Deflate compression, horizontal prediction, sample counts, and multi-strip
geometry in `benchmark/results/tiff-encode-compatibility.{json,md}`.

`npm run bench:zstd -- --runs 9 --warmups 2` measures the standalone
first-party Zstandard decoder against a committed independently generated
multi-block compressed fixture. It validates the exact decoded SHA-256 and
records median and p95 time, throughput, process memory, and minified,
gzip, and Brotli browser bundle sizes in
`benchmark/results/zstd-standalone.{json,md}`.

The HEIF corpus pins three original 4032x3024 iPhone 12 Pro HEIC camera files.
All three are 48-tile HEVC Main Still Picture grids with 8-bit YUV 4:2:0,
orientation metadata, WPP, scaling lists, SAO, and CU QP deltas. The profile
checks metadata, full HEIC-to-PNG decode, auto-oriented HEIC-to-JPEG resize, and
an oriented crop-resize workflow. Pixel samples are pinned from an independent
ImageMagick/libheif decode with narrow documented tolerances.

The JPEG compatibility corpus adds an Apple iPhone gain-map image, libultrahdr
ICC and ordinary JPEG fixtures, and Web Platform Tests' progressive Squoosh
MozJPEG RGB and YUV outputs. The dedicated verifier checks MPF image count,
color-space and sampling classification, SDR-primary decoding, ICC conversion,
and pixels derived from independent ImageMagick/LittleCMS decodes.

The ICO corpus commits three deterministic files covering multi-image
selection, a PNG-backed 256px primary, 24-bit DIB masking, and 32-bit DIB
partial alpha. Exact decoded pixels are pinned and were cross-checked with
ImageMagick. The profile measures metadata, PNG-backed and DIB-backed decode,
favicon resize, alpha flattening, absolute peak RSS, and output correctness.

### Private user-upload corpus

Exercise a local JSONL corpus without copying its images or identifying object
names into this repository:

```sh
npm run corpus:exercise -- /path/to/corpus
```

The corpus directory must contain `manifest.jsonl`; each downloaded image record
must provide `detectedFormat`, `localRelativePath`, `sha256`, and `sizeBytes`.
The runner opens every selected image at frame 0 using the library's default
tolerant JPEG decoding, reads metadata, auto-orients it, resizes inside 256x256
without enlargement, encodes JPEG, and verifies the output metadata. Selecting
frame 0 makes animated inputs exercise their decoder and transform path without
treating the API's explicit-frame requirement as a codec failure. Pass
`tolerantDecoding: false` to a normal library open when strict baseline JPEG
restart validation is required.
It defaults to one image at a time to bound memory. Use `--concurrency N`,
`--limit N`, or `--format jpeg,png` for controlled runs. To use multiple CPU
cores, launch separate processes with `--shard 0/N` through `--shard N-1/N`;
shards are assigned deterministically from each image's SHA-256.

The default report is
`benchmark/results/artifacts/user-corpus-report.json`, an ignored path. Reports
identify failures only by SHA-256, include both affected-record and unique-file
counts, and never include manifest object keys or local image paths. A nonzero
exit status means at least one file failed.

## Running

### Application-platform benchmark

Run the deterministic scientific-application benchmark with:

```sh
npm run bench:application-platform
```

The command writes a new date-stamped `benchmark/results/application-platform-<timestamp>.{json,md}`
pair; pass `-- --output <path>` only when an explicit artifact path is required. The fixture covers
bounded GSF, MRC, and CBF detection and first-tile reads; arbitrary-axis 4D-STEM
selection; first rendered display pixels; a real range-backed Aperio tile without a whole-source
download; source and derived cache accounting; ROI statistics; a calibrated line profile;
thresholding; Gaussian tile sizes; graph validation; provider preparation; and planning.

Every recorded workflow must pass its correctness assertion before its timing is emitted. Cold and
warm samples are labeled separately. The catastrophic timing gate is intentionally generous and is
only intended to detect hangs or orders-of-magnitude regressions. Tile-runtime retained bytes and
planner estimates are bounded cache/working-set evidence, not measurements of process peak RSS.
The report records Node, operating system, architecture, provider, implementation version, range
bytes, and cache metrics so results are not compared across unlike environments without context.

### Scientific-reader source and memory harness

The scientific-reader harness measures the reader path separately from image
decode-transform-encode benchmarks. It uses the complete public reader registry
for late detection, opens companion resources through an instrumented resolver,
and validates descriptors, calibrated axes, raster block layout, sample hashes,
and representative values before reporting timings. Each measured run is an
isolated Node process after an optional untimed warmup.

```sh
npm run bench:scientific:smoke
npm run bench:scientific:baseline
npm run bench:scientific:range
npm run bench:scientific:scaling
npm run bench:scientific:full
```

Smoke covers every public scientific reader with small or generated fixtures.
Baseline adds metadata-only, first-block, full-plane, and deterministic random
region contract workloads. These microfixtures are correctness and startup
tests, not performance claims. Range varies direct-range readers over 0, 5, 25,
and 100 ms of underlying-read latency. Scaling uses explicit reader selection
with deterministic 64-512 MiB NPY, NIfTI, NRRD, MRC, TIFF, and
DigitalMicrograph fixtures. TIFF and 4D-STEM DigitalMicrograph rows execute 20
deterministic selections against one warm open dataset. Full includes the
contract and scaling families plus available local corpus resources.

Scaling rows are eligible for charts only after at least three measured runs,
stable correctness hashes, and less than 10% coefficient of variation for the
recorded first-block, selected-operation, absolute peak RSS, and source-byte
measurements. Noisy and correctness-only rows remain in the artifacts but are
excluded from performance charts.

Reports are written to the ignored
`benchmark/scientific-readers/results/artifacts/scientific-readers/` directory
as date-stamped JSON and Markdown files plus `latest.json`. The JSON schema
records process/module/registry timing, detection/open/enumeration/read/close
stages, absolute RSS and external/ArrayBuffer memory, source requested/returned
and unique bytes, companion resolutions, payload overlap, and correctness
evidence. The report records per-row stability and publication eligibility;
these are reporting gates, not pass/fail performance thresholds.

### Base-versus-candidate hillclimbing

Use the reusable repository skill in `.agents/skills/benchmark-hillclimb/` and the focused runner
when optimizing one existing web-codec or scientific-reader workload:

```sh
npm run bench:hillclimb -- --suite web --workload northstar-photo-pipeline --goal memory --base-ref origin/main
npm run bench:hillclimb -- --suite scientific --workload scaling-tiff-large-warm-regions --goal speed --base-ref origin/main
```

The runner creates a temporary base worktree, builds both revisions with the current Node runtime,
and alternates base and candidate one-sample harness runs. Seven paired trials are used by default.
It compares raw correctness and performance samples, path-independent fixture and
commit-independent environment fingerprints, protected source/output metrics, median, MAD, IQR,
coefficient of variation, and paired deltas. Exploratory JSON and Markdown stay under the ignored
`.tmp/hillclimb/` directory; the runner never changes public snapshots or documentation claims.

Exit code 0 means an accepted improvement or neutral verification, 1 means a correctness or
protected/performance regression, and 2 means the comparison is noisy, incomparable, or invalid.

### Direct scientific JavaScript and WebAssembly competitors

The direct-reader scorecard is intentionally separate from the image
codec comparison. It uses exact-pinned packages in
`benchmark/competitors-js/package.json` and the checked-in lockfile, so these
competitor packages are benchmark-only and are not part of the published
PureJsImage dependency tree.

Prepare the isolated install and shared fixtures first:

```sh
npm run bench:scientific:competitors:prepare
```

Run the Node scorecard, or the separate Chromium scorecard:

```sh
npm run bench:scientific:competitors:js
npm run bench:scientific:competitors:browser
```

The Node report is written to
`benchmark/scientific-readers/results/artifacts/scientific-competitors/competitors-node.{json,md}`
with separate family reports for TIFF/whole-slide, HDF5/EMD substrate,
medical/volumetric interchange, and lightweight array interchange. Each
engine contract records package version, pure-JavaScript or WebAssembly class,
runtime environment, public input model, selected/lazy-read claim, complete
input copying, claimed workload IDs, and explicit unsupported reasons.

GeoTIFF is measured through its public custom range source for metadata,
selected windows, random whole-slide windows, and BigTIFF. `tiff`, `utif2`,
and `image-js` are complete native TIFF decoders only; no artificial lazy
region path or RGBA conversion is used. `nifti-reader-js` and `npyjs` report
header/full behavior and complete-buffer allocation, while `jsfive` is full
dataset only and `h5wasm` reports WASM initialization, the Emscripten virtual
filesystem copy, HDF5 open/hierarchy/selection, and cleanup as separate
stages. `@itk-wasm/image-io` attempts only its public NIfTI, NRRD, MetaImage,
MRC, and TIFF readers; its Node path records file-backed input and its
browser path records the worker/module bridge and output transfer.

Reports show wall time, first usable data, peak RSS and ArrayBuffer memory,
source requests/bytes, required input copies, native sample hashes, and
installed footprint. Imported JavaScript is measured minified/gzip/Brotli;
required distributed WASM assets are measured raw/gzip/Brotli as well. The
browser report is not averaged with Node results. There is no strong current
Node-focused JavaScript FITS competitor in this scorecard, so `fitsjs` is not
used as a primary scorecard engine; no browser historical comparison is
invented for it.

### Browser-native scientific viewer lane

Browser-native viewers are benchmarked in the separate
`benchmark/viewers/` package and are not mixed into the direct
scientific-reader scorecard. The nested package has an exact lockfile for
`@vivjs/loaders`, `@vivjs/layers`, `@hms-dbmi/viv`, deck.gl/luma.gl,
NiiVue, Cornerstone3D/NIfTI, GeoTIFF, cogeotiff, ITK-Wasm image-io, and
OpenSeadragon. These are benchmark-only dependencies; the published
PureJsImage package keeps its zero-runtime-dependency boundary.

The lane has three explicit paths:

* loader-only: metadata, first native tile, selected Z/C/T plane, and
  deterministic random tiles;
* minimal viewer: a fixed canvas viewport or orthogonal volume slice;
* complete interaction: channel, Z/T, zoom, slice-scroll, window/level, pan,
  cache, and overview transitions where the engine supports them.

OME-TIFF records direct GeoTIFF, Viv loader-only, indexed Viv loader-only, and
full Viv/deck.gl separately. Indexed Viv receives an IFD-offset sidecar
generated before the measured stage; sidecar bytes and generation time are
reported separately. OME-Zarr remains planned work and is not silently
represented by the OME-TIFF rows.

The representative browser fixtures are a shared 512x512x128 NIfTI volume, a
4096x4096 two-channel tiled OME-TIFF, and an 8192x8192 tiled GeoTIFF whose IFD,
GeoTIFF metadata, and tile tables precede the pixel payload. NRRD and MetaImage
endpoints remain available for future exact-support rows, but a viewer is not
counted as equivalent until its exact format path and output are validated.
OpenSeadragon remains unsupported until the same prepared tile endpoint is
available.

Run Chromium cold/warm smoke or an individual family with:

```sh
npm run bench:viewers:smoke
npm run bench:viewers:ome-tiff
npm run bench:viewers:volumes
npm run bench:viewers:cog
npm run bench:viewers:correctness
npm run bench:viewers:charts
```

Set a controlled profile when needed, for example:

```sh
PUREJSIMAGE_VIEWER_LATENCY_MS=25 npm run bench:viewers:smoke
PUREJSIMAGE_VIEWER_CACHE_MODE=revalidate PUREJSIMAGE_VIEWER_THROUGHPUT_BPS=100000 npm run bench:viewers:cog
```

The server provides deterministic HTTP Range request logs, configurable
0/5/25/100 ms latency profiles, cache-control modes, optional throughput
throttling, and aborted-request logging. JSON and Markdown family reports,
request accounting, correctness evidence, and package/dependency/asset
footprints are written under the ignored `benchmark/viewers/results/`
directory. There is deliberately no universal viewer score.

### DigitalMicrograph compatibility corpus

Prepare and verify the pinned DM3/DM4 compatibility files with:

```sh
npm run fixtures:digital-micrograph:prepare
npm run fixtures:digital-micrograph
```

The manifest pins the exact RosettaSciIO revision, upstream GPL-3.0 license, attribution, source
paths, SHA-256 checksums, oracle sample windows, calibration, and expected dataset shapes. The
downloaded binaries remain ignored and are not redistributed in this MIT repository. Verification
requires exact native samples before reporting success and checks that selected regions issue only
the required row reads.

Quick harness validation:

```sh
npm run bench:smoke
```

Common web codec comparison:

```sh
npm run bench:web-codecs
npm run bench:web-codecs:charts
```

The equivalent direct harness command, after `npm run build`, is:

```sh
node benchmark/run.ts --engines purejsimage,purejsimage-wasm,jimp,sharp,sharp-single-thread,image-js,jsquash --profile web-codecs
```

This is the primary common-web profile. It covers JPEG metadata, resize, crop,
orientation, and conversion; transparent and opaque PNG workflows; the
100-megapixel PNG downscale; representative WebP and TIFF conversion; and AVIF
metadata, full decode, resize, and conversion. The AVIF photograph is a
checksum-pinned libavif fixture already used by the codec conformance suite.
An engine is marked unsupported when its public API or installed codec build
cannot express the exact workflow.
`purejsimage` uses the default TypeScript codecs. `purejsimage-wasm` explicitly registers the
published JPEG and PNG scalar/SIMD accelerator providers and retains their normal eligibility and
fallback rules; WebP, TIFF, and AVIF execute through the same TypeScript reference codecs.
`purejsimage-experimental-heic` is reserved for the HEIF profile and directly imports the
experimental codec. It must not be added to the default or competitor engine lists.

Resize workflows use each engine's public default kernel. PureJsImage and Sharp
use Lanczos 3; Jimp uses bilinear. Cross-kernel timings describe each package's
default experience and are not matched-quality speed comparisons. `sharp` uses
its production defaults. `sharp-single-thread` is a separate engine and process
that calls `sharp.concurrency(1)` before processing. image-js uses its normal
public decode, transform, and encode APIs. Its optional Canvas integration is
omitted and is not part of the benchmark dependency tree.

For quality-enabled JPEG and PNG workflows, the harness independently decodes
the pinned input, applies crop and exact-area resize semantics, applies alpha
flattening where requested, and independently decodes each engine's output.
It reports PSNR over premultiplied RGB plus alpha, so invisible RGB values in
fully transparent pixels cannot inflate error. `exact` means every compared
channel matched. The oracle runs only for the first measured sample and after
the timed and peak-RSS regions. This makes quality loss visible alongside speed
and output size without claiming that different lossy quality scales are
calibrated or matched.

jSquash uses its public WebAssembly AVIF, JPEG, PNG, WebP, and resize APIs. The worker
uses jSquash's documented manual Node WASM initialization and a minimal
`ImageData` environment shim; it does not use a Canvas package or modify the
codec implementations. Input conversion happens before timing. Its PNG encoder
does not expose compression-level tuning, so the normal package default is used
and output size remains recorded. Workflows requiring metadata-only inspection,
exact crop coordinates, explicit alpha flattening, BMP, TIFF, or HEIC are
reported as unsupported rather than approximated.

Historical broad ordinary competitor profile:

```sh
npm run bench:competitors
npm run bench:competitors:charts
```

The `competitors` profile remains unchanged for cross-date comparability. It
includes the prior BMP and experimental HEIC rows and does not retroactively add
AVIF. New common-web documentation and charts use `web-codecs`; older
competitor artifacts remain historical evidence.

The current checked-in artifacts are
[`competitors-2026-08-09.md`](results/competitors-2026-08-09.md) and
[`competitors-2026-08-09.json`](results/competitors-2026-08-09.json).
The August 8 artifacts are retained as historical measurements from before
PureJsImage changed its default resize kernel from bilinear to Lanczos 3.

Standard Jimp baseline:

```sh
npm run bench:jimp -- --profile standard
```

JPEG implementation and cross-format regression pass:

```sh
PUREJSIMAGE_ENTRY=./dist/index.js npm run bench -- --engines jimp,purejsimage --profile phase4
```

Verify the pinned JPEG compatibility pixels and run the isolated encoder probe:

```sh
npm run fixtures:jpeg
npm run fixtures:jpeg:prepare # optional reproducibility check; requires pnmtojpeg
npm run bench:jpeg:encode -- 420
npm run bench:jpeg:encode -- 444
npm run bench:jpeg:progressive
```

The generated reference fixtures add 4:4:0, 4:1:1, eight-bit SOF1, sequential component scans,
progressive refinement scans, restart behavior, and explicit RGB coverage. Their generator refuses
output whose SHA-256 differs from the checked-in corpus record.

The progressive encoder benchmark runs baseline, refinement-based progressive, restart-marker,
and progressive-plus-restart output in isolated cold and warm processes. It rejects output that
does not independently decode before reporting runtime, absolute peak RSS, retained coefficient
bytes, output size, and PSNR. The checked-in result is
[`jpeg-progressive-encode-2026-08-09.md`](results/jpeg-progressive-encode-2026-08-09.md).

Run the isolated scaled-IDCT comparison for the pinned 4000x3000 JPEG:

```sh
npm run bench:jpeg:scaled-idct -- --runs 3
```

The 200px, 800px, and 1200px cases exercise native 1/8, 1/4, and 1/2 IDCT
output. Each is compared with the forced full-resolution decoder path and
reports decoded pixels avoided, runtime, absolute peak RSS, MAE, and PSNR. The
checked-in result is
[`jpeg-scaled-idct-2026-08-08.md`](results/jpeg-scaled-idct-2026-08-08.md).

Measure chroma interpolation quality against Sharp/libvips/libjpeg and compare full versus
restart-aware crop decoding in isolated cold and warm workers:

```sh
npm run bench:jpeg:upsampling
npm run bench:jpeg:region-rss
```

The region benchmark uses the same decoded crop for both paths and rejects a hash mismatch before
reporting timing. It records absolute peak RSS, fixed compressed-byte retention, entropy MCUs, and
reconstructed blocks; `full` is the explicit no-region baseline.

Verify the checksum-pinned JPEG 2000 corpus, then run its isolated real-photo
metadata and resize-to-JPEG RSS gates:

```sh
npm run fixtures:jpeg2000
npm run bench:jpeg2000:rss
```

Cross-format and first-frame GIF regression pass:

```sh
PUREJSIMAGE_ENTRY=./dist/index.js npm run bench -- --engines jimp,purejsimage --profile phase5
```

Static WebP decode, transform, and encode profile:

```sh
npm run bench:webp
```

The profile includes reproducible 4000x3000 lossy VP8 and lossless VP8L resize-to-JPEG
pressure fixtures. Both run in isolated processes, require oracle-derived pixel samples to pass,
and report absolute peak RSS so source-height-scaled decode buffers cannot regress unnoticed.

Jimp 1.6.0 does not provide a WebP codec, so this profile is intentionally
PureJsImage-only. Decode results still require independently generated pixel
samples to pass. The profile records absolute time, output size, and memory
without inventing an invalid direct Jimp comparison. Lossy WebP encoder output
is decoded in a separate Sharp/libwebp oracle process after timing and must pass
pinned pixel checks; the native oracle is never loaded into the measured
PureJsImage process.

Ordered spatial transforms ending in JPEG output:

```sh
npm run bench:transforms
npm run bench:transforms:compare
```

This profile measures a 90-degree rotation and downscale, arbitrary-angle
rotation with alpha flattening, crop-after-resize followed by a second resize,
and combined vertical and horizontal reflection. Every result is checked for
the expected dimensions and pinned pixels before its timing is accepted. The
arbitrary-angle workflow is intentionally a PureJsImage absolute baseline:
Jimp uses different canvas sizing and sampling semantics, so its output is not
an equivalent comparison. The comparison command runs the other three
workflows through both engines with the same correctness gates.

Run the real-browser compatibility suite in Chromium, Firefox, and WebKit:

```sh
npm run browser:test
```

Record the Chromium-only browser performance baseline:

```sh
npm run browser:bench
```

PureJsImage and native `createImageBitmap` + `OffscreenCanvas` results are
complete decode-resize-encode pipelines. jSquash JPEG, PNG, and WebP results are
codec-only decode or encode measurements and are deliberately labeled as such.
See `../browser-support.md` for exact engine versions and measurement details.

Verify and benchmark ICO inputs:

```sh
npm run fixtures:ico
npm run bench:ico
```

Jimp 1.6.0 does not decode ICO, so this is a correctness-gated PureJsImage-only
profile rather than an invalid head-to-head timing.

First-party BMP compatibility and performance profile:

```sh
npm run bench:bmp
```

The separate Jimp compatibility baseline is expected to report failures for
formats where its output does not match BMP Suite or it cannot decode the
input:

```sh
npm run bench:bmp:jimp
```

Jimp TIFF decode, transform, and encode baseline:

```sh
npm run bench:tiff:jimp
```

First-party TIFF compatibility and performance profile:

```sh
npm run bench:tiff
```

### Stable-codec baseline

The generated stable-codec profile is driven by the stable, explicit codec entries in
`capabilities/manifest.json`. It covers JPEG, PNG, WebP, BMP, GIF, TIFF, ICO, JPEG 2000, AVIF,
the limited JPEG XL decoder, HDR, QOI, Netpbm (PPM, PFM, and PAM), and TGA. It records cold import,
detection, metadata inspection, full decode, bounded region decode where the decoder advertises it,
conversion to PNG, encode where the manifest permits it, and TIFF encode through a streaming sink.
Major codecs use medium and large fixtures. Lossless rows retain exact output and decoded-pixel
hashes; lossy rows use an independent Sharp/libvips quality oracle after timing. Unsupported encoder
surfaces, missing fixtures, invalid output, unavailable quality oracles, and noisy rows are retained
as explicit non-headline statuses rather than being treated as fast results.

Run it with:

```sh
npm run bench:stable-codecs
npm run bench:results:index
```

Each run writes a new `benchmark/results/stable-codecs-<timestamp>.{json,md}` pair. The result index
also records the ordinary competitor snapshots, specialized codec reports, and scientific-reader
artifacts without replacing older results. The stable profile is intentionally PureJsImage versus
prior PureJsImage results; it is not forced into the ordinary competitor chart, whose six-engine
JPEG/PNG suite remains unchanged. Experimental HEIF/HEIC stays in the separate explicit HEIF profile.

The stable baseline uses only fixtures that exist in the repository. At present, ordinary TIFF
coverage includes uint8/uint16 strips, tiled packed samples, BigTIFF metadata and native-precision
decode, Deflate/LZW/PackBits cases, and encode streaming. There are no committed ordinary float32,
Zstd, LERC, JPEG-in-TIFF, JPEG 2000-in-TIFF, WebP-in-TIFF, or SubIFD pyramid fixtures; those rows
must remain absent or explicitly unrepresented until a checksum-pinned fixture is added. OME-TIFF
and SVS selections belong to `bench:scientific:*` reader workloads, not the ordinary TIFF profile.

`bench:scientific:reference` is intentionally not defined because this checkout has no maintained
Python reference runner. When one is added, its result must use the same date-stamped artifact and
result-index contract.

Prepare the checksum-pinned HEIF compatibility corpus, regenerate its two
first-party transform/profile fixtures, and verify the pinned matrix:

```sh
npm run fixtures:heif:prepare
npm run fixtures:heif
```

Re-run the isolated PureJsImage versus ImageMagick/libheif compatibility and
RSS report:

```sh
npm run report:heif:compatibility
```

The report command requires ImageMagick with its HEIC delegate, FFmpeg, and
`heif-thumbnailer` from libheif. These are development oracles only and are not
package dependencies.

The 2026-08-08 baseline classifies 25 files as 10 compatible, 12 explicitly
unsupported, 1 incorrect-pixels result, and 2 unexpected exceptions. The
largest unsupported cluster is absent or unspecified color-matrix signaling;
see `results/heif-compatibility-2026-08-08.md` for the evidence and next-project
recommendation.

Run the isolated cold and warm HEIF/HEVC pipeline profiles:

```sh
npm run bench:heif:cold
npm run bench:heif:warm
```

These commands select the explicit `purejsimage-experimental-heic` engine. The default PureJsImage
engine does not register HEIF/HEIC, and the pinned Jimp engine has no HEIF decoder, so the results
are correctness-gated experimental baselines rather than a synthetic head-to-head comparison.

The planar PackBits alpha fixture is validated against its source alpha plane,
and the trailing-data Deflate fixture is validated against independent TIFF
decoders. Jimp 1.6.0 decodes both incorrectly, so its baseline reports those
cases as correctness failures while continuing to measure the other workflows.

All Jimp-comparable workflows, including batch and 100-megapixel stress cases:

```sh
npm run bench:jimp -- --profile full
```

### Real AWS Lambda

The Lambda deployment creates temporary Node.js 22 functions in `us-east-1`:
x86_64 at 256, 512, and 1024 MiB, plus ARM64 at 512 MiB. The original runner
measures the x86_64 memory-tier profile. The ARM/WASM runner compares x86_64 and
ARM64 at 512 MiB on the same JavaScript bundle, then explicitly selects the JPEG
WASM accelerator for eligible full-resolution decode:

```sh
AWS_PROFILE=<profile> AWS_REGION=us-east-1 npm run bench:lambda:deploy
AWS_PROFILE=<profile> AWS_REGION=us-east-1 npm run bench:lambda:run
AWS_PROFILE=<profile> AWS_REGION=us-east-1 npm run bench:lambda:run:arm-wasm
AWS_PROFILE=<profile> AWS_REGION=us-east-1 npm run bench:lambda:destroy
```

Always destroy the stack after the run. The x86_64 and ARM64 target chains run
concurrently because they use separate functions. Within each target, the runner
serializes the environment-nonce update, waits for the Lambda update, invokes
one cold sample, and immediately invokes its paired warm sample. The Lambda log
stream must match before the warm sample is accepted, so samples sharing one
function cannot run concurrently without invalidating the lifecycle check.

The final 05:51 UTC profile staged the pinned 4000x3000 JPEG and deterministic
4000x3000 RGBA PNG as external S3 fixture objects. The deployed code ZIP was
98,517 bytes; the two fixture objects totaled 14,160,578 bytes and were not part
of that ZIP. The deploy command creates the temporary staging bucket without
requiring the ECR permission used by the standard CDK bootstrap. The destroy
command removes the functions, explicit log groups, IAM role, CloudFormation
stack, code object, fixture objects, and bucket. An earlier development pass
embedded the fixtures in a roughly 5.2 MiB package; that package and cold-start
profile are obsolete and are not the final published result.

The JPEG WASM module measured 21,100 bytes raw, 5,160 bytes gzip, and 4,363 bytes
Brotli. It remains opt-in: the JavaScript reference path is the default, and the
accelerator applies only when the planner requests an eligible full-resolution
JPEG decode. An accepted accelerated cold sample must instantiate the module
exactly once during the operation; its paired warm invocation must reuse that
instance. WASM memory was 6.0 MiB for every accelerated workflow, but maximum
AWS-reported memory did not always fall.

Interpret the architecture rows per workflow rather than declaring one platform
faster. ARM64 warm operation medians were about 5–6% lower for the JPEG inputs
and about 3–8% higher for the PNG inputs. The WASM warm medians improved by about
9% on x86_64 and 16% on ARM64 for PNG output. ARM64 WebP measured 13,604.4 ms on
the reference path and 8,160.3 ms with WASM, but the three-sample distributions
were variable, so use the exact samples rather than generalizing that result.

Every accepted workflow must produce one output SHA-256 across cold and warm
invocations, both architectures, and both engines where applicable.
`operationMs` excludes the S3 fixture read and output metadata validation but
includes JS/WASM input and output copies. AWS `Duration` includes the complete
handler, including the S3 read; cold total adds `Init Duration`. Maximum memory
is the largest AWS `REPORT` value across cold and warm samples.

Read the final
[ARM64 and JPEG WASM report](results/aws-lambda-arm-wasm-2026-08-09.md) and
[raw JSON samples](results/aws-lambda-arm-wasm-2026-08-09.json).

Every report contains a compatibility table, a performance table limited to
workflows that passed equivalently for every selected engine, and a separate
startup/package table. Startup uses one fresh process per engine and records
module import time, RSS immediately after import, first JPEG metadata and resize
latency, npm package (unpacked) size, and installed production package count.
The package count includes the engine package itself and every installed
production dependency instance required on the current platform.

Absolute peak RSS is the headline memory number. The delta remains available in
JSON as a diagnostic, but a warmup may leave allocator pages resident and make
the delta understate the real process footprint.

The separate bundle and installed-deployment comparison is reproducible with:

```sh
npm run size
```

It reports minified, gzip, and Brotli JavaScript for codec-scoped imports, then
walks each installed production dependency tree. Sharp's JavaScript result is
identified as a native wrapper and is paired with the platform-specific addon
and libvips footprint.

When PureJsImage has an executable build, set `PUREJSIMAGE_ENTRY` to its module
entrypoint and run both engines:

```sh
PUREJSIMAGE_ENTRY=./dist/index.js npm run bench -- --engines jimp,purejsimage
```

## Interpretation

PureJsImage wins a case only when it produces valid output and improves the
median wall time. The north-star goal is to win every supported standard case
while reducing peak RSS. Stress and compatibility cases may first expose
unsupported behavior; they remain visible until fixed rather than disappearing
from the suite.

Workflow timing includes encoding, but `quality: 80` is not a calibrated quality
target shared by different JPEG encoders. Compression quality and size require
a separate matched-quality study; the competitor report does not rank encoders
by output size alone.
