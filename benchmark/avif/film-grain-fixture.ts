import { join } from 'node:path'

import { avifCorpusDirectory } from './corpus.ts'

export const avifFilmGrainFixture = {
  file: 'film-grain-test1-yuv420-64x48.avif',
  width: 64,
  height: 48,
  fileSha256: 'd6c1d64166964bf1d2de06c779235e17d4b641d8679eb9d5481708a4e8c5ad1c',
  sourcePngSha256: '78783963be9fabe2182d8497dfe9a43d28288b8bb60658ed7f9dcfaaa2dd08e2',
  nativeYuvSha256: '636c0da61ca2a6eb0a79bcd2ed9d233a95b33d6192b4b7d8f1e4dc37cdfc2f62',
  decodedRgbaSha256: 'ceff8604f5dc42f3a16a67dc2b8afc56d3fe8674567353b82c2e8384f10835dd',
  oracleRgbaSha256: 'f71090b287a7710c0c24ed5d5489f01d5bf6cb72bb77c97a0442d9af5125a914',
  maximumOracleDifference: 2,
} as const

export const avifFilmGrainFixturePath = join(avifCorpusDirectory, avifFilmGrainFixture.file)
