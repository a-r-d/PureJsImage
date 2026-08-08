# Browser validation and performance

PureJsImage browser support is tested in real browser engines with Playwright.
The pinned Playwright 1.62.1 builds are:

- Chromium 151.0.7922.34
- Firefox 153.0
- WebKit 26.5

Chromium, Firefox, and WebKit all run the compatibility suite. Chromium also
runs the performance suite. Firefox and WebKit are compatibility gates only so
performance numbers remain reproducible within one engine.

## Compatibility coverage

The browser suite imports the real browser entry and first-party JPEG and PNG
codecs. It exercises `File`, `Blob`, `ArrayBuffer`, `Uint8Array`, `toBlob()`,
and `toUint8Array()`. Workflows cover JPEG and PNG decode, metadata, crop,
resize, EXIF orientation, rotation, alpha preservation, JPEG and PNG encoding,
and cleanup after an output failure.

The bundle check uses esbuild's browser platform and rejects any `node:` import
in the complete all-codec browser graph.

Run all engines:

```sh
npx playwright install chromium firefox webkit
npm run browser:test
```

Run one compatibility gate:

```sh
npm run browser:test -- --project=firefox
```

CI installs each engine and its Linux libraries independently with
`npx playwright install --with-deps <engine>`.

## Chromium performance baseline

Generate the checked-in Chromium report:

```sh
npm run browser:bench
```

The suite records module initialization time, first-operation time, the median
of five warm operations, encoded or decoded output bytes, decoded-pixel
correctness, and uncompressed JavaScript and WASM response bytes loaded.
Browser memory is not reported because the tested engines do not expose one
consistent, reliable API for these measurements.

PureJsImage and native rows are complete decode-resize-encode workflows:

- PureJsImage performs its complete first-party pipeline.
- Native uses `createImageBitmap` and `OffscreenCanvas` for complete resize and
  encode.

jSquash rows intentionally time only codec decode or codec encode for JPEG,
PNG, and WebP. ImageData preparation for encode is outside the timer. These
codec-only results are not complete pipeline comparisons and must not be
presented as peers to the PureJsImage or native complete workflows.

The recorded baseline is in
`benchmark/results/browser-chromium-2026-08-08.md` and its JSON companion.
