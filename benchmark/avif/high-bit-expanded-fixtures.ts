import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export type AvifHighBitFilter = 'cdef' | 'deblock' | 'self-guided' | 'wiener'

export interface AvifHighBitExpandedFixture {
  readonly bitDepth: 10 | 12
  readonly chromaSubsampling: '420' | '422' | '444'
  readonly chromiumRgbaSha256?: string
  readonly codedLossless: boolean
  readonly decodedRgbaSha256: string
  readonly encoder?: 'avifenc'
  readonly encoderSpeed?: 0 | 4
  readonly file: string
  readonly fileSha256: string
  readonly filters: readonly AvifHighBitFilter[]
  readonly fullRange?: false
  readonly height: number
  readonly maximumChromiumRgbDifference?: number
  readonly maximumSharpRgbDifference?: number
  readonly nativeYuvSha256: string
  readonly quantizer: 0 | 20 | 30 | 45
  readonly sharpRgbSha256?: string
  readonly sourcePattern?: 'filtered-detail' | 'fox-crop'
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
    filters: [],
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
    filters: [],
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
    filters: [],
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
    filters: [],
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
    filters: [],
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
    filters: [],
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
    filters: [],
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
    filters: [],
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
    filters: ['deblock', 'cdef', 'wiener'],
    quantizer: 45,
    sourceY4mSha256: '33f3a3e5719b12bb70c0d93f0798cf03a57fb46cc46387f877c142c6480eaa5a',
    width: 96,
  },
  {
    bitDepth: 10,
    chromaSubsampling: '420',
    chromiumRgbaSha256: '7443afcbe7796fcada187a67a6ab357241cfd0f9e7dca30aa0cb84c1af95c76d',
    codedLossless: false,
    decodedRgbaSha256: '026ecbc3e3256500066f44b6bdca81dcad6ec99e674e5550cda43291a73594d1',
    encoder: 'avifenc',
    encoderSpeed: 4,
    file: 'filtered-lossy-10bpc-yuv420-192x128.avif',
    fileSha256: '18e827edf09a9a35325b40d4f938719929445ff230310713f0cdf4299754a911',
    filters: ['deblock', 'cdef', 'wiener'],
    height: 128,
    maximumChromiumRgbDifference: 3,
    maximumSharpRgbDifference: 188,
    nativeYuvSha256: '23e14b0f95a77d0652e3e446659f96d667be95cf27c688c0554d27db807f8c3d',
    quantizer: 20,
    sharpRgbSha256: 'e774a541cc075d638c2a8f790275b136076453a1ed07fbc74b865cc770b36e52',
    sourcePattern: 'filtered-detail',
    sourceY4mSha256: 'bc7a7c171a37f32d513bb68e70f79324480cec0902a7e27fb4d4364f4f87b5d0',
    width: 192,
  },
  {
    bitDepth: 10,
    chromaSubsampling: '422',
    chromiumRgbaSha256: 'baca323bd5540446c8e07f66aa037024dcae16e7da0a3b412eb661f25c1eaf1a',
    codedLossless: false,
    decodedRgbaSha256: '32e1e6c6c8f80c33c099d3cd58351a75fa63fa352177713d67b93fd7ed19d50e',
    encoder: 'avifenc',
    encoderSpeed: 4,
    file: 'filtered-lossy-10bpc-yuv422-64x64.avif',
    fileSha256: 'c8549a5bff39d304e892a9ee12caf3b761bd2fe74236da4a0941fd0987ff3873',
    filters: ['cdef', 'wiener'],
    height: 64,
    maximumChromiumRgbDifference: 3,
    maximumSharpRgbDifference: 119,
    nativeYuvSha256: 'aa2d08541a8bfa46160c3579c0ff5a2936700fe4cc264343c6552f4eb0f1f83f',
    quantizer: 20,
    sharpRgbSha256: 'd644409c7b877307d48e99269a3dfef1b43357c8a473932a78e3ffe471da7a5c',
    sourcePattern: 'filtered-detail',
    sourceY4mSha256: '9ede5d5ffd9316403cde11708d6f3a686045047e7aff8fa498daba9bfa1dcb02',
    width: 64,
  },
  {
    bitDepth: 10,
    chromaSubsampling: '420',
    chromiumRgbaSha256: 'db0ce9ffa65137d06ebbc394b35f66fb3ae074b4ff9d606ed55aff50e5c62cb0',
    codedLossless: false,
    decodedRgbaSha256: 'e382b8f0373e80e4c9abe67e9c30666db7a39b2d850b3b86af8aa5baea466f5c',
    encoder: 'avifenc',
    encoderSpeed: 0,
    file: 'self-guided-10bpc-yuv420-320x192.avif',
    fileSha256: 'b504b675b860c534c04b0084b8574f39d5012d2f663431700285699444b28d68',
    filters: ['deblock', 'cdef', 'self-guided'],
    fullRange: false,
    height: 192,
    maximumChromiumRgbDifference: 6,
    maximumSharpRgbDifference: 10,
    nativeYuvSha256: '4036043fdd2cbcb42052e3c345f5dc578e2e1d15c86aab616c7e824ccacdd3af',
    quantizer: 20,
    sharpRgbSha256: '514afb7fe41de4ce3f148138087dce8a27fb55ff019ec7a5be22a1de8a94a85c',
    sourcePattern: 'fox-crop',
    sourceY4mSha256: 'ff8bb0c76d43d8c5a455de74144012f065c06c17c6885f73d4a0f351ca4e6fd9',
    width: 320,
  },
  {
    bitDepth: 12,
    chromaSubsampling: '420',
    chromiumRgbaSha256: '45ae308afcdea548bae4ced23d52feab9c00308d1c649986e9265acd77e7fc17',
    codedLossless: false,
    decodedRgbaSha256: 'e44124196c3e453abf158e571592c14b8388ca71875cff1be6f856916c7755f9',
    encoder: 'avifenc',
    encoderSpeed: 4,
    file: 'filtered-lossy-12bpc-yuv420-64x64.avif',
    fileSha256: '42fd29d686d67652d72f0531982f7f26aecffb72b2ee5bb92d7ae57d241e3a81',
    filters: ['deblock', 'cdef'],
    height: 64,
    maximumChromiumRgbDifference: 158,
    maximumSharpRgbDifference: 156,
    nativeYuvSha256: '00888d4e1290d8cee5d38971ff18dc49976813767e12b0c6a9698b0ce500b8c3',
    quantizer: 20,
    sharpRgbSha256: '07fb02661250943afd5b7914781dbb279c5a5cf8f1ab5af09d0f210d07067687',
    sourcePattern: 'filtered-detail',
    sourceY4mSha256: '0d8cc5f567619ab93579a81dcc5a47b9159963a13fba8bf3d9c74ed0d5442ecb',
    width: 64,
  },
  {
    bitDepth: 12,
    chromaSubsampling: '422',
    chromiumRgbaSha256: 'f116a8766e3887a5c9f9a965951b4edcf88d352e46db3ee3c9cce130ccb96da7',
    codedLossless: false,
    decodedRgbaSha256: 'f9b58fa7193daa31e3d4ef22349aeb67a5b1c3f802103c7c7c3fe93f889d8e87',
    encoder: 'avifenc',
    encoderSpeed: 4,
    file: 'filtered-lossy-12bpc-yuv422-64x64.avif',
    fileSha256: 'bd7c4826a179f31309216b79042b619cad520e46f257972cde5591d56efb877d',
    filters: ['deblock', 'cdef'],
    height: 64,
    maximumChromiumRgbDifference: 3,
    maximumSharpRgbDifference: 102,
    nativeYuvSha256: '1bc3253a2ae19ea134cf892bd41bdc585db3c87e147ca249e3da9bcd2651cb0f',
    quantizer: 20,
    sharpRgbSha256: '5f794904d6c004491d4705168f3fcfd0e510b2ff6b61b91df9ed6c9899f1f8a1',
    sourcePattern: 'filtered-detail',
    sourceY4mSha256: 'b51211f94ef263e301d6ca872e39e6d356304a8de47af236f828fd014651082b',
    width: 64,
  },
  {
    bitDepth: 12,
    chromaSubsampling: '444',
    chromiumRgbaSha256: '28b88bd4ba31908bab42a410a959bb7d2831ce60572be8dbd4e4685cf3e126f3',
    codedLossless: false,
    decodedRgbaSha256: '28b88bd4ba31908bab42a410a959bb7d2831ce60572be8dbd4e4685cf3e126f3',
    encoder: 'avifenc',
    encoderSpeed: 4,
    file: 'filtered-lossy-12bpc-yuv444-64x64.avif',
    fileSha256: 'dd63356ba2df4e48997cd83e06c782fc94935258759668ceb8b7ba3fff617018',
    filters: ['deblock', 'cdef'],
    height: 64,
    maximumChromiumRgbDifference: 0,
    maximumSharpRgbDifference: 1,
    nativeYuvSha256: '94aba76df9e890e27a5fe7b4fd07c87d1b43a305720ea9a649d80265b21ab8e6',
    quantizer: 20,
    sharpRgbSha256: 'ad79d3343e49b373a2a048ba3301b5eb71272efcf0b5af4c89f96afcc7129643',
    sourcePattern: 'filtered-detail',
    sourceY4mSha256: 'bf029a0492645ead5bf33a39d70b9bda8a76706b485be6aa2ac144bc0770aaaf',
    width: 64,
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
  if (fixture.sourcePattern === 'filtered-detail') {
    if (plane === 0) {
      return (x * 93 + y * 67 + ((x ^ y) & 15) * 161 + ((x >> 4) ^ (y >> 4)) * 257) & maximum
    }
    if (plane === 1) return (x * 127 + y * 43 + 1027 + ((x >> 3) & 1) * 511) & maximum
    return (x * 29 + y * 149 + 3073 + ((y >> 3) & 1) * 383) & maximum
  }
  if (fixture.bitDepth === 10) {
    if (plane === 0) return (x * 23 + y * 17 + ((x ^ y) & 7) * 41) & maximum
    if (plane === 1) return (x * 31 + y * 11 + 257) & maximum
    return (x * 7 + y * 37 + 769) & maximum
  }
  if (plane === 0) return (x * 93 + y * 67 + ((x ^ y) & 7) * 161) & maximum
  if (plane === 1) return (x * 127 + y * 43 + 1027) & maximum
  return (x * 29 + y * 149 + 3073) & maximum
}
