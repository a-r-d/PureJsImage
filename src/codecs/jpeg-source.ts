import { invalidInput, limitExceeded, truncatedInput } from '../errors.ts'
import type { ImageSource } from '../source.ts'

const bufferBytes = 65_536

export interface JpegRestartPoint {
  readonly marker: number
  readonly mcu: number
  readonly offset: number
}

export interface JpegEntropyIndex {
  readonly endOffset: number
  readonly restart?: JpegRestartPoint
  readonly restartCount: number
}

export class JpegUnexpectedRestart extends Error {
  readonly marker: number

  constructor(marker: number) {
    super(`Unexpected JPEG restart marker ${marker - 0xd0}`)
    this.name = 'JpegUnexpectedRestart'
    this.marker = marker
  }
}
export class JpegUnexpectedScanBoundary extends Error {
  readonly marker: number
  readonly offset: number

  constructor(marker: number, offset: number) {
    super(`Unexpected JPEG scan boundary ff${marker.toString(16)}`)
    this.name = 'JpegUnexpectedScanBoundary'
    this.marker = marker
    this.offset = offset
  }
}

/**
 * Bounded source buffer for JPEG entropy decoding. Call refill() at MCU boundaries;
 * bit reads remain synchronous inside the MCU hot loop.
 */
export class JpegEntropyReader {
  readonly #source: ImageSource
  readonly #buffer = new Uint8Array(bufferBytes)
  readonly #tolerant: boolean
  readonly #recoverScanBoundary: boolean
  #bufferStart: number
  #offset = 0
  #end = 0
  #bits = 0
  #ended = false
  #bitCount = 0

  constructor(source: ImageSource, offset: number, tolerant = false, recoverScanBoundary = false) {
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > source.size) {
      throw invalidInput(`Invalid JPEG entropy offset: ${offset}`)
    }
    this.#source = source
    this.#bufferStart = offset
    this.#tolerant = tolerant
    this.#recoverScanBoundary = recoverScanBoundary
  }

  get available(): number {
    return this.#end - this.#offset
  }

  get position(): number {
    return this.#bufferStart + this.#offset
  }
  get ended(): boolean {
    return this.#ended
  }

  async refill(): Promise<void> {
    if (this.#offset > 0) {
      this.#buffer.copyWithin(0, this.#offset, this.#end)
      this.#bufferStart += this.#offset
      this.#end -= this.#offset
      this.#offset = 0
    }
    if (this.#end === this.#buffer.byteLength) return
    const position = this.#bufferStart + this.#end
    const length = Math.min(this.#buffer.byteLength - this.#end, this.#source.size - position)
    if (length <= 0) return
    const data = await this.#source.read(position, length)
    if (data.byteLength !== length) {
      throw truncatedInput(
        `Expected ${length} JPEG entropy bytes at offset ${position}, received ${data.byteLength}`,
      )
    }
    this.#buffer.set(data, this.#end)
    this.#end += data.byteLength
  }

  #tryFillBits(): boolean {
    if (this.#offset >= this.#end) return false
    const value = this.#buffer[this.#offset] ?? 0
    if (value === 0xff) {
      if (this.#offset + 1 >= this.#end) return false
      if (this.#buffer[this.#offset + 1] !== 0) return false
      this.#offset += 2
    } else {
      this.#offset += 1
    }
    if (this.#bitCount === 0) this.#bits = 0
    this.#bits = ((this.#bits << 8) | value) >>> 0
    this.#bitCount += 8
    return true
  }

  #fillBits(): void {
    if (this.#tryFillBits()) return
    if (this.#offset >= this.#end) throw truncatedInput('JPEG entropy data is truncated')
    const value = this.#buffer[this.#offset] ?? 0
    this.#offset += 1
    if (value === 0xff) {
      if (this.#offset >= this.#end) throw truncatedInput('JPEG entropy byte stuffing is truncated')
      const stuffed = this.#buffer[this.#offset] ?? 0
      this.#offset += 1
      if (this.#tolerant && stuffed >= 0xd0 && stuffed <= 0xd7) {
        throw new JpegUnexpectedRestart(stuffed)
      }
      if (this.#recoverScanBoundary && (stuffed === 0xc4 || stuffed === 0xda || stuffed === 0xd9)) {
        throw new JpegUnexpectedScanBoundary(stuffed, this.position - 2)
      }
      if (stuffed !== 0) throw invalidInput(`Unexpected JPEG marker ff${stuffed.toString(16)}`)
    }
    if (this.#bitCount === 0) this.#bits = 0
    this.#bits = ((this.#bits << 8) | value) >>> 0
    this.#bitCount += 8
  }

  readBit(): number {
    if (this.#bitCount === 0) this.#fillBits()
    this.#bitCount -= 1
    return (this.#bits >>> this.#bitCount) & 1
  }

  readBits(length: number): number {
    let value = 0
    let remaining = length
    while (remaining > 0) {
      if (this.#bitCount === 0) this.#fillBits()
      const take = Math.min(remaining, this.#bitCount)
      const shift = this.#bitCount - take
      value = (value << take) | ((this.#bits >>> shift) & ((1 << take) - 1))
      this.#bitCount -= take
      if (this.#bitCount === 0) this.#bits = 0
      remaining -= take
    }
    return value
  }

  peekBits(length: number): number | undefined {
    if (length <= 0) return 0
    while (this.#bitCount < length) {
      if (!this.#tryFillBits()) return undefined
    }
    return (this.#bits >>> (this.#bitCount - length)) & ((1 << length) - 1)
  }

  skipBits(length: number): void {
    let remaining = length
    while (remaining > 0) {
      if (this.#bitCount === 0) this.#fillBits()
      const take = Math.min(remaining, this.#bitCount)
      this.#bitCount -= take
      if (this.#bitCount === 0) this.#bits = 0
      remaining -= take
    }
  }

  receiveAndExtend(length: number): number {
    if (length === 0) return 0
    const value = this.readBits(length)
    return value >= 1 << (length - 1) ? value : value + (-1 << length) + 1
  }

  restart(expected: number): number {
    this.#bits = 0
    this.#bitCount = 0
    if (!this.#tolerant) {
      while (this.#offset < this.#end && this.#buffer[this.#offset] === 0xff) this.#offset += 1
      if (this.#offset >= this.#end) throw truncatedInput('JPEG restart marker is truncated')
      const marker = this.#buffer[this.#offset] ?? 0
      this.#offset += 1
      if (marker !== 0xd0 + (expected & 7)) {
        throw invalidInput(`Expected JPEG restart marker ${expected & 7}`)
      }
      return marker
    }
    const recoveryEnd = Math.min(this.#end, this.#offset + bufferBytes)
    while (this.#offset < recoveryEnd) {
      if (this.#buffer[this.#offset] !== 0xff) {
        this.#offset += 1
        continue
      }
      this.#offset += 1
      while (this.#offset < recoveryEnd && this.#buffer[this.#offset] === 0xff) this.#offset += 1
      if (this.#offset >= recoveryEnd) break
      const marker = this.#buffer[this.#offset] ?? 0
      this.#offset += 1
      if (marker === 0) continue
      if (marker === 0xd9) {
        this.#ended = true
        return marker
      }
      if (marker >= 0xd0 && marker <= 0xd7) return marker
      throw invalidInput(`Expected JPEG restart marker ${expected & 7}`)
    }
    throw invalidInput('JPEG restart recovery exceeded 64 KiB')
  }

  scanEnd(): number {
    this.#bits = 0
    this.#bitCount = 0
    if (this.#offset >= this.#end || this.#buffer[this.#offset] !== 0xff) {
      throw invalidInput('JPEG scan contains trailing entropy data')
    }
    return this.position
  }

  async finish(): Promise<void> {
    this.#bits = 0
    this.#bitCount = 0
    if (this.#ended) return
    while (true) {
      if (this.available < 4) await this.refill()
      if (this.#offset >= this.#end) throw truncatedInput('JPEG end marker is missing')
      if (this.#buffer[this.#offset] !== 0xff) {
        this.#offset += 1
        continue
      }
      this.#offset += 1
      while (true) {
        if (this.#offset >= this.#end) {
          await this.refill()
          if (this.#offset >= this.#end) throw truncatedInput('JPEG end marker is truncated')
        }
        if (this.#buffer[this.#offset] !== 0xff) break
        this.#offset += 1
      }
      const marker = this.#buffer[this.#offset] ?? 0
      this.#offset += 1
      if (marker === 0) continue
      if (marker === 0xd9) return
      throw invalidInput('Baseline JPEG contains additional unsupported scans')
    }
  }
}

export const indexJpegEntropy = async (
  source: ImageSource,
  scanOffset: number,
  restartInterval: number,
  maximumRestarts = Number.MAX_SAFE_INTEGER,
  targetMcu = Number.MAX_SAFE_INTEGER,
  tolerant = false,
): Promise<JpegEntropyIndex> => {
  let position = scanOffset
  let restart = 0
  let restartPoint: JpegRestartPoint | undefined
  let markerPrefix = false
  while (position < source.size) {
    const length = Math.min(bufferBytes, source.size - position)
    const data = await source.read(position, length)
    if (data.byteLength !== length) {
      throw truncatedInput(
        `Expected ${length} JPEG entropy bytes at offset ${position}, received ${data.byteLength}`,
      )
    }
    for (let offset = 0; offset < data.byteLength; offset += 1) {
      const value = data[offset] ?? 0
      if (!markerPrefix) {
        markerPrefix = value === 0xff
        continue
      }
      if (value === 0xff) continue
      markerPrefix = false
      if (value === 0) continue
      const markerPosition = position + offset + 1
      if (value >= 0xd0 && value <= 0xd7) {
        if (restartInterval === 0) throw invalidInput('JPEG restart marker has no restart interval')
        if (!tolerant && value !== 0xd0 + (restart & 7)) {
          throw invalidInput(`Expected JPEG restart marker ${restart & 7}`)
        }
        restart += 1
        if (restart > maximumRestarts) {
          throw limitExceeded(`JPEG restart index exceeds ${maximumRestarts} entries`)
        }
        const point = { marker: value, mcu: restart * restartInterval, offset: markerPosition }
        if (point.mcu <= targetMcu) restartPoint = point
      } else if (value === 0xd9) {
        return {
          endOffset: markerPosition,
          restartCount: restart,
          ...(restartPoint ? { restart: restartPoint } : {}),
        }
      } else {
        throw invalidInput(`Baseline JPEG contains unsupported marker ff${value.toString(16)}`)
      }
    }
    position += data.byteLength
  }
  throw truncatedInput('JPEG end marker is missing')
}
