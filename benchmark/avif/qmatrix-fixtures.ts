import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export interface AvifQmatrixFixture {
  readonly baseQuantizer: number
  readonly deltaQResolution: number
  readonly file: string
  readonly fileSha256: string
  readonly height: number
  readonly matrixLevel: number
  readonly quality: 50 | 80
  readonly width: number
  readonly yuvSha256: string
}

export const avifQmatrixFixtureDirectory = join(
  dirname(dirname(fileURLToPath(import.meta.url))),
  'corpus',
  'files',
  'avif',
)

export const avifQmatrixFixtures: readonly AvifQmatrixFixture[] = [
  {
    quality: 50,
    file: 'sharp-qmatrix-q50-256x192.avif',
    width: 256,
    height: 192,
    baseQuantizer: 148,
    matrixLevel: 8,
    deltaQResolution: 2,
    fileSha256: '43fa0bff4ceb45a7a245365e0c1c5944b3af9308ad1e5c759de6bc69fa6af7bc',
    yuvSha256: '653411f52f0bb539f16b9b99f73988af39ee394ccc8a717f178a9db7fcf70974',
  },
  {
    quality: 80,
    file: 'sharp-qmatrix-q80-256x192.avif',
    width: 256,
    height: 192,
    baseQuantizer: 60,
    matrixLevel: 9,
    deltaQResolution: 0,
    fileSha256: 'c0b5b46cf975ba93345d08506faa4613b41518f9dcb9d004d8628e25f4787edc',
    yuvSha256: '653411f52f0bb539f16b9b99f73988af39ee394ccc8a717f178a9db7fcf70974',
  },
]
