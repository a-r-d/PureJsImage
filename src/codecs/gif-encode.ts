import type {
  AnimationEncodeRequest,
  EncodeRequest,
  ImageAnimationEncoder,
  ImageEncoder,
} from '../codec.ts'
import { invalidInput } from '../errors.ts'
import type { PixelBlock, PixelFormat } from '../pixel.ts'
import type { ImageSink } from '../sink.ts'
import { GifByteWriter, GifLzwEncoder, gifMinimumCodeSize } from './gif-lzw.ts'
import { exactGifPalette, gifAlphaThreshold, mapGifPalette, wuGifPalette } from './gif-quantize.ts'
import { RgbaFrameStager } from './rgba-frame.ts'

export interface GifEncoderSettings {
  /** Floyd-Steinberg strength from 0 (off) to 1. Used only when a frame has over 256 colors. */
  readonly dither: number
  /** Animation repeat count. 0 repeats forever. Ignored for one frame. */
  readonly loop: number
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

export const gifEncoderSettings = (options: unknown, sourceLoop = 0): GifEncoderSettings => {
  if (!isRecord(options)) throw invalidInput('GIF encoder options must be an object')
  const dither = options.dither ?? 1
  if (typeof dither !== 'number' || !Number.isFinite(dither) || dither < 0 || dither > 1) {
    throw invalidInput('GIF dither must be a number from 0 to 1')
  }
  const loop = options.loop ?? sourceLoop
  if (typeof loop !== 'number' || !Number.isInteger(loop) || loop < 0 || loop > 65_535) {
    throw invalidInput('GIF loop must be an integer from 0 to 65535')
  }
  return { dither, loop }
}

interface Rect {
  x: number
  y: number
  width: number
  height: number
}

const tableBits = (colors: number): number => {
  let bits = 1
  while (1 << bits < colors) bits += 1
  return bits
}

const writeColorTable = (writer: GifByteWriter, palette: Uint8Array, colors: number): void => {
  const entries = 1 << tableBits(colors)
  writer.reserve(entries * 3)
  writer.bytes(palette.subarray(0, colors * 3))
  for (let index = colors * 3; index < entries * 3; index += 1) writer.byte(0)
}

/**
 * Writes GIF89a output one frame behind its input. Holding one frame lets the encoder pick the
 * previous frame's disposal once it knows whether the next frame turns pixels transparent.
 * Frames draw only the changed rectangle; unchanged pixels inside it use the transparent index.
 */
export class GifAnimationWriter {
  readonly #sink: Pick<ImageSink, 'write'>
  readonly #width: number
  readonly #height: number
  readonly #settings: GifEncoderSettings
  readonly #lzw = new GifLzwEncoder()
  readonly #writer = new GifByteWriter(1 << 16)
  // The canvas a decoder shows after the last written frame and its disposal.
  readonly #display: Uint8Array
  // Source pixels of the last written frame, for change detection.
  #previous: Uint8Array | undefined
  // The held frame and its duration in centiseconds.
  #pending: Uint8Array | undefined
  #pendingDelay = 0
  #spare: Uint8Array | undefined
  #frames = 0
  #headerWritten = false
  #globalPalette: Uint8Array | undefined
  #globalColors = 0
  #globalTransparent = -1
  readonly #palette = new Uint8Array(256 * 3)
  readonly #quantized = new Uint8Array(256 * 3)
  #region: Uint8Array = new Uint8Array(0)
  #indices: Uint8Array = new Uint8Array(0)

  constructor(
    sink: Pick<ImageSink, 'write'>,
    width: number,
    height: number,
    settings: GifEncoderSettings,
  ) {
    if (
      !Number.isSafeInteger(width) ||
      !Number.isSafeInteger(height) ||
      width < 1 ||
      height < 1 ||
      width > 65_535 ||
      height > 65_535
    ) {
      throw invalidInput(`GIF dimensions ${width}x${height} must be from 1 to 65535`)
    }
    this.#sink = sink
    this.#width = width
    this.#height = height
    this.#settings = settings
    this.#display = new Uint8Array(width * height * 4)
  }

  /** A canvas-sized RGBA8 buffer for the next frame. It may reuse an earlier frame's buffer. */
  frameBuffer(): Uint8Array {
    const buffer = this.#spare ?? new Uint8Array(this.#width * this.#height * 4)
    this.#spare = undefined
    return buffer
  }

  /** Takes ownership of a full-canvas RGBA8 frame from `frameBuffer()`. */
  async addFrame(frame: Uint8Array, durationMs: number): Promise<void> {
    if (frame.byteLength !== this.#width * this.#height * 4) {
      throw invalidInput('GIF frame does not match the canvas size')
    }
    if (!Number.isFinite(durationMs) || durationMs < 0) {
      throw invalidInput('GIF frame duration must be a non-negative number')
    }
    if (this.#pending) await this.#writePending(frame)
    this.#pending = frame
    this.#pendingDelay = Math.min(65_535, Math.round(durationMs / 10))
  }

  async finish(): Promise<void> {
    if (!this.#pending) throw invalidInput('GIF output must contain a frame')
    await this.#writePending(undefined)
    this.#writer.reset()
    this.#writer.byte(0x3b)
    await this.#sink.write(this.#writer.view().slice())
  }

  async #writePending(next: Uint8Array | undefined): Promise<void> {
    const frame = this.#pending
    if (!frame) return
    const width = this.#width
    const height = this.#height
    const display = this.#display
    const previous = this.#previous
    const first = this.#frames === 0

    // Pixels the next frame turns transparent must be cleared by disposing this frame.
    let clear: Rect | undefined
    if (next) {
      let minX = width
      let minY = height
      let maxX = -1
      let maxY = -1
      for (let y = 0; y < height; y += 1) {
        let offset = y * width * 4 + 3
        for (let x = 0; x < width; x += 1, offset += 4) {
          if (
            (next[offset] ?? 0) < gifAlphaThreshold &&
            (frame[offset] ?? 0) >= gifAlphaThreshold
          ) {
            if (x < minX) minX = x
            if (x > maxX) maxX = x
            if (y < minY) minY = y
            maxY = y
          }
        }
      }
      if (maxX >= 0) clear = { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 }
    }

    // Draw opaque pixels whose source changed or that the canvas does not show.
    let rect: Rect
    if (first) {
      rect = { x: 0, y: 0, width, height }
    } else {
      let minX = width
      let minY = height
      let maxX = -1
      let maxY = -1
      for (let y = 0; y < height; y += 1) {
        let offset = y * width * 4
        for (let x = 0; x < width; x += 1, offset += 4) {
          if ((frame[offset + 3] ?? 0) < gifAlphaThreshold) continue
          if (
            (display[offset + 3] ?? 0) === 0 ||
            previous === undefined ||
            (previous[offset + 3] ?? 0) < gifAlphaThreshold ||
            frame[offset] !== previous[offset] ||
            frame[offset + 1] !== previous[offset + 1] ||
            frame[offset + 2] !== previous[offset + 2]
          ) {
            if (x < minX) minX = x
            if (x > maxX) maxX = x
            if (y < minY) minY = y
            maxY = y
          }
        }
      }
      rect =
        maxX >= 0
          ? { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 }
          : { x: 0, y: 0, width: 1, height: 1 }
    }
    if (clear) {
      const right = Math.max(rect.x + rect.width, clear.x + clear.width)
      const bottom = Math.max(rect.y + rect.height, clear.y + clear.height)
      rect.x = Math.min(rect.x, clear.x)
      rect.y = Math.min(rect.y, clear.y)
      rect.width = right - rect.x
      rect.height = bottom - rect.y
    }

    // Copy the drawn pixels of the rectangle; kept pixels become transparent. The first frame
    // draws every opaque pixel of the whole canvas, so it is read in place.
    const area = rect.width * rect.height
    if (this.#indices.byteLength < area) this.#indices = new Uint8Array(area)
    const indices = this.#indices
    let region = frame
    let regionStride = width * 4
    let transparent = false
    if (first) {
      for (let offset = 3; offset < frame.byteLength; offset += 4) {
        if ((frame[offset] ?? 0) < gifAlphaThreshold) {
          transparent = true
          break
        }
      }
    } else {
      if (this.#region.byteLength < area * 4) this.#region = new Uint8Array(area * 4)
      region = this.#region
      regionStride = rect.width * 4
    }
    for (let y = 0; !first && y < rect.height; y += 1) {
      let source = ((rect.y + y) * width + rect.x) * 4
      let target = y * rect.width * 4
      for (let x = 0; x < rect.width; x += 1, source += 4, target += 4) {
        const alpha = frame[source + 3] ?? 0
        const draw =
          alpha >= gifAlphaThreshold &&
          (first ||
            (display[source + 3] ?? 0) === 0 ||
            previous === undefined ||
            (previous[source + 3] ?? 0) < gifAlphaThreshold ||
            frame[source] !== previous[source] ||
            frame[source + 1] !== previous[source + 1] ||
            frame[source + 2] !== previous[source + 2])
        if (draw) {
          region[target] = frame[source] ?? 0
          region[target + 1] = frame[source + 1] ?? 0
          region[target + 2] = frame[source + 2] ?? 0
          region[target + 3] = 255
        } else {
          region[target + 3] = 0
          transparent = true
        }
      }
    }

    // Reuse the global palette when every drawn color is in it; otherwise build a local one.
    let palette = this.#palette
    let colors = 0
    let transparentIndex = transparent ? 0 : -1
    let local = true
    if (this.#globalPalette && (!transparent || this.#globalTransparent >= 0)) {
      palette.set(this.#globalPalette.subarray(0, this.#globalColors * 3))
      const reused = exactGifPalette(
        region,
        0,
        regionStride,
        rect.width,
        rect.height,
        this.#globalColors,
        this.#globalTransparent,
        indices,
        palette,
        this.#globalColors,
      )
      if (reused >= 0) {
        colors = this.#globalColors
        transparentIndex = transparent ? this.#globalTransparent : -1
        local = false
      }
    }
    if (local) {
      colors = exactGifPalette(
        region,
        0,
        regionStride,
        rect.width,
        rect.height,
        256,
        transparentIndex,
        indices,
        palette,
      )
      if (colors < 0) {
        const offset = transparent ? 1 : 0
        const quantized = wuGifPalette(
          region,
          0,
          regionStride,
          rect.width,
          rect.height,
          256 - offset,
          this.#quantized,
        )
        palette = this.#palette
        palette.fill(0, 0, offset * 3)
        palette.set(this.#quantized.subarray(0, quantized * 3), offset * 3)
        colors = quantized + offset
        mapGifPalette(
          region,
          0,
          regionStride,
          rect.width,
          rect.height,
          palette,
          colors,
          transparentIndex,
          this.#settings.dither,
          indices,
        )
      }
      colors = Math.max(colors, transparentIndex + 1, 2)
    }

    const writer = this.#writer
    writer.reset()
    if (!this.#headerWritten) {
      // The first frame's palette becomes the global table.
      this.#globalPalette = palette.slice(0, colors * 3)
      this.#globalColors = colors
      this.#globalTransparent = transparentIndex
      local = false
      writer.bytes(Uint8Array.of(0x47, 0x49, 0x46, 0x38, 0x39, 0x61))
      writer.uint16(width)
      writer.uint16(height)
      writer.byte(0x80 | 0x70 | (tableBits(colors) - 1))
      writer.byte(0)
      writer.byte(0)
      writeColorTable(writer, palette, colors)
      if (next) {
        writer.bytes(Uint8Array.of(0x21, 0xff, 0x0b))
        writer.bytes(Uint8Array.from('NETSCAPE2.0', (character) => character.charCodeAt(0)))
        writer.bytes(Uint8Array.of(3, 1))
        writer.uint16(this.#settings.loop)
        writer.byte(0)
      }
      this.#headerWritten = true
    }
    const disposal = clear ? 2 : 1
    if (next || transparentIndex >= 0 || this.#frames > 0) {
      writer.bytes(Uint8Array.of(0x21, 0xf9, 4))
      writer.byte((disposal << 2) | (transparentIndex >= 0 ? 1 : 0))
      writer.uint16(this.#pendingDelay)
      writer.byte(transparentIndex >= 0 ? transparentIndex : 0)
      writer.byte(0)
    }
    writer.byte(0x2c)
    writer.uint16(rect.x)
    writer.uint16(rect.y)
    writer.uint16(rect.width)
    writer.uint16(rect.height)
    writer.byte(local ? 0x80 | (tableBits(colors) - 1) : 0)
    if (local) writeColorTable(writer, palette, colors)
    this.#lzw.encode(indices, 0, area, gifMinimumCodeSize(1 << tableBits(colors)), writer)
    await this.#sink.write(writer.view().slice())

    // Update the decoder's canvas, then apply this frame's disposal. The last frame needs neither.
    for (let y = 0; next && y < rect.height; y += 1) {
      let target = ((rect.y + y) * width + rect.x) * 4
      let index = y * rect.width
      for (let x = 0; x < rect.width; x += 1, target += 4, index += 1) {
        const entry = indices[index] ?? 0
        if (entry === transparentIndex) continue
        display[target] = palette[entry * 3] ?? 0
        display[target + 1] = palette[entry * 3 + 1] ?? 0
        display[target + 2] = palette[entry * 3 + 2] ?? 0
        display[target + 3] = 255
      }
    }
    if (clear) {
      for (let y = 0; y < rect.height; y += 1) {
        const start = ((rect.y + y) * width + rect.x) * 4
        display.fill(0, start, start + rect.width * 4)
      }
    }
    this.#spare = previous
    this.#previous = frame
    this.#pending = undefined
    this.#frames += 1
  }
}

/** Single-image GIF output. The frame is held in memory to choose its palette. */
class GifEncoder implements ImageEncoder {
  readonly #writer: GifAnimationWriter
  readonly #stager: RgbaFrameStager
  readonly #frame: Uint8Array
  #finished = false

  constructor(writer: GifAnimationWriter, stager: RgbaFrameStager) {
    this.#writer = writer
    this.#stager = stager
    this.#frame = writer.frameBuffer()
  }

  async write(block: PixelBlock): Promise<void> {
    if (this.#finished) throw new Error('Cannot write to a finished GIF encoder')
    this.#stager.write(block, this.#frame)
  }

  async finish(): Promise<void> {
    if (this.#finished) throw new Error('GIF encoder is already finished')
    this.#finished = true
    if (!this.#stager.complete) throw invalidInput('GIF encoder did not receive every row')
    await this.#writer.addFrame(this.#frame, 0)
    await this.#writer.finish()
  }

  async abort(): Promise<void> {
    this.#finished = true
  }
}

export const gifEncoderPixelFormats: readonly PixelFormat[] = ['gray8', 'rgb8', 'rgba8']

export const createGifEncoder = async (
  sink: ImageSink,
  request: EncodeRequest,
): Promise<ImageEncoder> => {
  const settings = gifEncoderSettings(request.options)
  const writer = new GifAnimationWriter(sink, request.width, request.height, settings)
  return new GifEncoder(
    writer,
    new RgbaFrameStager(request.width, request.height, request.pixelFormat),
  )
}

/** Per-frame encoder for animated output; each finished frame goes to the shared writer. */
class GifFrameEncoder implements ImageEncoder {
  readonly #writer: GifAnimationWriter
  readonly #stager: RgbaFrameStager
  readonly #frame: Uint8Array
  readonly #durationMs: number
  readonly #done: () => void
  #finished = false

  constructor(
    writer: GifAnimationWriter,
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
    if (this.#finished) throw new Error('Cannot write to a finished GIF frame')
    this.#stager.write(block, this.#frame)
  }

  async finish(): Promise<void> {
    if (this.#finished) throw new Error('GIF frame is already finished')
    this.#finished = true
    if (!this.#stager.complete) throw invalidInput('GIF frame did not receive every row')
    this.#stager.reset()
    this.#done()
    await this.#writer.addFrame(this.#frame, this.#durationMs)
  }

  async abort(): Promise<void> {
    this.#finished = true
  }
}

class GifAnimationEncoder implements ImageAnimationEncoder {
  readonly #writer: GifAnimationWriter
  readonly #stager: RgbaFrameStager
  #open = false
  #finished = false

  constructor(writer: GifAnimationWriter, stager: RgbaFrameStager) {
    this.#writer = writer
    this.#stager = stager
  }

  async frame(options: { readonly durationMs: number }): Promise<ImageEncoder> {
    if (this.#finished) throw new Error('GIF animation is already finished')
    if (this.#open) throw new Error('Finish the current GIF frame before starting another')
    this.#open = true
    return new GifFrameEncoder(this.#writer, this.#stager, options.durationMs, () => {
      this.#open = false
    })
  }

  async finish(): Promise<void> {
    if (this.#finished) throw new Error('GIF animation is already finished')
    if (this.#open) throw invalidInput('The last GIF frame was not finished')
    this.#finished = true
    await this.#writer.finish()
  }

  async abort(): Promise<void> {
    this.#finished = true
  }
}

export const createGifAnimationEncoder = async (
  sink: ImageSink,
  request: AnimationEncodeRequest,
): Promise<ImageAnimationEncoder> => {
  const settings = gifEncoderSettings(request.options, request.loop ?? 0)
  const writer = new GifAnimationWriter(sink, request.width, request.height, settings)
  return new GifAnimationEncoder(
    writer,
    new RgbaFrameStager(request.width, request.height, request.pixelFormat),
  )
}
