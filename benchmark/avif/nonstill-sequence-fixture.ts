import { join } from 'node:path'

import { avifCorpusDirectory } from './corpus.ts'

export const avifNonstillSequenceFixture = {
  file: 'ms-mexico-nonstill-sequence.avif',
  fileSha256: '96bf0656417dca608ea9de0314b6e526fa8910d112ed01054d8842be1947e91f',
  width: 1_920,
  height: 1_080,
  decodedYuvSha256: 'da3ba1342d9d5c317b6f1878af2260e74c191f5aee245b988170f7ce59c132a4',
  decodedRgbaSha256: '99f28f0e2fdc30dab25ad903ce043e7af30b7097d1f3402e692b3f8629bff6c1',
} as const

export const avifNonstillSequenceFixturePath = join(
  avifCorpusDirectory,
  avifNonstillSequenceFixture.file,
)
