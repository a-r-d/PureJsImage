import type { ImageSource } from '../source.ts'
import { truncatedInput } from '../errors.ts'

const defaultChunkBytes = 65_536

export class SourceCursor {
  readonly #source: ImageSource
  readonly #signal: AbortSignal | undefined
  readonly #chunkBytes: number
  #buffer: Uint8Array<ArrayBufferLike> = new Uint8Array()
  #bufferOffset = 0
  #offset: number

  constructor(
    source: ImageSource,
    offset = 0,
    options: { readonly signal?: AbortSignal; readonly chunkBytes?: number } = {},
  ) {
    this.#source = source
    this.#offset = offset
    this.#signal = options.signal
    this.#chunkBytes = options.chunkBytes ?? defaultChunkBytes
  }

  get offset(): number {
    return this.#offset
  }

  get remaining(): number {
    return this.#source.size - this.#offset
  }

  seek(offset: number): void {
    this.#offset = offset
    if (offset < this.#bufferOffset || offset >= this.#bufferOffset + this.#buffer.byteLength) {
      this.#buffer = new Uint8Array()
      this.#bufferOffset = offset
    }
  }

  async byte(message: string): Promise<number> {
    if (this.#offset >= this.#source.size) throw truncatedInput(message)
    if (
      this.#offset < this.#bufferOffset ||
      this.#offset >= this.#bufferOffset + this.#buffer.byteLength
    ) {
      this.#bufferOffset = this.#offset
      this.#buffer = await this.#source.read(
        this.#offset,
        Math.min(this.#chunkBytes, this.#source.size - this.#offset),
        this.#signal === undefined ? {} : { signal: this.#signal },
      )
    }
    const value = this.#buffer[this.#offset - this.#bufferOffset]
    if (value === undefined) throw truncatedInput(message)
    this.#offset += 1
    return value
  }

  async skip(length: number, message: string): Promise<void> {
    if (!Number.isSafeInteger(length) || length < 0 || this.#offset + length > this.#source.size) {
      throw truncatedInput(message)
    }
    this.#offset += length
  }
}
