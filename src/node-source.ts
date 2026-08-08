import { invalidInput } from './errors.ts'
import type { ImageLimits } from './limits.ts'
import { validateInputSize } from './limits.ts'
import {
  BufferedSource,
  createImageSource as createPortableImageSource,
  type ImageInput as PortableImageInput,
  type ImageSource,
} from './source.ts'

export type ImageInput = PortableImageInput | string

const availableLength = (size: number, offset: number, length: number): number => {
  if (!Number.isSafeInteger(offset) || offset < 0)
    throw invalidInput('Read offset must be non-negative')
  if (!Number.isSafeInteger(length) || length < 0)
    throw invalidInput('Read length must be non-negative')
  return offset >= size ? 0 : Math.min(length, size - offset)
}

const fileBackingSource = (path: string, size: number): ImageSource => ({
  size,
  async read(offset: number, length: number): Promise<Uint8Array> {
    const available = availableLength(size, offset, length)
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

export class FileSource implements ImageSource {
  readonly path: string
  readonly size: number
  readonly #backing: ImageSource

  private constructor(path: string, size: number) {
    this.path = path
    this.size = size
    this.#backing = fileBackingSource(path, size)
  }

  static async open(path: string): Promise<FileSource> {
    const { stat } = await import('node:fs/promises')
    const file = await stat(path)
    if (!file.isFile()) throw invalidInput(`Image path is not a file: ${path}`)
    return new FileSource(path, file.size)
  }

  async read(offset: number, length: number): Promise<Uint8Array> {
    return this.#backing.read(offset, length)
  }
}

export const createImageSource = async (
  input: ImageInput,
  limits: ImageLimits,
): Promise<ImageSource> => {
  if (typeof input !== 'string') return createPortableImageSource(input, limits)
  const source = await FileSource.open(input)
  validateInputSize(source.size, limits)
  return new BufferedSource(source)
}
