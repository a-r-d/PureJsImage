import { join } from 'node:path'

import { avifCorpusDirectory } from './corpus.ts'

export const avifBoundedRowFixture = {
  file: 'bounded-row-lossless-64x192.avif',
  width: 64,
  height: 192,
  fileSha256: '87840f5d9acdcbc2ac622fa79744c63818c73ef63a833566d9f83dc52f9f65db',
  sourcePngSha256: 'd0dd3d8b7451e146d809a0c0de8c953f24ff13c1a7b60669946eca2957d0495d',
  decodedRgbaSha256: '7e977b27d1c17fcac0d6092bca89bc47b4ad289dbff356e38302cc9fce300287',
} as const

export const avifBoundedRowFixturePath = join(avifCorpusDirectory, avifBoundedRowFixture.file)
