import { unsupportedOperation } from './errors.ts'
import type {
  DeflateEncoder,
  DeflateOptions,
  ImageRuntime,
  TemporaryStore,
  TemporaryStoreOptions,
} from './runtime.ts'

const memoryTemporaryStoreLimit = 64 * 1024 * 1024
const memoryChunkBytes = 1024 * 1024
const indexedDbChunkBytes = 4 * 1024
const indexedDbStoreName = 'chunks'
let temporaryStoreSequence = 0

const temporaryStoreName = (prefix: string): string => {
  temporaryStoreSequence += 1
  return `${prefix}${Date.now().toString(36)}-${temporaryStoreSequence.toString(36)}`
}

class MemoryTemporaryStore implements TemporaryStore {
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

class OpfsTemporaryStore implements TemporaryStore {
  readonly #directory: FileSystemDirectoryHandle
  readonly #name: string
  readonly #handle: FileSystemFileHandle
  #writer: FileSystemWritableFileStream | undefined
  #file: File | undefined
  #closed = false

  constructor(directory: FileSystemDirectoryHandle, name: string, handle: FileSystemFileHandle) {
    this.#directory = directory
    this.#name = name
    this.#handle = handle
  }

  async #seal(): Promise<File> {
    if (this.#writer) {
      await this.#writer.close()
      this.#writer = undefined
    }
    this.#file ??= await this.#handle.getFile()
    return this.#file
  }

  async read(position: number, target: Uint8Array): Promise<void> {
    if (this.#closed) throw new Error('Temporary store is closed')
    const file = await this.#seal()
    const data = new Uint8Array(
      await file.slice(position, position + target.byteLength).arrayBuffer(),
    )
    if (data.byteLength !== target.byteLength) throw new Error('Temporary data is truncated')
    target.set(data)
  }

  async write(position: number, data: Uint8Array): Promise<void> {
    if (this.#closed) throw new Error('Temporary store is closed')
    if (this.#file) throw new Error('Cannot write temporary data after reading it')
    this.#writer ??= await this.#handle.createWritable({ keepExistingData: true })
    await this.#writer.seek(position)
    await this.#writer.write(Uint8Array.from(data))
  }

  async close(): Promise<void> {
    if (this.#closed) return
    this.#closed = true
    let closeError: unknown
    try {
      await this.#writer?.close()
    } catch (error) {
      closeError = error
    }
    this.#writer = undefined
    this.#file = undefined
    try {
      await this.#directory.removeEntry(this.#name)
    } catch (error) {
      closeError ??= error
    }
    if (closeError !== undefined) throw closeError
  }
}

const requestResult = <Result>(request: IDBRequest<Result>): Promise<Result> =>
  new Promise((resolve, reject) => {
    request.addEventListener('success', () => resolve(request.result), { once: true })
    request.addEventListener('error', () => reject(request.error), { once: true })
  })

const transactionCompletion = (transaction: IDBTransaction): Promise<void> =>
  new Promise((resolve, reject) => {
    transaction.addEventListener('complete', () => resolve(), { once: true })
    transaction.addEventListener(
      'error',
      () => reject(transaction.error ?? new Error('IndexedDB transaction failed')),
      { once: true },
    )
    transaction.addEventListener(
      'abort',
      () => reject(transaction.error ?? new Error('IndexedDB transaction was aborted')),
      { once: true },
    )
  })

class IndexedDbTemporaryStore implements TemporaryStore {
  readonly #database: IDBDatabase
  readonly #databaseName: string
  readonly #expectedBytes: number
  #closed = false

  constructor(database: IDBDatabase, databaseName: string, expectedBytes: number) {
    this.#database = database
    this.#databaseName = databaseName
    this.#expectedBytes = expectedBytes
  }

  async read(position: number, target: Uint8Array): Promise<void> {
    if (this.#closed) throw new Error('Temporary store is closed')
    if (position < 0 || position + target.byteLength > this.#expectedBytes) {
      throw new Error('Temporary read exceeds its bounded store')
    }
    const transaction = this.#database.transaction(indexedDbStoreName, 'readonly')
    const completion = transactionCompletion(transaction)
    const store = transaction.objectStore(indexedDbStoreName)
    let copied = 0
    while (copied < target.byteLength) {
      const absolute = position + copied
      const chunkIndex = Math.floor(absolute / indexedDbChunkBytes)
      const chunkOffset = absolute % indexedDbChunkBytes
      const amount = Math.min(target.byteLength - copied, indexedDbChunkBytes - chunkOffset)
      const result: unknown = await requestResult(store.get(chunkIndex))
      if (!(result instanceof Uint8Array) || chunkOffset + amount > result.byteLength) {
        throw new Error('Temporary data is truncated')
      }
      target.set(result.subarray(chunkOffset, chunkOffset + amount), copied)
      copied += amount
    }
    await completion
  }

  async write(position: number, data: Uint8Array): Promise<void> {
    if (this.#closed) throw new Error('Temporary store is closed')
    if (position < 0 || position + data.byteLength > this.#expectedBytes) {
      throw new Error('Temporary write exceeds its bounded store')
    }
    const transaction = this.#database.transaction(indexedDbStoreName, 'readwrite')
    const completion = transactionCompletion(transaction)
    const store = transaction.objectStore(indexedDbStoreName)
    let copied = 0
    while (copied < data.byteLength) {
      const absolute = position + copied
      const chunkIndex = Math.floor(absolute / indexedDbChunkBytes)
      const chunkOffset = absolute % indexedDbChunkBytes
      const amount = Math.min(data.byteLength - copied, indexedDbChunkBytes - chunkOffset)
      const chunkBytes = Math.min(
        indexedDbChunkBytes,
        this.#expectedBytes - chunkIndex * indexedDbChunkBytes,
      )
      let chunk: Uint8Array
      if (chunkOffset === 0 && amount === chunkBytes) {
        chunk = data.slice(copied, copied + amount)
      } else {
        const result: unknown = await requestResult(store.get(chunkIndex))
        if (result !== undefined && !(result instanceof Uint8Array)) {
          throw new Error('Temporary data has an invalid type')
        }
        chunk = result instanceof Uint8Array ? result : new Uint8Array(chunkBytes)
        chunk.set(data.subarray(copied, copied + amount), chunkOffset)
      }
      await requestResult(store.put(chunk, chunkIndex))
      copied += amount
    }
    await completion
  }

  async close(): Promise<void> {
    if (this.#closed) return
    this.#closed = true
    this.#database.close()
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase(this.#databaseName)
      request.addEventListener('success', () => resolve(), { once: true })
      request.addEventListener('error', () => reject(request.error), { once: true })
      request.addEventListener(
        'blocked',
        () => reject(new Error('IndexedDB cleanup was blocked')),
        {
          once: true,
        },
      )
    })
  }
}

const createOpfsTemporaryStore = async (
  options: TemporaryStoreOptions,
): Promise<TemporaryStore | undefined> => {
  if (typeof navigator === 'undefined') {
    return undefined
  }
  const storage: StorageManager | undefined = navigator.storage
  if (!storage || typeof storage.getDirectory !== 'function') return undefined
  try {
    const directory = await storage.getDirectory()
    const name = temporaryStoreName(options.prefix)
    const handle = await directory.getFileHandle(name, { create: true })
    return new OpfsTemporaryStore(directory, name, handle)
  } catch {
    return undefined
  }
}

const createIndexedDbTemporaryStore = async (
  options: TemporaryStoreOptions,
): Promise<TemporaryStore | undefined> => {
  if (typeof indexedDB === 'undefined') return undefined
  const name = temporaryStoreName(options.prefix)
  try {
    const request = indexedDB.open(name, 1)
    request.addEventListener(
      'upgradeneeded',
      () => {
        request.result.createObjectStore(indexedDbStoreName)
      },
      { once: true },
    )
    const database = await requestResult(request)
    return new IndexedDbTemporaryStore(database, name, options.expectedBytes)
  } catch {
    try {
      indexedDB.deleteDatabase(name)
    } catch {
      // Nothing was created, or the browser has already discarded it.
    }
    return undefined
  }
}

const createTemporaryStore = async (options: TemporaryStoreOptions): Promise<TemporaryStore> => {
  const opfs = await createOpfsTemporaryStore(options)
  if (opfs) return opfs
  if (options.expectedBytes <= memoryTemporaryStoreLimit) {
    return new MemoryTemporaryStore(options.expectedBytes)
  }
  const indexedDb = await createIndexedDbTemporaryStore(options)
  if (indexedDb) return indexedDb
  throw unsupportedOperation(
    `Browser temporary storage is unavailable and ${options.expectedBytes} bytes exceeds the 64 MiB memory fallback`,
  )
}

class BrowserDeflateEncoder implements DeflateEncoder {
  readonly #writer: WritableStreamDefaultWriter<BufferSource>
  readonly #reader: ReadableStreamDefaultReader<Uint8Array>
  readonly #completion: Promise<void>
  #finished = false

  constructor(onData: (chunk: Uint8Array) => Promise<void>) {
    if (typeof CompressionStream !== 'function') {
      throw unsupportedOperation('This browser does not provide CompressionStream')
    }
    const stream = new CompressionStream('deflate')
    this.#writer = stream.writable.getWriter()
    const reader = stream.readable.getReader()
    this.#reader = reader
    this.#completion = (async () => {
      while (true) {
        const result = await reader.read()
        if (result.done) return
        await onData(result.value)
      }
    })()
  }

  async write(data: Uint8Array): Promise<void> {
    if (this.#finished) throw new Error('Deflate encoder is already finished')
    await this.#writer.write(Uint8Array.from(data))
  }

  async finish(): Promise<void> {
    if (this.#finished) throw new Error('Deflate encoder is already finished')
    this.#finished = true
    await this.#writer.close()
    await this.#completion
    this.#reader.releaseLock()
  }

  async abort(reason: unknown): Promise<void> {
    this.#finished = true
    try {
      await this.#writer.abort(reason)
    } catch {
      // The pipeline reports the original operation failure.
    }
    try {
      await this.#completion
    } catch {
      // The pipeline reports the original operation failure.
    }
    this.#reader.releaseLock()
  }
}

const validateBrowserDeflateOptions = (options: DeflateOptions): void => {
  if (options.level !== 6) {
    throw unsupportedOperation(
      'Browser Deflate compression supports the default compressionLevel (6) only',
    )
  }
}

export const browserRuntime: ImageRuntime = Object.freeze({
  createTemporaryStore,
  createDeflateEncoder(
    options: DeflateOptions,
    onData: (chunk: Uint8Array) => Promise<void>,
  ): DeflateEncoder {
    validateBrowserDeflateOptions(options)
    return new BrowserDeflateEncoder(onData)
  },
  async deflate(data: Uint8Array, options: DeflateOptions): Promise<Uint8Array> {
    validateBrowserDeflateOptions(options)
    const chunks: Uint8Array[] = []
    let length = 0
    const encoder = new BrowserDeflateEncoder(async (chunk) => {
      const owned = Uint8Array.from(chunk)
      chunks.push(owned)
      length += owned.byteLength
    })
    await encoder.write(data)
    await encoder.finish()
    const output = new Uint8Array(length)
    let offset = 0
    for (const chunk of chunks) {
      output.set(chunk, offset)
      offset += chunk.byteLength
    }
    return output
  },
})
