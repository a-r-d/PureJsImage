import { ImageError, invalidInput, limitExceeded, unsupportedOperation } from '../errors.ts'
import { createPureJsImageSrgbIcc } from '../hdr/srgb-icc.ts'
import { inspectIccProfile } from './icc.ts'
import { assembleJpegIccProfile, type JpegIccChunk, parseJpegIccChunk } from './jpeg-baseline.ts'
import { parseJpegExifOrientation } from './jpeg-metadata.ts'

export interface JpegExactTranscodeDisplaySemantics {
  readonly orientation: 1
  readonly colorProfile: 'none' | 'srgb'
}

const byte = (data: Uint8Array, offset: number): number => {
  const value = data[offset]
  if (value === undefined) throw invalidInput('JPEG marker data is truncated')
  return value
}

const uint16 = (data: Uint8Array, offset: number): number =>
  byte(data, offset) * 256 + byte(data, offset + 1)

const startsWith = (data: Uint8Array, offset: number, expected: readonly number[]): boolean =>
  expected.every((value, index) => data[offset + index] === value)

const exactBytesEqual = (left: Uint8Array, right: Uint8Array): boolean =>
  left.byteLength === right.byteLength && left.every((value, index) => right[index] === value)

/** Validate rendering-affecting JPEG metadata before coefficient-domain transcoding. */
export const inspectJpegExactTranscodeDisplaySemantics = (
  data: Uint8Array,
  maximumMetadataBytes: number,
): JpegExactTranscodeDisplaySemantics => {
  if (data.byteLength < 4 || data[0] !== 0xff || data[1] !== 0xd8) {
    throw invalidInput('JPEG start marker is missing')
  }
  const orientations: number[] = []
  const iccChunks: JpegIccChunk[] = []
  let metadataBytes = 0
  let offset = 2
  while (offset + 1 < data.byteLength) {
    if (data[offset] !== 0xff) throw invalidInput('JPEG marker prefix is malformed')
    while (data[offset] === 0xff) offset += 1
    const marker = byte(data, offset++)
    if (marker === 0xda || marker === 0xd9) break
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue
    const length = uint16(data, offset)
    if (length < 2 || offset + length > data.byteLength) {
      throw invalidInput('JPEG marker length is malformed')
    }
    const payload = data.subarray(offset + 2, offset + length)
    if (marker === 0xe1 && startsWith(payload, 0, [0x45, 0x78, 0x69, 0x66, 0, 0])) {
      metadataBytes += payload.byteLength
      const orientation = parseJpegExifOrientation(payload, true)
      if (orientation !== undefined) orientations.push(orientation)
    } else if (
      marker === 0xe2 &&
      startsWith(payload, 0, [0x49, 0x43, 0x43, 0x5f, 0x50, 0x52, 0x4f, 0x46, 0x49, 0x4c, 0x45, 0])
    ) {
      metadataBytes += payload.byteLength
      const chunk = parseJpegIccChunk(payload, 0, payload.byteLength)
      if (!chunk) throw invalidInput('JPEG ICC color profile is malformed')
      iccChunks.push(chunk)
    }
    if (!Number.isSafeInteger(metadataBytes) || metadataBytes > maximumMetadataBytes) {
      throw limitExceeded(`JPEG rendering metadata exceeds ${maximumMetadataBytes} bytes`)
    }
    offset += length
  }
  const uniqueOrientations = new Set(orientations)
  if (uniqueOrientations.size > 1) {
    throw unsupportedOperation('JPEG has conflicting Exif display orientation metadata')
  }
  const orientation = orientations[0] ?? 1
  if (orientation !== 1) {
    throw unsupportedOperation(
      `JPEG display orientation ${orientation} is not supported for exact transcode`,
    )
  }
  let profile: Uint8Array | undefined
  try {
    profile = assembleJpegIccProfile(iccChunks, maximumMetadataBytes)
    if (profile) inspectIccProfile(profile)
  } catch (cause) {
    if (cause instanceof ImageError && cause.code === 'LIMIT_EXCEEDED') throw cause
    throw invalidInput('JPEG ICC color profile is malformed')
  }
  if (profile === undefined) return Object.freeze({ orientation: 1, colorProfile: 'none' })
  if (!exactBytesEqual(profile, createPureJsImageSrgbIcc())) {
    throw unsupportedOperation('JPEG color profile is not the independently validated sRGB profile')
  }
  return Object.freeze({ orientation: 1, colorProfile: 'srgb' })
}
