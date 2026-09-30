# README editorial review

Review base: `3cbfa868406bca001c88ed7c7a1d0addefd48b88`.
The README edits were reviewed before commit.

## Before and after

- Replaced the overlapping “What PureJsImage is best at”, repeated introduction and “Why PureJsImage?” bullets with one introduction and three concrete points. Removed the unsupported compatibility ranking, “HUGE” and “Benchmaxxed”. Kept the project origin link, informal quotation, Sharp tradeoff and correctness requirements.
- Added an early API chooser for ordinary image pipelines, scientific datasets and geographic rasters. Explained high precision in ordinary images, overlapping TIFF uses, reader/writer differences, container/schema limits and JPEG XL's separate native API.
- Kept the Node image quick start. Added a browser `File` to `Blob` example with real public imports. Improved the scientific example with an empty-dataset check and document cleanup. Kept the gain-map example and the complete temporary-storage measurements and failure behavior.
- Added a compact JPEG XL section linking all seven destinations. Distinguished scoped Stable static encoding from Experimental lossy animation, exact sample values from original JPEG bytes, and native data from display export.
- Gave geographic rasters their own heading and placed the geographic tutorials there. Kept the whole-slide screenshot near the opening and kept the large-image tool links together. At the user’s request, removed the OME-Zarr and scientific explorer screenshots and their captions. Kept package size and import tables together, and added a short navigation row.
- Shortened generated prose that repeated nearby support tables. Counts still come from manifests; measurements still come from the existing artifacts. Added chart units and clarified native Sharp versus WASM. No historical measurement or qualification result was rewritten.
- Moved codec support before installation. Added five-column format tables, including the supported WASM steps and short descriptions maintained in the capability manifest. Kept Stable/Experimental and read/write labels unchanged.
- Replaced repeated “evidence”, “surface” and “northstar” prose with plain headings and descriptions. Existing URLs and legacy section anchors still work.
- Added three decode/resize/encode timing examples from the existing 2026-08-24 Node report, with date, tested version, host and source link. JPEG is 518/474 ms, PNG 398/435 ms and WebP 345/314 ms for TypeScript/WASM. The slower PNG result remains visible. These are historical measurements, not a new benchmark run or a general speed ranking.
- Added an explicit MIT license link while retaining the HEIF/HEIC patent notice, citation details, acknowledgments and development instructions.

No technical walkthrough was removed or moved to another document. Added direct links to the native precision and tile memory guides; retained all pre-existing unique links. The README remains a standalone introduction with working examples and detailed support and benchmark tables.

## Original visual inventory

Nine original images remain in the README. The user requested removal of the OME-Zarr and scientific explorer screenshots; their image files and demo links remain available. No image file was changed.

| Original visual | Location after editing | Information and supporting link |
| --- | --- | --- |
| Brand mark | Opening | Original PureJsImage mark |
| npm badge | Opening | Version badge and npm package |
| CI badge | Opening | Main-branch CI workflow |
| Dependency badge | Opening | Zero runtime dependencies and package manifest |
| License badge | Opening | MIT and license file |
| Whole-slide screenshot | Opening, before the API chooser | 131,472 × 51,113 slide; 1.98 GiB source, 11.4 MiB fetched, 0.562%; live WSI demo |
| OME-Zarr graphic previously captioned as Raster X-Ray | Removed at user request | Demo and Raster X-Ray links remain. |
| Scientific explorer screenshot | Removed at user request | Scientific example, format table and explorer links remain. |
| Web codec speed chart | Current benchmark snapshots | Median wall time, milliseconds, dated scope and validated workloads; performance report |
| Web codec memory chart | Current benchmark snapshots | Absolute process peak RSS, MiB, dated scope, validated workloads and native Sharp distinction; performance report |
| DOI badge | Citation | Project DOI, plus the existing release DOI and CITATION.cff links |

## Original table inventory

All six original tables retain their original row values and units. The two codec tables now add optional WASM coverage, short format notes and links from each format name. The two package tables use the clearer column label “Bundle”. The API chooser and a small timing table bring the total to eight.

| Original table | Location after editing | Generator |
| --- | --- | --- |
| Current measured package surface, including geo entries | Package sizes | `scripts/render-documentation.ts` |
| Geographic raster compatibility | Geographic rasters | `scripts/render-geo-capabilities.ts` |
| Stable ordinary codecs, separate Read and Write | Supported formats | `scripts/render-capabilities.ts` |
| Experimental codecs | Supported formats | `scripts/render-capabilities.ts` |
| Scientific reader families | Scientific readers | `scripts/render-package-metrics.ts` |
| Bundle sizes with public imports | Bundle size and npm package size | `scripts/render-package-metrics.ts` |

The historical TIFF comparison remains generated by `scripts/render-library-comparison.ts`. Its date, denominators, mismatch counts and independent-oracle caveat are unchanged.

## Validation and review notes

- An automated inventory comparison confirmed the nine retained image URLs and all original table row values remain; demo and documentation links are preserved.
- All five TypeScript blocks compile against the built public package with strict checking. The temporary-storage fragment reuses the quick-start imports; the HDR fragment declares its caller-supplied input and block consumer. The browser block also compiles with DOM types and no Node ambient types.
- README rendering was inspected in Chromium at 1280-pixel and 390-pixel viewport widths using the installed Markdown renderer and a GitHub-like presentation. All nine retained images loaded, all eight tables rendered, and the page had no horizontal overflow. Wide tables scroll within their own area. This is a local Markdown preview, not a claim of exact GitHub CSS parity.
- All 61 checked local file or docs destinations exist. Public HEAD checks covered 58 URLs. The six newly added JPEG XL tool pages return 404 until the Prompt 2 site build is deployed; the README includes that caveat. npm and DOI/Zenodo returned 403 to automated HEAD requests, so those pre-existing destinations are not reported as independently verified by that check.
- README anchor links and docs-site fragment links were checked against the rendered Markdown and built site.
- The focused package-metric, project-contract and capability-manifest suites passed all 50 tests. Their old prose assertions were updated to check the new API chooser, preserved portability/memory/validation commitments and manifest-derived WASM count. A new regression check verifies the early codec tables, format summaries and accelerator export matching. The JPEG XL row assertion now includes its link; its support labels are unchanged.
- `VITEST_MAX_WORKERS=4 npm run check` passed: 250 test files and 3,239 tests passed, with one file and three tests skipped by existing conditions. The gate includes generators, package budgets, docs build/link checks, types, browser build, lint and formatting. Existing large-report and lint warnings remain nonfatal.
- Generation was run twice to check stability. Capability, scientific-reader, geographic, package-metric, documentation and historical comparison guards remain enabled.
- The unpacked package byte count is refreshed through `npm run size` because npm includes README text. JavaScript bundle sizes, benchmark data and capability decisions are unchanged.

Local review artifacts are in `.tmp/readme-review/`: `before.md`, `before.html`, `after.html`, desktop/narrow screenshots, link results, extracted TypeScript examples and validation logs. These review artifacts are not proposed package contents.

## GitHub CI follow-up

The CI run for the review base, [36602021986](https://github.com/a-r-d/PureJsImage/actions/runs/36602021986), failed in Node 24 and all three browser jobs.

- Older JPEG XL browser tests still looked for converter and progressive controls on the hub. They now open the separate tool routes and use their current controls and measurements. The progressive test checks bounded source reads, a fresh session on repeat, and the same viewport dimensions. Embedded-preview and pixel checks remain.
- The local-file privacy test used two untracked fixture paths. It now reads the committed `gray8-linear.jxl` fixture directly.
- The Node 24 failure was the default five-second timeout during a test that performs two effort-7 encodes and reconstructs both. That test now has a 30-second allowance; its size and error comparisons are unchanged. Converter startup assertions also allow 30 seconds for the initial sample decode.

No codec implementation, output tolerance or CI workflow was changed.
