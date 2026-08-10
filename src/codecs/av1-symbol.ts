import { invalidInput } from '../errors.ts'

const CDF_PROBABILITY_TOP = 1 << 15
const CDF_PROBABILITY_SHIFT = 6
const MIN_PROBABILITY = 4

const floorLog2 = (value: number): number => Math.floor(Math.log2(value))

export class Av1SymbolDecoder {
  readonly #data: Uint8Array
  readonly #updateCdfs: boolean
  #position = 0
  #range = CDF_PROBABILITY_TOP
  #value: number
  #maximumBits: number

  constructor(data: Uint8Array, updateCdfs: boolean) {
    if (data.byteLength === 0) throw invalidInput('AV1 tile is empty')
    this.#data = data
    this.#updateCdfs = updateCdfs
    const initialBits = Math.min(data.byteLength * 8, 15)
    const buffer = this.#readRaw(initialBits)
    this.#value = (CDF_PROBABILITY_TOP - 1) ^ (buffer * 2 ** (15 - initialBits))
    this.#maximumBits = data.byteLength * 8 - 15
  }

  get bitPosition(): number {
    return this.#position
  }

  readBoolean(): number {
    return this.readSymbol(new Uint16Array([1 << 14, 1 << 15, 0]))
  }

  readLiteral(bits: number): number {
    if (!Number.isInteger(bits) || bits < 0 || bits > 32) {
      throw invalidInput(`Invalid AV1 arithmetic literal width: ${bits}`)
    }
    let value = 0
    for (let index = 0; index < bits; index += 1) value = value * 2 + this.readBoolean()
    return value
  }
  readNonSymmetric(symbols: number): number {
    if (!Number.isInteger(symbols) || symbols < 1 || symbols > 256) {
      throw invalidInput(`Invalid AV1 non-symmetric symbol count: ${symbols}`)
    }
    if (symbols === 1) return 0
    const bits = floorLog2(symbols) + 1
    const cutoff = 2 ** bits - symbols
    const value = this.readLiteral(bits - 1)
    return value < cutoff ? value : value * 2 - cutoff + this.readBoolean()
  }

  readSymbol(cdf: Uint16Array): number {
    const symbols = cdf.length - 1
    if (symbols < 2 || cdf[symbols - 1] !== CDF_PROBABILITY_TOP) {
      throw invalidInput('AV1 symbol CDF is invalid')
    }
    let current = this.#range
    let previous = current
    let symbol = -1
    do {
      symbol += 1
      if (symbol >= symbols) throw invalidInput('AV1 symbol exceeds its CDF')
      previous = current
      const probability = CDF_PROBABILITY_TOP - (cdf[symbol] ?? 0)
      current =
        (((this.#range >> 8) * (probability >> CDF_PROBABILITY_SHIFT)) >>
          (7 - CDF_PROBABILITY_SHIFT)) +
        MIN_PROBABILITY * (symbols - symbol - 1)
    } while (this.#value < current)

    this.#range = previous - current
    this.#value -= current
    const bits = 15 - floorLog2(this.#range)
    this.#range *= 2 ** bits
    const newBits = Math.min(bits, Math.max(0, this.#maximumBits))
    const newData = this.#readRaw(newBits)
    const paddedData = newData * 2 ** (bits - newBits)
    this.#value = paddedData ^ ((this.#value + 1) * 2 ** bits - 1)
    this.#maximumBits -= bits

    if (this.#updateCdfs) {
      const count = cdf[symbols] ?? 0
      const rate = 3 + (count > 15 ? 1 : 0) + (count > 31 ? 1 : 0) + Math.min(floorLog2(symbols), 2)
      let target = 0
      for (let index = 0; index < symbols - 1; index += 1) {
        if (index === symbol) target = CDF_PROBABILITY_TOP
        const probability = cdf[index] ?? 0
        cdf[index] =
          probability +
          (target < probability
            ? -((probability - target) >> rate)
            : (target - probability) >> rate)
      }
      if (count < 32) cdf[symbols] = count + 1
    }
    return symbol
  }

  finish(): void {
    if (this.#maximumBits < -14) throw invalidInput('AV1 symbol decoder over-read its tile')
    const trailingBitPosition = this.#position - Math.min(15, this.#maximumBits + 15)
    const paddingEndPosition = this.#position + Math.max(0, this.#maximumBits)
    if (this.#rawBit(trailingBitPosition) !== 1) {
      throw invalidInput(
        `AV1 tile trailing one bit is missing at bit ${trailingBitPosition} after decoding ${this.#position} of ${this.#data.byteLength * 8} bits`,
      )
    }
    for (let position = trailingBitPosition + 1; position < paddingEndPosition; position += 1) {
      if (this.#rawBit(position) !== 0) {
        throw invalidInput(
          `AV1 tile trailing padding is nonzero at bit ${position} after decoding ${this.#position} of ${this.#data.byteLength * 8} bits`,
        )
      }
    }
  }

  #readRaw(bits: number): number {
    let value = 0
    for (let index = 0; index < bits; index += 1) {
      value = value * 2 + this.#rawBit(this.#position)
      this.#position += 1
    }
    return value
  }

  #rawBit(position: number): number {
    if (position < 0) return 0
    const byte = this.#data[position >>> 3]
    if (byte === undefined) throw invalidInput('AV1 symbol data is truncated')
    return (byte >>> (7 - (position & 7))) & 1
  }
}
