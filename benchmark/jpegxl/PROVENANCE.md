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
