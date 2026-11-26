import type {
  DecoderOptions,
  DecodeRequest,
  ImageAnimationDecoder,
  ImageAnimationFrame,
  ImageDecoder,
} from '../codec.ts'
import { throwIfAborted } from '../abort.ts'
import { invalidInput, truncatedInput, unsupportedOperation } from '../errors.ts'
import { type ImageLimits, validateImageDimensions } from '../limits.ts'
import type { PixelBlock } from '../pixel.ts'
import { type ImageSource, readExactly } from '../source.ts'
import { colorTableBytes, isGif } from './gif.ts'
import { createGifLzwDecodeScratch, decodeGifLzw, type GifLzwDecodeScratch } from './gif-lzw.ts'

const blockRows = 32

// Opaque RGBA8 pixels are written as one 32-bit value in the platform's byte order.
const nativeLittleEndian = new Uint8Array(Uint32Array.of(1).buffer)[0] === 1

const palette32 = (palette: Uint8Array, target: Uint32Array): void => {
  const colors = Math.min(256, palette.byteLength / 3)
  for (let index = 0; index < colors; index += 1) {
    const r = palette[index * 3] ?? 0
    const g = palette[index * 3 + 1] ?? 0
    const b = palette[index * 3 + 2] ?? 0
    target[index] = nativeLittleEndian
      ? (0xff000000 | (b << 16) | (g << 8) | r) >>> 0
      : ((r << 24) | (g << 16) | (b << 8) | 0xff) >>> 0
  }
}

export interface GifFrameDescriptor {
  readonly left: number
  readonly top: number
  readonly width: number
  readonly height: number
  readonly interlaced: boolean
  readonly palette: Uint8Array
  readonly transparentIndex: number
  readonly disposal: number
  readonly delayCentiseconds: number
  readonly minimumCodeSize: number
  /** Offset of the first data sub-block length byte. */
  readonly dataOffset: number
}

export interface GifStructure {
  readonly width: number
  readonly height: number
  /** NETSCAPE repeat count; 0 repeats forever. 1 when the file has no loop extension. */
  readonly loop: number
  readonly frames: readonly GifFrameDescriptor[]
}

const byte = (data: Uint8Array, offset: number): number => {
  const value = data[offset]
  if (value === undefined) throw truncatedInput(`GIF is truncated at offset ${offset}`)
  return value
}

const littleEndian = (data: Uint8Array, offset: number): number =>
  byte(data, offset) | (byte(data, offset + 1) << 8)

const skipSubBlocks = (data: Uint8Array, start: number): number => {
  let offset = start
  for (let blocks = 0; blocks < 1_000_000; blocks += 1) {
    const length = byte(data, offset)
    offset += 1
    if (length === 0) return offset
    offset += length
    if (offset > data.byteLength) throw truncatedInput('GIF data sub-block is truncated')
  }
  throw invalidInput('GIF contains too many data sub-blocks')
}

/** Reads every frame descriptor without decompressing image data. */
export const parseGif = (data: Uint8Array, limits: ImageLimits): GifStructure => {
  if (data.byteLength < 13 || !isGif(data)) throw invalidInput('GIF header is invalid')
  const width = littleEndian(data, 6)
  const height = littleEndian(data, 8)
  validateImageDimensions(width, height, 1, limits)
  const screenPacked = byte(data, 10)
  let offset = 13
  let globalPalette: Uint8Array | undefined
  if ((screenPacked & 0x80) !== 0) {
    const length = colorTableBytes(screenPacked)
    if (offset + length > data.byteLength) throw truncatedInput('GIF color table is truncated')
    globalPalette = data.subarray(offset, offset + length)
    offset += length
  }
  const frames: GifFrameDescriptor[] = []
  let loop = 1
  let transparentIndex = -1
  let disposal = 0
  let delayCentiseconds = 0
  for (let blocks = 0; offset < data.byteLength && blocks < 1_000_000; blocks += 1) {
    const marker = byte(data, offset)
    offset += 1
    if (marker === 0x3b) break
    if (marker === 0x21) {
      const label = byte(data, offset)
      offset += 1
      if (label === 0xf9) {
        if (byte(data, offset) !== 4)
          throw invalidInput('GIF graphics control extension is invalid')
        const packed = byte(data, offset + 1)
        disposal = (packed >>> 2) & 0x07
        delayCentiseconds = littleEndian(data, offset + 2)
        transparentIndex = (packed & 1) === 0 ? -1 : byte(data, offset + 4)
        if (byte(data, offset + 5) !== 0) throw invalidInput('GIF extension terminator is missing')
        offset += 6
      } else if (
        label === 0xff &&
        byte(data, offset) === 11 &&
        offset + 16 <= data.byteLength &&
        String.fromCharCode(...data.subarray(offset + 1, offset + 12)) === 'NETSCAPE2.0' &&
        byte(data, offset + 12) === 3 &&
        byte(data, offset + 13) === 1
      ) {
        loop = littleEndian(data, offset + 14)
        offset = skipSubBlocks(data, offset + 12)
      } else {
        offset = skipSubBlocks(data, offset)
      }
      continue
    }
    if (marker !== 0x2c) {
      throw invalidInput(`GIF contains an unknown block marker: 0x${marker.toString(16)}`)
    }
    const left = littleEndian(data, offset)
    const top = littleEndian(data, offset + 2)
    const frameWidth = littleEndian(data, offset + 4)
    const frameHeight = littleEndian(data, offset + 6)
    const imagePacked = byte(data, offset + 8)
    offset += 9
    if (
      frameWidth < 1 ||
      frameHeight < 1 ||
      left + frameWidth > width ||
      top + frameHeight > height
    ) {
      throw invalidInput(
        `GIF frame ${left},${top} ${frameWidth}x${frameHeight} exceeds ${width}x${height}`,
      )
    }
    let palette = globalPalette
    if ((imagePacked & 0x80) !== 0) {
      const length = colorTableBytes(imagePacked)
      if (offset + length > data.byteLength) throw truncatedInput('GIF color table is truncated')
      palette = data.subarray(offset, offset + length)
      offset += length
    }
    if (!palette) throw invalidInput('GIF frame has no color table')
    const minimumCodeSize = byte(data, offset)
    offset += 1
    if (minimumCodeSize < 2 || minimumCodeSize > 8) {
      throw invalidInput(`GIF LZW minimum code size ${minimumCodeSize} is invalid`)
    }
    frames.push({
      left,
      top,
      width: frameWidth,
      height: frameHeight,
      interlaced: (imagePacked & 0x40) !== 0,
      palette,
      transparentIndex,
      disposal,
      delayCentiseconds,
      minimumCodeSize,
      dataOffset: offset,
    })
    if (frames.length > limits.maxFrames) {
      validateImageDimensions(width, height, frames.length, limits)
    }
    offset = skipSubBlocks(data, offset)
    transparentIndex = -1
    disposal = 0
    delayCentiseconds = 0
  }
  if (frames.length === 0) throw invalidInput('GIF contains no image frames')
  validateImageDimensions(width, height, frames.length, limits)
  return { width, height, loop, frames }
}

// Interlaced GIF rows arrive in four passes. Returns the storage row of each display row.
const storageRows = (height: number, interlaced: boolean): Int32Array => {
  const rows = new Int32Array(height)
  if (!interlaced) {
    for (let row = 0; row < height; row += 1) rows[row] = row
    return rows
  }
  let storageRow = 0
  for (const [start, step] of [
    [0, 8],
    [4, 8],
    [2, 4],
    [1, 2],
  ] as const) {
    for (let row = start; row < height; row += step) {
      rows[row] = storageRow
      storageRow += 1
    }
  }
  return rows
}

const validateIndices = (frame: GifFrameDescriptor, indices: Uint8Array, length: number): void => {
  const colors = frame.palette.byteLength / 3
  if (colors >= 256) return
  for (let index = 0; index < length; index += 1) {
    const value = indices[index] ?? 0
    if (value >= colors && value !== frame.transparentIndex) {
      throw invalidInput(`GIF palette index ${value} is outside its color table`)
    }
  }
}

/** Composites frames in order on one RGBA8 canvas, applying each frame's disposal. */
export class GifCompositor {
  readonly #data: Uint8Array
  readonly #structure: GifStructure
  readonly #scratch: GifLzwDecodeScratch = createGifLzwDecodeScratch()
  readonly canvas: Uint8Array
  readonly #canvas32: Uint32Array
  readonly #colors = new Uint32Array(256)
  #indices = new Uint8Array(0)
  #saved = new Uint8Array(0)
  #next = 0
  // Disposal still owed by the last drawn frame.
  #pendingDisposal: GifFrameDescriptor | undefined

  constructor(data: Uint8Array, structure: GifStructure) {
    this.#data = data
    this.#structure = structure
    this.canvas = new Uint8Array(structure.width * structure.height * 4)
    this.#canvas32 = new Uint32Array(this.canvas.buffer)
  }

  get nextFrame(): number {
    return this.#next
  }

  /**
   * Starts at the last frame up to `frame` that covers the canvas without transparency. Earlier
   * frames cannot show through it, so they need no decoding.
   */
  skipTo(frame: number): void {
    const frames = this.#structure.frames
    for (let index = frame; index > this.#next; index -= 1) {
      const candidate = frames[index]
      if (
        candidate &&
        candidate.transparentIndex < 0 &&
        candidate.left === 0 &&
        candidate.top === 0 &&
        candidate.width === this.#structure.width &&
        candidate.height === this.#structure.height
      ) {
        this.#next = index
        this.#pendingDisposal = undefined
        return
      }
    }
  }

  /** Draws the next frame. The canvas then shows that frame as a viewer displays it. */
  drawNext(): GifFrameDescriptor {
    const frame = this.#structure.frames[this.#next]
    if (!frame) throw invalidInput('GIF has no more frames')
    const canvas = this.canvas
    const canvasWidth = this.#structure.width
    const owed = this.#pendingDisposal
    if (owed?.disposal === 2) {
      for (let y = 0; y < owed.height; y += 1) {
        const start = ((owed.top + y) * canvasWidth + owed.left) * 4
        canvas.fill(0, start, start + owed.width * 4)
      }
    } else if (owed?.disposal === 3) {
      const rowBytes = owed.width * 4
      for (let y = 0; y < owed.height; y += 1) {
        const start = ((owed.top + y) * canvasWidth + owed.left) * 4
        canvas.set(this.#saved.subarray(y * rowBytes, (y + 1) * rowBytes), start)
      }
    }
    if (frame.disposal === 3) {
      const rowBytes = frame.width * 4
      if (this.#saved.byteLength < rowBytes * frame.height) {
        this.#saved = new Uint8Array(rowBytes * frame.height)
      }
      for (let y = 0; y < frame.height; y += 1) {
        const start = ((frame.top + y) * canvasWidth + frame.left) * 4
        this.#saved.set(canvas.subarray(start, start + rowBytes), y * rowBytes)
      }
    }
    const area = frame.width * frame.height
    if (this.#indices.byteLength < area) this.#indices = new Uint8Array(area)
    const indices = this.#indices.subarray(0, area)
    decodeGifLzw(this.#data, frame.dataOffset, frame.minimumCodeSize, indices, this.#scratch)
    validateIndices(frame, indices, area)
    const rows = storageRows(frame.height, frame.interlaced)
    const colors = this.#colors
    palette32(frame.palette, colors)
    const canvas32 = this.#canvas32
    const transparent = frame.transparentIndex
    for (let y = 0; y < frame.height; y += 1) {
      let source = (rows[y] ?? 0) * frame.width
      let target = (frame.top + y) * canvasWidth + frame.left
      const end = source + frame.width
      if (transparent < 0) {
        for (; source < end; source += 1, target += 1)
          canvas32[target] = colors[indices[source] ?? 0] ?? 0
        continue
      }
      for (; source < end; source += 1, target += 1) {
        const index = indices[source] ?? 0
        if (index !== transparent) canvas32[target] = colors[index] ?? 0
      }
    }
    this.#pendingDisposal = frame
    this.#next += 1
    return frame
  }
}

interface GifRegion {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

const region = (width: number, height: number, request: DecodeRequest = {}): GifRegion => {
  const x = request.x ?? 0
  const y = request.y ?? 0
  const outputWidth = request.width ?? width - x
  const outputHeight = request.height ?? height - y
  if (
    !Number.isSafeInteger(x) ||
    !Number.isSafeInteger(y) ||
    !Number.isSafeInteger(outputWidth) ||
    !Number.isSafeInteger(outputHeight) ||
    x < 0 ||
    y < 0 ||
    outputWidth < 1 ||
    outputHeight < 1 ||
    x + outputWidth > width ||
    y + outputHeight > height
  ) {
    throw invalidInput(`GIF decode region ${x},${y} ${outputWidth}x${outputHeight} is invalid`)
  }
  return { x, y, width: outputWidth, height: outputHeight }
}

/** Emits a canvas region as RGBA8 blocks that copy the canvas rows. */
async function* canvasBlocks(
  canvas: Uint8Array,
  canvasWidth: number,
  output: GifRegion,
  signal: AbortSignal | undefined,
): AsyncGenerator<PixelBlock> {
  const stride = output.width * 4
  for (let outputY = 0; outputY < output.height; outputY += blockRows) {
    throwIfAborted(signal)
    const height = Math.min(blockRows, output.height - outputY)
    const data = new Uint8Array(stride * height)
    for (let row = 0; row < height; row += 1) {
      const start = ((output.y + outputY + row) * canvasWidth + output.x) * 4
      data.set(canvas.subarray(start, start + stride), row * stride)
    }
    yield { x: 0, y: outputY, width: output.width, height, stride, format: 'rgba8', data }
  }
}

const capabilities = Object.freeze({
  sequential: true,
  regionDecode: true,
  scaledDecode: false,
  progressive: false,
})

/** One frame as a viewer shows it. Frame 0 decodes without a canvas. */
class GifDecoder implements ImageDecoder {
  readonly width: number
  readonly height: number
  readonly pixelFormat = 'rgba8' as const
  readonly capabilities = capabilities
  readonly #data: Uint8Array
  readonly #structure: GifStructure
  readonly #frame: number

  constructor(data: Uint8Array, structure: GifStructure, frame: number) {
    this.width = structure.width
    this.height = structure.height
    this.#data = data
    this.#structure = structure
    this.#frame = frame
  }

  async *decode(request: DecodeRequest = {}): AsyncGenerator<PixelBlock> {
    const output = region(this.width, this.height, request)
    if (this.#frame > 0) {
      const compositor = new GifCompositor(this.#data, this.#structure)
      compositor.skipTo(this.#frame)
      while (compositor.nextFrame <= this.#frame) {
        throwIfAborted(request.signal)
        compositor.drawNext()
      }
      yield* canvasBlocks(compositor.canvas, this.width, output, request.signal)
      return
    }
    const frame = this.#structure.frames[0]
    if (!frame) throw invalidInput('GIF contains no image frames')
    const area = frame.width * frame.height
    const indices = new Uint8Array(area)
    decodeGifLzw(
      this.#data,
      frame.dataOffset,
      frame.minimumCodeSize,
      indices,
      createGifLzwDecodeScratch(),
    )
    validateIndices(frame, indices, area)
    const rows = storageRows(frame.height, frame.interlaced)
    const colors = new Uint32Array(256)
    palette32(frame.palette, colors)
    const transparent = frame.transparentIndex
    const stride = output.width * 4
    // Columns of the output that the frame covers.
    const firstX = Math.max(output.x, frame.left)
    const lastX = Math.min(output.x + output.width, frame.left + frame.width)
    for (let outputY = 0; outputY < output.height; outputY += blockRows) {
      throwIfAborted(request.signal)
      const height = Math.min(blockRows, output.height - outputY)
      const data = new Uint8Array(stride * height)
      const data32 = new Uint32Array(data.buffer)
      for (let row = 0; row < height; row += 1) {
        const frameY = output.y + outputY + row - frame.top
        if (frameY < 0 || frameY >= frame.height || firstX >= lastX) continue
        let source = (rows[frameY] ?? 0) * frame.width + firstX - frame.left
        let target = row * output.width + firstX - output.x
        for (let x = firstX; x < lastX; x += 1, source += 1, target += 1) {
          const index = indices[source] ?? 0
          if (index !== transparent) data32[target] = colors[index] ?? 0
        }
      }
      yield { x: 0, y: outputY, width: output.width, height, stride, format: 'rgba8', data }
    }
  }
}

const readGif = async (source: ImageSource, limits: ImageLimits) => {
  const data = await readExactly(source, 0, source.size)
  return { data, structure: parseGif(data, limits) }
}

export const decodeGif = async (
  source: ImageSource,
  limits: ImageLimits,
  options: Readonly<DecoderOptions> = {},
): Promise<ImageDecoder> => {
  const { data, structure } = await readGif(source, limits)
  const frames = structure.frames.length
  if (options.frame === undefined && frames > 1) {
    throw unsupportedOperation(
      `Animated GIF has ${frames} frames; pass { animated: true } to open() for every frame or { frame: 0 } for one`,
    )
  }
  const frame = options.frame ?? 0
  if (frame >= frames) {
    throw invalidInput(`GIF frame ${frame} does not exist; the file has ${frames} frames`)
  }
  return new GifDecoder(data, structure, frame)
}

class GifAnimationDecoder implements ImageAnimationDecoder {
  readonly width: number
  readonly height: number
  readonly pixelFormat = 'rgba8' as const
  readonly frameCount: number
  readonly loop: number
  readonly #data: Uint8Array
  readonly #structure: GifStructure

  constructor(data: Uint8Array, structure: GifStructure) {
    this.width = structure.width
    this.height = structure.height
    this.frameCount = structure.frames.length
    this.loop = structure.loop
    this.#data = data
    this.#structure = structure
  }

  async *frames(signal?: AbortSignal): AsyncGenerator<ImageAnimationFrame> {
    const compositor = new GifCompositor(this.#data, this.#structure)
    const width = this.width
    const height = this.height
    for (let index = 0; index < this.frameCount; index += 1) {
      throwIfAborted(signal)
      const frame = compositor.drawNext()
      const canvas = compositor.canvas
      yield {
        index,
        durationMs: frame.delayCentiseconds * 10,
        decode: (request?: DecodeRequest) =>
          canvasBlocks(canvas, width, region(width, height, request), request?.signal ?? signal),
      }
    }
  }
}

export const decodeGifAnimation = async (
  source: ImageSource,
  limits: ImageLimits,
): Promise<ImageAnimationDecoder> => {
  const { data, structure } = await readGif(source, limits)
  return new GifAnimationDecoder(data, structure)
}
