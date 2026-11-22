# AC model state and remaining cost, 2026-11-18

The branch is not ready to merge. Neither exact-output trial is retained.
Reducing raw histogram allocation changes a stream under a fixed memory budget.
Keeping the storage and scanning fewer symbols preserves output, but its small
timing gain does not survive a convincing confirmation. A fresh comparison also
measures the remaining overhead of regularized decisions against an updated control.

Base is `a97d219f` on `jxl-libjxl-ports`. This round changes no encoder source,
quality policy, dependency, gate or release state. The holdout stays closed.
[Structured evidence](RATE-AC-STATE-REPORT.json) preserves raw paired samples,
failed assertions, audit results and source hashes. Private runners and generators
are in [the experiment archive](RATE-AC-STATE-EXPERIMENT.patch).

## State reuse and candidate pruning

Fresh profiles of a complete encode with nine rate estimates still show AC
traversal, clustering, sorting and DC work. Each batch evaluates the control plus
eight deterministic local AC perturbations, then writes the unchanged control
stream. Preparation and cleanup are included; these are not new quality policies.

The photo produces six distinct learned order sets, and the texture eight.
Selected orders and context family stay the same in both batches. This does not
permit reusing the alternative models unchanged: their inputs changed, and their
rebuilt costs are what establish the winner.

A read-only diagnostic computes an optimistic bound from each original context's
empirical entropy, mandatory order/component headers, extra bits and ANS states.
It omits probability headers and clustering/normalization losses. All 36 model
rows per crop satisfy the lower-bound check, but zero of nine learned-order pairs
can be rejected early on either crop. The bound remains 4,724–4,751 bits below
the natural incumbent on the photo and 593–655 bits below on the texture.
No pruning implementation follows this result.

## Exact-output trials

LL-1198 derives raw histogram capacity from every legal packed value: 28 symbols
for the ordinary configuration and 34 for the dense configuration. The final
writer previously allocated 512 slots per raw histogram. Its ample-budget paired
outputs match, and ordinary managed peaks fall from 5,682,267/5,678,171 bytes to
3,596,116/3,484,730 bytes on the photo/texture.

The fixed-budget comparison rejects that change. On development im26-3012 at
distance 0.45 and budget 8,919,488 bytes, both variants finish, but control writes
109,346 bytes and the trial 105,085 bytes. Lower scratch changes model admission.
The requested invariant is exact output, so the smaller stream is a failure.
No RSS qualification or production adoption follows.

LL-1199 keeps all 512 backing slots and only shortens the occupied-symbol scan.
All 24 fixed budget comparisons match, including the failing capacity case.
All 24 budgets finish encoding; this is not limit-error coverage. Managed peaks
stay equal. Initial seven-pair timing looks mixed, so the final decision uses
21 alternating ordinary-encode pairs, without rate probes:

| Development crop | Paired ratio | Ratio MAD | Faster pairs | Control median ms | Trial median ms |
| --- | ---: | ---: | ---: | ---: | ---: |
| im26-3012 | 0.986080 | 0.066966 | 13 of 21 | 811.218 | 813.534 |
| im26-3312 | 0.990317 | 0.055259 | 11 of 21 | 833.186 | 818.771 |

The apparent gain is small relative to variation, with no clear majority on
the texture. The added scan branch is not retained. Both ordinary and nine-probe
seven-pair results remain in the JSON; batch timings are not ordinary speed claims.

## Fresh existing-policy cost

The original cost rejection predates later exact optimizations. Subsequent
LL-1077 qualification passed against a frozen control implementation. LL-1201
compares the same `standalone-forward-all` and regularized quality policies using the
current source for both. Every timed output must match its own saved quality
stream. Preparation and the entire encode are timed, with two warmups per mode
and 21 alternating pairs per crop. All 84 measured outputs match.

| Crop | Regularized/control ratio | Ratio MAD | Faster pairs | Historical allowance |
| --- | ---: | ---: | ---: | ---: |
| im26-3012 | 1.067280 | 0.046781 | 3 of 21 | 1.016124 |
| im26-3312 | 1.025401 | 0.034547 | 8 of 21 | 1.016124 |

The original allowance derives from the unchanged 0.161235% mean development
gain. Both measured ratios remain above it. However, the older qualification
runner imports a frozen control selector, while this run gives both policies the
current optimized implementation. This is a diagnostic of current marginal
cost, not a repeat of the historical gate. It does not revoke the earlier pass,
create a stricter promotion gate or authorize another quality/holdout trial.
Absolute speed against jSquash and original-image memory were not refreshed here.

## Quality, verification and next work

Prior native-scored regularized full-development BD-rates remain:

| Reference | SSIMULACRA2 | Butteraugli 3-norm | Butteraugli max |
| --- | ---: | ---: | ---: |
| wasm-vips | -8.205% | -5.199% | -5.631% |
| jSquash | -8.726% | -0.012% | +2.408% |

Partial-band omissions remain. There is no new holdout measurement. The two
historical holdout SSIM failures remain unresolved; current regularized timing
and saved development quality cannot substitute for promotion evidence.

Strict private TypeScript, reproduction of all 19 generated modules and restoration
of all 33 archived files pass. Fresh `VITEST_MAX_WORKERS=4 npm run check` exits 0
with no signal: 4,246 tests and 346 files pass, three tests and one file skip.
All build, browser-build, type, lint, format, comparison and documentation checks
pass. The full command takes 589.853 seconds; Vitest takes 545.72 seconds.
No retained implementation requires new native rescoring or
browser-runtime coverage in this round. The preceding verified source checkpoint
and its 576-stream parity remain unchanged.

Bundles stay 615,136/687,968 bytes, with zero runtime dependencies. The original
managed ceiling remains 137,514,476 bytes. Public forcing hooks still need source
separation, followed by the full promotion path for any successful quality repair.

Next three questions, in order: attribute the remaining cost between the two
existing selector policies; reduce repeated work without changing allocation
admission or model inputs; then use exact rebuilt rate costs with the validated
displayed-error model for a separately authorized quality trial. Do not retry the
rejected capacity change, freeze learned models or weaken any gate.

## Reproduction

Use a disposable checkout of `a97d219f` with the frozen development inputs and
saved reference streams. Apply the archive. Its small `probe.ts`, `normal.ts`
and timing runners are included; earlier generator variants are preserved as
history and need not be run. Rebuild the private source mirrors in this order:

```sh
node .tmp/jpegxl-lossy-lab/rate-ac-state-20261118/make-audit.ts
node .tmp/jpegxl-lossy-lab/rate-ac-state-20261118/make-compact-mirrors.ts
node .tmp/jpegxl-lossy-lab/rate-ac-state-20261118/make-budget.ts
node .tmp/jpegxl-lossy-lab/rate-ac-state-20261118/make-scan.ts
node .tmp/jpegxl-lossy-lab/rate-ac-state-20261118/make-lower-audit.ts
npx tsc --noEmit -p .tmp/jpegxl-lossy-lab/rate-ac-state-20261118/tsconfig.json
```

Run `order-audit.ts` and `lower-audit.ts` once for each recorded crop.
`scan-budget-parity.ts` verifies the fixed budgets; `budget-parity.ts` is expected
to reject the smaller-allocation trial. Run `scan-normal-paired.ts` with crop ID,
fresh label and `21`, then `policy-cost.ts` with each crop ID. Run timing serially
without profiling, scoring or tests in parallel. The prepared memory and
fixed-screen validation runners were not executed after the trials were rejected.
