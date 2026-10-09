# JPEG XL stopping checkpoint

The owner paused this campaign on 2026-10-09. Encoder compression gains at
`7230f091` remain in main. This checkpoint preserves measurement and fixture
selection fixes, with no production encoder or dependency changes.

## Preserved work

- BD-rate keeps measured rate reversals and averages exact quality ties in log
  bytes. SSIMULACRA2 uses 60–90 and Butteraugli max uses 0.5–3, clipped to measured
  overlap. Butteraugli 3-norm uses the common measured interval.
- Fixture selection includes all ten watch references, rejects incomplete
  promotion preparation, and prevents holdout use in development runs.
- Wider global ladders and `--resume-own` preserve completed measurements when
  continuing an unchanged baseline. The explicit 14-photo screen records its two
  large-image omissions; the full lab retains all 64 development photos.
- All prepared inputs, cached peer curves, 505 JPEG XL files and their scores
  remain under `.tmp/jpegxl-lossy-lab/`.

## Partial speed measurements

The isolated one-worker run stopped after 138/198 jobs. All three encoders
completed the same 46 development crops. Neither of the two full-resolution
originals was measured. These results do not establish the full speed target.
Settings were effort 7, distance 2 for PureJsImage and vips, and quality 80 for
jSquash. They are timing settings, not matched perceptual quality.

| Encoder | Completed crops | Median encode time |
| --- | ---: | ---: |
| PureJsImage | 46 | 1072.38 ms |
| jSquash 1.3.0 | 46 | 486.13 ms |
| wasm-vips 0.0.19 | 46 | 372.33 ms |

Among those crops, the own-encoder managed allocation peak was 84.22 MiB and the
process peak RSS was 535.33 MiB. Full-original memory remains unmeasured.

## Cleanup and validation

The stopping cleanup archived 197 metadata files plus preparation and speed
logs before removing 138 decoded PNG copies (97.80 MiB). Every removed PNG has a
preserved JPEG XL file whose size matches its measured result.
Archives, the partial speed summary and deletion records are under
`.tmp/jpegxl-stop-cleanup-2026-10-09/paused-lab/`.

The 75 focused lab regression tests and strict TypeScript checks pass.
`npm run check -- -- --maxWorkers=4` passed with 3,827 tests across 294 files,
plus three existing test skips and one skipped file. Build, browser, type,
documentation, package, lint and formatting checks passed. The full check log is
saved with the cleanup records.

## Unfinished work

The full development BD-rate baseline, complete isolated speed baseline and
holdout qualification remain unfinished. The existing screen report predates
the measurement repairs and remains an incomplete historical result.

Watch preparation produced nine of ten originals. The first-party baseline JPEG
reader leaves a terminal RST3 before EOI unconsumed on `prior-12mp-im26-1416`.
That preparation failure remains explicit; its codec fix is still pending.
No optimization experiments or holdout measurements were run in this lab phase.
