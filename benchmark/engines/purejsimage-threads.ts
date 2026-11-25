import { createPureJsImageEngine } from './purejsimage-shared.ts'

export const engine = await createPureJsImageEngine({
  id: 'purejsimage-threads',
  threads: 4,
  kind: 'pure-javascript',
  versionSuffix: ', up to 4 threads',
})
