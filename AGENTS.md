# Repository rules

## Before handing off changes

- Run `npm run check`.
- Run the narrowest relevant benchmark or fixture verification when changing benchmark code.
- Keep every implementation and test dependency in `devDependencies`. The published package must have
  no runtime dependency tree.

## Code style

- Write all source, benchmark, script, and test code in TypeScript with strict mode enabled.
- Never use `any`. Prefer narrow, clearly defined types, literal types, and discriminated unions over
  broad object shapes.
- Treat external input as `unknown` and narrow it with runtime checks. Do not bypass type safety with
  unchecked assertions or suppression comments.
- Prefer the smallest direct implementation that clearly solves the current problem.
- Use a few straightforward lines instead of introducing speculative layers, factories, or generic
  abstractions.
- Add an abstraction when it removes real repetition or enforces a real invariant, not because it may
  become useful later.
- Keep functions focused and data flow obvious. Avoid clever compression that makes code harder to
  review.
- In image-processing hot paths, minimize allocations, buffer copies, full-image materialization, and
  repeated pixel passes.
- Do not add features solely for API breadth. Optimize the workflows in the project specification and
  benchmark suite.

## Tests and benchmarks

- Add or update a focused test for every behavior change and regression fix.
- Test public behavior and important edge cases rather than implementation details.
- Correct output is required before performance counts. Unsupported or invalid output is a failed
  benchmark, regardless of speed.
- Treat benchmark changes as measurement changes: keep inputs pinned, workflows reproducible, and
  comparisons equivalent across engines.
