# Guidance after the plateau stop (2026-10-10)

Owner decisions (Aaron). These override conflicting earlier campaign rules.

## Preserve and promote the current candidate

Preserve the candidate, lab log and evidence index on `jxl-lossy-candidate` and
push first. Failing tests are allowed on that branch only. Main requires all
promotion gates. Repairs to promote this candidate are not compression trials.

The current-state block must include each metric's full-lab delta against the
unchanged development baseline on the same ladder, and the absolute isolated
crop speed ratio against jSquash.

Classify the 30 failing tests in the log. Update exact-byte and digest snapshots
with one justification each. Fix property failures in the encoder; never loosen
quality, continuity, exact-palette, thin-image or fallback expectations.

Restore tools according to the mechanism their former gates protected:

- Thin images require sufficient block geometry for the tool's context.
- Route exact palettes by visible color count at every image size.
- A fine-distance fallback condition is allowed when development evidence shows
  damage. Cite both the corpus evidence and mechanism in its code comment.
- Replace contrast switches with continuous blends.

After each repair, run the quick screen. Each metric's mean BD-rate must stay
within 0.3% of the preserved candidate. Promotion requires full development,
holdout aggregate, scale crops, watch originals, isolated speed, native libjxl
and jxl-rs decoding, `npm run check`, `npm run browser:check`, and the existing
bundle and memory ceilings. Then commit to main.

## Targets

Butteraugli targets use wasm-vips 0.0.19 (libjxl 0.12.0). Keep jSquash 1.3.0,
which wraps a 2022 development snapshot, in every report as a reference.
SSIMULACRA2 must remain at or below 0% against both peers. The steering's
Butteraugli limits, individual-image guards, 3x crop and 5x original speed
targets, memory limits and bundle ceilings continue to apply.

## Bounded Butteraugli phase after promotion

Reset the plateau counter after promotion. First run one direction diagnostic:
show development per-image Butteraugli 3-norm BD-rate by category; compare our
raw maps with wasm-vips on the five worst development images at matched bytes;
split errors by flat, edge and texture blocks and by channel. Explain where our
error concentrates differently.

Then implement steering step 5, a first-party perceptual error model and
closed-loop refinement directed by that evidence. Butteraugli improvements may
trade other quality provided SSIMULACRA2 remains at or below 0% against both
peers. The speed rules continue to apply.

The budget is 15 lab experiments or two sessions, whichever comes first.
Success requires at least 3% development Butteraugli 3-norm BD-rate improvement.
Otherwise stop, report final numbers and rank remaining ideas by expected
upside. The compression campaign then ends unless Aaron reopens it.

Push at the end of every session, using the candidate branch until promotion.
Keep the steering's end-of-session report format.
