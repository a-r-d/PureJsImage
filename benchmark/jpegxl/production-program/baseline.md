# JPEG XL production-program baseline

This report records the Milestone 0 baseline. It does not promote a codec capability.

- Starting main revision: `1cd965dfeba27865c920c4e27bd44dbb4ea0404b`
- Package version: `0.17.0`
- Official conformance: 2 pass, 36 expected unsupported, 0 malformed and safely rejected, 0 incorrect output, 1 explained unexpected failure
- Extracted PR feature fixtures: 27
- Exact JPEG reconstruction: 10/10 eligible baseline cases
- Exact JPEG median JXL/source size ratio: 1.1917293233082706
- Encoder median JXL/PNG size ratio: 6.03626375895752
- Correctness-gated benchmark workloads: 4
- Browser workbench: Chromium pass with retries disabled, Firefox pass with retries disabled, WebKit pass with retries disabled

## Important boundaries

The official `delta_palette` case reaches `INVALID_INPUT`. The baseline classifies this as an explained unexpected failure, not as malformed input or supported behavior.

Wall-time and RSS values are reference-machine snapshots. Ordinary pull-request CI treats correctness, hashes, classifications, and resource-policy behavior as gates.

See `baseline.json` for the complete module, API, corpus, feature, compression, speed, memory, package-size, pipeline, and browser matrices.
