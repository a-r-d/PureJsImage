import { join } from 'node:path'

import { avifCorpusDirectory } from './corpus.ts'

export const avifLossyMultitileFixture = {
  bitDepth: 8,
  chromaSubsampling: '420',
  columns: 2,
  decodedRgbaSha256: '64d50b1df2d192b1dcac24d4bd0e0df6996c00a1a3ecbd97bd9a888edf3dd737',
  file: 'libaom-lossy-multitile-yuv420-256x256.avif',
  fileSha256: 'e16b36ae63d8b6b045fa5488440f07f305c0d8eeb95fb6eee6276074600dd238',
  height: 256,
  maximumNativeYuvDifference: 0,
  nativeYuvDifferenceCount: 0,
  oracleYuvSha256: '175be58e56a3fcf2bc4b345f14454cc9aafb2e15351523560790ff6ba85ebee4',
  pureYuvSha256: '175be58e56a3fcf2bc4b345f14454cc9aafb2e15351523560790ff6ba85ebee4',
  rows: 2,
  sourceY4mSha256: '71177816bfa2ce08b33454429bbe00d0530c839c85b2450da1ddd1ed1ade47a3',
  width: 256,
} as const

export const avifLossyMultitileFixturePath = join(
  avifCorpusDirectory,
  avifLossyMultitileFixture.file,
)

export const lossyMultitileSample = (plane: 0 | 1 | 2, x: number, y: number): number => {
  if (plane === 0) return (x * 5 + y * 3 + (((x >> 3) ^ (y >> 3)) & 1) * 71 + ((x * y) >> 4)) & 0xff
  if (plane === 1) return (x * 11 + y * 7 + (((x >> 2) ^ (y >> 2)) & 1) * 53) & 0xff
  return (x * 3 + y * 13 + ((x * y) >> 3)) & 0xff
}
