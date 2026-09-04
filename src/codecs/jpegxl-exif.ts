import { invalidInput, limitExceeded } from '../errors.ts'

export interface JpegXlExifSummary {
  readonly pixelDensity?: Readonly<{ x: number; y: number; unit: 'inch' | 'centimeter' }>
  readonly timestamps?: Readonly<{ modified?: string; original?: string; digitized?: string }>
}

/** Extract only bounded density and timestamp fields from the primary and Exif IFDs. */
export const summarizeJpegXlExif = (bytes: Uint8Array): JpegXlExifSummary => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const little = bytes[0] === 0x49 && bytes[1] === 0x49
  const big = bytes[0] === 0x4d && bytes[1] === 0x4d
  if (bytes.length < 8 || (!little && !big) || view.getUint16(2, little) !== 42)
    throw invalidInput('JPEG XL Exif TIFF header is invalid')
  const extent = (offset: number, length: number): void => {
    if (
      !Number.isSafeInteger(offset) ||
      !Number.isSafeInteger(length) ||
      offset < 0 ||
      length < 0 ||
      offset > bytes.length - length
    )
      throw invalidInput('JPEG XL Exif field exceeds its payload')
  }
  const pending = [view.getUint32(4, little)]
  const visited = new Set<number>()
  const timestamps: { modified?: string; original?: string; digitized?: string } = {}
  let x: number | undefined
  let y: number | undefined
  let unit: 'inch' | 'centimeter' | undefined
  while (pending.length > 0) {
    const offset = pending.pop()
    if (offset === undefined || offset === 0) continue
    if (visited.has(offset)) throw invalidInput('JPEG XL Exif IFD cycle is invalid')
    visited.add(offset)
    if (visited.size > 2) throw limitExceeded('JPEG XL Exif summary exceeds its IFD budget')
    extent(offset, 2)
    const count = view.getUint16(offset, little)
    if (count > 4096) throw limitExceeded('JPEG XL Exif summary exceeds its field budget')
    extent(offset + 2, count * 12 + 4)
    for (let index = 0; index < count; index += 1) {
      const entry = offset + 2 + index * 12
      const tag = view.getUint16(entry, little)
      const type = view.getUint16(entry + 2, little)
      const elements = view.getUint32(entry + 4, little)
      const value = view.getUint32(entry + 8, little)
      if (tag === 0x8769 && type === 4 && elements === 1) pending.push(value)
      else if ((tag === 0x11a || tag === 0x11b) && type === 5 && elements === 1) {
        extent(value, 8)
        const denominator = view.getUint32(value + 4, little)
        const numerator = view.getUint32(value, little)
        if (denominator === 0 || numerator === 0)
          throw invalidInput('JPEG XL Exif density is invalid')
        if (tag === 0x11a) x = numerator / denominator
        else y = numerator / denominator
      } else if (tag === 0x128 && type === 3 && elements === 1) {
        const encodedUnit = view.getUint16(entry + 8, little)
        unit = encodedUnit === 2 ? 'inch' : encodedUnit === 3 ? 'centimeter' : undefined
      } else if ((tag === 0x132 || tag === 0x9003 || tag === 0x9004) && type === 2) {
        if (elements !== 20) throw invalidInput('JPEG XL Exif timestamp must contain 20 bytes')
        extent(value, elements)
        const text = String.fromCharCode(...bytes.subarray(value, value + 19))
        if (
          bytes[value + 19] !== 0 ||
          !/^\d{4}:(0[1-9]|1[0-2]):(0[1-9]|[12]\d|3[01]) ([01]\d|2[0-3]):[0-5]\d:[0-5]\d$/.test(
            text,
          )
        )
          throw invalidInput('JPEG XL Exif timestamp is invalid')
        if (tag === 0x132) timestamps.modified = text
        else if (tag === 0x9003) timestamps.original = text
        else timestamps.digitized = text
      }
    }
  }
  return Object.freeze({
    ...(x === undefined || y === undefined || unit === undefined
      ? {}
      : { pixelDensity: Object.freeze({ x, y, unit }) }),
    ...(Object.keys(timestamps).length === 0 ? {} : { timestamps: Object.freeze(timestamps) }),
  })
}
