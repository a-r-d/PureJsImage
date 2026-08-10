import { invalidInput } from './errors.ts'

export type PixelFormat =
  | 'gray8'
  | 'gray16'
  | 'rgb8'
  | 'rgba8'
  | 'rgb16'
  | 'rgba16'
  | 'yuv420p8'
  | 'yuv420p10'

export interface PixelBlock {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
  readonly stride: number
  readonly format: PixelFormat
  readonly data: Uint8Array
  readonly release?: () => void
}
export const resumePixelBlocks = async function* (
  blocks: AsyncIterable<PixelBlock>,
  firstOutputRow: number,
): AsyncGenerator<PixelBlock> {
  for await (const block of blocks) {
    const blockEnd = block.y + block.height
    if (blockEnd <= firstOutputRow) {
      block.release?.()
      continue
    }
    if (block.y < firstOutputRow) {
      const skippedRows = firstOutputRow - block.y
      yield {
        ...block,
        y: firstOutputRow,
        height: block.height - skippedRows,
        data: block.data.subarray(skippedRows * block.stride),
      }
      continue
    }
    yield block
  }
}
export const normalizedPixelFormat = (format: PixelFormat): PixelFormat => {
  if (format === 'gray16') return 'gray8'
  if (format === 'rgb16') return 'rgb8'
  if (format === 'rgba16') return 'rgba8'
  return format
}

export const normalizePixelBlocks = async function* (
  blocks: AsyncIterable<PixelBlock>,
  format: PixelFormat,
): AsyncGenerator<PixelBlock> {
  const normalized = normalizedPixelFormat(format)
  if (normalized === format) {
    yield* blocks
    return
  }
  const channels = format === 'gray16' ? 1 : format === 'rgb16' ? 3 : 4
  for await (const block of blocks) {
    const sourceRowBytes = block.width * channels * 2
    if (
      block.format !== format ||
      block.height < 1 ||
      block.stride < sourceRowBytes ||
      block.data.byteLength < block.stride * (block.height - 1) + sourceRowBytes
    ) {
      block.release?.()
      throw invalidInput('16-bit normalization received an invalid pixel block')
    }
    const outputStride = block.width * channels
    const output = new Uint8Array(outputStride * block.height)
    for (let row = 0; row < block.height; row += 1) {
      let source = row * block.stride
      let target = row * outputStride
      const end = source + sourceRowBytes
      while (source < end) {
        const value = ((block.data[source] ?? 0) << 8) | (block.data[source + 1] ?? 0)
        output[target] = Math.round((value * 255) / 65_535)
        source += 2
        target += 1
      }
    }
    block.release?.()
    yield {
      x: block.x,
      y: block.y,
      width: block.width,
      height: block.height,
      stride: outputStride,
      format: normalized,
      data: output,
    }
  }
}

const defaultSizeClasses = [65_536, 262_144, 1_048_576, 4_194_304] as const

export class BufferPool {
  readonly #classes: readonly number[]
  readonly #buffers = new Map<number, Uint8Array[]>()
  readonly #maxPerClass: number

  constructor(options: { sizeClasses?: readonly number[]; maxPerClass?: number } = {}) {
    this.#classes = [...(options.sizeClasses ?? defaultSizeClasses)].sort(
      (left, right) => left - right,
    )
    this.#maxPerClass = options.maxPerClass ?? 2
    if (this.#classes.some((size) => !Number.isSafeInteger(size) || size < 1)) {
      throw invalidInput('Buffer pool size classes must be positive safe integers')
    }
    if (!Number.isSafeInteger(this.#maxPerClass) || this.#maxPerClass < 0) {
      throw invalidInput('maxPerClass must be a non-negative safe integer')
    }
  }

  acquire(minimumBytes: number): Uint8Array {
    if (!Number.isSafeInteger(minimumBytes) || minimumBytes < 0) {
      throw invalidInput('Buffer size must be a non-negative safe integer')
    }
    const size = this.#classes.find((candidate) => candidate >= minimumBytes) ?? minimumBytes
    return this.#buffers.get(size)?.pop() ?? new Uint8Array(size)
  }

  release(buffer: Uint8Array): void {
    if (!this.#classes.includes(buffer.byteLength)) return
    const buffers = this.#buffers.get(buffer.byteLength) ?? []
    if (buffers.length >= this.#maxPerClass) return
    buffers.push(buffer)
    this.#buffers.set(buffer.byteLength, buffers)
  }

  clear(): void {
    this.#buffers.clear()
  }
}
