import type { ImageCodec } from '../codec.ts'
import { avifCodec } from '../codecs/avif.ts'
import { jpegCodec } from '../codecs/jpeg.ts'
import { pngCodec } from '../codecs/png.ts'
import { webpCodec } from '../codecs/webp.ts'

/**
 * Common web codec set. TIFF and less common formats remain available through
 * their explicit codec entries or `purejsimage/codecs/all`.
 */
export const allWebCodecs: readonly ImageCodec[] = Object.freeze([
  jpegCodec,
  pngCodec,
  webpCodec,
  avifCodec,
])
