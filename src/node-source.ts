import type { AbortOptions } from './abort.ts'
import { throwIfAborted } from './abort.ts'
import { invalidInput } from './errors.ts'
import type { ImageLimits } from './limits.ts'
import { validateInputSize } from './limits.ts'
import {
  BufferedSource,
  createImageSource as createPortableImageSource,
  type ImageInput as PortableImageInput,
  type ImageSource,
  type ImageSourceReadOptions,
  sourceSessionEnd,
  sourceSessionStart,
  stableSourceBuffers,
} from './source.ts'

export type ImageInput = PortableImageInput | string

const availableLength = (size: number, offset: number, length: number): number => {
  if (!Number.isSafeInteger(offset) || offset < 0)
    throw invalidInput('Read offset must be non-negative')
  if (!Number.isSafeInteger(length) || length < 0)
    throw invalidInput('Read length must be non-negative')
  return offset >= size ? 0 : Math.min(length, size - offset)
}

export class FileSource implements ImageSource {
  readonly path: string
  readonly size: number
  readonly [stableSourceBuffers] = true
  #handle: Promise<import('node:fs/promises').FileHandle> | undefined
  #sessions = 0

  private constructor(path: string, size: number) {
    this.path = path
    this.size = size
  }

  static async open(path: string, options: Readonly<AbortOptions> = {}): Promise<FileSource> {
    throwIfAborted(options.signal)
    const { stat } = await import('node:fs/promises')
    const file = await stat(path)
    throwIfAborted(options.signal)
    if (!file.isFile()) throw invalidInput(`Image path is not a file: ${path}`)
    return new FileSource(path, file.size)
  }

  async read(
    offset: number,
    length: number,
    options: Readonly<ImageSourceReadOptions> = {},
  ): Promise<Uint8Array<ArrayBuffer>> {
    throwIfAborted(options.signal)
    const available = availableLength(this.size, offset, length)
    if (available === 0) return new Uint8Array()
    if (this.#sessions === 0) {
      const { open } = await import('node:fs/promises')
      const file = await open(this.path, 'r')
      try {
        const data = await this.#read(file, offset, available)
        throwIfAborted(options.signal)
        return data
      } finally {
        await file.close()
      }
    }
    const data = await this.#read(await this.#sharedHandle(), offset, available)
    throwIfAborted(options.signal)
    return data
  }

  [sourceSessionStart](): void {
    this.#sessions += 1
  }

  async [sourceSessionEnd](): Promise<void> {
    if (this.#sessions < 1) throw new Error('File source session is not active')
    this.#sessions -= 1
    if (this.#sessions !== 0 || !this.#handle) return
    const handle = this.#handle
    this.#handle = undefined
    await (await handle).close()
  }

  async #sharedHandle(): Promise<import('node:fs/promises').FileHandle> {
    if (!this.#handle) {
      const { open } = await import('node:fs/promises')
      this.#handle = open(this.path, 'r')
    }
    try {
      return await this.#handle
    } catch (error) {
      this.#handle = undefined
      throw error
    }
  }

  async #read(
    file: import('node:fs/promises').FileHandle,
    offset: number,
    available: number,
  ): Promise<Uint8Array<ArrayBuffer>> {
    const output = new Uint8Array(available)
    const { bytesRead } = await file.read(output, 0, available, offset)
    return output.subarray(0, bytesRead)
  }
}

export const createImageSource = async (
  input: ImageInput,
  limits: ImageLimits,
  options: Readonly<AbortOptions> = {},
): Promise<ImageSource> => {
  throwIfAborted(options.signal)
  if (typeof input !== 'string') return createPortableImageSource(input, limits, options)
  const source = await FileSource.open(input, options)
  validateInputSize(source.size, limits)
  throwIfAborted(options.signal)
  return new BufferedSource(source)
}
