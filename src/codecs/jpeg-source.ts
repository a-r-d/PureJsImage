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
/**
 * Bounded source buffer for JPEG entropy decoding. Call refill() at MCU boundaries;
 * bit reads remain synchronous inside the MCU hot loop.
 */
export class JpegEntropyReader {
  readonly #source: ImageSource
  readonly #buffer = new Uint8Array(bufferBytes)
  readonly #tolerant: boolean
  #bufferStart: number
  #offset = 0
  #end = 0
  #bits = 0
  #ended = false
  #bitCount = 0

  constructor(source: ImageSource, offset: number, tolerant = false) {
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > source.size) {
      throw invalidInput(`Invalid JPEG entropy offset: ${offset}`)
    }
    this.#source = source
    this.#bufferStart = offset
    this.#tolerant = tolerant
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

  readBit(): number {
    if (this.#bitCount === 0) {
      if (this.#offset >= this.#end) throw truncatedInput('JPEG entropy data is truncated')
      this.#bits = this.#buffer[this.#offset] ?? 0
      this.#offset += 1
      if (this.#bits === 0xff) {
        if (this.#offset >= this.#end)
          throw truncatedInput('JPEG entropy byte stuffing is truncated')
        const stuffed = this.#buffer[this.#offset] ?? 0
        this.#offset += 1
        if (this.#tolerant && stuffed >= 0xd0 && stuffed <= 0xd7) {
          throw new JpegUnexpectedRestart(stuffed)
        }
        if (stuffed !== 0) throw invalidInput(`Unexpected JPEG marker ff${stuffed.toString(16)}`)
      }
      this.#bitCount = 8
    }
    this.#bitCount -= 1
    return (this.#bits >>> this.#bitCount) & 1
  }

  readBits(length: number): number {
    let value = 0
    for (let index = 0; index < length; index += 1) value = (value << 1) | this.readBit()
    return value
  }

  receiveAndExtend(length: number): number {
    if (length === 0) return 0
    const value = this.readBits(length)
    return value >= 1 << (length - 1) ? value : value + (-1 << length) + 1
  }

  restart(expected: number): number {
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
    this.#bitCount = 0
    if (this.#offset >= this.#end || this.#buffer[this.#offset] !== 0xff) {
      throw invalidInput('JPEG scan contains trailing entropy data')
    }
    return this.position
  }

  async finish(): Promise<void> {
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
