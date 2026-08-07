import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export type AvifChroma = '400' | '420' | '422' | '444'

export interface AvifFixture {
  readonly id: string
  readonly path: string
  readonly file: string
  readonly url: string
  readonly sourcePage: string
  readonly expected: {
    readonly width: number
    readonly height: number
    readonly bitDepth: number
    readonly chromaSubsampling: AvifChroma
    readonly codecProfile: number
    readonly hasAlpha: boolean
    readonly sha256: string
  }
}

const revision = '25a6d23f872f37c91a3df15b75e1a97f590d7c46'
const root = 'https://raw.githubusercontent.com/AOMediaCodec/libavif'
const pageRoot = 'https://github.com/AOMediaCodec/libavif/blob'

const fixture = (path: string, expected: AvifFixture['expected']): AvifFixture => ({
  id: path.replaceAll('/', '-').replace(/\.avif$/, ''),
  path,
  file: path.split('/').at(-1) ?? path,
  url: `${root}/${revision}/${path}`,
  sourcePage: `${pageRoot}/${revision}/${path}`,
  expected,
})

export const avifCorpusRevision = revision
export const avifCorpusLicense = 'BSD-2-Clause'
export const avifCorpusDirectory = join(
  dirname(dirname(fileURLToPath(import.meta.url))),
  'corpus',
  'files',
  'avif',
)

export const avifFixtures: readonly AvifFixture[] = [
  fixture('android_jni/avifandroidjni/src/androidTest/assets/avif/blue-and-magenta-crop.avif', {
    width: 320,
    height: 280,
    bitDepth: 8,
    chromaSubsampling: '444',
    codecProfile: 1,
    hasAlpha: true,
    sha256: 'fa8fafe0aeddf18586a987ffb3ae26d3548b174ddcfd569c4ba16d4d804c8137',
  }),
  fixture('android_jni/avifandroidjni/src/androidTest/assets/avif/fox.profile0.10bpc.yuv420.avif', {
    width: 1204,
    height: 800,
    bitDepth: 10,
    chromaSubsampling: '420',
    codecProfile: 0,
    hasAlpha: false,
    sha256: '1564a6cd6fd3350d6b02604c74894bb51f8133ff40fddcb86e521c88130c69f1',
  }),
  fixture(
    'android_jni/avifandroidjni/src/androidTest/assets/avif/fox.profile0.10bpc.yuv420.monochrome.avif',
    {
      width: 1204,
      height: 800,
      bitDepth: 10,
      chromaSubsampling: '400',
      codecProfile: 0,
      hasAlpha: false,
      sha256: '0e3e88e60a82ac4e1fd9470f839a8b0108455d0adb993b796622490de2aca4f4',
    },
  ),
  fixture('android_jni/avifandroidjni/src/androidTest/assets/avif/fox.profile0.8bpc.yuv420.avif', {
    width: 1204,
    height: 800,
    bitDepth: 8,
    chromaSubsampling: '420',
    codecProfile: 0,
    hasAlpha: false,
    sha256: 'a0ae1ad1aea81291730f42259593b297a8444699f4553de8dc25da2db56a40d9',
  }),
  fixture(
    'android_jni/avifandroidjni/src/androidTest/assets/avif/fox.profile0.8bpc.yuv420.monochrome.avif',
    {
      width: 1204,
      height: 800,
      bitDepth: 8,
      chromaSubsampling: '400',
      codecProfile: 0,
      hasAlpha: false,
      sha256: '98d20d1c63820e47bf013b370044865277160f8edee9d07f41e4f5373a750e03',
    },
  ),
  fixture('android_jni/avifandroidjni/src/androidTest/assets/avif/fox.profile1.10bpc.yuv444.avif', {
    width: 1204,
    height: 800,
    bitDepth: 10,
    chromaSubsampling: '444',
    codecProfile: 1,
    hasAlpha: false,
    sha256: '8e3c6ddabe21cb0b3063e90b58b26bc98e0dfce9337b6d38b5191e390e85712f',
  }),
  fixture('android_jni/avifandroidjni/src/androidTest/assets/avif/fox.profile1.8bpc.yuv444.avif', {
    width: 1204,
    height: 800,
    bitDepth: 8,
    chromaSubsampling: '444',
    codecProfile: 1,
    hasAlpha: false,
    sha256: 'ae159dde38f074ba47f6484a74a3858322da4530f6cac4cb8de348985ff4f4d4',
  }),
  fixture('android_jni/avifandroidjni/src/androidTest/assets/avif/fox.profile2.10bpc.yuv422.avif', {
    width: 1204,
    height: 800,
    bitDepth: 10,
    chromaSubsampling: '444',
    codecProfile: 2,
    hasAlpha: false,
    sha256: '0b4590eb1e52a1c3e07d1614cfa8f95d8a4c1f9b36d4a71d2661bbc0df5eeb70',
  }),
  fixture('android_jni/avifandroidjni/src/androidTest/assets/avif/fox.profile2.12bpc.yuv420.avif', {
    width: 1204,
    height: 800,
    bitDepth: 12,
    chromaSubsampling: '420',
    codecProfile: 2,
    hasAlpha: false,
    sha256: 'ce734812bb76659dbaf7c8a96321e12a4281fb7829180cadb685c14b9310fe45',
  }),
  fixture(
    'android_jni/avifandroidjni/src/androidTest/assets/avif/fox.profile2.12bpc.yuv420.monochrome.avif',
    {
      width: 1204,
      height: 800,
      bitDepth: 12,
      chromaSubsampling: '400',
      codecProfile: 2,
      hasAlpha: false,
      sha256: 'e2062323ee85b9c248d188312353e86f3051ff51b534bbe8c56b65a47a9ec8d8',
    },
  ),
  fixture('android_jni/avifandroidjni/src/androidTest/assets/avif/fox.profile2.12bpc.yuv422.avif', {
    width: 1204,
    height: 800,
    bitDepth: 12,
    chromaSubsampling: '444',
    codecProfile: 2,
    hasAlpha: false,
    sha256: '571d282b5be186b125c3aa40c46dbb31c4c3206783fd3a88e7c646ae0b5f3b4c',
  }),
  fixture('android_jni/avifandroidjni/src/androidTest/assets/avif/fox.profile2.12bpc.yuv444.avif', {
    width: 1204,
    height: 800,
    bitDepth: 12,
    chromaSubsampling: '444',
    codecProfile: 2,
    hasAlpha: false,
    sha256: '0989319c58afc70d0448676cabb0631d3a457814358bb6ea73e1dfadab3c8aaf',
  }),
  fixture('android_jni/avifandroidjni/src/androidTest/assets/avif/fox.profile2.8bpc.yuv422.avif', {
    width: 1204,
    height: 800,
    bitDepth: 8,
    chromaSubsampling: '444',
    codecProfile: 2,
    hasAlpha: false,
    sha256: '8029f46ba2504617948e8f0598e43547089917d0b589379226c1f91c28875d6e',
  }),
  fixture('tests/data/abc_color_irot_alpha_irot.avif', {
    width: 512,
    height: 256,
    bitDepth: 8,
    chromaSubsampling: '444',
    codecProfile: 1,
    hasAlpha: true,
    sha256: 'b371cc88244a873131e4d10ff9363d71ce4f41cf333bd4a491b38d970d9abd3b',
  }),
  fixture('tests/data/colors-animated-12bpc-keyframes-0-2-3.avif', {
    width: 64,
    height: 64,
    bitDepth: 12,
    chromaSubsampling: '422',
    codecProfile: 2,
    hasAlpha: true,
    sha256: '3bf9f91da471749e7df639ba7945d4d94c1c3e3968c26f3619fbbcfc92790576',
  }),
  fixture('tests/data/colors-animated-8bpc-alpha-exif-xmp.avif', {
    width: 150,
    height: 150,
    bitDepth: 8,
    chromaSubsampling: '420',
    codecProfile: 0,
    hasAlpha: true,
    sha256: 'c2e38681057c15009c4b76ea08cea68cdde80806abd41d42a646f697bf5aabb2',
  }),
  fixture('tests/data/colors_hdr_rec2020.avif', {
    width: 200,
    height: 200,
    bitDepth: 10,
    chromaSubsampling: '444',
    codecProfile: 1,
    hasAlpha: false,
    sha256: '9980e58ddf718a923f1738c34aad1c72f8e5795ec07e68f1a5f9bd216ca19740',
  }),
  fixture('tests/data/draw_points_idat.avif', {
    width: 33,
    height: 11,
    bitDepth: 8,
    chromaSubsampling: '444',
    codecProfile: 1,
    hasAlpha: true,
    sha256: 'ce2fd627efae49391ea82584e9beae05959b867ba429e688a2b95a015b38d3db',
  }),
  fixture('tests/data/draw_points_idat_progressive.avif', {
    width: 33,
    height: 11,
    bitDepth: 8,
    chromaSubsampling: '444',
    codecProfile: 1,
    hasAlpha: true,
    sha256: '077ab2ad1e46dd912a973e4f024cb1eb242a08298be2dbf1a52a058e88c48a4a',
  }),
  fixture('tests/data/extended_pixi.avif', {
    width: 4,
    height: 4,
    bitDepth: 8,
    chromaSubsampling: '420',
    codecProfile: 0,
    hasAlpha: false,
    sha256: '7de53620b571aa61f54df2fc00cfa32955cd4e474a6a4b723a513b51ef21e946',
  }),
  fixture('tests/data/io/cosmos1650_yuv444_10bpc_p3pq.avif', {
    width: 1024,
    height: 428,
    bitDepth: 10,
    chromaSubsampling: '444',
    codecProfile: 1,
    hasAlpha: false,
    sha256: '1c3db1867051ae23ba61ed217f6b7372a4248e6322d76a239feab14bc4c55ab5',
  }),
  fixture('tests/data/io/kodim03_yuv420_8bpc.avif', {
    width: 768,
    height: 512,
    bitDepth: 8,
    chromaSubsampling: '420',
    codecProfile: 0,
    hasAlpha: false,
    sha256: 'e69c973a3ddf635412c9a0c6cda66798102d0030303614873b337f658983ef5d',
  }),
  fixture('tests/data/sofa_grid1x5_420.avif', {
    width: 1024,
    height: 770,
    bitDepth: 8,
    chromaSubsampling: '420',
    codecProfile: 0,
    hasAlpha: false,
    sha256: 'c9e04ff9d90d7093454750fa33b7543ee5479e0cfb151e2c3d2ce6a16c1651c1',
  }),
  fixture('tests/data/white_1x1.avif', {
    width: 1,
    height: 1,
    bitDepth: 8,
    chromaSubsampling: '444',
    codecProfile: 1,
    hasAlpha: false,
    sha256: 'ea4e43d1f07e4c00de16c13afa32376111bb306e51f08212cf4c1b6064df3667',
  }),
  fixture('tests/data/weld_sato_12B_8B_q0.avif', {
    width: 1024,
    height: 684,
    bitDepth: 12,
    chromaSubsampling: '444',
    codecProfile: 2,
    hasAlpha: false,
    sha256: 'fa41d615d244d50fc99d71c1fea14561e0814382a748d1b8b672c3fd5a595dbe',
  }),
]
