# Grouped progressive DC regression

`benchmark/jpegxl/generate-m6-grouped-dc.ts` generates an analytical 4097 by 513
RGB pattern and encodes it with the pinned libjxl 0.12.0 development encoder.
Its internal Modular DC frame has progressive group payloads. The pinned C API
oracle reconstructs complete DC, each pass and final output. The checked-in
small crops are selected from those independent stages, using the manifest's
full-resolution region and native denominator. Full oracle hashes remain in
the manifest. Patterns and generator are MIT licensed.
