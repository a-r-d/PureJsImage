import { invalidInput, truncatedInput } from '../errors.ts'

// ISO/IEC 15444-1, Table C.2. These are format constants, stored in parallel
// typed arrays so the decision loop does not allocate or chase objects.
const qe = Uint16Array.from([
  0x5601, 0x3401, 0x1801, 0x0ac1, 0x0521, 0x0221, 0x5601, 0x5401, 0x4801, 0x3801, 0x3001, 0x2401,
  0x1c01, 0x1601, 0x5601, 0x5401, 0x5101, 0x4801, 0x3801, 0x3401, 0x3001, 0x2801, 0x2401, 0x2201,
  0x1c01, 0x1801, 0x1601, 0x1401, 0x1201, 0x1101, 0x0ac1, 0x09c1, 0x08a1, 0x0521, 0x0441, 0x02a1,
  0x0221, 0x0141, 0x0111, 0x0085, 0x0049, 0x0025, 0x0015, 0x0009, 0x0005, 0x0001, 0x5601,
])
const nextMps = Uint8Array.from([
  1, 2, 3, 4, 5, 38, 7, 8, 9, 10, 11, 12, 13, 29, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26,
  27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 45, 46,
])
const nextLps = Uint8Array.from([
  1, 6, 9, 12, 29, 33, 6, 14, 14, 14, 17, 18, 20, 21, 14, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22,
  23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 46,
])
const switchMps = Uint8Array.from([
  1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
])

export const createJpeg2000Contexts = (): Uint8Array => {
  const contexts = new Uint8Array(19)
  contexts[0] = 4 << 1
  contexts[17] = 46 << 1
  contexts[18] = 3 << 1
  return contexts
}

export class Jpeg2000MqDecoder {
  readonly #data: Uint8Array
  readonly #end: number
  #position: number
  #high: number
  #low = 0
  #counter = 0
  #interval = 0x8000

  constructor(data: Uint8Array, start = 0, end = data.byteLength) {
    if (
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end) ||
      start < 0 ||
      end <= start ||
      end > data.byteLength
    ) {
      throw invalidInput('JPEG 2000 MQ segment extent is invalid')
    }
    this.#data = data
    this.#end = end
    this.#position = start
    const first = data[start]
    if (first === undefined) throw truncatedInput('JPEG 2000 MQ segment is empty')
    this.#high = first
    this.#byteIn()
    this.#high = (this.#high << 7) | ((this.#low >>> 9) & 0x7f)
    this.#low = (this.#low << 7) & 0xffff
    this.#counter -= 7
  }

  #byteIn(): void {
    const current = this.#data[this.#position]
    if (current === undefined || this.#position >= this.#end) {
      this.#low += 0xff00
      this.#counter = 8
      if (this.#low > 0xffff) {
        this.#high += this.#low >>> 16
        this.#low &= 0xffff
      }
      return
    }
    if (current === 0xff) {
      const following = this.#data[this.#position + 1]
      if (following === undefined || following > 0x8f) {
        this.#low += 0xff00
        this.#counter = 8
      } else {
        this.#position += 1
        this.#low += following << 9
        this.#counter = 7
      }
    } else {
      this.#position += 1
      const following = this.#position < this.#end ? (this.#data[this.#position] ?? 0xff) : 0xff
      this.#low += following << 8
      this.#counter = 8
    }
    if (this.#low > 0xffff) {
      this.#high += this.#low >>> 16
      this.#low &= 0xffff
    }
  }

  read(contexts: Uint8Array, context: number): number {
    const packed = contexts[context]
    if (packed === undefined) throw invalidInput(`JPEG 2000 MQ context ${context} is invalid`)
    let state = packed >>> 1
    let mps = packed & 1
    const probability = qe[state]
    if (probability === undefined) throw invalidInput('JPEG 2000 MQ state is invalid')
    let interval = this.#interval - probability
    let decision: number

    if (this.#high < probability) {
      if (interval < probability) {
        interval = probability
        decision = mps
        state = nextMps[state] ?? 0
      } else {
        interval = probability
        decision = mps ^ 1
        if (switchMps[state] === 1) mps = decision
        state = nextLps[state] ?? 0
      }
    } else {
      this.#high -= probability
      if ((interval & 0x8000) !== 0) {
        this.#interval = interval
        return mps
      }
      if (interval < probability) {
        decision = mps ^ 1
        if (switchMps[state] === 1) mps = decision
        state = nextLps[state] ?? 0
      } else {
        decision = mps
        state = nextMps[state] ?? 0
      }
    }

    while ((interval & 0x8000) === 0) {
      if (this.#counter === 0) this.#byteIn()
      interval <<= 1
      this.#high = ((this.#high << 1) & 0xffff) | ((this.#low >>> 15) & 1)
      this.#low = (this.#low << 1) & 0xffff
      this.#counter -= 1
    }
    this.#interval = interval
    contexts[context] = (state << 1) | mps
    return decision
  }
}
