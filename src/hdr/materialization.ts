import { invalidInput, limitExceeded } from '../errors.ts'
import type { ImageSink } from '../sink.ts'

export interface MaterializationReservation {
  readonly bytes: number
  release(): void
}

export class HdrMaterializationBudget {
  readonly maximum: number
  #current = 0
  #peak = 0

  constructor(maximum: number) {
    if (!Number.isSafeInteger(maximum) || maximum < 1) {
      throw invalidInput('maxMaterializedBytes must be a positive safe integer')
    }
    this.maximum = maximum
  }

  get current(): number {
    return this.#current
  }

  get peak(): number {
    return this.#peak
  }

  reserve(bytes: number, maximum = this.maximum): MaterializationReservation {
    if (!Number.isSafeInteger(bytes) || bytes < 0) {
      throw invalidInput('HDR materialization reservation must be a non-negative safe integer')
    }
    if (!Number.isSafeInteger(maximum) || maximum < 1 || maximum > this.maximum) {
      throw invalidInput('HDR materialization reservation limit is invalid')
    }
    if (this.#current > maximum - bytes) {
      throw limitExceeded('Transformed HDR aggregate working set exceeds maxMaterializedBytes')
    }
    this.#current += bytes
    this.#peak = Math.max(this.#peak, this.#current)
    let released = false
    return Object.freeze({
      bytes,
      release: (): void => {
        if (released) return
        released = true
        this.#current -= bytes
      },
    })
  }
}

export const hdrMaterializationBudget = Symbol('hdrMaterializationBudget')

export type InternalMaterializationOptions = Readonly<{
  readonly [hdrMaterializationBudget]?: HdrMaterializationBudget
}>

export interface MaterializedBytes {
  readonly data: Uint8Array
  readonly reservation: MaterializationReservation
}

export class MaterializedUint8ArraySink implements ImageSink {
  readonly #budget: HdrMaterializationBudget
  readonly #chunks: Array<MaterializedBytes> = []
  #closed = false

  constructor(budget: HdrMaterializationBudget) {
    this.#budget = budget
  }

  async write(chunk: Uint8Array): Promise<void> {
    if (this.#closed) throw new Error('Cannot write to a closed sink')
    const reservation = this.#budget.reserve(chunk.byteLength)
    try {
      this.#chunks.push({ data: chunk.slice(), reservation })
    } catch (error) {
      reservation.release()
      throw error
    }
  }

  async close(): Promise<void> {
    this.#closed = true
  }

  async abort(_reason: unknown): Promise<void> {
    this.#releaseChunks()
    this.#closed = true
  }

  toMaterializedUint8Array(): MaterializedBytes {
    let length = 0
    for (const chunk of this.#chunks) {
      if (length > Number.MAX_SAFE_INTEGER - chunk.data.byteLength) {
        throw limitExceeded('HDR encoded artifact size overflow')
      }
      length += chunk.data.byteLength
    }
    let reservation: MaterializationReservation
    try {
      reservation = this.#budget.reserve(length)
    } catch (error) {
      this.#releaseChunks()
      throw error
    }
    try {
      const output = new Uint8Array(length)
      let offset = 0
      for (const chunk of this.#chunks) {
        output.set(chunk.data, offset)
        offset += chunk.data.byteLength
      }
      this.#releaseChunks()
      return Object.freeze({ data: output, reservation })
    } catch (error) {
      reservation.release()
      throw error
    }
  }

  #releaseChunks(): void {
    for (const chunk of this.#chunks) chunk.reservation.release()
    this.#chunks.length = 0
  }
}
