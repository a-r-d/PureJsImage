export type BundleCodec =
  | 'AVIF'
  | 'BMP'
  | 'GIF'
  | 'HDR'
  | 'HEIF / HEIC'
  | 'ICO'
  | 'JPEG'
  | 'JPEG 2000'
  | 'PNG'
  | 'Netpbm'
  | 'TIFF'
  | 'QOI'
  | 'WebP'
  | 'TGA'

export interface BundleTarget {
  /** Recorded minified byte count when this gate was introduced. */
  readonly baselineMinifiedBytes?: number
  readonly contents: string
  readonly id: string
  readonly name: string
  /** Fails the size gate when the minified entry exceeds this byte count. */
  readonly maxMinifiedBytes?: number
}

export interface CompetitorBundleTarget extends BundleTarget {
  readonly codecs: readonly BundleCodec[]
  readonly implementation: 'native-wrapper' | 'pure-javascript' | 'webassembly'
  readonly packageName: '@jsquash/jpeg' | 'image-js' | 'jimp' | 'purejsimage' | 'sharp'
  readonly packageNames?: readonly string[]
}

const exportsFrom = (entries: readonly string[]): string =>
  entries.map((entry) => `export * from '${entry}'`).join('\n')

export const commonCompetitorCodecs = ['JPEG', 'PNG'] as const satisfies readonly BundleCodec[]

export const pureJsImageEntryTargets: readonly BundleTarget[] = [
  {
    id: 'core',
    name: 'Core API',
    contents: exportsFrom(['./src/index.ts']),
    maxMinifiedBytes: 60 * 1024,
  },
  {
    id: 'scientific',
    name: 'Core + scientific platform',
    contents: exportsFrom(['./src/index.ts', './src/scientific/index.ts']),
    baselineMinifiedBytes: 143_546,
    maxMinifiedBytes: 187_000,
  },
  {
    id: 'scientific-reader-gsf',
    name: 'Scientific reader: GSF',
    contents: exportsFrom(['./src/scientific/readers/gsf.ts']),
    baselineMinifiedBytes: 37_864,
    maxMinifiedBytes: 50_000,
  },
  {
    id: 'scientific-reader-envi',
    name: 'Scientific reader: ENVI',
    contents: exportsFrom(['./src/scientific/readers/envi.ts']),
    baselineMinifiedBytes: 56_958,
    maxMinifiedBytes: 75_000,
  },
  {
    id: 'scientific-reader-fits',
    name: 'Scientific reader: FITS',
    contents: exportsFrom(['./src/scientific/readers/fits.ts']),
    baselineMinifiedBytes: 44_278,
    maxMinifiedBytes: 60_000,
  },
  {
    id: 'scientific-reader-mrc',
    name: 'Scientific reader: MRC',
    contents: exportsFrom(['./src/scientific/readers/mrc.ts']),
    baselineMinifiedBytes: 38_787,
    maxMinifiedBytes: 51_000,
  },
  {
    id: 'scientific-reader-cbf',
    name: 'Scientific reader: CBF',
    contents: exportsFrom(['./src/scientific/readers/cbf.ts']),
    baselineMinifiedBytes: 41_686,
    maxMinifiedBytes: 55_000,
  },
  {
    id: 'scientific-reader-digital-micrograph',
    name: 'Scientific reader: DigitalMicrograph',
    contents: exportsFrom(['./src/scientific/readers/digital-micrograph.ts']),
    maxMinifiedBytes: 100_000,
  },
  {
    id: 'scientific-reader-tia-ser',
    name: 'Scientific reader: TIA SER',
    contents: exportsFrom(['./src/scientific/readers/tia-ser.ts']),
    maxMinifiedBytes: 100_000,
  },
  {
    id: 'scientific-reader-tia-emi',
    name: 'Scientific reader: TIA EMI',
    contents: exportsFrom(['./src/scientific/readers/tia-emi.ts']),
    maxMinifiedBytes: 150_000,
  },
  {
    id: 'scientific-reader-ncem-emd',
    name: 'Scientific reader: NCEM EMD',
    contents: exportsFrom(['./src/scientific/readers/ncem-emd.ts']),
    maxMinifiedBytes: 180_000,
  },
  {
    id: 'scientific-reader-velox-emd',
    name: 'Scientific reader: Velox EMD',
    contents: exportsFrom(['./src/scientific/readers/velox-emd.ts']),
    maxMinifiedBytes: 180_000,
  },
  {
    id: 'scientific-reader-tiff',
    name: 'Scientific reader: TIFF',
    contents: exportsFrom(['./src/scientific/readers/tiff.ts']),
    baselineMinifiedBytes: 262_942,
    maxMinifiedBytes: 341_825,
  },
  {
    id: 'scientific-reader-ome-tiff',
    name: 'Scientific reader: OME-TIFF',
    contents: exportsFrom(['./src/scientific/readers/ome-tiff.ts']),
    baselineMinifiedBytes: 267_489,
    maxMinifiedBytes: 350_000,
  },
  {
    id: 'scientific-reader-aperio-svs',
    name: 'Scientific reader: Aperio SVS',
    contents: exportsFrom(['./src/scientific/readers/aperio-svs.ts']),
    baselineMinifiedBytes: 259_477,
    maxMinifiedBytes: 338_000,
  },
  {
    id: 'scientific-reader-png',
    name: 'Scientific reader: PNG',
    contents: exportsFrom(['./src/scientific/readers/png.ts']),
    baselineMinifiedBytes: 67_385,
    maxMinifiedBytes: 87_601,
  },
  {
    id: 'scientific-reader-jpeg',
    name: 'Scientific reader: JPEG',
    contents: exportsFrom(['./src/scientific/readers/jpeg.ts']),
    baselineMinifiedBytes: 104_815,
    maxMinifiedBytes: 136_260,
  },
  {
    id: 'scientific-reader-webp',
    name: 'Scientific reader: WebP',
    contents: exportsFrom(['./src/scientific/readers/webp.ts']),
    baselineMinifiedBytes: 106_317,
    maxMinifiedBytes: 138_213,
  },
  {
    id: 'scientific-reader-bmp',
    name: 'Scientific reader: BMP',
    contents: exportsFrom(['./src/scientific/readers/bmp.ts']),
    baselineMinifiedBytes: 44_120,
    maxMinifiedBytes: 57_356,
  },
  {
    id: 'scientific-reader-jp2',
    name: 'Scientific reader: JP2',
    contents: exportsFrom(['./src/scientific/readers/jp2.ts']),
    baselineMinifiedBytes: 93_696,
    maxMinifiedBytes: 121_805,
  },
  {
    id: 'scientific-readers-all',
    name: 'Scientific readers: all',
    contents: exportsFrom(['./src/scientific/readers/all.ts']),
    baselineMinifiedBytes: 576_306,
    maxMinifiedBytes: 749_198,
  },
  {
    id: 'operations',
    name: 'Operation descriptors and runtime',
    contents: exportsFrom(['./src/operations/index.ts']),
    baselineMinifiedBytes: 44_252,
    maxMinifiedBytes: 58_000,
  },
  {
    id: 'analysis',
    name: 'Analysis application API',
    contents: exportsFrom(['./src/analysis/index.ts']),
    baselineMinifiedBytes: 270_789,
    maxMinifiedBytes: 353_000,
  },
  {
    id: 'analysis-results',
    name: 'Analysis result schemas',
    contents: exportsFrom(['./src/analysis/results.ts']),
    baselineMinifiedBytes: 55_713,
    maxMinifiedBytes: 72_427,
  },
  {
    id: 'analysis-roi',
    name: 'Analysis ROI utilities',
    contents: exportsFrom(['./src/analysis/roi-entry.ts']),
    baselineMinifiedBytes: 32_622,
    maxMinifiedBytes: 42_409,
  },
  {
    id: 'analysis-runtime',
    name: 'Analysis tile runtime',
    contents: exportsFrom(['./src/analysis/runtime.ts']),
    baselineMinifiedBytes: 57_784,
    maxMinifiedBytes: 75_120,
  },
  {
    id: 'analysis-project',
    name: 'Analysis project and migrations',
    contents: exportsFrom(['./src/analysis/project-entry.ts']),
    baselineMinifiedBytes: 51_214,
    maxMinifiedBytes: 66_578,
  },
  {
    id: 'extensions',
    name: 'Trusted extension host',
    contents: exportsFrom(['./src/extensions/index.ts']),
    baselineMinifiedBytes: 46_564,
    maxMinifiedBytes: 61_000,
  },
  {
    id: 'png',
    name: 'Core + PNG',
    contents: exportsFrom(['./src/index.ts', './src/codec-entries/png.ts']),
  },
  {
    id: 'jpeg',
    name: 'Core + JPEG',
    contents: exportsFrom(['./src/index.ts', './src/codec-entries/jpeg.ts']),
  },
  {
    id: 'jpeg2000',
    name: 'Core + JPEG 2000',
    contents: exportsFrom(['./src/index.ts', './src/codec-entries/jpeg2000.ts']),
  },
  {
    id: 'jpegxl',
    name: 'Core + JPEG XL limited decoder',
    contents: exportsFrom(['./src/index.ts', './src/codec-entries/jpegxl.ts']),
  },
  {
    id: 'webp',
    name: 'Core + WebP',
    contents: exportsFrom(['./src/index.ts', './src/codec-entries/webp.ts']),
  },
  {
    id: 'hdr',
    name: 'Core + HDR',
    contents: exportsFrom(['./src/index.ts', './src/codec-entries/hdr.ts']),
  },
  {
    id: 'qoi',
    name: 'Core + QOI',
    contents: exportsFrom(['./src/index.ts', './src/codec-entries/qoi.ts']),
  },
  {
    id: 'netpbm',
    name: 'Core + Netpbm',
    contents: exportsFrom(['./src/index.ts', './src/codec-entries/netpbm.ts']),
  },
  {
    id: 'tga',
    name: 'Core + TGA',
    contents: exportsFrom(['./src/index.ts', './src/codec-entries/tga.ts']),
  },
  {
    id: 'gif',
    name: 'Core + GIF',
    contents: exportsFrom(['./src/index.ts', './src/codec-entries/gif.ts']),
  },
  {
    id: 'bmp',
    name: 'Core + BMP',
    contents: exportsFrom(['./src/index.ts', './src/codec-entries/bmp.ts']),
  },
  {
    id: 'ico',
    name: 'Core + ICO',
    contents: exportsFrom(['./src/index.ts', './src/codec-entries/ico.ts']),
  },
  {
    id: 'tiff',
    name: 'Core + TIFF',
    contents: exportsFrom(['./src/index.ts', './src/codec-entries/tiff.ts']),
  },
  {
    id: 'avif',
    name: 'Core + AVIF',
    contents: exportsFrom(['./src/index.ts', './src/codec-entries/avif.ts']),
  },
  {
    id: 'experimental-heic',
    name: 'Core + experimental HEIF / HEIC',
    contents: exportsFrom(['./src/index.ts', './src/codec-entries/experimental/heic.ts']),
  },
  {
    id: 'all',
    name: 'Core + all codecs',
    contents: exportsFrom(['./src/index.ts', './src/codec-entries/all.ts']),
  },
]

export const competitorBundleTargets: readonly CompetitorBundleTarget[] = [
  {
    id: 'purejsimage-matched',
    name: 'PureJsImage (matched)',
    packageName: 'purejsimage',
    implementation: 'pure-javascript',
    codecs: commonCompetitorCodecs,
    contents: exportsFrom([
      './src/index.ts',
      './src/codec-entries/jpeg.ts',
      './src/codec-entries/png.ts',
    ]),
  },
  {
    id: 'purejsimage-all',
    name: 'PureJsImage (all codecs)',
    packageName: 'purejsimage',
    implementation: 'pure-javascript',
    codecs: [
      'JPEG',
      'PNG',
      'WebP',
      'BMP',
      'TIFF',
      'GIF',
      'ICO',
      'JPEG 2000',
      'AVIF',
      'HDR',
      'QOI',
      'Netpbm',
      'TGA',
    ],
    contents: exportsFrom(['./src/index.ts', './src/codec-entries/all.ts']),
  },
  {
    id: 'jimp',
    name: 'Jimp',
    packageName: 'jimp',
    implementation: 'pure-javascript',
    codecs: ['JPEG', 'PNG', 'TIFF', 'BMP', 'GIF'],
    contents: "export * from 'jimp'",
  },
  {
    id: 'image-js',
    name: 'image-js',
    packageName: 'image-js',
    implementation: 'pure-javascript',
    codecs: ['JPEG', 'PNG', 'TIFF', 'BMP'],
    contents: "export * from 'image-js'",
  },
  {
    id: 'jsquash',
    name: 'jSquash',
    packageName: '@jsquash/jpeg',
    packageNames: ['@jsquash/jpeg', '@jsquash/png', '@jsquash/resize'],
    implementation: 'webassembly',
    codecs: commonCompetitorCodecs,
    contents: [
      "export { decode as decodeJpeg, encode as encodeJpeg } from '@jsquash/jpeg'",
      "export { decode as decodePng, encode as encodePng } from '@jsquash/png'",
      "export { default as resize } from '@jsquash/resize'",
    ].join('\n'),
  },
  {
    id: 'sharp',
    name: 'Sharp JS wrapper',
    packageName: 'sharp',
    implementation: 'native-wrapper',
    codecs: ['JPEG', 'PNG', 'TIFF', 'WebP', 'GIF', 'AVIF'],
    contents: "export { default } from 'sharp'",
  },
]
