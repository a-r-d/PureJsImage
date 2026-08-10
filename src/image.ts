import type { ImageLibraryRegistration } from './accelerator.ts'
import type { Image as RuntimeImage, ImageLibrary as RuntimeImageLibrary } from './image-core.ts'
import { createNodeImageLibrary } from './node-image.ts'
import type { ImageInput } from './node-source.ts'

export type { ImageOpenOptions } from './image-core.ts'

export type Image = RuntimeImage<ImageInput, Uint8Array>
export type ImageLibrary = RuntimeImageLibrary<ImageInput, Uint8Array>

export const createImageLibrary = (registration: ImageLibraryRegistration): ImageLibrary =>
  createNodeImageLibrary(registration)
