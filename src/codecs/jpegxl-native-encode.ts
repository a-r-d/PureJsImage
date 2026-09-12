import { throwIfAborted } from '../abort.ts'
import { normalizePixelColorSemantics, type PixelColorSemantics } from '../color.ts'
import { invalidInput, limitExceeded, unsupportedOperation } from '../errors.ts'
import { type ImageLimitOptions, resolveLimits, validateImageDimensions } from '../limits.ts'
import { inspectIccProfile } from './icc.ts'
import { encodeJpegXlIccCommands } from './jpegxl-icc.ts'
import { type JpegXlLimitOptions, resolveJpegXlLimits } from './jpegxl-limits.ts'
import {
  JpegXlBitWriter,
  acceptsJpegXlColorSemantics,
  packSigned,
  writeColorEncoding,
  writeHybridUint,
  writeModularHeader,
  writeModularTree,
  writePositiveF16,
  writePrefixCode,
  writeU32,
} from './jpegxl-modular-encode.ts'

export interface JpegXlNativePlaneInput {
  readonly data: Uint8Array | Uint16Array
  readonly bitDepth: number
  /** IEEE binary16 bit patterns use Uint16Array and bitDepth 16. */
  readonly sampleFormat?: 'unsigned-integer' | 'binary16'
}
export interface JpegXlNativeExtraInput extends JpegXlNativePlaneInput {
  readonly type: 0 | 1 | 2 | 3 | 5 | 6 | 16
  readonly name?: string
  readonly dimShift?: 0 | 1 | 2 | 3
  readonly associatedAlpha?: boolean
  readonly spotColor?: readonly [number, number, number, number]
  readonly cfaChannel?: number
}
export interface EncodeJpegXlNativeOptions {
  readonly width: number
  readonly height: number
  readonly color:
    | readonly [JpegXlNativePlaneInput]
    | readonly [JpegXlNativePlaneInput, JpegXlNativePlaneInput, JpegXlNativePlaneInput]
  readonly extraChannels?: readonly JpegXlNativeExtraInput[]
  readonly colorSemantics?: PixelColorSemantics
  readonly iccProfile?: Uint8Array
  readonly orientation?: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8
  readonly limits?: Readonly<ImageLimitOptions & JpegXlLimitOptions>
  readonly maxOutputBytes?: number
  readonly signal?: AbortSignal
}
const enumValues = [
  { value: 0 },
  { value: 1 },
  { bits: 4, offset: 2 },
  { bits: 6, offset: 18 },
] as const
const writeDepth = (writer: JpegXlBitWriter, plane: Readonly<JpegXlNativePlaneInput>): void => {
  const floating = plane.sampleFormat === 'binary16'
  writer.writeBits(floating ? 1 : 0, 1)
  writeU32(
    writer,
    plane.bitDepth,
    floating
      ? [{ value: 32 }, { value: 16 }, { value: 24 }, { bits: 6, offset: 1 }]
      : [{ value: 8 }, { value: 10 }, { value: 12 }, { bits: 6, offset: 1 }],
  )
  if (floating) writer.writeBits(4, 4)
}
const writeU64 = (writer: JpegXlBitWriter, value: number): void => {
  if (value === 0) writer.writeBits(0, 2)
  else if (value <= 16) {
    writer.writeBits(1, 2)
    writer.writeBits(value - 1, 4)
  } else if (value <= 272) {
    writer.writeBits(2, 2)
    writer.writeBits(value - 17, 8)
  } else {
    writer.writeBits(3, 2)
    writer.writeBits(value % 4096, 12)
    value = Math.floor(value / 4096)
    while (value > 0) {
      writer.writeBits(1, 1)
      writer.writeBits(value % 256, 8)
      value = Math.floor(value / 256)
    }
    writer.writeBits(0, 1)
  }
}
const defaultColor = (gray: boolean): PixelColorSemantics => ({
  family: gray ? 'gray' : 'rgb',
  primaries: 'srgb',
  transfer: { kind: 'srgb' },
  matrix: 'identity',
  range: 'full',
  alpha: 'none',
  provenance: 'container-signaled',
  renderingIntent: 'relative',
})

/** One bounded Modular group, preserving native integer or binary16 channels and an optional ICC profile. */
export const encodeJpegXlNative = async (
  options: Readonly<EncodeJpegXlNativeOptions>,
): Promise<Uint8Array> => {
  const limits = resolveLimits(options.limits),
    jpegLimits = resolveJpegXlLimits(options.limits)
  validateImageDimensions(options.width, options.height, 1, limits)
  if (options.width > 1024 || options.height > 1024)
    throw unsupportedOperation('JPEG XL native planar encoding is limited to one 1024-pixel group')
  const maximum = options.maxOutputBytes ?? limits.maxInputBytes
  if (!Number.isSafeInteger(maximum) || maximum < 1)
    throw invalidInput('JPEG XL maxOutputBytes must be a positive safe integer')
  const extra = options.extraChannels ?? []
  const colorSemantics =
    options.colorSemantics === undefined
      ? defaultColor(options.color.length === 1)
      : normalizePixelColorSemantics(options.colorSemantics)
  if (!options.iccProfile && !acceptsJpegXlColorSemantics(colorSemantics))
    throw unsupportedOperation('JPEG XL native input color semantics cannot be preserved')
  if (options.color.length !== 1 && options.color.length !== 3)
    throw invalidInput('JPEG XL native input requires one or three color planes')
  if (
    options.orientation !== undefined &&
    (!Number.isInteger(options.orientation) || options.orientation < 1 || options.orientation > 8)
  )
    throw invalidInput('JPEG XL orientation must be an integer from 1 through 8')
  if (
    options.colorSemantics &&
    options.colorSemantics.family !== (options.color.length === 1 ? 'gray' : 'rgb')
  )
    throw invalidInput('JPEG XL color semantics differ from the native color planes')
  if (extra.length > 4)
    throw limitExceeded('JPEG XL Level 5 native encoding permits at most four extra channels')
  for (const channel of extra) {
    if (![0, 1, 2, 3, 5, 6, 16].includes(channel.type))
      throw invalidInput('JPEG XL native extra-channel type is unsupported')
    const shift = channel.dimShift ?? 0
    if (!Number.isInteger(shift) || shift < 0 || shift > 3)
      throw invalidInput('JPEG XL dimension shift must be an integer from 0 through 3')
    if (
      channel.name !== undefined &&
      (typeof channel.name !== 'string' || channel.name.length > 1071)
    )
      throw invalidInput('JPEG XL channel name is invalid')
    if (
      channel.type === 2 &&
      (!channel.spotColor ||
        channel.spotColor.length !== 4 ||
        channel.spotColor.some((value) => !Number.isFinite(value) || value < 0 || value > 1))
    )
      throw invalidInput('JPEG XL spot color requires four finite unit-range components')
  }
  const planes = [...options.color, ...extra]
  const first = options.color[0]
  if (!first) throw invalidInput('JPEG XL native color channel is missing')
  let inputBytes = 0
  let deadline = performance.now() + 12
  const pause = async (): Promise<void> => {
    throwIfAborted(options.signal)
    if (performance.now() >= deadline) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0))
      deadline = performance.now() + 12
      throwIfAborted(options.signal)
    }
  }
  for (let c = 0; c < planes.length; c++) {
    const plane = planes[c]
    if (!plane) throw invalidInput('JPEG XL native channel is missing')
    if (!(plane.data instanceof Uint8Array) && !(plane.data instanceof Uint16Array))
      throw invalidInput('JPEG XL native channel requires unsigned integer storage')
    if (
      plane.sampleFormat !== undefined &&
      plane.sampleFormat !== 'unsigned-integer' &&
      plane.sampleFormat !== 'binary16'
    )
      throw invalidInput('JPEG XL native sample format is invalid')
    if (
      !Number.isSafeInteger(plane.bitDepth) ||
      plane.bitDepth < 1 ||
      plane.bitDepth > 16 ||
      (plane.sampleFormat === 'binary16' &&
        (plane.bitDepth !== 16 || !(plane.data instanceof Uint16Array)))
    )
      throw invalidInput('JPEG XL native sample storage and depth do not agree')
    if (
      c < options.color.length &&
      (plane.bitDepth !== first.bitDepth || plane.sampleFormat !== first.sampleFormat)
    )
      throw invalidInput('JPEG XL color channels must use the same sample representation')
    const shift = c < options.color.length ? 0 : (extra[c - options.color.length]?.dimShift ?? 0)
    const expected = Math.ceil(options.width / 2 ** shift) * Math.ceil(options.height / 2 ** shift)
    if (plane.data.length !== expected)
      throw invalidInput('JPEG XL native channel sample count is invalid')
    inputBytes += plane.data.byteLength
    const maximumSample = 2 ** plane.bitDepth - 1
    for (let i = 0; i < plane.data.length; i++) {
      if ((i & 65535) === 0) await pause()
      if (plane.data[i]! > maximumSample)
        throw invalidInput('JPEG XL native sample exceeds its declared depth')
    }
  }
  // Cover worst-case literal entropy output, geometric bit-writer growth, final copies,
  // and literal ICC commands. The caller retains the input planes throughout encoding.
  if (inputBytes * 12 + (options.iccProfile?.length ?? 0) * 10 + 65536 > limits.maxDecodedBytes)
    throw limitExceeded('JPEG XL native planar encoding exceeds maxDecodedBytes')
  throwIfAborted(options.signal)
  const profile = options.iccProfile
  if (profile) {
    if (profile.length > jpegLimits.maxIccBytes)
      throw limitExceeded('JPEG XL native ICC exceeds maxIccBytes')
    inspectIccProfile(profile)
    const space = String.fromCharCode(...profile.subarray(16, 20))
    if (space !== (options.color.length === 1 ? 'GRAY' : 'RGB '))
      throw invalidInput('JPEG XL native ICC color space differs from its color planes')
  }
  const section = new JpegXlBitWriter(undefined, maximum)
  section.writeBits(1, 1)
  section.writeBits(0, 1)
  writeModularHeader(section, false)
  writeModularTree(section, 0)
  const frequencies = new Uint32Array(280)
  // Predictor zero makes every native sample independent, including IEEE bit patterns.
  const token = (value: number): number =>
    value < 256 ? value : 248 + Math.floor(Math.log2(value))
  for (const plane of planes)
    for (let i = 0; i < plane.data.length; i++) {
      if ((i & 65535) === 0) await pause()
      const sample = plane.data[i]!
      const value = packSigned(sample)
      const symbol = token(value)
      frequencies[symbol] = (frequencies[symbol] ?? 0) + 1
    }
  const code = writePrefixCode(section, 1, frequencies)
  for (const plane of planes) {
    throwIfAborted(options.signal)
    for (let i = 0; i < plane.data.length; i++) {
      if ((i & 65535) === 0) await pause()
      writeHybridUint(section, packSigned(plane.data[i]!), code)
    }
  }
  const payload = section.finish()
  const writer = new JpegXlBitWriter(undefined, maximum)
  writer.writeBits(0xff, 8)
  writer.writeBits(0x0a, 8)
  const dimensions = [
    { bits: 9, offset: 1 },
    { bits: 13, offset: 1 },
    { bits: 18, offset: 1 },
    { bits: 30, offset: 1 },
  ] as const
  writer.writeBits(0, 1)
  writeU32(writer, options.height, dimensions)
  writer.writeBits(0, 3)
  writeU32(writer, options.width, dimensions)
  writer.writeBits(0, 1)
  const orientation = options.orientation ?? 1
  writer.writeBits(orientation === 1 ? 0 : 1, 1)
  if (orientation !== 1) {
    writer.writeBits(orientation - 1, 3)
    writer.writeBits(0, 3)
  }
  writeDepth(writer, first)
  writer.writeBits(1, 1)
  writeU32(writer, extra.length, [
    { value: 0 },
    { value: 1 },
    { bits: 4, offset: 2 },
    { bits: 12, offset: 1 },
  ])
  for (const channel of extra) {
    writer.writeBits(0, 1)
    writeU32(writer, channel.type, enumValues)
    writeDepth(writer, channel)
    writeU32(writer, channel.dimShift ?? 0, [
      { value: 0 },
      { value: 3 },
      { value: 4 },
      { bits: 3, offset: 1 },
    ])
    const name = new TextEncoder().encode(channel.name ?? '')
    if (name.length > 1071) throw limitExceeded('JPEG XL channel name is too long')
    writeU32(writer, name.length, [
      { value: 0 },
      { bits: 4, offset: 0 },
      { bits: 5, offset: 16 },
      { bits: 10, offset: 48 },
    ])
    for (const byte of name) writer.writeBits(byte, 8)
    if (channel.type === 0) writer.writeBits(channel.associatedAlpha ? 1 : 0, 1)
    if (channel.type === 2) {
      if (
        !channel.spotColor ||
        channel.spotColor.some((value) => !Number.isFinite(value) || value < 0 || value > 1)
      )
        throw invalidInput('JPEG XL spot color requires four finite unit-range components')
      for (const value of channel.spotColor) writePositiveF16(writer, value)
    }
    if (channel.type === 5)
      writeU32(writer, channel.cfaChannel ?? 1, [
        { value: 1 },
        { bits: 2, offset: 0 },
        { bits: 4, offset: 3 },
        { bits: 8, offset: 19 },
      ])
  }
  writer.writeBits(0, 1)
  if (profile) {
    writer.writeBits(0, 1)
    writer.writeBits(1, 1)
    writeU32(writer, options.color.length === 1 ? 1 : 0, enumValues)
  } else writeColorEncoding(writer, colorSemantics)
  if (orientation !== 1) writer.writeBits(1, 1)
  writeU64(writer, 0)
  writer.writeBits(1, 1)
  if (profile) {
    const commands = encodeJpegXlIccCommands(profile, jpegLimits.maxIccBytes)
    if (commands.length > jpegLimits.maxIccCompressedBytes)
      throw limitExceeded('JPEG XL literal ICC representation exceeds maxIccCompressedBytes')
    writeU64(writer, commands.length)
    const counts = new Uint32Array(256)
    for (const byte of commands) counts[byte] = (counts[byte] ?? 0) + 1
    const encoding = writePrefixCode(writer, 41, counts)
    for (const byte of commands) writeHybridUint(writer, byte, encoding)
  }
  writer.alignToByte()
  writer.writeBits(0, 1)
  writer.writeBits(0, 2)
  writer.writeBits(1, 1)
  writeU64(writer, 0)
  writer.writeBits(0, 1)
  for (let c = 0; c <= extra.length; c++) writer.writeBits(0, 2)
  writer.writeBits(3, 2)
  writer.writeBits(0, 2)
  writer.writeBits(0, 1)
  for (let c = 0; c <= extra.length; c++) writer.writeBits(0, 2)
  writer.writeBits(1, 1)
  writer.writeBits(0, 2)
  writer.writeBits(0, 1)
  writer.writeBits(0, 1)
  writer.writeBits(0, 2)
  writeU64(writer, 0)
  writeU64(writer, 0)
  writer.writeBits(0, 1)
  writer.alignToByte()
  writeU32(writer, payload.length, [
    { bits: 10, offset: 0 },
    { bits: 14, offset: 1024 },
    { bits: 22, offset: 17408 },
    { bits: 30, offset: 4211712 },
  ])
  const header = writer.finish()
  if (header.length + payload.length > maximum)
    throw limitExceeded('JPEG XL native output exceeds maxOutputBytes')
  throwIfAborted(options.signal)
  const result = new Uint8Array(header.length + payload.length)
  result.set(header)
  result.set(payload, header.length)
  return result
}
