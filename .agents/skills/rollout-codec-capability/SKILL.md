---
name: rollout-codec-capability
description: Add, expand, restrict, deprecate, or document a PureJsImage codec capability while keeping implementation, compatibility tests, the capability manifest, README tables, codec support pages, website tables, and generated expectations aligned. Use for decode, encode, metadata, color, orientation, animation, format-subset, memory-class, or unsupported-operation changes to an image codec.
---

# Roll Out Codec Capability

Treat correctness evidence and `capabilities/manifest.json` as the gates for every public codec
claim. Never make generated documentation authoritative.

## Establish the current contract

1. Read `AGENTS.md`, `CONTRIBUTING.md`, `capabilities/manifest.json`,
   `scripts/capability-manifest.ts`, and `scripts/render-capabilities.ts`.
2. Inspect the relevant codec source, its focused tests and fixtures, and its manifest entry. Check
   the worktree before editing and preserve unrelated changes.
3. State the exact capability and boundary being changed. Distinguish metadata inspection, pixel
   decode, encode, preservation, pipeline behavior, and memory behavior.
4. Treat an existing checked manifest item as a public claim. Treat an unchecked item as unsupported
   or planned until implementation and independent validation are complete.

## Implement and prove behavior

1. Implement production behavior locally in this repository. Never runtime-import, vendor, or copy a
   third-party codec. Development dependencies may act only as test or benchmark oracles.
2. Add or update focused tests for the public behavior and important failure boundary. Use pinned
   independent fixtures or oracles where format compatibility or lossy quality is involved.
3. Assert explicit `UNSUPPORTED_OPERATION` behavior when a recognized subset remains unsupported.
   Never silently approximate semantics or emit plausible but invalid output.
4. Exercise browser behavior when the changed codec path is reachable from browser entry points.
5. For performance or memory claims, validate output first and run the narrowest representative
   benchmark. Record full-frame fallbacks and memory classes explicitly.

## Update the authoritative manifest

Edit only `capabilities/manifest.json` for public capability data:

1. Update `read`, `write`, `boundary`, `description`, `memory`, or `recommendation` only when the
   corresponding public summary changed.
2. Change the relevant checklist line from `[ ]` to `[x]` only after the focused evidence passes.
   Add a narrow checklist line instead of broadening an unrelated claim.
3. Keep remaining limitations explicit and unchecked. Split mixed implemented/unimplemented items so
   one checkbox never overstates a partial feature.
4. Add every focused test file that proves the capability to the codec's `evidence` list. Remove an
   evidence path only when its claim is removed or replaced by equivalent coverage.
5. For a restriction or removal, update the summary and checklist, add a negative regression test,
   and retain an explicit error boundary.

Do not directly edit generated regions or files:

- the README codec table and roadmap links;
- root `*-codec-support.md` pages;
- capability tables and cards in `docs/codecs.html`;
- `docs/capabilities.json`; or
- `tests/generated/capability-expectations.json`.

Regenerate them with:

```sh
npm run capabilities:generate
```

Review every generated diff. Confirm summaries remain human-readable and detailed checklists do not
claim more than the tests prove.

## Validate the rollout

Run, in order:

```sh
npm run capabilities:check
npx vitest run <focused-test-files>
npm run browser:check
npm run check
```

Run the narrowest relevant fixture verifier or benchmark in addition when fixtures, compatibility,
performance, memory, or lossy quality changed. `npm run check` must prove that generated outputs are
current, evidence files exist, and published decoder/encoder support matches the actual codec
objects.

## Hand off precisely

Report:

- the capability now supported, restricted, or still unsupported;
- the exact subset and error boundary;
- the focused tests, fixtures, or oracle used as evidence;
- the generated documentation surfaces reviewed;
- browser, fixture, benchmark, and full-check results; and
- any known memory fallback or compatibility limitation.

Do not make marketing, compatibility, quality, or performance claims beyond the recorded evidence.
