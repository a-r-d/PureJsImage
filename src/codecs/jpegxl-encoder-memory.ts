import { invalidInput, limitExceeded } from '../errors.ts'

type OwnedArray =
  | Uint8Array<ArrayBuffer>
  | Uint16Array<ArrayBuffer>
  | Uint32Array<ArrayBuffer>
  | Int8Array<ArrayBuffer>
  | Int16Array<ArrayBuffer>
  | Int32Array<ArrayBuffer>
  | Float32Array<ArrayBuffer>
interface ArrayConstructor<T extends OwnedArray> {
  new (length: number): T
  readonly BYTES_PER_ELEMENT: number
}

interface AllocationScope {
  readonly buffers: Set<ArrayBuffer>
  readonly parent?: AllocationScope
  closed: boolean
}

/** Owns actual backing buffers. It does not estimate JavaScript heap or process RSS. */
export class JpegXlEncoderMemory {
  readonly #limit: number
  readonly #owners = new Map<ArrayBuffer, AllocationScope>()
  #scope: AllocationScope = { buffers: new Set(), closed: false }
  #live = 0
  #peak = 0

  readonly outputLimit: number
  constructor(limit: number, outputLimit = 134_217_728) {
    this.outputLimit = outputLimit
    if (!Number.isSafeInteger(limit) || limit < 1)
      throw invalidInput('JPEG XL maxWorkingBytes must be a positive safe integer')
    this.#limit = limit
  }

  get liveBytes(): number {
    return this.#live
  }
  get peakBytes(): number {
    return this.#peak
  }
  get liveAllocations(): number {
    return this.#owners.size
  }
  get currentScope(): AllocationScope {
    return this.#scope
  }

  allocate<T extends OwnedArray>(
    arrayType: ArrayConstructor<T>,
    length: number,
    scope = this.#scope,
  ): T {
    if (!Number.isSafeInteger(length) || length < 0)
      throw invalidInput('JPEG XL allocation length must be a nonnegative safe integer')
    const bytes = length * arrayType.BYTES_PER_ELEMENT
    this.#admit(bytes, scope)
    const output = new arrayType(length)
    this.#own(output.buffer, scope)
    return output
  }

  release(view: ArrayBufferView): void {
    if (!(view.buffer instanceof ArrayBuffer))
      throw invalidInput('JPEG XL cannot release shared storage')
    this.#releaseBuffer(view.buffer)
  }

  /** Escapes returned backing buffers, then releases all other scoped allocations. */
  run<T>(action: () => T): T {
    const parent = this.#scope
    if (parent.closed) throw invalidInput('JPEG XL encoder memory is closed')
    const scope: AllocationScope = { buffers: new Set(), parent, closed: false }
    this.#scope = scope
    try {
      const result = action()
      const visited = new Set<object>()
      const promote = (value: unknown): void => {
        if (typeof value !== 'object' || value === null || visited.has(value)) return
        visited.add(value)
        if (ArrayBuffer.isView(value)) {
          const buffer = value.buffer
          if (buffer instanceof ArrayBuffer && this.#owners.get(buffer) === scope) {
            scope.buffers.delete(buffer)
            parent.buffers.add(buffer)
            this.#owners.set(buffer, parent)
          }
        } else if (Array.isArray(value)) {
          for (const item of value) promote(item)
        } else {
          for (const item of Object.values(value)) promote(item)
        }
      }
      promote(result)
      return result
    } finally {
      for (const buffer of scope.buffers) this.#releaseBuffer(buffer)
      scope.closed = true
      this.#scope = parent
    }
  }

  close(): void {
    if (this.#scope.closed) return
    if (this.#scope.parent) throw invalidInput('Cannot close JPEG XL memory inside an active scope')
    for (const buffer of this.#scope.buffers) this.#releaseBuffer(buffer)
    this.#scope.closed = true
    if (this.#live !== 0 || this.#owners.size !== 0)
      throw invalidInput('JPEG XL encoder allocation ownership did not unwind')
  }

  #admit(bytes: number, scope: AllocationScope): void {
    if (scope.closed) throw invalidInput('JPEG XL allocation scope is closed')
    if (!Number.isSafeInteger(bytes) || bytes < 0)
      throw invalidInput('JPEG XL allocation size must be a nonnegative safe integer')
    if (bytes > this.#limit - this.#live)
      throw limitExceeded(
        `JPEG XL encoder requires ${this.#live + bytes} live backing bytes; maxWorkingBytes is ${this.#limit}`,
      )
  }

  #own(buffer: ArrayBuffer, scope: AllocationScope): void {
    if (this.#owners.has(buffer)) throw invalidInput('JPEG XL backing buffer is already owned')
    scope.buffers.add(buffer)
    this.#owners.set(buffer, scope)
    this.#live += buffer.byteLength
    this.#peak = Math.max(this.#peak, this.#live)
  }

  #releaseBuffer(buffer: ArrayBuffer): void {
    const owner = this.#owners.get(buffer)
    if (!owner) throw invalidInput('JPEG XL backing buffer released twice or without ownership')
    if (this.#live < buffer.byteLength)
      throw invalidInput('JPEG XL managed allocation counter underflow')
    owner.buffers.delete(buffer)
    this.#owners.delete(buffer)
    this.#live -= buffer.byteLength
  }
}

export const withJpegXlMemory = <T>(memory: JpegXlEncoderMemory | undefined, action: () => T): T =>
  memory ? memory.run(action) : action()

export const allocateJpegXlArray = <T extends OwnedArray>(
  memory: JpegXlEncoderMemory | undefined,
  arrayType: ArrayConstructor<T>,
  length: number,
): T => (memory ? memory.allocate(arrayType, length) : new arrayType(length))

export const copyJpegXlArray = <T extends OwnedArray, V>(
  memory: JpegXlEncoderMemory | undefined,
  arrayType: ArrayConstructor<T>,
  values: ArrayLike<V>,
  map: (value: V, index: number) => number = (value) => {
    if (typeof value !== 'number') throw invalidInput('JPEG XL array source is not numeric')
    return value
  },
): T => {
  const output = allocateJpegXlArray(memory, arrayType, values.length)
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index]
    if (value === undefined) throw invalidInput('JPEG XL array source has a missing value')
    output[index] = map(value, index)
  }
  return output
}
