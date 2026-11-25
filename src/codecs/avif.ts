import type { ImageCodec } from '../codec.ts'
import type { ImageLimits } from '../limits.ts'
import type { ImageSource } from '../source.ts'
import type { AvifGainMapDecoderComponents } from './avif-decode.ts'
import type { AvifBitstreamInspection } from './avif-metadata.ts'
import { detectIsobmffBrands } from './isobmff-brands.ts'

export { validateAvifWorkingBytes, validateAvifFrameDimensions } from './avif-validation.ts'
export type {
  NclxColor,
  AvifGainMapMetadata,
  AvifGridDescription,
  AvifGainMapGridInspection,
  AvifGainMapInspection,
  AvifCodedImageInspection,
  AvifAlphaAssociation,
  AvifBitstreamInspection,
} from './avif-metadata.ts'
export type { AvifGainMapDecoderComponents } from './avif-decode.ts'
export const inspectAvifBitstreams = async (
  source: ImageSource,
): Promise<AvifBitstreamInspection> => {
  const implementation = await import('./avif-metadata.ts')
  return implementation.inspectAvifBitstreams(source)
}
export const createAvifGainMapDecoderComponents = async (
  source: ImageSource,
  limits: ImageLimits,
): Promise<AvifGainMapDecoderComponents> => {
  const implementation = await import('./avif-decode.ts')
  return implementation.createAvifGainMapDecoderComponents(source, limits)
}

export const avifCodec: ImageCodec = {
  format: 'avif',
  mimeTypes: ['image/avif'],
  minimumBytes: 32,
  selection: { frames: true, resolutionLevels: false },
  detect(header) {
    return detectIsobmffBrands(header).some((brand) => brand === 'avif' || brand === 'avis')
  },
  async metadata(source, limits, options) {
    const { inspectAvif } = await import('./avif-metadata.ts')
    return inspectAvif(source, limits, options)
  },
  async preservedMetadata(source, limits, options) {
    const { preservedAvifMetadata } = await import('./avif-metadata.ts')
    return preservedAvifMetadata(source, limits, options)
  },
  // The AV1 encoder loads on first encode, so registering this codec does not load it.
  async createEncoder(sink, request) {
    const { createAvifEncoder } = await import('./avif-encode.ts')
    return createAvifEncoder(sink, request)
  },
  async createDecoder(source, limits, options) {
    const { createAvifDecoder } = await import('./avif-decode.ts')
    return createAvifDecoder(source, limits, options)
  },
}
