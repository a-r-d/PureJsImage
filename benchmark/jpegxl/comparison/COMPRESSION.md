# JPEG XL compression investigation, October 1, 2026

## Answer

PureJsImage is not at compression parity with libjxl yet. Its large-image
effort-1 path explains much of the quoted lossless gap. Higher efforts improve
compression substantially, but learned Modular prediction trees, color-transform
search and lossy coding decisions still leave measurable gaps. Decoder coverage
and accepted input types do not establish encoder compression parity.

This investigation uses the same pinned inputs and codec source as the public
comparison. No production encoder settings or code changed. Every lossless control
was independently decoded with pinned libjxl and compared against every original
RGBA8 sample. RGB controls remove only completely opaque alpha, after checking
that their RGB samples equal the original RGBA input. The original comparison and
its 23 unresolved lossy targets remain unchanged.

This is the investigation snapshot before implementation changes.
[The compression parity work](PARITY.md) records subsequent encoder changes and
their separately verified outputs. The tables below keep their original source
identity and measured results.

## Same-input lossless results

Sizes below are decimal MB. All rows preserve every sample exactly. Effort
numbers select each encoder's own search policy; equal numbers do not mean equal
algorithms or equal computation.

| 4000 × 3000 photo | PureJsImage | jSquash 1.3.0 | wasm-vips 0.0.19 |
| --- | ---: | ---: | ---: |
| Effort 1 | 15.389 | 9.307 | 8.177 |
| Effort 3 | 7.452 | 7.186 | 7.133 |
| Effort 7 | 7.036 | 6.899 | 6.649 |

The effort-1 outputs reproduce the frozen comparison byte for byte. Increasing
our effort to 3 reduces this file by 51.6%. At effort 7, our file is 2.0% larger
than jSquash and 5.8% larger than wasm-vips. Comparing our effort 7 against a
competitor's effort 1 would hide this remaining gap.

The screenshot still has a larger gap:

| 1920 × 1080 screenshot | PureJsImage | jSquash | wasm-vips |
| --- | ---: | ---: | ---: |
| Effort 1 | 1.892 | 0.819 | 0.653 |
| Effort 3 | 0.757 | 0.514 | 0.505 |
| Effort 7 | 0.576 | 0.391 | 0.422 |

Our effort-7 screenshot is 36.3% larger than wasm-vips and 47.1% larger than
jSquash. The capped 1024 × 768 photo from the earlier comparison remains
759,672 bytes at effort 1 and 611,525 bytes at effort 7. These three examples
do not establish a corpus-wide ranking.

### The large-image fast path

[The effort-1 branch](../../../src/codecs/jpegxl-modular-encode.ts) uses a fixed
left-neighbor predictor, no reversible color transform, one shared prefix-code
histogram and no LZ77 for multiple 1024-pixel groups. A single-group image also
tries an ANS candidate with a reversible color transform and separate channel
contexts. This makes compression policy depend on crossing the group boundary.
Effort 3 enables the adaptive group path, which adds color decorrelation, predictor
selection and ANS models per group.

The shared fast-mode model also mixes constant alpha residuals with RGB residuals.
On the 12 MP photo, removing only the opaque alpha plane changes our effort-1
output from 15,389,193 to 13,729,939 bytes. That is 1,659,254 bytes of extra cost
despite an entirely constant alpha channel. At effort 7 the RGB/RGBA difference is
only 727 bytes. The smaller single-group photo differs by only 46 bytes at effort
1. These controls locate the large alpha cost in the fast coding policy rather
than in image quality.

In the shared Huffman model, a zero residual still needs at least one bit because
other symbols are present. Almost all 12 million alpha residuals are zero, so
that plane alone needs about 1.5 MB before accounting for its effect on RGB code
lengths. A separate constant-channel model can avoid this repeated cost.

Our container overhead is 40 bytes. wasm-vips adds 181 bytes on the large photo
and 176 bytes on the small photo. Metadata cannot explain megabytes of difference.

### Compression tools at higher efforts

The current writer emits either no color transform or YCoCg. It chooses a
predictor per plane/group and optionally uses three signed-gradient context
buckets per channel. It does not learn arbitrary Modular prediction trees or
search the broader reversible color-transform set used by native libjxl.
Weighted prediction is already present; it is not an entirely missing feature.
The 12 photo groups all select ANS with gradient contexts at effort 7. Most
choose weighted prediction for luma and gradient prediction for chroma. None
selects palette, Squeeze or LZ77. The screenshot selects LZ77 in two of four
groups. Simply enabling those existing tools cannot explain away the gap.

The following native controls use exactly the same RGB samples. All decode
exactly. They are configuration controls, not results from the WASM APIs.

| Pinned libjxl 0.12.0, effort 7 | Photo bytes | Screenshot bytes |
| --- | ---: | ---: |
| Defaults | 6,643,349 | 419,356 |
| Fixed YCoCg (`-C 6`) | 6,707,003 | 429,668 |
| Tree learning disabled (`-I 0`) | 8,346,880 | 666,969 |
| Color transforms disabled (`-C 0`) | 10,037,169 | 636,566 |
| 1024-pixel groups (`-g 3`) | 5,702,630 | 391,887 |
| 1024-pixel groups, fixed YCoCg | 6,193,166 | 393,891 |
| 1024-pixel groups, tree learning disabled | 7,909,584 | 763,774 |

The photo is 23.4% larger in our RGB effort-7 path than in the native
1024-group control. Holding native group size at 1024, disabling tree learning
raises its size by 38.7%; restricting the color transform raises it by 8.6%.
These interventions show that modeling and transform search matter. They do not
predict how much a first-party implementation would gain, and their percentages
must not be added together.

The effort-3 `-P 1` and `-I 0` controls retain identical native output. Source
inspection explains why: native effort 3 uses a predefined weighted-predictor
tree rather than its learned-tree path. Those controls therefore do not isolate
left prediction or tree learning at effort 3. The effective learning controls
above use effort 7.

## The lossy gap is real, but attribution needs care

The four artifacts behind the original SSIMULACRA2-80 match retain their recorded
hashes and reproduce their SSIMULACRA2 and Butteraugli scores. All have opaque
alpha. The original interpolated size ratio remains 1.2119935, or 21.2% larger
than wasm-vips. Our SSIMULACRA2 bracket is 79.9302–80.0375; wasm-vips spans
79.9828–80.9346. This is a measured bracketed comparison, not two encodings with
identical quality settings.

The extra bytes are primarily in AC coefficient data. The nearby lower endpoints
show this directly:

| Section | PureJsImage, SSIMULACRA2 79.9302 | wasm-vips, SSIMULACRA2 79.9828 |
| --- | ---: | ---: |
| LF global | 35 | 25 |
| DC group | 13,539 | 17,789 |
| HF global | 873 | 994 |
| AC groups combined | 72,852 | 53,116 |
| Complete file | 87,380 | 72,135 |

The smaller native file spends more bytes on DC/strategy information and fewer
on AC coefficients. Our writer uses strategy IDs 0, 1, 12 and 13: DCT8, Hornuss
and split 8 × 8 transforms. The native stream also uses larger square and
rectangular DCTs, DCT2 and AFV strategies. It enables Gaborish and two EPF
iterations; our matched stream enables neither. The decoder can read these
native strategies, but the forward writer cannot emit all of them.

Native filter controls are recorded separately in
[the lossy filter results](results/compression-lossy-filters.json). They compare
the same normalized RGB input at bracketed SSIMULACRA2 80. Filter effects and
transform effects must not be conflated. The faster-decoding control changes
multiple tools and still retains larger transforms; it does not isolate DCT8.

| Native control | Interpolated bytes at SSIMULACRA2 80 | Change from native default |
| --- | ---: | ---: |
| Default | 70,698 | Baseline |
| Gaborish disabled | 72,812 | +3.0% |
| EPF disabled | 70,277 | -0.6% |
| Gaborish and EPF disabled | 71,929 | +1.7% |
| Faster decoding 4 | 74,411 | +5.3% |

All five curves have measured frontier brackets no wider than 0.25 SSIMULACRA2
points. Raw setting/score inversions remain in the reports. The controls show
that filters alone do not explain the original 21.2% difference. Turning off
both filters still leaves native libjxl well below our 87,481 interpolated bytes.
This points toward the remaining transform, quantization and entropy decisions;
it does not assign the remaining difference to a single tool. The CLI and WASM
paths are separate builds/APIs and produce different streams, so the original
wasm-vips comparison remains its own result. Butteraugli scores remain available
for every point; matching SSIMULACRA2 does not imply matching all quality metrics.

Earlier [larger-transform prototypes](../production-program/m7-prompt14-transform-probes.md)
produced valid streams but regressed protected original-size comparisons and
were reverted. Adding a strategy ID alone is not sufficient. Forward transforms,
DC representation, quantization, coefficient order, entropy modeling and transform
selection need to work together. Current quantization already has bounded local
contrast refinement; the older description of only two quantizer values is not
the complete current policy.

## Work to do before speed optimization

1. Give multi-group fast lossless output color decorrelation and separate channel
   models. Keep alpha in its own model and preserve every sample. Test both sides
   of the 1024-group boundary and retain the existing effort-1 output as a baseline.
2. Add learned or richer bounded Modular context models and group-level reversible
   color-transform search. Measure their independent contributions on photos and
   screenshots, with explicit memory limits and exact independent decoding.
3. Improve the lossy transform, quantization and entropy decisions together.
   Requalify larger transforms and AFV against matched SSIMULACRA2 and Butteraugli,
   including the original-size regressions. Qualify Gaborish separately.
4. Complete the unresolved quality brackets on a broader pinned image set before
   claiming general lossy parity. Keep native precision and alpha gates in place.

No speed optimization or compression-policy change was made in this investigation.

## Evidence and reproduction

Codec source SHA-256:
`088ba519315f3498cd388eaf0c7bef92c0a15c6702107e04219ed486760332ca`.
The clean codec revision is `6947e26`. Reports record full source, input, output
and oracle identities. Test/benchmark dependencies remain development-only.

Validation passed: 73 exact lossless controls, four rescored original lossy
endpoints, and 47 native quality points across five adequately bracketed filter
controls. `npm run check` passed with 3,490 tests and three existing skips.

- [Lossless controls and original lossy artifact inspection](results/compression-investigation.json)
- [Native lossy filter controls](results/compression-lossy-filters.json)
- [libjxl effort documentation](https://github.com/libjxl/libjxl/blob/v0.12.0/doc/man/cjxl.txt)
- [Native fast lossless predictor and YCoCg](https://github.com/libjxl/libjxl/blob/v0.12.0/lib/jxl/enc_fast_lossless.cc)
- [Native Modular effort policies and transform search](https://github.com/libjxl/libjxl/blob/v0.12.0/lib/jxl/enc_modular.cc)

Restore the pinned comparison fixtures/assets and native/metric tools if absent.
Run each diagnostic with the existing Linux process-tree guard. It admits one
benchmark tree at a time, limits memory to 8 GiB and disables swap.

```sh
PUREJSIMAGE_M7_MEMORY_GIB=8 PUREJSIMAGE_M7_CPU_PERCENT=800 \
  node benchmark/jpegxl/run-m7-bounded.ts compression-lossless-unique \
  node benchmark/jpegxl/comparison/investigate-compression.ts \
  .tmp/jpegxl-comparison-v1/compression-investigation.json

PUREJSIMAGE_M7_MEMORY_GIB=8 PUREJSIMAGE_M7_CPU_PERCENT=800 \
  node benchmark/jpegxl/run-m7-bounded.ts compression-filters-unique \
  node benchmark/jpegxl/comparison/investigate-lossy-filters.ts \
  .tmp/jpegxl-comparison-v1/compression-lossy-filters.json

# Revalidate existing artifacts and rescore the original four lossy endpoints.
PUREJSIMAGE_M7_MEMORY_GIB=8 PUREJSIMAGE_M7_CPU_PERCENT=800 \
  node benchmark/jpegxl/run-m7-bounded.ts compression-verify-unique \
  node benchmark/jpegxl/comparison/investigate-compression.ts \
  .tmp/jpegxl-comparison-v1/compression-investigation.json --verify-only
```

The scripts write temporary images and encoded files under the ignored `.tmp`
directory. The saved reports retain hashes and measurements. Diagnostic
timings are single observations with different initialization scopes, not paired
speed ratios. The existing public comparison remains the timing reference.
