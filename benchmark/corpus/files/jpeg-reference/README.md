# JPEG reference fixtures

These small files are generated from a deterministic RGB test pattern by
`npm run fixtures:jpeg:prepare`. The generator uses Netpbm `pnmtojpeg` (BSD-style license) linked
against libjpeg. It records the exact output checksums in its source and refuses a different result,
so a toolchain change is visible rather than silently replacing the corpus.

The corpus covers 4:4:0, 4:1:1, eight-bit SOF1, sequential component scans, an unusual progressive
scan layout, restart markers, and an explicitly RGB Adobe-style file. The generated images may be
redistributed under this repository's MIT license because their pixel pattern and preparation code
are original project material.

| File | SHA-256 |
| --- | --- |
| `generated-yuv440.jpg` | `2199caf17e3536fee1a95df125fb3e7f9cb8caee1d085e0f10081d725a86aa1c` |
| `generated-yuv411.jpg` | `0c9bea1f1bfa2fb952fbd2aa4705f2a288b52a08b7c105bae2f13dfcbd24fb64` |
| `generated-sof1-8bit.jpg` | `09048d46b313702386605da3eddd6ad0ebbfb104f891901ec17603a00bb25104` |
| `generated-sequential-multiscan.jpg` | `c916cbd242f3a1fc2a41870fb536f2e30f609055cd75165ab9d1df2285f21279` |
| `generated-progressive.jpg` | `ef15e5eafc4eb4d98e012f03ea2b8b1a400c7dff29fb0303e6c7c98ade0981ee` |
| `generated-adobe-rgb.jpg` | `d075ab672879c684eeacb84e88d2a7a9c9b300e65eed97eab31a46399dfdedc4` |
