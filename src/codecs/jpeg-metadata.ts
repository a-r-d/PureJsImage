import { invalidInput, limitExceeded } from '../errors.ts'

const isExif = (segment: Uint8Array): boolean =>
  segment[0] === 0x45 &&
  segment[1] === 0x78 &&
  segment[2] === 0x69 &&
  segment[3] === 0x66 &&
  segment[4] === 0 &&
  segment[5] === 0

/** Parse the Exif orientation field used by JPEG metadata and exact-transcode validation. */
export const parseJpegExifOrientation = (
  segment: Uint8Array,
  strict = false,
): number | undefined => {
  if (!isExif(segment)) return undefined
  const malformed = (message: string): undefined => {
    if (strict) throw invalidInput(message)
    return undefined
  }
  if (segment.byteLength < 14) return malformed('JPEG Exif orientation data is malformed')

  const tiff = 6
  const littleEndian = segment[tiff] === 0x49 && segment[tiff + 1] === 0x49
  const bigEndian = segment[tiff] === 0x4d && segment[tiff + 1] === 0x4d
  if (!littleEndian && !bigEndian) return malformed('JPEG Exif byte order is malformed')

  const read16 = (offset: number): number | undefined => {
    const first = segment[offset]
    const second = segment[offset + 1]
    if (first === undefined || second === undefined) return undefined
    return littleEndian ? first + second * 256 : first * 256 + second
  }
  const read32 = (offset: number): number | undefined => {
    const first = read16(offset)
    const second = read16(offset + 2)
    if (first === undefined || second === undefined) return undefined
    return littleEndian ? first + second * 65_536 : first * 65_536 + second
  }

  if (read16(tiff + 2) !== 42) return malformed('JPEG Exif TIFF header is malformed')
  const relativeIfd = read32(tiff + 4)
  if (relativeIfd === undefined) return malformed('JPEG Exif orientation data is malformed')
  const ifd = tiff + relativeIfd
  const entries = read16(ifd)
  if (entries === undefined) return malformed('JPEG Exif orientation data is malformed')
  if (entries > 4_096) {
    if (strict) throw limitExceeded('JPEG Exif IFD has too many entries')
    return undefined
  }

  for (let index = 0; index < entries; index += 1) {
    const entry = ifd + 2 + index * 12
    if (entry + 12 > segment.byteLength) {
      return malformed('JPEG Exif orientation data is malformed')
    }
    if (read16(entry) !== 0x0112) continue
    if (read16(entry + 2) !== 3 || read32(entry + 4) !== 1) {
      return malformed('JPEG Exif orientation field is malformed')
    }
    const orientation = read16(entry + 8)
    if (orientation === undefined || orientation < 1 || orientation > 8) {
      return malformed('JPEG Exif orientation value is malformed')
    }
    return orientation
  }
  return undefined
}
