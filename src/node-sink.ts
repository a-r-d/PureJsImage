import type { ImageSink } from './sink.ts'
import { Uint8ArraySink } from './sink.ts'

export class BufferSink implements ImageSink {
  readonly #sink = new Uint8ArraySink()

  async write(chunk: Uint8Array): Promise<void> {
    await this.#sink.write(chunk)
  }

  async close(): Promise<void> {
    await this.#sink.close()
  }

  async abort(reason: unknown): Promise<void> {
    await this.#sink.abort(reason)
  }

  toBuffer(): Buffer {
    const data = this.#sink.toUint8Array()
    return Buffer.from(data.buffer, data.byteOffset, data.byteLength)
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
