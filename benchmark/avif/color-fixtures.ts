import { join } from 'node:path'
import { avifCorpusDirectory } from './corpus.ts'

export interface AvifEncodedFixture {
  readonly file: string
  readonly fileSha256: string
}

export interface AvifColorFixture extends AvifEncodedFixture {
  readonly height: number
  readonly rgbaSha256: string
  readonly width: number
}

interface AvifHdrToneMapFixtureBase extends AvifColorFixture {
  readonly matrixCoefficients: number
  readonly primaries: number
  readonly sequenceColorSignaling?: 'unspecified'
  readonly transferCharacteristics: 16 | 18
}

export interface AvifPqToneMapFixture extends AvifHdrToneMapFixtureBase {
  readonly maximumAbsoluteError: number
  readonly maximumMeanAbsoluteError: number
  readonly maximumP95AbsoluteError: number
  readonly minimumPsnr: number
  readonly oracleFile: string
  readonly oracleSha256: string
  readonly transferCharacteristics: 16
}

export interface AvifHlgToneMapFixture extends AvifHdrToneMapFixtureBase {
  readonly transferCharacteristics: 18
}

export type AvifHdrToneMapFixture = AvifPqToneMapFixture | AvifHlgToneMapFixture

interface AvifHdrOracleSample {
  readonly pixel: number
  readonly rgb: readonly [number, number, number]
}

export interface AvifHdrSampleFixture extends AvifColorFixture {
  readonly matrixCoefficients: number
  readonly maximumAbsoluteError: number
  readonly oracleSamples: readonly AvifHdrOracleSample[]
  readonly primaries: number
  readonly transferCharacteristics: 16 | 18
}

export const avifColorFixtureDirectory = avifCorpusDirectory

export const avifHdrToneMapOracle =
  'FFmpeg 7.1.1 zscale to linear RGB at 203-nit reference white, ' +
  'Reinhard tone map with desaturation disabled and the PQ 10000-nit nominal peak, ' +
  'then zscale to full-range IEC 61966-2-1 / BT.709 RGBA; identity-coded RGB is first ' +
  'converted losslessly with libavif 1.3.0'

export const avifHdrToneMapFixtures: readonly AvifHdrToneMapFixture[] = [
  {
    file: 'libavif-colors-hdr-p3.avif',
    fileSha256: 'ec4b67fa129360f4b44768bdd1027fb32834d1a1f7e49ae53bed44c819def9c4',
    width: 200,
    height: 200,
    rgbaSha256: 'ef957216a73d4aac1ddf6a0ccfe2159a1d3f361bea95d93bb2fbe009c06a9848',
    primaries: 12,
    transferCharacteristics: 16,
    matrixCoefficients: 6,
    oracleFile: 'oracle-libavif-colors-hdr-p3-ffmpeg-reinhard.png',
    oracleSha256: 'fecc645c9e30cb36cc6998f5059aa3924d4984643db69ddcd387cd179e1120ff',
    maximumAbsoluteError: 2,
    maximumMeanAbsoluteError: 1,
    maximumP95AbsoluteError: 1,
    minimumPsnr: 50,
  },
  {
    file: 'hdr-hlg-10bpc-yuv444-32x24.avif',
    fileSha256: 'dbf91c2a6ec6b060b6f5502487bb5d437430dbf05b7233f58b186aed759fe1fa',
    width: 32,
    height: 24,
    rgbaSha256: '51dd3264ec19aa0af645a145c84159581ebd121a2296c071c58e5dda04c9cec4',
    primaries: 9,
    transferCharacteristics: 18,
    matrixCoefficients: 9,
    sequenceColorSignaling: 'unspecified',
  },
  {
    file: 'identity-pq-10bpc-yuv444-16x12.avif',
    fileSha256: 'e55aa2515a20c5d1e84eef395ec925805a2568b1a2ab9cbe5b27b2ea14218ee0',
    width: 16,
    height: 12,
    rgbaSha256: 'faf9e43856c554015a4940a2647a6d053fafb42cf22ebbb2600d4d61d4c018d9',
    primaries: 9,
    transferCharacteristics: 16,
    matrixCoefficients: 0,
    sequenceColorSignaling: 'unspecified',
    oracleFile: 'oracle-identity-pq-rec2020-ffmpeg-reinhard.png',
    oracleSha256: '86f0cedffb1fe542dcf92130cd59c2695164de56f022b66a7c414f9ca7acc82b',
    maximumAbsoluteError: 1,
    maximumMeanAbsoluteError: 1,
    maximumP95AbsoluteError: 1,
    minimumPsnr: 54,
  },
]

export const avifHdrChromaDerivedFixture: AvifHdrSampleFixture = {
  file: 'libavif-cosmos1650-yuv444-10bpc-p3pq.avif',
  fileSha256: '1c3db1867051ae23ba61ed217f6b7372a4248e6322d76a239feab14bc4c55ab5',
  width: 1024,
  height: 428,
  rgbaSha256: 'b39faa860e8fd51bfc22173d5c376f5b837a1eca2776e6bd3bbbcbbbfeb630bb',
  primaries: 12,
  transferCharacteristics: 16,
  matrixCoefficients: 12,
  maximumAbsoluteError: 1,
  oracleSamples: [
    { pixel: 0, rgb: [66, 95, 130] },
    { pixel: 1023, rgb: [174, 150, 132] },
    { pixel: 1024, rgb: [66, 95, 130] },
    { pixel: 65_535, rgb: [205, 173, 136] },
    { pixel: 109_567, rgb: [172, 127, 25] },
    { pixel: 219_135, rgb: [90, 84, 0] },
    { pixel: 328_703, rgb: [144, 91, 29] },
    { pixel: 437_247, rgb: [136, 138, 0] },
  ],
}

export const avifRec2020Fixture: AvifColorFixture = {
  file: 'libavif-colors-text-wcg-sdr-rec2020.avif',
  fileSha256: '1fba1a2ce322c7e1d5966517f110dfcf134005644c1e6207acf0dd7bb4e60708',
  width: 200,
  height: 200,
  rgbaSha256: '087173f8afaaf7c42640d07ef6f0ab873abb494dd3a89d920b11e13b2ad66717',
}

export const avifHdrGainMapFixture: AvifColorFixture = {
  file: 'libavif-seine-hdr-gainmap-srgb.avif',
  fileSha256: '9bf9c6a7606951de07e4079cd63c2cfe379d95139cd99ab9142d8a6ee22d28c7',
  width: 400,
  height: 300,
  rgbaSha256: '352475a2b3f3c60de9b6feee3f756a00cfcaa3b4ad19594ea72260064f84bc57',
}

export const avifWrongAlternativeGainMapFixture: AvifEncodedFixture = {
  file: 'libavif-seine-hdr-gainmap-srgb-wrong-altr.avif',
  fileSha256: '23990f6493467f13a313c629dec3c98a6560b85dbfbb11bfb2ab8a6bc9850bbf',
}

export const avifIccFixtures: readonly AvifColorFixture[] = [
  {
    file: 'libavif-paris-icc-exif-xmp.avif',
    fileSha256: '961bc38b61e60b7651fa20efa24269ae2f35e4958822a81c908c9bbf9b3f66e1',
    width: 403,
    height: 302,
    rgbaSha256: '2a283d662a75d7b522146ee8e559153b00fe16523e2958a17f988e34929e0b33',
  },
  {
    file: 'libavif-seine-sdr-gainmap-srgb-icc.avif',
    fileSha256: '63fa6580a4cc215debc1229e35450c8144207218cc7ce6f5bfe5596efa357d55',
    width: 400,
    height: 300,
    rgbaSha256: '9c5e940c2b043aeccd6516fe440cdd3e86a53244781b1422d20ffb3a909303a2',
  },
]

export const avifColorFixturePath = (fixture: AvifEncodedFixture): string =>
  join(avifColorFixtureDirectory, fixture.file)
