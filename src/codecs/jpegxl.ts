import type { DecoderOptions, ImageCodec } from '../codec.ts'
import type { ImageLimitOptions, ImageLimits } from '../limits.ts'
import { resolveLimits } from '../limits.ts'
import { createImageSource, type ImageInput, type ImageSource } from '../source.ts'
import {
  inspectJpegXlSource,
  JpegXlCodestreamSource,
  jpegXlContainerSignature,
  jpegXlRawSignature,
  type JpegXlStructure,
} from './jpegxl-container.ts'
import {
  decodeJpegXlSource,
  readJpegXlSourceInspectionMetadata,
  readJpegXlSourceMetadata,
} from './jpegxl-decode.ts'
import type { JpegXlLimitOptions, JpegXlLimits } from './jpegxl-limits.ts'
import { resolveJpegXlLimits } from './jpegxl-limits.ts'
import { createJpegDerivedJpegXlDecoder } from './jpegxl-vardct.ts'

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
  const source = await createImageSource(input, resolveLimits(options), options)
  return inspectJpegXlSource(source, resolveJpegXlLimits(options.jpegXlLimits), options)
}

const codestreamSource = async (
  source: ImageSource,
  limits: Readonly<JpegXlLimits>,
): Promise<Readonly<{ source: JpegXlCodestreamSource; limits: Readonly<JpegXlLimits> }>> =>
  Object.freeze({
    source: new JpegXlCodestreamSource(source, await inspectJpegXlSource(source, limits)),
    limits,
  })

/** Registered first-party JPEG XL codec with a bounded lossless Modular subset. */
export const jpegxlCodec: ImageCodec = Object.freeze({
  format: 'jpegxl',
  mimeTypes: ['image/jxl'],
  minimumBytes: jpegXlRawSignature.byteLength,
  detect(header: Uint8Array): boolean {
    return startsWith(header, jpegXlRawSignature) || startsWith(header, jpegXlContainerSignature)
  },
  async metadata(source: ImageSource, limits: ImageLimits, options: Readonly<DecoderOptions> = {}) {
    const logical = await codestreamSource(source, resolveJpegXlLimits())
    return readJpegXlSourceMetadata(logical.source, limits, options, logical.limits.maxHeaderBytes)
  },
  async createDecoder(
    source: ImageSource,
    limits: ImageLimits,
    options: Readonly<DecoderOptions> = {},
  ) {
    const logical = await codestreamSource(source, resolveJpegXlLimits())
    const inspection = await readJpegXlSourceInspectionMetadata(
      logical.source,
      limits,
      options,
      logical.limits.maxHeaderBytes,
    )
    if (inspection.encoding === 'vardct') {
      return createJpegDerivedJpegXlDecoder(source, limits, options)
    }
    return (
      await decodeJpegXlSource(logical.source, limits, options, logical.limits.maxHeaderBytes)
    ).decoder
  },
})
