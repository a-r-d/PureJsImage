# PureJsImage 0.10.0 prerelease notes (draft)

These are candidate notes only. The release manager must choose the exact prerelease identifier and
separately authorize version changes, a release commit, tag, push, npm publication, and GitHub
release. No release state is changed by this document.

## Application-platform foundation

This candidate adds an opt-in foundation for browser and Node scientific applications while keeping
the ordinary image pipeline unchanged:

- labeled-axis `ScientificDataset` V2 descriptors and arbitrary-axis bounded plane reads;
- explicit scientific document readers and caller-owned registries;
- canonical portable `RasterBlock` reads with one-time native `NumericTile` conversion;
- JSON-safe operation/value descriptors separated from executable providers;
- trusted local extension bundles with no global registration or hidden backend selection;
- bounded scalar, histogram, profile, table, and collection results;
- canonical versioned graphs, explicit migrations, source identity, immutable commands, planning,
  cancellation, execution provenance, and four declared reproducibility classes;
- calibrated rectangle, ellipse, polygon, line, and polyline ROI geometry and bounded sampling;
- a caller-owned bounded tile scheduler/cache with source and derived namespaces; and
- strict TypeScript crop, resample, arbitrary-axis slice, projection, threshold, Gaussian blur,
  ROI statistics, histogram, and calibrated line-profile operations.

The root package still has no runtime dependency tree. The application APIs live behind explicit
`purejsimage/scientific`, `purejsimage/operations`, `purejsimage/analysis`, and
`purejsimage/extensions` imports. Importing them does not create global registries, caches, workers,
or network activity. `purejsimage/scientific/node` remains Node-only; browser and Worker graphs use
portable entries.

## Compatibility and migration

The fixed XYZCT `MultidimensionalRasterDataset` remains only as a deprecated migration bridge. New
code should select two display axes and explicit indices for every other non-singleton labeled axis.
`toScientificDataset()` and `toMultidimensionalRasterDataset()` are deliberate adapters rather than
silent conversion. See [Scientific reader registry](scientific-reader-registry.md#migrating-from-fixed-xyzct-datasets).

Existing root/browser package imports and ordinary image workflows such as
`image.resize(...).jpeg(...)` retain their direct pipeline. This is a pre-1.0 alpha API: contracts
that were never published may still be cleaned up before this candidate is actually versioned and
published; the release notes must be rechecked against the final commit.

## External application evidence

The package checker packs the actual npm tarball, installs it into a clean strict TypeScript
consumer, compiles every documented application subpath, bundles browser and Worker entries,
rejects Node built-ins and private paths, and executes a GSF-to-numeric-tile-to-ROI-statistics
workflow with reference-provider and source-identity provenance.

A separate vanilla TypeScript/Vite materials spike installs only that tarball. Its Worker owns the
reader library, analysis controller, tile runtime, and execution; the main thread owns UI and Canvas.
It exercises local companions, remote range reads, scanX/scanY/kx/ky viewing, cancellation, ROI
analysis, bounded charts, commands, provider pinning, provenance, and `analysis.json` save/rebind/
replay without a private import or second cache.

## Performance evidence

The deterministic application benchmark records correctness before timing. On the checked Apple
arm64/Node 24 run, the 1,938,955-byte Aperio fixture reached its first tile after six range requests
and 300,556 fetched bytes. The cache probe retained 65,536 source bytes and 65,536 derived bytes and
observed cold misses followed by warm hits. ROI statistics, line profile, threshold, Gaussian blur,
document detection, first numeric/display tiles, and graph/provider setup are recorded in
[`benchmark/results/application-platform.json`](../benchmark/results/application-platform.json).
These are local wall-clock and bounded cache measurements, not process peak RSS or release budgets.

## Known limitations and deferred work

- WASM operation providers and WebGPU providers are not implemented.
- Untrusted extensions do not yet have a permissioned Worker or iframe RPC sandbox.
- FFT, registration, segmentation, mutable painting/editing, and materials-specific algorithms are
  not included.
- Cloud storage, authentication, collaboration, comments, and server workspace services remain app
  work.
- CPU cancellation remains cooperative at explicit abort checkpoints.
- Built-in dataset operations still need to converge with `DerivedTileSource` on one explicit
  tile-kernel acceleration path before the analysis API is considered stable.
- Reader-provided display recommendations and package-owned viewport/persistence policies are not
  part of the current generic contract.

## Candidate gate status

This draft is **not release-ready**. Current audit evidence:

- baseline before the PR 10 commit: `scientific-analysis` at
  `a026b5e0f7c0d7a046a003f67c9dd6f7fdd7183f`; record the resulting reviewed commit as the candidate
  only after all remaining release gates pass;
- clean `npm ci`: passed;
- installed package fixture: passed on Node 24.16.0 and minimum-supported Node 22.21.1;
- packed imports: no Worker construction, fetch, interval, or package global;
- browser, type, package, lint, formatting, 45 focused ordinary-pipeline/application tests, 12 real
  Chromium ordinary-demo/scientific tests, and application benchmark gates: passed;
- deterministic release fuzz: passed with seed `1592598566`, 512 mutations per registered codec,
  and no crash artifact;
- dry-run tarball: 376 files, 778,585 packed bytes, 3,757,512 unpacked bytes, SHA-1
  `752f2c7ac38da25e36da68919e0e3dada53505ba`, integrity
  `sha512-1oqvC2p+pQVIM3gTosH67Kr7AGmO2W4VtL+LG0Z1NKpozMoPaXpEkjat7GwCTARDDUSv2JAWmwg2QjtP0tkJuw==`;
- separate materials app: clean install, two unit tests, strict production build, and three real
  Chromium E2E tests passed against that exact tarball; and
- `npm run check`: failed after 1,150 passing tests because three expanded 12-bit AVIF fixtures have
  Sharp-oracle hash mismatches. The command's hostile-source phase was therefore not reached; an
  independent hostile-source run reached the same three failures with the other 1,150 tests passing.

The AVIF failures predate this slice and are outside the application-platform changes, but a
mandatory gate is still a mandatory gate. Reconcile those oracle expectations or decoder results,
rerun the complete check (including hostile-source tests), then record the final candidate commit
before choosing a prerelease identifier or performing any release action.
