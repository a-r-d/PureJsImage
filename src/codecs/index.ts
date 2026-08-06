import { CodecRegistry } from '../codec.ts'
import { gifCodec } from './gif.ts'
import { jpegCodec } from './jpeg.ts'
import { pngCodec } from './png.ts'

export const createDefaultCodecRegistry = (): CodecRegistry =>
  new CodecRegistry([jpegCodec, pngCodec, gifCodec])

export { gifCodec, jpegCodec, pngCodec }
