# Repository rules

## Before handing off changes

- Run `npm run check`.
- Run the narrowest relevant benchmark or fixture verification when changing benchmark code.
- Keep every implementation and test dependency in `devDependencies`. The published package must have
  no runtime dependency tree.
- Production codecs and processing code must be implemented in this repository. Do not bundle,
  vendor, copy, or runtime-import a third-party implementation to disguise a dependency as local
  package contents. Dev dependencies may be used only as test or benchmark oracles.

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

## Lambda memory northstar

- The original production problem behind PureJsImage is Jimp's high peak memory in AWS Lambda image
  workflows. Reducing Lambda memory requirements, allocation pressure, and out-of-memory risk is a
  primary product goal, not a secondary optimization.
- A JPEG downscale must not be considered solved merely because it is faster than Jimp. Common
  baseline-JPEG resize pipelines should decode and retain bounded MCU rows or another bounded working
  set instead of a full source-resolution RGB or RGBA bitmap.
- Avoid duplicate full-frame buffers at codec boundaries. Push crop and resize requirements into the
  decoder wherever the format permits it, and release source rows as soon as they cannot contribute
  to output.
- A full-frame codec fallback must be explicit, documented, and benchmarked separately. It must not
  silently define the memory behavior of the primary Lambda workflow.
- Progressive JPEG is a distinct memory class: later scans require earlier DCT coefficients, but the
  decoder should retain compact coefficient storage rather than a full RGB or RGBA frame and should
  reconstruct final pixels in bounded rows.
- Measure absolute peak RSS in isolated processes for both cold and warm executions. Ensure warmup
  allocations have actually been reclaimed before using a post-warmup baseline, and record external
  and ArrayBuffer memory when diagnosing retained pages.
- Prefer improvements that lower the Lambda memory tier needed by realistic concurrent workloads.
  Small percentage wins are useful, but they do not satisfy the northstar when peak memory still
  scales with the source bitmap.

## Tests and benchmarks

- Add or update a focused test for every behavior change and regression fix.
- Test public behavior and important edge cases rather than implementation details.
- Correct output is required before performance counts. Unsupported or invalid output is a failed
  benchmark, regardless of speed.
- Treat benchmark changes as measurement changes: keep inputs pinned, workflows reproducible, and
  comparisons equivalent across engines.
