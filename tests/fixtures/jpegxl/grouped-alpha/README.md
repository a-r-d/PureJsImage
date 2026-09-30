# Grouped JPEG XL alpha references

These fixtures exercise alpha streams whose transformed native planes require AC
group payloads. The libjxl inputs use first-party PAM rasters at 513x259 or
1025x259. A separate first-party forward stream has no global Squeeze transform.
The existing 300x270 PQ fixture is reused without copying its encoded bytes.

`manifest.json` records encoded and reference hashes, source input hashes,
encoding options, and the encoder used for each file. References come from the
unmodified libjxl 0.12.0 C API library with revision and library hash pinned by
`benchmark/jpegxl/flush-progressive-oracle.ts`. Integer samples and float32
samples use big endian storage. Associated alpha stays associated.

Linear float references request linear sRGB. The PQ reference normalizes color
to 10000 nits; its recorded `referenceColorScale` converts color to the public
203-nit linear sample convention. Alpha is never scaled by that factor.

Tests compare final color with the independent reference, require independent
alpha agreement at every emitted DC/pass/final stage, and compare selected
stages with complete stages across group boundaries and partial edge groups.
These files do not claim independent DC color references. Global Squeeze needs
complete alpha dependencies even when color groups are selected.

Regenerate with the pinned oracle tools already prepared:

```sh
node benchmark/jpegxl/generate-grouped-alpha-fixtures.ts
node benchmark/jpegxl/run-grouped-alpha.ts
```

The resource check uses isolated cold and warm processes, validates output,
records absolute peak RSS, external/ArrayBuffer storage, section reads and
managed bytes, and runs GC after warmup before measuring its baseline.
