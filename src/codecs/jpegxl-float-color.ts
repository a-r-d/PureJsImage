import { unsupportedOperation } from '../errors.ts'
import {
  createNclxHdrToneMap,
  createStructuredRgbMatrix,
  linearToSrgb,
  type NclxHdrToneMap,
  nclxToLinear,
} from './icc.ts'
import type { JpegXlFrameStructure } from './jpegxl-decode.ts'

/** One bounded SDR transfer function is selected before entering output loops. */
export const createJpegXlFloatSdrTransfer = (
  frame: Readonly<JpegXlFrameStructure>,
): ((sample: number) => number) => {
  const transfer = frame.colorSemanticsTransfer
  if (transfer.kind === 'linear') return (sample) => sample
  if (transfer.kind === 'srgb')
    return (sample) => (sample <= 0.04045 ? sample / 12.92 : ((sample + 0.055) / 1.055) ** 2.4)
  if (transfer.kind === 'bt709')
    return (sample) => (sample < 0.081 ? sample / 4.5 : ((sample + 0.099) / 1.099) ** (1 / 0.45))
  if (transfer.kind === 'gamma') {
    const exponent = transfer.exponent
    return (sample) => sample ** exponent
  }
  throw unsupportedOperation('JPEG XL floating sRGB conversion requires a structured SDR transfer')
}

export const jpegXlFloatSdrMatrix = (frame: Readonly<JpegXlFrameStructure>): Float64Array => {
  if (frame.iccProfile)
    throw unsupportedOperation(
      'JPEG XL floating ICC conversion requires explicit native channel extraction',
    )
  if (frame.chromaticities && frame.renderingIntent !== 'relative')
    throw unsupportedOperation('JPEG XL floating custom-color conversion requires relative intent')
  return frame.colorChannels === 1 ||
    (frame.colorSemanticsPrimaries === 'srgb' && !frame.chromaticities)
    ? Float64Array.of(1, 0, 0, 0, 1, 0, 0, 0, 1)
    : createStructuredRgbMatrix(frame.colorSemanticsPrimaries, frame.chromaticities)
}

/** Clamp only at the explicitly requested SDR display boundary. */
export const jpegXlFloatSdrCode = (linear: number): number =>
  Math.round(Math.max(0, Math.min(1, linearToSrgb(linear))) * 65_535)

/** Float HDR evaluates the transfer directly, without rounding its input to integer codes. */
export const createJpegXlFloatHdrTransform = (
  frame: Readonly<JpegXlFrameStructure>,
): {
  readonly transfer: (sample: number) => number
  readonly toneMap: NclxHdrToneMap
} => {
  if (frame.iccProfile)
    throw unsupportedOperation('JPEG XL HDR conversion requires structured transfer metadata')
  const kind = frame.colorSemanticsTransfer.kind
  if (kind !== 'pq' && kind !== 'hlg' && kind !== 'linear')
    throw unsupportedOperation('JPEG XL float HDR conversion requires PQ, HLG or linear samples')
  const primaries =
    frame.colorChannels === 1 || frame.colorSemanticsPrimaries === 'srgb'
      ? 1
      : frame.colorSemanticsPrimaries === 'rec2020'
        ? 9
        : frame.colorSemanticsPrimaries === 'display-p3'
          ? 12
          : undefined
  if (frame.chromaticities && frame.renderingIntent !== 'relative')
    throw unsupportedOperation('JPEG XL custom HDR conversion requires relative intent')
  const matrix = createStructuredRgbMatrix(frame.colorSemanticsPrimaries, frame.chromaticities)
  const base = createNclxHdrToneMap(primaries ?? 1, kind === 'hlg' ? 18 : 16)
  const custom = frame.chromaticities !== undefined || primaries === undefined
  const luma: readonly [number, number, number] = [
    0.2126 * (matrix[0] ?? 0) + 0.7152 * (matrix[3] ?? 0) + 0.0722 * (matrix[6] ?? 0),
    0.2126 * (matrix[1] ?? 0) + 0.7152 * (matrix[4] ?? 0) + 0.0722 * (matrix[7] ?? 0),
    0.2126 * (matrix[2] ?? 0) + 0.7152 * (matrix[5] ?? 0) + 0.0722 * (matrix[8] ?? 0),
  ]
  const colorMap = custom
    ? { ...base, sourceToSrgb: matrix, ...(kind === 'hlg' ? { hlgLumaCoefficients: luma } : {}) }
    : base
  const toneMap: NclxHdrToneMap =
    kind === 'pq'
      ? colorMap
      : {
          ...colorMap,
          sourcePeak: frame.toneMapping.intensityTarget / 203,
          ...(kind === 'hlg'
            ? { hlgSystemGamma: 1.2 * 1.111 ** Math.log2(frame.toneMapping.intensityTarget / 1000) }
            : {}),
        }
  return {
    transfer:
      kind === 'linear'
        ? (sample) => sample
        : (sample) => nclxToLinear(kind === 'pq' ? 16 : 18, Math.max(0, Math.min(1, sample))),
    toneMap,
  }
}
