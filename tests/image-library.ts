import { allCodecs } from '../src/codec-entries/all.ts'
import {
  createImageLibrary,
  type ImageCodec,
  type ImageInput,
  type ImageLibrary,
  type ImageOpenOptions,
} from '../src/index.ts'
import { BufferedSource } from '../src/source.ts'
import { HostileSource } from './hostile-source.ts'

const hostileSources = process.env.PUREJSIMAGE_HOSTILE_SOURCE === '1'

const wrapInput = (input: ImageInput): ImageInput => {
  if (!hostileSources) return input
  if (input instanceof Uint8Array) return new BufferedSource(new HostileSource(input), 1)
  if (input instanceof ArrayBuffer) {
    return new BufferedSource(new HostileSource(new Uint8Array(input)), 1)
  }
  return input
}

export const createTestImageLibrary = (codecs: Iterable<ImageCodec>): ImageLibrary => {
  const library = createImageLibrary(codecs)
  return Object.freeze({
    formats: (): readonly string[] => library.formats(),
    open: (input: ImageInput, options?: ImageOpenOptions) =>
      library.open(wrapInput(input), options),
  })
}

export const Image = createTestImageLibrary(allCodecs)
