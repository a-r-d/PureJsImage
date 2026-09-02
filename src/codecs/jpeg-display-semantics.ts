import { ImageError, invalidInput, limitExceeded, unsupportedOperation } from '../errors.ts'
import { createPureJsImageSrgbIcc } from '../hdr/srgb-icc.ts'
import { inspectIccProfile } from './icc.ts'
import { assembleJpegIccProfile, type JpegIccChunk, parseJpegIccChunk } from './jpeg-baseline.ts'
import { walkJpegMarkers } from './jpeg-marker-walk.ts'
import { parseJpegExifRenderingMetadata, type JpegExifColorSpace } from './jpeg-metadata.ts'

export interface JpegExactTranscodeDisplaySemantics {
  readonly orientation: 1
  readonly colorProfile: 'none' | 'srgb'
}

const startsWith = (data: Uint8Array, offset: number, expected: readonly number[]): boolean =>
  expected.every((value, index) => data[offset + index] === value)

const exactBytesEqual = (left: Uint8Array, right: Uint8Array): boolean =>
  left.byteLength === right.byteLength && left.every((value, index) => right[index] === value)

/** Validate rendering-affecting JPEG metadata before coefficient-domain transcoding. */
export const inspectJpegExactTranscodeDisplaySemantics = (
  data: Uint8Array,
  maximumMetadataBytes: number,
  options: Readonly<{ maximumMarkerCount?: number; signal?: AbortSignal }> = {},
): JpegExactTranscodeDisplaySemantics => {
  const orientations: number[] = []
  const exifColorSpaces: JpegExifColorSpace[] = []
  const iccChunks: JpegIccChunk[] = []
  let metadataBytes = 0
  for (const segment of walkJpegMarkers(data, {
    maximumMarkerCount: options.maximumMarkerCount ?? 16_384,
    ...(options.signal ? { signal: options.signal } : {}),
  })) {
    const payload = data.subarray(segment.payloadOffset, segment.end)
    if (segment.marker === 0xe1 && startsWith(payload, 0, [0x45, 0x78, 0x69, 0x66, 0, 0])) {
      metadataBytes += payload.byteLength
      const exif = parseJpegExifRenderingMetadata(payload)
      if (exif) {
        orientations.push(...exif.orientations)
        exifColorSpaces.push(...exif.colorSpaces)
      }
    } else if (
      segment.marker === 0xe2 &&
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
  const uniqueExifColorSpaces = new Set(exifColorSpaces)
  if (uniqueExifColorSpaces.size > 1) {
    throw unsupportedOperation('JPEG has conflicting Exif color metadata')
  }
  const exifColorSpace = exifColorSpaces[0]
  let profile: Uint8Array | undefined
  try {
    profile = assembleJpegIccProfile(iccChunks, maximumMetadataBytes)
    if (profile) inspectIccProfile(profile)
  } catch (cause) {
    if (cause instanceof ImageError && cause.code === 'LIMIT_EXCEEDED') throw cause
    throw invalidInput('JPEG ICC color profile is malformed')
  }
  if (profile === undefined) {
    if (exifColorSpace !== undefined && exifColorSpace !== 'srgb') {
      throw unsupportedOperation(`JPEG Exif color space ${exifColorSpace} is unsupported`)
    }
    return Object.freeze({ orientation: 1, colorProfile: 'none' })
  }
  if (!exactBytesEqual(profile, createPureJsImageSrgbIcc())) {
    throw unsupportedOperation('JPEG color profile is not the independently validated sRGB profile')
  }
  if (exifColorSpace !== undefined && exifColorSpace !== 'srgb') {
    throw unsupportedOperation('JPEG has conflicting Exif and ICC color metadata')
  }
  return Object.freeze({ orientation: 1, colorProfile: 'srgb' })
}
