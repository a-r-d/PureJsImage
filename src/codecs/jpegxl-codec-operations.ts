import type { DecoderOptions, EncodeRequest, ImageDecoder, ImageEncoder } from '../codec.ts'
import type { ImageLimits } from '../limits.ts'
import type { ImageSink } from '../sink.ts'
import type { ImageSource } from '../source.ts'

export const createJpegXlDecoder = async (
  source: ImageSource,
  limits: ImageLimits,
  options: Readonly<DecoderOptions> = {},
): Promise<ImageDecoder> => {
  const { createJpegXlCodecDecoder } = await import('./jpegxl-codec-decoder.ts')
  return createJpegXlCodecDecoder(source, limits, options)
}

export const createJpegXlEncoder = async (
  sink: ImageSink,
  input: EncodeRequest,
): Promise<ImageEncoder> => {
  const { createJpegXlCodecEncoder } = await import('./jpegxl-codec-encoder.ts')
  return createJpegXlCodecEncoder(sink, input)
}
