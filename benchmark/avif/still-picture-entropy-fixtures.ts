import { join } from 'node:path'

import { avifCorpusDirectory } from './corpus.ts'

export interface AvifStillPictureEntropyFixture {
  readonly allowIntrabc: boolean
  readonly file: string
  readonly fileSha256: string
  readonly height: number
  readonly initialFailure: 'symbol-overread' | 'trailing-one-bit' | 'trailing-padding'
  readonly nativeYuvSha256: string
  readonly rgbaSha256: string
  readonly width: number
}

export const avifStillPictureEntropyFixtures = [
  {
    allowIntrabc: true,
    file: 'ms-Tomsk-with-thumbnails.avif',
    fileSha256: 'e1635d66a6ba59c59893a0a2f17dc4fbda89183d8f2e78919bc472091a9de6e8',
    height: 720,
    initialFailure: 'symbol-overread',
    nativeYuvSha256: 'c7b410956b3a18b00880cf5e4305ef30df4e2b39413e74f4d41ad76e6ac47cd0',
    rgbaSha256: '3277bbd3ada1d7dc560080465c9957bf9595ff6eaf2b023c62aca4e7a3679c3b',
    width: 1280,
  },
  {
    allowIntrabc: true,
    file: 'ms-reduced-still-picture-header.avif',
    fileSha256: '89e803ae15fa438bcce2b955c36b174b836daf93a1fff9187bb9ee0ec1b2f5a7',
    height: 720,
    initialFailure: 'symbol-overread',
    nativeYuvSha256: 'c7b410956b3a18b00880cf5e4305ef30df4e2b39413e74f4d41ad76e6ac47cd0',
    rgbaSha256: '3277bbd3ada1d7dc560080465c9957bf9595ff6eaf2b023c62aca4e7a3679c3b',
    width: 1280,
  },
  {
    allowIntrabc: true,
    file: 'ms-still-picture.avif',
    fileSha256: '6f06c9fb62908bff0165dcbd3e51b143cc80619f46b41b382f8cf6e634b009bd',
    height: 720,
    initialFailure: 'trailing-one-bit',
    nativeYuvSha256: 'c7b410956b3a18b00880cf5e4305ef30df4e2b39413e74f4d41ad76e6ac47cd0',
    rgbaSha256: '3277bbd3ada1d7dc560080465c9957bf9595ff6eaf2b023c62aca4e7a3679c3b',
    width: 1280,
  },
  {
    allowIntrabc: true,
    file: 'ms-bbb-4k.avif',
    fileSha256: '5ba24612f2a7a8a6eae122e8422a723413b969bca4253ab2ce19eb65e3e15abf',
    height: 2160,
    initialFailure: 'trailing-padding',
    nativeYuvSha256: 'd056b086a327011c7b130247494b0ccffdd1a18c2de96b8fb792b38b73c173a8',
    rgbaSha256: '2ad091efd1d893980a05d5793150cccd53719c5393df0bc5f0f78c84bcae253d',
    width: 3840,
  },
  {
    allowIntrabc: false,
    file: 'svt-skipped-intra-tx-size-512x512.avif',
    fileSha256: 'cb83f407f0c38253d98441d8c41781c0d91d02d9c8cda45e2d73efd5000f3df6',
    height: 512,
    initialFailure: 'symbol-overread',
    nativeYuvSha256: '6d947021026aa017dd40dbeafa842f71f3e015d428a57ad0ed0071f5b0f2cf15',
    rgbaSha256: 'f181140e5c9a4702d4c0b931ac638c83d5c7a1b5a08f85e5dd53e3e258c5e275',
    width: 512,
  },
] as const satisfies readonly AvifStillPictureEntropyFixture[]

export const avifStillPictureEntropyFixturePath = (
  fixture: AvifStillPictureEntropyFixture,
): string => join(avifCorpusDirectory, fixture.file)
