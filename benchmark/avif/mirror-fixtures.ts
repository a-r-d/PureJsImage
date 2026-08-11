import { join } from 'node:path'
import { avifCorpusDirectory } from './corpus.ts'

export interface AvifMirrorFixture {
  readonly chromiumHeight: number
  readonly chromiumRgbaSha256: string
  readonly chromiumWidth: number
  readonly decodedHeight: number
  readonly decodedRgbaSha256: string
  readonly decodedWidth: number
  readonly file: string
  readonly fileSha256: string
  readonly hasAlpha: boolean
  readonly mirrorAxis: 0 | 1
  readonly orientation: 2 | 4 | 7
  readonly primaryItemType: 'av01' | 'grid'
  readonly rawHeight: number
  readonly sharpHeight: number
  readonly sharpRgbaSha256: string
  readonly sharpWidth: number
  readonly rawRgbaSha256: string
  readonly rawWidth: number
}

export const avifMirrorFixtureDirectory = avifCorpusDirectory

export const avifMirrorSourcePngSha256 = Object.freeze({
  alpha: '34915ba0964099f0aae9b1c492bc5c826e31a37c070bbf4c32b6cdd084a2bd02',
  opaque: '24086cf2330be17f92ac0e141224b7716a4a1ebe3dead91c25541bbb0fc482ba',
})

export const avifMirrorFixtures: readonly AvifMirrorFixture[] = [
  {
    file: 'libavif-imir-axis0-160x160.avif',
    fileSha256: '31d22a22f0b213a22ff1d93bce2c546e3efd350ee0b4866e812f4a09fc9b38c0',
    rawWidth: 160,
    rawHeight: 160,
    rawRgbaSha256: 'b4048af1aed5ab360fb12c9bec09be99449654505f02de4d55508384346161da',
    decodedWidth: 160,
    decodedHeight: 160,
    decodedRgbaSha256: 'ecc5d7baa51289462eb57ed3e9e2202872d4e24438849531f15b04d0d1d8cc8a',
    mirrorAxis: 0,
    orientation: 4,
    hasAlpha: false,
    primaryItemType: 'av01',
    sharpWidth: 160,
    sharpHeight: 160,
    sharpRgbaSha256: 'ecc5d7baa51289462eb57ed3e9e2202872d4e24438849531f15b04d0d1d8cc8a',
    chromiumWidth: 160,
    chromiumHeight: 160,
    chromiumRgbaSha256: 'ecc5d7baa51289462eb57ed3e9e2202872d4e24438849531f15b04d0d1d8cc8a',
  },
  {
    file: 'libavif-imir-axis1-160x160.avif',
    fileSha256: 'd8bc17ca6cf5a0dbf0269ef1590a7829b2d50a7989ec298da534df103208fbd3',
    rawWidth: 160,
    rawHeight: 160,
    rawRgbaSha256: 'b4048af1aed5ab360fb12c9bec09be99449654505f02de4d55508384346161da',
    decodedWidth: 160,
    decodedHeight: 160,
    decodedRgbaSha256: '150d389f0f9ec73685c3b301933f344e68d045114e96b06d4e09c2ae2d056569',
    mirrorAxis: 1,
    orientation: 2,
    hasAlpha: false,
    primaryItemType: 'av01',
    sharpWidth: 160,
    sharpHeight: 160,
    sharpRgbaSha256: '150d389f0f9ec73685c3b301933f344e68d045114e96b06d4e09c2ae2d056569',
    chromiumWidth: 160,
    chromiumHeight: 160,
    chromiumRgbaSha256: '150d389f0f9ec73685c3b301933f344e68d045114e96b06d4e09c2ae2d056569',
  },
  {
    file: 'libavif-imir-clap-irot-grid-alpha-160x160.avif',
    fileSha256: 'a95187604f8405700aee42c43dc62c22fe285855f19f5b57dd6f3e9bd72c58bd',
    rawWidth: 160,
    rawHeight: 160,
    rawRgbaSha256: '6732741c04252940e9a95d6df2939b39a37f94011b35ea08ac1495617f0b2e75',
    decodedWidth: 96,
    decodedHeight: 112,
    decodedRgbaSha256: 'b3cca86fed0bf074641663fea9611be3ed3a217498b0095864300df265acf533',
    mirrorAxis: 1,
    orientation: 7,
    hasAlpha: true,
    primaryItemType: 'grid',
    sharpWidth: 96,
    sharpHeight: 112,
    sharpRgbaSha256: 'ad7191664c5c2a2a42c8e95d9bd07e36cb0fc0ba1ae4e479f3c234b579dbb1dd',
    chromiumWidth: 160,
    chromiumHeight: 160,
    chromiumRgbaSha256: '5f22a0d268ac2f295e8c8d2fbaa90267a04ea03f5597eb782cf4210738ee9d1f',
  },
] as const

export const avifMirrorFixturePath = (fixture: AvifMirrorFixture): string =>
  join(avifMirrorFixtureDirectory, fixture.file)
