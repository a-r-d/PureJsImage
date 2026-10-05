# JPEG XL palette confirmation, October 4, 2026

The palette change, corrected size floor and numeric predictor cache are
integrated into the first-party encoder. Its measured graphic file beats two
selected WASM files in size and both quality scores. The cache preserves all
original comparison files and passes fresh cost studies, production fixtures,
82 focused tests and nine cases across three browsers. The historical studies
below keep their original source identities; current cache qualification appears
at the end of this page. Full compression parity remains open.

## Protected lossless cost

One predeclared study measures 21 independent alternating pairs, with 42 isolated
processes and 84 complete cold and warm encodes. All files reproduce the original
649,404-byte lossless stream, original input and managed allocation peak.
Explicit garbage collection reclaims operation buffers before each measurement.
The measurements use absolute cold and cumulative warm process peak RSS.

| Measurement | Paired median change | 95% interval | Original allowed increase |
| --- | ---: | --- | ---: |
| Cold encode time | +0.235% | -0.818% to +0.483% | 5% |
| Warm encode time | +0.179% | -0.835% to +0.556% | 5% |
| Cold peak RSS | +0.958% | -2.006% to +4.095% | 5% |
| Cumulative warm peak RSS | +0.151% | -3.470% to +2.392% | 5% |

Both each median and its upper confidence bound pass the original limits.
The user subsequently authorized up to 10% additional RSS for compression work,
with the 5% timing protection retained. This confirmation passes both policies.
The earlier 15-pair study's failed cold-RSS upper bound remains recorded
separately. The studies and diagnostic observations are not pooled. No cause
for that earlier result or speed or memory improvement is established.

[The independent audit](results/flat-palette-cost-confirmation-gates.json)
reproduces the statistics, checks every participant and preserves the separate
historical verdicts.

## Direct graphic comparison

These are three complete files from the same original 1024 by 1024 graphic.
They were freshly decoded in native libjxl and Rust. Original alpha stays exact,
both decoders agree within one color level, and both quality tools reproduce
their original scores.

| Public request | Bytes | SSIMULACRA2 | Butteraugli |
| --- | ---: | ---: | ---: |
| Qualified PureJsImage palette candidate, distance 8 | 14,617 | 84.390 | 4.820 |
| Pinned jSquash, quality 83.921 | 25,580 | 80.153 | 7.669 |
| Pinned wasm-vips, distance 8 | 30,921 | 80.459 | 5.574 |

The candidate file is 42.9% smaller than this jSquash file and 52.7% smaller
than this wasm-vips file. Its SSIMULACRA2 is higher and Butteraugli is lower
than both. This establishes a better measured point for these selected files.
It does not add a tightly matched target, a full quality frontier or a
competitor speed result. These files were measured before source adoption;
the production evidence below verifies the integrated code separately.

[Complete-file comparison evidence](results/flat-palette-point-dominance-controls.json)
records the six fresh independent grids and both metric reruns.

## Complete measured graphic curves

The comparison now covers all 24 requests in each frozen peer curve. All 48
distinct peer files were freshly decoded in both independent decoders and
rescored with both quality tools. Actual candidate files beat all 24 wasm-vips
files and 23 of 24 jSquash files: fewer bytes, no lower SSIMULACRA2 and no higher
Butteraugli. This compares complete files without interpolating their sizes.

The remaining jSquash request, quality 101, produces 11,644 bytes at
SSIMULACRA2 39.714 and Butteraugli 23.273. No tested candidate beats that file
on all three measurements. Keep this exception when describing the comparison.

[Full measured-curve evidence](results/flat-palette-curve-dominance-controls.json)
preserves every request, including the exception. Its physical pins use the
successful independent audit 471; an older audit number remains in its policy
prose. Neither successful files nor failed audit records were rewritten.

The candidate's own 24-request curve still has seven score inversions. The
score-80 bracket is 12.576 points wide, the score-90 bracket is 1.676 points wide,
and score 70 remains unbracketed. None passes the existing 0.25-point matching
tolerance. Wide-bracket size estimates do not count as matched results.
[The independent candidate audit](results/flat-palette-quality-audit.json)
checks 48 complete decoder grids and 201,326,592 deliberately quantized samples.
Original alpha remains exact. It records actual integer pixel error separately
from the producer's fractional estimate.

## Container overhead

The retained encoder's default container adds 40 bytes. jSquash emits a bare
codestream; the inspected wasm-vips containers also carry compressed metadata.
Separating those bytes explains the 23-byte default-file gap on im26-2018.
Its PureJsImage payload is 613,228 bytes, versus jSquash's 613,245 bytes.

Two fresh requests through the retained public encoder's existing
`container: false` option reproduce the original logical payloads exactly.
Four complete independent grids reproduce all 14,680,064 original samples.
The option keeps its existing behavior; defaults and metadata policy are unchanged.

| Input, effort 7 | PureJsImage payload | jSquash payload | wasm-vips payload |
| --- | ---: | ---: | ---: |
| im26-1416, capped photo | 649,364 | 644,097 | 649,211 |
| im26-2018, capped photo | 613,228 | 613,245 | 621,087 |
| im26-5032, capped map | 133,325 | 127,545 | 150,701 |
| Original screenshot | 401,950 | 391,394 | 422,211 |
| Original 12 MP photo | 6,220,141 | 6,899,188 | 6,648,783 |

The remaining first-photo, map and screenshot gaps to jSquash exceed container
overhead. On im26-1416, removing our wrapper also leaves a 153-byte payload gap
to wasm-vips. The original large photo remains below both peers.

[Container inspection evidence](results/lossless-container-controls.json)
keeps complete-file sizes, logical payloads and actual metadata boxes separate.

All six focused candidate regressions pass, including flat-region color
preservation, exact protected streams and natural recovery when optional
palette storage exceeds the working-memory budget. Chromium, Firefox and WebKit
reproduce the independently qualified graphic streams at distances two and eight.

The [complete original-input matrix](results/flat-palette-original-matrix.json)
measured the palette change before the additional size-floor correction below.
It passes all 123 fresh files and 246 complete native and Rust decoder grids.
All 32 lossless files retain their complete bytes and every original sample.
Of 91 fixed lossy requests, 22 graphic files shrink; the other 69 retain their
complete bytes, decoded pixels and both quality scores. Original inputs and
alpha remain exact, and managed allocations are released in every case.
The report preserves every observation and deduplicates repeated physical pins.
It does not add matched targets or a representative speed comparison. A fresh
matrix was required to verify the corrected selection rule. The cache
qualification below completes that replay and its independent audit.

## Changed graphic costs

Before the size-floor correction, seven independent alternating pairs measure
14 isolated participants and 28
cold and warm encodes of the original graphic at distance eight. Every request
reproduces its independently qualified file, original input and closed managed
ownership. Operation buffers are reclaimed before measurement.

| Measurement | Paired median change | 95% upper bound | Allowed increase |
| --- | ---: | ---: | ---: |
| Cold encode time | -38.810% | -38.561% | 5% |
| Warm encode time | -38.381% | -38.148% | 5% |
| Cold peak RSS | -25.499% | -24.943% | 10% |
| Cumulative warm peak RSS | -26.316% | -25.574% | 10% |

The old request produces 37,687 bytes at SSIMULACRA2 100. The palette request
produces 14,617 bytes at 84.390. These costs protect a fixed public request with
a disclosed quality change. They do not compare speed at matched quality or
measure competitor speed. [The cost report](results/flat-palette-graphic-cost-controls.json)
preserves all observations and the exact source and artifact identities.

## Integrated production checks

Actual production package builds measure 537,224 bytes for the core codec and
609,451 bytes for the specialized entry, within the original 541,000 and
614,000 byte ceilings. Exports stay unchanged. The core is 316 bytes smaller
than the qualified stage after import organization; specialized size is equal.
All 43 first-party module runtime bodies remain identical after formatting.

Two actual production requests reproduce the independently qualified 771-byte
generated graphic and 10,986-byte natural working-limit fallback. Four complete
native and Rust grids verify 262,144 samples, exact alpha, protected flat-region
colors and closed ownership. The six permanent palette regressions and 40
existing artwork and encoder-memory tests pass, including their original
24 MP deadlines and working-memory limits.

Chromium, Firefox and WebKit each pass both permanent production cases with
their normal sandbox settings. The development harness initially exhausted its
256-task limit; an eight-CPU validation affinity passes all six assertions with
zero rejected task creations. This resource adjustment changes no codec option
or measured cost study. [Production fixture evidence](results/flat-palette-production-controls.json)
and [browser evidence](results/flat-palette-production-browser-controls.json)
preserve these separate qualifications.

The full suite then exposed a size-floor regression on an additional generated
family-context graphic. The old complete file is 2,262 bytes with exact pixels;
the palette-only selection produced 5,558 bytes at SSIMULACRA2 78.614. Four
complete independent grids verify both observations. The writer now preserves
the previous Modular winner before comparing quantized colors, and a focused
regression requires the old exact file and all original samples.

[The corrected production fixture report](results/family-floor-production-controls.json)
reproduces the 771-byte graphic and natural 10,986-byte fallback with four fresh
independent grids. Its actual packages measure 537,497 and 609,724 bytes, within
the unchanged original ceilings; the correctness fix adds 273 bytes to each
previous production bundle. The earlier cost studies above retain their exact
pre-fix source identities. All 82 focused palette and VarDCT tests pass with
the original family-context expectations unchanged. Chromium, Firefox and
WebKit each pass the two palette budgets and the exact Modular regression,
giving nine passing cases and zero rejected task creations at a peak of 244.
[Corrected-source browser evidence](results/family-floor-browser-controls.json)
keeps those checks separate from the earlier six-case result. The complete
current-source `npm run check` passes 270 files and 3,651 tests, with the
existing one-file and three-test skips. It includes browser portability,
package ceilings, generated docs, types, lint and formatting. Changed-graphic
cost qualification for that uncached source was still pending at this checkpoint
and cannot be inferred from the earlier studies.

A separate one-pair cost pilot reproduces every qualified byte but exposes a
large timing increase after that correction: 57.4% cold and 58.4% warm. Its
absolute cold and cumulative warm peak RSS increase 3.9% and 3.0%. These are
diagnostic observations with no representative confidence verdict. The RSS
allowance does not relax the 5% timing limit, so this result calls for reducing
the extra work while retaining the corrected winner.

A CPU profile identifies repeated exhaustive predictor searches across the
existing Modular candidates. A private prototype reuses only their numeric
predictor choices for the same prepared planes. It reproduces the complete
771-byte graphic, 10,986-byte natural low-memory fallback and 2,262-byte exact
family file. Both independent decoders verify every checked sample, and its
whole public packages fit the existing ceilings.

One fresh private-prototype cold/warm screen returns near the earlier original
encode time, with cumulative warm RSS 2.5% higher. That screen compares with
separately historical observations and qualifies no representative cost.

## Qualified numeric predictor reuse

Two separate fresh studies each use seven alternating pairs and fourteen
isolated processes. Together they measure 56 cold and warm public encodes.
Every original input, expected complete stream, managed allocation peak and
settled garbage-collection baseline stays exact. An independent audit verifies
all participant files and recomputes the paired statistics and confidence bounds.

| Workload and measurement | Paired median change | 95% upper bound | Allowed increase |
| --- | ---: | ---: | ---: |
| Graphic cold encode time | -0.201% | -0.143% | 5% |
| Graphic warm encode time | -1.464% | -0.239% | 5% |
| Graphic cold peak RSS | -0.716% | +0.178% | 10% |
| Graphic cumulative warm peak RSS | +1.751% | +3.084% | 10% |
| Lossless cold encode time | -26.962% | -25.925% | 5% |
| Lossless warm encode time | -25.553% | -24.838% | 5% |
| Lossless cold peak RSS | -0.053% | +4.763% | 10% |
| Lossless cumulative warm peak RSS | +2.634% | +8.421% | 10% |

Both the medians and upper bounds pass the 5% timing protection and authorized
10% RSS allowance. The lossless cumulative warm upper bound fails the former
5% RSS limit; that separate verdict stays recorded. All seven lossless pairs
encode faster and reproduce the same 649,404-byte file. The graphic compares
the original 37,687-byte, score-100 file with the 14,617-byte, score-84.390 file,
so it supplies fixed-request cost protection with a disclosed quality change.
These measurements do not compare competitor speed or speed at matched quality.

The corrected full matrix reproduces 123 original requests and 246 complete
native and Rust decoder grids. Its independent audit checks 1,057,918,840
samples, every original lossless and alpha sample, the corrected codestream size
floors, both complete PNG pixel grids and both quality metrics. All 32 lossless
files remain exact. Of 91 lossy files, 22 graphics shrink and 69 files remain
exact. No original graphic winner needs restoration in this cohort; the additional
2,262-byte family regression stays exact in separate production checks.

Only the Modular writer changes during cache adoption. The weak cache stores
numeric predictor choices for the same prepared planes and retains no pixel
buffers. Safe formatting preserves its independently compiled runtime body;
the other 42 modules stay exact. Actual production packages measure 537,706
and 609,931 bytes, within the unchanged 541,000 and 614,000 byte ceilings.
Exports stay unchanged. Three production requests reproduce the qualified
771-byte graphic, 10,986-byte natural working-limit fallback and exact
2,262-byte family file in six fresh complete decoder grids. All 82 focused
tests and nine normal-sandbox Chromium, Firefox and WebKit cases pass.

[Current cache qualification](results/predictor-cache-production-controls.json)
preserves the private measurement, adopted and safely formatted source identities.
Its 1,307 physical evidence records resolve historical writer hashes to exact
archived source bytes. Earlier reports remain unchanged. Production source is
`9f300ee5a8f050beb1a551d3ad49a4339067ce36114503ac6f603b8c9aba2e69`.

The subsequent [complete repository gate](results/predictor-cache-final-gates.json)
passes 270 files and 3,651 tests, with the existing one-file and three-test skips.
It includes browser portability, package ceilings, generated documentation,
site build, types, lint and formatting. An earlier attempt stopped at stale
package metadata after its build step; the existing complete size-generation
command refreshed the metadata before the successful rerun. No check or limit
was weakened.

Tight graphic target matching remains unresolved. The published combined
comparison remains thirteen adequate and eleven unresolved pairs. The first
photo remains 4.512% larger than wasm-vips at SSIMULACRA2 80; several lossless
comparisons and alpha quality gaps also remain open.
