# TIFF encode compatibility

Version: ImageMagick 7.1.2-3 Q16 x86_64 23340 https://imagemagick.org independently decoded the generated TIFF files to exact raw pixels.

| Case | Size | Samples | Compression | Predictor | Rows/strip | Strips | Output | Pixels |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| RGB | 1024×100 | 3 | 8 | 2 | 42 | 3 | 1,183 bytes | exact |
| RGBA | 31×17 | 4 | 8 | 2 | 17 | 1 | 293 bytes | exact |
