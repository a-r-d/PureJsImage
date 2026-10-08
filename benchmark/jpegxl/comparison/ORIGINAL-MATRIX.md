# JPEG XL broader photo compression, October 8, 2026

## Quick answer

Overall lossy compression parity remains open. The latest qualified portrait
Butteraugli-0.5 curve is 0.09% smaller than pinned jSquash and 15.25% smaller
than pinned wasm-vips. Three confirmed portrait size gaps remain, alongside four
unresolved comparisons. The earlier 12 MP photo retains its passing fine result.
The historical tables below keep their original sources.

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

## Latest fine-photo update

The qualified portrait curve uses an estimated 2,562,127 bytes at matched
Butteraugli 0.5, 0.09% fewer than pinned jSquash and 15.25% fewer than pinned
wasm-vips. The independent 12 MP photo uses 2,451,585 bytes, 1.34% fewer than
jSquash and 17.99% fewer than wasm-vips. These are rounded log-byte interpolated
estimates from complete public files, with unchanged 0.25-unit brackets and no
extrapolation. Peer encoders were not rerun.

| Input | Butteraugli | PureJsImage bytes | jSquash bytes | wasm-vips bytes |
| --- | ---: | ---: | ---: | ---: |
| 2400 × 3000 portrait | 0.5 | 2,562,127 | 2,564,399 | 3,023,095 |
| 4000 × 3000 photo | 0.5 | 2,451,585 | 2,484,904 | 2,989,288 |

The [fine-photo controls](results/original-fine-production-controls.json) record
the qualified public files, source/package equivalence and protected SSIMULACRA2-90
comparison. The portrait's matched SSIMULACRA2-90 estimate is 2,008,483 bytes,
2.53% below the preceding result, 4.50% below jSquash and 10.40% below wasm-vips.
Four BA-0.5 endpoint files and two SSIM90 endpoint files have twelve complete
native/Rust grids and 211,200,000 checked public samples. Alpha is exact,
caller data is unchanged and encoder
and replay ownership closes. Public block releases and independent source-session
ownership evidence retain their separate scopes.

Fine allocation requires variation in the existing source importance scores. Inputs with nearly uniform source scores keep the preceding fine-quality path. All six published photo settings remain admitted. Their original files, decoder grids and quality scores are reused through an exact admission-only source bridge. The corrected complete packages are measured separately and remain within the original size ceilings. No photo was reencoded and no photo metric was refreshed for this guard correction.

Three confirmed portrait size gaps remain: Butteraugli 1 against jSquash and
wasm-vips (16.56% and 9.50% larger), and Butteraugli 2 against jSquash (25.36%
larger). Four portrait comparisons remain unresolved: jSquash SSIMULACRA2 70 and
Butteraugli 3, and wasm-vips Butteraugli 2 and 3. No overall lossy parity or new
speed/RSS result is claimed. The separate cached equal-coverage diagnostic is
excluded from these public curves. Historical tables below keep their sources.

## Preceding middle/coarse curves

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
passing earlier photo results and close the three remaining confirmed gaps before broader
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
