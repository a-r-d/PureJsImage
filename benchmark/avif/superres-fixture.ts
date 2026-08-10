import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export interface AvifSuperresFixture {
  readonly bitDepth: 8
  readonly chromaSubsampling: '420' | '444'
  readonly codedWidth: number
  readonly cpuUsed: 4 | 6
  readonly cqLevel: 32 | 45
  readonly decodedRgbaSha256: string
  readonly decodedYuvSha256: string
  readonly file: string
  readonly fileSha256: string
  readonly filters: readonly ('cdef' | 'restoration')[]
  readonly height: number
  readonly sharpRgbSha256?: string
  readonly sourcePattern: 'detail' | 'ramp'
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
  cpuUsed: 6,
  cqLevel: 32,
  decodedRgbaSha256: 'bb31c24e26095af2032ca9f0d039e4061fae90a426cb3b446cb2199191f96e8b',
  decodedYuvSha256: 'a61a848ee5f0bf9d044594a449c80ecbabe1686224244b7844c7f0f3b05cb185',
  file: 'libaom-superres-denom12-96x64.avif',
  fileSha256: '53df77806277516519a84c743cda8a11e4945dccb96b4e4a71c21045366cb156',
  filters: [],
  height: 64,
  sharpRgbSha256: 'c8d9b8616123a0de628925ab8e5646e4d11096f4de6c443c11b625446316e818',
  sourcePattern: 'ramp',
  sourceY4mSha256: 'ea3f4da506ec8fe4bbe090a52534edf900b2ebf625576574876cf1f67fbd8dcd',
  superresDenominator: 12,
  width: 96,
}

export const avifSuperres420Fixture: AvifSuperresFixture = {
  bitDepth: 8,
  chromaSubsampling: '420',
  codedWidth: 64,
  cpuUsed: 6,
  cqLevel: 32,
  decodedRgbaSha256: '52910f1cee64437ba4b5c0c7146624d9a253e2ee8ac39c155210a30a3dabf66f',
  decodedYuvSha256: '277ba85fd6b4cb72fb9fa22ff349b1674dc4fcd012873faeaa487fbd29633822',
  file: 'libaom-superres-denom12-yuv420-96x64.avif',
  fileSha256: '4f5ebc562bde4225fb20aa681aa6b50a5841da5b70ba1b46d6087a219ad82c5d',
  filters: [],
  height: 64,
  sourcePattern: 'ramp',
  sourceY4mSha256: '1318d800f0b25a8ac3820a6d6642c96147d72986960c0f064344f60ab74c6351',
  superresDenominator: 12,
  width: 96,
}

export const avifBoundedSuperresFixture: AvifSuperresFixture = {
  bitDepth: 8,
  chromaSubsampling: '420',
  codedWidth: 213,
  cpuUsed: 6,
  cqLevel: 32,
  decodedRgbaSha256: '9bc16a4112c7b0b41b2fc587802b50e321c3bf669a4e66f6404887532384af5d',
  decodedYuvSha256: '6be8e557e2f7f0df55ceccab65acfb678e840b4e7d1f0ec8c9c00b8987e4c163',
  file: 'libaom-superres-denom12-yuv420-320x192.avif',
  fileSha256: 'cf0b53b82fb2b7c8dd09c06289f3f24034910e746c8efcdcef9475ed9905269f',
  filters: [],
  height: 192,
  sourcePattern: 'detail',
  sourceY4mSha256: '8005d6385f2c8a4f61c4d195ae1c615af0000488d4e3598317ff6ea22e172b83',
  superresDenominator: 12,
  width: 320,
}

export const avifFilteredSuperresFixture: AvifSuperresFixture = {
  bitDepth: 8,
  chromaSubsampling: '420',
  codedWidth: 213,
  cpuUsed: 4,
  cqLevel: 45,
  decodedRgbaSha256: '87d8605b420d0aeb1e2f012fdab7a8fa9c30ff4f7fa9115a927485122125f8a8',
  decodedYuvSha256: 'ed6eabb7de6ec5fed828541bbd76798d69cd6257aee932ad26968c008e68c965',
  file: 'libaom-filtered-superres-denom12-yuv420-320x192.avif',
  fileSha256: 'aafc123607bfbf01bc5d208ae84ecac823f3d84a5db487aadac0eecca714ed09',
  filters: ['cdef', 'restoration'],
  height: 192,
  sourcePattern: 'detail',
  sourceY4mSha256: '8005d6385f2c8a4f61c4d195ae1c615af0000488d4e3598317ff6ea22e172b83',
  superresDenominator: 12,
  width: 320,
}

export const avifSuperresFixtures: readonly AvifSuperresFixture[] = [
  avifBoundedSuperresFixture,
  avifFilteredSuperresFixture,
  avifSuperres420Fixture,
  avifSuperresFixture,
]

export const avifSuperresFixturePath = join(avifSuperresFixtureDirectory, avifSuperresFixture.file)
export const avifSuperres420FixturePath = join(
  avifSuperresFixtureDirectory,
  avifSuperres420Fixture.file,
)
export const avifBoundedSuperresFixturePath = join(
  avifSuperresFixtureDirectory,
  avifBoundedSuperresFixture.file,
)
export const avifFilteredSuperresFixturePath = join(
  avifSuperresFixtureDirectory,
  avifFilteredSuperresFixture.file,
)
