# JPEG XL browser showcase handoff

September 29, 2026. PR #37, `codex/jpegxl-practical-coverage`.

## Destinations for Prompt 3

Use these exact canonical paths on `https://purejsimage.com` after site deployment:

| Destination | Working behavior |
| --- | --- |
| `/jpeg-xl/` | Encoder and decoder hub, sample actions, real tool previews, capability reference and API links |
| `/jpeg-xl/convert/` | Local JPEG, PNG, TIFF and JXL input; native integer lossless/static-lossy JXL encoding; progressive output; decoded comparison; separate resized display exports |
| `/jpeg-xl/jpeg-recompression/` | Eligible color or grayscale JPEG to JXL to original JPEG; `onlyIfSmaller`; reconstructed byte equality and downloads |
| `/jpeg-xl/animation/` | Frame selection, playback, rational timing and loops; selected-frame PNG; bounded local-frame creation, reordering, download and reopening |
| `/jpeg-xl/progressive/` | Actual session stages, scale/viewport controls, local and explicit HTTP Range input, source-read visualization and distinct I/O/memory statistics |
| `/jpeg-xl/native/` | Integer and binary32 sample bits, channel grids and metadata; explicit scalar display mapping; supported native re-encode and separate mapped PNG export |
| `/jpeg-xl/comparison/` | Frozen public-JavaScript comparison, correctness denominators, quality brackets, warm/cold timings, assets, preview I/O, memory and raw evidence |

Existing hub workbench anchors redirect to the converter or progressive tool. The seven routes have distinct canonicals and appear in the generated sitemap. Navigation and `llms.txt` link to the new destinations. The capability generator owns the updated general JPEG XL scope sentence in `llms.txt`.

These pages use the repository build. They do not assert that the latest APIs are in the published 0.17.0 package. Static lossy qualification is unchanged. Lossy animation remains Experimental. No codec implementation, capability decision, benchmark measurement, package version or release was changed for the showcase.

## Shared implementation and privacy

The existing workbench worker dispatches all operations. `JxlWorkerClient` provides shared worker creation, job identities, hard cancellation and failure recovery. The advanced worker module is imported on demand. Public first-party browser/codec/sequence/session APIs perform the work. Other site tools do not import the advanced JPEG XL module.

A canceled operation terminates its worker. Retry reopens the retained original `File`; it does not reuse a detached buffer or an expired session. Replacement and navigation invalidate old jobs and revoke output URLs. Repeated downloads remain available until replacement or disposal. Native encoding uses source samples, never canvas previews.

Local files, names, metadata and previews are not uploaded. Analytics is disabled on the JPEG XL layouts. Network access is limited to site assets, selected samples and an HTTP URL explicitly opened by the user. Browser tests assert this boundary, including a private filename, and exercise stale responses and worker errors. User names and metadata are rendered as text.

## Limits and supported semantics

- The tools admit files up to 64 MiB. Advanced tools limit decoded geometry and previews to four megapixels and apply a 256 MiB decoded-byte limit. These are tool limits, not new codec support claims.
- Animation creation accepts up to 16 sRGB8, orientation-1 frames with matching dimensions, one megapixel each and eight million total pixels. Playback admits at most 128 frame headers. Only the selected frame preview is retained; seeking replays prior dependencies. Playback scheduling adds decoding time to the declared frame duration. The original rational tick rate remains in the evidence.
- Native display maps a selected plane between zero and an explicit white value. It does not apply ICC or invent a color conversion. Numeric bits and metadata remain available independently of the canvas.
- Native export supports the existing preservable Modular integer/binary32 writer layouts. Unsupported XYB layouts, orientation, metadata boxes, intrinsic sizing, custom chromaticities, nondefault luminance metadata and writer combinations fail explicitly. Successful export reopens and compares every sample bit, precision, channel metadata, alpha association and ICC bytes.
- Display PNG export is separate from native preservation. Static display resize/export uses the existing orientation-aware display path. Native source encoding retains sample precision, including lower-depth samples stored in 16-bit containers.
- Progressive actions open fresh bounded sessions. They expose actual embedded/DC/pass/final events when available and report declared complete-decode fallbacks. They do not promise selective access for every stream. The HTTP tool requires CORS and Range support and rejects a full 200 response to a Range request. Logical reads, source bytes, HTTP transfer, cache, managed bytes and canvas bytes are distinct; browser process memory is unavailable.

## Evidence and assets

The comparison imports `benchmark/jpegxl/comparison/website-data.json` from Prompt 1 without changing its measurements. Its tested implementation is `564a4d2d3e1c318f64821322c67329550df6da6b`, not a new benchmark of the showcase. All 12 raw source reports, the method report, pinned subject/input manifests and official-source survey are served under `/jpeg-xl/evidence/`.

Only one of 24 lossy engine/target comparisons has adequate brackets on both sides. The page retains that denominator, failed/unsupported/unavailable outcomes, compiler/runtime distinctions, competitor advantages and unmatched preview workflows. It does not rank unequal preview work as equivalent decoding speed.

`scripts/jpegxl-comparison-crops.ts` verifies pinned decoded hashes and derives identical 256 × 192 crops from the source and actual nearby measured PureJsImage/wasm-vips outputs. Lossless WebP crops and their provenance are versioned. The photo is lilith's public-domain contribution to imazen-26. The color JPEG sample is the WPT four-color fixture with BSD attribution. The remaining small native, animation and PNG samples are generated repository fixtures.

Hub cards are real Chromium tool/output captures. `docs-astro/src/data/jpegxl-showcase-previews.json` records capture and WebP hashes. Regenerate manually with:

```sh
PUREJSIMAGE_CAPTURE_JXL=1 npx playwright test browser-tests/jpegxl-showcase.pw.ts --project=chromium --grep 'capture' --workers=1
node scripts/jpegxl-showcase-previews.ts
```

The separate JPEG XL split build is 885,214 raw JavaScript bytes under a 1,200,000-byte tool-only envelope. This replaces the old isolated static/progressive bundle snapshots with one shared inventory covering native, sequence and session APIs. The inventory is emitted as `/assets/jpegxl-tool-build.json`. No npm entry or unrelated site-tool budget was increased. The build rejects third-party implementation imports in the JPEG XL tool graph.

## Validation

- Focused unit checks: 27 tests passed across showcase protocol, existing worker protocol and preview tests.
- Browser checks: 63 tests passed across Chromium, Firefox and WebKit. Three manual screenshot capture cases were skipped in the normal run. Coverage includes native float/alpha bits, 10-bit precision, exact grayscale and color JPEG recovery, animation timing and output reopening, real progressive stages, cancellation after opening, retry, input replacement, stale responses, worker failures, repeated downloads, narrow layouts, keyboard access, no-upload assertions, canonical routes and evidence downloads.
- Real Chromium captures were generated and visually inspected. An earlier isolated WebKit opening timeout passed on retry and in the final complete browser run.
- `VITEST_MAX_WORKERS=4 npm run check` passed: 250 test files and 3,238 tests passed, with one file and three tests skipped by existing conditions. The gate also passed generated capabilities, documentation and comparison checks, package budgets, docs build/link checks, types, browser build and lint/format. Existing lint and large-report format warnings remain nonfatal.
- A final `npm run docs:build` passed after connecting the pinned subject/input manifests to the comparison downloads. All 33 site pages built. Two additional Chromium checks passed for final captures and legacy exact-transcode routing.
- Backend implementation commit: `8668fcb` (`feat(docs): share bounded JPEG XL worker operations`). The following site commit contains the shared UI, seven routes, generated assets, browser coverage and this handoff.

The work is a site implementation handoff. A successful build or branch push does not mean the public website has been deployed.
