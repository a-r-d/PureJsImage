import { combineAbortSignals, throwIfAborted } from '../abort.ts'
import type { DecoderOptions, ImageDecoder } from '../codec.ts'
import type { PixelColorSemantics } from '../color.ts'
import { limitExceeded, unsupportedOperation } from '../errors.ts'
import type { ImageLimits } from '../limits.ts'
import type { PixelFormat } from '../pixel.ts'
import type { ImageSource } from '../source.ts'
import {
  parseCmykIccTransform16,
  parseGrayIccFloatTransform16,
  parseRgbIccTransform16,
  writeCmykIcc16,
  writeNclxHdrLinearToneMappedRgba,
  writeRgbIcc16,
} from './icc.ts'
import { inspectJpegXlSource, JpegXlCodestreamSource } from './jpegxl-container.ts'
import {
  type JpegXlFrameStructure,
  jpegXlSourceColorSemantics,
  openJpegXlNativeGroupBands,
} from './jpegxl-decode.ts'
import { invalidJpegXlInput } from './jpegxl-errors.ts'
import {
  createJpegXlFloatHdrTransform,
  createJpegXlFloatSdrTransfer,
  jpegXlFloatSdrCode,
  jpegXlFloatSdrMatrix,
} from './jpegxl-float-color.ts'
import { resolveJpegXlLimits } from './jpegxl-limits.ts'
import { floatSample, integerPlane, normalizedExtraPlane } from './jpegxl-native-samples.ts'
import { openJpegXlSequence } from './jpegxl-sequence.ts'

/** Native planes feed caller-owned rows; composed frames retain bounded reference canvases. */
export const createJpegXlNativePixelDecoder = (
  source: ImageSource,
  limits: Readonly<ImageLimits>,
  options: Readonly<DecoderOptions>,
  frame: Readonly<JpegXlFrameStructure>,
): ImageDecoder => {
  if (
    frame.encoding !== 'modular' ||
    frame.colorTransform !== 'none' ||
    frame.upsampling !== 1 ||
    (frame.frameFlags & 19) !== 0 ||
    frame.gaborish ||
    frame.epfIterations !== 0
  )
    throw unsupportedOperation(
      'JPEG XL float and CMYK rows require native Modular color without reconstruction filters',
    )
  const frameIndex = options.frame ?? 0
  if (!Number.isSafeInteger(frameIndex) || frameIndex < 0)
    throw invalidJpegXlInput('frame index is invalid')
  if (frame.animation && options.frame === undefined)
    throw unsupportedOperation('JPEG XL animation requires an explicit frame index')
  const composed =
    !!frame.animation ||
    !frame.isLast ||
    frame.frameType !== 'regular' ||
    frame.frameWidth !== frame.width ||
    frame.frameHeight !== frame.height ||
    frame.frameOriginX !== 0 ||
    frame.frameOriginY !== 0 ||
    (frame.blending?.mode ?? 0) !== 0 ||
    !!frame.extraChannelBlending?.some((blend) => blend.mode !== 0) ||
    frameIndex !== 0
  if ((options.resolutionLevel ?? 0) !== 0)
    throw unsupportedOperation('JPEG XL native pixel rows have only resolution level zero')
  if (
    options.colorOutput !== undefined &&
    options.colorOutput !== 'preserve' &&
    options.colorOutput !== 'srgb'
  )
    throw invalidJpegXlInput('colorOutput must be preserve or srgb')
  if (
    options.alphaOutput !== undefined &&
    options.alphaOutput !== 'preserve' &&
    options.alphaOutput !== 'straight'
  )
    throw invalidJpegXlInput('alphaOutput must be preserve or straight')
  if (
    options.hdrOutput !== undefined &&
    !['encoded', 'linear-float', 'tone-map-srgb'].includes(options.hdrOutput)
  )
    throw invalidJpegXlInput('HDR output is invalid')
  if (options.colorOutput === 'srgb' && options.preserveIcc)
    throw invalidJpegXlInput('sRGB output cannot preserve source ICC samples')
  const blackIndex = frame.extraChannels.findIndex((extra) => extra.type === 4)
  const cmyk = blackIndex >= 0
  const hdr = options.hdrOutput !== undefined && options.hdrOutput !== 'encoded'
  const toneMapSrgb = options.hdrOutput === 'tone-map-srgb'
  if (cmyk && hdr) throw unsupportedOperation('JPEG XL CMYK has no structured HDR transfer')
  if (hdr && options.preserveIcc)
    throw invalidJpegXlInput('HDR conversion cannot preserve source ICC samples')
  if (
    frame.extraChannels.some((extra, index) => extra.type !== 0 && (!cmyk || index !== blackIndex))
  )
    throw unsupportedOperation('JPEG XL native pixel rows support alpha and one CMYK black channel')
  if (
    frame.extraChannels.filter((extra) => extra.type === 0).length > 1 &&
    options.alphaChannel === undefined
  )
    throw unsupportedOperation('JPEG XL has multiple alpha channels; select one explicitly')
  const alphaIndex = frame.selectedAlphaChannel
  const alpha = alphaIndex === undefined ? undefined : frame.extraChannels[alphaIndex]
  const black = cmyk ? frame.extraChannels[blackIndex] : undefined
  for (const extra of frame.extraChannels) {
    const factor = (frame.extraChannelUpsampling[extra.index] ?? 1) * 2 ** extra.dimShift
    if (factor !== 1 && factor !== 2 && factor !== 4 && factor !== 8)
      throw unsupportedOperation(
        'JPEG XL native pixel extra-channel upsampling supports factors 1, 2, 4 and 8',
      )
  }
  const floatDepth = frame.sampleFormat === 'floating-point' ? frame.bitDepth : undefined
  const integerColor = frame.sampleFormat === 'unsigned-integer'
  if (cmyk) {
    if (
      frame.colorChannels !== 3 ||
      (!integerColor && floatDepth === undefined) ||
      (integerColor && (frame.bitDepth < 8 || frame.bitDepth > 31))
    )
      throw unsupportedOperation('JPEG XL CMYK requires integer or IEEE color and black samples')
    if (!frame.iccProfile)
      throw unsupportedOperation('JPEG XL CMYK requires an embedded supported ICC profile')
    if (options.colorOutput === 'preserve' || options.preserveIcc)
      throw unsupportedOperation(
        'JPEG XL CMYK preservation requires explicit native channel extraction',
      )
  } else {
    if (!integerColor && floatDepth === undefined)
      throw unsupportedOperation('JPEG XL ordinary float color requires IEEE binary16 or binary32')
  }
  const channels = alpha ? 4 : hdr ? 3 : frame.colorChannels
  const floatSdr =
    !cmyk &&
    !hdr &&
    (options.colorOutput === 'srgb' ||
      (integerColor &&
        !!frame.iccProfile &&
        options.colorOutput !== 'preserve' &&
        !options.preserveIcc))
  const wideInteger = integerColor && !alpha && !cmyk && !hdr && !floatSdr
  const integerMaximum = 2 ** frame.bitDepth - 1
  const floatIcc = floatSdr && !!frame.iccProfile
  const high =
    cmyk && Math.max(frame.bitDepth, black?.bitDepth.bits ?? 0, alpha?.bitDepth.bits ?? 0) > 8
  const pixelFormat: PixelFormat = cmyk
    ? alpha
      ? high
        ? 'rgba16'
        : 'rgba8'
      : high
        ? 'rgb16'
        : 'rgb8'
    : wideInteger
      ? channels === 1
        ? 'gray32'
        : 'rgb32'
      : toneMapSrgb
        ? alpha
          ? 'rgba8'
          : 'rgb8'
        : floatSdr
          ? alpha
            ? 'rgba16'
            : channels === 1
              ? 'gray16'
              : 'rgb16'
          : alpha
            ? 'rgbaf32'
            : channels === 1
              ? 'grayf32'
              : 'rgbf32'
  const bytes = toneMapSrgb ? 1 : floatSdr ? 2 : cmyk ? (high ? 2 : 1) : 4
  const straight = cmyk || floatSdr || hdr || options.alphaOutput === 'straight'
  const sourceSemantics = jpegXlSourceColorSemantics(frame)
  const inputColorSemantics: PixelColorSemantics = cmyk
    ? {
        ...sourceSemantics,
        family: 'unspecified',
        icc: { ...sourceSemantics.icc, relevance: 'source' },
      }
    : sourceSemantics
  const colorSemantics: PixelColorSemantics =
    cmyk || floatSdr || toneMapSrgb
      ? {
          family: channels === 1 ? 'gray' : 'rgb',
          primaries: 'srgb',
          transfer: { kind: 'srgb' },
          matrix: 'identity',
          range: 'full',
          alpha: alpha ? 'straight' : 'none',
          provenance: 'decoder-converted',
        }
      : hdr
        ? {
            ...sourceSemantics,
            family: 'rgb',
            transfer: { kind: 'linear' },
            alpha: alpha ? 'straight' : 'none',
            provenance: 'decoder-converted',
          }
        : {
            ...sourceSemantics,
            family: channels === 1 ? 'gray' : 'rgb',
            alpha: alpha
              ? straight || !alpha.associatedAlpha
                ? 'straight'
                : 'premultiplied'
              : 'none',
          }
  // The extra-plane bound covers normalization and the native upsampler's scratch/copy storage.
  const alphaRaw =
    !!alpha && alpha.dimShift === 0 && (frame.extraChannelUpsampling[alpha.index] ?? 1) === 1
  const blackRaw =
    !!black && black.dimShift === 0 && (frame.extraChannelUpsampling[black.index] ?? 1) === 1
  const extraBytes =
    BigInt(frame.width) *
    BigInt(frame.height) *
    BigInt((alpha && !alphaRaw ? 1 : 0) + (black && !blackRaw ? 1 : 0)) *
    24n
  const tableBytes = hdr
    ? 32_768
    : floatSdr
      ? floatIcc && frame.colorChannels === 3
        ? 3_149_824 + (frame.iccProfile?.byteLength ?? 0) * 2
        : 4096 + (frame.iccProfile?.byteLength ?? 0) * 2
      : cmyk
        ? 1_320_960 + (frame.iccProfile?.byteLength ?? 0) * 2
        : 0
  const reserved = extraBytes + BigInt(frame.width * channels * bytes + tableBytes + 6)
  if (reserved >= BigInt(limits.maxDecodedBytes))
    throw limitExceeded(
      'JPEG XL native pixel rows, extra planes and ICC tables exceed maxDecodedBytes',
    )
  const nativeLimits = { ...limits, maxDecodedBytes: limits.maxDecodedBytes - Number(reserved) }
  const hdrTransform = hdr ? createJpegXlFloatHdrTransform(frame) : undefined
  const transform = cmyk && frame.iccProfile ? parseCmykIccTransform16(frame.iccProfile) : undefined
  const floatMatrix = floatSdr && !floatIcc ? jpegXlFloatSdrMatrix(frame) : undefined
  const floatTransfer = floatSdr && !floatIcc ? createJpegXlFloatSdrTransfer(frame) : undefined
  const floatGrayIcc =
    floatIcc && frame.colorChannels === 1 && frame.iccProfile
      ? parseGrayIccFloatTransform16(frame.iccProfile)
      : undefined
  const floatRgbIcc =
    floatIcc && frame.colorChannels === 3 && frame.iccProfile
      ? parseRgbIccTransform16(frame.iccProfile)
      : undefined
  const sampleBits = wideInteger
    ? frame.bitDepth
    : toneMapSrgb
      ? 8
      : floatSdr
        ? 16
        : cmyk
          ? high
            ? 16
            : 8
          : 32
  const convertedAlpha = !!alpha?.associatedAlpha && straight
  return {
    width: frame.width,
    height: frame.height,
    pixelFormat,
    colorSemantics,
    execution: {
      nativePixelFormat: floatSdr
        ? alpha
          ? 'rgbaf32'
          : channels === 1
            ? 'grayf32'
            : 'rgbf32'
        : pixelFormat,
      sourceSampleBitDepths: [
        ...Array.from({ length: frame.colorChannels }, () => frame.bitDepth),
        ...(black ? [black.bitDepth.bits] : []),
        ...(alpha ? [alpha.bitDepth.bits] : []),
      ],
      inputColorSemantics,
      precisionLoss:
        composed ||
        hdr ||
        cmyk ||
        floatSdr ||
        convertedAlpha ||
        (integerColor && !wideInteger) ||
        (!!alpha &&
          (alpha.bitDepth.sampleFormat === 'unsigned-integer' ||
            alpha.dimShift !== 0 ||
            (frame.extraChannelUpsampling[alpha.index] ?? 1) !== 1)),
      orientation: frame.orientation,
      sampleBitDepths: Array.from({ length: channels }, () => sampleBits),
      decodeDuringOpen: false,
      fullFrameFallbackReasons: [
        composed
          ? 'Native Modular frame composition retains full canvas planes and reference frames; conversion uses output rows'
          : 'Independent native Modular groups use cropped bands; global transforms or dependent groups retain full native planes',
      ],
      estimatedWorkingBytes:
        Number(reserved) +
        frame.width * frame.height * frame.channelCount * (composed ? 64 : 32) +
        frame.sections.reduce((sum, section) => sum + section.length * 2, 0) +
        frame.width * 256,
      conversions: [
        ...(hdr
          ? [toneMapSrgb ? 'hdr-tone-map-srgb' : 'hdr-to-linear-float']
          : cmyk
            ? ['cmyk-to-srgb', 'icc-to-srgb']
            : floatSdr
              ? [floatIcc ? 'icc-to-srgb' : 'float-sdr-to-srgb', 'clip-float-to-sdr']
              : floatDepth === 16
                ? ['float16-to-float32']
                : []),
        ...(frame.colorChannels === 1 && alpha ? ['gray-to-rgb'] : []),
        ...(convertedAlpha ? ['unpremultiply-alpha'] : []),
      ],
      encodingDefaults: {
        format: 'jpegxl',
        options: {
          orientation: frame.orientation,
          ...(!cmyk && !floatSdr && !toneMapSrgb ? { toneMapping: frame.toneMapping } : {}),
          ...(cmyk || floatSdr || toneMapSrgb || wideInteger
            ? { sampleBitDepth: sampleBits, ...(alpha ? { alphaBitDepth: sampleBits } : {}) }
            : {}),
          ...(frame.intrinsicWidth !== undefined && frame.intrinsicHeight !== undefined
            ? { intrinsicSize: { width: frame.intrinsicWidth, height: frame.intrinsicHeight } }
            : {}),
        },
      },
    },
    capabilities: { sequential: true, regionDecode: true, scaledDecode: false, progressive: false },
    async *decode(request = {}) {
      if ((request.scaleDenominator ?? 1) !== 1)
        throw unsupportedOperation('JPEG XL native pixel scaled decoding is unsupported')
      const x = request.x ?? 0,
        y = request.y ?? 0
      const width = request.width ?? frame.width - x,
        height = request.height ?? frame.height - y
      if (
        ![x, y, width, height].every(Number.isSafeInteger) ||
        x < 0 ||
        y < 0 ||
        width < 1 ||
        height < 1 ||
        x + width > frame.width ||
        y + height > frame.height
      )
        throw invalidJpegXlInput('native pixel crop is invalid')
      const signal = combineAbortSignals(options.signal, request.signal)
      throwIfAborted(signal)
      const sequence = await openJpegXlSequence(source, {
        limits: nativeLimits,
        ...(signal ? { signal } : {}),
      })
      try {
        async function* samples() {
          if (!composed) {
            const structure = await inspectJpegXlSource(
              source,
              resolveJpegXlLimits(),
              signal ? { signal } : {},
            )
            const bands = await openJpegXlNativeGroupBands(
              new JpegXlCodestreamSource(source, structure),
              frame,
              nativeLimits,
              { x, y, width, height },
              signal,
            )
            if (bands) {
              for await (const band of bands)
                yield {
                  color: band.planes.slice(0, frame.colorChannels),
                  alphaSamples:
                    alphaIndex === undefined
                      ? undefined
                      : band.planes[frame.colorChannels + alphaIndex],
                  blackSamples: cmyk ? band.planes[frame.colorChannels + blackIndex] : undefined,
                  normalized: false,
                  alphaRaw: true,
                  blackRaw: true,
                  width: band.width,
                  height: band.height,
                  offsetX: 0,
                  offsetY: 0,
                  outputHeight: band.height,
                  startRow: band.y,
                }
              return
            }
          }
          if (composed) {
            const selected = await sequence.frame(frameIndex, signal)
            yield {
              color: selected.planes.slice(0, frame.colorChannels),
              alphaSamples:
                alphaIndex === undefined
                  ? undefined
                  : selected.planes[frame.colorChannels + alphaIndex],
              blackSamples: cmyk ? selected.planes[frame.colorChannels + blackIndex] : undefined,
              normalized: true,
              alphaRaw: false,
              blackRaw: false,
              width: frame.width,
              height: frame.height,
              offsetX: x,
              offsetY: y,
              outputHeight: height,
              startRow: 0,
            }
            return
          }
          for await (const layer of sequence.layers(signal)) {
            if (layer.header.isPreview) continue
            if (
              layer.domain !== 'modular' ||
              !layer.header.isLast ||
              layer.layouts[0]?.width !== frame.width ||
              layer.layouts[0]?.height !== frame.height
            )
              throw unsupportedOperation(
                'JPEG XL native pixel layer requires a static full-size Modular frame',
              )
            yield {
              color: Array.from({ length: frame.colorChannels }, (_, channel) =>
                integerPlane(layer, channel),
              ),
              alphaSamples:
                alphaIndex === undefined
                  ? undefined
                  : alphaRaw
                    ? integerPlane(layer, frame.colorChannels + alphaIndex)
                    : normalizedExtraPlane(layer, alphaIndex, signal),
              blackSamples: cmyk
                ? blackRaw
                  ? integerPlane(layer, frame.colorChannels + blackIndex)
                  : normalizedExtraPlane(layer, blackIndex, signal)
                : undefined,
              normalized: false,
              alphaRaw,
              blackRaw,
              width: frame.width,
              height: frame.height,
              offsetX: x,
              offsetY: y,
              outputHeight: height,
              startRow: 0,
            }
            return
          }
        }
        for await (const sampled of samples()) {
          const { color, alphaSamples, blackSamples, normalized } = sampled
          if (color.some((plane) => plane.length !== sampled.width * sampled.height))
            throw invalidJpegXlInput('native color plane sizes disagree')
          const scratch = new Uint16Array(3)
          const linear = new Float64Array(3)
          const maximum = normalized ? 1 : 2 ** frame.bitDepth - 1
          const hdrScratch = new Uint8Array(4)
          const complement = (value: number, denominator: number): number => {
            if (!Number.isFinite(value))
              throw invalidJpegXlInput('CMYK samples reject NaN and infinity')
            return 65_535 - Math.round(Math.max(0, Math.min(1, value / denominator)) * 65_535)
          }
          for (let row = 0; row < sampled.outputHeight; row++) {
            if ((row & 31) === 31) await new Promise<void>((resolve) => setTimeout(resolve, 0))
            throwIfAborted(signal)
            const stride = width * channels * bytes
            const data = new Uint8Array(stride)
            const view = new DataView(data.buffer)
            for (let column = 0; column < width; column++) {
              const index = (sampled.offsetY + row) * sampled.width + sampled.offsetX + column
              const alphaValue = alphaSamples?.[index] ?? 1
              const a =
                sampled.alphaRaw && alpha
                  ? alpha.bitDepth.sampleFormat === 'floating-point'
                    ? floatSample(alphaValue, alpha.bitDepth.bits, alpha.bitDepth.exponentBits)
                    : alphaValue / (2 ** alpha.bitDepth.bits - 1)
                  : alphaValue
              if (!Number.isFinite(a)) throw invalidJpegXlInput('alpha rejects NaN and infinity')
              const denominator = convertedAlpha ? a : 1
              const offset = column * channels * bytes
              if (transform && blackSamples) {
                const c = normalized
                  ? (color[0]?.[index] ?? 0)
                  : floatDepth
                    ? floatSample(color[0]?.[index] ?? 0, floatDepth, frame.exponentBits)
                    : (color[0]?.[index] ?? 0) / maximum
                const m = normalized
                  ? (color[1]?.[index] ?? 0)
                  : floatDepth
                    ? floatSample(color[1]?.[index] ?? 0, floatDepth, frame.exponentBits)
                    : (color[1]?.[index] ?? 0) / maximum
                const yellow = normalized
                  ? (color[2]?.[index] ?? 0)
                  : floatDepth
                    ? floatSample(color[2]?.[index] ?? 0, floatDepth, frame.exponentBits)
                    : (color[2]?.[index] ?? 0) / maximum
                const k =
                  sampled.blackRaw && black
                    ? black.bitDepth.sampleFormat === 'floating-point'
                      ? floatSample(
                          blackSamples[index] ?? 0,
                          black.bitDepth.bits,
                          black.bitDepth.exponentBits,
                        )
                      : (blackSamples[index] ?? 0) / (2 ** black.bitDepth.bits - 1)
                    : (blackSamples[index] ?? 0)
                if (
                  !Number.isFinite(c) ||
                  !Number.isFinite(m) ||
                  !Number.isFinite(yellow) ||
                  !Number.isFinite(k)
                )
                  throw invalidJpegXlInput('CMYK samples reject NaN and infinity')
                if (denominator <= 0) scratch.fill(0)
                else
                  writeCmykIcc16(
                    transform,
                    complement(c, denominator),
                    complement(m, denominator),
                    complement(yellow, denominator),
                    complement(k, denominator),
                    scratch,
                    0,
                  )
                for (let channel = 0; channel < 3; channel++) {
                  const value = scratch[channel] ?? 0
                  if (high) view.setUint16(offset + channel * 2, value, false)
                  else data[offset + channel] = Math.round(value / 257)
                }
                if (alpha) {
                  const value = Math.round(Math.max(0, Math.min(1, a)) * (high ? 65_535 : 255))
                  if (high) view.setUint16(offset + 6, value, false)
                  else data[offset + 3] = value
                }
              } else if (hdrTransform) {
                for (let channel = 0; channel < 3; channel++) {
                  const sample = color[frame.colorChannels === 1 ? 0 : channel]?.[index] ?? 0
                  const value = normalized
                    ? sample
                    : floatDepth
                      ? floatSample(sample, floatDepth, frame.exponentBits)
                      : sample / integerMaximum
                  if (!Number.isFinite(value))
                    throw invalidJpegXlInput('HDR pixels reject NaN and infinity')
                  linear[channel] = hdrTransform.transfer(
                    denominator <= 0 ? 0 : value / denominator,
                  )
                }
                if (toneMapSrgb) {
                  writeNclxHdrLinearToneMappedRgba(
                    hdrScratch,
                    0,
                    linear[0] ?? 0,
                    linear[1] ?? 0,
                    linear[2] ?? 0,
                    hdrTransform.toneMap,
                  )
                  data[offset] = hdrScratch[0] ?? 0
                  data[offset + 1] = hdrScratch[1] ?? 0
                  data[offset + 2] = hdrScratch[2] ?? 0
                  if (alpha) data[offset + 3] = Math.round(Math.max(0, Math.min(1, a)) * 255)
                } else {
                  const luma = hdrTransform.toneMap.hlgLumaCoefficients
                  const luminance = luma
                    ? Math.max(
                        0,
                        luma[0] * (linear[0] ?? 0) +
                          luma[1] * (linear[1] ?? 0) +
                          luma[2] * (linear[2] ?? 0),
                      )
                    : 0
                  const scale = luma
                    ? luminance === 0
                      ? 0
                      : luminance ** ((hdrTransform.toneMap.hlgSystemGamma ?? 1.2) - 1) *
                        hdrTransform.toneMap.sourcePeak
                    : 1
                  for (let channel = 0; channel < 3; channel++) {
                    const value = (linear[channel] ?? 0) * scale
                    if (!Number.isFinite(Math.fround(value)))
                      throw invalidJpegXlInput('linear HDR overflows binary32')
                    view.setFloat32(offset + channel * 4, value, false)
                  }
                  if (alpha) view.setFloat32(offset + 12, a, false)
                }
              } else if (floatMatrix || floatGrayIcc || floatRgbIcc) {
                for (let channel = 0; channel < frame.colorChannels; channel++) {
                  const sample = color[channel]?.[index] ?? 0
                  const value = normalized
                    ? sample
                    : floatDepth
                      ? floatSample(sample, floatDepth, frame.exponentBits)
                      : sample / integerMaximum
                  if (!Number.isFinite(value))
                    throw invalidJpegXlInput('float pixels reject NaN and infinity')
                  // Straighten in the source domain, then explicitly map the source to SDR.
                  linear[channel] =
                    denominator <= 0
                      ? 0
                      : floatTransfer
                        ? floatTransfer(Math.max(0, Math.min(1, value / denominator)))
                        : value / denominator
                }
                if (frame.colorChannels === 1) {
                  const value = floatGrayIcc
                    ? floatGrayIcc(linear[0] ?? 0)
                    : jpegXlFloatSdrCode(linear[0] ?? 0)
                  view.setUint16(offset, value, false)
                  if (alpha) {
                    view.setUint16(offset + 2, value, false)
                    view.setUint16(offset + 4, value, false)
                  }
                } else if (floatRgbIcc) {
                  writeRgbIcc16(
                    floatRgbIcc,
                    linear[0] ?? 0,
                    linear[1] ?? 0,
                    linear[2] ?? 0,
                    scratch,
                    0,
                    true,
                  )
                  for (let channel = 0; channel < 3; channel++)
                    view.setUint16(offset + channel * 2, scratch[channel] ?? 0, false)
                } else if (floatMatrix) {
                  const red = linear[0] ?? 0,
                    green = linear[1] ?? 0,
                    blue = linear[2] ?? 0
                  for (let channel = 0; channel < 3; channel++) {
                    const start = channel * 3
                    const value =
                      (floatMatrix[start] ?? 0) * red +
                      (floatMatrix[start + 1] ?? 0) * green +
                      (floatMatrix[start + 2] ?? 0) * blue
                    view.setUint16(offset + channel * 2, jpegXlFloatSdrCode(value), false)
                  }
                }
                if (alpha)
                  view.setUint16(
                    offset + 6,
                    Math.round(Math.max(0, Math.min(1, a)) * 65_535),
                    false,
                  )
              } else if (wideInteger) {
                for (let channel = 0; channel < channels; channel++) {
                  const sample = color[channel]?.[index] ?? 0
                  view.setUint32(
                    offset + channel * 4,
                    normalized ? Math.round(sample * integerMaximum) : sample,
                    false,
                  )
                }
              } else {
                for (let channel = 0; channel < (alpha ? 3 : channels); channel++) {
                  const sample = color[frame.colorChannels === 1 ? 0 : channel]?.[index] ?? 0
                  const value = normalized
                    ? sample
                    : floatDepth
                      ? floatSample(sample, floatDepth, frame.exponentBits)
                      : sample / integerMaximum
                  if (!Number.isFinite(value))
                    throw invalidJpegXlInput('float pixels reject NaN and infinity')
                  const output = denominator <= 0 ? 0 : convertedAlpha ? value / denominator : value
                  if (!Number.isFinite(Math.fround(output)))
                    throw invalidJpegXlInput('straight float color overflows binary32')
                  view.setFloat32(offset + channel * 4, output, false)
                }
                if (alpha) view.setFloat32(offset + 12, a, false)
              }
            }
            yield {
              x: 0,
              y: sampled.startRow + row,
              width,
              height: 1,
              stride,
              format: pixelFormat,
              data,
              colorSemantics,
              ...(wideInteger
                ? {
                    displayRanges: Array.from({ length: channels }, () => ({
                      black: 0,
                      white: integerMaximum,
                    })),
                  }
                : {}),
            }
          }
        }
        return
      } finally {
        await sequence.close()
      }
    },
  }
}
