import { createPureJsImageEngine } from './purejsimage-shared.ts'

export const engine = await createPureJsImageEngine({
  id: 'purejsimage-experimental-heic',
  kind: 'pure-javascript',
  versionSuffix: ' experimental HEIC',
  codecs: [
    {
      path: './codec-entries/experimental/heic.js',
      exportName: 'experimentalHeifCodec',
    },
  ],
})
