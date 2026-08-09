import { allCodecs } from '../src/codec-entries/all.ts'
import type { ImageCodec, ImageInput, ImageOpenOptions } from '../src/index.ts'
import { createNodeImageLibrary, type NodeImageLibrary } from '../src/node-image.ts'
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

export const createTestImageLibrary = (codecs: Iterable<ImageCodec>): NodeImageLibrary => {
  const library = createNodeImageLibrary(codecs)
  return Object.freeze({
    formats: (): readonly string[] => library.formats(),
    open: (input: ImageInput, options?: ImageOpenOptions) =>
      library.open(wrapInput(input), options),
  })
}

export const Image = createTestImageLibrary(allCodecs)
