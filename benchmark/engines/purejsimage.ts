import { createPureJsImageEngine } from './purejsimage-shared.ts'

export const engine = await createPureJsImageEngine({
  id: 'purejsimage',
  kind: 'pure-javascript',
  versionSuffix: '',
})
