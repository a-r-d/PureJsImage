import { throwIfAborted } from '../abort.ts'
import { invalidInput } from '../errors.ts'
import { type ImageLimitOptions, resolveLimits } from '../limits.ts'
import { GifAnimationWriter, gifEncoderSettings } from './gif-encode.ts'
import { GifCompositor, parseGif } from './gif-pixels.ts'

export interface GifAnimationFrame {
  readonly index: number
  readonly durationMs: number
  readonly width: number
  readonly height: number
  /** Composited RGBA8 canvas as a viewer shows it. Valid until the next frame is requested. */
  readonly data: Uint8Array
}

export interface GifAnimation {
  readonly width: number
  readonly height: number
  readonly frameCount: number
  /** Repeat count; 0 repeats forever. */
  readonly loop: number
  frames(signal?: AbortSignal): AsyncIterable<GifAnimationFrame>
}

export interface OpenGifAnimationOptions {
  readonly limits?: ImageLimitOptions
}

/** Opens GIF bytes for frame-by-frame decoding. One canvas is reused for every frame. */
export const openGifAnimation = (
  bytes: Uint8Array,
  options: Readonly<OpenGifAnimationOptions> = {},
): GifAnimation => {
  const structure = parseGif(bytes, resolveLimits(options.limits))
  return {
    width: structure.width,
    height: structure.height,
    frameCount: structure.frames.length,
    loop: structure.loop,
    async *frames(signal?: AbortSignal): AsyncGenerator<GifAnimationFrame> {
      const compositor = new GifCompositor(bytes, structure)
      for (let index = 0; index < structure.frames.length; index += 1) {
        throwIfAborted(signal)
        const frame = compositor.drawNext()
        yield {
          index,
          durationMs: frame.delayCentiseconds * 10,
          width: structure.width,
          height: structure.height,
          data: compositor.canvas,
        }
      }
    },
  }
}

export interface GifAnimationInputFrame {
  /** Full-canvas RGBA8 pixels. Alpha below 128 is transparent. */
  readonly data: Uint8Array
  readonly durationMs: number
}

export interface EncodeGifAnimationOptions {
  readonly width: number
  readonly height: number
  /** Floyd-Steinberg strength from 0 to 1 for frames with over 256 colors. Defaults to 1. */
  readonly dither?: number
  /** Repeat count; 0 repeats forever. Defaults to 0. */
  readonly loop?: number
  readonly signal?: AbortSignal
}

/** Pull-based GIF output. The encoder holds one input frame and the decoder's canvas. */
export async function* encodeGifAnimation(
  frames: AsyncIterable<GifAnimationInputFrame> | Iterable<GifAnimationInputFrame>,
  options: Readonly<EncodeGifAnimationOptions>,
): AsyncGenerator<Uint8Array> {
  const settings = gifEncoderSettings({
    ...(options.dither === undefined ? {} : { dither: options.dither }),
    ...(options.loop === undefined ? {} : { loop: options.loop }),
  })
  const chunks: Uint8Array[] = []
  const writer = new GifAnimationWriter(
    { write: async (chunk) => void chunks.push(chunk) },
    options.width,
    options.height,
    settings,
  )
  const expected = options.width * options.height * 4
  let count = 0
  for await (const frame of frames) {
    throwIfAborted(options.signal)
    if (frame.data.byteLength !== expected) {
      throw invalidInput(`GIF frame ${count} must hold ${expected} RGBA8 bytes`)
    }
    const buffer = writer.frameBuffer()
    buffer.set(frame.data)
    await writer.addFrame(buffer, frame.durationMs)
    count += 1
    yield* chunks.splice(0)
  }
  await writer.finish()
  yield* chunks.splice(0)
}
