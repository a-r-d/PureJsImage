export interface ImageSink {
  write(chunk: Uint8Array): Promise<void>
  close(): Promise<void>
  abort(reason: unknown): Promise<void>
}

export class BufferSink implements ImageSink {
  readonly #chunks: Uint8Array[] = []
  #closed = false

  async write(chunk: Uint8Array): Promise<void> {
    if (this.#closed) throw new Error('Cannot write to a closed sink')
    this.#chunks.push(chunk.slice())
  }

  async close(): Promise<void> {
    this.#closed = true
  }

  async abort(): Promise<void> {
    this.#chunks.length = 0
    this.#closed = true
  }

  toBuffer(): Buffer {
    return Buffer.concat(this.#chunks)
  }
}

export class FileSink implements ImageSink {
  readonly #path: string
  #handle: import('node:fs/promises').FileHandle | undefined

  constructor(path: string) {
    this.#path = path
  }

  async write(chunk: Uint8Array): Promise<void> {
    if (!this.#handle) {
      const { open } = await import('node:fs/promises')
      this.#handle = await open(this.#path, 'w')
    }
    let offset = 0
    while (offset < chunk.byteLength) {
      const { bytesWritten } = await this.#handle.write(chunk, offset, chunk.byteLength - offset)
      if (bytesWritten === 0) throw new Error('File sink could not make write progress')
      offset += bytesWritten
    }
  }

  async close(): Promise<void> {
    await this.#handle?.close()
    this.#handle = undefined
  }

  async abort(): Promise<void> {
    await this.close()
    const { rm } = await import('node:fs/promises')
    await rm(this.#path, { force: true })
  }
}
