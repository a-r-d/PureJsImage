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
silent conversion. See [Scientific reader registry](scientific-reader-registry.md#migrating-from-fixed-xyzct-datasets)
and the [0.10 ScientificDataset V2 migration guide](migration/0.10-scientific-v2.md).

Persisted project, lifecycle, reproducibility, and tile-memory guarantees are collected in the
[application-platform contract index](contracts/README.md).

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
These are local wall-clock measurements and bounded managed-memory accounting, not process peak RSS
or release budgets.

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
- General pyramidal analysis still needs explicit operation-level resolution selection and
  per-level physical coordinate transforms.
- Public `NumericTile` values are CPU typed-array storage. Provider disposal is available, but a
  GPU-resident multi-operation graph is future work rather than a current zero-copy guarantee.
- `uint64` tiles remain exact `BigUint64Array` storage, but number-backed quantitative operations
  reject values above 2^53 - 1; bigint-aware results, parameters, and no-data metadata are future work.
- Reader-provided display recommendations and package-owned viewport/persistence policies are not
  part of the current generic contract.

## Candidate gate status

This draft is **not release-ready**. Historical candidate hashes and partial gate counts have been
removed because they do not describe the commit that will be published. After the final hardening
and documentation commit, the release manager must record one coherent candidate audit:

- final candidate commit SHA and clean status;
- complete `npm run check` result, including the hostile-source phase;
- clean install/package-consumer result on the declared minimum Node version and current CI Node;
- real modern-browser test command, browser/version, and result;
- exact `npm pack --dry-run` file/byte counts, tarball SHA-256, and npm integrity;
- exact repository URL and commit of the separate materials application tested against that same
  tarball;
- benchmark host CPU/OS/runtime, command, input corpus identity, and result artifact; and
- any remaining failure linked to a GitHub issue rather than described as an evergreen exception.

Do not replace these fields with evidence from an earlier SHA. Version changes, tags, publication,
and GitHub release creation remain separately authorized release-manager actions.
