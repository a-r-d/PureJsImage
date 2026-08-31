import type { AbortOptions } from '../abort.ts'
import type { ImageMetadata } from '../codec.ts'
import type { ImageLimitOptions } from '../limits.ts'
import { resolveLimits } from '../limits.ts'
import { createImageSource, type ImageInput } from '../source.ts'
import {
  inspectJpegXlSource,
  JpegXlCodestreamSource,
  type JpegXlBoxSummary,
  type JpegXlCodestreamSegment,
} from './jpegxl-container.ts'
import { readJpegXlSourceMetadata } from './jpegxl-decode.ts'
import type { JpegXlLimitOptions } from './jpegxl-limits.ts'
import { resolveJpegXlLimits } from './jpegxl-limits.ts'

export interface InspectJpegXlOptions extends AbortOptions {
  readonly limits?: Readonly<ImageLimitOptions & JpegXlLimitOptions>
}

export interface JpegXlResourceEstimates {
  readonly codestreamBytes: number
  readonly metadataBytes: number
  readonly nativeSampleBytes: number
}

export interface JpegXlInspection {
  readonly kind: 'raw-codestream' | 'container'
  readonly organization: 'raw' | 'jxlc' | 'jxlp'
  readonly containerVersion: 0 | 1 | undefined
  readonly codestreamBytes: number
  readonly codestreamSegments: readonly JpegXlCodestreamSegment[]
  readonly boxes: readonly JpegXlBoxSummary[]
  readonly metadataBoxes: readonly JpegXlBoxSummary[]
  readonly width: number
  readonly height: number
  readonly displayWidth: number
  readonly displayHeight: number
  readonly orientation: number
  readonly bitDepth: number
  readonly exponentBits: 0
  readonly colorChannels: 1 | 3
  readonly extraChannels: number
  readonly alpha: 'none' | 'straight'
  readonly encodedColor: string
  readonly icc: Readonly<{ readonly present: boolean; readonly decodedBytes: undefined }>
  readonly encoding: 'modular'
  readonly imageKind: 'static'
  readonly preview: false
  readonly frameCount: 1
  readonly level: 5 | 10 | undefined
  readonly progressivePasses: 1
  readonly jpegReconstruction: 'unavailable' | 'present-unvalidated'
  readonly exactReconstructionEligibility: 'unavailable' | 'requires-validation'
  readonly expectedPixelFormat: 'gray8' | 'gray16' | 'rgb8' | 'rgb16' | 'rgba8' | 'rgba16'
  readonly resourceEstimates: JpegXlResourceEstimates
  readonly unsupportedFeatures: readonly string[]
}

const expectedPixelFormat = (metadata: ImageMetadata): JpegXlInspection['expectedPixelFormat'] => {
  const highDepth = (metadata.bitDepth ?? 8) > 8
  if (!metadata.hasAlpha && metadata.components === 1) return highDepth ? 'gray16' : 'gray8'
  if (!metadata.hasAlpha) return highDepth ? 'rgb16' : 'rgb8'
  return highDepth ? 'rgba16' : 'rgba8'
}

export const inspectJpegXl = async (
  input: ImageInput,
  options: Readonly<InspectJpegXlOptions> = {},
): Promise<JpegXlInspection> => {
  const imageLimits = resolveLimits(options.limits)
  const jpegXlLimits = resolveJpegXlLimits(options.limits)
  const source = await createImageSource(input, imageLimits, options)
  const structure = await inspectJpegXlSource(source, jpegXlLimits, options)
  const logical = new JpegXlCodestreamSource(source, structure)
  const metadata = await readJpegXlSourceMetadata(
    logical,
    imageLimits,
    options,
    jpegXlLimits.maxHeaderBytes,
  )
  const colorChannels = metadata.colorSpace?.includes('gray') ? 1 : 3
  const channels = metadata.channels ?? colorChannels
  const metadataBytes = structure.metadataBoxes.reduce((sum, box) => sum + box.payloadBytes, 0)
  const bytesPerSample = (metadata.bitDepth ?? 8) > 8 ? 2 : 1
  const nativeSampleBytes = metadata.width * metadata.height * channels * bytesPerSample
  const reconstructionPresent = structure.metadataBoxes.some(({ type }) => type === 'jbrd')
  return Object.freeze({
    kind: structure.kind,
    organization: structure.organization,
    containerVersion: structure.containerVersion,
    codestreamBytes: structure.codestreamBytes,
    codestreamSegments: structure.codestreamSegments,
    boxes: structure.boxes,
    metadataBoxes: structure.metadataBoxes,
    width: metadata.width,
    height: metadata.height,
    displayWidth: metadata.width,
    displayHeight: metadata.height,
    orientation: metadata.orientation ?? 1,
    bitDepth: metadata.bitDepth ?? 8,
    exponentBits: 0,
    colorChannels,
    extraChannels: Math.max(0, channels - colorChannels),
    alpha: metadata.hasAlpha ? 'straight' : 'none',
    encodedColor: metadata.colorSpace ?? 'unspecified',
    icc: Object.freeze({
      present: metadata.colorProfile?.kind === 'icc',
      decodedBytes: undefined,
    }),
    encoding: 'modular',
    imageKind: 'static',
    preview: false,
    frameCount: 1,
    level: structure.level,
    progressivePasses: 1,
    jpegReconstruction: reconstructionPresent ? 'present-unvalidated' : 'unavailable',
    exactReconstructionEligibility: reconstructionPresent ? 'requires-validation' : 'unavailable',
    expectedPixelFormat: expectedPixelFormat(metadata),
    resourceEstimates: Object.freeze({
      codestreamBytes: structure.codestreamBytes,
      metadataBytes,
      nativeSampleBytes,
    }),
    unsupportedFeatures: Object.freeze([
      'VarDCT',
      'animation',
      'preview decode',
      'Level 10 pixel decode',
      'exact JPEG reconstruction',
    ]),
  })
}
