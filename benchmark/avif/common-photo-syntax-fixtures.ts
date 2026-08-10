import { join } from 'node:path'

import { avifCorpusDirectory } from './corpus.ts'

export interface AvifCommonPhotoSyntaxFixture {
  readonly chromaSubsampling: '420' | '444'
  readonly file: string
  readonly fileSha256: string
  readonly height: number
  readonly initialFailure: 'symbol-overread' | 'trailing-one-bit'
  readonly nativeYuvSha256: string
  readonly range: 'full' | 'limited'
  readonly rgbaSha256: string
  readonly width: number
}

export const avifCommonPhotoSyntaxFixtures = [
  {
    chromaSubsampling: '420',
    file: 'diagnostic-baby-ffmpeg-crf30-yuv420.avif',
    fileSha256: '065c50f5efb649b2c504cd4aa3e5a3bbd21cbf1b7e50bd6ead745e7299861889',
    height: 576,
    initialFailure: 'symbol-overread',
    nativeYuvSha256: '0eb58e92d7a411c672b6aab886fbd5188e473bc9c17ea44b9c430db08618f071',
    range: 'limited',
    rgbaSha256: '819d046be8dfc6b72fb722488216cdb4dfcb8e6eb2953a53932a7a2f03baeccb',
    width: 576,
  },
  {
    chromaSubsampling: '444',
    file: 'diagnostic-baby-ffmpeg-crf45-yuv444.avif',
    fileSha256: '5b1a3aa5932a1d912d23e793315b3804bec32f4abff64786476dc291b542cc92',
    height: 576,
    initialFailure: 'trailing-one-bit',
    nativeYuvSha256: 'f80c5626eb518e535d6e4273a1d09ee2b41284207a93498aeaec218ddcccf4e7',
    range: 'limited',
    rgbaSha256: '030e44892698be8cb28a3d2fd75bfc65b0fc656f2e03314c89dadd1e8f99f89f',
    width: 576,
  },
  {
    chromaSubsampling: '420',
    file: 'diagnostic-mc3-sharp-q50-yuv420.avif',
    fileSha256: '0cf166bfa6105dc9e32023d0c5d23362ebb2f541e9d51ed09b9a32f4cf53ffce',
    height: 576,
    initialFailure: 'symbol-overread',
    nativeYuvSha256: 'b5ae67cb134adb6ae38999d73c01d8f6304fe21f3fbaa1b402ec689a9b256179',
    range: 'full',
    rgbaSha256: 'cfac5f91515b6bdea3a784881a9918584f8058996192cb9616cca33a52cbf78b',
    width: 576,
  },
] as const satisfies readonly AvifCommonPhotoSyntaxFixture[]

export const avifCommonPhotoSyntaxFixturePath = (fixture: AvifCommonPhotoSyntaxFixture): string =>
  join(avifCorpusDirectory, fixture.file)
