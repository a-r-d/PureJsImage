<!-- Generated from capabilities/manifest.json by npm run capabilities:generate. Do not edit directly. -->
# JPEG XL lossless-first support plan

This document is the capability contract for PureJsImage's first-party JPEG XL
project. It has separate targets for static pixel
decode, pixel-lossless Modular encoding, and coefficient-domain JPEG transcoding
with exact JPEG reconstruction. Only the checked items below are implemented.


## Additional sample, color and animation qualification

- [x] Render twelve independently encoded VarDCT inputs with integer or binary16/binary32/custom float color and alpha, straight and associated alpha, including linear HDR reference blends, with static alpha exact, blended alpha within 0.00000012 and linear color within 1/255 in Node and three browsers
- [x] Check 24 mixed-alpha and wide-integer layouts against pinned libjxl 0.12.0 float output, including 24/31-bit integer alpha and integer color with Float32 alpha
- [x] Independently decode custom floating fields, Float32 animations and lossy Modular float output; retain exact alpha and source semantics
- [x] Compare RGB LUT8/LUT16 XYZ ICC output with LittleCMS and HLG/PQ/custom-primary associated-alpha forward output with pinned libjxl
- [x] Preserve integer RGB ICC and integer GRAY ICC plus alpha through ordinary keepIcc JPEG XL output
- [x] Read independent native float group crops under a budget below source-wide staging; verify isolated cold/warm resources against identical full native extraction

Ordinary native Modular decoding accepts legal JPEG XL floating-point fields, including the independently checked 24-bit/8-exponent and 16-bit/4-exponent layouts, as finite Float32 rows. Integer gray/RGB with floating alpha emits normalized rgbaf32. Alpha may use unsigned depths through 31 bits. Opaque unsigned color through 31 bits retains exact gray32/rgb32 samples and depth on re-encode. Integer color with wide or floating alpha uses normalized Float32 and reports precision loss. Wider integer VarDCT display remains unsupported.
Float ICC conversion supports GRAY curves and RGB matrix/TRC, mAB, LUT8 and LUT16 A2B0 profiles. RGB legacy LUT XYZ conversion is independently qualified against LittleCMS. Structured PQ/HLG/linear HDR supports relative custom primaries; source-primary linear output retains highlights and tone-mapped output uses sRGB8. Nonrelative custom conversion and profiles without supported HDR transfer metadata remain unsupported.
Lossless ordinary JPEG XL encoding preserves explicitly retained matching GRAY/RGB ICC profiles for integer and Float32 samples. Equal expanded gray-alpha RGB channels fold back to native grayscale; unrelated RGB samples cannot use a GRAY profile.
Ordinary native Modular CMYK with a supported embedded mft2 A2B0 profile accepts unsigned C/M/Y/black through 31 bits or legal floating samples. It emits straight sRGB8/16 with mixed or associated alpha. Floating black is supported. Source CMYK preservation requires native extraction. Other CMYK profile families remain unsupported; constant 2x black/alpha grids retain their earlier independent rendered qualification.
Ordinary grayf32/rgbf32/rgbaf32 output defaults to bit-exact lossless binary32 in a Level 10 container. Explicit lossy mode rounds color mantissas in Modular coding while preserving Float32 storage and exact alpha. This mode has no progressive passes and no perceptual quality equivalence claim. Float32 animation writing and selected HDR XYB VarDCT frame rendering are supported. HDR reference composition uses linear color before the output transfer curve. Forward integer VarDCT writing accepts HLG, relative custom chromaticities, associated alpha and nondefault intensity targets; a separately qualified opaque RGBA8 photo subset can select DCT16. Other larger DCT/AFV choices and Gaborish remain unsupported by the forward writer.
Independent unshifted native Modular groups decode intersecting crop bands without retaining full source channel planes. Global transforms, shifted extras, dependent groups and composition retain their declared native-plane or canvas/reference fallbacks. Output rows and color tables are reserved before decoding. Native integer/float encoding stages planar samples and retains compressed sections and output assembly within configured budgets.

Evidence lives in benchmark/jpegxl/gap-completion. Remaining boundaries include transformed implicit-palette prefix layouts, nonrelative custom color, other CMYK/ICC transform families, progressive floating-alpha stages, and native source CMYK re-encoding through the ordinary RGB API. Wider VarDCT integer input, float VarDCT writing and progressive animation writing remain unsupported. Existing comparison speed and size measurements retain their original pinned build.

## M10 Level 10 native precision and profiles

- [x] Verify a machine-readable Level 5 and Level 10 map for syntax, metadata, rendered pixels, raw channels, display conversion, encoding, reconstruction and limits
- [x] Decode the official binary32 fixture bit exactly with 64-bit weighted-predictor working values and intentional 32-bit sample wrap
- [x] Preserve unsigned integer samples through the JPEG XL maximum of 31 bits and IEEE binary16/binary32 bit patterns through bounded native lossless encoding
- [x] Select the minimum valid output level, emit jxll=10 for Level 10 and reject conflicting raw or Level 5 requests
- [x] Include dimensions, total pixels and ICC profile size in automatic Level 5 or Level 10 selection
- [x] Write general forward VarDCT at explicit Level 10 and select it automatically for exact Modular alpha above 12 bits
- [x] Stream Level 10 VarDCT animation in an unbounded jxlc container without whole-output buffering
- [x] Extract CMYK, black and independent alpha planes; convert profile-defined CMYK to RGBA8 with straight integer or IEEE alpha
- [x] Convert IEEE binary16/binary32 gray and RGB native layers to straight RGBA16 with mixed integer or IEEE alpha, shifted alpha, zero-alpha handling and nonfinite rejection
- [x] Compare binary16/32 gray and RGB color with opposite-width IEEE or 8-bit integer alpha, straight or associated, against 17 pinned libjxl 0.12.0 float-plane and RGBA16 references, including shifted alpha
- [x] Compare unshifted 24- and 31-bit integer alpha on Float32 gray/RGB with pinned libjxl rendered references
- [ ] Compare other shifted float/alpha precision pairs with pinned independent rendered references
- [x] Convert high-depth GRAY/RGB/CMYK ICC native layers directly to straight sRGB16, including gray alpha and mixed or associated alpha, with pinned LittleCMS 2.16 perceptual references
- [x] Write shifted native samples across multiple 1024-pixel Modular groups and convert shifted CMYK black and alpha planes with the signaled kernel
- [x] Match the shifted alpha, black and binary16 depth native grids against pinned jxl-oxide pre-upsampling decoded samples on odd multi-group images
- [x] Run all 39 pinned official valid cases successfully, with no expected-unsupported cases left
- [x] Accept Level 10 writer output in pinned libjxl djxl and rerun all M9 gates after the last production edit

The older native CMYK RGBA8 helper retains its separate associated-alpha restriction; ordinary row conversion supports associated alpha. The shifted native-grid oracle uses a pinned jxl-oxide decoder build instrumented before extra-channel upsampling.

## M9 production hardening

- [x] Twelve cross-feature workflows cover progressive selection, orientation, HDR and alpha fallback, high-depth native channels, animation timing, references, exact JPEG reconstruction, metadata invalidation, fragmented sources and strict fallback policy
- [x] Twelve mutation families cover containers, entropy, Modular transforms, VarDCT reconstruction, progressive dependencies, animation, ICC and extra channels, exact JPEG data, writers, display conversion and worker/API limits
- [x] Twelve resource cases cover stalled reads, section/frame/pixel/metadata limits, computation and fetch cancellation, sink failures, pending writes, early return, reuse and malformed late sections with zero managed ownership after cleanup
- [x] Packed public imports and browser-safe conditional exports are checked on Node 22 and 24; the public API runs in Chromium, Firefox and WebKit
- [x] Evidence admission requires exact case identities, source revision, a clean checkout, raw hashes, measured thresholds and internally consistent summaries
- [x] One bounded pull-request smoke gate runs pinned conformance plus M9 integration and hostile-input checks; full package, browser, fuzz, oracle, benchmark, memory and evidence matrices run locally

These gates harden the declared capability subsets. The M7 qualification below records the static lossy capability decision. Release authorization is separate. M10 reruns the M9 gates after its last production change.

## M8 sequence and native channel APIs

- [x] Independent header discovery, timed composited frame iteration, decimal tick timestamps, exact rational timebase, loop and timecode metadata
- [x] Explicit still-frame selection, index/timestamp replay, separate native layers, four reference slots and caller-owned output
- [x] Streamed lossless and Experimental lossy animation encoding with exact alpha, rectangles, references, orientation and cancellation
- [x] Typed native channel extraction, grouped shifted VarDCT alpha/depth and binary16 sample preservation
- [x] Bounded native planar encoding with matching original GRAY/RGB ICC profiles, including high-depth gray plus alpha
- [x] Global implicit delta palettes, M3 previous-channel MA-tree properties, custom inverse opsin, custom upsampling and custom Gaborish/EPF reconstruction
- [x] Independent comparisons for all 39 official cases; M10 promotes the final CMYK and binary32 native cases and every applicable Level 5 case passes
- [x] Native patch/progressive dependencies, all eight patch blend modes in Modular and XYB, YCbCr chroma reconstruction, shifted-alpha/color upsampling, and noise/spline interactions

Sequence output uses explicit full-canvas buffers and replay without a decoded sequence cache. Native extraction does not imply display conversion. See docs/jpegxl-sequences.md for ownership, budgets, timing, channel representation and level classification. The checked Level 5 corpus passes; unrestricted display of every native channel layout is not claimed.

## M6 progressive sessions

- [x] Lazy header indexing, aggregate header budgets and no pixel decode at session open
- [x] Explicit session close, one active iterator, bounded caches and source identity checks
- [x] Separate embedded preview, complete DC, completed pass and requested final events
- [x] Native denominators 2 and 4 use signaled pass boundaries; opaque denominator 8 omits main-frame HF data
- [x] Shared execution/explanation planner with all eight coordinate orientations and restoration halos
- [x] Selective group reads and declared static dependency fallbacks with strict rejection
- [x] Task-scheduled rendering cancellation, immutable output snapshots and iteration backpressure
- [x] Progressive Modular DC dependencies checked against pinned native stage outputs
- [x] Selective XYB VarDCT SDR alpha, SDR16, linear16 and PQ16 DC and pass stages with pinned libjxl color oracles and early section reads
- [x] Selective linear16 plus alpha stages with early LF reads, a pinned jxl-oxide partial first-pass RGBA image, and pinned libjxl 0.12.0 final pixels
- [x] Selective associated 2x shifted alpha when its native plane fits one global group; preserve source alpha meaning
- [x] Compare SDR8 and linear16 first-pass RGBA plus PQ16 first-pass alpha with pinned independent jxl-oxide partial renders before final payload
- [x] Selective SDR8/16 and linear/PQ16 stages with group-local integer alpha, global Squeeze dependencies, associated 2x shifted alpha, cross-group crops, replay, cancellation and memory limits

Use `openJpegXlSession` from `purejsimage/jpegxl`. `preview()` emits the separately encoded embedded image. `native()` rejects unavailable native boundaries. `progressive()` emits complete stages, and `decode()` defaults to final output. A final event validates the requested region and its dependencies, not unread unrelated groups.

DC reconstruction uses compact LF state and restoration bands. Alpha retains its full native plane; grouped alpha can require HF global data and later AC sections before DC output. Global Squeeze requires every alpha group, while color reconstruction remains selective. Plans report this storage and include every alpha dependency section. Pass and final output retain a full-resolution output; high-depth and HDR passes retain full working planes. Multiple or floating alpha, Modular main images, patches, splines, noise and other reference dependencies use their checked static paths; a plan states the fallback. The ordinary pipeline retains final-image semantics and the JPEG-derived reduced-IDCT path remains separate.

The session does not add generic read-ahead over a caller-provided source. HTTP transfer bytes still depend on that source's explicit block and cache policy. Its section-byte counter excludes metadata probes and transport overfetch. See `docs/jpeg-xl.md` for ownership, cache budgets, stage availability and memory accounting.

The frozen M6 cohort contains 30 functional fixtures and ten original-resolution photographs. Final benchmark and full handoff gates are recorded in `docs/architecture/jpegxl-m6-m10-completion.md`.

Ordinary native Modular decoding accepts legal JPEG XL floating-point fields, including the independently checked 24-bit/8-exponent and 16-bit/4-exponent layouts, as finite Float32 rows. Integer gray/RGB with floating alpha emits normalized rgbaf32. Alpha may use unsigned depths through 31 bits. Opaque unsigned color through 31 bits retains exact gray32/rgb32 samples and depth on re-encode. Integer color with wide or floating alpha uses normalized Float32 and reports precision loss. Wider integer VarDCT display remains unsupported. Float ICC conversion supports GRAY curves and RGB matrix/TRC, mAB, LUT8 and LUT16 A2B0 profiles. RGB legacy LUT XYZ conversion is independently qualified against LittleCMS. Structured PQ/HLG/linear HDR supports relative custom primaries; source-primary linear output retains highlights and tone-mapped output uses sRGB8. Nonrelative custom conversion and profiles without supported HDR transfer metadata remain unsupported. Lossless ordinary JPEG XL encoding preserves explicitly retained matching GRAY/RGB ICC profiles for integer and Float32 samples. Equal expanded gray-alpha RGB channels fold back to native grayscale; unrelated RGB samples cannot use a GRAY profile. Ordinary grayf32/rgbf32/rgbaf32 output defaults to bit-exact lossless binary32 in a Level 10 container. Explicit lossy mode rounds color mantissas in Modular coding while preserving Float32 storage and exact alpha. This mode has no progressive passes and no perceptual quality equivalence claim. Float32 animation writing and selected HDR XYB VarDCT frame rendering are supported. HDR reference composition uses linear color before the output transfer curve. Forward integer VarDCT writing accepts HLG, relative custom chromaticities, associated alpha and nondefault intensity targets; a separately qualified opaque RGBA8 photo subset can select DCT16. Other larger DCT/AFV choices and Gaborish remain unsupported by the forward writer.

Ordinary native Modular CMYK with a supported embedded mft2 A2B0 profile accepts unsigned C/M/Y/black through 31 bits or legal floating samples. It emits straight sRGB8/16 with mixed or associated alpha. Floating black is supported. Source CMYK preservation requires native extraction. Other CMYK profile families remain unsupported; constant 2x black/alpha grids retain their earlier independent rendered qualification.

## M5 static processing

- [x] JPEG XL to JPEG, PNG, WebP, AVIF and TIFF through the public pipeline
- [x] Crop, resize, contain, cover, orientation normalization and explicit metadata preservation or stripping
- [x] Native 8-16-bit crop and resize, independent alpha ranges, and float RGBA resize with bounded row buffers
- [x] Linear-light sRGB resize uses the actual source sample range; float linear RGB and RGBA retain highlights
- [x] Pixel-lossless JPEG XL re-encode inherits color and alpha precision, orientation and luminance metadata
- [x] Explicit pixel conversion is required before an encoder that cannot retain JPEG XL sample precision
- [x] Known 8-bit PNG color signals are preserved; incompatible or unavailable color conversions fail explicitly
- [x] Planner reports native format, sample depths, color semantics, source orientation, pushed crop and scale, conversions, encoder options and decoder working storage
- [x] Planner reports full-frame VarDCT output and any decode performed while opening the decoder
- [x] Nearest and linear-light filters bypass coefficient reduction; other eligible JPEG-derived resizes use reduced floating-point IDCT
- [x] Bounded HTTP Range reads across segmented jxlp, operation cancellation and source reuse
- [x] Browser workbench opens, inspects, resizes and exports representative native-depth, P3 and HDR inputs

Use `.jpegxl()` to retain supported native integer samples. To export 10- or 12-bit
samples to PNG storage, use `.convertPixelFormat({ format: "rgb16" }).png()`.
That explicit step scales the declared range to all 16 output bits. Use `rgba16` for alpha.
For display output, choose `rgb8` or `rgba8` explicitly. Pixel conversion changes storage
and range; it does not change transfer functions or primaries.

Open supported P3 input with `colorOutput: "srgb"` for explicit sRGB conversion.
Open PQ or HLG with `hdrOutput: "tone-map-srgb"` for explicit SDR rendering.
Ordinary GRAY/RGB ICC and structured SDR conversion support integer samples through 16 bits. Nonrelative custom-color conversions
remain errors. Ordinary static IEEE float input preserves finite source samples in float32 rows; ordinary lossless JPEG XL encoding preserves binary32 sample bits and matching retained ICC profiles.

VarDCT retains a full output frame. Eligible ordinary 8-bit photographs use bounded
restoration bands, while high-depth, alpha and other documented fallback cases retain
full working planes. Planner working-byte estimates exclude runtime and process overhead.
Ordinary VarDCT opening and `explainImage()` index headers without decoding pixels. JPEG-derived coefficient opening remains eager; `io.pixelDecode` reports that cost.

Progressive range-aware processing is M6 and is outside the M5 static boundary.

- [x] Encode sparse RGB16 effort-7 groups with sorted per-channel palettes and optional index RCT; verify native samples, partial groups and allocation limits
- [x] Encode multi-group effort-1 integer gray/RGB/RGBA with per-channel prefix or ANS models, constant-channel offsets, sampled prediction, local reversible color transforms and bounded single-history repeat coding; retain the smaller complete section representation and verify exact 8/16-bit samples in native libjxl and Rust
- [x] Encode unsqueezed, unpaletted effort-7 integer gray/RGB/RGBA groups with bounded learned gradient and weighted-error trees, per-leaf prediction and shared ANS histograms; retain smaller existing candidates and verify exact 8/16-bit samples in native libjxl, Rust and Chromium
- [x] Compare optional four-times prediction training for eligible effort-7 integer groups, through 262,144 samples per plane; retain the previous complete group on ties or allocation-limit failure, preserve original native samples and working-budget streams, and verify Node, libjxl, Rust, Chromium, Firefox and WebKit
- [x] Compare optional 256-pixel effort-1 groups, 512-pixel effort-7 groups with bounded local reversible color, and refined flat-background patch display trees for eligible lossless sRGB RGB8/RGBA8 inputs; retain complete previous files, preserve original samples and working limits, and verify Node, libjxl, Rust, Chromium, Firefox and WebKit
This optional lossless search applies from 262,144 through 4,194,304 pixels at sample depth 8. It keeps each completed ordinary and patch file, and selects an alternative only when the complete file is strictly smaller. Extra local planes, training buffers and compressed candidates count against maxWorkingBytes. Ties or optional allocation-limit failure retain the prior completed file; cancellation propagates with cleanup. The flat patch-display alternative samples at most 16,384 positions for local color selection and lowers its tree split overhead. Ordinary and JPEG coefficient trees keep their prior policy. All 45 independently exact comparable cells on the pinned integer-lossless corpus and all four separate original-size controls meet frozen peer size. This adds encoding work and does not establish broader lossy, float, CMYK, animation, speed or RSS parity. See benchmark/jpegxl/comparison/GROUP-SEARCH.md.
- [x] Compare bounded learned prediction for existing effort-7 integer RGB/RGBA palette groups; retain the complete previous group search, promote only smaller output, preserve prior working-limit fallback, and verify exact 8/16-bit samples, hidden RGB and group boundaries in native libjxl, Rust and Chromium
- [x] Compare bounded learned prediction within the three existing effort-7 RGBA8 palette orders through 1,048,576 pixels with no delta colors; preserve all prior per-order variants and complete files, recover optional working-limit failures, and verify original samples, hidden RGB, original limits and real Chromium output
- [x] Reduce eligible non-progressive effort-7 sRGB RGBA8 artwork through 1,048,576 pixels with opaque palette-edge quantization at distances 2 through 25; preserve every occurrence of colors found in uniform 2 by 2 regions, exact alpha and original input, and verify native/Rust grids, browser fixtures and natural working-limit recovery
This optional lossy candidate rounds green to a distance-scaled grid and shifts red and blue by the same amount, with clipping. Colors from uniform 2 by 2 regions remain exact throughout the image. The palette has at most 2,048 colors. Preserve the previous VarDCT or Modular winner as a complete size floor; select quantized output only when its complete codestream saves at least 5% against that winner. The container adds its existing bytes. Classifier, lookup tables, copied pixels and candidate storage share maxWorkingBytes; optional storage failure retains the previous complete output. Checked smaller graphic files do not establish tight target matching or general compression parity. Previous paired cost reports retain their pre-correction source identities; current cost confirmation remains open.
- [x] Compare legacy prefix, shared ANS and field-specific ANS for learned Modular tree metadata; preserve every node, signed threshold and adjoining bit field, retain the prefix on ties or optional working-limit failure, and verify full 8/16-bit native/Rust grids and Chromium output
Optional learned-tree metadata search counts serialized candidates, symbols, context IDs and bounded histograms against maxWorkingBytes. Tiny trees retain the original prefix policy. Full-width packed values that exceed uint32 skip the ANS trial. Candidate output admission precedes appending bits; temporary storage closes before prefix fallback. Every checked original required working limit remains accepted. This changes tree coding and adds encoding work; it does not establish general compression parity.
- [x] Compare six independent per-histogram hybrid integer layouts for effort-7 learned literal groups; score serialized ANS histograms and extra bits, keep smaller complete sections, retain prior streams on optional allocation-limit failure, and verify exact 8/16-bit samples in libjxl, Rust and Chromium
- [x] Compare one sampled reversible color candidate for unsqueezed, unpaletted single-group RGB/RGBA at effort 7; preserve 8/16-bit samples and alpha, keep smaller actual sections, and retain the baseline when optional search exceeds working storage
- [x] Compare exact lossless sRGB RGB8/RGBA8 reference patches at effort 7 on pale pages and colored flat backgrounds with 262,144 through 4,194,304 pixels; retain smaller complete files and preserve alpha, invisible RGB and nonpatched samples in native libjxl, Rust and Chromium
Lossless reference-patch search reserves another staged display copy and a reference atlas of at most 1,024 by 1,024 pixels within maxWorkingBytes. The flat-background finder also reserves 14 bytes of scratch per source pixel, accepts at least 40 repeated placements and 0.5% covered area, and bounds unique atlas pixels at 262,144. Allocation-limit failures retain the prior encoded candidate. Other formats, depths, efforts and page sizes keep their existing encoding paths.
- [x] Compare three or four prefix models for RGB8/RGBA8 reference-patch metadata; separate constant reference IDs and replacement modes from numeric fields, compare all serialized feature bits, and preserve every patch field and adjoining pixel-section bit in native libjxl, Rust and Chromium
Patch metadata retains the original prefix stream as a bit-inclusive size floor. Optional context bytes, four bounded histograms and compressed candidates count against maxWorkingBytes and add no source-sized bitmap. Ties or optional storage failure retain the original feature bits. Consumed token and entropy scratch is released before final assembly, preserving the checked prior minimum storage boundaries. This changes metadata encoding only and does not establish general compression parity.
- [x] Accept the bounded local three-scalar-palette transform chain with optional index RCT
- [x] Decode group-local Modular transform chains, including one or more scalar palettes before RCT; verify RGB8/RGB16 samples, odd partial groups, cross-group crops, replay, cancellation and inverse allocation limits
- [x] Decode all 16 pinned public-comparison lossless inputs exactly, including the seven previously rejected native-libjxl streams
- [x] Decode group-local transforms separately from retained global Palette prefix planes
- [x] Decode pinned multi-group global Palette and Squeeze streams with exact RGB8/RGB16 samples, cross-group crops, replay, cancellation and memory-limit checks
- [ ] Qualify remaining global delta Palette combinations and transformed prefix layouts across native formats and depths

Grouped Modular inverse allocations are bounded before group pixel decoding. Global palettes without spatial prediction retain their prefix tables and intersecting group bands. Global Squeeze, spatial Palette prediction, progressive passes and shifted prefix layouts use compact full-frame native channel planes; the planner reports that fallback. The global implicit delta-palette exception keeps its separate bounded path. Local group streams exclude the already-decoded global prefix planes and invert their own transforms before the global chain.

## M7 static forward encoding

Static forward encoding is Stable within the documented integer gray/RGB/RGBA subset. Use `.jpegxl({ mode: 'lossy', distance: 1, effort: 3, progressive: true })` for forward pixel encoding. `.jpegxl()` stays lossless. Distance must be from 0.25 to 25; zero and lossless/distance conflicts are errors.
- [x] Use finer color DC precision for fully opaque, high-color sRGB RGBA8 at effort 7 and distance above 1, through 4,194,304 pixels; preserve exact alpha and existing AC/filter choices, qualify matched photo quality with independent libjxl/Rust samples, and check regular/progressive output in Chromium
- [x] Compare an exact Modular candidate for regular effort-7 sRGB RGBA8 artwork through 1,048,576 pixels with at most 2,048 visible colors; select only complete files at least five percent smaller, preserve visible colors and exact alpha, and verify boundary, working-budget, cancellation and Chromium behavior
The artwork search retains full Modular candidate planes and compressed sections within maxWorkingBytes. A separate full RGBA8 normalization copy is needed only when fully transparent input has nonzero colors; those hidden colors may be replaced with zero under the existing lossy policy. The classifier and exact candidate share an optional storage scope. Losing candidates release all optional storage; working-storage failure retains the previous complete stream, and cancellation propagates with cleanup. The extra effort-7 search can add substantial encoding time. Other formats, depths, efforts, progressive output, transfer functions and larger images keep their existing paths. Exact artwork savings do not establish matched-quality or general compression parity.

The opaque-photo DC policy requires more than 2,048 visible colors. Its palette check reserves 20 KiB of temporary scratch and adds no source-sized bitmap. If that optional check exceeds working storage, the prior DC policy remains active. Partial alpha, small palettes, images above 16,777,216 pixels, other depths, HDR and lower efforts retain their prior policies.
- [x] Compress nonconstant VarDCT alpha groups at effort 7 with first-party repeat tokens, gradient or left prediction and optional gradient contexts; retain the previous complete-bit size floor, exact native 8/16-bit alpha and unchanged independently decoded colors, including regular/progressive output and Chromium memory fallback
The alpha search reuses bounded group-local residual and repeat scratch for at most 256 by 256 samples. It adds no source-sized bitmap. Optional working-storage failure preserves the prior alpha stream before output is changed. Failure in the additional left-predictor search preserves the selected gradient candidate. Constant groups, lower efforts and JPEG coefficient transcodes retain their previous encoding paths. Checked photo/graphic bytes and quality scores stay unchanged; the recorded transparency gains do not establish general compression parity.
- [x] Learn six channel/transform-family coefficient orders for eligible multi-group effort-7 VarDCT frames; retain a candidate only when its complete file is smaller, preserve independently decoded 8/16-bit colors and exact alpha for regular/progressive output, and verify Chromium output and working-limit fallback
The coefficient-order search requires at least 1,024 blocks and two AC groups. It reuses group coefficient scratch, keeps six 64-position counts and orders, and compares another compressed candidate without adding a source-sized bitmap. Optional allocation-limit failure returns the prior complete stream. Lower efforts, smaller frames and JPEG coefficient transcodes keep their previous encoding paths. The measured file savings do not establish general compression parity.
- [x] Compare six channel/transform-family AC contexts with natural and learned coefficient orders for the same eligible effort-7 frames; select smaller complete files, preserve full independent native 8/16-bit grids and exact alpha, and verify regular/progressive output, cancellation, Chromium and working-limit fallback
The family-context search adds up to two entropy serializations to the existing natural-order and learned-order candidates. Additional histograms, context maps and compressed candidates count against maxWorkingBytes; it adds no source-sized bitmap. If optional family search exceeds that limit, the best completed stream remains selected. Measured graphic and mixed-transform savings do not establish photographic or general compression parity.
- [x] Compare complete local strategy/quantizer metadata with gradient and left prediction for effort-7 forward VarDCT; select only fewer bits, preserve independently decoded native 8/16-bit grids and exact alpha, and verify regular/progressive output, Chromium, working-storage bounds and cancellation
Metadata prediction compares the full local tree, histogram headers and entropy data. Optional scratch and compressed candidates count against maxWorkingBytes and add no source-sized bitmap. Ties or optional allocation-limit failure retain the original metadata stream, and output admission precedes appending any candidate bits. Lower efforts and JPEG coefficient transcodes keep their existing paths. Checked original-size and capped files shrink with identical quality scores; these results do not establish general compression parity.
- [x] Compare separate strategy and quantizer entropy models with zero strategy and left quantizer prediction for the same effort-7 metadata; retain only fewer complete bits and preserve independently decoded native-depth, progressive and Chromium output
The separate-row candidate uses a fixed local tree and five histograms. Its scratch and compressed bytes count against maxWorkingBytes. Ties keep the earlier candidate, and optional row-model allocation failure preserves an already-completed left-prediction result. A replaced compressed candidate is released. Output admission still precedes appending bits, and no source-sized bitmap is added. At that checkpoint all checked public quality settings preserved their decoded grids and scores, and thirteen comparison pairs remained unresolved. Later comparison results retain their separate sources and scope.

- [x] Select aligned DCT16 and rate-aware AC rounding for eligible coarse opaque RGBA8 sRGB effort-7 photos; qualify all six matched-quality photo targets with complete native/Rust and public JavaScript pixels, exact alpha, three browsers, original working-limit fallback and cancellation
The capped-photo search requires regular output, distance at least 6, more than 2,048 visible colors and at most 4,194,304 pixels. It compares additional exact DC and strategy/quantizer tree, repeat and hybrid entropy models with complete bit floors. All per-encode search buffers count against maxWorkingBytes. Working-limit failure unwinds and retries the preceding complete transform path; cancellation propagates with closed ownership and unchanged caller storage. Protected progressive, partial-alpha, RGB3, native 16-bit, HDR, artwork and capped fine-quality paths retain their policies. The six pinned photo targets meet both frozen WASM peer sizes under the original 0.25-score rule. This adds encoding work and raises internal package ceilings explicitly; it does not establish speed/RSS or universal compression parity.

- [x] Extend regular effort-7 opaque standard-sRGB RGBA8 photo search above 4,194,304 and through 16,777,216 pixels; refine fine-quality block precision and AC rounding, larger-photo DC precision and DCT16 selection, and qualify sixteen original-photo files plus three held-out originals with complete libjxl/Rust and public JavaScript pixels
- [x] Compare a 256-cluster, 24-iteration AC model and sixteen legal hybrid configurations per histogram against the preceding complete sections and aligned table-of-contents cost; keep preceding bytes on ties or optional allocation-limit failure and propagate other errors and cancellation
The original-photo policy requires more than 2,048 visible colors and exact opaque 8-bit alpha. Its fine-quality rate map uses one managed byte per 8 by 8 block. Per-encode histograms, maps, scratch and compressed alternatives count against maxWorkingBytes; the additional shared packed-value lookup is bounded to 32 KiB. Optional image-search allocation failure retries the preceding path. Optional AC entropy failure retains the completed preceding entropy model on the same coefficient geometry. Losing candidates release their storage, callers remain unchanged and managed ownership closes to zero. This adds encoding work. The resolved matched SSIMULACRA2 and Butteraugli targets on the pinned unresized 12 MP photo meet both public WASM peer sizes; two exhausted-budget wasm-vips Butteraugli targets remain unresolved. Separate metric estimates do not establish joint quality dominance, speed/RSS parity or universal compression parity.

The current writer supports DCT8, effort-5/7 Hornuss and both rectangular half-block orientations, adaptive quantization, local chroma-from-luma, optional two-pass output, and exact straight alpha at native integer depths. Known-primary sRGB, linear, gamma, PQ and HLG inputs retain their declared source metadata. Relative custom chromaticities, associated alpha and nondefault intensity targets use the separately qualified forward color path. DCT16 is available in the separately qualified regular opaque RGBA8 photo subset. Other larger DCT/AFV strategies and Gaborish remain outside this encoding subset. Opaque standard-sRGB gray/RGB at effort 5/7 and distance 2 or above can use residual-scaled edge-preserving restoration when most blocks need filtering. Quantized AC magnitudes above 4095 are rejected with `UNSUPPORTED_OPERATION`; the writer does not clamp them.
Opaque non-progressive effort-1 frames with 2 through 256 AC groups can use group-local entropy models and reusable scratch. DC averages and AC transforms share one pixel conversion per block. Exact section-size comparison retains the smaller prefix representation when appropriate. All scratch remains subject to maxWorkingBytes; process RSS is measured separately.
Large pale sRGB RGB8 documents at effort 7 and distance 2 or above can use a first-party repeated-component patch dictionary. The writer keeps that two-frame stream only when it saves at least 5% against the selected output. Native and Rust decoders verify the displayed pixels. Other image classes keep their existing encoder paths.

The [static lossy qualification](benchmark/jpegxl/production-program/m7-visual-contrast-qualification.md) closes the registered sunset, screenshot, map and PQ visual defects and records measured compression, runtime, independent-decoder, browser and resource results. The original 240-source splits, capped/original distinction, wide or missing quality brackets, and tested-reference limits remain explicit. The workbench exposes lossless and static lossy controls separately from exact JPEG recompression, with local comparison, download, reopen and cancellation. Lossy animation remains Experimental.

## PR 35 precision, memory and evidence corrections

- [x] Preserve nondefault PQ and HLG luminance fields through storage-only conversion
- [x] Keep gray-alpha source descriptors separate from expanded RGBA pixel semantics
- [x] Render supported gray ICC plus alpha to sRGB; reject preserving the GRAY profile on expanded RGBA without weakening encoder validation
- [x] Check actual encoder allocations before construction and release all ownership on failure
- [x] Validate maxWorkingBytes and maxOutputBytes; keep caller/sink memory and process RSS separate

The nine original holdout assets retain source dimensions and checksums. Every effort-1 and effort-7 pixel result is independently exact, including original 24 MP and 12 MP photographs and two real UI captures. Large photos and screenshots often exceed PNG or libjxl sizes. At that checkpoint advanced effort search was single-group. M7 extends bounded search to larger inputs, with new corpus qualification still in progress. Two separately selected small eligible WPT JPEGs supplement the original ICC-ineligible small photographic case. No original holdout case was removed.

See `docs/architecture/jpegxl-pr35-remediation.md` for the raw gates, selection rules, rounding exception and exact-revision evidence.

## M4 color and metadata

- [x] Convert ordinary structured SDR gray/RGB through 16 bits, including relative custom chromaticities, gray alpha, mixed and associated alpha; check 33 libjxl native/profile and LittleCMS references, default preservation, replay, cross-group crops, PNG/JPEG XL output, cancellation and color-table limits
- [x] Convert ordinary GRAY/RGB ICC integer samples through 16 bits without an 8-bit intermediate; check mixed and associated alpha, constant 2x shifted alpha, group-boundary crops, PNG output, re-encode, cancellation and combined profile/decoder limits

- [x] Exact Modular RGB and gray samples in sRGB, linear sRGB, Display P3, Rec. 2020, PQ, HLG, bounded gamma, and custom chromaticities at 8, 10, 12, and 16 bits
- [x] All eight codestream orientations through `autoOrient()`, display dimensions, and normalized copied Exif orientation
- [x] Straight and premultiplied alpha with independent precision, VarDCT upsampling, explicit multiple-alpha selection, and zero-alpha handling
- [x] Bounded compressed ICC reconstruction, profile validation, supported first-party conversion, and source-profile preservation
- [x] High-depth VarDCT and linear RGB/RGBA float output without clipping HDR to SDR
- [x] Bounded Exif, XMP/XML, JUMBF, common brob, intrinsic dimensions, density, and timestamp metadata

The checked matrix contains 56 structured color cases, 40 independent-alpha cases, 18 high-depth VarDCT color cases, eight VarDCT alpha-upsample cases, and a two-alpha fixture. Pinned libjxl provides independent native or float references. At the M4 checkpoint, official conformance had 13 passes, 25 explicit unsupported cases, no incorrect outputs, and the separately recorded delta_palette failure. M10 later advances all 39 official cases to exact passes. ICC validation records source-profile warnings, including the cafe profile checksum mismatch; extracted profile bytes match djxl exactly.

Use `Image.open(input, { colorOutput: "preserve" })` to retain source-profile or structured Modular samples. Supported GRAY/RGB ICC conversions through 16-bit integer precision can request `colorOutput: "srgb"`. PQ and HLG Modular samples remain encoded unless `hdrOutput: "linear-float"` or `hdrOutput: "tone-map-srgb"` is selected. HDR and wide-gamut XYB reconstruction emits linear sRGB float samples, including negative gamut values and highlights above one. Float HDR uses 203 cd/m2 as reference white. The explicit native-layer ICC API converts supported high-depth GRAY/RGB/CMYK profiles to sRGB16. Ordinary high-depth ICC conversion emits sRGB16 with normalized straight integer alpha; source metadata retains native precision and profile meaning. Explicit structured SDR conversion supports linear, gamma, BT.709, P3, Rec. 2020 and relative custom chromaticities through 16-bit integer precision. Expanded gray-alpha samples retain the GRAY profile as source metadata. JPEG XL re-encoding folds equal RGB values back to gray; a GRAY profile cannot label expanded RGB PNG output. Nonrelative custom-color conversion still throws `UNSUPPORTED_OPERATION`.

`alphaOutput: "preserve"` retains associated samples. `alphaOutput: "straight"` unpremultiplies and sets zero-alpha color to zero. HDR conversions produce straight alpha. `alphaChannel` is a zero-based index and is required when more than one alpha channel is present. Alpha display range is independent of color.

Container payloads require an explicit metadata preservation request. `metadata()` exposes only bounded density and timestamp summaries in addition to image fields. Exif orientation must be normalized before JPEG XL encoding; the `orientation` encode option owns display orientation. The `intrinsicSize` option accepts width and height. `toneMapping` accepts intensityTarget, minNits, relativeToMaxDisplay, and linearBelow; values use finite half precision. Defaults are 10000 nits for PQ, 1000 for HLG, and 255 otherwise. Lossless ordinary JPEG XL encoding preserves explicitly retained matching GRAY/RGB ICC profiles for integer and Float32 samples. Equal expanded gray-alpha RGB channels fold back to native grayscale; unrelated RGB samples cannot use a GRAY profile. Matching profiles can also be preserved into compatible PNG output.

## Current implementation note

A JPEG XL input is either a raw codestream beginning with its two-byte signature or a
box container beginning with the fixed signature box. The container then carries an
`ftyp` box and either one `jxlc` codestream box or indexed `jxlp` fragments. The
first-party codec validates these structures and returns bounded source ranges
without concatenating compressed data. Raw, single-`jxlc`, ordered `jxlp`, and
file-format-version-1 out-of-order `jxlp` codestreams can enter the implemented
pixel subset through one logical segmented source.

The decoder covers the checked lossless Modular and common static VarDCT boundary. It includes
all 27 raw strategies from 0 through 26, restoration filters, progressive reconstruction,
patches, splines, synthetic noise, reference slots, and JPEG-derived RGB or YCbCr coefficients.
The M3 real-photo corpus contains 300 files: all 300 now decode correctly. The earlier internal
Modular tree failure is fixed. M4 adds independently checked color, alpha, and HDR cases.
The ordinary 8-bit sRGB path uses bounded restoration bands. High-depth, float, alpha, and
composition paths use an explicit full-frame fallback. Selected VarDCT crops follow decode.

The normal pipeline exposes a stable deterministic Modular integer encoder for gray8, gray16,
rgb8, rgb16, rgba8, and rgba16 at effort 1, 3, 5, or 7. Explicit color and alpha
precision can be declared from 8 through 16 bits when samples use 16-bit storage.
Lossless grayf32/rgbf32/rgbaf32 rows use the binary32 native writer in a Level 10 container. Source float semantics and explicitly preserved matching ICC profiles remain attached to the encoded samples. Explicit lossy Float32 output rounds Modular color mantissas and preserves alpha. Implicit integer-depth conversion remains unsupported.
The 163-case matrix is exact through PureJsImage, pinned `djxl`, jxl-rs, and jxl-oxide
where applicable. The 156 procedural cases measure the fixed effort-1, effort-7,
PNG and relative-speed gates. Actual encoder backing-buffer ownership has separate budget and cleanup tests. The separate stable
`purejsimage/jpegxl` API transcodes eligible baseline
and progressive one- or three-component 8-bit Huffman JPEGs in the coefficient domain, writes `jbrd`, and
reconstructs and compares every source byte before exact-mode success. Its 250-file real JPEG archive, compression, speed, bounded sink-verification, and browser parity gates pass. Exact transcode
walks APP metadata through EOI and requires Exif orientation absent or 1, Exif color absent or explicitly sRGB, and no ICC or the checked deterministic sRGB ICC.
Pinned libjxl 0.12.0 reconstructs first-party grayscale output byte for byte. Four baseline and progressive grayscale files with odd dimensions, optimized Huffman tables, and restart markers also match pinned `djxl` grayscale pixels within one code.

The checklist below preserves the initial decode roadmap and its original groupings.
Its boxes are historical planning state, not the current capability inventory.
Use the generated milestone sections above and this manifest's boundary, status,
memory and notes fields for current support. Unimplemented operations still fail explicitly.

## Scope decisions

- [x] Prioritize static `image/jxl` decode for upload-processing workflows
- [x] Decode bare JPEG XL codestreams and single-`jxlc` box-based containers for
  the implemented Modular subset
- [x] Implement both Modular and VarDCT decoding for the checked static subset; neither mode alone covers the
  common lossless and lossy image set
- [x] Decode JPEG-lossless-transcode codestreams to pixels without requiring
  bit-exact reconstruction of the original `.jpg` file
- [x] Make one full-canvas still image the first public milestone
- [ ] Apply orientation and color conversion during the pipeline rather than
  returning incorrectly oriented or raw XYB samples
- [x] Keep `libjxl`, `djxl`, `jxlinfo`, and other implementations as pinned
  development-only references and oracles
- [x] Implement production decoding in this repository without a runtime codec
  dependency, native library, WebAssembly module, or copied third-party code
- [x] Add a constrained pixel-lossless Modular encoder through the normal pipeline
- [x] Add explicit coefficient-domain JPEG transcode and exact reconstruction APIs
- [x] Pass the 250-file exact JPEG compression, 12 MP performance, bounded verification, and browser parity gates for the documented subset

## Output modes

The default encoder is a constrained mathematically lossless Modular pixel
encoder. Explicit lossy mode uses the Stable static forward VarDCT subset
described above. Neither pixel mode claims original-file reconstruction.
Exact JPEG recompression is a separate coefficient-domain API with byte-equality gates.

## Group 0: detection, container, and metadata — required for v1

### Content detection

- [x] Recognize the two-byte bare-codestream signature
- [x] Recognize the 12-byte JPEG XL container signature box and fixed signature
  payload
- [x] Use content detection for codec selection; `.jxl` and `image/jxl` are
  hints rather than proof of valid input
- [x] Distinguish a bare codestream from a container before parsing any image
  dimensions or allocating decode state
- [x] Reject truncated signatures and lookalike box files explicitly

### Container parsing

- [x] Parse big-endian box headers with 32-bit lengths, extended 64-bit lengths,
  and boxes extending to end-of-file
- [ ] Validate every box length, nesting level, order, and end offset before
  reading or allocating
- [x] Parse the signature and file type (`ftyp`) boxes and validate the JPEG XL
  brand and supported file-format version
- [x] Read one complete codestream from a `jxlc` box without copying it
- [x] Reassemble ordered and file-format-version-1 out-of-order `jxlp` boxes through a
  bounded segmented reader rather than concatenating them
- [x] Validate `jxlp` indexes, final-fragment signaling, uniqueness, ordering,
  and total compressed-byte limits
- [x] Parse JPEG XL level (`jxll`) and bound frame-index (`jxli`) boxes sufficiently to
  validate and skip them safely
- [x] Skip unknown non-essential boxes by validated extent
- [x] Reject conflicting `jxlc`/`jxlp` representations, missing codestream data,
  duplicate required boxes, and malformed box ordering

### Metadata boxes

- [x] Locate bounded EXIF (`Exif`), XML (`xml `), JUMBF (`jumb`), and JPEG
  reconstruction (`jbrd`) boxes without parsing them during pixel decode
- [x] Recognize Brotli-compressed metadata (`brob`) and skip it safely until a
  bounded first-party Brotli decoder is available
- [x] Expose metadata presence and byte sizes without returning unchecked box
  contents by default
- [ ] Define explicit metadata preservation and stripping behavior for
  JXL-to-other-codec pipelines
- [x] Keep JPEG bitstream reconstruction data independent from image pixel
  decode

### Metadata-only inspection

- [x] Parse basic image information without entropy-decoding image groups for the implemented subset
- [x] Expose bounded immutable inspection for the implemented Modular subset with
  structure, dimensions, orientation, bit depth, channels, alpha, color, level,
  metadata sizes, expected output format, and resource estimates
- [ ] Report width, height, orientation, bit depth, exponent bits, color channel
  count, extra channels, alpha, animation, preview, intrinsic dimensions, color
  description, frame count, and codec level
- [x] Apply configurable input, dimension, pixel, channel, frame, and metadata
  limits before starting full decode
- [x] Register `jpegxlCodec` with format `jpegxl` and MIME type `image/jxl` on the public codec surface

## Group 1: common static codestream decode — required for v1

This group defines the smallest credible JPEG XL upload decoder. It covers the
ordinary output of independent encoders for photographs, graphics, and
losslessly transcoded JPEG files.

### Bitstream and entropy foundation

- [x] Implement a bounded least-significant-bit-first bit reader with exact
  end-of-section checks
- [x] Decode JPEG XL fixed-width fields, compact integers, U32 distributions,
  signed values, and bounded enumerations
- [x] Parse the codestream and frame-header fields, group dimensions, and section
  sizes required by the implemented lossless Modular subset
- [x] Implement the bounded prefix and ANS entropy structures exercised by the
  pinned conformance fixture, including context maps and final-state validation
- [x] Implement bounded LZ77 distances, lengths, repeat offsets, and copies
  across entropy-coded streams
- [x] Reject invalid distributions, impossible symbols, non-final ANS states,
  LZ77 underflow/overflow, and reads past a declared section
- [ ] Support JPEG XL Level 5 codestream features within tighter configurable
  project limits
- [ ] Detect Level 10 inputs and reject them unless every required feature and
  resource limit is supported

### Modular mode

- [x] Parse the global and group headers, unshifted channel dimensions, group origins,
  section dependencies, and stream identifiers required by compatible multi-group Modular images
- [x] Decode meta-adaptive trees with bounded depth, node count, property
  ranges, and context count
- [x] Implement the required Modular predictors, including weighted prediction
  and its state updates
- [x] Decode residuals through the selected predictor and reconstruct signed
  channel samples without overflow
- [x] Complete palette transforms, including delta palettes and palette-index
  prediction
- [x] Implement and independently verify the pinned fixture's reversible color
  transform
- [x] Implement squeeze transforms for horizontal, vertical, and multi-channel
  reconstruction, including odd dimensions
- [x] Apply inverse Modular transforms in the exact reverse dependency order
- [x] Support single-group and compatible multi-group Modular images with shared
  global or per-group local MA trees and unshifted grouped channels
- [x] Support native 8/10/12/16-bit lossless grayscale and the documented RGB/RGBA subset
- [x] Support the pinned Modular sub-images used by VarDCT for low-frequency and control
  data
- [x] Verify the implemented mathematically lossless Modular fixture with exact samples

### VarDCT mode

- [x] Parse LF global data, LF groups, HF global data, HF passes, and pass-group
  sections with validated sizes and dependencies
- [x] Decode the checked quantizer fields, dequantization matrices, block strategies,
  coefficient orders, context models, and chroma-from-luma factors
- [x] Reconstruct DC and low-frequency images before dependent high-frequency
  groups
- [x] Decode progressive high-frequency passes and accumulate coefficients in
  the correct order
- [x] Implement all raw VarDCT strategy IDs 0 through 26,
  with independent full-image fixtures for the previously missing 8x32/32x8, 128x128, 128x64/64x128, 256x256 and 256x128/128x256 transforms; verify odd edges, cross-group crops and bounded scratch admission
- [x] Implement raw strategy 1 Hornuss with pinned independent fixture evidence
- [x] Apply inverse transforms, coefficient scaling, quantization bias, and
  block placement with defined numeric precision
- [x] Reconstruct the pinned XYB samples and perform the inverse opsin transform
- [x] Decode the checked 2x, 4x, and 8x chroma resampling modes
- [x] Implement pinned single-group and multi-group Gaborish and edge-preserving restoration filters
- [x] Decode and render checked patches and splines in valid static images
- [x] Decode and render the pinned synthetic-noise fixtures
- [x] Decode the pinned VarDCT images created from ordinary lossy sources
- [x] Decode the image pixels of pinned JPEG-lossless-transcode codestreams
- [x] Compare lossy output with conformance references using documented numeric
  tolerances

### Static frame and output

- [x] Decode one visible full-canvas frame with the default replace behavior
- [ ] Skip a declared preview and decode the main image by default
- [x] Resolve checked internal DC frames, reference slots, partial-canvas frames, and common static blend modes
- [x] Require explicit displayed-frame selection for animation in the ordinary still API
- [x] Apply all eight orientation values exactly once through explicit autoOrient()
- [x] Return display dimensions after orientation
- [x] Emit bounded, ordered `gray8`, big-endian `gray16`, `rgb8`, big-endian `rgb16`, `rgba8`, or big-endian `rgba16` pixel blocks for the implemented subset
- [ ] Support JXL-to-JPEG, JXL-to-PNG, JXL-to-WebP, crop, resize, and
  resize-plus-encode workflows

### Common samples, alpha, and color

- [x] Native integer grayscale at 8, 10, 12, and 16 bits per sample
- [x] Complete integer RGB coverage at 8, 10, 12, and 16 bits per sample for the current single-group Modular boundary
- [x] One alpha extra channel with independent precision
- [x] Decode the checked common VarDCT straight-alpha form
- [x] Premultiplied alpha with correct unpremultiplication or preservation behavior
- [x] Parse and report the checked sRGB and linear-sRGB gray or RGB encoding and rendering intent
  with distinct source metadata and emitted pixel semantics
- [x] Decode compressed embedded ICC profiles with strict decoded-size limits
- [ ] Render common sRGB, linear sRGB, Display P3, and gray inputs to the
  pipeline's declared output color space
- [x] Handle grayscale and RGB codestream color representations for the compatible Modular subset
- [x] Handle checked 8-bit sRGB XYB codestream color representations
- [x] Preserve native 9-bit and 12-bit integer samples in `rgba16` with per-channel
  display ranges; pipeline normalization requires an explicit pixel conversion
- [x] Reject unsupported color encodings or extra-channel semantics rather than
  treating their samples as sRGB or alpha for the checked subset

## Group 2: common compatibility improvements — should have

These features occur in real JPEG XL files, but a correct single-frame upload
decoder can ship before all of them are complete.

- [ ] Embedded preview decode and explicit preview selection
- [x] Multiple frames required internally by a checked still image
- [x] Checked frame crops, reference slots, save-as-reference behavior, and static blend modes
- [ ] Coalesced first-frame output for animated inputs without claiming full
  animation support
- [x] Out-of-order `jxlp` fragments permitted by newer container versions
- [x] JPEG bitstream reconstruction from `jbrd` to the exact original JPEG file for the checked subset
- [x] Common static PQ, HLG, and linear-light integer inputs with float output
- [x] Ordinary static full-canvas Modular IEEE binary16/binary32 gray/RGB input with integer or IEEE alpha, exact finite float32 rows, crop/resize and explicit finite-range PNG/JPEG XL output; 17 libjxl PFM cases, exact official binary32 samples and three-browser checks
- [x] Ordinary structured SDR conversion for static Modular IEEE binary16/binary32 gray/RGB to straight sRGB16 with integer or IEEE alpha, source-domain straightening, explicit SDR clipping, known primaries and relative custom chromaticities; 17 independent libjxl/LittleCMS references and three-browser pipeline checks
- [x] Ordinary float ICC conversion for supported GRAY curves and RGB matrix/TRC or mAB profiles, plus structured PQ/HLG and linear HDR conversion with source-domain straightening, source-primary linear Float32 output and explicit Reinhard sRGB8 output; independent LittleCMS and exact-gamma FFmpeg/zimg references
- [x] Ordinary lossless grayf32/rgbf32/rgbaf32 encoding preserves finite binary32 bits, associated alpha, source semantics, orientation, intrinsic size, tone metadata and explicitly retained GRAY/RGB ICC; 66 independent libjxl decoded encodings, memory/output limits and sink failure checks
- [x] Native Modular float and integer CMYK composed frames with cropped layers, reference reuse and all five frame blend modes; composition precedes ICC/HDR conversion, ordinary animation requires an explicit frame index, and Node plus three-browser checks cover every displayed frame
- [x] Legal custom floating fields and relative custom-primary HDR conversion
- [ ] Arbitrary ICC conversion families and profile-defined HDR without supported transfer metadata
- [x] Tone-mapping metadata, intensity target, luminance range, and a documented
  SDR conversion policy
- [ ] Wide-gamut Rec. 2020, Adobe RGB, ProPhoto RGB, and uncommon ICC profiles
- [x] Ordinary static full-canvas Modular CMYK integer input through 16 bits with supported mft2 A2B0 profiles; straight sRGB rows, mixed integer/IEEE and associated alpha, constant 2x black/alpha grids, crops, resize and PNG/JPEG XL output checked against LittleCMS 2.17 in Node and three browsers
- [x] Floating CMYK black in ordinary native Modular row conversion
- [ ] Other CMYK profile families
- [ ] Spot-color, selection-mask, depth, and black extra-channel discovery and
  opt-in extraction
- [x] Multiple alpha channels with explicit caller selection for the documented layouts
- [x] Intrinsic-size, pixel-density, and bounded timestamp metadata
- [x] Bounded metadata preservation for Exif, XMP/XML, and JUMBF
- [x] Bounded first-party decompression of `brob` metadata boxes
- [ ] JPEG XL Level 10 features that remain within explicit project limits

## Group 3: JPEG XL advantages — nice to have

- [ ] Progressive preview output from DC, low-frequency, and successive
  high-frequency passes
- [ ] Public reduced-resolution decode without reconstructing discarded
  high-frequency detail
- [x] Group-aware region decode for compatible multi-group Modular crops
- [ ] Decoder-driven downscale that selects only the resolution and passes
  capable of contributing to the requested output
- [x] Expose native high-bit integer decoder output through the shared `rgba16` pixel model
- [x] Finite float32 gray/RGB/RGBA pipeline output, explicit linear HDR output and ordinary float-preserving lossless JPEG XL encoding
- [ ] Opt-in extraction of depth, thermal, CFA, spot-color, and selection-mask
  extra channels
- [x] Native coding-layer access through the explicit sequence API, with unsupported unresolved dependencies reported
- [ ] Diagnostics identifying the box, frame, LF group, pass group, entropy
  stream, transform, or extra channel that caused a failure

## Group 4: explicitly skip

These unchecked items are outside the initial decode-only plan and do not block
JPEG XL v1.

- [x] Animated output, exact timing, looping metadata and checked frame composition through the explicit sequence API
- [ ] Re-encoding or editing frame references
- [ ] Producing an original JPEG reconstruction as a default decode result
- [ ] Unbounded or arbitrary user access to container boxes
- [ ] Encrypted, externally referenced, or vendor-private container extensions
- [ ] Undocumented experimental codestream extensions
- [ ] Treating every extra channel as displayable image data

## Memory and execution contract

- [ ] Bound compressed bytes, box count, metadata bytes, dimensions, pixels,
  frames, channels, extra channels, groups, LF groups, pass groups, passes,
  histograms, contexts, tree nodes, transforms, patches, splines, and decoded
  working bytes separately
- [ ] Use checked arithmetic for canvas and group geometry, channel shifts,
  strides, sample counts, coefficient counts, section sizes, patch extents,
  spline points, LZ77 copies, and allocations
- [x] Read `jxlc` and `jxlp` through segmented views without duplicating the
  compressed codestream
- [x] Decode compatible Modular groups in dependency order, retaining only crop-intersecting
  groups in one group-row band and releasing the band after output
- [ ] Release VarDCT entropy tables, coefficients, restoration buffers, and reference
  state as soon as later groups cannot reference them
- [x] Use compact signed channel planes and one bounded output row rather than a
  second source-sized RGBA decoder boundary for the implemented Modular subset
- [x] Push crop requirements into compatible Modular group selection
- [ ] Push resize and reduced-resolution requirements into group and pass selection
- [ ] Account for concurrent input, section indexes, entropy state, LF images,
  coefficients, Modular transforms, restoration halos, extra channels, color
  conversion, resize state, and encoded output
- [ ] Make any full-frame state required by patches, reference frames, or
  Modular transforms compact, explicit, and separately benchmarked
- [ ] Do not let an optional feature silently turn the normal static-photo path
  into a source-sized float RGB or RGBA allocation

## Correctness and hostile-input contract

- [ ] Treat every box, compact integer, dimension, section size, entropy
  distribution, tree node, symbol, LZ77 copy, transform, coefficient, group,
  patch, spline, frame, ICC field, and extra channel as hostile input
- [ ] Validate the complete allocation graph before allocating large planes or
  coefficient buffers
- [ ] Reject recursive or excessively deep trees, invalid context maps,
  impossible ANS states, oversized histograms, transform cycles, and invalid
  channel dependencies
- [ ] Validate patch source/destination rectangles, spline point counts, filter
  halos, frame crops, blend rectangles, and reference indexes before access
- [ ] Bound compressed ICC and Brotli metadata expansion independently from
  pixel decode
- [ ] Reject unsupported extensions using their declared lengths without
  attempting best-effort entropy decode
- [ ] Add fuzz targets for the bare codestream parser, container parser,
  entropy decoder, Modular transforms, VarDCT reconstruction, color metadata,
  and frame composition
- [ ] Turn every upstream libjxl security advisory relevant to accepted syntax
  into a local hostile-input regression test without copying its fix

## Reference implementations and conformance

- [x] Pin `libjxl` and its `djxl`/`jxlinfo` tools at an exact development-oracle
  version
- [ ] Study libjxl's module boundaries, supported features, test taxonomy,
  low-memory behavior, and security history without copying or mechanically
  translating its implementation
- [x] Pin the official JPEG XL conformance corpus and reference decoded outputs
  at an exact commit
- [ ] Run every applicable conformance codestream through PureJsImage and record
  unsupported cases separately from incorrect pixels
- [ ] Use a second independent decoder, such as a pinned `jxl-oxide` build, to
  investigate disagreements with libjxl
- [ ] Never use conformance to replace project-specific hostile-input, memory,
  crop, resize, and pipeline tests

## Fixtures and benchmarks

- [ ] Pin redistributable fixtures from at least two independent encoders
- [ ] Include bare and container files, `jxlc` and `jxlp`, Modular and VarDCT,
  lossless and lossy, JPEG-transcoded, grayscale, RGB, alpha, 8/10/12/16-bit,
  ICC, orientation, odd dimensions, multiple groups, and progressive passes
- [ ] Include realistic photos, transparent graphics, screenshots, high-entropy
  images, wide-gamut images, and a large downscale workload
- [ ] Record provenance, license, encoder/version, container form, dimensions,
  orientation, bit depth, channels, extra channels, color encoding, mode,
  frames, groups, passes, level, feature flags, and checksums
- [x] Verify native high-bit samples for lossless Modular fixtures against official conformance outputs
- [ ] Use conformance-defined or documented numeric tolerances for VarDCT, XYB,
  ICC, restoration-filter, and HDR output
- [x] Verify every recorded benchmark output before recording speed or memory
- [x] Record isolated full-decode and crop memory for a checksum-pinned 4096x4096
  multi-group fixture with a permuted table of contents and per-group local MA trees
- [ ] Benchmark metadata, full decode, JXL-to-JPEG, JXL-to-PNG, crop, resize,
  reduced-resolution resize, and resize-plus-encode workflows
- [ ] Measure cold and warm absolute peak RSS, RSS delta, external memory, and
  ArrayBuffer memory in isolated processes
- [ ] Compare upload workflows with pinned `djxl`; record Jimp as unsupported
  rather than treating failed decode as a performance result
- [ ] Include malformed container, fragment, header, entropy, LZ77, MA-tree,
  palette, squeeze, VarDCT, patch, spline, ICC, frame, and allocation-limit
  fixtures

## Decode v1 is complete when

- [ ] Group 0 and Group 1 are implemented and covered by pinned fixtures
- [ ] Unimplemented Group 2-4 features fail explicitly rather than producing
  plausible but incorrect pixels
- [ ] Lossless Modular and JPEG-transcoded reference images decode to the
  expected pixels
- [ ] VarDCT output meets the conformance tolerances
- [ ] Static `image/jxl` Buffer input can be inspected, oriented, resized, and
  converted to JPEG or PNG through the public pipeline
- [ ] The common large-photo resize path does not allocate a full
  source-resolution float RGB or RGBA bitmap
- [ ] Independent oracles confirm dimensions, orientation, color, alpha, and
  decoded pixels
- [ ] `npm run check` and the isolated JPEG XL fixture and benchmark
  verification pass

## Standards and implementation references

- [ISO/IEC 18181-1:2024 — JPEG XL core coding system](https://www.iso.org/standard/85066.html)
- [ISO/IEC 18181-2:2026 — JPEG XL file format](https://www.iso.org/standard/91379.html)
- [ISO/IEC 18181-3:2025 — JPEG XL conformance testing](https://www.iso.org/standard/87633.html)
- [JPEG Committee: JPEG XL overview](https://jpeg.org/jpegxl/)
- [JPEG Committee: JPEG XL documentation](https://jpeg.org/jpegxl/documentation.html)
- [IANA media type registry](https://www.iana.org/assignments/media-types/media-types.xhtml)
- [`libjxl` reference implementation](https://github.com/libjxl/libjxl)
- [Official JPEG XL conformance corpus](https://github.com/libjxl/conformance)
