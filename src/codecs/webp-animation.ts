import { throwIfAborted } from '../abort.ts'
import type {
  AnimationEncodeRequest,
  DecodeRequest,
  ImageAnimationDecoder,
  ImageAnimationEncoder,
  ImageAnimationFrame,
  ImageDecoder,
  ImageEncoder,
} from '../codec.ts'
import { invalidInput, truncatedInput, unsupportedOperation } from '../errors.ts'
import {
  type ImageLimitOptions,
  type ImageLimits,
  resolveLimits,
  validateImageDimensions,
} from '../limits.ts'
import type { PixelBlock } from '../pixel.ts'
import { type ImageSink, Uint8ArraySink } from '../sink.ts'
import { canvasBlocks, canvasRegion, RgbaFrameStager } from './rgba-frame.ts'
import {
  createWebpBitstreamDecoder,
  createWebpEncoder,
  type ParsedWebp,
  parseWebp,
  type WebpAcceleration,
  type WebpChunk,
} from './webp.ts'

export interface WebpFrameDescriptor {
  readonly left: number
  readonly top: number
  readonly width: number
  readonly height: number
  readonly durationMs: number
  /** Alpha-blend over the canvas; otherwise the frame replaces its rectangle. */
  readonly blend: boolean
  /** Clear the rectangle to transparent before the next frame. */
  readonly dispose: boolean
  readonly image: WebpChunk
  readonly alpha: WebpChunk | undefined
}

const uint24 = (data: Uint8Array, offset: number): number =>
  (data[offset] ?? 0) | ((data[offset + 1] ?? 0) << 8) | ((data[offset + 2] ?? 0) << 16)

const chunkType = (data: Uint8Array, offset: number): string =>
  String.fromCharCode(
    data[offset] ?? 0,
    data[offset + 1] ?? 0,
    data[offset + 2] ?? 0,
    data[offset + 3] ?? 0,
  )

/** Reads every ANMF frame header and finds each frame's bitstream chunks. */
export const webpFrames = (data: Uint8Array, parsed: ParsedWebp): WebpFrameDescriptor[] => {
  const frames: WebpFrameDescriptor[] = []
  for (const chunk of parsed.frameChunks) {
    if (chunk.length < 16) throw truncatedInput('WebP ANMF chunk is truncated')
    const base = chunk.offset
    const left = uint24(data, base) * 2
    const top = uint24(data, base + 3) * 2
    const width = uint24(data, base + 6) + 1
    const height = uint24(data, base + 9) + 1
    const flags = data[base + 15] ?? 0
    if (left + width > parsed.width || top + height > parsed.height) {
      throw invalidInput(
        `WebP frame ${left},${top} ${width}x${height} exceeds ${parsed.width}x${parsed.height}`,
      )
    }
    let image: WebpChunk | undefined
    let alpha: WebpChunk | undefined
    let offset = base + 16
    const end = base + chunk.length
    while (offset < end) {
      if (offset + 8 > end) throw truncatedInput('WebP frame chunk header is truncated')
      const type = chunkType(data, offset)
      const length =
        ((data[offset + 4] ?? 0) |
          ((data[offset + 5] ?? 0) << 8) |
          ((data[offset + 6] ?? 0) << 16) |
          ((data[offset + 7] ?? 0) << 24)) >>>
        0
      const payload = offset + 8
      if (payload + length > end) throw truncatedInput(`WebP frame ${type} chunk is truncated`)
      if (type === 'ALPH') {
        if (alpha || image) throw invalidInput('WebP frame alpha chunk is duplicated or late')
        alpha = { type, offset: payload, length }
      } else if (type === 'VP8 ' || type === 'VP8L') {
        if (image) throw invalidInput('WebP frame contains multiple bitstreams')
        image = { type, offset: payload, length }
      }
      offset = payload + length + (length & 1)
    }
    if (!image) throw invalidInput('WebP frame bitstream is missing')
    if (alpha && image.type !== 'VP8 ') throw invalidInput('WebP frame alpha needs a VP8 bitstream')
    frames.push({
      left,
      top,
      width,
      height,
      durationMs: uint24(data, base + 12),
      blend: (flags & 2) === 0,
      dispose: (flags & 1) === 1,
      image,
      alpha,
    })
  }
  if (frames.length === 0) throw invalidInput('Animated WebP contains no frames')
  return frames
}

/** Composites frames in order on one RGBA8 canvas, applying each frame's disposal. */
export class WebpCompositor {
  readonly #data: Uint8Array
  readonly #width: number
  readonly #frames: readonly WebpFrameDescriptor[]
  readonly #limits: ImageLimits
  readonly #accelerations: readonly WebpAcceleration[] | undefined
  readonly canvas: Uint8Array
  #next = 0
  #pendingDisposal: WebpFrameDescriptor | undefined

  constructor(
    data: Uint8Array,
    width: number,
    height: number,
    frames: readonly WebpFrameDescriptor[],
    limits: ImageLimits,
    accelerations?: readonly WebpAcceleration[],
  ) {
    this.#data = data
    this.#width = width
    this.#frames = frames
    this.#limits = limits
    this.#accelerations = accelerations
    this.canvas = new Uint8Array(width * height * 4)
  }

  get nextFrame(): number {
    return this.#next
  }

  /** Starts at the last frame up to `frame` that replaces the whole canvas without blending. */
  skipTo(frame: number, height: number): void {
    for (let index = frame; index > this.#next; index -= 1) {
      const candidate = this.#frames[index]
      if (
        candidate &&
        !candidate.blend &&
        candidate.left === 0 &&
        candidate.top === 0 &&
        candidate.width === this.#width &&
        candidate.height === height
      ) {
        this.#next = index
        this.#pendingDisposal = undefined
        return
      }
    }
  }

  async drawNext(signal?: AbortSignal): Promise<WebpFrameDescriptor> {
    const frame = this.#frames[this.#next]
    if (!frame) throw invalidInput('WebP has no more frames')
    const canvas = this.canvas
    const canvasWidth = this.#width
    const owed = this.#pendingDisposal
    if (owed?.dispose === true) {
      for (let y = 0; y < owed.height; y += 1) {
        const start = ((owed.top + y) * canvasWidth + owed.left) * 4
        canvas.fill(0, start, start + owed.width * 4)
      }
    }
    const decoder = await createWebpBitstreamDecoder(
      this.#data,
      frame.image,
      frame.alpha,
      this.#limits,
      this.#accelerations,
    )
    if (decoder.width !== frame.width || decoder.height !== frame.height) {
      throw invalidInput('WebP frame and bitstream dimensions do not match')
    }
    const rowBytes = frame.width * 4
    for await (const block of decoder.decode()) {
      throwIfAborted(signal)
      const data = block.data
      for (let row = 0; row < block.height; row += 1) {
        const source = row * block.stride
        let target = ((frame.top + block.y + row) * canvasWidth + frame.left) * 4
        if (!frame.blend) {
          canvas.set(data.subarray(source, source + rowBytes), target)
          continue
        }
        const end = source + rowBytes
        for (let index = source; index < end; index += 4, target += 4) {
          const alpha = data[index + 3] ?? 0
          if (alpha === 255) {
            canvas[target] = data[index] ?? 0
            canvas[target + 1] = data[index + 1] ?? 0
            canvas[target + 2] = data[index + 2] ?? 0
            canvas[target + 3] = 255
          } else if (alpha !== 0) {
            // Non-premultiplied "over", in the integer form browsers use for WebP frames.
            const coverage = ((canvas[target + 3] ?? 0) * (256 - alpha)) >> 8
            const total = alpha + coverage
            const scale = Math.floor(16_777_216 / total)
            for (let channel = 0; channel < 3; channel += 1) {
              const mixed =
                (data[index + channel] ?? 0) * alpha + (canvas[target + channel] ?? 0) * coverage
              canvas[target + channel] = Math.floor((mixed * scale) / 16_777_216)
            }
            canvas[target + 3] = total
          }
        }
      }
      block.release?.()
    }
    this.#pendingDisposal = frame
    this.#next += 1
    return frame
  }
}

const canvasCapabilities = Object.freeze({
  sequential: true,
  regionDecode: true,
  scaledDecode: false,
  progressive: false,
})

class WebpCanvasDecoder implements ImageDecoder {
  readonly width: number
  readonly height: number
  readonly pixelFormat = 'rgba8' as const
  readonly capabilities = canvasCapabilities
  readonly #canvas: Uint8Array

  constructor(canvas: Uint8Array, width: number, height: number) {
    this.#canvas = canvas
    this.width = width
    this.height = height
  }

  decode(request: DecodeRequest = {}): AsyncIterable<PixelBlock> {
    return canvasBlocks(
      this.#canvas,
      this.width,
      canvasRegion(this.width, this.height, request, 'WebP'),
      request.signal,
    )
  }
}

const rejectProfile = (parsed: ParsedWebp): void => {
  if (parsed.colorTransform) {
    throw unsupportedOperation('Animated WebP with an ICC profile is not supported')
  }
}

/** One composited frame of an animated WebP, as a viewer shows it. */
export const decodeWebpAnimationFrame = async (
  data: Uint8Array,
  parsed: ParsedWebp,
  frame: number,
  limits: ImageLimits,
  accelerations?: readonly WebpAcceleration[],
): Promise<ImageDecoder> => {
  rejectProfile(parsed)
  const frames = webpFrames(data, parsed)
  if (frame >= frames.length) {
    throw invalidInput(`WebP frame ${frame} does not exist; the file has ${frames.length} frames`)
  }
  const compositor = new WebpCompositor(
    data,
    parsed.width,
    parsed.height,
    frames,
    limits,
    accelerations,
  )
  compositor.skipTo(frame, parsed.height)
  while (compositor.nextFrame <= frame) await compositor.drawNext()
  return new WebpCanvasDecoder(compositor.canvas, parsed.width, parsed.height)
}

class WebpAnimationDecoder implements ImageAnimationDecoder {
  readonly width: number
  readonly height: number
  readonly pixelFormat = 'rgba8' as const
  readonly frameCount: number
  readonly loop: number
  readonly #data: Uint8Array
  readonly #parsed: ParsedWebp
  readonly #frames: readonly WebpFrameDescriptor[] | undefined
  readonly #limits: ImageLimits
  readonly #accelerations: readonly WebpAcceleration[] | undefined

  constructor(
    data: Uint8Array,
    parsed: ParsedWebp,
    limits: ImageLimits,
    accelerations?: readonly WebpAcceleration[],
  ) {
    this.width = parsed.width
    this.height = parsed.height
    this.#data = data
    this.#parsed = parsed
    this.#limits = limits
    this.#accelerations = accelerations
    this.#frames = parsed.animated ? webpFrames(data, parsed) : undefined
    this.frameCount = this.#frames?.length ?? 1
    this.loop = parsed.animated ? parsed.loop : 0
  }

  async *frames(signal?: AbortSignal): AsyncGenerator<ImageAnimationFrame> {
    const width = this.width
    const height = this.height
    const frames = this.#frames
    if (!frames) {
      // A still WebP is a one-frame animation.
      const image = this.#parsed.image
      if (!image) throw invalidInput('WebP image bitstream is missing')
      let decoder = await createWebpBitstreamDecoder(
        this.#data,
        image,
        this.#parsed.alpha,
        this.#limits,
        this.#accelerations,
      )
      if (this.#parsed.colorTransform) {
        const { ColorManagedDecoder } = await import('./webp-icc.ts')
        decoder = new ColorManagedDecoder(decoder, this.#parsed.colorTransform)
      }
      const still = decoder
      yield { index: 0, durationMs: 0, decode: (request) => still.decode(request) }
      return
    }
    const compositor = new WebpCompositor(
      this.#data,
      width,
      height,
      frames,
      this.#limits,
      this.#accelerations,
    )
    for (let index = 0; index < frames.length; index += 1) {
      throwIfAborted(signal)
      const frame = await compositor.drawNext(signal)
      const canvas = compositor.canvas
      yield {
        index,
        durationMs: frame.durationMs,
        decode: (request?: DecodeRequest) =>
          canvasBlocks(
            canvas,
            width,
            canvasRegion(width, height, request, 'WebP'),
            request?.signal ?? signal,
          ),
      }
    }
  }
}

export const decodeWebpAnimation = async (
  data: Uint8Array,
  limits: ImageLimits,
  accelerations?: readonly WebpAcceleration[],
): Promise<ImageAnimationDecoder> => {
  const parsed = await parseWebp(data)
  validateImageDimensions(parsed.width, parsed.height, parsed.frames, limits)
  if (parsed.animated) rejectProfile(parsed)
  return new WebpAnimationDecoder(data, parsed, limits, accelerations)
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

export interface WebpAnimationSettings {
  /** Options for each frame's still encoder: lossless, quality, effort and nearLossless. */
  readonly frame: Readonly<Record<string, unknown>>
  /** Repeat count; 0 repeats forever. */
  readonly loop: number
}

export const webpAnimationSettings = (options: unknown, sourceLoop = 0): WebpAnimationSettings => {
  if (!isRecord(options)) throw invalidInput('WebP encoder options must be an object')
  const loop = options.loop ?? sourceLoop
  if (typeof loop !== 'number' || !Number.isInteger(loop) || loop < 0 || loop > 65_535) {
    throw invalidInput('WebP loop must be an integer from 0 to 65535')
  }
  const frame: Record<string, unknown> = {}
  for (const key of ['lossless', 'quality', 'effort', 'nearLossless'] as const) {
    if (options[key] !== undefined) frame[key] = options[key]
  }
  return { frame, loop }
}

const writeUint24 = (target: Uint8Array, offset: number, value: number): void => {
  target[offset] = value & 0xff
  target[offset + 1] = (value >>> 8) & 0xff
  target[offset + 2] = (value >>> 16) & 0xff
}

const writeUint32 = (target: Uint8Array, offset: number, value: number): void => {
  writeUint24(target, offset, value)
  target[offset + 3] = (value >>> 24) & 0xff
}

const chunkBytes = (type: string, payload: Uint8Array): Uint8Array => {
  const output = new Uint8Array(8 + payload.byteLength + (payload.byteLength & 1))
  for (let index = 0; index < 4; index += 1) output[index] = type.charCodeAt(index)
  writeUint32(output, 4, payload.byteLength)
  output.set(payload, 8)
  return output
}

async function* rectBlocks(
  data: Uint8Array,
  width: number,
  height: number,
): AsyncGenerator<PixelBlock> {
  const stride = width * 4
  for (let y = 0; y < height; y += 64) {
    const rows = Math.min(64, height - y)
    yield {
      x: 0,
      y,
      width,
      height: rows,
      stride,
      format: 'rgba8',
      data: data.subarray(y * stride, (y + rows) * stride),
    }
  }
}

/**
 * Writes an animated WebP. Each frame encodes the rectangle that changed since the previous
 * frame, at even offsets. When every changed pixel is opaque, the frame alpha-blends and its
 * unchanged pixels are transparent; otherwise it replaces the rectangle exactly. Encoded frames are
 * held until the end because the RIFF header states the file size first.
 */
export class WebpAnimationWriter {
  readonly #sink: Pick<ImageSink, 'write'>
  readonly #width: number
  readonly #height: number
  readonly #settings: WebpAnimationSettings
  readonly #encoded: Uint8Array[] = []
  #previous: Uint8Array | undefined
  #spare: Uint8Array | undefined
  #region = new Uint8Array(0)
  #alpha = false
  #frames = 0

  constructor(
    sink: Pick<ImageSink, 'write'>,
    width: number,
    height: number,
    settings: WebpAnimationSettings,
  ) {
    if (
      !Number.isSafeInteger(width) ||
      !Number.isSafeInteger(height) ||
      width < 1 ||
      height < 1 ||
      width > 16_384 ||
      height > 16_384
    ) {
      throw invalidInput(`Animated WebP dimensions ${width}x${height} must be from 1 to 16384`)
    }
    this.#sink = sink
    this.#width = width
    this.#height = height
    this.#settings = settings
  }

  /** A canvas-sized RGBA8 buffer for the next frame. It may reuse an earlier frame's buffer. */
  frameBuffer(): Uint8Array {
    const buffer = this.#spare ?? new Uint8Array(this.#width * this.#height * 4)
    this.#spare = undefined
    return buffer
  }

  /** Takes ownership of a full-canvas RGBA8 frame from `frameBuffer()`. */
  async addFrame(frame: Uint8Array, durationMs: number): Promise<void> {
    const width = this.#width
    const height = this.#height
    if (frame.byteLength !== width * height * 4) {
      throw invalidInput('WebP frame does not match the canvas size')
    }
    if (!Number.isFinite(durationMs) || durationMs < 0) {
      throw invalidInput('WebP frame duration must be a non-negative number')
    }
    const previous = this.#previous
    const current = new Uint32Array(frame.buffer, frame.byteOffset, width * height)
    const before = previous
      ? new Uint32Array(previous.buffer, previous.byteOffset, width * height)
      : undefined

    // The rectangle of changed pixels, and whether every changed pixel is opaque.
    let left = 0
    let top = 0
    let right = width - 1
    let bottom = height - 1
    let opaque = true
    if (before) {
      left = width
      top = height
      right = -1
      bottom = -1
      for (let y = 0; y < height; y += 1) {
        let index = y * width
        for (let x = 0; x < width; x += 1, index += 1) {
          if (current[index] === before[index]) continue
          if (x < left) left = x
          if (x > right) right = x
          if (y < top) top = y
          bottom = y
          if ((frame[index * 4 + 3] ?? 0) !== 255) opaque = false
        }
      }
      if (right < 0) {
        // Nothing changed: a blended, fully transparent 2x2 frame keeps the canvas.
        left = 0
        top = 0
        right = Math.min(1, width - 1)
        bottom = Math.min(1, height - 1)
      }
    } else {
      for (let index = 3; index < frame.byteLength; index += 4) {
        if ((frame[index] ?? 0) !== 255) {
          opaque = false
          break
        }
      }
    }
    // Frame offsets are stored halved.
    left &= ~1
    top &= ~1
    const rectWidth = right - left + 1
    const rectHeight = bottom - top + 1
    const blend = before !== undefined && opaque

    const area = rectWidth * rectHeight * 4
    if (this.#region.byteLength < area) this.#region = new Uint8Array(area)
    const region = this.#region.subarray(0, area)
    let alpha = false
    for (let y = 0; y < rectHeight; y += 1) {
      const sourceRow = ((top + y) * width + left) * 4
      const targetRow = y * rectWidth * 4
      region.set(frame.subarray(sourceRow, sourceRow + rectWidth * 4), targetRow)
      if (!blend || !before) {
        for (let x = 3; x < rectWidth * 4; x += 4) {
          if ((region[targetRow + x] ?? 0) !== 255) alpha = true
        }
        continue
      }
      // Unchanged pixels become transparent so the blend keeps the canvas there.
      let index = (top + y) * width + left
      for (let x = 0; x < rectWidth; x += 1, index += 1) {
        if (current[index] === before[index]) {
          region.fill(0, targetRow + x * 4, targetRow + x * 4 + 4)
          alpha = true
        }
      }
    }
    this.#alpha ||= alpha

    const output = new Uint8ArraySink()
    const encoder = await createWebpEncoder(output, {
      width: rectWidth,
      height: rectHeight,
      pixelFormat: 'rgba8',
      options: this.#settings.frame,
    })
    for await (const block of rectBlocks(region, rectWidth, rectHeight)) await encoder.write(block)
    await encoder.finish()
    const still = output.toUint8Array()
    const parsed = await parseWebp(still)
    if (!parsed.image) throw invalidInput('WebP frame encoder wrote no bitstream')
    const parts: Uint8Array[] = []
    if (parsed.alpha) {
      parts.push(
        chunkBytes(
          'ALPH',
          still.subarray(parsed.alpha.offset, parsed.alpha.offset + parsed.alpha.length),
        ),
      )
    }
    parts.push(
      chunkBytes(
        parsed.image.type,
        still.subarray(parsed.image.offset, parsed.image.offset + parsed.image.length),
      ),
    )
    let payloadLength = 16
    for (const part of parts) payloadLength += part.byteLength
    const anmf = new Uint8Array(8 + payloadLength)
    anmf.set([0x41, 0x4e, 0x4d, 0x46], 0)
    writeUint32(anmf, 4, payloadLength)
    writeUint24(anmf, 8, left / 2)
    writeUint24(anmf, 11, top / 2)
    writeUint24(anmf, 14, rectWidth - 1)
    writeUint24(anmf, 17, rectHeight - 1)
    writeUint24(anmf, 20, Math.min(0xff_ffff, Math.round(durationMs)))
    anmf[23] = blend ? 0 : 2
    let offset = 24
    for (const part of parts) {
      anmf.set(part, offset)
      offset += part.byteLength
    }
    this.#encoded.push(anmf)
    this.#spare = previous
    this.#previous = frame
    this.#frames += 1
  }

  async finish(): Promise<void> {
    if (this.#frames === 0) throw invalidInput('WebP output must contain a frame')
    let bodyLength = 4 + 18 + 14
    for (const frame of this.#encoded) bodyLength += frame.byteLength
    const header = new Uint8Array(12 + 18 + 14)
    header.set([0x52, 0x49, 0x46, 0x46], 0)
    writeUint32(header, 4, bodyLength)
    header.set([0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x58], 8)
    writeUint32(header, 16, 10)
    header[20] = 0x02 | (this.#alpha ? 0x10 : 0)
    writeUint24(header, 24, this.#width - 1)
    writeUint24(header, 27, this.#height - 1)
    header.set([0x41, 0x4e, 0x49, 0x4d], 30)
    writeUint32(header, 34, 6)
    // Background color 0 (transparent), then the loop count.
    header[42] = this.#settings.loop & 0xff
    header[43] = this.#settings.loop >>> 8
    await this.#sink.write(header)
    for (const frame of this.#encoded) await this.#sink.write(frame)
    this.#encoded.length = 0
  }
}

class WebpFrameEncoder implements ImageEncoder {
  readonly #writer: WebpAnimationWriter
  readonly #stager: RgbaFrameStager
  readonly #frame: Uint8Array
  readonly #durationMs: number
  readonly #done: () => void
  #finished = false

  constructor(
    writer: WebpAnimationWriter,
    stager: RgbaFrameStager,
    durationMs: number,
    done: () => void,
  ) {
    this.#writer = writer
    this.#stager = stager
    this.#frame = writer.frameBuffer()
    this.#durationMs = durationMs
    this.#done = done
  }

  async write(block: PixelBlock): Promise<void> {
    if (this.#finished) throw new Error('Cannot write to a finished WebP frame')
    this.#stager.write(block, this.#frame)
  }

  async finish(): Promise<void> {
    if (this.#finished) throw new Error('WebP frame is already finished')
    this.#finished = true
    if (!this.#stager.complete) throw invalidInput('WebP frame did not receive every row')
    this.#stager.reset()
    this.#done()
    await this.#writer.addFrame(this.#frame, this.#durationMs)
  }

  async abort(): Promise<void> {
    this.#finished = true
  }
}

class WebpAnimationEncoder implements ImageAnimationEncoder {
  readonly #writer: WebpAnimationWriter
  readonly #stager: RgbaFrameStager
  #open = false
  #finished = false

  constructor(writer: WebpAnimationWriter, stager: RgbaFrameStager) {
    this.#writer = writer
    this.#stager = stager
  }

  async frame(options: { readonly durationMs: number }): Promise<ImageEncoder> {
    if (this.#finished) throw new Error('WebP animation is already finished')
    if (this.#open) throw new Error('Finish the current WebP frame before starting another')
    this.#open = true
    return new WebpFrameEncoder(this.#writer, this.#stager, options.durationMs, () => {
      this.#open = false
    })
  }

  async finish(): Promise<void> {
    if (this.#finished) throw new Error('WebP animation is already finished')
    if (this.#open) throw invalidInput('The last WebP frame was not finished')
    this.#finished = true
    await this.#writer.finish()
  }

  async abort(): Promise<void> {
    this.#finished = true
  }
}

export const createWebpAnimationEncoder = async (
  sink: ImageSink,
  request: AnimationEncodeRequest,
): Promise<ImageAnimationEncoder> => {
  const settings = webpAnimationSettings(request.options, request.loop ?? 0)
  const writer = new WebpAnimationWriter(sink, request.width, request.height, settings)
  return new WebpAnimationEncoder(
    writer,
    new RgbaFrameStager(request.width, request.height, request.pixelFormat),
  )
}

export interface WebpAnimationFrame {
  readonly index: number
  readonly durationMs: number
  readonly width: number
  readonly height: number
  /** Composited RGBA8 canvas as a viewer shows it. Valid until the next frame is requested. */
  readonly data: Uint8Array
}

export interface WebpAnimation {
  readonly width: number
  readonly height: number
  readonly frameCount: number
  /** Repeat count; 0 repeats forever. */
  readonly loop: number
  frames(signal?: AbortSignal): AsyncIterable<WebpAnimationFrame>
}

export interface OpenWebpAnimationOptions {
  readonly limits?: ImageLimitOptions
}

/** Opens animated WebP bytes for frame-by-frame decoding. One canvas is reused for every frame. */
export const openWebpAnimation = async (
  bytes: Uint8Array,
  options: Readonly<OpenWebpAnimationOptions> = {},
): Promise<WebpAnimation> => {
  const limits = resolveLimits(options.limits)
  const parsed = await parseWebp(bytes)
  validateImageDimensions(parsed.width, parsed.height, parsed.frames, limits)
  if (!parsed.animated) throw invalidInput('WebP is not animated')
  rejectProfile(parsed)
  const frames = webpFrames(bytes, parsed)
  return {
    width: parsed.width,
    height: parsed.height,
    frameCount: frames.length,
    loop: parsed.loop,
    async *frames(signal?: AbortSignal): AsyncGenerator<WebpAnimationFrame> {
      const compositor = new WebpCompositor(bytes, parsed.width, parsed.height, frames, limits)
      for (let index = 0; index < frames.length; index += 1) {
        throwIfAborted(signal)
        const frame = await compositor.drawNext(signal)
        yield {
          index,
          durationMs: frame.durationMs,
          width: parsed.width,
          height: parsed.height,
          data: compositor.canvas,
        }
      }
    },
  }
}

export interface WebpAnimationInputFrame {
  /** Full-canvas RGBA8 pixels. */
  readonly data: Uint8Array
  readonly durationMs: number
}

export interface EncodeWebpAnimationOptions {
  readonly width: number
  readonly height: number
  /** Lossless VP8L frames. Defaults to lossy VP8 frames. */
  readonly lossless?: boolean
  /** Lossy quality from 1 to 100. Defaults to 80. */
  readonly quality?: number
  /** Lossless effort from 0 to 6. */
  readonly effort?: number
  /** Repeat count; 0 repeats forever. Defaults to 0. */
  readonly loop?: number
  readonly signal?: AbortSignal
}

/** Animated WebP output. Encoded frames are held until the end, then written in one pass. */
export async function* encodeWebpAnimation(
  frames: AsyncIterable<WebpAnimationInputFrame> | Iterable<WebpAnimationInputFrame>,
  options: Readonly<EncodeWebpAnimationOptions>,
): AsyncGenerator<Uint8Array> {
  const settings = webpAnimationSettings({
    ...(options.lossless === undefined ? {} : { lossless: options.lossless }),
    ...(options.quality === undefined ? {} : { quality: options.quality }),
    ...(options.effort === undefined ? {} : { effort: options.effort }),
    ...(options.loop === undefined ? {} : { loop: options.loop }),
  })
  const chunks: Uint8Array[] = []
  const writer = new WebpAnimationWriter(
    { write: async (chunk) => void chunks.push(chunk) },
    options.width,
    options.height,
    settings,
  )
  const expected = options.width * options.height * 4
  let count = 0
  for await (const frame of frames) {
    throwIfAborted(options.signal)
    if (frame.data.byteLength !== expected) {
      throw invalidInput(`WebP frame ${count} must hold ${expected} RGBA8 bytes`)
    }
    const buffer = writer.frameBuffer()
    buffer.set(frame.data)
    await writer.addFrame(buffer, frame.durationMs)
    count += 1
  }
  await writer.finish()
  yield* chunks.splice(0)
}
