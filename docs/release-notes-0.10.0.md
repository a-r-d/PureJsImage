# PureJsImage 0.10.0 release notes

PureJsImage 0.10.0 expands the first-party codec suite and introduces an opt-in alpha foundation for
browser and Node scientific applications. The ordinary image pipeline remains unchanged and the
published package retains no runtime dependency tree.

## Application-platform foundation

This release adds an opt-in foundation for browser and Node scientific applications while keeping
the ordinary image pipeline unchanged:

- labeled-axis `ScientificDataset` descriptors and arbitrary-axis bounded plane reads;
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

Labeled-axis `ScientificDataset` is the only public scientific dataset model. The unpublished fixed
XYZCT model and its adapters remain only inside parser compatibility code while those parsers
migrate; they are not package exports. Reader-opened datasets include structured source,
reader-version, and dataset identities that analysis planning uses automatically. See the
[Scientific reader registry](scientific-reader-registry.md#labeled-axis-reads)
and the [0.10 ScientificDataset guide](migration/0.10-scientific.md).

Persisted project, lifecycle, reproducibility, and tile-memory guarantees are collected in the
[application-platform contract index](contracts/README.md).

The release also includes an explicitly registered Aperio SVS scientific reader, a
bit-exact `select-resolution-level` transform, and the first globally prepared operation:
deterministic tiled connected components. It returns lazy uint32 labels and a bounded columnar
object table without materializing a complete slide, mask, or label plane.

Existing root/browser package imports and ordinary image workflows such as
`image.resize(...).jpeg(...)` retain their direct pipeline. The application platform is a pre-1.0
alpha API, and provider and extension APIs are experimental; later incompatible changes require
explicit package, operation, graph, or migration versioning as applicable.

## External application evidence

The package checker creates an npm-format tarball from the candidate branch, installs it into a
clean strict TypeScript consumer, compiles every documented application subpath, bundles browser
and Worker entries,
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
- FFT, registration, morphology, watershed, broad segmentation, mutable painting/editing, mature
  particle/grain workflows, and materials-specific algorithms are not included. Initial bounded
  connected components and object measurements are included.
- Cloud storage, authentication, collaboration, comments, and server workspace services remain app
  work.
- CPU cancellation remains cooperative at explicit abort checkpoints.
- Built-in dataset operations still need to converge with `DerivedTileSource` on one explicit
  tile-kernel acceleration path before the analysis API is considered stable.
- Pyramidal analysis uses explicit `select-resolution-level@1` with per-level physical coordinate
  transforms; operations that intentionally span multiple levels remain future work.
- Public `NumericTile` values are CPU typed-array storage. Provider disposal is available, but a
  GPU-resident multi-operation graph is future work rather than a current zero-copy guarantee.
- `uint64` tiles remain exact `BigUint64Array` storage, but number-backed quantitative operations
  reject values above 2^53 - 1; bigint-aware results, parameters, and no-data metadata are future work.
- Reader-provided display recommendations and package-owned viewport/persistence policies are not
  part of the current generic contract.

## Release validation

The release manager records one coherent candidate audit for the exact release commit before
tagging:

- final candidate commit SHA and clean status;
- complete `npm run check` result, including the hostile-source phase;
- clean install/package-consumer result on the declared minimum Node version and current CI Node;
- real modern-browser test command, browser/version, and result;
- exact `npm pack --dry-run` file/byte counts, tarball SHA-256, and npm integrity;
- exact repository URL and commit of the separate materials application tested against that same
  tarball;
- benchmark host CPU/OS/runtime, command, input corpus identity, and result artifact; and
- any remaining failure linked to a GitHub issue rather than described as an evergreen exception.

Do not replace these fields with evidence from an earlier SHA.
