import { join } from 'node:path'

import { avifCorpusDirectory } from './corpus.ts'

export const avifLayeredFixture = {
  decodedRgbaSha256: 'd04f5c88fa8e105b354967755d1261ade0e214f85bb8707b97fcd0568098b68e',
  decodedYuvSha256: '59d0e7013d56d51d38d76e8cd31a9ff6da949ff5d95ee002073fbeccf75a64f7',
  file: 'xiph-tiger-3layer-lsel0-1216x832.avif',
  fileSha256: '38e340a1977b02f86a459c824214f6c32d5bd0f9c2cc83f8074810ce318dbcc7',
  height: 832,
  layerSizes: [8_299, 13_754] as const,
  selectedSpatialId: 0,
  sourceFileSha256: '46cb55301f5d4a36a72c8c00f1d7e10c6c9ae0297811dc0f38a26a0285daa316',
  spatialIds: [0, 1, 2] as const,
  width: 1_216,
} as const

export const avifLayeredFixturePath = join(avifCorpusDirectory, avifLayeredFixture.file)
