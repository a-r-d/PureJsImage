import type { ImageCodec } from '../codec.ts'
import { avifCodec } from '../codecs/avif.ts'
import { bmpCodec } from '../codecs/bmp.ts'
import { gifCodec } from '../codecs/gif.ts'
import { heifCodec } from '../codecs/heif.ts'
import { icoCodec } from '../codecs/ico.ts'
import { jpegCodec } from '../codecs/jpeg.ts'
import { pngCodec } from '../codecs/png.ts'
import { tiffCodec } from '../codecs/tiff.ts'
import { webpCodec } from '../codecs/webp.ts'

export const allCodecs: readonly ImageCodec[] = Object.freeze([
  jpegCodec,
  pngCodec,
  gifCodec,
  webpCodec,
  avifCodec,
  heifCodec,
  bmpCodec,
  icoCodec,
  tiffCodec,
])
