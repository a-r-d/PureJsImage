import { throwIfAborted } from '../abort.ts'
import { invalidInput, unsupportedOperation } from '../errors.ts'
import type { JpegXlNativeLayer } from './jpegxl-sequence.ts'
import { upsampleJpegXlNativePlane } from './jpegxl-vardct-render.ts'

export const integerPlane = (layer: Readonly<JpegXlNativeLayer>, index: number): Int32Array => {
  const plane = layer.planes[index]
  if (!(plane instanceof Int32Array)) throw unsupportedOperation('Integer plane unavailable')
  return plane
}

const binary16 = (bits: number): number => {
  const sign = (bits & 0x8000) === 0 ? 1 : -1
  const exponent = (bits >>> 10) & 0x1f
  const fraction = bits & 0x03ff
  if (exponent === 0) return sign * 2 ** -14 * (fraction / 1024)
  if (exponent === 0x1f) return fraction === 0 ? sign * Number.POSITIVE_INFINITY : Number.NaN
  return sign * 2 ** (exponent - 15) * (1 + fraction / 1024)
}

const binary32 = new Float32Array(1)
const binary32Bits = new Uint32Array(binary32.buffer)
export const floatSample = (
  bits: number,
  depth: number,
  exponentBits = depth === 16 ? 5 : 8,
): number => {
  if (depth !== 16 || exponentBits !== 5) {
    if (depth !== 32 || exponentBits !== 8) {
      const unsigned = bits >>> 0
      const mantissaBits = depth - exponentBits - 1
      const mantissaScale = 2 ** mantissaBits
      const sign = unsigned >= 2 ** (depth - 1) ? -1 : 1
      const magnitude = unsigned % 2 ** (depth - 1)
      const exponent = Math.floor(magnitude / mantissaScale)
      const fraction = magnitude % mantissaScale
      const bias = 2 ** (exponentBits - 1) - 1
      if (exponent === 2 ** exponentBits - 1)
        return fraction === 0 ? sign * Number.POSITIVE_INFINITY : Number.NaN
      return exponent === 0
        ? (sign * 2 ** (1 - bias) * fraction) / mantissaScale
        : sign * 2 ** (exponent - bias) * (1 + fraction / mantissaScale)
    }
  } else return binary16(bits)
  binary32Bits[0] = bits >>> 0
  return binary32[0] ?? 0
}

export const normalizedExtraPlane = (
  layer: Readonly<JpegXlNativeLayer>,
  descriptorIndex: number,
  signal?: AbortSignal,
): Float64Array => {
  throwIfAborted(signal)
  const descriptor = layer.header.extraChannels[descriptorIndex]
  const planeIndex = layer.header.colorChannels + descriptorIndex
  const layout = layer.layouts[planeIndex]
  const source = integerPlane(layer, planeIndex)
  const width = layer.layouts[0]?.width ?? 0
  const height = layer.layouts[0]?.height ?? 0
  if (!descriptor || !layout || width < 1 || height < 1)
    throw invalidInput('JPEG XL extra-channel layout is missing')
  const factor =
    (layer.header.extraChannelUpsampling[descriptorIndex] ?? 1) * 2 ** descriptor.dimShift
  if (
    layout.width !== Math.ceil(width / factor) ||
    layout.height !== Math.ceil(height / factor) ||
    source.length !== layout.width * layout.height
  )
    throw invalidInput('JPEG XL extra-channel plane size disagrees with its layout')
  const normalized = new Float64Array(source.length)
  if (descriptor.bitDepth.sampleFormat === 'unsigned-integer') {
    const maximum = 2 ** descriptor.bitDepth.bits - 1
    for (let index = 0; index < source.length; index++)
      normalized[index] = (source[index] ?? 0) / maximum
  } else if (
    descriptor.bitDepth.exponentBits >= 2 &&
    descriptor.bitDepth.exponentBits <= 8 &&
    descriptor.bitDepth.bits - descriptor.bitDepth.exponentBits >= 3 &&
    descriptor.bitDepth.bits - descriptor.bitDepth.exponentBits <= 24
  ) {
    const depth = descriptor.bitDepth.bits
    for (let index = 0; index < source.length; index++)
      normalized[index] = floatSample(source[index] ?? 0, depth, descriptor.bitDepth.exponentBits)
  } else {
    throw unsupportedOperation(
      'JPEG XL display conversion requires valid integer or floating alpha',
    )
  }
  for (let index = 0; index < normalized.length; index++)
    if (!Number.isFinite(normalized[index]))
      throw invalidInput('Float display rejects NaN and infinity')
  return factor === 1
    ? normalized
    : upsampleJpegXlNativePlane(
        normalized,
        layout.width,
        layout.height,
        factor,
        width,
        height,
        layer.header,
        signal,
      )
}
