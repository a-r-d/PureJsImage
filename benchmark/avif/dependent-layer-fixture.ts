import { join } from 'node:path'

import { avifCorpusDirectory } from './corpus.ts'

export const avifDependentLayerFixture = {
  file: 'tiger-3layer-3res.avif',
  source:
    'https://chromium.googlesource.com/chromium/src/+/57dfffd794cafdeb4c3bdb40ac96ebdb6d22c2f6/third_party/blink/web_tests/images/resources/avif/tiger_3layer_3res.avif?format=TEXT',
  fileSha256: '74726115c4b45083c19d9fc844591584391e3953c9ee6f8d2f36a39962684d15',
  width: 1_216,
  height: 832,
  layerSizes: [4_425, 8_897],
  spatialIds: [0, 1, 2],
  frameKinds: ['key', 'inter', 'inter'],
} as const

export const avifSelectedBaseLayerFixture = {
  file: 'tiger-3layer-3res-lsel0.avif',
  fileSha256: '1b445f9bc9c1fb02b07f6cd6a42738ec2f55c3f418aa69d5abdaeb04f5444053',
  width: 304,
  height: 208,
  selectedSpatialId: 0,
  decodedRgbaSha256: 'd9f8a13bbe9f0e86540c431cf3cfdcd1ffd00b345526cefcd7faa1904ab6ba3a',
  decodedYuvSha256: '475bbf6b5f2f4418ba27b883934a4f84d7f328300bac02b821aa2b04d7446327',
  oracleRgbaSha256: '2782ab0b7febde5de4145ac42ea7654fcdfbe0f061d5eaf63308f9dc45bf9c38',
  maximumOracleDifferences: [1, 1, 2, 0],
  minimumRgbPsnr: 55,
} as const

export const avifDependentLayerFixturePath = join(
  avifCorpusDirectory,
  avifDependentLayerFixture.file,
)

export const avifSelectedBaseLayerFixturePath = join(
  avifCorpusDirectory,
  avifSelectedBaseLayerFixture.file,
)
