import { invalidInput, truncatedInput } from './errors.ts'
import type { ImageLimits } from './limits.ts'
import { validateInputSize } from './limits.ts'

export interface ImageSource {
  readonly size: number
  /**
   * Returned bytes must remain valid until the next read starts. Consumers that
   * retain bytes across reads must copy them first.
   */
  read(offset: number, length: number): Promise<Uint8Array>
}

export type ImageInput = ArrayBuffer | Blob | ImageSource | Uint8Array | string

const defaultBufferBytes = 65_536

const readLength = (size: number, offset: number, length: number): number => {
  if (!Number.isSafeInteger(offset) || offset < 0)
    throw invalidInput('Read offset must be non-negative')
  if (!Number.isSafeInteger(length) || length < 0)
    throw invalidInput('Read length must be non-negative')
  return offset >= size ? 0 : Math.min(length, size - offset)
}

export class MemorySource implements ImageSource {
  readonly size: number
  readonly #data: Uint8Array

  constructor(data: ArrayBuffer | Uint8Array) {
    this.#data = data instanceof Uint8Array ? data : new Uint8Array(data)
    this.size = this.#data.byteLength
  }

  async read(offset: number, length: number): Promise<Uint8Array> {
    const available = readLength(this.size, offset, length)
    return this.#data.subarray(offset, offset + available)
  }
}

export class BlobSource implements ImageSource {
  readonly size: number
  readonly #blob: Blob

  constructor(blob: Blob) {
    this.#blob = blob
    this.size = blob.size
  }

  async read(offset: number, length: number): Promise<Uint8Array> {
    const available = readLength(this.size, offset, length)
    return new Uint8Array(await this.#blob.slice(offset, offset + available).arrayBuffer())
  }
}

export class BufferedSource implements ImageSource {
  readonly size: number
  readonly #source: ImageSource
  readonly #bufferBytes: number
  #buffer: Uint8Array<ArrayBufferLike> = new Uint8Array()
  #bufferStart = 0

  constructor(source: ImageSource, bufferBytes = defaultBufferBytes) {
    if (!Number.isSafeInteger(bufferBytes) || bufferBytes < 1) {
      throw invalidInput('Source buffer size must be a positive safe integer')
    }
    this.#source = source
    this.#bufferBytes = bufferBytes
    this.size = source.size
  }

  async read(offset: number, length: number): Promise<Uint8Array> {
    const available = readLength(this.size, offset, length)
    if (available === 0) return new Uint8Array()

    const bufferOffset = offset - this.#bufferStart
    if (bufferOffset >= 0 && bufferOffset + available <= this.#buffer.byteLength) {
      return this.#buffer.subarray(bufferOffset, bufferOffset + available)
    }
    if (available >= this.#bufferBytes) return this.#source.read(offset, available)

    const amount = Math.min(this.size - offset, this.#bufferBytes)
    const buffer = await this.#source.read(offset, amount)
    this.#bufferStart = offset
    this.#buffer = buffer
    return buffer.subarray(0, available)
  }
}

const fileBackingSource = (path: string, size: number): ImageSource => ({
  size,
  async read(offset: number, length: number): Promise<Uint8Array> {
    const available = readLength(size, offset, length)
    if (available === 0) return new Uint8Array()

    const { open } = await import('node:fs/promises')
    const file = await open(path, 'r')
    try {
      const output = new Uint8Array(available)
      const { bytesRead } = await file.read(output, 0, available, offset)
      return output.subarray(0, bytesRead)
    } finally {
      await file.close()
    }
  },
})

export class FileSource extends BufferedSource {
  readonly path: string

  private constructor(path: string, size: number) {
    super(fileBackingSource(path, size))
    this.path = path
  }

  static async open(path: string): Promise<FileSource> {
    const { stat } = await import('node:fs/promises')
    const file = await stat(path)
    if (!file.isFile()) throw invalidInput(`Image path is not a file: ${path}`)
    return new FileSource(path, file.size)
  }
}

export const createImageSource = async (
  input: ImageInput,
  limits: ImageLimits,
): Promise<ImageSource> => {
  let source: ImageSource
  if (typeof input === 'string') source = await FileSource.open(input)
  else if (input instanceof Blob) source = new BlobSource(input)
  else if (input instanceof Uint8Array || input instanceof ArrayBuffer)
    source = new MemorySource(input)
  else if (
    typeof input === 'object' &&
    input !== null &&
    'size' in input &&
    typeof input.size === 'number' &&
    'read' in input &&
    typeof input.read === 'function'
  )
    source = input
  else throw invalidInput('Unsupported image input')

  validateInputSize(source.size, limits)
  return source
}

export const readExactly = async (
  source: ImageSource,
  offset: number,
  length: number,
): Promise<Uint8Array> => {
  const data = await source.read(offset, length)
  if (data.byteLength !== length) {
    throw truncatedInput(
      `Expected ${length} bytes at offset ${offset}, received ${data.byteLength}`,
    )
  }
  return data
}

export class SourceReader {
  readonly #source: ImageSource
  readonly #blockSize: number
  #buffer: Uint8Array<ArrayBufferLike> = new Uint8Array()
  #bufferStart = 0
  position = 0

  constructor(source: ImageSource, offset = 0, blockSize = 65_536) {
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > source.size) {
      throw invalidInput(`Invalid reader offset: ${offset}`)
    }
    this.#source = source
    this.#blockSize = blockSize
    this.position = offset
  }

  async readByte(): Promise<number> {
    const bytes = await this.read(1)
    const value = bytes[0]
    if (value === undefined) throw truncatedInput(`Expected a byte at offset ${this.position - 1}`)
    return value
  }

  async read(length: number): Promise<Uint8Array> {
    if (!Number.isSafeInteger(length) || length < 0)
      throw invalidInput('Read length must be non-negative')
    if (length === 0) return new Uint8Array()

    const bufferOffset = this.position - this.#bufferStart
    if (bufferOffset >= 0 && bufferOffset + length <= this.#buffer.byteLength) {
      const data = this.#buffer.subarray(bufferOffset, bufferOffset + length)
      this.position += length
      return data
    }

    const remaining = this.#source.size - this.position
    const amount = Math.min(remaining, Math.max(length, this.#blockSize))
    this.#bufferStart = this.position
    this.#buffer = await this.#source.read(this.position, amount)
    if (this.#buffer.byteLength < length) {
      throw truncatedInput(`Expected ${length} bytes at offset ${this.position}`)
    }
    const data = this.#buffer.subarray(0, length)
    this.position += length
    return data
  }

  skip(length: number): void {
    if (!Number.isSafeInteger(length) || length < 0)
      throw invalidInput('Skip length must be non-negative')
    const next = this.position + length
    if (next > this.#source.size)
      throw truncatedInput(`Skip exceeds input size at offset ${this.position}`)
    this.position = next
  }
}
