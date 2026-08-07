import { CodecRegistry } from '../codec.ts'
import { avifCodec } from './avif.ts'
import { bmpCodec } from './bmp.ts'
import { gifCodec } from './gif.ts'
import { jpegCodec } from './jpeg.ts'
import { pngCodec } from './png.ts'
import { webpCodec } from './webp.ts'

export const createDefaultCodecRegistry = (): CodecRegistry =>
  new CodecRegistry([jpegCodec, pngCodec, gifCodec, webpCodec, avifCodec, bmpCodec])

export { avifCodec, bmpCodec, gifCodec, jpegCodec, pngCodec, webpCodec }
