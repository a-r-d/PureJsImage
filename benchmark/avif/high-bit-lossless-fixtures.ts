import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const avifHighBitLosslessFixtureDirectory = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'corpus',
  'files',
  'avif',
)

export interface AvifHighBitLosslessFixture {
  readonly bitDepth: 10 | 12
  readonly decodedRgbaSha256: string
  readonly file: string
  readonly fileSha256: string
  readonly height: number
  readonly sharpRgbSha256: string
  readonly sourceY4mSha256: string
  readonly width: number
}

export const avifHighBitLosslessFixtures: readonly AvifHighBitLosslessFixture[] = [
  {
    bitDepth: 10,
    decodedRgbaSha256: '54ce76855c1541d9a61bf24e543cac163c038f47e1e441450ba359c6ceb36a1c',
    file: 'lossless-identity-16x12-10bpc.avif',
    fileSha256: '6ae972874442ee8d034fa08af6772d64ea806a4c8023837d900da8d8bdd4ccab',
    height: 12,
    sharpRgbSha256: '6a7d0095509cac0f81209071c2d336f0695b960fee3551e1b590aa63d7998201',
    sourceY4mSha256: 'fbbbc1d6bd87571d0dc7f394a3540db04cbc514e87c2e65325666bba5ad16805',
    width: 16,
  },
  {
    bitDepth: 12,
    decodedRgbaSha256: '54ce76855c1541d9a61bf24e543cac163c038f47e1e441450ba359c6ceb36a1c',
    file: 'lossless-identity-16x12-12bpc.avif',
    fileSha256: 'd2c5527c437a26433c9cc61bdeb828ebb38cf008bd8601dadfdbcd540b5cc6e8',
    height: 12,
    sharpRgbSha256: '6a7d0095509cac0f81209071c2d336f0695b960fee3551e1b590aa63d7998201',
    sourceY4mSha256: '5646f86427959a01f2b6193e9d8f1573d987a039fe3833b692f16db5d0900ca5',
    width: 16,
  },
] as const
