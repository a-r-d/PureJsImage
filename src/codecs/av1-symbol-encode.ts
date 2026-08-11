import { invalidInput } from '../errors.ts'

const CDF_PROBABILITY_TOP = 1 << 15
const CDF_PROBABILITY_SHIFT = 6
const MIN_PROBABILITY = 4

const floorLog2 = (value: number): number => Math.floor(Math.log2(value))

export class Av1SymbolEncoder {
  #bytes = new Uint8Array(4096)
  #length = 0
  #low = 0n
  #range = CDF_PROBABILITY_TOP
  #count = -9
  #finished = false

  writeSymbol(cdf: Uint16Array, symbol: number): void {
    this.#ensureWritable()
    const symbols = cdf.length - 1
    if (symbols < 2 || cdf[symbols - 1] !== CDF_PROBABILITY_TOP) {
      throw invalidInput('AV1 symbol CDF is invalid')
    }
    if (!Number.isInteger(symbol) || symbol < 0 || symbol >= symbols) {
      throw invalidInput('AV1 symbol is outside its CDF')
    }

    const previous =
      symbol === 0
        ? this.#range
        : this.#scaledProbability(cdf[symbol - 1] ?? 0, symbols, symbol - 1)
    const current = this.#scaledProbability(cdf[symbol] ?? 0, symbols, symbol)
    const range = previous - current
    if (range <= 0) throw invalidInput('AV1 symbol CDF has an empty interval')
    if (symbol !== 0) this.#low += BigInt(this.#range - previous)
    this.#normalize(range)

    const count = cdf[symbols] ?? 0
    const rate = 3 + (count > 15 ? 1 : 0) + (count > 31 ? 1 : 0) + Math.min(floorLog2(symbols), 2)
    let target = 0
    for (let index = 0; index < symbols - 1; index += 1) {
      if (index === symbol) target = CDF_PROBABILITY_TOP
      const probability = cdf[index] ?? 0
      cdf[index] =
        probability +
        (target < probability ? -((probability - target) >> rate) : (target - probability) >> rate)
    }
    if (count < 32) cdf[symbols] = count + 1
  }

  writeBoolean(value: number): void {
    if (value !== 0 && value !== 1) throw invalidInput('AV1 boolean must be zero or one')
    this.#ensureWritable()
    const split =
      (((this.#range >> 8) * ((CDF_PROBABILITY_TOP >> 1) >> CDF_PROBABILITY_SHIFT)) >>
        (7 - CDF_PROBABILITY_SHIFT)) +
      MIN_PROBABILITY
    if (value === 0) this.#normalize(this.#range - split)
    else {
      this.#low += BigInt(this.#range - split)
      this.#normalize(split)
    }
  }

  writeLiteral(value: number, bits: number): void {
    if (!Number.isInteger(bits) || bits < 0 || bits > 32) {
      throw invalidInput(`Invalid AV1 arithmetic literal width: ${bits}`)
    }
    if (!Number.isInteger(value) || value < 0 || value >= 2 ** bits) {
      throw invalidInput(`AV1 arithmetic literal does not fit in ${bits} bits`)
    }
    this.#ensureWritable()
    for (let bit = bits - 1; bit >= 0; bit -= 1) {
      this.writeBoolean(Math.floor(value / 2 ** bit) & 1)
    }
  }

  finish(): Uint8Array {
    this.#ensureWritable()
    this.#finished = true

    let count = this.#count
    let remaining = count + 10
    const mask = 0x3fffn
    let end = ((this.#low + mask) & ~mask) | (mask + 1n)
    if (remaining > 0) {
      let residualMask = (1n << BigInt(count + 16)) - 1n
      do {
        const value = Number(end >> BigInt(count + 16))
        if ((value & 0x100) !== 0) this.#carry()
        this.#append(value & 0xff)
        end &= residualMask
        remaining -= 8
        count -= 8
        residualMask >>= 8n
      } while (remaining > 0)
    }
    return this.#bytes.slice(0, this.#length)
  }

  #scaledProbability(cumulative: number, symbols: number, symbol: number): number {
    const probability = CDF_PROBABILITY_TOP - cumulative
    return (
      (((this.#range >> 8) * (probability >> CDF_PROBABILITY_SHIFT)) >>
        (7 - CDF_PROBABILITY_SHIFT)) +
      MIN_PROBABILITY * (symbols - symbol - 1)
    )
  }

  #normalize(range: number): void {
    const bits = 15 - floorLog2(range)
    let count = this.#count
    let low = this.#low
    let pending = count + bits
    if (pending >= 40) {
      const readyBytes = (pending >> 3) + 1
      count += 24 - readyBytes * 8
      const shift = BigInt(count)
      const output = low >> shift
      low &= (1n << shift) - 1n
      const carryMask = 1n << BigInt(readyBytes * 8)
      const carry = (output & carryMask) !== 0n
      const bytes = output & (carryMask - 1n)
      if (carry) this.#carry()
      for (let index = readyBytes - 1; index >= 0; index -= 1) {
        this.#append(Number((bytes >> BigInt(index * 8)) & 0xffn))
      }
      pending = count + bits - 24
    }
    this.#low = low << BigInt(bits)
    this.#range = range * 2 ** bits
    this.#count = pending
  }

  #carry(): void {
    let index = this.#length - 1
    while (index >= 0 && this.#bytes[index] === 0xff) {
      this.#bytes[index] = 0
      index -= 1
    }
    if (index < 0) throw invalidInput('AV1 symbol encoder carry underflow')
    this.#bytes[index] = (this.#bytes[index] ?? 0) + 1
  }

  #append(value: number): void {
    if (this.#length === this.#bytes.length) {
      const grown = new Uint8Array(this.#bytes.length * 2)
      grown.set(this.#bytes)
      this.#bytes = grown
    }
    this.#bytes[this.#length] = value
    this.#length += 1
  }

  #ensureWritable(): void {
    if (this.#finished) throw invalidInput('AV1 symbol encoder is already finished')
  }
}
