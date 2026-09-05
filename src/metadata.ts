import { invalidInput } from './errors.ts'

const read16 = (data: Uint8Array, offset: number, littleEndian: boolean): number | undefined => {
  const first = data[offset]
  const second = data[offset + 1]
  if (first === undefined || second === undefined) return undefined
  return littleEndian ? first + second * 256 : first * 256 + second
}

const read32 = (data: Uint8Array, offset: number, littleEndian: boolean): number | undefined => {
  const first = read16(data, offset, littleEndian)
  const second = read16(data, offset + 2, littleEndian)
  if (first === undefined || second === undefined) return undefined
  return littleEndian ? first + second * 65_536 : first * 65_536 + second
}

export const exifOrientation = (exif: Uint8Array): number | undefined => {
  const littleEndian = exif[0] === 0x49 && exif[1] === 0x49
  const bigEndian = exif[0] === 0x4d && exif[1] === 0x4d
  if (!littleEndian && !bigEndian) return undefined
  if (read16(exif, 2, littleEndian) !== 42) return undefined
  const relativeIfd = read32(exif, 4, littleEndian)
  if (relativeIfd === undefined || relativeIfd + 2 > exif.byteLength) return undefined
  const entries = read16(exif, relativeIfd, littleEndian)
  if (entries === undefined || entries > 4_096) return undefined
  for (let index = 0; index < entries; index += 1) {
    const entry = relativeIfd + 2 + index * 12
    if (entry + 12 > exif.byteLength) return undefined
    if (
      read16(exif, entry, littleEndian) !== 0x0112 ||
      read16(exif, entry + 2, littleEndian) !== 3 ||
      read32(exif, entry + 4, littleEndian) !== 1
    ) {
      continue
    }
    const orientation = read16(exif, entry + 8, littleEndian)
    return orientation !== undefined && orientation >= 1 && orientation <= 8
      ? orientation
      : undefined
  }
  return undefined
}

export const normalizeExifOrientation = (
  exif: Uint8Array,
  output: Uint8Array = new Uint8Array(exif.byteLength),
): Uint8Array => {
  if (output.byteLength !== exif.byteLength)
    throw invalidInput('EXIF scratch length must match input')
  output.set(exif)
  const littleEndian = output[0] === 0x49 && output[1] === 0x49
  const bigEndian = output[0] === 0x4d && output[1] === 0x4d
  if (!littleEndian && !bigEndian) throw invalidInput('Preserved EXIF byte order is invalid')
  if (read16(output, 2, littleEndian) !== 42)
    throw invalidInput('Preserved EXIF TIFF header is invalid')
  const relativeIfd = read32(output, 4, littleEndian)
  if (relativeIfd === undefined || relativeIfd + 2 > output.byteLength)
    throw invalidInput('Preserved EXIF IFD is out of bounds')
  const entries = read16(output, relativeIfd, littleEndian)
  if (entries === undefined || entries > 4_096)
    throw invalidInput('Preserved EXIF IFD entry count is invalid')
  for (let index = 0; index < entries; index += 1) {
    const entry = relativeIfd + 2 + index * 12
    if (entry + 12 > output.byteLength) throw invalidInput('Preserved EXIF IFD is truncated')
    if (
      read16(output, entry, littleEndian) !== 0x0112 ||
      read16(output, entry + 2, littleEndian) !== 3 ||
      read32(output, entry + 4, littleEndian) !== 1
    ) {
      continue
    }
    if (littleEndian) {
      output[entry + 8] = 1
      output[entry + 9] = 0
    } else {
      output[entry + 8] = 0
      output[entry + 9] = 1
    }
    return output
  }
  return output
}

export const iccColorSpace = (profile: Uint8Array): 'gray' | 'rgb' | 'other' => {
  if (profile.byteLength < 20) throw invalidInput('Preserved ICC profile is truncated')
  const signature = String.fromCharCode(
    profile[16] ?? 0,
    profile[17] ?? 0,
    profile[18] ?? 0,
    profile[19] ?? 0,
  )
  if (signature === 'GRAY') return 'gray'
  if (signature === 'RGB ') return 'rgb'
  return 'other'
}
