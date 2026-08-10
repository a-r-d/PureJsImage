import { join } from 'node:path'

import { avifCorpusDirectory } from './corpus.ts'

export interface AvifLossyMultitileFixture {
  readonly bitDepth: 8
  readonly chromaSubsampling: '420'
  readonly columns: number
  readonly decodedRgbaSha256: string
  readonly file: string
  readonly fileSha256: string
  readonly fullPostFilters: boolean
  readonly height: number
  readonly maximumNativeYuvDifference: number
  readonly nativeYuvDifferenceCount: number
  readonly oracleYuvSha256: string
  readonly pureYuvSha256: string
  readonly reducedStillPictureHeader: boolean
  readonly rows: number
  readonly sourceY4mSha256: string
  readonly tileGroups: number
  readonly width: number
}

export const avifLossyMultitileFixture: AvifLossyMultitileFixture = {
  bitDepth: 8,
  chromaSubsampling: '420',
  columns: 2,
  decodedRgbaSha256: '64d50b1df2d192b1dcac24d4bd0e0df6996c00a1a3ecbd97bd9a888edf3dd737',
  file: 'libaom-lossy-multitile-yuv420-256x256.avif',
  fileSha256: 'e16b36ae63d8b6b045fa5488440f07f305c0d8eeb95fb6eee6276074600dd238',
  fullPostFilters: true,
  height: 256,
  maximumNativeYuvDifference: 0,
  nativeYuvDifferenceCount: 0,
  oracleYuvSha256: '175be58e56a3fcf2bc4b345f14454cc9aafb2e15351523560790ff6ba85ebee4',
  pureYuvSha256: '175be58e56a3fcf2bc4b345f14454cc9aafb2e15351523560790ff6ba85ebee4',
  reducedStillPictureHeader: true,
  rows: 2,
  sourceY4mSha256: '71177816bfa2ce08b33454429bbe00d0530c839c85b2450da1ddd1ed1ade47a3',
  tileGroups: 0,
  width: 256,
}

export const avifLossyMultitileFixturePath = join(
  avifCorpusDirectory,
  avifLossyMultitileFixture.file,
)

export const avifFullHeaderTileGroupsFixture: AvifLossyMultitileFixture = {
  bitDepth: 8,
  chromaSubsampling: '420',
  columns: 2,
  decodedRgbaSha256: '05ab2273ba3952c41d53daf0b45afd709e5025f709ea8c87fef4a0dbacb0a966',
  file: 'libaom-full-header-tile-groups-yuv420-256x256.avif',
  fileSha256: '7efc8dea7d5d70c1946b287780c5cc368f59d98a05c4cec115fe21c8b5e83914',
  fullPostFilters: false,
  height: 256,
  maximumNativeYuvDifference: 0,
  nativeYuvDifferenceCount: 0,
  oracleYuvSha256: '818d2d099d330a1a71109a795b944bc42b5d3ef84c6526237a67cc1274d7416c',
  pureYuvSha256: '818d2d099d330a1a71109a795b944bc42b5d3ef84c6526237a67cc1274d7416c',
  reducedStillPictureHeader: false,
  rows: 2,
  sourceY4mSha256: '71177816bfa2ce08b33454429bbe00d0530c839c85b2450da1ddd1ed1ade47a3',
  tileGroups: 4,
  width: 256,
}

export const avifFullHeaderTileGroupsFixturePath = join(
  avifCorpusDirectory,
  avifFullHeaderTileGroupsFixture.file,
)

export const avifLossyMultitileFixtures = [
  {
    fixture: avifLossyMultitileFixture,
    path: avifLossyMultitileFixturePath,
  },
  {
    fixture: avifFullHeaderTileGroupsFixture,
    path: avifFullHeaderTileGroupsFixturePath,
  },
] as const

export const lossyMultitileSample = (plane: 0 | 1 | 2, x: number, y: number): number => {
  if (plane === 0) return (x * 5 + y * 3 + (((x >> 3) ^ (y >> 3)) & 1) * 71 + ((x * y) >> 4)) & 0xff
  if (plane === 1) return (x * 11 + y * 7 + (((x >> 2) ^ (y >> 2)) & 1) * 53) & 0xff
  return (x * 3 + y * 13 + ((x * y) >> 3)) & 0xff
}
