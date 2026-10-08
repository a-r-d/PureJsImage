# JPEG XL broader photo compression, October 7, 2026

## Quick answer

Overall lossy compression parity remains open. The latest scoped portrait
Butteraugli-1 curve improves by 9.41%, to an estimated 1,575,149 bytes. It
remains 16.56% larger than jSquash and 9.50% larger than wasm-vips.
The earlier [12 MP photo](ORIGINAL-PHOTO.md) also improves at Butteraugli 1
and SSIMULACRA2 90. 4 confirmed portrait comparisons still have size gaps.
The historical all-band table below keeps its original source and unresolved bands.

The preceding median-luminance entropy change saves 0.13–0.56% on six fixed-setting controls across
four originals, with identical decoded pixels and both quality scores.
The [median-luminance controls](results/original-luma-context-controls.json)
keep their separate evidence.

The latest [spatial histogram change](results/original-spatial-context-controls.json)
saves another 0.07–0.82% on five of those six controls. Earthrise keeps the
preceding bytes. Every decoded pixel and both quality scores remain identical.
These changes add encoding work and do not close the portrait's matched-quality
gaps. The latest scoped curves below keep separate evidence from the
historical all-band baseline.

## Latest scoped curves

| Input | Metric | Target | Latest bytes | Versus historical curve | Frozen jSquash bytes | Frozen wasm-vips bytes |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| 2400 × 3000 portrait | Butteraugli | 1 | 1,575,149 | 9.41% smaller | 1,351,388 | 1,438,511 |
| 2400 × 3000 portrait | Butteraugli | 2 | 694,088 | 2.43% smaller | 553,694 | Unresolved |
| 2400 × 3000 portrait | SSIMULACRA2 | 80 | 796,731 | 2.66% smaller | 820,041 | 847,559 |
| 4000 × 3000 photo | Butteraugli | 1 | 1,262,177 | 1.09% smaller | 1,291,165 | 1,396,748 |
| 4000 × 3000 photo | SSIMULACRA2 | 90 | 1,416,452 | 0.59% smaller | 1,639,897 | 1,686,911 |
| 4000 × 3000 photo | Butteraugli | 2 | 482,354 | 1.44% smaller | 521,032 | Unresolved |
| 4000 × 3000 photo | SSIMULACRA2 | 80 | 500,097 | 2.52% smaller | 564,888 | 557,876 |

[Scoped production evidence](results/original-cone-floor-controls.json) records
19 fresh complete public-package files, 38 complete native/Rust grids and
700,800,000 public decoded samples. Every alpha sample and caller buffer
is preserved, and managed storage closes after each file. The formatted
production packages reproduce every measured compiled byte and keep the
original 558,000/631,000-byte ceilings.

Additional DCT16 choices apply to opaque standard-sRGB RGBA8 originals above
4,194,304 and through 16,777,216 pixels, at effort 7 and distances above one and
below four. Selection can encode an additional candidate and retains the smaller
complete file; optional storage failure retains the baseline. This adds work
and establishes no representative speed or RSS improvement.

The earlier photo's matched preservation gates pass. Previously observed
tundra and Earthrise controls keep the exact baseline bytes, pixels and both
scores. They do not supply a held-out or broader matched-curve claim.
Unmeasured bands, exhausted frozen peer budgets and every failed predecessor
remain separate. The peers were not rerun.

## Portrait baseline

This baseline uses production source `7c17231f`, public `@jsquash/jxl` 1.3.0
and `wasm-vips` 0.0.19 at effort 7. The input remains the exact original
opaque RGBA8 portrait, with no resize or crop. Each metric has its own
nondominated frontier, a maximum 0.25-unit bracket width and log-byte
interpolation without extrapolation. Byte counts below are rounded estimates.

| Metric | Target | PureJsImage bytes | jSquash bytes | Versus jSquash | wasm-vips bytes | Versus wasm-vips |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| SSIMULACRA2 | 70 | 527,895 | Unresolved | Unresolved | 536,955 | 1.69% smaller |
| SSIMULACRA2 | 80 | 818,469 | 820,041 | 0.19% smaller | 847,559 | 3.43% smaller |
| SSIMULACRA2 | 90 | 2,060,523 | 2,103,148 | 2.03% smaller | 2,241,666 | 8.08% smaller |
| Butteraugli | 0.5 | 2,833,640 | 2,564,399 | 10.50% larger | 3,023,095 | 6.27% smaller |
| Butteraugli | 1 | 1,738,709 | 1,351,388 | 28.66% larger | 1,438,511 | 20.87% larger |
| Butteraugli | 2 | 711,403 | 553,694 | 28.48% larger | Unresolved | Unresolved |
| Butteraugli | 3 | 438,361 | Unresolved | Unresolved | Unresolved | Unresolved |

All three participants exhaust their original 24-attempt budget.
jSquash's score-70 and Butteraugli-3 brackets remain too wide. Its measured
inversions stay in the evidence. Five wasm-vips bands are adequate; its
Butteraugli 2/3 brackets remain too wide. Those comparisons stay null.
An unresolved comparison does not imply a win or a loss.

The [physically verified baseline](results/original-matrix-portrait-baseline.json)
records complete native and Rust floating-point grids, exact alpha and every
PureJsImage public decoded sample. It rehashes the packages, encoded files,
scoring images, grids and tools, and freezes mutable source evidence. This
verification reuses already qualified measurements; it performs no new encode
or decode. It covers 72 files, 144 independent grids and 691,200,000 public
samples, with ten resolved and four unresolved comparisons. Four resolved
comparisons expose size gaps. The original comparison's 13 matched and 11 unresolved pairs stay
unchanged.

## Remaining work

The [predeclared plan](original-photo-matrix-plan.json) also includes the
unresized tundra and Earthrise originals. Their inputs are verified; matched
compression curves still need measurement. Encoder candidates must retain the
passing earlier photo results and close the newly measured gaps before broader
parity is claimed. HDR, float, CMYK and animation require their own equivalent
public-API comparisons.

## Reproduction

Run these commands at the pinned baseline source, with the corpus and
development oracles prepared. Keep each heavy process tree inside the repository's
bounded benchmark runner.

```sh
node benchmark/jpegxl/comparison/prepare-original-photo-matrix.ts
node benchmark/jpegxl/comparison/refine-original-photo-matrix.ts .tmp/portrait-pure portrait-2400x3000 purejsimage
node benchmark/jpegxl/comparison/refine-original-photo-matrix.ts .tmp/portrait-jsquash portrait-2400x3000 jsquash
node benchmark/jpegxl/comparison/refine-original-photo-matrix.ts .tmp/portrait-vips portrait-2400x3000 vips
node benchmark/jpegxl/comparison/verify-original-photo-matrix.ts .tmp/portrait-verification.json portrait-2400x3000
```

Attempts persist across commands, including failures and interruptions.
Rerunning a command preserves the existing budget. Temporary images, grids,
packages and diagnostic scripts stay ignored.
