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

export const avifColorFixtureDirectory = avifCorpusDirectory

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
