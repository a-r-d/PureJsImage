import { invalidInput } from './errors.ts'

export type PixelFormat = 'gray8' | 'rgb8' | 'rgba8' | 'rgb16' | 'rgba16' | 'yuv420p8' | 'yuv420p10'

export interface PixelBlock {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
  readonly stride: number
  readonly format: PixelFormat
  readonly data: Uint8Array
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
