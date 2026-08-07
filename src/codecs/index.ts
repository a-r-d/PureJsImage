import { CodecRegistry } from '../codec.ts'
import { avifCodec } from './avif.ts'
import { bmpCodec } from './bmp.ts'
import { gifCodec } from './gif.ts'
import { heicCodec, heifCodec } from './heif.ts'
import { jpegCodec } from './jpeg.ts'
import { pngCodec } from './png.ts'
import { tiffCodec } from './tiff.ts'
import { webpCodec } from './webp.ts'

export const createDefaultCodecRegistry = (): CodecRegistry =>
  new CodecRegistry([
    jpegCodec,
    pngCodec,
    gifCodec,
    webpCodec,
    avifCodec,
    heifCodec,
    bmpCodec,
    tiffCodec,
  ])

export {
  avifCodec,
  bmpCodec,
  gifCodec,
  heicCodec,
  heifCodec,
  jpegCodec,
  pngCodec,
  tiffCodec,
  webpCodec,
}
