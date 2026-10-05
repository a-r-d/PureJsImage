# JPEG XL quality sampling correction, October 3, 2026

The comparison sampler now refines the same measured size/quality curve used for
matching. One additional wasm-vips measurement resolves the second photo's
SSIMULACRA2 70 comparison. Together with the previous supplement, eleven
comparisons remain unresolved. Overall compression parity remains open.

The previous sampler selected adjacent raw points even when another measurement
offered both a smaller file and a higher score. Two such dominated points consumed
sampling budget without narrowing the accepted score-70 bracket. The corrected
sampler uses the matching bracket's endpoints. If its estimate was already
measured and dominated, it samples the widest remaining interval inside that
bracket. It retains the existing setting bounds, rounding, targets and budgets.

| Second photo, SSIMULACRA2 target | PureJsImage estimated bytes | wasm-vips estimated bytes | PureJsImage size difference | Bracket widths |
| --- | ---: | ---: | ---: | --- |
| 70 | 31,149.0 | 33,728.9 | -7.649% | 0.071 / 0.087 |
| 80 | 46,970.1 | 52,372.5 | -10.315% | 0.091 / 0.142 |

The second photo is the pinned 1024 by 768 im26-1416 diagnostic input. Sizes use
the existing interpolation of log bytes between nondominated measured points.
Both curves must bracket the target within the unchanged 0.25-score limit.
These estimates are between measured files; they are not files encoded at
exactly the target score.

The new measurement uses the same wasm-vips 0.0.19 public API, effort 7, original
pixels, module assets and independent quality tools. It carries the previous
five-point supplement and permits at most four new score-70 points, stopping
after the first point closes the bracket. Additional sampling effort is explicit.
The original 24-point report and 91-file PureJsImage replay remain unchanged.

Native and Rust decoding validate two full grids containing 6,291,456 samples.
Opaque alpha remains exact and color samples differ between decoders by at most
one 8-bit level. A separate audit reruns SSIMULACRA2 and Butteraugli within 1e-9
and recomputes every bracket and size ratio from the preserved curves.

Encoder source is unchanged. The first photo remains about 4.5% larger than
wasm-vips at score 80. Graphic and transparency cases, remaining lossless gaps,
and the rejected predictor-refinement candidate still need work.

Evidence:

- [New measurement, decoder grids and matching calculations](results/quality-photo-frontier-extension.json)
- [Earlier five-point supplement](results/quality-photo-extension.json)
- [Unchanged complete PureJsImage replay](results/quality-funded-sampling-public.json)
