import { promisify } from 'node:util'
import { constants, deflateRaw, type ZlibOptions } from 'node:zlib'
import type { DeflateEncoder } from './runtime.ts'

const compress = promisify(deflateRaw)
export const deflateChunkBytes = 384 * 1024
const adlerModulus = 65521

export function adler32(bytes: Uint8Array): number {
  let a = 1
  let b = 0
  for (let i = 0; i < bytes.length; ) {
    // At most 5552 bytes between reductions keeps both sums in uint32 range.
    const end = Math.min(i + 5552, bytes.length)
    for (; i < end; i++) {
      a += bytes[i] ?? 0
      b += a
    }
    a %= adlerModulus
    b %= adlerModulus
  }
  return ((b << 16) | a) >>> 0
}

export function combineAdler32(left: number, right: number, rightLength: number): number {
  const a = (left & 0xffff) - 1
  const low = (a + (right & 0xffff) + adlerModulus) % adlerModulus
  const high =
    (adlerModulus + (left >>> 16) + (right >>> 16) + (rightLength % adlerModulus) * a) %
    adlerModulus
  return ((high << 16) | low) >>> 0
}

export class ParallelDeflateEncoder implements DeflateEncoder {
  readonly #jobs: number
  readonly #options: ZlibOptions
  readonly #onData: (data: Uint8Array) => Promise<void>
  readonly #pending: Promise<void>[] = []
  readonly #free: Uint8Array[] = []
  #scanlines: Uint8Array | undefined
  #buffer: Uint8Array | undefined
  #used = 0
  #dictionary: Uint8Array | undefined
  #checksum = 1
  #tail = Promise.resolve()
  #closed = false
  #failure: { reason: unknown } | undefined

  constructor(jobs: number, options: ZlibOptions, onData: (chunk: Uint8Array) => Promise<void>) {
    this.#jobs = jobs
    this.#options = options
    this.#onData = onData
  }

  async #rejectClosed(): Promise<never> {
    await this.#tail
    this.#release()
    if (this.#failure) throw this.#failure.reason
    throw new Error('Deflate encoder is already finished')
  }

  inputBuffer(length: number): Uint8Array | undefined {
    if (length > deflateChunkBytes) return undefined
    if (!this.#scanlines || this.#scanlines.length < length)
      this.#scanlines = new Uint8Array(length)
    return this.#scanlines.length === length ? this.#scanlines : this.#scanlines.subarray(0, length)
  }

  async write(data: Uint8Array): Promise<void> {
    if (this.#closed) return this.#rejectClosed()
    for (let offset = 0; offset < data.length; ) {
      if (this.#used === deflateChunkBytes) this.#submit(false)
      if (!this.#buffer) {
        if (this.#pending.length >= this.#jobs) {
          await this.#pending.shift()
          if (this.#closed) return this.#rejectClosed()
        }
        this.#buffer = this.#free.pop() ?? new Uint8Array(deflateChunkBytes)
      }
      const count = Math.min(data.length - offset, deflateChunkBytes - this.#used)
      this.#buffer.set(data.subarray(offset, offset + count), this.#used)
      this.#used += count
      offset += count
    }
  }

  #submit(final: boolean): void {
    const buffer = this.#buffer ?? new Uint8Array()
    const input = buffer.subarray(0, this.#used)
    const first = this.#dictionary === undefined
    const result = compress(input, {
      ...this.#options,
      ...(first ? {} : { dictionary: this.#dictionary }),
      finishFlush: final ? constants.Z_FINISH : constants.Z_SYNC_FLUSH,
    })
    if (!final) this.#dictionary = input.slice(-32768)
    this.#checksum = combineAdler32(this.#checksum, adler32(input), input.length)
    this.#buffer = undefined
    this.#used = 0

    // The tail always settles after both native compression and all preceding sink writes.
    // Recording the first error here also handles failures while the producer is still filtering.
    this.#tail = Promise.allSettled([this.#tail, result]).then(async ([, compressed]) => {
      try {
        if (compressed.status === 'rejected') throw compressed.reason
        if (this.#failure) return
        if (first) {
          // RFC 1950: a 32 KiB window, no preset dictionary, and a two-byte header divisible by 31.
          const level = this.#options.level ?? 6
          const hint = level < 2 ? 0 : level < 6 ? 1 : level === 6 ? 2 : 3
          const flags = hint << 6
          await this.#onData(Uint8Array.of(0x78, flags + (31 - ((0x7800 + flags) % 31))))
        }
        if (!this.#failure) await this.#onData(compressed.value)
        if (final && !this.#failure) {
          const trailer = new Uint8Array(4)
          new DataView(trailer.buffer).setUint32(0, this.#checksum)
          await this.#onData(trailer)
        }
      } catch (reason) {
        this.#failure ??= { reason }
        this.#closed = true
      } finally {
        if (!this.#closed) this.#free.push(buffer)
      }
    })
    this.#pending.push(this.#tail)
  }

  async finish(): Promise<void> {
    if (this.#closed) return this.#rejectClosed()
    this.#closed = true
    this.#submit(true)
    await this.#tail
    this.#release()
    if (this.#failure) throw this.#failure.reason
  }

  async abort(reason: unknown): Promise<void> {
    this.#closed = true
    this.#failure ??= { reason }
    await this.#tail
    this.#release()
  }

  #release(): void {
    this.#pending.length = 0
    this.#free.length = 0
    this.#scanlines = undefined
    this.#buffer = undefined
    this.#dictionary = undefined
  }
}
