# JPEG XL palette error localization, October 3, 2026

The coarse palette controls fail to preserve the gray icon's appearance. Spatial
Butteraugli maps locate their largest error at the same pixels near coordinate
408, 901 in the pinned im26-5034 text graphic.

| Private control | Bytes | SSIMULACRA2 | Butteraugli | Original RGB at the peak | Quantized RGB |
| --- | ---: | ---: | ---: | --- | --- |
| Independent RGB rounding, step 8 | 28,178 | 92.380 | 1.285 | 167, 169, 171 | 168, 168, 168 |
| Independent RGB rounding, step 16 | 22,214 | 89.997 | 6.157 | 167, 169, 171 | 160, 176, 176 |
| Preserve four dominant colors, step 16 | 23,646 | 90.053 | 6.157 | 167, 169, 171 | 160, 176, 176 |
| Preserve channel differences, step 16 | 24,628 | 91.303 | 6.356 | 167, 169, 171 | 174, 176, 178 |

Independent RGB rounding introduces a color cast. A further control rounds the
green component and adds the same offset to all three original channels. It
preserves channel differences until endpoint clipping and retains the four
frequency-selected colors. At this peak, no clipping occurs and the original
channel differences remain intact, yet Butteraugli gets worse. The seven-level
brightness change also matters; preserving chroma alone does not solve the error.

The step-16 channel-difference control has 4,208 pixels above map error one and
1,557 above three. The finer step-8 independent control has 472 above one and
none above three. These counts describe this complete diagnostic image and do
not establish general thresholds or a production policy.

| Step preserving channel differences | Bytes | SSIMULACRA2 | Butteraugli |
| --- | ---: | ---: | ---: |
| 16 | 24,628 | 91.303 | 6.356 |
| 32 | 20,774 | 87.575 | 8.529 |
| 64 | 14,983 | 73.914 | 20.319 |

Both independent decoders reproduce every deliberately quantized color and every
original alpha sample. The three additional files pass six full grids containing
25,165,824 samples. Separate audits derive the expected pixels and rerun both
quality tools within 1e-9. Diagnostic maps retain the original Butteraugli scalar
and validate every finite nonnegative distance sample and its row orientation.

These results reject coarse channel rounding, the four-anchor repair, and the
chroma-only repair as solutions to the peak error. A future control should
consider preserving flat-region tones before changing edge detail, using original
image structure rather than the measured error coordinates. It still needs full
independent pixel and quality checks, representative costs and a public distance
policy before adoption.

All palette work remains private. It supplies no new matched-target result,
speed claim or general compression-parity claim. The verified public comparison
still combines thirteen adequate and eleven unresolved pairs. The full repository
check passes 269 files and 3,644 tests, with the three existing skips.

The original [palette controls](PALETTE-QUANTIZATION.md) and
[sampling correction](FRONTIER-SAMPLING.md) retain their own evidence. The new
raw maps and implementation variants remain in the ignored comparison workspace.
