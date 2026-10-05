# JPEG XL repeated lossless colors, October 4, 2026

This is the preceding checkpoint. The later
[lossless spatial coding](LOSSLESS-SPATIAL.md) records the current source,
smaller graphic files and fresh cost studies. The values below retain this
checkpoint's original source and evidence.

The effort-1 encoder now tries bounded repeated-residual coding when color
residuals repeat. It shares the existing residual plan and keeps the actual
former encoded stream as a size floor. A fixed sample of 2,048 positions checks
all color channels together and excludes alpha. Small images try the candidate
directly. This avoids extra coding work on the tested photos.

The codec source SHA-256 for this checkpoint is
`8ebabe8439e1ac2fcb62758ce9e2e4a474f9e9ae49263056056d5b5acc3b4d36`.
The [production controls](results/lossless-repeat-production-controls.json)
record the original inputs, serialized size floors, native samples, frozen
peers, actual public packages, cost studies and working-budget recovery.

## Lossless size

All 16 original effort-1 integer inputs pass. Eight files shrink and eight keep
identical bytes. None grows. All native 8-bit and 16-bit samples, transparent
RGB, alpha and caller buffers stay exact. Two independent decoders check all
384,733,048 samples across 64 complete grids for both variants. Both actual
public packages are byte-identical to the qualified private candidates.

| Capped graphic | Former bytes | Current bytes | jSquash bytes | wasm-vips bytes |
| --- | ---: | ---: | ---: | ---: |
| im26-5032 | 344,414 | 328,459 | 301,588 | 268,611 |
| im26-5034 | 226,686 | 168,184 | 202,254 | 158,783 |
| im26-5052 | 255,312 | 170,236 | 217,711 | 179,817 |
| im26-5334 | 176,420 | 58,178 | 135,588 | 105,926 |

The former largest capped-graphic gap, im26-5334, now uses 45.08% fewer bytes
than frozen wasm-vips. The same original lossless effort-1 inputs and settings
are retained. The peers reproduce every sample exactly; their encoded files
and hashes are checked again without rerunning the encoders.

The im26-5032 file still exceeds wasm-vips by 22.28%, and im26-5034 by 5.92%.
Several other previously identified effort-1 and effort-7 gaps remain. The
original 12 MP photo keeps its 7,452,825-byte effort-1 file in this change.
Overall compression parity remains open.

The [photo checkpoint](FILTER-AC.md) retains its matched-quality results.
It records 13 adequately matched pairs and 11 unresolved pairs. The first
tested photo at SSIMULACRA2 70 still exceeds wasm-vips by 3.00%. These lossless
changes do not establish a broader lossy quality lead.

## Time and working memory

Three studies use seven fresh alternating pairs each, with isolated processes,
settled garbage collection and complete cold and warm encodes. Both medians
and seeded 95% upper bounds pass the unchanged 5% timing guard and the newly
human-authorized 15% absolute peak-RSS allowance. Earlier failed studies stay
separate and are not pooled.

| Input | Cold median change | Warm median change | Cumulative peak-RSS median change |
| --- | ---: | ---: | ---: |
| Graphic im26-5334 | -27.00% | -23.72% | -2.43% |
| Photo im26-1030 | -30.12% | -28.13% | -3.40% |
| Photo im26-1416 | -31.65% | -33.20% | -3.82% |

The optional path can use more managed working memory. Existing limits remain
effective: a provisional allocation scope releases a rejected residual cache,
then the encoder reproduces the former stream. The original 2,305,794-byte and
2,476,162-byte regression budgets retain their exact streams and caller samples.
The original 104,966-byte minimum for the small RGB control still works;
one byte below it fails and releases all owned memory.

Both public packages keep their exports and remain below the original 541,000
and 614,000-byte ceilings. The full repository check passes 270 test files and
3,637 tests, with the same three existing skipped tests. Browser portability,
documentation generation, package budgets and all 18 real-browser cases pass.

The color regressions also re-encode all 56 original native color cases. Both
independent decoders preserve every sample across 112 complete grids. Nine
16-bit encoded-file hashes change; the original source and sample files remain
pinned. The maintained tests now compare every re-encoded native sample.
