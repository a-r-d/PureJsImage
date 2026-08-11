import type { AbortOptions } from './abort.ts'
import type { ImagePlatform } from './image-core.ts'
import type { ImageLimits } from './limits.ts'
import { browserRuntime } from './browser-runtime.ts'
import type { CollectedOutput } from './runtime.ts'
import { Uint8ArraySink } from './sink.ts'
import { createImageSource, type ImageInput, type ImageSource } from './source.ts'

export const browserPlatform: ImagePlatform<ImageInput, Uint8Array> = Object.freeze({
  runtime: browserRuntime,
  createImageSource(
    input: ImageInput,
    limits: ImageLimits,
    options?: Readonly<AbortOptions>,
  ): Promise<ImageSource> {
    return createImageSource(input, limits, options)
  },
  createCollectedOutput(): CollectedOutput<Uint8Array> {
    const sink = new Uint8ArraySink()
    return { sink, result: () => sink.toUint8Array() }
  },
})
