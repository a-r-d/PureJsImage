import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const avifCleanApertureFixtureDirectory = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'corpus',
  'files',
  'avif',
)

export const avifCleanApertureFixture = {
  crop: { x: 3, y: 2, width: 8, height: 6 },
  decodedRgbaSha256: 'b4f3dd1a9180c53513814f078199ea69d943409cafcd1befdd90595bd66c04dc',
  encodedHeight: 12,
  encodedWidth: 16,
  file: 'clean-aperture-lossless-16x12.avif',
  fileSha256: 'ace5e12b66bcc7b4c76c0b0ec04e38b20a819650a02e21bfa71d7537dc00714a',
  sharpRgbaSha256: 'b4f3dd1a9180c53513814f078199ea69d943409cafcd1befdd90595bd66c04dc',
  sourcePngSha256: '627a5354893af61035e4b4b283f87d583486034c7593434463a4b9e193ef3811',
} as const

export const avifFractionalCleanApertureFixture = {
  crop: { x: 272, y: 39, width: 385, height: 330 },
  encodedHeight: 1024,
  encodedWidth: 722,
  file: 'linku-kimono-crop.avif',
  license: 'CC-BY-SA-4.0',
  source: 'https://raw.githubusercontent.com/link-u/avif-sample-images/master/kimono.crop.avif',
  fileSha256: 'f175dcd9c64813b759da185fa67076fb772b76059845b2aad3ddcfab257f75ad',
  decodedRgbaSha256: 'cec4a971ed62d803ff8e4bb3635e2064b95e6f93868e8aab11aa0b7b15a525bf',
  sharpCroppedRgbaSha256: '02aaf2e98f25a96fc6698e9225a10c03bf72643812aacd62f0b7fd344d442a29',
} as const
