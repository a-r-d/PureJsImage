import { invalidInput } from '../errors.ts'

const RANGE_LPS: readonly (readonly [number, number, number, number])[] = [
  [128, 176, 208, 240],
  [128, 167, 197, 227],
  [128, 158, 187, 216],
  [123, 150, 178, 205],
  [116, 142, 169, 195],
  [111, 135, 160, 185],
  [105, 128, 152, 175],
  [100, 122, 144, 166],
  [95, 116, 137, 158],
  [90, 110, 130, 150],
  [85, 104, 123, 142],
  [81, 99, 117, 135],
  [77, 94, 111, 128],
  [73, 89, 105, 122],
  [69, 85, 100, 116],
  [66, 80, 95, 110],
  [62, 76, 90, 104],
  [59, 72, 86, 99],
  [56, 69, 81, 94],
  [53, 65, 77, 89],
  [51, 62, 73, 85],
  [48, 59, 69, 80],
  [46, 56, 66, 76],
  [43, 53, 63, 72],
  [41, 50, 59, 69],
  [39, 48, 56, 65],
  [37, 45, 54, 62],
  [35, 43, 51, 59],
  [33, 41, 48, 56],
  [32, 39, 46, 53],
  [30, 37, 43, 50],
  [29, 35, 41, 48],
  [27, 33, 39, 45],
  [26, 31, 37, 43],
  [24, 30, 35, 41],
  [23, 28, 33, 39],
  [22, 27, 32, 37],
  [21, 26, 30, 35],
  [20, 24, 29, 33],
  [19, 23, 27, 31],
  [18, 22, 26, 30],
  [17, 21, 25, 28],
  [16, 20, 23, 27],
  [15, 19, 22, 25],
  [14, 18, 21, 24],
  [14, 17, 20, 23],
  [13, 16, 19, 22],
  [12, 15, 18, 21],
  [12, 14, 17, 20],
  [11, 14, 16, 19],
  [11, 13, 15, 18],
  [10, 12, 15, 17],
  [10, 12, 14, 16],
  [9, 11, 13, 15],
  [9, 11, 12, 14],
  [8, 10, 12, 14],
  [8, 9, 11, 13],
  [7, 9, 11, 12],
  [7, 9, 10, 12],
  [7, 8, 10, 11],
  [6, 8, 9, 11],
  [6, 7, 9, 10],
  [6, 7, 8, 9],
  [2, 2, 2, 2],
]

const TRANSITION_LPS = Uint8Array.from([
  0, 0, 1, 2, 2, 4, 4, 5, 6, 7, 8, 9, 9, 11, 11, 12, 13, 13, 15, 15, 16, 16, 18, 18, 19, 19, 21, 21,
  22, 22, 23, 24, 24, 25, 26, 26, 27, 27, 28, 29, 29, 30, 30, 30, 31, 32, 32, 33, 33, 33, 34, 34,
  35, 35, 35, 36, 36, 36, 37, 37, 37, 38, 38, 63,
])

const transitionMps = (state: number): number => (state === 62 ? 62 : Math.min(state + 1, 63))

class CabacBitReader {
  readonly #data: Uint8Array
  #position: number

  constructor(data: Uint8Array, bitOffset: number) {
    if (!Number.isSafeInteger(bitOffset) || bitOffset < 0 || bitOffset > data.byteLength * 8) {
      throw invalidInput('HEVC CABAC bit offset is invalid')
    }
    this.#data = data
    this.#position = bitOffset
  }

  get position(): number {
    return this.#position
  }

  readBit(): number {
    if (this.#position >= this.#data.byteLength * 8) {
      throw invalidInput('HEVC CABAC payload is truncated')
    }
    const byte = this.#data[this.#position >>> 3]
    if (byte === undefined) throw invalidInput('HEVC CABAC payload is truncated')
    const bit = (byte >>> (7 - (this.#position & 7))) & 1
    this.#position += 1
    return bit
  }

  readBits(count: number): number {
    if (!Number.isInteger(count) || count < 0 || count > 32) {
      throw invalidInput(`Invalid HEVC CABAC bit count: ${count}`)
    }
    let value = 0
    for (let index = 0; index < count; index += 1) value = value * 2 + this.readBit()
    return value
  }
}

export class HevcCabacContext {
  #mostProbableSymbol: 0 | 1
  #state: number

  constructor(state: number, mostProbableSymbol: 0 | 1) {
    if (!Number.isInteger(state) || state < 0 || state > 63) {
      throw invalidInput('HEVC CABAC context state is invalid')
    }
    this.#state = state
    this.#mostProbableSymbol = mostProbableSymbol
  }

  get mostProbableSymbol(): 0 | 1 {
    return this.#mostProbableSymbol
  }

  get state(): number {
    return this.#state
  }

  transition(decodedLeastProbableSymbol: boolean): void {
    if (!decodedLeastProbableSymbol) {
      this.#state = transitionMps(this.#state)
      return
    }
    if (this.#state === 0) {
      this.#mostProbableSymbol = this.#mostProbableSymbol === 0 ? 1 : 0
    }
    const next = TRANSITION_LPS[this.#state]
    if (next === undefined) throw invalidInput('HEVC CABAC context transition is invalid')
    this.#state = next
  }

  copyFrom(source: HevcCabacContext): void {
    this.#state = source.#state
    this.#mostProbableSymbol = source.#mostProbableSymbol
  }
}

export const initializeHevcCabacContext = (
  initializationValue: number,
  sliceQp: number,
): HevcCabacContext => {
  if (
    !Number.isInteger(initializationValue) ||
    initializationValue < 0 ||
    initializationValue > 255
  ) {
    throw invalidInput('HEVC CABAC initialization value is invalid')
  }
  if (!Number.isInteger(sliceQp) || sliceQp < -72 || sliceQp > 51) {
    throw invalidInput('HEVC CABAC slice QP is invalid')
  }
  const slope = (initializationValue >>> 4) * 5 - 45
  const offset = (initializationValue & 15) * 8 - 16
  const clippedQp = Math.max(0, Math.min(51, sliceQp))
  const preContextState = Math.max(1, Math.min(126, Math.floor((slope * clippedQp) / 16) + offset))
  const mostProbableSymbol: 0 | 1 = preContextState <= 63 ? 0 : 1
  const state = mostProbableSymbol === 1 ? preContextState - 64 : 63 - preContextState
  return new HevcCabacContext(state, mostProbableSymbol)
}

export class HevcCabacDecoder {
  readonly #reader: CabacBitReader
  #offset: number
  #range = 510
  #terminated = false

  constructor(data: Uint8Array, bitOffset = 0) {
    this.#reader = new CabacBitReader(data, bitOffset)
    this.#offset = this.#reader.readBits(9)
    if (this.#offset >= 510) throw invalidInput('HEVC CABAC initial offset is invalid')
  }

  get bitsRead(): number {
    return this.#reader.position
  }

  get currentOffset(): number {
    return this.#offset
  }

  get currentRange(): number {
    return this.#range
  }

  get terminated(): boolean {
    return this.#terminated
  }

  decodeDecision(context: HevcCabacContext): 0 | 1 {
    this.#requireActive()
    const ranges = RANGE_LPS[context.state]
    if (!ranges) throw invalidInput('HEVC CABAC probability state is invalid')
    const leastProbableRange = ranges[(this.#range >>> 6) & 3]
    if (leastProbableRange === undefined) throw invalidInput('HEVC CABAC range index is invalid')
    this.#range -= leastProbableRange
    let decodedLeastProbableSymbol = false
    let value = context.mostProbableSymbol
    if (this.#offset >= this.#range) {
      decodedLeastProbableSymbol = true
      this.#offset -= this.#range
      this.#range = leastProbableRange
      value = value === 0 ? 1 : 0
    }
    context.transition(decodedLeastProbableSymbol)
    this.#renormalize()
    return value
  }

  decodeBypass(): 0 | 1 {
    this.#requireActive()
    this.#offset = this.#offset * 2 + this.#reader.readBit()
    if (this.#offset >= this.#range) {
      this.#offset -= this.#range
      this.#validateRegisters()
      return 1
    }
    this.#validateRegisters()
    return 0
  }

  decodeBypassBits(count: number): number {
    if (!Number.isInteger(count) || count < 0 || count > 32) {
      throw invalidInput(`Invalid HEVC CABAC bypass bit count: ${count}`)
    }
    let value = 0
    for (let index = 0; index < count; index += 1) value = value * 2 + this.decodeBypass()
    return value
  }

  decodeTerminate(): 0 | 1 {
    this.#requireActive()
    this.#range -= 2
    if (this.#offset >= this.#range) {
      this.#terminated = true
      return 1
    }
    this.#renormalize()
    return 0
  }

  alignForBypass(): void {
    this.#requireActive()
    this.#range = 256
    this.#validateRegisters()
  }

  #renormalize(): void {
    while (this.#range < 256) {
      this.#range *= 2
      this.#offset = this.#offset * 2 + this.#reader.readBit()
    }
    this.#validateRegisters()
  }

  #requireActive(): void {
    if (this.#terminated) throw invalidInput('HEVC CABAC decoder is already terminated')
  }

  #validateRegisters(): void {
    if (this.#range < 256 || this.#range > 510 || this.#offset < 0 || this.#offset >= this.#range) {
      throw invalidInput('HEVC CABAC arithmetic state is invalid')
    }
  }
}
