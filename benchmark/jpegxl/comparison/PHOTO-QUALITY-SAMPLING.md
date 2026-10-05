# JPEG XL photo quality sampling, October 3, 2026

Additional wasm-vips samples resolve 1 of the two previously
unresolved quality comparisons on the 1024 by 768 im26-1416 photo. Combined with
the unchanged earlier comparisons, 12 cases remain unresolved. The original
91-file PureJsImage replay and its thirteen unresolved cases remain preserved.
Overall compression parity remains open.

The added samples use the same public wasm-vips 0.0.19 API, effort 7, input,
assets, independent decoders and quality tools. The matching requirement remains
a SSIMULACRA2 bracket no wider than 0.25 on each encoder's curve. We supplement
the old 24-point budget with at most four additional points per target, and
report that extra sampling explicitly. This does not compare equal computation.

| SSIMULACRA2 target | PureJsImage bytes | wasm-vips bytes | PureJsImage size difference | Bracket widths |
| --- | ---: | ---: | ---: | --- |
| 70 | Unresolved | Unresolved | Unresolved | 0.071 / 0.312 |
| 80 | 46970.1 | 52372.5 | -10.315% | 0.091 / 0.142 |

Sizes at the matched target use the existing interpolation of log bytes between
nondominated measured points. They are estimates between measured files rather
than new files encoded at exactly those scores. Negative size differences mean
smaller PureJsImage files at that matched target.

The supplement adds 5 complete files, validated in 10 full native and Rust
grids containing 31,457,280 samples. Opaque alpha remains exact and independent
decoders differ by at most one 8-bit level. The independent audit reruns both
SSIMULACRA2 and Butteraugli with the same pinned tools and validates every curve,
input, source, asset and output hash. PureJsImage's qualified curves are unchanged.

The graphic and alpha cases still need separate work. The graphic remains exact
across its tested PureJsImage settings, and some alpha curves have large jumps or
do not reach the target. These samples establish no new speed result, source
adoption or general quality ranking. The other photo's adequately matched score-80
file remains about 4.5% larger than wasm-vips.

Evidence:

- [Supplemental complete files, sample proofs and matching calculations](results/quality-photo-extension.json)
- [Unchanged original full quality replay](results/quality-funded-sampling-public.json)
