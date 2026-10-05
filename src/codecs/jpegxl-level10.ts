import type { PixelColorSemantics } from '../color.ts'
import { invalidInput, limitExceeded, unsupportedOperation } from '../errors.ts'
import {
  parseCmykIccTransform,
  parseCmykIccTransform16,
  parseGrayIccTransform16,
  parseRgbIccTransform16,
  writeCmykIcc,
  writeCmykIcc16,
  writeRgbIcc16,
} from './icc.ts'
import { jpegXlSourceColorSemantics } from './jpegxl-decode.ts'
import { invalidJpegXlInput } from './jpegxl-errors.ts'
import { floatSample, integerPlane, normalizedExtraPlane } from './jpegxl-native-samples.ts'
import type { JpegXlNativeLayer } from './jpegxl-sequence.ts'

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
  readonly displayRange?: Readonly<{ black: number; white: number }>
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

/** Maps native floating color to straight RGBA16. Non-finite input is rejected. */
export const convertJpegXlFloatLayerToRgba16 = (
  layer: Readonly<JpegXlNativeLayer>,
  range: Readonly<{ black: number; white: number }>,
): JpegXlRgba16Image => {
  if (!Number.isFinite(range.black) || !Number.isFinite(range.white) || range.white <= range.black)
    throw invalidInput('Float range must be finite and increasing')
  const header = layer.header
  if (layer.domain !== 'modular' || header.sampleFormat !== 'floating-point')
    throw invalidInput('Not native floating-point color')
  const depth = header.bitDepth
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
      const value = floatSample(source?.[index] ?? 0, depth, header.exponentBits)
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

/** Converts supported high-depth source-profile samples directly to straight sRGB16. */
export const convertJpegXlIccLayerToRgba16 = (
  layer: Readonly<JpegXlNativeLayer>,
): JpegXlRgba16Image => {
  const header = layer.header
  const profile = header.iccProfile
  if (layer.domain !== 'modular' || !profile)
    throw invalidJpegXlInput('native layer has no ICC profile')
  if (header.sampleFormat !== 'unsigned-integer' || header.bitDepth < 8 || header.bitDepth > 16)
    throw unsupportedOperation('High-depth ICC conversion requires 8- through 16-bit integer color')
  const width = layer.layouts[0]?.width ?? 0
  const height = layer.layouts[0]?.height ?? 0
  const pixels = width * height
  if (!Number.isSafeInteger(pixels) || pixels < 1 || pixels > 134_217_728)
    throw limitExceeded('High-depth ICC output exceeds 1 GiB')
  const color = Array.from({ length: header.colorChannels }, (_, index) =>
    integerPlane(layer, index),
  )
  if (color.some((plane) => plane.length !== pixels))
    throw invalidJpegXlInput('ICC color planes must be full-size')
  const blackIndex = header.extraChannels.findIndex((channel) => channel.type === 4)
  if (
    blackIndex >= 0 &&
    header.extraChannels[blackIndex]?.bitDepth.sampleFormat !== 'unsigned-integer'
  )
    throw unsupportedOperation('CMYK black must be integer')
  const black = blackIndex < 0 ? undefined : normalizedExtraPlane(layer, blackIndex)
  const grayTransform =
    blackIndex < 0 && header.colorChannels === 1 ? parseGrayIccTransform16(profile) : undefined
  const rgbTransform =
    blackIndex < 0 && header.colorChannels === 3 ? parseRgbIccTransform16(profile) : undefined
  const cmykTransform =
    blackIndex >= 0 && header.colorChannels === 3 ? parseCmykIccTransform16(profile) : undefined
  if (!grayTransform && !rgbTransform && !cmykTransform)
    throw unsupportedOperation('ICC native display needs GRAY, RGB, or CMYK')
  const alpha = displayAlpha(layer)
  if (alpha && alpha.samples.length !== pixels)
    throw invalidJpegXlInput('ICC alpha plane size disagrees')
  const output = new Uint16Array(pixels * 4)
  const colorMaximum = 2 ** header.bitDepth - 1
  const toIndex = (value: number, alphaValue: number): number =>
    Math.round(Math.max(0, Math.min(1, value / colorMaximum / alphaValue)) * 65_535)
  for (let index = 0; index < pixels; index++) {
    const offset = index * 4
    const alphaValue = alpha?.samples[index] ?? 1
    const denominator = alpha?.associated ? alphaValue : 1
    if (denominator <= 0) {
      output[offset] = 0
      output[offset + 1] = 0
      output[offset + 2] = 0
    } else if (grayTransform) {
      const sample = toIndex(color[0]?.[index] ?? 0, denominator)
      const value = grayTransform[sample] ?? 0
      output[offset] = value
      output[offset + 1] = value
      output[offset + 2] = value
    } else if (rgbTransform) {
      writeRgbIcc16(
        rgbTransform,
        toIndex(color[0]?.[index] ?? 0, denominator),
        toIndex(color[1]?.[index] ?? 0, denominator),
        toIndex(color[2]?.[index] ?? 0, denominator),
        output,
        offset,
      )
    } else if (cmykTransform && black) {
      const blackSample = Math.round(
        Math.max(0, Math.min(1, (black[index] ?? 0) / denominator)) * 65_535,
      )
      writeCmykIcc16(
        cmykTransform,
        65_535 - toIndex(color[0]?.[index] ?? 0, denominator),
        65_535 - toIndex(color[1]?.[index] ?? 0, denominator),
        65_535 - toIndex(color[2]?.[index] ?? 0, denominator),
        65_535 - blackSample,
        output,
        offset,
      )
    }
    output[offset + 3] = Math.round(Math.max(0, Math.min(1, alphaValue)) * 65_535)
  }
  const sourceColorSemantics = jpegXlSourceColorSemantics(header)
  const colorSemantics: PixelColorSemantics = Object.freeze({
    family: 'rgb',
    primaries: 'srgb',
    transfer: Object.freeze({ kind: 'srgb' }),
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
    sourceColorSemantics,
  })
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
