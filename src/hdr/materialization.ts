import { invalidInput, limitExceeded } from '../errors.ts'
import type { ImageSink } from '../sink.ts'

export interface MaterializationReservation {
  readonly bytes: number
  release(): void
}

export type HdrMaterializationCategory =
  | 'retained-raster'
  | 'aligned-gain-map'
  | 'float-input-block'
  | 'float-output-block'
  | 'encoded-artifact'
  | 'assembly-staging'
  | 'final-output'
  | 'other'

export interface HdrMaterializationSnapshot {
  readonly currentBytes: number
  readonly peakBytes: number
  readonly retainedRasterBytes: number
  readonly encodedArtifactPeakBytes: number
  readonly outputBlockMaximumBytes: number
  readonly fullAdaptedFloatImageAllocated: false
}

export class HdrMaterializationBudget {
  readonly maximum: number
  #current = 0
  #peak = 0
  readonly #categoryCurrent = new Map<HdrMaterializationCategory, number>()
  #encodedArtifactPeak = 0
  #outputBlockMaximum = 0

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

  reserve(
    bytes: number,
    maximum = this.maximum,
    category: HdrMaterializationCategory = 'other',
  ): MaterializationReservation {
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
    this.#categoryCurrent.set(category, (this.#categoryCurrent.get(category) ?? 0) + bytes)
    if (
      category === 'encoded-artifact' ||
      category === 'assembly-staging' ||
      category === 'final-output'
    ) {
      const encodedCurrent =
        (this.#categoryCurrent.get('encoded-artifact') ?? 0) +
        (this.#categoryCurrent.get('assembly-staging') ?? 0) +
        (this.#categoryCurrent.get('final-output') ?? 0)
      this.#encodedArtifactPeak = Math.max(this.#encodedArtifactPeak, encodedCurrent)
    }
    if (category === 'float-output-block') {
      this.#outputBlockMaximum = Math.max(this.#outputBlockMaximum, bytes)
    }
    let released = false
    return Object.freeze({
      bytes,
      release: (): void => {
        if (released) return
        released = true
        this.#current -= bytes
        this.#categoryCurrent.set(category, (this.#categoryCurrent.get(category) ?? 0) - bytes)
      },
    })
  }

  snapshot(): HdrMaterializationSnapshot {
    return Object.freeze({
      currentBytes: this.#current,
      peakBytes: this.#peak,
      retainedRasterBytes: this.#categoryCurrent.get('retained-raster') ?? 0,
      encodedArtifactPeakBytes: this.#encodedArtifactPeak,
      outputBlockMaximumBytes: this.#outputBlockMaximum,
      fullAdaptedFloatImageAllocated: false,
    })
  }
}

export const hdrMaterializationBudget = Symbol('hdrMaterializationBudget')
export const hdrMaterializationMaximum = Symbol('hdrMaterializationMaximum')

export type InternalMaterializationOptions = Readonly<{
  readonly [hdrMaterializationBudget]?: HdrMaterializationBudget
  readonly [hdrMaterializationMaximum]?: number
}>

export interface MaterializedBytes {
  readonly data: Uint8Array
  readonly reservation: MaterializationReservation
}

export interface MaterializedUint8ArraySinkHooks {
  allocate(length: number): Uint8Array
  copy(target: Uint8Array, source: Uint8Array, offset: number): void
}

export class MaterializedUint8ArraySink implements ImageSink {
  readonly #budget: HdrMaterializationBudget
  readonly #maximum: number
  readonly #hooks: MaterializedUint8ArraySinkHooks
  readonly #chunks: Array<MaterializedBytes> = []
  #closed = false

  constructor(
    budget: HdrMaterializationBudget,
    maximum = budget.maximum,
    hooks: Readonly<Partial<MaterializedUint8ArraySinkHooks>> = {},
  ) {
    this.#budget = budget
    const validation = budget.reserve(0, maximum)
    validation.release()
    this.#maximum = maximum
    this.#hooks = {
      allocate: hooks.allocate ?? ((length) => new Uint8Array(length)),
      copy: hooks.copy ?? ((target, source, offset) => target.set(source, offset)),
    }
  }

  async write(chunk: Uint8Array): Promise<void> {
    if (this.#closed) throw new Error('Cannot write to a closed sink')
    const reservation = this.#budget.reserve(chunk.byteLength, this.#maximum, 'encoded-artifact')
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
        this.#releaseChunks()
        throw limitExceeded('HDR encoded artifact size overflow')
      }
      length += chunk.data.byteLength
    }
    let reservation: MaterializationReservation
    try {
      reservation = this.#budget.reserve(length, this.#maximum, 'encoded-artifact')
    } catch (error) {
      this.#releaseChunks()
      throw error
    }
    try {
      const output = this.#hooks.allocate(length)
      let offset = 0
      for (const chunk of this.#chunks) {
        this.#hooks.copy(output, chunk.data, offset)
        offset += chunk.data.byteLength
      }
      this.#releaseChunks()
      return Object.freeze({ data: output, reservation })
    } catch (error) {
      reservation.release()
      this.#releaseChunks()
      throw error
    }
  }

  #releaseChunks(): void {
    for (const chunk of this.#chunks) chunk.reservation.release()
    this.#chunks.length = 0
  }
}
