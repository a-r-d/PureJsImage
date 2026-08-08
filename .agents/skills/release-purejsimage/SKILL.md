---
name: release-purejsimage
description: Prepare, verify, publish, and audit PureJsImage releases. Use when changing the package version, promoting CHANGELOG entries, creating a release commit or tag, publishing to npm, creating a GitHub release, or checking that npm, GitHub, and git release artifacts agree.
---

# Release PureJsImage

Use this workflow as a release gate. Keep preparation separate from irreversible publishing, and
report exactly which gate has passed.

## Establish authority and scope

1. Treat version bumps, release commits, tags, pushes, npm publication, and GitHub releases as
   state-changing operations. Perform only the operations Aaron Decker explicitly requested.
2. Never infer a version number or release type from the current changelog. Confirm the intended
   semantic version when it is not explicit.
3. Never request, display, record, or store an npm password, token, recovery code, or one-time
   password. Have Aaron authenticate directly when interactive authentication is required.
4. Inspect `git status`, the current branch, `origin`, existing tags, npm state, and GitHub releases
   before changing anything. Preserve unrelated work; never reset, clean, or silently include it.
5. Release only from `main`. Confirm the candidate commit is the intended commit and is synchronized
   with `origin/main` before tagging or publishing.

## Prepare the release candidate

1. Read `AGENTS.md`, `CONTRIBUTING.md`, `SECURITY.md`, `package.json`, `package-lock.json`, and the
   `[Unreleased]` changelog section.
2. Choose the version only after reviewing user-visible compatibility, API, codec, security, and
   performance changes. Do not overstate unsupported behavior.
3. Move all completed `[Unreleased]` entries into a dated version section. Leave a fresh empty
   `[Unreleased]` section and update comparison links at the bottom of `CHANGELOG.md`.
4. Update `package.json` and `package-lock.json` to the exact same version. Do not create a tag as a
   side effect of this edit.
5. Update documentation when the release changes public APIs, supported formats, limitations,
   performance claims, compatibility, or security guidance.
6. Review the complete candidate diff. Exclude benchmark corpora, local results, secrets, temporary
   files, and unrelated changes unless they are intentional published project artifacts.

## Validate before publication

Run every mandatory gate from a clean install:

```sh
npm ci
npm run check
npm run fuzz:release
npm pack --dry-run --json
```

Also:

1. Treat the deterministic release fuzz campaign as mandatory. Before running it, resolve any
   existing `artifacts/fuzz-crashes` reproducers so the output directory represents this candidate.
   The campaign runs 512 seeded bit flips against one committed benchmark input for every registered
   codec. Record its seed and case count.
2. If the campaign writes a raw-exception reproducer under `artifacts/fuzz-crashes`, stop the
   release. Minimize and deduplicate the input, add its exact bytes to `tests/fuzz-regressions`, fix
   the error normalization, and rerun both `npm run check` and `npm run fuzz:release`.
3. Run the narrowest relevant fixture verifiers and benchmarks for codec, fixture, or performance
   changes. Validate output correctness before accepting timing results.
4. Confirm `package.json` has no `dependencies`, `optionalDependencies`, or bundled runtime
   dependencies. Development-only test and benchmark tools must not enter the published graph.
5. Inspect the packed file list. Confirm it contains only intended package files and excludes source
   corpora, credentials, local output, tests, and development configuration.
6. Pack the actual tarball and install it into a temporary consumer project. Smoke-test the root
   import and every changed public or codec entrypoint on the minimum supported Node.js version.
7. Record the version, candidate commit, validation commands, relevant benchmark environment, and
   tarball integrity. A failed or skipped required gate means the candidate is not ready.

## Commit, tag, and publish

Proceed through each state change only when it was explicitly authorized:

1. Create one focused release commit with the prepared version and changelog.
2. Push the release commit and wait for all required GitHub checks to pass on that exact commit.
3. Create an annotated `v<version>` tag that points to the verified release commit, then push that
   exact tag. Sign it when the maintainer's signing setup is available; never claim an unsigned tag
   is signed.
4. Prefer npm trusted publishing with provenance when it has been configured for this repository.
   Otherwise stop at the authentication boundary and have Aaron complete npm authentication
   privately. Do not claim provenance unless npm shows a registry attestation.
5. Publish the already-verified tarball or verify that a fresh pack is byte-for-byte the intended
   artifact. Do not rebuild from a changed worktree.
6. Create the GitHub release from the same tag. Use the matching changelog section for release notes
   and mark it latest unless Aaron explicitly identifies it as a prerelease.

Never reuse or move an existing published version or public tag. If publication partially succeeds,
stop and reconcile the public state instead of deleting or overwriting evidence.

## Verify the public release

After publication, independently confirm:

1. `npm view purejsimage@<version>` reports the expected version, integrity, repository, engines,
   dependency-free runtime graph, and release time.
2. A fresh temporary project can install the registry artifact and run the same import smoke tests.
3. The npm artifact, annotated git tag, GitHub release, changelog section, and release commit all use
   the same version and commit lineage.
4. The GitHub release is visible and correctly marked latest or prerelease.
5. Any configured documentation deployment completed for the release commit.

Conclude with a compact release record: version, commit, tag, npm status, GitHub release status,
provenance status, checks run, release-fuzz seed and case count, fixture or benchmark evidence, and
any remaining manual action.
