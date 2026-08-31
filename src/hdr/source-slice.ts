import { throwIfAborted } from '../abort.ts'
import { invalidInput } from '../errors.ts'
import type { ImageSource, ImageSourceReadOptions } from '../source.ts'
import { drainSourceEvidenceDependencies, sourceSessionEnd, sourceSessionStart } from '../source.ts'
import type { SourceIdentity } from '../source-identity-contract.ts'
import { imageSourceIdentity, inheritImageSourceIdentity } from '../source-identity-contract.ts'

interface SessionManagedSource extends ImageSource {
  [sourceSessionStart](): void
  [sourceSessionEnd](): Promise<void>
}

const sessionManaged = (source: ImageSource): source is SessionManagedSource =>
  sourceSessionStart in source &&
  typeof source[sourceSessionStart] === 'function' &&
  sourceSessionEnd in source &&
  typeof source[sourceSessionEnd] === 'function'

const nonnegativeSafeInteger = (value: number, label: string): void => {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw invalidInput(`${label} must be a nonnegative safe integer`)
  }
}

export class ImageSourceRange implements ImageSource {
  readonly size: number
  readonly #source: ImageSource
  readonly #start: number

  constructor(source: ImageSource, start: number, length: number) {
    nonnegativeSafeInteger(source.size, 'Parent source size')
    nonnegativeSafeInteger(start, 'Source range start')
    nonnegativeSafeInteger(length, 'Source range length')
    if (start > source.size || length > source.size - start) {
      throw invalidInput('Source range exceeds its parent source')
    }
    this.#source = source
    this.#start = start
    this.size = length
  }

  [imageSourceIdentity](): Promise<SourceIdentity> {
    return inheritImageSourceIdentity(this.#source)
  }

  [sourceSessionStart](): void {
    if (sessionManaged(this.#source)) this.#source[sourceSessionStart]()
  }

  async [sourceSessionEnd](): Promise<void> {
    if (sessionManaged(this.#source)) await this.#source[sourceSessionEnd]()
  }

  [drainSourceEvidenceDependencies](): readonly string[] {
    return this.#source[drainSourceEvidenceDependencies]?.() ?? []
  }

  async read(
    offset: number,
    length: number,
    options: Readonly<ImageSourceReadOptions> = {},
  ): Promise<Uint8Array> {
    throwIfAborted(options.signal)
    nonnegativeSafeInteger(offset, 'Source range read offset')
    nonnegativeSafeInteger(length, 'Source range read length')
    if (offset >= this.size || length === 0) return new Uint8Array()
    const available = Math.min(length, this.size - offset)
    return this.#source.read(this.#start + offset, available, options)
  }
}
