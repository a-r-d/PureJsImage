# JPEG XL larger-transform development patches

These are the original Prompt 14 source diffs, retained as design and regression evidence. They are not applied by the package build. The DCT16 backend has been reconstructed and tested on the `codex/jpegxl-transform-backend` development branch. The DCT64 patches are unselected prototypes; neither is a production encoder policy.

| Patch | SHA-256 | Purpose |
| --- | --- | --- |
| `prompt14-dct16-prototype.patch` | `c544ae5cf8d32f50acc8df0980e7deb6959fc3ed4f77afafe6bf9cd07ab6f1f9` | Original DCT16 geometry, DC, AC and quantization prototype |
| `prompt14-dct64-prototype.patch` | `066fed53ea08b63efa7a193414385bc3ed017d2978b67f96dc165a5724dd09bb` | Original broad DCT64 prototype |
| `prompt14-dct64-edge25-prototype.patch` | `ac4f2ad251e2e875d3366ea05c1aa2a4f4e3e7b20b07035ee6364df409272a6f` | Original edge-threshold DCT64 prototype |

The original measurements and rejection reasons are in [Prompt 14](../production-program/m7-prompt14-transform-probes.md). Treat these patches as historical experiments, not ready-to-apply changes to current mainline.
