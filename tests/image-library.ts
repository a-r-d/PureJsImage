import { allCodecs } from '../src/codec-entries/all.ts'
import {
  createImageLibrary,
  type ImageInput,
  type ImageLibrary,
  type ImageOpenOptions,
} from '../src/index.ts'
import { HostileSource } from './hostile-source.ts'

const library = createImageLibrary(allCodecs)
const hostileSources = process.env.PUREJSIMAGE_HOSTILE_SOURCE === '1'

const wrapInput = (input: ImageInput): ImageInput => {
  if (!hostileSources) return input
  if (input instanceof Uint8Array) return new HostileSource(input)
  if (input instanceof ArrayBuffer) return new HostileSource(new Uint8Array(input))
  return input
}

export const Image: ImageLibrary = Object.freeze({
  formats: (): readonly string[] => library.formats(),
  open: (input: ImageInput, options?: ImageOpenOptions) => library.open(wrapInput(input), options),
})
