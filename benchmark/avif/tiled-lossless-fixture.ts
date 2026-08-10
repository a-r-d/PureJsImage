import { join } from 'node:path'

import { avifCorpusDirectory } from './corpus.ts'

export const avifTiledLosslessFixture = {
  bitDepth: 10,
  columns: 2,
  file: 'tiled-lossless-10bpc-yuv444-2x2-256x256.avif',
  decodedRgbaSha256: '50ce8c229e978291fd1ac9397ed3c7becb270c4e81eb5661759ac25b943adff5',
  fileSha256: '244318a2a8b70bdf44b6aa85fdb7b86cdf6bf57c2748ab0dde297cbf973fe67b',
  height: 256,
  nativeYuvSha256: '9d3f7f3654d1cb93ef4bd6fec6adbaa3dbfef6090417d6cd78532778f4ac4c8c',
  rows: 2,
  sourceY4mSha256: 'ecb86c39f46692583b2b40f0a6bdb4009ae1a8b412e43a6fde4698d20e42deaf',
  width: 256,
} as const

export const avifTiledLosslessFixturePath = join(avifCorpusDirectory, avifTiledLosslessFixture.file)

export const tiledLosslessSample = (plane: 0 | 1 | 2, x: number, y: number): number => {
  const maximum = 2 ** avifTiledLosslessFixture.bitDepth - 1
  if (plane === 0) return (x * 17 + y * 11 + ((x ^ y) & 31) * 7) & maximum
  if (plane === 1) return (x * 5 + y * 19 + 257) & maximum
  return (x * 23 + y * 3 + 769) & maximum
}
