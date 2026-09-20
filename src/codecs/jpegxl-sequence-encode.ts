import { throwIfAborted } from '../abort.ts'
import type { PixelColorSemantics } from '../color.ts'
import { invalidInput, limitExceeded, unsupportedOperation } from '../errors.ts'
import { type ImageLimitOptions, resolveLimits, validateImageDimensions } from '../limits.ts'
import { pixelBytesPerPixel } from '../pixel.ts'
import { Uint8ArraySink } from '../sink.ts'
import { MemorySource } from '../source.ts'
import { inspectJpegXlSource } from './jpegxl-container.ts'
import {
  type JpegXlAnimationHeader,
  type JpegXlFrameStructure,
  readJpegXlSourceFrameStructure,
} from './jpegxl-decode.ts'
import { resolveJpegXlLimits } from './jpegxl-limits.ts'
import {
  createJpegXlModularEncoder,
  encodeJpegXlAnimationImageHeader,
  JpegXlBitWriter,
  jpegXlStreamingContainerPrefix,
  writeU32,
} from './jpegxl-modular-encode.ts'

export interface JpegXlAnimationInputFrame {
  readonly data: Uint8Array
  readonly width: number
  readonly height: number
  readonly x?: number
  readonly y?: number
  readonly durationTicks: number
  readonly timecode?: number
  readonly source?: 0 | 1 | 2 | 3
  readonly saveAsReference?: 0 | 1 | 2 | 3
  readonly saveBeforeColorTransform?: boolean
  readonly blend?: 'replace' | 'add' | 'blend' | 'multiply'
}

export interface EncodeJpegXlAnimationOptions {
  readonly width: number
  readonly height: number
  readonly pixelFormat: 'gray8' | 'gray16' | 'rgb8' | 'rgb16' | 'rgba8' | 'rgba16'
  readonly colorSemantics: PixelColorSemantics
  readonly animation: Readonly<JpegXlAnimationHeader>
  readonly encoding?: Readonly<Record<string, unknown>>
  readonly limits?: Readonly<ImageLimitOptions>
  readonly maxOutputBytes?: number
  readonly maxEncodedPixels?: number
  readonly signal?: AbortSignal
}

const enums = [{ value: 0 }, { value: 1 }, { value: 2 }, { value: 3 }] as const
const geometry = [
  { bits: 8, offset: 0 },
  { bits: 11, offset: 256 },
  { bits: 14, offset: 2304 },
  { bits: 30, offset: 18688 },
] as const
const positive = (value: number, name: string, allowZero = false): void => {
  if (!Number.isSafeInteger(value) || value < (allowZero ? 0 : 1))
    throw invalidInput(`JPEG XL ${name} is invalid`)
}

const frameHeader = (
  frame: Readonly<JpegXlFrameStructure>,
  input: Readonly<JpegXlAnimationInputFrame>,
  options: Readonly<EncodeJpegXlAnimationOptions>,
  last: boolean,
): Uint8Array => {
  if (frame.passCount !== 1 || frame.upsampling !== 1 || frame.gaborish || frame.frameFlags & ~128)
    throw unsupportedOperation('JPEG XL animation writer frame coding configuration is unsupported')
  if (
    input.saveBeforeColorTransform &&
    (last ||
      (input.blend ?? 'replace') !== 'replace' ||
      (input.durationTicks !== 0 && (input.saveAsReference ?? 1) === 0) ||
      (input.x ?? 0) > 0 ||
      (input.y ?? 0) > 0 ||
      (input.x ?? 0) + input.width < options.width ||
      (input.y ?? 0) + input.height < options.height)
  )
    throw invalidInput('JPEG XL pre-transform reference requires a nonfinal full replacement frame')
  const writer = new JpegXlBitWriter()
  writer.writeBits(0, 1)
  writeU32(writer, 0, enums)
  writer.writeBits(frame.encoding === 'modular' ? 1 : 0, 1)
  if (frame.frameFlags === 0) writer.writeBits(0, 2)
  else {
    writer.writeBits(2, 2)
    writer.writeBits(frame.frameFlags - 17, 8)
  }
  // U64 values above 16 use selector 2 and an eight-bit payload offset by 17.
  // The forward VarDCT encoder sets only the skip-adaptive-LF-smoothing flag (128).
  if (frame.colorTransform !== 'xyb') writer.writeBits(0, 1)
  writer.writeBits(0, 2)
  for (const _channel of frame.extraChannels) writer.writeBits(0, 2)
  if (frame.encoding === 'modular') writer.writeBits(Math.log2(frame.groupDimension / 128), 2)
  else if (frame.colorTransform === 'xyb') {
    writer.writeBits(frame.xQuantizationScale, 3)
    writer.writeBits(frame.bQuantizationScale, 3)
  }
  writer.writeBits(0, 2)
  const x = input.x ?? 0,
    y = input.y ?? 0
  const custom =
    x !== 0 || y !== 0 || input.width !== options.width || input.height !== options.height
  writer.writeBits(custom ? 1 : 0, 1)
  if (custom) {
    writeU32(writer, x < 0 ? -2 * x - 1 : 2 * x, geometry)
    writeU32(writer, y < 0 ? -2 * y - 1 : 2 * y, geometry)
    writeU32(writer, input.width, geometry)
    writeU32(writer, input.height, geometry)
  }
  const mode =
    input.blend === 'add' ? 1 : input.blend === 'blend' ? 2 : input.blend === 'multiply' ? 4 : 0
  const partial =
    x > 0 || y > 0 || x + input.width < options.width || y + input.height < options.height
  for (let channel = 0; channel <= frame.extraChannels.length; channel++) {
    writeU32(writer, mode, [{ value: 0 }, { value: 1 }, { value: 2 }, { bits: 2, offset: 3 }])
    if (mode === 2 && frame.extraChannels.length) writer.writeBits(0, 2)
    if (mode === 4 || (mode === 2 && frame.extraChannels.length)) writer.writeBits(1, 1)
    if (mode !== 0 || partial) writeU32(writer, input.source ?? 0, enums)
  }
  writeU32(writer, input.durationTicks, [
    { value: 0 },
    { value: 1 },
    { bits: 8, offset: 0 },
    { bits: 32, offset: 0 },
  ])
  if (options.animation.haveTimecodes) writer.writeBits(input.timecode ?? 0, 32)
  writer.writeBits(last ? 1 : 0, 1)
  if (!last) {
    writeU32(writer, input.saveAsReference ?? 1, enums)
    if ((input.durationTicks === 0 || (input.saveAsReference ?? 1) !== 0) && mode === 0 && !partial)
      writer.writeBits(input.saveBeforeColorTransform ? 1 : 0, 1)
  }
  writer.writeBits(0, 2) // Empty frame name.
  writer.writeBits(0, 1)
  writer.writeBits(0, 1)
  writer.writeBits(frame.epfIterations, 2)
  if (frame.epfIterations) {
    if (frame.encoding !== 'vardct')
      throw unsupportedOperation('JPEG XL Modular animation filtering is unsupported')
    writer.writeBits(0, 3)
  }
  writer.writeBits(0, 2)
  writer.writeBits(0, 2)
  writer.writeBits(0, 1)
  writer.alignToByte()
  for (const section of frame.sections)
    writeU32(writer, section.length, [
      { bits: 10, offset: 0 },
      { bits: 14, offset: 1024 },
      { bits: 22, offset: 17408 },
      { bits: 30, offset: 4211712 },
    ])
  return writer.finish()
}

/** Pull-based output. At most the current encoded frame and one input lookahead are retained. */
export async function* encodeJpegXlAnimation(
  frames: AsyncIterable<Readonly<JpegXlAnimationInputFrame>>,
  options: Readonly<EncodeJpegXlAnimationOptions>,
): AsyncGenerator<Uint8Array> {
  const limits = resolveLimits(options.limits)
  validateImageDimensions(options.width, options.height, 1, limits)
  const maximum = options.maxOutputBytes ?? limits.maxInputBytes
  const maxEncodedPixels = options.maxEncodedPixels ?? limits.maxPixels
  positive(maxEncodedPixels, 'maxEncodedPixels')
  positive(maximum, 'maxOutputBytes')
  positive(options.animation.ticksPerSecondNumerator, 'tick numerator')
  positive(options.animation.ticksPerSecondDenominator, 'tick denominator')
  positive(options.animation.loops, 'loop count', true)
  if (options.encoding?.progressive === true)
    throw unsupportedOperation('JPEG XL animation encoding does not yet accept progressive passes')
  const headerRequest = { ...options, options: options.encoding ?? {}, limits }
  const image = encodeJpegXlAnimationImageHeader(headerRequest, options.animation)
  const encoding = { ...options.encoding, container: image.codestreamLevel === 10 }
  const request = { ...options, options: encoding, limits }
  const containerPrefix =
    image.codestreamLevel === 10 ? jpegXlStreamingContainerPrefix(10) : undefined
  const iterator = frames[Symbol.asyncIterator]()
  let emitted = 0,
    count = 0,
    encodedPixels = 0
  try {
    let current = await iterator.next()
    if (current.done) throw invalidInput('JPEG XL animation must contain a frame')
    while (!current.done) {
      throwIfAborted(options.signal)
      const frame = current.value
      if (++count > limits.maxFrames) throw limitExceeded('JPEG XL animation exceeds maxFrames')
      validateImageDimensions(frame.width, frame.height, 1, limits)
      encodedPixels += frame.width * frame.height
      if (!Number.isSafeInteger(encodedPixels) || encodedPixels > maxEncodedPixels)
        throw limitExceeded('JPEG XL animation exceeds maxEncodedPixels')
      positive(frame.durationTicks, 'durationTicks', true)
      if (
        frame.durationTicks > 0xffffffff ||
        (frame.timecode !== undefined &&
          (!Number.isSafeInteger(frame.timecode) ||
            frame.timecode < 0 ||
            frame.timecode > 0xffffffff))
      )
        throw invalidInput('JPEG XL frame timing exceeds its 32-bit field')
      if (!Number.isSafeInteger(frame.x ?? 0) || !Number.isSafeInteger(frame.y ?? 0))
        throw invalidInput('JPEG XL animation origin must be an integer')
      if (frame.blend === 'blend' && !options.pixelFormat.startsWith('rgba'))
        throw invalidInput('JPEG XL alpha blending requires an alpha channel')
      if (
        count === 1 &&
        ((frame.x ?? 0) !== 0 ||
          (frame.y ?? 0) !== 0 ||
          frame.width !== options.width ||
          frame.height !== options.height ||
          (frame.blend ?? 'replace') !== 'replace')
      )
        throw invalidInput('JPEG XL animation starts with a full replacement frame')
      const stride = frame.width * pixelBytesPerPixel(options.pixelFormat)
      if (frame.data.byteLength !== stride * frame.height)
        throw invalidInput('JPEG XL animation input buffer size is invalid')
      if (
        frame.blend !== undefined &&
        !['replace', 'add', 'blend', 'multiply'].includes(frame.blend)
      )
        throw invalidInput('JPEG XL animation blend mode is invalid')
      const frameOutputLimit = Math.min(maximum - emitted, frame.data.byteLength * 4 + 65536)
      const availableWorkingBytes =
        limits.maxDecodedBytes -
        frameOutputLimit * 4 -
        frame.data.byteLength * 2 -
        image.header.length -
        (containerPrefix?.length ?? 0)
      if (availableWorkingBytes < 1)
        throw limitExceeded('JPEG XL animation buffers exceed maxDecodedBytes')
      const requestedWorkingBytes = options.encoding?.maxWorkingBytes
      if (
        requestedWorkingBytes !== undefined &&
        (typeof requestedWorkingBytes !== 'number' ||
          !Number.isSafeInteger(requestedWorkingBytes) ||
          requestedWorkingBytes < 1)
      )
        throw invalidInput('JPEG XL animation maxWorkingBytes is invalid')
      const sink = new Uint8ArraySink()
      const encoder = await createJpegXlModularEncoder(sink, {
        ...request,
        width: frame.width,
        height: frame.height,
        options: {
          ...encoding,
          maxOutputBytes: frameOutputLimit,
          maxWorkingBytes: Math.min(
            availableWorkingBytes,
            requestedWorkingBytes ?? availableWorkingBytes,
          ),
        },
      })
      try {
        await encoder.write({
          x: 0,
          y: 0,
          width: frame.width,
          height: frame.height,
          stride,
          format: options.pixelFormat,
          data: frame.data,
          colorSemantics: options.colorSemantics,
        })
        await encoder.finish()
      } catch (error) {
        await encoder.abort?.(error)
        throw error
      }
      const encoded = sink.toUint8Array()
      const encodedSource = new MemorySource(encoded)
      let frameCodestream = encoded
      if (image.codestreamLevel === 10) {
        const structure = await inspectJpegXlSource(encodedSource, resolveJpegXlLimits(), {})
        const segment = structure.codestreamSegments[0]
        if (!segment || structure.codestreamSegments.length !== 1)
          throw invalidInput('JPEG XL animation frame container is fragmented')
        frameCodestream = encoded.subarray(segment.offset, segment.offset + segment.length)
      }
      const frameSource = new MemorySource(frameCodestream)
      const parsed = await readJpegXlSourceFrameStructure(frameSource, limits)
      const next = await iterator.next()
      throwIfAborted(options.signal)
      const header = frameHeader(parsed, frame, options, next.done === true)
      const parts = [
        ...(count === 1
          ? [...(containerPrefix === undefined ? [] : [containerPrefix]), image.header]
          : []),
        header,
        ...parsed.sections.map((section) =>
          frameCodestream.subarray(section.offset, section.offset + section.length),
        ),
      ]
      for (const part of parts) {
        emitted += part.length
        if (emitted > maximum) throw limitExceeded('JPEG XL animation exceeds maxOutputBytes')
        throwIfAborted(options.signal)
        yield part.slice()
      }
      current = next
    }
  } finally {
    await iterator.return?.()
  }
}
