import type { ImageCodec } from './codec.ts'
import {
  createImageLibraryForPlatform,
  type Image as RuntimeImage,
  type ImageLibrary as RuntimeImageLibrary,
} from './image-core.ts'
import { nodePlatform } from './node-platform.ts'
import type { ImageInput } from './node-source.ts'

export type { ImageOpenOptions } from './image-core.ts'

export type Image = RuntimeImage<ImageInput, Buffer>
export type ImageLibrary = RuntimeImageLibrary<ImageInput, Buffer>

export const createImageLibrary = (codecs: Iterable<ImageCodec>): ImageLibrary =>
  createImageLibraryForPlatform(codecs, nodePlatform)
