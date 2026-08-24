import { once } from 'node:events'
import { type FileHandle, mkdtemp, open, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { constants, createDeflate, type Deflate, deflateSync, type ZlibOptions } from 'node:zlib'

import { invalidInput } from './errors.ts'
import { MemoryTemporaryStore } from './memory-temporary-store.ts'
import type { NodeImageLibraryOptions } from './node-options.ts'
import type {
  DeflateEncoder,
  DeflateOptions,
  ImageRuntime,
  TemporaryStore,
  TemporaryStoreOptions,
} from './runtime.ts'

interface NodeTemporaryFile {
  close(): Promise<void>
  read(
    buffer: Uint8Array,
    offset: number,
    length: number,
    position: number,
  ): Promise<{ readonly bytesRead: number }>
  truncate(length: number): Promise<void>
  write(
    buffer: Uint8Array,
    offset: number,
    length: number,
    position: number,
  ): Promise<{ readonly bytesWritten: number }>
}

export class NodeTemporaryStore implements TemporaryStore {
  readonly #directory: string
  readonly #expectedBytes: number
  #file: NodeTemporaryFile | undefined
  #memory: MemoryTemporaryStore | undefined
  #maximumWrittenEnd = 0
  #closed = false

  constructor(directory: string, file: NodeTemporaryFile, expectedBytes: number) {
    this.#directory = directory
    this.#file = file
    this.#expectedBytes = expectedBytes
  }

  async #readFile(position: number, target: Uint8Array): Promise<void> {
    const file = this.#file
    if (!file) throw new Error('Temporary file is unavailable')
    let offset = 0
    while (offset < target.byteLength) {
      const { bytesRead } = await file.read(
        target,
        offset,
        target.byteLength - offset,
        position + offset,
      )
      if (bytesRead < 1) throw new Error('Temporary data is truncated')
      offset += bytesRead
    }
  }

  async #writeFile(position: number, data: Uint8Array): Promise<void> {
    const file = this.#file
    if (!file) throw new Error('Temporary file is unavailable')
    let offset = 0
    while (offset < data.byteLength) {
      const { bytesWritten } = await file.write(
        data,
        offset,
        data.byteLength - offset,
        position + offset,
      )
      if (bytesWritten < 1) throw new Error('Temporary write made no progress')
      offset += bytesWritten
    }
  }

  async #removeFile(): Promise<void> {
    const file = this.#file
    let cleanupError: unknown
    try {
      await file?.close()
      this.#file = undefined
    } catch (error) {
      cleanupError = error
    }
    try {
      await rm(this.#directory, { recursive: true, force: true })
    } catch (error) {
      cleanupError ??= error
    }
    if (cleanupError !== undefined) throw cleanupError
  }

  async #switchToMemory(): Promise<MemoryTemporaryStore> {
    if (this.#memory) return this.#memory
    const memory = new MemoryTemporaryStore(this.#expectedBytes)
    const scratch = new Uint8Array(Math.min(1024 * 1024, this.#maximumWrittenEnd))
    for (let position = 0; position < this.#maximumWrittenEnd; position += scratch.byteLength) {
      const amount = Math.min(scratch.byteLength, this.#maximumWrittenEnd - position)
      const target = scratch.subarray(0, amount)
      await this.#readFile(position, target)
      await memory.write(position, target)
    }
    this.#memory = memory
    try {
      await this.#removeFile()
    } catch {
      // Retry cleanup when the store closes. The recovered bytes are already in memory.
    }
    return memory
  }

  async read(position: number, target: Uint8Array): Promise<void> {
    if (this.#closed) throw new Error('Temporary store is closed')
    if (this.#memory) {
      await this.#memory.read(position, target)
      return
    }
    try {
      await this.#readFile(position, target)
    } catch (fileError) {
      try {
        const memory = await this.#switchToMemory()
        await memory.read(position, target)
      } catch {
        throw fileError
      }
    }
  }

  async write(position: number, data: Uint8Array): Promise<void> {
    if (this.#closed) throw new Error('Temporary store is closed')
    if (this.#memory) {
      await this.#memory.write(position, data)
      return
    }
    try {
      await this.#writeFile(position, data)
      this.#maximumWrittenEnd = Math.max(this.#maximumWrittenEnd, position + data.byteLength)
    } catch (fileError) {
      try {
        const memory = await this.#switchToMemory()
        await memory.write(position, data)
        this.#maximumWrittenEnd = Math.max(this.#maximumWrittenEnd, position + data.byteLength)
      } catch {
        throw fileError
      }
    }
  }

  async close(): Promise<void> {
    if (this.#closed) return
    let closeError: unknown
    try {
      await this.#memory?.close()
    } catch (error) {
      closeError = error
    }
    try {
      await this.#removeFile()
    } catch (error) {
      closeError ??= error
    }
    if (closeError !== undefined) throw closeError
    this.#closed = true
  }
}

export type NodeRuntimeOptions = NodeImageLibraryOptions

const createFileTemporaryStore = async (
  options: TemporaryStoreOptions,
): Promise<TemporaryStore> => {
  const directory = await mkdtemp(join(tmpdir(), options.prefix))
  let file: FileHandle | undefined
  try {
    file = await open(join(directory, 'tiles'), 'w+')
    const probe = Uint8Array.of(0xa5)
    const { bytesWritten } = await file.write(probe, 0, probe.byteLength, 0)
    if (bytesWritten !== probe.byteLength)
      throw new Error('Temporary file probe write was incomplete')
    const result = new Uint8Array(probe.byteLength)
    const { bytesRead } = await file.read(result, 0, result.byteLength, 0)
    if (bytesRead !== result.byteLength || result[0] !== probe[0]) {
      throw new Error('Temporary file probe read did not match its write')
    }
    await file.truncate(0)
    return new NodeTemporaryStore(directory, file, options.expectedBytes)
  } catch (error) {
    try {
      await file?.close()
    } catch {
      // Preserve the capability-probe error.
    }
    await rm(directory, { recursive: true, force: true })
    throw error
  }
}

const createTemporaryStoreFactory = (
  runtimeOptions: Readonly<NodeRuntimeOptions>,
): ImageRuntime['createTemporaryStore'] => {
  if (
    runtimeOptions.temporaryFiles !== undefined &&
    typeof runtimeOptions.temporaryFiles !== 'boolean'
  ) {
    throw invalidInput('temporaryFiles must be a boolean')
  }
  const temporaryFiles = runtimeOptions.temporaryFiles ?? false
  return async (options: TemporaryStoreOptions): Promise<TemporaryStore> => {
    if (temporaryFiles) {
      try {
        return await createFileTemporaryStore(options)
      } catch {
        // File storage is an optional optimization. Preserve portable memory behavior.
      }
    }
    return new MemoryTemporaryStore(options.expectedBytes)
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

export const createNodeRuntime = (options: Readonly<NodeRuntimeOptions> = {}): ImageRuntime =>
  Object.freeze({
    createTemporaryStore: createTemporaryStoreFactory(options),
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

export const nodeRuntime: ImageRuntime = createNodeRuntime()
