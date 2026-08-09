import type { ImageCodec } from '../codec.ts'
import { avifCodec } from '../codecs/avif.ts'
import { bmpCodec } from '../codecs/bmp.ts'
import { gifCodec } from '../codecs/gif.ts'
import { icoCodec } from '../codecs/ico.ts'
import { jpegCodec } from '../codecs/jpeg.ts'
import { jpeg2000Codec } from '../codecs/jpeg2000.ts'
import { pngCodec } from '../codecs/png.ts'
import { tiffCodec } from '../codecs/tiff.ts'
import { webpCodec } from '../codecs/webp.ts'

/**
 * Default codec set. Experimental HEIF/HEIC is intentionally excluded and must
 * remain available only through its explicit package entry.
 */
export const allCodecs: readonly ImageCodec[] = Object.freeze([
  jpegCodec,
  jpeg2000Codec,
  pngCodec,
  gifCodec,
  webpCodec,
  avifCodec,
  bmpCodec,
  icoCodec,
  tiffCodec,
])
