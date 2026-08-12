import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export interface AvifSegmentationFixture {
  readonly decodedRgbaSha256: string
  readonly decodedYuvSha256: string
  readonly file: string
  readonly fileSha256: string
  readonly height: 512
  readonly segmentQuantizerDeltas: readonly [-4, -2, 13, 28]
  readonly sourceNormalizedSha256: string
  readonly sourceRawSha256: string
  readonly sourceUrl: string
  readonly width: 512
}

export const avifSegmentationFixtureDirectory = join(
  dirname(dirname(fileURLToPath(import.meta.url))),
  'corpus',
  'files',
  'avif',
)

export const avifSegmentationFixture: AvifSegmentationFixture = {
  decodedRgbaSha256: '91010159de46936ec760a1b60f7f2cc62a59674a101755e308aa0c3b8bdad5ad',
  decodedYuvSha256: '9f01675f10b341cb7db0f905598d7a3c3e9bdc26097f68826dc0df1ad434d188',
  file: 'rav1e-segmentation-q60-512x512.avif',
  fileSha256: '217d591b2850fcb83a309e3701c8ab1745a33185f5212adced5326d890fd0e73',
  height: 512,
  segmentQuantizerDeltas: [-4, -2, 13, 28],
  sourceNormalizedSha256: '236e0ebaee857eda451c01311c430287d59b924c9d935992e8f82a2cff131ce6',
  sourceRawSha256: '9572f678d9442bf654a01ef155bb493a65298b1af01febb723b10a04207c9c59',
  sourceUrl:
    'https://codec-corpus.r2.imazen.org/imazen-26-png-v3/9226-lilith-ai-products/grocery/whitelabel/9701_gen_products-grocery-whitelabel_coffee-bag-whole-bean_p0462_1024x1536.sdr.png',
  width: 512,
}

export const avifSegmentationFixturePath = join(
  avifSegmentationFixtureDirectory,
  avifSegmentationFixture.file,
)
