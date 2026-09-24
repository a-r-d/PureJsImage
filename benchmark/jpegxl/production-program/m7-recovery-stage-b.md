# M7 recovery: larger-transform backend milestone

This is development work on `codex/jpegxl-transform-backend` from the PR #37 Stage A revision `d7f3e9c9`. It is not a public codec change or a Stable promotion. The main PR branch keeps its current encoder while this backend and a selector are evaluated.

## Backend and stream behavior

The recovered DCT16 path covers four adjacent 8×8 blocks with one 16×16 transform. The code records the first block, packs the strategy and quantizer maps by transform, reconstructs the four low-frequency samples, stores 256 AC positions in a bounded group arena, and writes DCT16 coefficient order and contexts. An explicit internal opt-in selects the experimental path; ordinary sync and async encoding keep the existing behavior. Efforts below 7, progressive encoding, alpha, and non-RGB8 color settings use the old path. DCT8 remains available beside selected DCT16 regions.

Deterministic tests check forward/inverse behavior for a constant, ramp, impulse, edge, and texture; exact first-block coverage on a 65×65 partial group; a mixed 257×65 image; source pixel errors; progressive fallback; default output bytes; encoder resource-limit cleanup; and async cancellation. The selected 65×65 default stream keeps SHA-256 `54554eb00e70a50f1254a0029338e0c11b8a6bfb5ea59b7b4026917c8a713ba3`. This hash is a development regression check, not a public byte-level API promise.

The isolated [24-point development report](m7-recovery-stage-b-development.json) covers eight pinned derivatives at distances 1, 2 and 3. All 24 streams decoded through pinned native libjxl, pinned Rust and the repository decoder with maximum RGB8 difference 1. The report records each source and encoded artifact SHA-256, source dimensions, settings, output size, SSIMULACRA2 and Butteraugli. Its SHA-256 is `9c1c01efa2dfa74f83c252e8b36c0607dd052e61d6d5036d6169d8eeaf03d5df`. The [bounded receipt](m7-recovery-stage-b-receipt.json) records 583.1M peak process-tree memory and zero swap; its SHA-256 is `7f723eef839a3512f38d8a599cf6cf259d61ebb71fc15eea40879ccaa62ebb4a`. These are backend validity checks, not matched-quality compression evidence. The prior [Prompt 14](m7-prompt14-transform-probes.md) matched-quality probe rejected the broad DCT16 selector.

## Distance and coefficient limits

| Limit | Current reason | Scope of a proper change |
| --- | --- | --- |
| Public distance 0.25 to 25 | API guard in `jpegxl-vardct-encode.ts`. The current fixed base quantizer is 4 and `globalScale = round(65536 / (distance * 4))`. At 0.25, the scale is 65,536. | A smaller distance needs a coordinated scale and local-quantizer representation, source-quality and independent-decoder tests, not a removed guard. |
| Global scale ceiling 73,728 | The current JPEG XL `writeU32` branch uses 16 bits plus offset 8,193. This is the emitted field syntax; it is not changed by simply selecting another codestream level. | Validate quantizer and scale combinations within the syntax and against decoder behavior. |
| AC coefficient magnitude 4,095 | First-party encoder range guard and prepacked 8,192-value hybrid-token lookup; group storage is `Int16Array`. Hybrid tokens and signed 16-bit storage do not themselves establish a 4,095 JPEG XL format or Level 5 limit. | Widen the cached token range or encode tokens on demand, audit counts and memory, and independently test the full encoder/decoder path. Keep explicit failures until then. |

The tested streams do not establish whether a larger coefficient is valid under every level and profile. No public distance, level, or coefficient limit changed in this milestone.

## Bundle budget decision

The prior JPEG XL limits had only 177 bytes (`codec-jpegxl`) and 122 bytes (`jpegxl-specialized`) of headroom. The opt-in DCT16 backend measures 458,594 and 546,681 minified bytes, growth of 3,771 and 3,803 bytes from the recorded current revision. The development branch raises only these two ceilings to 475,000 and 563,000 bytes. This leaves roughly 16 KiB for a measured selector or a second useful transform and still gates further growth. These are ceiling amendments, not a claim that larger output is free or that the experiment is ready to ship. Generated size artifacts remain branch-local until integration is selected.

## Check result

`VITEST_MAX_WORKERS=2 npm run check` passed after the last codec change. The nested development checkout caused Vitest to discover two copies of the suite: 6,426 tests passed and six existing skips. Browser, packaging, types, lint, format, and size gates passed. The final 24-point diagnostic was rerun afterward with source hashes matching the checked code.

## Decision

DCT16 backend correctness is retained for further development; the forced quantizer-6 selection used by this opt-in is diagnostic and is not an accepted encoder policy. DCT32 and rectangular transforms remain unimplemented in this branch. The original DCT16 and DCT64 prototype patches are [tracked here](../experimental/README.md); the DCT64 edge rule was already rejected on original-size matched-quality checks. Next work is a calibrated region-level rate-distortion selector with complete-image guardrails. Do not infer a Stable scope from this backend milestone.
