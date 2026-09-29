import { throwIfAborted } from '../../../src/abort.ts'
import type { ImageCodec, ImageDecoder } from '../../../src/codec.ts'
import { defaultImageLimits } from '../../../src/limits.ts'
import type { PixelFormat } from '../../../src/pixel.ts'
import { MemorySource } from '../../../src/source.ts'
import { planJpegXlWorkbenchNativeMemory } from './jpegxl-workbench-types.ts'

type EncoderPixelFormat = 'gray8' | 'gray16' | 'rgb8' | 'rgb16' | 'rgba8' | 'rgba16'

interface NativePixels {
  readonly width: number
  readonly height: number
  readonly format: EncoderPixelFormat
  readonly pixels: Uint8Array
  readonly decoder: ImageDecoder
}

export const encoderPixelFormat = (format: PixelFormat): format is EncoderPixelFormat =>
  format === 'gray8' ||
  format === 'gray16' ||
  format === 'rgb8' ||
  format === 'rgb16' ||
  format === 'rgba8' ||
  format === 'rgba16'

export const channelCount = (format: EncoderPixelFormat): 1 | 3 | 4 =>
  format.startsWith('gray') ? 1 : format.startsWith('rgba') ? 4 : 3

export const nativePixels = async (
  codec: ImageCodec,
  data: Uint8Array,
  signal: AbortSignal,
): Promise<NativePixels> => {
  const decoder = await codec.createDecoder?.(new MemorySource(data), defaultImageLimits, {
    signal,
  })
  if (!decoder) throw new Error(`${codec.format} decoder is unavailable`)
  if (!encoderPixelFormat(decoder.pixelFormat)) {
    throw new Error(`Pixel-lossless JPEG XL encode does not support ${decoder.pixelFormat}`)
  }
  const format = decoder.pixelFormat
  const memoryPlan = planJpegXlWorkbenchNativeMemory(decoder.width, decoder.height, format)
  const sampleBytes = format.endsWith('16') ? 2 : 1
  const pixels = new Uint8Array(memoryPlan.nativePixelBytes)
  for await (const block of decoder.decode({ signal })) {
    try {
      throwIfAborted(signal)
      if (block.format !== format) throw new Error('Decoder changed pixel format between blocks')
      const blockRowBytes = block.width * channelCount(format) * sampleBytes
      for (let row = 0; row < block.height; row += 1) {
        pixels.set(
          block.data.subarray(row * block.stride, row * block.stride + blockRowBytes),
          ((block.y + row) * decoder.width + block.x) * channelCount(format) * sampleBytes,
        )
      }
    } finally {
      block.release?.()
    }
  }
  return Object.freeze({ width: decoder.width, height: decoder.height, format, pixels, decoder })
}
