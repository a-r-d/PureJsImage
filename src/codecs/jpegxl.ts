import { throwIfAborted } from '../abort.ts'
import type {
  DecoderOptions,
  ImageCodec,
  ImageDecoder,
  MetadataPreservationOptions,
} from '../codec.ts'
import { ImageError, unsupportedOperation } from '../errors.ts'
import type { ImageLimitOptions, ImageLimits } from '../limits.ts'
import { resolveLimits } from '../limits.ts'
import type { PixelBlock } from '../pixel.ts'
import { createImageSource, type ImageInput, type ImageSource } from '../source.ts'
import {
  ColorManagedDecoder,
  createStructuredGrayTransform,
  createStructuredRgbTransform,
  GrayColorManagedDecoder,
  linearToSrgb,
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
  jpegXlSourceColorSemantics,
  jpegXlXybOutputIsLinear,
  readJpegXlSourceFrameStructure,
  readJpegXlSourceInspectionMetadata,
  readJpegXlSourceMetadata,
} from './jpegxl-decode.ts'
import { summarizeJpegXlExif } from './jpegxl-exif.ts'
import type { JpegXlLimitOptions, JpegXlLimits } from './jpegxl-limits.ts'
import { resolveJpegXlLimits } from './jpegxl-limits.ts'
import { acceptsJpegXlColorSemantics, createJpegXlModularEncoder } from './jpegxl-modular-encode.ts'
import { createJpegXlVarDctDecoder } from './jpegxl-vardct.ts'
import { estimateJpegXlVarDctWorkingMemory } from './jpegxl-vardct-memory.ts'

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

const linearSrgbDecoder = (decoder: ImageDecoder): ImageDecoder => {
  const channels = decoder.pixelFormat === 'rgbaf32' ? 4 : 3
  const pixelFormat = channels === 4 ? 'rgba8' : 'rgb8'
  if (!decoder.colorSemantics)
    throw unsupportedOperation('Linear sRGB conversion requires known color semantics')
  const colorSemantics = Object.freeze({
    ...decoder.colorSemantics,
    transfer: Object.freeze({ kind: 'srgb' as const }),
    provenance: 'decoder-converted' as const,
  })
  return {
    width: decoder.width,
    height: decoder.height,
    pixelFormat,
    colorSemantics,
    capabilities: decoder.capabilities,
    async *decode(request): AsyncGenerator<PixelBlock> {
      for await (const block of decoder.decode(request)) {
        try {
          const data = new Uint8Array(block.width * block.height * channels)
          const view = new DataView(block.data.buffer, block.data.byteOffset, block.data.byteLength)
          for (let y = 0; y < block.height; y += 1) {
            throwIfAborted(request?.signal)
            for (let x = 0; x < block.width; x += 1) {
              const source = y * block.stride + x * channels * 4
              const target = (y * block.width + x) * channels
              for (let c = 0; c < channels; c += 1) {
                const sample = view.getFloat32(source + c * 4, false)
                data[target + c] = Math.round(
                  Math.max(0, Math.min(1, c === 3 ? sample : linearToSrgb(sample))) * 255,
                )
              }
            }
          }
          yield {
            x: block.x,
            y: block.y,
            width: block.width,
            height: block.height,
            stride: block.width * channels,
            format: pixelFormat,
            data,
            colorSemantics,
          }
        } finally {
          block.release?.()
        }
      }
    },
  }
}

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
  if (options.colorOutput === 'srgb' && options.preserveIcc) {
    throw unsupportedOperation('JPEG XL cannot preserve source ICC samples and convert to sRGB')
  }
  const hdr =
    frame.colorSemanticsTransfer.kind === 'pq' || frame.colorSemanticsTransfer.kind === 'hlg'
  if (hdr || frame.colorTransform === 'xyb') {
    if (hdr && options.colorOutput === 'srgb' && options.hdrOutput !== 'tone-map-srgb') {
      throw unsupportedOperation('JPEG XL HDR to sRGB requires explicit tone-map-srgb output')
    }
    if (!hdr && options.colorOutput === 'srgb' && decoder.pixelFormat.endsWith('f32')) {
      return linearSrgbDecoder(
        configureJpegXlDecoderOutput(decoder, frame, { ...options, alphaOutput: 'straight' }),
      )
    }
    return configureJpegXlDecoderOutput(decoder, frame, options)
  }
  const explicitConversion = options.colorOutput === 'srgb'
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

const describeJpegXlDecoder = (
  decoder: ImageDecoder,
  frame: Readonly<JpegXlFrameStructure>,
  options: Readonly<DecoderOptions>,
  encoding: 'modular' | 'vardct',
): ImageDecoder => {
  const converted = options.hdrOutput === 'tone-map-srgb' || options.colorOutput === 'srgb'
  const depth = decoder.pixelFormat.endsWith('f32')
    ? 32
    : decoder.pixelFormat.endsWith('16')
      ? frame.bitDepth
      : 8
  const channels = decoder.pixelFormat.startsWith('gray')
    ? 1
    : decoder.pixelFormat.startsWith('rgba')
      ? 4
      : 3
  const sampleBitDepths = Object.freeze(
    Array.from({ length: channels }, (_, c) =>
      c === 3 && decoder.pixelFormat.endsWith('16') ? (frame.alphaBitDepth ?? depth) : depth,
    ),
  )
  const nativeHigh = Math.max(frame.bitDepth, frame.alphaBitDepth ?? 0) > 8
  const nativePixelFormat = jpegXlXybOutputIsLinear(frame)
    ? frame.alphaBitDepth === undefined
      ? 'rgbf32'
      : 'rgbaf32'
    : frame.alphaBitDepth !== undefined
      ? nativeHigh
        ? 'rgba16'
        : 'rgba8'
      : frame.colorChannels === 1
        ? nativeHigh
          ? 'gray16'
          : 'gray8'
        : nativeHigh
          ? 'rgb16'
          : 'rgb8'
  const inputColorSemantics = jpegXlSourceColorSemantics(frame)
  const expandedGray = frame.colorChannels === 1 && frame.alphaBitDepth !== undefined
  const execution = Object.freeze({
    nativePixelFormat,
    sourceSampleBitDepths: Object.freeze(
      Array.from({ length: channels }, (_, c) =>
        c === 3 ? (frame.alphaBitDepth ?? frame.bitDepth) : frame.bitDepth,
      ),
    ),
    inputColorSemantics,
    precisionLoss:
      nativePixelFormat !== decoder.pixelFormat ||
      (decoder.colorSemantics?.provenance === 'decoder-converted' &&
        inputColorSemantics.provenance !== 'decoder-converted' &&
        !expandedGray) ||
      (frame.alphaAssociated && decoder.colorSemantics?.alpha === 'straight'),
    orientation: frame.orientation,
    sampleBitDepths,
    decodeDuringOpen: encoding === 'vardct',
    fullFrameFallbackReasons: Object.freeze(
      encoding === 'vardct'
        ? [
            decoder.capabilities.scaledDecode
              ? 'JPEG-derived coefficients retained for the whole image; pixels use bounded rows'
              : 'VarDCT retains a full output frame; eligible 8-bit images use bounded restoration bands',
          ]
        : frame.sections.length === 1
          ? ['Single-group Modular retains its complete channel planes']
          : [],
    ),
    estimatedWorkingBytes:
      encoding === 'vardct'
        ? Number(estimateJpegXlVarDctWorkingMemory(frame).requiredBytes)
        : frame.width * Math.min(frame.height, frame.groupDimension) * frame.channelCount * 16 +
          frame.sections.reduce((sum, part) => sum + part.length, 0),
    conversions: Object.freeze([
      ...(expandedGray ? ['gray-to-rgb'] : []),
      ...(decoder.colorSemantics?.alpha === 'straight' && frame.alphaAssociated
        ? ['unpremultiply-alpha']
        : []),
      ...(options.hdrOutput && options.hdrOutput !== 'encoded' ? [options.hdrOutput] : []),
      ...(options.colorOutput === 'srgb' ? ['color-to-srgb'] : []),
      ...(frame.iccProfile !== undefined &&
      decoder.colorSemantics?.provenance === 'decoder-converted'
        ? ['icc-to-srgb']
        : []),
    ]),
    encodingDefaults: Object.freeze({
      format: 'jpegxl',
      options: Object.freeze({
        ...(depth === 32 ? {} : { sampleBitDepth: depth }),
        ...(channels === 4 && depth !== 32 ? { alphaBitDepth: sampleBitDepths[3] } : {}),
        orientation: frame.orientation,
        ...(frame.intrinsicWidth !== undefined && frame.intrinsicHeight !== undefined
          ? { intrinsicSize: { width: frame.intrinsicWidth, height: frame.intrinsicHeight } }
          : {}),
        ...(!converted && depth !== 32 ? { toneMapping: frame.toneMapping } : {}),
      }),
    }),
  })
  return Object.freeze({
    width: decoder.width,
    height: decoder.height,
    pixelFormat: decoder.pixelFormat,
    ...(decoder.colorSemantics ? { colorSemantics: decoder.colorSemantics } : {}),
    capabilities: decoder.capabilities,
    ...('managedPeakBytes' in decoder && typeof decoder.managedPeakBytes === 'number'
      ? {
          get managedPeakBytes(): number {
            return 'managedPeakBytes' in decoder && typeof decoder.managedPeakBytes === 'number'
              ? decoder.managedPeakBytes
              : 0
          },
        }
      : {}),
    execution,
    decode: (request: Parameters<ImageDecoder['decode']>[0]) => decoder.decode(request),
  })
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
      return describeJpegXlDecoder(
        colorManagedJpegXlDecoder(
          await createJpegXlVarDctDecoder(source, limits, options),
          inspection.frame,
          options,
        ),
        inspection.frame,
        options,
        'vardct',
      )
    }
    const decoded = await decodeJpegXlSource(
      logical.source,
      limits,
      options,
      logical.limits.maxHeaderBytes,
      logical.limits,
    )
    return describeJpegXlDecoder(
      colorManagedJpegXlDecoder(decoded.decoder, inspection.frame, options),
      inspection.frame,
      options,
      'modular',
    )
  },
  createEncoder: createJpegXlModularEncoder,
})
