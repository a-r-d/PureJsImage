# Fuzz regression corpus

This directory holds minimized inputs that previously made a decoder throw something other than an
`ImageError`. Every `*.bin` file is exercised by the normal test suite and must now fail with an
`ImageError`.

The release corruption campaign saves exact reproducer bytes and a JSON error description under
`artifacts/fuzz-crashes` when it finds a raw exception. To promote a finding into this permanent
corpus:

1. Reproduce it with the seed and case information in the artifact filename.
2. Minimize and deduplicate the input without changing the failure.
3. Add the input here as `<format>-<short-description>.bin`.
4. Fix the underlying error normalization and add the finding to the Unreleased changelog.

Never replace a regression input with a newly generated equivalent. Keeping the original bytes makes
the test deterministic and preserves the exact parser boundary that failed.
