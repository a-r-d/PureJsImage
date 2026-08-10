import { join } from 'node:path'

import { avifCorpusDirectory } from './corpus.ts'

export const avifBoundedAlphaRowFixture = {
  file: 'bounded-row-alpha-lossless-64x192.avif',
  width: 64,
  height: 192,
  fileSha256: 'db45d9c187139d47b29d0caa3c4767f387b183eb9ed5d39463f0cd5c4e1c0bda',
  sourcePngSha256: '9b12d075e638c50a2dc92f31d48842f7b4c1cfa4c228332abd8e4f22d78ddb60',
  decodedRgbaSha256: 'a56c5a9dfcf52461d2e0000933d1215e011f2d3b82c533b2a0b8eaec8f1f1ec2',
} as const

export const avifBoundedAlphaRowFixturePath = join(
  avifCorpusDirectory,
  avifBoundedAlphaRowFixture.file,
)
