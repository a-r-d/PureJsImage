import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export interface AvifQmatrixFixture {
  readonly baseQuantizer: number
  readonly decodedYuvSha256: string
  readonly deltaQResolution: number
  readonly file: string
  readonly fileSha256: string
  readonly height: number
  readonly matrixLevels: readonly [number, number, number]
  readonly maximumYuvError: number
  readonly minimumYuvPsnr: number
  readonly quality: 30 | 50 | 65 | 80 | 90
  readonly width: number
}

export const avifQmatrixFixtureDirectory = join(
  dirname(dirname(fileURLToPath(import.meta.url))),
  'corpus',
  'files',
  'avif',
)

export const avifQmatrixFixtures: readonly AvifQmatrixFixture[] = [
  {
    quality: 30,
    file: 'sharp-qmatrix-q30-256x192.avif',
    width: 256,
    height: 192,
    baseQuantizer: 196,
    matrixLevels: [7, 7, 7],
    deltaQResolution: 3,
    maximumYuvError: 3,
    minimumYuvPsnr: 55,
    fileSha256: '4af9ced9c2425a91fb53ca46ea26ca50d84094b6bfb1beba17fe92ae9b786609',
    decodedYuvSha256: '79baef96bb1f902458a6998b6ece7735aa642bf3f0d59697343384a53a7dc194',
  },
  {
    quality: 50,
    file: 'sharp-qmatrix-q50-256x192.avif',
    width: 256,
    height: 192,
    baseQuantizer: 148,
    matrixLevels: [8, 8, 8],
    deltaQResolution: 2,
    maximumYuvError: 3,
    minimumYuvPsnr: 55,
    fileSha256: 'cc108d6f9d48edb7313d4ea3f8e6da84ca00cd1f6250b1b2273bc266d26ba1a8',
    decodedYuvSha256: '9e3a841e2e00518716bf671cf97748d30e068eb6a4c02144fd4cc03a92979000',
  },
  {
    quality: 65,
    file: 'sharp-qmatrix-q65-256x192.avif',
    width: 256,
    height: 192,
    baseQuantizer: 108,
    matrixLevels: [8, 9, 9],
    deltaQResolution: 1,
    maximumYuvError: 3,
    minimumYuvPsnr: 55,
    fileSha256: '75e47ffee05779cf6974d394279e2617a6590138c54c0751eea84c03263c3028',
    decodedYuvSha256: '41ed3d31bd6cc45c89ea2e4b509a11f2bfd121e2d4c4ae6015d0eaaa4c9771a5',
  },
  {
    quality: 80,
    file: 'sharp-qmatrix-q80-256x192.avif',
    width: 256,
    height: 192,
    baseQuantizer: 60,
    matrixLevels: [9, 9, 9],
    deltaQResolution: 0,
    maximumYuvError: 3,
    minimumYuvPsnr: 55,
    fileSha256: '260a0b5ea02a2f25fbc59e1372588a7797c8d2d100600731cd7a3a130aa5d417',
    decodedYuvSha256: '5d0ed8a7b2229f33ced30cdf25eb923604be6ece72fe7f60e51b92853c8890a2',
  },
  {
    quality: 90,
    file: 'sharp-qmatrix-q90-256x192.avif',
    width: 256,
    height: 192,
    baseQuantizer: 32,
    matrixLevels: [10, 10, 10],
    deltaQResolution: 0,
    maximumYuvError: 3,
    minimumYuvPsnr: 55,
    fileSha256: '66e593ca0b7f107524d310b2e2b0d9442bdadabeb3fdf493096b2d14b3adbba0',
    decodedYuvSha256: 'c33d5040b67de93763f9c5147817ac81c3e944d6bfbbd674deceb332f407b530',
  },
]
