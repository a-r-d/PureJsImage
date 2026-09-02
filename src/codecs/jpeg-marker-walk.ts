import { throwIfAborted } from '../abort.ts'
import { invalidInput, limitExceeded, unsupportedOperation } from '../errors.ts'

export interface JpegMarkerSegment {
  readonly marker: number
  readonly markerOffset: number
  readonly payloadOffset: number
  readonly end: number
  readonly scanIndex: number
}

export interface JpegMarkerWalkOptions {
  readonly maximumMarkerCount: number
  readonly signal?: AbortSignal
}

const byte = (data: Uint8Array, offset: number): number => {
  const value = data[offset]
  if (value === undefined) throw invalidInput('JPEG marker data is truncated')
  return value
}

const uint16 = (data: Uint8Array, offset: number): number =>
  byte(data, offset) * 256 + byte(data, offset + 1)

/** Walk every structural JPEG marker through EOI without copying source bytes. */
export function* walkJpegMarkers(
  data: Uint8Array,
  options: Readonly<JpegMarkerWalkOptions>,
): Generator<JpegMarkerSegment> {
  if (!Number.isSafeInteger(options.maximumMarkerCount) || options.maximumMarkerCount < 1) {
    throw invalidInput('JPEG maximum marker count must be a positive safe integer')
  }
  if (data.byteLength < 4 || byte(data, 0) !== 0xff || byte(data, 1) !== 0xd8) {
    throw invalidInput('JPEG start marker is missing')
  }

  let offset = 2
  let markerCount = 0
  let scanIndex = 0
  while (offset < data.byteLength) {
    throwIfAborted(options.signal)
    if (byte(data, offset) !== 0xff) throw invalidInput('JPEG marker prefix is malformed')
    const markerOffset = offset
    offset += 1
    if (byte(data, offset) === 0xff) {
      throw unsupportedOperation('JPEG fill bytes between markers are unsupported')
    }
    const marker = byte(data, offset)
    offset += 1
    if (marker === 0x00) throw invalidInput('JPEG stuffed byte appears outside entropy data')
    if (marker >= 0xd0 && marker <= 0xd7) {
      throw invalidInput('JPEG restart marker appears outside entropy data')
    }

    markerCount += 1
    if (markerCount > options.maximumMarkerCount) {
      throw limitExceeded(`JPEG has more than ${options.maximumMarkerCount} markers`)
    }

    if (marker === 0xd9 || marker === 0x01) {
      const segment = Object.freeze({
        marker,
        markerOffset,
        payloadOffset: offset,
        end: offset,
        scanIndex,
      })
      yield segment
      if (marker === 0xd9) return
      continue
    }

    const length = uint16(data, offset)
    if (length < 2) throw invalidInput('JPEG marker length is malformed')
    const end = offset + length
    if (!Number.isSafeInteger(end) || end > data.byteLength) {
      throw invalidInput('JPEG marker segment is truncated')
    }
    const segment = Object.freeze({
      marker,
      markerOffset,
      payloadOffset: offset + 2,
      end,
      scanIndex,
    })
    yield segment
    offset = end
    if (marker !== 0xda) continue

    scanIndex += 1
    while (offset < data.byteLength) {
      throwIfAborted(options.signal)
      if (byte(data, offset) !== 0xff) {
        offset += 1
        continue
      }
      if (offset + 1 >= data.byteLength) {
        throw invalidInput('JPEG entropy data is truncated')
      }
      const following = byte(data, offset + 1)
      if (following === 0x00 || (following >= 0xd0 && following <= 0xd7)) {
        offset += 2
        continue
      }
      if (following === 0xff) {
        throw unsupportedOperation(
          'JPEG fill bytes between entropy data and markers are unsupported',
        )
      }
      break
    }
  }
  throw invalidInput('JPEG is missing its end marker')
}
