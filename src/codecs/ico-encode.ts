import type { EncodeRequest, ImageEncoder } from '../codec.ts'
import { invalidInput, unsupportedOperation } from '../errors.ts'
import type { PixelBlock } from '../pixel.ts'
import { createResizeTransform } from '../resize.ts'
import { type ImageSink, Uint8ArraySink } from '../sink.ts'
import { createPngEncoder } from './png-encode.ts'
import { RgbaFrameStager } from './rgba-frame.ts'

export const defaultIcoSizes: readonly number[] = [16, 32, 48]

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

export const icoSizes = (options: unknown): readonly number[] => {
  if (!isRecord(options)) throw invalidInput('ICO encoder options must be an object')
  const sizes = options.sizes ?? defaultIcoSizes
  if (!Array.isArray(sizes) || sizes.length < 1 || sizes.length > 16) {
    throw invalidInput('ICO sizes must list 1 to 16 sizes')
  }
  const unique = new Set<number>()
  for (const size of sizes) {
    if (typeof size !== 'number' || !Number.isInteger(size) || size < 1 || size > 256) {
      throw invalidInput('ICO sizes must be integers from 1 to 256')
    }
    unique.add(size)
  }
  return [...unique].sort((a, b) => a - b)
}

async function* frameBlocks(
  frame: Uint8Array,
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
      data: frame.subarray(y * stride, (y + rows) * stride),
    }
  }
}

/** Fits the frame inside a transparent square with the library's Lanczos resize. */
const squareIcon = async (
  frame: Uint8Array,
  width: number,
  height: number,
  size: number,
): Promise<Uint8Array> => {
  if (width === size && height === size) return frame
  const resize = createResizeTransform(width, height, 'rgba8', {
    width: size,
    height: size,
    fit: 'contain',
    background: 'transparent',
  })
  if (resize.pixelFormat !== 'rgba8') throw unsupportedOperation('ICO resize must produce RGBA8')
  const output = new Uint8Array(size * size * 4)
  for await (const block of resize.apply(frameBlocks(frame, width, height))) {
    const rowBytes = block.width * 4
    for (let row = 0; row < block.height; row += 1) {
      const start = row * block.stride
      output.set(
        block.data.subarray(start, start + rowBytes),
        ((block.y + row) * size + block.x) * 4,
      )
    }
    block.release?.()
  }
  return output
}

/** A 32-bit BGRA DIB with an AND mask, stored bottom-up at twice its height as ICO requires. */
const iconBitmap = (pixels: Uint8Array, size: number): Uint8Array => {
  const maskRowBytes = Math.ceil(size / 32) * 4
  const pixelBytes = size * size * 4
  const output = new Uint8Array(40 + pixelBytes + maskRowBytes * size)
  const view = new DataView(output.buffer)
  view.setUint32(0, 40, true)
  view.setInt32(4, size, true)
  view.setInt32(8, size * 2, true)
  view.setUint16(12, 1, true)
  view.setUint16(14, 32, true)
  view.setUint32(20, pixelBytes + maskRowBytes * size, true)
  let target = 40
  const mask = 40 + pixelBytes
  for (let row = 0; row < size; row += 1) {
    let source = (size - 1 - row) * size * 4
    const maskRow = mask + row * maskRowBytes
    for (let x = 0; x < size; x += 1, source += 4, target += 4) {
      const alpha = pixels[source + 3] ?? 0
      output[target] = pixels[source + 2] ?? 0
      output[target + 1] = pixels[source + 1] ?? 0
      output[target + 2] = pixels[source] ?? 0
      output[target + 3] = alpha
      if (alpha === 0) {
        const at = maskRow + (x >>> 3)
        output[at] = (output[at] ?? 0) | (0x80 >>> (x & 7))
      }
    }
  }
  return output
}

const iconPng = async (pixels: Uint8Array, size: number, request: EncodeRequest) => {
  const sink = new Uint8ArraySink()
  const encoder = await createPngEncoder(sink, {
    width: size,
    height: size,
    pixelFormat: 'rgba8',
    options: {},
    ...(request.runtime === undefined ? {} : { runtime: request.runtime }),
  })
  for await (const block of frameBlocks(pixels, size, size)) await encoder.write(block)
  await encoder.finish()
  return sink.toUint8Array()
}

/** Multi-size ICO output. The input frame is held in memory and resized to each size. */
class IcoEncoder implements ImageEncoder {
  readonly #sink: ImageSink
  readonly #request: EncodeRequest
  readonly #sizes: readonly number[]
  readonly #stager: RgbaFrameStager
  readonly #frame: Uint8Array
  #finished = false

  constructor(sink: ImageSink, request: EncodeRequest, sizes: readonly number[]) {
    this.#sink = sink
    this.#request = request
    this.#sizes = sizes
    this.#stager = new RgbaFrameStager(request.width, request.height, request.pixelFormat)
    this.#frame = new Uint8Array(request.width * request.height * 4)
  }

  async write(block: PixelBlock): Promise<void> {
    if (this.#finished) throw new Error('Cannot write to a finished ICO encoder')
    this.#stager.write(block, this.#frame)
  }

  async finish(): Promise<void> {
    if (this.#finished) throw new Error('ICO encoder is already finished')
    this.#finished = true
    if (!this.#stager.complete) throw invalidInput('ICO encoder did not receive every row')
    const { width, height } = this.#request
    const images: Uint8Array[] = []
    for (const size of this.#sizes) {
      const pixels = await squareIcon(this.#frame, width, height, size)
      // PNG entries need Windows Vista or later; smaller sizes stay BMP for older readers.
      images.push(
        size === 256 ? await iconPng(pixels, size, this.#request) : iconBitmap(pixels, size),
      )
    }
    const header = new Uint8Array(6 + images.length * 16)
    const view = new DataView(header.buffer)
    view.setUint16(2, 1, true)
    view.setUint16(4, images.length, true)
    let offset = header.byteLength
    for (const [index, image] of images.entries()) {
      const size = this.#sizes[index] ?? 0
      const entry = 6 + index * 16
      header[entry] = size === 256 ? 0 : size
      header[entry + 1] = size === 256 ? 0 : size
      view.setUint16(entry + 4, 1, true)
      view.setUint16(entry + 6, 32, true)
      view.setUint32(entry + 8, image.byteLength, true)
      view.setUint32(entry + 12, offset, true)
      offset += image.byteLength
    }
    await this.#sink.write(header)
    for (const image of images) await this.#sink.write(image)
  }

  async abort(): Promise<void> {
    this.#finished = true
  }
}

export const createIcoEncoder = async (
  sink: ImageSink,
  request: EncodeRequest,
): Promise<ImageEncoder> => new IcoEncoder(sink, request, icoSizes(request.options))
