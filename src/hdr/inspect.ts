import { ImageError, type ImageErrorCode } from '../errors.ts'
import type { ImageLimitOptions } from '../limits.ts'
import { resolveLimits } from '../limits.ts'
import type { ImageInput } from '../source.ts'
import { createImageSource, readExactly } from '../source.ts'
import { inspectHdrJpeg, type HdrJpegLimits, type JpegByteRange } from './jpeg.ts'
import type { GainMapMetadataRepresentation, GainMapTriplet } from './model.ts'

export interface InspectGainMapImageOptions extends HdrJpegLimits {
  readonly imageLimits?: ImageLimitOptions
  readonly signal?: AbortSignal
}

export interface ValidGainMapImageInspection {
  readonly container: 'jpeg'
  readonly status: 'valid'
  readonly selectedRepresentation: GainMapMetadataRepresentation
  readonly representations: readonly GainMapMetadataRepresentation[]
  readonly baseDimensions: Readonly<{ width: number; height: number }>
  readonly gainMapDimensions: Readonly<{ width: number; height: number }>
  readonly channelCount: 1 | 3
  readonly baseRange: JpegByteRange
  readonly gainMapRange: JpegByteRange
  readonly baseRendition: 'sdr'
  readonly minimum: GainMapTriplet
  readonly maximum: GainMapTriplet
  readonly gamma: GainMapTriplet
  readonly capacityMinimum: number
  readonly capacityMaximum: number
}

export interface AbsentGainMapImageInspection {
  readonly container: 'jpeg' | 'unknown'
  readonly status: 'not-present'
}

export interface FailedGainMapImageInspection {
  readonly container: 'jpeg'
  readonly status: 'invalid' | 'unsupported'
  readonly error: Readonly<{ code: ImageErrorCode; message: string }>
}

export type GainMapProbeInspection =
  | ValidGainMapImageInspection
  | AbsentGainMapImageInspection
  | FailedGainMapImageInspection

const triplet = (values: readonly number[]): GainMapTriplet => {
  const first = values[0] ?? 0
  return Object.freeze([
    first,
    values.length === 1 ? first : (values[1] ?? first),
    values.length === 1 ? first : (values[2] ?? first),
  ])
}

export const inspectGainMapImage = async (
  input: ImageInput,
  options: Readonly<InspectGainMapImageOptions> = {},
): Promise<GainMapProbeInspection> => {
  const source = await createImageSource(input, resolveLimits(options.imageLimits), options)
  const header = await readExactly(source, 0, Math.min(12, source.size), options)
  const jpeg = header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff
  if (!jpeg) return Object.freeze({ container: 'unknown', status: 'not-present' })
  try {
    const inspection = await inspectHdrJpeg(source, options)
    if (!inspection.gainMap || !inspection.gainMapDimensions) {
      return Object.freeze({ container: 'jpeg', status: 'not-present' })
    }
    const selected = inspection.iso ?? inspection.ultraHdr
    if (!selected) {
      return Object.freeze({
        container: 'jpeg',
        status: 'unsupported',
        error: Object.freeze({
          code: 'UNSUPPORTED_OPERATION' as const,
          message: 'JPEG contains multiple images but no supported gain-map metadata',
        }),
      })
    }
    const components = inspection.gainMapDimensions.components
    if (components !== 1 && components !== 3) {
      return Object.freeze({
        container: 'jpeg',
        status: 'unsupported',
        error: Object.freeze({
          code: 'UNSUPPORTED_OPERATION' as const,
          message: 'Gain-map JPEG must contain one or three components',
        }),
      })
    }
    if (selected.baseRendition !== 'sdr') {
      return Object.freeze({
        container: 'jpeg',
        status: 'unsupported',
        error: Object.freeze({
          code: 'UNSUPPORTED_OPERATION' as const,
          message: 'Gain-map JPEG output and opening require an SDR base rendition',
        }),
      })
    }
    return Object.freeze({
      container: 'jpeg',
      status: 'valid',
      selectedRepresentation: inspection.iso ? 'iso-21496-1' : 'ultra-hdr-xmp',
      representations: inspection.representations,
      baseDimensions: Object.freeze({
        width: inspection.primaryDimensions.width,
        height: inspection.primaryDimensions.height,
      }),
      gainMapDimensions: Object.freeze({
        width: inspection.gainMapDimensions.width,
        height: inspection.gainMapDimensions.height,
      }),
      channelCount: components,
      baseRange: inspection.primary,
      gainMapRange: inspection.gainMap,
      baseRendition: selected.baseRendition,
      minimum: triplet(selected.minimum),
      maximum: triplet(selected.maximum),
      gamma: triplet(selected.gamma),
      capacityMinimum: selected.capacityMinimum,
      capacityMaximum: selected.capacityMaximum,
    })
  } catch (error) {
    if (!(error instanceof ImageError)) throw error
    return Object.freeze({
      container: 'jpeg',
      status: error.code === 'UNSUPPORTED_OPERATION' ? 'unsupported' : 'invalid',
      error: Object.freeze({ code: error.code, message: error.message }),
    })
  }
}
