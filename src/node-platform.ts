import type { AbortOptions } from './abort.ts'
import type { ImagePlatform } from './image-core.ts'
import type { ImageLimits } from './limits.ts'
import { createNodeRuntime, type NodeRuntimeOptions, nodeRuntime } from './node-runtime.ts'
import { BufferSink, FileSink } from './node-sink.ts'
import { createImageSource, type ImageInput } from './node-source.ts'
import type { CollectedOutput } from './runtime.ts'
import type { ImageSource } from './source.ts'

const createPlatform = (
  runtime: ReturnType<typeof createNodeRuntime>,
): ImagePlatform<ImageInput, Buffer> =>
  Object.freeze({
    runtime,
    createImageSource(
      input: ImageInput,
      limits: ImageLimits,
      options?: Readonly<AbortOptions>,
    ): Promise<ImageSource> {
      return createImageSource(input, limits, options)
    },
    createCollectedOutput(): CollectedOutput<Buffer> {
      const sink = new BufferSink()
      return {
        sink,
        result: () => {
          const data = sink.toBuffer()
          return Buffer.from(data.buffer, data.byteOffset, data.byteLength)
        },
      }
    },
    createFileSink(path: string): FileSink {
      return new FileSink(path)
    },
  })

export const createNodePlatform = (
  options: Readonly<NodeRuntimeOptions> = {},
): ImagePlatform<ImageInput, Buffer> => createPlatform(createNodeRuntime(options))

export const nodePlatform: ImagePlatform<ImageInput, Buffer> = createPlatform(nodeRuntime)
