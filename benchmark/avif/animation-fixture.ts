import { join } from 'node:path'

import { avifCorpusDirectory } from './corpus.ts'

export interface AvifAnimationKeyFrameFixture {
  readonly decodedRgbaSha256: string
  readonly frame: number
  readonly maximumOracleDifferences: readonly [number, number, number, number]
  readonly oracleFile: string
  readonly oracleFileSha256: string
  readonly oracleRgbaSha256: string
}

export const avifAnimationFixture = {
  bitDepth: 12,
  chromaSubsampling: '422' as const,
  codecProfile: 2,
  file: 'colors-animated-12bpc-keyframes-0-2-3.avif',
  fileSha256: '3bf9f91da471749e7df639ba7945d4d94c1c3e3968c26f3619fbbcfc92790576',
  frames: 5,
  hasAlpha: true,
  height: 64,
  width: 64,
} as const

export const avifAnimationAlphaFixture = {
  bitDepth: 8,
  chromaSubsampling: '420' as const,
  codecProfile: 0,
  decodedRgbaSha256: 'c87fd8f3ac6aed6d680f138fc41fccde73a75a0a0b2c8bc9bca4fbc5d935b84a',
  file: 'colors-animated-8bpc-alpha-exif-xmp.avif',
  fileSha256: 'c2e38681057c15009c4b76ea08cea68cdde80806abd41d42a646f697bf5aabb2',
  frames: 5,
  hasAlpha: true,
  height: 150,
  oracleFile: 'colors-animated-8bpc-frame0-dav1d.png',
  oracleFileSha256: 'f95d117bc0ea735163b8c0ed14553a011ef26d6abca98c94ca2261fdbf7cfcaf',
  oracleRgbaSha256: 'c87fd8f3ac6aed6d680f138fc41fccde73a75a0a0b2c8bc9bca4fbc5d935b84a',
  width: 150,
} as const

export const avifAnimationKeyFrames = [
  {
    frame: 0,
    decodedRgbaSha256: 'cef05e2501d6fe214a10be9acd4aeef15db8263529bcfb0111bf2cdc98285b57',
    oracleFile: 'colors-animated-12bpc-frame0-dav1d.png',
    oracleFileSha256: '25d736910e98c7a3e20a3a37d13bffc83384dd4b769b9f0da285cf90a7516896',
    oracleRgbaSha256: 'cef05e2501d6fe214a10be9acd4aeef15db8263529bcfb0111bf2cdc98285b57',
    maximumOracleDifferences: [0, 0, 0, 0],
  },
  {
    frame: 2,
    decodedRgbaSha256: 'e90c27ddd2ed208f3ac37fd03860804246dda7daee94e8e03d3fd5a8d7b26b93',
    oracleFile: 'colors-animated-12bpc-frame2-dav1d.png',
    oracleFileSha256: '0d884123ac7615a08771c998745a1a2d70fb3d5c951837f4cf9796fb3717df4c',
    oracleRgbaSha256: 'e5adf69a2e6c5e5912b0083b87dc2b12b9113c36653483da3461bfb64db51061',
    maximumOracleDifferences: [0, 1, 0, 0],
  },
  {
    frame: 3,
    decodedRgbaSha256: '9ba384ef84bba2807859a554d4fdde0ef81cc7fe383e60ec712ae1bb0687ad8a',
    oracleFile: 'colors-animated-12bpc-frame3-dav1d.png',
    oracleFileSha256: '3cdaca664a44c04946abed755cd840ce04c86f8125419006a512e4abeb2e660b',
    oracleRgbaSha256: '2de187c245387de0486104c8e51653d6277268dacf32ee0e3f7f888d521b2e55',
    maximumOracleDifferences: [3, 2, 3, 1],
  },
] as const satisfies readonly AvifAnimationKeyFrameFixture[]

export const avifAnimationFixturePath = join(avifCorpusDirectory, avifAnimationFixture.file)

export const avifAnimationOraclePath = (fixture: AvifAnimationKeyFrameFixture): string =>
  join(avifCorpusDirectory, fixture.oracleFile)

export const avifAnimationAlphaFixturePath = join(
  avifCorpusDirectory,
  avifAnimationAlphaFixture.file,
)

export const avifAnimationAlphaOraclePath = join(
  avifCorpusDirectory,
  avifAnimationAlphaFixture.oracleFile,
)
