# JPEG XL lossless-first architecture

Status: implementation checkpoint. The APIs and capability boundaries in this document are
provisional until their acceptance gates pass and a release is authorized.

Starting revision: `72ec5fcdbb80bb0c180534fcedc7b6052285d1d8`.

## 1. Product scope and non-goals

This project has three separate contracts:

1. Decode common static JPEG XL images to pixels. The target includes lossless Modular images,
   ordinary lossy VarDCT photographs, and JPEG-derived JXL image data.
2. Encode supported raw pixels with a constrained mathematically lossless Modular encoder.
3. Transcode eligible JPEG files in the coefficient domain and reconstruct the original JPEG bytes.

The contracts use separate APIs, evidence, and failure modes. Pixel-lossless encoding does not
claim that it can recreate an input file. Exact JPEG reconstruction does not use an RGB decode and
re-encode path.

The project does not add a general lossy VarDCT encoder. It also does not add animation support,
Level 10 support, arbitrary extra-channel extraction, broad CMYK JPEG transcoding, automatic WASM,
or a runtime codec dependency.

## 2. Current implementation map

The starting implementation has these modules:

| Module | Current responsibility | Required change |
| --- | --- | --- |
| `jpegxl.ts` | Detection, container structure, one physical codestream selection, codec wiring | Keep public codec wiring small and move container logic out |
| `jpegxl-bitstream.ts` | Bounded synchronous bit, Huffman, ANS, hybrid integer, and LZ77 primitives | Keep bounded section readers and add encoder counterparts in focused modules |
| `jpegxl-decode.ts` | Image/frame header subset, Modular program and group decode, output blocks | Split headers, Modular, color, and VarDCT responsibilities |
| `jpeg.ts` | JPEG metadata, public decode/encode wiring, metadata preservation | Reuse public semantics without coupling JPEG XL to JPEG pixel output |
| `jpeg-source.ts` | Incremental JPEG entropy reads and restart indexing | Reuse source-reading patterns where the JPEG coefficient parser needs them |
| `jpeg-baseline.ts` | JPEG DCT parsing, compact coefficients, progressive scans, reconstruction | Extract format-neutral coefficient and scan data without weakening decode |
| `codec.ts` | Decoder, encoder, metadata, source, sink, and limits contracts | Add only the JPEG XL options required by the normal pipeline |
| `evidence.ts` | Caller-owned bounded execution evidence | Add JPEG XL scopes through explicit contexts, with no global collector |

At the starting revision, structure inspection indexes raw, `jxlc`, and ordered `jxlp` extents
without joining fragments. Pixel metadata and decode then require exactly one physical segment and
read that complete segment into a `Uint8Array`. The implemented pixel path covers a constrained
lossless Modular subset. VarDCT, exact JPEG reconstruction, and encoding are unsupported.

## 3. Module and dependency direction

The intended portable module graph is:

```text
jpegxl.ts
  -> jpegxl-container.ts
  -> jpegxl-inspect.ts
  -> jpegxl-decode.ts
       -> jpegxl-header.ts
       -> jpegxl-modular.ts
       -> jpegxl-vardct.ts
       -> jpegxl-color.ts
       -> jpegxl-bitstream.ts

jpegxl-encode.ts
  -> jpegxl-header.ts
  -> jpegxl-modular-encode.ts
  -> jpegxl-container.ts

jpegxl-jpeg-transcode.ts
  -> jpegxl-jpeg-data.ts
  -> jpegxl-vardct encode internals
  -> jpegxl-jpeg-reconstruct.ts
  -> jpegxl-container.ts
```

`jpegxl-bitstream.ts` and the shared source, sink, pixel, limits, color, runtime, and evidence
contracts stay below codec coordination. JPEG parsing may produce the format-neutral data accepted
by the transcoder. JPEG XL modules must not import a JPEG RGB decoder as part of the exact path.

The explicit `purejsimage/jpegxl` entry may import specialized inspection and transcode code. The
root package, `purejsimage/browser`, `purejsimage/codecs/all`, and
`purejsimage/codecs/jpegxl` must not import that specialized entry.

## 4. Public API separation

The ordinary registered codec remains at `purejsimage/codecs/jpegxl`. It supplies metadata, pixel
decode, and the constrained lossless encoder through the normal image pipeline.

The normal pipeline will expose one JPEG XL encode operation:

```ts
const output = await image.jpegxl({
  mode: 'lossless',
  effort: 1,
  container: true,
})
```

The specialized `purejsimage/jpegxl` entry will expose:

```ts
inspectJpegXl(input, options)
inspectJpegReconstructionEligibility(input, options)
transcodeJpegToJpegXl(input, options)
reconstructJpegFromJpegXl(input, options)
```

`transcodeJpegToJpegXl()` uses `reconstruction: 'required' | 'prefer' | 'disabled'` and
`fallback: 'reject' | 'pixel-lossless'`. The default is exact reconstruction required with no
fallback. No API maps a generic `lossless: true` option to exact JPEG reconstruction.

## 5. Source, sink, and resource ownership

Every public input is resolved to `ImageSource` before codec parsing. Every operation accepts an
abort signal. Operations that return bytes use `Uint8ArraySink` only when the caller selected a
bounded memory result. Streaming variants write sequentially to caller-owned `ImageSink` values.

Sources own input bytes. Returned source views are valid only until the next read unless the source
declares stable buffers. Parsers copy only bounded state that must outlive a source read. Decoders
own section state until its final dependent group finishes. Encoders own group buffers until those
sections are written or spooled. Every optional temporary resource is selected through
`ImageRuntime`, created only after a read/write/truncate probe, and cleaned up on success, failure,
or cancellation.

## 6. Raw codestream and container model

`jpegxl-container.ts` validates the raw signature or the JPEG XL box sequence. The container model
records every box as a checked half-open physical extent. It recognizes `JXL `, `ftyp`, `jxll`,
`jxli`, `jxlc`, `jxlp`, `Exif`, `xml `, `jumb`, `brob`, and `jbrd`. Unknown boxes remain bounded
summaries unless a caller explicitly preserves an allowed opaque box.

The parser enforces safe extended lengths, boxes extending to EOF, required order, unique required
boxes, the configured box count, metadata byte limits, and one codestream representation. It does
not decompress `brob` during structure inspection.

## 7. Segmented `jxlc` and `jxlp` source model

A logical codestream is an `ImageSource` backed by validated physical segments. It exposes logical
size and maps every requested logical range to one or more physical reads. It never concatenates the
complete codestream. A read crossing fragments may allocate only the requested bounded range.

Raw input contributes one segment at offset zero. `jxlc` contributes one box payload. Each `jxlp`
contributes its payload after the four-byte fragment index. Fragment indexes, final signaling,
container-version ordering rules, logical-size addition, and physical extents are checked before the
logical source is returned.

Header parsing uses a small buffered logical source. After the frame table of contents is known,
each entropy section is fetched independently into a bounded section buffer. Existing synchronous
bit readers remain valid inside one section. No complete physical or logical codestream buffer is a
decoder prerequisite.

## 8. Static-frame decode model

The initial public decoder returns one visible full-canvas still image. It skips an embedded preview
unless a future explicit preview API requests it. Unsupported animation, reference-frame behavior,
or blend dependencies fail with `UNSUPPORTED_OPERATION` before plausible pixels are emitted.

Header parsing produces immutable image, extra-channel, color, frame, group, pass, and section
descriptions. Section scheduling follows declared dependencies. Ordered `PixelBlock` rows are
emitted only after all data affecting those rows is complete.

## 9. Modular decode and encode model

The decoder keeps signed integer channel planes. Mathematically lossless inputs never pass through
`Float32Array`. It applies MA-tree prediction, entropy residuals, weighted prediction, palettes,
squeeze transforms, shifted channels, and reversible color transforms with exact integer
arithmetic. Inverse transforms run in exact reverse dependency order.

Group decode retains only the active dependency band where the format permits it. Crop selection
fetches and reconstructs only intersecting groups plus declared dependencies.

The encoder accepts `gray8`, `gray16`, `rgb8`, `rgb16`, `rgba8`, and `rgba16`. It starts with a
deterministic effort-1 strategy, bounded MA trees, entropy coding, LZ77, useful reversible color
transforms, multiple groups, and sequential section output. Straight alpha is supported first.
Premultiplied alpha fails unless a later explicit conversion is independently proven.

The stable encoder claim requires the fixed size gates in the project specification. Until those
gates pass, the encoder remains experimental even if its files are valid and exact.

## 10. VarDCT decode model

VarDCT decode is separated into LF global, LF group, HF global, pass, and pass-group stages. Compact
coefficient storage is retained only through the final dependent pass and restoration stage.

The implementation must cover the block strategies, coefficient orders, quantization matrices,
chroma-from-luma paths, inverse transforms, XYB conversion, upsampling, Gaborish, EPF, patches,
splines, and noise exercised by the pinned common static corpus. Parser acceptance alone is not
evidence. Each strategy requires image-level comparison with independent decoders.

Full-frame float RGB or RGBA is not the normal boundary. Any compact full-frame LF, coefficient,
patch, or filter state is recorded as a distinct memory class and budgeted before allocation.

## 11. JPEG coefficient-domain transcoding model

The exact transcoder parses eligible 8-bit Huffman JPEGs into a format-neutral structure containing:

- frame components, sampling factors, and quantization table references;
- compact quantized coefficient blocks;
- baseline or progressive scan descriptions;
- Huffman tables and restart intervals;
- marker order and reconstruction metadata; and
- validated fill, entropy-padding, EOI, and supported trailing bytes.

The image data is encoded through the JPEG-derived VarDCT structures defined by JPEG XL. The exact
path never materializes RGB. Arithmetic, lossless-process, 12-bit, hierarchical, CMYK, YCCK, and
out-of-limit JPEGs return structured unsupported reasons in the initial subset.

## 12. JPEG bitstream reconstruction model

`jpegxl-jpeg-reconstruct.ts` parses `jbrd` and its referenced metadata boxes into a bounded
reconstruction description. It validates marker order, tables, scans, restart layout, coefficient
indexes, padding, metadata references, EOI, and the supported tail policy before writing output.

Reconstruction writes one marker or entropy segment at a time to `ImageSink`. Every block count,
coefficient count, and `coefficientIndex * 64` expression uses checked safe-integer or `BigInt`
arithmetic before indexing or allocation.

The operation succeeds only when the reconstructed length and bytes equal the source JPEG. Corpus
tests also require matching SHA-256 values. Missing or modified reconstruction data returns
`UNSUPPORTED_OPERATION`; pixel re-encoding is never an implicit substitute.

## 13. Color, ICC, alpha, and orientation semantics

The codestream color description determines emitted pixel semantics. Checked Modular sRGB and
linear-sRGB gray or RGB output retains the signaled transfer function. XYB is converted through the
inverse opsin transform and the current renderer's linear-to-sRGB conversion before 8-bit RGB
output. Metadata and decoder instances report the same complete semantics. Default signaling uses
`assumed-default`, explicit signaling uses `container-signaled`, and transformed XYB or
JPEG-derived output uses `decoder-converted`. Unsupported color conversions fail instead of
labeling unknown values as sRGB.

One alpha channel is supported first. Its bit depth and straight or premultiplied association are
explicit. Decoding either preserves valid association semantics or performs a documented conversion.

All eight JPEG XL codestream orientations remain an intended decoder contract, not a completed
capability. The current selected subset rejects orientation extra fields. Exact JPEG transcode
accepts source Exif orientation only when it is absent or 1. Copied Exif bytes inside reconstruction
metadata do not rotate decoded JPEG XL pixels.

Embedded ICC decode has separate compressed and decoded byte limits. ICC bytes never enter evidence
records.

The exact JPEG transcoder accepts no ICC or the exact checked deterministic sRGB ICC. It rejects
non-sRGB, malformed, duplicate, incomplete, or conflicting display profiles. The `jbrd` box is used
to reconstruct original JPEG bytes and is never treated as the JPEG XL display color description.

## 14. Metadata preservation policy

Inspection reports box types and sizes, not unchecked payloads. Pixel-lossless encoding may preserve
validated Exif, XMP, JUMBF, and ICC through explicit options. It does not promise source-file byte
identity.

Exact reconstruction preserves every reconstruction-dependent metadata byte. Editing, removing, or
reordering a referenced box invalidates exact reconstruction. Unknown JPEG APP markers and COM are
eligible only within the documented bounded policy. File-system names, dates, and permissions are
outside image bytes and are not preserved by the codec.

`brob` boxes are reported and may be preserved opaquely where legal. Any operation that needs their
decoded contents fails until bounded first-party Brotli support exists.

## 15. Progressive and reduced-resolution strategy

The first VarDCT milestone accumulates all progressive passes and returns the final correct image.
Public preview or refinement events are deferred until final decode passes the corpus.

The section scheduler records pass dependencies so later APIs can stop after DC, LF, or a selected
pass. A reduced-resolution or crop claim requires source evidence proving that discarded sections
were not fetched or decoded. Cancellation is checked between container, header, section, group,
pass, color, restoration, and output stages.

## 16. Memory accounting and full-frame fallbacks

JPEG XL limits are resolved once before parsing and separately bound source bytes, logical
codestream bytes, boxes, metadata, dimensions, pixels, levels, frames, groups, passes, channels,
entropy structures, MA trees, transforms, palettes, patches, splines, coefficients, restoration,
ICC, `jbrd`, reconstructed JPEG output, encoder working state, JXL output, and temporary storage.

All additions and products used for extents or allocations are checked. Values that may exceed the
signed 32-bit range do not use bitwise arithmetic.

The decoder does not retain a second source-sized RGBA image. Modular groups and VarDCT sections are
released after their final dependency. Full-frame coefficient, LF, patch, or reference state is
allowed only when required by accepted syntax, stored compactly, reported in evidence, and measured
as a distinct fallback.

The encoder accepts rows through `ImageEncoder`. If tree learning needs a retained native-sample
frame, that state is explicit and budgeted. Compressed sections are kept in bounded memory or
caller-enabled temporary storage and written sequentially without repeated full-output joins.

## 17. Execution-evidence integration

JPEG XL operations use caller-owned evidence contexts. Imports create no session, collector, timer,
cache, or global registration.

Child scopes cover container inspection, logical codestream mapping, headers, section indexes,
Modular global and groups, VarDCT LF and HF stages, patches, splines, noise, color, orientation,
JPEG coefficients, reconstruction parsing and output, Modular encoding, JPEG transcoding, box
assembly, and exact verification.

Summary and trace modes record bounded ranges, group and pass counts, managed allocations,
coefficient and restoration bytes, output bytes, exact/fallback mode, cancellation, and full-frame
fallbacks. They do not record pixels, coefficients, entropy payloads, ICC, Exif, XMP, local paths,
or signed URLs. Evidence-off paths do not allocate event objects.

## 18. Limits and hostile-input policy

All JPEG XL and JPEG fields are untrusted. Invalid compact integers, unsafe U64 values, impossible
entropy states, invalid ANS final states, LZ77 errors, deep trees, transform cycles, palette and
squeeze errors, invalid coefficient orders, non-finite color data, restoration overflows, patch and
spline bounds, frame references, malformed ICC, malicious `jbrd`, JPEG scan contradictions,
metadata mismatch, truncation, and cancellation have focused negative tests.

An invalid field is never reinterpreted as another feature. Recognized but unsupported syntax uses
`UNSUPPORTED_OPERATION`. Malformed accepted syntax uses `INVALID_INPUT`. Resource exhaustion uses
`LIMIT_EXCEEDED`.

Security regressions are written from independently understood failure classes. Third-party fixes
and source are not copied or mechanically translated.

## 19. Corpus and independent-oracle strategy

`benchmark/jpegxl/corpus.ts` is the typed fixture manifest. A separate oracle manifest records the
exact tool revision, role, license, source, and expected executable name. Generated fixtures record
their generator command and output checksum. Redistributed inputs record license and source.

The decoder corpus covers Modular, VarDCT, JPEG-derived pixels, raw codestreams, `jxlc`, `jxlp`,
color, alpha, orientation, progressive passes, metadata, odd dimensions, group boundaries, and
hostile mutations. Modular output requires exact native samples from at least two independent
decoders. VarDCT output records maximum absolute error, RMSE, and one fixed display-space perceptual
metric against high-precision oracle output.

The encoder corpus decodes every PureJsImage output through PureJsImage, `djxl`, jxl-rs, and
jxl-oxide. PureJsImage, `djxl`, and jxl-rs return exact native samples for the six advertised
formats. The pinned jxl-oxide revision returns exact 8-bit samples but clamps Modular 16-bit values
above 32767 because it treats them as signed. Those failures stay in the matrix as a pinned decoder
limitation. Exact JPEG corpus entries record pixel-decode eligibility and reconstruction
eligibility separately. Eligible entries require byte equality and SHA-256 equality.

Initial development pins:

| Oracle | Revision | Role |
| --- | --- | --- |
| libjxl | `v0.12.0`, `a7a9c787341cf703dede03c2009fa460cae5e5df` | `cjxl`, `djxl`, `jxlinfo`, `benchmark_xl` |
| libjxl conformance | `4bf053529c7cefd2951be453475bb3dccc7e7be8` | Conformance codestreams and references |
| simple-lossless-encoder | `7b9f14fd0ef1f4cb7e52e58ba5a222570937ddbf` | Independent lossless encoder fixtures |
| jxl-rs | `07ab48fcccde0a73c384b4011520fec67e5e09cd` | Independent decoder |
| jxl-oxide | `c0cc4c7ea57c1207f38ff2970d94757470613be4` | Independent decoder |
| imazen/jxl-encoder | `v0.3.1`, `d63e9d1a1aa84b2dbdfc90eeddccc33fef5eb48b` | Independent encoder fixtures and comparison |
| jxltran | `5d7ae715e9e83014cbf88ab5c6f6985ece2715c1` | JPEG transcode development oracle |

The lossless Modular generator verifies the SHA-256 of the libjxl v0.12.0 source archive before it
labels any output with that revision. The pinned archive hash is
`818398895831069902e3677d285054a7d1255b11b221e94c6aaa1cb83b0a3f29`. The current 33-case
matrix records 29 exact decodes, zero pixel mismatches, and four explicit unsupported results.

## 20. Browser demo architecture

The `/jpeg-xl/` route uses the existing Astro and worker boundaries. All codec work runs locally in
a worker. Messages include a request ID and generation. A new request cancels stale work. Responses
with an old generation are ignored. Large `ArrayBuffer` values are transferred, not cloned.

The worker has separate commands for JPEG recompression, pixel-lossless encoding, and JXL
inspection/decode. Each command validates input limits and returns bounded summaries. Object URLs
are revoked when outputs change or the page closes. Downloads require an explicit user action.

The page explains pixel-lossless output and exact JPEG reconstruction as separate results. It shows
the exact policy, equality check, hashes, source reads, managed memory, and unsupported reason. The
layout and controls are keyboard accessible, retain visible focus, honor reduced motion, and are
checked at the required responsive widths.

## 21. Package and bundle boundaries

The package retains zero `dependencies` and zero `optionalDependencies`. Production code is strict
TypeScript from this repository. Oracles remain development-only tools.

`purejsimage/codecs/jpegxl` contains the ordinary codec. `purejsimage/jpegxl` contains inspection,
exact transcode, and reconstruction. Bundle gates measure both entries independently. The root,
browser, and all-codecs graphs are checked to confirm they do not import the specialized transcode
entry, native code, or WASM.

Package type tests cover every public example. The package version, release tags, npm publication,
and merge remain outside this project.

## 22. Capability rollout policy

`capabilities/manifest.json` is the only manually edited public capability source. Generated README,
support page, website tables, public JSON, LLM discovery, and test expectations are regenerated with
`npm run capabilities:generate`.

The JPEG XL checklist separates structure inspection, Modular decode, VarDCT decode, JPEG-derived
pixel decode, exact reconstruction, Modular encode, exact transcode, metadata, progressive final
decode, progressive output, animation, HDR, Level 5, and Level 10.

An item is checked only after its focused tests and independent evidence pass. Lossy VarDCT requires
an `independent-oracle` declaration with a named oracle, fixed tolerance, and executable test path.
Unchecked items remain unsupported or planned. The implementation returns explicit errors at those
boundaries.

## 23. Milestone checklist and acceptance gates

### Checkpoint and corpus

- [x] Record a clean starting branch, current `origin/main`, package version, and Node version.
- [x] Record the current focused JPEG XL baseline: 6 test files and 62 tests pass.
- [x] Write the first complete architecture checkpoint before broad implementation.
- [ ] Add the complete typed corpus taxonomy and pinned oracle manifest.
- [x] Run the starting capability matrix against every available pinned fixture.

### Segmented source and inspection

- [x] Move container parsing into `jpegxl-container.ts` with format-specific limits.
- [x] Add a logical segmented codestream `ImageSource` for raw, `jxlc`, and `jxlp` input.
- [x] Parse headers and table-of-contents data without a complete codestream copy.
- [x] Add public bounded immutable `inspectJpegXl()` output for the implemented Modular subset.
- [ ] Prove exact logical and physical source reads for local and range sources.

### Modular decode

- [x] Complete required predictors and weighted prediction against the 14-predictor libjxl matrix.
- [x] Complete delta palette and palette-index prediction.
- [x] Complete horizontal, vertical, multi-channel, and odd-size squeeze.
- [x] Complete 8/10/12/16-bit gray, RGB, and RGBA with exact native samples.
- [ ] Complete alpha, color, ICC, orientation, group crop, and row release gates.

### VarDCT and JPEG-derived pixel decode

Progress note: the registered codec decodes all five pinned single-group XYB VarDCT files.
The matrix covers gray and RGB DCT8, DCT2, DCT8x4, AFV1, AFV3, DCT32x32, DCT16x8, and DCT8x16,
plus default Gaborish, all three default EPF stages, adaptive DC smoothing, and deterministic
synthetic noise. The progressive file uses a level-1 Modular DC frame and three shifted AC passes.
Every file stays within one sample value of pinned `djxl` 0.12.0 output, with RMSE below 0.5. The
two JPEG-derived reconstruction fixtures also decode through the normal codec. Multiple VarDCT
groups, chroma upsampling, patches, splines, alpha, and unsupported color syntax still fail
explicitly.

The selected renderer supports raw strategy IDs 0, 2, 5, 6, 7, 12, 13, 14, 15, 16, and 17.
Raw strategy 1 Hornuss remains unsupported and is not claimed by the capability manifest.

- [x] Decode the pinned selected 8-bit single-group XYB VarDCT corpus to fixed oracle tolerances.
- [ ] Cover required transforms, XYB, upsampling, restoration, patches, splines, and noise.
- [x] Decode final progressive images.
- [x] Decode JPEG-derived JXL image data to the original JPEG oracle pixels.
- [ ] Keep animation and unsupported color or extra-channel syntax explicit.

### Exact JPEG reconstruction and transcode

Progress note: the bounded `jbrd` structural header, marker order, table descriptors, scan script,
padding metadata, and direct Exif or XMP size references are parsed and validated. A bounded
first-party Brotli subset decodes the uncompressed opaque marker payload in the pinned libjxl file.
The inverse path now extracts the exact marker layout, Huffman and quantization table grouping,
progressive scan script, opaque APP and COM bytes, and trailing bytes from eligible 8-bit JPEGs. It
writes a bounded first-party `jbrd` payload. Both pinned progressive JPEG sources round-trip through
that new writer and the existing reconstruction parser byte for byte before any JXL output is
accepted. The initial subset rejects inter-marker fill data and non-canonical entropy streams.
The specialized transcoder now emits original first-party JPEG-derived VarDCT with DCT8 blocks,
natural coefficient order, raw quantization tables, one shared prefix histogram, and explicit
`jbrd`. It accepts the pinned progressive RGB 4:4:4 and YCbCr 4:2:0 sources plus one-group
progressive, SOF1 sequential, and sequential multiscan reference JPEGs. The required path verifies
the final JXL by reconstructing and comparing every source byte before returning. Disabled and
prefer policies use the Modular pixel encoder only when `pixel-lossless` is explicit, and
`onlyIfSmaller` rejects a non-beneficial result instead of discarding the input.
The JPEG-derived VarDCT path now decodes LF global state, custom block contexts, DC groups, AC
metadata, raw DCT8 quantization tables, custom coefficient orders, RGB and YCbCr channel layouts,
and AC groups. The public `reconstructJpegFromJpegXl()` path recreates the pinned progressive RGB
4:4:4 and YCbCr 4:2:0 JPEGs byte for byte and with the recorded SHA-256 without reading source-JPEG
coefficients. The reproducible local matrix also passes byte-exact 12 MP multi-group baseline 4:2:2
and progressive 4:2:0 camera JPEGs, including successive-approximation refinement scans. Grayscale,
restart, broader metadata, compressed Brotli, and cross-encoder corpus gates remain incomplete, so
the full reconstruction acceptance items stay unchecked.

The reverse matrix also proves PureJsImage output through pinned `jxlinfo` and `djxl`, including
byte-exact reconstruction and pixel equality with pinned `cjxl` output. Ordinary JPEG-derived pixel
decode now obtains image coefficients without parsing `jbrd`. Malformed or unsupported byte-layout
metadata does not block valid checked-subset pixels, while the explicit reconstruction API still
requires and validates `jbrd`.

Exact eligibility now also validates display semantics before coefficient work. Source Exif
orientation must be absent or 1, and ICC must be absent or the checked deterministic sRGB profile.
Inspection and every reconstruction policy use the same bounded validation. This prevents exact
byte reconstruction from hiding a JPEG XL codestream that would display with a different
orientation or color meaning.

- [ ] Parse and validate `jbrd` and every required referenced metadata box.
- [ ] Reconstruct eligible JPEG corpus entries byte for byte and by SHA-256.
- [x] Extract a reusable bounded JPEG coefficient and scan representation.
- [x] Transcode the eligible baseline and progressive JPEG subset without RGB.
- [x] Enforce reconstruction, fallback, and `onlyIfSmaller` policies without silent mode changes.

### Pixel-lossless encoder

Progress note: the normal pipeline now exposes deterministic lossless Modular output for `gray8`,
`gray16`, `rgb8`, `rgb16`, `rgba8`, and `rgba16`, as either a raw codestream or one `jxlc`
container. A bounded full-frame input buffer feeds 1024 by 1024 Modular groups with a shared global
tree and measured Huffman codes. PureJsImage and pinned `djxl` decode the native samples exactly.
The remaining independent decoders, representative compression corpus, metadata, color-semantics,
and sequential-output gates remain open. On the fixed 512 by 384 RGB8 benchmark, effort 1 writes
156,693 bytes versus 181,608 bytes from pinned `cjxl` 0.12.0 at lossless effort 1. Both decode to
the exact source pixels. This one fixture does not establish a broad compression claim.

The encoder now requires explicit full-range sRGB gray or RGB semantics. Missing, unspecified,
linear, source-profile, ICC-backed, limited-range, and premultiplied semantics fail with
`UNSUPPORTED_OPERATION`. Encoder benchmarks report managed memory as unavailable when no live
ledger measurement exists rather than using a false zero.

- [x] Encode all required 8-bit and 16-bit pixel formats deterministically.
- [ ] Decode every output through four decoder paths with exact native samples.
- [ ] Support raw and one-`jxlc` container output plus selected metadata.
- [x] Measure the fixed compression gate and keep the encoder experimental while the broader
  corpus remains open.
- [ ] Prove bounded memory and sequential output.

### Evidence, benchmark, browser, docs, and package

- [x] Add JPEG XL evidence scopes and off/summary/trace parity tests.
- [x] Add `npm run bench:jpegxl` with correctness-gated isolated RSS workloads.
- [x] Run the JPEG XL benchmark hillclimb and log every retained or rejected attempt.
- [x] Add the local-only `/jpeg-xl/` worker workbench and real-browser coverage.
- [x] Add the public guide, API docs, generated capability surfaces, discovery surfaces, and
  changelog.
- [x] Add independent package size gates for ordinary and specialized entries.

### Final gates

- [ ] Pass every focused corpus, mutation, exact-round-trip, package, browser, and benchmark gate.
- [ ] Pass `npm run browser:check`, `git diff --check`, and `npm run check`.
- [ ] Create coherent commits and push the dedicated feature branch.
- [ ] Verify required workflows on the exact pushed SHA without merging or publishing.

An item is complete only after its stated evidence passes. Locally implemented behavior is not a
public capability until the manifest and generated surfaces match that evidence.
