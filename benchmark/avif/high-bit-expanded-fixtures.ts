import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export interface AvifHighBitExpandedFixture {
  readonly bitDepth: 10 | 12
  readonly chromaSubsampling: '420' | '422' | '444'
  readonly codedLossless: boolean
  readonly decodedRgbaSha256: string
  readonly file: string
  readonly fileSha256: string
  readonly height: number
  readonly nativeYuvSha256: string
  readonly postFilters: boolean
  readonly quantizer: 0 | 30 | 45
  readonly sourceY4mSha256: string
  readonly width: number
}

export const avifHighBitExpandedFixtureDirectory = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'corpus',
  'files',
  'avif',
)

export const avifHighBitExpandedFixtures: readonly AvifHighBitExpandedFixture[] = [
  {
    bitDepth: 10,
    chromaSubsampling: '420',
    codedLossless: true,
    decodedRgbaSha256: 'dd5a14ac11b1c93d66f85cf2cad18c53f87e7beb3c7d53f6d41bd001fa2f0d85',
    file: 'coded-lossless-10bpc-yuv420-32x24.avif',
    fileSha256: '13f3fe78ae3477df638cded4890206917b602b4c8749aa75ec6ddbd9be8a1e64',
    height: 24,
    nativeYuvSha256: 'd424e816d0e24e73ef31feaaa50bb01008f8e76306e9152a2ed6bc5e0222c74e',
    postFilters: false,
    quantizer: 0,
    sourceY4mSha256: '4bdb0aad76d6eaaae96ae4f309e550c9650dbde4d8409601edc194945228669b',
    width: 32,
  },
  {
    bitDepth: 10,
    chromaSubsampling: '420',
    codedLossless: false,
    decodedRgbaSha256: '49fa5a03211fed7d1d0a1f7d47fd1cf3f017b2931423ed9e63597d611035087e',
    file: 'filter-free-lossy-10bpc-yuv420-32x24.avif',
    fileSha256: 'b053e398f19e7c6a19cff7c98207af6979b5a508c30c98f97986d24f140294af',
    height: 24,
    nativeYuvSha256: '794b7068522ec1ac1e9996787892268f7033235c8e155f2315101dbe75d9ffa5',
    postFilters: false,
    quantizer: 30,
    sourceY4mSha256: '4bdb0aad76d6eaaae96ae4f309e550c9650dbde4d8409601edc194945228669b',
    width: 32,
  },
  {
    bitDepth: 12,
    chromaSubsampling: '420',
    codedLossless: true,
    decodedRgbaSha256: 'dcbcade0a186058362a48c34b1401d8059ac793d4cd8072eb91ff9d3d8423fba',
    file: 'coded-lossless-12bpc-yuv420-32x24.avif',
    fileSha256: '5e90f05e719753bc6bc6e93837f044deba27464a04f0189f7b434bfde2cddbd0',
    height: 24,
    nativeYuvSha256: '64aba11d379906a881094ac08b7324126078f89eb9a64a69ec3381a0627f98cd',
    postFilters: false,
    quantizer: 0,
    sourceY4mSha256: '98e273d998db01981f8908ab4a9de609b29e1e37c2e33ea52b608378e159c3b7',
    width: 32,
  },
  {
    bitDepth: 12,
    chromaSubsampling: '420',
    codedLossless: false,
    decodedRgbaSha256: '07682df7721f5e784519a6a2195f224c61fc256f9aa4f23dcf9068da115fb368',
    file: 'filter-free-lossy-12bpc-yuv420-32x24.avif',
    fileSha256: '1ef4ef3a64372f6bd6c52643c8d438cda0817990c25eb65df202902354fa9264',
    height: 24,
    nativeYuvSha256: '4dd09df647b9184436138139b3681f9988af6564b4537e3eb8827af25ee26832',
    postFilters: false,
    quantizer: 30,
    sourceY4mSha256: '98e273d998db01981f8908ab4a9de609b29e1e37c2e33ea52b608378e159c3b7',
    width: 32,
  },
  {
    bitDepth: 10,
    chromaSubsampling: '422',
    codedLossless: false,
    decodedRgbaSha256: 'b2925f663a008378105940675c9fe1f250c25f7e07d2455ef6c3dd80d6459294',
    file: 'filter-free-lossy-10bpc-yuv422-32x24.avif',
    fileSha256: 'e247645509266da4bbfe4ca5075c3bb6ad025baad600e01a741c31010befd6b8',
    height: 24,
    nativeYuvSha256: '900275cc0e0147a0b6b91aeb1c07ac8b7dd4e17fefa10fc061309c9010b88d73',
    postFilters: false,
    quantizer: 30,
    sourceY4mSha256: 'd8546b6a7b37b91dcef76118d8ce59f03f3b3140ae4536a30b28f50992cff983',
    width: 32,
  },
  {
    bitDepth: 10,
    chromaSubsampling: '444',
    codedLossless: false,
    decodedRgbaSha256: '432698d3b277e8f80d0c3e1d518bd432a64aed3ff6b1ee78dbf658863fc0a818',
    file: 'filter-free-lossy-10bpc-yuv444-32x24.avif',
    fileSha256: '890adfeb8b3f5c78b2924043a01f1024de24d10970f5ec0c983090eaa4fb510f',
    height: 24,
    nativeYuvSha256: 'b1a0adee85bb4a29b97a3230a133ceea2b80258bb9292b2034c5c40c8e04b928',
    postFilters: false,
    quantizer: 30,
    sourceY4mSha256: 'aed3c51b43ae0ee00ec62a10a7851e3425e0b3bf88a373188d353d3e6ac33ead',
    width: 32,
  },
  {
    bitDepth: 12,
    chromaSubsampling: '422',
    codedLossless: false,
    decodedRgbaSha256: '6ca5d5de7728ec1be99c4fe5bfa9a9e7458ad15f27c6d8fc4c5fcb21eb6e0baf',
    file: 'filter-free-lossy-12bpc-yuv422-32x24.avif',
    fileSha256: '3e299930380b3f6cf8acd87c28822d9536d85e73adad2d32aac7c3fd0a456cb1',
    height: 24,
    nativeYuvSha256: 'a2edc55a367d94176e3e3886da161f0f269ec34b5a7958373937115846cb59ad',
    postFilters: false,
    quantizer: 30,
    sourceY4mSha256: '853ef2507ee1498451740e050d4e607501806e63d8488e15032dabf2a7348836',
    width: 32,
  },
  {
    bitDepth: 12,
    chromaSubsampling: '444',
    codedLossless: false,
    decodedRgbaSha256: '7b137477c628a55948b560e2af5a95c53803a8eafaccf42c64509e57251efafc',
    file: 'filter-free-lossy-12bpc-yuv444-32x24.avif',
    fileSha256: '2ee4427b4c99588d40b8213535da4cb4851588be5267e8df1b58e3c40ede5bff',
    height: 24,
    nativeYuvSha256: '6d12bcf52ba68b3411ce5b46d053b7fdadb6c4ac437f16f3f639afb0acdacdbb',
    postFilters: false,
    quantizer: 30,
    sourceY4mSha256: 'ab0da82be049e01621bea66394ba8ac3ba71b40f731e73ac08933c7e1b9c1333',
    width: 32,
  },
  {
    bitDepth: 10,
    chromaSubsampling: '444',
    codedLossless: false,
    decodedRgbaSha256: 'e9e2f8be7c4a179341c0ac312482e5a5d96b209698df253d73fcc642d65e8096',
    file: 'filtered-lossy-10bpc-yuv444-96x64.avif',
    fileSha256: 'd1254f6fd0f37ee62d198cf2fee7bba4a76eed0adcf126a9f7cc79db3ecb0655',
    height: 64,
    nativeYuvSha256: '28213f547f44e46289785fd2c19373813dae7cd0777d80ef985642e8cd3c0dbb',
    postFilters: true,
    quantizer: 45,
    sourceY4mSha256: '33f3a3e5719b12bb70c0d93f0798cf03a57fb46cc46387f877c142c6480eaa5a',
    width: 96,
  },
]

export const avifHighBitExpandedFixturePath = (fixture: AvifHighBitExpandedFixture): string =>
  join(avifHighBitExpandedFixtureDirectory, fixture.file)

export const highBitExpandedSample = (
  fixture: AvifHighBitExpandedFixture,
  plane: 0 | 1 | 2,
  x: number,
  y: number,
): number => {
  const maximum = 2 ** fixture.bitDepth - 1
  if (fixture.bitDepth === 10) {
    if (plane === 0) return (x * 23 + y * 17 + ((x ^ y) & 7) * 41) & maximum
    if (plane === 1) return (x * 31 + y * 11 + 257) & maximum
    return (x * 7 + y * 37 + 769) & maximum
  }
  if (plane === 0) return (x * 93 + y * 67 + ((x ^ y) & 7) * 161) & maximum
  if (plane === 1) return (x * 127 + y * 43 + 1027) & maximum
  return (x * 29 + y * 149 + 3073) & maximum
}
