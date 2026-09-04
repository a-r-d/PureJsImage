import type {
  DecoderOptions,
  ImageCodec,
  ImageDecoder,
  MetadataPreservationOptions,
} from '../codec.ts'
import { ImageError, unsupportedOperation } from '../errors.ts'
import type { ImageLimitOptions, ImageLimits } from '../limits.ts'
import { resolveLimits } from '../limits.ts'
import { createImageSource, type ImageInput, type ImageSource } from '../source.ts'
import {
  ColorManagedDecoder,
  createStructuredGrayTransform,
  createStructuredRgbTransform,
  GrayColorManagedDecoder,
  parseGrayIccTransform,
  parseRgbIccTransform,
} from './icc.ts'
import {
  inspectJpegXlSource,
  JpegXlCodestreamSource,
  type JpegXlStructure,
  jpegXlContainerSignature,
  jpegXlRawSignature,
  readJpegXlPreservedMetadata,
} from './jpegxl-container.ts'
import {
  configureJpegXlDecoderOutput,
  decodeJpegXlSource,
  type JpegXlFrameStructure,
  readJpegXlSourceFrameStructure,
  readJpegXlSourceInspectionMetadata,
  readJpegXlSourceMetadata,
} from './jpegxl-decode.ts'
import { summarizeJpegXlExif } from './jpegxl-exif.ts'
import type { JpegXlLimitOptions, JpegXlLimits } from './jpegxl-limits.ts'
import { resolveJpegXlLimits } from './jpegxl-limits.ts'
import { acceptsJpegXlColorSemantics, createJpegXlModularEncoder } from './jpegxl-modular-encode.ts'
import { createJpegXlVarDctDecoder } from './jpegxl-vardct.ts'

export type {
  JpegXlBoxSummary,
  JpegXlCodestreamSegment,
  JpegXlStructure,
} from './jpegxl-container.ts'

const startsWith = (data: Uint8Array, signature: Uint8Array): boolean =>
  data.byteLength >= signature.byteLength &&
  signature.every((value, index) => data[index] === value)

export interface InspectJpegXlStructureOptions extends Readonly<ImageLimitOptions> {
  readonly jpegXlLimits?: Readonly<JpegXlLimitOptions>
  readonly signal?: AbortSignal
}

export const inspectJpegXlStructure = async (
  input: ImageInput,
  options: Readonly<InspectJpegXlStructureOptions> = {},
): Promise<JpegXlStructure> => {
  const source = await createImageSource(input, resolveLimits(options), options)
  return inspectJpegXlSource(source, resolveJpegXlLimits(options.jpegXlLimits), options)
}

const codestreamSource = async (
  source: ImageSource,
  limits: Readonly<JpegXlLimits>,
  options: Readonly<DecoderOptions>,
): Promise<Readonly<{ source: JpegXlCodestreamSource; limits: Readonly<JpegXlLimits> }>> =>
  Object.freeze({
    source: new JpegXlCodestreamSource(source, await inspectJpegXlSource(source, limits, options)),
    limits,
  })

const colorManagedJpegXlDecoder = (
  decoder: ImageDecoder,
  frame: Readonly<JpegXlFrameStructure>,
  options: Readonly<DecoderOptions>,
): ImageDecoder => {
  if (
    options.colorOutput !== undefined &&
    options.colorOutput !== 'preserve' &&
    options.colorOutput !== 'srgb'
  ) {
    throw unsupportedOperation('JPEG XL colorOutput must be preserve or srgb')
  }
  const hdr =
    frame.colorSemanticsTransfer.kind === 'pq' || frame.colorSemanticsTransfer.kind === 'hlg'
  if (hdr || frame.colorTransform === 'xyb') {
    if (hdr && options.colorOutput === 'srgb' && options.hdrOutput !== 'tone-map-srgb') {
      throw unsupportedOperation('JPEG XL HDR to sRGB requires explicit tone-map-srgb output')
    }
    if (!hdr && options.colorOutput === 'srgb' && decoder.pixelFormat.endsWith('f32')) {
      throw unsupportedOperation(
        'JPEG XL linear float output requires explicit pixel conversion to sRGB',
      )
    }
    return configureJpegXlDecoderOutput(decoder, frame, options)
  }
  const explicitConversion = options.colorOutput === 'srgb'
  if (explicitConversion && options.preserveIcc) {
    throw unsupportedOperation('JPEG XL cannot preserve source ICC samples and convert to sRGB')
  }
  const iccConversion =
    frame.iccProfile !== undefined &&
    options.preserveIcc !== true &&
    options.colorOutput !== 'preserve'
  const structuredConversion =
    frame.iccProfile === undefined &&
    options.colorOutput === 'srgb' &&
    (frame.chromaticities !== undefined ||
      frame.colorSemanticsPrimaries !== 'srgb' ||
      frame.colorSemanticsTransfer.kind !== 'srgb')
  if (!iccConversion && !structuredConversion) {
    return configureJpegXlDecoderOutput(decoder, frame, options)
  }
  const alphaConfigured = configureJpegXlDecoderOutput(
    decoder,
    frame,
    frame.alphaAssociated ? { ...options, alphaOutput: 'straight' } : options,
  )
  try {
    if (frame.chromaticities !== undefined)
      throw unsupportedOperation(
        'JPEG XL custom chromaticity conversion requires a color transform',
      )
    if (frame.colorChannels === 1) {
      if (alphaConfigured.pixelFormat !== 'gray8') {
        throw unsupportedOperation('JPEG XL grayscale color conversion requires gray8 output')
      }
      const transform = frame.iccProfile
        ? parseGrayIccTransform(frame.iccProfile)
        : createStructuredGrayTransform(frame.colorSemanticsTransfer)
      return new GrayColorManagedDecoder(alphaConfigured, transform)
    }
    if (alphaConfigured.pixelFormat !== 'rgb8' && alphaConfigured.pixelFormat !== 'rgba8') {
      throw unsupportedOperation('JPEG XL color conversion currently requires 8-bit RGB output')
    }
    const transform = frame.iccProfile
      ? parseRgbIccTransform(frame.iccProfile)
      : createStructuredRgbTransform(frame.colorSemanticsPrimaries, frame.colorSemanticsTransfer)
    return new ColorManagedDecoder(alphaConfigured, transform)
  } catch (error) {
    if (
      !explicitConversion &&
      error instanceof ImageError &&
      error.code === 'UNSUPPORTED_OPERATION'
    ) {
      return configureJpegXlDecoderOutput(decoder, frame, options)
    }
    throw error
  }
}

/** Registered first-party JPEG XL codec with a bounded lossless Modular subset. */
export const jpegxlCodec: ImageCodec = Object.freeze({
  format: 'jpegxl',
  mimeTypes: ['image/jxl'],
  minimumBytes: jpegXlRawSignature.byteLength,
  encoderPixelFormats: ['gray8', 'gray16', 'rgb8', 'rgb16', 'rgba8', 'rgba16'] as const,
  acceptsColorSemantics: acceptsJpegXlColorSemantics,
  detect(header: Uint8Array): boolean {
    return startsWith(header, jpegXlRawSignature) || startsWith(header, jpegXlContainerSignature)
  },
  async metadata(source: ImageSource, limits: ImageLimits, options: Readonly<DecoderOptions> = {}) {
    const logical = await codestreamSource(source, resolveJpegXlLimits(), options)
    const metadata = await readJpegXlSourceMetadata(
      logical.source,
      limits,
      options,
      logical.limits.maxHeaderBytes,
      logical.limits,
    )
    const structure = await inspectJpegXlSource(source, logical.limits, options)
    const preserved = await readJpegXlPreservedMetadata(source, structure, logical.limits, {
      ...options,
      exif: true,
      icc: false,
    })
    return Object.freeze({
      ...metadata,
      ...(preserved.exif ? summarizeJpegXlExif(preserved.exif) : {}),
    })
  },
  async preservedMetadata(
    source: ImageSource,
    limits: ImageLimits,
    options: Readonly<MetadataPreservationOptions> = { exif: true, icc: true },
  ) {
    const jpegXlLimits = resolveJpegXlLimits()
    const structure = await inspectJpegXlSource(source, jpegXlLimits, options)
    const containerMetadata = await readJpegXlPreservedMetadata(
      source,
      structure,
      jpegXlLimits,
      options,
    )
    if (!options.icc) return containerMetadata
    const logical = new JpegXlCodestreamSource(source, structure)
    const frame = await readJpegXlSourceFrameStructure(
      logical,
      limits,
      options,
      jpegXlLimits.maxHeaderBytes,
      jpegXlLimits,
    )
    return Object.freeze({
      ...containerMetadata,
      ...(frame.iccProfile === undefined ? {} : { icc: Uint8Array.from(frame.iccProfile) }),
    })
  },
  async createDecoder(
    source: ImageSource,
    limits: ImageLimits,
    options: Readonly<DecoderOptions> = {},
  ) {
    const logical = await codestreamSource(source, resolveJpegXlLimits(), options)
    const inspection = await readJpegXlSourceInspectionMetadata(
      logical.source,
      limits,
      options,
      logical.limits.maxHeaderBytes,
      logical.limits,
    )
    if (inspection.frame.sampleFormat === 'floating-point') {
      throw unsupportedOperation('JPEG XL floating-point encoded samples are not supported yet')
    }
    if (
      inspection.frame.extraChannels.some(
        (channel) =>
          (inspection.encoding === 'modular' && channel.dimShift !== 0) ||
          channel.bitDepth.sampleFormat === 'floating-point',
      )
    ) {
      throw unsupportedOperation(
        'JPEG XL subsampled or floating-point extra channels are not supported yet',
      )
    }
    if (inspection.frame.extraChannels.length > 1 && options.alphaChannel === undefined) {
      throw unsupportedOperation('JPEG XL has multiple alpha channels; select one explicitly')
    }
    if (inspection.encoding === 'vardct') {
      return colorManagedJpegXlDecoder(
        await createJpegXlVarDctDecoder(source, limits, options),
        inspection.frame,
        options,
      )
    }
    const decoded = await decodeJpegXlSource(
      logical.source,
      limits,
      options,
      logical.limits.maxHeaderBytes,
      logical.limits,
    )
    return colorManagedJpegXlDecoder(decoded.decoder, inspection.frame, options)
  },
  createEncoder: createJpegXlModularEncoder,
})
