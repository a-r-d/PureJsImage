# Public JavaScript JPEG XL comparison

## Scope

This is a manual comparison of PureJsImage, `@jsquash/jxl` 1.3.0,
`jxl-oxide-wasm` 0.12.6 and `wasm-vips` 0.0.19 on one Linux host.
PureJsImage is the local public-API build of
`564a4d2d3e1c318f64821322c67329550df6da6b`. This is not a measurement of the
published 0.17.0 tarball. The encoder implementation and capability decisions
have not changed in this comparison.

[Generated summary](SUMMARY.md), [website dataset](website-data.json),
[subject/assets manifest](subjects.json), [fixture manifest](fixtures.json), and
[dated official-source survey](survey.json) are the handoff artifacts.
Raw reports live in [results](results). The [artifact index](results/artifact-index.json)
pins the measured binaries and harness files. The [quality validation](results/quality-correctness.json)
checks all 87 scored artifacts; five retain nonzero alpha error from comparator defaults. The website dataset is generated from
those reports. No overall winner score is calculated.

## Supported conclusions

- The tested PureJsImage toolkit has the smallest loaded asset footprint among
  these four adapters. This includes the benchmark worker and both encode and
  decode entry points; it is not a survey of every possible JPEG XL bundle.
- The WASM alternatives decode several native-libjxl lossless streams rejected
  by this PureJsImage revision's grouped Modular transform support. Those cases
  remain visible, including the failed PureJsImage roundtrip workload.
- The three encoders expose different speed/compression tradeoffs. See the
  generated paired lossless table; the WASM encoders are substantially faster
  on several measured workloads. Exact validation is required before a row
  enters a ratio.
- At SSIMULACRA2 80 on the capped photo, PureJsImage's interpolated size is about
  1.212 times wasm-vips, with adequate brackets on both sides. This one result
  does not establish a corpus-wide lossy ranking. Other targets remain wide or
  missing under the finite search budget.
- Oxide preserves the tested 16-bit integer images through its native-depth PNG
  path. It does not expose raw sample planes or encoding. Its PNG export cost
  remains part of the measured operation.
- Specialized APIs have separate results: PureJsImage's native float, extra
  channel, ICC and exact JPEG reconstruction probes pass; wasm-vips' native
  float and ICC probes pass. Animation timing has additional limits described
  below. Exposed APIs that were not tested are not treated as unsupported.

### Animation timing observations

The 3/5 ms fixture is retained as an exact-timing edge case. wasm-vips writes
100/100 ms in that case. Its upstream
[jxlsave implementation](https://github.com/libvips/libvips/blob/master/libvips/foreign/jxlsave.c)
explicitly normalizes delays of 10 ms or less to 100 ms. The ordinary 30/50 ms
control is reported separately.

Oxide's published duration numerator/denominator pairs yield 3000/5000 for
that fixture, while its frame access and composition are checked separately.
The inspected
[WASM binding source](https://github.com/tirr-c/jxl-oxide/blob/main/crates/jxl-oxide-wasm/src/lib.rs)
multiplies frame ticks by the tick-rate numerator. This report does not treat
those values as a verified seconds-based timeline. No workaround changes the
wrapper's returned timing. These observations concern the tested binding and
settings, not the full capabilities of the underlying native engines.

## Inputs and semantics

The 16 stills include eight existing M7 development diagnostics, a complete
12 MP sunset, a complete 1920x1080 screenshot, two alpha references, gray8,
gray16, RGB16 and RGBA16. Four diagnostics are native-resolution crops; four
are reduced photographs. `scope: capped` identifies this diagnostic group;
it does not mean all eight are reduced full images. The large originals remain
separate. These inspected sources provide regression evidence, not an unseen
holdout. This comparison does not rerun or replace M7 qualification.

The manifests pin input and output hashes. The imazen sources retain their
licenses and original source identities in the existing
[M7 source selection](../production-program/m7-corpus-selection.json).
Conformance sources come from revision
`4bf053529c7cefd2951be453475bb3dccc7e7be8` of
[libjxl/conformance](https://github.com/libjxl/conformance). The selected alpha
and gray cases are CC0. Small native float, extra-channel, ICC and animation
probes use repository fixtures and deterministic public-API synthesis.

Common encode inputs are prepared once as sRGB RGBA8, straight alpha, stored
orientation 1. Gray/RGB expansion adds opaque alpha without changing color
samples. High-depth inputs remain uint16 and are reported separately. The
specialized float probe retains IEEE binary32 values above 1. No wrapper is
credited with native precision by converting its input to 8-bit.

Every decoder receives the same pinned bytes per row. Native libjxl 0.12.0
creates the shared ordinary decode inputs. A rejected native stream remains an
unsupported-input result; it is not replaced with a stream selected for that
decoder. Lossless validation checks every requested sample, including color
under zero alpha. Rendered lossy comparisons use the existing maximum RGB8
error of 2 against pinned native libjxl output. This tolerance applies to that
rendering contract, not to pixel losslessness. A failure under this contract
does not by itself establish that a wrapper is generally broken.

The [validation amendment](results/validation-amendment.json) corrects an initial
benchmark assumption that every lossy default promised exact alpha. It preserves
all original classifications, measurements and alpha errors. Lossless equality,
the RGB8 decode tolerance, and PureJsImage's exact-alpha guarantee are unchanged.

Independent native decoding validates encoded streams outside the timed region.
Lossy timing rows establish dimensions and record alpha error. Exact alpha is
required for PureJsImage, which promises it by default. Other public lossy
defaults may alter alpha; their errors are retained as a quality tradeoff. Their color quality
is evaluated separately; successful decoding does not establish matched quality.

## Public API adapters

- PureJsImage uses `purejsimage/browser`, `purejsimage/codecs/jpegxl` and the
  specialized `purejsimage/jpegxl` exports. Encoder calls include the public
  selection logic. Typed pixel blocks use the API's big-endian byte layout.
- jSquash uses its published `decode`, `encode` and `init` functions, plus the
  documented ImageData shim in Node. Its ImageData API does not expose native
  16-bit or float samples. The non-isolated browser origin selects its normal
  single-thread encoder. Both encode and decode modules are initialized for
  this adapter toolkit; startup and footprint figures include both.
- jxl-oxide uses the published npm WASM binding. A decode operation includes
  `render().encodeToPng()`. This is a PNG-producing workflow, not raw decode.
  The published glue consumes the render result during PNG export; the image
  handle is explicitly freed. No native executable replaces this binding.
- wasm-vips loads its supported JXL dynamic plugin, sets `concurrency(1)` and
  disables the operation-result cache. `writeToMemory()` materializes pixels;
  every Image handle is deleted. The runtime is shut down after each timing
  job. Its browser pthread runtime requires cross-origin isolation and starts
  a worker pool even when image-processing concurrency is one. These startup
  and transfer costs remain included.

No adapter adds a missing sequence, exact-reconstruction, or raw-sample API to
another wrapper. The capability dataset distinguishes absent APIs from features
that are exposed but not tested. Specialized Node results are labeled Node;
browser support is not inferred from a Node success. Animation's Experimental
status in PureJsImage is separate from the measured sequence result.

## Timing and memory

Main measurements use Chromium and Node on the environment recorded in each
report. Firefox and WebKit run the small compatibility subset. Jobs run serially
under the existing bounded systemd runner with zero swap and an 8 GiB process-tree
ceiling. No new CI benchmark is installed.

Each main job uses a fresh process or browser worker/context, measures library
initialization plus its first operation, then three warm operations. Source
preparation, fetching the prepared input, independent validation, PNG reading for
validation and external metrics are outside the operation timer. Adapter input wrapping/copies, codec-required
conversions, copying the returned typed data and oxide's mandatory PNG export are
inside. Cold time excludes process/worker harness startup. The representative
cold report provides three independent startup observations per selected cell.

The library data is fully materialized before stopping the timer. Warm runs reuse
initialized code and allocated heaps, but wasm-vips cannot serve an operation
from its result cache. Main cold cells have one observation and cannot support a
precise cold median by themselves. Raw times and warm median/minimum/maximum are
retained. This is an interactive workstation, not a dedicated reference host;
small differences should not be described as durable wins.

Node peak RSS comes from each isolated subject process. It includes the JS
runtime, prepared source, output, temporary buffers, WASM and worker infrastructure.
The before/after process memory counters are diagnostic snapshots, not production
encoder-managed memory or proof of reclaimed warmup allocations. WASM linear memory was not separately instrumented. Browser memory is unavailable
because these browser/isolation combinations lack a consistent measurement API. No canvas allocation is measured.

The bundle inventory hashes complete loaded JS, WASM and worker assets. The
summary counts deployment files once, including the shared benchmark worker.
It also retains actual cold requests, including repeated worker-script fetches.
Gzip level 9 and Brotli quality 11 are offline transfer estimates. The server
uses uncompressed responses and `Cache-Control: no-store`; a warm operation
uses the initialized toolkit without new library fetches. These are toolkit
sizes, not claims about each library's smallest possible application bundle.

## Matched quality

The finite quality subset contains a photo, a sunset, fine text and transparency.
It measures public effort-7 encoding and a separately labeled native-libjxl
reference. It reuses the M7 nondominated frontier, log-byte interpolation,
monotonicity checks and adaptive next-setting helper.

SSIMULACRA2 80 is the primary requested target. Each subject/source gets at most
six lossy points, including two initial points; only missing or wide target-80
intervals are refined. A score width of at most 2 is adequate here. Bands 70/90
and Butteraugli coordinates 0.5/1/2/3 remain visible even when unresolved.
Butteraugli width at most 0.25 is marked adequate. No extrapolation or lossless
point is inserted. Equal effort, quality and distance options do not imply equal
quality or equal work. No lossy size ranking comes from the fixed-option timing
rows. Some comparator settings compress alpha lossily; the raw alpha errors and
both composite scores remain visible. This differs from PureJsImage's exact-alpha
default and must accompany a transparency size comparison. Native-libjxl results never enter JavaScript runtime comparisons.

Transparency is composited onto both black and white backgrounds before scoring.
The primary score is the lower SSIMULACRA2 value and the secondary distortion is
the higher Butteraugli value. Each background's raw scores remain available.
The HDR probe checks native float samples and explicit linear range mappings at
headroom 1/2/4. It is not a perceptual HDR encoder compression comparison.

## Preview and API limits

The separate Chromium preview command measures first nonempty output over
loopback HTTP. PureJsImage uses a read-at source and requests a 32x32 region at
scale 2. Oxide receives sequential 4096-byte chunks and exports a full-frame PNG.
These are different workflows and their latency is not ranked. Requested and
transferred source bytes remain separate from toolkit asset transfer. The Node companion checks final region pixels against native libjxl, including
center sampling at scale 2. The first DC/partial preview is checked for nonempty
output; its visual fidelity and real network latency are not qualified. A crop API alone is never classified as selective decoding.

Exif/XMP, arbitrary animation blend combinations, orientation rendering,
lossy native-16-bit curves and multithread speedup remain explicitly not tested in this bounded comparison.
They must not become unsupported or verified claims on the website. The report
is not a new codec capability promotion or a claim about every legal JXL stream.

## Reproduction

Use Node 24 and the exact root lockfile. Dependencies are development-only.
The package still has no runtime dependency tree.

```sh
npm ci
npm run build
node benchmark/jpegxl/comparison/restore-inputs.ts
node benchmark/jpegxl/comparison/prepare.ts
node benchmark/jpegxl/comparison/build.ts
```

Preparation reuses the existing pinned M7 normalized diagnostics and originals,
and generated lossless fixtures. Their paths and hashes are in `fixtures.json`.
On a fresh checkout, use `restore-inputs.ts` for only the selected imazen sources. It checks original
hashes and refuses normalization that differs from the committed prepared-input
hashes. Use the existing `generate-lossless-corpus.ts`,
`generate-vardct-corpus.ts` and pinned conformance archive for missing small
codec fixtures. No full-corpus timing run is required. Do not substitute a newer image or resizer output under an existing
fixture ID. The pinned native oracle and metric binaries live under
`.tmp/jpegxl-oracles/libjxl-v0.12.0/source/` and have hashes in the reports.

Run one bounded command at a time. The runner deliberately uses a single unit.
Repeat the following form for the listed commands:

```sh
PUREJSIMAGE_M7_CPU_PERCENT=800 PUREJSIMAGE_M7_MEMORY_GIB=8 \
  node benchmark/jpegxl/run-m7-bounded.ts comparison-main-chromium \
  env node benchmark/jpegxl/comparison/run.ts main chromium
```

Commands after `env node`:

```text
benchmark/jpegxl/comparison/run.ts main node
benchmark/jpegxl/comparison/run.ts compat firefox
benchmark/jpegxl/comparison/run.ts compat webkit
benchmark/jpegxl/comparison/run.ts cold chromium
benchmark/jpegxl/comparison/run.ts cold node
benchmark/jpegxl/comparison/specialized.ts
benchmark/jpegxl/comparison/preview.ts
benchmark/jpegxl/comparison/quality.ts
```

Choose a unique bounded-run ID for each command. `run.ts smoke node` and
`run.ts smoke chromium` provide quick initialization checks. `JXL_COMPARE_SUBJECTS`
can select a comma-separated subject list for diagnostics. Reports are written
after each row; rerunning a command makes new timings rather than treating an
old timing as a fresh sample. Preserve an old report before replacing it.

```sh
node benchmark/jpegxl/comparison/validate-quality.ts
node benchmark/jpegxl/comparison/amend-validation.ts
node benchmark/jpegxl/comparison/generate.ts
node benchmark/jpegxl/comparison/index-evidence.ts
npx vitest run tests/jpegxl-comparison.test.ts
npm run check
```

For the committed run, prior raw classifications are preserved in the validation
amendment and `results/preflight`. If formatting raw JSON, regenerate its dependent
validation and dataset hashes afterward. `archive-pins.ts` preserves exact subject
and fixture manifest bytes before formatting.

The generated dataset retains raw-report links and hashes, classified failures,
actual settings, artifact identities, and missing quality intervals. Large
binary artifacts remain in `.tmp/jpegxl-comparison-v1`; raw JSON and the artifact
index are versioned. Keep that cache for inspecting exact measured bytes.

## Handoff checks

The 11 comparison tests passed. The complete repository gate passed with
`VITEST_MAX_WORKERS=4 npm run check`: 3,236 tests passed and three were skipped.
The initial default-worker run timed out in an existing encoder test at five
seconds. That test passed in isolation in 2.7 seconds; the complete four-worker
rerun preserved its assertions and timeout. All non-test repository gates passed.

The Chromium/Node main runs, repeated cold subset, Firefox/WebKit compatibility
checks, preview probes, specialized probes and 87 independently decoded quality
artifacts are recorded above. The final input-normalization verification reproduced
all ten selected imazen inputs exactly. No benchmark timing was refreshed by a
repository test run.

## Prompt 2 boundary

Use this report and the generated data for a later comparison page. Publish
only claims supported by the measured scope, include competitor advantages,
and keep original-size results separate from diagnostics. Do not turn missing
brackets, wrapper limitations or untested features into wins. No production
codec change, Stable decision, version bump or release is part of this work.
