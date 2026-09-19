import { throwIfAborted } from '../abort.ts'
import { normalizePixelColorSemantics, type PixelColorSemantics } from '../color.ts'
import { invalidInput, limitExceeded, unsupportedOperation } from '../errors.ts'
import { type ImageLimitOptions, resolveLimits, validateImageDimensions } from '../limits.ts'
import { inspectIccProfile } from './icc.ts'
import { jpegXlContainerSignature } from './jpegxl-container.ts'
import { encodeJpegXlIccCommands } from './jpegxl-icc.ts'
import { type JpegXlLimitOptions, resolveJpegXlLimits } from './jpegxl-limits.ts'
import {
  acceptsJpegXlColorSemantics,
  JpegXlBitWriter,
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
  readonly data: Uint8Array | Uint16Array | Uint32Array
  readonly bitDepth: number
  /** IEEE binary16/binary32 bit patterns use matching unsigned storage. */
  readonly sampleFormat?: 'unsigned-integer' | 'binary16' | 'binary32'
}
export interface JpegXlNativeExtraInput extends JpegXlNativePlaneInput {
  readonly type: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 16
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
  /** Select the minimum valid level by default. Level 10 always uses a container with jxll. */
  readonly codestreamLevel?: 'auto' | 5 | 10
  /** Raw Level 10 output is invalid and rejected. */
  readonly container?: 'auto' | 'raw'
  readonly signal?: AbortSignal
}
const enumValues = [
  { value: 0 },
  { value: 1 },
  { bits: 4, offset: 2 },
  { bits: 6, offset: 18 },
] as const
const writeDepth = (writer: JpegXlBitWriter, plane: Readonly<JpegXlNativePlaneInput>): void => {
  const floating = plane.sampleFormat === 'binary16' || plane.sampleFormat === 'binary32'
  writer.writeBits(floating ? 1 : 0, 1)
  writeU32(
    writer,
    plane.bitDepth,
    floating
      ? [{ value: 32 }, { value: 16 }, { value: 24 }, { bits: 6, offset: 1 }]
      : [{ value: 8 }, { value: 10 }, { value: 12 }, { bits: 6, offset: 1 }],
  )
  if (floating) writer.writeBits(plane.sampleFormat === 'binary16' ? 4 : 7, 4)
}

const writeBox = (type: string, payload: Uint8Array): Uint8Array => {
  const output = new Uint8Array(8 + payload.length)
  const view = new DataView(output.buffer)
  view.setUint32(0, output.length, false)
  for (let index = 0; index < 4; index++) output[4 + index] = type.charCodeAt(index)
  output.set(payload, 8)
  return output
}

const levelTenContainer = (codestream: Uint8Array): Uint8Array => {
  const fileType = writeBox(
    'ftyp',
    Uint8Array.of(0x6a, 0x78, 0x6c, 0x20, 0, 0, 0, 0, 0x6a, 0x78, 0x6c, 0x20),
  )
  const level = writeBox('jxll', Uint8Array.of(10))
  const complete = writeBox('jxlc', codestream)
  const output = new Uint8Array(
    jpegXlContainerSignature.length + fileType.length + level.length + complete.length,
  )
  let offset = 0
  for (const part of [jpegXlContainerSignature, fileType, level, complete]) {
    output.set(part, offset)
    offset += part.length
  }
  return output
}

const encodedSample = (plane: Readonly<JpegXlNativePlaneInput>, sample: number): number =>
  plane.sampleFormat === 'binary32' && sample >= 2 ** 31 ? sample - 2 ** 32 : sample
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

/** Bounded Modular groups preserving native integer or binary16 channels and an optional ICC profile. */
export const encodeJpegXlNative = async (
  options: Readonly<EncodeJpegXlNativeOptions>,
): Promise<Uint8Array> => {
  const limits = resolveLimits(options.limits),
    jpegLimits = resolveJpegXlLimits(options.limits)
  validateImageDimensions(options.width, options.height, 1, limits)
  const maximum = options.maxOutputBytes ?? limits.maxInputBytes
  if (!Number.isSafeInteger(maximum) || maximum < 1)
    throw invalidInput('maxOutputBytes must be a positive safe integer')
  const extra = options.extraChannels ?? []
  const requiresLevelTen =
    [...options.color, ...extra].some(
      (plane) =>
        plane.bitDepth > 12 ||
        plane.sampleFormat === 'binary16' ||
        plane.sampleFormat === 'binary32',
    ) ||
    extra.length > 4 ||
    extra.some((channel) => channel.type === 4)
  const requestedLevel = options.codestreamLevel ?? 'auto'
  if (requestedLevel !== 'auto' && requestedLevel !== 5 && requestedLevel !== 10)
    throw invalidInput('codestreamLevel must be auto, 5, or 10')
  if (requiresLevelTen && requestedLevel === 5)
    throw invalidInput('Input requires codestream Level 10')
  const level = requestedLevel === 10 || requiresLevelTen ? 10 : 5
  if (
    options.container !== undefined &&
    options.container !== 'auto' &&
    options.container !== 'raw'
  )
    throw invalidInput('JPEG XL container is invalid')
  if (level === 10 && options.container === 'raw')
    throw invalidInput('Level 10 requires container signaling')
  const colorSemantics =
    options.colorSemantics === undefined
      ? defaultColor(options.color.length === 1)
      : normalizePixelColorSemantics(options.colorSemantics)
  if (extra.some((channel) => channel.type === 4) && !options.iccProfile)
    throw invalidInput('JPEG XL CMYK requires an ICC profile')
  if (!options.iccProfile && !acceptsJpegXlColorSemantics(colorSemantics))
    throw unsupportedOperation('Input color semantics cannot be preserved')
  if (options.color.length !== 1 && options.color.length !== 3)
    throw invalidInput('Native input needs one or three color planes')
  if (
    options.orientation !== undefined &&
    (!Number.isInteger(options.orientation) || options.orientation < 1 || options.orientation > 8)
  )
    throw invalidInput('Orientation must be an integer from 1 through 8')
  if (
    options.colorSemantics &&
    options.colorSemantics.family !== (options.color.length === 1 ? 'gray' : 'rgb')
  )
    throw invalidInput('Color semantics differ from color planes')
  if (extra.length > 256) throw limitExceeded('Level 10 permits at most 256 extra channels')
  for (const channel of extra) {
    if (![0, 1, 2, 3, 4, 5, 6, 16].includes(channel.type))
      throw invalidInput('Extra-channel type is unsupported')
    const shift = channel.dimShift ?? 0
    if (!Number.isInteger(shift) || shift < 0 || shift > 3)
      throw invalidInput('Dimension shift must be an integer from 0 through 3')
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
  const groupDimension = 1_024
  const groupsAcross = Math.ceil(options.width / groupDimension)
  const groupsDown = Math.ceil(options.height / groupDimension)
  const groupCount = groupsAcross * groupsDown
  if (groupCount > 1 && extra.some((channel) => (channel.dimShift ?? 0) !== 0))
    throw unsupportedOperation('Shifted native channels across multiple groups are not supported')
  const first = options.color[0]
  if (!first) throw invalidInput('Native color channel is missing')
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
    if (!plane) throw invalidInput('Native channel is missing')
    if (
      !(plane.data instanceof Uint8Array) &&
      !(plane.data instanceof Uint16Array) &&
      !(plane.data instanceof Uint32Array)
    )
      throw invalidInput('Channel needs unsigned integer storage')
    if (
      plane.sampleFormat !== undefined &&
      plane.sampleFormat !== 'unsigned-integer' &&
      plane.sampleFormat !== 'binary16' &&
      plane.sampleFormat !== 'binary32'
    )
      throw invalidInput('Sample format is invalid')
    if (
      !Number.isSafeInteger(plane.bitDepth) ||
      plane.bitDepth < 1 ||
      (plane.sampleFormat !== 'binary32' && plane.bitDepth > 31) ||
      plane.bitDepth > 32 ||
      (plane.sampleFormat === 'binary16' &&
        (plane.bitDepth !== 16 || !(plane.data instanceof Uint16Array))) ||
      (plane.sampleFormat === 'binary32' &&
        (plane.bitDepth !== 32 || !(plane.data instanceof Uint32Array))) ||
      (plane.bitDepth > 16 && !(plane.data instanceof Uint32Array))
    )
      throw invalidInput('Sample storage and depth do not agree')
    if (
      c < options.color.length &&
      (plane.bitDepth !== first.bitDepth || plane.sampleFormat !== first.sampleFormat)
    )
      throw invalidInput('Color channels need the same sample representation')
    const shift = c < options.color.length ? 0 : (extra[c - options.color.length]?.dimShift ?? 0)
    const expected = Math.ceil(options.width / 2 ** shift) * Math.ceil(options.height / 2 ** shift)
    if (plane.data.length !== expected) throw invalidInput('Channel sample count is invalid')
    inputBytes += plane.data.byteLength
    const maximumSample = plane.bitDepth === 32 ? 0xffff_ffff : 2 ** plane.bitDepth - 1
    for (let i = 0; i < plane.data.length; i++) {
      if ((i & 65535) === 0) await pause()
      if ((plane.data[i] ?? 0) > maximumSample)
        throw invalidInput('Sample exceeds its declared depth')
    }
  }
  // Cover worst-case literal entropy output, geometric bit-writer growth, final copies,
  // and literal ICC commands. The caller retains the input planes throughout encoding.
  if (inputBytes * 12 + (options.iccProfile?.length ?? 0) * 10 + 65536 > limits.maxDecodedBytes)
    throw limitExceeded('Native encode exceeds maxDecodedBytes')
  throwIfAborted(options.signal)
  const profile = options.iccProfile
  if (profile) {
    if (profile.length > jpegLimits.maxIccBytes)
      throw limitExceeded('JPEG XL native ICC exceeds maxIccBytes')
    inspectIccProfile(profile)
    const space = String.fromCharCode(...profile.subarray(16, 20))
    const hasBlack = extra.some((channel) => channel.type === 4)
    const expectedSpace = hasBlack ? 'CMYK' : options.color.length === 1 ? 'GRAY' : 'RGB '
    if (space !== expectedSpace)
      throw invalidInput('JPEG XL native ICC color space differs from its color planes')
    if (
      hasBlack &&
      (options.color.length !== 3 || extra.filter((channel) => channel.type === 4).length !== 1)
    )
      throw invalidInput('CMYK requires three color planes and one black channel')
  }
  const frequencies = new Uint32Array(280)
  // Predictor zero makes every native sample independent, including IEEE bit patterns.
  const token = (value: number): number =>
    value < 256 ? value : 248 + Math.floor(Math.log2(value))
  for (const plane of planes)
    for (let i = 0; i < plane.data.length; i++) {
      if ((i & 65535) === 0) await pause()
      const sample = plane.data[i] ?? 0
      const value = packSigned(encodedSample(plane, sample))
      const symbol = token(value)
      frequencies[symbol] = (frequencies[symbol] ?? 0) + 1
    }
  const sections: Uint8Array[] = []
  if (groupCount === 1) {
    const section = new JpegXlBitWriter(undefined, maximum)
    section.writeBits(1, 1)
    section.writeBits(0, 1)
    writeModularHeader(section, false)
    writeModularTree(section, 0)
    const code = writePrefixCode(section, 1, frequencies)
    for (const plane of planes) {
      throwIfAborted(options.signal)
      for (let i = 0; i < plane.data.length; i++) {
        if ((i & 65535) === 0) await pause()
        writeHybridUint(section, packSigned(encodedSample(plane, plane.data[i] ?? 0)), code)
      }
    }
    sections.push(section.finish())
  } else {
    const global = new JpegXlBitWriter(undefined, maximum)
    global.writeBits(1, 1)
    global.writeBits(1, 1)
    writeModularTree(global, 0)
    const code = writePrefixCode(global, 1, frequencies)
    writeModularHeader(global, true)
    sections.push(global.finish(), new Uint8Array(0))
    const dcGroupCount = Math.ceil(options.width / 8_192) * Math.ceil(options.height / 8_192)
    for (let index = 0; index < dcGroupCount; index++) sections.push(new Uint8Array(0))
    let sectionBytes = sections[0]?.length ?? 0
    for (let groupY = 0; groupY < groupsDown; groupY++) {
      for (let groupX = 0; groupX < groupsAcross; groupX++) {
        throwIfAborted(options.signal)
        if (sectionBytes >= maximum)
          throw limitExceeded('JPEG XL native output exceeds maxOutputBytes')
        const section = new JpegXlBitWriter(undefined, maximum - sectionBytes)
        writeModularHeader(section, true)
        const originX = groupX * groupDimension
        const originY = groupY * groupDimension
        const groupWidth = Math.min(groupDimension, options.width - originX)
        const groupHeight = Math.min(groupDimension, options.height - originY)
        for (const plane of planes) {
          for (let y = 0; y < groupHeight; y++) {
            const row = (originY + y) * options.width + originX
            for (let x = 0; x < groupWidth; x++) {
              if (((y * groupWidth + x) & 65535) === 0) await pause()
              const sample = plane.data[row + x] ?? 0
              writeHybridUint(section, packSigned(encodedSample(plane, sample)), code)
            }
          }
        }
        const bytes = section.finish()
        sections.push(bytes)
        sectionBytes += bytes.length
      }
    }
  }
  const payloadBytes = sections.reduce((sum, section) => sum + section.length, 0)
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
  writer.writeBits(level === 5 ? 1 : 0, 1)
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
  for (const section of sections)
    writeU32(writer, section.length, [
      { bits: 10, offset: 0 },
      { bits: 14, offset: 1024 },
      { bits: 22, offset: 17408 },
      { bits: 30, offset: 4211712 },
    ])
  const header = writer.finish()
  const containerOverhead = level === 10 ? 49 : 0
  if (header.length + payloadBytes + containerOverhead > maximum)
    throw limitExceeded('JPEG XL native output exceeds maxOutputBytes')
  throwIfAborted(options.signal)
  const result = new Uint8Array(header.length + payloadBytes)
  result.set(header)
  let offset = header.length
  for (const section of sections) {
    result.set(section, offset)
    offset += section.length
  }
  return level === 10 ? levelTenContainer(result) : result
}
