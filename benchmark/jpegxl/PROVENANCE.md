# JPEG XL encoder provenance inventory

## Reopening on 2026-10-13

[The owner decision](LOSSY_LIBJXL_REOPENING.md) allows source-informed ports and
bitstream decision transplants. Step 1 came before all ports and was committed
as `b2666b83`. Aaron then authorized Step 2. The current ports below are
development experiments; they are not selected by the public encoder.

| Our module | Source and exact revision | Material and changes |
| --- | --- | --- |
| `lossy-lab/libjxl-chroma-roundtrip-port.ts` | libjxl `lib/jxl/enc_group.cc`, QuantizeRoundtripYBlockAC and ComputeCoefficients, v0.12.0 `a7a9c787341cf703dede03c2009fa460cae5e5df` | Quantize and reconstruct Y before forming chroma residuals. Uses our existing rounding policy and normative bias values. Bridges our B-minus-original-Y working plane to prediction from reconstructed Y; no native thresholds, SIMD or infrastructure copied. |
| `lossy-lab/libjxl-quantization-port.ts` | libjxl `lib/jxl/enc_ac_strategy.cc` and `lib/jxl/enc_adaptive_quantization.cc`, v0.12.0 `a7a9c787341cf703dede03c2009fa460cae5e5df` | Transform selection's sixteenth-norm quantization estimate and AdjustQuantField's distance-dependent maximum/mean blend. Scalar TypeScript consumes our raw quantizers, normalizes the norm by its maximum, and rounds the final adjusted field to wire integer precision. This does not port InitialQuantField or its perceptual refinement loop. |
| `lossy-lab/libjxl-strategy-port.ts` | libjxl-tiny `encoder/enc_ac_strategy.cc`, `8eae18172059d54f5c734ca814f23b96eebff859`; libjxl `lib/jxl/enc_ac_strategy.cc`, v0.12.0 `a7a9c787341cf703dede03c2009fa460cae5e5df` | Tiny coefficient entropy/loss constants and rectangular split costs; v0.12 entropy estimate, spatial eighth-norm loss, channel/ringing weights, distance modulation, small-transform biases and hierarchical square/rectangle costs. Scalar TypeScript uses our transforms, quantizer and writer. Maximum-footprint quantization replaces the sixteenth norm. Tiny masking is constant one. Floating merge passes are omitted. The optional error guard is our own. |
| `lossy-lab/libjxl-strategy-mask.ts` | libjxl `lib/jxl/enc_adaptive_quantization.cc`, v0.12.0 `a7a9c787341cf703dede03c2009fa460cae5e5df` | Cubic-root/gamma derivative ratio, pixel Laplacian mask and five-by-five mask-blur weights. Scalar loops consume our XYB samples with padded extents and clamped borders. Managed full-plane scratch is development-only and requires a bounded replacement before production promotion. |
| `lossy-lab/libjxl-gaborish-port.ts` | libjxl `lib/jxl/enc_gaborish.cc` and `lib/jxl/enc_heuristics.cc`, v0.12.0 `a7a9c787341cf703dede03c2009fa460cae5e5df` | Five inverse-Gaborish weights, normalization and unit channel strength. Our scalar convolution uses a bounded 12x12 block halo and clamped borders. No SIMD, threading or source memory infrastructure is copied. |
| `lossy-lab/libjxl-dc-port.ts` | libjxl `lib/jxl/enc_adaptive_quantization.cc` and `lib/jxl/quant_weights.h`, v0.12.0 `a7a9c787341cf703dede03c2009fa460cae5e5df` | InitialQuantDC distance curve and DC matrix constants. Return physical DC precision to our writer while preserving its AC scale; test DC smoothing separately. |

Source reading order: libjxl-tiny commit
`8eae18172059d54f5c734ca814f23b96eebff859`, then libjxl v0.12.0 commit
`a7a9c787341cf703dede03c2009fa460cae5e5df`. Initial reads cover frame setup,
adaptive quantization, AC strategy and chroma-from-luma in tiny, then frame
heuristics and quantizer representation in libjxl. The decision extractor uses
our existing decoder. Forced maps are decoded from fresh wasm-vips streams.
The full libjxl LICENSE is in the packaged THIRD_PARTY_NOTICES and docs site.

The expanded transplant uses our existing normative inverse transforms to define
forward transforms, including AFV and DCT64. It re-encodes decoded native Modular
reference samples with our entropy writer, and inverts our decoder's signaled
Gaborish kernel mathematically. These development modules contain no libjxl
decision-logic port. Source reads of `enc_heuristics.cc` and `enc_gaborish.cc`
established the order of patch subtraction and preconditioning in Step 1, before
the optimized 5x5 preconditioner was ported in Step 2. Signaled-map replay leaves
unsignaled pixel preconditioning in the residual, along with quantizer rounding
and entropy coding.

The strategy experiment also tests our actual rate-aware rounding and normative
reconstruction biases in place of the source model's nearest-integer estimate.
This is an explicitly measured adaptation, not an exact reproduction of libjxl.
The joint Gaborish/strategy experiment computes masking before preconditioning
and transform costs after it, preserving the source ordering.
The reopened coupled investigation adds `spatial-source`: it uses the source
quantization norm and field adjustment instead of maximum-only aggregation.
It also uses unscaled normative matrices inside the source cost estimate;
signaled chroma scales remain applied by the writer.
Trials starting from extracted peer fields use final signaled quantizers, not
the unsignaled initial floating-point field used inside native selection.
All further ports must add our file, source file, exact commit and material taken
to this inventory, and the required source header to each module.

This inventory follows [LOSSY_STEERING.md](LOSSY_STEERING.md). It describes the
current tracked first-party encoder as of 2026-10-09. It changes no runtime
constant. Aaron must request any rewrite of an existing peer-derived heuristic.

The line references below describe the 2026-10-09 checkpoint. Later source moves
and the current candidate's verification are recorded in
[the lab log](lossy-lab-log.md) and [evidence index](lossy-lab/EVIDENCE.md).

The historical audit used repository source and the specific log entries listed
below. It did not read peer encoder source or native internal-state outputs.
Historical log statements establish what the earlier campaign did. They do not
record a new approval. The 2026-10-13 reopening now authorizes source reading and
decision transplants. Earlier restrictions below describe the 2026-10-09 policy
and are superseded for future work.

## Current correctness repair

Promoted source `1224c8a8`, initially preserved in `54c07fba` and qualified on
main in `a49a70f9`, restores the existing
standalone Q7/DC precision after coarse optional-storage refusal. It adds no
new quantization values or perceptual model. Its original 797,262-byte budget
and 2.5 mean-error limit remain unchanged. The complete native and Rust grids
pass, and its current full repository check passes 4,000 tests. All fresh speed and browser gates pass. All 1,253 normal promotion streams
match the qualified prior main with no managed increase. The repair has zero
compression delta on those identical ladders. Both independent decoders qualify
all 80 preserved effort-9 screen streams, and the strengthened promotion audit
passes. Historical compression measurements keep their original producer identity.
The final eleven-distance photo and separate non-photo reports are in
[the campaign summary](lossy-lab/FINAL-SUMMARY.md). All five main CI jobs pass.

This repair and its qualification use peer tools as encoders, decoders and
scorers only. The uncertain numeric origins in the older inventory below remain
open. The preserved oracle metadata correction records the helper's actual
distance 9 without replacing its original stream or measurements.

## Format and color definitions

These values implement format defaults or color mathematics. Their appearance in
another encoder is not evidence of a borrowed encoder heuristic. The default
table classification is supported by the shared forward/inverse implementation;
this audit did not independently check specification clause numbers.

| Current source | Definition | Classification |
| --- | --- | --- |
| `src/codecs/jpegxl-vardct-quantization.ts:1`, `:62`, `:74`, `:99`, `:107`, `:122` | Default DCT8, Hornuss, DCT4x8, DCT16, DCT32 and rectangle matrices; default quantization biases | JPEG XL normative defaults. Keep distinct from choosing a matrix or precision for an image. |
| `src/codecs/jpegxl-vardct-encode.ts:81`, `:97` | Default opsin forward matrix and cube-root bias `0.0037930732552754493` | Format color transform, shared with the decoder. |
| `src/codecs/jpegxl-vardct-encode.ts:93` | Piecewise sRGB inverse transfer | Standard color conversion. |
| `src/codecs/jpegxl-vardct-forward-transforms.ts`, `src/codecs/jpegxl-vardct-large-transforms.ts` | Transform basis, coefficient layout and normalization | First-party implementation of format transforms. The choice of transform is an encoder heuristic. |
| `src/codecs/jpegxl-vardct-encode.ts:1163`, `:1181` | CfL signaling in units of `1/84`, signed byte bounds | Format representation. Estimating covariance from source blocks is the encoder's choice. |
| `src/codecs/jpegxl-vardct-encode.ts:1209` | Unit bias and `magnitude - 0.145 / magnitude` decoded centroids | Normative reconstruction used by the rate-aware quantizer. Rate penalties surrounding those centroids are heuristics. |
| `src/codecs/jpegxl-vardct-coefficient-model.ts:16`, `:86` | 458 coefficient contexts and the current writer's remaining-nonzero/previous-symbol context semantics | Format coding context definitions. Learned probabilities, backoff and training population are separate encoder decisions. |

## Peer-informed history and known numeric origins

No nonnormative numeric constant in the entries below is confirmed by the cited
records to have been copied verbatim from a peer encoder. There is a documented
peer-informed modeling lineage. Numeric origin remains uncertain where the
records do not establish it; this is not an independence certificate for every
older constant.

| Current source | Constant or heuristic | Known provenance and remaining uncertainty |
| --- | --- | --- |
| `src/codecs/jpegxl-vardct-large-select.ts:510`, `:542`, `:549` | Adapted log-cone response, adaptation `1/256`, squared precision exponents `0.5` and `-0.25`, mean absolute directional log-light curvature | Peer-informed derivation. JXLENC-2384 (`benchmark/optimization-log.md:5011`) records a peer-source observation about a separate perceptual light coordinate. JXLENC-2386/2388 (`:5015`) then records an independently derived reciprocal derivative and a source scan choosing `1/256` and exponent `1/4`. JXLENC-2396 (`:5037`) records own image trials of contrast strength `0.125`; the current squared weight uses twice the precision exponents. The history supports development-photo calibration, not verbatim peer constants. General adaptive quantization remains allowed; future peer-source or internal-state fitting is forbidden. |
| `src/codecs/jpegxl-vardct-encode.ts:1113` | Fine score `exp(-1.6781207211372964 - 0.12447059956385063 log(max(1.431434608338262e-7, gradient)) + 0.11768501802984889 log(max(2.3679842775034314e-7, meanY)))` | Own output-error regression. JXLENC-2215/2218 (`:4540`) records the simpler log-gradient/log-meanY fit and spatial validation; JXLENC-2225 (`:4554`) explicitly calls the related target an own-reference model. No evidence here that these five fitted values came from peer source or a native internal field. The small training set is a limitation. |
| `src/codecs/jpegxl-vardct-encode.ts:59`, `:1489`, `:1502` | Fine allocation variance guard, `0.94` proxy budget, X0/B1, half-Y rate weights | Own trial choices. JXLENC-2199 (`:4522`) calls X0/half-Y a first-party source-only hypothesis and separates it from the oracle allocation teacher. JXLENC-2214 (`:4538`) and the historical fine-allocation summary (`:14`) record subsequent own-file trials. Exact origin of the initial six-percent choice is not established by these entries. |
| `src/codecs/jpegxl-vardct-encode.ts:751` | Channel-specific DC steps and the split at distance 2 | Own development calibration with peer-source exposure nearby. JXLENC-052 (`:1206`) records actual trials of `1/16384, 1/4096, 1/2048`. JXLENC-053 (`:1208`) explicitly records reading native DC and patch code for guidance. That does not prove these numeric steps were copied. Origins of later RGBA/photo steps need further own-history tracing. |
| `src/codecs/jpegxl-vardct-coefficient-model.ts:148`, `:159` | One-pseudocount support/token backoff, training on original coefficients and orders | Own normalized conditional probability model. JXLENC-2528 (`:5504`) describes the first-party model and replacement of the earlier magnitude-plus-support proxy. It uses the current format contexts, rather than importing a peer model. |
| `src/codecs/jpegxl-vardct-large-select.ts:275`, `:431` | Magnitude-plus-COUNT normalization; aggregate original-error budget; finite supported-policy solve | Own objective and constraint. JXLENC-2533 (`:5528`) identifies the original-derived normalization. JXLENC-2564 records the later original-error-budget query. No peer constant is identified. The physical error proxy is not a perceptual-quality guarantee. |

## Heuristics whose original numeric provenance is not established

These require own-history clarification or independent lab evaluation. Do not
label them normative merely because they are longstanding.

| Current source | Heuristic |
| --- | --- |
| `src/codecs/jpegxl-vardct-encode.ts:660` | Base `quantAc = 4` and distance-to-global-scale mapping. |
| `src/codecs/jpegxl-vardct-encode.ts:117`, `:118`, `:1123` | Candidate strategy set, nine-Q menu, activity/brightness/variance thresholds and initial Q4-Q8 assignments. |
| `src/codecs/jpegxl-vardct-encode.ts:1173`, `:1203` | Y penalties `0.1/0.05`, chroma penalties `0.04/0.02`; magnitude proxy `1 + 2 log2(1 + magnitude)`. |
| `src/codecs/jpegxl-vardct-encode.ts:1219`, `:1331`, `:1397` | Sharpness maxima 2/3, contrast-loss target `0.04`, refinement limit Q8, endpoint fade and half-active sharpness admission. The sigma conversion at `:1385` uses format relationships; its strength cap is development calibration. |
| `src/codecs/jpegxl-vardct-large-select.ts:227` | COUNT histogram add-one smoothing over 256 token bins. |
| `src/codecs/jpegxl-vardct-encode.ts:293`, `:673`, `:735`, `:746`, `:1857`, `:2259` | Pixel-count and distance admission windows. See the [gate audit](lossy-lab/gate-audit.md). |
| `src/codecs/jpegxl-modular-encode.ts:4760`, `:4794`, `:5480`, `:5550`, `:5593` | Visible-color cutoff, document/background tests, alternate candidate windows and byte-saving margins. |

## Historical techniques that are not current production rules

JXLENC-2380 and JXLENC-2415/2415-r1 describe native initial/post-transform field
captures and transferred partitions. The tracked encoder does not consume those
captures. They must not be reused for fitting or new encoder decisions.
JXLENC-2584/2586 describe the native-inspired original-footprint maximum-Q
diagnostic. That constraint is in ignored research prototypes, not the current
tracked large selector. The interrupted fine prototype is also not production.

The provenance gaps above remain open. No runtime value has been rewritten, and
no new independence, compression, speed or quality result is claimed by this
inventory.

Allocation sweep, 2026-10-14: `lossy-lab/allocation.ts` reuses the already recorded
`libjxl-dc-port.ts` InitialQuantDC port. The geometric blend and global AC scale
are owner-specified experiments implemented by first-party development hooks;
no additional libjxl code or constants are introduced. The native-map Gaborish
diagnostic reuses `libjxl-gaborish-port.ts` with all signaled maps fixed.

Step C, 2026-10-14 (libjxl v0.12.0 commit
`a7a9c787341cf703dede03c2009fa460cae5e5df`):

| Our module | Source file | Material taken and adaptation |
| --- | --- | --- |
| `lossy-lab/libjxl-initial-quant-port.ts` | `lib/jxl/enc_adaptive_quantization.cc`, `lib/jxl/quantizer.cc`, `lib/jxl/enc_heuristics.cc` | InitialQuantField local differences, fuzzy erosion, mask/gamma/HF/blue modulation, distance dampening, initial global-scale policy. Scalar TypeScript and Math functions; our B-Y plane is converted algebraically for blue modulation. Managed scratch and floating precision through selection. |
| `lossy-lab/libjxl-quantization-port.ts` | `lib/jxl/enc_adaptive_quantization.cc`, `lib/jxl/enc_ac_strategy.cc` | Extend the existing AdjustQuantField port to preserve fractional values until final raw-field rounding. |
| `lossy-lab/libjxl-standalone-port.ts` | `lib/jxl/enc_heuristics.cc` | Initial field before inverse Gaborish, transform selection before field rounding. Reuses attributed DC, selector and Gaborish ports; keeps our CfL, chroma scales, EPF and coefficient writer. No peer decisions. |
| `lossy-lab/libjxl-filter-port.ts` | `lib/jxl/enc_frame.cc`, `lib/jxl/enc_heuristics.cc` | Effort-7 Gaborish admission, EPF iteration thresholds, sharpness 4 and no-Gaborish initial-field distance rescale. The direct research variant uses these defaults to avoid deriving EPF from the discarded own transform search. |

Selector speed adaptations in `libjxl-strategy-port.ts` and
`selector-block-cache.ts` are first-party: a bounded tile cache, nonnegative
partial-cost pruning, Y-first scoring with the original accumulation order,
and tile-local traversal. `selector-transforms.ts` derives direct forward
formulas from our normative inverse transforms. The compact search menu is an
explicit research approximation, evaluated separately from the full selector.

Step C continuation, 2026-10-14, uses the same v0.12.0 commit
`a7a9c787341cf703dede03c2009fa460cae5e5df`:

| Our module | Source file | Material taken and adaptation |
| --- | --- | --- |
| `lossy-lab/selector-tile-mask.ts` | `lib/jxl/enc_adaptive_quantization.cc` | Existing Laplacian and Blur1x1Masking port evaluated per 64x64 tile with a three-pixel halo. Preserves the full-plane formula, Float32 storage and accumulation order while bounding scratch. |

The optional three-block-row luma ring in `libjxl-initial-quant-port.ts` preserves
the initial-field formula and removes the full luma plane. The quarter-resolution
mask and block field remain proportional to image area. The optional half-strength
HF modulation, EPF sharpness and iteration experiments are first-party adaptations
of the already attributed ports. `selector-transforms.ts` and `selector-inverse.ts`
use mathematical DCT symmetry to share dot products at mirrored samples; these
are first-party formulas, without additional source-code ports.
The continuation also measures physical InitialQuantDC step multipliers of 0.5
and 0.25, DC smoothing off, and our ordinary AC rounding as independent diagnostic
variants. The AC global scale retains the original source policy during DC-step
experiments. These are first-party parameter adaptations, not new source ports.

Further development-only allocation diagnostics retain half-size luma DC steps
and vary chroma DC steps to 0.75 or 1 times InitialQuantDC. The rejected dark-HF
variant blends HF strength from the source value to half strength using mean
XYB luminance. These are first-party adaptations of the attributed formulas.

Guard investigation, 2026-10-14: the coherent mode also measures DC smoothing
off and global HF strengths 0.375 and 0.625. These are first-party parameter
adaptations of the previously attributed InitialQuantField formula. No additional
source material or peer decisions are introduced. A first-party contiguous
intermediate DCT experiment was measured and removed after a speed regression.

The follow-up Gaborish source cache and signed-byte AC storage with Int16
exceptions are first-party storage adaptations. The Gaborish weights and
convolution accumulation order are unchanged. Coefficient compaction changes
no quantized value; dense planes retain their original Int16 storage.

The writer-estimate continuation tests final AdjustQuantField wire precision,
our rate-aware rounding with normative reconstruction bias, and signaled chroma
matrix scales inside the existing selector. It also tests 0.75 and 1.25
multipliers of the attributed information-loss weight. These are first-party
adaptations of `libjxl-strategy-port.ts` and `libjxl-standalone-port.ts`; their
libjxl source files and v0.12.0 revision are unchanged. No new source material
or peer maps are consumed. `forwardPairedSelectorTransform` in
`selector-transforms.ts` is a first-party optimization that reuses mirrored
pixel sums and preserves the existing arithmetic order.

The channel-rounding continuation in `libjxl-strategy-port.ts` separates actual
writer rounding for luma and chroma, normative reconstruction bias after integer
rounding, and nearest decoded-centroid rounding without a rate penalty. These
are first-party experiments on the existing attributed selector, not additional
libjxl ports. All six aliases in `libjxl-standalone-port.ts` retain the same field,
DC and filter policy and use the already verified paired-input transform.

These six rejected variants are archived in `lossy-lab/CENTROID-EXPERIMENT.patch`
and removed from the active TypeScript modules after measurement. The patch
preserves the modules' existing attribution and adds the focused tests needed
to reproduce the experiments.

The 2026-10-15 merge-guard continuation adds a first-party per-cell luma error
constraint to the attributed standalone selector. `lossy-lab/selector-merge-guard.ts`
contains bounded tile-footprint copying and budget checks, with no third-party
source. The selector tests eighth-power and RMS residual budgets, optional luma
writer rounding and relative tolerances. Existing libjxl file/revision attribution
is unchanged; no additional source material or peer decisions are consumed.
The same continuation tests a soft penalty for the worst per-cell luma norm
increase and 0.9/1.1 multipliers on the coherent initial AC precision field.
These are first-party cost/allocation experiments on the attributed ports.

`lossy-lab/selector-inverse-weights.ts` is a first-party inverse-DCT optimization.
It copies existing cosine weights into dot-product order, hoists coefficient
orientation/strides, and preserves the arithmetic order of `selector-inverse.ts`.
No libjxl source is copied for this optimization. It adds a bounded constant cache
of at most 21,760 bytes across all supported DCT dimensions (5,376 bytes for the
retained compact menu), with no source-sized scratch allocation.

The rejected 2026-10-15 guard and AC-allocation code, its tests and the measured
inverse variant are reproducible from `lossy-lab/MERGE-EXPERIMENT.patch` on base
`a9275832`. Only the inverse-weight optimization remains active after cleanup.

The next 2026-10-15 continuation tests first-party initial-field multipliers
1.025, 1.05 and 1.075 on the retained inverse selector. The existing DC,
global-scale, filter and high-frequency policy is unchanged. These adjustments
consume no new source material or peer decisions. The allocation variants are
rejected and preserved in `lossy-lab/AC-FOLLOWUP-EXPERIMENT.patch` for base
`6f282d51`; they are removed from active code.

| Our file | Source file and revision | Material and changes |
| --- | --- | --- |
| `lossy-lab/selector-mask-loss.ts` | libjxl `lib/jxl/enc_ac_strategy.cc`, v0.12.0 `a7a9c787341cf703dede03c2009fa460cae5e5df` | Eighth-power spatial loss, already ported in `libjxl-strategy-port.ts`. First-party row traversal preserves arithmetic order while removing per-pixel division and remainder. Uses the existing bounded mask with no additional allocation. |

The same continuation tests a bulk TypedArray copy for contiguous 8-pixel-wide
candidate planes and complementary fine/coarse distance envelopes for AC
precision. These are first-party adaptations with no new third-party material.
The combined mask/copy mode retains all 576 development streams exactly and
adds no allocation. Separate component modes remain explicit development
comparators; neither is selected individually. The source, measurements and
control against unchanged Git source are recorded in `lossy-lab/AC-FOLLOWUP-REPORT.md`.

The guard-focused follow-up freezes the coarse allocation envelope together
with the exact mask/copy kernel as `standalone-guard-coarse`. This reconsiders
the average-neutral envelope because it lowers the worst admitted development
SSIM regression from 7.677% to 7.192%. The envelope is our own development fit,
not an additional libjxl port. It multiplies the existing floating initial field
before selection and wire rounding, retains physical DC/global scale and uses
no peer decisions. Promotion eligibility remains explicit and restricted to the
frozen standalone finalists.

The next 2026-10-15 continuation tests first-party error estimates in
`selector-dc-error.ts`, `selector-gaborish-error.ts` and
`selector-correlation-error.ts`. DC reconstruction uses our existing forward
DC grid and normative low-frequency reconstruction. Filtering uses our
decoder's default Gaborish kernel with candidate-local clamped borders.
Correlation propagates luma error through the decoder's AC and DC CfL ratios,
including the existing B-minus-Y working-plane convention. These experiments
consume no new third-party code, source constants or peer decisions. Combined
trials reuse the already attributed quantizer, matrices and selector. Scratch
view reuse and row coefficient traversal preserve the existing arithmetic.

The same continuation reads the pipeline ordering in libjxl
`lib/jxl/enc_heuristics.cc`, v0.12.0
`a7a9c787341cf703dede03c2009fa460cae5e5df`: CfL maps are computed after inverse
Gaborish. `selector-source-correlation.ts` adapts our existing block-centered
covariance estimator to that filtered source, once per bounded selector tile.
It ports no libjxl CfL estimator or constants. Channel-separated trials and
initial-quantizer-squared weighting are first-party experiments.

All fifteen continuation trials are rejected or unretained after the screens,
two full labs and isolated cost comparisons. Their modules, selector options
and tests are preserved in `lossy-lab/SELECTOR-ERROR-EXPERIMENT.patch` for
`c706e64d`; they are removed from active code. The active encoder and tests
return exactly to that revision. No additional third-party port is promoted.

| Archived module | Source and exact revision | Material and changes |
| --- | --- | --- |
| `lossy-lab/selector-source-correlation.ts`, in `SELECTOR-ERROR-EXPERIMENT.patch` | libjxl `lib/jxl/enc_heuristics.cc`, v0.12.0 `a7a9c787341cf703dede03c2009fa460cae5e5df` | Post-Gaborish CfL ordering only. The covariance estimator, bounded tile execution and optional quantizer weighting are ours; no native CfL search code or constants are copied. The archived module carries the source, revision and BSD-3 header. |

## Native coefficient CfL continuation, 2026-10-17

| Our file | Source and exact revision | Material and changes |
| --- | --- | --- |
| `lossy-lab/libjxl-cfl-port.ts` | libjxl `lib/jxl/enc_chroma_from_luma.cc` and `lib/jxl/enc_heuristics.cc`, v0.12.0 `a7a9c787341cf703dede03c2009fa460cae5e5df` | Quantization-weighted AC fitting, fast least-squares and clipped Newton objective, regularization, 2.6 shrinkage, signed rounding and bounds, DCT8 initial fit followed by selected-transform/raw-quant final fit. Scalar double accumulators, Float32 weighted coefficients, existing first-party transforms and shared bounded selector scratch. B-minus-Y uses an equivalent zero-base residual. DC correlation stays at our default. No peer maps or runtime dependency. |

Stage-separated, writer-scaled and shrinkage-free diagnostics use the same
attributed solver. A following selector experiment restores the already
attributed native small-transform menu while keeping our existing 32-pixel
maximum merge footprint. Separate half-transform, AFV and incumbent-driven
adaptive menus are first-party speed experiments. No new constants are taken.

All nineteen screens and the complete-menu/final-field full lab are rejected.
The new port, all trial aliases and tests are preserved in
`lossy-lab/CFL-MENU-EXPERIMENT.patch` for `fba646a8` (encoder source matches
`c706e64d`). The patch applies cleanly; these experiments are removed from
active code. `lossy-lab/CFL-MENU-REPORT.md` records the measurements and the
remaining hypotheses. No new source logic is promoted.

## Reconstruction-driven EPF continuation, 2026-10-17

| Our file | Source and exact revision | Material and changes |
| --- | --- | --- |
| `lossy-lab/libjxl-ar-port.ts` | libjxl `lib/jxl/enc_heuristics.cc`, ComputeARHeuristics and ComputeBlockL2Distance, v0.12.0 `a7a9c787341cf703dede03c2009fa460cae5e5df` | Sharpness candidates, distance threshold, squared initial masking, XYB weights and no-smoothing preference. Reconstruct our final coefficients using existing first-party normative transforms and filters on 64x64 tiles with an eight-pixel halo. Preserve unsmoothed DC; the iteration diagnostic restores native iteration counts. Other modes keep the retained one-iteration cap. Error accumulators use doubles. No peer maps. The native histogram multiplier simplifies exactly to one because its integer count/total ratio is always zero. Additional menus, luma-only and unmasked losses, and minimum-gain guards are first-party experiments. |

Source audit correction: `encode.cc` maps effort to `10 - effort`; `common.h`
defines kKitten=2 and kSquirrel=3. `FindBestQuantizer` in
`enc_adaptive_quantization.cc` runs normal perceptual refinement only through
kKitten. It therefore skips that refinement at our effort-7 target.
The existing full BSD-3 license and npm/docs inclusion remain unchanged.

All nine AR screens are rejected. The port, its source header and tests are
preserved in `lossy-lab/AR-FORWARD-EXPERIMENT.patch` for `1f8d6a5a`; active AR
code, aliases and normative-kernel exports are removed. The same patch also
preserves the separate first-party writer experiment. Its existing transform
kernels contain no new third-party decision logic.
