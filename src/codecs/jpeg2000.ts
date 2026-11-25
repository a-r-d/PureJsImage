import type { ImageCodec } from '../codec.ts'
import { isJp2 } from './jpeg2000-signature.ts'

export const jpeg2000Codec: ImageCodec = {
  format: 'jp2',
  mimeTypes: ['image/jp2'],
  minimumBytes: 12,
  detect: isJp2,
  async metadata(source, limits) {
    const { readJpeg2000Metadata } = await import('./jpeg2000-metadata.ts')
    return readJpeg2000Metadata(source, limits)
  },
  async preservedMetadata(source, limits) {
    const { preservedJpeg2000Metadata } = await import('./jpeg2000-metadata.ts')
    return preservedJpeg2000Metadata(source, limits)
  },
  async createDecoder(source, limits) {
    const { createJpeg2000Decoder } = await import('./jpeg2000-decode.ts')
    return createJpeg2000Decoder(source, limits)
  },
}
