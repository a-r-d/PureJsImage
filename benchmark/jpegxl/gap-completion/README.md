# JPEG XL additional gap verification

These are development measurements on a dirty worktree based on
`590bbf08968f0f12c32bb4aa5c84627ba5dbeab4`. They extend the declared codec subsets.
The [library comparison](../comparison/REPORT.md) reruns this source with its
original pinned inputs and comparator versions. These additional cases qualify
the declared subsets without claiming a universal compatibility, speed or
compression winner.

Reproduce from the repository root with the pinned oracle libraries installed:

```sh
node benchmark/jpegxl/verify-gap-completion.ts
node benchmark/jpegxl/verify-gap-color.ts
bun benchmark/jpegxl/generate-vardct-floating-alpha.ts
node benchmark/jpegxl/run-gap-resources.ts
node benchmark/jpegxl/run-float-completion.ts benchmark/jpegxl/gap-completion/resources.json
node benchmark/jpegxl/verify-float-encoding.ts benchmark/jpegxl/gap-completion/encoding.json
node benchmark/jpegxl/production-program/run-conformance.ts --corpus-root .tmp/jpegxl-conformance --output benchmark/jpegxl/gap-completion/conformance.json
npm run browser:test -- browser-tests/jpegxl-gap-completion.pw.ts browser-tests/jpegxl-float-completion.pw.ts --workers=2
npm run check
node benchmark/jpegxl/write-gap-receipt.ts --checked
```

The receipt records current source and report hashes. If the sandbox cannot
start Git from Node, pass `--revision` with the verified 40-character HEAD hash;
it must match the conformance report.

`samples.json` records 24 libjxl-decoded sample layouts, with a normalized float
tolerance of 0.00000012. `color.json` records 17 further libjxl/LittleCMS checks:
custom floating fields, legacy RGB LUT XYZ profiles, wider/floating CMYK with
floating black, HLG/PQ/custom-primary associated forward writing, Float32
animation writing, selected HDR VarDCT frames and lossy Modular Float32 output.
The twelve pinned VarDCT floating-color/alpha inputs and references live under
`tests/fixtures/jpegxl/gap-alpha`. Linear color agrees within 1/255 in Node and
three browsers. Static alpha is exact. Two linear HDR reference blends allow
0.00000012 alpha error because libjxl rounds intermediate alpha to Float32.
HDR frames compose in linear color before applying the output transfer curve.

`resources.json` records 62 isolated workflows from the earlier float/CMYK
fixtures. `native-resources.json` adds an independently decoded 4100×1025 gray
Float32 image and a 5×3 crop crossing horizontal and vertical group boundaries.
Full native extraction and cropped group bands produce the same output hash.
The recorded cold crop reduces absolute peak RSS from about 185 MiB to 156 MiB;
warm peak RSS reduces from about 220 MiB to 166 MiB. Those are single isolated
measurements, not a general performance guarantee. HLG/PQ forward rows record
timing, output size, memory and deterministic hashes without a speed comparison.
Linear reference blend rows also record cold and warm decode measurements.
Warm rows follow two workflows and two GC calls; absolute peaks include warmup.
Source pixel throughput for crop rows counts the complete source geometry and
does not describe the amount of decoded work.

Default Float32 writing remains bit exact. Explicit float lossy mode rounds
Modular color mantissas and retains exact alpha and binary32 storage. It does
not emit float VarDCT or progressive passes. No perceptual quality equivalence
is claimed for that mode.

Independent native groups can use cropped bands. Global transforms, shifted
extras, dependent groups and composed frames retain explicit native-plane or
canvas/reference storage. Other ICC/CMYK transform families, nonrelative custom
color, wider integer VarDCT display, progressive floating-alpha stages,
progressive animation writing and transformed implicit-palette prefix layouts
remain unsupported or unqualified. The older `float-completion` receipt records
its earlier source hashes and measurements; this directory records the expanded
implementation separately.
