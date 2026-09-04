import type { AbortOptions } from '../abort.ts'
import type { ImageMetadata } from '../codec.ts'
import { pixelBytesPerPixel } from '../pixel.ts'
import type { PixelRenderingIntent } from '../color.ts'
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
import { jpegXlXybOutputIsLinear, readJpegXlSourceInspectionMetadata } from './jpegxl-decode.ts'
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
  readonly exponentBits: number
  readonly colorChannels: 1 | 3
  readonly extraChannels: number
  readonly alpha: 'none' | 'straight' | 'premultiplied'
  readonly alphaChannels: number
  readonly encodedColor: string
  readonly renderingIntent: PixelRenderingIntent
  readonly toneMapping: Readonly<{
    readonly intensityTarget: number
    readonly minNits: number
    readonly relativeToMaxDisplay: boolean
    readonly linearBelow: number
  }>
  readonly intrinsicWidth: number | undefined
  readonly intrinsicHeight: number | undefined
  readonly icc: Readonly<{ readonly present: boolean; readonly decodedBytes: number | undefined }>
  readonly encoding: 'modular' | 'vardct'
  readonly imageKind: 'static'
  readonly preview: false
  readonly frameCount: 1
  readonly level: 5 | 10 | undefined
  readonly progressivePasses: number
  readonly jpegReconstruction: 'unavailable' | 'metadata-valid'
  readonly exactReconstructionEligibility: 'unavailable' | 'requires-coefficient-validation'
  readonly expectedPixelFormat:
    | 'gray8'
    | 'gray16'
    | 'rgb8'
    | 'rgb16'
    | 'rgba8'
    | 'rgba16'
    | 'rgbf32'
    | 'rgbaf32'
  readonly resourceEstimates: JpegXlResourceEstimates
  readonly unsupportedFeatures: readonly string[]
}

const expectedPixelFormat = (metadata: ImageMetadata): JpegXlInspection['expectedPixelFormat'] => {
  const highDepth = Math.max(metadata.bitDepth ?? 8, ...(metadata.channelBitDepths ?? [])) > 8
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
    jpegXlLimits,
  )
  const metadata = header.metadata
  const frame = header.frame
  const colorChannels = frame.colorChannels
  const metadataBytes = structure.metadataBoxes.reduce((sum, box) => sum + box.payloadBytes, 0)
  const outputPixelFormat = jpegXlXybOutputIsLinear(header.frame)
    ? metadata.hasAlpha
      ? 'rgbaf32'
      : 'rgbf32'
    : expectedPixelFormat(metadata)
  const nativeSampleBytes = metadata.width * metadata.height * pixelBytesPerPixel(outputPixelFormat)
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
  const renderingIntent = metadata.colorSemantics?.renderingIntent
  if (!renderingIntent) throw invalidInput('JPEG XL rendering intent metadata is missing')
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
    displayWidth: (metadata.orientation ?? 1) >= 5 ? metadata.height : metadata.width,
    displayHeight: (metadata.orientation ?? 1) >= 5 ? metadata.width : metadata.height,
    orientation: metadata.orientation ?? 1,
    bitDepth: metadata.bitDepth ?? 8,
    exponentBits: frame.exponentBits,
    colorChannels,
    extraChannels: frame.extraChannels.length,
    alpha: metadata.hasAlpha ? (frame.alphaAssociated ? 'premultiplied' : 'straight') : 'none',
    alphaChannels: frame.extraChannels.filter(({ type }) => type === 0).length,
    encodedColor: metadata.colorSpace ?? 'unspecified',
    renderingIntent,
    toneMapping: frame.toneMapping,
    intrinsicWidth: frame.intrinsicWidth,
    intrinsicHeight: frame.intrinsicHeight,
    icc: Object.freeze({
      present: metadata.colorProfile?.kind === 'icc',
      decodedBytes: frame.iccProfile?.byteLength,
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
    expectedPixelFormat: outputPixelFormat,
    resourceEstimates: Object.freeze({
      codestreamBytes: structure.codestreamBytes,
      metadataBytes,
      nativeSampleBytes,
    }),
    unsupportedFeatures: Object.freeze([
      'animation',
      'preview decode',
      'Level 10 pixel decode',
      ...(reconstructionBox ? [] : ['exact JPEG reconstruction']),
    ]),
  })
}
