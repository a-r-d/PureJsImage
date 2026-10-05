# JPEG XL lossless group search, October 5, 2026

All three remaining measured integer-lossless compression gaps are closed.
The current encoder meets or beats the frozen peer size in all 45 independently
exact comparable cells from the original Node matrix. All four separate
original-size photo and screenshot controls also meet or beat peer size.
Three main cells without a matching exposed competitor API remain excluded.

The codec source SHA-256 is
`792b04814811f17458fca81c3c21ff661412f3731e0f68405e0312ba1934041f`.
The [production controls](results/lossless-group-search-production-controls.json)
retain original input, frozen competitor, complete package and independent
sample hashes. [Final handoff evidence](results/lossless-group-search-final-gates.json)
records the repository checks. The [preceding checkpoint](DENSE-TRAINING.md)
retains its original source and results.

| Input | Effort | Previous bytes | Current bytes | Smallest verified frozen peer |
| --- | ---: | ---: | ---: | ---: |
| im26-2018 capped photo | 1 | 926,285 | 819,166 | 907,687, wasm-vips |
| im26-1416 capped photo | 7 | 645,989 | 641,956 | 644,097, jSquash |
| Original 1920 by 1080 screenshot | 7 | 400,951 | 386,813 | 391,394, jSquash |

Six original effort-1 files shrink and ten remain byte-identical. Four
effort-7 files shrink and twelve remain byte-identical. None grows. The original
12 MP photo remains 7,452,825 bytes at effort 1 and 6,183,475 at effort 7,
below both tested peers. The effort-7 map retains its 125,561-byte file.

All 32 complete files reproduce every original native 8-bit and 16-bit sample
in both libjxl and Rust, including alpha and RGB beneath fully transparent
pixels. This covers 64 complete grids and 384,733,048 original sample
comparisons. All seven existing neighboring counterexamples preserve complete
file-size floors and every native and public sample. All 56 native color
encodings remain byte-identical, with 112 independent decoder grids.

## Encoding changes

Eligible lossless sRGB RGB8 and RGBA8 inputs at efforts 1 and 7, from 262,144
through 4,194,304 pixels, retain their complete existing file before optional
search. Effort 1 tries 256-pixel groups using the existing channel models.
Effort 7 can try 512-pixel groups with bounded local reversible color selection.
The flat-background patch alternative can sample 16,384 positions for local
color selection and train its display tree with a lower split overhead.
Ordinary trees and JPEG coefficient transcodes retain their prior training
policy. Only a strictly smaller complete file wins. Ties and optional
allocation-limit failure retain the previous completed file.

Every additional candidate, local plane, training buffer and compressed file
counts against the existing public working-memory budget. Original small
minimum boundaries and repeated/training budget streams remain exact.
Cancellation propagates and releases owned storage. Focused tests cover both
sides of the 512-pixel boundary, hidden RGBA samples and cancellation.
Thirty cases pass across Chromium, Firefox and WebKit with matching Node
output. The complete core and specialized packages are 540,986 and 613,208
minified bytes, within the unchanged 541,000 and 614,000-byte ceilings.

This adds encoding work. The user prioritizes compression before speed and
memory. Individual elapsed times and managed peaks are diagnostic observations;
they do not establish speed or process-RSS parity. Earlier failed performance
guards keep their original outcomes. The implementation remains first-party
portable JavaScript with zero runtime dependencies.

## Scope still open

These results establish integer-lossless compression parity on the pinned
corpus. They do not establish general compression parity or a quality lead.
The [lossy photo checkpoint](FILTER-AC.md) retains 13 adequately matched pairs
and 11 unresolved pairs. The first photo remains 3.00% larger than wasm-vips
at SSIMULACRA2 70. Float, CMYK and animation compression still need comparable
evidence. Competitor versions, files and earlier speed tables stay pinned.
