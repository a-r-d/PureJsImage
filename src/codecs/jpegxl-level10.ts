import { invalidInput, unsupportedOperation } from '../errors.ts'
import type { PixelColorSemantics } from '../color.ts'
import { jpegXlSourceColorSemantics } from './jpegxl-decode.ts'
import { parseCmykIccTransform, writeCmykIcc } from './icc.ts'
import type { JpegXlNativeLayer } from './jpegxl-sequence.ts'
import { upsampleJpegXlNativePlane } from './jpegxl-vardct-render.ts'

export interface JpegXlRgba8Image {
  readonly width: number
  readonly height: number
  readonly format: 'rgba8'
  readonly data: Uint8Array
}

export interface JpegXlRgba16Image {
  readonly width: number
  readonly height: number
  readonly format: 'rgba16'
  readonly data: Uint16Array
  /** The mapped RGB samples have straight alpha, even when source samples were associated. */
  readonly colorSemantics: PixelColorSemantics
  readonly sourceColorSemantics: PixelColorSemantics
  readonly displayRange: Readonly<{ black: number; white: number }>
}

const integerPlane = (layer: Readonly<JpegXlNativeLayer>, index: number): Int32Array => {
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
const floatSample = (bits: number, depth: 16 | 32): number => {
  if (depth === 16) return binary16(bits)
  binary32Bits[0] = bits >>> 0
  return binary32[0] ?? 0
}

const normalizedExtraPlane = (
  layer: Readonly<JpegXlNativeLayer>,
  descriptorIndex: number,
): Float64Array => {
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
    (descriptor.bitDepth.bits === 16 && descriptor.bitDepth.exponentBits === 5) ||
    (descriptor.bitDepth.bits === 32 && descriptor.bitDepth.exponentBits === 8)
  ) {
    const depth = descriptor.bitDepth.bits === 16 ? 16 : 32
    for (let index = 0; index < source.length; index++)
      normalized[index] = floatSample(source[index] ?? 0, depth)
  } else {
    throw unsupportedOperation('JPEG XL display conversion requires integer or IEEE alpha')
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
      )
}

const displayAlpha = (
  layer: Readonly<JpegXlNativeLayer>,
):
  | Readonly<{
      samples: Float64Array
      associated: boolean
    }>
  | undefined => {
  const selected = layer.header.selectedAlphaChannel
  const index =
    selected !== undefined && layer.header.extraChannels[selected]?.type === 0
      ? selected
      : layer.header.extraChannels.findIndex((channel) => channel.type === 0)
  if (index < 0) return undefined
  return Object.freeze({
    samples: normalizedExtraPlane(layer, index),
    associated: layer.header.extraChannels[index]?.associatedAlpha ?? false,
  })
}

/** Returns caller-owned unsigned samples without losing integer or floating-point bit patterns. */
export const jpegXlNativeUnsignedPlanes = (
  layer: Readonly<JpegXlNativeLayer>,
): readonly Uint32Array[] =>
  Object.freeze(
    layer.planes.map((_, index) => {
      const source = integerPlane(layer, index)
      const output = new Uint32Array(source.length)
      for (let sample = 0; sample < source.length; sample++) output[sample] = source[sample] ?? 0
      return output
    }),
  )

/** Reinterprets native IEEE binary32 color samples exactly, including signed zero and subnormals. */
export const jpegXlNativeFloat32ColorPlanes = (
  layer: Readonly<JpegXlNativeLayer>,
): readonly Float32Array[] => {
  if (
    layer.domain !== 'modular' ||
    layer.header.sampleFormat !== 'floating-point' ||
    layer.header.bitDepth !== 32 ||
    layer.header.exponentBits !== 8
  )
    throw invalidInput('Not IEEE binary32 color')
  return Object.freeze(
    Array.from({ length: layer.header.colorChannels }, (_, index) => {
      const source = integerPlane(layer, index)
      const output = new Float32Array(source.length)
      new Uint32Array(output.buffer).set(source)
      return output
    }),
  )
}

/** Maps IEEE binary16/32 native color to straight RGBA16. Non-finite input is rejected. */
export const convertJpegXlFloatLayerToRgba16 = (
  layer: Readonly<JpegXlNativeLayer>,
  range: Readonly<{ black: number; white: number }>,
): JpegXlRgba16Image => {
  if (!Number.isFinite(range.black) || !Number.isFinite(range.white) || range.white <= range.black)
    throw invalidInput('Float range must be finite and increasing')
  const header = layer.header
  if (layer.domain !== 'modular' || header.sampleFormat !== 'floating-point')
    throw invalidInput('Not IEEE floating-point color')
  const depth =
    header.bitDepth === 16 && header.exponentBits === 5
      ? 16
      : header.bitDepth === 32 && header.exponentBits === 8
        ? 32
        : undefined
  if (!depth) throw unsupportedOperation('Float display needs IEEE binary16 or binary32 color')
  if (header.colorChannels !== 1 && header.colorChannels !== 3)
    throw unsupportedOperation('Float display needs gray or RGB')
  const width = layer.layouts[0]?.width ?? 0
  const height = layer.layouts[0]?.height ?? 0
  const pixels = width * height
  const planes = Array.from({ length: header.colorChannels }, (_, index) =>
    integerPlane(layer, index),
  )
  if (pixels < 1 || planes.some((plane) => plane.length !== pixels))
    throw invalidInput('Float plane sizes disagree')
  const alpha = displayAlpha(layer)
  if (alpha && alpha.samples.length !== pixels)
    throw invalidInput('Float alpha plane size disagrees')
  const output = new Uint16Array(pixels * 4)
  const scale = 65_535 / (range.white - range.black)
  for (let index = 0; index < pixels; index++) {
    const target = index * 4
    const alphaValue = alpha?.samples[index] ?? 1
    const unitAlpha = Math.max(0, Math.min(1, alphaValue))
    for (let channel = 0; channel < 3; channel++) {
      const source = planes[planes.length === 1 ? 0 : channel]
      const value = floatSample(source?.[index] ?? 0, depth)
      if (!Number.isFinite(value)) throw invalidInput('Float display rejects NaN and infinity')
      // Associated samples must be straightened in the native domain. Applying the
      // nonzero display black point first would change their color meaning.
      if (alpha?.associated && alphaValue <= 0) {
        output[target + channel] = 0
        continue
      }
      const straight = alpha?.associated ? value / alphaValue : value
      output[target + channel] = Math.round(
        Math.max(0, Math.min(65_535, (straight - range.black) * scale)),
      )
    }
    output[target + 3] = Math.round(unitAlpha * 65_535)
  }
  const sourceSemantics = jpegXlSourceColorSemantics(header)
  const colorSemantics: PixelColorSemantics = Object.freeze({
    family: 'rgb',
    primaries: 'unspecified',
    transfer: Object.freeze({ kind: 'unspecified' }),
    matrix: 'identity',
    range: 'full',
    alpha: 'straight',
    provenance: 'decoder-converted',
  })
  return Object.freeze({
    width,
    height,
    format: 'rgba16' as const,
    data: output,
    colorSemantics,
    sourceColorSemantics: sourceSemantics,
    displayRange: Object.freeze({ black: range.black, white: range.white }),
  })
}

/** Retained binary32-specific entry point for existing callers. */
export const convertJpegXlFloat32LayerToRgba16 = (
  layer: Readonly<JpegXlNativeLayer>,
  range: Readonly<{ black: number; white: number }>,
): JpegXlRgba16Image => {
  if (layer.header.bitDepth !== 32 || layer.header.exponentBits !== 8)
    throw invalidInput('Not IEEE binary32 color')
  return convertJpegXlFloatLayerToRgba16(layer, range)
}

/** Applies the embedded CMYK ICC profile while leaving native CMYK planes available separately. */
export const convertJpegXlCmykLayerToRgba8 = (
  layer: Readonly<JpegXlNativeLayer>,
): JpegXlRgba8Image => {
  const blackIndex = layer.header.extraChannels.findIndex((channel) => channel.type === 4)
  const profile = layer.header.iccProfile
  if (layer.domain !== 'modular' || layer.header.colorChannels !== 3 || blackIndex < 0 || !profile)
    throw invalidInput('Not profile-defined CMYK')
  if (layer.header.sampleFormat !== 'unsigned-integer')
    throw unsupportedOperation('CMYK needs integer color')
  const colorMaximum = 2 ** layer.header.bitDepth - 1
  const blackDescriptor = layer.header.extraChannels[blackIndex]
  if (blackDescriptor?.bitDepth.sampleFormat !== 'unsigned-integer')
    throw unsupportedOperation('CMYK black is not integer')
  const blackPlaneIndex = layer.header.colorChannels + blackIndex
  const planes = [0, 1, 2, blackPlaneIndex].map((index) => integerPlane(layer, index))
  const width = layer.layouts[0]?.width ?? 0
  const height = layer.layouts[0]?.height ?? 0
  const pixels = width * height
  if (pixels < 1 || planes.slice(0, 3).some((plane) => plane.length !== pixels))
    throw unsupportedOperation('CMYK color planes must be full-size')
  const black = normalizedExtraPlane(layer, blackIndex)
  const transform = parseCmykIccTransform(profile)
  const output = new Uint8Array(pixels * 4)
  const alpha = displayAlpha(layer)
  if (alpha?.associated)
    throw unsupportedOperation('JPEG XL CMYK display conversion does not support associated alpha')
  for (let index = 0; index < pixels; index++) {
    const target = index * 4
    writeCmykIcc(
      transform,
      255 - Math.round(((planes[0]?.[index] ?? 0) * 255) / colorMaximum),
      255 - Math.round(((planes[1]?.[index] ?? 0) * 255) / colorMaximum),
      255 - Math.round(((planes[2]?.[index] ?? 0) * 255) / colorMaximum),
      255 - Math.round((black[index] ?? 0) * 255),
      output,
      target,
    )
    output[target + 3] = alpha
      ? Math.round(Math.max(0, Math.min(1, alpha.samples[index] ?? 0)) * 255)
      : 255
  }
  return Object.freeze({ width, height, format: 'rgba8' as const, data: output })
}
