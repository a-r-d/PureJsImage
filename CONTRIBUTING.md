# Contributing to PureJsImage

Thanks for helping improve PureJsImage. The project favors focused, measurable changes that keep
the default TypeScript implementation portable, safe, and small.

## Changes that are welcome

Bug fixes and performance improvements are welcome when they:

- include a focused regression test or expand an existing test;
- leave the complete test suite passing;
- include a reproducible before-and-after benchmark when making a performance claim;
- validate output correctness before treating benchmark timing as meaningful; and
- follow the performance, memory, safety, and code-style rules in `AGENTS.md`.

Keep fixes as small and direct as practical. Performance changes should reduce work, memory traffic,
or allocation pressure before adding complexity to a hot path.

## New functionality

Explain why a new feature belongs in PureJsImage and weigh its value against bundle size, memory,
maintenance cost, and API surface.

For functionality proposed for the core or a default entry point, opening an issue or discussion
first is encouraged when the design or bundle impact is significant. It is not required.

If the functionality can live behind a separate explicit import and remain completely excluded from
the default bundle, you are welcome to proceed directly with a pull request. Strongly consider this
modular approach for new transforms, codecs, providers, and other substantial features.

The pure-JavaScript reference implementation remains the default. Optional implementations such as
WASM codecs must never be loaded, bundled, downloaded, or selected unless the application explicitly
imports and registers them.

## Tests and benchmarks

Before opening a pull request:

```sh
npm ci
npm run check
```

Add or update a focused test for every behavior change. Run the narrowest relevant fixture verifier
or benchmark in addition to the full check. Keep benchmark inputs pinned and comparisons equivalent
across engines.

Performance pull requests should report representative wall time and peak RSS. Where relevant, also
report throughput, allocations, output size, and lossy output quality. A fast invalid output is a
failed benchmark.

## APIs, documentation, and changelog

Changes that add or extend public APIs must update the applicable documentation, including the root
README and public `/docs` pages. Keep capability claims precise and document unsupported boundaries.

Every pull request must update `CHANGELOG.md`. Add a concise entry under the appropriate heading in
the `[Unreleased]` section. Do not create a release, change the package version, or move entries into
a versioned section. The release manager, Aaron Decker (`a-r-d`), will prepare releases.

## Code and tooling rules

- Follow `AGENTS.md`, including its strict TypeScript, bounded-memory, dependency, test, benchmark,
  and hot-path rules.
- If you use an AI coding tool, instruct it to read and follow `AGENTS.md` before making changes. You
  remain responsible for reviewing its code, tests, documentation, and benchmark claims.
- Do not change formatter or linter settings without discussing the proposal with the maintainer
  first.
- Keep implementation and test packages in `devDependencies`; the published package must retain no
  runtime dependency tree.
- Do not vendor, copy, or disguise third-party production codec implementations as local code.

## Pull requests

Open pull requests directly against the `main` branch. Before requesting review:

1. Update your branch from the latest `main`.
2. Resolve every merge conflict locally.
3. Run `npm run check` and the relevant fixtures or benchmarks.
4. Confirm the documentation and `[Unreleased]` changelog entry are included.
5. Describe the problem, the chosen approach, the validation performed, and any compatibility,
   bundle-size, or memory tradeoffs.

Pull requests should be clean of conflicts and limited to a coherent change. An issue is optional;
a clear pull request with evidence is enough for a modular, self-contained addition.

## License

All contributions are made available under the repository's MIT License. By submitting a pull
request, you agree that your contribution may be distributed under that license.

Questions can be directed to Aaron Decker through [www.ard.ninja](https://www.ard.ninja).
