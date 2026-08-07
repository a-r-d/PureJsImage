import { allCodecs } from '../src/codec-entries/all.ts'
import { createImageLibrary } from '../src/index.ts'

export const Image = createImageLibrary(allCodecs)
