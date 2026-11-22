# Coherent standalone guard and storage repair

Research branch `jxl-libjxl-ports`, starting at `f6f473fa`. Local main is the
earlier transplant checkpoint `b2666b83`; published `origin/main` remains
`f9c74a49`. Both are ancestors of this research branch. Neither is changed here. These development modes consume no peer decisions and add no runtime
dependencies. No production source changes are included in this continuation. The holdout
aggregate objective passes, but two full-band SSIM guards against production
block promotion. The candidate stays on the research branch.

The retained allocation disables normative DC smoothing and uses HF modulation
strength 0.625, while retaining luma/chroma DC multipliers 0.5/0.75 and the
one-iteration EPF policy. It clears the previous dark-grain image guard.

## Development quality

64 photos, nine frozen distances, 576 valid outputs. Negative BD-rate is better.
The repaired `standalone-guard-bounded` mode preserves all 576 outputs from
`standalone-guard-hf625` byte for byte; every quality value below is unchanged.

| Reference | SSIMULACRA2 | Butteraugli 3-norm | Butteraugli max |
| --- | ---: | ---: | ---: |
| wasm-vips | -8.090% | -4.730% | -5.575% |
| jSquash | -8.553% | +0.770% | +2.537% |
| Production control | -7.254% | -9.856% | -9.629% |
| Native-map replay | -10.350% | -5.612% | -5.321% |

The vips mean is -6.132%. All aggregate development gates pass. No admitted
per-image guard fails: eight SSIM comparisons cover the required band, and no
3-norm comparison covers its full band. Partial comparisons do not establish
per-image safety. The former im26-2004 SSIM failure improves from +8.397% to
+6.756%; im26-3302 is +7.677%.

The three worst partial maximum-error regressions against production are
im26-3000 (+27.556%), im26-3004 (+10.604%) and im26-1636 (+9.561%). Visual review
finds smoother fine texture on the door and bag; jar edges remain close. These
partial maximum-error comparisons are reported, not used as per-image gates.

## Holdout outcome

All 63 photos and 567 own outputs finish, with no execution failures. Only
aggregate quality is inspected; no holdout image is used for tuning.

| Reference | SSIMULACRA2 | Butteraugli 3-norm | Butteraugli max |
| --- | ---: | ---: | ---: |
| wasm-vips | -6.064% | -3.380% | -2.301% |
| jSquash | -6.510% | +2.035% | +3.388% |
| Production control | -5.451% | -8.007% | -7.599% |

The mean against vips is **-3.915%**, meeting the owner's +2% aggregate objective;
each metric also clears +5%. The normal per-image promotion guard fails on **two
of nine full-band SSIM comparisons** against production. There are no full-band
3-norm comparisons. The 279 partial-band warnings remain explicit.

All 567 fresh default effort-7 public encodes are byte-identical to the qualified
production reference, with no managed-memory increase. This verifies the control
used for the holdout guard against the current public path.

The failed guard comes from [promotion entry rule 4](../LOSSY_PROMOTION_ENTRY.md),
including its 0.05-point tolerance. The aggregate-only holdout rule in
[the steering](../LOSSY_STEERING.md) prevents choosing a new heuristic from these
individual holdout results. No further compression tuning or promotion follows.

## Memory and speed

`standalone-guard-bounded` adds a 23,280-byte Gaborish source cache and lossless
signed-byte coefficient storage with Int16 exceptions. Dense coefficient planes
retain Int16 storage. One group is expanded for the existing writer. All 80
screen streams, 576 full-lab streams and both original-image streams match the
uncompressed mode byte for byte.

| Original at distance 2 | Previous managed peak | Repaired managed peak | Repaired time | jSquash ratio |
| --- | ---: | ---: | ---: | ---: |
| 13 MP | 97,857,343 B | 59,071,615 B | 49.359 s | 1.960x |
| 21 MP | 154,734,749 B | 90,903,965 B | 92.402 s | unavailable |

Both repaired peaks fit the unchanged 137,514,476-byte ceiling. Formal worker RSS
is 405,594,112 and 505,589,760 bytes, down from 464,490,496 and 554,397,696 bytes.
jSquash aborts on 21 MP; native libjxl validates both own outputs. An earlier
direct-launch probe reports anomalous RSS and is preserved separately, excluded
from the matched formal comparison.

The source cache gives a paired median 1.908% speed improvement on im26-3012/d2,
with 12 of 15 alternating pairs faster and every output identical. The added
storage experiment has noisy timing and makes no speed claim. A contiguous DCT
intermediate experiment regresses by a paired 1.879% and was removed.

Fresh repaired-mode timing covers 64 photos and 192 isolated jobs without
failures or omissions: own median 1479.168 ms, jSquash 493.896 ms, vips 348.442 ms.
The 2.994898x jSquash ratio passes the nominal 3x target with little margin. Own
p90 is 1592.710 ms and the slowest crop is 1727.814 ms. No concurrent tests or
other CPU benchmarks ran during this timing. Managed peak is 8,735,786 bytes.
The preceding allocation mode measured 3.016349x jSquash.

## Evidence and remaining gates

Raw evidence is under `.tmp/jpegxl-lossy-lab/standalone-guards-20261014/`.
Experiments LL-713 onward are recorded in `../lossy-lab-log.md`; source attribution
is in `../PROVENANCE.md`. Earlier screens and rejected experiments are retained.

All 576 development and 567 holdout streams decode with jxl-rs within one code
value of native libjxl. Node/browser receipts agree in Chromium, Firefox and
WebKit. All 59 focused tests pass. `VITEST_MAX_WORKERS=2 npm run check` passes all static, package, documentation,
browser-build and test gates: 4,118 tests passed, three existing skips. Node is
v24.16.0; peers remain wasm-vips 0.0.19 and jSquash JXL 1.3.0.

The full watch and scale runs were stopped after the holdout guard failed.
Watch preserves 22 encode receipts and 21 scored points, with no own failures and
a maximum managed peak of 92,952,647 bytes. Scale preserves eight valid points,
with no own failures and a maximum peak of 26,010,835 bytes. These partial runs do
not qualify the full watch or scale gates. The separately completed formal 13 MP
and 21 MP entry measurements remain valid. Both interrupted runs retain their
artifacts and peer failures.

The initial full repository check passed static and package gates, then showed
nine apparent test timeouts while sharing the host with the lab. It was stopped
and rerun with the supported `VITEST_MAX_WORKERS=2` setting. Test expectations and
timeouts are unchanged; the rerun passes and both logs are retained.

This continuation changes no `src/` files. The branch already differs from local main in two source modules containing
development decision hooks from earlier steps. Published main predates the
transplant checkpoint and does not contain those forcing hooks.
Public-path integration remains pending. Inherited peer-forcing hooks must be
removed or isolated before any merge to main. No main merge, release, version
change or public default change is included.

## Reproduction

Run from the repository root. Keep speed runs isolated from tests and other CPU
jobs. The holdout run is a recorded promotion attempt, not a tuning loop.

```sh
node benchmark/jpegxl/lossy-lab/run.ts --manifest .tmp/jpegxl-lossy-lab/corpus-512-v2/manifest.json --out .tmp/jpegxl-lossy-lab/reproduce-guard-lab --mode lab --variant standalone-guard-bounded --workers 4 --strategy-port standalone-guard-bounded
node benchmark/jpegxl/lossy-lab/run.ts --manifest .tmp/jpegxl-lossy-lab/corpus-512-v2/manifest.json --out .tmp/jpegxl-lossy-lab/reproduce-guard-speed --mode speed --variant standalone-guard-bounded --workers 1 --strategy-port standalone-guard-bounded
VITEST_MAX_WORKERS=2 npm run check
npx playwright test browser-tests/jpegxl-decision-transplant.pw.ts --workers 1
```

[Machine-readable evidence](GUARD-REPORT.json) records the aggregates, exact raw
artifact paths and SHA256 values, formal original receipts, interrupted-run
counts, current-control proof and verification results.
