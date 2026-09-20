# Embedded preview fixture

`benchmark/jpegxl/generate-m6-preview.ts` combines independently encoded libjxl
frames with a first-party image header. The embedded image is 333 by 77 pixels;
the main image is 43 by 35 pixels and contains an internal DC dependency.
The differing dimensions expose accidental preview/main-frame confusion.

`benchmark/jpegxl/flush-progressive-oracle.ts` calls the pinned libjxl 0.12.0
public C decoder API to produce the embedded image and each main-image stage.
The oracle manifest records input, library and output hashes. It preserves
encoded coordinates. The native binary is a development oracle only.

The analytical preview pattern and assembly script are MIT licensed. The main
pattern retains the CC0 attribution in the generated VarDCT corpus manifest.
No third-party implementation is included in the production package.
