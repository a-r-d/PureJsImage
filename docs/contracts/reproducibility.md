# Reproducibility contract

Status: normative alpha contract. Reproducibility is layered; no single hash promises identical
floating-point bytes on every backend.

## Identity layers

| Record | Meaning | Excludes |
| --- | --- | --- |
| `graphHash` | SHA-256 identity of a reusable versioned recipe | bound values, sources, providers, labels, timing |
| `bindingHash` | SHA-256 identity of all semantic external bindings | presentation and locator hints |
| `invocationHash` | SHA-256 of `{ graphHash, bindingHash }` | provider choice and execution conditions |
| execution record | invocation plus providers, implementations, library build, warnings, and timing | nothing required to interpret that run |

`graphHash` is a recipe hash, not a complete analysis identity. Graph canonicalization sorts inputs,
nodes, ports, and outputs by semantic identifiers and sorts JSON object keys. It does not preserve
authoring order. The current domain is `purejsimage.analysis-graph.canonical-json.v2`; changing the
canonical byte contract requires a new domain and explicit migration.

Bindings are sorted by input name and include the exact value-type ID/version. Built-in scalars and
JSON values use canonical semantic JSON. ROI identity excludes names and presentation but includes
stable ID, quantitative geometry, axes, fixed indices, coordinate space, and units. Opaque
extension values require an application-defined semantic identity. Execution cannot replace an
identity captured by planning.

## Source identity strength

- Content SHA-256 and remote strong ETag/version IDs are strong identities.
- Local name/path, size, and modified time and remote `Last-Modified` are weak metadata identities.
- Memory, Blob without durable metadata, and custom sources may be session-only.

Weak equality is a cache/rebinding hint, never proof of equal bytes. A validator change creates a
different binding and invocation. Content hashing is explicit, bounded, cancellable, and optional;
it is not required before first display.

## Provider and numerical classes

Every operation version declares one reproducibility class:

- **bit-exact**: every conforming implementation produces exactly identical typed output bytes for
  canonical vectors. Only implementations declaring bit-exact conformance are selectable.
- **backend-stable**: a particular implementation build is internally stable, but another backend
  may differ. The execution record is required to reproduce it.
- **tolerance-based**: results may differ within the operation descriptor's explicit absolute or
  relative tolerance and invalid-value policy.
- **provider-pinned**: planning requires the exact provider ID/version and optional build
  fingerprint. Decline or absence is an error; there is no silent fallback.

Provider kind is not a reproducibility or quality ranking. Provenance records provider ID/version,
kind, build fingerprint, operation implementation version, library package version/build
fingerprint, parameters hash, declared class/tolerance, and any explicit fallback.

Floating-point reductions define traversal/merge order where promised, but JavaScript, WASM, and
GPU arithmetic can still differ through precision, fused operations, denormal handling, or NaN
payloads. `uint64` tiles remain exact storage; number-backed analysis rejects values beyond
`Number.MAX_SAFE_INTEGER` and does not claim exact quantitative uint64 support.

## Versioning rules

An operation version must increase when valid inputs, defaults, no-data rules, coordinate
interpretation, output shape/type, numerical algorithm, reduction order, boundary behavior, or
declared tolerance changes semantically. Performance-only changes that preserve the declared
reproducibility contract may keep the operation version but must change the implementation version
or build fingerprint.

Graph and operation migrations are explicit registered transforms. They may produce a new graph and
hash only after inspection and caller approval; silent semantic rewrites are forbidden.

## Golden vectors

Canonical compatibility fixtures must commit the exact canonical graph JSON and hash, quantitative
ROI canonical JSON and hash, sorted binding manifest and hash, and complete invocation hash. Each
vector names its hash domain and operation/schema versions. A changed expected value requires an
explicit domain/version change or a documented correction reviewed as a compatibility change.

Numerical operation fixtures additionally record inputs, provider/implementation fingerprint,
expected typed output, invalid/no-data policy, and either exact bytes or the declared tolerance.
Golden vectors are correctness gates; benchmarks cannot replace them.
