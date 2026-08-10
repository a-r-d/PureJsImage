import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export interface AvifHighBitExpandedFixture {
  readonly bitDepth: 10 | 12
  readonly chromaSubsampling: '420' | '444'
  readonly codedLossless: boolean
  readonly decodedRgbaSha256: string
  readonly file: string
  readonly fileSha256: string
  readonly height: number
  readonly nativeYuvSha256: string
  readonly quantizer: 0 | 30
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
    quantizer: 0,
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
    quantizer: 0,
    sourceY4mSha256: '98e273d998db01981f8908ab4a9de609b29e1e37c2e33ea52b608378e159c3b7',
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
    quantizer: 30,
    sourceY4mSha256: 'aed3c51b43ae0ee00ec62a10a7851e3425e0b3bf88a373188d353d3e6ac33ead',
    width: 32,
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
