import { once } from 'node:events'
import { mkdtemp, open, rm, type FileHandle } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { constants, createDeflate, deflateSync, type Deflate, type ZlibOptions } from 'node:zlib'

import { invalidInput } from './errors.ts'
import type {
  DeflateEncoder,
  DeflateOptions,
  ImageRuntime,
  TemporaryStore,
  TemporaryStoreOptions,
} from './runtime.ts'

class NodeTemporaryStore implements TemporaryStore {
  readonly #directory: string
  readonly #file: FileHandle
  #closed = false

  constructor(directory: string, file: FileHandle) {
    this.#directory = directory
    this.#file = file
  }

  async read(position: number, target: Uint8Array): Promise<void> {
    let offset = 0
    while (offset < target.byteLength) {
      const { bytesRead } = await this.#file.read(
        target,
        offset,
        target.byteLength - offset,
        position + offset,
      )
      if (bytesRead < 1) throw new Error('Temporary data is truncated')
      offset += bytesRead
    }
  }

  async write(position: number, data: Uint8Array): Promise<void> {
    let offset = 0
    while (offset < data.byteLength) {
      const { bytesWritten } = await this.#file.write(
        data,
        offset,
        data.byteLength - offset,
        position + offset,
      )
      if (bytesWritten < 1) throw new Error('Temporary write made no progress')
      offset += bytesWritten
    }
  }

  async close(): Promise<void> {
    if (this.#closed) return
    this.#closed = true
    let closeError: unknown
    try {
      await this.#file.close()
    } catch (error) {
      closeError = error
    }
    try {
      await rm(this.#directory, { recursive: true, force: true })
    } catch (error) {
      closeError ??= error
    }
    if (closeError !== undefined) throw closeError
  }
}

const createTemporaryStore = async (options: TemporaryStoreOptions): Promise<TemporaryStore> => {
  const directory = await mkdtemp(join(tmpdir(), options.prefix))
  try {
    const file = await open(join(directory, 'tiles'), 'w+')
    return new NodeTemporaryStore(directory, file)
  } catch (error) {
    await rm(directory, { recursive: true, force: true })
    throw error
  }
}

const zlibOptions = (options: DeflateOptions): ZlibOptions => ({
  level: options.level,
  strategy: options.strategy === 'rle' ? constants.Z_RLE : constants.Z_DEFAULT_STRATEGY,
})

class NodeDeflateEncoder implements DeflateEncoder {
  readonly #deflater: Deflate
  readonly #completion: Promise<void>
  #finished = false

  constructor(options: DeflateOptions, onData: (chunk: Uint8Array) => Promise<void>) {
    const deflater = createDeflate(zlibOptions(options))
    this.#deflater = deflater
    this.#completion = new Promise((resolve, reject) => {
      let writes = Promise.resolve()
      deflater.on('data', (chunk: unknown) => {
        deflater.pause()
        if (!(chunk instanceof Uint8Array)) {
          reject(invalidInput('Deflate compressor returned invalid data'))
          return
        }
        writes = writes.then(() => onData(chunk))
        writes.then(
          () => deflater.resume(),
          (error: unknown) => {
            reject(error)
            deflater.destroy(error instanceof Error ? error : new Error('Deflate output failed'))
          },
        )
      })
      deflater.once('error', (error: unknown) => reject(error))
      deflater.once('end', () => writes.then(resolve, reject))
    })
  }

  async write(data: Uint8Array): Promise<void> {
    if (this.#finished) throw new Error('Deflate encoder is already finished')
    if (!this.#deflater.write(data)) await once(this.#deflater, 'drain')
  }

  async finish(): Promise<void> {
    if (this.#finished) throw new Error('Deflate encoder is already finished')
    this.#finished = true
    this.#deflater.end()
    await this.#completion
  }

  async abort(reason: unknown): Promise<void> {
    this.#finished = true
    if (!this.#deflater.destroyed) {
      this.#deflater.destroy(reason instanceof Error ? reason : new Error('Deflate aborted'))
    }
    try {
      await this.#completion
    } catch {
      // The pipeline reports the original operation failure.
    }
  }
}

export const nodeRuntime: ImageRuntime = Object.freeze({
  createTemporaryStore,
  createDeflateEncoder(
    options: DeflateOptions,
    onData: (chunk: Uint8Array) => Promise<void>,
  ): DeflateEncoder {
    return new NodeDeflateEncoder(options, onData)
  },
  async deflate(data: Uint8Array, options: DeflateOptions): Promise<Uint8Array> {
    return Uint8Array.from(deflateSync(data, zlibOptions(options)))
  },
})
