# HDR Surgery architecture

Status: implementation checkpoint. The API is provisional until an authorized release.

## 1. Product scope

HDR Surgery is an explicit gain-map API for JPEG and AVIF. It inspects a compound image, exposes
the encoded base and gain-map ranges, renders a caller-selected display boost, applies matching
geometric operations to both renditions, and writes a backward-compatible compound output.

The supported product claim is:

> Inspect, transform, and re-encode gain-map HDR images without silently discarding the HDR
> rendition.

The first implementation does not generate a gain map from unrelated SDR and HDR images. It does
not infer HDR detail from clipped SDR pixels. It does not add drawing, compositing, arbitrary-angle
rotation, camera RAW, JPEG XL output, HEIF output, C2PA authoring, or AVIF animation.

## 2. Baseline

Work started from `origin/main` revision `c840f92e43e6c71ab63acc160009330034c331fe` on
`codex/hdr-surgery`. The package version is `0.17.0` and the baseline Node.js version is `v24.16.0`.
The worktree was clean before the branch was created.

The focused JPEG, AVIF, native-precision, evidence, and source-contract baseline passed 255 tests
in 6 files. `npm run browser:check` passed with a 2,014,317-byte aggregate browser graph and 10
default codecs. The existing package-size gate reported these relevant minified entries:

| Entry | Baseline minified size |
| --- | ---: |
| Core initial chunk | 19.1 KiB |
| Core execution chunk | 65.3 KiB |
| Core plus JPEG | 164.1 KiB |
| Core plus AVIF | 477.1 KiB |
| All stable codecs | 903.6 KiB |

The complete HDR entry is 580,322 minified bytes because it includes the first-party JPEG and AVIF
implementations needed by its one explicit entry. Its reviewed ceiling is 680,000 bytes. Root and
default-browser dependency checks reject HDR imports, so this cost remains opt-in. The only shared
ordinary-codec change is the small generic display-weight helper used by AVIF.

Current relevant implementation facts:

- ordinary JPEG metadata stops at the first SOS and reports only the bounded MPF image count;
- ordinary JPEG decode reads the primary codestream and already returns the SDR primary for the
  checked compound fixture;
- JPEG EXIF and ICC preservation currently reads the complete compressed source;
- the JPEG encoder writes EXIF and ICC marker segments before frame and entropy data;
- AVIF parses ISO gain-map rationals, validates its `tmap` relationship, resamples rows, and
  composes a fixed SDR result inside `src/codecs/avif.ts`;
- AVIF coded item and ISOBMFF parsing stays in AVIF modules;
- native crop and orientation preserve fixed-width interleaved formats;
- native resize supports the required 8-bit, 16-bit, and float formats with bounded rows;
- quarter turns can use the existing explicit temporary-store path;
- `ImageSource` reads have borrowed-buffer semantics and evidence hooks;
- `Uint8ArraySink` copies chunks and concatenates once only when the caller requests bytes; and
- execution evidence is caller-owned, bounded, JSON-safe, and absent unless explicitly supplied.

## 3. Dependency direction

The portable dependency direction is:

```text
ImageSource, ImageSink, limits, pixels, color, transforms, evidence
                              ^
                              |
                 generic gain-map model and math
                    ^                       ^
                    |                       |
          JPEG compound adapter      AVIF gain-map adapter
                    \                       /
                     explicit purejsimage/hdr API
                                  ^
                                  |
                         browser worker and page
```

The generic layer contains no JPEG markers, MPF, XML, ISOBMFF, AV1, HEVC, DOM, or Node code. JPEG
does not depend on AVIF. Ordinary codec entries do not import the HDR entry. Applications import
the explicit HDR entry only when they need both supported gain-map container adapters.

## 4. Public package entry point

The package entry is `purejsimage/hdr`. It exports:

- immutable gain-map metadata and inspection types;
- metadata normalization and validation;
- display-weight and row composition functions;
- JPEG and AVIF inspection and opening functions;
- extraction and bit-preserving repack options;
- paired crop, flip, orientation, quarter-turn, and resize operations; and
- JPEG and constrained AVIF output options when their acceptance gates pass.

Importing `purejsimage`, `purejsimage/browser`, or an ordinary codec entry does not import this
module. The entry has no side effects, global registration, runtime dependency, or Node built-in.

## 5. Source and resource ownership

An opened gain-map image owns one validated source and two non-copying subrange views. The source
views inherit identity, session lifetime, cancellation, and evidence dependencies. A view validates
its start and length with safe-integer arithmetic and translates every child read back to the parent
range.

The opened object owns its child decoders, iterators, transformed child pipelines, evidence scopes,
and compressed output artifacts. `close()` is idempotent. A failure or cancellation returns both
child iterators and releases all managed leases. Inspection objects contain no source bytes,
TypedArrays, callbacks, live decoders, or DOM values.

## 6. Generic gain-map metadata model

The immutable model records:

- whether the base is SDR or HDR;
- one encoded channel or three encoded channels;
- base and gain-map dimensions;
- three normalized values for minimum log2 gain, maximum log2 gain, gamma, SDR offset, and HDR
  offset;
- minimum and maximum display-capacity log2 values;
- whether the base color space is used for the alternate;
- declared base, alternate, and gain-map sample semantics;
- source container and metadata representations;
- the selected effective representation;
- exact ISO signed rational numerators and unsigned denominators;
- validated Ultra HDR decimal lexical forms when present;
- base, map, and metadata source ranges;
- orientation and normalized geometry; and
- bounded warnings and unsupported details.

Single values are expanded to three normalized values once. The source cardinality remains
available for faithful writing. Hot loops receive finite numeric tables only.

## 7. Validation

Validation occurs before pixel decoding. Values must be finite. Gamma is positive. Minimum gain is
not above maximum gain. Capacity minimum is not above capacity maximum. Required offsets are
nonnegative. Display boost is finite and at least 1. Dimensions and channel counts must be within
the image and HDR limits. Base and map dimensions must describe the same rational aspect ratio.

Every offset, length, row stride, dimension product, TIFF offset, APP length, and final output size
uses checked safe-integer arithmetic. Zero denominators, unsafe integers, unsupported flags,
overlapping child ranges, conflicting image selections, and contradictory preferred metadata fail
explicit HDR opening. Ordinary SDR decode remains available.

## 8. Container adapters and precedence

### JPEG

The JPEG adapter performs bounded marker inspection, standard and extended XMP assembly, a small
RDF/XML subset parse, GContainer directory resolution, MPF image enumeration, and ISO 21496-1
metadata parsing. A valid adjacent MPF relationship uses declared ranges plus SOI and EOI boundary
reads. A malformed or padded legacy primary range falls back to bounded entropy-aware EOI scanning.
The adapter returns source ranges and normalized metadata without entropy-decoding either child.

### AVIF

The AVIF adapter keeps all ISOBMFF and AV1 details in AVIF modules. It converts the existing `tmap`
inspection and exact rationals into the generic model. The ordinary AVIF decoder keeps its existing
default output policy.

### Precedence

Valid ISO 21496-1 metadata wins over Ultra HDR XMP. A valid lower-priority XMP representation is
retained for inspection and compatibility checks. If valid representations select different child
images, dimensions, base direction, or materially different gain parameters, explicit HDR opening
fails. An invalid preferred representation does not silently fall through. Cheap inspection reports
the stable failure while ordinary SDR decode remains usable.

## 9. JPEG metadata bounds

The first implementation uses explicit configurable limits with conservative defaults for marker
count, APP segment count and bytes, XMP packet and extended chunk bytes, XML depth and attributes,
RDF list entries, MPF IFD and image entries, embedded images, ISO metadata bytes, compressed child
bytes, and final output bytes. XML rejects DTD and entity declarations. It never resolves external
entities. Names, text, attributes, nesting, and list cardinality are bounded.

JPEG boundary scanning understands byte stuffing, restart markers, multiple SOS scans, progressive
scans, and EOI. It does not treat entropy bytes as top-level markers.

## 10. Color, transfer, and alpha semantics

Gain-map composition requires declared RGB or gray base semantics and a known transfer function.
The base transfer is decoded to linear before gain is applied. Gain-map samples are normalized
encoded values. One gain channel applies to RGB. Three gain channels apply independently. Alpha is
copied and never multiplied.

The first output semantics are linear sRGB or linear Display P3 where the container relationship
proves the primaries. Source-profile and unknown primaries fail unless an existing decoder has
already converted them to declared output pixels. An SDR preview is an explicit display mapping and
is not reported as a true HDR pixel result.

## 11. Reconstruction math

For each channel, the normalized encoded map value `g` is converted once per sample:

```text
recovery = g / sampleMax
logRecovery = recovery ** (1 / gamma)
weight = clamp((log2(displayBoost) - capacityMin) /
               (capacityMax - capacityMin), 0, 1)
logBoost = gainMin * (1 - logRecovery) + gainMax * logRecovery
alternate = (baseLinear + offsetSdr) * 2 ** (logBoost * weight) - offsetHdr
```

For an HDR base, the standard reverse weight and offset direction are used. Intermediate values are
not clamped to SDR white. Negative post-offset values are clamped to zero at the requested output
boundary. Non-finite output is a structured invalid-input failure. Float32 output uses Float64 math.
Integer output has an explicit scale and clamp policy.

Specialized one-channel and three-channel kernels avoid per-pixel allocation and metadata parsing.
Rows or bounded row blocks are emitted as `rgbf32`, `rgba16`, or an explicit 8-bit SDR preview.

## 12. Geometry mapping

Base and map pixel edges share normalized coordinates. A base edge at `x / baseWidth` maps to
`x * mapWidth / baseWidth` in gain-map edge coordinates. Crop preserves the exact rational source
region and resamples it to the selected integer output map geometry. It does not independently round
two integer crops.

The default output map density follows the source map density and produces dimensions with the same
final aspect ratio as the base. Callers may select explicit compatible map dimensions. Different
map resolution uses bilinear or Lanczos3 sampling. Tests cover odd sizes, non-integral ratios,
fractional crop edges, and one-pixel boundaries.

## 13. Transformation semantics

Geometric operations apply separately to base pixels and encoded gain samples. Crop, horizontal and
vertical flip, EXIF auto-orientation, 90, 180, and 270 degree rotation, and nearest, bilinear, and
Lanczos3 resize are supported. Metadata gain values do not change for these operations. Scalar maps
remain scalar and RGB maps remain RGB.

The primary orientation applies exactly once to the relationship. Gain-map EXIF orientation is
ignored where the container contract requires it. Output pixels are normalized to orientation 1.
Arbitrary-angle rotation and edits that change only one rendition remain unsupported.

## 14. Encoded output assembly

JPEG output encodes or reuses the base and map artifacts separately. Assembly calculates XMP, ISO,
and MPF lengths and offsets with checked arithmetic, injects legal markers, and streams the final
container to any `ImageSink`. It keeps bounded compressed artifacts and never concatenates decoded
full frames. Artifact storage is released on success, failure, or cancellation.

The default metadata mode is `dual`; `iso` and `ultra-hdr` remain explicit options. Base and map
quality are independent. A one-channel map uses grayscale JPEG. A no-pixel-change repack copies the
two child codestream ranges exactly, decodes zero pixels, and reports that path in evidence.

The first AVIF writer accepts opaque 8-bit base pixels and a one-channel 8-bit map, independently
coded AV1 items, ISO metadata, required relationships, and sRGB NCLX signaling. It does not support
Display P3 output, alpha, grids, animation, external data references, or unknown auxiliaries.

## 15. Memory model

Inspection reads marker, metadata, and range boundaries only. It does not read a complete remote
source. Rendering uses bounded base rows, required gain rows, lookup tables, and an output block. It
does not retain complete decoded RGBA base and map images together.

The current paired crop, flip, orientation, quarter-turn, resize, and re-encode path is an explicit
full-frame fallback with a caller-controlled `maxMaterializedBytes` limit. It retains one 8-bit base
raster and one smaller encoded gain raster, not a decoded RGBA pair. Encoded assembly may retain
bounded compressed artifacts. Untransformed selected-boost rendering remains the bounded-row path.

## 16. Execution evidence

HDR work uses child scopes for inspection, XMP, MPF, ISO metadata, both decoders, gain resampling,
composition, both transforms, both encoders, JPEG or AVIF assembly, and bit-preserving repack.

Evidence records source ranges, logical reads, physical transfers when available, selected
representation, operations, blocks, managed allocations, compressed artifacts, output bytes,
cancellation, fallback class, and whether pixels were decoded. It never records pixels, XMP, ICC,
entropy bytes, local paths, signed query strings, or arbitrary metadata. Summary mode keeps no
per-block history. Disabled evidence performs no global lookup and allocates no trace object.

## 17. Fixtures and independent oracles

`benchmark/hdr-surgery/fixture-manifest.json` is the source, license, checksum, expected structure, and
oracle registry. Synthetic TypeScript fixture generators cover exact math, endian variants,
orientations, malformed metadata, range conflicts, and non-integral geometry. Redistributable real
fixtures are checksum pinned.

The JPEG oracle is libultrahdr v2.0.0 at commit
`b2aacb366e1542cfc29605cb0d8a0ebd06bb07f8`. Its probe accepts generated dual metadata and its
linear RGBA16F output matches the constant-map analytic fixture with maximum absolute error
0.017571 and RMSE 0.001608. The AVIF oracle is `avifgainmaputil` 1.3.0. It parses the generated exact
ISO metadata and writes a tone-mapped PNG at three stops of headroom. Browsers are additional
container and application checks. Lossless extraction is byte exact.

The 24 MP inspection workload reads 32,772 unique bytes in six reads from a 1,169,698-byte source,
decodes zero pixels, and uses no full-frame fallback. The 12 MP 2x render emits 144,000,000 bytes of
linear RGB in bounded blocks with a 192,622,592-byte absolute peak RSS in the latest full run.

## 18. Browser application architecture

`/hdr-surgery/` uses the existing Astro application shell and a dedicated validated worker
protocol. The worker receives closed-schema `unknown` messages, request IDs, and generations.
Buffers transfer rather than clone. Stale results and image bitmaps are closed. Reset and page
teardown terminate workers, revoke object URLs, close opened images, and cancel active work.

All image processing remains local. A remote URL is fetched only when CORS permits it. The page does
not upload source bytes. The native `<img>` result is separate from the software SDR preview and
false-color visualization.

## 19. Package and bundle boundaries

The HDR entry is tree-shakeable and has a dedicated minified, gzip, and Brotli measurement. Its
ceiling is set after the first correct implementation and reviewed against actual parsed and pixel
work. Root, browser, and ordinary codec entry dependency tests reject accidental HDR imports. The
published package keeps zero runtime dependencies.

## 20. Compatibility and migration policy

The ordinary JPEG and AVIF APIs retain their existing defaults. JPEG returns the SDR primary.
Explicit HDR opening is additive. Invalid gain-map metadata never changes ordinary SDR decode.
Shared AVIF math may move to the generic module only after existing hashes, limits, browser output,
and gain-map fixtures pass.

The API may evolve before release. Version changes, tags, publication, and stable compatibility
promises require separate release authorization.

## 21. Implementation checklist

An item is complete only after its stated focused evidence passes.

- [x] Record git, package, runtime, focused-test, browser, and bundle baselines.
- [x] Inventory current JPEG metadata, AVIF gain-map, precision, transform, source, sink, evidence,
      package, and application seams.
- [x] Record public Android, Apple, ISO summary, and libultrahdr sources that inform the design.
- [x] Add the immutable generic metadata model, exact source representations, limits, and tests.
- [x] Add display-weight, scalar and RGB composition, transfer, alpha, float, and 16-bit tests.
- [x] Add validated non-copying source subranges and cancellation tests.
- [x] Add bounded JPEG codestream, XMP, GContainer, MPF, and ISO parsers with malformed tests.
- [x] Add cheap JPEG inspection, child extraction, opening, and invalid-HDR behavior.
- [x] Refactor AVIF to the shared model and caller-selected display boost without regression.
- [x] Add paired geometry and exact analytic alignment tests.
- [x] Add Ultra HDR JPEG encode and reopen tests for dual, ISO, and XMP modes.
- [x] Add bit-preserving repack and prove zero decoded pixels plus exact child bytes.
- [x] Add constrained ISO gain-map AVIF output and independent decode evidence.
- [x] Add caller-owned HDR evidence scopes, summaries, trace bounds, and explain output.
- [x] Add the fixture manifest, deterministic generators, mutation suite, and pinned oracles.
- [x] Add `bench:hdr-surgery`, isolated RSS work, neighboring benchmarks, and baseline comparison.
- [x] Add `purejsimage/hdr`, package type tests, browser graph tests, and a dedicated size ceiling.
- [x] Add the worker protocol, `/hdr-surgery/` application, accessibility, containment, and three
      browser engines.
- [x] Update capability facts, regenerate derived docs, add the guide, API reference, roadmap,
      changelog, navigation, sitemap, and public metadata.
- [x] Run every focused, fixture, oracle, benchmark, package, browser, generated, docs, diff, and
      full repository gate.
- [x] Commit and push the feature branch, then verify required exact-commit remote workflows.

## 22. Public sources used

- Android, *Ultra HDR Image Format v1.1*, including XMP fields, defaults, MPF/GContainer location,
  display math, invalid-metadata fallback, and ISO precedence.
- Android, *Edit Ultra HDR images* and *Display Ultra HDR images*, for coupled edits and the
  distinction between software previews and native HDR presentation.
- ISO, public summary for ISO 21496-1:2025. The paid standard text is not copied or committed.
- Apple, WWDC24 session 10177, for alternate-rendition behavior, HDR-base symmetry, and paired
  base/gain edits.
- google/libultrahdr, pinned during fixture-oracle setup, for independent container and numeric
  behavior only. No implementation code is copied or translated.
