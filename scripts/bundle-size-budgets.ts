export interface BundleSizeBudget {
  /** Recorded minified byte count when this gate was introduced. */
  readonly baselineMinifiedBytes?: number
  /** Fails the size gate when the minified entry exceeds this byte count. */
  readonly maxMinifiedBytes?: number
}

/**
 * Size budgets are keyed by stable target IDs only. The target inventory itself
 * is built from capabilities/manifest.json and package.json exports.
 */
export const bundleSizeBudgets: Readonly<Record<string, BundleSizeBudget>> = {
  core: { maxMinifiedBytes: 64 * 1024 },
  // 2026-11-24: raised from 73 KiB to 74 KiB, owner approved, for the opaque RGBA resize path
  // that filters RGB only when the decoder reports every pixel is opaque.
  // 2026-11-24: raised from 74 KiB to 76 KiB, owner approved. A single-file bundle inlines the
  // parallel PNG deflate encoder that Node loads only when `threads` is above 1.
  // 2026-11-25: raised from 76 KiB to 78 KiB, owner approved, for the transparent-span and
  // row-reuse paths in the RGBA resize, with headroom for the next small core change.
  // 2026-11-25: raised from 78 KiB to 80 KiB, owner approved, for the bounded-window rotation
  // sampler and the four-tap RGBA resize path.
  // 2026-11-26: raised from 80 KiB to 84 KiB, owner approved, for the animated GIF pipeline path
  // in the executor and the GIF and ICO encode operations.
  'core-execution': { maxMinifiedBytes: 84 * 1024 },
  hdr: { baselineMinifiedBytes: 580_322, maxMinifiedBytes: 680_000 },
  // Owner approved campaign ceiling increases on 2026-10-10. Report sizes; they are not promotion gates.
  // 2026-11-20: raised to fit the libjxl-derived effort-7 encoder (about 25.5 KB), owner approved.
  // 2026-11-22: raised by 3,000 bytes for untagged, kept-ICC, float and oriented encoder input
  // and the ICC profile recognizer that lossy keepIcc() output uses.
  // 2026-11-23: raised by 2,000 bytes so lossless keepIcc() output writes the profile in the
  // Modular image header instead of the native writer's unpredicted samples, and for Lab gray
  // ICC curves and the real-primaries check on structured ICC color.
  // 2026-11-23: raised by 2,000 bytes again for the lint cleanup that replaced non-null
  // assertions with `?? 0` sample reads and checked plane reads.
  // 2026-11-24: raised by 6,000 bytes, owner approved. The codec loads its VarDCT, sequence,
  // native-sample and encoder modules on first use, and a single-file bundle wraps each lazily
  // loaded module in an init function.
  // 2026-11-24: raised by 1,000 bytes, owner approved, for the same opaque RGBA resize path in
  // the core execution code this entry bundles.
  // 2026-11-24: raised by 3,000 bytes, owner approved, for the same inlined parallel PNG encoder.
  // 2026-11-25: raised to 660,000 bytes, owner approved, for the same RGBA resize paths.
  // 2026-11-25: raised to 662,000 bytes, owner approved, for the same rotation and resize paths.
  // 2026-11-26: raised to 667,000 bytes, owner approved, for the same animated GIF pipeline path.
  // 2026-11-26: raised to 668,000 bytes, owner approved, for the Node zlib PNG inflate path.
  'codec-jpegxl': { baselineMinifiedBytes: 233_093, maxMinifiedBytes: 668_000 },
  // The specialized entry includes the same effort-9 searches and the same encoder input handling.
  // 2026-11-23: raised by 1,000 bytes for the GRAY ICC profile on grayscale JPEG input in
  // lossless keepIcc() output and the effort-7 search conditions, owner approved.
  // 2026-11-24: raised by 7,000 bytes for the same lazy-load wrappers, owner approved.
  // 2026-11-24: raised by 2,000 bytes, owner approved. The entry bundles the JPEG decoder and
  // encoder for JPEG transcoding, which gained batched progressive AC scans, an 8-bit Huffman
  // prefix lookup, a 4:2:0 color fast path and a factored forward DCT.
  // 2026-11-26: raised from 730,000 to 731,000 bytes, owner approved. The JPEG decoder it bundles
  // now offers progressive input to a registered WASM accelerator and resumes rows in TypeScript.
  'jpegxl-specialized': { baselineMinifiedBytes: 255_489, maxMinifiedBytes: 731_000 },
  // 2026-11-24: raised by 3,000 bytes, owner approved, for the same inlined parallel PNG encoder.
  // 2026-11-25: raised to 210,000 bytes, owner approved, for the same RGBA resize paths.
  // 2026-11-26: raised to 212,000 bytes, owner approved, for the shared-read RGBA Lanczos resize.
  // 2026-11-26: raised to 216,000 bytes, owner approved, for the same animated GIF pipeline path.
  // 2026-11-26: raised to 217,000 bytes, owner approved, for the Node zlib PNG inflate path.
  scientific: { baselineMinifiedBytes: 143_546, maxMinifiedBytes: 217_000 },
  geo: { baselineMinifiedBytes: 138_715, maxMinifiedBytes: 181_000 },
  'geo-readers-all': { baselineMinifiedBytes: 626_956, maxMinifiedBytes: 816_000 },
  'scientific-reader-gsf': { baselineMinifiedBytes: 37_864, maxMinifiedBytes: 50_000 },
  'scientific-reader-envi': { baselineMinifiedBytes: 56_958, maxMinifiedBytes: 75_000 },
  'scientific-reader-fits': { baselineMinifiedBytes: 44_278, maxMinifiedBytes: 60_000 },
  'scientific-reader-mrc': { baselineMinifiedBytes: 38_787, maxMinifiedBytes: 51_000 },
  'scientific-reader-cbf': { baselineMinifiedBytes: 41_686, maxMinifiedBytes: 55_000 },
  'scientific-reader-digital-micrograph': { maxMinifiedBytes: 100_000 },
  'scientific-reader-nanonis-sxm': { maxMinifiedBytes: 100_000 },
  'scientific-reader-igor-binary-wave': { maxMinifiedBytes: 110_000 },
  'scientific-reader-digital-surf': { maxMinifiedBytes: 110_000 },
  'scientific-reader-x3p': { maxMinifiedBytes: 120_000 },
  'scientific-reader-tia-ser': { maxMinifiedBytes: 100_000 },
  'scientific-reader-tia-emi': { maxMinifiedBytes: 150_000 },
  'scientific-reader-ncem-emd': { maxMinifiedBytes: 185_000 },
  'scientific-reader-velox-emd': { maxMinifiedBytes: 180_000 },
  'scientific-reader-tiff': { baselineMinifiedBytes: 262_942, maxMinifiedBytes: 341_825 },
  'scientific-reader-ome-tiff': { baselineMinifiedBytes: 267_489, maxMinifiedBytes: 350_000 },
  'scientific-reader-ome-zarr': { maxMinifiedBytes: 220_000 },
  'scientific-reader-aperio-svs': { baselineMinifiedBytes: 259_477, maxMinifiedBytes: 338_000 },
  // 2026-11-26: raised from 87,601 to 91,000 bytes, owner approved. The reader bundles the PNG
  // codec, whose encoder now also builds an indexed file for output with 256 or fewer colors.
  // 2026-11-26: raised from 91,000 to 92,000 bytes, owner approved, for the PNG CRC that switches
  // to an eight-byte table after 256 KiB.
  'scientific-reader-png': { baselineMinifiedBytes: 67_385, maxMinifiedBytes: 92_000 },
  'scientific-reader-jpeg': { baselineMinifiedBytes: 104_815, maxMinifiedBytes: 136_260 },
  // 2026-11-26: raised from 138,213 to 145,000 bytes, owner approved, for VP8 intra mode
  // selection in the lossy encoder and bilinear chroma upsampling in the decoder.
  'scientific-reader-webp': { baselineMinifiedBytes: 106_317, maxMinifiedBytes: 145_000 },
  'scientific-reader-bmp': { baselineMinifiedBytes: 44_120, maxMinifiedBytes: 57_356 },
  'scientific-reader-jp2': { baselineMinifiedBytes: 93_696, maxMinifiedBytes: 121_805 },
  'scientific-reader-rpl': { baselineMinifiedBytes: 41_135, maxMinifiedBytes: 53_500 },
  'scientific-reader-emsa': { baselineMinifiedBytes: 39_050, maxMinifiedBytes: 50_800 },
  'scientific-reader-nrrd': { baselineMinifiedBytes: 43_686, maxMinifiedBytes: 56_800 },
  'scientific-reader-meta-image': { baselineMinifiedBytes: 40_913, maxMinifiedBytes: 53_200 },
  'scientific-reader-dicom': { maxMinifiedBytes: 500_000 },
  'scientific-reader-nifti': { baselineMinifiedBytes: 42_422, maxMinifiedBytes: 55_200 },
  'scientific-reader-npy': { baselineMinifiedBytes: 38_965, maxMinifiedBytes: 50_700 },
  'scientific-reader-blockfile': { baselineMinifiedBytes: 39_615, maxMinifiedBytes: 51_500 },
  'scientific-reader-mib': { baselineMinifiedBytes: 32_612, maxMinifiedBytes: 42_400 },
  'scientific-reader-ebsd-text': { baselineMinifiedBytes: 41_681, maxMinifiedBytes: 54_200 },
  'scientific-readers-all': { baselineMinifiedBytes: 844_813, maxMinifiedBytes: 1_350_000 },
  operations: { baselineMinifiedBytes: 44_252, maxMinifiedBytes: 58_000 },
  analysis: { baselineMinifiedBytes: 270_789, maxMinifiedBytes: 353_000 },
  'analysis-results': { baselineMinifiedBytes: 55_713, maxMinifiedBytes: 72_427 },
  'analysis-roi': { baselineMinifiedBytes: 32_622, maxMinifiedBytes: 42_409 },
  'analysis-runtime': { baselineMinifiedBytes: 57_784, maxMinifiedBytes: 75_120 },
  'analysis-project': { baselineMinifiedBytes: 51_214, maxMinifiedBytes: 66_578 },
  extensions: { baselineMinifiedBytes: 46_564, maxMinifiedBytes: 61_000 },
}
