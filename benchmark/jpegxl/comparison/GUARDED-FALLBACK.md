# JPEG XL memory recovery and package size, October 3, 2026

The private predictor refinement preserves the previous encoder result when its
extra state reaches a working-memory limit. Its packaged encoder and decoder
also reproduce the four smaller lossless files. Both bundles fit the existing
size ceilings with all public exports intact.

The production codec still uses the previous qualified implementation. This
prototype needs further qualification before adoption. Overall compression parity remains open.

| Input | Retained ordinary file | Guarded refinement | Bytes saved |
| --- | ---: | ---: | ---: |
| im26-1416 | 649,404 | 648,383 | 1,021 |
| im26-2018 | 613,268 | 612,152 | 1,116 |
| Red dither | 617,106 | 615,996 | 1,110 |
| 513-pixel crop | 227,797 | 227,749 | 48 |

## Working-memory limits

The frozen 513 by 512 RGBA crop retains the original minimum of 36,853,881
working bytes. One byte below that minimum fails in both implementations. At the
minimum, both produce the same 271,761-byte file. The existing 48 by 32 RGB
fixture retains its 221,988-byte minimum and exact 586-byte file.

The old encoder selects a larger file when less working memory is available.
Compare both implementations at the same limit:

| Crop working limit | Previous file | Guarded file |
| --- | ---: | ---: |
| 36,853,880 | Limit exceeded | Limit exceeded |
| 36,853,881 | 271,761 | 271,761 |
| 41,387,257 | 271,761 | 227,797 |
| 41,387,258 | 271,761 | 227,749 |
| 47,284,910 | 227,797 | 227,749 |

Four supported budget pairs exercise the complete group retry. Every supported
file in the sweep preserves all original samples through native, Rust, and
public JavaScript decoding. Failed encodes leave no partial output. The memory
owner releases all its buffers.

The natural sweep report keeps `completed: false`: its additional coverage gate
failed because none of those limits reached the later histogram-search failure.
That failed receipt is preserved. These two fixtures do not establish a memory
guarantee for every input.

A separate diagnostic test allocates 64 KiB of scratch and requests another
256 MiB inside each refinement-enabled histogram search. The original allocator
rejects that request under its unchanged 256 MiB limit. Both group retries
restore the exact original crop file and release the failed scratch. A separate
invalid-input error propagates with no retry or partial output. Exhaustively
sampled small inputs skip the refinement and the injected branch.

## Package size and public behavior

The first-party helper shares the literal JPEG XL prefix in error messages.
1367 error literals preserve their complete message, error class, name, and code.
The portable codec remains implemented in this repository.

| Public target | Previous bytes | Funded guarded bytes | Existing ceiling | Headroom |
| --- | ---: | ---: | ---: | ---: |
| Core and JPEG XL | 540,978 | 540,879 | 541,000 | 121 |
| JPEG XL specialized | 613,578 | 612,784 | 614,000 | 1,216 |

The core target retains all 15 exports. The specialized target retains all 14.
The build uses the existing targets and bundler settings. Exact resolved codec
paths select the private copies, preserving the public entry module.

The actual built public encoder and decoder reproduce all eight controlled
files, including the previous and guarded result for each input. They preserve
the source measurements' whole-file hashes and managed memory peaks. Fresh
native and Rust decoding checks 50,339,840 original samples. Packaged JavaScript
decoding checks another 25,169,920 samples with complete, nonduplicate coverage,
including alpha and color samples behind transparent pixels.

## Remaining qualification

Earlier single-run timings added about 6% to 11% on these four inputs. Those
observations do not qualify the original 5% paired median and 95% bootstrap upper limits
for runtime and RSS. The prototype still needs acceptable paired costs,
broader memory controls, compatibility fixtures, real browser coverage, and the
complete public comparison matrices before adoption.

The retained comparison still has 13 unresolved quality comparisons. On the
matched photo at SSIMULACRA2 80, the retained output remains about 4.5% larger
than wasm-vips. This lossless predictor work does not resolve those lossy cases.

Evidence:

- [Whole-group source controls](results/whole-group-fallback-controls.json)
- [Natural memory sweep and its failed coverage gate](results/whole-group-memory-fallback-controls.json)
- [Injected recovery and error propagation](results/whole-group-memory-injected-controls-retry.json)
- [Actual package measurements](results/whole-group-fallback-package-controls.json)
- [Packaged public encoding and decoding](results/funded-whole-group-public-controls.json)

The earlier single-injection frame expectation, prototype-cloning harness
failure, and failed package-controller compilation remain recorded in the
optimization log. They are excluded from successful qualification counts.
