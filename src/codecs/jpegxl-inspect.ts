import type { AbortOptions } from '../abort.ts'
import type { ImageMetadata } from '../codec.ts'
import { invalidInput } from '../errors.ts'
import type { ImageLimitOptions } from '../limits.ts'
import { resolveLimits } from '../limits.ts'
import { createImageSource, type ImageInput, readExactly } from '../source.ts'
import {
  inspectJpegXlSource,
  type JpegXlBoxSummary,
  type JpegXlCodestreamSegment,
  JpegXlCodestreamSource,
} from './jpegxl-container.ts'
import { readJpegXlSourceInspectionMetadata } from './jpegxl-decode.ts'
import { parseJpegXlJpegReconstructionHeader } from './jpegxl-jpeg-reconstruction.ts'
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
  readonly encoding: 'modular' | 'vardct'
  readonly imageKind: 'static'
  readonly preview: false
  readonly frameCount: 1
  readonly level: 5 | 10 | undefined
  readonly progressivePasses: number
  readonly jpegReconstruction: 'unavailable' | 'metadata-valid'
  readonly exactReconstructionEligibility: 'unavailable' | 'requires-coefficient-validation'
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
  const header = await readJpegXlSourceInspectionMetadata(
    logical,
    imageLimits,
    options,
    jpegXlLimits.maxHeaderBytes,
  )
  const metadata = header.metadata
  const colorChannels = metadata.colorSpace?.includes('gray') ? 1 : 3
  const channels = metadata.channels ?? colorChannels
  const metadataBytes = structure.metadataBoxes.reduce((sum, box) => sum + box.payloadBytes, 0)
  const bytesPerSample = (metadata.bitDepth ?? 8) > 8 ? 2 : 1
  const nativeSampleBytes = metadata.width * metadata.height * channels * bytesPerSample
  const reconstructionBox = structure.metadataBoxes.find(({ type }) => type === 'jbrd')
  if (reconstructionBox) {
    const contentStart =
      reconstructionBox.offset + reconstructionBox.length - reconstructionBox.payloadBytes
    const payload = await readExactly(source, contentStart, reconstructionBox.payloadBytes, options)
    const reconstruction = parseJpegXlJpegReconstructionHeader(payload, jpegXlLimits)
    const exifMarkers = reconstruction.appMarkers.filter(({ type }) => type === 'exif')
    const xmpMarkers = reconstruction.appMarkers.filter(({ type }) => type === 'xmp')
    if (exifMarkers.length > 1 || xmpMarkers.length > 1) {
      throw invalidInput('JPEG XL reconstruction metadata repeats Exif or XMP references')
    }
    const exifBox = structure.metadataBoxes.find(({ type }) => type === 'Exif')
    const xmpBox = structure.metadataBoxes.find(({ type }) => type === 'xml ')
    const exifMarker = exifMarkers[0]
    const xmpMarker = xmpMarkers[0]
    if ((exifMarker === undefined) !== (exifBox === undefined)) {
      throw invalidInput('JPEG XL reconstruction Exif reference does not match the container')
    }
    if (exifMarker && exifBox && exifBox.payloadBytes !== exifMarker.byteLength - 5) {
      throw invalidInput('JPEG XL reconstruction Exif size does not match the container')
    }
    if ((xmpMarker === undefined) !== (xmpBox === undefined)) {
      throw invalidInput('JPEG XL reconstruction XMP reference does not match the container')
    }
    if (xmpMarker && xmpBox && xmpBox.payloadBytes !== xmpMarker.byteLength - 32) {
      throw invalidInput('JPEG XL reconstruction XMP size does not match the container')
    }
  }
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
    encoding: header.encoding,
    imageKind: 'static',
    preview: false,
    frameCount: 1,
    level: structure.level,
    progressivePasses: header.progressivePasses,
    jpegReconstruction: reconstructionBox ? 'metadata-valid' : 'unavailable',
    exactReconstructionEligibility: reconstructionBox
      ? 'requires-coefficient-validation'
      : 'unavailable',
    expectedPixelFormat: expectedPixelFormat(metadata),
    resourceEstimates: Object.freeze({
      codestreamBytes: structure.codestreamBytes,
      metadataBytes,
      nativeSampleBytes,
    }),
    unsupportedFeatures: Object.freeze([
      ...(header.encoding === 'vardct' ? ['VarDCT pixel decode'] : []),
      'animation',
      'preview decode',
      'Level 10 pixel decode',
      ...(reconstructionBox ? [] : ['exact JPEG reconstruction']),
    ]),
  })
}
