# JPEG XL denser lossless prediction, October 5, 2026

The effort-7 encoder now optionally tries four times the original deterministic
training sample count for eligible integer groups. It first retains the
previous complete encoded group. Only a strictly smaller complete group wins;
an optional allocation-limit failure keeps the previous stream.

The codec source SHA-256 is
`37243714e4990afd617240afcdcd1a305a79f6d820420ec7ea308e057849fe06`.
The [production controls](results/lossless-dense-training-production-controls.json)
record original inputs, complete public packages, frozen competitors,
independent sample grids, budgets and qualification evidence. The preceding
[reversible-color checkpoint](LOSSLESS-RCT.md) retains its original source and results.

## Complete lossless files

Twelve of the sixteen original effort-7 files shrink. Four remain byte-identical.
None grows. Both independent decoders reproduce every original native 8-bit
and 16-bit sample, including alpha and RGB beneath fully transparent pixels.
All sixteen effort-1 files remain byte-identical. The two effort cohorts cover
64 complete native/Rust grids and 384,733,048 exact original sample comparisons.

| Input, effort 7 | Previous bytes | Current bytes | jSquash bytes | wasm-vips bytes |
| --- | ---: | ---: | ---: | ---: |
| im26-5032 map | 133,365 | 125,561 | 127,545 | 150,876 |
| im26-1416 capped photo | 649,404 | 645,989 | 644,097 | 649,387 |
| im26-2018 capped photo | 613,268 | 609,276 | 613,245 | 621,262 |
| 4000 by 3000 photo | 6,220,181 | 6,183,475 | 6,899,188 | 6,648,964 |
| 1920 by 1080 screenshot | 401,990 | 400,951 | 391,394 | 422,389 |

The same frozen jSquash 1.3.0 and wasm-vips 0.0.19 files are retained and
their complete hashes are checked again. Equal effort numbers select each
encoder's own policy and do not imply equal computation.

The original Node matrix has 48 lossless comparison cells: 45 independently
exact matching peers and three without a matching exposed competitor API.
Current files meet or beat peer size in 43 of those 45 verified comparisons.
Three formerly larger cells now meet parity. Two remain larger:

| Input | Effort | Competitor | Extra bytes | Size gap |
| --- | ---: | --- | ---: | ---: |
| im26-2018 capped photo | 1 | wasm-vips | 18,598 | 2.049% |
| im26-1416 capped photo | 7 | jSquash | 1,892 | 0.294% |

The separately scoped original screenshot remains 9,557 bytes, or 2.442%,
larger than jSquash. These finite controls do not establish overall parity.
The [photo checkpoint](FILTER-AC.md) retains 13 adequately matched lossy pairs
and 11 unresolved pairs. Float, CMYK, animation and broader lossy compression
still need comparable evidence.

## Search cost and memory recovery

The optional search trains on at most 262,144 deterministic positions per
plane, retaining the original 256-leaf and depth-16 bounds. Smaller existing
patch groups use proportionately smaller training counts. Full-input residuals
remain exact. The search adds group-local training and entropy scratch plus
the previous encoded group, without another source-sized input bitmap.

The user prioritizes compression before speed and memory. This adds encoding
work. Per-input elapsed times and owned-storage peaks are diagnostic
observations, not a paired speed or process-RSS improvement claim. Prior
cost-guard verdicts retain their original source identities and outcomes.

Original public working-memory budgets and small minimum boundaries retain
their exact previous streams. A 513 by 257 smooth RGB control shrinks from
17,116 to 17,033 bytes by default. At its previous 15,989,965-byte working
budget, it recovers the exact original 17,116-byte file. Native libjxl, Rust
and the public decoder verify every sample in both files. Both public packages
match the independently qualified candidate exactly and fit their original
541,000-byte and 614,000-byte ceilings, with unchanged exports and no runtime
dependencies. All 56 native color encodings retain exact files and samples.

Eighteen changed-path cases pass in real Chromium, Firefox and WebKit.
The first browser run hit the development job task limit before Firefox
encoding began. Its failed receipt and traces remain preserved; the fresh
passing run bounds development bundler concurrency with the same codec
assertions, browser timeout and task ceiling. Full repository qualification
is recorded separately in the final gate.
