# ICO benchmark corpus

These three deterministic fixtures are committed so normal tests and benchmark
runs always exercise the same ICO bytes:

- `ico-mixed-16-32-256.ico` contains 16x16 and 32x32 BGRA DIB entries plus a
  256x256 RGBA PNG entry. It exercises directory selection and PNG delegation.
- `ico-dib32-alpha-128.ico` contains a 128x128 BGRA DIB with partial alpha and
  an all-zero compatibility mask, isolating the alpha-channel behavior.
- `ico-dib24-mask-96.ico` contains a 96x96 BGR DIB whose transparent border is
  represented only by its AND mask.

The fixture generator is first-party TypeScript in
`benchmark/scripts/prepare-corpus.ts`. The manifest pins dimensions, image
counts, and SHA-256 hashes. `npm run fixtures:ico` additionally decodes every
fixture through the public pipeline and checks exact RGBA samples.

During implementation, the mixed fixture's selected image and the decoded DIB
fixtures were also compared with ImageMagick 7.1.2. The selected dimensions and
RGBA pixels agreed exactly.
