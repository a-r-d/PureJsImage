import { throwIfAborted } from '../../src/abort.ts'
import type { ImageSource, ImageSourceReadOptions } from '../../src/source.ts'

export interface TrackedRead {
  readonly offset: number
  readonly length: number
}

export class TrackingSource implements ImageSource {
  readonly size: number
  readonly reads: TrackedRead[] = []
  readonly #bytes: Uint8Array

  constructor(bytes: Uint8Array) {
    this.#bytes = bytes
    this.size = bytes.byteLength
  }

  async read(
    offset: number,
    length: number,
    options: Readonly<ImageSourceReadOptions> = {},
  ): Promise<Uint8Array> {
    throwIfAborted(options.signal)
    this.reads.push(Object.freeze({ offset, length }))
    const available = offset >= this.size ? 0 : Math.min(length, this.size - offset)
    return this.#bytes.slice(offset, offset + available)
  }
}

export const rangesOverlap = (start: number, end: number, reads: readonly TrackedRead[]): boolean =>
  reads.some((read) => {
    const readEnd = read.offset + read.length
    return read.offset < end && readEnd > start
  })
