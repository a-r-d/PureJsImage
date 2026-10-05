# JPEG XL private palette cost qualification, October 4, 2026

The private palette candidate has not passed its protected lossless cost gate.
Timing and cumulative peak RSS passed. Cold peak RSS failed the existing upper
confidence limit. The candidate remains private, and compression parity is still
incomplete.

Fifteen fresh alternating pairs compare the actual original and candidate public
packages on the unchanged complete 1024 by 768 photo, using lossless effort seven.
Thirty isolated children run sixty encodes. Every file reproduces the qualified
649,404-byte hash and closes managed ownership. The existing GC and settled
ArrayBuffer checks pass before both cold and warm operations.

| Metric | Paired median change | 95% interval | Gate |
| --- | ---: | ---: | --- |
| Cold operation time | -0.084% | -1.267% to +0.109% | Passed |
| Warm operation time | -0.330% | -1.126% to +0.527% | Passed |
| Cumulative peak RSS | +0.797% | -0.943% to +2.211% | Passed |
| Cold peak RSS | +2.218% | -0.824% to +6.281% | Failed |

Each metric must keep both its paired median and its 95% upper bound at or below
five percent. Completing the measurement process does not pass a failed gate.
The original result and all thirty raw child reports remain preserved.

Six further diagnostic children compare the original package, literal-prefix
sharing alone, and prefix sharing plus the palette policy. They preserve the
same original file and the 132,979,807-byte managed peak. Every pre-operation
ArrayBuffer baseline settles at 3,480,644 bytes. Their cold RSS observations vary
across all three variants; two observations per variant do not identify a cause
or qualify a cost result. The twelve diagnostic encodes stay separate from the
original sixty.

One larger independent confirmation is prepared with twenty-one pairs. The
sample count is declared before new measurements. It will use the same inputs,
options, timing boundary, GC and buffer checks, absolute RSS metrics and both
five-percent protections. It will keep its forty-two children separate from all
earlier samples. The failed fifteen-pair result will retain its original verdict.
No confirmation result is claimed here.

The [browser and natural fallback checks](FLAT-PALETTE-RUNTIME.md) remain valid
for their tested cases. Changed graphics costs, the broader input and browser
matrix, tighter graphic and alpha quality matching, the remaining lossless
gaps, and the first-photo lossy gap remain open. No production source is adopted.

[Cost evidence](results/flat-palette-cost-gates.json) records the failed gate,
diagnostic scope and unchanged protections. Raw reports and prepared scripts
stay in the ignored comparison workspace.
