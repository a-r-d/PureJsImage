# M5 segmented JPEG XL fixture

`segmented.jxl` contains the unchanged codestream from the MIT-licensed
`../m4-color/srgb-12.jxl` fixture, split into four ordered `jxlp` boxes.
Its native reference pixels remain `../m4-color/srgb-12.bin`.

Regenerate it with `node benchmark/jpegxl/generate-m5-segmented.ts`.
The browser test serves this file over real HTTP Range and compares Node and
browser crop, resize, conversion, and PNG export against the native reference.
