# Feedback after the lab checkpoint (2026-10-09)

Resume the campaign. LOSSY_STEERING.md still governs. This note adds corrections
and replaces steps 1-2 of its work order. Save it next to the steering file and
read both at session start.

## Keep doing
The lab log format, gate audit, PROVENANCE.md and holdout fencing are what was
asked for. Keep them current.

## Superseded
- comparison/RESEARCH-CHECKPOINT.md: do not resume its private prototypes
  (2586-2591, fixed-writer trials, frozen numeric workers). Its rule requiring
  public matched-quality evidence for every gain is replaced by the lab and
  promotion tiers in LOSSY_STEERING.md.
- The harness is done. No further BD-rate method refinements (interpolation,
  ties, reversals) unless a specific result is ambiguous because of the method.
  Harness and documentation work should now take under 20% of session time.

## Fix before the baseline (small)
1. Ladder placement.
   - Problem: the screen ladder 0.25/1.5/6/25 puts at most two points inside
     SSIMULACRA2 60-90 and Butteraugli max 0.5-3. That is why SSIMULACRA2
     coverage was 2/16.
   - Screen: five distances inside the range, for example 0.5, 1, 2, 4, 7.
   - Full lab: about nine points spaced geometrically from 0.45 to 7.5. Drop
     0.25, 0.35, 16 and 25 unless coverage needs them, and log which images
     needed them. 0.25 and 0.35 are the slowest encodes and rarely in range.
   - jSquash: add qualities inside the range, for example 50, 65, 70, 80, 88
     and 95. Cached points stay; compute only the new ones.
   - Pick the ladder once, globally, from measured baseline quality. Never
     choose points per image.
2. Large crops out of the screen. The two 2080-square crops cannot finish in
   budget and dominate wall time. The screen is 16 photos at 512. Large crops
   move to the scale check below.
3. Fixed overhead.
   - Files at 512 square and distance 5+ are a few KB, so header, TOC,
     container and color-signaling bytes can move BD-rate by whole percents.
   - Measure each engine's fixed overhead on the screen set.
   - If ours exceeds the peers' by more than 0.5% of median file size at
     distance 3, reduce it in the encoder. It is a real cost for small images.
     Log it as its own experiment row.
4. Fix the RST3-before-EOI JPEG decode failure on prior-12mp-im26-1416 as an
   ordinary decoder fix with a regression test. Users would hit this.

## Finish the baseline (time-box: one session)
- Full lab: 64 development photos at 512, new ladder.
- Isolated speed: the remaining 18 crops and the two watch originals, one
  worker.
- Scale check: two 2080 crops plus two watch originals on the screen ladder.
  Run it per promotion candidate, not per experiment.
- Publish the current-state table even if a few images lack coverage. Log the
  gaps; do not chase them.

## What the first data says
- Crops versus jSquash: Butteraugli 3-norm about +16%, max about +13% (partial
  screen). The 3-norm gap is not smaller than the max gap, so this is broad bit
  allocation, not only worst-region error.
- Speed on 512 crops: about 2.2x jSquash, already inside the stretch target.
  The slowness is in the paths that only run on images above 4 MP.
- The gate audit shows four effective encoders:
  - Opaque RGBA above 4,194,304 pixels gets the photo bundle (photo Q, DCT16
    and large transforms, cone frame, coarse rounding, B1, advanced DC search).
  - Opaque RGBA at or below that size gets neither tool set. This is what the
    lab measures.
  - RGB gets finerSdrAc and local contrast refinement but never the photo
    bundle, because sdrAlpha requires four channels.
  - All earlier parity evidence came from the first case.

## Revised work order (then continue with steering steps 3-6)
E1. Channel A/B.
    - Encode the screen set as RGB8 and as opaque RGBA8 at baseline. Report the
      BD-rate between the two.
    - Then make channel count stop selecting tools. An opaque RGBA image and
      the same RGB image must take the same color path and produce the same
      color data. Alpha handling stays unchanged.
E2. Area floor. On top of E1, remove the 4,194,304-pixel conditions on
    originalPhotoAc, originalDarkAc, the rgbDcPolicy area window and the coarse
    ceiling. Do this as one change, because they form one bundle. Measure full
    lab BD-rate, plus speed on crops and on the scale check.
E3. Tool ablation.
    - From the E2 configuration, turn off one tool per run.
    - Tools: cone frame, DCT16 menu, COUNT large stage, conditional large
      stage, fine allocation, local contrast refinement, finerSdrAc, advanced
      Modular DC search, order/family search, luma-context alternate, RGB
      alternate strategy, sharpness map.
    - Measure screen BD-rate for all three metrics, plus encode time on crops
      and on one 2080 crop. Confirm the largest effects in the full lab.
    - Publish one table: each tool's BD-rate contribution per metric and its
      share of encode time.
E4. Budget.
    - Keep at effort 7 the tools that meet the steering's speed rule: at least
      1% BD-rate per 10% added time.
    - For the rest, bring Aaron the table with a proposal: move them to a
      slower tier, or remove them.
    - Do not add a public effort tier without approval.
E5. Continue with steering steps 3-6. Re-test the footprint floor as an
    ordinary lab trial in the tracked selector. Do not reuse the 2586/2587
    private writer chain.

Target: E1 through E3 in the next session.

## Speed target (pending Aaron's confirmation)
- Lab crops: stay within 3x jSquash.
- Watch originals: within 5x jSquash.
- E2 will likely push large-tool cost onto small images, which is why E3 and
  E4 matter.