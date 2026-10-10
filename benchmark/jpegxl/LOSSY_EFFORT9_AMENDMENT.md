# Bundle size and the removed searches (2026-10-10)

Owner decisions (Aaron). These override conflicting earlier campaign rules.

Bundle size is not a campaign constraint or promotion gate. Report it at each
session end. Raise the check ceilings as needed and record new values in the
commit message.

L1 keeps complete alternatives at slow effort 9 instead of deleting them:

- AC iteration search;
- RGB strategy alternate;
- luma-context alternate;
- cone frame;
- exhaustive advanced Modular DC search.

Effort 9 is effort 7 plus these searches. Gate them by effort only, never image
size or channel count. Normal transform geometry and allocation recovery still
apply. The public API did not previously accept effort 9; adding it is approved.
Document it as slow. Lossless effort 9 uses effort 7's search policy.

Effort 7 retains histogram model estimation before serializing a single stream.
Effort 9 compares complete AC streams as well. Progressive model training covers
both passes.

Lab work stays at effort 7. Do not tune effort 9 during this campaign. At
promotion, run its screen once and report BD-rate and speed against our effort 7
and jSquash effort 9. Both independent decoders and focused tests must pass.

Reproduction after development entry passes: use the same prepared screen and
ladder for a fresh effort-7 screen, then run `lossy-lab/run.ts` with
`--mode screen --promotion --effort 9 --effort7-reference <effort-7-result-root>`.
Use one worker for both screens when comparing their wall times. The effort-9
runner requires one worker and freshly measures jSquash effort 9, so cached
peer timings cannot enter its speed comparison. The report
includes the effort-7 reference curves and speed distribution, jSquash effort 9,
and current wasm-vips at effort 7. Effort-9 peer cache paths and saved effort
fields prevent reuse of effort-7 curves.
