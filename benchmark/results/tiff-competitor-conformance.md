# TIFF competitor conformance

Generated: 2026-08-10T18:25:13.850Z

Oracle: sharp with ImageMagick fallback raw RGBA8; exact means every independently decoded channel matched.

| Engine | Files | Exact | Pixel mismatch | Unsupported | Error | Oracle failure | Timeout | Crash |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| purejsimage | 14 | 7 | 7 | 0 | 0 | 0 | 0 | 0 |
| geotiff | 14 | 4 | 10 | 0 | 0 | 0 | 0 | 0 |
| utif | 14 | 6 | 6 | 0 | 1 | 0 | 1 | 0 |
| image-js | 14 | 7 | 0 | 0 | 7 | 0 | 0 | 0 |
| jimp | 14 | 6 | 4 | 0 | 4 | 0 | 0 | 0 |

## Non-exact and failed cases

| Engine | File | Outcome | Differing pixels | Max delta | RMSE | Detail |
| --- | --- | --- | ---: | ---: | ---: | --- |
| jimp | files/libtiff-deflate-extra-strip-data.tiff | success | 2000 | 255 | 10.2104 |  |
| geotiff | files/libtiff-lzw-single-strip.tiff | success | 24335990 | 255 | 219.0701 |  |
| utif | files/libtiff-lzw-single-strip.tiff | timeout | - | - | - | worker timed out |
| geotiff | files/libtiff-miniswhite-1c-1b.tiff | success | 23707 | 255 | 174.7215 |  |
| purejsimage | files/libtiff-packbits-gray-alpha.tiff | success | 3036 | 255 | 118.5140 |  |
| geotiff | files/libtiff-packbits-gray-alpha.tiff | success | 3980 | 255 | 120.9617 |  |
| utif | files/libtiff-packbits-gray-alpha.tiff | success | 3980 | 255 | 120.9617 |  |
| image-js | files/libtiff-packbits-gray-alpha.tiff | error | - | - | - | Unsupported Compression: PackBits |
| jimp | files/libtiff-packbits-gray-alpha.tiff | success | 4094 | 255 | 121.0771 |  |
| purejsimage | files/libtiff-palette-1c-8b.tiff | success | 18378 | 1 | 0.5574 |  |
| geotiff | files/libtiff-palette-1c-8b.tiff | success | 23707 | 239 | 86.8111 |  |
| purejsimage | files/tiff-bigtiff-rgb16-1024x768.tiff | success | 336161 | 1 | 0.3577 |  |
| geotiff | files/tiff-bigtiff-rgb16-1024x768.tiff | success | 336161 | 1 | 0.3577 |  |
| utif | files/tiff-bigtiff-rgb16-1024x768.tiff | error | - | - | - | UTIF.js omitted dimensions |
| image-js | files/tiff-bigtiff-rgb16-1024x768.tiff | error | - | - | - | invalid data format: undefined |
| jimp | files/tiff-bigtiff-rgb16-1024x768.tiff | error | - | - | - | Could not find MIME for Buffer |
| purejsimage | files/tiff-cielab8-strip-2048x1536.tiff | success | 2966701 | 88 | 13.4635 |  |
| geotiff | files/tiff-cielab8-strip-2048x1536.tiff | success | 3131743 | 255 | 89.0528 |  |
| utif | files/tiff-cielab8-strip-2048x1536.tiff | success | 3145728 | 255 | 180.2311 |  |
| image-js | files/tiff-cielab8-strip-2048x1536.tiff | error | - | - | - | Unsupported image type: 8 |
| jimp | files/tiff-cielab8-strip-2048x1536.tiff | success | 3145728 | 255 | 180.2311 |  |
| purejsimage | files/tiff-cmyk8-planar-1024x768.tiff | success | 786422 | 128 | 19.9032 |  |
| geotiff | files/tiff-cmyk8-planar-1024x768.tiff | success | 786432 | 126 | 19.5438 |  |
| utif | files/tiff-cmyk8-planar-1024x768.tiff | success | 786432 | 255 | 132.4806 |  |
| image-js | files/tiff-cmyk8-planar-1024x768.tiff | error | - | - | - | Unsupported image type: 5 |
| jimp | files/tiff-cmyk8-planar-1024x768.tiff | error | - | - | - | window is not defined |
| geotiff | files/tiff-fillorder6-strip-2049x1537.tiff | success | 3100032 | 248 | 94.9363 |  |
| utif | files/tiff-fillorder6-strip-2049x1537.tiff | success | 3149313 | 255 | 180.3970 |  |
| image-js | files/tiff-fillorder6-strip-2049x1537.tiff | error | - | - | - | Unsupported bitDepth: 6 |
| jimp | files/tiff-fillorder6-strip-2049x1537.tiff | success | 3149313 | 255 | 180.3970 |  |
| purejsimage | files/tiff-packed12-strip-2048x1536.tiff | success | 2747983 | 1 | 0.6112 |  |
| geotiff | files/tiff-packed12-strip-2048x1536.tiff | success | 3145726 | 239 | 95.9016 |  |
| utif | files/tiff-packed12-strip-2048x1536.tiff | success | 3145726 | 255 | 101.5885 |  |
| image-js | files/tiff-packed12-strip-2048x1536.tiff | error | - | - | - | Unsupported bitDepth: 12 |
| jimp | files/tiff-packed12-strip-2048x1536.tiff | error | - | - | - | 12 |
| purejsimage | files/tiff-packed12-tile-2051x1539.tiff | success | 2759014 | 1 | 0.6116 |  |
| geotiff | files/tiff-packed12-tile-2051x1539.tiff | success | 3156488 | 239 | 95.9707 |  |
| utif | files/tiff-packed12-tile-2051x1539.tiff | success | 3156487 | 255 | 103.2094 |  |
| image-js | files/tiff-packed12-tile-2051x1539.tiff | error | - | - | - | Unsupported bitDepth: 12 |
| jimp | files/tiff-packed12-tile-2051x1539.tiff | error | - | - | - | 12 |
