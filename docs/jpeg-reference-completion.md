# JPEG reference completion plan

This document tracks the final first-party TypeScript JPEG work that should land before an optional
Rust/WASM implementation begins. The TypeScript codec remains the portable reference and default
production path. Each checked item requires focused tests, independent pixel or bitstream evidence
where applicable, updated capability documentation, and bounded-memory behavior consistent with
`AGENTS.md`.

## Scope boundary

This project completes the common static 8-bit Huffman JPEG reference. It does not add 12-bit,
lossless, arithmetic-coded, hierarchical, DNL, abbreviated MJPEG, JPEG XT, full Ultra HDR
reconstruction, progressive output, optimized Huffman output, or coefficient-domain transforms.
Those inputs and options must continue to fail explicitly rather than return plausible pixels.

## Phase 1: incremental and region-aware decode

- [x] Parse JPEG headers and entropy incrementally from `ImageSource` without retaining the complete
  compressed input.
- [x] Keep baseline single-scan reconstruction bounded to MCU rows.
- [x] Keep progressive and multi-scan sequential input in an explicit compact coefficient memory
  class without retaining compressed bytes.
- [x] Validate and index restart markers without source-sized allocations.
- [x] Seek to the nearest usable restart boundary for crop regions and avoid IDCT/color work for
  MCUs that cannot affect the requested output.
- [x] Allow decoder-driven scaled IDCT for safely aligned crop-resize plans while retaining the
  full-resolution fallback for unsafe coordinate mappings.
- [x] Benchmark full-frame resize and crop-heavy resize in isolated processes, including wall time,
  absolute peak RSS, compressed bytes retained, MCUs entropy-decoded, and blocks reconstructed.

## Phase 2: reference pixel quality

- [x] Replace nearest-sample chroma expansion with bounded-row bilinear upsampling using the sample
  placement defined for JFIF JPEGs.
- [x] Keep direct fast paths for grayscale, RGB, CMYK, YCCK, and 4:4:4 data that does not require
  chroma expansion.
- [x] Validate baseline, progressive, scaled-IDCT, restart-marker, odd-dimension, and crop-edge
  pixels against independent libjpeg/ImageMagick output with fancy upsampling enabled.
- [x] Record output error and performance before and after the quality change.

## Phase 3: common 8-bit syntax and sampling

- [x] Decode 8-bit extended sequential Huffman JPEG (`SOF1`) while continuing to reject 12-bit
  input explicitly.
- [x] Decode sequential JPEGs whose components are split across multiple scans using compact
  coefficient storage.
- [x] Add checksum-pinned, redistributable or reproducibly generated fixtures for 4:4:0, 4:1:1,
  8-bit `SOF1`, and non-progressive multi-scan input.
- [x] Add an unusual progressive scan fixture and strengthen Adobe RGB coverage.
- [x] Verify metadata and complete decoded pixels against independent libjpeg/ImageMagick output.

## Phase 4: JPEG-specific hostile-input contract

- [x] Add structured corruptions for marker extents, table replacement, scan counts and ordering,
  restart sequences, entropy stuffing, sampling geometry, and truncated scans.
- [x] Apply explicit scan-count, retained-coefficient, restart-index, ICC, and allocation limits.
- [x] Add large compressed-input tests proving bounded reads and cleanup after failure.
- [x] Require every invalid or unsupported case to return a typed `ImageError`; no case may return
  plausible corrupted pixels or leak an unexpected exception.

## Phase 5: bounded streaming encoder completion

- [x] Encode `gray8` as a native single-component JPEG without RGB expansion.
- [x] Add validated restart-interval output with `DRI`, ordered `RST0`-`RST7` markers, bit alignment,
  and DC predictor resets.
- [x] Preserve row-bounded encoding for grayscale and color output.
- [x] Verify generated files through independent libjpeg decode and compare output dimensions,
  pixels, size, and quality.
- [x] Keep progressive and optimized-Huffman output explicitly unsupported because they require a
  separate compact-coefficient or spillable two-pass memory design.

## Phase 6: future WASM parity contract

- [x] Add a reusable JPEG reference-vector manifest covering metadata, decode requests, output
  hashes or tolerances, limits, and expected typed failures.
- [x] Add a provider-neutral parity runner that exercises the TypeScript reference now and can run
  the later explicit WASM codec without changing vectors.
- [x] Document exact-versus-tolerant pixel rules and require identical metadata, limits, and error
  codes across providers.
- [x] Keep the default and browser codec entrypoints free of WASM and Node built-ins.

Exact vectors cover component layouts whose reference samples are direct. Subsampled YCbCr vectors
carry both a reference-output SHA-256 (to detect accidental TypeScript drift) and explicit MAE and
maximum-channel tolerances for comparing a later WASM implementation. Metadata fields, limit
outcomes, and `ImageError` codes are always exact across providers.

## Final validation and handoff

- [x] Update `capabilities/manifest.json`, regenerate every derived capability surface, and review
  the generated diff.
- [x] Update the Unreleased changelog and benchmark documentation.
- [x] Run `npm run capabilities:check`, focused JPEG tests, `npm run fixtures:jpeg`, and
  `npm run browser:check`.
- [x] Run `npm run check`.
- [x] Re-run the JPEG encode, scaled-IDCT, region/RSS, and representative competitor benchmarks.
- [x] Re-run the benchmark chart generator (`npm run bench:competitors:charts`) and review the
  generated graphs.
- [x] Commit and push the branch, then open a draft pull request into `main` with the measured
  compatibility, quality, runtime, memory, and remaining-boundary evidence.
