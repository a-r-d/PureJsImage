import { invalidInput, truncatedInput } from '../../errors.ts'

export class ForwardBitReader {
  private bitPosition = 0
  private readonly data: Uint8Array
  private readonly start: number
  private readonly end: number

  constructor(data: Uint8Array, start: number, end: number) {
    this.data = data
    this.start = start
    this.end = end
    if (start < 0 || end < start || end > data.byteLength) {
      throw invalidInput('Invalid Zstandard forward bitstream bounds')
    }
  }

  get bytesRead(): number {
    return Math.ceil(this.bitPosition / 8)
  }

  get bitsRemaining(): number {
    return (this.end - this.start) * 8 - this.bitPosition
  }

  peekBits(count: number): number {
    if (!Number.isInteger(count) || count < 0 || count > 24) {
      throw invalidInput('Invalid Zstandard forward bit count')
    }
    if (count > this.bitsRemaining) {
      throw truncatedInput('Truncated Zstandard forward bitstream')
    }

    let value = 0
    for (let bit = 0; bit < count; bit += 1) {
      const position = this.bitPosition + bit
      const byte = this.data[this.start + (position >>> 3)] ?? 0
      value += ((byte >>> (position & 7)) & 1) * 2 ** bit
    }
    return value
  }

  readBits(count: number): number {
    const value = this.peekBits(count)
    this.bitPosition += count
    return value
  }
}

export interface PaddedBitRead {
  readonly value: number
  readonly overflow: boolean
}

export class ReverseBitReader {
  private readonly data: Uint8Array
  private readonly firstBit: number
  private bitPosition: number

  constructor(data: Uint8Array, start: number, end: number) {
    this.data = data
    if (start < 0 || end <= start || end > data.byteLength) {
      throw truncatedInput('Truncated Zstandard reverse bitstream')
    }
    const last = data[end - 1]
    if (last === undefined || last === 0) {
      throw invalidInput('Invalid Zstandard reverse bitstream end marker')
    }

    this.firstBit = start * 8
    this.bitPosition = (end - 1) * 8 + Math.floor(Math.log2(last)) - 1
  }

  get bitsRemaining(): number {
    return Math.max(0, this.bitPosition - this.firstBit + 1)
  }

  peekBits(count: number): number {
    return this.readInternal(count, false, true).value
  }
  peekBitsPadded(count: number): number {
    return this.readInternal(count, true, true).value
  }

  skipBits(count: number): void {
    this.readInternal(count, false, false)
  }

  readBits(count: number): number {
    return this.readInternal(count, false, false).value
  }

  readBitsPadded(count: number): PaddedBitRead {
    return this.readInternal(count, true, false)
  }

  assertConsumed(): void {
    if (this.bitsRemaining !== 0) {
      throw invalidInput('Zstandard reverse bitstream has trailing bits')
    }
  }

  private readInternal(count: number, padded: boolean, peek: boolean): PaddedBitRead {
    if (!Number.isInteger(count) || count < 0 || count > 31) {
      throw invalidInput('Invalid Zstandard reverse bit count')
    }

    const available = this.bitsRemaining
    if (!padded && count > available) {
      throw truncatedInput('Truncated Zstandard reverse bitstream')
    }

    const readable = Math.min(count, available)
    let position = this.bitPosition
    let value = 0
    for (let bit = 0; bit < readable; bit += 1) {
      const byte = this.data[position >>> 3] ?? 0
      value = value * 2 + ((byte >>> (position & 7)) & 1)
      position -= 1
    }
    if (readable < count) value *= 2 ** (count - readable)
    if (!peek) this.bitPosition = position
    return { value, overflow: count > available }
  }
}
