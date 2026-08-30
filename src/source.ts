import type { AbortOptions } from './abort.ts'
import { combineAbortSignals, throwIfAborted } from './abort.ts'
import { ImageError, invalidInput, truncatedInput } from './errors.ts'
import type { ImageLimits } from './limits.ts'
import { validateInputSize } from './limits.ts'
import type { SourceIdentity } from './source-identity-contract.ts'
import {
  createSourceSessionIdentity,
  imageSourceIdentity,
  inheritImageSourceIdentity,
} from './source-identity-contract.ts'

/** Internal portable correlation hook used by explicit execution-evidence wrappers. */
export const sourceReadEvidenceDependencies = Symbol('purejsimage.sourceReadEvidenceDependencies')
/** Internal drain used by single-stream executors to attach completed reads to output blocks. */
export const drainSourceEvidenceDependencies = Symbol('purejsimage.drainSourceEvidenceDependencies')

export interface ImageSourceReadOptions extends AbortOptions {
  readonly [sourceReadEvidenceDependencies]?: (ids: readonly string[]) => void
}

export interface ImageSource {
  readonly size: number
  readonly [imageSourceIdentity]?: () => SourceIdentity | Promise<SourceIdentity>
  readonly [drainSourceEvidenceDependencies]?: () => readonly string[]
  /**
   * Return exactly min(length, size - offset) bytes for an in-range read.
   * Returned bytes must remain valid until the next read starts. Consumers that
   * retain bytes across reads must copy them first. Reject the promise when the
   * backing read fails.
   */
  read(
    offset: number,
    length: number,
    options?: Readonly<ImageSourceReadOptions>,
  ): Promise<Uint8Array>
}

export const sourceSessionStart = Symbol('purejsimage.sourceSessionStart')
export const sourceSessionEnd = Symbol('purejsimage.sourceSessionEnd')
export const stableSourceBuffers = Symbol('purejsimage.stableSourceBuffers')

interface StableBufferSource extends ImageSource {
  readonly [stableSourceBuffers]: true
  read(
    offset: number,
    length: number,
    options?: Readonly<ImageSourceReadOptions>,
  ): Promise<Uint8Array<ArrayBuffer>>
}

interface SessionManagedSource extends ImageSource {
  [sourceSessionStart](): void
  [sourceSessionEnd](): Promise<void>
}

const isSessionManagedSource = (source: ImageSource): source is SessionManagedSource =>
  sourceSessionStart in source &&
  typeof source[sourceSessionStart] === 'function' &&
  sourceSessionEnd in source &&
  typeof source[sourceSessionEnd] === 'function'

const hasStableSourceBuffers = (source: ImageSource): source is StableBufferSource =>
  stableSourceBuffers in source && source[stableSourceBuffers] === true

export const withSourceSession = async <Result>(
  source: ImageSource,
  operation: () => Promise<Result>,
): Promise<Result> => {
  if (!isSessionManagedSource(source)) return operation()
  source[sourceSessionStart]()
  const outcome = await Promise.resolve()
    .then(operation)
    .then(
      (value) => ({ kind: 'success' as const, value }),
      (error: unknown) => ({ kind: 'failure' as const, error }),
    )
  try {
    await source[sourceSessionEnd]()
  } catch (releaseError) {
    if (outcome.kind === 'success') throw releaseError
  }
  if (outcome.kind === 'failure') throw outcome.error
  return outcome.value
}

export type ImageInput = ArrayBuffer | Blob | ImageSource | Uint8Array

const defaultBufferBytes = 262_144
const defaultBufferSlots = 4

interface BufferedRegion {
  readonly data: Uint8Array<ArrayBuffer>
  lastUsed: number
  readonly start: number
}

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
  readonly #identity: SourceIdentity

  constructor(
    data: ArrayBuffer | Uint8Array,
    options: Readonly<{ readonly identity?: SourceIdentity }> = {},
  ) {
    this.#data = data instanceof Uint8Array ? data : new Uint8Array(data)
    this.size = this.#data.byteLength
    if (options.identity !== undefined && options.identity.size !== this.size) {
      throw invalidInput('Invalid source identity size')
    }
    this.#identity =
      options.identity === undefined
        ? createSourceSessionIdentity(this.size)
        : Object.freeze({ ...options.identity })
  }

  [imageSourceIdentity](): SourceIdentity {
    return this.#identity
  }

  async read(
    offset: number,
    length: number,
    options: Readonly<ImageSourceReadOptions> = {},
  ): Promise<Uint8Array> {
    throwIfAborted(options.signal)
    const available = readLength(this.size, offset, length)
    return this.#data.subarray(offset, offset + available)
  }
}

export class BlobSource implements ImageSource {
  readonly size: number
  readonly [stableSourceBuffers] = true
  readonly #blob: Blob
  readonly #identity: SourceIdentity

  constructor(blob: Blob) {
    this.#blob = blob
    this.size = blob.size
    const fileLike: unknown = blob
    this.#identity =
      typeof fileLike === 'object' &&
      fileLike !== null &&
      'name' in fileLike &&
      typeof fileLike.name === 'string' &&
      'lastModified' in fileLike &&
      typeof fileLike.lastModified === 'number'
        ? Object.freeze({
            kind: 'local-file',
            strength: 'weak',
            stability: 'metadata',
            nameOrPath: fileLike.name,
            size: this.size,
            lastModified: fileLike.lastModified,
          })
        : createSourceSessionIdentity(this.size)
  }

  [imageSourceIdentity](): SourceIdentity {
    return this.#identity
  }

  async read(
    offset: number,
    length: number,
    options: Readonly<ImageSourceReadOptions> = {},
  ): Promise<Uint8Array<ArrayBuffer>> {
    throwIfAborted(options.signal)
    const available = readLength(this.size, offset, length)
    const data = new Uint8Array(await this.#blob.slice(offset, offset + available).arrayBuffer())
    throwIfAborted(options.signal)
    return data
  }
}

class ValidatedSource implements ImageSource {
  readonly size: number
  readonly #source: ImageSource

  constructor(source: ImageSource) {
    this.#source = source
    this.size = source.size
  }

  [imageSourceIdentity](): Promise<SourceIdentity> {
    return inheritImageSourceIdentity(this.#source)
  }

  [sourceSessionStart](): void {
    if (isSessionManagedSource(this.#source)) this.#source[sourceSessionStart]()
  }

  async [sourceSessionEnd](): Promise<void> {
    if (isSessionManagedSource(this.#source)) await this.#source[sourceSessionEnd]()
  }

  async read(
    offset: number,
    length: number,
    options: Readonly<ImageSourceReadOptions> = {},
  ): Promise<Uint8Array> {
    throwIfAborted(options.signal)
    const expected = readLength(this.size, offset, length)
    if (expected === 0) return new Uint8Array()

    let data: unknown
    try {
      data = await this.#source.read(offset, length, options)
    } catch (cause) {
      throwIfAborted(options.signal)
      if (cause instanceof ImageError) throw cause
      throw new ImageError(
        'INVALID_INPUT',
        `ImageSource read failed at offset ${offset} for ${length} bytes`,
        { cause },
      )
    }

    throwIfAborted(options.signal)
    if (!(data instanceof Uint8Array)) {
      throw invalidInput(`ImageSource read at offset ${offset} did not return a Uint8Array`)
    }
    if (data.byteLength < expected) {
      throw truncatedInput(
        `ImageSource returned ${data.byteLength} of ${expected} bytes at offset ${offset}`,
      )
    }
    if (data.byteLength > expected) {
      throw invalidInput(
        `ImageSource returned ${data.byteLength} bytes for a ${expected}-byte read at offset ${offset}`,
      )
    }
    return data
  }
}
class SignalBoundSource implements ImageSource {
  readonly size: number
  protected readonly source: ImageSource
  readonly #signal: AbortSignal

  constructor(source: ImageSource, signal: AbortSignal) {
    this.source = source
    this.size = source.size
    this.#signal = signal
  }

  [imageSourceIdentity](): Promise<SourceIdentity> {
    return inheritImageSourceIdentity(this.source)
  }

  [sourceSessionStart](): void {
    if (isSessionManagedSource(this.source)) this.source[sourceSessionStart]()
  }

  async [sourceSessionEnd](): Promise<void> {
    if (isSessionManagedSource(this.source)) await this.source[sourceSessionEnd]()
  }

  [drainSourceEvidenceDependencies](): readonly string[] {
    return this.source[drainSourceEvidenceDependencies]?.() ?? []
  }

  read(
    offset: number,
    length: number,
    options: Readonly<ImageSourceReadOptions> = {},
  ): Promise<Uint8Array> {
    const signal = combineAbortSignals(this.#signal, options.signal)
    throwIfAborted(signal)
    return this.source.read(offset, length, { ...options, signal })
  }
}

class StableSignalBoundSource extends SignalBoundSource implements StableBufferSource {
  readonly [stableSourceBuffers] = true
  readonly #stableSource: StableBufferSource
  readonly #signal: AbortSignal

  constructor(source: StableBufferSource, signal: AbortSignal) {
    super(source, signal)
    this.#stableSource = source
    this.#signal = signal
  }

  override read(
    offset: number,
    length: number,
    options: Readonly<ImageSourceReadOptions> = {},
  ): Promise<Uint8Array<ArrayBuffer>> {
    const signal = combineAbortSignals(this.#signal, options.signal)
    throwIfAborted(signal)
    return this.#stableSource.read(offset, length, { ...options, signal })
  }
}

export const bindImageSourceSignal = (
  source: ImageSource,
  signal: AbortSignal | undefined,
): ImageSource => {
  if (signal === undefined) return source
  return hasStableSourceBuffers(source)
    ? new StableSignalBoundSource(source, signal)
    : new SignalBoundSource(source, signal)
}

export class BufferedSource implements ImageSource {
  readonly size: number
  readonly #source: ImageSource
  readonly #bufferBytes: number
  readonly #buffers: BufferedRegion[] = []
  #accessCounter = 0

  constructor(source: ImageSource, bufferBytes = defaultBufferBytes) {
    if (!Number.isSafeInteger(bufferBytes) || bufferBytes < 1) {
      throw invalidInput('Source buffer size must be a positive safe integer')
    }
    this.#source = source
    this.#bufferBytes = bufferBytes
    this.size = source.size
  }

  [imageSourceIdentity](): Promise<SourceIdentity> {
    return inheritImageSourceIdentity(this.#source)
  }

  [sourceSessionStart](): void {
    if (isSessionManagedSource(this.#source)) this.#source[sourceSessionStart]()
  }

  async [sourceSessionEnd](): Promise<void> {
    if (isSessionManagedSource(this.#source)) await this.#source[sourceSessionEnd]()
  }

  #coveringBuffer(position: number): BufferedRegion | undefined {
    let covering: BufferedRegion | undefined
    for (const buffer of this.#buffers) {
      if (
        position >= buffer.start &&
        position < buffer.start + buffer.data.byteLength &&
        (!covering ||
          buffer.start + buffer.data.byteLength > covering.start + covering.data.byteLength)
      ) {
        covering = buffer
      }
    }
    return covering
  }

  #readCached(offset: number, length: number): Uint8Array | undefined {
    const end = offset + length
    let position = offset
    while (position < end) {
      const buffer = this.#coveringBuffer(position)
      if (!buffer) return undefined
      position = Math.min(end, buffer.start + buffer.data.byteLength)
    }

    const output = new Uint8Array(length)
    position = offset
    while (position < end) {
      const buffer = this.#coveringBuffer(position)
      if (!buffer) return undefined
      const amount = Math.min(end, buffer.start + buffer.data.byteLength) - position
      output.set(
        buffer.data.subarray(position - buffer.start, position - buffer.start + amount),
        position - offset,
      )
      buffer.lastUsed = ++this.#accessCounter
      position += amount
    }
    return output
  }

  #storeBuffer(buffer: BufferedRegion): void {
    if (this.#buffers.length < defaultBufferSlots) {
      this.#buffers.push(buffer)
      return
    }
    let oldest = 0
    for (let index = 1; index < this.#buffers.length; index += 1) {
      if ((this.#buffers[index]?.lastUsed ?? 0) < (this.#buffers[oldest]?.lastUsed ?? 0)) {
        oldest = index
      }
    }
    this.#buffers[oldest] = buffer
  }

  async read(
    offset: number,
    length: number,
    options: Readonly<ImageSourceReadOptions> = {},
  ): Promise<Uint8Array> {
    throwIfAborted(options.signal)
    const available = readLength(this.size, offset, length)
    if (available === 0) return new Uint8Array()

    for (const buffer of this.#buffers) {
      const bufferOffset = offset - buffer.start
      if (bufferOffset >= 0 && bufferOffset + available <= buffer.data.byteLength) {
        buffer.lastUsed = ++this.#accessCounter
        return buffer.data.subarray(bufferOffset, bufferOffset + available)
      }
    }
    const cached = this.#readCached(offset, available)
    if (cached) return cached
    if (available >= this.#bufferBytes) return this.#source.read(offset, available, options)

    const firstRegion = Math.floor(offset / this.#bufferBytes) * this.#bufferBytes
    const lastRegion = Math.floor((offset + available - 1) / this.#bufferBytes) * this.#bufferBytes
    for (
      let regionStart = firstRegion;
      regionStart <= lastRegion;
      regionStart += this.#bufferBytes
    ) {
      throwIfAborted(options.signal)
      if (!this.#buffers.some((buffer) => buffer.start === regionStart)) {
        const amount = Math.min(this.size - regionStart, this.#bufferBytes)
        const data = hasStableSourceBuffers(this.#source)
          ? await this.#source.read(regionStart, amount, options)
          : Uint8Array.from(await this.#source.read(regionStart, amount, options))
        this.#storeBuffer({ data, lastUsed: ++this.#accessCounter, start: regionStart })
      }
    }
    throwIfAborted(options.signal)
    return this.#readCached(offset, available) ?? this.#source.read(offset, available, options)
  }
}

export const createImageSource = async (
  input: ImageInput,
  limits: ImageLimits,
  options: Readonly<AbortOptions> = {},
): Promise<ImageSource> => {
  throwIfAborted(options.signal)
  let source: ImageSource
  if (input instanceof Blob) source = new BlobSource(input)
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
    source = new ValidatedSource(input)
  else throw invalidInput('Unsupported image input')

  validateInputSize(source.size, limits)
  throwIfAborted(options.signal)
  return source instanceof MemorySource || source instanceof BufferedSource
    ? source
    : new BufferedSource(source)
}

export const readExactly = async (
  source: ImageSource,
  offset: number,
  length: number,
  options: Readonly<ImageSourceReadOptions> = {},
): Promise<Uint8Array> => {
  const data = await source.read(offset, length, options)
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
