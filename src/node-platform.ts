import type { ImagePlatform } from './image-core.ts'
import type { ImageLimits } from './limits.ts'
import { nodeRuntime } from './node-runtime.ts'
import { BufferSink, FileSink } from './node-sink.ts'
import { createImageSource, type ImageInput } from './node-source.ts'
import type { CollectedOutput } from './runtime.ts'
import type { ImageSource } from './source.ts'

export const nodePlatform: ImagePlatform<ImageInput, Buffer> = Object.freeze({
  runtime: nodeRuntime,
  createImageSource(input: ImageInput, limits: ImageLimits): Promise<ImageSource> {
    return createImageSource(input, limits)
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
