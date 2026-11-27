import { type ImageLibraryRegistration, resolveLibraryRegistration } from './accelerator.ts'
import type { ImageCodec } from './codec.ts'
import type { PngInflater } from './codecs/png.ts'
import {
  createImageLibraryForPlatform,
  type Image as RuntimeImage,
  type ImageLibrary as RuntimeImageLibrary,
} from './image-core.ts'
import type { NodeImageLibraryOptions } from './node-options.ts'
import { createNodePlatform, nodePlatform } from './node-platform.ts'
import { inflatePng } from './node-runtime.ts'
import type { ImageInput } from './node-source.ts'

export type NodeImage = RuntimeImage<ImageInput, Buffer>
export type NodeImageLibrary = RuntimeImageLibrary<ImageInput, Buffer>

const bindInflater = (
  codec: ImageCodec & {
    withPngInflater?: (inflate: PngInflater) => ImageCodec
  },
): ImageCodec =>
  codec.format === 'png' && typeof codec.withPngInflater === 'function'
    ? codec.withPngInflater(inflatePng)
    : codec

export const createNodeImageLibrary = (
  registration: ImageLibraryRegistration,
  options?: Readonly<NodeImageLibraryOptions>,
): NodeImageLibrary => {
  const { codecs, resize } = resolveLibraryRegistration(registration)
  return createImageLibraryForPlatform(
    { codecs: codecs.map(bindInflater), ...(resize && { accelerators: [resize] }) },
    options === undefined ? nodePlatform : createNodePlatform(options),
  )
}
