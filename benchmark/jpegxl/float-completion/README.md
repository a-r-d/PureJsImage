# Float and composed-frame qualification

## Quick Answer

Ordinary JPEG XL float ICC/HDR conversion, lossless Float32 encoding and native
float/CMYK composition pass the pinned public-pipeline checks. The implementation
keeps first-party TypeScript codecs and a package with no runtime dependencies.

The qualification adds twelve static ICC/HDR inputs and thirteen libjxl-encoded
composed inputs with twenty-nine displayed frames. The fixture manifests pin
encoded bytes, profile binaries, source samples, display references and tolerances.
The forty-one workflows run in Node, Chromium, Firefox and WebKit, including
replay, group-boundary crops, ICC byte preservation and re-encoding.

`encoding.json` records sixty-six ordinary-pipeline outputs decoded independently
with pinned libjxl 0.12.0. All decoded Float32 bits match source rows, including
associated alpha, encoded HDR and source-primary linear HDR. Preserved ICC bytes
also match independently decoded profiles. Binary16 input emits binary32.

`resource.json` records sixty-two isolated cold/warm cases across ten inputs.
Decode, crop, HDR linear output and re-encoding each validate output against the
pinned references. Warm measurements follow two complete workflows and two GC
calls. Absolute peak RSS includes warmup; baseline and final memory include
external and ArrayBuffer allocations. Measured process peaks are 112.5 to
179.8 MiB on this host, including the Node runtime and module loading. These
small inputs do not establish large-image memory scaling or a Lambda memory tier.

Static conversion retains source planes. Composition retains a canvas and up to
four reference slots. Float encoding retains planar Float32 bits, compressed
sections and assembled output. Cropping does not remove source or reference
storage. Public working/output limits remain explicit and checked before allocation.

`conformance.json` records thirty-nine passing official cases with matching
current expectations. Its historical baseline comparison is false because that
baseline marked features unsupported that are now supported. `receipt.json`
records the Git base revision and hashes of the implementation, harnesses,
fixture manifests and reports for this qualification.

## Reproduce

The fixture READMEs document pinned development-only native libraries. Node
verification uses saved references and needs no native runtime dependencies.
Independent output decoding requires Bun on Linux x64 and the pinned libjxl
shared library. The conformance corpus lives at `.tmp/jpegxl-conformance`.

```sh
npx vitest run tests/jpegxl-float-completion.test.ts
npx playwright test browser-tests/jpegxl-float-completion.pw.ts
node benchmark/jpegxl/verify-float-encoding.ts benchmark/jpegxl/float-completion/encoding.json
node benchmark/jpegxl/run-float-completion.ts benchmark/jpegxl/float-completion/resource.json
node benchmark/jpegxl/production-program/run-conformance.ts --corpus-root .tmp/jpegxl-conformance --output benchmark/jpegxl/float-completion/conformance.json
```

The [practical coverage table](../../../docs/jpegxl-practical-coverage.md) lists
the supported profiles, sample layouts and remaining conversion boundaries.
