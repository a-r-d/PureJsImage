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
  core: { maxMinifiedBytes: 60 * 1024 },
  scientific: { baselineMinifiedBytes: 143_546, maxMinifiedBytes: 187_000 },
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
  'scientific-reader-png': { baselineMinifiedBytes: 67_385, maxMinifiedBytes: 87_601 },
  'scientific-reader-jpeg': { baselineMinifiedBytes: 104_815, maxMinifiedBytes: 136_260 },
  'scientific-reader-webp': { baselineMinifiedBytes: 106_317, maxMinifiedBytes: 138_213 },
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
