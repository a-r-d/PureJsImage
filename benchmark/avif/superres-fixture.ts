import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export interface AvifSuperresFixture {
  readonly bitDepth: 8
  readonly chromaSubsampling: '420' | '444'
  readonly codedWidth: number
  readonly decodedRgbaSha256: string
  readonly decodedYuvSha256: string
  readonly file: string
  readonly fileSha256: string
  readonly height: number
  readonly sharpRgbSha256?: string
  readonly sourceY4mSha256: string
  readonly superresDenominator: 12
  readonly width: number
}

export const avifSuperresFixtureDirectory = join(
  dirname(dirname(fileURLToPath(import.meta.url))),
  'corpus',
  'files',
  'avif',
)

export const avifSuperresFixture: AvifSuperresFixture = {
  bitDepth: 8,
  chromaSubsampling: '444',
  codedWidth: 64,
  decodedRgbaSha256: 'bb31c24e26095af2032ca9f0d039e4061fae90a426cb3b446cb2199191f96e8b',
  decodedYuvSha256: 'a61a848ee5f0bf9d044594a449c80ecbabe1686224244b7844c7f0f3b05cb185',
  file: 'libaom-superres-denom12-96x64.avif',
  fileSha256: 'f0c8f841fe09fb9c4a733f272396aa05f1ba1f2ecb1128491142dac0bfccfb09',
  height: 64,
  sharpRgbSha256: 'c8d9b8616123a0de628925ab8e5646e4d11096f4de6c443c11b625446316e818',
  sourceY4mSha256: 'ea3f4da506ec8fe4bbe090a52534edf900b2ebf625576574876cf1f67fbd8dcd',
  superresDenominator: 12,
  width: 96,
}

export const avifSuperres420Fixture: AvifSuperresFixture = {
  bitDepth: 8,
  chromaSubsampling: '420',
  codedWidth: 64,
  decodedRgbaSha256: '52910f1cee64437ba4b5c0c7146624d9a253e2ee8ac39c155210a30a3dabf66f',
  decodedYuvSha256: '277ba85fd6b4cb72fb9fa22ff349b1674dc4fcd012873faeaa487fbd29633822',
  file: 'libaom-superres-denom12-yuv420-96x64.avif',
  fileSha256: '7526d643470ccfa2bb3bcfc31d2aaf6dd4dda5ac71697674e3b0cb21f9d5fae7',
  height: 64,
  sourceY4mSha256: '1318d800f0b25a8ac3820a6d6642c96147d72986960c0f064344f60ab74c6351',
  superresDenominator: 12,
  width: 96,
}

export const avifSuperresFixtures: readonly AvifSuperresFixture[] = [
  avifSuperres420Fixture,
  avifSuperresFixture,
]

export const avifSuperresFixturePath = join(avifSuperresFixtureDirectory, avifSuperresFixture.file)
export const avifSuperres420FixturePath = join(
  avifSuperresFixtureDirectory,
  avifSuperres420Fixture.file,
)
