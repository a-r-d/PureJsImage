export interface ImageSink {
  write(chunk: Uint8Array): Promise<void>
  close(): Promise<void>
  abort(reason: unknown): Promise<void>
}

export class Uint8ArraySink implements ImageSink {
  readonly #chunks: Uint8Array[] = []
  #closed = false

  async write(chunk: Uint8Array): Promise<void> {
    if (this.#closed) throw new Error('Cannot write to a closed sink')
    this.#chunks.push(chunk.slice())
  }

  async close(): Promise<void> {
    this.#closed = true
  }

  async abort(_reason: unknown): Promise<void> {
    this.#chunks.length = 0
    this.#closed = true
  }

  toUint8Array(): Uint8Array {
    let length = 0
    for (const chunk of this.#chunks) length += chunk.byteLength
    const output = new Uint8Array(length)
    let offset = 0
    for (const chunk of this.#chunks) {
      output.set(chunk, offset)
      offset += chunk.byteLength
    }
    return output
  }
}
