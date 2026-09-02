import { invalidInput, limitExceeded } from '../errors.ts'

const isExif = (segment: Uint8Array): boolean =>
  segment[0] === 0x45 &&
  segment[1] === 0x78 &&
  segment[2] === 0x69 &&
  segment[3] === 0x66 &&
  segment[4] === 0 &&
  segment[5] === 0

export type JpegExifColorSpace = 'srgb' | 'uncalibrated' | 'adobe-rgb' | 'other'

export interface JpegExifRenderingMetadata {
  readonly orientations: readonly number[]
  readonly colorSpaces: readonly JpegExifColorSpace[]
}

interface ParsedExif {
  readonly orientations: readonly number[]
  readonly colorSpaces: readonly JpegExifColorSpace[]
}

const parseJpegExif = (
  segment: Uint8Array,
  strict: boolean,
  includeColor: boolean,
): ParsedExif | undefined => {
  if (!isExif(segment)) return undefined
  const malformed = (message: string): ParsedExif | undefined => {
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

  const checkedIfdEntries = (
    relativeOffset: number,
    label: string,
  ): readonly number[] | undefined => {
    if (!Number.isSafeInteger(relativeOffset)) return undefined
    const ifd = tiff + relativeOffset
    const entries = read16(ifd)
    if (entries === undefined) return undefined
    if (entries > 4_096) {
      if (strict) throw limitExceeded(`JPEG Exif ${label} has too many entries`)
      return undefined
    }
    const end = ifd + 2 + entries * 12 + 4
    if (!Number.isSafeInteger(end) || end > segment.byteLength) return undefined
    return Object.freeze(Array.from({ length: entries }, (_, index) => ifd + 2 + index * 12))
  }

  const shortValue = (entry: number, label: string): number | undefined => {
    if (read16(entry + 2) !== 3 || read32(entry + 4) !== 1) {
      if (strict) throw invalidInput(`JPEG Exif ${label} field is malformed`)
      return undefined
    }
    return read16(entry + 8)
  }

  const pointerValue = (entry: number, label: string): number | undefined => {
    if (read16(entry + 2) !== 4 || read32(entry + 4) !== 1) {
      if (strict) throw invalidInput(`JPEG Exif ${label} pointer is malformed`)
      return undefined
    }
    const pointer = read32(entry + 8)
    if (pointer === undefined || checkedIfdEntries(pointer, label) === undefined) {
      if (strict) throw invalidInput(`JPEG Exif ${label} pointer is out of bounds`)
      return undefined
    }
    return pointer
  }

  const asciiValue = (entry: number, label: string): Uint8Array | undefined => {
    if (read16(entry + 2) !== 2) {
      if (strict) throw invalidInput(`JPEG Exif ${label} field type is malformed`)
      return undefined
    }
    const count = read32(entry + 4)
    if (count === undefined || count < 1) {
      if (strict) throw invalidInput(`JPEG Exif ${label} field count is malformed`)
      return undefined
    }
    const valueOffset = count <= 4 ? entry + 8 : tiff + (read32(entry + 8) ?? Number.NaN)
    const end = valueOffset + count
    if (
      !Number.isSafeInteger(valueOffset) ||
      !Number.isSafeInteger(end) ||
      end > segment.byteLength
    ) {
      if (strict) throw invalidInput(`JPEG Exif ${label} field offset is malformed`)
      return undefined
    }
    return segment.subarray(valueOffset, end)
  }

  if (read16(tiff + 2) !== 42) return malformed('JPEG Exif TIFF header is malformed')
  const relativeIfd = read32(tiff + 4)
  if (relativeIfd === undefined) return malformed('JPEG Exif orientation data is malformed')
  const ifdEntries = checkedIfdEntries(relativeIfd, 'IFD')
  if (!ifdEntries) return malformed('JPEG Exif IFD is malformed')
  const orientations: number[] = []
  const exifPointers: number[] = []
  for (const entry of ifdEntries) {
    const tag = read16(entry)
    if (tag === 0x0112) {
      const orientation = shortValue(entry, 'orientation')
      if (orientation === undefined || orientation < 1 || orientation > 8) {
        return malformed('JPEG Exif orientation value is malformed')
      }
      orientations.push(orientation)
    } else if (includeColor && tag === 0x8769) {
      const pointer = pointerValue(entry, 'color IFD')
      if (pointer === undefined) return undefined
      exifPointers.push(pointer)
    }
  }

  const colorSpaces: JpegExifColorSpace[] = []
  if (includeColor) {
    for (const exifPointer of exifPointers) {
      const exifEntries = checkedIfdEntries(exifPointer, 'color IFD')
      if (!exifEntries) return malformed('JPEG Exif color IFD is malformed')
      const interoperabilityPointers: number[] = []
      for (const entry of exifEntries) {
        const tag = read16(entry)
        if (tag === 0xa001) {
          const value = shortValue(entry, 'ColorSpace')
          if (value === undefined) return undefined
          colorSpaces.push(value === 1 ? 'srgb' : value === 0xffff ? 'uncalibrated' : 'other')
        } else if (tag === 0xa005) {
          const pointer = pointerValue(entry, 'interoperability IFD')
          if (pointer === undefined) return undefined
          interoperabilityPointers.push(pointer)
        }
      }
      for (const interoperabilityPointer of interoperabilityPointers) {
        const interoperabilityEntries = checkedIfdEntries(
          interoperabilityPointer,
          'interoperability IFD',
        )
        if (!interoperabilityEntries) {
          return malformed('JPEG Exif interoperability IFD is malformed')
        }
        for (const entry of interoperabilityEntries) {
          if (read16(entry) !== 0x0001) continue
          const value = asciiValue(entry, 'InteroperabilityIndex')
          if (value?.byteLength !== 4 || value[3] !== 0) {
            return malformed('JPEG Exif InteroperabilityIndex field is malformed')
          }
          const index = String.fromCharCode(value[0] ?? 0, value[1] ?? 0, value[2] ?? 0)
          colorSpaces.push(index === 'R98' ? 'srgb' : index === 'R03' ? 'adobe-rgb' : 'other')
        }
      }
    }
  }

  return Object.freeze({
    orientations: Object.freeze(orientations),
    colorSpaces: Object.freeze(colorSpaces),
  })
}

/** Parse the Exif orientation field used by JPEG metadata and exact-transcode validation. */
export const parseJpegExifOrientation = (segment: Uint8Array, strict = false): number | undefined =>
  parseJpegExif(segment, strict, false)?.orientations[0]

/** Parse rendering-relevant Exif declarations for exact-transcode policy. */
export const parseJpegExifRenderingMetadata = (
  segment: Uint8Array,
): JpegExifRenderingMetadata | undefined => parseJpegExif(segment, true, true)
