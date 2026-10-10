# JPEG XL lossy encoder: campaign steering

Owner decisions (Aaron, 2026-10-09). These override any earlier campaign framing in
benchmark/optimization-log.md. Read this file at the start of every session. If it
conflicts with an older log entry, this file wins.

Also read [LOSSY_FEEDBACK.md](LOSSY_FEEDBACK.md). The owner's checkpoint feedback
corrects baseline preparation and replaces work-order steps 1–2 with E1–E4.
Also read [LOSSY_PROMOTION_GUIDANCE.md](LOSSY_PROMOTION_GUIDANCE.md). The owner's
2026-10-10 decisions authorize candidate repairs after the plateau and govern
preservation, promotion and the bounded final Butteraugli phase.
The [effort-9 amendment](LOSSY_EFFORT9_AMENDMENT.md) removes the bundle promotion
gate and approves the slow effort-9 search tier.

1. The lossy encoder is a fully independent first-party encoder. It does not try to
   reproduce libjxl's heuristics or constants.
2. The goal is close parity, not exact parity. The targets are in section 1. When
   they are met, the campaign stops.
3. Evaluation moves from 1-4 images to the existing frozen corpus.
4. Encoder speed is now as important as compression.

## 1. Targets

Measure on the holdout photo split (section 4), at effort 7. Butteraugli targets
use wasm-vips 0.0.19 (libjxl 0.12.0); retain @jsquash/jxl 1.3.0 at effort 7
as a reference. Use the mean per-image BD-rate. Negative means our files are smaller.

- SSIMULACRA2: at most 0% against both peers. Protect that.
- Butteraugli 3-norm: at most +5%.
- Butteraugli max: at most +8%.
- No single holdout photo may be worse than +20% on any of the three metrics.
- Report both peers in every result table.

Speed: measure effort-7 encode wall time in single-threaded Node on the same
machine. Take the median over the lab set and over the full-resolution watch set.
It must be within 3x of jSquash effort 7 on the 512-square lab crops and within
5x on full-resolution watch originals. Aaron confirmed these tighter targets on
2026-10-09 after the checkpoint feedback.

Memory: effort-7 managed peak on full-resolution originals must not exceed today's
value. This is the Lambda memory northstar in AGENTS.md.

Package: report bundle size at every session end. Bundle size is not a campaign
constraint or promotion gate. Raise check ceilings as needed and record their new
values in the commit message, as approved on 2026-10-10.

## 2. Independence rules

Allowed:
- The JPEG XL specification (ISO/IEC 18181) and its normative contents: transforms,
  default quantization matrices and bitstream syntax.
- Published papers and textbooks on codec design and perceptual modeling.
- General techniques, whoever else uses them: adaptive quantization,
  rate-distortion optimization, block-size selection, closed-loop refinement against
  an error estimate, and rate-distortion-aware quantization.
- Peer encoders and tools as black boxes only:
  - encode to produce comparison curves;
  - decode to check conformance;
  - butteraugli_main and ssimulacra2 as development-only scorers.
- Fitting our own models and constants to metric outputs (scores and distance maps)
  on the development split.

Not allowed:
- Reading peer encoder source for heuristics, constants, weights, masks, thresholds
  or tables.
- Capturing, replaying or fitting to peer internal state. This ends the native
  probe work:
  - no InitialQuantField or AC-strategy captures;
  - no thin native callers of internal functions;
  - no quant-field replay;
  - no new harnesses of this kind.
- Fitting anything to the holdout split.

Provenance: if you know of current production constants that came from peer encoder
source, list them in benchmark/jpegxl/PROVENANCE.md with file and line. Do not
rewrite them unless Aaron asks.

## 3. Two levels of rigor

The previous campaign applied release-level verification to every exploratory
question. Stop doing that. Full rigor belongs at promotion, not during exploration.

Lab level (the default for all exploration):
- Skip these entirely:
  - plan or entry hashes;
  - pin counts;
  - admission write-ups;
  - cross-agent reviews;
  - bit-exact replay proofs;
  - scope disclaimers.
- Each experiment follows one loop: one hypothesis, one change, a quick screen, the
  full lab if the screen looks promising, then one log row.
- Prefer a direct encode-and-measure trial over preliminary capacity, fidelity,
  necessary-condition or falsifier queries. Run a diagnostic only when a direct
  trial is impossible, or when a trial failed and you need to know why.
- If a harness breaks, fix it and add a unit test for that failure. Log one row and
  continue.
- Aim for at least 8 lab experiments per working session.

Promotion level (only for changes that pass the lab):
- Entry conditions:
  - the full-lab development BD-rate improves on the targeted metrics, or speed
    improves while BD-rate stays within plus or minus 0.2%;
  - no development image regresses more than 3% on any metric.
- Then run these checks in order:
  1. holdout BD-rate;
  2. the full-resolution watch set;
  3. independent decoding in native libjxl and jxl-rs, within one 8-bit code value
     with exact alpha;
  4. npm run check;
  5. npm run browser:check;
  6. memory ceilings.
- The commit message states the change, the development and holdout BD-rate deltas,
  and the speed delta. Nothing else is needed.

## 4. Corpus

Use the frozen imazen-26 corpus in
benchmark/jpegxl/production-program/m7-corpus-selection.json. It already has 120
development and 120 holdout images.

The lossy campaign uses the photographic categories: 64 development photos and 63
holdout photos. These are lilith photos, interiors, nature and food; unsplash people
and textures; the Met; and the Art Institute of Chicago. Documents, scans and
screenshots go in a separate secondary report. Track them and do not regress them,
but do not let them block the photo work.

- Quick screen: a fixed 16-image subset of the development photos at 4 distances.
  Budget: 10 minutes of wall time at most.
- Full lab: all 64 development photos across the full distance ladder. Budget: 60
  minutes of wall time at most, using parallel workers.
- Lab images are deterministic crops chosen by hash, never by hand.
- Until step 1 of the work order removes the pixel-count gates, include a few crops
  large enough to trigger them.
- If current speed cannot meet the budgets, shrink the crop size or count and record
  what you dropped. Growing the set back is a speed milestone.
- Full-resolution watch set (promotion only): 6 development originals chosen by hash,
  plus the portrait, the 12 MP photo, tundra and Earthrise from earlier work.
- Run the holdout only at promotion. Read only its aggregate numbers. Do not use
  per-image holdout results to choose the next hypothesis.
- Compute the peer curves (jSquash and wasm-vips) once per corpus version and cache
  them.

## 5. Metrics and BD-rate

- Score every decoded image with SSIMULACRA2, Butteraugli max and Butteraugli 3-norm.
  butteraugli_main prints the max on line 1 and the 3-norm on line 2. The current
  harnesses read only line 1; fix that.
- Use a fixed distance ladder for our encoder, for example 0.5, 0.75, 1, 1.5, 2, 3,
  4.5 and 6.
- Choose the jSquash quality ladder and the vips distance ladder so that every
  image's curves overlap across SSIMULACRA2 60-90 and Butteraugli max 0.5-3. Check
  the overlap per image and log any image that fails.
- Compute BD-rate per image and per metric: log bytes against quality, monotone
  piecewise-cubic interpolation, integrated over the overlapping range.
- Report the mean, median, p90 and worst value across images.
- Retire the 0.25-wide matched-bracket method for lab work. Historical documents
  keep it.

## 6. Speed rules

- A change that slows effort 7 must buy at least 1% mean BD-rate for every 10% of
  added time. Otherwise it moves to a slower effort tier or is reverted.
- Speed-only changes must keep BD-rate within plus or minus 0.2%.
- Effort 7 should not encode several complete candidate files and keep the smallest.
  Replace those searches with estimated-cost selection.
- Effort 9 is the approved slow tier. It is effort 7 plus AC iteration, RGB
  strategy, luma-context, cone-frame and exhaustive advanced Modular DC searches.
  Gate those searches by effort only, never area or channel count. Lab work stays
  on effort 7. Do not tune effort 9; run its screen once at promotion and report
  BD-rate and speed against our effort 7 and jSquash effort 9.

## 7. Work order

0. Harness and baseline.
   - Build the lab crops, the quick screen, the cached peer curves, the three
     metrics and the BD-rate script.
   - Build a speed table covering us, jSquash effort 7 and vips effort 7, on the lab
     set and on two full-resolution originals.
   - Publish the baseline current-state table before making any encoder change.
1. Gate audit.
   - List every pixel-count, distance-window and color-count condition in the lossy
     VarDCT path. Examples: large transforms only for 4-16 MP images at distances
     2-4; coherent selection only above distance 4; the fine-allocation gates.
   - For each one, run the lab with the gate widened or removed.
   - Keep a gate only if removing it hurts development BD-rate, and write the reason
     in a code comment next to it.
   - "This is where it was measured" is not a reason.
2. Speed.
   - Profile effort 7 on a full-resolution original and rank the hotspots.
   - Apply the rules in section 6, then report the new speed ratio.
3. Footprint floor.
   - A large transform that covers several 8x8 cells must not be quantized more
     coarsely than its most sensitive covered cell needs.
   - Our own evidence supports this (JXLENC-2584 and 2586). Test it as a direct lab
     trial.
4. Per-region error constraint.
   - The aggregate error budget lets the selector move error into sensitive
     regions, which a max-style metric punishes (JXLENC-2570 and 2573).
   - Try a per-window cap instead: for example, each merged window's weighted error
     is at most its pre-merge error times (1 + epsilon).
5. First-party perceptual error model and closed loop.
   - Build our own fast, block-level perceptual error estimate in XYB, with masking
     from local activity.
   - Calibrate it on the development split against Butteraugli raw distance maps
     (butteraugli_main --rawdistmap out.pfm) and SSIMULACRA2 scores.
   - Use it to raise precision on blocks predicted to exceed the target.
   - Run one refinement pass at effort 7 if the speed rules allow it, and more
     passes in a slower tier.
6. Only after steps 1-5: entropy coding, coefficient orders and context models.
   Recent work there gained 0.1-0.8% per change; the gap is not there.

## 8. Logging

- Do not append to benchmark/optimization-log.md for this campaign. Treat JXLENC
  entries up to 2586 as an archive and read them only for a specific lookup.
- Start a new file: benchmark/jpegxl/lossy-lab-log.md.
- Its top block shows the current state in at most 15 lines:
  - the BD-rate table against jSquash and vips, per metric;
  - the speed ratio;
  - memory;
  - the next three hypotheses.
  Keep this block current.
- Below it, add one table row per experiment with these columns:
  - ID and date;
  - the hypothesis in one sentence;
  - quick-screen and full-lab BD-rate deltas per metric;
  - effort-7 time delta;
  - verdict (kept, reverted or promoted);
  - commit.
- Write in normal English with spaces. Before starting a hypothesis, search this log
  so you do not rediscover a known result.

## 9. Stopping and escalation

- Success: the section 1 targets are met on the holdout at the speed target. Stop
  the lossy campaign, write a one-page summary and ask Aaron for the next priority.
- Plateau: stop if about 15 lab experiments in a row produce less than 1% cumulative
  development BD-rate improvement. Report the remaining hypotheses ranked by
  estimated upside.
- Ask Aaron before changing targets or memory ceilings, adding another public
  effort tier, or touching the release version. Bundle ceiling changes and effort
  9 are already approved for this campaign.

## 10. End-of-session report

Keep it to 20 lines or fewer:
- the BD-rate table (development full lab; holdout only after a promotion);
- the speed ratio;
- bundle size (reported, not a promotion gate);
- experiments run, kept, reverted and promoted;
- commits;
- the next three hypotheses.

Report results plainly. One sentence of scope is enough; do not repeat disclaimers on
every line. Everything else in AGENTS.md still applies: no runtime dependencies,
strict TypeScript, browser portability, and correctness before performance.
