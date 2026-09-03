# JPEG XL production program

This document is the authoritative human-readable ledger for the staged JPEG XL production program. The machine-readable companion is `benchmark/jpegxl/production-program/status.json`.

## Current program state

- Current merged main: `1cd965dfeba27865c920c4e27bd44dbb4ea0404b`
- Package version: `0.17.0`
- Current target: A
- Active milestone: M0
- Active branch: `codex/jpegxl-m00-program-baseline`
- Pull request: [#35](https://github.com/a-r-d/PureJsImage/pull/35)
- Starting revision: `1cd965dfeba27865c920c4e27bd44dbb4ea0404b`
- Final revision: pending review and merge
- Capability change: none. Reading remains Limited and writing remains Experimental.
- Stable promotion gate: not passed and not eligible in M0

## Production targets

Target A covers production-ready common static JPEG XL. It requires M0 through M6. Its gate includes common static decode, mathematically lossless encoding, the documented exact JPEG subset, broad color and metadata, ordinary pipeline workflows, and progressive range-aware decode.

Target B covers broad production-ready Level 5 support. It requires M7 through M9 after Target A. Its gate adds a general lossy encoder, animation, common extra channels, broader Level 5 conformance, and release hardening.

Target C is the Level 10 stretch target. M10 must pass before the project can claim near-full standardized JPEG XL coverage. The claim must still exclude future, private, encrypted, malformed, or unbounded inputs.

## Milestones

| ID | Target | Status | Branch | PR | Start SHA | Final SHA | Stable gate |
| --- | --- | --- | --- | --- | --- | --- | --- |
| M0 | A | PR open | `codex/jpegxl-m00-program-baseline` | [#35](https://github.com/a-r-d/PureJsImage/pull/35) | `1cd965dfeba27865c920c4e27bd44dbb4ea0404b` | pending | no promotion permitted |
| M1 | A | not started | `codex/jpegxl-m01-jpeg-recompression` | pending | pending | pending | not passed |
| M2 | A | not started | `codex/jpegxl-m02-lossless-encoder` | pending | pending | pending | not passed |
| M3 | A | not started | `codex/jpegxl-m03-common-vardct` | pending | pending | pending | not passed |
| M4 | A | not started | `codex/jpegxl-m04-color-alpha-metadata` | pending | pending | pending | not passed |
| M5 | A | not started | `codex/jpegxl-m05-static-pipeline` | pending | pending | pending | not passed |
| M6 | A | not started | `codex/jpegxl-m06-progressive-range` | pending | pending | pending | not passed |
| M7 | B | not started | `codex/jpegxl-m07-lossy-encoder` | pending | pending | pending | not passed |
| M8 | B | not started | `codex/jpegxl-m08-level5-breadth` | pending | pending | pending | not passed |
| M9 | B | not started | `codex/jpegxl-m09-production-hardening` | pending | pending | pending | not passed |
| M10 | C | not started | `codex/jpegxl-m10-level10-stretch` | pending | pending | pending | not passed |

Milestone goals and required gates are recorded in `status.json`. Only one milestone may be active in a pull request.

## M0 baseline

The deterministic baseline report is `benchmark/jpegxl/production-program/baseline.json`. Its generated summary is `benchmark/jpegxl/production-program/baseline.md`.

The baseline starts from the exact remote main revision above and inventories 19 current JPEG XL modules and the ordinary and specialized public APIs. The capability matrix is descriptive only. It does not broaden `capabilities/manifest.json`.

### Corpus versions

- Official conformance corpus: `libjxl/conformance` revision `4bf053529c7cefd2951be453475bb3dccc7e7be8`, archive SHA-256 `1e7954076edfe8c6f66354db5a7aa0ba76c99095d81564e8dbc76043caed37bd`
- libjxl tools: revision `a7a9c787341cf703dede03c2009fa460cae5e5df`, version 0.12.0
- jxl-rs: revision `07ab48fcccde0a73c384b4011520fec67e5e09cd`
- jxl-oxide: revision `c0cc4c7ea57c1207f38ff2970d94757470613be4`
- simple-lossless-encoder: revision `7b9f14fd0ef1f4cb7e52e58ba5a222570937ddbf`
- imazen/jxl-encoder: revision `d63e9d1a1aa84b2dbdfc90eeddccc33fef5eb48b`

The four corpus manifests live under `benchmark/jpegxl/production-program/corpora`. They separate official conformance, generated feature, real image, and JPEG archive inputs. Each entry has an explicit license and checksum or refers to a checksum-pinned component manifest. The generated-feature PR set contains 14 fixtures. The scheduled workflow runs the complete pinned matrices.

Oracle source acquisition, exact build commands, lock checksum, and reference-machine binary checksums are recorded in `benchmark/jpegxl/production-program/oracle-tools.json`. These tools are development oracles only.

### Measured results

- Official conformance: 39 cases. 2 pass, 36 return the expected unsupported class, 0 produce incorrect output, and 1 has an explained unexpected failure.
- The official `delta_palette` case reaches `INVALID_INPUT`. It is valid input outside the proven subset, so this remains a baseline defect rather than a malformed-input classification.
- Encoder matrix: 7 cases across all six published experimental native formats, checked against pinned independent decoders.
- Exact JPEG matrix: 10 of 10 eligible cases reconstruct byte-for-byte. The median JXL/source size ratio is 1.1917, so this is not yet a useful archival compressor.
- Lossless encoder compression: median JXL/PNG ratio 6.0363 over the five-class baseline. Stable compression thresholds are not met.
- Correctness-gated speed and process-memory benchmark: 4 workloads. The two 12 MP exact transcodes take median 69.6 to 71.5 seconds with 307 to 370 MB peak RSS delta on the recorded reference machine.
- Modular memory: the 4096 by 4096 full decode has 76.4 MB median peak RSS delta. The 64 by 64 crop has 1.8 MB median peak RSS delta.
- VarDCT memory: all 7 accepted workloads stay within their pixel gates. The over-budget workload fails preflight with `LIMIT_EXCEEDED`.
- Package entries remain under their current checked minified ceilings: 240,492 bytes for `codec-jpegxl` and 274,559 bytes for `jpegxl-specialized`.
- Browser workbench: Chromium, Firefox, and WebKit pass with retries disabled.

CPU time, time to first output, source read counts, unique source bytes, temporary-storage bytes, and standalone cancellation latency are not available from the current benchmark harness. Later milestones must add them where their gates require them.

### Commands

The M0 reference measurements used these exact commands:

```sh
node benchmark/jpegxl/production-program/run-conformance.ts --corpus-root /tmp/jpegxl-conformance-4bf0535 --output /tmp/jpegxl-conformance-baseline.json
PUREJSIMAGE_JPEGXL_ORACLE_DIR=.tmp/jpegxl-oracles/libjxl-v0.12.0/source/build-pinned/tools npm run bench:jpegxl -- --output /tmp/jpegxl-m00-benchmark.json
node benchmark/jpegxl/run-memory.ts --output /tmp/jpegxl-m00-memory.json
node benchmark/jpegxl/run-vardct-memory.ts --output /tmp/jpegxl-m00-vardct-memory.json
npm run bench:jpegxl:compression -- --output /tmp/jpegxl-m00-compression.json
npm run fixtures:jpegxl:encoder-matrix -- --output /tmp/jpegxl-m00-encoder.json
node benchmark/jpegxl/run-purejsimage-reverse-matrix.ts .tmp/jpegxl-oracles/libjxl-v0.12.0/source/build-pinned/tools --output /tmp/jpegxl-m00-reverse.json
```

The M0 handoff gate uses:

```sh
npm run jpegxl:program:baseline
npm run jpegxl:program:conformance -- --corpus-root /tmp/jpegxl-conformance-4bf0535 --output /tmp/jpegxl-m00-conformance-check.json
npx vitest run tests/jpegxl-production-program.test.ts tests/jpegxl.test.ts tests/jpegxl-bitstream.test.ts tests/jpegxl-corpus.test.ts tests/jpegxl-jpeg-reconstruction.test.ts tests/jpegxl-workbench-preview.test.ts tests/jpegxl-worker-protocol.test.ts tests/capability-manifest.test.ts
npm run capabilities:check
npm run package:types
npm run browser:check
npx playwright test browser-tests/jpegxl-workbench.pw.ts --project=chromium --project=firefox --project=webkit --retries=0
npm run check
git diff --check
```

The exact remote workflows passed for revision `14596426179e5c3cd62aa79c3a12e3c61c87c102`:

- [CI](https://github.com/a-r-d/PureJsImage/actions/runs/33766236347)
- [CodeQL](https://github.com/a-r-d/PureJsImage/actions/runs/33766236336)
- [Imazen codec corpus](https://github.com/a-r-d/PureJsImage/actions/runs/33766236377)
- [JPEG XL pinned corpus](https://github.com/a-r-d/PureJsImage/actions/runs/33766236426), including the complete pinned matrix and all three browsers with retries disabled

The required JPEG XL workflow is `.github/workflows/jpegxl-corpus.yml`; it runs weekly and on relevant pull requests.

### Accepted limitations and deferred work

- Current wall-time and RSS numbers are reference-machine snapshots. They are not mandatory thresholds on shared pull-request runners.
- The real-image manifest uses the existing redistributable source set. A redistributable UI screenshot, scanned document, wide-gamut image, and high-bit RGB image remain explicit gaps.
- The JPEG archive currently has 10 eligible cases, including 3 real camera or source JPEGs. M1 must grow the legally usable real archive to at least 250 before exact recompression can become Stable.
- M0 records behavior and infrastructure only. It does not fix `delta_palette`, broaden VarDCT, improve compression, or change the public capability.

## M0 gate checklist

- [x] Four checksum-pinned corpus manifests with licenses
- [x] Parsed feature inventory rather than handwritten strategy claims
- [x] Every current public claim mapped to evidence
- [x] Stable five-class conformance taxonomy with no unexplained incorrect output
- [x] Weekly full-corpus workflow and small PR-safe set
- [x] Pinned oracle revisions, acquisition, build commands, and checksums
- [x] Deterministic JSON and Markdown baseline command
- [x] `npm run check`
- [x] Chromium, Firefox, and WebKit locally with retries disabled
- [x] No capability promotion
- [x] Exact remote pull-request workflow run recorded

M0 is ready for review. Review and merge remain external, and M1 must not begin on this branch.
