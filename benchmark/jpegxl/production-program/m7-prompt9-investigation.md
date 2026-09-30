# JPEG XL lossy screenshot and gradient investigation, September 24

This pass starts at `eccd158206a44e6aea50ffdb16eb15617099dbf8` on PR #37. It retains no codec change. The [probe data](m7-prompt9-probes.json) records all 48 first-party diagnostic points, exact stream hashes, input hashes, native control hashes, independent-decoder differences and raw receipt paths. The [Prompt 8 result](m7-prompt8-report.md) remains the qualification result. Lossy stays Experimental.

## What pinned libjxl does

The pinned `enc_heuristics.cc` searches for splines and patches before choosing an initial quantization field, block transforms, color correlation and a refined quantizer. It subtracts selected patch content before coding the remaining VarDCT frame. Its patch finder in `enc_patch_dictionary.cc` starts from flat 4×4 regions, grows a local background, finds small foreground components, and groups similar components into reference patches. These are algorithm notes from the pinned source, not copied production code. The source hashes and pinned `cjxl` hash are in the probe data.

On the original observed screenshot `im26-8160`, its distance-3 stream has a 114×112 Modular reference frame and a VarDCT display frame with 1,576 replace-patch placements. The placements cover 2.55% of the image, with 140 reference groups. A source-pixel check found that 1,380 of 1,436 placements after each group's first are byte-identical to that first rectangle. The other 56 can differ because libjxl groups quantized residuals. The existing first-party pale-page detector finds only 0.69% exact coverage here. A separate flat-background diagnostic finds 2.01% exact coverage on this previously observed screenshot and 1.18% on development screenshot `im26-8444`. These are search diagnostics, not encoded candidate results.

| Pinned native effort 7, distance 3 | Normal bytes | Patches off bytes | Saving relative to patches off |
| --- | ---: | ---: | ---: |
| Development screenshot `im26-8444`, 1024×768 | 49,870 | 55,290 | 9.80% |
| Previously observed screenshot `im26-8160`, 1920×1080 | 110,950 | 129,598 | 14.39% |

Both controls used the same normalized source pixels and the pinned `cjxl` binary in 3 GiB, zero-swap bounded runs. Pinned native and Rust decoders agree within one RGB8 level on each patches-off stream. On the development screenshot, normal/patched-off SSIMULACRA2 is 77.354/76.735 and Butteraugli is 3.038/3.038. On the previously observed original, SSIMULACRA2 is 74.572/73.773, while Butteraugli is 3.732/3.597. Patch coding therefore improves size and SSIMULACRA2 here but trades away some Butteraugli quality on the original. The [raw native receipts](m7-prompt9-probes.json) give stream, decoded and input hashes. Equal distance does not establish matched quality. The observed screenshot was inspected in earlier work and remains regression evidence.

The current first-party patch writer uses a Modular display. A previously measured step-4 Modular stream for development screenshot `im26-8444` is 359,181 bytes before patches, while its VarDCT distance-3 stream is 71,040 bytes. The candidate's 1.18% exact patch coverage cannot justify selecting that much larger Modular path. Screenshot patch work needs a first-party VarDCT display frame with an independently verified reference and patch composition path. The current brochure writer does not provide that path. On original gradient `im26-1416`, pinned native uses only 37 patches covering about 0.0035% of pixels; patch coding is not its material gap.

## Bounded encoder experiments

The eight fixed development derivatives, four text/map and four photo/texture, were re-encoded at effort 7 and distances 1, 2 and 3. Each candidate has 24 measured points and pinned native plus Rust decoding with a maximum one-level RGB8 difference. The unmodified baseline is the existing `diagnostic-prompt6-base` report. The input and tool hashes, per-point quality, sizes, stream hashes and 3 GiB zero-swap receipts are preserved in the [probe data](m7-prompt9-probes.json). No cold/warm runtime comparison is inferred from these serial runs.

| Candidate | Result | Decision |
| --- | --- | --- |
| Disable the residual-based EPF restoration | Eight photo/gradient streams change; SSIMULACRA2 falls in all eight, Butteraugli worsens in seven. Text/map streams are byte-identical. | Reverted. It does not explain the text outliers and reduces photo/gradient quality. |
| Remove the two-token advantage required before choosing an alternate 8×8 block transform | All 24 streams change. Bytes grow in 23; SSIMULACRA2 rises in 16 and falls in eight; Butteraugli worsens in five and improves in two. | Reverted. No useful class-wide quality-size gain. |

## Remaining work and qualification boundary

The measured screenshot coding opportunity is a VarDCT patch-bearing display, with exact or bounded-similarity region search against a local background. It needs new first-party reference-frame signaling, XYB composition and independent native/Rust/repository decoding before size and quality can count. For the gradient, libjxl's adaptive quantization and block decisions are a more relevant model; the current binary block quantizer still needs a measured, image-independent improvement. HDR/alpha visual outliers and missing transparent quality brackets remain separate work.

The approved six-distance 2 MP matrices still lack SSIMULACRA2 70/80/90 brackets. Pinned native libjxl itself misses some reference brackets on that grid, as listed in the [per-case bracket audit](m7-prompt8-bracket-audit.json). Supplemental endpoints must retain the original grid and source-family split. A new generalization claim needs genuinely held-out sources. After a codec change is retained and frozen, rerun the affected 2 MP and fixed eight original-size checks, relevant HDR/alpha views, and final conformance/resource checks. This investigation changes no encoded artifact or promotion result, so prior quality and timing evidence remains applicable.
