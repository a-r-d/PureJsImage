import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export interface AvifExpandedAlphaFixture {
  readonly alphaBitDepth: 8 | 10 | 12
  readonly alphaFullRange: boolean
  readonly decodedAlphaSha256?: string
  readonly decodedRgbaSha256: string
  readonly file: string
  readonly fileSha256: string
  readonly height: number
  readonly width: number
}

export const avifAuxiliaryFixtureDirectory = join(
  dirname(dirname(fileURLToPath(import.meta.url))),
  'corpus',
  'files',
  'avif',
)

export const avifExpandedAlphaFixtures: readonly AvifExpandedAlphaFixture[] = [
  {
    file: 'xiph-alpha-limited-8bpc-2048x2048.avif',
    width: 2048,
    height: 2048,
    alphaBitDepth: 8,
    alphaFullRange: false,
    fileSha256: 'f4809df9188fa46ed100f63c78c4cf42559d90a98351a8f69e177385920672b4',
    decodedAlphaSha256: 'd6ae69ac599cdc33587d45d3e21742eabeb031f85910ae0bc20a3e456ce06700',
    decodedRgbaSha256: '8264cd14f144270bc3594da6f02ef3c6b22658e93a0844f660ac8648871e8d1a',
  },
  {
    file: 'alpha-full-10bpc-64x48.avif',
    width: 64,
    height: 48,
    alphaBitDepth: 10,
    alphaFullRange: true,
    fileSha256: '15e7229b37bd9bba604eba2440694ad3a41252b7e934c00aa874ba540ced330b',
    decodedRgbaSha256: 'dfc169edd84afdb59f30abcbfd09ddb277783e82ffda2489b60e9429d9f3d5f4',
  },
  {
    file: 'alpha-full-12bpc-64x48.avif',
    width: 64,
    height: 48,
    alphaBitDepth: 12,
    alphaFullRange: true,
    fileSha256: '876e08fe6b750deb431270bb22026e4d827b3d6899b553e2932feadca78c40da',
    decodedRgbaSha256: 'dfc169edd84afdb59f30abcbfd09ddb277783e82ffda2489b60e9429d9f3d5f4',
  },
]

export const avifAlphaGridFixture = {
  file: 'libavif-color-grid-alpha-items-80x80.avif',
  width: 80,
  height: 80,
  fileSha256: 'bae56368b348b1d847e2bfb662522599f0c63dfe62fb68826c9e42a300ff405d',
  decodedAlphaSha256: '248f2d33c474a17c8e5a7c5b125ee587ff5be05be00f1edc54aff9a0f564179f',
  decodedRgbaSha256: 'bfc6eb86c18a9be89e5b52ff7dfc2faba3e84d4c1368bf18b478ec4f4947ff49',
  oracleRgbaSha256: '4ede0d909351b9b09c7e3e9475bfd3baf458141dbdd08f08aee19c11d2ec2983',
} as const

export const avifAlphaTransformFixtures = [
  {
    file: 'libavif-color-irot-alpha-noirot-512x256.avif',
    fileSha256: 'f2c8cd6ded641c68d13b3363417a62288a5eb335870de8d0b9da5093865ffb9a',
  },
  {
    file: 'libavif-color-irot-alpha-irot-512x256.avif',
    fileSha256: 'b371cc88244a873131e4d10ff9363d71ce4f41cf333bd4a491b38d970d9abd3b',
  },
] as const

export const avifAlphaTransformDecodedRgbaSha256 =
  '5102863ca73f618c60944e490aa3982e7a1afd6975f4d0edf12b40ac85c88f82'

export const avifAuxiliaryRoleFixtures = [
  {
    file: 'libavif-alpha-grid-gainmap-roles.avif',
    fileSha256: 'c424c43fe4bab3b8ef37b86c0bab3851b850b94e5d46b9fae979586dae45de0a',
    colorItems: 12,
    alphaItems: 12,
  },
  {
    file: 'libavif-depth-role.avif',
    fileSha256: '93177031f6177cff1e14c9065eb9dc97dbd7bbfa3e32a8b99af222398be1daac',
    colorItems: 1,
    alphaItems: 0,
  },
  {
    file: 'ms-thumbnail-roles.avif',
    fileSha256: 'e1635d66a6ba59c59893a0a2f17dc4fbda89183d8f2e78919bc472091a9de6e8',
    colorItems: 1,
    alphaItems: 0,
  },
] as const
