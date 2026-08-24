import type { ImageLibraryRegistration } from './accelerator.ts'
import {
  createImageLibraryForPlatform,
  type Image as RuntimeImage,
  type ImageLibrary as RuntimeImageLibrary,
} from './image-core.ts'
import type { NodeImageLibraryOptions } from './node-options.ts'
import { createNodePlatform, nodePlatform } from './node-platform.ts'
import type { ImageInput } from './node-source.ts'

export type NodeImage = RuntimeImage<ImageInput, Buffer>
export type NodeImageLibrary = RuntimeImageLibrary<ImageInput, Buffer>

export const createNodeImageLibrary = (
  registration: ImageLibraryRegistration,
  options?: Readonly<NodeImageLibraryOptions>,
): NodeImageLibrary =>
  createImageLibraryForPlatform(
    registration,
    options === undefined ? nodePlatform : createNodePlatform(options),
  )
