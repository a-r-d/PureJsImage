import type { DecodeRequest, DecoderCapabilities, ImageDecoder } from '../codec.ts'
import { invalidInput, truncatedInput, unsupportedOperation } from '../errors.ts'
import type { PixelBlock, PixelFormat } from '../pixel.ts'

const ICC_HEADER_BYTES = 128
export const MAX_ICC_PROFILE_BYTES = 16 * 1024 * 1024
const SRGB_ENCODE_STEPS = 4095

interface IccTag {
  readonly offset: number
  readonly size: number
}

interface RgbMatrixIccTransform {
  readonly kind: 'rgb'
  readonly method: 'matrix'
  readonly redToRed: Float32Array
  readonly redToGreen: Float32Array
  readonly redToBlue: Float32Array
  readonly greenToRed: Float32Array
  readonly greenToGreen: Float32Array
  readonly greenToBlue: Float32Array
  readonly blueToRed: Float32Array
  readonly blueToGreen: Float32Array
  readonly blueToBlue: Float32Array
  readonly encode: Uint8Array
}

interface RgbLutIccTransform {
  readonly kind: 'rgb'
  readonly method: 'lut'
  readonly inputCurves: readonly Float32Array[]
  readonly gridPoints: readonly number[]
  readonly clut: Uint16Array
  readonly middleCurves: readonly Float32Array[]
  readonly matrix: Float64Array
  readonly outputCurves: readonly Float32Array[]
  readonly pcs: 'Lab ' | 'XYZ '
  readonly encode: Uint8Array
}

export type RgbIccTransform = RgbLutIccTransform | RgbMatrixIccTransform

interface CmykInputAxis {
  readonly low: Uint8Array
  readonly fraction: Float32Array
}

export interface CmykIccTransform {
  readonly kind: 'cmyk'
  readonly gridPoints: number
  readonly cyan: CmykInputAxis
  readonly magenta: CmykInputAxis
  readonly yellow: CmykInputAxis
  readonly black: CmykInputAxis
  readonly clut: Uint16Array
  readonly outputTables: Uint16Array
  readonly outputEntries: number
  readonly pcs: 'Lab ' | 'XYZ '
  readonly encode: Uint8Array
}

export type JpegIccTransform = CmykIccTransform | RgbIccTransform

const byte = (data: Uint8Array, offset: number): number => data[offset] ?? 0

const uint16 = (data: Uint8Array, offset: number): number => {
  if (offset < 0 || offset + 2 > data.byteLength) throw truncatedInput('ICC value is truncated')
  return byte(data, offset) * 256 + byte(data, offset + 1)
}

const uint32 = (data: Uint8Array, offset: number): number => {
  if (offset < 0 || offset + 4 > data.byteLength) throw truncatedInput('ICC value is truncated')
  return (
    byte(data, offset) * 16_777_216 +
    byte(data, offset + 1) * 65_536 +
    byte(data, offset + 2) * 256 +
    byte(data, offset + 3)
  )
}

const fixed = (data: Uint8Array, offset: number): number => {
  const unsigned = uint32(data, offset)
  return (unsigned >= 2_147_483_648 ? unsigned - 4_294_967_296 : unsigned) / 65_536
}

const signature = (data: Uint8Array, offset: number): string =>
  String.fromCharCode(
    byte(data, offset),
    byte(data, offset + 1),
    byte(data, offset + 2),
    byte(data, offset + 3),
  )

const tags = (profile: Uint8Array, profileBytes: number): ReadonlyMap<string, IccTag> => {
  const count = uint32(profile, ICC_HEADER_BYTES)
  if (count > 4_096 || ICC_HEADER_BYTES + 4 + count * 12 > profileBytes) {
    throw invalidInput('ICC tag table is invalid')
  }
  const output = new Map<string, IccTag>()
  for (let index = 0; index < count; index += 1) {
    const entry = ICC_HEADER_BYTES + 4 + index * 12
    const name = signature(profile, entry)
    const offset = uint32(profile, entry + 4)
    const size = uint32(profile, entry + 8)
    if (size < 8 || offset < ICC_HEADER_BYTES || offset + size > profileBytes) {
      throw invalidInput(`ICC tag ${name} has an invalid extent`)
    }
    output.set(name, { offset, size })
  }
  return output
}

const validatedProfile = (
  profile: Uint8Array,
): { readonly profileBytes: number; readonly allTags: ReadonlyMap<string, IccTag> } => {
  if (profile.byteLength < ICC_HEADER_BYTES + 4) throw truncatedInput('ICC profile is truncated')
  const profileBytes = uint32(profile, 0)
  if (
    profileBytes < ICC_HEADER_BYTES + 4 ||
    profileBytes > profile.byteLength ||
    profile.byteLength > MAX_ICC_PROFILE_BYTES ||
    profileBytes > MAX_ICC_PROFILE_BYTES ||
    signature(profile, 36) !== 'acsp'
  ) {
    throw invalidInput('ICC profile header is invalid')
  }
  return { profileBytes, allTags: tags(profile, profileBytes) }
}

const utf16BigEndian = (data: Uint8Array): string => {
  if (data.byteLength % 2 !== 0) throw invalidInput('ICC localized description is malformed')
  const characters: string[] = []
  for (let offset = 0; offset < data.byteLength; offset += 2) {
    const code = uint16(data, offset)
    if (code !== 0) characters.push(String.fromCharCode(code))
  }
  return characters.join('').trim()
}

const profileDescription = (
  profile: Uint8Array,
  allTags: ReadonlyMap<string, IccTag>,
): string | undefined => {
  const tag = allTags.get('desc')
  if (!tag) return undefined
  const type = signature(profile, tag.offset)
  if (type === 'desc') {
    if (tag.size < 12) throw invalidInput('ICC profile description is truncated')
    const length = uint32(profile, tag.offset + 8)
    if (length < 1 || 12 + length > tag.size) {
      throw invalidInput('ICC profile description has an invalid extent')
    }
    if (profile[tag.offset + 12 + length - 1] !== 0) {
      throw invalidInput('ICC profile description is not null terminated')
    }
    const bytes = profile.subarray(tag.offset + 12, tag.offset + 12 + length - 1)
    return new TextDecoder('latin1').decode(bytes).trim() || undefined
  }
  if (type === 'mluc') {
    if (tag.size < 16) throw invalidInput('ICC localized description is truncated')
    const count = uint32(profile, tag.offset + 8)
    const recordBytes = uint32(profile, tag.offset + 12)
    if (count > 4096 || recordBytes !== 12 || 16 + count * recordBytes > tag.size) {
      throw invalidInput('ICC localized description table is invalid')
    }
    for (let index = 0; index < count; index += 1) {
      const record = tag.offset + 16 + index * recordBytes
      const length = uint32(profile, record + 4)
      const relativeOffset = uint32(profile, record + 8)
      if (
        length % 2 !== 0 ||
        relativeOffset < 16 + count * recordBytes ||
        relativeOffset + length > tag.size
      ) {
        throw invalidInput('ICC localized description has an invalid extent')
      }
      const value = utf16BigEndian(
        profile.subarray(tag.offset + relativeOffset, tag.offset + relativeOffset + length),
      )
      if (value) return value
    }
    return undefined
  }
  return undefined
}

export const inspectIccProfile = (profile: Uint8Array): { readonly description?: string } => {
  const { allTags } = validatedProfile(profile)
  const description = profileDescription(profile, allTags)
  return description === undefined ? {} : { description }
}

const requiredTag = (allTags: ReadonlyMap<string, IccTag>, name: string): IccTag => {
  const tag = allTags.get(name)
  if (!tag) throw invalidInput(`ICC profile is missing ${name}`)
  return tag
}

const xyzTag = (profile: Uint8Array, tag: IccTag): readonly [number, number, number] => {
  if (tag.size < 20 || signature(profile, tag.offset) !== 'XYZ ') {
    throw invalidInput('ICC colorant tag is not XYZ data')
  }
  return [
    fixed(profile, tag.offset + 8),
    fixed(profile, tag.offset + 12),
    fixed(profile, tag.offset + 16),
  ]
}

const curveValue = (profile: Uint8Array, tag: IccTag, input: number): number => {
  const type = signature(profile, tag.offset)
  if (type === 'curv') {
    const count = uint32(profile, tag.offset + 8)
    if (count === 0) return input
    if (count === 1) {
      if (tag.size < 14) throw truncatedInput('ICC gamma curve is truncated')
      return input ** (uint16(profile, tag.offset + 12) / 256)
    }
    if (count > 65_536 || 12 + count * 2 > tag.size) {
      throw invalidInput('ICC sampled curve is invalid')
    }
    const position = input * (count - 1)
    const low = Math.floor(position)
    const high = Math.min(count - 1, low + 1)
    const fraction = position - low
    const first = uint16(profile, tag.offset + 12 + low * 2)
    const second = uint16(profile, tag.offset + 12 + high * 2)
    return (first + (second - first) * fraction) / 65_535
  }
  if (type !== 'para' || tag.size < 16) {
    throw invalidInput(`ICC tone curve type ${type} is unsupported`)
  }
  const functionType = uint16(profile, tag.offset + 8)
  const parameterCount = [1, 3, 4, 5, 7][functionType]
  if (parameterCount === undefined || 12 + parameterCount * 4 > tag.size) {
    throw invalidInput(`ICC parametric curve ${functionType} is unsupported`)
  }
  const parameter = (index: number): number => fixed(profile, tag.offset + 12 + index * 4)
  const g = parameter(0)
  if (functionType === 0) return input ** g
  const a = parameter(1)
  const b = parameter(2)
  const threshold = functionType < 3 ? -b / a : parameter(4)
  if (input >= threshold) {
    const powered = (a * input + b) ** g
    if (functionType === 2) return powered + parameter(3)
    if (functionType === 4) return powered + parameter(5)
    return powered
  }
  if (functionType < 2) return 0
  if (functionType === 2) return parameter(3)
  const c = parameter(3)
  return c * input + (functionType === 4 ? parameter(6) : 0)
}

const curveLut = (profile: Uint8Array, tag: IccTag): Float32Array =>
  Float32Array.from({ length: 256 }, (_, value) => curveValue(profile, tag, value / 255))

const curveAt = (
  profile: Uint8Array,
  offset: number,
  end: number,
): { readonly tag: IccTag; readonly next: number } => {
  if (offset < 0 || offset + 12 > end) throw truncatedInput('ICC curve set is truncated')
  const type = signature(profile, offset)
  let size: number
  if (type === 'curv') {
    const count = uint32(profile, offset + 8)
    if (count > 65_536) throw invalidInput('ICC sampled curve is invalid')
    size = 12 + count * 2
  } else if (type === 'para') {
    const functionType = uint16(profile, offset + 8)
    const parameterCount = [1, 3, 4, 5, 7][functionType]
    if (parameterCount === undefined) {
      throw invalidInput(`ICC parametric curve ${functionType} is unsupported`)
    }
    size = 12 + parameterCount * 4
  } else {
    throw invalidInput(`ICC tone curve type ${type} is unsupported`)
  }
  if (offset + size > end) throw truncatedInput('ICC curve set is truncated')
  return { tag: { offset, size }, next: offset + ((size + 3) & ~3) }
}

const curveSet = (
  profile: Uint8Array,
  tag: IccTag,
  relativeOffset: number,
  channels: number,
  entries: number,
): readonly Float32Array[] => {
  if (relativeOffset === 0) {
    const identity = Float32Array.from({ length: entries }, (_, index) => index / (entries - 1))
    return Array.from({ length: channels }, () => identity)
  }
  if (relativeOffset < 32 || relativeOffset >= tag.size) {
    throw invalidInput('ICC mAB curve offset is invalid')
  }
  const end = tag.offset + tag.size
  let offset = tag.offset + relativeOffset
  const output: Float32Array[] = []
  for (let channel = 0; channel < channels; channel += 1) {
    const curve = curveAt(profile, offset, end)
    output.push(
      Float32Array.from({ length: entries }, (_, index) =>
        curveValue(profile, curve.tag, index / (entries - 1)),
      ),
    )
    offset = curve.next
  }
  return output
}

let cachedSrgbEncodeLut: Uint8Array | undefined

const srgbEncodeLut = (): Uint8Array => {
  if (cachedSrgbEncodeLut) return cachedSrgbEncodeLut
  cachedSrgbEncodeLut = Uint8Array.from({ length: SRGB_ENCODE_STEPS + 1 }, (_, index) => {
    const linear = index / SRGB_ENCODE_STEPS
    const encoded = linear <= 0.0031308 ? linear * 12.92 : 1.055 * linear ** (1 / 2.4) - 0.055
    return Math.round(encoded * 255)
  })
  return cachedSrgbEncodeLut
}

const multiply3x3 = (left: Float64Array, right: Float64Array): Float64Array => {
  const output = new Float64Array(9)
  for (let row = 0; row < 3; row += 1) {
    for (let column = 0; column < 3; column += 1) {
      output[row * 3 + column] =
        (left[row * 3] ?? 0) * (right[column] ?? 0) +
        (left[row * 3 + 1] ?? 0) * (right[3 + column] ?? 0) +
        (left[row * 3 + 2] ?? 0) * (right[6 + column] ?? 0)
    }
  }
  return output
}

const multiplyMatrixVector = (
  matrix: Float64Array,
  vector: readonly [number, number, number],
): readonly [number, number, number] => [
  (matrix[0] ?? 0) * vector[0] + (matrix[1] ?? 0) * vector[1] + (matrix[2] ?? 0) * vector[2],
  (matrix[3] ?? 0) * vector[0] + (matrix[4] ?? 0) * vector[1] + (matrix[5] ?? 0) * vector[2],
  (matrix[6] ?? 0) * vector[0] + (matrix[7] ?? 0) * vector[1] + (matrix[8] ?? 0) * vector[2],
]

const inverse3x3 = (matrix: Float64Array): Float64Array => {
  const a = matrix[0] ?? 0
  const b = matrix[1] ?? 0
  const c = matrix[2] ?? 0
  const d = matrix[3] ?? 0
  const e = matrix[4] ?? 0
  const f = matrix[5] ?? 0
  const g = matrix[6] ?? 0
  const h = matrix[7] ?? 0
  const i = matrix[8] ?? 0
  const determinant = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g)
  if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-12) {
    throw invalidInput('RGB chromaticities do not form an invertible color space')
  }
  const scale = 1 / determinant
  return Float64Array.of(
    (e * i - f * h) * scale,
    (c * h - b * i) * scale,
    (b * f - c * e) * scale,
    (f * g - d * i) * scale,
    (a * i - c * g) * scale,
    (c * d - a * f) * scale,
    (d * h - e * g) * scale,
    (b * g - a * h) * scale,
    (a * e - b * d) * scale,
  )
}

const xyzToSrgb = Float64Array.of(
  3.2404542,
  -1.5371385,
  -0.4985314,
  -0.969266,
  1.8760108,
  0.041556,
  0.0556434,
  -0.2040259,
  1.0572252,
)

const transformFromMatrixAndCurves = (
  matrix: Float64Array,
  redCurve: Float32Array,
  greenCurve: Float32Array,
  blueCurve: Float32Array,
): RgbIccTransform => {
  const contribution = (curve: Float32Array, scale: number): Float32Array =>
    Float32Array.from(curve, (value) => value * scale)
  return {
    kind: 'rgb',
    method: 'matrix',
    redToRed: contribution(redCurve, matrix[0] ?? 0),
    redToGreen: contribution(redCurve, matrix[3] ?? 0),
    redToBlue: contribution(redCurve, matrix[6] ?? 0),
    greenToRed: contribution(greenCurve, matrix[1] ?? 0),
    greenToGreen: contribution(greenCurve, matrix[4] ?? 0),
    greenToBlue: contribution(greenCurve, matrix[7] ?? 0),
    blueToRed: contribution(blueCurve, matrix[2] ?? 0),
    blueToGreen: contribution(blueCurve, matrix[5] ?? 0),
    blueToBlue: contribution(blueCurve, matrix[8] ?? 0),
    encode: srgbEncodeLut(),
  }
}

const mabMatrix = (profile: Uint8Array, tag: IccTag, relativeOffset: number): Float64Array => {
  if (relativeOffset === 0) {
    return Float64Array.of(1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0)
  }
  if (relativeOffset < 32 || relativeOffset + 48 > tag.size) {
    throw invalidInput('ICC mAB matrix offset is invalid')
  }
  const offset = tag.offset + relativeOffset
  return Float64Array.from({ length: 12 }, (_, index) => fixed(profile, offset + index * 4))
}

const rgbLutTransform = (
  profile: Uint8Array,
  tag: IccTag,
  pcs: 'Lab ' | 'XYZ ',
): RgbIccTransform => {
  if (tag.size < 32 || signature(profile, tag.offset) !== 'mAB ') {
    throw unsupportedOperation('RGB ICC A2B0 must use a supported mAB transform')
  }
  const inputChannels = byte(profile, tag.offset + 8)
  const outputChannels = byte(profile, tag.offset + 9)
  if (inputChannels !== 3 || outputChannels !== 3) {
    throw unsupportedOperation('RGB ICC mAB transforms must use three input and output channels')
  }
  const outputCurveOffset = uint32(profile, tag.offset + 12)
  const matrixOffset = uint32(profile, tag.offset + 16)
  const middleCurveOffset = uint32(profile, tag.offset + 20)
  const clutOffset = uint32(profile, tag.offset + 24)
  const inputCurveOffset = uint32(profile, tag.offset + 28)
  if (clutOffset < 32 || clutOffset + 20 > tag.size) {
    throw invalidInput('ICC mAB CLUT offset is invalid')
  }
  const clutHeader = tag.offset + clutOffset
  const gridPoints = [
    byte(profile, clutHeader),
    byte(profile, clutHeader + 1),
    byte(profile, clutHeader + 2),
  ]
  if (gridPoints.some((value) => value < 2 || value > 33)) {
    throw unsupportedOperation('RGB ICC mAB CLUT grid dimensions are unsupported')
  }
  const precision = byte(profile, clutHeader + 16)
  if (precision !== 1 && precision !== 2) {
    throw invalidInput('ICC mAB CLUT precision must be one or two bytes')
  }
  const clutValues = (gridPoints[0] ?? 0) * (gridPoints[1] ?? 0) * (gridPoints[2] ?? 0) * 3
  const clutBytes = clutValues * precision
  if (clutOffset + 20 + clutBytes > tag.size) throw truncatedInput('ICC mAB CLUT is truncated')
  const clut = new Uint16Array(clutValues)
  const clutData = clutHeader + 20
  for (let index = 0; index < clutValues; index += 1) {
    clut[index] =
      precision === 1
        ? byte(profile, clutData + index) * 257
        : uint16(profile, clutData + index * 2)
  }
  return {
    kind: 'rgb',
    method: 'lut',
    inputCurves: curveSet(profile, tag, inputCurveOffset, 3, 256),
    gridPoints,
    clut,
    middleCurves: curveSet(profile, tag, middleCurveOffset, 3, SRGB_ENCODE_STEPS + 1),
    matrix: mabMatrix(profile, tag, matrixOffset),
    outputCurves: curveSet(profile, tag, outputCurveOffset, 3, SRGB_ENCODE_STEPS + 1),
    pcs,
    encode: srgbEncodeLut(),
  }
}

const rgbTransform = (
  profile: Uint8Array,
  allTags: ReadonlyMap<string, IccTag>,
  pcs: 'Lab ' | 'XYZ ',
): RgbIccTransform => {
  const matrixAndCurves =
    allTags.has('rXYZ') &&
    allTags.has('gXYZ') &&
    allTags.has('bXYZ') &&
    allTags.has('rTRC') &&
    allTags.has('gTRC') &&
    allTags.has('bTRC')
  if (!matrixAndCurves) {
    return rgbLutTransform(profile, requiredTag(allTags, 'A2B0'), pcs)
  }
  const red = xyzTag(profile, requiredTag(allTags, 'rXYZ'))
  const green = xyzTag(profile, requiredTag(allTags, 'gXYZ'))
  const blue = xyzTag(profile, requiredTag(allTags, 'bXYZ'))
  const colorants = Float64Array.of(
    red[0],
    green[0],
    blue[0],
    red[1],
    green[1],
    blue[1],
    red[2],
    green[2],
    blue[2],
  )
  const d50ToD65 = Float64Array.of(
    0.9555766,
    -0.0230393,
    0.0631636,
    -0.0282895,
    1.0099416,
    0.0210077,
    0.0122982,
    -0.020483,
    1.3299098,
  )
  const matrix = multiply3x3(xyzToSrgb, multiply3x3(d50ToD65, colorants))
  const redCurve = curveLut(profile, requiredTag(allTags, 'rTRC'))
  const greenCurve = curveLut(profile, requiredTag(allTags, 'gTRC'))
  const blueCurve = curveLut(profile, requiredTag(allTags, 'bTRC'))
  return transformFromMatrixAndCurves(matrix, redCurve, greenCurve, blueCurve)
}

export interface RgbChromaticities {
  readonly whiteX: number
  readonly whiteY: number
  readonly redX: number
  readonly redY: number
  readonly greenX: number
  readonly greenY: number
  readonly blueX: number
  readonly blueY: number
}

const chromaticityXyz = (x: number, y: number): readonly [number, number, number] => {
  if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y <= 0 || x + y > 1) {
    throw invalidInput('PNG cHRM contains an invalid chromaticity')
  }
  return [x / y, 1, (1 - x - y) / y]
}

const chromaticityMatrix = (chromaticities: RgbChromaticities): Float64Array => {
  const red = chromaticityXyz(chromaticities.redX, chromaticities.redY)
  const green = chromaticityXyz(chromaticities.greenX, chromaticities.greenY)
  const blue = chromaticityXyz(chromaticities.blueX, chromaticities.blueY)
  const white = chromaticityXyz(chromaticities.whiteX, chromaticities.whiteY)
  const primaries = Float64Array.of(
    red[0],
    green[0],
    blue[0],
    red[1],
    green[1],
    blue[1],
    red[2],
    green[2],
    blue[2],
  )
  const scales = multiplyMatrixVector(inverse3x3(primaries), white)
  if (scales.some((scale) => !Number.isFinite(scale) || scale <= 0)) {
    throw invalidInput('PNG cHRM primaries do not contain the declared white point')
  }
  const sourceToXyz = Float64Array.of(
    red[0] * scales[0],
    green[0] * scales[1],
    blue[0] * scales[2],
    red[1] * scales[0],
    green[1] * scales[1],
    blue[1] * scales[2],
    red[2] * scales[0],
    green[2] * scales[1],
    blue[2] * scales[2],
  )
  const bradford = Float64Array.of(
    0.8951,
    0.2664,
    -0.1614,
    -0.7502,
    1.7135,
    0.0367,
    0.0389,
    -0.0685,
    1.0296,
  )
  const inverseBradford = Float64Array.of(
    0.9869929,
    -0.1470543,
    0.1599627,
    0.4323053,
    0.5183603,
    0.0492912,
    -0.0085287,
    0.0400428,
    0.9684867,
  )
  const sourceCone = multiplyMatrixVector(bradford, white)
  const destinationCone = multiplyMatrixVector(bradford, [0.95047, 1, 1.08883])
  if (sourceCone.some((value) => !Number.isFinite(value) || Math.abs(value) < 1e-12)) {
    throw invalidInput('PNG cHRM white point cannot be chromatically adapted')
  }
  const adaptation = multiply3x3(
    inverseBradford,
    multiply3x3(
      Float64Array.of(
        destinationCone[0] / sourceCone[0],
        0,
        0,
        0,
        destinationCone[1] / sourceCone[1],
        0,
        0,
        0,
        destinationCone[2] / sourceCone[2],
      ),
      bradford,
    ),
  )
  return multiply3x3(xyzToSrgb, multiply3x3(adaptation, sourceToXyz))
}

export const createPngColorTransform = (
  gamma: number,
  chromaticities?: RgbChromaticities,
): RgbIccTransform => {
  if (!Number.isFinite(gamma) || gamma <= 0) throw invalidInput('PNG gAMA value must be positive')
  const curve = Float32Array.from({ length: 256 }, (_, value) => (value / 255) ** (1 / gamma))
  const matrix = chromaticities
    ? chromaticityMatrix(chromaticities)
    : Float64Array.of(1, 0, 0, 0, 1, 0, 0, 0, 1)
  return transformFromMatrixAndCurves(matrix, curve, curve, curve)
}

export const createPngGrayTransform = (gamma: number): Uint8Array => {
  if (!Number.isFinite(gamma) || gamma <= 0) throw invalidInput('PNG gAMA value must be positive')
  const encode = srgbEncodeLut()
  return Uint8Array.from({ length: 256 }, (_, value) => {
    const linear = (value / 255) ** (1 / gamma)
    return encode[Math.round(linear * SRGB_ENCODE_STEPS)] ?? 0
  })
}

const nclxChromaticities = (primaries: number): RgbChromaticities => {
  if (primaries === 1) {
    return {
      whiteX: 0.3127,
      whiteY: 0.329,
      redX: 0.64,
      redY: 0.33,
      greenX: 0.3,
      greenY: 0.6,
      blueX: 0.15,
      blueY: 0.06,
    }
  }
  if (primaries === 9) {
    return {
      whiteX: 0.3127,
      whiteY: 0.329,
      redX: 0.708,
      redY: 0.292,
      greenX: 0.17,
      greenY: 0.797,
      blueX: 0.131,
      blueY: 0.046,
    }
  }
  if (primaries === 12) {
    return {
      whiteX: 0.3127,
      whiteY: 0.329,
      redX: 0.68,
      redY: 0.32,
      greenX: 0.265,
      greenY: 0.69,
      blueX: 0.15,
      blueY: 0.06,
    }
  }
  throw unsupportedOperation(`NCLX color primaries ${primaries} are not supported`)
}

const cachedNclxLumaCoefficients = new Map<number, readonly [number, number, number]>()

export const nclxLumaCoefficients = (primaries: number): readonly [number, number, number] => {
  const cached = cachedNclxLumaCoefficients.get(primaries)
  if (cached) return cached
  const sourceToSrgb = chromaticityMatrix(nclxChromaticities(primaries))
  const srgbY = [0.212_672_9, 0.715_152_2, 0.072_175] as const
  const coefficients: readonly [number, number, number] = [
    srgbY[0] * (sourceToSrgb[0] ?? 0) +
      srgbY[1] * (sourceToSrgb[3] ?? 0) +
      srgbY[2] * (sourceToSrgb[6] ?? 0),
    srgbY[0] * (sourceToSrgb[1] ?? 0) +
      srgbY[1] * (sourceToSrgb[4] ?? 0) +
      srgbY[2] * (sourceToSrgb[7] ?? 0),
    srgbY[0] * (sourceToSrgb[2] ?? 0) +
      srgbY[1] * (sourceToSrgb[5] ?? 0) +
      srgbY[2] * (sourceToSrgb[8] ?? 0),
  ]
  cachedNclxLumaCoefficients.set(primaries, coefficients)
  return coefficients
}

export const nclxToLinear = (transferCharacteristics: number, encoded: number): number => {
  if (transferCharacteristics === 8) return encoded
  if (transferCharacteristics === 13) {
    return encoded <= 0.04045 ? encoded / 12.92 : ((encoded + 0.055) / 1.055) ** 2.4
  }
  if (transferCharacteristics === 1 || transferCharacteristics === 6) {
    return encoded < 0.081 ? encoded / 4.5 : ((encoded + 0.099) / 1.099) ** (1 / 0.45)
  }
  if (transferCharacteristics === 14 || transferCharacteristics === 15) {
    return encoded < 0.081_45 ? encoded / 4.5 : ((encoded + 0.099_3) / 1.099_3) ** (1 / 0.45)
  }
  if (transferCharacteristics === 16) {
    const m1 = 2610 / 16_384
    const m2 = 2523 / 32
    const c1 = 3424 / 4096
    const c2 = 2413 / 128
    const c3 = 2392 / 128
    const signal = Math.max(encoded, 0) ** (1 / m2)
    const numerator = Math.max(signal - c1, 0)
    const denominator = c2 - c3 * signal
    return denominator <= 0 ? 10_000 / 203 : ((numerator / denominator) ** (1 / m1) * 10_000) / 203
  }
  if (transferCharacteristics === 18) {
    return encoded <= 0.5
      ? (encoded * encoded) / 3
      : (Math.exp((encoded - 0.559_910_73) / 0.178_832_77) + 0.284_668_92) / 12
  }
  throw unsupportedOperation(
    `NCLX transfer characteristics ${transferCharacteristics} are not supported`,
  )
}

const NCLX_HDR_CURVE_STEPS = 4096

export interface NclxHdrToneMap {
  readonly encodedToLinear: Float32Array
  readonly linearToSrgb: Uint8Array
  readonly sourceToSrgb: Float64Array
  readonly sourcePeak: number
  readonly hlgLumaCoefficients?: readonly [number, number, number]
}

const cachedNclxHdrToneMaps = new Map<string, NclxHdrToneMap>()

export const createNclxHdrToneMap = (
  primaries: number,
  transferCharacteristics: 16 | 18,
): NclxHdrToneMap => {
  const key = `${primaries}:${transferCharacteristics}`
  const cached = cachedNclxHdrToneMaps.get(key)
  if (cached) return cached
  const encodedToLinear = Float32Array.from({ length: NCLX_HDR_CURVE_STEPS + 1 }, (_, index) =>
    nclxToLinear(transferCharacteristics, index / NCLX_HDR_CURVE_STEPS),
  )
  // BT.2100 defines PQ against 10,000 cd/m² and the reference HLG display at 1,000 cd/m².
  // Normalize both to BT.2408's 203 cd/m² HDR reference white before the SDR operator.
  const toneMap = {
    encodedToLinear,
    linearToSrgb: srgbEncodeLut(),
    sourceToSrgb: chromaticityMatrix(nclxChromaticities(primaries)),
    sourcePeak: (transferCharacteristics === 16 ? 10_000 : 1_000) / 203,
    ...(transferCharacteristics === 18
      ? { hlgLumaCoefficients: nclxLumaCoefficients(primaries) }
      : {}),
  }
  cachedNclxHdrToneMaps.set(key, toneMap)
  return toneMap
}

const sampleNclxHdrCurve = (curve: Float32Array, encoded: number): number => {
  const position = Math.max(0, Math.min(1, encoded)) * NCLX_HDR_CURVE_STEPS
  const low = Math.floor(position)
  const high = Math.min(NCLX_HDR_CURVE_STEPS, low + 1)
  const fraction = position - low
  return (curve[low] ?? 0) * (1 - fraction) + (curve[high] ?? 0) * fraction
}

export const writeNclxHdrToneMappedRgba = (
  data: Uint8Array,
  offset: number,
  encodedRed: number,
  encodedGreen: number,
  encodedBlue: number,
  toneMap: NclxHdrToneMap,
): void => {
  let sourceRed = sampleNclxHdrCurve(toneMap.encodedToLinear, encodedRed)
  let sourceGreen = sampleNclxHdrCurve(toneMap.encodedToLinear, encodedGreen)
  let sourceBlue = sampleNclxHdrCurve(toneMap.encodedToLinear, encodedBlue)
  const hlgLuma = toneMap.hlgLumaCoefficients
  if (hlgLuma) {
    const sceneLuminance = Math.max(
      0,
      hlgLuma[0] * sourceRed + hlgLuma[1] * sourceGreen + hlgLuma[2] * sourceBlue,
    )
    // BT.2100's HLG OOTF applies one luminance-derived system-gamma factor to all
    // three scene-linear channels. A per-channel exponent would distort hue.
    const ootfScale = sceneLuminance ** (1.2 - 1) * toneMap.sourcePeak
    sourceRed *= ootfScale
    sourceGreen *= ootfScale
    sourceBlue *= ootfScale
  }
  const signal = Math.max(sourceRed, sourceGreen, sourceBlue, 1e-6)
  // Reinhard's global operator, normalized so the transfer's nominal peak maps to SDR white.
  // Scaling all source-primary channels by the brightest-channel result preserves hue.
  const mappedSignal = (signal / (signal + 1)) * ((toneMap.sourcePeak + 1) / toneMap.sourcePeak)
  const scale = mappedSignal / signal
  const matrix = toneMap.sourceToSrgb
  const red =
    (matrix[0] ?? 0) * sourceRed + (matrix[1] ?? 0) * sourceGreen + (matrix[2] ?? 0) * sourceBlue
  const green =
    (matrix[3] ?? 0) * sourceRed + (matrix[4] ?? 0) * sourceGreen + (matrix[5] ?? 0) * sourceBlue
  const blue =
    (matrix[6] ?? 0) * sourceRed + (matrix[7] ?? 0) * sourceGreen + (matrix[8] ?? 0) * sourceBlue
  // The linear primary transform follows tone mapping, matching FFmpeg/zimg's source-gamut
  // Reinhard path and avoiding a destination-gamut clip before highlight compression.
  data[offset] = encodeLinear(red * scale, toneMap.linearToSrgb)
  data[offset + 1] = encodeLinear(green * scale, toneMap.linearToSrgb)
  data[offset + 2] = encodeLinear(blue * scale, toneMap.linearToSrgb)
  data[offset + 3] = 255
}

export const linearToSrgb = (linear: number): number =>
  linear <= 0.003_130_8 ? linear * 12.92 : 1.055 * linear ** (1 / 2.4) - 0.055

const cachedNclxTransforms = new Map<string, RgbIccTransform>()

export const createNclxSrgbTransform = (
  primaries: number,
  transferCharacteristics: number,
): RgbIccTransform => {
  const key = `${primaries}:${transferCharacteristics}`
  const cached = cachedNclxTransforms.get(key)
  if (cached) return cached
  const curve = Float32Array.from({ length: 256 }, (_, value) =>
    nclxToLinear(transferCharacteristics, value / 255),
  )
  const transform = transformFromMatrixAndCurves(
    chromaticityMatrix(nclxChromaticities(primaries)),
    curve,
    curve,
    curve,
  )
  cachedNclxTransforms.set(key, transform)
  return transform
}

export const createDisplayP3Transform = (): RgbIccTransform => createNclxSrgbTransform(12, 13)

const sampledTable = (
  profile: Uint8Array,
  offset: number,
  entries: number,
  input: number,
): number => {
  const position = input * (entries - 1)
  const low = Math.floor(position)
  const high = Math.min(entries - 1, low + 1)
  const fraction = position - low
  const first = uint16(profile, offset + low * 2)
  const second = uint16(profile, offset + high * 2)
  return (first + (second - first) * fraction) / 65_535
}

const cmykInputAxis = (
  profile: Uint8Array,
  tableOffset: number,
  entries: number,
  gridPoints: number,
): CmykInputAxis => {
  const low = new Uint8Array(256)
  const fraction = new Float32Array(256)
  for (let value = 0; value < 256; value += 1) {
    const position = sampledTable(profile, tableOffset, entries, value / 255) * (gridPoints - 1)
    low[value] = Math.min(gridPoints - 2, Math.floor(position))
    fraction[value] = position - (low[value] ?? 0)
  }
  return { low, fraction }
}

const cmykTransform = (
  profile: Uint8Array,
  allTags: ReadonlyMap<string, IccTag>,
  pcs: 'Lab ' | 'XYZ ',
): CmykIccTransform => {
  const tag = requiredTag(allTags, 'A2B0')
  if (signature(profile, tag.offset) !== 'mft2' || tag.size < 52) {
    throw invalidInput('CMYK ICC profile must provide a lut16 A2B0 transform')
  }
  const inputChannels = byte(profile, tag.offset + 8)
  const outputChannels = byte(profile, tag.offset + 9)
  const gridPoints = byte(profile, tag.offset + 10)
  const inputEntries = uint16(profile, tag.offset + 48)
  const outputEntries = uint16(profile, tag.offset + 50)
  if (
    inputChannels !== 4 ||
    outputChannels !== 3 ||
    gridPoints < 2 ||
    gridPoints > 33 ||
    inputEntries < 2 ||
    outputEntries < 2
  ) {
    throw invalidInput('CMYK ICC lut16 dimensions are unsupported')
  }
  const inputBytes = inputChannels * inputEntries * 2
  const clutValues = gridPoints ** inputChannels * outputChannels
  const clutBytes = clutValues * 2
  const outputBytes = outputChannels * outputEntries * 2
  if (52 + inputBytes + clutBytes + outputBytes > tag.size) {
    throw truncatedInput('CMYK ICC lut16 data is truncated')
  }
  const inputOffset = tag.offset + 52
  const clutOffset = inputOffset + inputBytes
  const outputOffset = clutOffset + clutBytes
  const clut = new Uint16Array(clutValues)
  for (let index = 0; index < clutValues; index += 1) {
    clut[index] = uint16(profile, clutOffset + index * 2)
  }
  const outputTables = new Uint16Array(outputChannels * outputEntries)
  for (let index = 0; index < outputTables.length; index += 1) {
    outputTables[index] = uint16(profile, outputOffset + index * 2)
  }
  return {
    kind: 'cmyk',
    gridPoints,
    cyan: cmykInputAxis(profile, inputOffset, inputEntries, gridPoints),
    magenta: cmykInputAxis(profile, inputOffset + inputEntries * 2, inputEntries, gridPoints),
    yellow: cmykInputAxis(profile, inputOffset + inputEntries * 4, inputEntries, gridPoints),
    black: cmykInputAxis(profile, inputOffset + inputEntries * 6, inputEntries, gridPoints),
    clut,
    outputTables,
    outputEntries,
    pcs,
    encode: srgbEncodeLut(),
  }
}

export const parseJpegIccTransform = (profile: Uint8Array): JpegIccTransform => {
  const { allTags } = validatedProfile(profile)
  const colorSpace = signature(profile, 16)
  const pcs = signature(profile, 20)
  if (pcs !== 'Lab ' && pcs !== 'XYZ ') throw invalidInput(`ICC PCS ${pcs} is unsupported`)
  if (colorSpace === 'RGB ') return rgbTransform(profile, allTags, pcs)
  if (colorSpace === 'CMYK') return cmykTransform(profile, allTags, pcs)
  throw invalidInput(`ICC input color space ${colorSpace} is unsupported`)
}

export const parseRgbIccTransform = (profile: Uint8Array): RgbIccTransform => {
  const transform = parseJpegIccTransform(profile)
  if (transform.kind !== 'rgb') {
    throw invalidInput('Embedded ICC profile must use the RGB input color space')
  }
  return transform
}

export const parseCmykIccTransform = (profile: Uint8Array): CmykIccTransform => {
  const transform = parseJpegIccTransform(profile)
  if (transform.kind !== 'cmyk') {
    throw invalidInput('Embedded ICC profile must use the CMYK input color space')
  }
  return transform
}

const encodeLinear = (value: number, table: Uint8Array): number => {
  const index = Math.round(Math.max(0, Math.min(1, value)) * SRGB_ENCODE_STEPS)
  return table[index] ?? 0
}

export const tiffCieLabToSrgb = (lightness: number, a: number, b: number): number => {
  const fy = (lightness + 16) / 116
  const fx = fy + a / 500
  const fz = fy - b / 200
  const epsilon = 216 / 24_389
  const inverseScale = 27 / 24_389
  const fx3 = fx * fx * fx
  const fy3 = fy * fy * fy
  const fz3 = fz * fz * fz
  const x = 0.95047 * (fx3 > epsilon ? fx3 : (116 * fx - 16) * inverseScale)
  const y = fy3 > epsilon ? fy3 : (116 * fy - 16) * inverseScale
  const z = 1.08883 * (fz3 > epsilon ? fz3 : (116 * fz - 16) * inverseScale)
  const encode = srgbEncodeLut()
  const red = encodeLinear(3.2404542 * x - 1.5371385 * y - 0.4985314 * z, encode)
  const green = encodeLinear(-0.969266 * x + 1.8760108 * y + 0.041556 * z, encode)
  const blue = encodeLinear(0.0556434 * x - 0.2040259 * y + 1.0572252 * z, encode)
  return (red << 16) | (green << 8) | blue
}

const sampleCurveLut = (curve: Float32Array, input: number): number => {
  const position = Math.max(0, Math.min(1, input)) * (curve.length - 1)
  const low = Math.floor(position)
  const high = Math.min(curve.length - 1, low + 1)
  const fraction = position - low
  const first = curve[low] ?? 0
  return first + ((curve[high] ?? first) - first) * fraction
}

const applyRgbLutPixels = (
  data: Uint8Array,
  channels: number,
  stride: number,
  width: number,
  height: number,
  transform: RgbLutIccTransform,
): void => {
  const inputRed = transform.inputCurves[0]
  const inputGreen = transform.inputCurves[1]
  const inputBlue = transform.inputCurves[2]
  const middleRed = transform.middleCurves[0]
  const middleGreen = transform.middleCurves[1]
  const middleBlue = transform.middleCurves[2]
  const outputRed = transform.outputCurves[0]
  const outputGreen = transform.outputCurves[1]
  const outputBlue = transform.outputCurves[2]
  const redGrid = transform.gridPoints[0]
  const greenGrid = transform.gridPoints[1]
  const blueGrid = transform.gridPoints[2]
  if (
    !inputRed ||
    !inputGreen ||
    !inputBlue ||
    !middleRed ||
    !middleGreen ||
    !middleBlue ||
    !outputRed ||
    !outputGreen ||
    !outputBlue ||
    !redGrid ||
    !greenGrid ||
    !blueGrid
  ) {
    throw invalidInput('RGB ICC mAB transform storage is incomplete')
  }
  const matrix = transform.matrix
  for (let row = 0; row < height; row += 1) {
    const end = row * stride + width * channels
    for (let offset = row * stride; offset < end; offset += channels) {
      const redPosition = (inputRed[data[offset] ?? 0] ?? 0) * (redGrid - 1)
      const greenPosition = (inputGreen[data[offset + 1] ?? 0] ?? 0) * (greenGrid - 1)
      const bluePosition = (inputBlue[data[offset + 2] ?? 0] ?? 0) * (blueGrid - 1)
      const redLow = Math.min(redGrid - 2, Math.max(0, Math.floor(redPosition)))
      const greenLow = Math.min(greenGrid - 2, Math.max(0, Math.floor(greenPosition)))
      const blueLow = Math.min(blueGrid - 2, Math.max(0, Math.floor(bluePosition)))
      const redFraction = redPosition - redLow
      const greenFraction = greenPosition - greenLow
      const blueFraction = bluePosition - blueLow
      let first = 0
      let second = 0
      let third = 0
      for (let mask = 0; mask < 8; mask += 1) {
        const useRed = mask & 1
        const useGreen = (mask >>> 1) & 1
        const useBlue = (mask >>> 2) & 1
        const weight =
          (useRed ? redFraction : 1 - redFraction) *
          (useGreen ? greenFraction : 1 - greenFraction) *
          (useBlue ? blueFraction : 1 - blueFraction)
        const index =
          (((redLow + useRed) * greenGrid + greenLow + useGreen) * blueGrid + blueLow + useBlue) * 3
        first += (transform.clut[index] ?? 0) * weight
        second += (transform.clut[index + 1] ?? 0) * weight
        third += (transform.clut[index + 2] ?? 0) * weight
      }
      const middleFirst = sampleCurveLut(middleRed, first / 65_535)
      const middleSecond = sampleCurveLut(middleGreen, second / 65_535)
      const middleThird = sampleCurveLut(middleBlue, third / 65_535)
      first = sampleCurveLut(
        outputRed,
        (matrix[0] ?? 0) * middleFirst +
          (matrix[1] ?? 0) * middleSecond +
          (matrix[2] ?? 0) * middleThird +
          (matrix[9] ?? 0),
      )
      second = sampleCurveLut(
        outputGreen,
        (matrix[3] ?? 0) * middleFirst +
          (matrix[4] ?? 0) * middleSecond +
          (matrix[5] ?? 0) * middleThird +
          (matrix[10] ?? 0),
      )
      third = sampleCurveLut(
        outputBlue,
        (matrix[6] ?? 0) * middleFirst +
          (matrix[7] ?? 0) * middleSecond +
          (matrix[8] ?? 0) * middleThird +
          (matrix[11] ?? 0),
      )
      let x: number
      let y: number
      let z: number
      if (transform.pcs === 'Lab ') {
        const legacyScale = 65_535 / 65_280
        first = Math.min(1, first * legacyScale)
        second = Math.min(1, second * legacyScale)
        third = Math.min(1, third * legacyScale)
        const fy = (first * 100 + 16) / 116
        const fx = fy + (second * 255 - 128) / 500
        const fz = fy - (third * 255 - 128) / 200
        const epsilon = 216 / 24_389
        const inverseScale = 27 / 24_389
        const fx3 = fx * fx * fx
        const fy3 = fy * fy * fy
        const fz3 = fz * fz * fz
        x = 0.9642 * (fx3 > epsilon ? fx3 : (116 * fx - 16) * inverseScale)
        y = fy3 > epsilon ? fy3 : (116 * fy - 16) * inverseScale
        z = 0.8249 * (fz3 > epsilon ? fz3 : (116 * fz - 16) * inverseScale)
      } else {
        const xyzScale = 65_535 / 32_768
        x = first * xyzScale
        y = second * xyzScale
        z = third * xyzScale
      }
      const d65X = 0.9555766 * x - 0.0230393 * y + 0.0631636 * z
      const d65Y = -0.0282895 * x + 1.0099416 * y + 0.0210077 * z
      const d65Z = 0.0122982 * x - 0.020483 * y + 1.3299098 * z
      data[offset] = encodeLinear(
        3.2404542 * d65X - 1.5371385 * d65Y - 0.4985314 * d65Z,
        transform.encode,
      )
      data[offset + 1] = encodeLinear(
        -0.969266 * d65X + 1.8760108 * d65Y + 0.041556 * d65Z,
        transform.encode,
      )
      data[offset + 2] = encodeLinear(
        0.0556434 * d65X - 0.2040259 * d65Y + 1.0572252 * d65Z,
        transform.encode,
      )
    }
  }
}

export const applyRgbIcc = (data: Uint8Array, transform: RgbIccTransform): void => {
  if (transform.method === 'lut') {
    applyRgbLutPixels(data, 3, data.byteLength, data.byteLength / 3, 1, transform)
    return
  }
  for (let offset = 0; offset < data.byteLength; offset += 3) {
    const red = data[offset] ?? 0
    const green = data[offset + 1] ?? 0
    const blue = data[offset + 2] ?? 0
    data[offset] = encodeLinear(
      (transform.redToRed[red] ?? 0) +
        (transform.greenToRed[green] ?? 0) +
        (transform.blueToRed[blue] ?? 0),
      transform.encode,
    )
    data[offset + 1] = encodeLinear(
      (transform.redToGreen[red] ?? 0) +
        (transform.greenToGreen[green] ?? 0) +
        (transform.blueToGreen[blue] ?? 0),
      transform.encode,
    )
    data[offset + 2] = encodeLinear(
      (transform.redToBlue[red] ?? 0) +
        (transform.greenToBlue[green] ?? 0) +
        (transform.blueToBlue[blue] ?? 0),
      transform.encode,
    )
  }
}

const applyRgbIccBlock = (block: PixelBlock, transform: RgbIccTransform): void => {
  const channels = block.format === 'rgb8' ? 3 : block.format === 'rgba8' ? 4 : 0
  if (channels === 0) {
    throw unsupportedOperation(`RGB ICC conversion does not support ${block.format} pixels`)
  }
  if (transform.method === 'lut') {
    applyRgbLutPixels(block.data, channels, block.stride, block.width, block.height, transform)
    return
  }
  for (let row = 0; row < block.height; row += 1) {
    const start = row * block.stride
    const end = start + block.width * channels
    for (let offset = start; offset < end; offset += channels) {
      const red = block.data[offset] ?? 0
      const green = block.data[offset + 1] ?? 0
      const blue = block.data[offset + 2] ?? 0
      block.data[offset] = encodeLinear(
        (transform.redToRed[red] ?? 0) +
          (transform.greenToRed[green] ?? 0) +
          (transform.blueToRed[blue] ?? 0),
        transform.encode,
      )
      block.data[offset + 1] = encodeLinear(
        (transform.redToGreen[red] ?? 0) +
          (transform.greenToGreen[green] ?? 0) +
          (transform.blueToGreen[blue] ?? 0),
        transform.encode,
      )
      block.data[offset + 2] = encodeLinear(
        (transform.redToBlue[red] ?? 0) +
          (transform.greenToBlue[green] ?? 0) +
          (transform.blueToBlue[blue] ?? 0),
        transform.encode,
      )
    }
  }
}

export class ColorManagedDecoder implements ImageDecoder {
  readonly width: number
  readonly height: number
  readonly pixelFormat: PixelFormat
  readonly capabilities: DecoderCapabilities
  readonly #decoder: ImageDecoder
  readonly #transform: RgbIccTransform

  constructor(decoder: ImageDecoder, transform: RgbIccTransform) {
    this.#decoder = decoder
    this.#transform = transform
    this.width = decoder.width
    this.height = decoder.height
    this.pixelFormat = decoder.pixelFormat
    this.capabilities = decoder.capabilities
  }

  async *decode(request?: DecodeRequest): AsyncGenerator<PixelBlock> {
    for await (const block of this.#decoder.decode(request)) {
      applyRgbIccBlock(block, this.#transform)
      yield block
    }
  }
}

export class GrayColorManagedDecoder implements ImageDecoder {
  readonly width: number
  readonly height: number
  readonly pixelFormat: PixelFormat
  readonly capabilities: DecoderCapabilities
  readonly #decoder: ImageDecoder
  readonly #transform: Uint8Array

  constructor(decoder: ImageDecoder, transform: Uint8Array) {
    this.#decoder = decoder
    this.#transform = transform
    this.width = decoder.width
    this.height = decoder.height
    this.pixelFormat = decoder.pixelFormat
    this.capabilities = decoder.capabilities
  }

  async *decode(request?: DecodeRequest): AsyncGenerator<PixelBlock> {
    for await (const block of this.#decoder.decode(request)) {
      if (block.format !== 'gray8') {
        throw unsupportedOperation(`Grayscale color conversion does not support ${block.format}`)
      }
      for (let row = 0; row < block.height; row += 1) {
        const start = row * block.stride
        const end = start + block.width
        for (let offset = start; offset < end; offset += 1) {
          block.data[offset] = this.#transform[block.data[offset] ?? 0] ?? 0
        }
      }
      yield block
    }
  }
}

const outputCurve = (transform: CmykIccTransform, channel: number, value: number): number => {
  const position = (value / 65_535) * (transform.outputEntries - 1)
  const low = Math.floor(position)
  const high = Math.min(transform.outputEntries - 1, low + 1)
  const fraction = position - low
  const base = channel * transform.outputEntries
  const first = transform.outputTables[base + low] ?? 0
  const second = transform.outputTables[base + high] ?? 0
  return (first + (second - first) * fraction) / 65_535
}

export const writeCmykIcc = (
  transform: CmykIccTransform,
  cyan: number,
  magenta: number,
  yellow: number,
  black: number,
  output: Uint8Array,
  offset: number,
): void => {
  const c0 = transform.cyan.low[cyan] ?? 0
  const m0 = transform.magenta.low[magenta] ?? 0
  const y0 = transform.yellow.low[yellow] ?? 0
  const k0 = transform.black.low[black] ?? 0
  const cf = transform.cyan.fraction[cyan] ?? 0
  const mf = transform.magenta.fraction[magenta] ?? 0
  const yf = transform.yellow.fraction[yellow] ?? 0
  const kf = transform.black.fraction[black] ?? 0
  const grid = transform.gridPoints
  let first = 0
  let second = 0
  let third = 0
  for (let mask = 0; mask < 16; mask += 1) {
    const useC = mask & 1
    const useM = (mask >>> 1) & 1
    const useY = (mask >>> 2) & 1
    const useK = (mask >>> 3) & 1
    const weight =
      (useC ? cf : 1 - cf) * (useM ? mf : 1 - mf) * (useY ? yf : 1 - yf) * (useK ? kf : 1 - kf)
    const index = ((((c0 + useC) * grid + m0 + useM) * grid + y0 + useY) * grid + k0 + useK) * 3
    first += (transform.clut[index] ?? 0) * weight
    second += (transform.clut[index + 1] ?? 0) * weight
    third += (transform.clut[index + 2] ?? 0) * weight
  }
  first = outputCurve(transform, 0, first)
  second = outputCurve(transform, 1, second)
  third = outputCurve(transform, 2, third)
  let x: number
  let y: number
  let z: number
  if (transform.pcs === 'Lab ') {
    const legacyScale = 65_535 / 65_280
    first = Math.min(1, first * legacyScale)
    second = Math.min(1, second * legacyScale)
    third = Math.min(1, third * legacyScale)
    const fy = (first * 100 + 16) / 116
    const fx = fy + (second * 255 - 128) / 500
    const fz = fy - (third * 255 - 128) / 200
    const fx3 = fx * fx * fx
    const fy3 = fy * fy * fy
    const fz3 = fz * fz * fz
    const epsilon = 216 / 24_389
    const inverseScale = 27 / 24_389
    x = 0.9642 * (fx3 > epsilon ? fx3 : (116 * fx - 16) * inverseScale)
    y = fy3 > epsilon ? fy3 : (116 * fy - 16) * inverseScale
    z = 0.8249 * (fz3 > epsilon ? fz3 : (116 * fz - 16) * inverseScale)
  } else {
    x = first * (65_535 / 32_768)
    y = second * (65_535 / 32_768)
    z = third * (65_535 / 32_768)
  }
  const d65X = 0.9555766 * x - 0.0230393 * y + 0.0631636 * z
  const d65Y = -0.0282895 * x + 1.0099416 * y + 0.0210077 * z
  const d65Z = 0.0122982 * x - 0.020483 * y + 1.3299098 * z
  output[offset] = encodeLinear(
    3.2404542 * d65X - 1.5371385 * d65Y - 0.4985314 * d65Z,
    transform.encode,
  )
  output[offset + 1] = encodeLinear(
    -0.969266 * d65X + 1.8760108 * d65Y + 0.041556 * d65Z,
    transform.encode,
  )
  output[offset + 2] = encodeLinear(
    0.0556434 * d65X - 0.2040259 * d65Y + 1.0572252 * d65Z,
    transform.encode,
  )
}
