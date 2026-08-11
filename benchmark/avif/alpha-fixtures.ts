import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export interface AvifAlphaFixture {
  readonly decodedRgbaSha256: string
  readonly file: string
  readonly fileSha256: string
  readonly height: number
  readonly premultiplied: boolean
  readonly width: number
}

export interface AvifStagedAlphaFixture {
  readonly colorPhaseWorkingBytes: number
  readonly decodedRgbaSha256: string
  readonly file: string
  readonly fileSha256: string
  readonly height: number
  readonly maximumOracleDifferences: readonly [number, number, number, number]
  readonly oracle: 'libavif' | 'sharp'
  readonly oracleRgbaSha256: string
  readonly retainedAlphaBytes: number
  readonly width: number
}

export interface AvifGainMapFixture {
  readonly baseGrid: boolean
  readonly decodedRgbaSha256: string
  readonly file: string
  readonly fileSha256: string
  readonly gainMapGrid: boolean
  readonly hasAlpha: boolean
  readonly height: number
  readonly maximumMeanOracleDifferences: readonly [number, number, number, number]
  readonly maximumOracleDifferences: readonly [number, number, number, number]
  readonly minimumRgbPsnr: number
  readonly oracleRgbaSha256: string
  readonly width: number
}

export const avifAlphaFixtureDirectory = join(
  dirname(dirname(fileURLToPath(import.meta.url))),
  'corpus',
  'files',
  'avif',
)

export const avifAlphaFixtures: readonly AvifAlphaFixture[] = [
  {
    file: 'alpha-straight-64x48.avif',
    width: 64,
    height: 48,
    premultiplied: false,
    fileSha256: '20c63d6e79b048bf5204f50ce56f1d81aa493b679689863a76e667732ec6d3cc',
    decodedRgbaSha256: '54633c27b86e4034c8c1916134b5bfdd3209e43344bdfbaaaa53abde94b33d02',
  },
  {
    file: 'alpha-premultiplied-64x48.avif',
    width: 64,
    height: 48,
    premultiplied: true,
    fileSha256: '260570c663c51b255b407496c3a6b2a675779ae71fa3fcd69d4d7b9a77c240c4',
    decodedRgbaSha256: '797e6c9b789c30cdedb63c7f92adc127378f21cfae36809b7eb3499456ab3457',
  },
]

export const avifStagedAlphaFixtures: readonly AvifStagedAlphaFixture[] = [
  {
    file: 'linku-plum-10bpc-alpha-full.avif',
    width: 2048,
    height: 2048,
    fileSha256: '0a615cfb673ab45e37da3582c17dd36f86d5da3d81246a32951d1db4ed90149d',
    decodedRgbaSha256: 'e9ea241d0f0b623f4813a15ada72323dd2483ee19f8246fba66b842f596ab940',
    retainedAlphaBytes: 8_388_608,
    colorPhaseWorkingBytes: 58_443_355,
    oracle: 'sharp',
    oracleRgbaSha256: 'e8c50a8178468e1af983881260bd1864309dbfd5f3385f84574813a3b5a70d5f',
    maximumOracleDifferences: [1, 1, 1, 0],
  },
  {
    file: 'ms-bbb-alpha-inverted.avif',
    width: 3840,
    height: 2160,
    fileSha256: '83d68084a93f043a89d10373f0ca26dafc988eec811b8076cabb2ff1580c1817',
    decodedRgbaSha256: 'b341b84d50447573b3ae0e70a8b259beb408c489d95b89b9f7c8afaa170cf0b4',
    retainedAlphaBytes: 8_294_400,
    colorPhaseWorkingBytes: 59_341_022,
    oracle: 'libavif',
    oracleRgbaSha256: '814c74f2dc4beadff496ac4d652ef1fb44850c8615c2435c432d67e335cc31a7',
    maximumOracleDifferences: [2, 1, 9, 0],
  },
]

export const avifGainMapFixtures: readonly AvifGainMapFixture[] = [
  {
    file: 'libavif_color_grid_alpha_grid_gainmap_nogrid.avif',
    width: 512,
    height: 600,
    hasAlpha: true,
    baseGrid: true,
    gainMapGrid: false,
    fileSha256: 'c424c43fe4bab3b8ef37b86c0bab3851b850b94e5d46b9fae979586dae45de0a',
    decodedRgbaSha256: 'ea8a15d99b5f28a7858b097b8b82056ce65898f51bb2ff0d2c5715bdcfeff2fd',
    oracleRgbaSha256: '0415e2d96c0963aa6e97e57c703a381a1db22604fe765972d6dfb045f1ea1b26',
    maximumOracleDifferences: [20, 7, 21, 0],
    maximumMeanOracleDifferences: [0.7, 1.1, 0.75, 0],
    minimumRgbPsnr: 45,
  },
  {
    file: 'libavif_color_grid_gainmap_different_grid.avif',
    width: 512,
    height: 600,
    hasAlpha: true,
    baseGrid: true,
    gainMapGrid: true,
    fileSha256: '73a68c3d6daad7b8298db975a00f02bca46b6c3f292eac09d3c1443d2006fab2',
    decodedRgbaSha256: '4091bcc2b181c37e1b03bb6ec2b086b77516318b58cef4c75e8a8b5b0989f81e',
    oracleRgbaSha256: 'ec2e0866029609c3870f1776153fb1931b48001a6a9d21ceae3358a52e4c5c49',
    maximumOracleDifferences: [112, 22, 146, 0],
    maximumMeanOracleDifferences: [0.95, 1.35, 0.8, 0],
    minimumRgbPsnr: 39,
  },
  {
    file: 'libavif_color_nogrid_alpha_nogrid_gainmap_grid.avif',
    width: 128,
    height: 200,
    hasAlpha: true,
    baseGrid: false,
    gainMapGrid: true,
    fileSha256: 'd783e0d9ce778f972e88586b6b1b9eb062f54d38f28521721a8b9cbbda3b7fb0',
    decodedRgbaSha256: 'b6ab4171d2d9030704c753aff99765c47b0829f537b2e92138eb90e64f3e0441',
    oracleRgbaSha256: 'b51026a15235c016767b8a4d007acdd8e5c98334e925bb8344078f577a78e507',
    maximumOracleDifferences: [52, 9, 82, 0],
    maximumMeanOracleDifferences: [0.55, 1.1, 0.7, 0],
    minimumRgbPsnr: 44,
  },
  {
    file: 'libavif_seine_hdr_gainmap_small_srgb.avif',
    width: 400,
    height: 300,
    hasAlpha: false,
    baseGrid: false,
    gainMapGrid: false,
    fileSha256: '573a67fdd581f6e634da198a819cc92a071539dfb720c5d7dfdf02e4e87a0346',
    decodedRgbaSha256: 'a3a2ea2482c9d96b7b98b47dc1d874229a079d0860ccac0ed8ee77e19b3580b1',
    oracleRgbaSha256: '2b33cc5d8f56290138db21572d454a96a5f88817bd57c3da85099342c736a983',
    maximumOracleDifferences: [5, 5, 5, 0],
    maximumMeanOracleDifferences: [0.95, 0.9, 0.95, 0],
    minimumRgbPsnr: 46,
  },
]
