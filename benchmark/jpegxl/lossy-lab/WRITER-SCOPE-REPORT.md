# Selected-block writer and peak error

Seven writer screens completed 560 native-valid development encodes.
None of those individual writer policies qualified for the full lab.
Restricting the selected-block pass to
larger transforms recovered most of its SSIM gain and increased peak
error. The retained development renderer now handles the rectangular
transforms found at those error sites, with exact filtered pixel parity.

## Source-only chooser

One fixed ridge model combines the two earlier luma features with the
10th-to-90th percentile luma range. The original 16 photos supply the
centering, scale and writer-eligibility labels. The coefficient penalty is
one. At most one of the 16 photos switches safely under any fitted-score
cutoff. The unchanged two-switch calibration gate rejects all cutoffs.
The 48 validation photos remain unevaluated by the chooser.

## Isolating the writer changes

The bitstream audit verifies 384 archived streams at distances 0.9,
1.85 and 3.8 on 64 development photos. AC groups account for 98.1% of
the complete writer's net byte increase across these pairs. Outside the
original screen, the median area with raised precision on one-block
transforms is 29.0% for the 23 eligible writer photos and 19.9% for the
other 25. That association motivates a controlled screen.

Every new mode uses the frozen transform, DC, correlation and filter
decisions. Each starts from the archived corrected writer and changes
one choice of quantization policy:

- One-block only uses the selected-block pass on transforms contained in
  one 8×8 block. Larger transforms use regularized quantization and rounding.
- Larger only reverses that assignment.
- Unchanged quantizer fallback uses the complete writer, and restores
  regularized rounding for larger transforms whose raw quantizer stays the same.
- Luma coefficient error fallback uses the complete writer on one-block
  transforms. For larger transforms, it keeps the complete writer
  choice only when reconstructed luma AC squared error is at or below
  regularized. A rejected transform uses regularized quantization,
  rounding and reconstructed-luma chroma residuals together.
- Fixed quantizer uses selected-block rounding on larger transforms and
  keeps the regularized raw quantizer everywhere.
- The luma count guard adds a per-transform fallback to regularized
  rounding when selected rounding increases the luma nonzero count.
- The strict luma count guard requires selected rounding to lower that
  count before it can replace regularized rounding.

## Development screen

Each row contains 80 scores over the same 16 crops and five distances.
Triplets give mean SSIMULACRA2, Butteraugli 3-norm and Butteraugli max
BD-rate over the measured overlap. The last column shows the largest
per-image Butteraugli-max regression against regularized.

| Writer policy | Regularized | wasm-vips | jSquash | Worst max vs regularized |
| --- | ---: | ---: | ---: | ---: |
| Archived complete writer | −0.674 / −1.050 / −0.115% | −11.374 / −6.602 / −6.572% | −12.367 / −1.690 / +0.551% | See original report |
| One-block only | +0.058 / −0.244 / −0.335% | −10.683 / −6.061 / −6.767% | −11.727 / −0.764 / +0.236% | +4.199% |
| Larger only | −0.636 / −0.513 / +1.016% | −11.319 / −6.119 / −5.568% | −12.355 / −1.185 / +1.689% | +9.905% |
| Unchanged quantizer fallback | +0.015 / −0.281 / −0.518% | −10.727 / −6.075 / −6.979% | −11.775 / −0.806 / +0.040% | +6.002% |
| Luma coefficient error fallback | −0.423 / −0.648 / +0.068% | −11.159 / −6.226 / −6.410% | −12.189 / −1.301 / +0.701% | +11.059% |
| Fixed quantizer | −0.619 / −0.549 / +1.508% | −11.305 / −6.165 / −5.096% | −12.342 / −1.224 / +2.167% | +9.239% |
| Luma count guard | −0.280 / −0.379 / −0.148% | −10.958 / −6.203 / −6.668% | −12.008 / −0.916 / +0.437% | +5.538% |
| Strict luma count guard | −0.266 / −0.371 / −0.143% | −10.946 / −6.197 / −6.664% | −11.997 / −0.904 / +0.442% | +5.538% |

The original [complete writer](BLOCK-QUANTIZATION-REPORT.md) provides
the comparison row. The [new measurements](WRITER-SCOPE-REPORT.json)
include vips and jSquash, partial-range omissions and exact quantizer
checks. All seven trials exceed the 3% development regression allowance
in Butteraugli max. The trial encodes run concurrently, so their times
do not qualify speed. The holdout stays closed.

## Display error at the worst peaks

On the three largest larger-only max regressions, the audit compares native
distance maps at the same saved setting with the largest score increase.
The largest paired pixel increases are +1.082 on im26-3000, +0.797 on
im26-2004 and +0.533 on im26-1052. Their sites fall inside transforms
covering 2, 8 and 16 blocks, respectively. The raw quantizer rises at
two sites and stays the same at one. On two photos, the highest absolute
peak of the larger-only output is itself inside a larger transform whose
raw quantizer stays the same.

Mean displayed Y squared error falls in all three 32×32 windows around
those paired peak increases, including with the luma-coefficient guard.
These are same-setting diagnostics with unequal byte counts. The native
peak metric responds to changes the coefficient and window means miss.
The saved raw maps and measured scores are under
`.tmp/jpegxl-lossy-lab/multi-block-writer/max-maps/`.

The unchanged directional multiscale model flags all six native local-max
increases above 1% in windows around the three actual peaks. It also flags
all six material increases at the separate pixels chosen for the largest
paired change. The full-image model independently identifies the exact
native peak pixel on each of those three crops. The difference between
predicted and measured changes in maximum is under 0.001 percentage points.
Two cheaper searches select up to eight windows using squared displayed RGB
error or the half-resolution directional score. Both searches miss all
three native peak locations.

The bounded display helper covers strategies 6, 7 and 10 after this
round. Focused fixtures compare one modified transform at an interior
site and an image edge for each strategy. The modified quantizer and
all three coefficient planes produce the same filtered and dithered
RGBA as full reconstruction, byte for byte. The next spatial guard
can use this renderer for those sites. It still needs native
development validation and complete encoder cost measurements.

## Spatial rounding pilot

A fixed 64×64 window centered on the full model's predicted candidate
peak selects transforms for regularized rounding. The first pilot also
restores the regularized raw quantizer. It improves max on all three
crops at fewer bytes, but im26-2004 loses 0.156 SSIM points, exceeding
the pilot's 0.1-point allowance.

In the second pilot, the writer preserves every raw quantizer. Only
transforms with unchanged quantizers use regularized rounding inside
the window. This retains the complete reduction in peak error and
keeps all three within the same pilot thresholds. Deltas below use the
unmodified larger-only writer as the reference.

| Crop | Bytes | SSIM points | Butteraugli 3-norm | Butteraugli max |
| --- | ---: | ---: | ---: | ---: |
| im26-3000 | −4 | −0.028 | +0.375% | −2.568% |
| im26-2004 | −54 | −0.080 | +0.119% | −7.261% |
| im26-1052 | −18 | +0.006 | −0.024% | −9.792% |

These pairs establish that changing rounding can remove the peak
without changing raw quantization. Their byte caps come from the
larger-only writer at the same setting. The existing regularized encoder
uses fewer bytes on all three points, so this is a comparison with the
larger-only writer's byte budget.

## Spatial rounding screen

The full-image model drives the same rounding policy over all 80
development settings. The rule activates when the predicted candidate
max exceeds the regularized max by more than 1%. It triggers on all
17 measured same-setting max regressions above 1%. Fifteen drop below
that threshold after the fallback. Six guarded streams exceed their
unmodified candidate's byte count. The screen uses saved preliminary
reconstructions, so it provides no complete selector timing.

| Reference | SSIMULACRA2 | Butteraugli 3-norm | Butteraugli max |
| --- | ---: | ---: | ---: |
| Regularized | −0.601% | −0.544% | −1.890% |
| Unguarded larger-only | +0.033% | −0.033% | −2.782% |
| wasm-vips | −11.277% | −6.141% | −8.172% |
| jSquash | −12.329% | −1.210% | −1.149% |

Two Butteraugli-max development guards still exceed 3% on the measured
overlap. im26-3012 is +3.547%, and im26-3000 is +6.540%. On both,
every tested guarded setting adds bytes relative to regularized and
neither has a same-setting max loss above 1%. The guard fixes most
peak regressions without addressing the remaining rate cost.

The same spatial rule on the fixed-quantizer writer resolves 18 of 19
same-setting max harms. Its screen BD-rates are −0.660%, −0.659% and
−1.763% against regularized, −11.321%, −6.262% and −8.002% against
wasm-vips, and −12.373%, −1.322% and −0.988% against jSquash.
Only im26-3000 exceeds the 3% measured-overlap max guard, at +5.948%.
At distance 2 it costs 1,093 more bytes than regularized. The first-party
decoder measures 8,637 additional bits in the AC payload, and its
coefficient arenas contain 2,554 more nonzero Y coefficients, 11 more
nonzero B coefficients and the same X count. The channel counts locate
the largest coefficient increase, and section offsets measure total
AC payload.

Using that diagnosis, the luma count guard compares both rounding
choices at the original quantizer and uses regularized rounding
whenever selected rounding adds nonzero luma coefficients. This
clears im26-3000 in the 80-point screen and leaves one different max
failure, im26-3014 at +5.538%. This count is a local rate estimate.
The screen comparison uses the actual encoded rates. Requiring the
count to fall also leaves im26-3014 at +5.538%.

The luma count guard plus spatial rounding clears all 16 photos on
the measured overlap. The worst regression is +0.158%, and its mean
BD-rates against regularized are −0.356%, −0.511% and −1.821%.
It detects all eight same-setting max harms above 1% and reduces six
below that threshold. Six of the eight changed points add bytes relative
to the unmodified luma-count stream, and the BD-rates include those costs.

Ten of 80 luma-count outputs have identical displayed RGB to
regularized. For the other 70, the median affected area spans the full
image after including the perceptual model's 76-pixel support. Seven
of the eight triggered points also cover the full image. Reusing the
unchanged area would save little on those points.

## Full development lab

The combined luma-count and spatial rule evaluates 576 points across
64 development photos. The luma-count writer supplies 498 outputs, and
the spatial fallback supplies 78 native-valid re-encodes. The table
uses the frozen peer ladders. The initial overlay summary included
extra cached wasm-vips settings, so the peer verification checks actual
stream hashes and recomputes BD-rates on the official settings.

| Reference | SSIMULACRA2 | Butteraugli 3-norm | Butteraugli max |
| --- | ---: | ---: | ---: |
| Regularized | −0.143% | −0.372% | −1.162% |
| Luma count guard alone | −0.008% | −0.031% | −0.768% |
| wasm-vips | −8.318% | −5.570% | −6.662% |
| jSquash | −8.841% | −0.400% | +1.207% |

All 64 photos meet the 3% guard on measured overlap, with +1.215%
as the worst per-image regression. The two count-only max failures
turn from +9.451% to −1.335% on im26-2400 and from +3.731% to
−5.415% on im26-1468. Full required ranges are still unavailable for
18 SSIMULACRA2 curves and all 64 curves for each Butteraugli metric
against regularized. The fallback reduces 38 of 78 same-setting
max harms below 1% and 57 guarded outputs cost more bytes than the
count-only candidate at the same setting.

An isolated kernel test on im26-3012 measures a median 292.0 ms for
one full 512×512 predictor map with prepared source, versus 10.9 ms
for a single 32×32 region. All eleven local samples match the full map.
The experiment uses two preliminary reconstructions and whole-image
scores. Complete encoder speed and original memory still need
qualification, and the holdout remains closed.

## Live encoder follow-up

`standalone-peak-rounding` is an effort-7 development mode. It uses
the regularized encoder's source transforms, keeps sparse coefficient
alternatives from that pass, selects the rounding policy before entropy
coding, and writes one stream. Score regions on originals have bounded
display and model support. The original source and the encoder's own
coefficient choices supply both reconstructions.

Both live screens reproduce all 80 archived final streams byte for
byte. Their peer-relative rate-quality comparisons match the saved
results. The seven-pair tests also pin every output to the independent
archived stream. The shortened threshold calculation matches all 12
thresholds in 180 comparisons across ten transform shapes, six raw
quantizers and three coefficient patterns.

The final live lab reproduces all 576 archived streams byte for byte
and re-scores every stream. Both peer tables match the fixed-ladder
results above, with 293 incomplete required-range peer comparisons
logged separately and zero failed encode or scorer jobs. The fresh
writer-managed crop peak is 9,636,586 bytes.

| Development crop | Distance | Regularized median | Count-only median | Integrated median | Integrated/regularized paired ratio |
| --- | ---: | ---: | ---: | ---: | ---: |
| im26-3012 | 2 | 964 ms | 1,027 ms | 2,097 ms | 2.188× |
| im26-3312 | 2 | 1,039 ms | 1,125 ms | 2,156 ms | 2.113× |
| im26-3014 | 1 | 1,051 ms | 1,050 ms | 2,099 ms | 1.981× |

The live selection phase takes about 1.03–1.06 seconds per crop.
On the profiled crop, full-peak scoring accounts for 28.6% of samples,
display reconstruction 13.8%, and alternative rounding 1.0%.
The Gaussian blur and directional sums are the largest individual
scoring costs. Sharing unchanged inverse transforms between renders
lowers measured selection medians by 18–31 ms. Its paired complete
encode comparisons are mixed. Fixed-quantizer threshold calculation
now omits the two chroma scans and statistics used to pick another
raw quantizer.

Isolated peer spot checks on the final writer give the following costs.
The crop target is 3× jSquash. The watch-original target is 5×.

| Image | PureJsImage | jSquash | wasm-vips | Ratio to jSquash |
| --- | ---: | ---: | ---: | ---: |
| im26-3012 crop | 2.288 s | 0.470 s | 0.323 s | 4.870× |
| im26-3312 crop | 2.390 s | 0.512 s | 0.335 s | 4.673× |
| im26-3014 crop | 2.189 s | 0.545 s | 0.350 s | 4.016× |
| im26-2004 original, 13 MP | 125.599 s | 25.276 s | 9.146 s | 4.969× |

The crops need 25–38% lower complete encode time to reach 3× on
these samples. The original passes native decoding and scoring,
with 59,613,182 bytes of writer-managed peak and 505,184,256 bytes
of reported process peak RSS. Scorer arrays are outside the writer
ledger. The timing and memory gate for the complete watch set remain
open. The holdout remains closed.

Two offline checks use the existing development streams to test
cheaper decisions. Choosing count-only only when it uses fewer actual
bytes selects 164 of 576 points and still leaves both full-development
max guard failures, with +9.451% worst. A two-window search ranked by
source-normalized luma-gradient error locates only 12 of the 78 full
model peaks that caused the spatial rule to run. Neither policy
advances to encoding trials.

Run the paired timing script from the repository root:

```sh
node --expose-gc benchmark/jpegxl/lossy-lab/time-standalone-peak-rounding.ts \
  .tmp/jpegxl-lossy-lab/integrated-peak/paired.json 7
```

Pass `--strategy-port standalone-peak-rounding` to the lab runner for
fresh screen and speed measurements. Raw receipts and the CPU profile
are under `.tmp/jpegxl-lossy-lab/integrated-peak/`.

## Avoiding the second full crop score

The writer finds the candidate's exact peak before scoring the control.
The control score at that pixel is a lower bound on the maximum control
score. If the candidate peak clears the existing 1% guard against that
bound, the full control reconstruction and score can be skipped. Near the
comparison boundary and when the local bound is insufficient, the writer
calculates the full control peak. The tiled original path still calculates
both full peaks.

Across the saved 576-point development grid, one control pixel certified
424 of the 530 non-identical pairs, including none of the 78 cases that
triggered fallback. Expanding the certificate to a radius of 16 certified
four more pairs. An exact directional upper bound could exclude only
28 of 4,096 tiles even with the true peak supplied. Reuse of the candidate
render on the full control path and early comparison of identical packed
coefficient alternatives also failed to give a repeatable speed gain.

Against the captured `040452dc` working tree, seven alternating pairs for
each of im26-3012 at distance 2, im26-3312 at distance 2 and im26-3014
at distance 1 gave complete-encode ratios of 0.840×, 0.788× and 1.024×.
The first two crops use the certificate and won six and seven pairs.
The third needs both full scores and won three pairs. All 42 timed outputs
match the archived hashes. The paired runs had identical writer-managed
peaks. Raw receipts and reverted patches are under
`.tmp/jpegxl-lossy-lab/crop-speed/`. Lab records LL-1247 through LL-1250.

The fresh isolated speed run completed all 192 jobs across the 64
development crops with zero failures or omissions. Median encode time was
2.054 s for PureJsImage at distance 2, 0.490 s for jSquash at quality 80,
and 0.345 s for wasm-vips at distance 2. All used effort 7. At 4.19×
jSquash and 5.96× wasm-vips, the candidate needs another 28.5% reduction
in median crop encode time to reach the 3× jSquash gate. Its writer-managed
peak was 9,140,218 bytes and the highest isolated worker RSS was
278,413,312 bytes. These crop measurements leave the full-original memory
and timing gates open. The holdout stays closed.

In a new single-crop CPU profile on im26-3012 at distance 2, full candidate
scoring accounted for 12.2% of sampled time, full source model preparation
for 7.2%, display reconstruction for 9.8%, and the local control calculation
for 1.0%. The remaining gap exceeds the cost of any one of these phases.

Fresh encoding of all 576 development points matches the native-scored
archive byte for byte and reproduces all 78 fallback decisions. There
were 424 skips backed by the local control score, 106 full comparisons,
and 46 unchanged geometries. The maximum writer-managed allocation
matches the previous lab at 9,636,586 bytes. The replay keeps the
prior quality measurements and their required-range omissions.

## Candidate display conversion

The next crop speed pass uses the existing linear RGB converter and a
table of neighboring sRGB values. A sample uses the table when both
neighbors round to the same byte under the original dither. The transfer
curve handles values near a rounding boundary, at the sRGB join, and
outside [0, 1]. For aligned 512×512 renders the converter can use the
filtered Float32 planes directly. This avoids 6 MiB of transient Float64
copies per render. The reusable lookup occupies 256 KiB. The core
converter's emitted JavaScript is unchanged.

The initial dither comparison improved complete encode pairs by 3.0%,
1.9%, and 3.4% across three crops, with all 42 streams exact. The final
lookup and copy avoidance cut the selection phase by 7.7% on the
15-pair confirmation crop, with 13 pairs faster. Whole-encode timing
there was inconclusive at 1.005× and MAD 0.054×. Three separate scorer
trials covering unused quadratic arrays, horizontal blur tap pairs and
combined directional output are archived. Each preserved full scores
and had mixed or slower timing. Raw receipts are under
`.tmp/jpegxl-lossy-lab/candidate-speed/`. Lab records LL-1253 through LL-1258.

The fresh isolated run completed all 192 jobs. The 64 development crop
streams at distance 2 match the previous speed run byte for byte. The
median was 1.996 s for PureJsImage, 0.496 s for jSquash, and 0.346 s for
wasm-vips. These give 4.027× jSquash and 5.776× wasm-vips. The earlier
isolated run was 4.193× jSquash. The current median needs a further
25.5% reduction to reach 3× jSquash. The writer-managed maximum was
9,140,218 bytes in both runs. Maximum process RSS was 277,319,680 bytes
in this run and 278,413,312 bytes in the earlier run.

Five fresh-process memory pairs on each of the three benchmark fixtures
reproduced the same output bytes and writer-managed peak. Median
process peak RSS fell by 1,445,888, 6,025,216, and 7,385,088 bytes on
im26-3012, im26-3312, and im26-3014. Their paired time ratios were
0.994×, 0.935×, and 0.930×. The package metrics register 54 extra
unpacked bytes from the internal TypeScript declaration. Minified core
and specialized JPEG XL bundles measure 611,871 and 684,691 bytes.

The fallback footprint audit reproduced all 16 development screen
streams at distance 2. On the 15 crops with distinct fallback choices,
the median area where the peak can affect coefficients was 28.6%.
The current local model's 76-pixel filter support raised the median
required input area to 92.0%. Eight of the 15 covered at least 90%,
including four full crops. The coverage leaves limited room to reduce
reconstruction with the current local scorer. Lab record LL-1261.

The final implementation reproduced all 576 development streams and 78
fallback decisions. The maximum writer-managed peak on that replay was
9,636,586 bytes, equal to the preceding development run. The holdout
stayed closed. Lab record LL-1262.

An instrumented timing split matched all 16 screen streams. The
completed isolated repeat put median time outside display selection at
3,083.05 ms, or 2.752× the jSquash median. Six individual crops already
exceeded 3× outside that phase. The isolated 64-crop benchmark measures
the speed gate. Lab records LL-1263 and LL-1264.

## Shared encoder costs

The inverse-Gaborish reader now determines the extent contributed by
each source block before copying its pixels. It visits each halo pixel
once and keeps the original convolution and source-read order. Four
focused fixtures compare every filtered Float32 sample against scalar
clamping for tiny, thin, odd and larger images. The reader uses the
same backing buffers.

On the first seven pairs per crop the change was 4.0% faster on
im26-3012 and 1.2% faster on im26-3312. The longer 15-pair confirmation
on im26-3012 gave a 0.976 median paired ratio, MAD 0.042, and 12 wins.
Every stream and writer-managed peak matched. Five other experiments
covering filter arithmetic, quantization preparation, and cache reads
are archived. Lab records LL-1265 through LL-1273.

The isolated 64-crop run matched all 64 distance-2 streams. Median
encode times were 2.008 s for PureJsImage, 0.497 s for jSquash, and
0.350 s for wasm-vips. The 4.037× jSquash ratio is close to 4.027× in
the preceding run. At this median, reaching 3× requires a further
25.7% reduction.
Writer-managed peak was 9,140,218 bytes in both runs. Highest worker
RSS was 276,201,472 bytes in this run. Lab record LL-1274.

The full development ladder reproduced all 576 streams and all 78
fallback decisions. The managed peak matched at every point and its
maximum was 9,636,586 bytes. The holdout stayed closed. Lab record
LL-1277.

The selector's minimum entropy could rule out 6.7% of calls before
transforming a block on the 16-crop screen. The scratch shortcut keeps
all 16 streams exact. Isolated pairs on the two largest-coverage crops
and one zero-rejection crop gave 0.990×, 0.981× and 1.004×. Timing was
mixed and the shortcut stays archived. Lab records LL-1275, LL-1276,
and LL-1278.

## Repeated source colors

The development writer caches the Float32 XYB values for repeated
RGB colors on aligned opaque SDR crops with at most 262,144 pixels. A hit
uses the full RGB key, so a hash collision recomputes the color.
The cache adds at most 65,536 bytes and releases them under memory
pressure. The three focused aligned fixtures emit identical streams
at their original memory caps. The published encoder uses its
existing source conversion.

Against the preceding writer, 15 pairs per crop gave median
whole-encode ratios of 0.9668×, 0.9735× and 0.9625× on im26-3012,
im26-3312 and im26-3014. The cache was faster in 37 of 45 pairs.
Comparing the cache directly with aligned reads alone gave 28 wins
in 33 pairs. All streams matched. The seven other experiments,
including a different Gaussian ring layout and a larger raw
Gaborish cache, showed no repeatable benefit. Lab records LL-1279
through LL-1291.

In the isolated 64-crop benchmark, all 64 streams matched the
preceding run. Median encode times were 1.905 s for PureJsImage,
0.489 s for jSquash and 0.339 s for wasm-vips. The crop speed ratio
moved from 4.037× to 3.893× jSquash across the two runs. It still
needs a 437 ms reduction to reach 3×. The largest writer-managed
allocation was 9,205,754 bytes, up 65,536 bytes. Highest worker RSS
was 280,494,080 bytes. Lab record LL-1292.

Fresh-process pairs confirm the speed gain on all three sampled
crops. Median peak RSS rises by 8.34 and 8.45 MB on im26-3012 and
im26-3312, and falls by 6.57 MB on im26-3014. The full development
replay reproduces all 576 stream hashes and all 78 fallback decisions.
Every ladder point uses 65,536 more managed bytes, with a maximum of
9,702,122 bytes. Lab records LL-1293 and LL-1294.

## Scoring possible fallback locations

A peak can change the stream only if its fallback window overlaps
a transform whose selected and regularized coefficients differ. The
encoder covers those positions with tiles. When their highest score
is below the existing threshold using a local control score, raising
the control score to its true maximum cannot change the result. A
higher candidate peak outside the covered tiles cannot affect the
stream. If this comparison cannot decide, the encoder scores the
complete candidate. Diagnostic callers request the full peak and
fallback position.

The scratch version matches all 32 screen streams at distances 1 and
2. At distance 2, it avoids the complete score on 41 of 64 crops.
Fifteen-pair color-cache timings and seven-pair scorer timings use
separate runs. For the scorer, all 21 pairs on the three certified
crops are faster, with median ratios of 0.947×, 0.946× and 0.744×.
The three full-score cases have mixed timings.

The scratch 64-crop run matches all streams and keeps the 9,205,754
byte managed peak. The median is 1.811 s, or 3.739× jSquash and
5.270× wasm-vips. PureJsImage worker median peak RSS falls from
263.5 MB to 257.1 MB and the highest worker peak rises from
280.4 MB to 294.4 MB on a full-score crop. Lab records LL-1295,
LL-1296, LL-1298 and LL-1299.

The integrated path measured 1.818 s on the standard 64-crop run.
jSquash measured 0.486 s and wasm-vips 0.339 s. The ratio is 3.744×
jSquash and 5.370× wasm-vips. Every timed stream matches. Reaching
3× jSquash requires another 361 ms per crop at this peer speed.
The writer-managed peak remains 9,205,754 bytes. Median process
peak for PureJsImage is 257.7 MB and the highest is 301.7 MB. Lab
record LL-1300.

The integrated full development replay matches all 576 streams.
It uses the normal encoder entry point without collecting peak
diagnostics. Managed peaks match the cache-only writer at every
point, with a 9,702,122-byte maximum. Lab record LL-1301.

Keeping the candidate's prepared planes through the control score
increased peak RSS on some full-score crops. The writer now drops
its reference as soon as the candidate's peak is known. Five fresh
process pairs on each of the two full-score crops lowered median
peak RSS by 32.8 and 27.5 MB. The regional comparison lowered it by
1.7 MB. All 30 streams and managed peaks matched. Lab record LL-1302.

The final isolated run measures 1.779 s for PureJsImage, 0.484 s
for jSquash and 0.340 s for wasm-vips. That is 3.672× jSquash and
5.233× wasm-vips. Reaching 3× still requires 325 ms per crop, or
18.3% of the remaining encode time. All 64 timed streams match.
Managed peak is 9,205,754 bytes. The PureJsImage worker median and
highest process peaks are 256.2 MB and 274.8 MB, compared with
263.2 MB and 276.2 MB at the start of the round. Lab record LL-1304.

Joining the instrumented scoring paths to the final timings shows
where time remains. All 13 crops that render locally or skip scoring
are within 3× on their individual peer times. The crops that still
prepare a complete image have a median shortfall of 329 ms when
they score covered regions and 524 ms when they score the whole
image. Lab record LL-1305.

The covered crops score a median 24.6% of output positions. Their
existing filters require 52.5% of the fine input plane and 71.5%
of the half-resolution input plane at the median, counting the
union of padded tiles separately at each scale. These coverage
measurements bound a separate preparation trial. Lab record LL-1306.

## Preparing regions at each scale

The scorer groups required windows separately at full and half
resolution. It reconstructs their shared display extent once.
Each filter stage computes the support for the next stage using its
original tap order. The padded input area limits when the regional
plan can run. When the encoder
has already prepared the full source, the local control score takes
the source bands directly from that preparation.

Twenty-two of 24 crops that tried the initial regional plan certified
without a dense score. Counting filter work also admitted five of the
six previously declined covered crops. All diagnostic streams and
their managed peaks matched. In 15 whole-encode pairs the combined
pass gave 0.932× and 0.953× on im26-1052 and im26-3306, with 14 and
12 wins. The dense im26-3312 gave 0.986× with eight wins. Scattered
render windows showed mixed timing. Lab records LL-1309 through LL-1319.

The first full run used a broader admission rule based on Gaussian
tap counts. On im26-1234, the admitted attempt prepared
296,737 regional input samples, missed its certificate, and continued
to full preparation. RSS had already risen by 66.7 MB before the
dense preparation started. The final path uses the stricter padded-area
limit and goes directly to dense scoring after an unsuccessful
single-window score that already covered every eligible position.
Dense scoring releases each decoded scale after it produces its score
map. A required full control score processes its fine scale in strips.
Lab records LL-1320 through LL-1325.

The memory-safe 64-crop run measures 1.683 s for PureJsImage,
0.494 s for jSquash and 0.342 s for wasm-vips. Ratios are 3.404×
and 4.917×, compared with 3.672× and 5.233× before this round.
Reaching 3× jSquash requires another 200 ms per crop, or 11.9%.
All 64 timed streams match. Managed peak remains 9,205,754 bytes.
Median worker peak RSS falls from 256.2 MB to 229.9 MB and the
highest rises from 274.8 MB to 284.1 MB, within the 5% guard.
Lab record LL-1326.

The full development replay matches all 576 streams byte for byte.
Writer-managed memory matches at every point and peaks at 9,702,122
bytes. Lab record LL-1330.

## Full-frame blur and directional scoring

Each directional stencil loads its center once. Per-band scoring
skips a tile's output when every error sample in its four-pixel
halo and interior is zero. The difference pass also skips identical
finite inputs. All additions within a nonzero stencil keep their
original order. The two-scale map runs save 32–44% with shared centers
and empty-tile checks together. Skipping identical finite inputs
saves a further 6–11% in those runs. Lab records LL-1333 through LL-1339.

Opsin color adaptation consumes the output of the same five-tap blur
one row at a time. Three five-row rings replace three full Float64
planes. At 512 square this removes 6,230,016 bytes from the live
scratch required by that stage. Preparation in the paired tests takes
5–8% less time. Paired control-strip, blur-plan and mask changes give
no repeatable gain and stay in scratch. Lab records LL-1340 through
LL-1345.

The isolated effort-7 benchmark over all 64 development crops gives medians
of 1.543 s for PureJsImage, 0.480 s for jSquash and 0.334 s for wasm-vips.
Ratios improve from 3.404× to 3.215× jSquash and from 4.917× to 4.625×
wasm-vips. Fifty-two of 64 matched crops are faster, with a median matched
ratio of 0.970× and a MAD of 0.026. Reaching 3× needs another 103 ms, or
6.7% of the current median. Highest worker RSS falls from 284.1 to 270.1 MB
and median worker RSS falls from 229.9 to 229.5 MB. The 9,205,754-byte crop
managed peak matches. Lab record LL-1352.

## Transform selector speed

The selector now uses the writer's zero threshold to skip quantizer calls
for known-zero tokens. It preserves the original call at signed zero and
at both threshold boundaries. The score reuses candidate dimensions,
dequantization tables and scratch views. It also reuses the exact masked
loss term between pruning checks. Small forward DCTs share input loads
across four frequencies. The large inverse shares vertical weights across
four columns. All dot products keep their original addition order.

The isolated 64-crop benchmark measures 1.515 s PureJsImage,
0.485 s jSquash and 0.338 s wasm-vips. Ratios improve from 3.215× to
3.125× jSquash and from 4.625× to 4.486× wasm-vips. Fifty-four crops
are faster when matched by image to the preceding run, with a median
matched ratio of 0.953×. Reaching 3× still needs 61 ms, or 4.0% of the
current median. All 64 streams and their managed peaks match. Maximum
worker RSS moves from 270.1 to 282.8 MB, up 4.69% within the 5% guard.
Median worker RSS falls from 229.5 to 228.4 MB. Lab record LL-1373.

### Forward and inverse transform trials

The new forward kernels share loads across adjacent transform lines. The
inverse kernels share weights across adjacent pixels, reuse sparse-row
scratch and remove copies from the small DCT2 transform. Each kernel
preserves the original sum order. Caching the selector's winning
coefficients for the writer gave mixed results in paired encodes and
stayed in scratch.

| Isolated 64-crop run | PureJsImage | jSquash | wasm-vips | Ratio to jSquash | Ratio to wasm-vips | Peak worker RSS |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Retained checkpoint | 1,515.17 ms | 484.89 ms | 337.79 ms | 3.125× | 4.486× | 282,796,032 B |
| Large selector and sparse inverse | 1,627.77 ms | 509.00 ms | 356.36 ms | 3.198× | 4.568× | 274,984,960 B |
| Small and large transforms | 1,554.91 ms | 493.57 ms | 353.19 ms | 3.150× | 4.403× | 281,575,424 B |
| Small and sparse transforms | 1,539.95 ms | 494.13 ms | 349.91 ms | 3.117× | 4.401× | 278,740,992 B |

All three trials reproduce all 64 distance-2 streams and their
writer-managed peaks. Managed peak is 9,205,754 B, and all three runs
stay below the 283,633,459 B RSS guard. The closest run needs 57.57 ms
to reach 3× and is faster on 25 of 64 matched crops. Its matched median
is 1.0129× the previous checkpoint. The earlier checkpoint is restored
and its speed gap is 60.50 ms.

The wider forward and inverse batches improve direct kernel timings.
The complete encode is faster on one of three paired crops and slower
on two. The latest im26-1006 profile puts 2.97% of sampled CPU time in
the compact forward pass and 1.75% in the weighted inverse. Entropy
coding, perceptual preparation and the writer account for larger shares
of the remaining runtime. Lab records LL-1382 through LL-1395.

The three trial patches and 64-crop verification receipts are saved
under `.tmp/jpegxl-lossy-lab/transform-gate/`. Apply the corresponding
`transform-kernels.patch`, `transform-small-large.patch` or
`transform-sparse.patch` to the retained checkpoint and use its
filename stem as the variant in the crop command below.

## Verification

After the transform trials were archived, the restored checkpoint
passed `npm run check` with 4,270 passing tests in 347 files.
The three saved patches apply cleanly to the restored source.
Lab record LL-1396.

The exact selector changes match all 576 development streams and their
managed peaks. The full ladder tops out at 9,702,122 bytes of writer-managed
memory. The repository check passes 4,270 tests in 347 files. One file and
three tests were skipped. Lab records LL-1378 and LL-1381.

All 576 development streams match byte for byte after the full-frame scorer
changes. Writer-managed memory matches at every point and peaks at 9,702,122
bytes. The repository check passes 4,268 tests in 347 files. One file and
three tests were skipped. Core and specialized JPEG XL bundles measure
611,871 and 684,691 minified bytes. Lab records LL-1347 and LL-1350.

The repository check for per-scale regional preparation passes with
4,267 tests in 347 files. One file and three tests were skipped.
Lab record LL-1331.

The final color-cache and covered-score implementation reproduces
all 576 development streams. Its managed peaks match the preceding
covered-score replay at every point. The full repository check passes
4,263 tests in 346 files, with one file and three tests skipped. The
minified core and specialized JPEG XL bundles measure 611,871 and
684,691 bytes. Lab records LL-1307 and LL-1308.

The repository check after the halo-span change passed with 4,261
tests in 346 files. One file and three tests were skipped. The dense
reference encode now runs in the tiled-comparison fixture's setup over
the same image, with the same output and score assertions in the test.

The repository check after the candidate display change passed with
4,257 tests in 346 files. One file and three tests were skipped.

The repository check after the crop-speed change passed with 4,256
tests in 346 files. One file and three tests were skipped.

The live encoder's isolated `VITEST_MAX_WORKERS=4 npm run check`
passes with 4,256 tests in 346 files. Three tests and one file are
skipped. The first run overlaps the full development replay and
reports three test timeouts. After splitting the new compound fixture
into three smaller tests, all 96 focused tests and the full rerun
pass with the lab idle. The exact minified core and specialized JPEG XL
bundles remain 611,871 and 684,691 bytes respectively.

## Reproduction

Run the integrated crop timing with an empty output directory.

```sh
node benchmark/jpegxl/lossy-lab/run.ts \
  --manifest .tmp/jpegxl-lossy-lab/corpus-512-v2/manifest.json \
  --out "$trial_root/selector-exact" --mode speed --workers 1 \
  --budget-seconds 1800 --variant selector-exact \
  --strategy-port standalone-peak-rounding
```

[WRITER-SCOPE-AUDIT.patch](WRITER-SCOPE-AUDIT.patch) restores the
offline chooser, byte and peak audits, and screen verification tools.
[WRITER-SCOPE-EXPERIMENT.patch](WRITER-SCOPE-EXPERIMENT.patch) adds each
writer change to its own scratch snapshot.
Restore the historical writer at `3d61db6b` with
[BLOCK-QUANTIZATION-WRITER-V2-EXPERIMENT.patch](BLOCK-QUANTIZATION-WRITER-V2-EXPERIMENT.patch)
in each snapshot, and restore the archived development inputs.
The snapshots live under `.tmp/jpegxl-lossy-lab/` in the four
directories listed in the JSON report, each with a `snapshot/`
subdirectory. Use the frozen screen command:

```sh
node benchmark/jpegxl/lossy-lab/run.ts \
  --manifest .tmp/jpegxl-lossy-lab/corpus-512-v2/manifest.json \
  --out "$trial_root/screen" --mode screen --workers 4 \
  --budget-seconds 1800 --variant "standalone-$mode" \
  --strategy-port standalone-block-quantization
```

Run the screen from the matching snapshot with pinned local scorer
binaries, development fixture paths and saved peer curves. Run the
receipt tools from the research checkout. The JSON report pins the raw
inputs and every candidate's changed source hashes.
For the peak pilots, copy the larger-only snapshot to each of the two
peak trial directories, then apply the matching paths in
`WRITER-SCOPE-EXPERIMENT.patch`. Use the same larger-only snapshot
as the base for the fixed-quantizer and luma-count variants. Run
`audit-peak-shortlist.ts` for
`rgb`, `half` and `dense`, then run `test-peak-guard.ts` with
`quant-and-rounding` and `rounding-only`. Run `screen-peak-rounding.ts`
with `selected-quant`, `fixed-quant` and `nonzero-budget` for the
respective screens. Run `audit-fixed-rate.ts` after the fixed-quantizer
spatial screen and `audit-dirty-support.ts` after the luma-count screen.
For the full lab, prepare peers with `prepare-peers.ts lab nonzero-budget-writer`,
run the count writer with `--mode lab`, and run
`screen-peak-rounding.ts nonzero-budget lab`.
`recheck-peer-ladders.ts` verifies the peer comparisons from saved outputs.
Lab records LL-1228 through LL-1246.
