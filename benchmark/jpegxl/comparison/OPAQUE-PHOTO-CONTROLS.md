# Opaque JPEG XL photo controls, October 4, 2026

Four first-party photo controls remain unadopted. The filtering controls save
bytes at matched SSIMULACRA2, but they still need broader quality and cost
qualification. The retained first-photo gap at SSIMULACRA2 80 remains 4.512%
against wasm-vips. The prototype results below do not change that headline.

## Transform selection

The first control enables the existing rate and distortion transform selector
for opaque RGBA8 photographs at effort 7 and distances above one through four.
It preserves DC and AC precision, filtering, alpha and memory allocation.
Earlier rejected RGB policy expansions changed precision and contrast as well;
this control isolates the transform decision.

All 20 complete public files pass both independent decoders, giving 40 full
sample grids with exact original alpha. The changed files grow by 0.089% to
0.256%, with mixed small SSIMULACRA2 and Butteraugli changes. Distances one and
eight retain their original bytes. The two actual public package builds keep
their exports and fit the existing size limits.

[Transform-control evidence](results/opaque-rdo-controls.json) records the actual
files and both metrics. The fixed-distance observations provide no matched
quality or speed claim and do not justify adoption.

## Texture precision

Opaque RGBA photos currently use AC precision seven in every block. The second
control tests precision six and five on busy texture while retaining seven on
smooth blocks. It reuses the existing opacity proof and computed gradient and
variance, preserving DC precision, transforms, alpha, filtering and allocations.
The change fades above distance one without an upper-distance cutoff.

All 30 public files and 60 complete independent grids pass, including exact
original alpha and unchanged distance-one files. Both package variants fit the
existing limits. Changed files shrink, but every changed SSIMULACRA2 score also
falls. Several Butteraugli measurements worsen.

The existing encoder already provides a smaller and better first-photo file
near the score-80 target:

| Actual complete file | Bytes | SSIMULACRA2 | Butteraugli |
| --- | ---: | ---: | ---: |
| Qualified parent, distance 4.5551 | 75,255 | 80.258 | 2.479 |
| Texture precision five, distance 4 | 76,227 | 79.672 | 3.121 |

The parent has fewer bytes, higher SSIMULACRA2 and lower Butteraugli. Its actual
distance-8.3542 file also beats the first-photo texture-six distance-8 file on
all three measurements. These counterexamples prevent adopting either tested
policy as a general correction. They do not establish that every possible
adaptive precision policy has been exhausted.

[Texture-control evidence](results/opaque-texture-controls.json) preserves both
variants and every fixed request. [The qualified parent curve](results/quality-funded-sampling-public.json)
contains the original comparison files. No wide interpolation is used in these
direct file comparisons. Production source and published matching counts
remain unchanged; repeated timing and RSS qualification were unnecessary for
these rejected controls.

## Photo filtering

The existing calibrated edge filter excludes RGBA photographs even when the
encoder has already proved that every pixel is opaque. Two controls reuse that
proof for nonpalette, 8-bit sRGB photographs at effort seven and distances of at
least two. They retain the existing coefficients, transforms, calibration and
rule that discards a map when too many blocks require filtering. The map uses
one managed byte per 8 by 8 block and adds no full-image pass.

The first control keeps the existing strength cap of three. The second limits
only this photo path to two; existing RGB behavior keeps its cap of three.
Both whole public package builds retain their exports and fit the original
size ceilings. All fixed-request files pass complete native libjxl and Rust
sample grids, exact alpha and input checks, and managed allocation cleanup.
The weaker control also preserves eight procedural exclusions byte for byte.

Adaptive sampling uses at most 24 points per photo, including the five original
screening points. All six score-70, score-80 and score-90 brackets pass the
existing maximum width of 0.25. Byte estimates use the nondominated frontier
and logarithmic interpolation without extrapolation. Frozen adequate competitor
estimates retain their original files and settings.

| First photo, SSIMULACRA2 80 | Estimated bytes | Change from retained encoder | Gap to frozen wasm-vips |
| --- | ---: | ---: | ---: |
| Retained encoder | 74,529.953 | 0% | +4.512% |
| Photo filter, cap three | 72,938.204 | -2.136% | +2.280% |
| Photo filter, cap two | 73,161.218 | -1.836% | +2.593% |

The second photo's score-80 estimate falls from 46,970.132 bytes to 45,801.061
with cap three and 46,036.436 with cap two, savings of 2.489% and 1.988%.
These are primary-metric compression leads on two measured photos.

Butteraugli prevents a broader quality claim. The retained first-photo
score-80 bracket has Butteraugli endpoints 2.389171 and 2.524378. Cap three
produces 2.635677 and 2.701072; cap two produces 2.507368 and 2.515810.
Lower Butteraugli is better. The weaker filter reduces the observed tradeoff,
but its overlapping range does not prove a secondary-metric improvement.
The separate retained score-80.258 file above is not the score-80 bracket.

[Cap-three audit](results/opaque-epf-refinement-controls.json) checks 38 complete
files, 76 independent grids and 239,075,328 samples.
[Cap-two audit](results/opaque-epf-cap-two-refinement-controls.json) checks 41
files, 82 grids and 257,949,696 samples. Each audit independently reproduces
the frontier and size estimates and preserves every Butteraugli coordinate
and score inversion.

The filter is ineligible below distance two. A separate cap-three check
reproduces all 16 original photo requests below that distance byte for byte,
with 32 fresh complete decoder grids. Differences between independently
sampled score-90 estimates therefore do not establish a filtering regression
or gain. Adding those protected points restores the original first-photo
score-90 estimate exactly; the supplement remains separate from the original
24-point refinement budgets.

Neither filter is adopted. Representative timing, RSS and broader matrix
qualification remain open. The published comparison remains 13 adequately
matched comparisons and 11 unresolved comparisons; these prototype studies
do not establish full compression parity.
