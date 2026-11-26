import { throwIfAborted } from '../abort.ts'
import type { DecodeRequest } from '../codec.ts'
import { invalidInput, unsupportedOperation } from '../errors.ts'
import type { PixelBlock, PixelFormat } from '../pixel.ts'

const channelsFor = (format: PixelFormat): number => {
  if (format === 'rgba8') return 4
  if (format === 'rgb8') return 3
  if (format === 'gray8') return 1
  throw unsupportedOperation(`Encoding does not support ${format} pixels`)
}

/** Copies ordered 8-bit gray, RGB or RGBA blocks into a full RGBA8 frame. */
export class RgbaFrameStager {
  readonly #width: number
  readonly #height: number
  readonly #format: PixelFormat
  readonly #channels: number
  #expectedY = 0

  constructor(width: number, height: number, format: PixelFormat) {
    this.#width = width
    this.#height = height
    this.#format = format
    this.#channels = channelsFor(format)
  }

  get complete(): boolean {
    return this.#expectedY === this.#height
  }

  write(block: PixelBlock, target: Uint8Array): void {
    const width = this.#width
    const channels = this.#channels
    if (
      block.x !== 0 ||
      block.y !== this.#expectedY ||
      block.width !== width ||
      block.height < 1 ||
      block.y + block.height > this.#height ||
      block.format !== this.#format
    ) {
      throw invalidInput('Encoder requires ordered, full-width pixel blocks')
    }
    const rowBytes = width * channels
    if (
      block.stride < rowBytes ||
      block.data.byteLength < block.stride * (block.height - 1) + rowBytes
    ) {
      throw invalidInput('Encoder pixel block data is truncated')
    }
    const data = block.data
    for (let row = 0; row < block.height; row += 1) {
      let source = row * block.stride
      let output = (block.y + row) * width * 4
      if (channels === 4) {
        target.set(data.subarray(source, source + rowBytes), output)
      } else if (channels === 3) {
        for (let x = 0; x < width; x += 1, source += 3, output += 4) {
          target[output] = data[source] ?? 0
          target[output + 1] = data[source + 1] ?? 0
          target[output + 2] = data[source + 2] ?? 0
          target[output + 3] = 255
        }
      } else {
        for (let x = 0; x < width; x += 1, source += 1, output += 4) {
          const value = data[source] ?? 0
          target[output] = value
          target[output + 1] = value
          target[output + 2] = value
          target[output + 3] = 255
        }
      }
    }
    this.#expectedY += block.height
  }

  reset(): void {
    this.#expectedY = 0
  }
}

export interface CanvasRegion {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

/** Validates a decode request against a canvas and fills in the default full region. */
export const canvasRegion = (
  width: number,
  height: number,
  request: DecodeRequest = {},
  format: string,
): CanvasRegion => {
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
    throw invalidInput(
      `${format} decode region ${x},${y} ${outputWidth}x${outputHeight} is invalid`,
    )
  }
  return { x, y, width: outputWidth, height: outputHeight }
}

const canvasBlockRows = 32

/** Emits a region of an RGBA8 canvas as blocks that copy the canvas rows. */
export async function* canvasBlocks(
  canvas: Uint8Array,
  canvasWidth: number,
  output: CanvasRegion,
  signal: AbortSignal | undefined,
): AsyncGenerator<PixelBlock> {
  const stride = output.width * 4
  for (let outputY = 0; outputY < output.height; outputY += canvasBlockRows) {
    throwIfAborted(signal)
    const height = Math.min(canvasBlockRows, output.height - outputY)
    const data = new Uint8Array(stride * height)
    for (let row = 0; row < height; row += 1) {
      const start = ((output.y + outputY + row) * canvasWidth + output.x) * 4
      data.set(canvas.subarray(start, start + stride), row * stride)
    }
    yield { x: 0, y: outputY, width: output.width, height, stride, format: 'rgba8', data }
  }
}
