import type { TemporaryStore } from './runtime.ts'

export const memoryTemporaryStoreLimit = 64 * 1024 * 1024

const memoryChunkBytes = 1024 * 1024

export class MemoryTemporaryStore implements TemporaryStore {
  readonly #expectedBytes: number
  readonly #chunks = new Map<number, Uint8Array>()
  #closed = false

  constructor(expectedBytes: number) {
    this.#expectedBytes = expectedBytes
  }

  async read(position: number, target: Uint8Array): Promise<void> {
    if (this.#closed) throw new Error('Temporary store is closed')
    if (position < 0 || position + target.byteLength > this.#expectedBytes) {
      throw new Error('Temporary read exceeds its bounded store')
    }
    let copied = 0
    while (copied < target.byteLength) {
      const absolute = position + copied
      const chunkIndex = Math.floor(absolute / memoryChunkBytes)
      const chunkOffset = absolute % memoryChunkBytes
      const amount = Math.min(target.byteLength - copied, memoryChunkBytes - chunkOffset)
      const chunk = this.#chunks.get(chunkIndex)
      if (!chunk) throw new Error('Temporary data is truncated')
      target.set(chunk.subarray(chunkOffset, chunkOffset + amount), copied)
      copied += amount
    }
  }

  async write(position: number, data: Uint8Array): Promise<void> {
    if (this.#closed) throw new Error('Temporary store is closed')
    if (position < 0 || position + data.byteLength > this.#expectedBytes) {
      throw new Error('Temporary write exceeds its bounded store')
    }
    let copied = 0
    while (copied < data.byteLength) {
      const absolute = position + copied
      const chunkIndex = Math.floor(absolute / memoryChunkBytes)
      const chunkOffset = absolute % memoryChunkBytes
      const amount = Math.min(data.byteLength - copied, memoryChunkBytes - chunkOffset)
      let chunk = this.#chunks.get(chunkIndex)
      if (!chunk) {
        chunk = new Uint8Array(
          Math.min(memoryChunkBytes, this.#expectedBytes - chunkIndex * memoryChunkBytes),
        )
        this.#chunks.set(chunkIndex, chunk)
      }
      chunk.set(data.subarray(copied, copied + amount), chunkOffset)
      copied += amount
    }
  }

  async close(): Promise<void> {
    this.#closed = true
    this.#chunks.clear()
  }
}
