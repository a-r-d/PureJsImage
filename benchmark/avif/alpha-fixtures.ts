import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export interface AvifAlphaFixture {
  readonly decodedRgbaSha256: string
  readonly file: string
  readonly fileSha256: string
  readonly height: number
  readonly premultiplied: boolean
  readonly width: number
}

export const avifAlphaFixtureDirectory = join(
  dirname(dirname(fileURLToPath(import.meta.url))),
  'corpus',
  'files',
  'avif',
)

export const avifAlphaFixtures: readonly AvifAlphaFixture[] = [
  {
    file: 'alpha-straight-64x48.avif',
    width: 64,
    height: 48,
    premultiplied: false,
    fileSha256: '20c63d6e79b048bf5204f50ce56f1d81aa493b679689863a76e667732ec6d3cc',
    decodedRgbaSha256: '54633c27b86e4034c8c1916134b5bfdd3209e43344bdfbaaaa53abde94b33d02',
  },
  {
    file: 'alpha-premultiplied-64x48.avif',
    width: 64,
    height: 48,
    premultiplied: true,
    fileSha256: '260570c663c51b255b407496c3a6b2a675779ae71fa3fcd69d4d7b9a77c240c4',
    decodedRgbaSha256: '797e6c9b789c30cdedb63c7f92adc127378f21cfae36809b7eb3499456ab3457',
  },
]
