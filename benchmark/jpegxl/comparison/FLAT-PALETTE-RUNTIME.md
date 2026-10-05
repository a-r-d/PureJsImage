# JPEG XL private palette browser and memory checks, October 3, 2026

The private flat-color palette candidate passes the tested real Chromium path
and one natural optional memory fallback. The production encoder is unchanged.
Compression parity is still incomplete, with thirteen adequately matched
comparisons and eleven unresolved comparisons.

Chromium 151.0.7922.34 encodes the complete original 1024 by 1024 graphic through
the public encoder API in a browser-platform build. Distances two and eight
produce the same complete files as the separately audited Node controls:

| Distance | Bytes | SSIMULACRA2 | Butteraugli | Managed peak bytes |
| --- | ---: | ---: | ---: | ---: |
| 2 | 24,507 | 91.584 | 1.484 | 60,639,269 |
| 8 | 14,617 | 84.390 | 4.820 | 60,397,163 |

Four fresh native and Rust decoder grids check 16,777,216 samples against the
qualified expected pixels. Every original alpha sample remains exact. Original
input remains unchanged, and managed live bytes and allocations close at zero.
The emitted browser module has no external imports, Node built-ins, runtime
dependencies or WASM. Its four network requests stay on the local test server.
These results cover the two complete graphic requests in Chromium. They do not
establish a complete browser matrix or a comparative speed or RSS result.

The memory probe uses generated opaque palettes at four sizes and five fixed
public working limits. Forty outcomes compare observation-only copies with the
actual uninstrumented public candidate. Every output byte and structured error
matches. The counters observe existing branches and change no allocation,
working limit, pixel, coding choice or fallback. No failure is injected.

On the 128 by 128 input, a 1,500,000-byte working limit admits quantization but
the optional Modular writer requests 1,719,807 live backing bytes. Its existing
limit catch returns the primary lossy stream. The public encoder produces
10,986 bytes with a managed peak of 979,138 bytes and closes every allocation.
The original retained encoder produces exactly the same fallback file under
that limit. At 750,000 bytes, both reject the mandatory path with the same
`LIMIT_EXCEEDED` message and empty output. A larger limit admits the 771-byte
quantized file.

Four more complete native and Rust grids check 262,144 finite samples and exact
original alpha. The decoders agree within one 8-bit sample. This includes
131,072 samples checked exactly against independently derived quantized pixels
for the admitted file. The fallback is lossy: its largest original color error
is ten samples. Its diagnostic SSIMULACRA2 is 92.356 and Butteraugli is 0.620.
The admitted quantized file has scores 85.339 and 1.101. These generated input
scores are not new points on the public comparison curves.

This proves one naturally reached optional fallback after real quantization and
allocation rejection. It supplies no general working-memory guarantee. The
earlier [palette controls](FLAT-PALETTE.md) remain the source for the private
policy, independent quality curve and unchanged package limits. Representative
paired costs, the broader input matrix, target matching and source adoption
remain open. A separate fifteen-pair cost measurement is prepared for the
unchanged lossless photo path; it will not qualify changed graphics costs.

[Runtime evidence](results/flat-palette-runtime-gates.json) keeps the original
qualification, failed harness attempts, Chromium files and natural memory
boundary in separate scopes. Raw copies and artifacts stay in the ignored
comparison workspace.
