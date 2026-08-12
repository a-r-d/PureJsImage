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
    name: 'Core + scientific rasters',
    contents: exportsFrom(['./src/index.ts', './src/scientific/index.ts']),
  },
  {
    id: 'operations',
    name: 'Operation descriptors and runtime',
    contents: exportsFrom(['./src/operations/index.ts']),
  },
  {
    id: 'analysis',
    name: 'Quantitative analysis results',
    contents: exportsFrom(['./src/analysis/index.ts']),
  },
  {
    id: 'extensions',
    name: 'Trusted extension host',
    contents: exportsFrom(['./src/extensions/index.ts']),
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
