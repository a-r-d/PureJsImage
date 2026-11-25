import { invalidInput, truncatedInput } from '../errors.ts'

export const byte = (data: ArrayLike<number>, index: number): number => data[index] ?? 0

export const readUint16 = (data: Uint8Array, offset: number): number => {
  if (offset < 0 || offset + 2 > data.byteLength) throw truncatedInput('JPEG segment is truncated')
  return byte(data, offset) * 256 + byte(data, offset + 1)
}

export const segmentEnd = (data: Uint8Array, offset: number): number => {
  const length = readUint16(data, offset)
  if (length < 2) throw invalidInput('JPEG segment length is invalid')
  if (offset + length > data.byteLength) throw truncatedInput('JPEG segment is truncated')
  return offset + length
}

export interface JpegCodestreamInspection {
  readonly sofMarker: number
  readonly precision: number
  readonly width: number
  readonly height: number
  readonly componentCount: number
  readonly eoiOffset: number
  readonly trailingByteCount: number
}

const isStartOfFrameMarker = (marker: number): boolean =>
  marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc

const scanJpegEntropy = (
  data: Uint8Array,
  start: number,
):
  | { readonly marker: number; readonly markerOffset: number; readonly afterMarker: number }
  | undefined => {
  let offset = start
  while (offset < data.byteLength) {
    if (byte(data, offset) !== 0xff) {
      offset += 1
      continue
    }
    offset += 1
    while (offset < data.byteLength && byte(data, offset) === 0xff) offset += 1
    if (offset >= data.byteLength) return undefined
    const marker = byte(data, offset)
    const markerOffset = offset - 1
    offset += 1
    if (marker === 0x00 || (marker >= 0xd0 && marker <= 0xd7)) continue
    return { marker, markerOffset, afterMarker: offset }
  }
  return undefined
}

export const inspectJpegCodestream = (data: Uint8Array): JpegCodestreamInspection => {
  if (data.byteLength < 4 || byte(data, 0) !== 0xff || byte(data, 1) !== 0xd8) {
    throw invalidInput('JPEG start marker is missing')
  }
  let offset = 2
  let sofMarker: number | undefined
  let precision = 0
  let width = 0
  let height = 0
  let componentCount = 0
  let eoiOffset = -1

  while (offset + 1 < data.byteLength) {
    if (byte(data, offset) !== 0xff) throw invalidInput('JPEG marker is missing')
    offset += 1
    let marker = byte(data, offset)
    offset += 1
    while (marker === 0xff && offset < data.byteLength) {
      marker = byte(data, offset)
      offset += 1
    }
    if (marker === 0xd9) {
      eoiOffset = offset - 2
      break
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue
    if (marker === 0xda) {
      offset = segmentEnd(data, offset)
      const next = scanJpegEntropy(data, offset)
      if (next === undefined) break
      if (next.marker === 0xd9) {
        eoiOffset = next.markerOffset
        break
      }
      offset = next.markerOffset
      continue
    }
    const end = segmentEnd(data, offset)
    if (isStartOfFrameMarker(marker)) {
      const start = offset + 2
      if (end - start < 6) throw truncatedInput('JPEG start-of-frame marker is truncated')
      sofMarker = marker
      precision = byte(data, start)
      height = readUint16(data, start + 1)
      width = readUint16(data, start + 3)
      componentCount = byte(data, start + 5)
    }
    offset = end
  }

  if (sofMarker === undefined) throw invalidInput('JPEG start-of-frame marker is missing')
  if (eoiOffset < 0) throw invalidInput('JPEG is missing EOI')
  return Object.freeze({
    sofMarker,
    precision,
    width,
    height,
    componentCount,
    eoiOffset,
    trailingByteCount: data.byteLength - (eoiOffset + 2),
  })
}
