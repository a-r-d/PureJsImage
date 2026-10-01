# Float ICC and HDR fixtures

These twelve inputs qualify ordinary binary16/binary32 gray and RGB ICC or
HDR conversion. They cover negative samples, highlight headroom, associated
alpha, mixed color/alpha depths and a crop across the 1024-pixel group boundary.

The manifest pins each encoded input, source samples, profile and converted
reference by SHA-256. Binary sample files are gzip-compressed, interleaved and
big-endian. `.source.bin.gz` contains libjxl Float32 samples in the source color
domain. `.bin.gz` contains LittleCMS sRGB16 or FFmpeg sRGB8 display samples.
HDR inputs also have `.linear.bin.gz` source-primary Float32 references.

Source decoding uses libjxl 0.12.0 at commit
`a7a9c787341cf703dede03c2009fa460cae5e5df` and the shared library hash in the
manifest. ICC conversion uses LittleCMS 2.17 with Float32 input and Float64
output before final 16-bit rounding. HDR references use FFmpeg 8.0.1 with
zimg, full-range source samples, 203 nit reference white and `agamma=0` for
exact HLG luminance OOTF. Tone mapping applies Reinhard in the source gamut
before conversion to sRGB. The manifest records the binary hashes and tolerances.

Regenerate on Linux x64 with Bun, the pinned libjxl library at
`.tmp/jpegxl-remediation-oracle/lib/libjxl.so.0.12.0`, LittleCMS 2.17 and the
pinned FFmpeg binary:

```sh
node benchmark/jpegxl/generate-float-completion-fixtures.ts
npx biome format --write tests/fixtures/jpegxl/float-completion/manifest.json
```

`tests/jpegxl-float-completion.test.ts` checks public conversion, crop, replay,
profile preservation and lossless re-encoding. The same workflows run in
Chromium, Firefox and WebKit. All native libraries are development oracles.
