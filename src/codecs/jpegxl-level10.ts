import { invalidInput, unsupportedOperation } from '../errors.ts'
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
}

const integerPlane = (layer: Readonly<JpegXlNativeLayer>, index: number): Int32Array => {
  const plane = layer.planes[index]
  if (!(plane instanceof Int32Array)) throw unsupportedOperation('Integer plane unavailable')
  return plane
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

/** Explicitly maps binary32 color to integer display samples. Non-finite input is rejected. */
export const convertJpegXlFloat32LayerToRgba16 = (
  layer: Readonly<JpegXlNativeLayer>,
  range: Readonly<{ black: number; white: number }>,
): JpegXlRgba16Image => {
  if (!Number.isFinite(range.black) || !Number.isFinite(range.white) || range.white <= range.black)
    throw invalidInput('Float range must be finite and increasing')
  const planes = jpegXlNativeFloat32ColorPlanes(layer)
  if (planes.length !== 1 && planes.length !== 3)
    throw unsupportedOperation('Float display needs gray or RGB')
  const width = layer.layouts[0]?.width ?? 0
  const height = layer.layouts[0]?.height ?? 0
  const pixels = width * height
  if (pixels < 1 || planes.some((plane) => plane.length !== pixels))
    throw invalidInput('Float plane sizes disagree')
  const output = new Uint16Array(pixels * 4)
  const scale = 65_535 / (range.white - range.black)
  for (let index = 0; index < pixels; index++) {
    const target = index * 4
    for (let channel = 0; channel < 3; channel++) {
      const value = planes[planes.length === 1 ? 0 : channel]?.[index]
      if (value === undefined || !Number.isFinite(value))
        throw invalidInput('Float display rejects NaN and infinity')
      output[target + channel] = Math.round(
        Math.max(0, Math.min(65_535, (value - range.black) * scale)),
      )
    }
    output[target + 3] = 65_535
  }
  return Object.freeze({ width, height, format: 'rgba16' as const, data: output })
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
  const blackMaximum = 2 ** blackDescriptor.bitDepth.bits - 1
  const blackPlaneIndex = layer.header.colorChannels + blackIndex
  const planes = [0, 1, 2, blackPlaneIndex].map((index) => integerPlane(layer, index))
  const width = layer.layouts[0]?.width ?? 0
  const height = layer.layouts[0]?.height ?? 0
  const pixels = width * height
  if (pixels < 1 || planes.slice(0, 3).some((plane) => plane.length !== pixels))
    throw unsupportedOperation('CMYK color planes must be full-size')
  const displayExtra = (
    descriptorIndex: number,
    planeIndex: number,
    maximum: number,
  ): Readonly<{ values: Int32Array | Float64Array; maximum: number }> => {
    const descriptor = layer.header.extraChannels[descriptorIndex]
    const layout = layer.layouts[planeIndex]
    const source = integerPlane(layer, planeIndex)
    if (!descriptor || !layout) throw invalidInput('CMYK extra-channel layout is missing')
    const factor =
      (layer.header.extraChannelUpsampling[descriptorIndex] ?? 1) * 2 ** descriptor.dimShift
    if (
      layout.width !== Math.ceil(width / factor) ||
      layout.height !== Math.ceil(height / factor) ||
      source.length !== layout.width * layout.height
    )
      throw invalidInput('CMYK extra-channel plane size disagrees with its layout')
    if (factor === 1) return { values: source, maximum }
    const normalized = Float64Array.from(source, (value) => value / maximum)
    return {
      values: upsampleJpegXlNativePlane(
        normalized,
        layout.width,
        layout.height,
        factor,
        width,
        height,
        layer.header,
      ),
      maximum: 1,
    }
  }
  const black = displayExtra(blackIndex, blackPlaneIndex, blackMaximum)
  const transform = parseCmykIccTransform(profile)
  const output = new Uint8Array(pixels * 4)
  const alphaIndex = layer.header.extraChannels.findIndex((channel) => channel.type === 0)
  const alphaDescriptor = alphaIndex < 0 ? undefined : layer.header.extraChannels[alphaIndex]
  const alphaMaximum = 2 ** (alphaDescriptor?.bitDepth.bits ?? 8) - 1
  const alpha =
    alphaIndex < 0
      ? undefined
      : displayExtra(alphaIndex, layer.header.colorChannels + alphaIndex, alphaMaximum)
  for (let index = 0; index < pixels; index++) {
    const target = index * 4
    writeCmykIcc(
      transform,
      255 - Math.round(((planes[0]?.[index] ?? 0) * 255) / colorMaximum),
      255 - Math.round(((planes[1]?.[index] ?? 0) * 255) / colorMaximum),
      255 - Math.round(((planes[2]?.[index] ?? 0) * 255) / colorMaximum),
      255 - Math.round(((black.values[index] ?? 0) * 255) / black.maximum),
      output,
      target,
    )
    output[target + 3] = alpha
      ? Math.round(((alpha.values[index] ?? 0) * 255) / alpha.maximum)
      : 255
  }
  return Object.freeze({ width, height, format: 'rgba8' as const, data: output })
}
