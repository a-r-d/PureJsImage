import type { ImageLibraryRegistration } from './accelerator.ts'
import {
  createImageLibraryForPlatform,
  type Image as RuntimeImage,
  type ImageLibrary as RuntimeImageLibrary,
} from './image-core.ts'
import { nodePlatform } from './node-platform.ts'
import type { ImageInput } from './node-source.ts'

export type NodeImage = RuntimeImage<ImageInput, Buffer>
export type NodeImageLibrary = RuntimeImageLibrary<ImageInput, Buffer>

export const createNodeImageLibrary = (registration: ImageLibraryRegistration): NodeImageLibrary =>
  createImageLibraryForPlatform(registration, nodePlatform)
