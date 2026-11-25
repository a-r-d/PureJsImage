import type { DecoderOptions, ImageCodec, MetadataPreservationOptions } from '../codec.ts'
import type { ImageLimitOptions, ImageLimits } from '../limits.ts'
import type { ImageInput, ImageSource } from '../source.ts'
import { createJpegXlDecoder, createJpegXlEncoder } from './jpegxl-codec-operations.ts'
import { acceptsJpegXlFloatColorSemantics } from './jpegxl-color-semantics.ts'
import type { JpegXlStructure } from './jpegxl-container.ts'
import type { JpegXlLimitOptions } from './jpegxl-limits.ts'
import { jpegXlRawSignature, jpegXlContainerSignature } from './jpegxl-signature.ts'

export type {
  JpegXlBoxSummary,
  JpegXlCodestreamSegment,
  JpegXlStructure,
} from './jpegxl-container.ts'

const startsWith = (data: Uint8Array, signature: Uint8Array): boolean =>
  data.byteLength >= signature.byteLength &&
  signature.every((value, index) => data[index] === value)

export interface InspectJpegXlStructureOptions extends Readonly<ImageLimitOptions> {
  readonly jpegXlLimits?: Readonly<JpegXlLimitOptions>
  readonly signal?: AbortSignal
}

export const inspectJpegXlStructure = async (
  input: ImageInput,
  options: Readonly<InspectJpegXlStructureOptions> = {},
): Promise<JpegXlStructure> => {
  const { inspectJpegXlInput } = await import('./jpegxl-container.ts')
  return inspectJpegXlInput(input, options)
}

/**
 * Registered first-party JPEG XL codec with a bounded lossless Modular subset. The VarDCT,
 * sequence, native-sample and encoder paths hold most of the JPEG XL code, so they load on first
 * use. Registering this codec, for example through `allCodecs`, then costs little memory when no
 * JPEG XL image is decoded or encoded.
 */
export const jpegxlCodec: ImageCodec = Object.freeze({
  format: 'jpegxl',
  mimeTypes: ['image/jxl'],
  minimumBytes: jpegXlRawSignature.byteLength,
  selection: { frames: true, resolutionLevels: false },
  encoderPixelFormats: [
    'gray8',
    'gray16',
    'rgb8',
    'rgb16',
    'rgba8',
    'rgba16',
    'grayf32',
    'rgbf32',
    'rgbaf32',
    'gray32',
    'rgb32',
  ] as const,
  acceptsColorSemantics: acceptsJpegXlFloatColorSemantics,
  detect(header: Uint8Array): boolean {
    return startsWith(header, jpegXlRawSignature) || startsWith(header, jpegXlContainerSignature)
  },
  async metadata(source: ImageSource, limits: ImageLimits, options: Readonly<DecoderOptions> = {}) {
    const { readJpegXlCodecMetadata } = await import('./jpegxl-codec-decoder.ts')
    return readJpegXlCodecMetadata(source, limits, options)
  },
  async preservedMetadata(
    source: ImageSource,
    limits: ImageLimits,
    options: Readonly<MetadataPreservationOptions> = { exif: true, icc: true },
  ) {
    const { preserveJpegXlCodecMetadata } = await import('./jpegxl-codec-decoder.ts')
    return preserveJpegXlCodecMetadata(source, limits, options)
  },
  createDecoder: createJpegXlDecoder,
  createEncoder: createJpegXlEncoder,
})
