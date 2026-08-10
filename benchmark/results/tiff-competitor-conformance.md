# TIFF competitor conformance

Generated: 2026-08-10T20:34:17.956Z

Corpus: codec-corpus TIFF conformance; https://github.com/a-r-d/codec-corpus/tree/main/tiff-conformance

Oracle: sharp with ImageMagick fallback raw RGBA8. Exact means every independently decoded channel matched. Color-converted and lossy cases remain visible but a mismatch is not automatically a decoder defect.

Signed, floating-point, wider-than-16-bit, and arbitrary-channel rasters are classified as native scientific data and are not forced through RGBA.

| Engine | Version | Files attempted | RGBA-compared | Decoded | Exact | Pixel mismatch | Unsupported | Error | Oracle failure | Timeout | Crash | Native raster, not compared | Malformed rejected | Malformed accepted | Malformed timeout | Malformed crash |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| purejsimage | 0.8.0 | 154 | 106 | 104 | 57 | 47 | 0 | 0 | 2 | 0 | 0 | 44 | 4 | 0 | 0 | 0 |
| geotiff | 3.0.5 | 154 | 106 | 84 | 32 | 52 | 11 | 7 | 2 | 0 | 2 | 44 | 1 | 3 | 0 | 0 |
| utif2 | 4.1.0 | 154 | 106 | 74 | 49 | 25 | 0 | 28 | 2 | 2 | 3 | 44 | 0 | 1 | 0 | 3 |
| tiff | 7.1.3 | 154 | 106 | 41 | 27 | 14 | 51 | 12 | 2 | 0 | 0 | 44 | 1 | 3 | 0 | 0 |
| image-js | 1.7.0 | 154 | 106 | 39 | 33 | 6 | 51 | 14 | 2 | 0 | 0 | 44 | 1 | 3 | 0 | 0 |
| jimp | 1.6.0 | 154 | 106 | 74 | 49 | 25 | 0 | 28 | 2 | 2 | 3 | 44 | 0 | 1 | 0 | 3 |

## Non-exact, failed, and malformed-accepted cases

| Engine | File | Comparison | Outcome | Differing pixels | Max delta | RMSE | Detail |
| --- | --- | --- | --- | ---: | ---: | ---: | --- |
| purejsimage | edge-cases/usda_naip_256_webp_z3.tif | converted-rgba | success | 26620 | 31 | 0.2242 |  |
| geotiff | edge-cases/usda_naip_256_webp_z3.tif | converted-rgba | error | - | - | - | Cannot decode WebImage as `createImageBitmap` is not available |
| utif2 | edge-cases/usda_naip_256_webp_z3.tif | converted-rgba | error | - | - | - | UTIF.js found no image directory |
| tiff | edge-cases/usda_naip_256_webp_z3.tif | converted-rgba | error | - | - | - | not a TIFF file |
| image-js | edge-cases/usda_naip_256_webp_z3.tif | converted-rgba | error | - | - | - | invalid data format: undefined |
| jimp | edge-cases/usda_naip_256_webp_z3.tif | converted-rgba | error | - | - | - | Could not find MIME for Buffer |
| utif2 | robustness/sample-get-lzw-stuck.tiff | robustness | malformed-accepted | - | - | - |  |
| jimp | robustness/sample-get-lzw-stuck.tiff | robustness | malformed-accepted | - | - | - |  |
| geotiff | robustness/test_ifd_loop_subifd.tif | robustness | malformed-accepted | - | - | - |  |
| utif2 | robustness/test_ifd_loop_subifd.tif | robustness | process-crash | - | - | - | <--- Last few GCs ---> [660076:0x1fa7c000]     2063 ms: Mark-Compact (reduce) 509.3 (514.2) -> 508.9 (512.9) MB, pooled: 0 MB, 86.77 / 0.00 ms  (+ 0.2 ms in 16 steps since start of marking, biggest step 0.2 ms, walltime since start of marking 89 ms) (average mu = 0.321, current[660076:0x1fa7c000]     2323 ms: Mark-Compact 510.1 (512.9) -> 509.8 (516.9) MB, pooled: 0 MB, 225.86 / 0.00 ms  (average mu = 0.205, current mu = 0.133) allocation failure; scavenge might not succeed FATAL ERROR: Ineffe |
| tiff | robustness/test_ifd_loop_subifd.tif | robustness | malformed-accepted | - | - | - |  |
| image-js | robustness/test_ifd_loop_subifd.tif | robustness | malformed-accepted | - | - | - |  |
| jimp | robustness/test_ifd_loop_subifd.tif | robustness | process-crash | - | - | - | <--- Last few GCs ---> [660126:0x1a40b000]     2141 ms: Scavenge (interleaved) 505.5 (511.7) -> 505.2 (516.7) MB, pooled: 0 MB, 2.12 / 0.00 ms  (average mu = 0.279, current mu = 0.267) allocation failure;  [660126:0x1a40b000]     2254 ms: Mark-Compact (reduce) 508.9 (516.9) -> 508.2 (513.4) MB, pooled: 0 MB, 83.76 / 0.00 ms  (+ 0.4 ms in 51 steps since start of marking, biggest step 0.3 ms, walltime since start of marking 89 ms) (average mu = 0.291, current FATAL ERROR: Ineffective mark-compact |
| geotiff | robustness/test_ifd_loop_to_first.tif | robustness | malformed-accepted | - | - | - |  |
| utif2 | robustness/test_ifd_loop_to_first.tif | robustness | process-crash | - | - | - | <--- Last few GCs ---> [660184:0x7b0d000]     1662 ms: Scavenge (interleaved) 503.0 (515.2) -> 502.4 (515.9) MB, pooled: 0 MB, 4.49 / 0.00 ms  (average mu = 0.366, current mu = 0.295) allocation failure;  [660184:0x7b0d000]     1780 ms: Mark-Compact 504.0 (516.2) -> 503.7 (528.2) MB, pooled: 0 MB, 115.08 / 0.00 ms  (average mu = 0.286, current mu = 0.190) allocation failure; scavenge might not succeed FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory ----- Nativ |
| tiff | robustness/test_ifd_loop_to_first.tif | robustness | malformed-accepted | - | - | - |  |
| image-js | robustness/test_ifd_loop_to_first.tif | robustness | malformed-accepted | - | - | - |  |
| jimp | robustness/test_ifd_loop_to_first.tif | robustness | process-crash | - | - | - | <--- Last few GCs ---> [660242:0x2b156000]     1629 ms: Scavenge (interleaved) 503.8 (512.7) -> 503.6 (517.7) MB, pooled: 0 MB, 2.72 / 0.00 ms  (average mu = 0.311, current mu = 0.106) allocation failure;  [660242:0x2b156000]     1752 ms: Mark-Compact (reduce) 507.3 (518.2) -> 506.6 (514.2) MB, pooled: 0 MB, 91.19 / 0.00 ms  (+ 0.3 ms in 52 steps since start of marking, biggest step 0.2 ms, walltime since start of marking 97 ms) (average mu = 0.310, current FATAL ERROR: Reached heap limit Alloc |
| geotiff | robustness/test_ifd_loop_to_self.tif | robustness | malformed-accepted | - | - | - |  |
| utif2 | robustness/test_ifd_loop_to_self.tif | robustness | process-crash | - | - | - | <--- Last few GCs ---> [660314:0x29643000]     2199 ms: Scavenge (interleaved) 506.2 (512.2) -> 506.0 (517.2) MB, pooled: 0 MB, 2.98 / 0.00 ms  (average mu = 0.251, current mu = 0.197) allocation failure;  [660314:0x29643000]     2433 ms: Mark-Compact (reduce) 508.0 (517.4) -> 507.7 (512.9) MB, pooled: 0 MB, 202.41 / 0.00 ms  (+ 0.6 ms in 29 steps since start of marking, biggest step 0.5 ms, walltime since start of marking 208 ms) (average mu = 0.213, curre FATAL ERROR: Ineffective mark-compact |
| tiff | robustness/test_ifd_loop_to_self.tif | robustness | malformed-accepted | - | - | - |  |
| image-js | robustness/test_ifd_loop_to_self.tif | robustness | malformed-accepted | - | - | - |  |
| jimp | robustness/test_ifd_loop_to_self.tif | robustness | process-crash | - | - | - | <--- Last few GCs ---> [660363:0x43287000]     1740 ms: Scavenge (interleaved) 502.6 (512.9) -> 502.4 (517.9) MB, pooled: 0 MB, 2.18 / 0.00 ms  (average mu = 0.302, current mu = 0.187) allocation failure;  [660363:0x43287000]     1845 ms: Mark-Compact (reduce) 506.0 (518.4) -> 505.5 (514.9) MB, pooled: 0 MB, 76.78 / 0.00 ms  (+ 0.1 ms in 45 steps since start of marking, biggest step 0.0 ms, walltime since start of marking 82 ms) (average mu = 0.312, current FATAL ERROR: Reached heap limit Alloc |
| purejsimage | valid/12bit.cropped.rgb.tiff | exact-rgba | success | 368 | 1 | 0.2596 |  |
| geotiff | valid/12bit.cropped.rgb.tiff | exact-rgba | success | 1901 | 26 | 3.4835 |  |
| utif2 | valid/12bit.cropped.rgb.tiff | exact-rgba | error | - | - | - | 12 |
| tiff | valid/12bit.cropped.rgb.tiff | exact-rgba | unsupported | - | - | - | Unsupported bitDepth: 12 |
| image-js | valid/12bit.cropped.rgb.tiff | exact-rgba | unsupported | - | - | - | Unsupported bitDepth: 12 |
| jimp | valid/12bit.cropped.rgb.tiff | exact-rgba | error | - | - | - | 12 |
| purejsimage | valid/12bit.cropped.tiff | exact-rgba | success | 368 | 1 | 0.2596 |  |
| geotiff | valid/12bit.cropped.tiff | exact-rgba | success | 14 | 1 | 0.0506 |  |
| utif2 | valid/12bit.cropped.tiff | exact-rgba | success | 4096 | 255 | 127.5000 |  |
| tiff | valid/12bit.cropped.tiff | exact-rgba | unsupported | - | - | - | Unsupported bitDepth: 12 |
| image-js | valid/12bit.cropped.tiff | exact-rgba | unsupported | - | - | - | Unsupported bitDepth: 12 |
| jimp | valid/12bit.cropped.tiff | exact-rgba | success | 4096 | 255 | 127.5000 |  |
| tiff | valid/32bpp-None-jpeg.tiff | exact-rgba | unsupported | - | - | - | Unsupported Compression: PackBits |
| image-js | valid/32bpp-None-jpeg.tiff | exact-rgba | unsupported | - | - | - | Unsupported Compression: PackBits |
| purejsimage | valid/32bpp-None.tiff | exact-rgba | success | 60 | 1 | 0.0771 |  |
| geotiff | valid/32bpp-None.tiff | exact-rgba | success | 2775 | 255 | 105.0647 |  |
| utif2 | valid/32bpp-None.tiff | exact-rgba | success | 164 | 254 | 18.2440 |  |
| tiff | valid/32bpp-None.tiff | exact-rgba | success | 60 | 1 | 0.0771 |  |
| image-js | valid/32bpp-None.tiff | exact-rgba | success | 2775 | 255 | 103.4686 |  |
| jimp | valid/32bpp-None.tiff | exact-rgba | success | 164 | 254 | 18.2440 |  |
| geotiff | valid/big_g4.tif | exact-rgba | unsupported | - | - | - | Unknown compression method identifier: 4 |
| tiff | valid/big_g4.tif | exact-rgba | unsupported | - | - | - | Unsupported Compression: 4 |
| image-js | valid/big_g4.tif | exact-rgba | unsupported | - | - | - | Unsupported Compression: 4 |
| utif2 | valid/BigTIFF.tif | exact-rgba | error | - | - | - | UTIF.js found no image directory |
| tiff | valid/BigTIFF.tif | exact-rgba | error | - | - | - | not a TIFF file |
| image-js | valid/BigTIFF.tif | exact-rgba | error | - | - | - | invalid data format: undefined |
| jimp | valid/BigTIFF.tif | exact-rgba | error | - | - | - | Could not find MIME for Buffer |
| utif2 | valid/BigTIFFLong.tif | exact-rgba | error | - | - | - | UTIF.js found no image directory |
| tiff | valid/BigTIFFLong.tif | exact-rgba | error | - | - | - | not a TIFF file |
| image-js | valid/BigTIFFLong.tif | exact-rgba | error | - | - | - | invalid data format: undefined |
| jimp | valid/BigTIFFLong.tif | exact-rgba | error | - | - | - | Could not find MIME for Buffer |
| utif2 | valid/BigTIFFMotorola.tif | exact-rgba | error | - | - | - | UTIF.js omitted dimensions |
| tiff | valid/BigTIFFMotorola.tif | exact-rgba | error | - | - | - | not a TIFF file |
| image-js | valid/BigTIFFMotorola.tif | exact-rgba | error | - | - | - | invalid data format: undefined |
| jimp | valid/BigTIFFMotorola.tif | exact-rgba | error | - | - | - | Could not find MIME for Buffer |
| purejsimage | valid/cmyk-3c-16b.tiff | converted-rgba | success | 23705 | 40 | 12.5002 |  |
| geotiff | valid/cmyk-3c-16b.tiff | converted-rgba | success | 23707 | 255 | 81.4648 |  |
| utif2 | valid/cmyk-3c-16b.tiff | converted-rgba | error | - | - | - | window is not defined |
| tiff | valid/cmyk-3c-16b.tiff | converted-rgba | unsupported | - | - | - | Unsupported image type: 5 |
| image-js | valid/cmyk-3c-16b.tiff | converted-rgba | unsupported | - | - | - | Unsupported image type: 5 |
| jimp | valid/cmyk-3c-16b.tiff | converted-rgba | error | - | - | - | window is not defined |
| purejsimage | valid/cmyk-3c-8b.tiff | converted-rgba | success | 23705 | 40 | 12.4935 |  |
| geotiff | valid/cmyk-3c-8b.tiff | converted-rgba | success | 23707 | 38 | 12.6414 |  |
| utif2 | valid/cmyk-3c-8b.tiff | converted-rgba | error | - | - | - | window is not defined |
| tiff | valid/cmyk-3c-8b.tiff | converted-rgba | unsupported | - | - | - | Unsupported image type: 5 |
| image-js | valid/cmyk-3c-8b.tiff | converted-rgba | unsupported | - | - | - | Unsupported image type: 5 |
| jimp | valid/cmyk-3c-8b.tiff | converted-rgba | error | - | - | - | window is not defined |
| geotiff | valid/cramps-tile.tif | exact-rgba | error | - | - | - | Offset is outside the bounds of the DataView |
| utif2 | valid/cramps-tile.tif | exact-rgba | error | - | - | - | Cannot read properties of undefined (reading 'length') |
| tiff | valid/cramps-tile.tif | exact-rgba | error | - | - | - | Offset is outside the bounds of the DataView |
| image-js | valid/cramps-tile.tif | exact-rgba | error | - | - | - | Offset is outside the bounds of the DataView |
| jimp | valid/cramps-tile.tif | exact-rgba | error | - | - | - | Cannot read properties of undefined (reading 'length') |
| geotiff | valid/cramps.tif | exact-rgba | success | 485600 | 255 | 178.2939 |  |
| tiff | valid/cramps.tif | exact-rgba | unsupported | - | - | - | Unsupported Compression: PackBits |
| image-js | valid/cramps.tif | exact-rgba | unsupported | - | - | - | Unsupported Compression: PackBits |
| utif2 | valid/deflate-last-strip-extra-data.tiff | exact-rgba | success | 2000 | 255 | 10.2104 |  |
| jimp | valid/deflate-last-strip-extra-data.tiff | exact-rgba | success | 2000 | 255 | 10.2104 |  |
| purejsimage | valid/dscf0013.tif | converted-rgba | success | 2 | 1 | 0.0013 |  |
| geotiff | valid/dscf0013.tif | converted-rgba | error | - | - | - | Offset is outside the bounds of the DataView |
| utif2 | valid/dscf0013.tif | converted-rgba | success | 292825 | 111 | 10.3332 |  |
| tiff | valid/dscf0013.tif | converted-rgba | unsupported | - | - | - | Unsupported image type: 6 |
| image-js | valid/dscf0013.tif | converted-rgba | unsupported | - | - | - | Unsupported image type: 6 |
| jimp | valid/dscf0013.tif | converted-rgba | success | 292825 | 111 | 10.3332 |  |
| geotiff | valid/extra_bits_gray_8b.tiff | exact-rgba | success | 64 | 254 | 127.0000 |  |
| utif2 | valid/extra_bits_gray_8b.tiff | exact-rgba | success | 64 | 254 | 127.0000 |  |
| image-js | valid/extra_bits_gray_8b.tiff | exact-rgba | error | - | - | - | incorrect data size: 128. Expected 64 |
| jimp | valid/extra_bits_gray_8b.tiff | exact-rgba | success | 64 | 254 | 127.0000 |  |
| geotiff | valid/extra_bits_rgb_8b.tiff | exact-rgba | success | 64 | 254 | 127.0000 |  |
| image-js | valid/extra_bits_rgb_8b.tiff | exact-rgba | error | - | - | - | incorrect data size: 256. Expected 192 |
| geotiff | valid/fax2d.tif | exact-rgba | unsupported | - | - | - | Unknown compression method identifier: 3 |
| tiff | valid/fax2d.tif | exact-rgba | unsupported | - | - | - | Unsupported Compression: 3 |
| image-js | valid/fax2d.tif | exact-rgba | unsupported | - | - | - | Unsupported Compression: 3 |
| geotiff | valid/fax4.tiff | exact-rgba | unsupported | - | - | - | Unknown compression method identifier: 4 |
| tiff | valid/fax4.tiff | exact-rgba | unsupported | - | - | - | Unsupported Compression: 4 |
| image-js | valid/fax4.tiff | exact-rgba | unsupported | - | - | - | Unsupported Compression: 4 |
| geotiff | valid/flower-minisblack-02.tif | exact-rgba | success | 1647 | 63 | 15.0338 |  |
| tiff | valid/flower-minisblack-02.tif | exact-rgba | unsupported | - | - | - | Unsupported bitDepth: 2 |
| image-js | valid/flower-minisblack-02.tif | exact-rgba | unsupported | - | - | - | Unsupported bitDepth: 2 |
| geotiff | valid/flower-minisblack-04.tif | exact-rgba | success | 3115 | 15 | 5.0106 |  |
| utif2 | valid/flower-minisblack-04.tif | exact-rgba | success | 3139 | 255 | 153.3356 |  |
| tiff | valid/flower-minisblack-04.tif | exact-rgba | unsupported | - | - | - | Unsupported bitDepth: 4 |
| image-js | valid/flower-minisblack-04.tif | exact-rgba | unsupported | - | - | - | Unsupported bitDepth: 4 |
| jimp | valid/flower-minisblack-04.tif | exact-rgba | success | 3139 | 255 | 153.3356 |  |
| geotiff | valid/flower-minisblack-06.tif | exact-rgba | success | 1647 | 3 | 0.7159 |  |
| utif2 | valid/flower-minisblack-06.tif | exact-rgba | success | 3139 | 255 | 155.8345 |  |
| tiff | valid/flower-minisblack-06.tif | exact-rgba | unsupported | - | - | - | Unsupported bitDepth: 6 |
| image-js | valid/flower-minisblack-06.tif | exact-rgba | unsupported | - | - | - | Unsupported bitDepth: 6 |
| jimp | valid/flower-minisblack-06.tif | exact-rgba | success | 3139 | 255 | 155.8345 |  |
| purejsimage | valid/flower-minisblack-10.tif | exact-rgba | success | 1570 | 1 | 0.6125 |  |
| geotiff | valid/flower-minisblack-10.tif | exact-rgba | success | 3120 | 254 | 73.5183 |  |
| utif2 | valid/flower-minisblack-10.tif | exact-rgba | success | 3139 | 255 | 156.6628 |  |
| tiff | valid/flower-minisblack-10.tif | exact-rgba | unsupported | - | - | - | Unsupported bitDepth: 10 |
| image-js | valid/flower-minisblack-10.tif | exact-rgba | unsupported | - | - | - | Unsupported bitDepth: 10 |
| jimp | valid/flower-minisblack-10.tif | exact-rgba | success | 3139 | 255 | 156.6628 |  |
| purejsimage | valid/flower-minisblack-12.tif | exact-rgba | success | 1496 | 1 | 0.5979 |  |
| geotiff | valid/flower-minisblack-12.tif | exact-rgba | success | 3128 | 249 | 78.6037 |  |
| utif2 | valid/flower-minisblack-12.tif | exact-rgba | success | 3139 | 255 | 156.7034 |  |
| tiff | valid/flower-minisblack-12.tif | exact-rgba | unsupported | - | - | - | Unsupported bitDepth: 12 |
| image-js | valid/flower-minisblack-12.tif | exact-rgba | unsupported | - | - | - | Unsupported bitDepth: 12 |
| jimp | valid/flower-minisblack-12.tif | exact-rgba | success | 3139 | 255 | 156.7034 |  |
| purejsimage | valid/flower-minisblack-14.tif | exact-rgba | success | 1502 | 1 | 0.5991 |  |
| geotiff | valid/flower-minisblack-14.tif | exact-rgba | success | 3125 | 235 | 80.2397 |  |
| utif2 | valid/flower-minisblack-14.tif | exact-rgba | success | 3139 | 255 | 156.7144 |  |
| tiff | valid/flower-minisblack-14.tif | exact-rgba | unsupported | - | - | - | Unsupported bitDepth: 14 |
| image-js | valid/flower-minisblack-14.tif | exact-rgba | unsupported | - | - | - | Unsupported bitDepth: 14 |
| jimp | valid/flower-minisblack-14.tif | exact-rgba | success | 3139 | 255 | 156.7144 |  |
| purejsimage | valid/flower-minisblack-16.tif | exact-rgba | success | 568 | 1 | 0.3684 |  |
| tiff | valid/flower-minisblack-16.tif | exact-rgba | success | 568 | 1 | 0.3684 |  |
| purejsimage | valid/flower-palette-02.tif | exact-rgba | success | 1437 | 1 | 0.4032 |  |
| tiff | valid/flower-palette-02.tif | exact-rgba | unsupported | - | - | - | Unsupported bitDepth: 2 |
| image-js | valid/flower-palette-02.tif | exact-rgba | unsupported | - | - | - | Unsupported bitDepth: 2 |
| purejsimage | valid/flower-palette-04.tif | exact-rgba | success | 1632 | 1 | 0.4462 |  |
| tiff | valid/flower-palette-04.tif | exact-rgba | unsupported | - | - | - | Unsupported bitDepth: 4 |
| image-js | valid/flower-palette-04.tif | exact-rgba | unsupported | - | - | - | Unsupported bitDepth: 4 |
| purejsimage | valid/flower-palette-08.tif | exact-rgba | success | 2208 | 1 | 0.5400 |  |
| geotiff | valid/flower-palette-08.tif | exact-rgba | success | 3139 | 248 | 80.4473 |  |
| tiff | valid/flower-palette-08.tif | exact-rgba | success | 1312 | 1 | 0.3622 |  |
| purejsimage | valid/flower-palette-16.tif | exact-rgba | success | 1918 | 1 | 0.4912 |  |
| geotiff | valid/flower-palette-16.tif | exact-rgba | success | 3138 | 253 | 88.0369 |  |
| utif2 | valid/flower-palette-16.tif | exact-rgba | error | - | - | - | 16 |
| tiff | valid/flower-palette-16.tif | exact-rgba | success | 1606 | 1 | 0.4155 |  |
| jimp | valid/flower-palette-16.tif | exact-rgba | error | - | - | - | 16 |
| geotiff | valid/flower-rgb-contig-02.tif | exact-rgba | success | 1753 | 253 | 58.5717 |  |
| utif2 | valid/flower-rgb-contig-02.tif | exact-rgba | error | - | - | - | 2 |
| tiff | valid/flower-rgb-contig-02.tif | exact-rgba | unsupported | - | - | - | Unsupported bitDepth: 2 |
| image-js | valid/flower-rgb-contig-02.tif | exact-rgba | unsupported | - | - | - | Unsupported bitDepth: 2 |
| jimp | valid/flower-rgb-contig-02.tif | exact-rgba | error | - | - | - | 2 |
| geotiff | valid/flower-rgb-contig-04.tif | exact-rgba | success | 3135 | 241 | 76.3462 |  |
| utif2 | valid/flower-rgb-contig-04.tif | exact-rgba | error | - | - | - | 4 |
| tiff | valid/flower-rgb-contig-04.tif | exact-rgba | unsupported | - | - | - | Unsupported bitDepth: 4 |
| image-js | valid/flower-rgb-contig-04.tif | exact-rgba | unsupported | - | - | - | Unsupported bitDepth: 4 |
| jimp | valid/flower-rgb-contig-04.tif | exact-rgba | error | - | - | - | 4 |
| purejsimage | valid/flower-rgb-contig-10.tif | exact-rgba | success | 2691 | 1 | 0.6041 |  |
| geotiff | valid/flower-rgb-contig-10.tif | exact-rgba | success | 3139 | 251 | 88.7771 |  |
| utif2 | valid/flower-rgb-contig-10.tif | exact-rgba | error | - | - | - | 10 |
| tiff | valid/flower-rgb-contig-10.tif | exact-rgba | unsupported | - | - | - | Unsupported bitDepth: 10 |
| image-js | valid/flower-rgb-contig-10.tif | exact-rgba | unsupported | - | - | - | Unsupported bitDepth: 10 |
| jimp | valid/flower-rgb-contig-10.tif | exact-rgba | error | - | - | - | 10 |
| purejsimage | valid/flower-rgb-contig-12.tif | exact-rgba | success | 2730 | 1 | 0.6061 |  |
| geotiff | valid/flower-rgb-contig-12.tif | exact-rgba | success | 3139 | 239 | 78.2901 |  |
| utif2 | valid/flower-rgb-contig-12.tif | exact-rgba | error | - | - | - | 12 |
| tiff | valid/flower-rgb-contig-12.tif | exact-rgba | unsupported | - | - | - | Unsupported bitDepth: 12 |
| image-js | valid/flower-rgb-contig-12.tif | exact-rgba | unsupported | - | - | - | Unsupported bitDepth: 12 |
| jimp | valid/flower-rgb-contig-12.tif | exact-rgba | error | - | - | - | 12 |
| purejsimage | valid/flower-rgb-contig-14.tif | exact-rgba | success | 2722 | 1 | 0.6067 |  |
| geotiff | valid/flower-rgb-contig-14.tif | exact-rgba | success | 3139 | 245 | 68.5819 |  |
| utif2 | valid/flower-rgb-contig-14.tif | exact-rgba | error | - | - | - | 14 |
| tiff | valid/flower-rgb-contig-14.tif | exact-rgba | unsupported | - | - | - | Unsupported bitDepth: 14 |
| image-js | valid/flower-rgb-contig-14.tif | exact-rgba | unsupported | - | - | - | Unsupported bitDepth: 14 |
| jimp | valid/flower-rgb-contig-14.tif | exact-rgba | error | - | - | - | 14 |
| purejsimage | valid/flower-rgb-contig-16.tif | exact-rgba | success | 1501 | 1 | 0.3989 |  |
| geotiff | valid/flower-rgb-contig-16.tif | exact-rgba | success | 1501 | 1 | 0.3989 |  |
| tiff | valid/flower-rgb-contig-16.tif | exact-rgba | success | 1501 | 1 | 0.3989 |  |
| geotiff | valid/flower-rgb-planar-02.tif | exact-rgba | success | 1753 | 252 | 58.5825 |  |
| utif2 | valid/flower-rgb-planar-02.tif | exact-rgba | error | - | - | - | 2 |
| tiff | valid/flower-rgb-planar-02.tif | exact-rgba | unsupported | - | - | - | Unsupported bitDepth: 2 |
| image-js | valid/flower-rgb-planar-02.tif | exact-rgba | unsupported | - | - | - | Unsupported bitDepth: 2 |
| jimp | valid/flower-rgb-planar-02.tif | exact-rgba | error | - | - | - | 2 |
| geotiff | valid/flower-rgb-planar-04.tif | exact-rgba | success | 3135 | 240 | 76.6938 |  |
| utif2 | valid/flower-rgb-planar-04.tif | exact-rgba | error | - | - | - | 4 |
| tiff | valid/flower-rgb-planar-04.tif | exact-rgba | unsupported | - | - | - | Unsupported bitDepth: 4 |
| image-js | valid/flower-rgb-planar-04.tif | exact-rgba | unsupported | - | - | - | Unsupported bitDepth: 4 |
| jimp | valid/flower-rgb-planar-04.tif | exact-rgba | error | - | - | - | 4 |
| utif2 | valid/flower-rgb-planar-08.tif | exact-rgba | success | 3139 | 255 | 68.6578 |  |
| tiff | valid/flower-rgb-planar-08.tif | exact-rgba | error | - | - | - | Offset is outside the bounds of the DataView |
| image-js | valid/flower-rgb-planar-08.tif | exact-rgba | error | - | - | - | Offset is outside the bounds of the DataView |
| jimp | valid/flower-rgb-planar-08.tif | exact-rgba | success | 3139 | 255 | 68.6578 |  |
| purejsimage | valid/flower-rgb-planar-10.tif | exact-rgba | success | 2691 | 1 | 0.6041 |  |
| geotiff | valid/flower-rgb-planar-10.tif | exact-rgba | success | 3139 | 191 | 81.4959 |  |
| utif2 | valid/flower-rgb-planar-10.tif | exact-rgba | error | - | - | - | 10 |
| tiff | valid/flower-rgb-planar-10.tif | exact-rgba | unsupported | - | - | - | Unsupported bitDepth: 10 |
| image-js | valid/flower-rgb-planar-10.tif | exact-rgba | unsupported | - | - | - | Unsupported bitDepth: 10 |
| jimp | valid/flower-rgb-planar-10.tif | exact-rgba | error | - | - | - | 10 |
| purejsimage | valid/flower-rgb-planar-12.tif | exact-rgba | success | 2730 | 1 | 0.6061 |  |
| geotiff | valid/flower-rgb-planar-12.tif | exact-rgba | success | 3139 | 239 | 82.7002 |  |
| utif2 | valid/flower-rgb-planar-12.tif | exact-rgba | error | - | - | - | 12 |
| tiff | valid/flower-rgb-planar-12.tif | exact-rgba | unsupported | - | - | - | Unsupported bitDepth: 12 |
| image-js | valid/flower-rgb-planar-12.tif | exact-rgba | unsupported | - | - | - | Unsupported bitDepth: 12 |
| jimp | valid/flower-rgb-planar-12.tif | exact-rgba | error | - | - | - | 12 |
| purejsimage | valid/flower-rgb-planar-14.tif | exact-rgba | success | 2722 | 1 | 0.6067 |  |
| geotiff | valid/flower-rgb-planar-14.tif | exact-rgba | success | 3139 | 246 | 84.0886 |  |
| utif2 | valid/flower-rgb-planar-14.tif | exact-rgba | error | - | - | - | 14 |
| tiff | valid/flower-rgb-planar-14.tif | exact-rgba | unsupported | - | - | - | Unsupported bitDepth: 14 |
| image-js | valid/flower-rgb-planar-14.tif | exact-rgba | unsupported | - | - | - | Unsupported bitDepth: 14 |
| jimp | valid/flower-rgb-planar-14.tif | exact-rgba | error | - | - | - | 14 |
| purejsimage | valid/flower-rgb-planar-16.tif | exact-rgba | success | 1501 | 1 | 0.3989 |  |
| geotiff | valid/flower-rgb-planar-16.tif | exact-rgba | success | 1501 | 1 | 0.3989 |  |
| utif2 | valid/flower-rgb-planar-16.tif | exact-rgba | success | 3139 | 255 | 68.9215 |  |
| tiff | valid/flower-rgb-planar-16.tif | exact-rgba | error | - | - | - | Offset is outside the bounds of the DataView |
| image-js | valid/flower-rgb-planar-16.tif | exact-rgba | error | - | - | - | Offset is outside the bounds of the DataView |
| jimp | valid/flower-rgb-planar-16.tif | exact-rgba | success | 3139 | 255 | 68.9215 |  |
| purejsimage | valid/flower-separated-contig-08.tif | converted-rgba | success | 3129 | 23 | 9.2932 |  |
| geotiff | valid/flower-separated-contig-08.tif | converted-rgba | success | 3135 | 24 | 9.8483 |  |
| utif2 | valid/flower-separated-contig-08.tif | converted-rgba | error | - | - | - | window is not defined |
| tiff | valid/flower-separated-contig-08.tif | converted-rgba | unsupported | - | - | - | Unsupported image type: 5 |
| image-js | valid/flower-separated-contig-08.tif | converted-rgba | unsupported | - | - | - | Unsupported image type: 5 |
| jimp | valid/flower-separated-contig-08.tif | converted-rgba | error | - | - | - | window is not defined |
| purejsimage | valid/flower-separated-contig-16.tif | converted-rgba | success | 3131 | 23 | 9.3006 |  |
| geotiff | valid/flower-separated-contig-16.tif | converted-rgba | success | 3139 | 254 | 98.3960 |  |
| utif2 | valid/flower-separated-contig-16.tif | converted-rgba | error | - | - | - | window is not defined |
| tiff | valid/flower-separated-contig-16.tif | converted-rgba | unsupported | - | - | - | Unsupported image type: 5 |
| image-js | valid/flower-separated-contig-16.tif | converted-rgba | unsupported | - | - | - | Unsupported image type: 5 |
| jimp | valid/flower-separated-contig-16.tif | converted-rgba | error | - | - | - | window is not defined |
| purejsimage | valid/flower-separated-planar-08.tif | converted-rgba | success | 3129 | 23 | 9.2932 |  |
| geotiff | valid/flower-separated-planar-08.tif | converted-rgba | success | 3135 | 24 | 9.8483 |  |
| utif2 | valid/flower-separated-planar-08.tif | converted-rgba | error | - | - | - | window is not defined |
| tiff | valid/flower-separated-planar-08.tif | converted-rgba | unsupported | - | - | - | Unsupported image type: 5 |
| image-js | valid/flower-separated-planar-08.tif | converted-rgba | unsupported | - | - | - | Unsupported image type: 5 |
| jimp | valid/flower-separated-planar-08.tif | converted-rgba | error | - | - | - | window is not defined |
| purejsimage | valid/flower-separated-planar-16.tif | converted-rgba | success | 3131 | 23 | 9.3006 |  |
| geotiff | valid/flower-separated-planar-16.tif | converted-rgba | success | 3139 | 254 | 98.3960 |  |
| utif2 | valid/flower-separated-planar-16.tif | converted-rgba | error | - | - | - | window is not defined |
| tiff | valid/flower-separated-planar-16.tif | converted-rgba | unsupported | - | - | - | Unsupported image type: 5 |
| image-js | valid/flower-separated-planar-16.tif | converted-rgba | unsupported | - | - | - | Unsupported image type: 5 |
| jimp | valid/flower-separated-planar-16.tif | converted-rgba | error | - | - | - | window is not defined |
| geotiff | valid/g3test.tif | exact-rgba | unsupported | - | - | - | Unknown compression method identifier: 3 |
| tiff | valid/g3test.tif | exact-rgba | unsupported | - | - | - | Unsupported Compression: 3 |
| image-js | valid/g3test.tif | exact-rgba | unsupported | - | - | - | Unsupported Compression: 3 |
| purejsimage | valid/hpredict_packbits.tiff | exact-rgba | success | 482 | 1 | 0.3837 |  |
| geotiff | valid/hpredict_packbits.tiff | exact-rgba | success | 1024 | 255 | 122.1920 |  |
| utif2 | valid/hpredict_packbits.tiff | exact-rgba | success | 900 | 239 | 79.2581 |  |
| tiff | valid/hpredict_packbits.tiff | exact-rgba | unsupported | - | - | - | Unsupported Compression: PackBits |
| image-js | valid/hpredict_packbits.tiff | exact-rgba | unsupported | - | - | - | Unsupported Compression: PackBits |
| jimp | valid/hpredict_packbits.tiff | exact-rgba | success | 900 | 239 | 79.2581 |  |
| purejsimage | valid/hpredict.tiff | exact-rgba | success | 622 | 1 | 0.4305 |  |
| geotiff | valid/hpredict.tiff | exact-rgba | success | 1024 | 255 | 123.1947 |  |
| utif2 | valid/hpredict.tiff | exact-rgba | success | 900 | 239 | 80.7953 |  |
| tiff | valid/hpredict.tiff | exact-rgba | success | 622 | 1 | 0.4305 |  |
| image-js | valid/hpredict.tiff | exact-rgba | success | 1024 | 255 | 93.0012 |  |
| jimp | valid/hpredict.tiff | exact-rgba | success | 900 | 239 | 80.7953 |  |
| geotiff | valid/imagemagick_group4.tiff | exact-rgba | unsupported | - | - | - | Unknown compression method identifier: 4 |
| tiff | valid/imagemagick_group4.tiff | exact-rgba | unsupported | - | - | - | Unsupported Compression: 4 |
| image-js | valid/imagemagick_group4.tiff | exact-rgba | unsupported | - | - | - | Unsupported Compression: 4 |
| purejsimage | valid/issue_69_lzw.tiff | exact-rgba | success | 1209 | 1 | 0.6692 |  |
| tiff | valid/issue_69_lzw.tiff | exact-rgba | success | 1209 | 1 | 0.6692 |  |
| purejsimage | valid/issue_69_packbits.tiff | exact-rgba | success | 1209 | 1 | 0.6692 |  |
| tiff | valid/issue_69_packbits.tiff | exact-rgba | unsupported | - | - | - | Unsupported Compression: PackBits |
| image-js | valid/issue_69_packbits.tiff | exact-rgba | unsupported | - | - | - | Unsupported Compression: PackBits |
| geotiff | valid/jello.tif | exact-rgba | success | 49152 | 231 | 126.7718 |  |
| tiff | valid/jello.tif | exact-rgba | unsupported | - | - | - | Unsupported Compression: PackBits |
| image-js | valid/jello.tif | exact-rgba | unsupported | - | - | - | Unsupported Compression: PackBits |
| geotiff | valid/jim___ah.tif | exact-rgba | success | 539832 | 255 | 168.6429 |  |
| geotiff | valid/jim___dg.tif | exact-rgba | success | 93903 | 255 | 1.1267 |  |
| geotiff | valid/jim___gg.tif | exact-rgba | success | 93903 | 255 | 1.1267 |  |
| geotiff | valid/l1_xmp.tiff | exact-rgba | success | 5047 | 127 | 78.1360 |  |
| geotiff | valid/l1.tiff | exact-rgba | success | 5047 | 127 | 78.1360 |  |
| purejsimage | valid/ladoga.tif | exact-rgba | success | 4309 | 1 | 0.4163 |  |
| tiff | valid/ladoga.tif | exact-rgba | success | 4309 | 1 | 0.4163 |  |
| geotiff | valid/lzw-single-strip.tiff | exact-rgba | success | 24335990 | 255 | 219.0701 |  |
| purejsimage | valid/minisblack-1c-16b.tiff | exact-rgba | success | 4170 | 1 | 0.3632 |  |
| tiff | valid/minisblack-1c-16b.tiff | exact-rgba | success | 4170 | 1 | 0.3632 |  |
| purejsimage | valid/minisblack-2c-8b-alpha.tiff | exact-rgba | success | 3036 | 255 | 118.5140 |  |
| geotiff | valid/minisblack-2c-8b-alpha.tiff | exact-rgba | success | 3980 | 255 | 120.9617 |  |
| utif2 | valid/minisblack-2c-8b-alpha.tiff | exact-rgba | success | 4094 | 255 | 121.0771 |  |
| tiff | valid/minisblack-2c-8b-alpha.tiff | exact-rgba | unsupported | - | - | - | Unsupported Compression: PackBits |
| image-js | valid/minisblack-2c-8b-alpha.tiff | exact-rgba | unsupported | - | - | - | Unsupported Compression: PackBits |
| jimp | valid/minisblack-2c-8b-alpha.tiff | exact-rgba | success | 4094 | 255 | 121.0771 |  |
| geotiff | valid/miniswhite-1c-1b.tiff | exact-rgba | success | 23707 | 255 | 174.7215 |  |
| purejsimage | valid/ojpeg_chewey_subsamp21_multi_strip.tiff | converted-rgba | success | 203480 | 15 | 1.0064 |  |
| geotiff | valid/ojpeg_chewey_subsamp21_multi_strip.tiff | converted-rgba | unsupported | - | - | - | old style JPEG compression is not supported. |
| utif2 | valid/ojpeg_chewey_subsamp21_multi_strip.tiff | converted-rgba | error | - | - | - | JPEG error: SOI not found |
| tiff | valid/ojpeg_chewey_subsamp21_multi_strip.tiff | converted-rgba | unsupported | - | - | - | Unsupported image type: 6 |
| image-js | valid/ojpeg_chewey_subsamp21_multi_strip.tiff | converted-rgba | unsupported | - | - | - | Unsupported image type: 6 |
| jimp | valid/ojpeg_chewey_subsamp21_multi_strip.tiff | converted-rgba | error | - | - | - | JPEG error: SOI not found |
| purejsimage | valid/ojpeg_single_strip_no_rowsperstrip.tiff | converted-rgba | oracle-failure | - | - | - | sharp: tiff2vips: Defined set_get_field_type of custom tag 0 (Tag 0) is TIFF_SETGET_UNDEFINED and thus tag is not read from file tiff2vips: Old-style JPEG compression support is not configured tiff2vips: Defined set_get_field_type of custom tag 0 (Tag 0) is TIFF_SETGET_UNDEFINED and thus tag is not read from file tiff2vips: Old-style JPEG compression support is not configured tiff2vips: Defined set_get_field_type of custom tag 0 (Tag 0) is TIFF_SETGET_UNDEFINED and thus tag is not read from file |
| geotiff | valid/ojpeg_single_strip_no_rowsperstrip.tiff | converted-rgba | oracle-failure | - | - | - | sharp: tiff2vips: Defined set_get_field_type of custom tag 0 (Tag 0) is TIFF_SETGET_UNDEFINED and thus tag is not read from file tiff2vips: Old-style JPEG compression support is not configured tiff2vips: Defined set_get_field_type of custom tag 0 (Tag 0) is TIFF_SETGET_UNDEFINED and thus tag is not read from file tiff2vips: Old-style JPEG compression support is not configured tiff2vips: Defined set_get_field_type of custom tag 0 (Tag 0) is TIFF_SETGET_UNDEFINED and thus tag is not read from file |
| utif2 | valid/ojpeg_single_strip_no_rowsperstrip.tiff | converted-rgba | oracle-failure | - | - | - | sharp: tiff2vips: Defined set_get_field_type of custom tag 0 (Tag 0) is TIFF_SETGET_UNDEFINED and thus tag is not read from file tiff2vips: Old-style JPEG compression support is not configured tiff2vips: Defined set_get_field_type of custom tag 0 (Tag 0) is TIFF_SETGET_UNDEFINED and thus tag is not read from file tiff2vips: Old-style JPEG compression support is not configured tiff2vips: Defined set_get_field_type of custom tag 0 (Tag 0) is TIFF_SETGET_UNDEFINED and thus tag is not read from file |
| tiff | valid/ojpeg_single_strip_no_rowsperstrip.tiff | converted-rgba | oracle-failure | - | - | - | sharp: tiff2vips: Defined set_get_field_type of custom tag 0 (Tag 0) is TIFF_SETGET_UNDEFINED and thus tag is not read from file tiff2vips: Old-style JPEG compression support is not configured tiff2vips: Defined set_get_field_type of custom tag 0 (Tag 0) is TIFF_SETGET_UNDEFINED and thus tag is not read from file tiff2vips: Old-style JPEG compression support is not configured tiff2vips: Defined set_get_field_type of custom tag 0 (Tag 0) is TIFF_SETGET_UNDEFINED and thus tag is not read from file |
| image-js | valid/ojpeg_single_strip_no_rowsperstrip.tiff | converted-rgba | oracle-failure | - | - | - | sharp: tiff2vips: Defined set_get_field_type of custom tag 0 (Tag 0) is TIFF_SETGET_UNDEFINED and thus tag is not read from file tiff2vips: Old-style JPEG compression support is not configured tiff2vips: Defined set_get_field_type of custom tag 0 (Tag 0) is TIFF_SETGET_UNDEFINED and thus tag is not read from file tiff2vips: Old-style JPEG compression support is not configured tiff2vips: Defined set_get_field_type of custom tag 0 (Tag 0) is TIFF_SETGET_UNDEFINED and thus tag is not read from file |
| jimp | valid/ojpeg_single_strip_no_rowsperstrip.tiff | converted-rgba | oracle-failure | - | - | - | sharp: tiff2vips: Defined set_get_field_type of custom tag 0 (Tag 0) is TIFF_SETGET_UNDEFINED and thus tag is not read from file tiff2vips: Old-style JPEG compression support is not configured tiff2vips: Defined set_get_field_type of custom tag 0 (Tag 0) is TIFF_SETGET_UNDEFINED and thus tag is not read from file tiff2vips: Old-style JPEG compression support is not configured tiff2vips: Defined set_get_field_type of custom tag 0 (Tag 0) is TIFF_SETGET_UNDEFINED and thus tag is not read from file |
| purejsimage | valid/ojpeg_zackthecat_subsamp22_single_strip.tiff | converted-rgba | success | 49842 | 255 | 145.2668 |  |
| geotiff | valid/ojpeg_zackthecat_subsamp22_single_strip.tiff | converted-rgba | unsupported | - | - | - | old style JPEG compression is not supported. |
| utif2 | valid/ojpeg_zackthecat_subsamp22_single_strip.tiff | converted-rgba | error | - | - | - | JPEG error: SOI not found |
| tiff | valid/ojpeg_zackthecat_subsamp22_single_strip.tiff | converted-rgba | unsupported | - | - | - | Unsupported image type: 6 |
| image-js | valid/ojpeg_zackthecat_subsamp22_single_strip.tiff | converted-rgba | unsupported | - | - | - | Unsupported image type: 6 |
| jimp | valid/ojpeg_zackthecat_subsamp22_single_strip.tiff | converted-rgba | error | - | - | - | JPEG error: SOI not found |
| geotiff | valid/oxford.tif | exact-rgba | error | - | - | - | Offset is outside the bounds of the DataView |
| utif2 | valid/oxford.tif | exact-rgba | success | 27049 | 255 | 113.9654 |  |
| tiff | valid/oxford.tif | exact-rgba | error | - | - | - | Offset is outside the bounds of the DataView |
| image-js | valid/oxford.tif | exact-rgba | error | - | - | - | Offset is outside the bounds of the DataView |
| jimp | valid/oxford.tif | exact-rgba | success | 27049 | 255 | 113.9654 |  |
| purejsimage | valid/palette-1c-4b.tiff | exact-rgba | success | 19365 | 1 | 0.6338 |  |
| tiff | valid/palette-1c-4b.tiff | exact-rgba | unsupported | - | - | - | Unsupported bitDepth: 4 |
| image-js | valid/palette-1c-4b.tiff | exact-rgba | unsupported | - | - | - | Unsupported bitDepth: 4 |
| purejsimage | valid/palette-1c-8b.tiff | exact-rgba | success | 18378 | 1 | 0.5574 |  |
| geotiff | valid/palette-1c-8b.tiff | exact-rgba | success | 23707 | 239 | 86.8111 |  |
| tiff | valid/palette-1c-8b.tiff | exact-rgba | success | 12619 | 1 | 0.4156 |  |
| utif2 | valid/planar-rgb-u8.tif | exact-rgba | success | 186551 | 255 | 78.6846 |  |
| tiff | valid/planar-rgb-u8.tif | exact-rgba | error | - | - | - | Offset is outside the bounds of the DataView |
| image-js | valid/planar-rgb-u8.tif | exact-rgba | error | - | - | - | Offset is outside the bounds of the DataView |
| jimp | valid/planar-rgb-u8.tif | exact-rgba | success | 186551 | 255 | 78.6846 |  |
| purejsimage | valid/quad-jpeg.tif | converted-rgba | success | 82586 | 3 | 0.4262 |  |
| geotiff | valid/quad-jpeg.tif | converted-rgba | success | 96082 | 85 | 3.1573 |  |
| utif2 | valid/quad-jpeg.tif | converted-rgba | success | 96292 | 85 | 3.1575 |  |
| tiff | valid/quad-jpeg.tif | converted-rgba | unsupported | - | - | - | Unsupported image type: 6 |
| image-js | valid/quad-jpeg.tif | converted-rgba | unsupported | - | - | - | Unsupported image type: 6 |
| jimp | valid/quad-jpeg.tif | converted-rgba | success | 96292 | 85 | 3.1575 |  |
| geotiff | valid/quad-lzw-compat.tiff | - | process-crash | - | - | - | <--- Last few GCs ---> [670974:0x149ec000]     1711 ms: Mark-Compact 658.1 (789.5) -> 402.6 (532.5) MB, pooled: 4 MB, 294.95 / 0.00 ms  (average mu = 0.385, current mu = 0.351) allocation failure; scavenge might not succeed [670974:0x149ec000]     2390 ms: Mark-Compact 976.4 (1106.3) -> 593.8 (723.0) MB, pooled: 4 MB, 445.46 / 0.00 ms  (average mu = 0.358, current mu = 0.344) allocation failure; scavenge might not succeed FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out |
| utif2 | valid/quad-lzw-compat.tiff | - | timeout | - | - | - | worker timed out |
| tiff | valid/quad-lzw-compat.tiff | exact-rgba | error | - | - | - | Offset is outside the bounds of the DataView |
| image-js | valid/quad-lzw-compat.tiff | exact-rgba | error | - | - | - | Offset is outside the bounds of the DataView |
| jimp | valid/quad-lzw-compat.tiff | - | timeout | - | - | - | worker timed out |
| geotiff | valid/quad-lzw.tif | - | process-crash | - | - | - | <--- Last few GCs ---> [671243:0x3a712000]     1805 ms: Mark-Compact 658.1 (789.5) -> 402.6 (532.5) MB, pooled: 5 MB, 318.47 / 0.00 ms  (average mu = 0.382, current mu = 0.336) allocation failure; scavenge might not succeed [671243:0x3a712000]     2557 ms: Mark-Compact 976.4 (1106.3) -> 593.8 (722.5) MB, pooled: 6 MB, 486.19 / 0.00 ms  (average mu = 0.363, current mu = 0.354) allocation failure; scavenge might not succeed FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out |
| utif2 | valid/quad-lzw.tif | - | timeout | - | - | - | worker timed out |
| tiff | valid/quad-lzw.tif | exact-rgba | error | - | - | - | Offset is outside the bounds of the DataView |
| image-js | valid/quad-lzw.tif | exact-rgba | error | - | - | - | Offset is outside the bounds of the DataView |
| jimp | valid/quad-lzw.tif | - | timeout | - | - | - | worker timed out |
| purejsimage | valid/quad-tile.jpg.tiff | converted-rgba | success | 83544 | 3 | 0.4244 |  |
| geotiff | valid/quad-tile.jpg.tiff | converted-rgba | success | 99423 | 95 | 3.3603 |  |
| utif2 | valid/quad-tile.jpg.tiff | converted-rgba | success | 99608 | 95 | 3.3605 |  |
| tiff | valid/quad-tile.jpg.tiff | converted-rgba | unsupported | - | - | - | Unsupported image type: 6 |
| image-js | valid/quad-tile.jpg.tiff | converted-rgba | unsupported | - | - | - | Unsupported image type: 6 |
| jimp | valid/quad-tile.jpg.tiff | converted-rgba | success | 99608 | 95 | 3.3605 |  |
| geotiff | valid/quad-tile.tif | exact-rgba | error | - | - | - | Offset is outside the bounds of the DataView |
| utif2 | valid/quad-tile.tif | exact-rgba | error | - | - | - | Cannot read properties of undefined (reading '0') |
| tiff | valid/quad-tile.tif | exact-rgba | error | - | - | - | Offset is outside the bounds of the DataView |
| image-js | valid/quad-tile.tif | exact-rgba | error | - | - | - | Offset is outside the bounds of the DataView |
| jimp | valid/quad-tile.tif | exact-rgba | error | - | - | - | Cannot read properties of undefined (reading '0') |
| purejsimage | valid/rgb-3c-16b.tiff | exact-rgba | success | 12361 | 1 | 0.4096 |  |
| geotiff | valid/rgb-3c-16b.tiff | exact-rgba | success | 12361 | 1 | 0.4096 |  |
| tiff | valid/rgb-3c-16b.tiff | exact-rgba | success | 12361 | 1 | 0.4096 |  |
| purejsimage | valid/smallliz.tif | converted-rgba | success | 24575 | 34 | 2.3374 |  |
| geotiff | valid/smallliz.tif | converted-rgba | unsupported | - | - | - | old style JPEG compression is not supported. |
| utif2 | valid/smallliz.tif | converted-rgba | error | - | - | - | JPEG error: SOI not found |
| tiff | valid/smallliz.tif | converted-rgba | unsupported | - | - | - | Unsupported image type: 6 |
| image-js | valid/smallliz.tif | converted-rgba | unsupported | - | - | - | Unsupported image type: 6 |
| jimp | valid/smallliz.tif | converted-rgba | error | - | - | - | JPEG error: SOI not found |
| purejsimage | valid/strike.tif | exact-rgba | success | 3258 | 1 | 0.1651 |  |
| geotiff | valid/strike.tif | exact-rgba | success | 24269 | 255 | 84.5620 |  |
| utif2 | valid/strike.tif | exact-rgba | success | 4217 | 254 | 19.5602 |  |
| tiff | valid/strike.tif | exact-rgba | success | 3357 | 255 | 8.1886 |  |
| image-js | valid/strike.tif | exact-rgba | success | 24269 | 255 | 82.6752 |  |
| jimp | valid/strike.tif | exact-rgba | success | 4217 | 254 | 19.5602 |  |
| geotiff | valid/testfax3_bug_513.tiff | exact-rgba | unsupported | - | - | - | Unknown compression method identifier: 3 |
| tiff | valid/testfax3_bug_513.tiff | exact-rgba | unsupported | - | - | - | Unsupported Compression: 3 |
| image-js | valid/testfax3_bug_513.tiff | exact-rgba | unsupported | - | - | - | Unsupported Compression: 3 |
| geotiff | valid/testfax3_bug54_1dnoEOL.tif | exact-rgba | unsupported | - | - | - | Unknown compression method identifier: 3 |
| utif2 | valid/testfax3_bug54_1dnoEOL.tif | exact-rgba | success | 227223 | 255 | 52.5752 |  |
| tiff | valid/testfax3_bug54_1dnoEOL.tif | exact-rgba | unsupported | - | - | - | Unsupported Compression: 3 |
| image-js | valid/testfax3_bug54_1dnoEOL.tif | exact-rgba | unsupported | - | - | - | Unsupported Compression: 3 |
| jimp | valid/testfax3_bug54_1dnoEOL.tif | exact-rgba | success | 227223 | 255 | 52.5752 |  |
| purejsimage | valid/text.tif | exact-rgba | oracle-failure | - | - | - | sharp: tiff2vips: Not enough data at scanline 320 (0 != 1512); ImageMagick: identify: Not enough data at scanline 320 (0 != 1512). `ThunderDecode' @ error/tiff.c/TIFFErrors/575. |
| geotiff | valid/text.tif | exact-rgba | oracle-failure | - | - | - | sharp: tiff2vips: Not enough data at scanline 320 (0 != 1512); ImageMagick: identify: Not enough data at scanline 320 (0 != 1512). `ThunderDecode' @ error/tiff.c/TIFFErrors/575. |
| utif2 | valid/text.tif | exact-rgba | oracle-failure | - | - | - | sharp: tiff2vips: Not enough data at scanline 320 (0 != 1512); ImageMagick: identify: Not enough data at scanline 320 (0 != 1512). `ThunderDecode' @ error/tiff.c/TIFFErrors/575. |
| tiff | valid/text.tif | exact-rgba | oracle-failure | - | - | - | sharp: tiff2vips: Not enough data at scanline 320 (0 != 1512); ImageMagick: identify: Not enough data at scanline 320 (0 != 1512). `ThunderDecode' @ error/tiff.c/TIFFErrors/575. |
| image-js | valid/text.tif | exact-rgba | oracle-failure | - | - | - | sharp: tiff2vips: Not enough data at scanline 320 (0 != 1512); ImageMagick: identify: Not enough data at scanline 320 (0 != 1512). `ThunderDecode' @ error/tiff.c/TIFFErrors/575. |
| jimp | valid/text.tif | exact-rgba | oracle-failure | - | - | - | sharp: tiff2vips: Not enough data at scanline 320 (0 != 1512); ImageMagick: identify: Not enough data at scanline 320 (0 != 1512). `ThunderDecode' @ error/tiff.c/TIFFErrors/575. |
| geotiff | valid/tiled-gray-i1.tif | exact-rgba | success | 934 | 127 | 77.3788 |  |
| purejsimage | valid/tiled-jpeg-rgb-u8.tif | converted-rgba | success | 6849 | 1 | 0.0971 |  |
| geotiff | valid/tiled-jpeg-rgb-u8.tif | converted-rgba | success | 28138 | 1 | 0.2025 |  |
| utif2 | valid/tiled-jpeg-rgb-u8.tif | converted-rgba | success | 28138 | 1 | 0.2025 |  |
| tiff | valid/tiled-jpeg-rgb-u8.tif | converted-rgba | unsupported | - | - | - | Unsupported Compression: 7 |
| image-js | valid/tiled-jpeg-rgb-u8.tif | converted-rgba | unsupported | - | - | - | Unsupported Compression: 7 |
| jimp | valid/tiled-jpeg-rgb-u8.tif | converted-rgba | success | 28138 | 1 | 0.2025 |  |
| purejsimage | valid/tiled-jpeg-ycbcr.tif | converted-rgba | success | 158116 | 4 | 0.6376 |  |
| geotiff | valid/tiled-jpeg-ycbcr.tif | converted-rgba | success | 75942 | 16 | 0.8564 |  |
| utif2 | valid/tiled-jpeg-ycbcr.tif | converted-rgba | success | 79065 | 16 | 0.8591 |  |
| tiff | valid/tiled-jpeg-ycbcr.tif | converted-rgba | unsupported | - | - | - | Unsupported image type: 6 |
| image-js | valid/tiled-jpeg-ycbcr.tif | converted-rgba | unsupported | - | - | - | Unsupported image type: 6 |
| jimp | valid/tiled-jpeg-ycbcr.tif | converted-rgba | success | 79065 | 16 | 0.8591 |  |
| tiff | valid/tiled-rect-rgb-u8.tif | exact-rgba | success | 179830 | 255 | 103.9493 |  |
| image-js | valid/tiled-rect-rgb-u8.tif | exact-rgba | success | 179830 | 255 | 103.9493 |  |
| tiff | valid/tiled-rgb-u8.tif | exact-rgba | success | 186625 | 255 | 84.8972 |  |
| image-js | valid/tiled-rgb-u8.tif | exact-rgba | success | 186625 | 255 | 84.8972 |  |
| geotiff | valid/Transparency-lzw.tif | exact-rgba | success | 52537 | 255 | 97.4109 |  |
| image-js | valid/Transparency-lzw.tif | exact-rgba | success | 52537 | 255 | 97.4109 |  |
| geotiff | valid/webp_lossless_rgba_alpha_fully_opaque.tif | converted-rgba | error | - | - | - | Cannot decode WebImage as `createImageBitmap` is not available |
| utif2 | valid/webp_lossless_rgba_alpha_fully_opaque.tif | converted-rgba | success | 400 | 255 | 169.4183 |  |
| tiff | valid/webp_lossless_rgba_alpha_fully_opaque.tif | converted-rgba | unsupported | - | - | - | Unsupported Compression: 50001 |
| image-js | valid/webp_lossless_rgba_alpha_fully_opaque.tif | converted-rgba | unsupported | - | - | - | Unsupported Compression: 50001 |
| jimp | valid/webp_lossless_rgba_alpha_fully_opaque.tif | converted-rgba | success | 400 | 255 | 169.4183 |  |
| purejsimage | valid/ycbcr-cat.tif | converted-rgba | success | 94 | 1 | 0.0170 |  |
| geotiff | valid/ycbcr-cat.tif | converted-rgba | error | - | - | - | Offset is outside the bounds of the DataView |
| utif2 | valid/ycbcr-cat.tif | converted-rgba | success | 80808 | 255 | 65.5227 |  |
| tiff | valid/ycbcr-cat.tif | converted-rgba | unsupported | - | - | - | Unsupported image type: 6 |
| image-js | valid/ycbcr-cat.tif | converted-rgba | unsupported | - | - | - | Unsupported image type: 6 |
| jimp | valid/ycbcr-cat.tif | converted-rgba | success | 80808 | 255 | 65.5227 |  |
| purejsimage | valid/zackthecat.tif | converted-rgba | success | 49842 | 255 | 145.2668 |  |
| geotiff | valid/zackthecat.tif | converted-rgba | unsupported | - | - | - | old style JPEG compression is not supported. |
| utif2 | valid/zackthecat.tif | converted-rgba | error | - | - | - | JPEG error: SOI not found |
| tiff | valid/zackthecat.tif | converted-rgba | unsupported | - | - | - | Unsupported image type: 6 |
| image-js | valid/zackthecat.tif | converted-rgba | unsupported | - | - | - | Unsupported image type: 6 |
| jimp | valid/zackthecat.tif | converted-rgba | error | - | - | - | JPEG error: SOI not found |
